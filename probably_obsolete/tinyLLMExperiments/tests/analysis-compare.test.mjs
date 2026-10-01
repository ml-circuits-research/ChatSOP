import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {compareAnalyses, multisetDiff} from '../lib/languages-util/analysis-compare.mjs';
import {featuresOf, logicalRelation} from '../lib/languages-util/analysis-features.mjs';
import {createSynonymOracle} from '../lib/languages-util/synonyms.mjs';
import {comparePairs, summaryOf} from '../tools/eval/analysis-compare.mjs';
import {wilson} from '../tools/eval/analysis-compare-validate.mjs';

// Recorded SymbolicLM analyses: no parser runs in this test.
const A = JSON.parse(fs.readFileSync(new URL('./fixtures/analysis-compare/parses.json', import.meta.url), 'utf8')).analyses;
const synonyms = (a, b) => [['repair', 'fix']].some(([x, y]) => (a === x && b === y) || (a === y && b === x));
const cmp = (a, b, options = {}) => compareAnalyses(A[a], A[b], {synonyms, textA: a, textB: b, ...options});

test('an active and a passive sentence of one meaning are equivalent and the voice change is reported', () => {
  const r = cmp('Laura manages Jack.', 'Jack is managed by Laura.');
  assert.equal(r.verdict, 'equivalent', r.reasons.join('; '));
  assert.deepEqual(r.voiceChange, ['manage']);
  assert.equal(logicalRelation('nsubj:pass'), 'obj');
  assert.equal(logicalRelation('obl:agent'), 'nsubj');
});

test('swapped subject and object is different', () => {
  const r = cmp('Laura manages Jack.', 'Jack manages Laura.');
  assert.equal(r.verdict, 'different');
  assert.ok(r.failedChecks.includes('roles'), r.reasons.join('; '));
});

test('a flipped negation is different', () => {
  const r = cmp('Mia does not teach Spanish.', 'Mia teaches Spanish.');
  assert.equal(r.verdict, 'different');
  assert.ok(r.failedChecks.includes('polarity'));
});

test('a changed quantifier, question word, number and name are each different', () => {
  assert.ok(cmp('Are all students certified?', 'Are some students certified?').failedChecks.includes('quantifiers'));
  assert.ok(cmp('Where did Tatiana travel?', 'When did Tatiana travel?').failedChecks.includes('question'));
  assert.ok(cmp('Ana bought 3 apples.', 'Ana bought 5 apples.').failedChecks.includes('numbers'));
  assert.ok(cmp('Olena lives in Cluj.', 'Mara lives in Cluj.').failedChecks.includes('names'));
});

test('a date in a lead-in that SymbolicLM masks before parsing still counts (numbers come from the raw text)', () => {
  const r = cmp('As of 3 October 2025, was Julien enrolled at the academy?', 'As of 3 October 2027, was Julien enrolled at the academy?');
  assert.equal(r.verdict, 'different');
  assert.ok(r.failedChecks.includes('numbers'));
  const blind = compareAnalyses(A['As of 3 October 2025, was Julien enrolled at the academy?'], A['As of 3 October 2027, was Julien enrolled at the academy?'], {synonyms});
  assert.notEqual(blind.verdict, 'different', 'without the raw text the masked dates are invisible: that is why textA and textB are passed');
});

test('names swapped between sentences are different', () => {
  const r = cmp('Olena works at Greenline Transport. Chloe works at Greenline Transport. Does Hassan work at Greenline Transport?', 'Hassan works at Greenline Transport. Chloe works at Greenline Transport. Does Olena work at Greenline Transport?');
  assert.equal(r.verdict, 'different');
  assert.ok(r.failedChecks.includes('roles'));
});

test('a politeness wrapper does not change the meaning', () => {
  assert.equal(cmp('Do you know who manages Takumi?', 'Who manages Takumi?').verdict, 'equivalent');
});

test('synonymous predicates are uncertain by default and equivalent when accepted; an extra sentence is uncertain', () => {
  const r = cmp('Tom repairs the car.', 'Tom fixes the car.');
  assert.equal(r.verdict, 'uncertain');
  assert.match(r.reasons.join(' '), /synonyms/);
  assert.equal(cmp('Tom repairs the car.', 'Tom fixes the car.', {synonymPolicy: 'accept'}).verdict, 'equivalent');
  const extra = cmp('Tom repairs the car.', 'Tom repairs the car. The garage is open.');
  assert.equal(extra.verdict, 'uncertain');
  assert.match(extra.reasons.join(' '), /sentence_count/);
});

test('a missing parse is uncertain, never different', () => {
  assert.deepEqual(compareAnalyses(null, A['Laura manages Jack.']).reasons, ['missing_parse']);
  assert.equal(compareAnalyses(null, null).verdict, 'uncertain');
});

test('features: names, numbers, quantifiers and question type of a recorded analysis', () => {
  const f = featuresOf(A['Are all students certified?'], 'Are all students certified?');
  assert.deepEqual(f.quantifiers, ['ALL']);
  assert.equal(f.question.asks, true);
  assert.equal(f.question.yn, true);
  assert.deepEqual(featuresOf(A['Ana bought 3 apples.']).numbers, ['3']);
  assert.deepEqual(featuresOf(A['Olena lives in Cluj.']).names, ['cluj', 'olena']);
  assert.equal(featuresOf(A['Mia does not teach Spanish.']).predicates.get('teach').neg, true);
});

test('multisetDiff and Wilson interval', () => {
  assert.deepEqual(multisetDiff(['a', 'a', 'b'], ['a', 'c']), {onlyA: ['a', 'b'], onlyB: ['c'], common: 1});
  const w = wilson(98, 100);
  assert.ok(w.lo > 0.92 && w.hi < 1 && w.p === 0.98);
  assert.equal(wilson(0, 0).p, null);
});

test('the synonym oracle never pairs converse relations and works without any source', () => {
  const none = createSynonymOracle({wordnet: null, dictionary: null});
  assert.equal(none('buy', 'purchase'), false);
  assert.equal(none.available, false);
  const fake = {index: new Map([['buy', new Set(['v1'])], ['purchase', new Set(['v1'])], ['sell', new Set(['v1'])]]), members: new Map([['v1', ['buy', 'purchase', 'sell']]])};
  const oracle = createSynonymOracle({wordnet: fake});
  assert.equal(oracle('buy', 'purchase'), true);
  assert.equal(oracle('buy', 'sell'), false);
});

test('the CLI core: identical pairs are equivalent without a parse and the summary counts the judge calls saved', async () => {
  const verdicts = await comparePairs([{id: 1, a: 'Hello there.', b: 'Hello there.'}]);
  assert.equal(verdicts[0].verdict, 'equivalent');
  const summary = summaryOf([{verdict: 'equivalent'}, {verdict: 'different', failedChecks: ['names']}, {verdict: 'uncertain'}]);
  assert.deepEqual([summary.n, summary.equivalent, summary.needs_llm_judge, summary.failed_checks.names], [3, 1, 2, 1]);
});
