#!/usr/bin/env node
/** Fail-closed verification of the three datasets (bad_english, symbolic_english, neuro_english; DS008 "Three datasets").
 *
 *   node tools/datasets/verify-three-datasets.mjs [--dataset NAME] [--quick]
 *
 * A validator (like tools/datasets/validate.mjs) it may open the sealed test files. Checks: manifest format, sha256 and
 * byte counts of every split file, row counts, row schema per dataset, unique ids, split fields, split groups disjoint
 * across splits and across the three datasets, sealed-suite rows only in the sealed test, no normalized message text in
 * a test file and in a train or dev file, no lexical duplicate of a train/dev row in the test (content-word overlap), rights and quality flags, target coherence (targets pass the clean-English
 * gate), symbolic_english rows verified by a gold SOP match, by identical default/accurate trees or by both judge conditions, neuro_english failure kinds. `--quick` skips the
 * clean-English gate on targets. Exit code 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import {readJsonlShardedSync, hashJsonlSharded, jsonlBytes, jsonlExists} from '../../lib/jsonl-shards.mjs';
import {ROOT, THREE_DATASETS} from '../../lib/dataset-paths.mjs';
import {classifyMessage} from './three-datasets/sources.mjs';
import {normalText} from './three-datasets/inputs.mjs';
import {run as contentWordOverlap} from './audit/content-word-overlap.mjs';

const args = process.argv.slice(2);
const only = args.includes('--dataset') ? args[args.indexOf('--dataset') + 1] : null;
const quick = args.includes('--quick');
const failures = [];
const fail = message => { if (failures.length < 60) failures.push(message); failures.count = (failures.count ?? 0) + 1; };

const SEALED_ONLY = new Set(['formalizer-ood-v1', 'formalizer-wild-v1']);
// `composed` (tools/datasets/composed-train.mjs), `form-variant` (tools/datasets/form-variants.mjs) and `production` (tools/datasets/add-case.mjs merge) are generated or reviewed working data.
const TRAIN_DEV_CORPORA = new Set(['formalizer-v1', 'proofing-diverse-dev', 'new_cases', 'composed', 'form-variant', 'production']);
const LANGUAGE_KINDS = new Set(['ro', 'mixed', 'noisy_en']);
const FAILURE_KINDS = new Set(['parser', 'rules', 'gold_convention', 'unknown']);
// gold_sop_match: SOP equals the gold. parsers_agree: no gold, default and accurate trees identical. judge_bc: no gold, trees differ and
// Haiku conditions b AND c accept every differing sentence. There is no pending state: a row without evidence is not in symbolic_english.
// parsers_agree_c: no gold, identical trees on every sentence and an accepting condition-c verdict on each (the tightened gate, deviation D3 of eval-symbolic-gate-v1).
// accurate_judge_bc: no gold, the analysis is the current (accurate-package) tree; every sentence has an accepting condition-c verdict
// and a sentence whose tree differs from the default package's has an accepting condition-b verdict as well (experiment eval-symbolic-accurate-adopt-v1).
const VERIFIED = new Set(['gold_sop_match', 'parsers_agree', 'judge_bc', 'parsers_agree_c', 'accurate_judge_bc']);
const GOOD = new Set(['CORRECT', 'MINOR', 'INPUT_TYPO']);
const AGREEMENT = new Set(['identical', 'noncore_diff', 'core_diff', 'not_measured']); // not_measured: composed, form-variant and production rows (no second Stanza package was run on them)
const COMMON = ['id', 'dataset', 'split', 'split_group_id', 'message', 'source', 'rights', 'quality_flags', 'review_status'];
const REQUIRED = {
  bad_english: [...COMMON, 'language', 'language_kind', 'noise_categories', 'targets', 'gate_reasons'],
  symbolic_english: [...COMMON, 'analysis', 'sop', 'sop_valid', 'outcome', 'unparsed', 'analysis_verified', 'verification', 'symbolic_lm'],
  neuro_english: [...COMMON, 'analysis', 'sop', 'failure_kind', 'failure', 'rewrite_target', 'targets', 'verification', 'symbolic_lm'],
};
const splitPath = (dataset, split) => (split === 'test' ? path.join(ROOT, 'eval', 'suites', dataset, 'test.jsonl') : path.join(ROOT, 'datasets', dataset, `${split}.jsonl`));

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
    if (row.target === row.message) fail(`${row.id}: target equals the message`);
    if (!row.target && !row.flags?.includes('no_target')) fail(`${row.id}: no target and no no_target flag`);
    if (!quick) for (const t of row.targets) if (classifyMessage(t.text).partition !== 'clean_en') fail(`${row.id}: target is not clean English: ${t.text.slice(0, 60)}`);
  }
  if (dataset === 'symbolic_english') for (const row of all) {
    if (!VERIFIED.has(row.analysis_verified)) fail(`${row.id}: analysis_verified ${row.analysis_verified}`);
    // A greeting or thanks is answered before parsing (`no_request`), so its analysis has no sentences by design.
    if (!row.analysis?.sentences?.length && !['no_request', 'gibberish'].includes(row.outcome)) fail(`${row.id}: no grammatical analysis`);
    if (!row.sop_valid || row.outcome === 'crash') fail(`${row.id}: symbolic row with invalid SOP`);
    if (!('sop_gold_match' in row.verification) || !('judge' in row.verification) || !('stanza_spacy_agree' in row.verification)) fail(`${row.id}: verification object incomplete`);
    if (row.analysis_verified === 'gold_sop_match' && (row.verification.sop_gold_match !== true || typeof row.gold_sop !== 'string')) fail(`${row.id}: gold_sop_match without a gold SOP match`);
    if (!AGREEMENT.has(row.verification.stanza_default_accurate)) fail(`${row.id}: verification.stanza_default_accurate ${row.verification.stanza_default_accurate}`);
    if (row.analysis_verified === 'parsers_agree' && (row.unparsed.length || row.verification.stanza_default_accurate !== 'identical' || row.verification.judge !== null)) fail(`${row.id}: parsers_agree row with unparsed spans, differing trees or a judge record`);
    if (row.analysis_verified === 'parsers_agree_c') {
      const judged = row.verification.judge?.sentences;
      if (row.unparsed.length || row.verification.stanza_default_accurate !== 'identical' || (row.analysis.sentences.length && (judged?.length !== row.analysis.sentences.length || judged.some(j => j.class !== 'identical' || !GOOD.has(j.c))))) fail(`${row.id}: parsers_agree_c row without identical trees and a condition-c verdict on every sentence`);
    }
    if (row.analysis_verified === 'accurate_judge_bc') {
      const judged = row.verification.judge?.sentences;
      if (row.unparsed.length || !judged?.length || judged.length !== row.analysis.sentences.length) fail(`${row.id}: accurate_judge_bc row with unparsed spans or without a verdict per sentence`);
      else for (const j of judged) { if (!GOOD.has(j.c) || (j.class !== 'identical' && !GOOD.has(j.b))) fail(`${row.id}: accurate_judge_bc sentence ${j.sentence} without accepting verdicts`); }
      if (row.verification.stanza_default_accurate === 'identical') fail(`${row.id}: accurate_judge_bc row with identical trees (it is parsers_agree_c)`);
    }
    if (row.analysis_verified === 'judge_bc') {
      const judged = row.verification.judge?.sentences;
      if (row.unparsed.length || !judged?.length || row.verification.stanza_default_accurate === 'identical') fail(`${row.id}: judge_bc row without a judge record, with unparsed spans or with identical trees`);
      else if (judged.some(j => !GOOD.has(j.b) || !GOOD.has(j.c))) fail(`${row.id}: judge_bc row with a sentence that judges b and c did not both accept`);
    }
    if (row.analysis_verified !== 'gold_sop_match' && row.gold_sop !== null) fail(`${row.id}: a row without a gold match keeps gold_sop null`);
    if (row.analysis_suspect !== undefined && typeof row.analysis_suspect !== 'boolean') fail(`${row.id}: analysis_suspect must be a boolean`);
    if (row.analysis_suspect === true && row.analysis_verified !== 'gold_sop_match') fail(`${row.id}: analysis_suspect only on gold-matching rows`);
  }
  if (dataset === 'neuro_english') for (const row of all) {
    if (!FAILURE_KINDS.has(row.failure_kind)) fail(`${row.id}: failure_kind ${row.failure_kind}`);
    if (row.target !== (row.targets[0]?.text ?? null)) fail(`${row.id}: target is not the first of targets`);
    if (row.failure_kind === 'gold_convention' && row.rewrite_target !== false) fail(`${row.id}: a gold-convention miss is not a rewrite target`);
    if (!row.target && !row.flags?.length) fail(`${row.id}: no target and no flag`);
    if (row.target && row.target === row.message) fail(`${row.id}: target equals the message`);
    if (row.verification.sop_gold_match === true) fail(`${row.id}: neuro row that matches its gold`);
    if (row.analysis_verified === 'analysis_pending_judge' && (!row.flags?.includes('pending_judge') || row.failure_kind !== 'unknown')) fail(`${row.id}: pending_judge row without the flag or with a failure kind`);
    if (row.analysis_verified === 'analysis_rejected_by_gate' && (!['parser', 'unknown'].includes(row.failure_kind) || !row.verification.judge?.sentences?.length && row.verification.stanza_default_accurate === 'identical')) fail(`${row.id}: a row rejected by the gate needs failure_kind parser or unknown and its judge record`);
  }
}
if (!only) {
  for (const [group, splits] of groupSplits) if (splits.size > 1) fail(`split group ${group} crosses splits ${[...splits].join(', ')}`);
  for (const [text, splits] of textSplits) if (splits.size > 1) fail(`message text in the sealed test and in train/dev: ${text.slice(0, 70)}`);
}
// Content-word overlap (DS008 "Content-word overlap"): the fail-closed part is a normalized duplicate of a train/dev message and an
// identical content-word signature with an identical form (a lexical duplicate); the rest of the report is information.
if (Object.keys(loaded).length) for (const message of contentWordOverlap({datasets: Object.keys(loaded)}).failures) fail(`content-word overlap: ${message} (node tools/datasets/audit/content-word-overlap.mjs lists examples)`);
const report = {datasets: only ? [only] : THREE_DATASETS, rows: Object.fromEntries(Object.entries(loaded).map(([d, s]) => [d, Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.length]))])), failures: failures.count ?? 0, examples: failures};
console.log(JSON.stringify(report, null, 1));
if (failures.count) process.exitCode = 1;
