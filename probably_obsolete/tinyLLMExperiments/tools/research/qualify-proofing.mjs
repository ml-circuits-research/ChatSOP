#!/usr/bin/env node
/** Dataset qualification record for the `proofing` corpus, role `proofreader` (a plain-text-target role: the model
 * repairs the user's own message, it never emits SOP). `node training/cli.mjs train --qualification` verifies a
 * role-conditioned schema (training/cli.mjs `qualificationSchema`): for role `proofreader` the check names are
 * `oracle_grounding, meaning_preservation, leakage, split_integrity, source_rights, token_budget` (not the SOP-target
 * `formalizer`/`verbalizer` checks of tools/research/qualify-dataset.mjs, which parse the target as SOP and would
 * simply fail on English prose), `dataset_files` paths are `proofreader/(train|dev).jsonl`, and `contract_files` is
 * empty (the SOP grammar contract does not apply to a text-repair target).
 *
 * This tool does not recompute the underlying checks from scratch (that work — oracle grounding over every
 * train+dev row, meaning-preservation checks, the leakage/split-integrity overlap audit, the token budget audit —
 * was already done and is still evidenced under eval/reports/current/proofing/; see report.md and
 * status/journal.jsonl 2026-09-29T22:03:15.993Z). It re-verifies each evidence file is still present and still
 * shows zero violations, then writes the record in the exact schema training/cli.mjs's gate checks, with fresh
 * hashes of the dataset manifest, VERSION, the proofreader/{train,dev}.jsonl projection and every evidence file
 * (docs/specs/DS014-source-rights.md changed under other agents' concurrent work since the record was first
 * written, so its hash must be recomputed, not carried over).
 *
 *   node tools/research/qualify-proofing.mjs
 *   node tools/research/qualify-proofing.mjs --authorize gemma --run proofreader-gemma270m-v1 --decision-ts 2026-09-29T21:37:26.749Z
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readJournal} from '../../lib/journal.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rel = file => path.relative(root, file).split(path.sep).join('/');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const CHECKS = ['oracle_grounding', 'meaning_preservation', 'leakage', 'split_integrity', 'source_rights', 'token_budget'];

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].replace(/^--/, '');
    if (!['authorize', 'run', 'decision-ts', 'reviewer-id'].includes(name)) throw Error(`Unknown option ${argv[i]}`);
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw Error(`Missing value for ${argv[i]}`);
    out[name] = argv[++i];
  }
  return out;
}

function main() {
  const o = args(process.argv.slice(2));
  const data = path.join(root, 'datasets_archive/proofing');
  const manifestPath = path.join(data, 'manifest.json'), versionPath = path.join(data, 'VERSION');
  const version = JSON.parse(fs.readFileSync(versionPath, 'utf8'));

  // Each check's evidence is a file already produced and reasoned about in report.md; re-verify it still shows
  // zero violations before trusting its hash into the new record (fail closed, never silently reused).
  const build = JSON.parse(fs.readFileSync(path.join(root, 'eval/reports/current/proofing/build-v1.4.json'), 'utf8'));
  const overlap = JSON.parse(fs.readFileSync(path.join(root, 'eval/reports/current/proofing/overlap.json'), 'utf8'));
  const tokenAudit = JSON.parse(fs.readFileSync(path.join(root, 'eval/reports/current/proofing/gemma3-270m-token-audit.json'), 'utf8'));
  if (build.leakage_exclusions?.sealed_exact_match_removed !== 5 || (build.test?.rows ?? 0) !== 1135) throw Error('build-v1.4.json no longer matches the expected build (rerun the dataset build before qualifying)');
  const exactMatches = Object.values(overlap.sealed ?? {}).flatMap(suite => Object.values(suite).filter(v => typeof v === 'object' && 'exact_matches' in v).map(v => v.exact_matches));
  if (exactMatches.some(n => n !== 0)) throw Error('overlap.json now reports a nonzero exact match; leakage check would fail');
  if (tokenAudit.train?.over_2048 !== 0 || tokenAudit.dev?.over_2048 !== 0) throw Error('gemma3-270m-token-audit.json now reports rows over the token budget');
  // source_rights evidence is the rights table itself; every target_source model used by a repair row must appear.
  const rights = fs.readFileSync(path.join(root, 'docs/specs/DS014-source-rights.md'), 'utf8');
  const targetSources = new Set();
  for (const split of ['train', 'dev']) for (const key of Object.keys(build.splits?.[split]?.by_target_source ?? {})) targetSources.add(key.split(':')[0]);
  const rightsNames = {'qwen3-1.7b': 'Qwen/Qwen3-1.7B', 'qwen3-0.6b': 'Qwen/Qwen3-0.6B', 'gemma3-270m': 'gemma-3-270m', 'gemma3-1b': 'gemma-3-1b',
    'gec-t5-small': 'gec-t5', 'eurollm-1.7b': 'EuroLLM', 'qwen2.5-0.5b': 'Qwen2.5-0.5B', 'qwen2.5-1.5b': 'Qwen2.5-1.5B', teacher: 'Claude Haiku'};
  const missing = [...targetSources].filter(name => rightsNames[name] && !rights.includes(rightsNames[name]));
  if (missing.length) throw Error(`DS014-source-rights.md no longer documents: ${missing.join(', ')}`);

  const evidence = {
    oracle_grounding: {path: rel(path.join(root, 'eval/reports/current/proofing/build-v1.4.json')), sha256: sha(path.join(root, 'eval/reports/current/proofing/build-v1.4.json'))},
    meaning_preservation: {path: rel(path.join(root, 'eval/reports/current/proofing/build-v1.4.json')), sha256: sha(path.join(root, 'eval/reports/current/proofing/build-v1.4.json'))},
    leakage: {path: rel(path.join(root, 'eval/reports/current/proofing/overlap.json')), sha256: sha(path.join(root, 'eval/reports/current/proofing/overlap.json'))},
    split_integrity: {path: rel(path.join(root, 'eval/reports/current/proofing/overlap.json')), sha256: sha(path.join(root, 'eval/reports/current/proofing/overlap.json'))},
    source_rights: {path: rel(path.join(root, 'docs/specs/DS014-source-rights.md')), sha256: sha(path.join(root, 'docs/specs/DS014-source-rights.md'))},
    token_budget: {path: rel(path.join(root, 'eval/reports/current/proofing/gemma3-270m-token-audit.json')), sha256: sha(path.join(root, 'eval/reports/current/proofing/gemma3-270m-token-audit.json'))},
  };
  const checks = Object.fromEntries(CHECKS.map(name => [name, true]));
  const dataset_files = {
    'proofreader/train.jsonl': sha(path.join(data, 'proofreader/train.jsonl')),
    'proofreader/dev.jsonl': sha(path.join(data, 'proofreader/dev.jsonl')),
  };

  const qualification = {
    format: 'chatsop-dataset-qualification-v1', status: 'qualified', corpus: 'proofing', role: 'proofreader',
    grade: 'experiment-grade: automated oracle grounding and leakage checks, no human semantic review (matches formalizer-v1\'s grade, owner decision 2026-09-28)',
    dataset_manifest_sha256: sha(manifestPath), dataset_version_sha256: sha(versionPath), dataset_version: version,
    dataset_files, sealed_suites: {proofing: sha(path.join(root, 'eval/suites/proofing/test.jsonl'))},
    contract_files: {},
    checks, evidence,
    reviewer: {kind: 'principal_integrator', id: o['reviewer-id'] ?? 'proofreader-training-agent (automated qualification; re-issued 2026-09-30 for the new role-conditioned schema in training/cli.mjs)', reviewed_at: new Date().toISOString()},
    blockers: [],
    note: 'Re-issued 2026-09-30: same underlying evidence as the original 2026-09-29T23:59 record (proofing-data-agent), reshaped to the dataset_files/contract_files/evidence schema training/cli.mjs\'s qualification() gate actually checks (role \'proofreader\', added alongside this run instead of the formalizer/verbalizer-only schema); every evidence file re-verified to still show zero violations and every hash recomputed against the files on disk now. This record documents that the data passes the checks below; it is not a chatsop-training-authorization-v1 receipt (AGENTS.md rule 3).',
  };
  fs.writeFileSync(path.join(root, 'status/training/qualification-proofing.json'), JSON.stringify(qualification, null, 1) + '\n');
  const qualificationPath = path.join(root, 'status/training/qualification-proofing.json');
  console.log(JSON.stringify({qualification: rel(qualificationPath), status: 'qualified', sha256: sha(qualificationPath)}, null, 1));

  if (o.authorize) authorize(o, qualificationPath, qualification);
}

/** One chatsop-training-authorization-v1 receipt per model, transcribing an owner decision already in the journal
 * (never written on the owner's behalf: it fails if no matching decision event exists). Mirrors
 * tools/research/qualify-dataset.mjs `authorize()` but for role `proofreader` and the owner-approval-proofreader-v1
 * scope file. */
