import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {runOmpRpc, closeOmpRpc} from '../lib/omp/rpc.mjs';
import {repoPath, tempDir} from './helpers.mjs';

const bin = repoPath('tests/fixtures/omp/stub-rpc.mjs');
function setup(t) {
  const folder = tempDir(t, 'omp-rpc-');
  const log = path.join(folder, 'calls.jsonl');
  t.after(closeOmpRpc);
  const options = {folder, bin, system: 'Immutable system prompt', model: 'fixture/model', thinking: 'low',
    timeoutMs: 1500, graceMs: 0, env: {PATH: process.env.PATH, STUB_RPC_LOG: log, CHATSOP_API_KEY: 'private'}};
  const calls = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [];
  return {options, calls};
}

test('separate requests reuse one fenced process without sharing history; interleaved repair restores its own session', async t => {
  const {options, calls} = setup(t);
  const a = {}, b = {};
  const first = await runOmpRpc({...options, sessionKey: a, prompt: 'first'});
  const otherFolder = tempDir(t, 'other-rpc-request-');
  const second = await runOmpRpc({...options, folder: otherFolder, sessionKey: b, prompt: 'second'});
  fs.rmSync(otherFolder, {recursive: true, force: true});
  const repaired = await runOmpRpc({...options, sessionKey: a, continueSession: true, prompt: 'repair'});
  const repairedB = await runOmpRpc({...options, folder: otherFolder, sessionKey: b, continueSession: true, prompt: 'repair b'});
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(repaired.ok, true);
  assert.equal(repairedB.ok, true);
  const prompts = calls().filter(c => c.type === 'prompt');
  assert.equal(calls().filter(c => c.kind === 'spawn').length, 1);
  assert.equal(calls().filter(c => c.type === 'new_session').length, 2);
  assert.notEqual(prompts[0].session, prompts[1].session);
  assert.equal(prompts[0].session, prompts[2].session);
  assert.equal(repaired.final_text, `${prompts[0].session}:2:repair`);
  assert.equal(second.final_text, `${prompts[1].session}:1:second`);
  assert.equal(repairedB.final_text, `${prompts[1].session}:2:repair b`);
  assert.deepEqual(repaired.usage, {turns: 1, input_tokens: 20, output_tokens: 7, cache_read_tokens: 2, cost_usd: 0.00125});
  assert.deepEqual(first.usage, {turns: 1, input_tokens: 10, output_tokens: 7, cache_read_tokens: 2, cost_usd: 0.00125});
  const spawn = calls().find(c => c.kind === 'spawn');
  assert.notEqual(spawn.cwd, options.folder, 'worker lives outside disposable request folder');
  for (const flag of ['--no-tools', '--no-extensions', '--no-skills', '--no-rules', '--no-lsp', '--no-title']) assert.ok(spawn.args.includes(flag));
  assert.equal(spawn.args[spawn.args.indexOf('--system-prompt') + 1], options.system);
  assert.ok(!spawn.env_keys.includes('CHATSOP_API_KEY'));
});

test('simultaneous calls serialize per worker and preserve distinct sessions', async t => {
  const {options, calls} = setup(t);
  const [a, b, c] = await Promise.all(['a', 'b', 'c'].map(prompt => runOmpRpc({...options, sessionKey: {}, prompt})));
  assert.ok([a, b, c].every(r => r.ok));
  assert.equal(new Set([a.final_text, b.final_text, c.final_text].map(s => s.split(':')[0])).size, 3);
  assert.equal(calls().filter(c => c.kind === 'spawn').length, 1);
  assert.deepEqual(calls().filter(c => c.type === 'prompt').map(c => c.message), ['a', 'b', 'c']);
});

test('asynchronous prompt error after immediate ack is failure; subsequent request cannot consume stale turn', async t => {
  const {options, calls} = setup(t);
  const bad = await runOmpRpc({...options, sessionKey: {}, prompt: 'ASYNC_ERROR'});
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /asynchronous prompt rejected/);
  assert.equal(bad.final_text, '');
  const good = await runOmpRpc({...options, sessionKey: {}, prompt: 'fresh'});
  assert.equal(good.ok, true);
  assert.notEqual(calls().filter(c => c.kind === 'spawn')[0].pid, calls().filter(c => c.kind === 'spawn')[1].pid);
});

