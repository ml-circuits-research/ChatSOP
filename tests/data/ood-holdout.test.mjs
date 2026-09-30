// Held-out guarantees of the built corpora (DS022 "Out-of-distribution suite", "Long messages", Q-DATA-6):
// no lead-in frame or construction of a formalizer-ood-v1 row occurs in formalizer-v1 train/dev, no
// formalizer-v1 row uses an OOD-only resource, Romanian rows have English targets, and long messages exist in
// every split.
import test from 'node:test';
import assert from 'node:assert/strict';
import {repoPath} from '../helpers.mjs';
import {corpusSkip, loadCorpus} from './corpus.mjs';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {isOodOnly, rowResources} from '../../tools/datasets/diversity/heldout.mjs';
import {RO_RELATION_EN} from '../../tools/datasets/diversity/english.mjs';
import {parse} from '../../sop/parser.mjs';

const CORPUS = 'formalizer-v1', OOD = 'formalizer-ood-v1';
const skip = corpusSkip(CORPUS);
const oodRows = () => readJsonlShardedSync(repoPath(`eval/suites/${OOD}/test.jsonl`));

test('OOD rows share no lead-in frame or construction with formalizer-v1 train/dev', {skip}, () => {
  const {bySplit} = loadCorpus(CORPUS);
  const development = [...bySplit.train, ...bySplit.dev];
  const frames = new Set(development.flatMap(row => rowResources(row).frames));
  const constructions = new Set(development.flatMap(row => rowResources(row).constructions));
  const rows = oodRows();
  const overlapping = rows.filter(row => rowResources(row).frames.some(id => frames.has(id)) || rowResources(row).constructions.some(id => constructions.has(id))).map(row => row.id);
  assert.deepEqual(overlapping.slice(0, 10), []);
  assert.ok(rows.some(row => row.ood_axis === 'domain') && rows.some(row => row.ood_axis === 'construction'), 'both OOD axes are present');
  assert.ok(rows.some(row => (row.surface_design?.resources ?? []).some(isOodOnly)), 'OOD-only resources are used');
});

test('no formalizer-v1 row uses an OOD-only frame or construction', {skip}, () => {
  const {rows} = loadCorpus(CORPUS);
  assert.deepEqual(rows.filter(row => (row.surface_design?.resources ?? []).some(isOodOnly)).map(row => row.id).slice(0, 10), []);
});

test('targets are canonical English: no Romanian relation phrase in any target', {skip}, () => {
  const romanian = new Set(Object.keys(RO_RELATION_EN).filter(phrase => !Object.values(RO_RELATION_EN).includes(phrase)));
  const bad = [];
  for (const row of [...loadCorpus(CORPUS).rows, ...oodRows()]) {
    for (const match of String(row.sop_target ?? '').matchAll(/relation ("(?:\\.|[^"\\])*")/g)) if (romanian.has(JSON.parse(match[1]))) bad.push(`${row.id}: ${match[1]}`);
  }
  assert.deepEqual(bad.slice(0, 10), []);
});

test('long messages: present in every split and the OOD suite, with long targets', {skip}, () => {
  const {bySplit} = loadCorpus(CORPUS);
  for (const [name, rows] of [...Object.entries(bySplit), ['ood', oodRows()]]) {
    const long = rows.filter(row => row.family === 'long_message');
    const share = long.length / rows.length;
    assert.ok(share >= 0.03 && share <= 0.12, `${name}: long-message share ${share.toFixed(3)}`);
    assert.ok(long.every(row => row.question.length >= 300), `${name}: a long message is shorter than 300 characters`);
  }
  const longest = Math.max(...bySplit.train.map(row => row.question.length));
  assert.ok(longest > 3000, `longest training message ${longest}`);
});

test('accepted alternative golds parse and differ from the primary target', {skip}, () => {
  const rows = loadCorpus(CORPUS).rows.filter(row => row.sop_targets_accepted);
  for (const row of rows) for (const text of row.sop_targets_accepted) {
    assert.doesNotThrow(() => parse(text), row.id);
    assert.notEqual(text, row.sop_target, row.id);
  }
});
