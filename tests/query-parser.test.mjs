// The request parser of a turn (server/query-parser.mjs, DS009 "Request parser"): the coding agent is the only parser; the subscription chain,
// the honest failures (`parse_unavailable`, `parse_failed`, never a local fallback), the cache, and the chat/API surface, against stubs. No test calls a model.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createQueryParser, queryParserSettings} from '../server/query-parser.mjs';
import {FAMILY, productServer, stubQueryParser} from './product-helpers.mjs';
import {lex, repoPath, tempDir} from './helpers.mjs';

const STUB = repoPath('tests/fixtures/omp/stub-omp.mjs');
const Q = (object = 'Lab Alpha', relation = 'works_at') => `@q query\n  where match\n    relation "${relation}"\n    role subject "Ana"\n    role object "${object}"\n    polarity affirmed\n  end\n`;
const ABSTAIN = '@u unclear\n  kind gibberish\n';
const stubBackend = (answers, calls = []) => ({id: 'stub', model: 'stub/model', generate: async ({history}) => { calls.push(history.length); const a = typeof answers === 'function' ? answers() : answers; return {ok: true, sop: a, usage: {turns: 1, cost_usd: 0.01}, duration_ms: 1}; }});
const parserWith = (backend, extra = {}) => createQueryParser({settings: queryParserSettings({queryParser: {maxFixRounds: 1, ...extra}}), backendFactory: () => backend});

test('the coding agent is the only parser; the record says who parsed, the model chain, the cost and the time', async () => {
  const settings = queryParserSettings();
  assert.deepEqual(settings.models, ['openai-codex/gpt-6-luna'], 'the chain defaults to the backend model');
  assert.equal('default' in settings, false, 'there is no parser choice any more');
  const qp = parserWith(stubBackend(Q()));
  const r = await qp.parse({message: 'Does Ana work at Lab Alpha?', lexicon: lex, memoryKey: 'm1'});
  assert.equal(r.sop, Q());
  assert.equal(r.parse.parser, 'coding_agent');
  assert.equal(r.parse.model, 'stub/model');
  assert.equal(r.parse.rounds, 1);
  assert.equal(r.parse.cost_usd, 0.01);
  assert.equal(r.parse.cache, 'miss');
  assert.deepEqual(r.parse.tried, []);
});

test('the subscription chain: a model omp cannot use is skipped, a run that delivers nothing moves to the next model', async () => {
  const models = [{id: 'b/two'}];
  const ompModels = {list: async () => ({available: true, models})};
  const seen = [];
  const factory = s => ({id: 'stub', model: s.model, generate: async () => { seen.push(s.model); return s.model === 'b/two' ? {ok: true, sop: Q(), usage: {cost_usd: 0.02}, duration_ms: 1} : {ok: false, sop: '', usage: {}, duration_ms: 1, reason: 'timeout'}; }});
  const chain = createQueryParser({settings: queryParserSettings({queryParser: {models: ['a/one', 'b/two', 'c/three'], maxFixRounds: 0}}), ompModels, backendFactory: factory});
  const r = await chain.parse({message: 'Does Ana work at Lab Alpha?', lexicon: lex});
  assert.deepEqual(seen, ['b/two'], 'a/one and c/three are not usable by omp');
  assert.equal(r.parse.model, 'b/two');
  assert.deepEqual(r.parse.tried, ['a/one', 'c/three']);
  models.push({id: 'a/one'});
  seen.length = 0;
  const second = await chain.parse({message: 'Is it so?', lexicon: lex});
  assert.deepEqual(seen, ['a/one', 'b/two'], 'a/one fails to deliver, b/two answers');
  assert.equal(second.parse.model, 'b/two');
  assert.equal(chain.stats().model_switches, 1);
  // The session's preferred model is tried first.
  models.push({id: 'c/three'});
  seen.length = 0;
  const preferred = await chain.parse({message: 'Another one?', lexicon: lex, preferredModel: 'c/three'});
  assert.deepEqual(seen.slice(0, 1), ['c/three']);
  assert.equal(preferred.parse.model, 'b/two');
});

