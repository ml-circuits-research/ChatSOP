// Scoring of one judged question in the open-vocabulary linking suite (tools/eval/linking-open.mjs; eval-linking-v1).
import test from 'node:test';
import assert from 'node:assert/strict';
import {judgeRow} from '../tools/eval/linking-open.mjs';

const row = gold => ({gold: {relation: 'born_in', converse: false, alternatives: [], ask: false, entities: [{surface: 'Marie Curie', id: 'marie_curie'}], ...gold}});
const link = (symbol, extra = {}) => ({kind: 'relation', surface: 'be born in', symbol, ...extra});
const ent = (surface, symbol) => ({kind: 'entity', surface, symbol});

test('a relation bound to the gold predicate is correct, a converse realization too', () => {
  assert.equal(judgeRow(row({}), {linking: [link('born_in'), ent('Marie Curie', 'marie_curie')], issues: []}).relation, 'correct');
  assert.equal(judgeRow(row({}), {linking: [link('born_in__converse')], issues: []}).relation, 'correct');
});

test('another predicate is wrong, no binding with a question is an abstention, nothing is no_program', () => {
  assert.equal(judgeRow(row({}), {linking: [link('died_in')], issues: []}).relation, 'wrong');
  assert.equal(judgeRow(row({}), {linking: [], issues: [{kind: 'relation'}]}).relation, 'abstain');
  assert.equal(judgeRow(row({}), {linking: [], issues: []}).relation, 'no_program');
});

test('entities: bound to the gold id, to another id for the same words, or not linked', () => {
  const r = row({});
  assert.deepEqual(judgeRow(r, {linking: [ent('Marie Curie', 'marie_curie')], issues: []}).entities, ['correct']);
  assert.deepEqual(judgeRow(r, {linking: [ent('Marie Curie', 'pierre_curie')], issues: []}).entities, ['wrong']);
  assert.deepEqual(judgeRow(r, {linking: [], issues: []}).entities, ['unlinked']);
});

test('rows whose gold says ask: a question is justified, reported alternatives are tolerated, a silent bind is a guess', () => {
  const ask = row({ask: true, relation: 'ambiguous', alternatives: ['head_of_state_of', 'head_of_government_of'], entities: []});
  assert.equal(judgeRow(ask, {linking: [], issues: [{kind: 'relation'}]}).relation, 'justified_clarify');
  assert.equal(judgeRow(ask, {linking: [link('head_of_state_of', {scored_alternatives: [{id: 'head_of_government_of', score: 100}]})], issues: []}).relation, 'bound_reported');
  assert.equal(judgeRow(ask, {linking: [link('head_of_state_of', {scored_alternatives: []})], issues: []}).relation, 'silent_guess');
});

test('rows whose gold is "none": abstaining is right, any binding is a hallucinated link', () => {
  const none = row({relation: 'none', entities: []});
  assert.equal(judgeRow(none, {linking: [], issues: [{kind: 'relation'}]}).relation, 'abstain');
  assert.equal(judgeRow(none, {linking: [link('born_in')], issues: []}).relation, 'wrong');
});
