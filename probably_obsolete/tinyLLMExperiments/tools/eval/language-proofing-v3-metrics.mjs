#!/usr/bin/env node
/** Iteration-3 metrics for LanguageProofingLLM (experiment train-language-proofing-gemma270m-it3). Works on $LP_WORK outputs and scores.
 *
 *   node tools/eval/language-proofing-v3-metrics.mjs words --name N --set trained|unseen [--split heldout|heldout3]   # target word kept per row, kind and word (writes scores/words-<set>__N.json)
 *   node tools/eval/language-proofing-v3-metrics.mjs sealed-words --name N --set trained|unseen                       # the same on the sealed proofing units whose reference or input contains a word of the set
 *   node tools/eval/language-proofing-v3-metrics.mjs spacing --name N                                                 # exact repair of dev-spacing, and the defect-free identity rate on dev2300 + devbg
 *   node tools/eval/language-proofing-v3-metrics.mjs paired --a N1 --b N2 --kind words-trained|words-unseen|spacing|mash   # paired bootstrap difference b minus a
 *   node tools/eval/language-proofing-v3-metrics.mjs select --names a,b,c                                             # the preregistered epoch-selection table
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {WORK, bootstrapMean} from './language-proofing-eval.mjs';
import {mash} from './language-proofing-v2-metrics.mjs';
import {norm} from '../datasets/language-proofing/pairs.mjs';
import {TRAINED_TEN, HELD_OUT_V3} from '../datasets/language-proofing/vocab-it3.mjs';
import {hasSpacingDefect} from '../datasets/language-proofing/spacing.mjs';
import {wilson} from './composed/stats.mjs';

const readJsonl = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const SETS = {trained: {table: TRAINED_TEN, split: 'heldout', file: 'datasets/bad_english/proofing-it3/dev-heldout.jsonl'}, unseen: {table: HELD_OUT_V3, split: 'heldout3', file: 'datasets/bad_english/proofing-it3/dev-heldout-v3.jsonl'},
  // production build 1: the eight probe words are trained; their dev slice, the ten words' dev (heldout) and the fresh probe sentences (words of both lists, rows carry `word`)
  trained8: {table: HELD_OUT_V3, split: 'vocab8', file: 'datasets/bad_english/proofing-prod1/dev-vocab8.jsonl'}, fresh18: {table: {...TRAINED_TEN, ...HELD_OUT_V3}, split: 'vocabfresh', file: 'eval/suites/bad_english/proofing-probe-vocab.jsonl'}};
const rate = (k, n) => ({k, n, pct: n ? Math.round(1000 * k / n) / 10 : null, ci95: n ? wilson(k, n) : null});
const outOf = (name, split) => new Map(readJsonl(path.join(WORK, 'outputs', `${name}__${split}.jsonl`)).map(r => [r.id, r.output]));

/** Rows (id, word, kind, hit) of one vocabulary set for one arm: a row counts for the first word of the set that its reference contains. */
export function wordRows(name, set) {
  const {table, split, file} = SETS[set];
  const outs = outOf(name, split);
  return readJsonl(path.join(ROOT, file)).map(r => {
    const word = Object.keys(table).find(w => table[w].test(r.target));
    return word ? {id: r.id, word, kind: r.language_kind, hit: table[word].test(outs.get(r.id) ?? ''), unchanged: norm(outs.get(r.id) ?? '') === norm(r.prompt)} : null;
  }).filter(Boolean);
}
export function words(name, set) {
  const rows = wordRows(name, set), by = (key) => { const o = {}; for (const r of rows) { const b = (o[r[key]] ??= {k: 0, n: 0}); b.n++; if (r.hit) b.k++; } return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, rate(v.k, v.n)])); };
  const res = {name, set, total: rate(rows.filter(r => r.hit).length, rows.length), by_kind: by('kind'), by_word: by('word'), returned_unchanged: rate(rows.filter(r => r.unchanged).length, rows.length)};
  fs.writeFileSync(path.join(WORK, 'scores', `words-${set}__${name}.json`), JSON.stringify(res, null, 1) + '\n');
  return res;
}
/** Sealed proofing units whose reference or input contains a word of the set (there are few: reported as a check, not as a measure). */
export function sealedWords(name, set) {
  const {table} = SETS[set], units = readJsonl(path.join(ROOT, 'eval/suites/bad_english/proofing-test.jsonl')), outs = outOf(name, 'test');
  const rows = units.filter(u => u.pair === 'repair' && Object.values(table).some(re => re.test(u.target ?? '') || re.test(u.prompt ?? ''))).map(u => {
    const word = Object.keys(table).find(w => table[w].test(u.target ?? '') || table[w].test(u.prompt ?? ''));
    return {id: u.id, word, hit: table[word].test(outs.get(u.id) ?? '')};
  });
  const res = {name, set, total: rate(rows.filter(r => r.hit).length, rows.length), by_word: Object.fromEntries(Object.entries(rows.reduce((o, r) => { (o[r.word] ??= {k: 0, n: 0}).n++; if (r.hit) o[r.word].k++; return o; }, {})).map(([k, v]) => [k, rate(v.k, v.n)]))};
  fs.writeFileSync(path.join(WORK, 'scores', `sealed-words-${set}__${name}.json`), JSON.stringify(res, null, 1) + '\n');
  return res;
}
export function spacing(name) {
  const rows = readJsonl(path.join(ROOT, 'datasets/bad_english/proofing-it3/dev-spacing.jsonl')), outs = outOf(name, 'spacing');
  const exact = rows.filter(r => norm(outs.get(r.id) ?? '') === norm(r.target)), unchanged = rows.filter(r => norm(outs.get(r.id) ?? '') === norm(r.prompt));
  // identity units of the regular dev sets, split by whether the (unchanged) prompt has a spacing defect: a repaired defect is intended in iteration 3
  const ident = {defect_free: {k: 0, n: 0}, defect: {k: 0, n: 0}};
  for (const split of ['dev2300', 'devbg']) {
    const f = path.join(WORK, 'scores', `${name}__${split}.json`); if (!fs.existsSync(f)) continue;
    for (const r of JSON.parse(fs.readFileSync(f, 'utf8')).records) if (r.pair === 'identity' && r.kind !== 'mash') { const b = ident[hasSpacingDefect(r.input) ? 'defect' : 'defect_free']; b.n++; if (r.unchanged) b.k++; }
  }
  const res = {name, spacing_exact: rate(exact.length, rows.length), spacing_returned_unchanged: rate(unchanged.length, rows.length), identity_defect_free_untouched: rate(ident.defect_free.k, ident.defect_free.n), identity_defect_units_untouched: rate(ident.defect.k, ident.defect.n),
    examples_wrong: rows.filter(r => norm(outs.get(r.id) ?? '') !== norm(r.target)).slice(0, 6).map(r => [r.prompt, outs.get(r.id)])};
  fs.writeFileSync(path.join(WORK, 'scores', `spacing__${name}.json`), JSON.stringify(res, null, 1) + '\n');
  return res;
}
function paired(a, b, kind) {
  const pick = {'words-trained': n => new Map(wordRows(n, 'trained').map(r => [r.id, Number(r.hit)])), 'words-unseen': n => new Map(wordRows(n, 'unseen').map(r => [r.id, Number(r.hit)])),
    spacing: n => { const rows = readJsonl(path.join(ROOT, 'datasets/bad_english/proofing-it3/dev-spacing.jsonl')), o = outOf(n, 'spacing'); return new Map(rows.map(r => [r.id, Number(norm(o.get(r.id) ?? '') === norm(r.target))])); },
    mash: n => { const rows = readJsonl(path.join(ROOT, 'datasets/bad_english/proofing-it3/mash-eval.jsonl')), o = outOf(n, 'mash'); return new Map(rows.map(r => [r.id, Number(norm(o.get(r.id) ?? '') === norm(r.prompt))])); }}[kind];
  const A = pick(a), B = pick(b), ids = [...A.keys()].filter(id => B.has(id)), d = ids.map(id => B.get(id) - A.get(id));
  const mean = x => x.reduce((p, q) => p + q, 0) / x.length;
  return {kind, a, b, n: ids.length, a_pct: Math.round(1000 * mean(ids.map(id => A.get(id)))) / 10, b_pct: Math.round(1000 * mean(ids.map(id => B.get(id)))) / 10, delta_pp: Math.round(1000 * mean(d)) / 10, ci95_pp: bootstrapMean(d, {seed: 5}).map(x => Math.round(x * 1000) / 10)};
}
const scoreOf = (name, tag) => { const f = path.join(WORK, 'scores', `${name}__${tag}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).summary : null; };
function select(names) {
  const rows = names.map(name => {
    const bg = scoreOf(name, 'devbg'), ho = scoreOf(name, 'heldout'), h3 = scoreOf(name, 'heldout3'), sp = spacing(name), m = mash(name);
    const good = s => s?.repair?.good?.pct ?? null;
    const idf = sp.identity_defect_free_untouched;
    return {name, devbg_good: good(bg), heldout_trained_good: good(ho), heldout_unseen_good: good(h3), trained_word_kept: words(name, 'trained').total.pct, unseen_word_kept: words(name, 'unseen').total.pct, devbg_chrf: bg?.repair?.chrf?.mean ?? null,
      identity_defect_free_pct: idf.pct, mash_unchanged_pct: m.unchanged.pct, spacing_exact_pct: sp.spacing_exact.pct, selection_score: ((good(bg) ?? 0) + (good(ho) ?? 0) + (good(h3) ?? 0)) / 3};
  });
  const eligible = rows.filter(r => (r.identity_defect_free_pct ?? 0) >= 95 && (r.mash_unchanged_pct ?? 0) >= 90 && (r.spacing_exact_pct ?? 0) >= 80).sort((a, b) => b.selection_score - a.selection_score || (b.devbg_chrf ?? 0) - (a.devbg_chrf ?? 0));
  console.log(JSON.stringify({rows, eligible: eligible.map(r => r.name), selected: eligible[0]?.name ?? null}, null, 1));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2), arg = n => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
  fs.mkdirSync(path.join(WORK, 'scores'), {recursive: true});
  if (cmd === 'words') console.log(JSON.stringify(words(arg('--name'), arg('--set')), null, 1));
  else if (cmd === 'sealed-words') console.log(JSON.stringify(sealedWords(arg('--name'), arg('--set')), null, 1));
  else if (cmd === 'spacing') console.log(JSON.stringify(spacing(arg('--name')), null, 1));
  else if (cmd === 'paired') console.log(JSON.stringify(paired(arg('--a'), arg('--b'), arg('--kind')), null, 1));
  else if (cmd === 'select') select(String(arg('--names')).split(','));
  else { console.error('usage: words|sealed-words|spacing|paired|select'); process.exitCode = 2; }
}
