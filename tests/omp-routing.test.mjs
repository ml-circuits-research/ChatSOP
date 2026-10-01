// Routing of a chat message between SymbolicLM and the coding agent (DS031 "Routing"): the pure decision and POST /v1/route.
import test from 'node:test';
import assert from 'node:assert/strict';
import {decideRoute, symbolicSignals, symbolicFailure} from '../lib/omp/routing.mjs';
import {productServer} from './product-helpers.mjs';
import {repoPath} from './helpers.mjs';

const STUB = repoPath('tests/fixtures/omp/stub-omp.mjs');
const up = {available: true, model: 'deepseek/deepseek-flash', cost_class: 'paid_api'};
const down = {available: false, reason: 'omp could not be started (ENOENT)'};
const understood = (sentences, extra = {}) => ({status: 'ok', interpretation: {sentences}, clarify_items: [], clarify: null, ...extra});
const RULE = {language: 'en', sentences: [{text: 'Every researcher must wear goggles.', tokens: [[1, 'Every', 'every', 'DET', 2, 'det'], [2, 'researcher', 'researcher', 'NOUN', 4, 'nsubj'], [3, 'must', 'must', 'AUX', 4, 'aux'], [4, 'wear', 'wear', 'VERB', 0, 'root'], [5, 'goggles', 'goggles', 'NOUN', 4, 'obj'], [6, '.', '.', 'PUNCT', 4, 'punct']]}]};
const QUESTION = {language: 'en', sentences: [{text: 'Who works at Alpha Lab?', tokens: [[1, 'Who', 'who', 'PRON', 2, 'nsubj'], [2, 'works', 'work', 'VERB', 0, 'root'], [3, 'at', 'at', 'ADP', 5, 'case'], [4, 'Alpha', 'Alpha', 'PROPN', 5, 'compound'], [5, 'Lab', 'Lab', 'PROPN', 2, 'obl'], [6, '?', '?', 'PUNCT', 2, 'punct']]}]};

test('route: attached files always go to the coding agent, whatever the setting says except an unavailable omp', () => {
  const r = decideRoute({filesAttached: 2, omp: up});
  assert.equal(r.path, 'authoring');
  assert.equal(r.reason.trigger, 'attached_files');
  assert.equal(decideRoute({filesAttached: 1, authoring: 'off', omp: up}).path, 'authoring', 'files win over off');
  const fallback = decideRoute({filesAttached: 1, omp: down});
  assert.equal(fallback.path, 'symbolic');
  assert.equal(fallback.fallback.from, 'authoring');
  assert.match(fallback.fallback.reason, /could not be started/);
});

test('route: the default never starts the coding agent; only attached files and the setting always do', () => {
  assert.equal(decideRoute({authoring: 'always', omp: up}).reason.trigger, 'setting_always');
  assert.equal(decideRoute({authoring: 'always', omp: down}).fallback.reason.length > 0, true);
  for (const input of [{}, {authoring: 'off'}, {scope: SCOPE}, {understanding: understood([{status: 'failed'}, {status: 'failed'}])}]) {
    assert.equal(decideRoute({omp: up, ...input}).path, 'symbolic', JSON.stringify(input).slice(0, 80));
  }
  assert.equal(decideRoute({omp: up, scopeNote: 'none', scope: SCOPE}).suggestion, null, 'none shows nothing');
  assert.equal(decideRoute({omp: up, scopeNote: 'none', understanding: understood([{status: 'failed'}])}).suggestion, null);
  assert.equal(decideRoute({omp: up, scope: SCOPE}).settings.authoring, 'off');
});

const SCOPE = {label: 'needs_knowledge_authoring', wires: [{wire: 'norm', score: 0.7, cues: ['c2'], targets: ['norm']}], sentences: [{text: 'Every researcher must wear goggles.', label: 'needs_knowledge_authoring',
  wires: [{wire: 'norm', score: 0.7, cues: ['c2'], targets: ['norm']}, {wire: 'rule', score: 0.55, cues: ['c1'], targets: ['predicate', 'rule']}], cues: [{id: 'c1', wire: 'rule', type: 'universal_determiner', text: 'Every researcher'}, {id: 'c2', wire: 'norm', type: 'modal_strong', text: 'must'}]}]};

