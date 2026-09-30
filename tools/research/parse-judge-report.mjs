/** Metrics of eval-parse-judge-haiku-v1 (see parse-judge-eval.mjs). Writes eval/reports/current/parse-judge/metrics.json. */
import fs from 'node:fs';
export const mulberry = seed => { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const OUT = 'eval/reports/current/parse-judge';
const SL = 'eval/reports/current/symbolic-layers/';
const rl = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(x => x.trim()).map(JSON.parse) : []);
const GOOD = new Set(['CORRECT', 'MINOR', 'INPUT_TYPO']);
const bad = v => v === 'DEEP' || v === 'FAIL';

export function wilson(k, n, z = 1.96) {
  if (!n) return {p: null, lo: null, hi: null, k, n};
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return {p, lo: (c - m) / d, hi: (c + m) / d, k, n};
}
export function kappa(pairs) { // pairs of [a, b] categorical
  const n = pairs.length; if (!n) return null;
  const cats = [...new Set(pairs.flat())];
  const po = pairs.filter(([a, b]) => a === b).length / n;
  const pe = cats.reduce((s, c) => s + (pairs.filter(p => p[0] === c).length / n) * (pairs.filter(p => p[1] === c).length / n), 0);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}
function bootKappa(pairs, seed = 11, B = 2000) {
  const rand = mulberry(seed), ks = [];
  for (let b = 0; b < B; b++) { const s = Array.from({length: pairs.length}, () => pairs[Math.floor(rand() * pairs.length)]); const k = kappa(s); if (k !== null && Number.isFinite(k)) ks.push(k); }
  ks.sort((a, b) => a - b);
  return [ks[Math.floor(0.025 * ks.length)], ks[Math.floor(0.975 * ks.length)]];
}
const cls4 = v => (bad(v) ? 'bad' : v);
const ratio = (k, n) => ({...wilson(k, n)});
function wRatio(items, pred, tp) { // weighted precision-like: sum w over pred&tp / sum w over pred
  const num = items.filter(i => pred(i) && tp(i)).reduce((s, i) => s + i.w, 0), den = items.filter(pred).reduce((s, i) => s + i.w, 0);
  return den ? num / den : null;
}

/** Metrics of one verdict list against the reference; items = [{ref, pred, w, ...}]. */
export function metrics(items) {
  const n = items.length;
  const use = items.filter(i => i.pred);
  const binPairs = use.map(i => [bad(i.ref) ? 'bad' : 'good', bad(i.pred) ? 'bad' : 'good']);
  const cm = {tp_bad: 0, fp_bad: 0, fn_bad: 0, tn_bad: 0};
  for (const i of use) { const r = bad(i.ref), p = bad(i.pred); if (p && r) cm.tp_bad++; else if (p && !r) cm.fp_bad++; else if (!p && r) cm.fn_bad++; else cm.tn_bad++; }
  const kb = kappa(binPairs), k4 = kappa(use.map(i => [cls4(i.ref), cls4(i.pred)]));
  const goodPred = use.filter(i => GOOD.has(i.pred));
  return {
    n, unusable: n - use.length, unusable_rate: (n - use.length) / n,
    confusion: cm,
    kappa_binary: kb, kappa_binary_ci: use.length > 10 ? bootKappa(binPairs) : null,
    kappa_4class: k4, kappa_4class_ci: use.length > 10 ? bootKappa(use.map(i => [cls4(i.ref), cls4(i.pred)])) : null,
    agreement_binary: binPairs.filter(([a, b]) => a === b).length / (use.length || 1),
    bad_precision: ratio(cm.tp_bad, cm.tp_bad + cm.fp_bad), bad_recall: ratio(cm.tp_bad, cm.tp_bad + cm.fn_bad),
    good_precision: ratio(goodPred.filter(i => GOOD.has(i.ref)).length, goodPred.length),
    good_recall: ratio(goodPred.filter(i => GOOD.has(i.ref)).length, items.filter(i => GOOD.has(i.ref)).length),
    weighted: {good_precision: wRatio(use, i => GOOD.has(i.pred), i => GOOD.has(i.ref)), bad_precision: wRatio(use, i => bad(i.pred), i => bad(i.ref)),
      good_recall: wRatio(use, i => GOOD.has(i.ref), i => GOOD.has(i.pred)), bad_recall: wRatio(use, i => bad(i.ref), i => bad(i.pred))},
  };
}


