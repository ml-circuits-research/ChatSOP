// omp integration (DS022): model discovery and cost classes, the fenced run, the authoring loop and the /v1/author API, all against
// a stub of the omp CLI (tests/fixtures/omp/stub-omp.mjs). No test calls a real model.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {OmpModels, costClassOf, ompArguments, ompEnvironment, runOmp, readSessionUsage, authorCircuits, checkFiles, validateAuthored, taskText, ompSettings} from '../lib/omp/index.mjs';
import {FAMILY, productServer} from './product-helpers.mjs';
import {repoPath, tempDir} from './helpers.mjs';

const STUB = repoPath('tests/fixtures/omp/stub-omp.mjs');
const withStub = (t, mode, extra = {}) => {
  const log = path.join(tempDir(t, 'stub-log-'), 'calls.jsonl');
  const saved = {};
  const set = (k, v) => { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  set('STUB_OMP_MODE', mode);
  set('STUB_OMP_LOG', log);
  for (const [k, v] of Object.entries(extra)) set(k, v);
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  return {log, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [])};
};
const goodFile = t => { const f = path.join(tempDir(t, 'good-'), 'good.sop'); fs.writeFileSync(f, FAMILY); return f; };

test('omp models: cost classes, the catalog of the stub, and the cache', async t => {
  const {calls} = withStub(t, 'good');
  const models = new OmpModels({bin: STUB, ttlMs: 60_000});
  const first = await models.list();
  assert.equal(first.available, true);
  assert.equal(first.cached, false);
  const byId = Object.fromEntries(first.models.map(m => [m.id, m]));
  assert.equal(byId['deepseek/deepseek-flash'].cost_class, 'paid_api');
  assert.equal(byId['xai-oauth/grok-4.20-0309-non-reasoning'].cost_class, 'subscription');
  assert.equal(byId['zai/glm-5'].cost_class, 'subscription');
  assert.equal(byId['openrouter/vendor/some-model'].cost_class, 'paid_api');
  assert.equal(byId['mystery/x'].cost_class, 'unknown');
  assert.equal(byId['deepseek/deepseek-flash'].price_per_mtok.input, 0.3);
  assert.equal(first.providers.find(p => p.id === 'xai-oauth').models, 1);
  const callsAfterFirst = calls().length;
  assert.equal((await models.list()).cached, true);
  assert.equal(calls().length, callsAfterFirst, 'the cached listing ran no process');
  assert.equal((await models.list({force: true})).cached, false);
  assert.equal(costClassOf('github-copilot'), 'subscription');
  assert.equal(costClassOf('something-oauth'), 'subscription');
});

test('omp models: a missing omp is reported, never thrown', async t => {
  const models = new OmpModels({bin: '/nonexistent/omp'});
  const answer = await models.list();
  assert.equal(answer.available, false);
  assert.match(answer.reason, /could not be started/);
  assert.deepEqual(answer.models, []);
});

test('omp run: the fence flags, no secret in the environment, files only inside the folder', async t => {
  const folder = tempDir(t, 'omp-run-');
  const args = ompArguments({folder, prompt: 'do it', files: ['TASK.md', 'input/a.txt'], model: 'deepseek/deepseek-flash', timeoutMs: 120_000});
  assert.deepEqual(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2), ['--tools', 'read,write,edit']);
  for (const flag of ['-p', '--no-extensions', '--no-skills', '--no-rules', '--no-lsp']) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf('--cwd') + 1], folder);
  assert.equal(args[args.indexOf('--session-dir') + 1], path.join(folder, '.omp-session'));
  assert.equal(args[args.indexOf('--max-time') + 1], '120');
  assert.ok(args.includes('@input/a.txt') && args.at(-1) === 'do it');
  assert.ok(!args.includes('--api-key'), 'no key on the command line');
  assert.throws(() => ompArguments({folder, prompt: 'x', files: ['/etc/passwd']}), /inside the folder/);
  assert.throws(() => ompArguments({folder, prompt: 'x', files: ['../x']}), /inside the folder/);
  const env = ompEnvironment({PATH: '/bin', CHATSOP_API_KEY: 'secret-secret-secret', RECALL_LLM_KEY: 'k', HOME: '/home/x'});
  assert.deepEqual(Object.keys(env).sort(), ['HOME', 'PATH']);
});

