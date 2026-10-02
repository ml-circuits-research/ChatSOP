#!/usr/bin/env node
/**
 * Aggregates the per-model JSONL of eval-query-model-calibration-v1 into summary.json and summary.md (table per model, per form,
 * paired bootstrap against gpt-6-luna and Qwen3-4B Q8_0).
 *   node tools/eval/query-model-calibration/report.mjs [--dir eval/reports/current/query-model-calibration] [--stage 50|all]
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {MODELS, CPU_VARIANT} from './models.mjs';
import {mulberry, SEED} from './rows.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const dir = path.resolve(ROOT, opt('--dir', 'eval/reports/current/query-model-calibration'));

const pct = (k, n) => (n ? Math.round((1000 * k) / n) / 10 : null);
const quantile = (xs, q) => { if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(q * a.length))]; };
const sum = xs => xs.reduce((a, b) => a + b, 0);
export function wilson(k, n, z = 1.96) { if (!n) return [null, null]; const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [Math.round(1000 * (c - m) / d) / 10, Math.round(1000 * (c + m) / d) / 10]; }

/** Paired bootstrap of (a - b) in executed-correct percentage points over the questions both models ran. */
export function pairedBootstrap(a, b, {resamples = 10000, seed = SEED} = {}) {
  const ids = [...a.keys()].filter(id => b.has(id));
  if (!ids.length) return null;
  const d = ids.map(id => (a.get(id) ? 1 : 0) - (b.get(id) ? 1 : 0));
  const rand = mulberry(seed);
  const means = [];
  for (let r = 0; r < resamples; r++) { let s = 0; for (let i = 0; i < d.length; i++) s += d[Math.floor(rand() * d.length)]; means.push(100 * s / d.length); }
  means.sort((x, y) => x - y);
  return {n: ids.length, diff_pp: Math.round(1000 * sum(d) / d.length) / 10, lo: Math.round(10 * means[Math.floor(0.025 * resamples)]) / 10, hi: Math.round(10 * means[Math.floor(0.975 * resamples)]) / 10};
}

