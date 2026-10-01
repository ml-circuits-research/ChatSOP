#!/usr/bin/env node
/** Sealed comparison of production-build-1 epochs against iteration 3 (experiment train-language-proofing-gemma270m-prod1): per-metric rate and paired bootstrap difference (arm minus reference).
 *   LP_WORK=eval/reports/current/language-proofing-prod1 node tools/eval/language-proofing-prod1-compare.mjs --ref lp-it3 --arms lp-prod1-e3,lp-prod1-e1 [--dev lp-it3=lp-it3,lp-prod1-e3=lp-prod1-epoch3,lp-prod1-e1=lp-prod1-epoch1] [--meaning]
 * Writes $LP_WORK/compare-prod1.json. Reads only outputs and scores of $LP_WORK; trains nothing. */
import fs from 'node:fs';
import path from 'node:path';
import {WORK, bootstrapMean, loadMeaningVerdicts} from './language-proofing-eval.mjs';
import {wordRows} from './language-proofing-v3-metrics.mjs';
import {nameRows} from './language-proofing-prod1-metrics.mjs';
import {textKey} from '../datasets/neuro-oracle/common.mjs';
import {norm} from '../datasets/language-proofing/pairs.mjs';

const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const ref = arg('--ref'), arms = String(arg('--arms')).split(','), devMap = Object.fromEntries(String(arg('--dev') ?? '').split(',').filter(Boolean).map(p => p.split('=')));
const readJsonl = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const records = (name, split) => JSON.parse(fs.readFileSync(path.join(WORK, 'scores', `${name}__${split}.json`), 'utf8')).records;
const outs = (name, split) => new Map(readJsonl(path.join(WORK, 'outputs', `${name}__${split}.jsonl`)).map(r => [r.id, r.output]));
const vec = (rows, f) => new Map(rows.map(r => [r.id, Number(f(r))]));
const mean = x => x.reduce((p, q) => p + q, 0) / (x.length || 1);
const pct = x => Math.round(1000 * x) / 10;
const CHILD_IN = /\b(copil|copilul|copilului|copii|copiii|copiilor|copila|copilei|child|children|kid|kids)\b/, fold = t => String(t).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const meaningV = args => args.meaning ? loadMeaningVerdicts() : null;
const useMeaning = process.argv.includes('--meaning'), verdicts = useMeaning ? loadMeaningVerdicts() : null;
const meaningOk = (input, output) => { if (norm(input) === norm(output)) return true; if (!norm(output)) return false; const id = textKey(`ORIGINAL: ${input}\n\nREWRITE: ${output}`); return verdicts.get(`${id}|m1`) === 'yes' && verdicts.get(`${id}|m2`) === 'yes'; };

const metrics = {
  'H1 clean900 untouched': n => vec(records(n, 'testclean'), r => r.unchanged === false ? 0 : 1),
  'H3 mash150 unchanged': n => vec(records(n, 'mash'), r => !r.unchanged ? 0 : 1),
  'H5 sealed test repair content preserved (neg)': n => vec(records(n, 'test').filter(r => r.pair === 'repair'), r => r.content_ok_neg),
  'sealed test repair clean-English gate': n => vec(records(n, 'test').filter(r => r.pair === 'repair'), r => r.clean_gate),
  'sealed test repair mechanical good': n => vec(records(n, 'test').filter(r => r.pair === 'repair'), r => r.good),
  'sealed test identity untouched': n => vec(records(n, 'test').filter(r => r.pair === 'identity'), r => r.unchanged),
  'H2 child units: relation word kept': n => { const o = outs(n, 'probe'); return vec(records(n, 'probe').filter(r => CHILD_IN.test(fold(r.input))), r => /\b(child|children|kid|kids|son|sons|daughter|daughters)\b/.test(fold(o.get(r.id) ?? ''))); },
  'H2 child units: parent flip (lower is better)': n => { const o = outs(n, 'probe'); return vec(records(n, 'probe').filter(r => CHILD_IN.test(fold(r.input))), r => /\bparents?\b/.test(fold(o.get(r.id) ?? '')) && !/\b(parinte|parintele|parintelui|parinti|parintii|parintilor|parent|parents)\b/.test(fold(r.input))); },
  'H6 sealed units with a name: all names kept': n => vec(nameRows(n, 'test'), r => r.kept),
  'fresh probe 18 words: target word': n => new Map(wordRows(n, 'fresh18').map(r => [r.id, Number(r.hit)])),
};
if (useMeaning) {
  metrics['sealed600 meaning judged (two votes): meaning preserved'] = n => vec(records(n, 'test600'), r => meaningOk(r.input, r.output));
  metrics['sealed600 composite (clean AND content AND meaning)'] = n => vec(records(n, 'test600'), r => r.clean_gate && r.content_ok_neg && meaningOk(r.input, r.output));
}
const devMetrics = {
  'H4 dev-heldout ten words': (n, d) => new Map(wordRows(d, 'trained').map(r => [r.id, Number(r.hit)])),
  'H4 dev-vocab8 eight words': (n, d) => new Map(wordRows(d, 'trained8').map(r => [r.id, Number(r.hit)])),
  'H6 dev-names all kept': (n, d) => new Map(nameRows(d, 'names').map(r => [r.id, Number(r.kept)])),
  'H7 dev-typochild child word kept': (n, d) => { const o = outs(d, 'typochild'); return vec(records(d, 'typochild'), r => /\b(child|children|kid|kids|son|daughter)\b/i.test(o.get(r.id) ?? '')); },
};
const result = {ref, arms, rows: {}};
const run = (label, get) => {
  const R = get(ref), row = {n: R.size, [ref]: pct(mean([...R.values()]))};
  for (const a of arms) {
    const A = get(a), ids = [...A.keys()].filter(id => R.has(id)), d = ids.map(id => A.get(id) - R.get(id));
    row[a] = {pct: pct(mean([...A.values()])), delta_pp: pct(mean(d)), ci95_pp: (bootstrapMean(d, {seed: 5}) ?? []).map(x => pct(x))};
  }
  if (arms.length === 2) { const [x, y] = arms, X = get(x), Y = get(y), ids = [...X.keys()].filter(id => Y.has(id)), d = ids.map(id => Y.get(id) - X.get(id)); row[`${y}_minus_${x}`] = {delta_pp: pct(mean(d)), ci95_pp: (bootstrapMean(d, {seed: 5}) ?? []).map(v => pct(v))}; }
  result.rows[label] = row;
};
for (const [label, f] of Object.entries(metrics)) run(label, f);
for (const [label, f] of Object.entries(devMetrics)) run(label, name => f(name, devMap[name] ?? name));
fs.writeFileSync(path.join(WORK, 'compare-prod1.json'), JSON.stringify(result, null, 1) + '\n');
for (const [k, v] of Object.entries(result.rows)) console.log(k.padEnd(60), JSON.stringify(v));
