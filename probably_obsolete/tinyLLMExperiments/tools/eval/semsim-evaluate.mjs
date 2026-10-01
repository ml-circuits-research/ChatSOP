#!/usr/bin/env node
/**
 * Evaluates small semantic-similarity models and their combinations with the analysis-compare core checks on the labelled sets of
 * eval-analysis-compare-v1 (DS016 "Analysis comparison"). Inputs: the verdict rows of tools/eval/analysis-compare-validate.mjs (keyed by pair),
 * the scores of training/python/semsim_score.py and the latency file. Thresholds are tuned on the tune half of the calibration set (clean view C:
 * positives without typos, mechanical negatives from their clean origin) and applied unchanged to the test half and the judged sets.
 *   node tools/eval/semsim-evaluate.mjs [--verdicts eval/reports/current/analysis-compare/validation-d1/verdicts.jsonl] [--out eval/reports/current/analysis-compare/semsim]
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {wilson, MECHANICAL} from './analysis-compare-validate.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const DIR = path.join(ROOT, 'eval/reports/current/analysis-compare');
const VERDICTS = path.resolve(ROOT, args.verdicts ?? 'eval/reports/current/analysis-compare/validation-d1/verdicts.jsonl');
const OUT = path.resolve(ROOT, args.out ?? 'eval/reports/current/analysis-compare/semsim');
const rd = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

export const OPTIONS = ['symbolic', 'nli-small', 'nli-base', 'nli-moritz', 'quora', 'stsb', 'minilm', 'bge'];
const MODELS = OPTIONS.slice(1);
/** Equivalence score in [0, 1] of one model for one pair (higher = more alike). */
export function modelScore(model, s) {
  const m = s?.[model];
  if (!m) return null;
  if (m.ab) return Math.min(m.ab.entailment, m.ba.entailment);
  if ('score' in m) return Math.min(m.score, m.score_rev);
  return m.cos;
}

/** Pools of unique labelled rows from the verdict rows (one row per item and view). */
export function pools(rows) {
  const cal = rows.filter(r => r.set === 'calibration' && !r.noise);
  const ids = [...new Set(cal.map(r => r.id))];
  const pick = view => ids.map(id => { const rs = cal.filter(r => r.id === id); return view === 'A' ? rs.find(r => r.view === 'A') : rs.find(r => r.view === 'B') ?? rs.find(r => r.view === 'A'); }).filter(Boolean);
  const C = pick('B').filter(r => r.label !== 'same' || r.typo_free), A = pick('A');
  const judged = set => rows.filter(r => r.set === set && (r.votes === 'yesyes' || r.votes === 'nono')).map(r => ({...r, label: r.votes === 'yesyes' ? 'same' : 'different'}));
  return {tuneC: C.filter(r => r.half === 'tune'), testC: C.filter(r => r.half === 'test'), allC: C, testA: A.filter(r => r.half === 'test'), allA: A, backgen: judged('backgen'), bad_english: judged('bad_english'), bad_english_typo_free: judged('bad_english').filter(r => r.typo_free)};
}

/** The option's three-way verdict for one row given the tuned thresholds. */
function decide(option, row, sc, t) {
  if (option === 'symbolic') return row.verdict;
  const [kind, model] = option.split(':');
  const sym = row.verdict;
  const m = modelScore(model, {[model]: sc.get(row.k)?.[model]});
  if (m === null) return 'uncertain';
  const byModel = m >= t.hi ? 'equivalent' : m <= t.lo ? 'different' : 'uncertain';
  if (kind === 'model') return byModel;
  if (kind === 'p1') return sym === 'different' ? 'different' : byModel; // core checks first, then the model, then uncertain
  if (kind === 'p2') return sym !== 'uncertain' ? sym : byModel; // the symbolic verdict whenever it is confident, the model for the rest
  if (kind === 'p3') return sym === 'different' ? 'different' : sym === 'equivalent' && m >= t.hi ? 'equivalent' : byModel === 'different' ? 'different' : 'uncertain'; // both must agree to skip the judge
  return 'uncertain';
}