export function loadRuns(dirPath) {
  const runs = {};
  for (const name of fs.readdirSync(dirPath).filter(n => n.endsWith('.jsonl'))) runs[name.replace(/\.jsonl$/, '')] = fs.readFileSync(path.join(dirPath, name), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  return runs;
}

function latencyParts(rows) {
  const sumOf = (r, k) => sum((r.timings ?? []).map(t => t[k] ?? 0));
  return {
    startup_ms_p50: quantile(rows.map(r => sumOf(r, 'startup_ms')).filter(x => x > 0), 0.5),
    model_ms_p50: quantile(rows.map(r => sumOf(r, 'model_ms')).filter(x => x > 0), 0.5),
    prompt_ms_p50: quantile(rows.map(r => sumOf(r, 'prompt_ms')).filter(x => x > 0), 0.5),
    gen_ms_p50: quantile(rows.map(r => sumOf(r, 'gen_ms')).filter(x => x > 0), 0.5),
    gen_tps_median: quantile(rows.flatMap(r => (r.timings ?? []).map(t => t.gen_tps)).filter(Boolean), 0.5),
    cold_prompt_ms_max: Math.max(0, ...rows.flatMap(r => (r.timings ?? []).map(t => t.prompt_ms ?? 0))),
  };
}

export function summarize(rows) {
  const n = rows.length;
  const count = o => rows.filter(r => r.outcome === o).length;
  const valid = rows.filter(r => r.author_status === 'validated').length;
  const correct = count('correct');
  const lat = rows.map(r => r.latency_ms).filter(x => typeof x === 'number');
  const forms = {};
  for (const f of [...new Set(rows.map(r => r.form))].sort()) { const fr = rows.filter(r => r.form === f); forms[f] = {n: fr.length, correct_pct: pct(fr.filter(r => r.outcome === 'correct').length, fr.length), wrong_pct: pct(fr.filter(r => r.outcome === 'wrong').length, fr.length)}; }
  return {
    n, valid_pct: pct(valid, n), correct_pct: pct(correct, n), correct_ci95: wilson(correct, n), wrong_pct: pct(count('wrong'), n), unknown_or_unclear_pct: pct(count('unknown') + count('unclear'), n), invalid_or_failed_pct: pct(count('invalid') + count('failed'), n),
    repairs_mean: n ? Math.round(100 * sum(rows.map(r => r.repairs ?? 0)) / n) / 100 : null, rounds_mean: n ? Math.round(100 * sum(rows.map(r => r.rounds ?? 0)) / n) / 100 : null,
    tokens_out_per_circuit: n ? Math.round(sum(rows.map(r => r.tokens_out)) / n) : null, tokens_in_per_circuit: n ? Math.round(sum(rows.map(r => r.tokens_in)) / n) : null,
    latency_ms_p50: quantile(lat, 0.5), latency_ms_p95: quantile(lat, 0.95), exec_ms_p50: quantile(rows.map(r => r.exec_ms).filter(x => typeof x === 'number'), 0.5),
    cost_usd_per_100: n ? Math.round(1e4 * sum(rows.map(r => r.cost_usd)) / n) / 100 : null, cost_usd_total: Math.round(1e6 * sum(rows.map(r => r.cost_usd))) / 1e6,
    ...latencyParts(rows), forms,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const runs = loadRuns(dir);
  const stageFilter = opt('--ids') ? new Set(fs.readFileSync(opt('--ids'), 'utf8').split('\n').filter(Boolean)) : null;
  const out = {generated_at: new Date().toISOString(), models: {}, paired: {}};
  const byId = {};
  for (const [id, rows0] of Object.entries(runs)) {
    const rows = stageFilter ? rows0.filter(r => stageFilter.has(r.id)) : rows0;
    out.models[id] = {...summarize(rows), settings: MODELS[id.replace(/-cpu$/, '')] ? {kind: MODELS[id.replace(/-cpu$/, '')].kind, model: MODELS[id.replace(/-cpu$/, '')].model ?? MODELS[id.replace(/-cpu$/, '')].name, cpu: /-cpu$/.test(id), note: MODELS[id.replace(/-cpu$/, '')].note ?? null} : null};
    byId[id] = new Map(rows.map(r => [r.id, r.outcome === 'correct']));
  }
  for (const ref of ['luna', 'qwen3-4b-q8']) for (const id of Object.keys(byId)) if (id !== ref && byId[ref]) out.paired[`${id} - ${ref}`] = pairedBootstrap(byId[id], byId[ref]);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(out, null, 1) + '\n');
  const f = x => (x === null || x === undefined ? '-' : x);
  const sec = ms => (ms == null ? '-' : (ms / 1000).toFixed(1));
  const lines = ['# Query-model calibration (eval-query-model-calibration-v1)', '', `Generated ${out.generated_at}. Executed scoring on world-v1; same prompt and loop (lib/query-author) for every model.`, '',
    '| model | n | valid after repair % | executed-correct % (95% CI) | wrong % | unclear/unknown % | repairs/q | tokens out/circuit | latency p50 / p95 (s) | cost per 100 q (USD) |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const [id, m] of Object.entries(out.models)) lines.push(`| ${id} | ${m.n} | ${f(m.valid_pct)} | ${f(m.correct_pct)} (${m.correct_ci95.join('-')}) | ${f(m.wrong_pct)} | ${f(m.unknown_or_unclear_pct)} | ${f(m.repairs_mean)} | ${f(m.tokens_out_per_circuit)} | ${sec(m.latency_ms_p50)} / ${sec(m.latency_ms_p95)} | ${f(m.cost_usd_per_100)} |`);
  lines.push('', '## Per form: executed-correct % (n)', '');
  const forms = [...new Set(Object.values(out.models).flatMap(m => Object.keys(m.forms)))].sort();
  lines.push('| model | ' + forms.join(' | ') + ' |', '|---|' + forms.map(() => '---').join('|') + '|');
  for (const [id, m] of Object.entries(out.models)) lines.push(`| ${id} | ` + forms.map(x => (m.forms[x] ? `${f(m.forms[x].correct_pct)} (${m.forms[x].n})` : '-')).join(' | ') + ' |');
  lines.push('', '## Latency parts (median per question, ms)', '', '| model | start-up | model turns | prompt processing | generation | gen tok/s | longest cold prompt |', '|---|---|---|---|---|---|---|');
  for (const [id, m] of Object.entries(out.models)) lines.push(`| ${id} | ${f(m.startup_ms_p50)} | ${f(m.model_ms_p50)} | ${f(m.prompt_ms_p50)} | ${f(m.gen_ms_p50)} | ${f(m.gen_tps_median && Math.round(m.gen_tps_median * 10) / 10)} | ${f(m.cold_prompt_ms_max && Math.round(m.cold_prompt_ms_max))} |`);
  lines.push('', '## Paired bootstrap (executed-correct difference, percentage points, 95% interval)', '');
  for (const [k, v] of Object.entries(out.paired)) if (v) lines.push(`- ${k}: ${v.diff_pp} pp [${v.lo}, ${v.hi}] (n=${v.n})`);
  fs.writeFileSync(path.join(dir, 'summary.md'), lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}
