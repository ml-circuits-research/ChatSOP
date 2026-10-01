#!/usr/bin/env node
/** Dataset qualification record and authorization receipt for LanguageProofingLLM (bad_english/proofing, frozen role id `proofreader`).
 * Sibling of tools/research/qualify-neuro-proofing.mjs: same record schema (training/cli.mjs `qualificationSchema`, role `proofreader`), every check
 * recomputed from the files on disk, written only when every check holds (fail closed; the blockers are printed otherwise).
 *
 *   node tools/research/qualify-language-proofing.mjs [--reviewer-id ID]
 *   node tools/research/qualify-language-proofing.mjs --authorize gemma --run RUN --decision-ts TS   # transcribe an owner decision
 *
 * Checks:
 *   oracle_grounding      every pair is reproduced by tools/datasets/language-proofing/pairs.mjs from its source row (repair: a sentence of a bad_english row's
 *                         target, identity: a clean unchanged sentence of a bad_english row or a symbolic_english message); evidence grounding.json
 *   meaning_preservation  the mechanical meaning checks (names, numbers, quoted spans, negation, question marks, length ratio) hold for every repair pair; DeepSeek-written
 *                         targets are review_status pending and are not meaning-judged (recorded in meaning.json with the state of the meaning-judge calibration)
 *   leakage               no folded exact match of a train/dev prompt or target with a sealed text, sentence or identity message (integrity.json)
 *   split_integrity       an id is in one split only; no train prompt equals a dev prompt (integrity.json)
 *   source_rights         DS014 records DeepSeek-written text
 *   token_budget          no pair above 2048 tokens with the Gemma 3 tokenizer (token-audit.json)
 * The record is not a training authorization (AGENTS.md rule 3).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readJournal} from '../../lib/journal.mjs';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {projectRow, pairProblems, hashText, norm} from '../datasets/language-proofing/pairs.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rel = file => path.relative(root, file).split(path.sep).join('/');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const readJsonl = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const WORK = path.join(root, 'eval/reports/current/language-proofing-it1');
const DATA = path.join(root, 'datasets/bad_english/proofing');

export function qualify({reviewerId = 'language-proofing-training-agent (automated qualification)'} = {}) {
  const blockers = [];
  const manifestPath = path.join(DATA, 'manifest.json'), versionPath = path.join(DATA, 'VERSION');
  const manifest = readJson(manifestPath);
  const audit = readJsonl(path.join(DATA, 'audit.jsonl')), auditById = new Map(audit.map(a => [a.id, a]));
  const flat = ['train', 'dev'].flatMap(split => readJsonl(path.join(DATA, `${split}.jsonl`)).map(row => ({...row, split})));
  // oracle_grounding: re-project the source rows and find each pair
  const source = new Map();
  for (const split of ['train', 'dev']) for (const row of readJsonlShardedSync(path.join(root, 'datasets/bad_english', `${split}.jsonl`))) source.set(row.id, {row, split, name: 'bad_english'});
  // identity pairs: the snapshot of clean symbolic_english messages copied at build time (symbolic_english may be re-split later); its hash is in the manifest
  const snapshotFile = path.join(DATA, 'identity-source.jsonl');
  if (sha(snapshotFile) !== manifest.symbolic_english_at_build?.identity_source_sha256) blockers.push('identity-source.jsonl changed after the projection was built');
  for (const row of readJsonl(snapshotFile)) source.set(row.id, {row: {message: row.message}, split: row.split, name: 'symbolic_english'});
  const projected = new Map();
  let ungrounded = 0, wrongSplit = 0;
  for (const row of flat) {
    const a = auditById.get(row.id);
    if (!a) { ungrounded++; continue; }
    const src = source.get(a.row_id);
    if (!src) { ungrounded++; continue; }
    if (src.split !== row.split) wrongSplit++;
    if (src.name === 'symbolic_english') { if (row.kind !== 'identity' || norm(row.prompt) !== norm(row.target) || norm(src.row.message) !== norm(row.prompt)) ungrounded++; continue; }
    if (!projected.has(a.row_id)) projected.set(a.row_id, new Map(projectRow(src.row).pairs.map(p => [p.id, p])));
    const p = projected.get(a.row_id).get(row.id);
    if (!p || p.prompt !== row.prompt || p.target !== row.target) ungrounded++;
  }
  if (ungrounded) blockers.push(`${ungrounded} pairs are not reproduced from a source row`);
  if (wrongSplit) blockers.push(`${wrongSplit} pairs changed the split of their source row`);
  // meaning_preservation
  let mechanicalFailures = 0;
  for (const row of flat) if (row.kind === 'repair' && pairProblems(row.prompt, row.target).length) mechanicalFailures++;
  if (mechanicalFailures) blockers.push(`${mechanicalFailures} repair pairs fail the mechanical meaning checks`);
  const judge = path.join(root, 'eval/reports/current/neuro-oracle/meaning-calibration.json');
  const calibration = fs.existsSync(judge) ? readJson(judge) : null;
  const bySource = {};
  for (const a of audit) bySource[a.target_source] = (bySource[a.target_source] ?? 0) + 1;
  const meaning = {generated_at: new Date().toISOString(), repair_pairs: flat.filter(r => r.kind === 'repair').length, mechanical_failures: mechanicalFailures, pairs_by_target_source: bySource,
    llm_targets: 'llm:deepseek-flash targets are review_status pending; meaning checked mechanically only (names, numbers, quoted spans, negation, question marks, length ratio), not by the DeepSeek meaning judge',
    meaning_judge_calibration: calibration ? {file: rel(judge), trusted: calibration.trusted ?? null, precision_main: calibration.precision_main ?? null} : null};
  fs.writeFileSync(path.join(WORK, 'meaning.json'), JSON.stringify(meaning, null, 1) + '\n');
  fs.writeFileSync(path.join(WORK, 'grounding.json'), JSON.stringify({generated_at: meaning.generated_at, pairs: flat.length, ungrounded, wrong_split: wrongSplit, source_rows: projected.size}, null, 1) + '\n');
  // leakage and split integrity
  const integrity = readJson(path.join(WORK, 'integrity.json'));
  if (Object.values(integrity.exact_matches).some(n => n !== 0)) blockers.push('integrity.json reports an exact match with a sealed text');
  if (integrity.ids_in_two_splits || integrity.train_prompts_also_in_dev) blockers.push('integrity.json reports a split violation');
  // source rights
  const rights = fs.readFileSync(path.join(root, 'docs/specs/DS014-source-rights.md'), 'utf8');
  if (!/deepseek/i.test(rights)) blockers.push('DS014-source-rights.md does not mention DeepSeek-written text');
  // token budget
  const tokens = readJson(path.join(WORK, 'token-audit.json'));
  if (tokens.over_2048 !== 0) blockers.push(`${tokens.over_2048} pairs above 2048 tokens`);
  // file hashes are the manifest's
  for (const [name, info] of Object.entries(manifest.files)) if (sha(path.join(DATA, name)) !== info.sha256) blockers.push(`${name} changed after the manifest was written`);
  for (const [file, hash] of Object.entries(manifest.source_sha256)) if (sha(path.join(root, file)) !== hash) blockers.push(`source ${file} changed after the projection was built`);
  if (sha(path.join(WORK, 'sealed-hashes.json')) !== manifest.sealed_hashes_sha256) blockers.push('sealed-hashes.json changed after the projection was built');
  if (blockers.length) return {status: 'blocked', blockers};

  const ev = file => ({path: rel(file), sha256: sha(file)});
  const record = {
    format: 'chatsop-dataset-qualification-v1', status: 'qualified', corpus: 'bad_english/proofing', role: 'proofreader',
    grade: 'experiment-grade: sentence pairs reproduced from their source rows, mechanical meaning checks (names, numbers, quotes, negation, question marks, length ratio) and sentence-level leakage checks against the sealed hashes; DeepSeek-written targets are unreviewed (pending), no human semantic review',
    dataset_manifest_sha256: sha(manifestPath), dataset_version_sha256: sha(versionPath), dataset_version: readJson(versionPath),
    dataset_files: {'proofreader/train.jsonl': sha(path.join(DATA, 'proofreader/train.jsonl')), 'proofreader/dev.jsonl': sha(path.join(DATA, 'proofreader/dev.jsonl'))},
    sealed_suites: {'bad_english/proofing-test': sha(path.join(root, 'eval/suites/bad_english/proofing-test.jsonl'))},
    contract_files: {},
    checks: Object.fromEntries(['oracle_grounding', 'meaning_preservation', 'leakage', 'split_integrity', 'source_rights', 'token_budget'].map(name => [name, true])),
    evidence: {oracle_grounding: ev(path.join(WORK, 'grounding.json')), meaning_preservation: ev(path.join(WORK, 'meaning.json')), leakage: ev(path.join(WORK, 'integrity.json')),
      split_integrity: ev(path.join(WORK, 'integrity.json')), source_rights: ev(path.join(root, 'docs/specs/DS014-source-rights.md')), token_budget: ev(path.join(WORK, 'token-audit.json'))},
    reviewer: {kind: 'principal_integrator', id: reviewerId, reviewed_at: new Date().toISOString()},
    blockers: [],
    note: 'Data qualification only; not a chatsop-training-authorization-v1 receipt (AGENTS.md rule 3).',
  };
  const out = path.join(root, 'status/training/qualification-language-proofing.json');
  fs.writeFileSync(out, JSON.stringify(record, null, 1) + '\n');
  return {status: 'qualified', qualification: rel(out), sha256: sha(out)};
}

/** One chatsop-training-authorization-v1 receipt transcribing an owner decision that already exists in the journal (fails when no matching decision event or scope file exists). */
export function authorize({model, run, decisionTs, scopeFile = 'status/training/owner-approval-language-proofing-it1.json'}) {
  const qualificationPath = path.join(root, 'status/training/qualification-language-proofing.json');
  const qualification = readJson(qualificationPath);
  if (qualification.status !== 'qualified') throw Error('The dataset qualification record is not qualified');
  const decision = readJournal().find(event => event.ts === decisionTs && event.area === 'training' && event.state === 'decision');
  if (!decision) throw Error(`No training decision event at ${decisionTs} in status/journal.jsonl`);
  const scope = readJson(path.join(root, scopeFile));
  if (scope.journal_event.ts !== decision.ts) throw Error('The approval scope does not match this decision');
  if (!scope.approved_models.includes(model)) throw Error(`${model} is outside the owner's approved models for this experiment`);
  const receipt = {
    format: 'chatsop-training-authorization-v1', authorization: 'explicit-user-approval', approved: true, approved_by: 'user',
    approved_at: decision.ts, instruction: `${decision.title}: ${decision.detail}`,
    journal_event: {file: 'status/journal.jsonl', ts: decision.ts, actor: decision.actor},
    further_decisions: scope.further_decisions ?? [],
    model, run, role: 'proofreader', qualification_sha256: sha(qualificationPath),
    recipe_sha256: sha(path.join(root, 'config', `train-${model}.json`)),
    dataset_manifest_sha256: qualification.dataset_manifest_sha256, dataset_version_sha256: qualification.dataset_version_sha256,
    transcribed_by: process.env.CHATSOP_ACTOR || 'language-proofing-training-agent', transcribed_at: new Date().toISOString(),
  };
  const out = path.join(root, 'status/training', `authorization-${model}-${run}.json`);
  fs.writeFileSync(out, JSON.stringify(receipt, null, 1) + '\n');
  return {authorization: rel(out), sha256: sha(out)};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  try {
    if (arg('--authorize')) console.log(JSON.stringify(authorize({model: arg('--authorize'), run: arg('--run'), decisionTs: arg('--decision-ts')}), null, 1));
    else { const r = qualify({reviewerId: arg('--reviewer-id')}); console.log(JSON.stringify(r, null, 1)); if (r.status !== 'qualified') process.exitCode = 2; }
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
