import test from 'node:test';
import assert from 'node:assert/strict';
import {treesCertified, shouldRewrite, mechanicalMeaning, acceptRewrite, runRewritePipeline, REWRITE_GATES} from '../lib/symbolic-lm/rewrite-gate.mjs';
import {splitSentences} from '../lib/sentence-split.mjs';

const tokens = deprel => [[1, 'Dogs', 'dog', 'NOUN', 2, 'nsubj'], [2, 'bark', 'bark', 'VERB', 0, deprel]];

test('treesCertified needs identical trees on every sentence', () => {
  assert.equal(treesCertified([{tokens: tokens('root')}], [{tokens: tokens('root')}]), true);
  assert.equal(treesCertified([{tokens: tokens('root')}], [{tokens: tokens('conj')}]), false);
  assert.equal(treesCertified([{tokens: tokens('root')}], [{tokens: tokens('root')}, {tokens: tokens('root')}]), false);
  assert.equal(treesCertified([], []), false);
  assert.equal(treesCertified([{tokens: tokens('root')}], null), false);
});

test('gates choose the units that go to the model', () => {
  assert.deepEqual(REWRITE_GATES, ['uncertain', 'trees', 'trees_or_uncertain', 'always']);
  assert.equal(shouldRewrite('trees', {certified: true, uncertain: true}), false);
  assert.equal(shouldRewrite('trees', {certified: false}), true);
  assert.equal(shouldRewrite('trees_or_uncertain', {certified: true, uncertain: true}), true);
  assert.equal(shouldRewrite('trees_or_uncertain', {certified: true, uncertain: false}), false);
  assert.equal(shouldRewrite('always', {certified: true}), true);
  assert.equal(shouldRewrite('uncertain', {certified: false, uncertain: false}), false);
  assert.throws(() => shouldRewrite('nope', {}));
});

test('mechanical meaning checks: names, numbers, negation, quantifiers, question kind', () => {
  assert.equal(mechanicalMeaning('Does Anna own 3 cats?', 'Anna owns 3 cats?').names, true);
  assert.equal(mechanicalMeaning('Is it true that Anna owns 3 cats?', 'Anna owns 4 cats?').numbers, false);
  assert.equal(mechanicalMeaning('Anna does not own a cat.', 'Anna owns a cat.').negation, false);
  assert.equal(mechanicalMeaning('All cats sleep.', 'Cats sleep.').quantifiers, false);
  assert.equal(mechanicalMeaning('Cats sleep.', 'Do cats sleep?').question, false);
  assert.equal(mechanicalMeaning('Then Anna met Bob Smith.', 'Anna met someone.').names, false);
  assert.equal(mechanicalMeaning('Cats sleep.', ' ').nonempty, false);
});

test('acceptance keeps the original unless the rewrite is certified and keeps the meaning', () => {
  assert.equal(acceptRewrite('Cats sleep.', 'Cats sleep.', {outputCertified: false}).accepted, true);
  assert.deepEqual(acceptRewrite('Cats sleep.', 'Cats rest.', {outputCertified: false}).reasons, ['not_certified']);
  assert.equal(acceptRewrite('Cats sleep.', 'Cats rest.', {outputCertified: true}).accepted, true);
  assert.deepEqual(acceptRewrite('Cats sleep.', 'Some cats rest.', {outputCertified: true}).reasons, ['meaning_quantifiers']);
  assert.equal(acceptRewrite('Cats sleep.', 'Some cats rest.', {acceptance: 'off'}).accepted, true);
  assert.equal(acceptRewrite('Cats sleep.', '', {acceptance: 'off'}).accepted, false);
  assert.deepEqual(acceptRewrite('Cats sleep.', 'Cats rest.', {acceptance: 'certified_compare', outputCertified: true, compareVerdict: 'different'}).reasons, ['analysis_different']);
  assert.equal(acceptRewrite('Cats sleep.', 'Cats rest.', {acceptance: 'certified_compare', outputCertified: true, compareVerdict: 'uncertain'}).accepted, true);
});

test('the pipeline sends only uncertified units and replaces them only with accepted rewrites', async () => {
  const text = 'Cats sleep. Then he and Bob went home and ate. Dogs bark.';
  const bad = new Set(['Then he and Bob went home and ate.']);
  const inspect = async unit => ({certified: !bad.has(unit), uncertain: false, compact: null});
  const sent = [];
  const rewrite = async unit => { sent.push(unit); return unit.includes('Bob') ? 'Bob went home. Bob ate.' : 'Dogs sing.'; };
  const run = await runRewritePipeline(text, {split: splitSentences, inspect, rewrite, gate: 'trees', acceptance: 'certified'});
  assert.deepEqual(sent, ['Then he and Bob went home and ate.']);
  assert.equal(run.text, 'Cats sleep. Bob went home. Bob ate. Dogs bark.');
  assert.equal(run.applied, true);
  // a rewrite that drops a name is refused and the original stays
  const dropping = await runRewritePipeline(text, {split: splitSentences, inspect, rewrite: async () => 'He went home.', gate: 'trees', acceptance: 'certified'});
  assert.equal(dropping.text, text);
  assert.deepEqual(dropping.units.filter(u => u.sent).map(u => u.reasons), [['meaning_names']]);
  // a rewrite that is not certified is refused
  const uncertified = await runRewritePipeline(text, {split: splitSentences, inspect: async () => ({certified: false}), rewrite: async u => u + ' ok', gate: 'trees', acceptance: 'certified'});
  assert.equal(uncertified.text, text);
  // the reference setting sends everything and keeps everything
  const all = await runRewritePipeline(text, {split: splitSentences, inspect, rewrite: async () => 'X.', gate: 'always', acceptance: 'off'});
  assert.equal(all.text, 'X. X. X.');
});