/** Weighted binary statistics (bad vs good_enough) with a stratified bootstrap 95% CI (strata = prior-Haiku verdict). */
export function weightedStats(items, B = 1000, seed = 5) {
  const stat = list => {
    const W = (f) => list.filter(f).reduce((s, i) => s + i.w, 0);
    const pb = i => bad(i.pred), rb = i => bad(i.ref);
    const tp = W(i => pb(i) && rb(i)), fp = W(i => pb(i) && !rb(i)), fn = W(i => !pb(i) && rb(i)), tn = W(i => !pb(i) && !rb(i)), T = tp + fp + fn + tn;
    const po = (tp + tn) / T, pe = ((tp + fp) * (tp + fn) + (fn + tn) * (fp + tn)) / (T * T);
    return {bad_precision: tp / (tp + fp), bad_recall: tp / (tp + fn), good_precision: tn / (tn + fn), good_recall: tn / (tn + fp), kappa: (po - pe) / (1 - pe), bad_prevalence: (tp + fn) / T, accuracy: po};
  };
  const point = stat(items);
  const strata = new Map();
  for (const i of items) { if (!strata.has(i.stratum)) strata.set(i.stratum, []); strata.get(i.stratum).push(i); }
  const rand = mulberry(seed), draws = [];
  for (let b = 0; b < B; b++) { const sample = []; for (const list of strata.values()) for (let k = 0; k < list.length; k++) sample.push(list[Math.floor(rand() * list.length)]); draws.push(stat(sample)); }
  const ci = key => { const v = draws.map(d => d[key]).filter(Number.isFinite).sort((a, b) => a - b); return v.length ? [v[Math.floor(0.025 * v.length)], v[Math.floor(0.975 * v.length)]] : null; };
  return {point, ci: Object.fromEntries(Object.keys(point).map(k => [k, ci(k)]))};
}

