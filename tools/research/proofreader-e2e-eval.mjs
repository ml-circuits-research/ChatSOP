#!/usr/bin/env node
/** Experiment eval-proofreader-e2e-v1: end-to-end SymbolicLM accuracy with the fine-tuned gemma3-270m proofreader
 * wired as the `rewrite` hook (lib/symbolic-lm/index.mjs analyze() `rewrite`/`rewriteWhen`), on formalizer suites
 * never used to build the proofing data (eval/suites/formalizer-v1, formalizer-ood-v1, formalizer-wild-v1).
 *
 * Uses a FROZEN snapshot of lib/symbolic-lm/+languages-util/+translator-service with lib/ud-to-sop replaced by the
 * frozen-rules-v1.4 copy (eval/reports/current/proofing/rules/v1.4, produced by tools/research/proofing-oracle.mjs
 * loadFrozenRules), so a concurrent live edit of lib/ud-to-sop (v1.5, another agent) cannot change a score mid-run.
 * The snapshot is built once by --build-snapshot and lives outside the repo (path given by --snapshot).
 *
 * The proofreader is called through a running llama-server (GGUF Q8_0, verified byte-identical to the merged HF
 * checkpoint's greedy output on 50-100 rows, tools/research/proofing-eval-checkpoint.mjs's sibling verification) at
 * --port, message-only chat completion (matches training's message-only prompt exactly).
 *
 * Two SymbolicLM passes per row: rewrite:null (baseline) and rewrite:<llama-server>,rewriteWhen:'always' (always-on).
 * `result.uncertain` (SymbolicLM's own built-in uncertainty signal, computed before any rewrite decision, identical
 * in both passes) derives the gated arm for free: gated = uncertain ? always-on : baseline.
 *
 *   node tools/research/proofreader-e2e-eval.mjs run   --suite formalizer-v1 --stage 100|300|full --port 8099 --snapshot DIR
 *   node tools/research/proofreader-e2e-eval.mjs score --suite formalizer-v1 --stage 100|300|full
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {evaluate} from '../../eval/run.mjs';
import {stages} from './ud-baseline-eval.mjs';
import {wilson, pairedDelta} from './symbolic-lm-eval.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = path.join(ROOT, 'eval/reports/current/proofreader-e2e');
const sha = text => createHash('sha256').update(text).digest('hex');
const readJsonl = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)) : []);
const writeJsonl = (file, rows) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')); };
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, JSON.stringify(value, null, 1) + '\n'); };

const SUITES = {
  'formalizer-v1': path.join(ROOT, 'eval/suites/formalizer-v1/test.jsonl'),
  'formalizer-ood-v1': path.join(ROOT, 'eval/suites/formalizer-ood-v1/test.jsonl'),
  'formalizer-wild-v1': path.join(ROOT, 'eval/suites/formalizer-wild-v1/test.jsonl'),
};

function args(argv) {
  const [command, ...rest] = argv, out = {command};
  for (let i = 0; i < rest.length; i++) { const key = rest[i].replace(/^--/, ''); out[key] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; }
  return out;
}

function suiteRows(suite) {
  const file = SUITES[suite];
  if (!file) throw Error('unknown suite ' + suite);
  return readJsonlShardedSync(file);
}

/** en-only rows (the arms this experiment scores); wild suite's `mixed` rows are a separate exploratory group. */
function enRows(suite) { return suiteRows(suite).filter(r => r.language === 'en'); }
function mixedRows(suite) { return suiteRows(suite).filter(r => r.language === 'mixed'); }

function setsFile(suite) { return path.join(OUT, suite, 'sets.json'); }
function ensureStages(suite, rows, seed = 42) {
  const file = setsFile(suite);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const staged = stages(rows, r => r.question_type ?? 'unspecified', [100, 300].filter(n => n < rows.length), seed);
  const out = {suite, rows: rows.length, seed, stages: staged};
  writeJson(file, out);
  return out;
}

/** Message-only chat completion against a running llama-server (GGUF), greedy, matching training's prompt exactly. */
function llamaRewriter(port) {
  return async englishText => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({model: 'proofreader', messages: [{role: 'user', content: englishText}], temperature: 0, top_k: 1, max_tokens: 384, seed: 0}),
    });
    if (!res.ok) throw Error(`llama-server ${res.status}`);
    const data = await res.json();
    return String(data.choices[0].message.content ?? '').trim();
  };
}