test('failures are honest: parse_unavailable when no model can run, parse_failed for an invalid circuit, never a local answer', async () => {
  const none = createQueryParser({settings: queryParserSettings(), ompModels: {list: async () => ({available: false, reason: 'omp could not be started'})}, backendFactory: () => stubBackend(Q())});
  await assert.rejects(none.parse({message: 'm', lexicon: lex}), error => error.code === 'parse_unavailable' && error.status === 503 && /not available/.test(error.message) && error.parse.parser === 'coding_agent');
  const off = createQueryParser({settings: queryParserSettings(), ompConfig: {enabled: false}, ompModels: {list: async () => ({available: true, models: []})}, backendFactory: () => stubBackend(Q())});
  await assert.rejects(off.parse({message: 'm', lexicon: lex}), error => error.code === 'parse_unavailable' && /disabled/.test(error.message));
  const missing = createQueryParser({settings: queryParserSettings(), ompModels: {list: async () => ({available: true, models: [{id: 'other/model'}]})}, backendFactory: () => stubBackend(Q())});
  await assert.rejects(missing.parse({message: 'm', lexicon: lex}), error => error.code === 'parse_unavailable' && /cannot use any model of the chain/.test(error.message));
  const down = {id: 'x', generate: async () => ({ok: false, sop: '', usage: {}, duration_ms: 1, reason: 'omp exceeded the 120 s limit'})};
  await assert.rejects(parserWith(down).parse({message: 'm', lexicon: lex}), error => error.code === 'parse_unavailable' && /120 s/.test(error.message) && Boolean(error.parse.failed));
  const invalid = parserWith(stubBackend('@q query\n  where bogus\n'));
  await assert.rejects(invalid.parse({message: 'm', lexicon: lex}), error => error.code === 'parse_failed' && error.status === 422 && /invalid/.test(error.message) && error.parse.rounds === 2);
  const gibberish = await parserWith(stubBackend(ABSTAIN)).parse({message: 'asdf', lexicon: lex});
  assert.match(gibberish.sop, /gibberish/, 'an honest unclear is the coding agent\'s answer, not a failure');
  let release;
  const gate = new Promise(r => { release = r; });
  const slow = {id: 's', model: 's', generate: async () => { await gate; return {ok: true, sop: Q(), usage: {}, duration_ms: 1}; }};
  const busy = parserWith(slow, {maxConcurrent: 1});
  const first = busy.parse({message: 'one', lexicon: lex});
  await new Promise(r => setTimeout(r, 10));
  await assert.rejects(busy.parse({message: 'two', lexicon: lex}), error => error.code === 'parse_unavailable' && /busy/.test(error.message));
  release();
  assert.equal((await first).parse.parser, 'coding_agent');
});

test('identical requests are cached per memory version', async () => {
  const calls = [];
  const qp = parserWith(stubBackend(Q(), calls));
  const args = {message: '  Does   Ana like Bob? ', lexicon: lex, memoryKey: 'v1'};
  const a = await qp.parse(args);
  const b = await qp.parse({...args, message: 'does ana like bob?'});
  assert.equal(a.parse.cache, 'miss');
  assert.equal(b.parse.cache, 'hit');
  assert.equal(b.parse.cost_usd, 0);
  assert.equal(calls.length, 1);
  await qp.parse({...args, memoryKey: 'v2'});
  assert.equal(calls.length, 2, 'another memory version asks again');
  assert.equal(qp.stats().cache_hits, 1);
});

