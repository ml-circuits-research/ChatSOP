/** Scores the meaning-judge calibration (experiment eval-meaning-judge-calibration-v1).
 *
 *   node tools/datasets/meaning-judge/score-calibration.mjs [--folder datasets_sources/meaning_judge_calibration]
 *
 * Labels: eval/reports/current/meaning-judge/labels.jsonl (written by build-calibration.mjs, never in the judge folder).
 * Reports, per condition (m1, m2) and for the two-vote rule (m1 AND m2): precision and recall of "yes" with Wilson 95%
 * intervals, the yes rate per negative type, the reproducibility of m1 on the 100 repeated items (m1 vs m1r), and the
 * disagreements between label and judge (for adjudication). Writes eval/reports/current/meaning-judge/calibration.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT, readJsonl} from '../neuro-oracle/common.mjs';
let WORK = path.join(ROOT, 'eval/reports/current/meaning-judge');

export const wilson = (k, n, z = 1.959964) => {
  if (!n) return [null, null];
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
};
const r4 = x => (x === null ? null : Math.round(x * 10000) / 10000);
const interval = (k, n) => ({k, n, rate: n ? r4(k / n) : null, wilson: wilson(k, n).map(r4)});

export function load(folder) {
  const labels = new Map(readJsonl(path.join(WORK, 'labels.jsonl')).map(r => [r.id, r]));
  const verdicts = {};
  for (const r of readJsonl(path.join(folder, 'output/verdicts.jsonl'))) (verdicts[r.condition] ??= new Map()).set(r.id, r.answer?.preserves ?? null);
  return {labels, verdicts};
}

/** Precision/recall of a decision function `yes(id)` (true|false|null) over the labelled items. */
export function measure(labels, yes, filter = () => true) {
  const out = {tp: 0, fp: 0, fn: 0, tn: 0, unusable: 0};
  for (const [id, l] of labels) {
    if (!filter(l)) continue;
    const y = yes(id);
    if (y === null || y === undefined) { out.unusable++; continue; }
    if (l.label === 'same') y ? out.tp++ : out.fn++; else y ? out.fp++ : out.tn++;
  }
  return {...out, precision: interval(out.tp, out.tp + out.fp), recall: interval(out.tp, out.tp + out.fn), specificity: interval(out.tn, out.tn + out.fp)};
}

const ofCondition = (verdicts, c) => id => { const v = verdicts[c]?.get(id); return v === 'yes' ? true : v === 'no' ? false : null; };
const twoVote = (verdicts, a, b) => id => { const x = ofCondition(verdicts, a)(id), y = ofCondition(verdicts, b)(id); return x === null || y === null ? null : x && y; };

/** Adjudicated precision: noise negatives (did not change the meaning) are removed; a judge-yes negative that is not listed counts as real. */
export function adjudicated(labels, yes, adjudication) {
  const noise = new Set(Object.keys(adjudication?.noise ?? {}));
  const m = measure(labels, yes, l => l.label === 'same' || !noise.has(l.id));
  const negatives = m.fp + m.tn, recall = m.tp / (m.tp + m.fn), fpr = negatives ? m.fp / negatives : 0;
  const atPrevalence = bad => { const p = 1 - bad; return r4(recall * p / (recall * p + fpr * (1 - p))); };
  return {precision: m.precision, recall: m.recall, real_negatives: negatives, false_yes_real: m.fp, false_yes_rate: interval(m.fp, negatives), precision_at_10_percent_bad: atPrevalence(0.1), precision_at_5_percent_bad: atPrevalence(0.05), noise_removed: noise.size};
}

