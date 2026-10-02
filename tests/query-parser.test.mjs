// The request parser of a turn (server/query-parser.mjs, DS009 "Request parser"): LLMDirect calls a model of the chain directly (no omp); the
// chain and its reachability, the honest failures (`parse_unavailable`, `parse_failed`, never a local fallback), the cache, and the chat/API
// surface, against stub backends and a stub OpenAI-compatible endpoint. No test calls a model.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {createQueryParser, queryParserSettings} from '../server/query-parser.mjs';
import {FAMILY, productServer, stubQueryParser} from './product-helpers.mjs';
import {lex, tempDir, listen} from './helpers.mjs';

const Q = (object = 'Lab Alpha', relation = 'works_at') => `@q query\n  where match\n    relation "${relation}"\n    role subject "Ana"\n    role object "${object}"\n    polarity affirmed\n  end\n`;
const ABSTAIN = '@u unclear\n  kind gibberish\n';
const stubBackend = (answers, calls = []) => ({id: 'stub', model: 'stub/model', generate: async ({history}) => { calls.push(history.length); const a = typeof answers === 'function' ? answers() : answers; return {ok: true, sop: a, usage: {turns: 1, cost_usd: 0.01}, duration_ms: 1}; }});
const parserWith = (backend, extra = {}) => createQueryParser({settings: queryParserSettings({queryParser: {maxFixRounds: 1, models: ['openference/stub-model'], ...extra}}), backendFactory: () => backend});

test('LLMDirect is the default; the record says who parsed, the model, the cost and the time; old strategy names are read as LLMDirect', async () => {
  const settings = queryParserSettings();
  assert.equal(settings.strategy, 'LLMDirect');
  assert.deepEqual(settings.models, ['small'], 'the configuration names a proxy tier');
  assert.equal(settings.entries[0].tier, 'small');
  assert.equal(settings.entries[0].model, 'small');
  assert.deepEqual(settings.entries[0].headers, {}, 'a tier keeps the proxy fallback');
  const concrete = queryParserSettings({queryParser: {models: ['small', 'openrouter/deepseek/deepseek-v4-flash']}}).entries[1];
  assert.equal(concrete.endpoint, 'http://127.0.0.1:18080/u/openrouter/v1');
  assert.deepEqual(concrete.headers, {'x-llmapiprovider-no-fallback': '1'}, 'a concrete model switches the proxy fallback off');
  assert.equal(queryParserSettings().local.tier, 'tiny', 'the step-by-step strategies ask the proxy tier tiny');
  assert.equal(queryParserSettings({queryParser: {strategy: 'CodingAgent'}}).strategy, 'LLMDirect');
  assert.equal(queryParserSettings({queryParser: {strategy: 'LocalLLMDirect'}}).strategy, 'LLMDirect');
  assert.throws(() => queryParserSettings({queryParser: {strategy: 'Nope'}}), e => e.code === 'invalid_strategy');
  const qp = parserWith(stubBackend(Q()));
  const r = await qp.parse({message: 'Does Ana work at Lab Alpha?', lexicon: lex, memoryKey: 'm1'});
  assert.equal(r.sop, Q());
  assert.equal(r.parse.parser, 'llm_direct');
  assert.equal(r.parse.strategy, 'LLMDirect');
  assert.equal(r.parse.model, 'openference/stub-model');
  assert.equal(r.parse.rounds, 1);
  assert.equal(r.parse.cost_usd, 0.01);
  assert.equal(r.parse.cache, 'miss');
  assert.deepEqual(r.parse.tried, []);
});

test('the chain: an unreachable model is skipped with its reason, a run that delivers nothing moves to the next model', async () => {
  const reachable = new Set(['b/two']);
  const seen = [];
  const factory = entry => ({id: 'stub', model: entry.model, generate: async () => { seen.push(entry.id); return entry.id === 'openference/b/two' ? {ok: true, sop: Q(), usage: {cost_usd: 0.02}, duration_ms: 1} : {ok: false, sop: '', usage: {}, duration_ms: 1, reason: 'timeout'}; }});
  const probe = entry => (reachable.has(entry.model) ? {available: true} : {available: false, reason: 'not reachable'});
  const chain = createQueryParser({settings: queryParserSettings({queryParser: {models: ['a/one', 'b/two', 'c/three'], maxFixRounds: 0}}), backendFactory: factory, probe});
  const r = await chain.parse({message: 'Does Ana work at Lab Alpha?', lexicon: lex});
  assert.deepEqual(seen, ['openference/b/two'], 'a/one and c/three are not reachable');
  assert.equal(r.parse.model, 'openference/b/two');
  assert.deepEqual(r.parse.tried, ['openference/a/one', 'openference/c/three']);
  reachable.add('a/one');
  seen.length = 0;
  const second = await chain.parse({message: 'Is it so?', lexicon: lex});
  assert.deepEqual(seen, ['openference/a/one', 'openference/b/two'], 'a/one fails to deliver, b/two answers');
  assert.equal(second.parse.model, 'openference/b/two');
  assert.equal(chain.stats().model_switches, 1);
  // The session's preferred model is tried first.
  reachable.add('c/three');
  seen.length = 0;
  const preferred = await chain.parse({message: 'Another one?', lexicon: lex, preferredModel: 'openference/c/three'});
  assert.deepEqual(seen.slice(0, 1), ['openference/c/three']);
  assert.equal(preferred.parse.model, 'openference/b/two');
});

