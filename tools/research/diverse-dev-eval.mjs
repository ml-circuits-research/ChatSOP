#!/usr/bin/env node
/** Experiment eval-proofreader-diverse-dev-v1: does the fine-tuned Gemma3-270M proofreader
 * (train-proofreader-gemma270m-v1, models/gemma/proofreader-gemma270m-v1/proofreader/merged-best) help end-to-end
 * SOP accuracy on realistic, independently-diversified English text the way it helps on generator-distribution
 * suites (formalizer-v1, formalizer-ood-v1), or does it fail the way it fails on formalizer-wild-v1?
 *
 * Rows: datasets_archive/proofing-diverse-dev/diverse-dev.jsonl, a held-out slice of Haiku-diversified paraphrases of
 * formalizer-v1 train rows (DS022 "LLM diversification"), never eval/suites/**. Same schema as a formalizer-v1
 * test row (id, question, ontology_sop, world, sop_target, split_group_id, language, question_type), so scoring
 * reuses eval/run.mjs through tools/research/proofing-oracle.mjs's scoreRows() exactly as datasets_archive/proofing was
 * scored, and every row is converted by the FROZEN rules v1.4 private snapshot (loadFrozenRules), never the live
 * lib/ud-to-sop (another agent is changing it toward v1.5 concurrently) -- so a delta here is never a v1.5 artifact.
 *
 * Arms: no_rewrite | gemma_always_on | gemma_gate_no_spacy | qwen_proof (untrained Qwen3-1.7B, PROMPTS.proof,
 * protect/restore around names and literals exactly as tools/research/proofing.mjs's small-candidate generation).
 * Staged 100 / 300 / full with the same paired cluster-bootstrap early-stopping rule as eval-proofreader-e2e-v1
 * (cluster = split_group_id).
 *
 *   node tools/research/diverse-dev-eval.mjs run [--rows datasets_archive/proofing-diverse-dev/diverse-dev.jsonl] [--out FILE.json]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {loadFrozenRules, ParseCache, ROOT, OUT as PROOFING_OUT, readJsonl, writeJsonl, writeJson, scoreRows} from './proofing-oracle.mjs';
import {protectText, cleanOutput, CANDIDATES, PROMPTS} from './proofing.mjs';
import {stratifiedOrder} from './grammar-constrained-eval.mjs';

const OUT = path.join(ROOT, 'eval/reports/current/proofreader-diverse-dev');
const PY = path.join(os.homedir(), 'nlp-venv/bin/python');
const RULES_VERSION = 'v1.4';
const round = x => (x === null || x === undefined || !Number.isFinite(x)) ? null : Math.round(x * 10000) / 10000;
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function args(argv) {
  const [command, ...rest] = argv, out = {command};
  for (let i = 0; i < rest.length; i++) { const key = rest[i].replace(/^--/, ''); out[key] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; }
  return out;
}

// ------------------------------------------------------------------ rewrite arms

function rewriteAllGemma(model, ids, texts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diverse-dev-gemma-'));
  const tmpIn = path.join(dir, 'in.jsonl'), tmpOut = path.join(dir, 'out.jsonl');
  writeJsonl(tmpIn, ids.map((id, i) => ({id, text: texts[i]})));
  execFileSync(PY, [path.join(ROOT, 'training/python/generate_causal.py'), '--model', model, '--in', tmpIn, '--out', tmpOut, '--device', 'cuda', '--batch', '32'], {stdio: ['ignore', 'ignore', 'inherit']});
  const outs = new Map(readJsonl(tmpOut).map(o => [o.id, String(o.output ?? '').trim()]));
  fs.rmSync(dir, {recursive: true, force: true});
  return ids.map(id => outs.get(id) ?? '');
}

/** Untrained Qwen3-1.7B, PROMPTS.proof, protect/restore -- same mechanism as tools/research/proofing.mjs generate(). */
function rewriteAllQwen(rules, rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diverse-dev-qwen-'));
  const prepared = rows.map(row => ({row, p: protectText(rules, row.question)}));
  const promptFile = path.join(dir, 'prompt.txt');
  fs.writeFileSync(promptFile, PROMPTS.proof);
  const tmpIn = path.join(dir, 'in.jsonl'), tmpOut = path.join(dir, 'out.jsonl');
  writeJsonl(tmpIn, prepared.map(x => ({id: x.row.id, text: x.p.text})));
  const modelDir = path.join(ROOT, CANDIDATES['qwen3-1.7b'].dir);
  execFileSync(PY, [path.join(ROOT, 'training/python/proofread_llm.py'), '--model', modelDir, '--prompt-file', promptFile, '--in', tmpIn, '--out', tmpOut, '--device', 'cuda', '--batch', '32'], {stdio: ['ignore', 'ignore', 'inherit']});
  const outs = new Map(readJsonl(tmpOut).map(o => [o.id, o]));
  const result = prepared.map(x => {
    const o = outs.get(x.row.id);
    const cleaned = cleanOutput(o?.output);
    const r = rules.protect.restore(cleaned, x.p.slots);
    return r.text;
  });
  fs.rmSync(dir, {recursive: true, force: true});
  return result;
}