test('chat: the coding agent (stub omp) writes the circuit, the packet records it; session query takes a message; no model is parse_unavailable', async t => {
  const saved = {};
  for (const [k, v] of Object.entries({CHATSOP_OMP_BIN: STUB, STUB_OMP_MODE: 'good', STUB_OMP_QUERY: Q('Dan', 'parent')})) { saved[k] = process.env[k]; process.env[k] = v; }
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const s = await productServer(t, {config: {queryParser: {backend: {kind: 'omp', model: 'deepseek/deepseek-flash'}, timeoutSeconds: 30}}, serverOptions: {queryParser: null}});
  await s.admin('/v1/memories', 'POST', {name: 'Family', id: 'family', circuits: [{name: 'family', text: FAMILY}]});
  const id = (await s.user('/v1/sessions', 'POST', {base: 'family'})).body.id;
  const chat = (extra = {}) => s.user('/v1/chat/completions', 'POST', {model: 'chatsop-local', session_id: id, messages: [{role: 'user', content: 'Does Ana like Alpha Lab?'}], ...extra});
  const first = await chat();
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const c = first.body.chatSop;
  assert.equal(c.parse.parser, 'coding_agent');
  assert.equal(c.parse.model, 'deepseek/deepseek-flash');
  assert.ok(c.parse.cost_usd > 0);
  assert.match(c.model_sop, /Dan/, 'the circuit is the coding agent\'s');
  assert.equal(c.formalizer_model, 'coding-agent:deepseek/deepseek-flash');
  assert.equal((await chat({parser: 'local'})).status, 400, 'the parser parameter is gone');
  assert.equal((await chat({language: 'ro'})).status, 400, 'the language parameter is gone');
  assert.equal((await s.user(`/v1/sessions/${id}/settings`, 'POST', {parser: 'local'})).status, 400);
  const q = await s.user(`/v1/sessions/${id}/query`, 'POST', {message: 'Does Ana like Alpha Lab?'});
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.equal(q.body.parse.parser, 'coding_agent');
  assert.equal(q.body.parse.cache, 'hit', 'the same request on the same memory is served from the cache');
  assert.match(q.body.model_sop, /Dan/);
  assert.equal((await s.user(`/v1/sessions/${id}/query`, 'POST', {message: 'x', query: 'y'})).status, 400);
  const models = await s.user('/v1/models');
  assert.equal(models.body.data[0].chatsop.coding_agent.available, true);
  assert.ok(models.body.data[0].chatsop.coding_agent.models.length > 0, 'the model chain is listed');
});

test('chat: a coding agent that is not installed is parse_unavailable (503) with the record, never a local answer', async t => {
  const saved = process.env.CHATSOP_OMP_BIN;
  process.env.CHATSOP_OMP_BIN = '/nonexistent/omp';
  t.after(() => { if (saved === undefined) delete process.env.CHATSOP_OMP_BIN; else process.env.CHATSOP_OMP_BIN = saved; });
  const s = await productServer(t, {serverOptions: {queryParser: null}});
  const id = (await s.user('/v1/sessions', 'POST', {base: 'default'})).body.id;
  const r = await s.user('/v1/chat/completions', 'POST', {model: 'chatsop-local', session_id: id, messages: [{role: 'user', content: 'Does Ana like Alpha Lab?'}]});
  assert.equal(r.status, 503, JSON.stringify(r.body));
  assert.equal(r.body.error.code, 'parse_unavailable');
  assert.equal(r.body.chatSop.status, 'parse_unavailable');
  assert.match(r.body.chatSop.reason, /not available/);
  assert.equal((await s.user('/readyz')).status, 503);
  const stub = await productServer(t, {serverOptions: {queryParser: stubQueryParser({available: false})}});
  const down = await stub.user('/v1/chat/completions', 'POST', {model: 'chatsop-local', messages: [{role: 'user', content: 'hi'}]});
  assert.equal(down.status, 503);
});

test('a clear question no predicate expresses is an honest unclear and is logged as a gap of the memory', async t => {
  const root = tempDir(t, 'qp-gap-');
  const qp = createQueryParser({settings: queryParserSettings({queryParser: {}}), chatData: {root, tmpFolder: () => null}, backendFactory: () => stubBackend('@u unclear\n  kind relation_not_in_memory\n')});
  const r = await qp.parse({message: 'Who employs Ana?', lexicon: lex, memoryKey: 'gap-1'});
  assert.equal(r.parse.parser, 'coding_agent');
  assert.match(r.sop, /relation_not_in_memory/);
  const log = fs.readFileSync(path.join(root, 'query-gaps.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(log.length, 1);
  assert.equal(log[0].message, 'Who employs Ana?');
  assert.equal(log[0].memory, 'gap-1');
  assert.ok(log[0].closest.length > 0, 'the closest predicates are material for the authoring path');
});
