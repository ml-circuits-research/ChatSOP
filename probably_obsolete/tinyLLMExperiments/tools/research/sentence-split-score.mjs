/** Scoring of experiment eval-sentence-split-v1 (called by tools/research/sentence-split-eval.mjs score).
 *
 * Per set and condition: tolerant execution equivalence (eval/run.mjs `evaluate`, sealed test and OOD rows),
 * DS016 wire F1 (micro), rows with wire F1 >= 0.9 and query-part correctness (eval/metrics.mjs), and for the wild
 * suite accepted match, decision match and proposition F1 (tools/eval/wild-suite.mjs `scoreAgainstAccepted`).
 * Latency is the sum of the calls a condition needs per message. Deltas against S0 (and S2 against S1) use a
 * paired cluster bootstrap (clusters: split groups for formalizer-v1/OOD rows, rows for wild; mulberry32 seed 42).
 * A heuristic error analysis labels rows that splitting makes worse.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {evaluate} from '../../eval/run.mjs';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {rowWireComparison, WIRE_F1_THRESHOLD} from '../../eval/metrics.mjs';
import {scoreAgainstAccepted} from '../eval/wild-suite.mjs';
import {parse} from '../../sop/parser.mjs';
import {propositionOf} from '../../sop/propositions.mjs';
import {rowsOf, conditionsOf, REPORT_DIR, PREREGISTERED_S2} from './sentence-split-eval.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const at = file => path.join(root, file);
const CONDITIONS = ['S0', 'S1', 'S2', 'S2dedupe', 'S2diff', 'S2hybrid'];
const round = x => x === null || x === undefined || Number.isNaN(x) ? null : Math.round(x * 10000) / 10000;
const readJsonl = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const languageSlice = row => row.language === 'mixed' || row.code_switch ? 'mixed' : row.language;
const quantiles = values => {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b), q = p => s.length ? round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) : null;
  return {count: s.length, mean: s.length ? round(s.reduce((a, b) => a + b, 0) / s.length) : null, p50: q(0.5), p90: q(0.9), p95: q(0.95), max: s.length ? round(s.at(-1)) : null};
};

/** Per-row numbers from which every metric is a ratio of sums (so the bootstrap can resample them). */
function rowNumbers(row, sop, exec) {
  const c = rowWireComparison(row, sop);
  const n = {
    rows: 1, wire_matched: c.matched, wire_gold: c.gold, wire_predicted: c.predicted, f1_ge_0_9: c.f1 >= WIRE_F1_THRESHOLD ? 1 : 0, row_f1: c.f1,
    stmt_matched: c.statements.matched, stmt_gold: c.statements.gold, stmt_predicted: c.statements.predicted,
    query_rows: c.problems.gold > 0 ? 1 : 0, query_correct: c.problems_correct ? 1 : 0, unparsable: c.unparsable,
  };
  if (exec !== undefined) { n.exec_rows = 1; n.exec = exec ? 1 : 0; }
  if (row.suite === 'formalizer-wild-v1') {
    const w = scoreAgainstAccepted(sop, row.sop_targets_accepted);
    Object.assign(n, {wild_rows: 1, accepted_match: w.accepted_match, decision_match: w.decision_match, proposition_f1: w.proposition_f1, parsed: w.parsed ? 1 : 0});
  }
  return n;
}
const METRICS = {
  execution_equivalence_tolerant: s => s.exec_rows ? s.exec / s.exec_rows : null,
  wire_f1: s => s.wire_gold + s.wire_predicted ? 2 * s.wire_matched / (s.wire_gold + s.wire_predicted) : null,
  wire_precision: s => s.wire_predicted ? s.wire_matched / s.wire_predicted : null,
  wire_recall: s => s.wire_gold ? s.wire_matched / s.wire_gold : null,
  statement_f1: s => s.stmt_gold + s.stmt_predicted ? 2 * s.stmt_matched / (s.stmt_gold + s.stmt_predicted) : null,
  mean_row_wire_f1: s => s.rows ? s.row_f1 / s.rows : null,
  rows_wire_f1_ge_0_9: s => s.rows ? s.f1_ge_0_9 / s.rows : null,
  query_part_correct: s => s.query_rows ? s.query_correct / s.query_rows : null,
  wild_accepted_match: s => s.wild_rows ? s.accepted_match / s.wild_rows : null,
  wild_decision_match: s => s.wild_rows ? s.decision_match / s.wild_rows : null,
  wild_proposition_f1: s => s.wild_rows ? s.proposition_f1 / s.wild_rows : null,
  wild_parsed: s => s.wild_rows ? s.parsed / s.wild_rows : null,
};
const add = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = (a[k] ?? 0) + v; return a; };
const summarize = list => {
  const s = list.reduce((acc, n) => add(acc, n), {});
  const out = {rows: list.length};
  for (const [name, f] of Object.entries(METRICS)) { const v = f(s); if (v !== null) out[name] = round(v); }
  if (s.exec_rows) out.execution_counts = {n: s.exec, d: s.exec_rows};
  if (s.query_rows) out.query_counts = {n: s.query_correct, d: s.query_rows};
  out.rows_wire_f1_ge_0_9_counts = {n: s.f1_ge_0_9, d: s.rows};
  if (s.wild_rows) out.wild_accepted_counts = {n: s.accepted_match, d: s.wild_rows};
  return out;
};