// ------------------------------------------------------------------ frozen-rules conversion and the uncertainty gate
// (copied verbatim in spirit from tools/research/proofreader-e2e-frozen-rules-eval.mjs so the gate matches the
// production SymbolicLM uncertainty signal exactly: unparsed wires, converter repair/fallback, or an OOV lowercase
// word not in the system dictionary.)

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

// ------------------------------------------------------------------ bootstrap and staged early stopping

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

// ------------------------------------------------------------------ main

async function buildPredictions(rows, model) {
  const rules = await loadFrozenRules(RULES_VERSION);
  const cache = new ParseCache(rules, {device: 'cuda'});
  const ids = rows.map(r => r.id);
  const texts = rows.map(r => r.question);

  const rawParses = await cache.parseAll(texts, {log: m => console.log('raw', m)});
  const rawConv = convertAll(rules, texts, rawParses);
  const gate = rawConv.map((conv, i) => gateFires(conv, rawParses[i]));

  const gemmaTexts = rewriteAllGemma(model, ids, texts);
  const gemmaParses = await cache.parseAll(gemmaTexts, {log: m => console.log('gemma', m)});
  const gemmaConv = convertAll(rules, gemmaTexts, gemmaParses);

  const qwenTexts = rewriteAllQwen(rules, rows);
  const qwenParses = await cache.parseAll(qwenTexts, {log: m => console.log('qwen', m)});
  const qwenConv = convertAll(rules, qwenTexts, qwenParses);

  await cache.stop();

  return rows.map((row, i) => ({
    id: row.id, language: row.language, question_type: row.question_type ?? null, split_group_id: row.split_group_id ?? row.id,
    raw_text: texts[i], gemma_text: gemmaTexts[i], qwen_text: qwenTexts[i],
    gemma_changed: texts[i].trim() !== gemmaTexts[i].trim(), qwen_changed: texts[i].trim() !== qwenTexts[i].trim(), gate: gate[i],
    sop: {no_rewrite: rawConv[i].sop, gemma_always_on: gemmaConv[i].sop, gemma_gate_no_spacy: gate[i] ? gemmaConv[i].sop : rawConv[i].sop, qwen_proof: qwenConv[i].sop},
  }));
}

