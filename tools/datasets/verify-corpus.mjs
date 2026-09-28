#!/usr/bin/env node
/** Verify a model-language corpus (DS022) against its manifest and its verification worlds.
 *
 *   node tools/datasets/verify-corpus.mjs --corpus formalizer-v1 [--sample 400] [--all] [--engine scan|holo-memory|recall-memory|sqlite|hybrid]
 *   node tools/datasets/verify-corpus.mjs --suite formalizer-ood-v1 [--sample 400]
 *
 * Fail-closed checks: every split file matches the manifest's sha256; every row has the required fields, a
 * model-language target (checkModelProgram), the message as its only model input and rights provenance; connected
 * groups stay in one split; and each checked row's target, executed with model origin against the row's own
 * verification world (ontology_sop, setup_sop, late_setup_sop), reproduces the stored `expected` status and
 * answers. `--sample N` executes a stratified sample (per family and split), `--all` executes every row.
 * Exit 0 pass, 1 a check failed, 2 the run could not start. No model, no GPU.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from '../../sop/parser.mjs';
import {checkModelProgram} from '../../sop/declarative.mjs';
import {executeTarget} from './diversity/execute.mjs';
import {hash32} from './diversity/text.mjs';
import {readJsonlShardedSync, hashJsonlSharded} from '../../lib/jsonl-shards.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const value = (name, fallback = null) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const corpus = value('corpus'), suite = value('suite');
const sample = Number(value('sample', 400)), all = args.includes('--all'), engine = value('engine', 'scan');
if (!corpus && !suite) { console.error('usage: verify-corpus.mjs --corpus NAME | --suite NAME [--sample N] [--all]'); process.exit(2); }
const readText = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const manifestPath = corpus ? `datasets/${corpus}/manifest.json` : `eval/suites/${suite}/manifest.json`;
if (!fs.existsSync(path.join(root, manifestPath))) { console.error(`missing ${manifestPath}`); process.exit(2); }
const manifest = JSON.parse(readText(manifestPath));
const failures = [];
const fail = message => { if (failures.length < 50) failures.push(message); failures.count = (failures.count ?? 0) + 1; };

const rows = [];
for (const [split, relative] of Object.entries(manifest.splits)) {
  // A split may be stored as one file or as shards (lib/jsonl-shards.mjs); the hash covers the logical file.
  const file = path.join(root, relative);
  if (manifest.sha256?.[relative] && await hashJsonlSharded(file) !== manifest.sha256[relative]) fail(`${relative}: sha256 differs from the manifest (rebuild with tools/datasets/build-corpora.mjs, never hand-edit rows)`);
  for (const row of readJsonlShardedSync(file)) { if (row.split !== split) fail(`${row.id}: row of split ${row.split} in the ${split} file`); rows.push(row); }
}
const REQUIRED = ['id', 'question', 'language', 'split', 'split_group_id', 'semantic_case_id', 'family', 'question_type', 'sop_target', 'expected', 'rights', 'quality_flags'];
const ids = new Set(), groups = new Map();
for (const row of rows) {
  for (const key of REQUIRED) if (row[key] === undefined || row[key] === null) fail(`${row.id}: missing ${key}`);
  if (ids.has(row.id)) fail(`${row.id}: duplicate id`);
  ids.add(row.id);
  if (row.model_input !== undefined && row.model_input !== row.question) fail(`${row.id}: model_input differs from the message`);
  if (row.context !== undefined) fail(`${row.id}: the evaluation-only scaffolding is named verification_context, not context (DS022 row fields)`);
  if (row.verification_context && row.verification_context.model_visible !== false) fail(`${row.id}: verification_context is not marked model_visible false`);
  if (row.rights?.text_copied !== false || row.quality_flags?.source_rows_copied !== false) fail(`${row.id}: rights/provenance do not declare that no text was copied`);
  try { checkModelProgram(parse(row.sop_target)); } catch (error) { fail(`${row.id}: target is not model language (${error.message})`); }
  if (!groups.has(row.split_group_id)) groups.set(row.split_group_id, new Set());
  groups.get(row.split_group_id).add(row.split);
}
for (const [group, splits] of groups) if (splits.size > 1) fail(`group ${group} crosses splits ${[...splits].join(', ')}`);

// Execution against the verification worlds: every row, or a stratified sample per family and split.
const executable = rows.filter(row => row.execution?.executed);
let chosen = executable;
if (!all) {
  const strata = new Map();
  for (const row of executable) { const key = `${row.family}|${row.split}`; if (!strata.has(key)) strata.set(key, []); strata.get(key).push(row); }
  const perStratum = Math.max(1, Math.ceil(sample / Math.max(1, strata.size)));
  chosen = [...strata.values()].flatMap(list => list.sort((a, b) => hash32(a.id) - hash32(b.id)).slice(0, perStratum));
}
// The target runs exactly as written: the host normalizes times and resolves filter literals (DS021).
const targetOf = row => row.sop_target;
let agree = 0;
for (const row of chosen) {
  const result = await executeTarget(row, targetOf(row), {engine});
  const answers = JSON.stringify([...(result.answers ?? [])].map(a => JSON.stringify(a)).sort());
  const expected = JSON.stringify([...(row.expected.answers ?? [])].map(a => JSON.stringify(a)).sort());
  if (result.status !== row.expected.status || answers !== expected) fail(`${row.id}: executes to ${result.status} ${answers}, expected ${row.expected.status} ${expected}${result.error ? ' (' + result.error + ')' : ''}`);
  else agree++;
}

const report = {corpus: corpus ?? suite, engine, rows: rows.length, executed: chosen.length, agreeing: agree, failures: failures.count ?? 0, examples: failures};
console.log(JSON.stringify(report, null, 1));
process.exit(failures.length ? 1 : 0);