test('crash invalidates repair; a new request starts a fresh process', async t => {
  const {options, calls} = setup(t);
  const key = {};
  assert.equal((await runOmpRpc({...options, sessionKey: key, prompt: 'first'})).ok, true);
  const crashed = await runOmpRpc({...options, sessionKey: key, continueSession: true, prompt: 'CRASH'});
  assert.equal(crashed.ok, false);
  assert.equal(crashed.final_text, '');
  const newRequest = await runOmpRpc({...options, sessionKey: {}, prompt: 'new'});
  assert.equal(newRequest.ok, true);
  assert.equal(newRequest.final_text.split(':')[1], '1');
  assert.equal((await runOmpRpc({...options, sessionKey: key, continueSession: true, prompt: 'repair'})).ok, false);
  assert.equal(calls().filter(c => c.kind === 'spawn').length, 2);
});

test('timeout kills the worker, releases the queue, and never hands delayed output to a later call', async t => {
  const {options, calls} = setup(t);
  const stalled = runOmpRpc({...options, sessionKey: {}, prompt: 'STALL', timeoutMs: 140});
  const next = runOmpRpc({...options, sessionKey: {}, prompt: 'after timeout', timeoutMs: 1500});
  const [timed, recovered] = await Promise.all([stalled, next]);
  assert.equal(timed.ok, false);
  assert.equal(timed.timed_out, true);
  assert.equal(timed.final_text, '');
  assert.equal(recovered.ok, true);
  assert.equal(recovered.final_text.split(':')[1], '1');
  assert.equal(calls().filter(c => c.kind === 'spawn').length, 2);
});

test('assistant failure and prohibited tool events never return successful text', async t => {
  const {options} = setup(t);
  const failure = await runOmpRpc({...options, sessionKey: {}, prompt: 'ASSISTANT_ERROR'});
  assert.equal(failure.ok, false);
  assert.match(failure.reason, /provider failed/);
  const forbidden = await runOmpRpc({...options, sessionKey: {}, prompt: 'TOOL'});
  assert.equal(forbidden.ok, false);
  assert.match(forbidden.reason, /forbidden tool/);
  const malformed = await runOmpRpc({...options, sessionKey: {}, prompt: 'NULL_FRAME'});
  assert.equal(malformed.ok, false);
  assert.equal(malformed.final_text, '');
  assert.equal((await runOmpRpc({...options, sessionKey: {}, prompt: 'fresh after malformed'})).ok, true);
});

test('cancelled reset and wrong-session restoration never send another request into retained history', async t => {
  const {options, calls} = setup(t);
  const configured = {...options, env: {...options.env, STUB_RPC_CANCEL_RESET: '1'}};
  assert.equal((await runOmpRpc({...configured, sessionKey: {}, prompt: 'private first request'})).ok, true);
  const refused = await runOmpRpc({...configured, sessionKey: {}, prompt: 'different user'});
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /session was cancelled/);
  assert.deepEqual(calls().filter(c => c.type === 'prompt').map(c => c.message), ['private first request']);
  closeOmpRpc();
  const switched = {...options, env: {...options.env, STUB_RPC_BAD_SWITCH: '1'}};
  const first = {};
  assert.equal((await runOmpRpc({...switched, sessionKey: first, prompt: 'a'})).ok, true);
  assert.equal((await runOmpRpc({...switched, sessionKey: {}, prompt: 'b'})).ok, true);
  const bad = await runOmpRpc({...switched, sessionKey: first, continueSession: true, prompt: 'repair a'});
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /different session/);
  assert.ok(!calls().some(c => c.message === 'repair a'));
});

test('a token-limit stop is not a completed circuit even when its partial text parses; usage remains accounted', async t => {
  const {options} = setup(t);
  const partial = await runOmpRpc({...options, sessionKey: {}, prompt: 'TRUNCATED'});
  assert.equal(partial.ok, false);
  assert.equal(partial.final_text, '');
  assert.match(partial.reason, /incomplete \(length\)/);
  assert.equal(partial.usage.output_tokens, 7);
});
