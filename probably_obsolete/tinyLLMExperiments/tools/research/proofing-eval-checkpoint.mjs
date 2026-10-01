#!/usr/bin/env node
/** Evaluates a message-only causal-LM checkpoint (a fine-tuned `proofreader`, or a zero-shot base for a reference
 * arm) on datasets_archive/proofing rows with the SAME frozen-rules oracle used to build the corpus, reusing
 * tools/research/proofing.mjs's oracle()/checks()/charEdit()/bootstrap() and tools/research/proofing-oracle.mjs's
 * loadFrozenRules/ParseCache/convertAll/scoreRows. Not a copy of the oracle: every score comes from those same
 * exports, called on rows outside their usual scope (the sealed proofing test and a stratified dev sample), which
 * tools/research/proofing.mjs's own generate/score commands do not cover (they are scoped to formalizer-v1 pilot
 * stages only). Experiment train-proofreader-gemma270m-v1.
 *
 * A fine-tuned checkpoint is generated message-only (training/python/generate_causal.py: the user turn is the row's
 * `input` verbatim, no instruction wrapper, matching training/python/common.py chat_ids()); a zero-shot reference
 * base is generated with tools/research/proofing.mjs's own PROMPTS.proof wrapper (training/python/proofread_llm.py),
 * exactly like the candidate comparison this run compares against.
 *
 *   node tools/research/proofing-eval-checkpoint.mjs sample --model DIR [--mode finetuned|zero-shot] --n 100 --seed 20260930 --out FILE.json
 *   node tools/research/proofing-eval-checkpoint.mjs test   --model DIR [--mode finetuned|zero-shot] --out FILE.json [--limit N] [--include-hard]
 *   node tools/research/proofing-eval-checkpoint.mjs cached-test --cond qwen3-1.7b:proof --out FILE.json [--include-hard]   # reuse an existing full-corpus cache, filtered to the sealed test ids
 *
 * `--include-hard` scores the FULL sealed test (1,135 rows: identity 518, repair 142, hard 475) instead of the
 * default 660 non-hard rows (identity+repair only). Hard rows are rows no candidate in proofing-candidates-v1 ever
 * repaired (report.md §4's ceiling analysis); they are always raw_oracle.strict=false and are almost never repaired
 * by a new checkpoint either, so including them lowers repair_rate's denominator advantage and net_delta versus the
 * conditional (non-hard-only) number reported by train-proofreader-gemma270m-v1 — this is the natural-distribution,
 * unconditional number (experiment eval-proofreader-e2e-v1).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {loadFrozenRules, ROOT, OUT, readJsonl, writeJsonl, sha} from './proofing-oracle.mjs';
import {oracle, corpusRows, checks, charEdit, bootstrap, PROMPTS, cleanOutput} from './proofing.mjs';

const PY = path.join(os.homedir(), 'nlp-venv/bin/python');
const RULES_VERSION = 'v1.4';
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const squash = s => String(s).replace(/\s+/g, ' ').trim();
function args(argv) {
  const [command, ...rest] = argv, out = {command};
  for (let i = 0; i < rest.length; i++) { const key = rest[i].replace(/^--/, ''); out[key] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; }
  return out;
}
function mulberry(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Stratified pick of n rows from datasets_archive/proofing/dev.jsonl, proportional by kind (identity/repair; this dev file
 * is EN-only, see report.md §5), seed-fixed, sorted by id for reproducibility. */
function stratifiedDevSample(n, seed) {
  const rows = readJsonlShardedSync(path.join(ROOT, 'datasets_archive/proofing/dev.jsonl'));
  const strata = new Map();
  for (const row of rows) { const k = row.kind; if (!strata.has(k)) strata.set(k, []); strata.get(k).push(row); }
  const keys = [...strata.keys()].sort();
  const quota = new Map(keys.map(k => [k, n * strata.get(k).length / rows.length]));
  const take = new Map(keys.map(k => [k, Math.floor(quota.get(k))]));
  let remaining = n - [...take.values()].reduce((a, b) => a + b, 0);
  for (const k of [...keys].sort((a, b) => (quota.get(b) - take.get(b)) - (quota.get(a) - take.get(a))).slice(0, remaining)) take.set(k, take.get(k) + 1);
  const rand = mulberry(seed), picked = [];
  for (const k of keys) { const pool = [...strata.get(k)]; for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; } picked.push(...pool.slice(0, take.get(k))); }
  return picked.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Runs a checkpoint (finetuned: message-only; zero-shot: proof-prompt wrapper) over `rows` (each has .id, .input),
 * returns Map id -> {text, ms, out_tokens, truncated}. */
