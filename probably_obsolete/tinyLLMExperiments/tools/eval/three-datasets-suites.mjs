#!/usr/bin/env node
/** Sealed side of the three datasets (bad_english, symbolic_english, neuro_english; DS008 "Three datasets").
 *
 *   node tools/eval/three-datasets-suites.mjs hashes                      # sealed text hashes for the train/dev builder
 *   node tools/eval/three-datasets-suites.mjs analyze [--shard 0/4] [--threads 3]   # then `targets` (rewrite candidates)
 *   node tools/eval/three-datasets-suites.mjs assemble [--datasets a,b]   # writes eval/suites/<dataset>/test.jsonl (or only the named datasets)
 *   node tools/eval/three-datasets-suites.mjs merge-llm-targets [--dry]   # DeepSeek flash targets into the sealed bad_english test, in place (owner decision 2026-09-30 night: bad tests may be fixed)
 *
 * Only rows of the sealed suites (eval/suites/formalizer-v1, formalizer-ood-v1, formalizer-wild-v1, proofing) and the
 * owner-sealed writers of the new cases (datasets_sources/new_cases/split-proposal.json) go into a test file, and
 * nothing else: a generator may not open a sealed file (AGENTS.md rule 9), so this tool lives beside
 * tools/eval/clean-english-suite.mjs. It shares the assembler with tools/datasets/build-three-datasets.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {ROOT, archived} from '../../lib/dataset-paths.mjs';
import {formalizerRecord} from '../datasets/three-datasets/sources.mjs';
import {newCaseRecords} from '../datasets/three-datasets/inputs.mjs';
import {normalText} from '../datasets/three-datasets/inputs.mjs';
import {analyseTexts, loadCache, textKey} from '../datasets/three-datasets/analysis.mjs';
import {assemble, targetTexts, goldMissTargetTexts} from '../datasets/three-datasets/assemble.mjs';
import {scoreAgainstAccepted} from './wild-suite.mjs';
import {legacyTestRows, WILD} from './legacy-resplit.mjs';
import {proofingIndex, regularizationIndex} from '../datasets/three-datasets/targets.mjs';
import {writeSplit, summarise, updateManifest, DATASET_INFO, MANIFEST_FORMAT} from '../datasets/three-datasets/write.mjs';

const WORK = path.join(ROOT, 'eval/reports/current/three-datasets');
const SUITES = {'formalizer-v1': 'eval/suites/formalizer-v1/test.jsonl'};
const read = relative => readJsonlShardedSync(path.join(ROOT, relative));

function args(argv) {
  const [command, ...rest] = argv, out = {command};
  for (let i = 0; i < rest.length; i++) { const key = rest[i].replace(/^--/, ''); out[key] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; }
  return out;
}

/** Split groups of the sealed proofing test (`eval/suites/proofing`): its messages are formalizer-v1 dev messages. */
function proofingSealedGroups() {
  return [...new Set(read('eval/suites/proofing/test.jsonl').map(row => row.split_group_id))].sort();
}

/**
 * Sealed formalizer records: the three sealed suites, plus the formalizer-v1 dev rows whose group the sealed proofing
 * test uses (AGENTS.md rule 9: a message that is in a sealed test is never in train or dev, so the dev rows of those
 * groups are sealed here instead). Those rows keep `source.origin_split: dev` and `source.sealed_by`.
 */
function sealedFormalizerRecords() {
  const records = Object.entries(SUITES).flatMap(([corpus, file]) => read(file).map(row => formalizerRecord(row, {corpus, split: 'test'})));
  // Owner decision 2026-09-30 (DS008 "Form coverage and form variants"): only the test part of the legacy out-of-distribution and wild suites is sealed here; the train and
  // dev parts are learning material (tools/eval/legacy-resplit.mjs writes them to datasets_archive/). The legacy files stay as archive and provenance.
  for (const corpus of Object.keys(WILD)) for (const row of legacyTestRows(corpus)) records.push(formalizerRecord(row, {corpus, split: 'test', wild: WILD[corpus]}));
  const groups = new Set(proofingSealedGroups());
  for (const row of read(archived('formalizer-v1/dev.jsonl'))) {
    if (!groups.has(row.split_group_id)) continue;
    const record = formalizerRecord(row, {corpus: 'formalizer-v1', split: 'test'});
    record.originSplit = 'dev';
    records.push(record);
  }
  return records;
}

