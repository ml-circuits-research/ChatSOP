#!/usr/bin/env node
/** Training projection of bad_english for LanguageProofingLLM (experiment train-language-proofing-gemma270m-it1), role id `proofreader`.
 *
 *   node tools/datasets/build-language-proofing.mjs [--identity-ratio 0.1] [--seed 20260930] [--max-tokens 2048] [--out datasets/bad_english/proofing]
 *
 * One sentence-level message -> its clean-English target (tools/datasets/language-proofing/pairs.mjs), from datasets/bad_english/{train,dev}.jsonl;
 * rows without a target (including the ones DeepSeek marked unfixable) are skipped. A small share of identity pairs (clean English -> itself)
 * comes from datasets/symbolic_english/{train,dev}.jsonl. Writes `{train,dev}.jsonl`, `proofreader/{train,dev}.jsonl` (flat {id, prompt, target, ...},
 * prompt = the sentence verbatim, message-only), `audit.jsonl`, `manifest.json`, `VERSION`, and eval/reports/current/language-proofing-it1/{token-audit,integrity,build-summary}.json.
 * Leakage: the sealed texts are known only as folded hashes (eval/reports/current/language-proofing-it1/sealed-hashes.json, written by
 * tools/eval/language-proofing-test.mjs); this tool never opens a sealed file. Token lengths: Gemma 3 tokenizer (training/python/pair_token_lengths.py).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {splitSentences} from '../../lib/sentence-split.mjs';
import {projectRow, hashText, countBy, norm} from './language-proofing/pairs.mjs';

// iteration 2 rebuilds the projection from the current bad_english files into its own folder (LP_WORK, LP_SEALED, --out), leaving the iteration-1 artifacts untouched
const WORK = path.resolve(ROOT, process.env.LP_WORK ?? 'eval/reports/current/language-proofing-it1');
const SEALED = path.resolve(ROOT, process.env.LP_SEALED ?? path.join(path.relative(ROOT, WORK), 'sealed-hashes.json'));
const args = argv => { const o = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; return o; };
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const pct = (xs, p) => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] : 0);
const dist = xs => ({n: xs.length, min: Math.min(...xs), p50: pct(xs, 0.5), p90: pct(xs, 0.9), p99: pct(xs, 0.99), max: Math.max(...xs)});

function main() {
  const o = args(process.argv.slice(2));
  const ratio = Number(o['identity-ratio'] ?? 0.1), seed = Number(o.seed ?? 20260930), maxTokens = Number(o['max-tokens'] ?? 2048);
  const outDir = path.resolve(ROOT, o.out ?? 'datasets/bad_english/proofing');
  const sealed = new Set(JSON.parse(fs.readFileSync(SEALED, 'utf8')).hashes);
  const src = name => path.join(ROOT, 'datasets', name);
  const rowsOf = (name, split) => readJsonlShardedSync(path.join(src(name), `${split}.jsonl`));
  const summary = {skipped: {train: {}, dev: {}}, dropped_by_problem: {}, sealed_leaks_dropped: 0, dev_prompt_dupes_dropped_from_dev: 0, duplicates_dropped: 0};
  const pairs = {train: [], dev: []}, inrow = {train: [], dev: []}, trainPrompts = new Set();
  // train first; a dev pair whose prompt is also a train prompt is dropped from dev (train keeps its diversity, dev stays novel)
  for (const split of ['train', 'dev']) {
    const seen = new Set();
    for (const row of rowsOf('bad_english', split)) {
      const res = projectRow(row);
      if (res.skipped) summary.skipped[split][res.skipped] = (summary.skipped[split][res.skipped] ?? 0) + 1;
      for (const d of res.dropped) for (const p of d.problems) { const k = p.replace(/:.*$/, ''); summary.dropped_by_problem[k] = (summary.dropped_by_problem[k] ?? 0) + 1; }
      for (const p of res.pairs) {
        const hp = hashText(p.prompt), ht = hashText(p.target);
        if (sealed.has(hp) || sealed.has(ht)) { summary.sealed_leaks_dropped++; continue; }
        if (split === 'dev' && trainPrompts.has(hp)) { summary.dev_prompt_dupes_dropped_from_dev++; continue; }
        if (seen.has(hp)) { summary.duplicates_dropped++; continue; }
        seen.add(hp);
        if (split === 'train') trainPrompts.add(hp);
        const entry = {...p, pair: 'repair', row_id: row.id, target_source: row.target_source, review_status: row.review_status};
        // a sentence already clean and unchanged inside a bad row is an identity example, pooled with the symbolic_english identity pool
        if (p.kind === 'clean') { entry.pair = 'identity'; entry.target_source = 'identity:in-row'; inrow[split].push(entry); } else pairs[split].push(entry);
      }
    }
  }
  summary.inrow_clean_pool = {train: inrow.train.length, dev: inrow.dev.length};
  // identity pairs: a fixed share of each split, half from clean sentences inside bad rows, half (or the rest) from symbolic_english
  const identitySnapshot = [], random = rng(seed), shuffle = list => { for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } return list; };
  for (const split of ['train', 'dev']) {
    const used = new Set([...pairs[split], ...inrow[split]].map(p => hashText(p.prompt)));
    const pool = rowsOf('symbolic_english', split).filter(r => r.message.length <= 300 && splitSentences(r.message).length === 1 && !used.has(hashText(r.message)) && !sealed.has(hashText(r.message)) && (split === 'train' ? true : !trainPrompts.has(hashText(r.message))));
    const want = Math.round(pairs[split].length * ratio / (1 - ratio)), fromRow = shuffle(inrow[split].slice()).slice(0, Math.floor(want / 2));
    const symbolic = shuffle(pool.slice()).slice(0, want - fromRow.length);
    pairs[split].push(...fromRow);
    for (const r of symbolic) identitySnapshot.push({id: r.id, split, message: r.message});
    for (const r of symbolic) pairs[split].push({id: r.id, prompt: r.message, target: r.message, kind: 'clean', row_kind: 'clean', sentences: 1, pair: 'identity', row_id: r.id, target_source: 'identity:symbolic_english', review_status: 'n/a'});
    summary[`identity_${split}`] = {wanted: want, from_bad_english_rows: fromRow.length, from_symbolic_english: symbolic.length, symbolic_pool: pool.length};
  }
  // deterministic order
  for (const split of ['train', 'dev']) pairs[split].sort((a, b) => hashText(a.id).localeCompare(hashText(b.id)));
  fs.mkdirSync(path.join(outDir, 'proofreader'), {recursive: true});
  fs.mkdirSync(WORK, {recursive: true});
  const flat = pair => ({id: pair.id, prompt: pair.prompt, target: pair.target, kind: pair.pair, language_kind: pair.kind, target_source: pair.target_source});
  // tokens
  const tmp = {};
  for (const split of ['train', 'dev']) { tmp[split] = path.join(WORK, `.tmp-${split}.jsonl`); fs.writeFileSync(tmp[split], pairs[split].map(p => JSON.stringify(flat(p))).join('\n') + '\n'); }
  const python = process.env.TRAIN_PYTHON ?? path.join(process.env.HOME, 'nlp-venv/bin/python'), tokOut = path.join(WORK, '.tmp-tokens.json');
  const r = spawnSync(python, ['training/python/pair_token_lengths.py', '--base', 'models/gemma/bases/99073d6b6edb0e298d163f964ec2b9d970b3408d', '--out', tokOut, tmp.train, tmp.dev], {cwd: ROOT, encoding: 'utf8', env: {...process.env, PYTHONPATH: path.join(ROOT, 'training/python')}});
  if (r.status !== 0) throw Error(`token lengths failed: ${r.stderr.slice(-400)}`);
  const lengths = JSON.parse(fs.readFileSync(tokOut, 'utf8'));
  let overBudget = 0;
  for (const split of ['train', 'dev']) {
    const table = lengths[tmp[split]];
    pairs[split] = pairs[split].filter(p => { p.tokens = {prompt: table[p.id][0], total: table[p.id][1]}; if (p.tokens.total > maxTokens) { overBudget++; return false; } return true; });
    fs.unlinkSync(tmp[split]);
  }
  fs.unlinkSync(tokOut);
  summary.over_token_budget_dropped = overBudget;
  const files = {};
  for (const split of ['train', 'dev']) {
    const body = pairs[split].map(p => JSON.stringify(flat(p))).join('\n') + '\n';
    for (const dir of [outDir, path.join(outDir, 'proofreader')]) fs.writeFileSync(path.join(dir, `${split}.jsonl`), body);
    files[`proofreader/${split}.jsonl`] = {rows: pairs[split].length, sha256: sha(path.join(outDir, 'proofreader', `${split}.jsonl`))};
  }
  fs.writeFileSync(path.join(outDir, 'identity-source.jsonl'), identitySnapshot.map(r => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(outDir, 'audit.jsonl'), ['train', 'dev'].flatMap(split => pairs[split].map(p => JSON.stringify({id: p.id, split, row_id: p.row_id, kind: p.pair, language_kind: p.kind, row_kind: p.row_kind, sentences_in_row: p.sentences, target_source: p.target_source, review_status: p.review_status, tokens: p.tokens}))).join('\n') + '\n');
  // integrity and leakage against the sealed hashes and across splits
  const ids = new Map(), twice = [];
  for (const split of ['train', 'dev']) for (const p of pairs[split]) { if (ids.has(p.id)) twice.push(p.id); ids.set(p.id, split); }
  const devP = new Set(pairs.dev.map(p => hashText(p.prompt)));
  const trainPromptsFinal = new Set(pairs.train.map(p => hashText(p.prompt)));
  let sealedExact = 0, trainDevPromptOverlap = 0;
  for (const split of ['train', 'dev']) for (const p of pairs[split]) for (const t of [p.prompt, p.target]) if (sealed.has(hashText(t))) sealedExact++;
  for (const p of pairs.train) if (devP.has(hashText(p.prompt))) trainDevPromptOverlap++;
  const integrity = {generated_at: new Date().toISOString(), pairs: {train: pairs.train.length, dev: pairs.dev.length}, ids_in_two_splits: twice.length, exact_matches: {train_dev_vs_sealed_texts: sealedExact}, train_prompts_also_in_dev: trainDevPromptOverlap, row_split_kept: true,
    note: 'exact matches after case, diacritic, punctuation and spacing folding; the sealed hashes cover the messages and targets of eval/suites/bad_english (test, test-composed components, proofing-test) and the identity messages of the sealed proofing test'};
  const tokenAudit = {generated_at: integrity.generated_at, tokenizer: 'Gemma 3 (models/gemma/bases/99073d6b..., chat template of training/python/common.py chat_ids)', max_tokens: maxTokens, over_2048: ['train', 'dev'].flatMap(s => pairs[s]).filter(p => p.tokens.total > 2048).length, train: dist(pairs.train.map(p => p.tokens.total)), dev: dist(pairs.dev.map(p => p.tokens.total)), prompt_train: dist(pairs.train.map(p => p.tokens.prompt)), dropped_over_budget: overBudget};
  fs.writeFileSync(path.join(WORK, 'integrity.json'), JSON.stringify(integrity, null, 1) + '\n');
  fs.writeFileSync(path.join(WORK, 'token-audit.json'), JSON.stringify(tokenAudit, null, 1) + '\n');
  const mix = split => ({pairs: pairs[split].length, by_pair: countBy(pairs[split], p => p.pair), by_kind: countBy(pairs[split], p => p.kind), by_row_kind: countBy(pairs[split], p => p.row_kind), by_target_source: countBy(pairs[split], p => p.target_source), by_review_status: countBy(pairs[split], p => p.review_status), sentences_in_row: countBy(pairs[split], p => (p.sentences > 5 ? '6+' : String(p.sentences)))});
  const buildSummary = {...summary, train: mix('train'), dev: mix('dev')};
  fs.writeFileSync(path.join(WORK, 'build-summary.json'), JSON.stringify(buildSummary, null, 1) + '\n');
  const source = {};
  for (const f of ['datasets/bad_english/manifest.json', 'datasets/bad_english/train.jsonl', 'datasets/bad_english/dev.jsonl']) source[f] = sha(path.join(ROOT, f));
  const symbolicAtBuild = {manifest_sha256: sha(path.join(ROOT, 'datasets/symbolic_english/manifest.json')), identity_source: 'identity-source.jsonl (the clean messages copied at build time; symbolic_english is being re-split by another agent)', identity_source_sha256: sha(path.join(outDir, 'identity-source.jsonl'))};
  const manifest = {format: 'chatsop-proofing-pairs-v1', dataset: 'bad_english', model: 'LanguageProofingLLM', role: 'proofreader', prompt_profile: 'message-only',
    prompt: 'row.prompt verbatim: one sentence of a Romanian, mixed or badly written English message and nothing else (DS021 message-only input, no instruction wrapper, no system role); training/python/common.py chat_ids()',
    target: 'row.target verbatim: the clean English sentence (repair) or the identical sentence (identity, clean English from symbolic_english)',
    created: integrity.generated_at, training_authorized: false, review_status: 'not_reviewed', identity_ratio: ratio, identity_seed: seed, source_sha256: source, symbolic_english_at_build: symbolicAtBuild, sealed_hashes_sha256: sha(SEALED),
    files, summary: buildSummary, note: 'Byte-identical copies of ../train.jsonl and ../dev.jsonl are in proofreader/ (the layout training/cli.mjs expects). Targets of rows of target_source llm:deepseek-flash are DeepSeek-written with review_status pending; mechanical checks only (names, numbers, quotes, negation, question marks, length ratio).'};
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  // projection manifest read by training/python/common.py read_training_rows (prompt_profile must be message-only)
  fs.writeFileSync(path.join(outDir, 'proofreader/manifest.json'), JSON.stringify({format: 'chatsop-proofreader-projection-v1', corpus: 'bad_english/proofing', prompt_profile: 'message-only', created: integrity.generated_at, training_authorized: false, review_status: 'not_reviewed',
    note: 'Byte-identical copies of ../train.jsonl and ../dev.jsonl in the layout training/cli.mjs expects for the role proofreader.', files}, null, 1) + '\n');
  const version = {format: 'chatsop-dataset-version-v1', corpus: 'bad_english/proofing', counter: 1, label: `bad_english/proofing ${integrity.generated_at.slice(0, 10)}-${files['proofreader/train.jsonl'].sha256.slice(0, 8)} (sentence pairs, ${pairs.train.length} train / ${pairs.dev.length} dev)`, dataset: 'bad_english/proofing', version: `${integrity.generated_at.slice(0, 10)}-${files['proofreader/train.jsonl'].sha256.slice(0, 8)}`};
  fs.writeFileSync(path.join(outDir, 'VERSION'), JSON.stringify(version) + '\n');
  console.log(JSON.stringify({out: path.relative(ROOT, outDir), ...buildSummary, tokens: {train: tokenAudit.train, dev: tokenAudit.dev, over_2048: tokenAudit.over_2048}, manifest_sha256: sha(path.join(outDir, 'manifest.json'))}, null, 1));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
