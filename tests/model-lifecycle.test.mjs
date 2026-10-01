// Model lifecycle (DS012 "Model lifecycle", DS030 "Server models"): the manager's limits from settings, no eviction of a model a turn holds,
// pinned (keep_open) and off models, the memory budget, the start-up warmup and its state in /health and /v1/capabilities, the
// GET/POST /v1/server/models API with its persistence, the greeting skip and the parallel sentence calls of textToCleanEnglish.
// A fake llama-server and a fake SymbolicLM service stand in for the models: no model is loaded.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Repository} from '../memory/repository.mjs';
import {demoLexicon} from '../lib/knowledge-seeds.mjs';
import {createServer} from '../server/http.mjs';
import {loadRegistry, ModelManager} from '../server/formalizers.mjs';
import {DEFAULT_MAX_RUNNING, CHAT_PIPELINE, normalizeSettings, loadServerModelSettings, saveServerModelSettings, modeOf} from '../server/server-models.mjs';
import {textToCleanEnglish, GREETING} from '../lib/text-to-clean-english/index.mjs';
import {identify} from '../lib/languages-util/index.mjs';
import {listen, repoPath, repoUrl, tempDir} from './helpers.mjs';

const token = 'alice-secret-token-123456';

function stubManager(t, {ids = ['m-a', 'm-b', 'm-c', 'm-d'], options = {}} = {}) {
  const dir = tempDir(t, 'chatsop-lifecycle-');
  const bin = path.join(dir, 'llama-server');
  fs.copyFileSync(repoPath('tests/fixtures/capability-api/stub-llama-server.cjs'), bin);
  fs.chmodSync(bin, 0o755);
  process.env.STUB_LOG = path.join(dir, 'stub.jsonl');
  t.after(() => { delete process.env.STUB_LOG; });
  for (const id of ids) fs.writeFileSync(path.join(dir, id + '.gguf'), 'fake');
  const file = path.join(dir, 'formalizers.json');
  fs.writeFileSync(file, JSON.stringify({default: ids[0], models: ids.map(id => ({id, label: id, gguf: id + '.gguf', capabilities: ['proofread']}))}));
  const registry = loadRegistry(file, {root: dir});
  const manager = new ModelManager({registry, bin, startTimeoutMs: 15000, ...options});
  t.after(() => manager.stopAll());
  return {dir, registry, manager};
}
const states = (manager, ids) => ids.map(id => manager.status(id).state);

test('the default maxRunning fits one chat turn (four pipeline models) plus one', t => {
  assert.equal(DEFAULT_MAX_RUNNING, CHAT_PIPELINE.length + 1);
  const {manager} = stubManager(t);
  assert.equal(manager.maxRunning, 5);
  assert.ok(manager.memoryBudgetMb > 0, 'a memory budget is set');
  const shipped = loadServerModelSettings(repoPath('config/server-models.json'), new Set(CHAT_PIPELINE));
  assert.ok(shipped.maxRunning >= DEFAULT_MAX_RUNNING, 'the shipped config keeps room for a turn and one more');
  for (const id of CHAT_PIPELINE) assert.equal(shipped.models[id], 'keep_open', id + ' is kept open by default');
});

