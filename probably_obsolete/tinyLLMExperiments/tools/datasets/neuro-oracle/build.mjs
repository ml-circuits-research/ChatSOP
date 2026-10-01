/** Builds the SymbolicProofingLLM pair files from the final verdicts.
 *
 *   datasets/neuro_english/proofing/{train,dev}.jsonl   flat {id, prompt, target, kind, language, source_language, pipeline, target_source}
 *   datasets/neuro_english/proofing/audit.jsonl         id, pair_split, kind, source, verification, form, decomposition, tokens ...
 *   datasets/neuro_english/proofing/manifest.json       counts and hashes (+ VERSION, proofreader/ projection for training/cli.mjs)
 *
 * This module handles train and dev. The sealed test pairs (eval/suites/neuro_english/proofing-test.jsonl) are built by
 * tools/eval/neuro-oracle-test.mjs with the same functions; this side reads of the sealed side only the hashes of its texts
 * (`sealed-hashes.json`) and a summary. Every pair keeps the id of its source row, so a later re-split of the legacy rows
 * carries the pair along (`build` again after the re-split regenerates the files from the same verdicts).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {ROOT, WORK, sha256, writeJsonl, writeJson, readJson} from './common.mjs';
import {normalText} from '../three-datasets/inputs.mjs';
import {classifyRow} from '../three-datasets/decomposition.mjs';
import {mainForm} from '../three-datasets/forms.mjs';
import {selectBest, stratifiedIdentity, flat, repairAudit, identityAudit} from './pairs.mjs';

export const OUT_DIR = path.join(ROOT, 'datasets/neuro_english/proofing');
export const SEALED_HASHES = path.join(WORK, 'sealed-hashes.json');
const COMPOSED = new Set(['composed', 'form-variant']);
const isComposed = row => COMPOSED.has(row.source?.corpus) || row.composed === true;
export const countBy = (rows, key) => rows.reduce((o, r) => { const k = key(r) ?? 'none'; o[k] = (o[k] ?? 0) + 1; return o; }, {});
/** Hash of a folded text, the form in which sealed texts cross from the sealed side. */
export const hashText = text => crypto.createHash('sha1').update(normalText(text)).digest('hex').slice(0, 20);

/**
 * Pairs of the given splits: `{split: {repair, composed, identity}}`, lists of {flat, audit}.
 * `neuro`: Map(id -> neuro row) and `symbolic`: array of symbolic_english rows, both restricted to `splits` by the caller.
 */
export function buildPairs({verdicts, candidates, neuro, symbolic, splits, identityRatio = 0.67, allowExtra = new Set()}) {
  const textOf = new Map(candidates.map(c => [c.cid, c.text]));
  const out = Object.fromEntries(splits.map(s => [s, {repair: [], identity: [], composed: []}]));
  // Rows flagged `rewrite_target: false` (failure_kind gold_convention: host frame normalization repairs them) are never
  // fine-tuning material (neuro_english README, "failure_kind"), so they get no pair even when a candidate matches.
  const eligible = verdicts.filter(v => neuro.has(v.id) && neuro.get(v.id).rewrite_target !== false);
  const best = selectBest(eligible, textOf, {allowExtra});
  const notes = {composed_neuro_rows: 0, composed_symbolic_rows: 0, rows_excluded_not_a_rewrite_target: new Set(verdicts.filter(v => neuro.get(v.id)?.rewrite_target === false && ['VERIFIED_GOLD', 'VERIFIED_GOLD_NORMALIZED'].includes(v.level)).map(v => v.id)).size};
  for (const [id, b] of best) {
    const row = neuro.get(id);
    if (isComposed(row)) continue; // composed rows carry their own verified target (hook below)
    out[row.split].repair.push({flat: flat(id, row.message, b.text, 'repair', `${b.v.src}:${b.v.level}`), audit: repairAudit(row, b, row.split)});
  }
  // Hook: composed long cases and form variants written by tools/datasets/composed-train.mjs / form-variants.mjs (train and dev only).
  for (const row of neuro.values()) if (isComposed(row) && row.split !== 'test' && typeof row.target === 'string' && row.target && row.target !== row.message) {
    notes.composed_neuro_rows++;
    const shape = classifyRow({message: row.message, analysis: row.analysis, target: row.target});
    out[row.split].composed.push({flat: flat(row.id, row.message, row.target, 'repair', `${row.source.corpus}:verified_composed`), audit: {id: row.id, pair_split: row.split, kind: 'repair', source: row.source.corpus, candidate_id: null, verification: 'VERIFIED_COMPOSED', meaning_judge: null, has_gold: false, failure_kind: row.failure_kind ?? null, form: mainForm(row.analysis), corpus: row.source.corpus, message_sentences: shape.message_sentences, target_sentences: shape.target_sentences, decomposition: shape.decomposition, decomposition_type: shape.type, candidate_shape: shape.candidate}});
  }
  for (const row of symbolic) if (isComposed(row) && row.split !== 'test') {
    notes.composed_symbolic_rows++;
    out[row.split].composed.push({flat: flat(row.id, row.message, row.message, 'identity', 'identity:composed'), audit: {...identityAudit(row, row.split), source: row.source.corpus, verification: 'IDENTITY_COMPOSED'}});
  }
  // Identity pairs, stratified by form, about `identityRatio` per repair pair; never a text that is also a repair prompt or target.
  for (const split of splits) {
    const used = new Set(out[split].repair.flatMap(p => [normalText(p.flat.prompt), normalText(p.flat.target)]));
    const pool = symbolic.filter(r => r.split === split && !isComposed(r));
    const quota = Math.round(identityRatio * out[split].repair.length);
    for (const row of stratifiedIdentity(pool, quota, used)) out[split].identity.push({flat: flat(row.id, row.message, row.message, 'identity', 'identity'), audit: identityAudit(row, split)});
  }
  return {out, notes, best};
}