export function report(args = {}) {
  const refs = rl(`${OUT}/reference.jsonl`);
  const ext = rl(`${OUT}/extension.jsonl`);
  const clean = [...refs.filter(r => r.clean_en), ...ext];
  // stratum weights over ALL clean sentences of the 1200 (prior Haiku final verdict), reference sentences of the stratum = sample
  const cleanIds = new Set(rl('eval/suites/clean-english/test.jsonl').map(r => r.source_id));
  const priorAll = new Map(rl(SL + 'judgments.jsonl').map(j => [j.key, j.judge?.verdict ?? 'unusable']));
  const sents = rl(SL + 'sentences.jsonl').filter(s => cleanIds.has(s.id) && !s.empty && s.language === 'en');
  const N = {}, n = {};
  for (const s of sents) N[priorAll.get(s.key) ?? 'unusable'] = (N[priorAll.get(s.key) ?? 'unusable'] ?? 0) + 1;
  for (const r of clean) { const k = r.prior_haiku_final ?? 'unusable'; n[k] = (n[k] ?? 0) + 1; }
  const weightOf = r => { const k = r.prior_haiku_final ?? 'unusable'; return (N[k] ?? n[k]) / n[k]; };
  const spacy = new Map(rl(SL + 'spacy-compare.jsonl').map(s => [s.key, s]));
  const conds = ['a', 'b', 'c'].filter(c => fs.existsSync(`${OUT}/results-${c}.jsonl`));
  const res = Object.fromEntries(conds.map(c => [c, new Map(rl(`${OUT}/results-${c}.jsonl`).map(r => [r.id, r]))]));
  const out = {population: {clean_reference: clean.length, ref_distribution: countBy(clean, r => r.ref), stratum_all_clean: N, stratum_reference: n,
    prevalence_bad_reference: clean.filter(r => bad(r.ref)).length / clean.length}, conditions: {}, cost: {}, hybrids: {}};
  const judged = c => clean.filter(r => res[c].has(r.id));
  for (const c of conds) {
    const rows = judged(c);
    const items = rows.map(r => ({ref: r.ref, pred: res[c].get(r.id).verdict, w: weightOf(r), stratum: r.prior_haiku_final ?? 'unusable', id: r.id}));
    out.conditions[c] = {rows: rows.length, ...metrics(items), weighted_full: rows.length === clean.length ? weightedStats(items.filter(i => i.pred)) : null, by_ref: countBy(items, i => `${i.ref}->${bad(i.pred) ? 'bad' : i.pred}`), pred_distribution: countBy(items, i => i.pred ?? 'unusable')};
    const rr = rows.map(r => res[c].get(r.id));
    const costs = rr.map(r => r.cost_usd).filter(x => x != null), lat = rr.map(r => r.ms).filter(x => x != null).sort((a, b) => a - b);
    const api = rr.flatMap(r => r.sentences.map(s => s.api_ms)).filter(x => x != null).sort((a, b) => a - b);
    out.cost[c] = {mean_usd: mean(costs), total_usd: sum(costs), latency_ms_mean: mean(lat), latency_ms_median: lat[Math.floor(lat.length / 2)], latency_ms_p90: lat[Math.floor(lat.length * 0.9)], api_ms_median: api[Math.floor(api.length / 2)], calls: rr.length};
  }
  // gates: subsets of {a, b, c, agree} that must ALL say "good"; evaluated on the rows judged by every condition present
  const common = clean.filter(r => conds.every(c => res[c].has(r.id)));
  const agree = r => spacy.get(r.id)?.core_agree === true;
  const good = (c, r) => GOOD.has(res[c].get(r.id).verdict);
  const signals = [...conds.map(c => ({name: `Haiku ${c}`, key: c, f: r => good(c, r)})), {name: 'Stanza-spaCy agree', key: 'agree', f: agree}];
  const gates = {};
  for (let mask = 1; mask < (1 << signals.length); mask++) {
    const sel = signals.filter((_, k) => mask & (1 << k));
    gates[sel.map(x => x.name).join(' AND ')] = {sel, accept: r => sel.every(x => x.f(r))};
  }
  const stratOf = r => r.prior_haiku_final ?? 'unusable';
  for (const [name, {sel, accept}] of Object.entries(gates)) {
    const items = common.map(r => ({ref: r.ref, pred: accept(r) ? 'CORRECT' : 'DEEP', w: weightOf(r), stratum: stratOf(r)}));
    const acc = common.filter(accept);
    const goodAll = common.filter(r => GOOD.has(r.ref));
    const goodAcc = acc.filter(r => GOOD.has(r.ref)).length;
    const w = common.length === clean.length ? weightedStats(items) : null;
    const llmKeys = sel.filter(x => x.key !== 'agree').map(x => x.key);
    out.hybrids[name] = {rows: common.length, accepted: acc.length, accept_rate: acc.length / common.length, accept_rate_weighted: items.filter(i => i.pred === 'CORRECT').reduce((t, i) => t + i.w, 0) / items.reduce((t, i) => t + i.w, 0), accepted_good_precision: wilson(goodAcc, acc.length), good_recall: wilson(goodAcc, goodAll.length), accepted_bad_leak: acc.filter(r => bad(r.ref)).length,
      weighted: w ? {good_precision: w.point.good_precision, good_precision_ci: w.ci.good_precision, good_recall: w.point.good_recall, good_recall_ci: w.ci.good_recall} : null,
      mean_cost_usd: llmKeys.reduce((s, k) => s + (out.cost[k]?.mean_usd ?? 0), 0), latency_ms_parallel: Math.max(0, ...llmKeys.map(k => out.cost[k]?.latency_ms_mean ?? 0))};
  }
  fs.writeFileSync(`${OUT}/metrics.json`, JSON.stringify(out, null, 1) + '\n');
  const f = x => (x == null ? 'n/a' : (100 * x).toFixed(1) + '%');
  for (const c of conds) { const m = out.conditions[c]; console.log(`cond ${c}: n ${m.n} unusable ${m.unusable} kappa2 ${m.kappa_binary?.toFixed(2)} [${m.kappa_binary_ci?.map(x => x.toFixed(2))}] kappa4 ${m.kappa_4class?.toFixed(2)} | bad P ${f(m.bad_precision.p)} R ${f(m.bad_recall.p)} | good P ${f(m.good_precision.p)} [${f(m.good_precision.lo)}] R ${f(m.good_recall.p)} | weighted good P ${f(m.weighted.good_precision)} | $${out.cost[c].mean_usd.toFixed(4)} ${Math.round(out.cost[c].latency_ms_median)}ms`); }
  for (const [name, h] of Object.entries(out.hybrids)) console.log(`gate ${name}: accepted ${h.accepted}/${h.rows} good-precision ${f(h.accepted_good_precision.p)} [lo ${f(h.accepted_good_precision.lo)}] recall ${f(h.good_recall.p)} | weighted P ${f(h.weighted?.good_precision)} [${h.weighted?.good_precision_ci?.map(f)}] R ${f(h.weighted?.good_recall)} | leak ${h.accepted_bad_leak} $${h.mean_cost_usd.toFixed(4)}`);
}
const countBy = (rows, fn) => rows.reduce((a, r) => { const k = fn(r); a[k] = (a[k] ?? 0) + 1; return a; }, {});
const sum = a => a.reduce((s, x) => s + x, 0), mean = a => (a.length ? sum(a) / a.length : null);
