#!/usr/bin/env node
/** Paired case-level bootstrap of the composed K4 (per sentence, every sentence sent) results of two arms of the same run folder.
 *   node tools/eval/language-proofing-v3-k4.mjs --a lp-it2 --b lp-it3 [--dir eval/reports/history/language-proofing-it3/composed]
 * Rates are sums over cases: clean sentences changed = (broken) / clean components; bad sentences fixed = repaired / change components;
 * bad sentences wrongly rewritten = wrong_rewrite / change components. Cases are resampled (2,000 resamples, seed 5).
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../lib/dataset-paths.mjs';
const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const dir = path.resolve(ROOT, arg('--dir') ?? 'eval/reports/history/language-proofing-it3/composed'), a = arg('--a'), b = arg('--b');
const load = n => new Map(fs.readFileSync(path.join(dir, 'runs', `${n}__K4__sentence.jsonl`), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(r => [r.id, r]));
const A = load(a), B = load(b), ids = [...A.keys()].filter(id => B.has(id));
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const metrics = {
  clean_sentences_changed: [r => r.broken, r => r.clean_components],
  bad_sentences_fixed: [r => r.repaired, r => r.change_components],
  bad_sentences_wrong_rewrite: [r => r.wrong_rewrite, r => r.change_components],
  bad_sentences_untouched: [r => r.not_repaired, r => r.change_components],
};
const out = {a, b, cases: ids.length, metrics: {}};
for (const [name, [num, den]] of Object.entries(metrics)) {
  const rate = (list, m) => { let k = 0, n = 0; for (const id of list) { k += num(m.get(id)); n += den(m.get(id)); } return n ? k / n : 0; };
  const random = rng(5), diffs = [];
  for (let i = 0; i < 2000; i++) { const s = ids.map(() => ids[Math.floor(random() * ids.length)]); diffs.push(rate(s, B) - rate(s, A)); }
  diffs.sort((x, y) => x - y);
  const pp = x => Math.round(x * 1000) / 10;
  out.metrics[name] = {a_pct: pp(rate(ids, A)), b_pct: pp(rate(ids, B)), delta_pp: pp(rate(ids, B) - rate(ids, A)), ci95_pp: [pp(diffs[50]), pp(diffs[1949])]};
}
console.log(JSON.stringify(out, null, 1));