export function calibrate(folder) {
  const {labels: rawLabels, verdicts} = load(folder);
  const labels = rawLabels;
  const rules = {m1: ofCondition(verdicts, 'm1'), m2: ofCondition(verdicts, 'm2'), two_vote: twoVote(verdicts, 'm1', 'm2')};
  const adjFile = path.join(WORK, 'adjudication.json');
  const adjudication = fs.existsSync(adjFile) ? JSON.parse(fs.readFileSync(adjFile, 'utf8')) : null;
  const result = {generated_at: new Date().toISOString(), items: labels.size, adjudication: adjudication ? {real: Object.keys(adjudication.real).length, noise: Object.keys(adjudication.noise).length} : null, conditions: {}};
  const types = [...new Set([...labels.values()].map(l => l.type))].filter(t => t !== 'positive').sort();
  const groups = {all_negatives: l => l.label === 'different', mechanical: l => l.label === 'different' && !l.type.startsWith('hard_'), hard: l => l.label === 'different' && l.type.startsWith('hard_')};
  for (const [name, yes] of Object.entries(rules)) {
    const perType = {};
    for (const t of types) { let k = 0, n = 0; for (const [id, l] of labels) if (l.type === t) { const y = yes(id); if (y === null) continue; n++; if (y) k++; } perType[t] = interval(k, n); }
    const byGroup = {};
    for (const [g, f] of Object.entries(groups)) byGroup[g] = measure(labels, yes, l => l.label === 'same' || f(l));
    result.conditions[name] = {overall: measure(labels, yes), adjudicated: adjudicated(labels, yes, adjudication), precision_by_negative_group: Object.fromEntries(Object.entries(byGroup).map(([g, m]) => [g, {precision: m.precision, fp: m.fp, negatives_judged: m.tn + m.fp}])), yes_rate_on_negatives_by_type: perType,
      recall_by_source: Object.fromEntries(['neuro_proofing', 'archive_proofing'].map(s => { const m = measure(labels, yes, l => l.label === 'same' && l.source === s); return [s, m.recall]; }))};
  }
  // reproducibility: m1 vs m1r on the repeated items
  const rep = [...labels.values()].filter(l => l.repeat);
  let agree = 0, n = 0, flips = [];
  for (const l of rep) { const a = verdicts.m1?.get(l.id), b = verdicts.m1r?.get(l.id); if (!a || !b) continue; n++; if (a === b) agree++; else flips.push(l.id); }
  result.reproducibility = {items: n, agree: interval(agree, n), flipped_ids: flips};
  // condition agreement
  let both = 0, nb = 0;
  for (const id of labels.keys()) { const a = verdicts.m1?.get(id), b = verdicts.m2?.get(id); if (!a || !b) continue; nb++; if (a === b) both++; }
  result.m1_m2_agreement = interval(both, nb);
  // disagreements for adjudication
  result.disagreements = {};
  for (const [name, yes] of Object.entries(rules)) result.disagreements[name] = {false_yes: [...labels].filter(([id, l]) => l.label === 'different' && yes(id) === true).map(([id]) => id), false_no: [...labels].filter(([id, l]) => l.label === 'same' && yes(id) === false).map(([id]) => id)};
  return result;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const t = process.argv.indexOf('--tag'), tag = t > 0 ? process.argv[t + 1] : null;
  if (tag) WORK = path.join(WORK, tag);
  const f = process.argv.indexOf('--folder'), o = process.argv.indexOf('--out');
  const folder = f > 0 ? path.resolve(process.argv[f + 1]) : path.resolve(ROOT, `datasets_sources/meaning_judge_calibration${tag ? '_' + tag : ''}`);
  const result = calibrate(folder);
  // --folder DIR scores another judge's DIR/output/verdicts.jsonl against the same labels; --out DIR keeps calibration.json elsewhere (eval-local-judge-v1)
  const outDir = o > 0 ? path.resolve(process.argv[o + 1]) : WORK;
  fs.mkdirSync(outDir, {recursive: true});
  fs.writeFileSync(path.join(outDir, 'calibration.json'), JSON.stringify(result, null, 1) + '\n');
  const show = (name, m) => console.log(`${name}: precision ${m.precision.k}/${m.precision.n} = ${m.precision.rate} [${m.precision.wilson}]  recall ${m.recall.k}/${m.recall.n} = ${m.recall.rate} [${m.recall.wilson}]  unusable ${m.unusable}`);
  for (const [name, c] of Object.entries(result.conditions)) {
    show(name + ' raw', c.overall); show(name + ' adjudicated', {...c.adjudicated, unusable: 0}); console.log(`   false-yes rate on real negatives ${c.adjudicated.false_yes_real}/${c.adjudicated.real_negatives}; precision at 10% bad stream ${c.adjudicated.precision_at_10_percent_bad}`);
    for (const [g, v] of Object.entries(c.precision_by_negative_group)) console.log(`   ${g}: precision ${v.precision.rate} [${v.precision.wilson}] fp ${v.fp}/${v.negatives_judged}`);
  }
  console.log('reproducibility', JSON.stringify(result.reproducibility.agree), 'm1/m2 agreement', JSON.stringify(result.m1_m2_agreement));
}