const all = (out, split) => ['repair', 'composed', 'identity'].flatMap(kind => out[split][kind]);

/** Train/dev pairs whose prompt or target hashes like a sealed text are dropped; returns the number dropped. */
export function dropLeaks(out, sealedSet) {
  let dropped = 0;
  for (const split of Object.keys(out)) for (const kind of ['repair', 'identity', 'composed']) {
    const keep = out[split][kind].filter(p => !sealedSet.has(hashText(p.flat.prompt)) && !sealedSet.has(hashText(p.flat.target)));
    dropped += out[split][kind].length - keep.length;
    out[split][kind] = keep;
  }
  return dropped;
}

/** Duplicated prompts keep the first occurrence (dev before train, so the dev split keeps its texts); returns the number dropped. */
export function dedupePrompts(out) {
  const seen = new Set();
  let dropped = 0;
  for (const split of ['dev', 'train']) for (const kind of ['repair', 'composed', 'identity']) {
    out[split][kind] = out[split][kind].filter(p => { const key = normalText(p.flat.prompt); if (seen.has(key)) { dropped++; return false; } seen.add(key); return true; });
  }
  return dropped;
}

/** Sealed hashes written by the sealed side: {hashes: [...], test_pair_ids: [...]}. */
export function loadSealedHashes(file = SEALED_HASHES) {
  if (!fs.existsSync(file)) throw Error(`${path.relative(ROOT, file)} is missing: run \`node tools/eval/neuro-oracle-test.mjs build\` first (the sealed side writes the hashes of its texts)`);
  const j = readJson(file);
  return {set: new Set(j.hashes), testIds: new Set(j.test_pair_ids), rows: j.rows, file_sha256: sha256(fs.readFileSync(file))};
}

/** Split integrity and leakage evidence of the final train/dev pair sets (integrity.json). */
export function integrity(out, sealed, rowsById) {
  const seen = new Map(), idInTwoSplits = [], wrongSplit = [];
  let idInTest = 0;
  for (const split of ['train', 'dev']) for (const p of all(out, split)) {
    if (seen.has(p.flat.id) && seen.get(p.flat.id) !== split) idInTwoSplits.push(p.flat.id);
    seen.set(p.flat.id, split);
    if (sealed.testIds.has(p.flat.id)) idInTest++;
    if (rowsById.has(p.flat.id) && rowsById.get(p.flat.id).split !== split) wrongSplit.push(p.flat.id);
  }
  let exactSealed = 0;
  for (const split of ['train', 'dev']) for (const p of all(out, split)) for (const t of [p.flat.prompt, p.flat.target]) if (sealed.set.has(hashText(t))) exactSealed++;
  return {generated_at: new Date().toISOString(), pairs: {train: all(out, 'train').length, dev: all(out, 'dev').length, sealed_test: sealed.rows}, ids_in_two_splits: idInTwoSplits.length, ids_also_in_sealed_test_pairs: idInTest, pair_split_differs_from_row_split: wrongSplit.length,
    exact_matches: {train_dev_vs_sealed_texts_and_test_pairs: exactSealed},
    note: 'exact matches after case, diacritic, punctuation and spacing folding; the sealed hashes cover the messages and targets of the sealed neuro_english, symbolic_english and bad_english suites and the sealed proofing pairs (eval/reports/current/neuro-oracle/sealed-hashes.json, written by tools/eval/neuro-oracle-test.mjs)'};
}

