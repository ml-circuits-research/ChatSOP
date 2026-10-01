#!/usr/bin/env node
/** Error categories and examples of an arm on the judged sample (repair units), exclusive, first match wins; writes $LP_WORK/examples.jsonl (30 examples).
 *   node tools/eval/language-proofing-v2-errors.mjs --name lp-it2 --other lp-it1
 */
import fs from 'node:fs';
import path from 'node:path';
import {WORK} from './language-proofing-eval.mjs';

const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const name = arg('--name') ?? 'lp-it2', other = arg('--other') ?? 'lp-it1';
const load = n => new Map(JSON.parse(fs.readFileSync(path.join(WORK, 'scores', `${n}__test600.json`), 'utf8')).records.map(r => [r.id, r]));
const A = load(name), B = load(other);
const fold = t => String(t).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const childIn = t => /\b(copil|copilul|copilului|copii|copiii|child|children)\b/.test(fold(t)), parentIn = t => /\b(parinte|parintele|parinti|parent|parents)\b/.test(fold(t));
const cat = r => {
  if (r.pair !== 'repair') return null;
  if (!r.clean_gate && /gibberish/.test(r.clean_gate_reasons.join(' '))) return 'keyboard-mash or unintelligible input (clean-English gate says gibberish)';
  if (!r.clean_gate) return 'other clean-English gate failure (untranslated word, spelling left)';
  if (!r.content_ok_neg) return 'content lost or changed mechanically (name, number, quote, negation, question mark, length)';
  if (childIn(r.input) && /\bparents?\b/i.test(r.output) && !parentIn(r.input)) return 'relation flip child to parent';
  if (r.meaning_ok === false) return 'meaning judge rejects (wrong lexical choice, wrong translation, added or dropped detail, judge strictness)';
  if (!r.analysis_pass) return 'only the analysis gate fails (meaning judge and mechanics pass)';
  return 'pass everything';
};
const count = M => { const c = {}; let n = 0; for (const r of M.values()) { const k = cat(r); if (!k) continue; n++; c[k] = (c[k] ?? 0) + 1; } return {n, c}; };
const a = count(A), b = count(B);
console.log('| category | ' + name + ' units | share | ' + other + ' units | share |\n|---|---|---|---|---|');
for (const k of new Set([...Object.keys(a.c), ...Object.keys(b.c)])) console.log(`| ${k} | ${a.c[k] ?? 0} | ${(100 * (a.c[k] ?? 0) / a.n).toFixed(1)}% | ${b.c[k] ?? 0} | ${(100 * (b.c[k] ?? 0) / b.n).toFixed(1)}% |`);
// 30 examples: spread over kinds and outcomes, deterministic
const rows = [...A.values()].filter(r => r.pair === 'repair' || r.pair === 'identity').sort((x, y) => x.id.localeCompare(y.id));
const pick = [];
const take = (filter, n) => { for (const r of rows.filter(filter)) { if (pick.length >= 30 || n <= 0) break; if (!pick.includes(r)) { pick.push(r); n--; } } };
take(r => r.kind === 'ro' && cat(r) === 'pass everything', 5); take(r => r.kind === 'mixed' && cat(r) === 'pass everything', 4); take(r => r.kind === 'noisy_en' && cat(r) === 'pass everything', 4);
take(r => r.pair === 'repair' && cat(r) === 'meaning judge rejects (wrong lexical choice, wrong translation, added or dropped detail, judge strictness)', 5);
take(r => r.pair === 'repair' && cat(r) === 'only the analysis gate fails (meaning judge and mechanics pass)', 3);
take(r => r.pair === 'repair' && cat(r) === 'other clean-English gate failure (untranslated word, spelling left)', 2);
take(r => r.pair === 'repair' && cat(r) === 'keyboard-mash or unintelligible input (clean-English gate says gibberish)', 2);
take(r => r.pair === 'identity' && r.unchanged, 2); take(r => r.pair === 'identity' && !r.unchanged, 3);
take(r => r.pair === 'repair' && childIn(r.input), 6);
const out = pick.slice(0, 30).map(r => ({id: r.id, kind: r.kind, pair: r.pair, input: r.input, reference: r.target, [name]: r.output, [other]: B.get(r.id)?.output, category: cat(r) ?? (r.unchanged ? 'identity untouched' : 'identity changed')}));
fs.writeFileSync(path.join(WORK, 'examples.jsonl'), out.map(x => JSON.stringify(x)).join('\n') + '\n');
