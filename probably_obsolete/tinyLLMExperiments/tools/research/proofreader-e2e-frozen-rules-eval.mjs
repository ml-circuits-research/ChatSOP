#!/usr/bin/env node
/** Experiment eval-proofreader-e2e-v1, part 2: does wiring the fine-tuned Gemma3-270M proofreader
 * (train-proofreader-gemma270m-v1) as an English-text rewrite ahead of the frozen UD-to-SOP rules improve
 * end-to-end SOP accuracy on formalizer suites that were never used to build datasets_archive/proofing?
 *
 * NOTE (2026-09-30, operational): this file was originally named tools/research/proofreader-e2e-eval.mjs; it was
 * renamed after a second, concurrent process (another agent instance also acting under CHATSOP_ACTOR
 * proofreader-eval-agent -- almost certainly a reconnaissance fork that exceeded its "no GPU jobs, no edits"
 * mandate) overwrote that path with its own, different implementation (SymbolicLM + a live llama-server GGUF
 * endpoint + SymbolicLM's built-in uncertainty gate) while THIS script's v1/ood runs were already executing as
 * already-loaded Node processes (unaffected: ES modules are loaded once at process start) or already complete. Per
 * AGENTS.md ("never kill processes you did not start" / "do not add concurrent GPU jobs"), the other process's
 * llama-server daemons and its version of the file were left untouched; this script was saved back under a new
 * name so both agents' work is preserved and neither clobbers the other. The results below (v1, ood, wild) were
 * produced by THIS script before the collision and are unaffected by it. See status/journal.jsonl 2026-09-30 and
 * topic notes (topic proofing) for the full account.
 *
 * Three arms per suite, EN rows only (RO monolingual is out of scope: route direct produces no English text, see
 * status/preregistrations/eval-proofreader-e2e-v1.json H6):
 *   no_rewrite      - the message parsed as is
 *   always_on       - the fine-tuned checkpoint rewrites the English text first (message-only HF greedy)
 *   gate_no_spacy   - rewrite only when the RAW text's frozen-rules trace is uncertain (unparsed spans, converter
 *                     repair/fallback, or an OOV lower-case word), else keep the raw text -- same construction as
 *                     datasets_archive/proofing's gate_no_spacy (tools/research/proofing.mjs signalsCommand), no spaCy.
 * A fourth, exploratory, non-gating arm scores formalizer-wild-v1's `mixed` (code-switched) rows through
 * SymbolicLM's own dictionary translation (lib/symbolic-lm toEnglish, version-independent of ud-to-sop) before the
 * same optional rewrite and the same frozen rules. NOT RUN in this record: skipped to avoid adding a second
 * concurrent GPU/CPU job while the other agent's servers were active (see note above); recorded as not completed,
 * not as a negative result.
 *
 * Every row is converted by the FROZEN rules v1.4 copy (tools/research/proofing-oracle.mjs loadFrozenRules), never
 * the live lib/ud-to-sop (another agent is changing it to v1.5 concurrently) -- so a delta here is never a v1.5
 * artifact. formalizer-v1 and formalizer-ood-v1 rows carry a verification world and are scored with eval/run.mjs's
 * evaluate() (canonical_match = strict gold SOP match, canonical_match_tolerant = host frame-normalized score,
 * DS016); formalizer-wild-v1 rows carry no verification world (`scoring.executed: false` on every row) and are
 * scored with tools/eval/wild-suite.mjs's scoreAgainstAccepted() against sop_targets_accepted instead
 * (accepted_match = strict, accepted_match_tolerant = host frame-normalized).
 *
 *   node tools/research/proofreader-e2e-frozen-rules-eval.mjs run --suite v1|ood|wild [--mixed]
 *        [--model models/gemma/proofreader-gemma270m-v1/proofreader/merged-best] [--out FILE.json]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {loadFrozenRules, ParseCache, ROOT} from './proofing-oracle.mjs';
import {evaluate} from '../../eval/run.mjs';
import {scoreAgainstAccepted} from '../eval/wild-suite.mjs';
import {stratifiedOrder} from './grammar-constrained-eval.mjs';
import {createSymbolicLM} from '../../lib/symbolic-lm/index.mjs';

const OUT = path.join(ROOT, 'eval/reports/history/proofreader-e2e');
const SUITES = {v1: 'eval/suites/formalizer-v1/test.jsonl', ood: 'eval/suites/formalizer-ood-v1/test.jsonl', wild: 'eval/suites/formalizer-wild-v1/test.jsonl'};
const SUITE_NAMES = {v1: 'formalizer-v1', ood: 'formalizer-ood-v1', wild: 'formalizer-wild-v1'};
const PY = path.join(os.homedir(), 'nlp-venv/bin/python');
const RULES_VERSION = 'v1.4';
const round = x => (x === null || x === undefined || !Number.isFinite(x)) ? null : Math.round(x * 10000) / 10000;
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const readJsonl = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : []);
const writeJsonl = (file, rows) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')); };
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, JSON.stringify(value, null, 1) + '\n'); };

function args(argv) {
  const [command, ...rest] = argv, out = {command};
  for (let i = 0; i < rest.length; i++) { const key = rest[i].replace(/^--/, ''); out[key] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; }
  return out;
}

async function englishTextsOf(rows, mixed) {
  if (!mixed) return rows.map(r => r.question);
  const lm = await createSymbolicLM({device: 'cpu'});
  const out = [];
  for (const row of rows) out.push((await lm.toEnglish(row.question)).text);
  return out;
}

function rewriteAll(model, ids, texts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proofreader-e2e-'));
  const tmpIn = path.join(dir, 'in.jsonl'), tmpOut = path.join(dir, 'out.jsonl');
  writeJsonl(tmpIn, ids.map((id, i) => ({id, text: texts[i]})));
  execFileSync(PY, [path.join(ROOT, 'training/python/generate_causal.py'), '--model', model, '--in', tmpIn, '--out', tmpOut, '--device', 'cuda', '--batch', '32'], {stdio: ['ignore', 'ignore', 'inherit']});
  const outs = new Map(readJsonl(tmpOut).map(o => [o.id, String(o.output ?? '').trim()]));
  fs.rmSync(dir, {recursive: true, force: true});
  return ids.map(id => outs.get(id) ?? '');
}

let dictWords = null;
function systemWords() {
  if (dictWords) return dictWords;
  dictWords = new Set();
  for (const file of ['/usr/share/dict/american-english', '/usr/share/dict/words']) { try { for (const w of fs.readFileSync(file, 'utf8').split('\n')) if (w) dictWords.add(w.toLowerCase()); break; } catch { /* none */ } }
  return dictWords;
}
function gateFires(conv, parse) {
  const oov = (parse.sentences ?? []).flatMap(s => s.words).filter(w => w.oov && /^\p{Ll}[\p{L}'’-]+$/u.test(w.text) && !systemWords().has(w.text.toLowerCase()));
  return conv.wires.filter(w => w.type === 'unparsed').length > 0 || (conv.repaired ?? []).length > 0 || conv.outcome !== 'converted' || oov.length > 0;
}

function convertAll(rules, texts, parses) {
  return texts.map((text, i) => {
    if (!String(text).trim()) return {sop: '@u unclear\n  kind no_request\n', valid: true, outcome: 'empty', wires: [], repaired: []};
    try { return rules.convertParse(parses[i], text); } catch (error) { return {sop: '', valid: false, outcome: 'crash', wires: [], repaired: [], error: error.message}; }
  });
}

async function buildPredictions({suite, model, mixed}) {
  const path0 = path.join(ROOT, SUITES[suite]);
  let rows = readJsonlShardedSync(path0);
  rows = mixed ? rows.filter(r => r.language === 'mixed') : rows.filter(r => r.language === 'en');
  rows = stratifiedOrder(rows, 20260930);
  const rules = await loadFrozenRules(RULES_VERSION);
  const cache = new ParseCache(rules, {device: 'cuda'});

  const englishTexts = await englishTextsOf(rows, mixed);
  const ids = rows.map(r => r.id);
  const rawParses = await cache.parseAll(englishTexts, {log: m => console.log('raw', m)});
  const rawConv = convertAll(rules, englishTexts, rawParses);
  const gate = rawConv.map((conv, i) => gateFires(conv, rawParses[i]));

  const rewritten = rewriteAll(model, ids, englishTexts);
  const rewrittenParses = await cache.parseAll(rewritten, {log: m => console.log('rewrite', m)});
  const rewrittenConv = convertAll(rules, rewritten, rewrittenParses);
  await cache.stop();

  const records = rows.map((row, i) => ({
    id: row.id, language: row.language, question_type: row.question_type ?? null,
    raw_text: englishTexts[i], rewritten_text: rewritten[i], changed: englishTexts[i].trim() !== rewritten[i].trim(), gate: gate[i],
    sop: {no_rewrite: rawConv[i].sop, always_on: rewrittenConv[i].sop, gate_no_spacy: gate[i] ? rewrittenConv[i].sop : rawConv[i].sop},
  }));
  return {rows, records};
}

async function scoreArm(suite, rows, sopById) {
  if (suite === 'wild') {
    return new Map(rows.map(row => { const w = scoreAgainstAccepted(sopById.get(row.id), row.sop_targets_accepted ?? [row.sop_target]); return [row.id, {strict: !!w.accepted_match, tolerant: !!w.accepted_match_tolerant, proposition_f1: w.proposition_f1}]; }));
  }
  const suiteRows = rows.map(row => ({...row, ontology_sop: row.ontology_sop ?? ''}));
  const report = await evaluate(suiteRows, {predictor: ({id}) => sopById.get(id), source: 'predictions'});
  return new Map(report.records.map(r => [r.id, {strict: !!r.canonical_match, tolerant: !!r.canonical_match_tolerant, execution_strict: !!r.execution_equivalent, execution_tolerant: !!r.execution_equivalent_tolerant}]));
}

function mulberry(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function bootstrapDelta(pairs, reps = 10000, seed = 7) {
  const clusters = new Map();
  for (const p of pairs) { if (!clusters.has(p.cluster)) clusters.set(p.cluster, []); clusters.get(p.cluster).push(p); }
  const list = [...clusters.values()];
  const flat = list.flat();
  const point = mean(flat.map(p => p.b)) - mean(flat.map(p => p.a));
  const random = mulberry(seed), deltas = [];
  for (let r = 0; r < reps; r++) {
    const sample = [];
    for (let i = 0; i < list.length; i++) sample.push(...list[Math.floor(random() * list.length)]);
    deltas.push(mean(sample.map(p => p.b)) - mean(sample.map(p => p.a)));
  }
  deltas.sort((x, y) => x - y);
  return {delta: round(point), ci95: [round(deltas[Math.floor(0.025 * deltas.length)]), round(deltas[Math.floor(0.975 * deltas.length)])]};
}

const stagesOf = total => [...new Set([100, 300, total].filter(n => n <= total))];
function stopDecision(stageIndex, totalStages, brokenShare, delta) {
  if (stageIndex === 1 && brokenShare > 0.2) return {stop: true, reason: 'broken'};
  if (delta && delta.ci95[0] > 1.5) return {stop: true, reason: 'decisive-positive'};
  if (delta && delta.ci95[1] < 0) return {stop: true, reason: 'decisive-negative'};
  if (delta && delta.ci95[1] < 0.5) return {stop: true, reason: 'futility'};
  if (stageIndex >= totalStages) return {stop: true, reason: 'complete'};
  return {stop: false, reason: 'continue'};
}

async function runCommand(o) {
  const suite = o.suite, mixed = Boolean(o.mixed);
  if (!SUITES[suite]) throw Error(`unknown suite ${suite}; use v1, ood or wild`);
  const model = o.model ? (path.isAbsolute(o.model) ? o.model : path.join(ROOT, o.model)) : path.join(ROOT, 'models/gemma/proofreader-gemma270m-v1/proofreader/merged-best');
  console.log(`building predictions: suite=${suite} mixed=${mixed} model=${model}`);
  const {rows, records} = await buildPredictions({suite, model, mixed});
  const byId = new Map(records.map(r => [r.id, r]));
  const arms = ['no_rewrite', 'always_on', 'gate_no_spacy'];
  const sopById = Object.fromEntries(arms.map(arm => [arm, new Map(records.map(r => [r.id, r.sop[arm]]))]));
  const scores = {};
  for (const arm of arms) scores[arm] = await scoreArm(suite, rows, sopById[arm]);

  const cluster = row => (suite === 'wild' ? row.id : row.split_group_id ?? row.id);
  const stages = stagesOf(rows.length);
  const stageResults = [];
  for (const [index, n] of stages.entries()) {
    const slice = rows.slice(0, n);
    const brokenShare = mean(slice.map(r => (byId.get(r.id).rewritten_text.trim() ? 0 : 1)));
    const summary = {};
    for (const arm of arms) {
      const strict = mean(slice.map(r => (scores[arm].get(r.id).strict ? 1 : 0)));
      const tolerant = mean(slice.map(r => (scores[arm].get(r.id).tolerant ? 1 : 0)));
      summary[arm] = {rows: slice.length, strict: round(strict), tolerant: round(tolerant)};
    }
    const pairsAlways = slice.map(row => ({cluster: cluster(row), a: scores.no_rewrite.get(row.id).strict ? 1 : 0, b: scores.always_on.get(row.id).strict ? 1 : 0}));
    const pairsGated = slice.map(row => ({cluster: cluster(row), a: scores.no_rewrite.get(row.id).strict ? 1 : 0, b: scores.gate_no_spacy.get(row.id).strict ? 1 : 0}));
    const scale100 = d => (d ? {delta: round(d.delta * 100), ci95: d.ci95.map(x => round(x * 100))} : null);
    const deltaAlways = scale100(bootstrapDelta(pairsAlways));
    const deltaGated = scale100(bootstrapDelta(pairsGated));
    const brokenOnCorrect = slice.filter(r => scores.no_rewrite.get(r.id).strict);
    const breakAlways = brokenOnCorrect.length ? mean(brokenOnCorrect.map(r => (scores.always_on.get(r.id).strict ? 0 : 1))) : null;
    const decision = stopDecision(index + 1, stages.length, brokenShare, deltaAlways);
    stageResults.push({stage: index + 1, rows: n, summary, delta_always_on_pp: deltaAlways, delta_gate_no_spacy_pp: deltaGated, break_rate_always_on: round(breakAlways), decision});
    console.log(JSON.stringify(stageResults.at(-1)));
    if (decision.stop) break;
  }
  const final = stageResults.at(-1);
  const slice = rows.slice(0, final.rows);
  const gained = slice.filter(r => !scores.no_rewrite.get(r.id).strict && scores.always_on.get(r.id).strict).map(r => r.id);
  const lost = slice.filter(r => scores.no_rewrite.get(r.id).strict && !scores.always_on.get(r.id).strict).map(r => r.id);
  const changedRows = slice.filter(r => byId.get(r.id).changed);
  const shuffled = mulberry(20260930 + 1), examplePool = [...changedRows];
  for (let i = examplePool.length - 1; i > 0; i--) { const j = Math.floor(shuffled() * (i + 1)); [examplePool[i], examplePool[j]] = [examplePool[j], examplePool[i]]; }
  const examples = examplePool.slice(0, 20).map(row => { const rec = byId.get(row.id); return {id: row.id, before: rec.raw_text, after: rec.rewritten_text, gate_no_spacy: rec.gate, no_rewrite_strict: scores.no_rewrite.get(row.id).strict, always_on_strict: scores.always_on.get(row.id).strict}; });

  const out = {suite: SUITE_NAMES[suite], mixed, rows_total: rows.length, rows_scored: final.rows, model, stages: stageResults,
    gained_rows: gained, lost_rows: lost, changed_rows: changedRows.length, examples};
  const outFile = o.out ? path.resolve(o.out) : path.join(OUT, `${suite}${mixed ? '-mixed' : ''}.json`);
  writeJson(outFile, out);
  console.log(JSON.stringify({suite: out.suite, mixed, rows_scored: out.rows_scored, final_delta_always_on_pp: final.delta_always_on_pp, final_delta_gate_no_spacy_pp: final.delta_gate_no_spacy_pp, stop_reason: final.decision.reason}, null, 1));
}

async function main() {
  const o = args(process.argv.slice(2));
  if (o.command === 'run') return runCommand(o);
  throw Error(`Unknown command ${o.command}`);
}
main().catch(error => { console.error(error.stack); process.exit(1); });
