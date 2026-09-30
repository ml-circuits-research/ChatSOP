#!/usr/bin/env node
/** Experiment eval-grammar-constrained-v1: grammar-constrained decoding of the fine-tuned small formalizers.
 *
 * Two conditions of the same checkpoint, server and request (lib/formalizer-endpoint.mjs `predictMessage`, the
 * message as the only input, greedy): `free` (no grammar) and `gbnf` (llama.cpp GBNF of the SOP model surface,
 * tools/sop-gbnf.mjs). Rows are taken in a stratified order (language x question type, mulberry32 seed 42) so every
 * prefix is a stratified sample; the evaluation runs in stages (100, 300, then the full cell) and stops early by
 * the owner's sequential rule (see `stageDecision`).
 *
 *   node tools/research/grammar-constrained-eval.mjs run --model smollm2-360m --cell wild --url http://127.0.0.1:18961 --device "gpu:…"
 *   node tools/research/grammar-constrained-eval.mjs predict --model smollm2-360m --cell wild --stage 1 --url http://127.0.0.1:18961 [--parallel 1]
 *   node tools/research/grammar-constrained-eval.mjs score --model smollm2-360m --cell wild [--reps 2000]
 *   node tools/research/grammar-constrained-eval.mjs cpu --model smollm2-360m --url http://127.0.0.1:18962 --rows 40
 *
 * Requests go one at a time by default and without llama-server's prompt cache: with several slots decoding
 * together, or with a prompt prefix reused from an earlier request, greedy outputs depend on the batch and on the
 * request history (A/A controls of identical free runs differed on 6-33% of rows); `free-aa` repeats the free
 * condition in the same session as a control, so the two conditions differ only by the grammar. `run` predicts and scores stage after stage until the
 * stopping rule ends the cell.
 *
 * Cells: `wild` (formalizer-wild-v1, 796), `ood` (formalizer-ood-v1: all 1,578 for 360M, a 500-row stratified
 * prefix for 135M), `test500` (the stratified 500-row sealed-test sample of formalizer-size-v1).
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {predictMessage} from '../../lib/formalizer-endpoint.mjs';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {evaluate} from '../../eval/run.mjs';
import {referenceFreeRecord} from '../../eval/reference-free.mjs';
import {rowWireComparison} from '../../eval/metrics.mjs';
import {scoreAgainstAccepted} from '../eval/wild-suite.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const at = file => path.join(root, file);
export const REPORT_DIR = 'eval/reports/current/grammar-constrained';
export const GRAMMAR = `${REPORT_DIR}/sop-model.gbnf`;
export const CONDITIONS = ['free', 'gbnf'];
/** Grammar per condition. `gbnf-lax` is EXPLORATORY (added after stage 1): strings may start with blanks, as the parser allows. */
export const GRAMMARS = {gbnf: GRAMMAR, 'gbnf-lax': `${REPORT_DIR}/sop-model-parser-strings.gbnf`, 'free-aa': null};
const SUITES = {
  wild: 'eval/suites/formalizer-wild-v1/test.jsonl',
  ood: 'eval/suites/formalizer-ood-v1/test.jsonl',
  test500: 'eval/reports/current/formalizer-size-v1/sample500/formalizer-v1-sample500.suite.jsonl',
};
/** Rows per cell and model; the stages are the cumulative prefixes 100, 300 and the whole cell. */
export const CELL_ROWS = {'smollm2-135m': {wild: 796, ood: 500, test500: 500}, 'smollm2-360m': {wild: 796, ood: 1578, test500: 500}};
export const stagesOf = total => [...new Set([100, 300, total].filter(n => n <= total))];
const MAX_TOKENS = 6144;
const round = x => x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10000) / 10000;
const readJsonl = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
const languageSlice = row => row.language === 'mixed' || row.code_switch ? 'mixed' : row.language;

