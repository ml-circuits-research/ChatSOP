import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {tangleOf} from '../tools/eval/decomposition/tangle.mjs';
import {markers, understoodText, failureStats, shapeStats} from '../tools/eval/decomposition/metrics.mjs';
import {runPartialPipeline, pairSeverity} from '../tools/eval/decomposition-score.mjs';
import {splitSentences} from '../lib/sentence-split.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// "Ana left because Ben shouted and Mara stayed." as a stored analysis (compact UD columns: id, form, lemma, upos, head, deprel)
const analysis = {sentences: [{text: 'Ana left because Ben shouted and Mara stayed.', tokens: [
  [1, 'Ana', 'Ana', 'PROPN', 2, 'nsubj'], [2, 'left', 'leave', 'VERB', 0, 'root'], [3, 'because', 'because', 'SCONJ', 5, 'mark'], [4, 'Ben', 'Ben', 'PROPN', 5, 'nsubj'],
  [5, 'shouted', 'shout', 'VERB', 2, 'advcl'], [6, 'and', 'and', 'CCONJ', 8, 'cc'], [7, 'Mara', 'Mara', 'PROPN', 8, 'nsubj'], [8, 'stayed', 'stay', 'VERB', 5, 'conj'], [9, '.', '.', 'PUNCT', 2, 'punct']]}]};

test('tangleOf counts finite clauses and types the sentence', () => {
  const t = tangleOf(analysis);
  assert.equal(t.clauses, 3);
  assert.ok(t.tangled);
  assert.ok(t.types.includes('subordinate') && t.types.includes('coordination'));
  assert.equal(t.primary, 'subordinate');
  const one = tangleOf({sentences: [{text: 'Ana left.', tokens: [[1, 'Ana', 'Ana', 'PROPN', 2, 'nsubj'], [2, 'left', 'leave', 'VERB', 0, 'root'], [3, '.', '.', 'PUNCT', 2, 'punct']]}]});
  assert.equal(one.clauses, 1);
  assert.equal(one.tangled, false);
});

test('several questions are tangled even without subordination', () => {
  const q = s => ({text: s, tokens: [[1, 'Who', 'who', 'PRON', 2, 'nsubj'], [2, 'left', 'leave', 'VERB', 0, 'root'], [3, '?', '?', 'PUNCT', 2, 'punct']]});
  assert.equal(tangleOf({sentences: [q('Who left?'), q('Who left?')]}).primary, 'multi_question');
});

test('markers: a not-represented span, an uncertain sentence or a partial leftover is a marker; an uncertified sentence alone is not', () => {
  const verified = {text: 'Ana left.', status: 'verified', cnl_sentences: ['Ana left.'], not_represented: [], certified: false};
  assert.equal(markers({available: true, sentences: [verified], not_represented: []}).marked, false);
  assert.deepEqual(markers({available: true, sentences: [verified], not_represented: ['hey']}).reasons, ['not_represented']);
  assert.deepEqual(markers({available: true, sentences: [{...verified, status: 'uncertain'}], not_represented: []}).reasons, ['uncertain']);
  assert.deepEqual(markers({available: true, sentences: [verified], not_represented: []}, {leftovers: ['ana  LEFT.']}).reasons, ['partial_leftover']);
  assert.equal(markers({available: false}).marked, true);
});

test('understoodText shows the CNL of verified sentences and the original wording of uncertain ones', () => {
  const text = understoodText({available: true, sentences: [{status: 'verified', cnl_sentences: ['Ana left.'], text: 'ana left'}, {status: 'uncertain', cnl: null, cnl_sentences: [], text: 'Ben, hm, shouted.'}]});
  assert.equal(text, 'Ana left. Ben, hm, shouted.');
});

test('failureStats: silent meaning change is a failure with no marker; acceptable is its complement', () => {
  const rec = (severity, marked) => ({severity, severity_lower: severity, marked});
  const st = failureStats([rec('S0', false), rec('S4', true), rec('S4', false), rec('S3', false), rec('S2', false), rec('NONE', false)]);
  assert.equal(st.n, 6);
  assert.equal(st.catastrophic.k, 2);
  assert.equal(st.catastrophic_silent.k, 1);
  assert.equal(st.failure_s3plus.k, 4);
  assert.equal(st.failure_detectable.k, 1);
  assert.equal(st.silent_meaning_change.k, 3);
  assert.equal(st.acceptable.k, 3);
});

test('shapeStats counts sentences, certified sentences and the expected count', () => {
  const st = shapeStats([{sentences: 3, certified_sentences: 3, all_certified: true, expected: 3, input_sentences: 1, changed: true}, {sentences: 1, certified_sentences: 0, all_certified: false, expected: 3, input_sentences: 1, changed: false}]);
  assert.equal(st.certified_sentences.k, 3);
  assert.equal(st.count_equals_expected.k, 1);
  assert.equal(st.decomposed.k, 1);
});

test('pairSeverity: the local layer decides, else the worse judge is the upper estimate and the milder the lower', () => {
  const local = new Map([['a', {decided: true, severity: 'S0', layer: 'exact'}], ['b', {decided: false}]]);
  const judges = {grok: new Map([['b', 'S1']]), glm: new Map([['b', 'S4']])};
  assert.deepEqual(pairSeverity('a', local, judges), {upper: 'S0', lower: 'S0', layer: 'exact'});
  assert.deepEqual(pairSeverity('b', local, judges), {upper: 'S4', lower: 'S1', layer: 'judge'});
});

test('partial acceptance keeps certified output sentences and the original unit follows; a failed meaning check keeps the original', async () => {
  const facts = new Map([['Ana left and Ben stayed because Mara called.', {certified: false}], ['Ana left.', {certified: true}], ['Ben stayed because Mara called.', {certified: false}]]);
  const inspect = async t => facts.get(t) ?? {certified: false};
  const original = 'Ana left and Ben stayed because Mara called.';
  const ok = await runPartialPipeline(original, {split: splitSentences, inspect, rewrite: async () => 'Ana left. Ben stayed because Mara called.'});
  assert.equal(ok.text, `Ana left. ${original}`);
  assert.deepEqual(ok.leftovers, [original]);
  const flipped = await runPartialPipeline(original, {split: splitSentences, inspect, rewrite: async () => 'Ana did not leave. Ben stayed because Mara called.'});
  assert.equal(flipped.text, original);
  assert.ok(flipped.units[0].reasons.includes('meaning_negation'));
  const none = await runPartialPipeline(original, {split: splitSentences, inspect, rewrite: async () => 'Ana left. Ben stayed.'});
  assert.equal(none.text, `Ana left. Ben stayed.`.length ? original : original);
});

test('the decomposition suite and the iteration-3 data keep their declared status', () => {
  const suite = path.join(root, 'eval/suites/decomposition');
  if (fs.existsSync(path.join(suite, 'manifest.json'))) {
    const manifest = JSON.parse(fs.readFileSync(path.join(suite, 'manifest.json'), 'utf8'));
    const rows = fs.readFileSync(path.join(suite, 'test.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    assert.equal(manifest.rows, rows.length);
    for (const r of rows) { assert.ok(r.expected.length >= 2, r.id); assert.ok(r.certified && r.meaning_votes.grok && r.meaning_votes.glm, r.id); }
  }
  const data = path.join(root, 'datasets/neuro_english/proofing-it3-decomp/manifest.json');
  if (fs.existsSync(data)) {
    const manifest = JSON.parse(fs.readFileSync(data, 'utf8'));
    assert.equal(manifest.status, 'prepared, not trained');
    assert.equal(manifest.training_authorized, false);
  }
});
