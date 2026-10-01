#!/usr/bin/env node
/** RO arm of experiment proofing-candidates-v1 (dataset_proofing): the owner's target pipeline for a Romanian
 * message is message -> SymbolicLM translates to English -> the small LLM proofreads the English -> SymbolicLM
 * parses English and emits SOP (deviation D2 of status/preregistrations/proofing-candidates-v1.json). This module
 * reuses the frozen-rules oracle, `protect`, meaning `checks` and the candidate table of tools/research/proofing.mjs,
 * but scores the SymbolicLM ENGLISH TRANSLATION of a Romanian row (and its optional proofread rewrite), not the raw
 * Romanian text, and compares that arbiter score with the row's own direct-Romanian baseline (already computed by
 * `proofing.mjs baseline`). The English text is judged only by the frozen UD-to-SOP oracle: the SymbolicLM
 * translation vs direct comparison itself is eval-symbolic-lm-v1's job, not this file's.
 *
 *   node tools/research/proofing-ro.mjs translate [--threads 8]                 # dump RO rows, run SymbolicLM toEnglish (CPU)
 *   node tools/research/proofing-ro.mjs score-translated [--rules v1.4]         # oracle of the untouched translation
 *   node tools/research/proofing-ro.mjs generate --cond qwen3-1.7b:proof [--batch 48]   # proofread the translation (GPU)
 *   node tools/research/proofing-ro.mjs score --cond qwen3-1.7b:proof [--rules v1.4]    # oracle of the proofread text
 *   node tools/research/proofing-ro.mjs compare [--rules v1.4] [--cond qwen3-1.7b:proof] # direct RO vs translate-only vs translate+proofread
 *   node tools/research/proofing-ro.mjs build --cond qwen3-1.7b:proof [--rules v1.4]     # RO portion of datasets_archive/proofing (pipeline: translate)
 *
 * Scope: the same 10,142 monolingual Romanian in-scope rows of datasets_archive/formalizer-v1 train+dev as the direct-RO
 * baseline (code_switch rows excluded). Outputs under eval/reports/current/proofing/ro/.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {loadFrozenRules, ParseCache, OUT, ROOT, readJsonl, writeJsonl, writeJson} from './proofing-oracle.mjs';
import {corpusRows, inScope, protectText, checks, charEdit, cleanOutput, oracle, readBaseline, CANDIDATES, PROMPTS, DEFAULT_RULES, bootstrap} from './proofing.mjs';

const RO_OUT = path.join(OUT, 'ro');
const RO_CACHE = path.join(RO_OUT, 'cache');
const PY = path.join(os.homedir(), 'nlp-venv/bin/python');
const TRANSLATED = path.join(OUT, 'ro-translated.jsonl');
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const wilson = (k, n) => { if (!n) return [null, null]; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; };
function argumentsOf(argv) { const [command, ...rest] = argv; const args = {command}; for (let i = 0; i < rest.length; i++) { const key = rest[i].replace(/^--/, ''); args[key] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; } return args; }

/** In-scope Romanian rows, in the same order every time. */
export const roRows = () => corpusRows().filter(r => inScope(r) && r.language === 'ro');
/** SymbolicLM English translation of every in-scope RO row: Map id -> {message, english, language, untranslated}. */
export function readTranslated() {
  if (!fs.existsSync(TRANSLATED)) throw Error(`run "translate" first (missing ${TRANSLATED})`);
  return new Map(readJsonl(TRANSLATED).map(r => [r.id, r]));
}

async function translateCommand(args) {
  const rows = roRows();
  writeJsonl(path.join(OUT, 'ro-rows.jsonl'), rows.map(r => ({id: r.id, question: r.question})));
  const threads = String(args.threads ?? 8);
  execFileSync(process.execPath, [path.join(ROOT, 'tools/symbolic-lm.mjs'), 'english', '--in', path.join(OUT, 'ro-rows.jsonl'), '--out', TRANSLATED, '--field', 'question', '--threads', threads],
    {cwd: ROOT, stdio: 'inherit', env: {...process.env, CUDA_VISIBLE_DEVICES: ''}});
}

