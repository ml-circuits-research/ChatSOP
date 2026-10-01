#!/usr/bin/env node
/** Error categories and examples of the SymbolicProofingLLM iteration-2 evaluation (experiment train-symbolic-proofing-gemma270m-it2), from the score files and the composed runs.
 *
 *   SYMPROOF_WORK=eval/reports/current/symbolic-proofing-it2 node tools/eval/symbolic-proofing-errors.mjs [--arm it2] [--out errors.md]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {sentencesOf, foldWords, lostFillers, pronounCount} from '../datasets/symbolic-proofing-v2/units.mjs';
import {loadCases} from './composed-score.mjs';

const WORK = path.join(ROOT, process.env.SYMPROOF_WORK ?? 'eval/reports/current/symbolic-proofing-it2');
const args = process.argv.slice(2), opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const ARM = opt('arm', 'it2'), out = opt('out', 'errors.md');
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const readJsonl = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const score = (arm, split) => { const f = path.join(WORK, 'scores', `${arm}__${split}.json`); return fs.existsSync(f) ? readJson(f) : null; };
const rank = (seed, id) => crypto.createHash('sha1').update(`${seed}|${id}`).digest('hex');
const pick = (list, n, seed, key = r => r.id) => [...list].sort((a, b) => rank(seed, key(a)).localeCompare(rank(seed, key(b)))).slice(0, n);
const lines = [];
const trunc = (s, n = 260) => { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 3) + '...' : s; };

export function repairCategory(r) {
  if (r.runaway) return 'runaway (cap hit or repeated sentence)';
  const a = r.analysis;
  if (a.good) return r.unchanged ? 'good: unchanged and already analysis-correct' : r.exact_text ? 'good: equals the verified target text' : 'good: different wording, analysis correct, meaning kept';
  if (r.unchanged) return 'left unchanged, analysis still wrong';
  if (a.out_pass && !a.meaning_kept) {
    const hard = r.meaning.names && r.meaning.numbers && r.meaning.negation && r.meaning.nonempty;
    return hard ? 'meaning lost, analysis correct (judge says no)' : 'meaning lost, analysis correct (names, numbers or negation changed)';
  }
  if (!a.out_pass && a.meaning_kept) return 'changed, analysis still wrong, meaning kept';
  return 'changed, analysis still wrong and meaning lost';
}

const FRAME = /^(any idea|do you know|i wonder|could you check|can you tell me|could you tell me|tell me|i'd like to know|i need to know|let me know|so|okay so|just checking|quick question|quick one|honestly|also|plus|hypothetically|background|question)\b/i;
export function identityCategory(r) {
  const i = r.input, o = r.output, ci = foldWords(i), co = foldWords(o);
  if (ci === co) return 'punctuation or case only';
  const bag = s => foldWords(s).split(' ').sort().join(' ');
  if (pronounCount(o) !== pronounCount(i) || (/\b(he|him|his)\b/i.test(o) !== /\b(he|him|his)\b/i.test(i)) || (/\b(she|her)\b/i.test(o) !== /\b(she|her)\b/i.test(i))) return 'pronoun changed';
  if (lostFillers(i, o).length || (FRAME.test(i.trim()) && !FRAME.test(o.trim()))) return 'lead-in, tag or question frame dropped';
  if (sentencesOf(o).length > sentencesOf(i).length) return 'split into several sentences';
  if (bag(i) === bag(o)) return 'same words reordered (passive/active, fronting, clause order)';
  return 'reworded (words added, dropped or replaced)';
}

const count = list => { const m = new Map(); for (const k of list) m.set(k, (m.get(k) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1]); };
const table = (head, rows) => { lines.push(`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`); for (const r of rows) lines.push(`| ${r.join(' | ')} |`); lines.push(''); };
const ex = (n, title, input, output, target = null, note = '') => { lines.push(`${n}. **${title}**${note ? ` (${note})` : ''}`, `   - IN: ${trunc(input)}`, `   - OUT: ${trunc(output)}`); if (target) lines.push(`   - TGT: ${trunc(target)}`); };

const test = score(ARM, 'test'), sym = score(ARM, 'sym500');
lines.push('## Error categories', '', `Arm: ${ARM}.`, '');
const rep = test.records.filter(r => r.kind === 'repair');
const cats = count(rep.map(repairCategory));
lines.push('### Sealed repair pairs', '');
table(['category', 'pairs', 'share'], cats.map(([k, n]) => [k, String(n), `${Math.round(1000 * n / rep.length) / 10}%`]));
const flags = [['pronoun dropped or replaced', r => r.pronoun_dropped], ['lead-in, tag or question frame dropped', r => r.filler_dropped], ['statement turned into a question', r => r.statement_to_question], ['output sentence count differs from the target', r => r.analysis.shape_out?.sentences !== r.analysis.shape_target?.sentences], ['decomposition pair (target has more sentences)', r => r.decomposition]];
table(['flag (overlapping)', 'pairs'], flags.map(([k, f]) => [k, String(rep.filter(f).length)]));
const byKind = new Map();
for (const r of rep) { const k = r.failure_kind ?? 'none'; const e = byKind.get(k) ?? {n: 0, good: 0}; e.n++; if (r.analysis.good) e.good++; byKind.set(k, e); }
lines.push('Repair pairs by the failure kind of the source row:', '');
table(['failure kind', 'pairs', 'good'], [...byKind].sort((a, b) => b[1].n - a[1].n).map(([k, e]) => [k, String(e.n), `${e.good} (${Math.round(1000 * e.good / e.n) / 10}%)`]));
// by number of target sentences
const bySent = new Map();
for (const r of rep) { const k = Math.min(r.analysis.shape_target?.sentences ?? 1, 4); const e = bySent.get(k) ?? {n: 0, good: 0, exact: 0}; e.n++; if (r.analysis.good) e.good++; if (r.exact_text) e.exact++; bySent.set(k, e); }
lines.push('Repair pairs by the number of sentences of the verified target:', '');
table(['target sentences', 'pairs', 'good', 'equals the target text'], [...bySent].sort((a, b) => a[0] - b[0]).map(([k, e]) => [k === 4 ? '4 or more' : String(k), String(e.n), `${e.good} (${Math.round(1000 * e.good / e.n) / 10}%)`, `${e.exact} (${Math.round(1000 * e.exact / e.n) / 10}%)`]));

lines.push('### Identity breaks (working sentences whose analysis or text changed)', '');
for (const [name, s] of [['sealed identity pairs', test.records.filter(r => r.kind === 'identity')], ['500 working sentences', sym.records]]) {
  const broken = s.filter(r => !r.unchanged || !r.analysis.same_analysis);
  lines.push(`${name}: ${broken.length} of ${s.length} changed.`, '');
  table(['cause (heuristic, first match)', 'sentences', 'of which output no longer analysis-correct'], count(broken.map(identityCategory)).map(([k, n]) => [k, String(n), String(broken.filter(r => identityCategory(r) === k && !r.analysis.out_pass).length)]));
}

// ------------------------------------------------------------------ examples
lines.push('## Thirty examples', '');
let n = 0;
const goodChanged = rep.filter(r => r.analysis.good && !r.unchanged);
const goodDec = pick(goodChanged.filter(r => r.decomposition), 3, 'gd');
const good = [...goodDec, ...pick(goodChanged.filter(r => !r.decomposition && !goodDec.includes(r)), 4, 'g')];
for (const r of good) ex(++n, `good repair${r.decomposition ? ' (decomposition)' : ''} (sealed)`, r.input, r.output, r.target);
const bad = rep.filter(r => !r.analysis.good);
const badDec = pick(bad.filter(r => r.decomposition), 3, 'bd');
const byCat = new Map();
for (const r of bad.filter(r => !badDec.includes(r))) { const c = repairCategory(r); (byCat.get(c) ?? byCat.set(c, []).get(c)).push(r); }
const badOthers = [...byCat.values()].flatMap(list => pick(list, 2, 'b'));
for (const r of badDec) ex(++n, `${repairCategory(r)} (decomposition, sealed)`, r.input, r.output, r.target);
for (const r of pick(badOthers, 6, 'bo')) ex(++n, `${repairCategory(r)} (sealed)`, r.input, r.output, r.target);
const broken = [...test.records.filter(r => r.kind === 'identity'), ...sym.records].filter(r => !r.unchanged || !r.analysis.same_analysis);
const brokenByCat = new Map();
for (const r of broken) { const c = identityCategory(r); (brokenByCat.get(c) ?? brokenByCat.set(c, []).get(c)).push(r); }
for (const r of pick([...brokenByCat.values()].flatMap(l => pick(l, 2, 'ib')), 8, 'ib2')) ex(++n, `identity break: ${identityCategory(r)}`, r.input, r.output, null, r.analysis.out_pass ? 'output still analysis-correct' : 'output no longer analysis-correct');
// K6 and K2 from the composed runs
const k6cases = new Map(loadCases('K6', path.join(ROOT, 'eval/suites'), 'neuro_english').map(r => [r.id, r]));
const k6 = readJsonl(path.join(WORK, 'composed/runs', `${ARM}-sent__K6-neuro_english.jsonl`));
const k6good = k6.filter(r => r.count_match), k6bad = k6.filter(r => !r.count_match);
for (const r of [...pick(k6good, 2, 'k6g'), ...pick(k6bad, 2, 'k6b')]) { const c = k6cases.get(r.id); ex(++n, `K6 decomposition, per sentence: ${r.count_match ? 'sentence count reached' : 'sentence count not reached'} (${r.output_sentences} of ${r.expected_sentences})`, c.message, r.output, c.expected_text); }
const k2cases = new Map(loadCases('K2', path.join(ROOT, 'eval/suites'), 'neuro_english').map(r => [r.id, r]));
const k2 = readJsonl(path.join(WORK, 'composed/runs', `${ARM}__K2__sentence.jsonl`)).filter(r => !r.error);
for (const r of pick(k2, 2, 'k2')) { const c = k2cases.get(r.id); ex(++n, `K2 mixed paragraph, per sentence (${r.n_sentences} sentences, ${r.sent} sent)`, c.message, r.output, c.expected_text); }
lines.push('');
fs.writeFileSync(path.join(WORK, out), lines.join('\n') + '\n');
console.log(`wrote ${path.join(WORK, out)} (${n} examples)`);
