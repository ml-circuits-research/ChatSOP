/** Layout of datasets/ after the owner decision of 2026-09-30 and the resolver of legacy paths (lib/dataset-paths.mjs). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {archived, corpusDir, corpusNames, resolveDatasetPath, THREE_DATASETS, NATURAL_COLLECTION, LEGACY_CORPORA, ARCHIVE_DIR} from '../lib/dataset-paths.mjs';
import {repoPath, tempDir} from './helpers.mjs';

test('the first level of datasets/ holds only the three datasets, the owner-message collection natural and SOURCES.md', () => {
  assert.deepEqual(fs.readdirSync(repoPath('datasets')).sort(), [...THREE_DATASETS, NATURAL_COLLECTION, 'SOURCES.md'].sort());
});

test('legacy corpora live in datasets_archive/ and old stored paths resolve to them', () => {
  for (const corpus of ['formalizer-v1', 'proofing', 'proofing-diverse-dev', 'clean-english', 'diversity']) assert.ok(fs.existsSync(repoPath(`${ARCHIVE_DIR}/${corpus}`)), corpus);
  assert.equal(resolveDatasetPath('datasets/formalizer-v1/world'), 'datasets_archive/formalizer-v1/world');
  assert.ok(fs.existsSync(repoPath(resolveDatasetPath('datasets/formalizer-v1/manifest.json'))));
  assert.equal(resolveDatasetPath('datasets/bad_english/train.jsonl'), 'datasets/bad_english/train.jsonl', 'the three datasets are not legacy');
  assert.equal(resolveDatasetPath('eval/suites/formalizer-v1/test.jsonl'), 'eval/suites/formalizer-v1/test.jsonl');
  assert.equal(archived('proofing/train.jsonl'), 'datasets_archive/proofing/train.jsonl');
  assert.equal(corpusDir('formalizer-v1'), 'datasets_archive/formalizer-v1');
  assert.equal(corpusDir('symbolic_english'), 'datasets/symbolic_english');
  const names = corpusNames();
  for (const name of [...THREE_DATASETS, ...LEGACY_CORPORA]) assert.ok(names.includes(name), name);
});

test('corpusDir and corpusNames follow a scratch root, and the alias file names every legacy corpus', t => {
  const root = tempDir(t, 'dataset-paths-');
  fs.mkdirSync(path.join(root, 'datasets/neuro_english'), {recursive: true});
  fs.mkdirSync(path.join(root, 'datasets_archive/proofing-y'), {recursive: true});
  assert.deepEqual(corpusNames(root), ['neuro_english', 'proofing-y']);
  assert.equal(corpusDir('proofing-y', root), 'datasets_archive/proofing-y');
  const aliases = JSON.parse(fs.readFileSync(repoPath('datasets_archive/PATH_ALIASES.json'), 'utf8')).aliases;
  for (const corpus of LEGACY_CORPORA) assert.equal(aliases[`datasets/${corpus}`], `datasets_archive/${corpus}`);
});