async function runCommand(o) {
  const rowsFile = path.resolve(ROOT, o.rows ?? 'datasets_archive/proofing-diverse-dev/diverse-dev.jsonl');
  const model = o.model ? (path.isAbsolute(o.model) ? o.model : path.join(ROOT, o.model)) : path.join(ROOT, 'models/gemma/proofreader-gemma270m-v1/proofreader/merged-best');
  const allRows = readJsonl(rowsFile).filter(r => r.language === 'en');
  const rows = stratifiedOrder(allRows, 20260930);
  console.log(`diverse-dev: ${rows.length} EN rows, model=${model}`);
  const records = await buildPredictions(rows, model);
  const byId = new Map(records.map(r => [r.id, r]));

  const arms = ['no_rewrite', 'gemma_always_on', 'gemma_gate_no_spacy', 'qwen_proof'];
  const scoreWork = path.join(OUT, 'score-work');
  const scores = {};
  for (const arm of arms) {
    const preds = records.map(r => ({id: r.id, sop: r.sop[arm]}));
    scores[arm] = scoreRows(rows, preds, path.join(scoreWork, arm));
  }

  const cluster = row => row.split_group_id ?? row.id;
  const stages = stagesOf(rows.length);
  const stageResults = [];
  for (const [index, n] of stages.entries()) {
    const slice = rows.slice(0, n);
    const brokenShare = mean(slice.map(r => (byId.get(r.id).gemma_text.trim() && byId.get(r.id).qwen_text.trim() ? 0 : 1)));
    const summary = {};
    for (const arm of arms) {
      const strict = mean(slice.map(r => (scores[arm].get(r.id)?.strict ? 1 : 0)));
      const tolerant = mean(slice.map(r => (scores[arm].get(r.id)?.tolerant ? 1 : 0)));
      summary[arm] = {rows: slice.length, strict: round(strict), tolerant: round(tolerant)};
    }
    const scale100 = d => (d ? {delta: round(d.delta * 100), ci95: d.ci95.map(x => round(x * 100))} : null);
    const deltas = {};
    for (const arm of ['gemma_always_on', 'gemma_gate_no_spacy', 'qwen_proof']) {
      const pairs = slice.map(row => ({cluster: cluster(row), a: scores.no_rewrite.get(row.id)?.strict ? 1 : 0, b: scores[arm].get(row.id)?.strict ? 1 : 0}));
      deltas[arm] = scale100(bootstrapDelta(pairs));
    }
    const brokenOnCorrect = slice.filter(r => scores.no_rewrite.get(r.id)?.strict);
    const breakRate = arm => (brokenOnCorrect.length ? mean(brokenOnCorrect.map(r => (scores[arm].get(r.id)?.strict ? 0 : 1))) : null);
    const decision = stopDecision(index + 1, stages.length, brokenShare, deltas.gemma_always_on);
    stageResults.push({stage: index + 1, rows: n, summary, delta_pp: deltas,
      break_rate: {gemma_always_on: round(breakRate('gemma_always_on')), gemma_gate_no_spacy: round(breakRate('gemma_gate_no_spacy')), qwen_proof: round(breakRate('qwen_proof'))},
      decision});
    console.log(JSON.stringify(stageResults.at(-1)));
    if (decision.stop) break;
  }

  const final = stageResults.at(-1);
  const slice = rows.slice(0, final.rows);
  const transitions = arm => ({
    gained: slice.filter(r => !scores.no_rewrite.get(r.id)?.strict && scores[arm].get(r.id)?.strict).map(r => r.id),
    lost: slice.filter(r => scores.no_rewrite.get(r.id)?.strict && !scores[arm].get(r.id)?.strict).map(r => r.id),
  });
  const changedRows = slice.filter(r => byId.get(r.id).gemma_changed);
  const shuffled = mulberry(20260930 + 1), examplePool = [...changedRows];
  for (let i = examplePool.length - 1; i > 0; i--) { const j = Math.floor(shuffled() * (i + 1)); [examplePool[i], examplePool[j]] = [examplePool[j], examplePool[i]]; }
  const examples = examplePool.slice(0, 30).map(row => { const rec = byId.get(row.id); return {id: row.id, before: rec.raw_text, gemma_after: rec.gemma_text, qwen_after: rec.qwen_text, gate: rec.gate,
    no_rewrite_strict: scores.no_rewrite.get(row.id)?.strict, gemma_always_on_strict: scores.gemma_always_on.get(row.id)?.strict, qwen_proof_strict: scores.qwen_proof.get(row.id)?.strict}; });

  const out = {rows_file: path.relative(ROOT, rowsFile), rows_total: rows.length, rows_scored: final.rows, model, rules: RULES_VERSION, stages: stageResults,
    transitions: {gemma_always_on: transitions('gemma_always_on'), gemma_gate_no_spacy: transitions('gemma_gate_no_spacy'), qwen_proof: transitions('qwen_proof')},
    changed_rows_gemma: changedRows.length, examples};
  const outFile = o.out ? path.resolve(o.out) : path.join(OUT, 'diverse-dev.json');
  writeJson(outFile, out);
  console.log(JSON.stringify({rows_scored: out.rows_scored, final_delta_pp: final.delta_pp, final_break_rate: final.break_rate, stop_reason: final.decision.reason}, null, 1));
}

async function main() {
  const o = args(process.argv.slice(2));
  if (o.command === 'run') return runCommand(o);
  throw Error(`Unknown command ${o.command}`);
}
main().catch(error => { console.error(error.stack); process.exit(1); });