test('route: a scope detection only suggests; the user is asked (ask) or the sentence is marked (mark); nothing is sent by itself', () => {
  const s = decideRoute({omp: up, scope: SCOPE});
  assert.equal(s.path, 'symbolic', 'SymbolicLM still answers');
  assert.equal(s.ask, true, 'the default setting is ask');
  assert.equal(s.suggestion.trigger, 'scope_needs_knowledge_authoring');
  assert.equal(s.suggestion.mode, 'ask');
  assert.match(s.suggestion.text, /norm, rule/);
  const [sentence] = s.suggestion.scope.sentences;
  assert.deepEqual(sentence.wires.map(w => [w.wire, w.confidence]), [['norm', 'reliable'], ['rule', 'may_need']]);
  assert.deepEqual(sentence.cues.map(c => c.text), ['Every researcher', 'must'], 'the cues are quoted');
  const mark = decideRoute({omp: up, scope: SCOPE, scopeNote: 'mark'});
  assert.equal(mark.ask, false);
  assert.equal(mark.suggestion.mode, 'mark');
  const noOmp = decideRoute({omp: down, scope: SCOPE});
  assert.equal(noOmp.ask, false, 'no question when omp cannot run');
  assert.match(noOmp.suggestion.unavailable, /could not be started/);
  assert.equal(decideRoute({omp: up, scope: {label: 'surface_ok', wires: [], sentences: []}}).reason.trigger, 'default');
});

test('route: a wire type the user declined is not suggested again', () => {
  const one = decideRoute({omp: up, scope: SCOPE, declined: ['norm']});
  assert.deepEqual(one.suggestion.scope.sentences[0].wires.map(w => w.wire), ['rule'], 'the sentence still has another undeclined type');
  assert.equal(decideRoute({omp: up, scope: SCOPE, declined: ['norm', 'rule']}).suggestion, null);
});

test('route: detected SymbolicLM failures suggest the coding agent', () => {
  const failed = decideRoute({omp: up, understanding: understood([{status: 'failed'}, {status: 'certified'}])});
  assert.equal(failed.path, 'symbolic');
  assert.equal(failed.suggestion.trigger, 'symbolic_failure');
  assert.match(failed.suggestion.text, /1 sentence\(s\) failed/);
  assert.equal(failed.signals.failed_sentences, 1);
  assert.equal(decideRoute({omp: up, understanding: understood([{status: 'uncertain'}, {status: 'certified'}])}).suggestion?.trigger, 'symbolic_failure', 'half the sentences uncertain reaches the 0.5 ratio');
  assert.equal(decideRoute({omp: up, understanding: understood([{status: 'uncertain'}, {status: 'certified'}, {status: 'certified'}])}).suggestion, null, 'a third does not');
  assert.equal(decideRoute({omp: up, understanding: understood([{status: 'certified'}], {clarify_items: [{kind: 'not_represented', text: 'x'}, {kind: 'not_represented', text: 'y'}], clarify: 'I did not understand'}), detector: {minNotRepresented: 3, clarifyTriggers: false}}).suggestion, null);
  assert.match(decideRoute({omp: up, understanding: understood([{status: 'certified'}], {clarify: 'Could you rephrase it?'})}).suggestion.text, /clarification/);
  assert.equal(decideRoute({omp: up, understanding: understood([{status: 'certified'}], {clarify: 'x'}), detector: {clarifyTriggers: false}}).suggestion, null);
  assert.equal(decideRoute({omp: up, understanding: {status: 'unavailable', interpretation: {sentences: []}}}).suggestion.trigger, 'symbolic_failure');
  assert.equal(decideRoute({omp: up}).suggestion, null);
  const noOmp = decideRoute({omp: down, understanding: understood([{status: 'failed'}])});
  assert.equal(noOmp.path, 'symbolic');
  assert.equal(noOmp.suggestion.mode, 'mark');
  assert.equal(symbolicSignals(null), null);
  assert.equal(symbolicFailure(null), null);
});