async function runCommand(o) {
  const stage = o.stage ?? 'full';
  const rows = o.group === 'mixed' ? mixedRows(o.suite) : enRows(o.suite);
  const setInfo = ensureStages(o.suite + (o.group === 'mixed' ? '-mixed' : ''), rows);
  const ids = new Set(setInfo.stages[stage] ?? setInfo.stages.full ?? rows.map(r => r.id));
  const picked = rows.filter(r => ids.has(r.id));
  const {createSymbolicLM} = await import(path.join(o.snapshot, 'lib/symbolic-lm/index.mjs'));
  const lm = await createSymbolicLM({device: 'cpu'});
  const rewrite = llamaRewriter(Number(o.port ?? 8099));
  const route = o.group === 'mixed' ? 'translate' : 'auto';
  const predictions = {baseline: [], always: []};
  const traces = [];
  const started = Date.now();
  for (const row of picked) {
    let base, always;
    try { base = await lm.analyze(row.question, {route, rewrite: null}); }
    catch (error) { base = {sop: '', valid: false, outcome: 'crash', uncertain: null}; }
    try { always = await lm.analyze(row.question, {route, rewrite, rewriteWhen: 'always'}); }
    catch (error) { always = {sop: '', valid: false, outcome: 'crash', uncertain: base.uncertain}; }
    predictions.baseline.push({id: row.id, sop: base.sop});
    predictions.always.push({id: row.id, sop: always.sop});
    traces.push({id: row.id, uncertain: always.uncertain ?? base.uncertain ?? false, reasons: always.reasons ?? base.reasons ?? [], rewrite_applied: always.trace?.rewrite?.applied ?? false, rewrite_input: always.trace?.rewrite?.input ?? null, rewrite_output: always.trace?.rewrite?.output ?? null});
    if (predictions.baseline.length % 25 === 0) process.stderr.write(`\r${o.suite}${o.group === 'mixed' ? ':mixed' : ''} ${predictions.baseline.length}/${picked.length}`);
  }
  await lm.stop();
  const dir = path.join(OUT, o.suite + (o.group === 'mixed' ? '-mixed' : ''));
  writeJsonl(path.join(dir, `baseline-${stage}.predictions.jsonl`), predictions.baseline);
  writeJsonl(path.join(dir, `always-${stage}.predictions.jsonl`), predictions.always);
  writeJsonl(path.join(dir, `traces-${stage}.jsonl`), traces);
  writeJson(path.join(dir, `manifest-${stage}.json`), {suite: o.suite, group: o.group ?? 'en', stage, rows: picked.length, snapshot: o.snapshot, seconds: (Date.now() - started) / 1000, started_at: new Date(started).toISOString()});
  console.error(`\n${o.suite}${o.group === 'mixed' ? ':mixed' : ''} stage ${stage}: ${picked.length} rows in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

async function scoreCommand(o) {
  const stage = o.stage ?? 'full';
  const group = o.group === 'mixed' ? 'mixed' : 'en';
  const dir = path.join(OUT, o.suite + (group === 'mixed' ? '-mixed' : ''));
  const rows = group === 'mixed' ? mixedRows(o.suite) : enRows(o.suite);
  const setInfo = ensureStages(o.suite + (group === 'mixed' ? '-mixed' : ''), rows);
  const ids = new Set(setInfo.stages[stage] ?? setInfo.stages.full ?? rows.map(r => r.id));
  const picked = rows.filter(r => ids.has(r.id));
  const rowById = new Map(picked.map(r => [r.id, r]));
  const baseline = new Map(readJsonl(path.join(dir, `baseline-${stage}.predictions.jsonl`)).map(p => [p.id, p.sop]));
  const always = new Map(readJsonl(path.join(dir, `always-${stage}.predictions.jsonl`)).map(p => [p.id, p.sop]));
  const traces = new Map(readJsonl(path.join(dir, `traces-${stage}.jsonl`)).map(t => [t.id, t]));
  let frames = null;
  try { const mod = await import('../../sop/frames.mjs'); frames = {loadFrames: mod.loadFrames, normalizeProgram: mod.normalizeProgram}; } catch { frames = null; }
  const norm = (sop) => (frames ? frames.normalizeProgram(sop, frames.loadFrames()).sop : sop);
  const repBase = await evaluate(picked, {predictor: ({id}) => baseline.get(id), config: {}, source: 'predictions'});
  const repAlways = await evaluate(picked, {predictor: ({id}) => always.get(id), config: {}, source: 'predictions'});
  const repBaseFrame = frames ? await evaluate(picked, {predictor: ({id}) => norm(baseline.get(id)), config: {}, source: 'predictions'}) : null;
  const repAlwaysFrame = frames ? await evaluate(picked, {predictor: ({id}) => norm(always.get(id)), config: {}, source: 'predictions'}) : null;
  const recOf = report => report.records.map(r => ({id: r.id, strict: r.execution_equivalent ? 1 : 0, tolerant: r.execution_equivalent_tolerant ? 1 : 0}));
  const recBase = recOf(repBase), recAlways = recOf(repAlways);
  const byBase = new Map(recBase.map(r => [r.id, r])), byAlways = new Map(recAlways.map(r => [r.id, r]));
  const gated = picked.map(row => { const t = traces.get(row.id); const use = t?.uncertain ? byAlways.get(row.id) : byBase.get(row.id); return {id: row.id, strict: use.strict, tolerant: use.tolerant}; });
  const k = (rs, key) => rs.filter(r => r[key]).length;
  const acc = rs => ({strict: k(rs, 'strict') / rs.length, strict_ci95: wilson(k(rs, 'strict'), rs.length), tolerant: k(rs, 'tolerant') / rs.length, tolerant_ci95: wilson(k(rs, 'tolerant'), rs.length)});
  // break/repair vs baseline for the always-on and gated arms
  function breakRepair(rs, key) {
    const ok = picked.filter(row => byBase.get(row.id)[key]), bad = picked.filter(row => !byBase.get(row.id)[key]);
    const at = new Map(rs.map(r => [r.id, r]));
    const broken = ok.filter(row => !at.get(row.id)[key]).length, repaired = bad.filter(row => at.get(row.id)[key]).length;
    return {ok: ok.length, bad: bad.length, broken, repaired, break_rate: ok.length ? broken / ok.length : null, break_ci95: ok.length ? wilson(broken, ok.length) : null, repair_rate: bad.length ? repaired / bad.length : null, repair_ci95: bad.length ? wilson(repaired, bad.length) : null};
  }
  const summary = {
    suite: o.suite, group, stage, rows: picked.length,
    baseline: acc(recBase), always: acc(recAlways), gated: acc(gated),
    baseline_frame: repBaseFrame ? acc(recOf(repBaseFrame)) : null, always_frame: repAlwaysFrame ? acc(recOf(repAlwaysFrame)) : null,
    paired_always_minus_baseline: {strict: pairedDelta(picked, recBase, recAlways, r => r.strict), tolerant: pairedDelta(picked, recBase, recAlways, r => r.tolerant)},
    paired_gated_minus_baseline: {strict: pairedDelta(picked, recBase, gated, r => r.strict), tolerant: pairedDelta(picked, recBase, gated, r => r.tolerant)},
    break_repair_always: {strict: breakRepair(recAlways, 'strict'), tolerant: breakRepair(recAlways, 'tolerant')},
    break_repair_gated: {strict: breakRepair(gated, 'strict'), tolerant: breakRepair(gated, 'tolerant')},
    uncertain_share: [...traces.values()].filter(t => t.uncertain).length / Math.max(1, traces.size),
    rewrite_applied_share: [...traces.values()].filter(t => t.rewrite_applied).length / Math.max(1, traces.size),
  };
  writeJson(path.join(dir, `score-${stage}.json`), summary);
  console.log(JSON.stringify({suite: o.suite, group, stage, rows: summary.rows,
    baseline_strict: +(summary.baseline.strict * 100).toFixed(2), always_strict: +(summary.always.strict * 100).toFixed(2), gated_strict: +(summary.gated.strict * 100).toFixed(2),
    delta_always_strict: [+(summary.paired_always_minus_baseline.strict.delta * 100).toFixed(2), summary.paired_always_minus_baseline.strict.ci95?.map(x => +(x * 100).toFixed(2))],
    delta_gated_strict: [+(summary.paired_gated_minus_baseline.strict.delta * 100).toFixed(2), summary.paired_gated_minus_baseline.strict.ci95?.map(x => +(x * 100).toFixed(2))],
    break_always_strict: summary.break_repair_always.strict.break_rate, repair_always_strict: summary.break_repair_always.strict.repair_rate,
    uncertain_share: +summary.uncertain_share.toFixed(3)}, null, 1));
}

/** 20 random changed examples (before/after text differs) for the report, seeded. */
async function examplesCommand(o) {
  const stage = o.stage ?? 'full';
  const group = o.group === 'mixed' ? 'mixed' : 'en';
  const dir = path.join(OUT, o.suite + (group === 'mixed' ? '-mixed' : ''));
  const traces = readJsonl(path.join(dir, `traces-${stage}.jsonl`)).filter(t => t.rewrite_applied);
  let s = 20260930 >>> 0;
  const rand = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = traces.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [traces[i], traces[j]] = [traces[j], traces[i]]; }
  const picked = traces.slice(0, Number(o.n ?? 20));
  writeJson(path.join(dir, `examples-${stage}.json`), picked);
  console.log(JSON.stringify(picked, null, 1));
}

async function main() {
  const o = args(process.argv.slice(2));
  if (o.command === 'run') return runCommand(o);
  if (o.command === 'score') return scoreCommand(o);
  if (o.command === 'examples') return examplesCommand(o);
  throw Error('Unknown command ' + o.command);
}

main().catch(error => { console.error(error.stack); process.exit(1); });
