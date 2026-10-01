#!/usr/bin/env node
/** Dataset qualification record for the neuro_english proofing pairs (SymbolicProofingLLM, frozen role id `proofreader`).
 * Sibling of tools/research/qualify-proofing.mjs: same record schema (training/cli.mjs `qualificationSchema`, role
 * `proofreader`), but every check is recomputed from the files on disk before the record is written, and the record is
 * written only when every check holds (fail closed; no record is written on a failure, the blockers are printed).
 *
 *   node tools/research/qualify-neuro-proofing.mjs [--reviewer-id ID]
 *   node tools/research/qualify-neuro-proofing.mjs --authorize gemma --run RUN --decision-ts TS   # transcribe an owner decision
 *
 * Data directory for `node training/cli.mjs train --role proofreader --data datasets/neuro_english/proofing`:
 * `manifest.json`, `VERSION` and `proofreader/{train,dev}.jsonl` (written by tools/datasets/neuro-targets-oracle.mjs build).
 * The record is not a training authorization (AGENTS.md rule 3): no training starts without the owner's explicit approval.
 *
 * Checks:
 *   oracle_grounding      every repair pair's target is a candidate of eval/reports/current/neuro-oracle/verdicts.jsonl at a verified
 *                         level (VERIFIED_GOLD, VERIFIED_GOLD_NORMALIZED, VERIFIED_FORM) or a composed/form-variant pair of the composed tools; identity pairs are
 *                         symbolic_english rows
 *   meaning_preservation  no VERIFIED_FORM pair (meaning judged by DeepSeek) unless the calibrated meaning check reached its preregistered
 *                         precision (eval-neuro-meaning-judge-v1); gold-verified pairs (strict or normalized) are verified by the SOP; a
 *                         normalized pair also needs the judge's yes when the judge is trusted (applied when the verdicts were merged)
 *   leakage               no exact match (folded) of a train/dev prompt or target with a sealed text or sealed pair (integrity.json)
 *   split_integrity       an id is in one split only and keeps the split of its source row (integrity.json)
 *   source_rights         DS014 records the sources (DeepSeek-written text, owner decision pending)
 *   token_budget          no pair above 2048 tokens with the Gemma 3 tokenizer (token-audit.json)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readJournal} from '../../lib/journal.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rel = file => path.relative(root, file).split(path.sep).join('/');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const readJsonl = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const WORK = path.join(root, 'eval/reports/current/neuro-oracle');
const DATA = path.join(root, 'datasets/neuro_english/proofing');
const VERIFIED = new Set(['VERIFIED_GOLD', 'VERIFIED_GOLD_NORMALIZED', 'VERIFIED_FORM']);

export function qualify({reviewerId = 'neuro-oracle-agent (automated qualification)'} = {}) {
  const blockers = [];
  const manifestPath = path.join(DATA, 'manifest.json'), versionPath = path.join(DATA, 'VERSION');
  const manifest = readJson(manifestPath);
  const audit = readJsonl(path.join(DATA, 'audit.jsonl')), verdicts = new Map(readJsonl(path.join(WORK, 'verdicts.jsonl')).map(v => [v.cid, v]));
  const flat = ['train', 'dev'].flatMap(split => readJsonl(path.join(DATA, `${split}.jsonl`)).map(row => ({...row, split})));
  const auditById = new Map(audit.map(a => [a.id, a]));
  const calibrationFile = path.join(WORK, 'meaning-calibration.json');
  const calibration = fs.existsSync(calibrationFile) ? readJson(calibrationFile) : {trusted: false};
  const extraTiers = new Set(manifest.include_extra ?? []);

  // oracle_grounding
  let ungrounded = 0, formPairs = 0;
  for (const row of flat) {
    const a = auditById.get(row.id);
    if (!a) { ungrounded++; continue; }
    if (a.kind === 'identity') continue;
    if (a.verification === 'VERIFIED_COMPOSED') continue;
    const v = verdicts.get(a.candidate_id);
    const tier = v && (VERIFIED.has(v.level) ? v.level : extraTiers.has(v.extra) ? v.extra : null);
    if (!v || tier !== a.verification || !a.candidate_id) ungrounded++;
    if (a.verification === 'VERIFIED_FORM') formPairs++;
  }
  if (ungrounded) blockers.push(`${ungrounded} pairs are not grounded in a verified oracle verdict`);
  // meaning_preservation
  const extraPairs = audit.filter(a => ['VERIFIED_FORM_UNTRUSTED'].includes(a.verification)).length;
  if (formPairs && !calibration.trusted) blockers.push(`${formPairs} VERIFIED_FORM pairs but the meaning check is not trusted (precision ${calibration.precision_main ?? 'n/a'})`);
  if (extraPairs) blockers.push(`${extraPairs} pairs of an optional unverified tier (--include-extra) are in the set`);
  // leakage and split integrity
  const integrity = readJson(path.join(WORK, 'integrity.json'));
  if (Object.values(integrity.exact_matches).some(n => n !== 0)) blockers.push('integrity.json reports an exact match with a sealed text');
  if (integrity.ids_in_two_splits || integrity.ids_also_in_sealed_test_pairs || integrity.pair_split_differs_from_row_split) blockers.push('integrity.json reports a split violation');
  // source rights
  const rights = fs.readFileSync(path.join(root, 'docs/specs/DS014-source-rights.md'), 'utf8');
  if (!/deepseek/i.test(rights)) blockers.push('DS014-source-rights.md does not mention DeepSeek-written text');
  // token budget
  const tokens = readJson(path.join(WORK, 'token-audit.json'));
  if (tokens.over_2048 !== 0) blockers.push(`${tokens.over_2048} pairs above 2048 tokens`);
  // file hashes are the manifest's
  for (const [name, info] of Object.entries(manifest.files)) if (sha(path.join(DATA, name)) !== info.sha256) blockers.push(`${name} changed after the manifest was written`);
  if (manifest.sealed_test && sha(path.join(root, manifest.sealed_test.path)) !== manifest.sealed_test.sha256) blockers.push('sealed proofing-test.jsonl changed after the manifest was written');
  if (blockers.length) return {status: 'blocked', blockers};

  const ev = file => ({path: rel(file), sha256: sha(file)});
  const record = {
    format: 'chatsop-dataset-qualification-v1', status: 'qualified', corpus: 'neuro_english/proofing', role: 'proofreader',
    grade: 'experiment-grade: automated oracle grounding (SymbolicLM under the frozen rules, strict gold match, calibrated parse gate) and leakage checks, no human semantic review',
    dataset_manifest_sha256: sha(manifestPath), dataset_version_sha256: sha(versionPath), dataset_version: readJson(versionPath),
    dataset_files: {'proofreader/train.jsonl': sha(path.join(DATA, 'proofreader/train.jsonl')), 'proofreader/dev.jsonl': sha(path.join(DATA, 'proofreader/dev.jsonl'))},
    sealed_suites: {'neuro_english/proofing-test': sha(path.join(root, manifest.sealed_test.path))},
    contract_files: {},
    checks: Object.fromEntries(['oracle_grounding', 'meaning_preservation', 'leakage', 'split_integrity', 'source_rights', 'token_budget'].map(name => [name, true])),
    evidence: {
      oracle_grounding: ev(path.join(WORK, 'verdicts.jsonl')), meaning_preservation: ev(calibrationFile.replace(/$/, '')), leakage: ev(path.join(WORK, 'integrity.json')),
      split_integrity: ev(path.join(WORK, 'integrity.json')), source_rights: ev(path.join(root, 'docs/specs/DS014-source-rights.md')), token_budget: ev(path.join(WORK, 'token-audit.json')),
    },
    reviewer: {kind: 'principal_integrator', id: reviewerId, reviewed_at: new Date().toISOString()},
    blockers: [],
    note: 'Data qualification only; not a chatsop-training-authorization-v1 receipt (AGENTS.md rule 3). Train pairs carry the verification level of each candidate in audit.jsonl.',
  };
  const out = path.join(root, 'status/training/qualification-neuro-proofing.json');
  fs.writeFileSync(out, JSON.stringify(record, null, 1) + '\n');
  return {status: 'qualified', qualification: rel(out), sha256: sha(out)};
}

/** One chatsop-training-authorization-v1 receipt transcribing an owner decision that already exists in the journal
 * (never written on the owner's behalf: it fails when no matching decision event or scope file exists). Mirrors
 * tools/research/qualify-proofing.mjs `authorize()`; scope file: status/training/owner-approval-symbolic-proofing-it1.json. */