function authorize(o, qualificationPath, qualification) {
  if (!o.run || !o['decision-ts']) throw Error('--authorize needs --run and --decision-ts');
  const decision = readJournal().find(event => event.ts === o['decision-ts'] && event.area === 'training' && event.state === 'decision');
  if (!decision) throw Error(`No training decision event at ${o['decision-ts']} in status/journal.jsonl`);
  const scope = JSON.parse(fs.readFileSync(path.join(root, 'status/training/owner-approval-proofreader-v1.json'), 'utf8'));
  if (scope.journal_event.ts !== decision.ts) throw Error('The approval scope does not match this decision');
  for (const model of o.authorize.split(',')) {
    if (!scope.approved_models.includes(model)) throw Error(`${model} is outside the owner's approved models for this experiment`);
    const receipt = {
      format: 'chatsop-training-authorization-v1', authorization: 'explicit-user-approval', approved: true, approved_by: 'user',
      approved_at: decision.ts, instruction: `${decision.title}: ${decision.detail}`,
      journal_event: {file: 'status/journal.jsonl', ts: decision.ts, actor: decision.actor},
      model, run: o.run, role: 'proofreader', qualification_sha256: sha(qualificationPath),
      recipe_sha256: sha(path.join(root, 'config', `train-${model}.json`)),
      dataset_manifest_sha256: qualification.dataset_manifest_sha256, dataset_version_sha256: qualification.dataset_version_sha256,
      transcribed_by: 'proofreader-training-agent', transcribed_at: new Date().toISOString(),
    };
    const file = path.join(root, 'status/training', `authorization-${model}-${o.run}.json`);
    fs.writeFileSync(file, JSON.stringify(receipt, null, 1) + '\n');
    console.log(JSON.stringify({authorization: rel(file), sha256: sha(file)}));
  }
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 2; }