/** Paired cluster bootstrap of metric(B) - metric(A); `pairs` is [{cluster, a, b}] of per-row numbers. */
function bootstrapDelta(pairs, metric, reps, seed = 42) {
  const clusters = new Map();
  for (const p of pairs) { if (!clusters.has(p.cluster)) clusters.set(p.cluster, {a: {}, b: {}}); add(clusters.get(p.cluster).a, p.a); add(clusters.get(p.cluster).b, p.b); }
  const list = [...clusters.values()];
  const all = list.reduce((acc, c) => ({a: add(acc.a, c.a), b: add(acc.b, c.b)}), {a: {}, b: {}});
  const point = metric(all.b) - metric(all.a);
  if (!Number.isFinite(point)) return null;
  let state = seed >>> 0;
  const random = () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const deltas = [];
  for (let r = 0; r < reps; r++) {
    const a = {}, b = {};
    for (let i = 0; i < list.length; i++) { const c = list[Math.floor(random() * list.length)]; add(a, c.a); add(b, c.b); }
    const d = metric(b) - metric(a);
    if (Number.isFinite(d)) deltas.push(d);
  }
  deltas.sort((x, y) => x - y);
  return {delta: round(point), ci95: [round(deltas[Math.floor(0.025 * deltas.length)]), round(deltas[Math.floor(0.975 * deltas.length)])], clusters: list.length};
}