/** Token lengths of the flat pairs with the Gemma 3 tokenizer (training/python/pair_token_lengths.py). */
export function tokenLengths(files, {python = process.env.TRAIN_PYTHON ?? path.join(process.env.HOME, 'nlp-venv/bin/python'), base = 'models/gemma/bases/99073d6b6edb0e298d163f964ec2b9d970b3408d', out = path.join(WORK, `token-lengths-${crypto.randomBytes(4).toString('hex')}.json`)} = {}) {
  const r = spawnSync(python, ['training/python/pair_token_lengths.py', '--base', base, '--out', out, ...files], {cwd: ROOT, encoding: 'utf8', env: {...process.env, PYTHONPATH: path.join(ROOT, 'training/python')}});
  if (r.status !== 0) throw Error(`token lengths failed: ${r.stderr.slice(-400)}`);
  const lengths = JSON.parse(fs.readFileSync(out, 'utf8'));
  fs.unlinkSync(out);
  return lengths;
}

const pct = (xs, p) => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] : 0);
export const percentiles = xs => ({n: xs.length, min: xs.length ? Math.min(...xs) : 0, p50: pct(xs, 0.5), p90: pct(xs, 0.9), p99: pct(xs, 0.99), max: xs.length ? Math.max(...xs) : 0});

/** Counts of a list of audit rows (with `tokens`): the per-split summary of the manifest and the report. */
export function summarise(rows) {
  const repairs = rows.filter(r => r.kind === 'repair');
  return {pairs: rows.length, by_kind: countBy(rows, r => r.kind), by_verification: countBy(rows, r => r.verification), by_source: countBy(rows, r => r.source), by_failure_kind: countBy(repairs, r => r.failure_kind), by_target_sentences: countBy(repairs, r => r.target_sentences),
    by_decomposition_type: countBy(repairs, r => (r.decomposition ? r.decomposition_type : 'not_a_decomposition')), tokens_total: rows.length ? percentiles(rows.map(r => r.tokens.total)) : null};
}

/** Flat file, tokens and audit rows of the pairs of one split: {flatRows, auditRows}; `tokenOf(id)` -> [prompt, total]. */
export function auditRows(out, split, tokenOf) {
  const pairs = all(out, split).sort((a, b) => a.flat.id.localeCompare(b.flat.id));
  return {flatRows: pairs.map(p => p.flat), auditRows: pairs.map(p => ({...p.audit, tokens: {prompt: tokenOf(p.flat.id)[0], total: tokenOf(p.flat.id)[1]}}))};
}