export function authorize({model, run, decisionTs, scopeFile = 'status/training/owner-approval-symbolic-proofing-it1.json', qualificationFile = 'status/training/qualification-neuro-proofing.json', recipeFile = null}) {
  const qualificationPath = path.join(root, qualificationFile);
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
    recipe_sha256: sha(path.join(root, recipeFile ?? path.join('config', `train-${model}.json`))),
    dataset_manifest_sha256: qualification.dataset_manifest_sha256, dataset_version_sha256: qualification.dataset_version_sha256,
    transcribed_by: process.env.CHATSOP_ACTOR || 'symbolic-proofing-training-agent', transcribed_at: new Date().toISOString(),
  };
  const out = path.join(root, 'status/training', `authorization-${model}-${run}.json`);
  if (scope.experiment && scope.corpus && qualification.corpus !== scope.corpus) throw Error(`The qualification is for ${qualification.corpus}, the approval scope for ${scope.corpus}`);
  fs.writeFileSync(out, JSON.stringify(receipt, null, 1) + '\n');
  return {authorization: rel(out), sha256: sha(out)};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  try {
    if (arg('--authorize')) console.log(JSON.stringify(authorize({model: arg('--authorize'), run: arg('--run'), decisionTs: arg('--decision-ts'), ...(arg('--scope') ? {scopeFile: arg('--scope')} : {}), ...(arg('--qualification') ? {qualificationFile: arg('--qualification')} : {}), ...(arg('--recipe') ? {recipeFile: arg('--recipe')} : {})}), null, 1));
    else { const r = qualify({reviewerId: arg('--reviewer-id')}); console.log(JSON.stringify(r, null, 1)); if (r.status !== 'qualified') process.exitCode = 2; }
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