function tune(option, rows, sc) {
  if (option === 'symbolic') return {};
  const [kind, model] = option.split(':');
  const scored = rows.map(r => ({r, m: modelScore(model, {[model]: sc.get(r.k)?.[model]})})).filter(x => x.m !== null);
  const candidates = [...new Set(scored.map(x => x.m))].sort((a, b) => a - b);
  // t.hi: smallest threshold whose confident `equivalent` has precision >= 0.98 on at least 8 items (after the core-check filter of the combination)
  const pool = scored.filter(x => (kind === 'p1' || kind === 'p3' ? x.r.verdict !== 'different' : true) && (kind !== 'p3' || x.r.verdict === 'equivalent'));
  let hi = Infinity;
  for (const c of candidates) {
    const sel = pool.filter(x => x.m >= c);
    if (sel.length >= 8 && sel.filter(x => x.r.label === 'same').length / sel.length >= 0.98) { hi = c; break; }
  }
  // t.lo: largest threshold with a false-alarm rate of at most 10% on the positives
  const positives = scored.filter(x => x.r.label === 'same');
  let lo = -Infinity;
  for (const c of candidates) { if (positives.filter(x => x.m <= c).length / Math.max(1, positives.length) <= 0.10) lo = c; else break; }
  return {hi, lo};
}

function evaluate(option, t, rows, sc) {
  const out = rows.map(r => ({...r, v: decide(option, r, sc, t)}));
  const pos = out.filter(r => r.label === 'same'), neg = out.filter(r => r.label === 'different');
  const eq = out.filter(r => r.v === 'equivalent'), df = out.filter(r => r.v === 'different');
  const mech = neg.filter(r => MECHANICAL.includes(r.type));
  const byType = {};
  for (const ty of [...new Set(neg.map(r => r.type))].sort()) { const rs = neg.filter(r => r.type === ty); byType[ty] = {n: rs.length, different: rs.filter(r => r.v === 'different').length, equivalent: rs.filter(r => r.v === 'equivalent').length}; }
  return {
    n: out.length, positives: pos.length, negatives: neg.length,
    equivalent_precision: wilson(eq.filter(r => r.label === 'same').length, eq.length), equivalent_recall: wilson(eq.filter(r => r.label === 'same').length, pos.length),
    different_precision: wilson(df.filter(r => r.label === 'different').length, df.length), different_recall: wilson(df.filter(r => r.label === 'different').length, neg.length),
    mechanical_recall: wilson(mech.filter(r => r.v === 'different').length, mech.length), false_alarm: wilson(pos.filter(r => r.v === 'different').length, pos.length),
    uncertain_rate: wilson(out.filter(r => r.v === 'uncertain').length, out.length),
    skip_share: wilson(eq.length, out.length), // items a confident equivalent lets the LLM judge skip
    by_type: byType,
  };
}

/** Single-threshold classifier without any LLM: same / different by the model score alone; threshold maximises balanced accuracy on the tune pool. */
function noLlm(model, tuneRows, evalRows, sc) {
  const sel = rows => rows.map(r => ({r, m: modelScore(model, {[model]: sc.get(r.k)?.[model]})})).filter(x => x.m !== null);
  const tr = sel(tuneRows);
  let best = {t: 0.5, bal: -1};
  for (const c of [...new Set(tr.map(x => x.m))].sort((a, b) => a - b)) {
    const tp = tr.filter(x => x.r.label === 'same' && x.m >= c).length, tn = tr.filter(x => x.r.label === 'different' && x.m < c).length;
    const bal = (tp / Math.max(1, tr.filter(x => x.r.label === 'same').length) + tn / Math.max(1, tr.filter(x => x.r.label === 'different').length)) / 2;
    if (bal > best.bal) best = {t: c, bal};
  }
  const ev = sel(evalRows);
  const wrong = ev.filter(x => (x.m >= best.t) !== (x.r.label === 'same')).length;
  const fn = ev.filter(x => x.r.label === 'same' && x.m < best.t).length, fp = ev.filter(x => x.r.label === 'different' && x.m >= best.t).length;
  return {threshold: +best.t.toFixed(4), error_rate: wilson(wrong, ev.length), false_alarm: wilson(fn, ev.filter(x => x.r.label === 'same').length), missed_change: wilson(fp, ev.filter(x => x.r.label === 'different').length)};
}

const pct = w => (w.p === null ? 'n/a' : `${(w.p * 100).toFixed(1)}% [${(w.lo * 100).toFixed(1)}, ${(w.hi * 100).toFixed(1)}] (${w.k}/${w.n})`);