/** Oracle of the untouched SymbolicLM translation: cached per rules version. */
export async function scoreTranslated(rules, cache = null) {
  const file = path.join(RO_CACHE, `translate-only-${rules.version}.jsonl`);
  const have = new Map(readJsonl(file).map(r => [r.id, r]));
  const translated = readTranslated();
  const byId = new Map(roRows().map(r => [r.id, r]));
  const todo = [...byId.keys()].filter(id => !have.has(id));
  const own = !cache;
  cache ??= new ParseCache(rules);
  for (let i = 0; i < todo.length; i += 4000) {
    const part = todo.slice(i, i + 4000);
    const res = await oracle(rules, part.map(id => ({row: byId.get(id), text: translated.get(id).english})), 'ro-translate-only-' + rules.version, cache);
    const recs = part.map((id, j) => ({id, strict: res[j].strict, tolerant: res[j].tolerant, sop: res[j].sop, unparsed: res[j].unparsed}));
    fs.appendFileSync(file, recs.map(r => JSON.stringify(r)).join('\n') + '\n');
    for (const r of recs) have.set(r.id, r);
  }
  if (own) await cache.stop();
  return have;
}
async function scoreTranslatedCommand(args) {
  const rules = await loadFrozenRules(String(args.rules ?? DEFAULT_RULES));
  const have = await scoreTranslated(rules);
  console.log(`translate-only ${rules.version}: strict ${(mean([...have.values()].map(r => (r.strict ? 1 : 0))) * 100).toFixed(1)}% of ${have.size} RO rows`);
}

const condDir = cond => path.join(RO_CACHE, 'rewrites', cond.replace(':', '__'));
export function readRoRewrites(cond) { return new Map(readJsonl(path.join(condDir(cond), 'rewrites.jsonl')).map(r => [r.id, r])); }

/** Proofread the SymbolicLM translation with one candidate (protect -> LLM -> restore), same GPU path as proofing.mjs generate(). */
async function generateCommand(args) {
  const cond = String(args.cond);
  const [cand, prompt] = cond.split(':');
  const spec = CANDIDATES[cand];
  if (!spec || spec.kind !== 'llm') throw Error('unknown or non-LLM candidate ' + cand);
  const rules = await loadFrozenRules(DEFAULT_RULES); // protect() is rule-version independent text protection
  const translated = readTranslated();
  const dir = condDir(cond);
  fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, 'rewrites.jsonl');
  const have = new Set(readJsonl(file).map(r => r.id));
  const rows = roRows().filter(r => !have.has(r.id));
  if (!rows.length) { console.log(`${cond}: nothing to do (${have.size} cached)`); return; }
  const prepared = rows.map(row => ({row, p: protectText(rules, translated.get(row.id).english)}));
  const tmpIn = path.join(dir, '_in.jsonl'), tmpOut = path.join(dir, '_out.jsonl');
  const promptFile = path.join(dir, 'prompt.txt');
  fs.writeFileSync(promptFile, PROMPTS[prompt]);
  writeJsonl(tmpIn, prepared.map(x => ({id: x.row.id, text: x.p.text})));
  const t0 = performance.now();
  execFileSync(PY, [path.join(ROOT, 'training/python/proofread_llm.py'), '--model', path.join(ROOT, spec.dir), '--prompt-file', promptFile, '--in', tmpIn, '--out', tmpOut, '--device', 'cuda', '--batch', String(args.batch ?? 48)],
    {stdio: ['ignore', 'ignore', 'inherit']});
  const outs = new Map(readJsonl(tmpOut).map(o => [o.id, o]));
  const wall = (performance.now() - t0) / 1000;
  const records = prepared.map(x => {
    const o = outs.get(x.row.id);
    const r = rules.protect.restore(cleanOutput(o.output), x.p.slots);
    return {id: x.row.id, cond, protected: x.p.text, output: o.output, text: r.text, preserved: r.preserved, dropped: r.dropped, invented: r.invented, in_tokens: o.in_tokens ?? null, out_tokens: o.out_tokens ?? null, ms: o.ms ?? null};
  });
  fs.appendFileSync(file, records.map(r => JSON.stringify(r)).join('\n') + '\n');
  fs.rmSync(tmpIn, {force: true}); fs.rmSync(tmpOut, {force: true});
  process.stderr.write(`${cond}: ${records.length} RO-translated rewrites in ${wall.toFixed(1)} s\n`);
}