test('settings set the manager limits and modes; invalid settings are refused', t => {
  const {manager} = stubManager(t);
  const known = new Set(manager.entries.keys());
  const settings = normalizeSettings({maxRunning: 2, idleMinutes: 5, turnWindowSeconds: 7, memoryBudgetMb: 4096, models: {'m-a': 'keep_open', 'm-d': 'off'}}, known);
  manager.applySettings(settings);
  assert.equal(manager.maxRunning, 2);
  assert.equal(manager.idleMs, 5 * 60000);
  assert.equal(manager.turnWindowMs, 7000);
  assert.equal(manager.memoryBudgetMb, 4096);
  assert.deepEqual(['m-a', 'm-b', 'm-d'].map(id => manager.entries.get(id).mode), ['keep_open', 'on_demand', 'off']);
  assert.throws(() => normalizeSettings({maxRunning: 0}, known), /maxRunning/);
  assert.throws(() => normalizeSettings({models: {'m-a': 'sometimes'}}, known), /one of keep_open, on_demand, off/);
  assert.throws(() => normalizeSettings({models: {nope: 'off'}}, known), /Unknown managed model/);
  assert.throws(() => normalizeSettings({maxRunning: 1, models: {'m-a': 'keep_open', 'm-b': 'keep_open'}}, known), /below the 2 models kept open/);
  assert.throws(() => normalizeSettings({surprise: 1}, known), /Unsupported setting/);
  assert.equal(modeOf({}, 'translator-llm'), 'keep_open');
  assert.equal(modeOf({}, 'smollm2-360m-base'), 'on_demand');
});

test('a model a turn holds is never evicted, even when it is the least recently used', async t => {
  const {manager} = stubManager(t, {options: {maxRunning: 2, turnWindowMs: 0}});
  await manager.ensure('m-a');
  await manager.ensure('m-b');
  const release = manager.hold(['m-a']);
  await manager.ensure('m-c');
  assert.deepEqual(states(manager, ['m-a', 'm-b', 'm-c']), ['ready', 'stopped', 'ready'], 'm-b went, the held m-a stayed');
  const releaseAll = manager.hold(['m-c']);
  await assert.rejects(manager.ensure('m-d'), error => error.code === 'formalizer_capacity' && /held by a turn/.test(error.message));
  assert.deepEqual(states(manager, ['m-a', 'm-c', 'm-d']), ['ready', 'ready', 'stopped'], 'a refused start leaves the others running');
  release();
  releaseAll();
  await manager.ensure('m-d');
  assert.equal(manager.status('m-d').state, 'ready');
  assert.equal(manager.entries.get('m-a').busy + manager.entries.get('m-c').busy, 0, 'releases are balanced');
});

test('a model busy with work is not evicted while the work runs', async t => {
  const {manager} = stubManager(t, {options: {maxRunning: 2, turnWindowMs: 0}});
  let unblock;
  const gate = new Promise(resolve => { unblock = resolve; });
  const working = manager.use('m-a', 'proofread', async () => gate);
  await manager.ensure('m-b');
  await manager.ensure('m-c');
  assert.equal(manager.status('m-a').state, 'ready', 'the busy model stayed');
  assert.equal(manager.status('m-b').state, 'stopped');
  unblock('done');
  assert.equal(await working, 'done');
});

test('a kept-open model is pinned: never evicted, never idled out; an on-demand one is', async t => {
  const {manager} = stubManager(t, {options: {maxRunning: 2, turnWindowMs: 0, idleMs: 1000}});
  manager.applySettings(normalizeSettings({maxRunning: 2, models: {'m-a': 'keep_open'}}, new Set(manager.entries.keys())));
  await manager.ensure('m-a');
  await manager.ensure('m-b');
  await manager.ensure('m-c');
  assert.deepEqual(states(manager, ['m-a', 'm-b', 'm-c']), ['ready', 'stopped', 'ready'], 'the pinned least recently used m-a survives; m-b is evicted');
  await manager.sweep(Date.now() + 3600_000);
  assert.deepEqual(states(manager, ['m-a', 'm-c']), ['ready', 'stopped'], 'idle sweep stops the on-demand model only');
});

test('an off model never starts and says so; switching it off stops it', async t => {
  const {manager} = stubManager(t);
  await manager.ensure('m-a');
  manager.applySettings(normalizeSettings({models: {'m-a': 'off'}}, new Set(manager.entries.keys())), {models: {}});
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(manager.status('m-a').state, 'stopped');
  await assert.rejects(manager.ensure('m-a'), error => error.code === 'model_off' && /switched off/.test(error.message));
  assert.equal(manager.status('m-a').mode, 'off');
});