function generate(model, rows, mode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proofing-eval-'));
  const tmpIn = path.join(dir, 'in.jsonl'), tmpOut = path.join(dir, 'out.jsonl');
  writeJsonl(tmpIn, rows.map(r => ({id: r.id, text: r.input})));
  if (mode === 'zero-shot') {
    const promptFile = path.join(dir, 'prompt.txt');
    fs.writeFileSync(promptFile, PROMPTS.proof);
    execFileSync(PY, [path.join(ROOT, 'training/python/proofread_llm.py'), '--model', model, '--prompt-file', promptFile, '--in', tmpIn, '--out', tmpOut, '--device', 'cuda', '--batch', '32'], {stdio: ['ignore', 'ignore', 'inherit']});
  } else {
    execFileSync(PY, [path.join(ROOT, 'training/python/generate_causal.py'), '--model', model, '--in', tmpIn, '--out', tmpOut, '--device', 'cuda', '--batch', '32'], {stdio: ['ignore', 'ignore', 'inherit']});
  }
  const outs = new Map(readJsonl(tmpOut).map(o => [o.id, o]));
  const texts = new Map(rows.map(r => { const o = outs.get(r.id); const text = mode === 'zero-shot' ? cleanOutput(o.output) : String(o.output ?? '').trim(); return [r.id, {text, ms: o.ms ?? null, out_tokens: o.out_tokens ?? null, truncated: o.truncated ?? false}]; }));
  fs.rmSync(dir, {recursive: true, force: true});
  return texts;
}

/** Oracle-scores `rows` (sealed-test/dev schema, with source_id) against `texts` (Map id -> {text}); returns
 * per-row records plus break/repair/net/meaning metrics, matching tools/research/proofing.mjs metricsOf's shape. */
async function scoreAndReport(rows, texts, label) {
  const rules = await loadFrozenRules(RULES_VERSION);
  const byFv1Id = new Map(corpusRows().map(r => [r.id, r]));
  const items = rows.map(row => { const source = byFv1Id.get(row.source_id); if (!source) throw Error(`${row.id}: source row ${row.source_id} not found in formalizer-v1`); return {row: source, text: texts.get(row.id).text}; });
  const scored = await oracle(rules, items, label);
  const records = rows.map((row, i) => ({id: row.id, kind: row.kind, language: row.language, raw_strict: row.raw_oracle.strict, new_strict: scored[i].strict, new_tolerant: scored[i].tolerant,
    gate_no_spacy: row.signals?.gate_no_spacy ?? null, meaning: checks(row, row.input, texts.get(row.id).text, null), char_edit: charEdit(row.input, texts.get(row.id).text),
    identity: squash(texts.get(row.id).text) === squash(row.input), out_tokens: texts.get(row.id).out_tokens, ms: texts.get(row.id).ms, truncated: texts.get(row.id).truncated}));
  const report = (gate) => {
    const all = gate ? records.map(r => ({...r, effective_strict: r.gate_no_spacy ? r.new_strict : r.raw_strict})) : records.map(r => ({...r, effective_strict: r.new_strict}));
    const ok = all.filter(r => r.raw_strict), bad = all.filter(r => !r.raw_strict);
    const broken = ok.filter(r => !r.effective_strict).length, repaired = bad.filter(r => r.effective_strict).length;
    const clusters = all.map(r => [r.raw_strict ? 1 : 0, r.effective_strict ? 1 : 0]).map(pair => [pair]);
    return {rows: all.length, ok_rows: ok.length, failing_rows: bad.length, broken, repaired,
      break_rate: ok.length ? broken / ok.length : null, repair_rate: bad.length ? repaired / bad.length : null,
      net_delta: mean(all.map(r => (r.effective_strict ? 1 : 0) - (r.raw_strict ? 1 : 0))), net_ci95: bootstrap(clusters),
      identity_share: mean(all.map(r => (r.identity ? 1 : 0))), meaning_ok: mean(all.map(r => (r.meaning.ok ? 1 : 0))),
      mean_out_tokens: mean(all.map(r => r.out_tokens ?? 0)), mean_char_edit: mean(all.map(r => r.char_edit))};
  };
  return {label, rows: records.length, always_on: report(false), gate_no_spacy: report(true), records};
}