/** Oracle of a condition's proofread translation, cached per (cond, rules version). */
export async function scoreRoCondition(rules, cond, cache = null) {
  const file = path.join(condDir(cond), `oracle-${rules.version}.jsonl`);
  const have = new Map(readJsonl(file).map(r => [r.id, r]));
  const rewrites = readRoRewrites(cond);
  const byId = new Map(roRows().map(r => [r.id, r]));
  const todo = [...rewrites.keys()].filter(id => !have.has(id));
  const own = !cache;
  cache ??= new ParseCache(rules);
  for (let i = 0; i < todo.length; i += 4000) {
    const part = todo.slice(i, i + 4000);
    const res = await oracle(rules, part.map(id => ({row: byId.get(id), text: rewrites.get(id).text})), 'ro-' + cond.replace(':', '__') + '-' + rules.version, cache);
    const recs = part.map((id, j) => ({id, strict: res[j].strict, tolerant: res[j].tolerant, sop: res[j].sop}));
    fs.appendFileSync(file, recs.map(r => JSON.stringify(r)).join('\n') + '\n');
    for (const r of recs) have.set(r.id, r);
  }
  if (own) await cache.stop();
  return have;
}
async function scoreCommand(args) {
  const rules = await loadFrozenRules(String(args.rules ?? DEFAULT_RULES));
  const cond = String(args.cond);
  const have = await scoreRoCondition(rules, cond, null);
  console.log(`${cond} ${rules.version}: strict ${(mean([...have.values()].map(r => (r.strict ? 1 : 0))) * 100).toFixed(1)}% of ${have.size} RO rows`);
}

const pct = (x, d = 1) => (x === null || x === undefined ? '–' : (x * 100).toFixed(d));
const ci = c => (c && c[0] !== null ? `[${pct(c[0])},${pct(c[1])}]` : '');
/** Direct Romanian parsing vs the SymbolicLM English translation, untouched and proofread (paired on the same rows). */
async function compareCommand(args) {
  const version = String(args.rules ?? DEFAULT_RULES);
  const rules = await loadFrozenRules(version);
  const cond = args.cond ? String(args.cond) : null;
  const direct = readBaseline(version);
  const translateOnly = await scoreTranslated(rules);
  const proofread = cond ? await scoreRoCondition(rules, cond, null) : null;
  const rows = roRows();
  const clusters = f => { const m = new Map(); for (const r of rows) { const k = r.semantic_case_id; if (!m.has(k)) m.set(k, []); m.get(k).push(f(r)); } return [...m.values()]; };
  const rateOf = (map, key) => { const xs = rows.map(r => (map.get(r.id)?.[key] ? 1 : 0)); const k = xs.reduce((a, b) => a + b, 0); return {rate: k / rows.length, ci: wilson(k, rows.length)}; };
  const netOf = (a, b, key) => { const pairs = clusters(r => [a.get(r.id)?.[key] ? 1 : 0, b.get(r.id)?.[key] ? 1 : 0]); const delta = mean(rows.map(r => (b.get(r.id)?.[key] ? 1 : 0) - (a.get(r.id)?.[key] ? 1 : 0))); return {delta, ci: bootstrap(pairs)}; };
  const d = rateOf(direct, 'strict'), t = rateOf(translateOnly, 'strict'), p = proofread ? rateOf(proofread, 'strict') : null;
  const dt = netOf(direct, translateOnly, 'strict');
  console.log(`Romanian arbiter score (rules ${version}, n=${rows.length}):`);
  console.log(`  direct RO parse             ${pct(d.rate)} ${ci(d.ci)}`);
  console.log(`  translate -> EN (untouched) ${pct(t.rate)} ${ci(t.ci)}  Δ vs direct ${pct(dt.delta)} ${ci(dt.ci)}`);
  let tp = null, dp = null;
  if (proofread) { tp = netOf(translateOnly, proofread, 'strict'); dp = netOf(direct, proofread, 'strict'); console.log(`  translate -> proofread(${cond}) -> EN ${pct(p.rate)} ${ci(p.ci)}  Δ vs translate-only ${pct(tp.delta)} ${ci(tp.ci)}  Δ vs direct ${pct(dp.delta)} ${ci(dp.ci)}`); }
  return {version, rows: rows.length, direct: d, translate_only: t, translate_vs_direct: dt, translate_proofread: p, proofread_vs_translate_only: tp, proofread_vs_direct: dp, cond};
}

