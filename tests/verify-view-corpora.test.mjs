/** Verifiers of the archived `clean-english` and `proofing` corpora (tools/datasets/verify-view-corpora.mjs; TODO 1e): a clean fixture passes,
 * and each defect class is caught by name. Fixtures live in a temporary root; no model, no GPU. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tempDir} from './helpers.mjs';
import {verifyProofing, verifyCleanEnglish} from '../tools/datasets/verify-view-corpora.mjs';
import {hashJsonlSharded} from '../lib/jsonl-shards.mjs';

const write = (root, relative, rows) => { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')); return file; };
const flags = {synthetic: true, human_reviewed: false, training_approved: false};

async function fixture(t, corpus, files, extra = {}) {
  const root = tempDir(t, 'view-corpora-');
  const manifest = {format: 'chatsop-corpus-manifest-v2', corpus, training_authorized: false, splits: {}, sha256: {}, counts: {}, ...extra};
  for (const [name, {relative, stored, rows}] of Object.entries(files)) {
    const file = write(root, relative, rows);
    manifest.splits[name] = stored; manifest.sha256[stored.split(' ')[0]] = await hashJsonlSharded(file); manifest.counts[name] = rows.length;
  }
  fs.writeFileSync(path.join(root, `datasets_archive/${corpus}/manifest.json`), JSON.stringify(manifest));
  return {root, manifest};
}

const proofRow = (id, split, group, extra = {}) => ({id, source_corpus: 'formalizer-v1', source_id: id, split_group_id: group, semantic_case_id: group, split, language: 'en', input: `input ${id}`, target: `input ${id}`, kind: 'identity', target_source: null, quality_flags: flags, rights: {input: 'x'}, ...extra});
const proofFiles = () => ({
  train: {relative: 'datasets_archive/proofing/train.jsonl', stored: 'datasets/proofing/train.jsonl', rows: [proofRow('a1', 'train', 'g1'), proofRow('a2', 'train', 'g2', {kind: 'repair', input: 'Ana wrks', target: 'Ana works', target_source: 'teacher', target_oracle: {strict: true, tolerant: true}, meaning_checks: {ok: true}})]},
  dev: {relative: 'datasets_archive/proofing/dev.jsonl', stored: 'datasets/proofing/dev.jsonl', rows: [proofRow('b1', 'dev', 'g3')]},
  test: {relative: 'eval/suites/proofing/test.jsonl', stored: 'eval/suites/proofing/test.jsonl', rows: [proofRow('c1', 'test', 'g4'), proofRow('c2', 'test', 'g5', {kind: 'hard', target: null})]},
  hard_cases: {relative: 'datasets_archive/proofing/hard_cases.jsonl', stored: 'datasets/proofing/hard_cases.jsonl (never a training target)', rows: [proofRow('h1', null, 'g1', {kind: 'hard', target: null})]},
});
const withProjection = (root, train = [{id: 'a1', prompt: 'input a1', target: 'input a1'}, {id: 'a2', prompt: 'Ana wrks', target: 'Ana works'}], dev = [{id: 'b1', prompt: 'input b1', target: 'input b1'}]) => { write(root, 'datasets_archive/proofing/proofreader/train.jsonl', train); write(root, 'datasets_archive/proofing/proofreader/dev.jsonl', dev); };

test('proofing: a consistent fixture passes', async t => {
  const {root} = await fixture(t, 'proofing', proofFiles());
  withProjection(root);
  const result = await verifyProofing({root});
  assert.deepEqual(result.failures, []);
});

test('proofing: each defect class is caught by name', async t => {
  const files = proofFiles();
  files.train.rows[0] = proofRow('a1', 'train', 'g4'); // group g4 is also in test
  files.train.rows[1] = {...files.train.rows[1], target: files.train.rows[1].input}; // repair without a change
  files.dev.rows.push(proofRow('b2', 'dev', 'g6', {kind: 'hard', target: null})); // hard row in dev
  files.dev.rows.push(proofRow('b3', 'dev', 'g7', {target: 'other'})); // identity whose target differs
  files.test.rows.push(proofRow('c3', 'test', 'g8', {quality_flags: {...flags, training_approved: true}}));
  files.hard_cases.rows.push(proofRow('h2', 'train', 'g1', {kind: 'repair', target: 'x'})); // not a hard row
  const {root} = await fixture(t, 'proofing', files);
  withProjection(root, [{id: 'a1', prompt: 'input a1', target: 'changed'}], []);
  const text = (await verifyProofing({root})).failures.join('\n');
  for (const expected of [/group g4 crosses splits/, /repair row whose target equals its input/, /hard row in dev/, /identity row whose target differs/, /quality_flags must be/, /hard_cases h2: kind repair/, /prompt\/target differ/, /proofreader\/dev.jsonl is missing|proofreader\/dev: 0 rows/, /proofreader\/train: 1 rows/]) assert.match(text, expected);
});

test('proofing: a checksum that differs from the manifest fails', async t => {
  const {root, manifest} = await fixture(t, 'proofing', proofFiles());
  withProjection(root);
  manifest.sha256['datasets/proofing/dev.jsonl'] = '0'.repeat(64);
  fs.writeFileSync(path.join(root, 'datasets_archive/proofing/manifest.json'), JSON.stringify(manifest));
  assert.match((await verifyProofing({root})).failures.join('\n'), /sha256 differs/);
});

const cleanRow = (id, split, extra = {}) => ({id, split, split_group_id: `grp-${id}`, language: 'en', question: `Who runs ${id}?`, sop_target: '@s1 stated\n  relation "run"\n  role subject "Ana"\n  role object "lab"\n  polarity affirmed\n  certainty asserted\n', expected: {}, rights: {text_copied: false}, quality_flags: {source_rows_copied: false, ...flags}, ...extra});
const cleanFiles = () => ({
  train: {relative: 'datasets_archive/clean-english/train.jsonl', stored: 'datasets/clean-english/train.jsonl', rows: [cleanRow('t1', 'train')]},
  dev: {relative: 'datasets_archive/clean-english/dev.jsonl', stored: 'datasets/clean-english/dev.jsonl', rows: [cleanRow('d1', 'dev')]},
  test: {relative: 'eval/suites/clean-english/test.jsonl', stored: 'eval/suites/clean-english/test.jsonl', rows: [cleanRow('e1', 'test'), cleanRow('w1', 'test', {suite: 'formalizer-wild-v1', writer: 'writer-1', split_group_id: undefined, rights: {text_copied: false}, quality_flags: ['eval_only_never_training']})]},
});

test('clean-english: a consistent fixture passes; wild rows need no split group', async t => {
  const {root} = await fixture(t, 'clean-english', cleanFiles());
  assert.deepEqual((await verifyCleanEnglish({root, languageGate: false})).failures, []);
});

test('clean-english: language, model input, copied text, repeated messages and bad targets are caught', async t => {
  const files = cleanFiles();
  files.train.rows.push(cleanRow('t2', 'train', {language: 'ro'}), cleanRow('t3', 'train', {context: {}}), cleanRow('t4', 'train', {sop_target: 'not a program'}), cleanRow('t5', 'train', {rights: {text_copied: true}}));
  files.test.rows.push(cleanRow('e2', 'test', {question: 'Who runs t1?'})); // repeats a train message
  files.test.rows.push(cleanRow('w2', 'dev', {suite: 'formalizer-wild-v1', writer: 'w', split_group_id: undefined, quality_flags: ['x']}));
  const {root} = await fixture(t, 'clean-english', files);
  const text = (await verifyCleanEnglish({root, languageGate: false})).failures.join('\n');
  for (const expected of [/t2: language ro/, /t3: the evaluation-only scaffolding/, /t4: target is not model language/, /t5: rights\/provenance/, /e2: message repeated from t1/, /w2: a wild row must carry/, /w2: row of split dev in the test file/]) assert.match(text, expected);
});
