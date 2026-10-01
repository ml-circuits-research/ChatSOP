// The request parsers of a turn (server/query-parser.mjs, DS031 "Request parsers"): coding_agent by default, local on request, fallbacks
// with their reason, the cache, and the chat/API surface, against stubs. No test calls a model.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createQueryParser, queryParserSettings, checkParser, PARSERS} from '../server/query-parser.mjs';
import {FAMILY, productServer} from './product-helpers.mjs';
import {lex, repoPath, tempDir} from './helpers.mjs';

const STUB = repoPath('tests/fixtures/omp/stub-omp.mjs');
const Q = (object = 'Lab Alpha', relation = 'works_at') => `@q query\n  where match\n    relation "${relation}"\n    role subject "Ana"\n    role object "${object}"\n    polarity affirmed\n  end\n`;
const LOCAL = '@q query\n  where match\n    relation "like"\n    role subject "Local"\n    role object "Parser"\n    polarity affirmed\n  end\n';
const ABSTAIN = '@u unclear\n  kind gibberish\n';
const stubBackend = (answers, calls = []) => ({id: 'stub', model: 'stub/model', generate: async ({history}) => { calls.push(history.length); const a = typeof answers === 'function' ? answers() : answers; return {ok: true, sop: a, usage: {turns: 1, cost_usd: 0.01}, duration_ms: 2}; }});
const parserWith = (backend, extra = {}) => createQueryParser({settings: queryParserSettings({queryParser: {maxFixRounds: 1, ...extra}}), backendFactory: () => backend});

test('the coding agent is the default parser; the packet record says who parsed, the cost and the time', async () => {
  assert.equal(queryParserSettings().default, 'coding_agent');
  assert.deepEqual(PARSERS, ['coding_agent', 'local']);
  const qp = parserWith(stubBackend(Q()));
  let localCalls = 0;
  const r = await qp.parse({message: 'Does Ana like Bob?', lexicon: lex, memoryKey: 'm1', local: async () => { localCalls++; return LOCAL; }});
  assert.equal(r.sop, Q());
  assert.equal(r.parse.parser, 'coding_agent');
  assert.equal(r.parse.model, 'stub/model');
  assert.equal(r.parse.rounds, 1);
  assert.equal(r.parse.cost_usd, 0.01);
  assert.equal(r.parse.fallback, null);
  assert.equal(r.parse.cache, 'miss');
  assert.equal(localCalls, 0, 'localQuery is not run when the coding agent answers');
  assert.throws(() => checkParser('oracle'), /parser must be one of/);
  assert.equal(checkParser(undefined), null);
});

test('parser local runs SymbolicLM only; a failing or abstaining local is retried with the coding agent', async () => {
  const calls = [];
  const qp = parserWith(stubBackend(Q(), calls));
  const local = await qp.parse({parser: 'local', message: 'm', lexicon: lex, local: async () => LOCAL});
  assert.equal(local.parse.parser, 'local');
  assert.equal(local.sop, LOCAL);
  assert.equal(calls.length, 0);
  const abstained = await qp.parse({parser: 'local', message: 'Does Ana like Bob?', lexicon: lex, memoryKey: 'a', local: async () => ABSTAIN});
  assert.equal(abstained.parse.parser, 'coding_agent');
  assert.equal(abstained.parse.fallback.from, 'local');
  assert.match(abstained.parse.fallback.reason, /abstained/);
  const failed = await qp.parse({parser: 'local', message: 'Does Ana like Bob? 2', lexicon: lex, memoryKey: 'a', local: async () => { throw new Error('SymbolicLM down'); }});
  assert.equal(failed.parse.parser, 'coding_agent');
  assert.match(failed.parse.fallback.reason, /SymbolicLM down/);
  const off = parserWith(stubBackend(Q()), {fallbackOnLocalAbstain: false});
  const stays = await off.parse({parser: 'local', message: 'm', lexicon: lex, local: async () => ABSTAIN});
  assert.equal(stays.parse.parser, 'local');
  assert.equal(stays.parse.abstained, true);
  await assert.rejects(off.parse({parser: 'local', message: 'm', lexicon: lex, local: async () => { throw new Error('down'); }}), /down/);
});