/** RO portion of datasets_archive/proofing: input/target are English (the translation, proofread if that repairs it),
 * tagged pipeline "translate" and source_language "ro" so the two arms never mix silently. */
async function buildCommand(args) {
  const version = String(args.rules ?? DEFAULT_RULES);
  const cond = String(args.cond ?? 'qwen3-1.7b:proof');
  const rules = await loadFrozenRules(version);
  const translated = readTranslated();
  const translateOnly = await scoreTranslated(rules);
  const proofread = await scoreRoCondition(rules, cond, null);
  const rewrites = readRoRewrites(cond);
  const out = roRows().map(row => {
    const t = translated.get(row.id), enRow = {...row, language: 'en'};
    const tOk = translateOnly.get(row.id);
    if (tOk?.strict) return {row, kind: 'identity', input: t.english, target: t.english, target_oracle: tOk, edit: 0};
    const w = rewrites.get(row.id), p = proofread.get(row.id);
    if (w && p?.strict) {
      const c = checks(enRow, t.english, w.text, w);
      if (c.ok) return {row, kind: 'repair', input: t.english, target: w.text, source: cond, target_oracle: p, checks: c, edit: charEdit(t.english, w.text)};
    }
    return {row, kind: 'hard', input: t.english, target: null};
  });
  const {writeJsonlShardedSync} = await import('../../lib/jsonl-shards.mjs');
  const direct = readBaseline(version);
  const rowOut = r => ({id: 'proof_ro_' + r.row.id, source_corpus: 'formalizer-v1', source_id: r.row.id, split_group_id: r.row.split_group_id, semantic_case_id: r.row.semantic_case_id,
    split: r.row.split === 'train' ? 'train' : 'dev', language: 'en', source_language: 'ro', pipeline: 'translate',
    input: r.input, target: r.target, kind: r.kind, target_source: r.kind === 'repair' ? r.source : r.kind === 'identity' ? 'symbolic-lm-translation' : null,
    question_type: r.row.question_type, untranslated: translated.get(r.row.id).untranslated,
    raw_oracle: {rules: version, direct_ro_strict: direct.get(r.row.id)?.strict ?? null},
    target_oracle: r.target ? {rules: version, strict: r.target_oracle.strict, tolerant: r.target_oracle.tolerant} : null,
    char_edit: r.edit ?? null, meaning_checks: r.checks ?? null,
    quality_flags: {synthetic: true, human_reviewed: false, training_approved: false, source_rows_copied: false},
    rights: {input: 'SymbolicLM English translation of a formalizer-v1 message (MIT; owner-released-inspired-by)', target: r.kind === 'repair' ? `model output of ${CANDIDATES[cond.split(':')[0]]?.repo} (${CANDIDATES[cond.split(':')[0]]?.licence}), oracle-filtered` : r.kind === 'identity' ? 'identical to the SymbolicLM translation' : null}});
  const rows = out.map(rowOut);
  const dir = path.join(ROOT, 'datasets_archive/proofing');
  writeJsonlShardedSync(path.join(dir, 'ro_translated.jsonl'), rows.sort((a, z) => a.id.localeCompare(z.id)));
  const stats = {rules: version, cond, rows: rows.length, by_kind: rows.reduce((a, r) => { a[r.kind] = (a[r.kind] ?? 0) + 1; return a; }, {})};
  writeJson(path.join(RO_OUT, `build-${version}.json`), stats);
  console.log(JSON.stringify(stats, null, 1));
}

const COMMANDS = {translate: translateCommand, 'score-translated': scoreTranslatedCommand, generate: generateCommand, score: scoreCommand, compare: compareCommand, build: buildCommand};
async function main() {
  const args = argumentsOf(process.argv.slice(2));
  const command = COMMANDS[args.command];
  if (!command) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 15).join('\n')); return; }
  await command(args);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.stack); process.exit(1); });