test('readiness: the proxy upstream routes and the tiers are read from the proxy /health; a missing provider is a reason, not an exception', async () => {
  const health = body => async url => ({ok: true, json: async () => body, _url: url});
  const entry = model => queryParserSettings({queryParser: {models: [model]}}).entries[0];
  const {providerReadiness} = await import('../lib/llm-providers.mjs');
  const proxy = {ok: true, upstreams: {openrouter: {key_configured: true}, deepseek: {key_configured: false}}};
  assert.equal((await providerReadiness(entry('openrouter/x').endpoint, {fetchImpl: health(proxy)})).available, true);
  assert.match((await providerReadiness(entry('local/x').endpoint, {fetchImpl: health(proxy)})).reason, /no upstream local/);
  assert.match((await providerReadiness(entry('small').endpoint, {tier: 'small', fetchImpl: health(proxy)})).reason, /does not serve model tiers yet/);
  assert.equal((await providerReadiness(entry('small').endpoint, {tier: 'small', fetchImpl: health({...proxy, tiers: ['tiny', 'small']})})).available, true);
  assert.equal((await providerReadiness(entry('small').endpoint, {tier: 'small', fetchImpl: health({...proxy, tiers: {small: {usable: false}}})})).available, false);
});

test('failures are honest: parse_unavailable when no model can run, parse_failed for an invalid circuit, never a local answer', async () => {
  const none = createQueryParser({settings: queryParserSettings({queryParser: {models: ['openference/x']}}), backendFactory: () => stubBackend(Q()), probe: () => ({available: false, reason: 'the proxy is down'})});
  await assert.rejects(none.parse({message: 'm', lexicon: lex}), error => error.code === 'parse_unavailable' && error.status === 503 && /no model of the formalizer chain is reachable.*the proxy is down/.test(error.message) && error.parse.parser === 'llm_direct');
  const down = {id: 'x', generate: async () => ({ok: false, sop: '', usage: {}, duration_ms: 1, reason: 'the endpoint exceeded the 120 s limit'})};
  await assert.rejects(parserWith(down).parse({message: 'm', lexicon: lex}), error => error.code === 'parse_unavailable' && /120 s/.test(error.message) && Boolean(error.parse.failed));
  const invalid = parserWith(stubBackend('@q query\n  where bogus\n'));
  await assert.rejects(invalid.parse({message: 'm', lexicon: lex}), error => error.code === 'parse_failed' && error.status === 422 && /invalid/.test(error.message) && error.parse.rounds === 2);
  const gibberish = await parserWith(stubBackend(ABSTAIN)).parse({message: 'asdf', lexicon: lex});
  assert.match(gibberish.sop, /gibberish/, 'an honest unclear is the formalizer\'s answer, not a failure');
  let release;
  const gate = new Promise(r => { release = r; });
  const slow = {id: 's', model: 's', generate: async () => { await gate; return {ok: true, sop: Q(), usage: {}, duration_ms: 1}; }};
  const busy = parserWith(slow, {maxConcurrent: 1});
  const first = busy.parse({message: 'one', lexicon: lex});
  await new Promise(r => setTimeout(r, 10));
  await assert.rejects(busy.parse({message: 'two', lexicon: lex}), error => error.code === 'parse_unavailable' && /busy/.test(error.message));
  release();
  assert.equal((await first).parse.parser, 'llm_direct');
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

/** A stub OpenAI-compatible endpoint (the proxy's place): `/health`, and `/v1/chat/completions` answering `reply`. */
async function stubEndpoint(t, reply, calls = []) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      if (req.url === '/health') { res.writeHead(200, {'content-type': 'application/json'}); return res.end('{"ok":true}'); }
      calls.push({url: req.url, headers: req.headers, body: JSON.parse(body || '{}')});
      res.writeHead(200, {'content-type': 'application/json'});
      res.end(JSON.stringify({choices: [{message: {content: '```sop\n' + reply + '```'}}], usage: {prompt_tokens: 100, completion_tokens: 20, cost: 0.0001, prompt_tokens_details: {cached_tokens: 80}}}));
    });
  });
  const base = await listen(t, server);
  return {base: `${base}/v1`, calls};
}

