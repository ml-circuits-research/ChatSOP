/** The neuro oracle (tools/datasets/neuro-targets-oracle.mjs): candidate selection, identity stratification, the judge gate and the meaning rule. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {selectBest, stratifiedIdentity, flat} from '../tools/datasets/neuro-oracle/pairs.mjs';
import {gateOf, meaningOf} from '../tools/datasets/neuro-oracle/judge.mjs';
import {finalVerdicts} from '../tools/datasets/neuro-oracle/merge.mjs';
import {gapTags} from '../tools/datasets/neuro-oracle/gaps.mjs';
import {estimateKernel} from '../tools/datasets/neuro-oracle/cost.mjs';

const v = (cid, id, level, sentences, n, extra = null) => ({cid, id, level, sentences, n, extra, src: 'deepseek', has_gold: level === 'VERIFIED_GOLD'});

test('selectBest prefers gold, then fewer sentences, then the shorter text', () => {
  const textOf = new Map([['a#0', 'Ana works. Ana lives in Cluj. Does Ana have a car?'], ['a#1', 'Does Ana have a car?'], ['a#2', 'Is it true that Ana has a car?'], ['b#0', 'Bob runs.'], ['b#1', 'Bob runs fast.']]);
  const best = selectBest([v('a#0', 'a', 'VERIFIED_FORM', 3, 0), v('a#1', 'a', 'VERIFIED_FORM', 1, 1), v('a#2', 'a', 'VERIFIED_GOLD', 1, 2), v('b#0', 'b', 'VERIFIED_GOLD', 1, 0), v('b#1', 'b', 'VERIFIED_GOLD', 1, 1)], textOf);
  assert.equal(best.get('a').v.cid, 'a#2', 'gold beats a shorter form-only candidate');
  assert.equal(best.get('b').v.cid, 'b#0', 'same level and sentences: the shorter text');
});

test('optional tiers are ignored unless allowed', () => {
  const textOf = new Map([['x#0', 'One.']]);
  const rows = [{...v('x#0', 'x', 'REJECTED', 1, 0, 'VERIFIED_FORM_UNTRUSTED')}];
  assert.equal(selectBest(rows, textOf).size, 0);
  assert.equal(selectBest(rows, textOf, {allowExtra: new Set(['VERIFIED_FORM_UNTRUSTED'])}).get('x').v.level, 'VERIFIED_FORM_UNTRUSTED');
});

test('identity rows are stratified by form: the rare forms are covered before the common ones repeat', () => {
  // token 1 is the root verb, the others hang off it with the given relations
  const tokens = (...deprels) => [[1, 'runs', 'run', 'VERB', 0, 'root'], ...deprels.map((d, i) => [i + 2, 'w' + i, 'w' + i, 'NOUN', 1, d])];
  const row = (id, deprels) => ({id, message: `message ${id}`, analysis: {sentences: [{text: 'x', tokens: tokens(...deprels)}]}});
  const common = Array.from({length: 6}, (_, i) => row('c' + i, ['nsubj', 'obj']));
  const rare = [row('r1', ['nsubj', 'obl'])];
  const picked = stratifiedIdentity([...common, ...rare], 2);
  assert.equal(picked.length, 2);
  assert.ok(picked.some(r => r.id === 'r1'), 'the rare form is picked first');
  assert.deepEqual(stratifiedIdentity([...common, ...rare], 2).map(r => r.id), picked.map(r => r.id), 'deterministic');
  assert.equal(stratifiedIdentity(common, 3, new Set(['message c0', 'message c1', 'message c2', 'message c3'].map(t => t.replace(/[^a-z0-9]+/g, ' ')))).length, 2, 'excluded texts are skipped');
});

test('the parse gate needs conditions a and c good on every sentence', () => {
  const verdicts = new Map([['s1|a', {verdict: 'CORRECT'}], ['s1|c', {verdict: 'MINOR'}], ['s2|a', {verdict: 'CORRECT'}], ['s2|c', {verdict: 'DEEP'}]]);
  assert.equal(gateOf(['s1'], verdicts).state, 'pass');
  assert.equal(gateOf(['s1', 's2'], verdicts).state, 'fail');
  assert.equal(gateOf(['s1', 's3'], verdicts).state, 'pending');
});

test('meaning answers: only a clear yes counts; an unusable answer is null', () => {
  assert.equal(meaningOf({preserves: 'yes'}), 'yes');
  assert.equal(meaningOf({preserves: 'no'}), 'no');
  assert.equal(meaningOf({preserves: null}), null);
  assert.equal(meaningOf(undefined), null);
});

test('final verdicts: the analysis gate applies to every candidate; a gold match is the meaning signal; rejections keep their reason', () => {
  const rows = [
    {cid: 'g#0', id: 'g', stage: 'gold_match', has_gold: true}, {cid: 'm#0', id: 'm', stage: 'gold_mismatch', has_gold: true, frame_ok: true}, {cid: 't#0', id: 't', stage: 'tree_disagree', has_gold: false},
    {cid: 'x#0', id: 'x', stage: 'gold_match', has_gold: true}, {cid: 'n#0', id: 'n', stage: 'gold_match', has_gold: true}, {cid: 'f#0', id: 'f', stage: 'to_judge', has_gold: false},
  ];
  const parse = {get: key => ({'s1|a': {verdict: 'CORRECT'}, 's1|c': {verdict: 'MINOR'}, 's2|a': {verdict: 'CORRECT'}, 's2|c': {verdict: 'DEEP'}}[key])};
  const index = {'g#0': ['s1'], 'm#0': ['s1'], 'x#0': ['s2'], 'f#0': ['s1']};
  const out = finalVerdicts(rows, {index, meaningTrusted: false, parse});
  assert.equal(out[0].level, 'VERIFIED_GOLD', 'strict gold match and a passing gate');
  assert.equal(out[1].level, 'VERIFIED_GOLD_NORMALIZED', 'a normalized gold match is a level of its own; the untrusted judge is not applied');
  assert.equal(finalVerdicts([rows[1]], {index, meaningTrusted: true, parse})[0].level, 'PENDING', 'a trusted judge is required to answer first');
  assert.equal(out[2].reason, 'tree_disagree');
  assert.equal(out[3].level, 'REJECTED', 'a gold match does not rescue a candidate whose analysis the judge rejects');
  assert.equal(out[3].reason, 'gate_failed');
  assert.equal(out[4].level, 'PENDING', 'a candidate that was never prepared for the judge is pending, never a vacuous pass');
  assert.equal(out[4].reason, 'gate_not_prepared');
  assert.equal(out[5].reason, 'form_gate_passed_meaning_not_trusted', 'no gold: the gate alone is not a verified rewrite while the meaning judge is untrusted');
});

test('flat rows use the proofreader projection fields and the kernel cost estimate is proportional to the calls', () => {
  assert.deepEqual(Object.keys(flat('id', 'p', 't', 'repair', 'x')), ['id', 'prompt', 'target', 'kind', 'language', 'source_language', 'pipeline', 'target_source']);
  const p = {input: 0.15, output: 0.6, cache_read: 0.003};
  assert.equal(estimateKernel({calls: 2000, systemChars: 4000, userChars: 2000, outputTokens: 100}, p), 2 * estimateKernel({calls: 1000, systemChars: 4000, userChars: 2000, outputTokens: 100}, p));
});

test('engine-gap tags recognise the wording shapes of the backlog', () => {
  assert.deepEqual(gapTags('A crate holds 12 bottles and 5 crates arrive. How many bottles are there?'), ['numeric_word_problem']);
  assert.ok(gapTags('Is Ana or Mia older?').includes('alternative_question'));
  assert.ok(gapTags('How many of the nurses got the jab?').includes('partitive_count'));
  assert.ok(gapTags('Other than Octavian, who wrote it?').includes('besides_except'));
  assert.ok(gapTags('Which team is Rotaru the coach of?').includes('stranded_preposition'));
  assert.deepEqual(gapTags('Does Ana work at the hospital?'), []);
});
