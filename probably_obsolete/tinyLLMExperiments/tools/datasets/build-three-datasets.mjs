#!/usr/bin/env node
/** Build the three datasets of the owner decision of 2026-09-30 (DS008 "Three datasets"):
 *   datasets/bad_english      messages that are not clean English (Romanian, mixed, spelling/grammar) with a clean target
 *   datasets/symbolic_english clean English whose SymbolicLM analysis is correct: every sentence has identical default/accurate trees and DeepSeek conditions a and c good (the regression suite)
 *   datasets/neuro_english    clean English whose SymbolicLM analysis is not correct (SymbolicProofingLLM material); the SOP result of every row is kept as sop_layer
 *
 *   node tools/datasets/build-three-datasets.mjs collect                         # classification counts, no writes
 *   node tools/datasets/build-three-datasets.mjs analyze [--shard 0/4] [--threads 3] [--targets]
 *   node tools/datasets/build-three-datasets.mjs refresh --texts FILE [--device cpu]  # re-analyse cached texts whose tree changed (one text per line)
 *   node tools/datasets/build-three-datasets.mjs gate-stage [--dry]              # analysis gate: record missing parses, append the judge items still missing (datasets_sources/resplit_parse_judge)
 *   node tools/datasets/build-three-datasets.mjs assemble [--datasets a,b]       # writes train/dev of the three datasets (or only the named ones)
 *   node tools/datasets/build-three-datasets.mjs resplit-report                  # eval/reports/current/three-datasets/resplit-summary.md
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

async function assembleCommand(records, newCases, o = {}) {
  const {AnalysisGate, GATE_NAME, GATE_JUDGE} = await import('./three-datasets/analysis-gate.mjs');
  const cache = loadCache();
  const parser = [...cache.values()].find(r => r.parser)?.parser ?? null;
  const proofing = proofingIndex(trainDevProofingRows());
  const sealed = sealedHashes();
  const side = records.filter(r => r.split !== 'test');
  const {scoreAgainstAccepted} = await import('../eval/wild-suite.mjs'); // accepted golds of the wild rows that were re-split into train and dev
  const gate = new AnalysisGate({cache});
  const built = await assemble(side, {cache, parser, proofing, wildScore: scoreAgainstAccepted, agreement: (await import('./three-datasets/spacy-agree.mjs')).loadAgreement(), gate, ...(o['unparsed-policy'] ? {unparsedPolicy: o['unparsed-policy']} : {})});
  const dropped = {sealed_overlap: 0, dev_overlap: 0};
  const devTexts = new Set(side.filter(r => r.split === 'dev').map(r => textKey(normalText(r.message))));
  const keep = row => {
    const key = textKey(normalText(row.message));
    if (sealed.has(key)) { dropped.sealed_overlap++; return false; }
    if (row.split === 'train' && devTexts.has(key)) { dropped.dev_overlap++; return false; }
    return true;
  };
  const rowsByDataset = {bad_english: built.bad, symbolic_english: built.symbolic, neuro_english: built.neuro};
  // `--datasets a,b` limits the datasets that are written (the analysis-layer re-split leaves bad_english to the agent that merges its targets).
  const only = o.datasets ? new Set(String(o.datasets).split(',')) : null;
  const report = {generated_at: new Date().toISOString(), skipped: built.skipped, dropped, gate: {name: GATE_NAME, judge: GATE_JUDGE, decided: built.gateStats.decided, unparsed_gate_would_say: built.gateStats.unparsed_gate_would_say, failure_kinds: built.gateStats.failure_kinds, sentence_trees: built.gateStats.sentence_trees, sentence_verdicts_from: built.gateStats.sentence_verdicts_from}, written: [], datasets: {}};
  if (built.gateStats.pending_texts.length) console.error(`WARNING: ${built.gateStats.pending_texts.length} rows have no analysis verdict yet (pending_judge): run \`gate-stage\`, the judge task, then assemble again`);
  for (const [dataset, all] of Object.entries(rowsByDataset)) {
    if (only && !only.has(dataset)) continue;
    const rows = all.filter(keep);
    const patch = {splits_written: {}, counts: {}, sha256: {}, bytes: {}};
    for (const split of ['train', 'dev']) {
      const part = rows.filter(r => r.split === split).sort((a, b) => a.id.localeCompare(b.id));
      const written = await writeSplit(dataset, split, part);
      patch.sha256[written.path] = written.sha256; patch.bytes[written.path] = written.bytes;
      patch.counts[split] = summarise(dataset, part);
    }
    updateManifest(dataset, {...patch, symbolic_lm: {version: 'symbolic-lm-v2.0', rules: RULES_VERSION, stanza: parser, call: "analyze(text, {route: 'direct', language: 'auto'}), no spelling correction, no rewrite", code_sha256: codeHashes()},
      ...(dataset === 'bad_english' ? {} : {analysis_gate: {name: GATE_NAME, judge: GATE_JUDGE, rule: 'symbolic_english: every sentence has identical default/accurate trees and DeepSeek conditions a and c good; neuro_english otherwise; no analysis or an unparsed span: the SOP rules decide', decision: 'status/journal.jsonl 2026-09-30 night, incident: symbolic/neuro split used SOP match instead of the grammatical analysis'}}),
      sources: {new_cases: {path: 'datasets_sources/new_cases/cases.jsonl', sha256: newCases.sha256, rows: newCases.records.length, note: 'read-only; LLM-written references marked reviewed-by:pending'}}, train_dev_built_at: new Date().toISOString()});
    report.datasets[dataset] = patch.counts;
    report.written.push(dataset);
  }
  const {movement} = await import('./three-datasets/resplit-report.mjs');
  const moved = movement('train-dev', [...built.symbolic, ...built.neuro].filter(keep));
  fs.mkdirSync(WORK, {recursive: true});
  if (moved) { fs.mkdirSync(path.join(WORK, 'resplit'), {recursive: true}); fs.writeFileSync(path.join(WORK, 'resplit/movement-train-dev.json'), JSON.stringify(moved, null, 1) + '\n'); report.movement = moved; }
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
      const {scoreAgainstAccepted} = await import('../eval/wild-suite.mjs'); // accepted golds of the wild rows re-split into train and dev
      texts = [...targetTexts(newCases.records, cache), ...await goldMissTargetTexts(formalizer, cache, {proofing: proofingIndex(trainDevProofingRows()), wildScore: scoreAgainstAccepted})];
    }
    const result = await analyseTexts(texts, {shard: [index, count], threads: Number(o.threads ?? 3), onProgress: (done, todo) => process.stderr.write(`\r${o.targets ? 'targets' : 'messages'} shard ${index}/${count}: ${done}/${todo}`)});
    console.error(`\nshard ${index}/${count}: analysed ${result.done} of ${result.todo}`);
    return;
  }
  if (o.command === 'refresh') {
    // Re-analyse specific texts although they are cached (rows whose tree changed, for example under a new rules version): `refresh --texts FILE [--device cpu]`, one text per line.
    if (typeof o.texts !== 'string') throw Error('usage: build-three-datasets.mjs refresh --texts FILE [--device cpu|cuda]');
    const texts = fs.readFileSync(o.texts, 'utf8').split('\n').filter(Boolean);
    const result = await analyseTexts(texts, {force: true, threads: 1, ...(o.device ? {device: o.device} : {})});
    console.error(`refreshed ${result.done} of ${texts.length} texts`);
    return;
  }
  if (o.command === 'accurate') {
    const {parseAccurate} = await import('./three-datasets/accurate.mjs');
    const result = await parseAccurate(messageTexts(records), {onProgress: (done, todo) => process.stderr.write(`\raccurate ${done}/${todo}`)});
    console.error(`\naccurate parses added: ${result.done} of ${result.todo}`);
    return;
  }
  if (o.command === 'resplit-report') {
    const {writeResplitSummary} = await import('./three-datasets/resplit-summary.mjs');
    console.log(writeResplitSummary());
    return;
  }
  if (o.command === 'gate-stage') {
    // Records the parses the analysis gate lacks (GPU, one worker) and appends the judge items still missing to datasets_sources/resplit_parse_judge/ (train/dev side).
    const {AnalysisGate, stage} = await import('./three-datasets/analysis-gate.mjs');
    const {specialKind} = await import('./three-datasets/assemble.mjs');
    const cache = loadCache();
    const gate = new AnalysisGate({cache});
    const entries = messageTexts(records.filter(r => r.split !== 'test')).map(text => ({text, record: cache.get(textKey(text))})).filter(e => e.record && specialKind(e.record) !== 'no_analysis').map(e => ({text: e.text, analysis: e.record.analysis}));
    console.log(JSON.stringify(await stage(gate, entries, {record: !o.dry, log: m => process.stderr.write(m + '\n')})));
    return;
  }
  if (o.command === 'snapshot-before') {
    // Frozen labels of the current (SOP-proxy) train/dev rows of symbolic_english and neuro_english, written once (DS008 "Three datasets", analysis-layer re-split).
    const {readJsonlShardedSync, jsonlExists} = await import('../../lib/jsonl-shards.mjs');
    const {writeSnapshot} = await import('./three-datasets/resplit-report.mjs');
    const rows = ['symbolic_english', 'neuro_english'].flatMap(dataset => ['train', 'dev'].flatMap(split => { const file = path.join(ROOT, 'datasets', dataset, `${split}.jsonl`); return jsonlExists(file) ? readJsonlShardedSync(file) : []; }));
    console.log(JSON.stringify(writeSnapshot('train-dev', rows, {force: Boolean(o.force)})));
    return;
  }
  if (o.command === 'assemble') return assembleCommand(records, newCases, o);
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