async function main() {
  const o = args(process.argv.slice(2));
  if (o.command === 'cached-test') {
    const cache = new Map(readJsonl(path.join(OUT, 'cache', 'rewrites', o.cond.replace(':', '__'), `oracle-${RULES_VERSION}.jsonl`)).map(r => [r.id, r]));
    const rewrites = new Map(readJsonl(path.join(OUT, 'cache', 'rewrites', o.cond.replace(':', '__'), 'rewrites.jsonl')).map(r => [r.id, r]));
    let test = readJsonlShardedSync(path.join(ROOT, 'eval/suites/proofing/test.jsonl'));
    if (!o['include-hard']) test = test.filter(r => r.kind !== 'hard');
    const missing = test.filter(r => !cache.has(r.source_id));
    const records = test.filter(r => cache.has(r.source_id)).map(row => { const s = cache.get(row.source_id), w = rewrites.get(row.source_id);
      return {id: row.id, kind: row.kind, language: row.language, raw_strict: row.raw_oracle.strict, new_strict: s.strict, new_tolerant: s.tolerant,
        gate_no_spacy: row.signals?.gate_no_spacy ?? null, identity: w ? squash(w.text) === squash(row.input) : null, char_edit: w ? charEdit(row.input, w.text) : null}; });
    const ok = records.filter(r => r.raw_strict), bad = records.filter(r => !r.raw_strict);
    const broken = ok.filter(r => !r.new_strict).length, repaired = bad.filter(r => r.new_strict).length;
    const clusters = records.map(r => [[r.raw_strict ? 1 : 0, r.new_strict ? 1 : 0]]);
    const out = {label: o.cond, rows: records.length, missing_from_cache: missing.length, always_on: {rows: records.length, ok_rows: ok.length, failing_rows: bad.length, broken, repaired,
      break_rate: ok.length ? broken / ok.length : null, repair_rate: bad.length ? repaired / bad.length : null, net_delta: mean(records.map(r => (r.new_strict ? 1 : 0) - (r.raw_strict ? 1 : 0))), net_ci95: bootstrap(clusters)}, records};
    fs.mkdirSync(path.dirname(path.resolve(o.out)), {recursive: true});
    fs.writeFileSync(path.resolve(o.out), JSON.stringify(out, null, 1) + '\n');
    console.log(JSON.stringify({label: o.cond, rows: out.rows, missing_from_cache: out.missing_from_cache, always_on: out.always_on.break_rate !== undefined ? {break_rate: out.always_on.break_rate, repair_rate: out.always_on.repair_rate, net_delta: out.always_on.net_delta} : null}));
    return;
  }
  const mode = o.mode || 'finetuned';
  let rows;
  if (o.command === 'sample') rows = stratifiedDevSample(Number(o.n ?? 100), Number(o.seed ?? 20260930));
  else if (o.command === 'test') { rows = readJsonlShardedSync(path.join(ROOT, 'eval/suites/proofing/test.jsonl')); if (!o['include-hard']) rows = rows.filter(r => r.kind !== 'hard'); if (o.limit) rows = rows.slice(0, Number(o.limit)); }
  else throw Error(`Unknown command ${o.command}`);
  const model = path.isAbsolute(o.model) || o.model.startsWith('.') ? path.resolve(o.model) : path.join(ROOT, o.model);
  const texts = generate(model, rows, mode);
  const report = await scoreAndReport(rows, texts, `checkpoint-${o.command}-${Date.now()}`);
  fs.mkdirSync(path.dirname(path.resolve(o.out)), {recursive: true});
  fs.writeFileSync(path.resolve(o.out), JSON.stringify(report, null, 1) + '\n');
  console.log(JSON.stringify({rows: report.rows, always_on: report.always_on, gate_no_spacy: report.gate_no_spacy}, null, 1));
}

main().catch(error => { console.error(error.stack); process.exit(1); });