test('the memory budget evicts an idle on-demand model before a start that would not fit', async t => {
  const {manager} = stubManager(t, {options: {maxRunning: 5, turnWindowMs: 0, memoryBudgetMb: 700}});
  manager.estimateMb = () => 300; // each fake model counts as 300 MB
  manager.usedMb = () => 300;
  await manager.ensure('m-a');
  await manager.ensure('m-b');
  await manager.ensure('m-c');
  assert.deepEqual(states(manager, ['m-a', 'm-b', 'm-c']), ['stopped', 'ready', 'ready'], '3 x 300 MB exceeds 700 MB: the least recently used went');
  assert.ok(manager.events().some(e => e.event === 'evict' && e.model === 'm-a' && e.reason === 'memory'));
});

test('the models used within the turn window are the last choice for an eviction', async t => {
  const {manager} = stubManager(t, {options: {maxRunning: 2, turnWindowMs: 60000}});
  await manager.ensure('m-a');
  await manager.ensure('m-b');
  manager.entries.get('m-a').lastUsed = Date.now() - 3600_000; // m-a is old, m-b was used just now, although m-a was used after m-b in order
  manager.touch(manager.entries.get('m-a'));
  manager.entries.get('m-a').lastUsed = Date.now() - 3600_000;
  await manager.ensure('m-c');
  assert.deepEqual(states(manager, ['m-a', 'm-b', 'm-c']), ['stopped', 'ready', 'ready']);
});

