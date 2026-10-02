// The server status (GET /v1/status), the session's formalization strategy and the pipeline trace of the chat page (DS009).
import test from 'node:test';
import assert from 'node:assert/strict';
import {FAMILY, productServer} from './product-helpers.mjs';
import {strategyRequest, formalizationStrategies} from '../server/status.mjs';
import {stubQueryParser} from './helpers.mjs';
import {chatPage} from '../server/pages/chat.mjs';

test('status: strategies, base memories, engines and caches; listed in the capabilities', async t => {
  const s = await productServer(t);
  const r = await s.user('/v1/status');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.object, 'status');
  assert.equal(r.body.formalization.default, 'CodingAgent');
  assert.deepEqual(r.body.formalization.strategies.map(x => x.id), ['CodingAgent', 'LocalLLMDirect', 'LocalLLMStepByStep', 'InternalReasoningStepByStep']);
  const coding = r.body.formalization.strategies[0];
  assert.equal(coding.available, true);
  assert.deepEqual(coding.models.map(m => m.id), ['stub/model']);
  assert.ok(r.body.formalization.strategies.slice(1).every(x => x.available === false && x.reason), 'a strategy the server does not run says why');
  assert.ok(r.body.memories.some(m => m.id === 'default'));
  assert.ok(r.body.reasoning.engines.some(e => e.id === 'js-reference' && e.available));
  assert.ok('query-parser' in r.body.caches);
  assert.equal(r.body.ready, true);
  assert.ok((await s.user('/v1/capabilities')).body.endpoints.some(e => e.path === '/v1/status'));
  assert.equal((await s.call('/v1/status')).status, 401, 'the status needs authentication');
});

test('status: a session strategy the server cannot run is refused with parse_unavailable, never substituted', async t => {
  const s = await productServer(t);
  await s.admin('/v1/memories', 'POST', {name: 'Family', id: 'family', circuits: [{name: 'family', text: FAMILY}]});
  const id = (await s.user('/v1/sessions', 'POST', {base: 'family', settings: {formalizer: 'LocalLLMDirect'}})).body.id;
  const chat = () => s.user('/v1/chat/completions', 'POST', {model: 'chatsop-local', messages: [{role: 'user', content: 'Does Ana like Alpha Lab?'}], session_id: id});
  const refused = await chat();
  assert.equal(refused.status, 503);
  assert.equal(refused.body.error.code, 'parse_unavailable');
  assert.match(refused.body.error.message, /LocalLLMDirect/);
  assert.equal((await s.user(`/v1/sessions/${id}/settings`, 'POST', {formalizer: 'Nope'})).status, 400);
  const set = await s.user(`/v1/sessions/${id}/settings`, 'POST', {formalizer: 'CodingAgent'});
  assert.equal(set.body.settings.formalizer, 'CodingAgent');
  const ok = await chat();
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(typeof ok.body.chatSop.turn_ms, 'number');
  assert.equal(ok.body.chatSop.session.formalizer, 'CodingAgent');
  assert.ok('verification' in ok.body.chatSop && 'session_circuits' in ok.body.chatSop && 'strategy' in ok.body.chatSop);
});

test('status: a request parser with several strategies receives the chosen one and reports its own list', async () => {
  const multi = {strategies: async () => [{id: 'CodingAgent', available: true}, {id: 'LocalLLMStepByStep', available: true}]};
  assert.deepEqual(strategyRequest(multi, 'LocalLLMStepByStep'), {strategy: 'LocalLLMStepByStep'});
  assert.deepEqual((await formalizationStrategies(multi)).map(x => x.id), ['CodingAgent', 'LocalLLMStepByStep']);
  assert.deepEqual(strategyRequest(stubQueryParser(), null), {});
  assert.deepEqual(strategyRequest(stubQueryParser(), 'CodingAgent'), {});
  assert.throws(() => strategyRequest(stubQueryParser(), 'LocalLLMStepByStep'), e => e.code === 'parse_unavailable' && e.status === 503);
});

