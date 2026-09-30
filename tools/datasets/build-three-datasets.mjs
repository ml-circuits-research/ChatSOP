#!/usr/bin/env node
/** Build the three datasets of the owner decision of 2026-09-30 (DS008 "Three datasets"):
 *   datasets/bad_english      messages that are not clean English (Romanian, mixed, spelling/grammar) with a clean target
 *   datasets/symbolic_english clean English that SymbolicLM analyses correctly (the regression suite)
 *   datasets/neuro_english    clean English that SymbolicLM does not analyse correctly (SymbolicProofingLLM material)
 *
 *   node tools/datasets/build-three-datasets.mjs collect                         # classification counts, no writes
 *   node tools/datasets/build-three-datasets.mjs analyze [--shard 0/4] [--threads 3] [--targets]
 *   node tools/datasets/build-three-datasets.mjs assemble                        # writes train/dev of the three datasets
 *
 * Train and dev only: the sealed tests come from `node tools/eval/three-datasets-suites.mjs` (a generator may not
 * open a sealed file, AGENTS.md rule 9). Sources: datasets_archive/{formalizer-v1,proofing,proofing-diverse-dev}
 * and the read-only new-case delivery under datasets_sources/new_cases/.
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {trainDevFormalizerRecords, newCaseRecords, trainDevProofingRows, normalText} from './three-datasets/inputs.mjs';
import {proofingIndex} from './three-datasets/targets.mjs';
import {writeSplit, summarise, updateManifest} from './three-datasets/write.mjs';
import {assemble, RULES_VERSION} from './three-datasets/assemble.mjs';
import {codeHashes} from './three-datasets/hashes.mjs';
import {analyseTexts, loadCache, textKey} from './three-datasets/analysis.mjs';
import {targetTexts, goldMissTargetTexts} from './three-datasets/assemble.mjs';

const WORK = path.join(ROOT, 'eval/reports/current/three-datasets');

function args(argv) {
  const [command, ...rest] = argv, out = {command};
  for (let i = 0; i < rest.length; i++) { const key = rest[i].replace(/^--/, ''); out[key] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; }
  return out;
}

/** The distinct messages SymbolicLM has to analyse on this side: clean-English messages (phase 1). */
export function messageTexts(records) { return records.filter(r => r.partition === 'clean_en' && !r.noisy).map(r => r.message); }

function tally(records) {
  const counts = {};
  for (const r of records) { const key = `${r.corpus}/${r.split}/${r.partition}${r.noisy ? '+noisy' : ''}`; counts[key] = (counts[key] ?? 0) + 1; }
  return counts;
}

