#!/usr/bin/env node
/** Dataset qualification record for the LanguageProofingLLM post-editing variant (experiment train-language-proofing-gloss-gemma270m,
 * datasets/bad_english/proofing-gloss, frozen role id `proofreader`). Sibling of tools/research/qualify-language-proofing-v2.mjs (same record
 * schema, training/cli.mjs `qualificationSchema` for role `proofreader`); every check is recomputed from the files on disk and the record is
 * written only when every check holds (fail closed). It is a DATA qualification only: it is NOT a chatsop-training-authorization-v1 receipt
 * (AGENTS.md rule 3), and this tool has no `--authorize` mode on purpose.
 *
 *   node tools/research/qualify-language-proofing-gloss.mjs [--reviewer-id ID] [--sample 500]
 *
 * Checks:
 *   oracle_grounding      every train/dev pair is a pair of the qualified datasets/bad_english/proofing-it3 with the same id and the same target; the prompt is the
 *                         TranslatorService gloss of the source prompt, recomputed for a seeded sample of rows (equal, or the record is not written)
 *   meaning_preservation  the gloss introduces no problem the source pair did not have (names, numbers, quotes, question marks, negation: tools/datasets/language-proofing/pairs.mjs);
 *                         the meaning relation of the source pair is the one qualified for iteration 3 (its two-vote judge and mechanical checks)
 *   leakage               no folded exact match of a train or dev prompt (gloss or source) or target with any sealed text
 *   split_integrity       an id is in one split only; no train prompt equals a dev prompt; none of the eight new held-out words is in a train prompt or target
 *   source_rights         DS014 records DeepSeek-written text
 *   token_budget          no pair above 2048 tokens with the Gemma 3 tokenizer
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {hashText, pairProblems} from '../datasets/language-proofing/pairs.mjs';
import {HELD_OUT_V3, matchesAny} from '../datasets/language-proofing/vocab-it3.mjs';
import {createSymbolicLM} from '../../lib/symbolic-lm/index.mjs';
import {glossMessage} from '../../lib/translator-service/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(root, 'datasets/bad_english/proofing-gloss');
const SRC = path.join(root, 'datasets/bad_english/proofing-it3');
const EVID = path.join(root, 'eval/reports/current/gloss/data');
const QUAL = path.join(root, 'status/training/qualification-language-proofing-gloss.json');
const SEALED = path.join(root, 'eval/reports/current/language-proofing-it3/data/sealed-hashes-union.json');
const rel = file => path.relative(root, file).split(path.sep).join('/');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const readJsonl = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const writeJson = (file, data) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, JSON.stringify(data, null, 1) + '\n'); return {path: rel(file), sha256: sha(file)}; };
const kind = p => p.replace(/^lost: .*/, 'lost item');
const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };

export async function qualify({reviewerId = 'gloss-agent (automated qualification)', sample = 500} = {}) {
  const blockers = [];
  const manifest = readJson(path.join(DATA, 'manifest.json'));
  const srcManifest = readJson(path.join(SRC, 'manifest.json'));
  const files = ['train', 'dev'].map(split => [split, readJsonl(path.join(DATA, 'proofreader', `${split}.jsonl`)), new Map(readJsonl(path.join(SRC, 'proofreader', `${split}.jsonl`)).map(r => [r.id, r]))]);
  // ---- oracle_grounding
  const grounding = {generated_at: new Date().toISOString(), source: 'datasets/bad_english/proofing-it3', source_manifest_sha256: sha(path.join(SRC, 'manifest.json')), splits: {}};
  for (const [split, rows, src] of files) {
    let notInSource = 0, targetDiffers = 0, identityChanged = 0, promptEqualsSource = 0;
    for (const r of rows) {
      const s = src.get(r.id);
      if (!s) { notInSource++; continue; }
      if (s.target !== r.target) targetDiffers++;
      if (s.prompt !== r.source_prompt) targetDiffers++;
      if (r.prompt === s.prompt) promptEqualsSource++;
      if (s.kind === 'identity' && r.prompt !== s.prompt) identityChanged++;
    }
    grounding.splits[split] = {rows: rows.length, source_rows: src.size, not_in_source: notInSource, target_or_source_prompt_differs: targetDiffers, prompt_unchanged_by_gloss: promptEqualsSource, identity_pairs_whose_prompt_the_gloss_changed: identityChanged};
    if (notInSource || targetDiffers) blockers.push(`${split}: ${notInSource} rows not in the source, ${targetDiffers} differing targets or source prompts`);
  }
  // recompute the gloss for a seeded sample
  const all = files.flatMap(([split, rows]) => rows.map(r => ({...r, split})));
  const order = all.slice().sort((a, b) => hashText(`gloss-qual${a.id}${a.split}`).localeCompare(hashText(`gloss-qual${b.id}${b.split}`))).slice(0, sample);
  const lm = await createSymbolicLM({});
  let mismatched = 0;
  const examples = [];
  try {
    for (const r of order) {
      const g = await glossMessage(lm, r.source_prompt, {spell: true, senses: manifest.gloss.senses});
      if (g.text !== r.prompt) { mismatched++; if (examples.length < 5) examples.push({id: r.id, stored: r.prompt, recomputed: g.text}); }
    }
  } finally { await lm.stop?.(); }
  grounding.recomputed = {sample: order.length, mismatched, examples, gloss: manifest.gloss, rule: 'the stored prompt equals translator-gloss glossMessage(source_prompt, {spell: true, senses: 2}); a mismatch blocks the record'};
  if (mismatched) blockers.push(`${mismatched} of ${order.length} recomputed glosses differ from the stored prompt`);
  // ---- meaning_preservation
  const meaning = {generated_at: grounding.generated_at, rule: 'problems of (gloss prompt, target) that the pair (source prompt, target) did not have; length ratio excluded', splits: {}};
  for (const [split, rows, src] of files) {
    const byProblem = {}; let rowsWith = 0;
    for (const r of rows) {
      const had = new Set(pairProblems(src.get(r.id).prompt, r.target).map(kind));
      const added = pairProblems(r.prompt, r.target).filter(p => !/^length ratio/.test(p) && !had.has(kind(p)));
      if (added.length) { rowsWith++; for (const p of new Set(added.map(kind))) byProblem[p] = (byProblem[p] ?? 0) + 1; }
    }
    meaning.splits[split] = {rows: rows.length, rows_with_new_problem: rowsWith, by_problem: byProblem, dropped_at_build: split === 'train' ? manifest.summary.dropped_mechanical : 'dev rows are kept for measurement'};
    if (split === 'train' && rowsWith) blockers.push(`${rowsWith} train rows have a problem the gloss introduced`);
  }
  meaning.source_qualification = {path: 'status/training/qualification-language-proofing-it3.json', sha256: sha(path.join(root, 'status/training/qualification-language-proofing-it3.json'))};
  // ---- leakage and split integrity
  const sealed = new Set(readJson(SEALED).hashes);
  const named = [['train', files[0][1]], ['dev', files[1][1]], ...['dev-heldout', 'dev-heldout-v3', 'dev-heldout-v3-identity', 'dev-spacing', 'dev-backgen', 'mash-eval'].map(n => [n, readJsonl(path.join(DATA, `${n}.jsonl`))])];
  const sealedHits = {}, ids = new Map();
  let twoSplits = 0;
  for (const [name, rows] of named) {
    sealedHits[name] = rows.filter(r => sealed.has(hashText(r.prompt)) || sealed.has(hashText(r.source_prompt)) || sealed.has(hashText(r.target))).length;
    if (name === 'train' || name === 'dev') for (const r of rows) { if (ids.has(r.id) && ids.get(r.id) !== name) twoSplits++; ids.set(r.id, name); }
  }
  const devPrompts = new Set([...files[1][1], ...named.slice(2).flatMap(([, rows]) => rows)].map(r => hashText(r.prompt)));
  const trainPromptsInDev = files[0][1].filter(r => devPrompts.has(hashText(r.prompt))).length;
  const heldoutInTrain = files[0][1].filter(r => matchesAny(HELD_OUT_V3, r.prompt, r.target)).length;
  const integrity = {generated_at: grounding.generated_at, pairs: Object.fromEntries(named.map(([n, rows]) => [n, rows.length])), sealed_hashes: rel(SEALED), exact_matches_with_sealed_texts: sealedHits, ids_in_two_splits: twoSplits,
    train_prompts_also_in_dev_sets: trainPromptsInDev, heldout_v3_words_in_train_prompt_or_target: heldoutInTrain, note: 'exact matches after the folding of tools/datasets/language-proofing/pairs.mjs hashText; gloss prompts, source prompts and targets are all checked'};
  if (Object.values(sealedHits).some(n => n)) blockers.push(`sealed text matches: ${JSON.stringify(sealedHits)}`);
  if (twoSplits) blockers.push(`${twoSplits} ids in two splits`);
  if (trainPromptsInDev) blockers.push(`${trainPromptsInDev} train prompts also in a dev set`);
  if (heldoutInTrain) blockers.push(`${heldoutInTrain} train rows contain a new held-out word`);
  // ---- source rights
  if (!/deepseek/i.test(fs.readFileSync(path.join(root, 'docs/specs/DS014-source-rights.md'), 'utf8'))) blockers.push('DS014-source-rights.md does not mention DeepSeek-written text');
  // ---- token budget
  const python = process.env.TRAIN_PYTHON ?? path.join(process.env.HOME, 'nlp-venv/bin/python');
  const tmp = path.join(EVID, '.tmp-tokens.json');
  fs.mkdirSync(EVID, {recursive: true});
  const run = spawnSync(python, ['training/python/pair_token_lengths.py', '--base', 'models/gemma/bases/99073d6b6edb0e298d163f964ec2b9d970b3408d', '--out', tmp, ...named.map(([n]) => n === 'train' || n === 'dev' ? path.join(DATA, 'proofreader', `${n}.jsonl`) : path.join(DATA, `${n}.jsonl`))],
    {cwd: root, encoding: 'utf8', env: {...process.env, PYTHONPATH: path.join(root, 'training/python')}});
  if (run.status !== 0) blockers.push(`token length audit failed: ${run.stderr.slice(-300)}`);
  const tokenAudit = {generated_at: grounding.generated_at, tokenizer: 'Gemma 3 (models/gemma/bases/99073d6b..., chat template of training/python/common.py chat_ids)', over_2048: 0, splits: {}};
  if (run.status === 0) {
    const lengths = readJson(tmp);
    for (const [file, map] of Object.entries(lengths)) {
      const totals = Object.values(map).map(v => v[1]).sort((a, b) => a - b);
      tokenAudit.over_2048 += totals.filter(n => n > 2048).length;
      tokenAudit.splits[path.basename(file, '.jsonl')] = {n: totals.length, p50: totals[Math.floor(totals.length / 2)], p99: totals[Math.floor(totals.length * 0.99)], max: totals.at(-1)};
    }
    fs.rmSync(tmp, {force: true});
    if (tokenAudit.over_2048) blockers.push(`${tokenAudit.over_2048} pairs above 2048 tokens`);
  }
  const ev = {oracle_grounding: writeJson(path.join(EVID, 'grounding-gloss.json'), grounding), meaning_preservation: writeJson(path.join(EVID, 'meaning-gloss.json'), meaning), leakage: writeJson(path.join(EVID, 'integrity-gloss.json'), integrity),
    token_budget: writeJson(path.join(EVID, 'token-audit-gloss.json'), tokenAudit)};
  ev.split_integrity = ev.leakage;
  ev.source_rights = {path: 'docs/specs/DS014-source-rights.md', sha256: sha(path.join(root, 'docs/specs/DS014-source-rights.md'))};
  if (blockers.length) return {status: 'blocked', blockers};
  const record = {
    format: 'chatsop-dataset-qualification-v1', status: 'qualified', corpus: 'bad_english/proofing-gloss', role: 'proofreader',
    grade: 'experiment-grade: the pairs and targets are those of the qualified bad_english/proofing-it3 (DeepSeek-written targets, mechanical checks, two-vote meaning judge for back-generated pairs); the prompts are deterministic gloss output recomputed on a seeded sample; no human semantic review',
    dataset_manifest_sha256: sha(path.join(DATA, 'manifest.json')), dataset_version_sha256: sha(path.join(DATA, 'VERSION')), dataset_version: readJson(path.join(DATA, 'VERSION')),
    dataset_files: {'proofreader/train.jsonl': sha(path.join(DATA, 'proofreader/train.jsonl')), 'proofreader/dev.jsonl': sha(path.join(DATA, 'proofreader/dev.jsonl'))},
    sealed_suites: {'bad_english/proofing-test': sha(path.join(root, 'eval/suites/bad_english/proofing-test.jsonl'))}, contract_files: {},
    checks: Object.fromEntries(['oracle_grounding', 'meaning_preservation', 'leakage', 'split_integrity', 'source_rights', 'token_budget'].map(name => [name, true])),
    evidence: {oracle_grounding: ev.oracle_grounding, meaning_preservation: ev.meaning_preservation, leakage: ev.leakage, split_integrity: ev.split_integrity, source_rights: ev.source_rights, token_budget: ev.token_budget},
    reviewer: {kind: 'principal_integrator', id: reviewerId, reviewed_at: new Date().toISOString()},
    blockers: [], note: 'Data qualification only; not a chatsop-training-authorization-v1 receipt (AGENTS.md rule 3). No authorization receipt exists for this corpus.',
  };
  fs.writeFileSync(QUAL, JSON.stringify(record, null, 1) + '\n');
  return {status: 'qualified', qualification: rel(QUAL), sha256: sha(QUAL), source_train_sha256: srcManifest.files?.['proofreader/train.jsonl']?.sha256};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  qualify({reviewerId: arg('--reviewer-id', undefined), sample: Number(arg('--sample', 500))}).then(r => { console.log(JSON.stringify(r, null, 1)); process.exit(r.status === 'qualified' ? 0 : 1); }, e => { console.error(e); process.exit(1); });
}