test('chat page: the strategy selector, the status card and the pipeline trace; no stale controls', () => {
  const html = chatPage({model: 'chatsop-local', ready: true});
  for (const id of ['id="formalizer"', 'id="status-box"', 'id="status-refresh"', 'id="omp-model"']) assert.ok(html.includes(id), id);
  for (const section of ['1. Formalization', '2. Vocabulary', '3. Session definitions and assumptions', '4. Linking', '5. Retrieval', '6. Route and verification', '7. Answer formulation', '8. Latency']) assert.ok(html.includes(section), section);
  assert.ok(!html.includes('strategy-info') && !html.includes('Attaching a file is the only thing'), 'stale controls are gone');
});

test('answer language: off for English, phrased from the result for another language, English kept when a number is dropped', async () => {
  const {createAnswerFormulator, looksEnglish} = await import('../server/answer-language.mjs');
  assert.equal(looksEnglish('Who wrote Hamlet?'), true);
  assert.equal(looksEnglish('Is Paris located in Europe?'), true);
  assert.equal(looksEnglish('Ada Lovelace?'), true);
  assert.equal(looksEnglish('Care este capitala Franței?'), false);
  assert.equal(looksEnglish('Wer hat Hamlet geschrieben?'), false);
  const calls = [];
  const runner = async ({model, prompt}) => { calls.push(model); return model === 'bad/model' ? {ok: true, final_text: 'Răspuns: unsprezece.'} : {ok: true, final_text: 'Răspuns: 11 (Wikidata Q183).'}; };
  const f = createAnswerFormulator({settings: {mode: 'auto', models: ['bad/model', 'good/model'], timeoutSeconds: 5, thinking: 'off'}, runner});
  const english = await f.formulate({message: 'How many?', english: 'Answer: 11 (Wikidata Q183).', packet: {}});
  assert.equal(english.applied, false);
  assert.equal(calls.length, 0, 'no model call for an English message');
  const ro = await f.formulate({message: 'Câte țări se învecinează cu Germania?', english: 'Answer: 11 (Wikidata Q183).', packet: {status: 'supported'}});
  assert.equal(ro.applied, true);
  assert.equal(ro.model, 'good/model');
  assert.match(ro.tried[0].reason, /dropped 11/);
  const none = createAnswerFormulator({settings: {mode: 'always', models: ['bad/model'], timeoutSeconds: 5, thinking: 'off'}, runner});
  assert.equal((await none.formulate({message: 'x', english: 'Answer: 11.', packet: {}})).applied, false, 'an unfaithful phrasing falls back to English');
});

test('base memories: the encyclopedic default falls back to the minimal memory when world-v1 is not loaded; three kinds of new memory', async t => {
  const s = await productServer(t);
  const list = (await s.user('/v1/memories')).body;
  assert.equal(list.default_base, 'default', 'world-v1 is not loaded in the test root, so the minimal default is used');
  assert.deepEqual(list.kinds, ['encyclopedic', 'minimal', 'empty']);
  const session = await s.user('/v1/sessions', 'POST', {});
  assert.equal(session.status, 201, JSON.stringify(session.body));
  assert.equal(session.body.base.id, 'default', 'a session without base forks the default');
  const empty = await s.admin('/v1/memories', 'POST', {name: 'Specialised', kind: 'empty'});
  assert.equal(empty.status, 201, JSON.stringify(empty.body));
  assert.deepEqual(empty.body.imports, []);
  const minimal = await s.admin('/v1/memories', 'POST', {name: 'Small', kind: 'minimal'});
  assert.deepEqual(minimal.body.imports.map(l => l.id), ['core-min']);
  assert.equal((await s.admin('/v1/memories', 'POST', {name: 'World copy', kind: 'encyclopedic'})).status, 409, 'no encyclopedic memory on this server');
  assert.equal((await s.admin('/v1/memories', 'POST', {name: 'X', kind: 'huge'})).status, 400);
});