function mulberry(seed) {
  let state = seed >>> 0;
  return () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Stratified order: each stratum (language x question type) shuffled, rows placed at their fractional rank, so a prefix of any length is (approximately) proportional. */
export function stratifiedOrder(rows, seed = 42) {
  const random = mulberry(seed), strata = new Map();
  for (const row of rows) { const key = `${languageSlice(row)}|${row.question_type ?? 'none'}`; if (!strata.has(key)) strata.set(key, []); strata.get(key).push(row); }
  const keyed = [];
  for (const list of [...strata.values()]) {
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    const offset = random();
    list.forEach((row, index) => keyed.push({row, key: (index + offset) / list.length}));
  }
  return keyed.sort((a, b) => a.key - b.key || (a.row.id < b.row.id ? -1 : 1)).map(item => item.row);
}
export function cellRows(model, cell) {
  const rows = readJsonlShardedSync(at(SUITES[cell])).map(row => ({...row, suite: cell === 'wild' ? 'formalizer-wild-v1' : cell === 'ood' ? 'formalizer-ood-v1' : 'formalizer-v1'}));
  return stratifiedOrder(rows).slice(0, CELL_ROWS[model][cell]);
}
const workFile = (model, cell, condition) => at(`${REPORT_DIR}/work/${model}/${cell}.${condition}.jsonl`);

async function predict({model, cell, stage, url, parallel = 1, conditions = CONDITIONS, device}) {
  const rows = cellRows(model, cell), limit = stagesOf(rows.length)[stage - 1];
  if (!limit) throw Error(`${cell} has ${stagesOf(rows.length).length} stages`);
  for (const condition of conditions) {
    const grammar = GRAMMARS[condition] ? fs.readFileSync(at(GRAMMARS[condition]), 'utf8') : null;
    const file = workFile(model, cell, condition), done = new Set(readJsonl(file).map(r => r.id));
    const todo = rows.slice(0, limit).filter(row => !done.has(row.id));
    fs.mkdirSync(path.dirname(file), {recursive: true});
    let next = 0;
    const started = performance.now();
    const worker = async () => {
      while (next < todo.length) {
        const row = todo[next++];
        let record;
        try {
          const r = await predictMessage(url, row.question, {maxTokens: MAX_TOKENS, grammar, cachePrompt: false});
          record = {id: row.id, sop: r.text, finish: r.finish, ms: r.ms, completion_tokens: r.usage?.completion_tokens ?? null, prompt_tokens: r.usage?.prompt_tokens ?? null,
            gen_tps: r.timings?.predicted_per_second ?? null, raw: !!r.raw};
        } catch (error) { record = {id: row.id, sop: '', error: error.message, ms: null}; }
        fs.appendFileSync(file, JSON.stringify({...record, device, stage}) + '\n');
      }
    };
    await Promise.all(Array.from({length: parallel}, worker));
    console.log(JSON.stringify({model, cell, condition, stage, rows: limit, predicted: todo.length, seconds: +((performance.now() - started) / 1000).toFixed(1)}));
  }
}

/** Per-row numbers from which every metric is a ratio of sums, so the bootstrap can resample them. */
function rowNumbers(row, record, exec) {
  const sop = record?.sop ?? '';
  const rf = referenceFreeRecord(row.question, sop);
  const c = rowWireComparison(row, sop);
  const n = {rows: 1, parse: rf.parse_valid ? 1 : 0, compile: rf.compile_valid ? 1 : 0, empty: sop.trim() ? 0 : 1, truncated: record?.finish === 'length' ? 1 : 0, error: record?.error ? 1 : 0,
    wire_matched: c.matched, wire_gold: c.gold, wire_predicted: c.predicted};
  if (exec !== undefined) { n.exec_rows = 1; n.exec = exec ? 1 : 0; }
  if (row.suite === 'formalizer-wild-v1') {
    const w = scoreAgainstAccepted(sop, row.sop_targets_accepted);
    Object.assign(n, {wild_rows: 1, accepted_match: w.accepted_match, decision_match: w.decision_match, proposition_f1: w.proposition_f1});
  }
  return n;
}
export const METRICS = {
  parse_validity: s => s.parse / s.rows,
  compile_validity: s => s.compile / s.rows,
  empty_or_error: s => (s.empty + s.error) / s.rows,
  truncated: s => s.truncated / s.rows,
  execution_equivalence_tolerant: s => s.exec_rows ? s.exec / s.exec_rows : null,
  wire_f1: s => s.wire_gold + s.wire_predicted ? 2 * s.wire_matched / (s.wire_gold + s.wire_predicted) : null,
  wild_accepted_match: s => s.wild_rows ? s.accepted_match / s.wild_rows : null,
  wild_decision_match: s => s.wild_rows ? s.decision_match / s.wild_rows : null,
  wild_proposition_f1: s => s.wild_rows ? s.proposition_f1 / s.wild_rows : null,
};
export const PRIMARY = {wild: 'wild_accepted_match', ood: 'execution_equivalence_tolerant', test500: 'execution_equivalence_tolerant'};
const add = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = (a[k] ?? 0) + v; return a; };
function summarize(list) {
  const s = list.reduce((acc, n) => add(acc, n), {});
  const out = {rows: list.length};
  for (const [name, f] of Object.entries(METRICS)) { const v = s.rows ? f(s) : null; if (v !== null) out[name] = round(v); }
  out.counts = {parse: s.parse, compile: s.compile, exec: s.exec ?? null, accepted_match: s.accepted_match ?? null};
  return out;
}
/** Paired cluster bootstrap of metric(gbnf) - metric(free); clusters are split groups (test/OOD) or rows (wild). */
export function bootstrapDelta(pairs, metric, reps = 2000, seed = 42) {
  const clusters = new Map();
  for (const p of pairs) { if (!clusters.has(p.cluster)) clusters.set(p.cluster, {a: {}, b: {}}); add(clusters.get(p.cluster).a, p.a); add(clusters.get(p.cluster).b, p.b); }
  const list = [...clusters.values()];
  const all = list.reduce((acc, c) => ({a: add(acc.a, c.a), b: add(acc.b, c.b)}), {a: {}, b: {}});
  const point = metric(all.b) - metric(all.a);
  if (!Number.isFinite(point)) return null;
  const random = mulberry(seed), deltas = [];
  for (let r = 0; r < reps; r++) {
    const a = {}, b = {};
    for (let i = 0; i < list.length; i++) { const c = list[Math.floor(random() * list.length)]; add(a, c.a); add(b, c.b); }
    const d = metric(b) - metric(a);
    if (Number.isFinite(d)) deltas.push(d);
  }
  deltas.sort((x, y) => x - y);
  return {delta: round(point), ci95: [round(deltas[Math.floor(0.025 * deltas.length)]), round(deltas[Math.floor(0.975 * deltas.length)])], clusters: list.length};
}
/**
 * The owner's sequential rule (2026-09-29), applied to the cell's primary metric after each stage:
 * stop `broken` when the grammar condition has > 20% parse failures or empty outputs on the first 100 rows;
 * stop `efficacy` when the 95% interval lies above +2 pp; stop `futility` when its upper bound is below +1 pp;
 * otherwise continue to the next stage (the last stage always ends the cell).
 */
