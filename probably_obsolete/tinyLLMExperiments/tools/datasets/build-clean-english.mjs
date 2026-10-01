#!/usr/bin/env node
/** Builds the clean-English partition of formalizer-v1 (owner decision 2026-09-30, journaled: formalization
 * evaluation focuses on valid, clean English; Romanian, "romgleza" and badly written English leave the evaluation
 * and are handled by a separate textToCleanEnglish chat-UI service).
 *
 * Partitioning: `tools/datasets/clean-english.mjs` `classifyPartition`, applied per row to
 * datasets_archive/formalizer-v1/{train,dev}.jsonl (sharded via lib/jsonl-shards.mjs). This generator never opens a sealed
 * test file (AGENTS.md rule 9); the sealed clean-English suite is built by `tools/eval/clean-english-suite.mjs`,
 * which also patches the `test` fields of the corpus manifest this tool writes (they are kept when it reruns).
 *
 * Outputs (never hand-edited; rerun this builder after a corpus or classifier change):
 *   - datasets_archive/clean-english/{train,dev}.jsonl   clean_en rows of formalizer-v1, split preserved, plus manifest.json
 *   - datasets_archive/formalizer-v1/partitions/{noisy_en,ro,mixed}.json   id lists + counts, for later separate evaluation
 *
 * This is a filter over already-approved, already-rights-cleared rows (DS014): no new source text is introduced, so
 * the corpus inherits formalizer-v1's `inspired_by` rights record (tools/datasets/rights.mjs) rather than declaring
 * a new one; `datasets/SOURCES.md` records the relationship.
 *
 *   node tools/datasets/build-clean-english.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync, writeJsonlShardedSync, jsonlBytes, hashJsonlSharded} from '../../lib/jsonl-shards.mjs';
import {loadSpellfix} from '../../lib/languages-util/spellfix.mjs';
import {defaultDictionary} from '../../sop/dictionary.mjs';
import {classifyPartition} from './clean-english.mjs';
import {SOURCES as RIGHTS_SOURCES} from './rights.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const abs = p => path.join(ROOT, p);
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, JSON.stringify(value, null, 1) + '\n'); };

const TRAIN_DEV = {
  train: 'datasets_archive/formalizer-v1/train.jsonl', // logical path; physically sharded train.part-NNN.jsonl
  dev: 'datasets_archive/formalizer-v1/dev.jsonl',
};
function classifyAll(rows, resources) {
  const byPartition = {clean_en: [], noisy_en: [], ro: [], mixed: []};
  for (const row of rows) {
    const {partition} = classifyPartition(row, resources);
    byPartition[partition].push(row);
  }
  return byPartition;
}

function partitionManifest(byPartition, sourceFile) {
  const out = {source: sourceFile, classifier: 'tools/datasets/clean-english.mjs classifyPartition', counts: {}};
  for (const [name, rows] of Object.entries(byPartition)) out.counts[name] = rows.length;
  for (const name of ['noisy_en', 'ro', 'mixed']) out[name] = byPartition[name].map(r => r.id);
  return out;
}

async function main() {
  console.log('loading LanguagesUtil resources (spellfix dictionaries, host dictionary)...');
  const resources = {spellfix: loadSpellfix(), dictionary: defaultDictionary()};

  // --- train/dev ------------------------------------------------------------------------------------------------
  const trainRows = readJsonlShardedSync(abs(TRAIN_DEV.train));
  const devRows = readJsonlShardedSync(abs(TRAIN_DEV.dev));
  const trainParts = classifyAll(trainRows, resources);
  const devParts = classifyAll(devRows, resources);
  console.log('formalizer-v1 train', Object.fromEntries(Object.entries(trainParts).map(([k, v]) => [k, v.length])));
  console.log('formalizer-v1 dev  ', Object.fromEntries(Object.entries(devParts).map(([k, v]) => [k, v.length])));

  fs.mkdirSync(abs('datasets_archive/formalizer-v1/partitions'), {recursive: true});
  writeJson(abs('datasets_archive/formalizer-v1/partitions/noisy_en.json'), {corpus: 'formalizer-v1', train: partitionManifest(trainParts, TRAIN_DEV.train).noisy_en, dev: partitionManifest(devParts, TRAIN_DEV.dev).noisy_en, counts: {train: trainParts.noisy_en.length, dev: devParts.noisy_en.length}});
  writeJson(abs('datasets_archive/formalizer-v1/partitions/ro.json'), {corpus: 'formalizer-v1', train: trainParts.ro.map(r => r.id), dev: devParts.ro.map(r => r.id), counts: {train: trainParts.ro.length, dev: devParts.ro.length}});
  writeJson(abs('datasets_archive/formalizer-v1/partitions/mixed.json'), {corpus: 'formalizer-v1', train: trainParts.mixed.map(r => r.id), dev: devParts.mixed.map(r => r.id), counts: {train: trainParts.mixed.length, dev: devParts.mixed.length}});

  fs.mkdirSync(abs('datasets_archive/clean-english'), {recursive: true});
  const trainResult = writeJsonlShardedSync(abs('datasets_archive/clean-english/train.jsonl'), trainParts.clean_en);
  const devResult = writeJsonlShardedSync(abs('datasets_archive/clean-english/dev.jsonl'), devParts.clean_en);

  // The sealed test fields come from tools/eval/clean-english-suite.mjs; keep what it recorded.
  const previous = fs.existsSync(abs('datasets_archive/clean-english/manifest.json')) ? JSON.parse(fs.readFileSync(abs('datasets_archive/clean-english/manifest.json'), 'utf8')) : {};
  const TEST = 'eval/suites/clean-english/test.jsonl';
  const hashes = {};
  for (const file of ['datasets_archive/clean-english/train.jsonl', 'datasets_archive/clean-english/dev.jsonl']) hashes[file] = await hashJsonlSharded(abs(file));
  if (previous.sha256?.[TEST]) hashes[TEST] = previous.sha256[TEST];

  // --- manifests --------------------------------------------------------------------------------------------------
  const inspiredBy = Object.keys(RIGHTS_SOURCES).map(id => ({id, name: RIGHTS_SOURCES[id].name, url: RIGHTS_SOURCES[id].url, licence: RIGHTS_SOURCES[id].licence}));
  const rights = {
    license: 'MIT (repository LICENSE); original ChatSOP authored text',
    rights_decision: 'inherited-from-formalizer-v1 (no new source text: a language-quality filter over already rights-cleared rows)',
    rights_decision_date: '2026-09-28',
    inspired_by: inspiredBy,
    text_copied: false,
    filtered_from: previous.rights?.filtered_from ?? 'datasets_archive/formalizer-v1 (train/dev), by tools/datasets/clean-english.mjs classifyPartition',
  };

  writeJson(abs('datasets_archive/clean-english/manifest.json'), {
    format: 'chatsop-corpus-manifest-v2', corpus: 'clean-english',
    owner_decision: '2026-09-30: formalization evaluation focuses on valid, clean English (status/journal.jsonl)',
    builder: 'tools/datasets/build-clean-english.mjs (train, dev) and tools/eval/clean-english-suite.mjs (test)', classifier: 'tools/datasets/clean-english.mjs',
    target_language: 'DS021 model language (stated, assumed, unclear, query, constraint)',
    model_input: 'question (the user message only); verification_context, ontology_sop, world, setup_sop, late_setup_sop, verification, surface_ir, expected and execution are evaluation-only (DS022 row fields), unchanged from formalizer-v1',
    review_status: 'not_reviewed', human_reviewed: false, training_authorized: false, synthetic: true,
    splits: {train: 'datasets_archive/clean-english/train.jsonl', dev: 'datasets_archive/clean-english/dev.jsonl', test: TEST},
    sha256: hashes,
    bytes: {'datasets_archive/clean-english/train.jsonl': jsonlBytes(abs('datasets_archive/clean-english/train.jsonl')), 'datasets_archive/clean-english/dev.jsonl': jsonlBytes(abs('datasets_archive/clean-english/dev.jsonl')), ...(previous.bytes?.[TEST] ? {[TEST]: previous.bytes[TEST]} : {})},
    counts: {train: trainParts.clean_en.length, dev: devParts.clean_en.length, ...(previous.counts?.test !== undefined ? {test: previous.counts.test, test_by_suite: previous.counts.test_by_suite} : {})},
    shared_world: {note: 'rows keep their original world reference (row.world, row.ontology_sop, row.setup_sop); this corpus adds no new world'},
    rights,
  });
  console.log('clean-english: train', trainParts.clean_en.length, 'dev', devParts.clean_en.length);
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