test('lifecycle events are recorded: start, ready, evict, stop', async t => {
  const dir = tempDir(t, 'chatsop-lifecycle-log-');
  const {manager} = stubManager(t, {options: {maxRunning: 1, turnWindowMs: 0, logDir: dir}});
  await manager.ensure('m-a');
  await manager.ensure('m-b');
  await manager.stop('m-b');
  assert.deepEqual(manager.events().map(e => e.event + ':' + e.model), ['start:m-a', 'ready:m-a', 'evict:m-a', 'stop:m-a', 'start:m-b', 'ready:m-b', 'stop:m-b']);
  const lines = fs.readFileSync(path.join(dir, 'manager-events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(lines.length, 7);
  assert.equal(typeof lines[1].ms, 'number', 'the ready event carries the start time');
});

// ---- the server: warmup, /health, /v1/capabilities, /v1/server/models ----
async function serverSetup(t, {warm = false} = {}) {
  const dir = tempDir(t, 'chatsop-lifecycle-server-');
  const bin = path.join(dir, 'llama-server');
  fs.copyFileSync(repoPath('tests/fixtures/capability-api/stub-llama-server.cjs'), bin);
  fs.chmodSync(bin, 0o755);
  process.env.STUB_LOG = path.join(dir, 'stub.jsonl');
  t.after(() => { delete process.env.STUB_LOG; });
  for (const name of ['language-proofing', 'symbolic-proofing', 'translator', 'extra']) fs.writeFileSync(path.join(dir, name + '.gguf'), 'fake');
  const file = path.join(dir, 'formalizers.json');
  fs.writeFileSync(file, JSON.stringify({default: 'symbolic-lm', models: [
    {id: 'symbolic-lm', label: 'SymbolicLM', service: repoPath('tests/fixtures/capability-api/stub-symbolic-service.mjs'), capabilities: ['formalize'], memoryMb: 100, startEstimateMs: 1234},
    {id: 'language-proofing-llm', label: 'LanguageProofingLLM', gguf: 'language-proofing.gguf', capabilities: ['proofread']},
    {id: 'translator-llm', label: 'TranslatorLLM', gguf: 'translator.gguf', capabilities: ['translate-clean']},
    {id: 'symbolic-proofing-llm', label: 'SymbolicProofingLLM', gguf: 'symbolic-proofing.gguf', capabilities: ['proofread-symbolic']},
    {id: 'extra-model', label: 'Extra model', gguf: 'extra.gguf', capabilities: ['proofread']}]}));
  const registry = loadRegistry(file, {root: dir});
  const manager = new ModelManager({registry, bin, startTimeoutMs: 15000, logDir: path.join(dir, 'logs')});
  t.after(() => manager.stopAll());
  const repo = new Repository(path.join(dir, 'state'));
  repo.init('base');
  const settingsFile = path.join(dir, 'server-models.json');
  const server = createServer({repo, lexicon: demoLexicon(), base: 'base', authTokens: {alice: token}, config: {promptProfile: 'formal', policy: {allowWrite: true}}, formalizers: {registry, manager}, serverModelsFile: settingsFile});
  const url = await listen(t, server);
  const request = async (method, route, body, headers = {Authorization: 'Bearer ' + token}) => {
    const response = await fetch(url + route, {method, headers: {...headers, ...(body ? {'Content-Type': 'application/json'} : {})}, body: body ? JSON.stringify(body) : undefined});
    return {status: response.status, body: await response.json()};
  };
  return {dir, manager, server, request, settingsFile, registry};
}

test('before a warmup /health and /v1/capabilities report the warm state as disabled', async t => {
  const {request} = await serverSetup(t);
  const health = await request('GET', '/health', undefined, {});
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'ok');
  assert.equal(health.body.warm.state, 'disabled');
  assert.equal((await request('GET', '/healthz', undefined, {})).body.warm.state, 'disabled');
  const capabilities = await request('GET', '/v1/capabilities');
  assert.equal(capabilities.body.warm.state, 'disabled');
  assert.ok(capabilities.body.endpoints.some(e => e.path === '/v1/server/models' && e.method === 'POST'));
});

test('the warmup starts the kept-open models in the background, probes them and reports it', async t => {
  const {request, server, manager} = await serverSetup(t);
  // The four pipeline models are kept open by default; the extra chat model is on demand.
  assert.deepEqual(manager.keptOpen().sort(), [...CHAT_PIPELINE].sort());
  const done = server.capabilities.warmup({resources: false});
  const during = await request('GET', '/health', undefined, {});
  assert.equal(during.status, 200, 'the server answers while the models start');
  assert.equal(during.body.warm.state, 'warming');
  const state = await done;
  assert.equal(state.state, 'warm');
  assert.equal(state.ready, true);
  assert.deepEqual(state.kept_open.sort(), [...CHAT_PIPELINE].sort());
  for (const id of CHAT_PIPELINE) {
    assert.equal(state.models[id].state, 'ready', id);
    assert.equal(state.models[id].warm, true, id + ' was probed');
    assert.equal(typeof state.models[id].probe_ms, 'number');
  }
  assert.equal(manager.status('extra-model').state, 'stopped', 'an on-demand model is not started by the warmup');
  const health = await request('GET', '/health', undefined, {});
  assert.equal(health.body.warm.state, 'warm');
  assert.equal(health.body.warm.ready, true);
  assert.equal((await request('GET', '/v1/capabilities')).body.warm.models['translator-llm'].warm, true);
  // A turn now needs no start: nothing is evicted and nothing is started.
  const before = manager.events().length;
  const answered = await request('POST', '/v1/language/proofread', {message: 'Cine locuiește aici.', sendAll: true});
  assert.equal(answered.status, 200);
  await request('POST', '/v1/understand', {message: 'Who lives here?', rewrite: 'gated'});
  assert.equal(manager.events().slice(before).filter(e => ['start', 'evict', 'stop'].includes(e.event)).length, 0);
});

test('GET /v1/server/models lists every model with its mode, state, memory and start cost', async t => {
  const {request, manager} = await serverSetup(t);
  await manager.ensure('symbolic-lm');
  const {status, body} = await request('GET', '/v1/server/models');
  assert.equal(status, 200);
  assert.equal(body.object, 'server.models');
  assert.deepEqual(body.modes, ['keep_open', 'on_demand', 'off']);
  assert.equal(body.settings.maxRunning, DEFAULT_MAX_RUNNING);
  assert.ok(body.settings.memoryBudgetEffectiveMb > 0);
  const row = id => body.models.find(m => m.id === id);
  assert.equal(row('symbolic-lm').mode, 'keep_open');
  assert.equal(row('symbolic-lm').state, 'ready');
  assert.equal(row('symbolic-lm').running, true);
  assert.equal(typeof row('symbolic-lm').memory_mb, 'number');
  assert.equal(typeof row('symbolic-lm').start_ms, 'number', 'the measured start time');
  assert.equal(row('translator-llm').state, 'stopped');
  assert.equal(row('translator-llm').memory_mb, null);
  assert.equal(row('translator-llm').start_estimate_ms, 3000, 'a small model: the default start estimate');
  assert.equal(row('extra-model').mode, 'on_demand');
  assert.equal(body.running, 1);
  assert.equal(body.warm.state, 'disabled');
});

test('POST /v1/server/models changes modes and limits at once and persists them', async t => {
  const {request, manager, settingsFile} = await serverSetup(t);
  const set = await request('POST', '/v1/server/models', {models: {'extra-model': 'keep_open', 'translator-llm': 'off'}, maxRunning: 7, idleMinutes: 10});
  assert.equal(set.status, 200);
  assert.equal(set.body.settings.maxRunning, 7);
  assert.equal(set.body.settings.idleMinutes, 10);
  assert.equal(manager.idleMs, 600000);
  assert.equal(set.body.models.find(m => m.id === 'translator-llm').mode, 'off');
  assert.equal(set.body.models.find(m => m.id === 'extra-model').mode, 'keep_open');
  for (let i = 0; i < 100 && manager.status('extra-model').state !== 'ready'; i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(manager.status('extra-model').state, 'ready', 'a model put to keep_open starts in the background');
  const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  assert.equal(saved.format, 'chatsop-server-models-v1');
  assert.equal(saved.maxRunning, 7);
  assert.equal(saved.models['translator-llm'], 'off');
  // A restart reads the file back.
  const again = loadServerModelSettings(settingsFile, new Set(manager.entries.keys()));
  assert.equal(again.models['extra-model'], 'keep_open');
  assert.equal(again.idleMinutes, 10);
  // An off translator is a refused start for its callers, who degrade (the cleaning step reports it per sentence).
  const cleaned = await request('POST', '/v1/language/proofread', {message: 'Cine locuiește aici.', sendAll: true});
  assert.equal(cleaned.status, 200);
  assert.equal(cleaned.body.status === 'ok' || cleaned.body.status === 'partial', true);
  assert.equal(cleaned.body.fallback?.from, 'translator-llm', 'the fallback to the proofreader is reported');
  assert.match(cleaned.body.warnings[0].message, /switched off/);
});

test('POST /v1/server/models refuses invalid changes and leaves the settings alone', async t => {
  const {request, settingsFile} = await serverSetup(t);
  const bad = async (patch, code, message) => {
    const response = await request('POST', '/v1/server/models', patch);
    assert.equal(response.status, 400, JSON.stringify(patch));
    assert.equal(response.body.error.code, code);
    assert.match(response.body.error.message, message);
  };
  await bad({maxRunning: 1}, 'invalid_settings', /below the 4 models kept open/);
  await bad({models: {nope: 'off'}}, 'unknown_model', /Unknown managed model/);
  await bad({models: {'extra-model': 'maybe'}}, 'invalid_parameter', /one of/);
  await bad({idleMinutes: 'soon'}, 'invalid_parameter', /idleMinutes/);
  await bad({colour: 'red'}, 'unsupported_parameter', /colour/);
  assert.equal(fs.existsSync(settingsFile), false, 'nothing was written');
  assert.equal((await request('GET', '/v1/server/models')).body.settings.maxRunning, DEFAULT_MAX_RUNNING);
  assert.equal((await request('GET', '/v1/server/models', undefined, {})).status, 401, 'the API needs the server credentials like every other route');
});

test('settings survive a save and load, and a stale model id of the file is ignored', t => {
  const dir = tempDir(t, 'chatsop-lifecycle-file-');
  const file = path.join(dir, 's.json');
  const known = new Set(['a', 'b']);
  saveServerModelSettings(file, normalizeSettings({maxRunning: 3, models: {a: 'keep_open', b: 'off'}}, known));
  fs.writeFileSync(file, JSON.stringify({...JSON.parse(fs.readFileSync(file, 'utf8')), models: {a: 'keep_open', b: 'off', gone: 'keep_open'}}));
  const loaded = loadServerModelSettings(file, known);
  assert.deepEqual(loaded.models, {a: 'keep_open', b: 'off'});
  assert.equal(loaded.maxRunning, 3);
  assert.deepEqual(loadServerModelSettings(path.join(dir, 'missing.json'), known).models, {a: 'on_demand', b: 'on_demand'}, 'no file: the defaults');
});

// ---- textToCleanEnglish: greetings and parallel sentences ----
const lexicons = {has: (lang, word) => ({en: new Set(['hello', 'hi', 'the', 'cat', 'sits', 'on', 'mat', 'good', 'morning', 'thanks', 'dog', 'runs', 'fast']), ro: new Set(['salut'])})[lang].has(word), perMillion: () => 0};
const resources = {identify, lexicons, spellfix: {fix: text => ({text, changes: [], language: 'en', ms: 0})}};
const config = (extra = {}) => ({enabled: true, backends: {english: 'llm', nonEnglish: 'none'}, llm: {sendAll: true, ...extra}, translator: {}});

test('a pure greeting skips the model when the gate finds it clean English, whatever sendAll says', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(JSON.stringify({choices: [{message: {content: 'x'}, finish_reason: 'stop'}]}), {status: 200, headers: {'Content-Type': 'application/json'}}); });
  for (const text of ['Hello', 'Hello!', 'hi there', 'Good morning.', 'Thanks!']) {
    const result = await textToCleanEnglish(text, {config: config(), gateResources: resources, backendOptions: {endpoint: 'http://127.0.0.1:1'}});
    assert.equal(result.changed, false, text);
    assert.equal(result.backend, 'none', text);
    assert.equal(result.skipped?.[0]?.why, 'greeting', text);
  }
  assert.equal(calls, 0, 'no model call for a greeting');
  assert.equal(GREETING.test('Hello, can you check my message?'), false, 'a greeting with a request is not skipped');
  await textToCleanEnglish('The cat sits on the mat.', {config: config(), gateResources: resources, backendOptions: {endpoint: 'http://127.0.0.1:1'}});
  assert.equal(calls, 1, 'an ordinary clean sentence still goes to the model with sendAll');
  await textToCleanEnglish('Hello', {config: config({skipGreetings: false}), gateResources: resources, backendOptions: {endpoint: 'http://127.0.0.1:1'}});
  assert.equal(calls, 2, 'skipGreetings: false sends the greeting too');
});

test('the sentences of one message are cleaned in parallel and put back in order', async t => {
  let running = 0, peak = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    running++; peak = Math.max(peak, running);
    const message = JSON.parse(init.body).messages.at(-1).content;
    await new Promise(resolve => setTimeout(resolve, message.includes('cat') ? 60 : 10));
    running--;
    return new Response(JSON.stringify({choices: [{message: {content: message.toUpperCase()}, finish_reason: 'stop'}]}), {status: 200, headers: {'Content-Type': 'application/json'}});
  });
  const result = await textToCleanEnglish('The cat sits on the mat. The dog runs fast.', {config: config(), gateResources: resources, backendOptions: {endpoint: 'http://127.0.0.1:1'}});
  assert.equal(result.clean, 'THE CAT SITS ON THE MAT. THE DOG RUNS FAST.', 'the slow first sentence still comes first');
  assert.equal(peak, 2, 'both sentences were in flight together');
  assert.equal(result.routes.length, 2);
});