async function main() {
  const o = args(process.argv.slice(2));
  const sealed = sealedFormalizerRecords();
  const newCases = newCaseRecords();
  const sealedCases = newCases.records.filter(r => r.split === 'test');
  if (o.command === 'hashes') {
    const hashes = [...new Set([...sealed, ...sealedCases].map(r => textKey(normalText(r.message))))].sort();
    fs.mkdirSync(WORK, {recursive: true});
    fs.writeFileSync(path.join(WORK, 'sealed-text-hashes.json'), JSON.stringify({note: 'sha1 prefixes of the normalized message text of every sealed row (formalizer suites, sealed new-case writers) and the split groups of the sealed proofing test (their formalizer-v1 dev rows are sealed too); no text', rows: sealed.length + sealedCases.length, groups: proofingSealedGroups(), hashes}, null, 1) + '\n');
    const proofingRows = read('eval/suites/proofing/test.jsonl');
    const by = {}; for (const r of proofingRows) by[r.kind] = (by[r.kind] ?? 0) + 1;
    const suites = {}; for (const r of sealed) { const key = r.originSplit ? `${r.corpus} (dev rows of the sealed proofing test groups)` : r.corpus; suites[key] = (suites[key] ?? 0) + 1; }
    fs.writeFileSync(path.join(WORK, 'sealed-source-counts.json'), JSON.stringify({note: 'row counts of the sealed sources (no text)', formalizer: suites, proofing: {rows: proofingRows.length, by_kind: by}, new_cases_sealed: sealedCases.length}, null, 1) + '\n');
    console.log(`${hashes.length} sealed text hashes`);
    return;
  }
  if (o.command === 'snapshot-before') {
    // Frozen labels of the sealed rows of symbolic_english and neuro_english as the SOP-proxy builders placed them (ids and labels only; analysis-layer re-split).
    const {writeSnapshot} = await import('../datasets/three-datasets/resplit-report.mjs');
    const rows = ['symbolic_english', 'neuro_english'].flatMap(dataset => read(`eval/suites/${dataset}/test.jsonl`));
    console.log(JSON.stringify(writeSnapshot('test', rows, {force: Boolean(o.force)})));
    return;
  }
  if (o.command === 'analyze') {
    const [index, count] = String(o.shard ?? '0/1').split('/').map(Number);
    const texts = sealed.filter(r => r.partition === 'clean_en').map(r => r.message);
    const result = await analyseTexts(texts, {shard: [index, count], threads: Number(o.threads ?? 3), onProgress: (done, todo) => process.stderr.write(`\rsealed shard ${index}/${count}: ${done}/${todo}`)});
    console.error(`\nshard ${index}/${count}: analysed ${result.done} of ${result.todo}`);
    return;
  }
  if (o.command === 'targets') {
    // Phase 2 of the analysis: the clean references of the sealed new cases whose message fails and the rewrite candidates of
    // the gold-verified misses of the sealed suites (re-verified under the current engine by the assembler).
    const cache = loadCache();
    const proofing = proofingIndex(read('eval/suites/proofing/test.jsonl'));
    const regularization = regularizationIndex(fs.readFileSync(path.join(ROOT, 'eval/reports/current/symbolic-layers/regularization-candidates.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)));
    const texts = [...targetTexts(sealedCases, cache), ...await goldMissTargetTexts(sealed, cache, {proofing, regularization, wildScore: scoreAgainstAccepted})];
    const result = await analyseTexts(texts, {onProgress: (done, todo) => process.stderr.write(`\rsealed targets: ${done}/${todo}`)});
    console.error(`\nanalysed ${result.done} of ${result.todo}`);
    return;
  }
  if (o.command === 'accurate') {
    const {parseAccurate} = await import('../datasets/three-datasets/accurate.mjs');
    const texts = [...sealed, ...sealedCases].filter(r => r.partition === 'clean_en' && !r.noisy).map(r => r.message);
    const result = await parseAccurate(texts, {onProgress: (done, todo) => process.stderr.write(`\raccurate ${done}/${todo}`)});
    console.error(`\naccurate parses added: ${result.done} of ${result.todo}`);
    return;
  }
  if (o.command === 'merge-llm-targets') {
    // Owner decision 2026-09-30 night (journal; questions.md Q-DATA-2): a sealed test row may be completed or corrected when it is incomplete or wrong, with the change recorded
    // (source, reason) and the same checks as train/dev. The targets of datasets_sources/bad_english_targets are merged with the rules of the train/dev merge
    // (tools/datasets/three-datasets/llm-targets.mjs): only rows without a target; a target that fails the clean-English gate is held as an unverified reference; a mixed row that is
    // already clean takes its message as target; `target_source: llm:deepseek-flash`, `review_status: pending`. Idempotent.
    const {loadLlmTargets, applyLlmTargets, LLM_TARGET_SOURCE} = await import('../datasets/three-datasets/llm-targets.mjs');
    const base = path.join(ROOT, 'eval/suites/bad_english/test.jsonl');
    const rows = read('eval/suites/bad_english/test.jsonl');
    const before = rows.filter(r => r.target).length;
    const counts = applyLlmTargets(rows, loadLlmTargets());
    const report = {generated_at: new Date().toISOString(), file: 'eval/suites/bad_english/test.jsonl', rows: rows.length, rows_with_target_before: before, rows_with_target_after: rows.filter(r => r.target).length, counts, source: LLM_TARGET_SOURCE, reason: 'sealed bad_english rows without a clean-English target were incomplete (owner decision 2026-09-30 night: no point in sealing nonsense)', review_status: 'pending'};
    if (!o.dry) {
      const written = await writeSplit('bad_english', 'test', rows, {base});
      const counted = summarise('bad_english', rows);
      const suiteFile = path.join(ROOT, 'eval/suites/bad_english/manifest.json');
      const suite = JSON.parse(fs.readFileSync(suiteFile, 'utf8'));
      Object.assign(suite, {rows: written.rows, sha256: written.sha256, bytes: written.bytes, counts: counted, llm_targets: {source: 'datasets_sources/bad_english_targets', target_source: LLM_TARGET_SOURCE, review_status: 'pending', merged_at: report.generated_at, rows_merged: counts.merged, reason: report.reason}});
      fs.writeFileSync(suiteFile + '.tmp', JSON.stringify(suite, null, 1) + '\n');
      fs.renameSync(suiteFile + '.tmp', suiteFile); // atomic
      updateManifest('bad_english', {sha256: {[written.path]: written.sha256}, bytes: {[written.path]: written.bytes}, counts: {test: counted}, llm_targets_test: {source: 'datasets_sources/bad_english_targets', target_source: LLM_TARGET_SOURCE, review_status: 'pending', merged_at: report.generated_at, rows_merged: counts.merged, reason: report.reason}});
      fs.mkdirSync(WORK, {recursive: true});
      fs.writeFileSync(path.join(WORK, 'merge-llm-targets-test.json'), JSON.stringify(report, null, 1) + '\n');
    }
    console.log(JSON.stringify(report, null, 1));
    return;
  }
  if (o.command === 'gate-stage') {
    // Records the parses the analysis gate lacks (GPU, one worker) and appends the judge items still missing for the sealed rows to datasets_sources/resplit_parse_judge/.
    const {AnalysisGate, stage} = await import('../datasets/three-datasets/analysis-gate.mjs');
    const {specialKind} = await import('../datasets/three-datasets/assemble.mjs');
    const cache = loadCache();
    const gate = new AnalysisGate({cache});
    const entries = [...sealed, ...sealedCases].filter(r => r.partition === 'clean_en' && !r.noisy).map(r => ({text: r.message, record: cache.get(textKey(r.message))})).filter(e => e.record && specialKind(e.record) !== 'no_analysis').map(e => ({text: e.text, analysis: e.record.analysis}));
    console.log(JSON.stringify(await stage(gate, entries, {record: !o.dry, log: m => process.stderr.write(m + '\n')})));
    return;
  }
  if (o.command === 'assemble') {
    const {AnalysisGate, GATE_NAME, GATE_JUDGE} = await import('../datasets/three-datasets/analysis-gate.mjs');
    const cache = loadCache();
    const parser = [...cache.values()].find(r => r.parser)?.parser ?? null;
    const proofing = proofingIndex(read('eval/suites/proofing/test.jsonl'));
    const regularization = regularizationIndex(fs.readFileSync(path.join(ROOT, 'eval/reports/current/symbolic-layers/regularization-candidates.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)));
    const built = await assemble([...sealed, ...sealedCases], {cache, parser, proofing, regularization, wildScore: scoreAgainstAccepted, agreement: (await import('../datasets/three-datasets/spacy-agree.mjs')).loadAgreement(), gate: new AnalysisGate({cache}), ...(o['unparsed-policy'] ? {unparsedPolicy: o['unparsed-policy']} : {})});
    const only = o.datasets ? new Set(String(o.datasets).split(',')) : null; // `--datasets a,b` limits the test files that are written (bad_english belongs to the agent that merges its targets)
    const report = {generated_at: new Date().toISOString(), skipped: built.skipped, gate: {name: GATE_NAME, judge: GATE_JUDGE, decided: built.gateStats.decided, unparsed_gate_would_say: built.gateStats.unparsed_gate_would_say, failure_kinds: built.gateStats.failure_kinds, sentence_trees: built.gateStats.sentence_trees, sentence_verdicts_from: built.gateStats.sentence_verdicts_from}, written: [], datasets: {}};
    if (built.gateStats.pending_texts.length) console.error(`WARNING: ${built.gateStats.pending_texts.length} sealed rows have no analysis verdict yet (pending_judge): run \`gate-stage\`, the judge task, then assemble again`);
    for (const [dataset, rows] of Object.entries({bad_english: built.bad, symbolic_english: built.symbolic, neuro_english: built.neuro})) {
      if (only && !only.has(dataset)) continue;
      const sorted = rows.sort((a, b) => a.id.localeCompare(b.id));
      const written = await writeSplit(dataset, 'test', sorted, {base: path.join(ROOT, 'eval/suites', dataset, 'test.jsonl')});
      const counts = summarise(dataset, sorted);
      const suiteManifest = {format: MANIFEST_FORMAT, dataset, split: 'test', sealed: true, ...DATASET_INFO[dataset], path: written.path, rows: written.rows, sha256: written.sha256, bytes: written.bytes, counts,
        sources: 'eval/suites/{formalizer-v1,formalizer-ood-v1,formalizer-wild-v1,proofing} and the owner-sealed writers of datasets_sources/new_cases (rule 9: only here, never in train/dev)', built_at: new Date().toISOString()};
      fs.mkdirSync(path.join(ROOT, 'eval/suites', dataset), {recursive: true});
      const suiteFile = path.join(ROOT, 'eval/suites', dataset, 'manifest.json');
      fs.writeFileSync(suiteFile + '.tmp', JSON.stringify(suiteManifest, null, 1) + '\n');
      fs.renameSync(suiteFile + '.tmp', suiteFile); // atomic, like the split files (lib/jsonl-shards.mjs)
      updateManifest(dataset, {splits: {test: written.path}, sha256: {[written.path]: written.sha256}, bytes: {[written.path]: written.bytes}, counts: {test: counts}, test_built_at: new Date().toISOString()});
      report.datasets[dataset] = counts;
      report.written.push(dataset);
    }
    const {movement} = await import('../datasets/three-datasets/resplit-report.mjs');
    const moved = movement('test', [...built.symbolic, ...built.neuro]);
    if (moved) { fs.mkdirSync(path.join(WORK, 'resplit'), {recursive: true}); fs.writeFileSync(path.join(WORK, 'resplit/movement-test.json'), JSON.stringify(moved, null, 1) + '\n'); report.movement = moved; }
    fs.writeFileSync(path.join(WORK, 'assemble-test.json'), JSON.stringify(report, null, 1) + '\n');
    console.log(JSON.stringify(report, null, 1));
    return;
  }
  throw Error('unknown command ' + o.command);
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