/** Writes the train/dev pair files and the manifest; returns {manifest, summary}. */
export function writePairs({allowExtra = new Set(), integrityReport, out, notes, leakDropped, dedupDropped, identityRatio, verdictsSha, sealedInfo, meta, outDir = OUT_DIR, evidence = true}) {
  fs.mkdirSync(outDir, {recursive: true});
  const flatFiles = {train: path.join(outDir, 'train.jsonl'), dev: path.join(outDir, 'dev.jsonl')};
  const flats = {};
  for (const split of ['train', 'dev']) { flats[split] = all(out, split).sort((a, b) => a.flat.id.localeCompare(b.flat.id)).map(p => p.flat); writeJsonl(flatFiles[split], flats[split]); }
  const tokens = tokenLengths([flatFiles.train, flatFiles.dev]);
  const audit = {};
  for (const split of ['train', 'dev']) audit[split] = auditRows(out, split, id => tokens[flatFiles[split]][id]).auditRows;
  const auditAll = [...audit.train, ...audit.dev];
  writeJsonl(path.join(outDir, 'audit.jsonl'), auditAll);
  // projection for training/cli.mjs (`--data datasets/neuro_english/proofing --role proofreader` reads proofreader/{train,dev}.jsonl)
  const proj = path.join(outDir, 'proofreader');
  fs.mkdirSync(proj, {recursive: true});
  for (const split of ['train', 'dev']) fs.copyFileSync(flatFiles[split], path.join(proj, `${split}.jsonl`));
  const fileInfo = file => ({rows: fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length, sha256: sha256(fs.readFileSync(file))});
  const summary = {train: summarise(audit.train), dev: summarise(audit.dev), test: sealedInfo?.summary ?? null};
  const manifest = {
    format: 'chatsop-proofing-pairs-v1', dataset: 'neuro_english', model: 'SymbolicProofingLLM', role: 'proofreader', prompt_profile: 'message-only',
    prompt: 'row.prompt verbatim: the clean-English message and nothing else (DS021 message-only input, no instruction wrapper, no system role); training/python/common.py chat_ids()',
    target: 'row.target verbatim: the verified limited-English rewrite (repair) or the identical message (identity)',
    created: new Date().toISOString(), training_authorized: false, review_status: 'not_reviewed', identity_ratio: identityRatio, include_extra: [...allowExtra],
    files: {'train.jsonl': fileInfo(flatFiles.train), 'dev.jsonl': fileInfo(flatFiles.dev), 'audit.jsonl': fileInfo(path.join(outDir, 'audit.jsonl')), 'proofreader/train.jsonl': fileInfo(path.join(proj, 'train.jsonl')), 'proofreader/dev.jsonl': fileInfo(path.join(proj, 'dev.jsonl'))},
    sealed_test: sealedInfo ? {path: sealedInfo.path, rows: sealedInfo.rows, sha256: sealedInfo.sha256} : null,
    summary, dropped: {leaks_against_sealed_texts: leakDropped, duplicate_prompts: dedupDropped}, composed_hook: notes, verdicts_sha256: verdictsSha, ...meta,
  };
  writeJson(path.join(outDir, 'manifest.json'), manifest);
  writeJson(path.join(proj, 'manifest.json'), {format: 'chatsop-proofreader-projection-v1', corpus: 'neuro_english/proofing', prompt_profile: 'message-only', created: manifest.created, training_authorized: false, review_status: 'not_reviewed', note: 'Byte-identical copies of ../train.jsonl and ../dev.jsonl in the layout training/cli.mjs expects for the role proofreader.', files: {'proofreader/train.jsonl': manifest.files['proofreader/train.jsonl'], 'proofreader/dev.jsonl': manifest.files['proofreader/dev.jsonl']}});
  fs.writeFileSync(path.join(outDir, 'VERSION'), JSON.stringify(versionRecord(manifest, meta)) + '\n');
  const testTokens = sealedInfo?.tokens ?? null;
  if (evidence) writeJson(path.join(WORK, 'integrity.json'), integrityReport);
  if (evidence) writeJson(path.join(WORK, 'token-audit.json'), {generated_at: manifest.created, tokenizer: 'Gemma 3 (models/gemma/bases/99073d6b..., chat template of training/python/common.py chat_ids)', train: summary.train.tokens_total, dev: summary.dev.tokens_total, test: summary.test?.tokens_total ?? null,
    over_2048: Object.values(tokens).flatMap(m => Object.values(m)).filter(([, t]) => t > 2048).length + (testTokens?.over_2048 ?? 0)});
  return {manifest, summary};
}

/** VERSION record in the shape training/cli.mjs requires (`counter` and `label`), with the fields this pipeline always wrote (`dataset`, `version`, `rules`). */
export function versionRecord(manifest, meta) {
  const version = `${new Date().toISOString().slice(0, 10)}-${manifest.files['train.jsonl'].sha256.slice(0, 8)}`;
  return {format: 'chatsop-dataset-version-v1', corpus: 'neuro_english/proofing', counter: 1, label: `neuro_english/proofing ${version} (rules ${meta.rules_version ?? 'unknown'}, oracle-verified pairs)`, dataset: 'neuro_english/proofing', version, rules: meta.rules_version ?? null};
}