test('chat: LLMDirect calls the chain model directly, the packet records it; session query takes a message; settings keep the model preference', async t => {
  const endpoint = await stubEndpoint(t, Q('Dan', 'parent'));
  const s = await productServer(t, {config: {llmProviders: {openference: {baseUrl: endpoint.base, model: 'stub-model'}}, queryParser: {models: ['openference/stub-model'], timeoutSeconds: 30}}, serverOptions: {queryParser: null}});
  await s.admin('/v1/memories', 'POST', {name: 'Family', id: 'family', circuits: [{name: 'family', text: FAMILY}]});
  const id = (await s.user('/v1/sessions', 'POST', {base: 'family'})).body.id;
  const chat = (extra = {}) => s.user('/v1/chat/completions', 'POST', {model: 'chatsop-local', session_id: id, messages: [{role: 'user', content: 'Does Ana like Alpha Lab?'}], ...extra});
  const first = await chat();
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const c = first.body.chatSop;
  assert.equal(c.parse.parser, 'llm_direct');
  assert.equal(c.parse.model, 'openference/stub-model');
  assert.ok(c.parse.cost_usd > 0);
  assert.ok(c.parse.cache_read_tokens >= 80, 'the prompt-cache hits of the provider are recorded');
  assert.equal(endpoint.calls[0].headers['x-llmapiprovider-purpose'], 'formalize', 'every formalization call is tagged for the proxy log');
  assert.match(c.model_sop, /Dan/, 'the circuit is the model\'s');
  assert.equal(c.formalizer_model, 'formalizer:openference/stub-model');
  const sent = endpoint.calls[0];
  assert.equal(sent.body.model, 'stub-model');
  assert.equal(sent.headers['x-llmapiprovider-no-fallback'], '1');
  assert.equal(sent.body.messages[0].role, 'system', 'the stable guide is the first (cached) message');
  assert.match(sent.body.messages[1].content, /Does Ana like Alpha Lab\?/);
  assert.equal((await chat({parser: 'local'})).status, 400, 'the parser parameter is gone');
  assert.equal((await chat({language: 'ro'})).status, 400, 'the language parameter is gone');
  assert.equal((await s.user(`/v1/sessions/${id}/settings`, 'POST', {parser: 'local'})).status, 400);
  const set = await s.user(`/v1/sessions/${id}/settings`, 'POST', {formalizer_model: 'openference/stub-model', formalizer: 'CodingAgent'});
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.settings.formalizer, 'LLMDirect', 'an old strategy name is stored as the current one');
  assert.equal(set.body.settings.formalizer_model, 'openference/stub-model');
  const q = await s.user(`/v1/sessions/${id}/query`, 'POST', {message: 'Does Ana like Alpha Lab?'});
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.equal(q.body.parse.parser, 'llm_direct');
  assert.equal(q.body.parse.cache, 'hit', 'the same request on the same memory is served from the cache');
  assert.match(q.body.model_sop, /Dan/);
  assert.equal((await s.user(`/v1/sessions/${id}/query`, 'POST', {message: 'x', query: 'y'})).status, 400);
  const models = await s.user('/v1/models');
  assert.equal(models.body.data[0].chatsop.formalizer.available, true);
  assert.deepEqual(models.body.data[0].chatsop.formalizer.models, ['openference/stub-model'], 'the model chain is listed');
});

test('chat: an unreachable formalizer chain is parse_unavailable (503) with the record, never a local answer', async t => {
  const s = await productServer(t, {config: {llmProviders: {openference: {baseUrl: 'http://127.0.0.1:9/v1'}}, queryParser: {models: ['openference/stub-model']}}, serverOptions: {queryParser: null}});
  const id = (await s.user('/v1/sessions', 'POST', {base: 'default'})).body.id;
  const r = await s.user('/v1/chat/completions', 'POST', {model: 'chatsop-local', session_id: id, messages: [{role: 'user', content: 'Does Ana like Alpha Lab?'}]});
  assert.equal(r.status, 503, JSON.stringify(r.body));
  assert.equal(r.body.error.code, 'parse_unavailable');
  assert.equal(r.body.chatSop.status, 'parse_unavailable');
  assert.match(r.body.chatSop.reason, /not reachable/);
  assert.equal((await s.user('/readyz')).status, 503);
  const stub = await productServer(t, {serverOptions: {queryParser: stubQueryParser({available: false})}});
  const down = await stub.user('/v1/chat/completions', 'POST', {model: 'chatsop-local', messages: [{role: 'user', content: 'Does Ana like Alpha Lab?'}]});
  assert.equal(down.status, 503);
});

test('a clear question no predicate expresses is an honest unclear and is logged as a gap of the memory', async t => {
  const root = tempDir(t, 'qp-gap-');
  const qp = createQueryParser({settings: queryParserSettings({queryParser: {models: ['openference/stub-model']}}), chatData: {root}, backendFactory: () => stubBackend('@u unclear\n  kind relation_not_in_memory\n')});
  const r = await qp.parse({message: 'Who employs Ana?', lexicon: lex, memoryKey: 'gap-1'});
  assert.equal(r.parse.parser, 'llm_direct');
  assert.match(r.sop, /relation_not_in_memory/);
  const log = fs.readFileSync(path.join(root, 'query-gaps.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(log.length, 1);
  assert.equal(log[0].message, 'Who employs Ana?');
  assert.equal(log[0].memory, 'gap-1');
  assert.ok(log[0].closest.length > 0, 'the closest predicates are material for the authoring path');
});