test('fallback to localQuery with the reason: invalid output, a backend that fails, no request, omp unavailable, busy', async () => {
  const local = async () => LOCAL;
  const invalid = await parserWith(stubBackend('@q query\n  where bogus\n')).parse({message: 'm', lexicon: lex, local});
  assert.equal(invalid.parse.parser, 'local');
  assert.equal(invalid.parse.fallback.to, 'local');
  assert.equal(invalid.parse.fallback.from, 'coding_agent');
  assert.match(invalid.parse.fallback.reason, /invalid/);
  assert.equal(invalid.parse.agent.rounds, 2);
  const down = {id: 'x', generate: async () => ({ok: false, sop: '', usage: {}, duration_ms: 1, reason: 'omp exceeded the 120 s limit'})};
  const timedOut = await parserWith(down).parse({message: 'm', lexicon: lex, local});
  assert.match(timedOut.parse.fallback.reason, /120 s/);
  const none = await parserWith(stubBackend('@u unclear\n  kind no_request\n')).parse({message: 'thanks', lexicon: lex, local});
  assert.equal(none.parse.parser, 'local');
  assert.match(none.parse.fallback.reason, /not_a_query/);
  const unavailable = createQueryParser({settings: queryParserSettings(), ompModels: {list: async () => ({available: false, reason: 'omp could not be started'})}, backendFactory: () => stubBackend(Q())});
  const u = await unavailable.parse({message: 'm', lexicon: lex, local});
  assert.equal(u.parse.parser, 'local');
  assert.match(u.parse.fallback.reason, /not available/);
  const gibberish = await parserWith(stubBackend(ABSTAIN)).parse({message: 'asdf', lexicon: lex, local});
  assert.equal(gibberish.parse.parser, 'coding_agent', 'gibberish is the coding agent\'s honest answer');
  let release;
  const gate = new Promise(r => { release = r; });
  const slow = {id: 's', model: 's', generate: async () => { await gate; return {ok: true, sop: Q(), usage: {}, duration_ms: 1}; }};
  const busy = parserWith(slow, {maxConcurrent: 1});
  const first = busy.parse({message: 'one', lexicon: lex, local});
  await new Promise(r => setTimeout(r, 10));
  const second = await busy.parse({message: 'two', lexicon: lex, local});
  assert.equal(second.parse.parser, 'local');
  assert.match(second.parse.fallback.reason, /busy/);
  release();
  assert.equal((await first).parse.parser, 'coding_agent');
});