test('omp run: the stub run reports cost, tokens and the output file; a failure and a timeout are results, not exceptions', async t => {
  const {calls} = withStub(t, 'good', {CHATSOP_API_KEY: 'must-not-reach-omp-0000'});
  const folder = tempDir(t, 'omp-run-');
  const run = await runOmp({folder, prompt: 'go', bin: STUB, model: 'deepseek/deepseek-flash'});
  assert.equal(run.ok, true);
  assert.equal(run.usage.cost_usd, 0.0025);
  assert.equal(run.usage.input_tokens, 1000);
  assert.equal(run.usage.turns, 1);
  assert.match(run.final_text, /stub done/);
  assert.ok(fs.existsSync(path.join(folder, run.output_file)));
  assert.equal(calls().at(-1).cwd, folder);
  assert.ok(!calls().at(-1).env_keys.includes('CHATSOP_API_KEY'), 'the server credential never reaches omp');
  process.env.STUB_OMP_MODE = 'fail';
  const failed = await runOmp({folder: tempDir(t, 'omp-run-'), prompt: 'go', bin: STUB});
  assert.equal(failed.ok, false);
  assert.equal(failed.exit_code, 3);
  assert.match(failed.reason, /exited with code 3/);
  const missing = await runOmp({folder: tempDir(t, 'omp-run-'), prompt: 'go', bin: '/nonexistent/omp'});
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /could not be started/);
  process.env.STUB_OMP_MODE = 'slow';
  const slow = await runOmp({folder: tempDir(t, 'omp-run-'), prompt: 'go', bin: STUB, timeoutMs: 300, graceMs: 100});
  assert.equal(slow.timed_out, true);
  assert.equal(slow.ok, false);
  assert.ok(slow.duration_ms < 10_000);
  assert.deepEqual(readSessionUsage(path.join(tempDir(t), 'nothing')).turns, 0);
});

test('authoring: files are checked (text only, safe names, bounded)', () => {
  assert.deepEqual(checkFiles([{name: '../../etc/passwd', text: 'x'}, {name: 'passwd', text: 'y'}]).map(f => f.name), ['passwd', '2-passwd']);
  assert.throws(() => checkFiles([{name: 'a.bin', text: 'a\0b'}]), e => e.code === 'unsupported_file');
  assert.throws(() => checkFiles([{name: 'a'}]), e => e.code === 'invalid_files');
  assert.throws(() => checkFiles(Array.from({length: 11}, (_, i) => ({name: `f${i}`, text: 'x'}))), e => e.status === 413);
  assert.throws(() => checkFiles([{name: 'big', text: 'x'.repeat(2_000_001)}]), e => e.status === 413);
  assert.match(taskText({instructions: 'Do X', files: [{name: 'a.txt', bytes: 3}], hasVocabulary: true}), /Work ONLY inside this folder[\s\S]*Do X[\s\S]*input\/a\.txt[\s\S]*existing-vocabulary/);
});

test('authoring: a valid first answer is one round, the folder holds TASK.md, the skill and the input', async t => {
  withStub(t, 'good', {STUB_OMP_GOOD: goodFile(t)});
  const folder = tempDir(t, 'author-');
  const progress = [];
  const result = await authorCircuits({folder, files: [{name: 'manual.txt', text: 'Ann is the parent of Bob.'}], instructions: 'Compile the family.', model: 'deepseek/deepseek-flash', bin: STUB, onProgress: p => progress.push(p.phase)});
  assert.equal(result.status, 'validated');
  assert.equal(result.ok, true);
  assert.equal(result.rounds, 1);
  assert.match(result.circuits[0].text, /@r_grand rule/);
  assert.match(result.report, /Stub report/);
  assert.equal(result.usage.cost_usd, 0.0025);
  assert.deepEqual(progress, ['writing', 'validating']);
  for (const f of ['TASK.md', 'skill/SKILL.md', 'skill/authoring-guide.md', 'input/manual.txt', 'result.json']) assert.ok(fs.existsSync(path.join(folder, f)), f);
  assert.match(fs.readFileSync(path.join(folder, 'TASK.md'), 'utf8'), /Compile the family\./);
});