// ---------- error analysis of rows that splitting makes worse ----------
const PRONOUN_VALUES = new Set(['he', 'she', 'it', 'they', 'him', 'her', 'them', 'this', 'that', 'these', 'those', 'el', 'ea', 'ei', 'ele', 'acesta', 'aceasta', 'there', 'acolo']);
const CONDITIONAL_START = /^(if|when|suppose|supposing|assume|assuming|imagine|dac[aă]|presupun|s[aă] presupunem|să zicem|sa zicem|în cazul|in cazul|când|cand)\b/i;
function statementsOf(sop) { try { return parse(sop).wires.filter(w => w.type === 'stated' || w.type === 'assumed').map(w => ({type: w.type, ...propositionOf(w)})); } catch { return []; } }
function queriesOf(sop) { try { return parse(sop).wires.filter(w => w.type === 'query' || w.type === 'constraint'); } catch { return []; } }
const fold = t => String(t ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
function errorLabels(row, record, whole, split) {
  const labels = [];
  const units = record.units.map(fold);
  const splitStatements = statementsOf(split), wholeStatements = statementsOf(whole);
  const pronoun = s => s.roles.some(r => typeof r.value === 'string' && PRONOUN_VALUES.has(fold(r.value)));
  if (splitStatements.filter(pronoun).length > wholeStatements.filter(pronoun).length) labels.push('pronoun_left_unresolved');
  const goldQueries = queriesOf(row.sop_target);
  const values = q => (Object.values(q.fields).flat().join('\n').match(/"(?:\\.|[^"\\])*"/g) ?? []).map(x => fold(JSON.parse(x))).filter(v => v.length > 1);
  if (goldQueries.some(q => { const vs = values(q).filter(v => fold(row.question).includes(v)); return vs.length > 1 && !units.some(u => vs.every(v => u.includes(v))); })) labels.push('question_spans_sentences');
  if (record.units.some((u, i) => i + 1 < record.units.length && CONDITIONAL_START.test(u.trim()) && /[.]$/.test(u.trim()))) labels.push('conditional_split');
  const gold = statementsOf(row.sop_target);
  if (gold.some(s => s.certainty === 'supposed' || s.certainty === 'hedged' || (s.speaker && s.speaker !== 'user'))) {
    const lost = gold.filter(s => s.certainty === 'supposed').length > splitStatements.filter(s => s.certainty === 'supposed').length;
    if (lost) labels.push('supposition_lost');
  }
  if (record.units.some(u => /^(context|question|întrebare|intrebare)\s*:/i.test(u.trim()))) labels.push('context_question_frame');
  const goldUnclear = /\bunclear\b/.test(row.sop_target.split('\n')[0] ?? '');
  const splitUnclear = /^@\S+ unclear/.test(String(split).trim());
  if (goldUnclear && !splitUnclear) labels.push('unclear_message_formalized');
  if (!goldUnclear && splitUnclear) labels.push('content_reduced_to_unclear');
  if (queriesOf(split).length > goldQueries.length) labels.push('extra_queries');
  if (splitStatements.length > gold.length + 1) labels.push('extra_statements');
  if (queriesOf(split).length < goldQueries.length) labels.push('missing_queries');
  if (!labels.length) labels.push('other');
  return labels;
}

async function scoreSet(model, set, reps) {
  const records = new Map(readJsonl(at(`${REPORT_DIR}/work/${model}/${set}.calls.jsonl`)).map(r => [r.id, r]));
  // The dev pilot ran while the segmenter was still being tuned on dev: it is scored on the rows it actually predicted.
  // Staged evaluation (owner rule of 2026-09-29): a set is scored on the rows predicted so far (a nested stage).
  const rows = set === 'dev-pilot' ? readJsonlShardedSync(at('datasets_archive/formalizer-v1/dev.jsonl')).filter(row => records.has(row.id)).map(row => ({...row, suite: 'formalizer-v1-dev'})) : rowsOf(set).filter(row => records.has(row.id));
  if (!rows.length) throw Error(`${set}: no rows have calls yet`);
  const conditions = new Map(rows.map(row => [row.id, conditionsOf(records.get(row.id))]));
  const outDir = at(`${REPORT_DIR}/${model}`);
  fs.mkdirSync(outDir, {recursive: true});
  const executed = row => row.suite !== 'formalizer-wild-v1';
  const perRow = {};
  for (const name of CONDITIONS) {
    const byId = new Map(rows.map(row => [row.id, conditions.get(row.id)[name].sop]));
    fs.writeFileSync(path.join(outDir, `${set}.${name}.predictions.jsonl`), rows.map(row => JSON.stringify({id: row.id, sop: byId.get(row.id)})).join('\n') + '\n');
    const execRows = rows.filter(executed);
    const exec = new Map();
    if (execRows.length) {
      const report = await evaluate(execRows, {predictor: ({id}) => byId.get(id), source: 'predictions'});
      for (const r of report.records) exec.set(r.id, !!r.execution_equivalent_tolerant);
    }
    perRow[name] = new Map(rows.map(row => [row.id, rowNumbers(row, byId.get(row.id), executed(row) ? exec.get(row.id) : undefined)]));
  }
  const slices = {all: rows};
  for (const row of rows) {
    (slices[`language:${languageSlice(row)}`] ??= []).push(row);
    if (set === 'short') (slices[`suite:${row.suite}`] ??= []).push(row);
    if (set === 'wild') {
      const units = records.get(row.id).units.length;
      (slices[units > 1 ? 'units:2+' : 'units:1'] ??= []).push(row);
      const goldStatements = statementsOf(row.sop_target).length;
      if (goldStatements >= 2) (slices['gold_statements:2+'] ??= []).push(row);
    }
  }
  const metrics = {};
  for (const [slice, list] of Object.entries(slices)) metrics[slice] = Object.fromEntries(CONDITIONS.map(name => [name, summarize(list.map(row => perRow[name].get(row.id)))]));
  const cluster = row => row.suite === 'formalizer-wild-v1' ? row.id : row.split_group_id ?? row.id;
  const deltaMetrics = set === 'wild' ? ['wild_accepted_match', 'wild_decision_match', 'wild_proposition_f1', 'wire_f1', 'rows_wire_f1_ge_0_9', 'query_part_correct']
    : ['execution_equivalence_tolerant', 'wire_f1', 'rows_wire_f1_ge_0_9', 'query_part_correct', 'statement_f1'];
  const comparisons = [['S0', 'S1'], ['S0', 'S2'], ['S1', 'S2'], ['S0', 'S2dedupe'], ['S0', 'S2hybrid']];
  const deltas = {};
  for (const [slice, list] of Object.entries(slices)) {
    if (slice !== 'all' && !slice.startsWith('suite:') && !slice.startsWith('units:') && !slice.startsWith('gold_')) continue;
    deltas[slice] = {};
    for (const [a, b] of comparisons) {
      deltas[slice][`${b}-${a}`] = Object.fromEntries(deltaMetrics.map(m => [m, bootstrapDelta(list.map(row => ({cluster: cluster(row), a: perRow[a].get(row.id), b: perRow[b].get(row.id)})), s => { const v = METRICS[m](s); return v === null ? NaN : v; }, reps)]));
    }
  }
  const latency = Object.fromEntries(CONDITIONS.map(name => {
    const list = rows.map(row => conditions.get(row.id)[name]);
    const total = list.reduce((n, c) => n + (c.ms ?? 0), 0), base = rows.reduce((n, row) => n + (conditions.get(row.id).S0.ms ?? 0), 0);
    return [name, {per_message_ms: quantiles(list.map(c => c.ms)), calls_per_message: quantiles(list.map(c => c.calls)), total_ms_ratio_to_S0: round(total / base)}];
  }));
  const mergeStats = Object.fromEntries(CONDITIONS.filter(n => n !== 'S0').map(name => [name, rows.reduce((acc, row) => {
    const stats = conditions.get(row.id)[name].stats;
    if (stats) for (const [k, v] of Object.entries(stats)) if (typeof v === 'number') acc[k] = (acc[k] ?? 0) + v; else if (v && typeof v === 'object') for (const [kk, vv] of Object.entries(v)) acc[`${k}.${kk}`] = (acc[`${k}.${kk}`] ?? 0) + vv;
    return acc;
  }, {})]));
  // Errors: rows where a split condition is worse than S0 (execution lost, or wire F1 down by >= 0.2; wild: accepted match lost or proposition F1 down by >= 0.2).
  const errors = {};
  for (const name of ['S1', 'S2']) {
    const worse = [], better = [];
    for (const row of rows) {
      const a = perRow.S0.get(row.id), b = perRow[name].get(row.id);
      const lost = (a.exec === 1 && b.exec === 0) || (a.accepted_match === 1 && b.accepted_match === 0) || b.row_f1 <= a.row_f1 - 0.2 || (a.wild_rows && b.proposition_f1 <= a.proposition_f1 - 0.2);
      const won = (a.exec === 0 && b.exec === 1) || (a.accepted_match === 0 && b.accepted_match === 1) || b.row_f1 >= a.row_f1 + 0.2;
      if (lost) worse.push(row); else if (won) better.push(row);
    }
    const labels = {};
    const examples = [];
    for (const row of worse) {
      const ls = errorLabels(row, records.get(row.id), conditions.get(row.id).S0.sop, conditions.get(row.id)[name].sop);
      for (const l of ls) labels[l] = (labels[l] ?? 0) + 1;
      if (examples.length < 12 && records.get(row.id).units.length <= 6) examples.push({id: row.id, labels: ls, units: records.get(row.id).units, gold: row.sop_target, S0: conditions.get(row.id).S0.sop, [name]: conditions.get(row.id)[name].sop});
    }
    errors[name] = {worse_than_S0: worse.length, better_than_S0: better.length, rows: rows.length, labels_of_worse_rows: Object.fromEntries(Object.entries(labels).sort((x, y) => y[1] - x[1])), examples};
  }
  const devices = {};
  for (const row of rows) devices[records.get(row.id).device ?? 'cpu (llama.cpp -ngl 0, 8 threads, 4 slots)'] = (devices[records.get(row.id).device ?? 'cpu (llama.cpp -ngl 0, 8 threads, 4 slots)'] ?? 0) + 1;
  return {set, rows: rows.length, devices, units: quantiles(rows.map(row => records.get(row.id).units.length)), metrics, deltas, latency, merge: mergeStats, errors,
    call_errors: rows.reduce((n, row) => n + ['S0', 'S1', 'S2'].reduce((m, k) => m + [].concat(records.get(row.id)[k]).filter(c => c.error).length, 0), 0),
    truncated_calls: rows.reduce((n, row) => n + ['S0', 'S1', 'S2'].reduce((m, k) => m + [].concat(records.get(row.id)[k]).filter(c => c.finish === 'length').length, 0), 0)};
}

export async function score({model, sets, reps = 2000}) {
  const file = at(`${REPORT_DIR}/${model}/results.json`);
  const previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const results = {format: 'chatsop-sentence-split-results-v1', experiment: 'eval-sentence-split-v1', model, preregistered_s2: PREREGISTERED_S2, generated_at: new Date().toISOString(), bootstrap: {reps, seed: 42, clusters: 'split_group_id (formalizer-v1, OOD), row (wild)'}, sets: {...(previous.sets ?? {})}};
  for (const set of sets) { results.sets[set] = await scoreSet(model, set, reps); console.log(JSON.stringify({set, all: Object.fromEntries(Object.entries(results.sets[set].metrics.all).map(([k, v]) => [k, {exec: v.execution_equivalence_tolerant, f1: v.wire_f1, ge90: v.rows_wire_f1_ge_0_9, q: v.query_part_correct, acc: v.wild_accepted_match, dec: v.wild_decision_match, pf1: v.wild_proposition_f1}]))})); }
  fs.writeFileSync(file, JSON.stringify(results, null, 2) + '\n');
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const rest = process.argv.slice(2), options = {};
  for (let i = 0; i < rest.length; i += 2) options[rest[i].replace(/^--/, '')] = rest[i + 1];
  await score({model: options.model, sets: options.sets.split(','), reps: Number(options.reps ?? 2000)});
}
