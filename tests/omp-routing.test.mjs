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

test('route: the settings always and off', () => {
  assert.equal(decideRoute({authoring: 'always', omp: up}).reason.trigger, 'setting_always');
  assert.equal(decideRoute({authoring: 'always', omp: down}).fallback.reason.length > 0, true);
  const off = decideRoute({authoring: 'off', omp: up, understanding: understood([{status: 'failed'}])});
  assert.equal(off.path, 'symbolic');
  assert.equal(off.reason.trigger, 'setting_off');
});

test('route: the scope detector and detected SymbolicLM failures', () => {
  const scope = {label: 'needs_knowledge_authoring', wires: [{wire: 'norm'}, {wire: 'rule'}]};
  const s = decideRoute({omp: up, scope});
  assert.equal(s.path, 'authoring');
  assert.equal(s.reason.trigger, 'scope_needs_knowledge_authoring');
  assert.match(s.reason.text, /norm, rule/);
  assert.equal(decideRoute({omp: up, scope: {label: 'surface_ok', wires: []}}).reason.trigger, 'default');
  const failed = decideRoute({omp: up, understanding: understood([{status: 'failed'}, {status: 'certified'}])});
  assert.equal(failed.reason.trigger, 'symbolic_failure');
  assert.match(failed.reason.text, /1 sentence\(s\) failed/);
  assert.equal(failed.signals.failed_sentences, 1);
  assert.equal(decideRoute({omp: up, understanding: understood([{status: 'uncertain'}, {status: 'certified'}])}).path, 'authoring', 'half the sentences uncertain reaches the 0.5 ratio');
  assert.equal(decideRoute({omp: up, understanding: understood([{status: 'uncertain'}, {status: 'certified'}, {status: 'certified'}])}).path, 'symbolic', 'a third does not');
  assert.equal(decideRoute({omp: up, understanding: understood([{status: 'certified'}], {clarify_items: [{kind: 'not_represented', text: 'x'}, {kind: 'not_represented', text: 'y'}], clarify: 'I did not understand'}), detector: {minNotRepresented: 3, clarifyTriggers: false}}).path, 'symbolic');
  assert.equal(decideRoute({omp: up, understanding: understood([{status: 'certified'}], {clarify: 'Could you rephrase it?'})}).reason.text.includes('clarification'), true);
  assert.equal(decideRoute({omp: up, understanding: understood([{status: 'certified'}], {clarify: 'x'}), detector: {clarifyTriggers: false}}).path, 'symbolic');
  assert.equal(decideRoute({omp: up, understanding: {status: 'unavailable', interpretation: {sentences: []}}}).reason.trigger, 'symbolic_failure');
  assert.equal(decideRoute({omp: up}).path, 'symbolic');
  const noOmp = decideRoute({omp: down, understanding: understood([{status: 'failed'}])});
  assert.equal(noOmp.path, 'symbolic');
  assert.equal(noOmp.reason.trigger, 'symbolic_failure');
  assert.ok(noOmp.fallback);
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
  assert.equal(rule.body.path, 'authoring');
  assert.equal(rule.body.reason.trigger, 'scope_needs_knowledge_authoring');
  assert.equal(rule.body.omp.model, 'deepseek/deepseek-flash');
  assert.equal(rule.body.omp.cost_class, 'paid_api');
  assert.equal((await post({session: sid, message: 'See the attached manual.', files: 1})).body.reason.trigger, 'attached_files');
  const failed = await post({session: sid, message: 'Hmm.', understanding: understood([{status: 'failed'}])});
  assert.equal(failed.body.reason.trigger, 'symbolic_failure');
  await s.user(`/v1/sessions/${sid}/settings`, 'POST', {authoring: 'always'});
  assert.equal((await post({session: sid, message: 'Anything'})).body.reason.trigger, 'setting_always');
  await s.user(`/v1/sessions/${sid}/settings`, 'POST', {authoring: 'off'});
  assert.equal((await post({session: sid, message: 'Every researcher must wear goggles.', analysis: RULE})).body.path, 'symbolic');
  assert.equal((await post({session: 'nope', message: 'x'})).status, 404);
});

test('POST /v1/route: without omp the answer is the symbolic path with the reason, never an error', async t => {
  const s = await productServer(t, {config: {omp: {bin: '/nonexistent/omp'}}});
  const r = await s.user('/v1/route', 'POST', {message: 'Every researcher must wear goggles.', analysis: RULE});
  assert.equal(r.status, 200);
  assert.equal(r.body.path, 'symbolic');
  assert.equal(r.body.omp.available, false);
  assert.equal(r.body.fallback.from, 'authoring');
  assert.equal(r.body.reason.trigger, 'scope_needs_knowledge_authoring');
  const off = await productServer(t, {config: {omp: {bin: STUB, enabled: false}}});
  const r2 = await off.user('/v1/route', 'POST', {message: 'x', files: 1});
  assert.match(r2.body.fallback.reason, /disabled/);
});