test('authoring: the host repairs a broken answer with the validator output, within a bounded number of rounds', async t => {
  const {calls} = withStub(t, 'fix', {STUB_OMP_GOOD: goodFile(t)});
  const fixed = await authorCircuits({folder: tempDir(t, 'author-'), instructions: 'Compile.', bin: STUB, maxFixRounds: 2});
  assert.equal(fixed.status, 'validated');
  assert.equal(fixed.rounds, 2);
  assert.equal(calls().filter(c => c.args.includes('-c')).length, 1, 'the second round continues the same omp session');
  assert.match(calls().at(-1).args.at(-1), /validator[\s\S]*missing_field|unknown|then/, 'the fix prompt carries the validator problems');
  assert.equal(fixed.usage.cost_usd, 0.005);
  const bad = withStub(t, 'bad');
  const stuck = await authorCircuits({folder: tempDir(t, 'author-'), instructions: 'Compile.', bin: STUB, maxFixRounds: 2});
  assert.equal(stuck.status, 'invalid');
  assert.equal(stuck.ok, false);
  assert.equal(stuck.rounds, 3, 'one write plus two fix rounds, then it stops');
  assert.ok(stuck.validation.problems.length > 0);
  assert.equal(bad.calls().length, 3);
});

test('authoring: a failed or silent agent is reported, never thrown', async t => {
  withStub(t, 'fail');
  const failed = await authorCircuits({folder: tempDir(t, 'author-'), instructions: 'Compile.', bin: STUB});
  assert.equal(failed.status, 'failed');
  assert.match(failed.reason, /exited with code 3/);
  process.env.STUB_OMP_MODE = 'none';
  const silent = await authorCircuits({folder: tempDir(t, 'author-'), instructions: 'Compile.', bin: STUB, maxFixRounds: 1});
  assert.equal(silent.status, 'invalid');
  assert.equal(silent.validation.problems[0].code, 'missing_output');
  await assert.rejects(authorCircuits({folder: tempDir(t, 'author-'), bin: STUB}), /Attach files or give instructions/);
});

test('authoring: circuits are validated together with the theory they join (duplicate ids, forbidden wires)', () => {
  const existing = [{name: 'family', text: FAMILY}];
  assert.equal(validateAuthored({knowledge: FAMILY, existing}).problems.some(p => p.code === 'duplicate_id'), true);
  assert.equal(validateAuthored({knowledge: '@j jsEval\n  expression 1\n', existing: []}).ok, false);
  assert.equal(validateAuthored({knowledge: FAMILY, queries: '@q query\n  where great_grandparent ?who di\n  select ?who\n'}).ok, true);
});

test('omp settings: the binary can be overridden by the environment', () => {
  assert.equal(ompSettings({}, {}).bin, 'omp');
  assert.equal(ompSettings({omp: {maxFixRounds: 1}}, {CHATSOP_OMP_BIN: '/x/stub'}).bin, '/x/stub');
  assert.equal(ompSettings({omp: {maxFixRounds: 1}}, {}).maxFixRounds, 1);
});