export function stageDecision(stage, stages, summaryGbnf, delta) {
  if (stage === 1 && (1 - summaryGbnf.parse_validity > 0.2 || summaryGbnf.empty_or_error > 0.2)) return {stop: true, reason: 'broken'};
  if (delta && delta.ci95[0] >= 0.02) return {stop: true, reason: 'efficacy'};
  if (delta && delta.ci95[1] < 0.01) return {stop: true, reason: 'futility'};
  if (stage >= stages) return {stop: true, reason: 'complete'};
  return {stop: false, reason: 'ambiguous: continue'};
}

async function score({model, cell, reps = 2000, b = 'gbnf'}) {
  const conds = ['free', b];
  const rows = cellRows(model, cell), stages = stagesOf(rows.length);
  const records = Object.fromEntries(conds.map(c => [c, new Map(readJsonl(workFile(model, cell, c)).map(r => [r.id, r]))]));
  const done = rows.filter(row => conds.every(c => records[c].has(row.id)));
  const reached = stages.filter(n => n <= done.length && rows.slice(0, n).every(row => conds.every(c => records[c].has(row.id))));
  if (!reached.length) throw Error(`${model} ${cell}: no complete stage yet (${done.length} rows done)`);
  const scored = rows.slice(0, reached.at(-1));
  const perRow = {};
  for (const condition of conds) {
    const byId = records[condition];
    const exec = new Map();
    if (cell !== 'wild') {
      const report = await evaluate(scored, {predictor: ({id}) => byId.get(id).sop, source: 'predictions'});
      for (const r of report.records) exec.set(r.id, !!r.execution_equivalent_tolerant);
    }
    perRow[condition] = new Map(scored.map(row => [row.id, rowNumbers(row, byId.get(row.id), cell === 'wild' ? undefined : exec.get(row.id))]));
  }
  const cluster = row => row.suite === 'formalizer-wild-v1' ? row.id : row.split_group_id ?? row.id;
  const deltaMetrics = ['parse_validity', 'compile_validity', cell === 'wild' ? 'wild_accepted_match' : 'execution_equivalence_tolerant', 'wire_f1', ...(cell === 'wild' ? ['wild_decision_match', 'wild_proposition_f1'] : [])];
  const metricFn = name => s => { const v = METRICS[name](s); return v === null ? NaN : v; };
  const pairsOf = list => list.map(row => ({cluster: cluster(row), a: perRow.free.get(row.id), b: perRow[b].get(row.id)}));
  const stageResults = [];
  for (const [index, n] of reached.entries()) {
    const list = scored.slice(0, n);
    const summary = Object.fromEntries(conds.map(c => [c, summarize(list.map(row => perRow[c].get(row.id)))]));
    const delta = bootstrapDelta(pairsOf(list), metricFn(PRIMARY[cell]), reps);
    stageResults.push({stage: index + 1, rows: n, primary: PRIMARY[cell], summary, primary_delta: delta, decision: stageDecision(index + 1, stages.length, summary[b], delta)});
    if (stageResults.at(-1).decision.stop) break;
  }
  const final = stageResults.at(-1), list = scored.slice(0, final.rows);
  const slices = {all: list};
  for (const row of list) (slices[`language:${languageSlice(row)}`] ??= []).push(row);
  const metrics = {}, deltas = {};
  for (const [slice, members] of Object.entries(slices)) {
    metrics[slice] = Object.fromEntries(conds.map(c => [c, summarize(members.map(row => perRow[c].get(row.id)))]));
    deltas[slice] = Object.fromEntries(deltaMetrics.map(m => [m, bootstrapDelta(pairsOf(members), metricFn(m), reps)]));
  }
  // Speed on the prediction device (bulk, parallel slots): per-message latency and server generation tokens/s.
  const quant = values => { const s = values.filter(Number.isFinite).sort((a, b) => a - b); const q = p => s.length ? round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) : null; return {count: s.length, mean: s.length ? round(s.reduce((a, b) => a + b, 0) / s.length) : null, p50: q(0.5), p95: q(0.95)}; };
  const speed = Object.fromEntries(conds.map(c => { const rs = list.map(row => records[c].get(row.id)); return [c, {device: [...new Set(rs.map(r => r.device))], latency_ms: quant(rs.map(r => r.ms)), completion_tokens: quant(rs.map(r => r.completion_tokens)), gen_tokens_per_second: quant(rs.map(r => r.gen_tps))}]; }));
  // Examples: rows where the grammar changed the outcome of the primary metric, or turned an unparsable output into a parsable one.
  const outcome = (c, row) => { const n = perRow[c].get(row.id); return cell === 'wild' ? n.accepted_match : n.exec; };
  // changed_valid: the free output was already valid and the grammar still changed it (a canonical-form restriction).
  const examples = {helped: [], hurt: [], repaired_parse: [], forced_wrong: [], changed_valid: []};
  for (const row of list) {
    const fa = perRow.free.get(row.id), fb = perRow[b].get(row.id);
    const item = () => ({id: row.id, language: languageSlice(row), question: row.question, gold: row.sop_target, free: records.free.get(row.id).sop, [b]: records[b].get(row.id).sop});
    if (!outcome('free', row) && outcome(b, row)) examples.helped.push(item());
    if (outcome('free', row) && !outcome(b, row)) examples.hurt.push(item());
    if (!fa.parse && fb.parse) examples.repaired_parse.push(item());
    if (!fa.parse && fb.parse && !outcome(b, row)) examples.forced_wrong.push(item());
    if (fa.parse && records.free.get(row.id).sop !== records[b].get(row.id).sop) examples.changed_valid.push(item());
  }
  const changed = list.filter(row => records.free.get(row.id).sop !== records[b].get(row.id).sop).length;
  const result = {format: 'chatsop-grammar-constrained-cell-v1', model, cell, comparison: `${b} - free`, suite: SUITES[cell], cell_rows: rows.length, stages, stage_results: stageResults, final_rows: final.rows, stopped: final.decision,
    identical_outputs: round(1 - changed / list.length), metrics, deltas, speed,
    example_counts: Object.fromEntries(Object.entries(examples).map(([k, v]) => [k, v.length])), examples: Object.fromEntries(Object.entries(examples).map(([k, v]) => [k, v.slice(0, 8)]))};
  const out = at(`${REPORT_DIR}/${model}/${cell}${b === 'gbnf' ? '' : '.' + b}.results.json`);
  fs.mkdirSync(path.dirname(out), {recursive: true});
  fs.writeFileSync(out, JSON.stringify(result, null, 1) + '\n');
  console.log(JSON.stringify({model, cell, stages: stageResults.map(s => ({rows: s.rows, free: s.summary.free[PRIMARY[cell]], gbnf: s.summary[b][PRIMARY[cell]], parse: [s.summary.free.parse_validity, s.summary[b].parse_validity], delta: s.primary_delta, decision: s.decision}))}, null, 1));
  return result;
}

