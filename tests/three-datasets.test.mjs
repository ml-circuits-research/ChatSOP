/** The three datasets (bad_english, symbolic_english, neuro_english; DS008 "Three datasets"): noise reconstruction,
 * new-case splits, regression classes and, when the datasets are built, the fail-closed verifier. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {undoNoise, noiseCategories} from '../tools/datasets/three-datasets/noise.mjs';
import {newCaseSplits} from '../tools/datasets/three-datasets/sources.mjs';
import {classifyRow, emptyCounts, FAILING_CLASSES} from '../lib/symbolic-lm/regression.mjs';
import {repoPath} from './helpers.mjs';

test('undoNoise reconstructs the clean text from recorded operations and refuses what it cannot undo', () => {
  assert.equal(undoNoise('I wonddr who Jürgen Schmidt raisses .', [{op: 'space_before_punctuation'}, {op: 'typo', kind: 'substitution', from: 'wonder', to: 'wonddr'}, {op: 'typo', kind: 'insertion', from: 'raises', to: 'raisses'}]), 'I wonder who Jürgen Schmidt raises.');
  assert.equal(undoNoise('Rem ind mewhen Priya wirked ubnder Rohan .', [{op: 'space_split', from: 'Remind', to: 'Rem ind'}, {op: 'space_merge', from: 'me when', to: 'mewhen'}, {op: 'typo', from: 'worked', to: 'wirked'}, {op: 'typo', from: 'under', to: 'ubnder'}, {op: 'space_before_punctuation'}]), 'Remind me when Priya worked under Rohan.');
  assert.equal(undoNoise('i cant come', [{op: 'lowercase_i'}, {op: 'missing_apostrophe'}, {op: 'lowercase_start'}]), "I can't come");
  assert.equal(undoNoise('anything', [{op: 'strip_diacritics'}]), null, 'not invertible');
  assert.equal(undoNoise('the the cat', [{op: 'typo', from: 'a', to: 'the'}]), null, 'a `to` that occurs twice is ambiguous');
  assert.equal(undoNoise('clean text', []), null);
  assert.deepEqual(noiseCategories([{op: 'typo'}, {op: 'space_merge'}, {op: 'space_split'}]), ['typo', 'spacing']);
});

test('new-case splits: sealed writers are the test, four deterministic dev writers, the rest train', () => {
  const writers = Array.from({length: 30}, (_, i) => `writer-${String(i + 1).padStart(2, '0')}`);
  const sealed = ['writer-13', 'writer-14', 'writer-15', 'writer-28', 'writer-29', 'writer-30'];
  const splitOf = newCaseSplits(writers, sealed);
  const counts = {};
  for (const w of writers) counts[splitOf(w)] = (counts[splitOf(w)] ?? 0) + 1;
  assert.deepEqual(counts, {train: 20, dev: 4, test: 6});
  assert.equal(splitOf('writer-13'), 'test');
  assert.deepEqual(writers.map(splitOf), writers.map(newCaseSplits(writers, sealed)), 'stable');
});

test('regression classes: same, analysis changed, SOP changed (verified or not), now failing', () => {
  const row = {sop: '@q query\n', unparsed: [], analysis: {sentences: [{text: 'A.', tokens: [[1, 'A', 'a', 'NOUN', 0, 'root']]}]}};
  const now = {sop: row.sop, sop_valid: true, outcome: 'converted', unparsed: [], analysis: JSON.parse(JSON.stringify(row.analysis))};
  assert.equal(classifyRow(row, now), 'same');
  const reparsed = {...now, analysis: {sentences: [{text: 'A.', tokens: [[1, 'A', 'a', 'PROPN', 0, 'root']]}]}};
  assert.equal(classifyRow(row, reparsed), 'analysis_changed_sop_same');
  const changed = {...now, sop: '@q query\n  x\n'};
  assert.equal(classifyRow(row, changed), 'sop_changed');
  assert.equal(classifyRow(row, changed, {goldStillMatches: true}), 'sop_changed_equivalent');
  assert.equal(classifyRow(row, changed, {goldStillMatches: false}), 'now_failing');
  assert.equal(classifyRow(row, {...now, unparsed: ['x'], sop: '@u unparsed\n'}), 'now_failing');
  assert.equal(classifyRow(row, {...now, sop_valid: false, sop: ''}), 'now_failing');
  assert.equal(classifyRow({...row, unparsed: ['x']}, {...now, unparsed: ['x'], analysis: reparsed.analysis}), 'analysis_changed_sop_same', 'a known unparsed span is not new');
  assert.deepEqual(FAILING_CLASSES, ['sop_changed', 'now_failing']);
  assert.equal(Object.keys(emptyCounts()).length, 5);
});

const built = fs.existsSync(repoPath('datasets/symbolic_english/manifest.json')) && fs.existsSync(repoPath('eval/suites/symbolic_english/test.jsonl'));
test('the built datasets pass the fail-closed verifier', {skip: !built && 'datasets not built', timeout: 600000}, () => {
  const result = spawnSync(process.execPath, [repoPath('tools/datasets/verify-three-datasets.mjs'), '--quick'], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  assert.equal(result.status, 0, result.stdout.slice(-3000));
});