test('POST /v1/route: the decision with the session settings and the omp state', async t => {
  const s = await productServer(t, {config: {omp: {bin: STUB, defaultModel: 'deepseek/deepseek-flash'}}});
  await s.admin('/v1/memories', 'POST', {name: 'Empty', id: 'empty'});
  const sid = (await s.user('/v1/sessions', 'POST', {base: 'empty'})).body.id;
  const post = body => s.user('/v1/route', 'POST', body);
  assert.equal((await post({})).status, 400);
  assert.equal((await post({message: 'x', bogus: 1})).status, 400);
  const plain = await post({session: sid, message: 'Who works at Alpha Lab?', analysis: QUESTION});
  assert.equal(plain.status, 200);
  assert.equal(plain.body.path, 'symbolic');
  assert.equal(plain.body.scope_source, 'request');
  const rule = await post({session: sid, message: 'Every researcher must wear goggles.', analysis: RULE});
  assert.equal(rule.body.path, 'symbolic', 'a detection does not send anything');
  assert.equal(rule.body.ask, true);
  assert.equal(rule.body.suggestion.trigger, 'scope_needs_knowledge_authoring');
  assert.ok(rule.body.suggestion.scope.sentences[0].cues.length > 0);
  assert.equal(rule.body.omp.model, 'deepseek/deepseek-flash');
  assert.equal(rule.body.omp.cost_class, 'paid_api');
  assert.equal(rule.body.scope.label, 'needs_knowledge_authoring');
  // The user's answer is logged; after a no the same wire types are not suggested again in this session.
  const wires = rule.body.suggestion.scope.wires;
  const no = await s.user(`/v1/sessions/${sid}/scope-answer`, 'POST', {message: 'Every researcher must wear goggles.', wires, answer: 'no'});
  assert.equal(no.status, 200);
  assert.deepEqual(no.body.declined.sort(), [...wires].sort());
  const again = await post({session: sid, message: 'Every researcher must wear goggles.', analysis: RULE});
  assert.equal(again.body.suggestion, null);
  assert.equal((await s.user(`/v1/sessions/${sid}/scope-answer`, 'POST', {answer: 'maybe'})).status, 400);
  const log = s.server.sessions.scopeLog(sid);
  assert.ok(log.some(e => e.kind === 'verdict' && e.scope.label === 'needs_knowledge_authoring'));
  assert.ok(log.some(e => e.kind === 'answer' && e.answer === 'no'));
  await s.user(`/v1/sessions/${sid}/scope-answer`, 'POST', {message: 'x', wires: ['norm'], answer: 'yes'});
  assert.equal((await s.user(`/v1/sessions/${sid}`)).body.scope_declined.length, wires.length, 'a yes does not mute anything');
  assert.equal((await post({session: sid, message: 'See the attached manual.', files: 1})).body.reason.trigger, 'attached_files');
  const failed = await post({session: sid, message: 'Hmm.', understanding: understood([{status: 'failed'}])});
  assert.equal(failed.body.suggestion.trigger, 'symbolic_failure');
  await s.user(`/v1/sessions/${sid}/settings`, 'POST', {scope_note: 'mark'});
  assert.equal((await post({session: sid, message: 'Hmm.', understanding: understood([{status: 'failed'}])})).body.ask, false, 'mark only: the page does not ask');
  assert.equal((await s.user(`/v1/sessions/${sid}/settings`, 'POST', {scope_note: 'sometimes'})).status, 400);
  await s.user(`/v1/sessions/${sid}/settings`, 'POST', {authoring: 'always'});
  assert.equal((await post({session: sid, message: 'Anything'})).body.reason.trigger, 'setting_always');
  await s.user(`/v1/sessions/${sid}/settings`, 'POST', {authoring: 'off', scope_note: 'none'});
  assert.equal((await post({session: sid, message: 'Every researcher must wear goggles.', analysis: RULE})).body.suggestion, null, 'scope_note none silences the suggestions');
  assert.equal((await post({session: 'nope', message: 'x'})).status, 404);
});

test('POST /v1/route: without omp the answer is the symbolic path with the reason, never an error', async t => {
  const s = await productServer(t, {config: {omp: {bin: '/nonexistent/omp'}}});
  const r = await s.user('/v1/route', 'POST', {message: 'Every researcher must wear goggles.', analysis: RULE});
  assert.equal(r.status, 200);
  assert.equal(r.body.path, 'symbolic');
  assert.equal(r.body.omp.available, false);
  assert.equal(r.body.ask, false);
  assert.equal(r.body.suggestion.mode, 'mark');
  assert.match(r.body.suggestion.unavailable, /omp could not be started/);
  const wanted = await s.user('/v1/route', 'POST', {message: 'x', files: 1});
  assert.equal(wanted.body.fallback.from, 'authoring', 'a file or the Always setting falls back with the reason');
  const off = await productServer(t, {config: {omp: {bin: STUB, enabled: false}}});
  const r2 = await off.user('/v1/route', 'POST', {message: 'x', files: 1});
  assert.match(r2.body.fallback.reason, /disabled/);
});