test('identical requests are cached per memory version', async () => {
  const calls = [];
  const qp = parserWith(stubBackend(Q(), calls));
  const args = {message: '  Does   Ana like Bob? ', lexicon: lex, memoryKey: 'v1', local: async () => LOCAL};
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

test('chat: the default parser is the coding agent (stub omp), the session and the request can choose local, the packet records it', async t => {
  const saved = {};
  for (const [k, v] of Object.entries({CHATSOP_OMP_BIN: STUB, STUB_OMP_MODE: 'good', STUB_OMP_QUERY: Q('Dan', 'parent')})) { saved[k] = process.env[k]; process.env[k] = v; }
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const s = await productServer(t, {config: {queryParser: {default: 'coding_agent', backend: {kind: 'omp', model: 'deepseek/deepseek-flash'}, timeoutSeconds: 30}}});
  await s.admin('/v1/memories', 'POST', {name: 'Family', id: 'family', circuits: [{name: 'family', text: FAMILY}]});
  const id = (await s.user('/v1/sessions', 'POST', {base: 'family'})).body.id;
  const chat = (extra = {}) => s.user('/v1/chat/completions', 'POST', {model: 'chatsop-local', session_id: id, messages: [{role: 'user', content: 'Does Ana like Alpha Lab?'}], ...extra});
  const first = await chat();
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const c = first.body.chatSop;
  assert.equal(c.parse.parser, 'coding_agent');
  assert.equal(c.parse.model, 'deepseek/deepseek-flash');
  assert.equal(c.parse.fallback, null);
  assert.ok(c.parse.cost_usd > 0);
  assert.match(c.model_sop, /Dan/, 'the circuit is the coding agent\'s');
  assert.equal(c.formalizer_model, 'coding-agent:deepseek/deepseek-flash');
  const local = await chat({parser: 'local'});
  assert.equal(local.body.chatSop.parse.parser, 'local');
  assert.match(local.body.chatSop.model_sop, /Alpha Lab/, 'the stub SymbolicLM asked about Alpha Lab');
  assert.equal((await chat({parser: 'oracle'})).status, 400);
  const set = await s.user(`/v1/sessions/${id}/settings`, 'POST', {parser: 'local'});
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.settings.parser, 'local');
  assert.equal((await chat()).body.chatSop.parse.parser, 'local', 'the session setting applies');
  assert.equal((await s.user(`/v1/sessions/${id}/settings`, 'POST', {parser: 'oracle'})).status, 400);
  assert.equal((await chat({parser: 'coding_agent'})).body.chatSop.parse.parser, 'coding_agent', 'the request overrides the session');
  // The session query endpoint takes a request in natural language and a parser.
  const q = await s.user(`/v1/sessions/${id}/query`, 'POST', {message: 'Does Ana like Alpha Lab?', parser: 'coding_agent'});
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.equal(q.body.parse.parser, 'coding_agent');
  assert.equal(q.body.parse.cache, 'hit', 'the same request on the same memory is served from the cache');
  assert.match(q.body.model_sop, /Dan/);
  assert.equal((await s.user(`/v1/sessions/${id}/query`, 'POST', {message: 'x', query: 'y'})).status, 400);
});

test('chat: a coding agent that is not installed falls back to SymbolicLM and says so', async t => {
  const saved = process.env.CHATSOP_OMP_BIN;
  process.env.CHATSOP_OMP_BIN = '/nonexistent/omp';
  t.after(() => { if (saved === undefined) delete process.env.CHATSOP_OMP_BIN; else process.env.CHATSOP_OMP_BIN = saved; });
  const s = await productServer(t, {config: {queryParser: {default: 'coding_agent'}}});
  const id = (await s.user('/v1/sessions', 'POST', {base: 'default'})).body.id;
  const r = await s.user('/v1/chat/completions', 'POST', {model: 'chatsop-local', session_id: id, messages: [{role: 'user', content: 'Does Ana like Alpha Lab?'}]});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const p = r.body.chatSop.parse;
  assert.equal(p.parser, 'local');
  assert.equal(p.fallback.from, 'coding_agent');
  assert.match(p.fallback.reason, /not available/);
});

test('a clear question no predicate expresses is an honest unclear and is logged as a gap of the memory', async t => {
  const root = tempDir(t, 'qp-gap-');
  const qp = createQueryParser({settings: queryParserSettings({queryParser: {}}), chatData: {root, tmpFolder: () => null}, backendFactory: () => stubBackend('@u unclear\n  kind relation_not_in_memory\n')});
  const r = await qp.parse({message: 'Who employs Ana?', lexicon: lex, memoryKey: 'gap-1', local: async () => LOCAL});
  assert.equal(r.parse.parser, 'coding_agent');
  assert.match(r.sop, /relation_not_in_memory/);
  const log = fs.readFileSync(path.join(root, 'query-gaps.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(log.length, 1);
  assert.equal(log[0].message, 'Who employs Ana?');
  assert.equal(log[0].memory, 'gap-1');
  assert.ok(log[0].closest.length > 0, 'the closest predicates are material for the authoring path');
});

test('measurement mode: a failing coding agent is an error that carries its record, never a local answer', async () => {
  const qp = parserWith(stubBackend('@q query\n  where bogus\n'), {fallbackToLocal: false});
  await assert.rejects(qp.parse({message: 'm', lexicon: lex, local: async () => LOCAL}), error => error.code === 'parser_failed' && error.parse.parser === 'coding_agent' && /invalid/.test(error.parse.failed));
});