export function main() {
  const rows = rd(VERDICTS);
  const sc = new Map(rd(path.join(DIR, 'semsim/scores.jsonl')).map(r => [r.k, r]));
  const latency = fs.existsSync(path.join(DIR, 'semsim/latency.json')) ? JSON.parse(fs.readFileSync(path.join(DIR, 'semsim/latency.json'), 'utf8')) : {};
  const P = pools(rows);
  const options = ['symbolic', ...MODELS.map(m => `model:${m}`), ...MODELS.map(m => `p1:${m}`), ...MODELS.map(m => `p2:${m}`), ...MODELS.map(m => `p3:${m}`)];
  const result = {generated_at: new Date().toISOString(), verdicts: path.relative(ROOT, VERDICTS), pool_sizes: Object.fromEntries(Object.entries(P).map(([k, v]) => [k, v.length])), options: {}, no_llm: {}, latency};
  for (const option of options) {
    const t = tune(option, P.tuneC, sc);
    result.options[option] = {thresholds: {hi: Number.isFinite(t.hi) ? +t.hi.toFixed(4) : null, lo: Number.isFinite(t.lo) ? +t.lo.toFixed(4) : null}, tuneC: evaluate(option, t, P.tuneC, sc), testC: evaluate(option, t, P.testC, sc), allC: evaluate(option, t, P.allC, sc), testA: evaluate(option, t, P.testA, sc), backgen: evaluate(option, t, P.backgen, sc), bad_english: evaluate(option, t, P.bad_english, sc), bad_english_typo_free: evaluate(option, t, P.bad_english_typo_free, sc)};
  }
  for (const m of MODELS) result.no_llm[m] = {testC: noLlm(m, P.tuneC, P.testC, sc), testA: noLlm(m, P.tuneC, P.testA, sc), bad_english: noLlm(m, P.tuneC, P.bad_english, sc), backgen: noLlm(m, P.tuneC, P.backgen, sc)};
  fs.writeFileSync(path.join(OUT, 'summary-semsim.json'), JSON.stringify(result, null, 1) + '\n');
  const lines = ['# semantic-similarity options vs analysis-compare', '', `thresholds tuned on calibration tune half, clean view C (${P.tuneC.length} items); pools: ${JSON.stringify(result.pool_sizes)}`, ''];
  lines.push('| option | t.hi | t.lo | test C: equivalent precision | equivalent recall | mech. recall | false alarm | uncertain | skip share |', '|---|---|---|---|---|---|---|---|---|');
  for (const [o, v] of Object.entries(result.options)) { const e = v.testC; lines.push(`| ${o} | ${v.thresholds.hi ?? 'none'} | ${v.thresholds.lo ?? 'none'} | ${pct(e.equivalent_precision)} | ${pct(e.equivalent_recall)} | ${pct(e.mechanical_recall)} | ${pct(e.false_alarm)} | ${pct(e.uncertain_rate)} | ${pct(e.skip_share)} |`); }
  lines.push('', '## judged sets (agreement with the two-vote LLM judge: both yes = same, both no = different)', '', '| option | bad_english equivalent precision | skip share of all | different recall of both-no | backgen equivalent precision | skip share |', '|---|---|---|---|---|---|');
  for (const [o, v] of Object.entries(result.options)) lines.push(`| ${o} | ${pct(v.bad_english.equivalent_precision)} | ${pct(v.bad_english.skip_share)} | ${pct(v.bad_english.different_recall)} | ${pct(v.backgen.equivalent_precision)} | ${pct(v.backgen.skip_share)} |`);
  lines.push('', '## no-LLM single-threshold classifiers (same/different; error rate on the pool)', '', '| model | threshold | test C error | false alarm | missed change | bad_english error | backgen error |', '|---|---|---|---|---|---|---|');
  for (const [m, v] of Object.entries(result.no_llm)) lines.push(`| ${m} | ${v.testC.threshold} | ${pct(v.testC.error_rate)} | ${pct(v.testC.false_alarm)} | ${pct(v.testC.missed_change)} | ${pct(v.bad_english.error_rate)} | ${pct(v.backgen.error_rate)} |`);
  lines.push('', '## latency and size (4 threads, batch 1, one pair, CPU under load)', '', ...Object.entries(latency).map(([m, v]) => `- ${m}: ${v.latency_ms_per_pair_4threads_batch1 ?? 'n/a'} ms/pair, ${v.params_m} M parameters (${v.repo})`));
  fs.writeFileSync(path.join(OUT, 'summary-semsim.md'), lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}
if (import.meta.url === `file://${process.argv[1]}`) main();
