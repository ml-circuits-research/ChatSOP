#!/usr/bin/env node
/** Evaluation of LanguageProofingLLM checkpoints and baselines (experiment train-language-proofing-gemma270m-it1), natural-language and
 * grammatical-analysis layer only (owner direction 2026-09-30: no SOP translation in this layer).
 *
 *   node tools/eval/language-proofing-eval.mjs generate --split dev|test [--sample N] --name NAME (--model DIR [--prefix TEXT] | --identity | --url URL)
 *   node tools/eval/language-proofing-eval.mjs prepare  --split S [--sample N] --names a,b,c     # record parses, write the parse-judge items (then run the omp judge)
 *   node tools/eval/language-proofing-eval.mjs meaning-prepare --split S [--sample N] --names a,b,c   # meaning-judge items (then run the omp judge)
 *   node tools/eval/language-proofing-eval.mjs score    --split S [--sample N] --name NAME [--analysis true|false] [--meaning true]
 *   node tools/eval/language-proofing-eval.mjs compare  --split S [--sample N] --a NAME --b NAME
 *   node tools/eval/language-proofing-eval.mjs agree    --split S [--sample N] --a NAME --b NAME [--n 50]
 *
 * Splits: `dev` (datasets/bad_english/proofing/proofreader/dev.jsonl, selection only) and `test` (eval/suites/bad_english/proofing-test.jsonl, sealed,
 * read only here). `--sample N` is a stratified sample by (pair, kind), deterministic (seed 7). Every row is {id, prompt, target, pair: repair|identity, kind: ro|mixed|noisy_en|clean}.
 * Metrics per row: (a) clean-English gate of the output (tools/datasets/clean-english.mjs); (b) content preservation (names, numbers, quoted spans, question
 * marks, length ratio of tools/eval/bad-english-targets.mjs, plus negation parity); (c) chrF and token F1 against the reference; (d) analysis correctness (every
 * output sentence passes the calibrated gate: Stanza default = accurate trees AND the DeepSeek judge a and c good, tools/eval/analysis-layer.mjs); (e) identity:
 * clean input left untouched. `good` = (a) and (b) and (d). Outputs and scores: $LP_WORK/{outputs,scores}/ (default eval/reports/history/language-proofing-it1). Trains nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {loadSpellfix} from '../../lib/languages-util/spellfix.mjs';
import {defaultDictionary} from '../../sop/dictionary.mjs';
import {cleanEnglishGate} from '../datasets/clean-english.mjs';
import {pairProblems, norm, countBy} from '../datasets/language-proofing/pairs.mjs';
import {AnalysisLayer} from './analysis-layer.mjs';
import {readVerdicts} from '../datasets/neuro-oracle/judge.mjs';
import {renderFull, renderTree, judgeMessage, checkMessage} from '../research/parse-judge.mjs';
import {wilson} from './composed/stats.mjs';
import {textKey} from '../datasets/neuro-oracle/common.mjs';

// Iteration 1 is the default; iteration 2 sets LP_WORK=eval/reports/history/language-proofing-it2 and its own judge folders (verdicts of the iteration-1 folders are reused, they are keyed by text).
const envDir = (name, fallback) => path.resolve(ROOT, process.env[name] ?? fallback);
export const WORK = envDir('LP_WORK', 'eval/reports/history/language-proofing-it1');
export const JUDGE_DIR = envDir('LP_JUDGE_DIR', 'datasets_sources/language_proofing_parse_judge');
export const MEANING_DIR = envDir('LP_MEANING_DIR', 'datasets_sources/language_proofing_meaning_judge');
const OLD_JUDGE_DIR = path.join(ROOT, 'datasets_sources/language_proofing_parse_judge');
const OLD_MEANING_DIR = path.join(ROOT, 'datasets_sources/language_proofing_meaning_judge');
const V2 = 'datasets/bad_english/proofing-v2';
const MEANING_SOURCE_DIR = path.join(ROOT, 'datasets_sources/meaning_judge_calibration_v2');
const SYMBOLIC_JUDGE_DIR = path.join(ROOT, 'datasets_sources/symbolic_proofing_parse_judge');
const DEV_FILE = 'datasets/bad_english/proofing/proofreader/dev.jsonl';
const TEST_FILE = 'eval/suites/bad_english/proofing-test.jsonl';
const CLEAN_FILE = 'eval/suites/bad_english/proofing-test-clean.jsonl';
// iteration-2 selection sets (datasets/bad_english/proofing-v2): regular dev, back-generated dev, held-out vocabulary dev, keyboard-mash set
const V3 = 'datasets/bad_english/proofing-it3';
const P1 = 'datasets/bad_english/proofing-prod1';
// iteration-3 sets: `heldout3` (new unseen words), `heldout3id` (clean sentences that contain them), `spacing` (perturbed dev sentences); `heldout` is byte-identical in proofing-v2 and proofing-it3 (now the trained-vocabulary dev)
const V2_FILES = {dev2: `${V2}/proofreader/dev.jsonl`, devbg: `${V2}/dev-backgen.jsonl`, heldout: `${V2}/dev-heldout.jsonl`, mash: `${V2}/mash-eval.jsonl`, probe: 'eval/suites/bad_english/proofing-probe-child.jsonl', heldout3: `${V3}/dev-heldout-v3.jsonl`, heldout3id: `${V3}/dev-heldout-v3-identity.jsonl`, spacing: `${V3}/dev-spacing.jsonl`,
  // production build 1 (datasets/bad_english/proofing-prod1): the eight it3 probe words are TRAINED now, vocab8 is their dev slice; names = swaps of institution names; typochild = typo'd child words; vocabfresh = sentences written after the data was frozen
  vocab8: `${P1}/dev-vocab8.jsonl`, vocab8id: `${P1}/dev-vocab8-identity.jsonl`, names: `${P1}/dev-names.jsonl`, typochild: `${P1}/dev-typochild.jsonl`, spacing1: `${P1}/dev-spacing.jsonl`, mash1: `${P1}/mash-eval.jsonl`, vocabfresh: 'eval/suites/bad_english/proofing-probe-vocab.jsonl'};
const GENERATE = path.join(ROOT, 'training/python/generate_causal.py');
const PYTHON = process.env.GEN_PYTHON ?? path.join(process.env.HOME, 'nlp-venv/bin/python');
const readJsonl = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)) : []);
const writeJsonl = (file, rows) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n'); };
const args = argv => { const o = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; return o; };
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Rows of a split, optionally a stratified sample by (pair, kind) (largest-remainder proportional allocation, at least 1 per stratum). */
export function loadSplit(split, sample = null) {
  const file = path.join(ROOT, split === 'dev' ? DEV_FILE : split === 'test' ? TEST_FILE : split === 'testclean' ? CLEAN_FILE : V2_FILES[split] ?? (() => { throw Error(`unknown split ${split}`); })());
  const rows = readJsonl(file).map(r => ({id: r.id, prompt: r.prompt, target: r.target, pair: r.pair ?? r.kind, kind: r.kind === 'identity' || r.kind === 'repair' ? (r.language_kind ?? 'clean') : r.kind, target_source: r.target_source, has_ref: r.has_ref ?? true}));
  if (!sample || sample >= rows.length) return rows;
  const groups = new Map();
  for (const r of rows) { const k = `${r.pair}|${r.kind}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const random = rng(7), picked = [];
  const quota = new Map([...groups].map(([k, list]) => [k, Math.max(1, Math.round(sample * list.length / rows.length))]));
  for (const [k, list] of groups) {
    const order = list.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    picked.push(...order.slice(0, quota.get(k)).map(i => list[i]));
  }
  const keep = new Set(picked.map(r => r.id));
  return rows.filter(r => keep.has(r.id));
}
const tag = (split, sample) => (sample ? `${split}${sample}` : split);
const inputFile = t => path.join(WORK, `inputs-${t}.jsonl`);
const outputFile = (name, t) => path.join(WORK, 'outputs', `${name}__${t}.jsonl`);
const scoreFile = (name, t) => path.join(WORK, 'scores', `${name}__${t}.json`);

async function generateEndpoint(rows, url, out, {maxTokens = 400} = {}) {
  const records = [];
  for (const r of rows) {
    const t0 = Date.now();
    const res = await fetch(`${url.replace(/\/$/, '')}/v1/chat/completions`, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({model: 'proofreader', messages: [{role: 'user', content: r.prompt}], temperature: 0, top_k: 1, seed: 0, cache_prompt: false, max_tokens: maxTokens})});
    if (!res.ok) throw Error(`endpoint ${res.status}`);
    const data = await res.json(), choice = data.choices?.[0];
    records.push({id: r.id, output: String(choice?.message?.content ?? '').trim(), in_tokens: data.usage?.prompt_tokens ?? null, out_tokens: data.usage?.completion_tokens ?? null, truncated: choice?.finish_reason === 'length', ms: Date.now() - t0, device: 'llama.cpp'});
  }
  writeJsonl(out, records);
}

async function generate(rows, t, name, o) {
  const out = outputFile(name, t);
  fs.mkdirSync(path.dirname(out), {recursive: true});
  if (o.url) return generateEndpoint(rows, o.url, out, {maxTokens: Number(o['max-tokens'] ?? 400)});
  if (o.identity) { writeJsonl(out, rows.map(r => ({id: r.id, output: r.prompt, in_tokens: null, out_tokens: null, truncated: false, ms: 0, device: 'none'}))); return; }
  const prefix = o.prefix ? String(o.prefix).replace(/\\n/g, '\n') : '';
  // `--prompts-from NAME`: the model input is the text of another arm's output on the same split (the gloss of the post-edit variant, tools/eval/gloss-eval.mjs); scoring still uses the original prompt
  const promptOf = o['prompts-from'] ? new Map(readJsonl(outputFile(o['prompts-from'], t)).map(x => [x.id, x.output])) : null;
  writeJsonl(inputFile(t), rows.map(r => ({id: r.id, text: prefix + (promptOf ? (promptOf.get(r.id) ?? r.prompt) : r.prompt)})));
  const res = spawnSync(PYTHON, [GENERATE, '--model', path.resolve(ROOT, o.model), '--in', inputFile(t), '--out', out, '--batch', String(o.batch ?? 32), '--device', o.device ?? 'cuda', '--max-new', String(o['max-new'] ?? 400)], {stdio: ['ignore', 'inherit', 'inherit']});
  if (res.status !== 0) throw Error(`generation failed (${res.status})`);
}

// ---- metrics -----------------------------------------------------------------------------------------------------------------------------
const ngrams = (text, n) => { const s = text.replace(/\s+/g, ''), m = new Map(); for (let i = 0; i + n <= s.length; i++) { const g = s.slice(i, i + n); m.set(g, (m.get(g) ?? 0) + 1); } return m; };
/** chrF (character n-grams 1..6, beta 2), in [0, 1]. */
export function chrF(hyp, ref, beta = 2) {
  let p = 0, r = 0, used = 0;
  for (let n = 1; n <= 6; n++) {
    const h = ngrams(hyp, n), g = ngrams(ref, n), hn = [...h.values()].reduce((a, b) => a + b, 0), gn = [...g.values()].reduce((a, b) => a + b, 0);
    if (!hn || !gn) continue;
    let match = 0;
    for (const [k, c] of h) match += Math.min(c, g.get(k) ?? 0);
    p += match / hn; r += match / gn; used++;
  }
  if (!used) return hyp === ref ? 1 : 0;
  p /= used; r /= used;
  return p + r === 0 ? 0 : (1 + beta * beta) * p * r / (beta * beta * p + r);
}
const words = text => (String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
export function tokenF1(hyp, ref) {
  const h = words(hyp), g = words(ref), m = new Map();
  for (const w of g) m.set(w, (m.get(w) ?? 0) + 1);
  let hit = 0;
  for (const w of h) if ((m.get(w) ?? 0) > 0) { hit++; m.set(w, m.get(w) - 1); }
  if (!h.length || !g.length) return h.length === g.length ? 1 : 0;
  const p = hit / h.length, r = hit / g.length;
  return p + r === 0 ? 0 : 2 * p * r / (p + r);
}

export function loadJudgeVerdicts() {
  // every language_proofing_*parse_judge folder (iterations 1, 2, 3) is read: verdicts are keyed by text, so identical outputs reuse earlier verdicts
  const dirs = fs.readdirSync(path.join(ROOT, 'datasets_sources')).filter(d => /^language_proofing_.*parse_judge$/.test(d)).map(d => path.join(ROOT, 'datasets_sources', d));
  return new Map([...readVerdicts(path.join(ROOT, 'datasets_sources/neuro_oracle_parse_judge')), ...readVerdicts(SYMBOLIC_JUDGE_DIR), ...readVerdicts(OLD_JUDGE_DIR), ...dirs.flatMap(d => [...readVerdicts(d)]), ...readVerdicts(JUDGE_DIR)]);
}

/** Every text the analysis layer needs: parses are recorded (GPU) and the judge items written to this experiment's own task folder. */
async function prepare(rows, t, names) {
  const texts = [];
  for (const r of rows) texts.push(r.prompt, r.target);
  for (const name of names) for (const o of readJsonl(outputFile(name, t))) texts.push(o.output);
  const layer = new AnalysisLayer();
  const parses = await layer.ensure(texts);
  layer.reloadVerdicts();
  layer.verdicts = loadJudgeVerdicts();
  const items = layer.pendingItems(texts);
  fs.mkdirSync(path.join(JUDGE_DIR, 'input'), {recursive: true});
  fs.mkdirSync(path.join(JUDGE_DIR, 'output'), {recursive: true});
  fs.mkdirSync(path.join(JUDGE_DIR, 'scripts'), {recursive: true});
  for (const f of ['SYSTEM_a.txt', 'SYSTEM_c.txt', 'scripts/judge.py']) if (!fs.existsSync(path.join(JUDGE_DIR, f))) fs.copyFileSync(path.join(SYMBOLIC_JUDGE_DIR, f), path.join(JUDGE_DIR, f));
  const task = path.join(JUDGE_DIR, 'TASK.md');
  if (!fs.existsSync(task)) fs.writeFileSync(task, fs.readFileSync(path.join(SYMBOLIC_JUDGE_DIR, 'TASK.md'), 'utf8').replaceAll('symbolic_proofing_parse_judge', path.basename(JUDGE_DIR)).replaceAll('SymbolicProofingLLM', 'LanguageProofingLLM'));
  const file = path.join(JUDGE_DIR, 'input/items.jsonl');
  const have = new Set(readJsonl(file).map(i => `${i.id}|${i.condition}`));
  const add = items.filter(i => !have.has(`${i.id}|${i.condition}`));
  if (add.length) fs.appendFileSync(file, add.map(i => JSON.stringify(i)).join('\n') + '\n');
  console.log(JSON.stringify({split: t, names, texts: new Set(texts).size, parses, pending_items: items.length, added: add.length, items_total: have.size + add.length}));
}

// ---- meaning judge (two-vote rule m1 AND m2 of the calibrated DeepSeek meaning judge, eval-meaning-judge-calibration-v1) ----------------------------------
const meaningUser = (input, output) => `ORIGINAL: ${input}\n\nREWRITE: ${output}`;
export function loadMeaningVerdicts() {
  const map = new Map();
  const dirs = fs.readdirSync(path.join(ROOT, 'datasets_sources')).filter(d => /^language_proofing_.*meaning_judge$/.test(d)).map(d => path.join(ROOT, 'datasets_sources', d));
  for (const dir of [...new Set([OLD_MEANING_DIR, ...dirs, MEANING_DIR])]) for (const r of readJsonl(path.join(dir, 'output/verdicts.jsonl'))) map.set(`${r.id}|${r.condition}`, r.answer?.preserves ?? null);
  return map;
}
function meaningVerdict(input, output, verdicts, rowId) {
  if (norm(input) === norm(output)) return true;
  if (!norm(output)) return false;
  const id = textKey(meaningUser(input, output)), m1 = verdicts.get(`${id}|m1`), m2 = verdicts.get(`${id}|m2`);
  if (m1 === undefined || m2 === undefined) throw Error(`meaning verdict pending for ${rowId}; run meaning-prepare and the judge first`);
  return m1 === 'yes' && m2 === 'yes';
}
/** Items of the meaning judge for the outputs (and reference targets) that differ from their input; the prompts are the frozen SYSTEM_m1/m2 of the calibration. */
function meaningPrepare(rows, t, names) {
  fs.mkdirSync(path.join(MEANING_DIR, 'input'), {recursive: true});
  fs.mkdirSync(path.join(MEANING_DIR, 'output'), {recursive: true});
  fs.mkdirSync(path.join(MEANING_DIR, 'scripts'), {recursive: true});
  for (const f of ['SYSTEM_m1.txt', 'SYSTEM_m2.txt', 'scripts/judge.py']) if (!fs.existsSync(path.join(MEANING_DIR, f))) fs.copyFileSync(path.join(MEANING_SOURCE_DIR, f), path.join(MEANING_DIR, f));
  const task = path.join(MEANING_DIR, 'TASK.md');
  if (!fs.existsSync(task)) fs.writeFileSync(task, fs.readFileSync(path.join(MEANING_SOURCE_DIR, 'TASK.md'), 'utf8').replaceAll('meaning_judge_calibration_v2', path.basename(MEANING_DIR)).replace('(calibration run)', '(LanguageProofingLLM evaluation)').replace('an ORIGINAL English message', 'an ORIGINAL message (English, Romanian, or a mix of both; the REWRITE is meant to be its clean English version)').replace('Your verdicts are compared afterwards with known labels to\nmeasure how reliable you are, so answer honestly and independently.', 'Answer honestly and independently.').replace(/`"m1" \| "m2" \| "m1r"`/, '`"m1" | "m2"`'));
  const file = path.join(MEANING_DIR, 'input/items.jsonl');
  const have = new Set([...readJsonl(file).map(i => `${i.id}|${i.condition}`), ...[...loadMeaningVerdicts().keys()]]), add = [], seen = new Set();
  const want = (input, output) => {
    if (norm(input) === norm(output) || !norm(output)) return;
    const user = meaningUser(input, output), id = textKey(user);
    for (const condition of ['m1', 'm2']) { const k = `${id}|${condition}`; if (!have.has(k) && !seen.has(k)) { seen.add(k); add.push({id, condition, user}); } }
  };
  for (const r of rows) if (r.has_ref && r.target) want(r.prompt, r.target);
  for (const name of names) { const outs = new Map(readJsonl(outputFile(name, t)).map(r => [r.id, r.output])); for (const r of rows) if (outs.has(r.id)) want(r.prompt, outs.get(r.id)); }
  if (add.length) fs.appendFileSync(file, add.map(i => JSON.stringify(i)).join('\n') + '\n');
  console.log(JSON.stringify({split: t, names, added: add.length, items_total: readJsonl(file).length + add.length}));
}

let resources = null;
const gate = text => cleanEnglishGate({question: text, language: 'en'}, (resources ??= {spellfix: loadSpellfix(), dictionary: defaultDictionary()}));

async function score(rows, t, name, o) {
  const outs = new Map(readJsonl(outputFile(name, t)).map(r => [r.id, r]));
  if (outs.size < rows.length) throw Error(`${outs.size} outputs for ${rows.length} rows`);
  const withAnalysis = o.analysis !== 'false';
  const meaningVerdicts = o.meaning === 'true' ? loadMeaningVerdicts() : null;
  let layer = null;
  if (withAnalysis) { layer = new AnalysisLayer(); layer.reloadVerdicts(); layer.verdicts = loadJudgeVerdicts(); }
  const records = [];
  for (const r of rows) {
    const o2 = outs.get(r.id), output = o2.output, input = r.prompt;
    const g = gate(output), problems = pairProblems(input, output), structural = problems.filter(p => p !== 'negation differs');
    const rec = {id: r.id, pair: r.pair, kind: r.kind, target_source: r.target_source, input, target: r.target, output,
      unchanged: norm(output) === norm(input), exact: r.has_ref ? norm(output) === norm(r.target) : null, empty: !norm(output), truncated: Boolean(o2.truncated),
      clean_gate: g.clean, clean_gate_reasons: g.reasons, content_ok: structural.length === 0, content_ok_neg: problems.length === 0, content_problems: problems,
      has_ref: r.has_ref, chrf: r.has_ref ? chrF(output, r.target) : null, f1: r.has_ref ? tokenF1(output, r.target) : null, out_sentences_n: null, in_tokens: o2.in_tokens ?? null, out_tokens: o2.out_tokens ?? null};
    if (withAnalysis) {
      const a = layer.gate(output);
      if (a.pending) throw Error(`judge verdicts pending for ${r.id}; run prepare and the judge first`);
      const tgt = r.has_ref ? layer.gate(r.target) : null, inp = layer.gate(input);
      if (inp.pending || tgt?.pending) throw Error(`judge verdicts pending for the input or reference of ${r.id}; run prepare and the judge first`);
      Object.assign(rec, {analysis_pass: a.pass, analysis_failed: a.failed, analysis_parsed: a.parsed, analysis_sentences: a.sentences, target_analysis_pass: tgt ? tgt.pass : null, input_analysis_pass: inp.pass,
        same_analysis_as_input: rec.unchanged || layer.sameAnalysis(input, output), same_analysis_as_target: r.has_ref ? rec.exact || layer.sameAnalysis(r.target, output) : null});
      rec.good = rec.clean_gate && rec.content_ok_neg && rec.analysis_pass;
    } else rec.good = rec.clean_gate && rec.content_ok_neg;
    if (o.meaning === 'true') {
      rec.meaning_ok = meaningVerdict(input, output, meaningVerdicts, r.id);
      if (r.has_ref) rec.target_meaning_ok = meaningVerdict(input, r.target, meaningVerdicts, r.id);
      rec.good_meaning = rec.good && rec.meaning_ok;
    }
    records.push(rec);
  }
  const summary = summarize(records, withAnalysis);
  fs.mkdirSync(path.dirname(scoreFile(name, t)), {recursive: true});
  fs.writeFileSync(scoreFile(name, t), JSON.stringify({name, split: t, generated_at: new Date().toISOString(), analysis: withAnalysis, summary, records}, null, 1) + '\n');
  console.log(JSON.stringify({name, split: t, summary}, null, 1));
}

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export function bootstrapMean(values, {resamples = 2000, seed = 11} = {}) {
  if (!values.length) return null;
  const random = rng(seed), n = values.length, means = [];
  for (let b = 0; b < resamples; b++) { let s = 0; for (let i = 0; i < n; i++) s += values[Math.floor(random() * n)]; means.push(s / n); }
  means.sort((a, b) => a - b);
  return [means[Math.floor(0.025 * resamples)], means[Math.min(resamples - 1, Math.floor(0.975 * resamples))]].map(x => Math.round(x * 1e4) / 1e4);
}
const rate = (list, f) => { const k = list.filter(f).length, w = wilson(k, list.length); return {k, n: list.length, pct: list.length ? Math.round(1000 * k / list.length) / 10 : null, ci95: w}; };
const avg = (list, f) => { const v = list.map(f); return {mean: v.length ? Math.round(1e4 * mean(v)) / 1e4 : null, ci95: bootstrapMean(v), n: v.length}; };

function group(list, withAnalysis) {
  const out = {n: list.length};
  out.clean_english_rate = rate(list, r => r.clean_gate);
  out.content_preserved = rate(list, r => r.content_ok);
  out.content_preserved_with_negation = rate(list, r => r.content_ok_neg);
  const ref = list.filter(r => r.has_ref);
  out.with_reference = ref.length;
  out.chrf = avg(ref, r => r.chrf);
  out.token_f1 = avg(ref, r => r.f1);
  out.exact_reference = rate(ref, r => r.exact);
  out.unchanged_output = rate(list, r => r.unchanged);
  out.empty_or_truncated = rate(list, r => r.empty || r.truncated);
  if (withAnalysis) {
    out.analysis_correct = rate(list, r => r.analysis_pass);
    out.reference_analysis_correct = rate(ref, r => r.target_analysis_pass);
    out.same_analysis_as_reference = rate(ref, r => r.same_analysis_as_target);
  }
  if (list.some(r => r.meaning_ok !== undefined)) {
    out.meaning_judge_two_vote = rate(list, r => r.meaning_ok);
    out.reference_meaning_judge_two_vote = rate(ref, r => r.target_meaning_ok);
    out.good_with_meaning_judge = rate(list, r => r.good_meaning);
  }
  out.good = rate(list, r => r.good);
  return out;
}

export function summarize(records, withAnalysis = true) {
  const repair = records.filter(r => r.pair === 'repair'), identity = records.filter(r => r.pair === 'identity');
  const out = {rows: records.length, repair_rows: repair.length, identity_rows: identity.length, repair: group(repair, withAnalysis), by_kind: {}};
  for (const kind of ['ro', 'mixed', 'noisy_en']) { const list = repair.filter(r => r.kind === kind); if (list.length) out.by_kind[kind] = group(list, withAnalysis); }
  if (identity.length) {
    out.identity = {n: identity.length, left_untouched: rate(identity, r => r.unchanged), text_changed: rate(identity, r => !r.unchanged), content_broken: rate(identity, r => !r.content_ok_neg), clean_gate_after: rate(identity, r => r.clean_gate),
      ...(withAnalysis ? {analysis_changed: rate(identity, r => !r.same_analysis_as_input), analysis_correct_before_and_not_after: rate(identity.filter(r => r.input_analysis_pass), r => !r.analysis_pass)} : {})};
  }
  out.all = group(records, withAnalysis);
  return out;
}

/** Paired bootstrap of the difference of a per-row metric between two scored runs (same rows), resampling rows. */
function compare(t, a, b, o) {
  const A = new Map(JSON.parse(fs.readFileSync(scoreFile(a, t), 'utf8')).records.map(r => [r.id, r])), B = new Map(JSON.parse(fs.readFileSync(scoreFile(b, t), 'utf8')).records.map(r => [r.id, r]));
  const metrics = {good: r => Number(r.good), clean_english: r => Number(r.clean_gate), content_preserved: r => Number(r.content_ok_neg), chrf: r => r.chrf, token_f1: r => r.f1, analysis_correct: r => Number(r.analysis_pass ?? 0), unchanged: r => Number(r.unchanged), meaning_judge: r => Number(r.meaning_ok ?? 0)};
  const res = {};
  for (const scope of ['repair', 'identity', ...['ro', 'mixed', 'noisy_en'].map(k => `repair:${k}`)]) {
    const ids = [...A.keys()].filter(id => B.has(id) && (scope === 'identity' ? A.get(id).pair === 'identity' : scope === 'repair' ? A.get(id).pair === 'repair' : A.get(id).pair === 'repair' && A.get(id).kind === scope.split(':')[1]));
    if (!ids.length) continue;
    res[scope] = {n: ids.length};
    for (const [m, f] of Object.entries(metrics)) {
      const use = ['chrf', 'token_f1'].includes(m) ? ids.filter(id => A.get(id).has_ref) : ids;
      if (!use.length) continue;
      const d = use.map(id => f(B.get(id)) - f(A.get(id)));
      res[scope][m] = {n: use.length, a: Math.round(1e4 * mean(use.map(id => f(A.get(id))))) / 1e4, b: Math.round(1e4 * mean(use.map(id => f(B.get(id))))) / 1e4, delta: Math.round(1e4 * mean(d)) / 1e4, ci95: bootstrapMean(d, {seed: 5})};
    }
  }
  console.log(JSON.stringify({split: t, a, b, ...res}, null, 1));
  if (o.out) fs.writeFileSync(o.out, JSON.stringify({split: t, a, b, ...res}, null, 1) + '\n');
}

function agree(rows, t, a, b, n) {
  const A = new Map(readJsonl(outputFile(a, t)).map(r => [r.id, r.output])), B = new Map(readJsonl(outputFile(b, t)).map(r => [r.id, r.output]));
  const ids = rows.map(r => r.id).filter(id => A.has(id) && B.has(id)).slice(0, n);
  const differ = ids.filter(id => norm(A.get(id)) !== norm(B.get(id))).map(id => ({id, a: A.get(id).slice(0, 200), b: B.get(id).slice(0, 200)}));
  console.log(JSON.stringify({split: t, a, b, rows: ids.length, identical: ids.length - differ.length, differ}, null, 1));
}

async function main() {
  const [command, ...rest] = process.argv.slice(2), o = args(rest);
  const sample = o.sample ? Number(o.sample) : null, t = tag(o.split, sample);
  const rows = o.split ? loadSplit(o.split, sample) : [];
  if (command === 'generate') await generate(rows, t, o.name, o);
  else if (command === 'prepare') await prepare(rows, t, String(o.names).split(','));
  else if (command === 'meaning-prepare') meaningPrepare(rows, t, String(o.names).split(','));
  else if (command === 'score') await score(rows, t, o.name, o);
  else if (command === 'compare') compare(t, o.a, o.b, o);
  else if (command === 'agree') agree(rows, t, o.a, o.b, Number(o.n ?? 50));
  else if (command === 'count') console.log(JSON.stringify({split: t, rows: rows.length, by: countBy(rows, r => `${r.pair}/${r.kind}`)}));
  else throw Error('usage: language-proofing-eval.mjs generate|prepare|score|compare|agree|count ...');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
