#!/usr/bin/env node
/** Fail-closed verification of the three datasets (bad_english, symbolic_english, neuro_english; DS008 "Three datasets").
 *
 *   node tools/datasets/verify-three-datasets.mjs [--dataset NAME] [--quick]
 *
 * A validator (like tools/datasets/validate.mjs) it may open the sealed test files. Checks: manifest format, sha256 and
 * byte counts of every split file, row counts, row schema per dataset, unique ids, split fields, split groups disjoint
 * across splits and across the three datasets, sealed-suite rows only in the sealed test, no normalized message text in
 * a test file and in a train or dev file, no lexical duplicate of a train/dev row in the test (content-word overlap), rights and quality flags, target coherence (targets pass the clean-English
 * gate), symbolic_english rows whose analysis passed the gate (identical default/accurate trees on every sentence and DeepSeek conditions a and c good; rows without analysis or
 * with an unparsed span follow the SOP rules), neuro_english failure kinds of the analysis layer, the `sop_layer` of every row, and (not with `--quick`) that the stored gate verdict
 * is what the recorded parses and judge verdicts decide now. `--quick` skips the clean-English gate on targets and that recomputation. Exit code 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import {readJsonlShardedSync, hashJsonlSharded, jsonlBytes, jsonlExists} from '../../lib/jsonl-shards.mjs';
import {ROOT, THREE_DATASETS} from '../../lib/dataset-paths.mjs';
import {classifyMessage} from './three-datasets/sources.mjs';
import {normalText} from './three-datasets/inputs.mjs';
import {run as contentWordOverlap} from './audit/content-word-overlap.mjs';
import {run as naturalOverlap} from './audit/natural-overlap.mjs';
import {AnalysisGate, isGood, ANALYSIS_FAILURE_KINDS, ROW_FAILURE_KINDS} from './three-datasets/analysis-gate.mjs';
import {specialKind} from './three-datasets/assemble.mjs';

const args = process.argv.slice(2);
const only = args.includes('--dataset') ? args[args.indexOf('--dataset') + 1] : null;
const quick = args.includes('--quick');
const failures = [];
const fail = message => { if (failures.length < 60) failures.push(message); failures.count = (failures.count ?? 0) + 1; };

// The legacy out-of-distribution and wild suites are re-split across train, dev and test by group (owner decision 2026-09-30): no corpus is sealed-only any more.
const SEALED_ONLY = new Set();
// `composed` (tools/datasets/composed-train.mjs), `form-variant` (tools/datasets/form-variants.mjs) and `production` (tools/datasets/add-case.mjs merge) are generated or reviewed working data.
const TRAIN_DEV_CORPORA = new Set(['formalizer-v1', 'formalizer-ood-v1', 'formalizer-wild-v1', 'proofing-diverse-dev', 'new_cases', 'composed', 'form-variant', 'production']);
const LANGUAGE_KINDS = new Set(['ro', 'mixed', 'noisy_en']);
const FAILURE_KINDS = new Set(ROW_FAILURE_KINDS);
// Analysis-layer membership (owner direction 2026-09-30 night, DS008 "Three datasets"). symbolic_english `analysis_verified`: `analysis_gate` (every sentence has
// identical default/accurate trees and DeepSeek conditions a and c good) or `sop_rule` (no analysed sentence or an unparsed span: the SOP rules decide); `gold_sop_match` is the retired
// name that production rows still carry. neuro_english: `analysis_gate_failed`, `analysis_pending_judge` (no verdict yet; never in a finished build) or `sop_rule_failed`.
const VERIFIED = new Set(['analysis_gate', 'sop_rule', 'gold_sop_match']);
const SOP_STATUS = new Set(['match', 'mismatch', 'no_gold']);
const GOOD = new Set(['CORRECT', 'MINOR', 'INPUT_TYPO']);
const AGREEMENT = new Set(['identical', 'noncore_diff', 'core_diff', 'not_measured']); // not_measured: composed, form-variant and production rows (no second Stanza package was run on them)
const COMMON = ['id', 'dataset', 'split', 'split_group_id', 'message', 'source', 'rights', 'quality_flags', 'review_status'];
const REQUIRED = {
  bad_english: [...COMMON, 'language', 'language_kind', 'noise_categories', 'targets', 'gate_reasons'],
  symbolic_english: [...COMMON, 'analysis', 'sop', 'sop_valid', 'outcome', 'unparsed', 'analysis_verified', 'verification', 'symbolic_lm'],
  neuro_english: [...COMMON, 'analysis', 'sop', 'failure_kind', 'failure', 'rewrite_target', 'targets', 'verification', 'symbolic_lm'],
};
const splitPath = (dataset, split) => (split === 'test' ? path.join(ROOT, 'eval', 'suites', dataset, 'test.jsonl') : path.join(ROOT, 'datasets', dataset, `${split}.jsonl`));

let gate = null;
const loaded = {};
const groupSplits = new Map(), textSplits = new Map();
for (const dataset of only ? [only] : THREE_DATASETS) {
  const manifestFile = path.join(ROOT, 'datasets', dataset, 'manifest.json');
  if (!fs.existsSync(manifestFile)) { fail(`${dataset}: missing manifest.json`); continue; }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (manifest.format !== 'chatsop-dataset-manifest-v3') fail(`${dataset}: manifest format ${manifest.format}`);
  if (manifest.training_authorized !== false) fail(`${dataset}: manifest must record training_authorized false`);
  const ids = new Set();
  loaded[dataset] = {};
  for (const split of ['train', 'dev', 'test']) {
    const file = splitPath(dataset, split);
    if (!jsonlExists(file)) { fail(`${dataset}/${split}: file missing`); continue; }
    const relative = path.relative(ROOT, file).split(path.sep).join('/');
    const sha = await hashJsonlSharded(file);
    if (manifest.sha256?.[relative] !== sha) fail(`${relative}: sha256 differs from datasets/${dataset}/manifest.json`);
    if (manifest.bytes?.[relative] !== jsonlBytes(file)) fail(`${relative}: byte count differs from the manifest`);
    const rows = readJsonlShardedSync(file);
    loaded[dataset][split] = rows;
    if (manifest.counts?.[split]?.rows !== rows.length) fail(`${relative}: ${rows.length} rows, manifest says ${manifest.counts?.[split]?.rows}`);
    for (const row of rows) {
      for (const key of REQUIRED[dataset]) if (row[key] === undefined) fail(`${row.id}: missing ${key}`);
      if (ids.has(row.id)) fail(`${row.id}: duplicate id in ${dataset}`);
      ids.add(row.id);
      if (row.dataset !== dataset) fail(`${row.id}: dataset field ${row.dataset}`);
      if (row.split !== split) fail(`${row.id}: split ${row.split} in the ${split} file`);
      if (typeof row.message !== 'string' || !row.message.trim()) fail(`${row.id}: empty message`);
      if (row.rights?.text_copied !== false || !row.rights?.license) fail(`${row.id}: rights do not declare original text and a licence`);
      if (row.quality_flags?.training_approved !== false) fail(`${row.id}: training_approved must be false`);
      if (split === 'test' && row.source?.split !== 'test') fail(`${row.id}: sealed test row with source split ${row.source?.split}`);
      if (split !== 'test' && (SEALED_ONLY.has(row.source?.corpus) || row.source?.split === 'test' || !TRAIN_DEV_CORPORA.has(row.source?.corpus))) fail(`${row.id}: ${row.source?.corpus} rows may only be in the sealed test`);
      const groups = groupSplits.get(row.split_group_id) ?? new Set(); groups.add(split); groupSplits.set(row.split_group_id, groups);
      const key = normalText(row.message);
      const texts = textSplits.get(key) ?? new Set(); texts.add(split === 'test' ? 'test' : 'trainDev'); textSplits.set(key, texts);
    }
  }
  const all = Object.values(loaded[dataset]).flat();
  if (dataset === 'bad_english') for (const row of all) {
    if (!LANGUAGE_KINDS.has(row.language_kind)) fail(`${row.id}: language_kind ${row.language_kind}`);
    if (row.target !== (row.targets[0]?.text ?? null)) fail(`${row.id}: target is not the first of targets`);
    const messageIsTarget = row.targets?.[0]?.check?.message_is_target === true; // owner direction 2026-09-30: a mixed row DeepSeek found already clean English keeps its message as target (llm-targets.mjs)
    if (row.target === row.message && !messageIsTarget) fail(`${row.id}: target equals the message`);
    if (!row.target && !row.flags?.includes('no_target')) fail(`${row.id}: no target and no no_target flag`);
    if (!quick) for (const t of row.targets) if (!t.check?.message_is_target && classifyMessage(t.text).partition !== 'clean_en') fail(`${row.id}: target is not clean English: ${t.text.slice(0, 60)}`);
  }
  if (dataset === 'symbolic_english') for (const row of all) {
    if (!VERIFIED.has(row.analysis_verified)) fail(`${row.id}: analysis_verified ${row.analysis_verified}`);
    const retired = row.analysis_verified === 'gold_sop_match'; // production rows of tools/datasets/add-case.mjs
    if (!retired && row.source?.corpus === 'production') fail(`${row.id}: production row with analysis_verified ${row.analysis_verified}`);
    if (retired && row.source?.corpus !== 'production') fail(`${row.id}: retired analysis_verified gold_sop_match outside production rows`);
    // A greeting or thanks is answered before parsing (`no_request`), so its analysis has no sentences by design.
    if (!retired && !row.analysis?.sentences?.length && row.analysis_verified !== 'sop_rule') fail(`${row.id}: no grammatical analysis`);
    if (!('sop_gold_match' in row.verification) || !('judge' in row.verification) || !('stanza_spacy_agree' in row.verification)) fail(`${row.id}: verification object incomplete`);
    if (!AGREEMENT.has(row.verification.stanza_default_accurate)) fail(`${row.id}: verification.stanza_default_accurate ${row.verification.stanza_default_accurate}`);
    if (!retired) {
      if (!SOP_STATUS.has(row.sop_layer?.status)) fail(`${row.id}: sop_layer.status ${row.sop_layer?.status}`);
      else {
        if ((row.sop_layer.status === 'match') !== (row.verification.sop_gold_match === true) || (row.sop_layer.status === 'no_gold') !== (row.verification.sop_gold_match === null)) fail(`${row.id}: sop_layer.status ${row.sop_layer.status} disagrees with verification.sop_gold_match ${row.verification.sop_gold_match}`);
        if (row.sop_layer.status === 'match' && typeof row.gold_sop !== 'string') fail(`${row.id}: sop_layer match without a gold SOP`);
        if (row.sop_layer.status === 'no_gold' && row.gold_sop !== null) fail(`${row.id}: sop_layer no_gold but a gold SOP is stored`);
      }
      const v = row.analysis_verdict;
      if (row.analysis_verified === 'analysis_gate') {
        const n = row.analysis?.sentences?.length ?? 0;
        if (v?.state !== 'pass' || v.sentences?.length !== n || !n || v.reasons?.length || v.sentences.some(x => x.tree !== 'identical' || !isGood(x.a) || !isGood(x.c))) fail(`${row.id}: analysis_gate row without identical trees and good DeepSeek conditions a and c on every sentence`);
        if (v.placed_by !== 'analysis_gate') fail(`${row.id}: analysis_gate row placed by ${v.placed_by}`);
        if (row.verification.stanza_default_accurate !== 'identical') fail(`${row.id}: analysis_gate row with stanza_default_accurate ${row.verification.stanza_default_accurate}`);
      }
      if (row.analysis_verified === 'sop_rule') {
        const special = specialKind({analysis: row.analysis, unparsed: row.unparsed ?? []});
        // no analysed sentence: the gate is not applicable; an unparsed span: the SOP rules place the row (policy `sop_rules`, Q-DATA-3) and the gate result is information
        if (!special || v?.placed_by !== 'sop_rule' || v.reason !== special || (special === 'no_analysis') !== (v.state === 'not_applicable')) fail(`${row.id}: sop_rule row without its SOP-rule placement record`);
        if (!(row.sop_layer.status === 'match' || (row.sop_layer.status === 'no_gold' && row.sop_layer.handled))) fail(`${row.id}: sop_rule row whose SOP rule did not pass`);
      }
    }
    if (row.analysis_suspect !== undefined && typeof row.analysis_suspect !== 'boolean') fail(`${row.id}: analysis_suspect must be a boolean`);
  }
  if (dataset === 'neuro_english') for (const row of all) {
    if (!FAILURE_KINDS.has(row.failure_kind)) fail(`${row.id}: failure_kind ${row.failure_kind}`);
    if (row.target !== (row.targets[0]?.text ?? null)) fail(`${row.id}: target is not the first of targets`);
    if (!row.target && !row.flags?.length) fail(`${row.id}: no target and no flag`);
    if (row.target && row.target === row.message) fail(`${row.id}: target equals the message`);
    if (!SOP_STATUS.has(row.sop_layer?.status)) fail(`${row.id}: sop_layer.status ${row.sop_layer?.status}`);
    else if ((row.sop_layer.status === 'match') !== (row.verification.sop_gold_match === true)) fail(`${row.id}: sop_layer.status ${row.sop_layer.status} disagrees with verification.sop_gold_match ${row.verification.sop_gold_match}`);
    const v = row.analysis_verdict;
    if (row.analysis_verified === 'analysis_gate_failed') {
      const priority = ANALYSIS_FAILURE_KINDS.find(kind => v?.reasons?.some(x => x.kind === kind));
      if (v?.state !== 'fail' || !priority || row.failure_kind !== priority) fail(`${row.id}: analysis_gate_failed row whose failure_kind ${row.failure_kind} is not the first reason of its verdict (${priority})`);
    } else if (row.analysis_verified === 'analysis_pending_judge') {
      if (!row.flags?.includes('pending_judge') || row.failure_kind !== 'pending_judge') fail(`${row.id}: pending_judge row without the flag or with another failure kind`);
    } else if (row.analysis_verified === 'sop_rule_failed') {
      const special = specialKind({analysis: row.analysis, unparsed: row.unparsed ?? []});
      if (!special || row.failure_kind !== special || v?.placed_by !== 'sop_rule' || v.reason !== special || (special === 'no_analysis') !== (v.state === 'not_applicable')) fail(`${row.id}: sop_rule_failed row whose failure_kind ${row.failure_kind} is not ${special} or without its SOP-rule placement record`);
    } else fail(`${row.id}: neuro analysis_verified ${row.analysis_verified}`);
    if (row.failure?.layer !== 'analysis' && !row.composed) fail(`${row.id}: failure.layer ${row.failure?.layer}`);
  }
  // The stored gate verdict is what the recorded parses and judge verdicts decide now (a verdict file is append-only; a changed decision means a rebuild is due).
  if (!quick && dataset !== 'bad_english') { gate ??= new AnalysisGate(); for (const row of all) {
    if (row.analysis_verified === 'gold_sop_match' || row.analysis_verdict?.placed_by === 'sop_rule') continue;
    const d = gate.compute(row.message, row.analysis);
    const expected = dataset === 'symbolic_english' ? 'pass' : row.analysis_verified === 'analysis_pending_judge' ? 'pending' : 'fail';
    if (d.state !== expected) fail(`${row.id}: stored as ${dataset} (${row.analysis_verified}) but the gate now says ${d.state}; rebuild the datasets`);
  } }
}
if (!only) {
  for (const [group, splits] of groupSplits) if (splits.size > 1) fail(`split group ${group} crosses splits ${[...splits].join(', ')}`);
  for (const [text, splits] of textSplits) if (splits.size > 1) fail(`message text in the sealed test and in train/dev: ${text.slice(0, 70)}`);
}
// Content-word overlap (DS008 "Content-word overlap"): the fail-closed part is a normalized duplicate of a train/dev message and an
// identical content-word signature with an identical form (a lexical duplicate); the rest of the report is information.
if (Object.keys(loaded).length) for (const message of contentWordOverlap({datasets: Object.keys(loaded)}).failures) fail(`content-word overlap: ${message} (node tools/datasets/audit/content-word-overlap.mjs lists examples)`);
// Owner messages of datasets/natural (2026-10-01): a derived row may reuse a form, never the words (exact, normalized and lexical duplicates fail closed).
if (Object.keys(loaded).length) for (const message of naturalOverlap({datasets: Object.keys(loaded), loadRows: (d, split) => loaded[d]?.[split] ?? []}).failures) fail(`natural overlap: ${message} (node tools/datasets/audit/natural-overlap.mjs lists examples)`);
const report = {datasets: only ? [only] : THREE_DATASETS, rows: Object.fromEntries(Object.entries(loaded).map(([d, s]) => [d, Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.length]))])), failures: failures.count ?? 0, examples: failures};
console.log(JSON.stringify(report, null, 1));
// A full run leaves its verdict for the /experiments gates (server/project.mjs).
if (!only && !quick) {
  const dir = path.join(ROOT, 'eval/reports/current/three-datasets');
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'verification.json'), JSON.stringify({generated: new Date().toISOString(), verdict: failures.count ? 'fail' : 'pass', ...report}, null, 1) + '\n');
}
if (failures.count) process.exitCode = 1;