/** Hashes of the sealed texts and the sealed split groups (written by tools/eval/three-datasets-suites.mjs). */
function sealedFile() {
  const file = path.join(WORK, 'sealed-text-hashes.json');
  if (!fs.existsSync(file)) throw Error('run `node tools/eval/three-datasets-suites.mjs hashes` first (sealed text hashes are missing)');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
/** Train and dev rows whose normalized text equals a sealed text are dropped. */
const sealedHashes = () => new Set(sealedFile().hashes);
/** Split groups sealed by another sealed suite (the sealed proofing test uses formalizer-v1 dev messages): not train or dev here. */
const sealedGroups = () => new Set(sealedFile().groups ?? []);

async function assembleCommand(records, newCases) {
  const gateModule = await import('./three-datasets/gate.mjs');
  const cache = loadCache();
  const parser = [...cache.values()].find(r => r.parser)?.parser ?? null;
  const proofing = proofingIndex(trainDevProofingRows());
  const sealed = sealedHashes();
  const side = records.filter(r => r.split !== 'test');
  const built = await assemble(side, {cache, parser, proofing, agreement: (await import('./three-datasets/spacy-agree.mjs')).loadAgreement(), gate: gateModule.loadGate()});
  gateModule.writeWorklist('train-dev', built.gateWork);
  const dropped = {sealed_overlap: 0, dev_overlap: 0};
  const devTexts = new Set(side.filter(r => r.split === 'dev').map(r => textKey(normalText(r.message))));
  const keep = row => {
    const key = textKey(normalText(row.message));
    if (sealed.has(key)) { dropped.sealed_overlap++; return false; }
    if (row.split === 'train' && devTexts.has(key)) { dropped.dev_overlap++; return false; }
    return true;
  };
  const rowsByDataset = {bad_english: built.bad, symbolic_english: built.symbolic, neuro_english: built.neuro};
  const report = {generated_at: new Date().toISOString(), skipped: built.skipped, dropped, datasets: {}};
  for (const [dataset, all] of Object.entries(rowsByDataset)) {
    const rows = all.filter(keep);
    const patch = {splits_written: {}, counts: {}, sha256: {}, bytes: {}};
    for (const split of ['train', 'dev']) {
      const part = rows.filter(r => r.split === split).sort((a, b) => a.id.localeCompare(b.id));
      const written = await writeSplit(dataset, split, part);
      patch.sha256[written.path] = written.sha256; patch.bytes[written.path] = written.bytes;
      patch.counts[split] = summarise(dataset, part);
    }
    updateManifest(dataset, {...patch, symbolic_lm: {version: 'symbolic-lm-v2.0', rules: RULES_VERSION, stanza: parser, call: "analyze(text, {route: 'direct', language: 'auto'}), no spelling correction, no rewrite", code_sha256: codeHashes()},
      sources: {new_cases: {path: 'datasets_sources/new_cases/cases.jsonl', sha256: newCases.sha256, rows: newCases.records.length, note: 'read-only; LLM-written references marked reviewed-by:pending'}}, train_dev_built_at: new Date().toISOString()});
    report.datasets[dataset] = patch.counts;
  }
  fs.mkdirSync(WORK, {recursive: true});
  fs.writeFileSync(path.join(WORK, 'assemble-train-dev.json'), JSON.stringify(report, null, 1) + '\n');
  console.log(JSON.stringify(report, null, 1));
}

async function main() {
  const o = args(process.argv.slice(2));
  const formalizer = trainDevFormalizerRecords({excludeGroups: sealedGroups()});
  const newCases = newCaseRecords();
  const records = [...formalizer, ...newCases.records];
  if (o.command === 'collect') {
    console.log(JSON.stringify(tally(records), null, 1));
    return;
  }
  if (o.command === 'analyze') {
    const [index, count] = String(o.shard ?? '0/1').split('/').map(Number);
    let texts = messageTexts(records);
    if (o.targets) {
      // Phase 2: the clean references of the new cases whose message fails, and the rewrite candidates of the gold-verified
      // misses (their targets are re-verified under the current engine, the recorded oracle of older rules does not count).
      const cache = loadCache();
      texts = [...targetTexts(newCases.records, cache), ...await goldMissTargetTexts(formalizer, cache, {proofing: proofingIndex(trainDevProofingRows())})];
    }
    const result = await analyseTexts(texts, {shard: [index, count], threads: Number(o.threads ?? 3), onProgress: (done, todo) => process.stderr.write(`\r${o.targets ? 'targets' : 'messages'} shard ${index}/${count}: ${done}/${todo}`)});
    console.error(`\nshard ${index}/${count}: analysed ${result.done} of ${result.todo}`);
    return;
  }
  if (o.command === 'spacy') {
    const {computeAgreement} = await import('./three-datasets/spacy-agree.mjs');
    const result = await computeAgreement(loadCache(), {onProgress: (done, todo) => process.stderr.write(`\rspaCy ${done}/${todo}`)});
    console.error(`\nspaCy agreement records added: ${result.added}`);
    return;
  }
  if (o.command === 'accurate') {
    const {parseAccurate} = await import('./three-datasets/accurate.mjs');
    const result = await parseAccurate(messageTexts(records), {onProgress: (done, todo) => process.stderr.write(`\raccurate ${done}/${todo}`)});
    console.error(`\naccurate parses added: ${result.done} of ${result.todo}`);
    return;
  }
  if (o.command === 'assemble') return assembleCommand(records, newCases);
  if (o.command === 'report') {
    const {reuseAnalysis, updateReadmes, coverage} = await import('./three-datasets/report.mjs');
    fs.mkdirSync(WORK, {recursive: true});
    const everything = trainDevFormalizerRecords();
    const groups = sealedGroups();
    fs.writeFileSync(path.join(WORK, 'reuse-analysis.md'), reuseAnalysis({formalizer: everything, newCases: newCases.records, movedToTest: everything.filter(r => r.corpus === 'formalizer-v1' && groups.has(r.splitGroupId))}));
    fs.writeFileSync(path.join(WORK, 'coverage.json'), JSON.stringify(coverage(), null, 1) + '\n');
    updateReadmes();
    console.log('wrote reuse-analysis.md, coverage.json and the README counts');
    return;
  }
  throw Error('unknown command ' + o.command);
}
if (process.argv[1] === new URL(import.meta.url).pathname) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
