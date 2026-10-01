#!/usr/bin/env node
/** Production-build-1 metrics for LanguageProofingLLM (experiment train-language-proofing-gemma270m-prod1). Works on $LP_WORK outputs and scores.
 *
 *   node tools/eval/language-proofing-prod1-metrics.mjs names --name N            # institution and place names kept verbatim: dev-names and the sealed units whose input has a name
 *   node tools/eval/language-proofing-prod1-metrics.mjs typochild --name N        # dev-typochild: child word kept, parent flip
 *   node tools/eval/language-proofing-prod1-metrics.mjs vocab --name N            # target-word rate on dev-heldout (ten words), dev-vocab8 (eight words) and the fresh probe (all eighteen)
 *   node tools/eval/language-proofing-prod1-metrics.mjs select --names a,b,c      # the preregistered epoch-selection table of train-language-proofing-gemma270m-prod1
 *   node tools/eval/language-proofing-prod1-metrics.mjs paired --a N1 --b N2 --kind vocab8|heldout|fresh|names|typochild   # paired bootstrap difference b minus a
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {WORK, bootstrapMean} from './language-proofing-eval.mjs';
import {mash} from './language-proofing-v2-metrics.mjs';
import {words, wordRows, spacing} from './language-proofing-v3-metrics.mjs';
import {instNames} from '../datasets/language-proofing/names-typos.mjs';
import {norm} from '../datasets/language-proofing/pairs.mjs';
import {wilson} from './composed/stats.mjs';

const readJsonl = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const rate = (k, n) => ({k, n, pct: n ? Math.round(1000 * k / n) / 10 : null, ci95: n ? wilson(k, n) : null});
const outOf = (name, split) => new Map(readJsonl(path.join(WORK, 'outputs', `${name}__${split}.jsonl`)).map(r => [r.id, r.output]));
const P1 = 'datasets/bad_english/proofing-prod1';
const fold = t => String(t).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Rows with their kept flag: every institution or place name of the input occurs in the output exactly as written. */
export function nameRows(name, split = 'names') {
  const file = split === 'names' ? path.join(ROOT, P1, 'dev-names.jsonl') : path.join(ROOT, 'eval/suites/bad_english/proofing-test.jsonl'), outs = outOf(name, split === 'names' ? 'names' : 'test');
  return readJsonl(file).filter(r => split === 'names' || (r.pair ?? r.kind) === 'repair' || (r.pair ?? r.kind) === 'identity').map(r => {
    const names = instNames(r.prompt);
    if (!names.length || !outs.has(r.id)) return null;
    const out = outs.get(r.id) ?? '', lost = names.filter(n => !out.includes(n));
    return {id: r.id, names, lost, kept: lost.length === 0, kept_folded: names.every(n => fold(out).includes(fold(n)))};
  }).filter(Boolean);
}
export function names(name) {
  const dev = nameRows(name, 'names'), sealed = fs.existsSync(path.join(WORK, 'outputs', `${name}__test.jsonl`)) ? nameRows(name, 'test') : [];
  const res = {name, dev_names_all_kept: rate(dev.filter(r => r.kept).length, dev.length), dev_names_kept_folded: rate(dev.filter(r => r.kept_folded).length, dev.length),
    sealed_units_with_name: sealed.length, sealed_units_all_kept: rate(sealed.filter(r => r.kept).length, sealed.length), sealed_names_lost: sealed.reduce((n, r) => n + r.lost.length, 0), sealed_names_total: sealed.reduce((n, r) => n + r.names.length, 0),
    examples_lost: [...dev, ...sealed].filter(r => !r.kept).slice(0, 8).map(r => ({id: r.id, lost: r.lost}))};
  fs.writeFileSync(path.join(WORK, 'scores', `names__${name}.json`), JSON.stringify(res, null, 1) + '\n');
  return res;
}
const CHILD_OUT = /\b(child|children|kid|kids|son|daughter|sons|daughters|child's|children's)\b/i;
export function typochild(name) {
  const rows = readJsonl(path.join(ROOT, P1, 'dev-typochild.jsonl')), outs = outOf(name, 'typochild');
  let kept = 0, flip = 0;
  for (const r of rows) { const o = outs.get(r.id) ?? ''; if (CHILD_OUT.test(o)) kept++; if (/\bparents?\b/i.test(o) && !/\b(parinte|părinte|parent)/i.test(r.prompt)) flip++; }
  const exact = rows.filter(r => norm(outs.get(r.id) ?? '') === norm(r.target)).length;
  const res = {name, child_word_kept: rate(kept, rows.length), parent_flip: rate(flip, rows.length), exact_reference: rate(exact, rows.length)};
  fs.writeFileSync(path.join(WORK, 'scores', `typochild__${name}.json`), JSON.stringify(res, null, 1) + '\n');
  return res;
}
export function vocab(name) {
  const out = {name};
  for (const [label, set, split] of [['ten_words_dev_heldout', 'trained', 'heldout'], ['eight_words_dev_vocab8', 'trained8', 'vocab8'], ['fresh_probe_18_words', 'fresh18', 'vocabfresh']]) {
    if (fs.existsSync(path.join(WORK, 'outputs', `${name}__${split}.jsonl`))) { const r = words(name, set); out[label] = {total: r.total, by_word: r.by_word, by_kind: r.by_kind}; }
  }
  return out;
}
function paired(a, b, kind) {
  const pick = {vocab8: n => new Map(wordRows(n, 'trained8').map(r => [r.id, Number(r.hit)])), heldout: n => new Map(wordRows(n, 'trained').map(r => [r.id, Number(r.hit)])), fresh: n => new Map(wordRows(n, 'fresh18').map(r => [r.id, Number(r.hit)])),
    names: n => new Map(nameRows(n, 'names').map(r => [r.id, Number(r.kept)])), typochild: n => { const rows = readJsonl(path.join(ROOT, P1, 'dev-typochild.jsonl')), o = outOf(n, 'typochild'); return new Map(rows.map(r => [r.id, Number(CHILD_OUT.test(o.get(r.id) ?? ''))])); }}[kind];
  const A = pick(a), B = pick(b), ids = [...A.keys()].filter(id => B.has(id)), d = ids.map(id => B.get(id) - A.get(id)), mean = x => x.reduce((p, q) => p + q, 0) / x.length;
  return {kind, a, b, n: ids.length, a_pct: Math.round(1000 * mean(ids.map(id => A.get(id)))) / 10, b_pct: Math.round(1000 * mean(ids.map(id => B.get(id)))) / 10, delta_pp: Math.round(1000 * mean(d)) / 10, ci95_pp: bootstrapMean(d, {seed: 5}).map(x => Math.round(x * 1000) / 10)};
}
const scoreOf = (name, tag) => { const f = path.join(WORK, 'scores', `${name}__${tag}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).summary : null; };
function select(list) {
  const rows = list.map(name => {
    const bg = scoreOf(name, 'devbg'), ho = scoreOf(name, 'heldout'), v8 = scoreOf(name, 'vocab8'), sp = spacing(name), m = mash(name), nm = names(name);
    const good = s => s?.repair?.good?.pct ?? s?.repair?.mechanical_good?.pct ?? null;
    return {name, devbg_good: good(bg), heldout_good: good(ho), vocab8_good: good(v8), ten_word_kept: words(name, 'trained').total.pct, eight_word_kept: words(name, 'trained8').total.pct, devbg_chrf: bg?.repair?.chrf?.mean ?? null,
      identity_defect_free_pct: sp.identity_defect_free_untouched.pct, mash_unchanged_pct: m.unchanged.pct, spacing_exact_pct: sp.spacing_exact.pct, names_kept_pct: nm.dev_names_all_kept.pct,
      selection_score: ((good(bg) ?? 0) + (good(ho) ?? 0) + (good(v8) ?? 0)) / 3};
  });
  const eligible = rows.filter(r => (r.identity_defect_free_pct ?? 0) >= 95 && (r.mash_unchanged_pct ?? 0) >= 90 && (r.spacing_exact_pct ?? 0) >= 80 && (r.names_kept_pct ?? 0) >= 90).sort((a, b) => b.selection_score - a.selection_score || (b.devbg_chrf ?? 0) - (a.devbg_chrf ?? 0));
  console.log(JSON.stringify({rows, eligible: eligible.map(r => r.name), selected: eligible[0]?.name ?? null}, null, 1));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2), arg = n => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
  fs.mkdirSync(path.join(WORK, 'scores'), {recursive: true});
  if (cmd === 'names') console.log(JSON.stringify(names(arg('--name')), null, 1));
  else if (cmd === 'typochild') console.log(JSON.stringify(typochild(arg('--name')), null, 1));
  else if (cmd === 'vocab') console.log(JSON.stringify(vocab(arg('--name')), null, 1));
  else if (cmd === 'paired') console.log(JSON.stringify(paired(arg('--a'), arg('--b'), arg('--kind')), null, 1));
  else if (cmd === 'select') select(String(arg('--names')).split(','));
  else { console.error('usage: names|typochild|vocab|paired|select'); process.exitCode = 2; }
}