test('API: GET /v1/omp/models is open to any authenticated user and cached; POST /v1/author adds the validated circuits to the session', async t => {
  const {calls} = withStub(t, 'good', {STUB_OMP_GOOD: goodFile(t)});
  const s = await productServer(t, {config: {omp: {bin: STUB}}});
  await s.admin('/v1/memories', 'POST', {name: 'Empty', id: 'empty'});
  assert.equal((await s.user('/v1/omp/models')).status, 200);
  const listing = await s.admin('/v1/omp/models');
  assert.equal(listing.status, 200);
  assert.equal(listing.body.available, true);
  assert.equal(listing.body.models.length, 5);
  const before = calls().length;
  assert.equal((await s.admin('/v1/omp/models')).body.cached, true);
  assert.equal(calls().length, before);
  const sid = (await s.user('/v1/sessions', 'POST', {base: 'empty'})).body.id;
  assert.equal((await s.user('/v1/author', 'POST', {session: sid})).status, 400, 'needs files or instructions');
  assert.equal((await s.user('/v1/author', 'POST', {session: sid, instructions: 'x', model: 'nope/model'})).body.error.code, 'unknown_model');
  assert.equal((await s.user('/v1/author', 'POST', {session: sid, instructions: 'x', bogus: 1})).status, 400);
  const done = await s.user('/v1/author', 'POST', {session: sid, files: [{name: 'family.txt', text: 'Ann is the parent of Bob.'}], instructions: 'Compile.', model: 'deepseek/deepseek-flash'});
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.status, 'validated');
  assert.equal(done.body.cost_class, 'paid_api');
  assert.equal(done.body.usage.cost_usd, 0.0025);
  assert.match(done.body.added.file, /authored-r-/);
  assert.match(done.body.folder, new RegExp(`^sessions/${sid}/requests/r-`));
  assert.ok(fs.existsSync(path.join(s.chatData.root, done.body.folder, 'TASK.md')));
  assert.match((await s.user(`/v1/sessions/${sid}/theory`)).body.theory, /@r_grand/, 'validated circuits join the session at once');
  const status = await s.user(`/v1/sessions/${sid}/requests/${done.body.request_id}`);
  assert.equal(status.body.status, 'validated');
  assert.equal((await s.user(`/v1/sessions/${sid}/requests/r-none`)).status, 404);
});

test('API: wait false answers 202 and the status route follows the request; a request without a session uses tmp', async t => {
  withStub(t, 'good', {STUB_OMP_GOOD: goodFile(t)});
  const s = await productServer(t, {config: {omp: {bin: STUB}}});
  await s.admin('/v1/memories', 'POST', {name: 'Empty', id: 'empty'});
  const sid = (await s.user('/v1/sessions', 'POST', {base: 'empty'})).body.id;
  const started = await s.user('/v1/author', 'POST', {session: sid, instructions: 'Compile.', wait: false});
  assert.equal(started.status, 202);
  let status;
  for (let i = 0; i < 100; i++) {
    status = (await s.user(started.body.status_url)).body;
    if (status.status !== 'running') break;
    await new Promise(r => setTimeout(r, 50));
  }
  assert.equal(status.status, 'validated');
  assert.ok(status.result.added?.file);
  const loose = await s.user('/v1/author', 'POST', {instructions: 'Compile.'});
  assert.equal(loose.status, 200);
  assert.equal(loose.body.added, null);
  assert.match(loose.body.folder, /^tmp\//);
});

test('API: an unavailable or disabled omp is a clear 503, not a crash', async t => {
  const s = await productServer(t, {config: {omp: {bin: '/nonexistent/omp'}}});
  await s.admin('/v1/memories', 'POST', {name: 'Empty', id: 'empty'});
  const sid = (await s.user('/v1/sessions', 'POST', {base: 'empty'})).body.id;
  const listing = await s.admin('/v1/omp/models');
  assert.equal(listing.body.available, false);
  const r = await s.user('/v1/author', 'POST', {session: sid, instructions: 'x'});
  assert.equal(r.status, 503);
  assert.equal(r.body.error.code, 'omp_unavailable');
  const off = await productServer(t, {config: {omp: {bin: STUB, enabled: false}}});
  await off.admin('/v1/memories', 'POST', {name: 'Empty', id: 'empty'});
  const sid2 = (await off.user('/v1/sessions', 'POST', {base: 'empty'})).body.id;
  assert.match((await off.user('/v1/author', 'POST', {session: sid2, instructions: 'x'})).body.error.message, /disabled/);
});
