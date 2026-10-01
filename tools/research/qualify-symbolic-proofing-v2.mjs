#!/usr/bin/env node
/** Dataset qualification record for SymbolicProofingLLM iteration 2 (datasets/neuro_english/proofing-it2, frozen role id `proofreader`).
 * Sibling of tools/research/qualify-neuro-proofing.mjs: the same record schema (training/cli.mjs `qualificationSchema`, role `proofreader`), every
 * check recomputed from the files on disk, the record written only when every check holds (fail closed).
 *
 *   node tools/research/qualify-symbolic-proofing-v2.mjs [--reviewer-id ID]
 *   node tools/research/qualify-neuro-proofing.mjs --authorize gemma --run symbolic-proofing-gemma270m-it2 --decision-ts 2026-09-30T17:32:38.274Z \
 *        --scope status/training/owner-approval-symbolic-proofing-it2.json --qualification status/training/qualification-symbolic-proofing-it2.json
 *
 * Checks (recomputed here, evidence files under eval/reports/current/symbolic-proofing-it2/data/):
 *   oracle_grounding      an identity pair has a prompt that passes the analysis gate and equals its target; a repair pair has a prompt that does NOT pass the
 *                         gate (SymbolicLM does not handle it as it is) and a target whose sentences all pass the gate or whose source row is in the current
 *                         symbolic_english train/dev of the same split
 *   meaning_preservation  every repair pair is mechanically clean (names, numbers, negation, question mark, lead-ins and tags kept, no pronoun replaced by a
 *                         name, no added name or content) and carries the two-vote meaning verdict (inherited from its verified source pair, or voted for the
 *                         unit itself in datasets_sources/symbolic_proofing_it2_meaning_judge)
 *   leakage               no sentence of a prompt or target equals a sealed sentence or shares its content words (tools/datasets/audit/symbolic-proofing-overlap.mjs)
 *   split_integrity       ids are unique, no prompt is in both splits, no prompt carries two labels
 *   source_rights         DS014 records the DeepSeek-written text
 *   token_budget          no pair above the token cap (token-audit.json)
 * The record is not a training authorization (AGENTS.md rule 3).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {AnalysisLayer} from '../eval/analysis-layer.mjs';
import {meaningVotes, meaningItemId} from '../datasets/neuro-oracle/judge.mjs';
import {sealedSentences} from '../datasets/audit/symbolic-proofing-overlap.mjs';
import {lightWords} from '../datasets/three-datasets/forms.mjs';
import {sentencesOf, foldWords, fold, mechanicalUnit} from '../datasets/symbolic-proofing-v2/units.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rel = file => path.relative(root, file).split(path.sep).join('/');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const readJsonl = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const VERSION = process.env.SYMPROOF_VERSION ?? 'it2';
process.env.SYMPROOF_RULES ??= VERSION === 'it3' ? 'v3' : 'v2';
const DATA = path.join(root, `datasets/neuro_english/proofing-${VERSION}`);
const WORK = path.join(root, `eval/reports/current/symbolic-proofing-${VERSION}/data`);
const MEANING_DIR = path.join(root, 'datasets_sources/symbolic_proofing_it2_meaning_judge');
const write = (name, value) => { const file = path.join(WORK, name); fs.writeFileSync(file, JSON.stringify(value, null, 1) + '\n'); return file; };

export function qualify({reviewerId = 'symbolic-proofing-it2-agent (automated qualification)'} = {}) {
  const blockers = [];
  const manifestPath = path.join(DATA, 'manifest.json'), versionPath = path.join(DATA, 'VERSION');
  const manifest = readJson(manifestPath);
  for (const [name, info] of Object.entries(manifest.files)) if (sha(path.join(DATA, name)) !== info.sha256) blockers.push(`${name} changed after the manifest was written`);
  const audit = new Map(readJsonl(path.join(DATA, 'audit.jsonl')).map(a => [a.id, a]));
  const rows = ['train', 'dev'].flatMap(split => readJsonl(path.join(DATA, `proofreader/${split}.jsonl`)).map(r => ({...r, split})));
  const layer = new AnalysisLayer();
  layer.reloadVerdicts();
  const votes = fs.existsSync(MEANING_DIR) ? meaningVotes(MEANING_DIR) : new Map();
  const symbolic = new Map();
  for (const split of ['train', 'dev']) for (const r of readJsonlShardedSync(path.join(root, `datasets/symbolic_english/${split}.jsonl`))) symbolic.set(r.id, split);

  const grounding = {rows: rows.length, ungrounded: [], by_basis: {}}, meaning = {repair_rows: 0, bad: [], by_basis: {}};
  for (const r of rows) {
    const a = audit.get(r.id);
    if (!a || a.kind !== r.kind || a.pair_split !== r.split) { grounding.ungrounded.push({id: r.id, why: 'audit'}); continue; }
    const gp = layer.gate(r.prompt);
    if (gp.pending) { grounding.ungrounded.push({id: r.id, why: 'prompt gate pending'}); continue; }
    if (r.kind === 'identity') {
      if (!gp.pass || r.prompt !== r.target) grounding.ungrounded.push({id: r.id, why: 'identity prompt does not pass the gate or differs from the target'});
      grounding.by_basis.identity_gate = (grounding.by_basis.identity_gate ?? 0) + 1;
      continue;
    }
    if (gp.pass) grounding.ungrounded.push({id: r.id, why: 'repair prompt already passes the gate'});
    const sourceRow = a.source_row ? symbolic.get(a.source_row) : null;
    let basis = null;
    if (a.target_in_symbolic && sourceRow === r.split) basis = 'target_in_symbolic_english';
    else if (a.target_in_symbolic && a.origin === 'decomp') basis = 'decomp_group_of_symbolic_sentences';
    else { const gt = layer.gate(r.target); if (gt.pass) basis = 'target_gate'; }
    if (!basis) grounding.ungrounded.push({id: r.id, why: 'target neither in symbolic_english nor passing the gate'});
    else grounding.by_basis[basis] = (grounding.by_basis[basis] ?? 0) + 1;
    // meaning
    meaning.repair_rows++;
    const mech = mechanicalUnit(r.prompt, r.target, {cut: false});
    if (!mech.ok) meaning.bad.push({id: r.id, why: mech.reasons});
    let m = a.meaning_basis;
    if (m === 'needs') { const v = votes.get(meaningItemId(r.id, r.prompt, r.target)); if (v !== 'yes') meaning.bad.push({id: r.id, why: `two-vote verdict ${v}`}); m = 'two_vote_unit'; }
    if (!['two_vote', 'gold_sop', 'composed', 'two_vote_unit'].includes(m)) meaning.bad.push({id: r.id, why: `meaning basis ${m}`});
    meaning.by_basis[m] = (meaning.by_basis[m] ?? 0) + 1;
  }
  if (grounding.ungrounded.length) blockers.push(`${grounding.ungrounded.length} pairs are not grounded (first: ${JSON.stringify(grounding.ungrounded[0])})`);
  if (meaning.bad.length) blockers.push(`${meaning.bad.length} repair pairs fail the meaning checks (first: ${JSON.stringify(meaning.bad[0])})`);

  // leakage against the sealed sentences
  const {exact, sig} = sealedSentences();
  const leaks = [];
  for (const r of rows) for (const text of [r.prompt, r.target]) for (const s of sentencesOf(text)) {
    const words = lightWords(s);
    if (exact.has(foldWords(s)) || (words.length >= 2 && sig.has(words.join(' ')))) { leaks.push({id: r.id, sentence: s}); break; }
  }
  if (leaks.length) blockers.push(`${leaks.length} units share a sentence or its content words with a sealed text (first: ${JSON.stringify(leaks[0])})`);

  // split integrity
  const ids = new Set(), promptSplit = new Map(), problems = [];
  for (const r of rows) {
    if (ids.has(r.id)) problems.push({id: r.id, why: 'duplicate id'});
    ids.add(r.id);
    const k = fold(r.prompt), seen = promptSplit.get(k);
    if (seen) problems.push({id: r.id, why: seen.split !== r.split ? 'prompt in two splits' : seen.target !== r.target ? 'one prompt, two targets' : 'duplicate pair'});
    else promptSplit.set(k, {split: r.split, target: r.target});
  }
  if (problems.length) blockers.push(`${problems.length} split problems (first: ${JSON.stringify(problems[0])})`);

  const rights = fs.readFileSync(path.join(root, 'docs/specs/DS014-source-rights.md'), 'utf8');
  if (!/deepseek/i.test(rights)) blockers.push('DS014-source-rights.md does not mention DeepSeek-written text');
  const tokens = readJson(path.join(WORK, 'token-audit.json'));
  if (tokens.over_2048 !== 0 || tokens.over_cap !== 0) blockers.push(`token audit: ${tokens.over_2048} pairs above 2048, ${tokens.over_cap} above the cap`);

  const files = {
    oracle_grounding: write('grounding.json', {generated_at: new Date().toISOString(), ...grounding, ungrounded: grounding.ungrounded.slice(0, 20)}),
    meaning_preservation: write('meaning-check.json', {generated_at: new Date().toISOString(), ...meaning, bad: meaning.bad.slice(0, 20)}),
    leakage: write('leakage-final.json', {generated_at: new Date().toISOString(), rows: rows.length, leaks: leaks.length, examples: leaks.slice(0, 20)}),
    split_integrity: write('split-integrity.json', {generated_at: new Date().toISOString(), rows: rows.length, unique_prompts: promptSplit.size, problems: problems.slice(0, 20)}),
  };
  if (blockers.length) return {status: 'blocked', blockers};

  const ev = file => ({path: rel(file), sha256: sha(file)});
  const record = {
    format: 'chatsop-dataset-qualification-v1', status: 'qualified', corpus: `neuro_english/proofing-${VERSION}`, role: 'proofreader',
    grade: 'experiment-grade: analysis-layer gate (Stanza default and accurate trees identical, DeepSeek judge conditions a and c), two-vote DeepSeek meaning judge, mechanical filters and sealed-overlap audit, no human semantic review',
    dataset_manifest_sha256: sha(manifestPath), dataset_version_sha256: sha(versionPath), dataset_version: readJson(versionPath),
    dataset_files: {'proofreader/train.jsonl': sha(path.join(DATA, 'proofreader/train.jsonl')), 'proofreader/dev.jsonl': sha(path.join(DATA, 'proofreader/dev.jsonl'))},
    sealed_suites: {'neuro_english/proofing-test': manifest.sealed_test.sha256},
    contract_files: {},
    checks: Object.fromEntries(['oracle_grounding', 'meaning_preservation', 'leakage', 'split_integrity', 'source_rights', 'token_budget'].map(name => [name, true])),
    evidence: {
      oracle_grounding: ev(files.oracle_grounding), meaning_preservation: ev(files.meaning_preservation), leakage: ev(files.leakage), split_integrity: ev(files.split_integrity),
      source_rights: ev(path.join(root, 'docs/specs/DS014-source-rights.md')), token_budget: ev(path.join(WORK, 'token-audit.json')),
    },
    reviewer: {kind: 'principal_integrator', id: reviewerId, reviewed_at: new Date().toISOString()},
    blockers: [],
    note: 'Data qualification only; not a chatsop-training-authorization-v1 receipt (AGENTS.md rule 3).',
  };
  const out = path.join(root, `status/training/qualification-symbolic-proofing-${VERSION}.json`);
  fs.writeFileSync(out, JSON.stringify(record, null, 1) + '\n');
  return {status: 'qualified', qualification: rel(out), sha256: sha(out), grounding: grounding.by_basis, meaning: meaning.by_basis};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  try { const r = qualify({reviewerId: arg('--reviewer-id')}); console.log(JSON.stringify(r, null, 1)); if (r.status !== 'qualified') process.exitCode = 2; }
  catch (error) { console.error(error); process.exitCode = 2; }
}