/**
 * CPU speed on a small sample: each message sent `reps` times per condition, one request at a time, in ABBA order
 * (free, gbnf, gbnf, free, …) so load drift and prompt caching hit both conditions alike. The robust summary is the
 * median over messages of the paired latency ratio (the CPU is shared with other agents' servers).
 */
async function cpu({model, url, rows: count = 40, reps = 2, device}) {
  const rows = cellRows(model, 'test500').slice(0, count);
  const grammar = fs.readFileSync(at(GRAMMAR), 'utf8');
  const records = [];
  for (const [index, row] of rows.entries()) {
    const order = [];
    for (let r = 0; r < reps; r++) order.push(...((index + r) % 2 ? ['gbnf', 'free'] : ['free', 'gbnf']));
    for (const condition of order) {
      const r = await predictMessage(url, row.question, {maxTokens: MAX_TOKENS, grammar: condition === 'gbnf' ? grammar : null});
      records.push({id: row.id, condition, ms: r.ms, completion_tokens: r.usage?.completion_tokens ?? null, gen_tps: r.timings?.predicted_per_second ?? null, prompt_ms: r.timings?.prompt_ms ?? null, predicted_ms: r.timings?.predicted_ms ?? null, text: r.text});
    }
  }
  const byCondition = c => records.filter(r => r.condition === c);
  const sum = (list, key) => list.reduce((n, r) => n + (r[key] ?? 0), 0);
  const median = values => { const s = values.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const quant = values => { const s = values.filter(Number.isFinite).sort((a, b) => a - b); return {mean: round(s.reduce((a, b) => a + b, 0) / s.length), p50: round(s[Math.floor(0.5 * s.length)]), p95: round(s[Math.min(s.length - 1, Math.floor(0.95 * s.length))])}; };
  // Per message: the median of its repetitions per condition, then the paired ratio.
  const perMessage = rows.map(row => {
    const of = (c, key) => median(records.filter(r => r.id === row.id && r.condition === c).map(r => r[key]));
    return {id: row.id, free_ms: of('free', 'ms'), gbnf_ms: of('gbnf', 'ms'), free_ms_per_token: of('free', 'predicted_ms') / of('free', 'completion_tokens'), gbnf_ms_per_token: of('gbnf', 'predicted_ms') / of('gbnf', 'completion_tokens'),
      identical: records.find(r => r.id === row.id && r.condition === 'free').text === records.find(r => r.id === row.id && r.condition === 'gbnf').text};
  });
  const summary = Object.fromEntries(CONDITIONS.map(c => [c, {latency_ms: quant(perMessage.map(m => m[c + '_ms'])), gen_tokens_per_second: quant(byCondition(c).map(r => r.gen_tps)),
    completion_tokens: sum(byCondition(c), 'completion_tokens'), aggregate_tokens_per_second: round(sum(byCondition(c), 'completion_tokens') / (sum(byCondition(c), 'predicted_ms') / 1000))}]));
  const result = {format: 'chatsop-grammar-constrained-cpu-v2', model, device, rows: rows.length, reps, sample: 'first rows of the stratified test500 order', summary,
    latency_ratio_median: round(median(perMessage.map(m => m.gbnf_ms / m.free_ms))), ms_per_token_ratio_median: round(median(perMessage.map(m => m.gbnf_ms_per_token / m.free_ms_per_token))),
    latency_ratio_of_means: round(summary.gbnf.latency_ms.mean / summary.free.latency_ms.mean), tokens_per_second_ratio: round(summary.gbnf.aggregate_tokens_per_second / summary.free.aggregate_tokens_per_second),
    identical_outputs: perMessage.filter(m => m.identical).length, per_message: perMessage, records};
  const out = at(`${REPORT_DIR}/${model}/cpu-speed.json`);
  fs.mkdirSync(path.dirname(out), {recursive: true});
  fs.writeFileSync(out, JSON.stringify(result, null, 1) + '\n');
  console.log(JSON.stringify({model, device, summary, latency_ratio_median: result.latency_ratio_median, ms_per_token_ratio_median: result.ms_per_token_ratio_median, latency_ratio_of_means: result.latency_ratio_of_means, identical: result.identical_outputs}, null, 1));
}

/** summary.json: every cell (main and exploratory), the CPU speed samples, the ceilings and the CPU-baseline control. */
function summary() {
  const read = file => fs.existsSync(at(file)) ? JSON.parse(fs.readFileSync(at(file), 'utf8')) : null;
  const BASELINE = {'smollm2-135m': {wild: 'formalizer-wild-v1-q8_0', ood: 'formalizer-ood-v1-q8_0', test500: 'formalizer-v1-q8_0'}, 'smollm2-360m': {wild: 'formalizer-wild-v1-q8_0', ood: 'formalizer-ood-v1-q8_0', test500: 'formalizer-v1-sample500-q8_0'}};
  const out = {format: 'chatsop-grammar-constrained-summary-v1', experiment: 'eval-grammar-constrained-v1', generated_at: new Date().toISOString(), grammar: GRAMMARS, cells: {}, cpu: {},
    ceiling: read(`${REPORT_DIR}/ceiling.json`)?.cells ?? null, ceiling_parser_strings: read(`${REPORT_DIR}/ceiling-parser-strings.json`)?.cells ?? null};
  for (const model of Object.keys(CELL_ROWS)) {
    out.cpu[model] = (({model: _m, records: _r, per_message: _p, ...rest}) => rest)(read(`${REPORT_DIR}/${model}/cpu-speed.json`) ?? {});
    for (const cell of Object.keys(SUITES)) for (const b of Object.keys(GRAMMARS)) {
      const r = read(`${REPORT_DIR}/${model}/${cell}${b === 'gbnf' ? '' : '.' + b}.results.json`);
      if (!r) continue;
      // Control: the GPU free outputs against the formalizer-size-v1 CPU free outputs of the same rows.
      const cpuFree = new Map(readJsonl(at(`eval/reports/current/formalizer-size-v1/${model}/${BASELINE[model][cell]}.predictions.jsonl`)).map(x => [x.id, x.sop]));
      const gpuFree = readJsonl(workFile(model, cell, 'free')).slice(0, r.final_rows);
      const same = gpuFree.filter(x => cpuFree.has(x.id) && cpuFree.get(x.id) === x.sop).length;
      out.cells[`${model}/${cell}/${b}`] = {model, cell, condition: b, exploratory: b !== 'gbnf', rows: r.final_rows, stopped: r.stopped, primary: PRIMARY[cell], stage_results: r.stage_results.map(({summary: _s, ...rest}) => rest),
        metrics: r.metrics, deltas: r.deltas, speed_gpu: r.speed, identical_outputs: r.identical_outputs, example_counts: r.example_counts,
        control_gpu_free_equals_cpu_free: {same, of: gpuFree.filter(x => cpuFree.has(x.id)).length}};
    }
  }
  fs.writeFileSync(at(`${REPORT_DIR}/summary.json`), JSON.stringify(out, null, 1) + '\n');
  console.log(`wrote ${REPORT_DIR}/summary.json (${Object.keys(out.cells).length} cells)`);
  return out;
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  const args = {};
  for (let i = 0; i < rest.length; i += 2) args[rest[i].replace(/^--/, '')] = rest[i + 1];
  if (command === 'summary') return summary();
  if (!CELL_ROWS[args.model]) throw Error('--model smollm2-135m|smollm2-360m');
  if (command === 'predict') return predict({model: args.model, cell: args.cell, stage: Number(args.stage), url: args.url, parallel: Number(args.parallel ?? 1), device: args.device ?? 'unknown'});
  if (command === 'run') {
    const stages = stagesOf(CELL_ROWS[args.model][args.cell]).length;
    for (let stage = 1; stage <= stages; stage++) {
      await predict({model: args.model, cell: args.cell, stage, url: args.url, parallel: Number(args.parallel ?? 1), device: args.device ?? 'unknown'});
      const result = await score({model: args.model, cell: args.cell, reps: Number(args.reps ?? 2000)});
      if (result.stopped.stop && result.stage_results.length === stage) return result;
    }
    return;
  }
  if (command === 'score') return score({model: args.model, cell: args.cell, reps: Number(args.reps ?? 2000), b: args.condition ?? 'gbnf'});
  if (command === 'predict-exploratory') return predict({model: args.model, cell: args.cell, stage: Number(args.stage ?? 1), url: args.url, parallel: 1, conditions: [args.condition], device: args.device ?? 'unknown'});
  if (command === 'cpu') return cpu({model: args.model, url: args.url, rows: Number(args.rows ?? 40), reps: Number(args.reps ?? 2), device: args.device ?? 'cpu'});
  throw Error('Usage: grammar-constrained-eval.mjs predict|score|cpu …');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.stack ?? error.message); process.exitCode = 1; });
}
