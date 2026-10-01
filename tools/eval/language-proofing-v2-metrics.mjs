#!/usr/bin/env node
/** Iteration-2 selection and vocabulary metrics for LanguageProofingLLM (experiment train-language-proofing-gemma270m-it2). Works on $LP_WORK outputs and scores.
 *
 *   node tools/eval/language-proofing-v2-metrics.mjs heldout --name N     # held-out word kept (outputs of `generate --split heldout`), per kind
 *   node tools/eval/language-proofing-v2-metrics.mjs mash --name N [--split mash]   # keyboard-mash strings returned unchanged
 *   node tools/eval/language-proofing-v2-metrics.mjs select --names a,b,c  # the preregistered epoch-selection table (scores of dev2300, devbg, heldout, mash must exist)
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {WORK} from './language-proofing-eval.mjs';
import {norm} from '../datasets/language-proofing/pairs.mjs';

const readJsonl = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const ROOTS = {cousin: /\bcousins?\b/i, niece: /\bnieces?\b/i, uncle: /\buncles?\b/i, tenant: /\btenants?\b/i, supervisor: /\bsupervisors?\b/i, tutor: /\b(tutors?|tutored|tutoring)\b/i, owe: /\b(owes?|owed|owing)\b/i, adopt: /\b(adopts?|adopted|adopting|adoption)\b/i, audit: /\b(audits?|audited|auditing)\b/i, boatyard: /\bboatyards?\b/i};
const rate = (k, n) => ({k, n, pct: n ? Math.round(1000 * k / n) / 10 : null});

export function heldout(name) {
  const rows = readJsonl(path.join(ROOT, 'datasets/bad_english/proofing-v2/dev-heldout.jsonl')), outs = new Map(readJsonl(path.join(WORK, 'outputs', `${name}__heldout.jsonl`)).map(r => [r.id, r.output]));
  const by = {}, byWord = {}, tot = {k: 0, n: 0};
  for (const r of rows) {
    const o = outs.get(r.id) ?? '';
    for (const [w, re] of Object.entries(ROOTS)) if (re.test(r.target)) {
      const hit = re.test(o), b = (by[r.language_kind] ??= {k: 0, n: 0}), bw = (byWord[w] ??= {k: 0, n: 0});
      b.n++; bw.n++; tot.n++; if (hit) { b.k++; bw.k++; tot.k++; }
    }
  }
  const res = {name, total: rate(tot.k, tot.n), by_kind: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, rate(v.k, v.n)])), by_word: Object.fromEntries(Object.entries(byWord).map(([k, v]) => [k, rate(v.k, v.n)]))};
  fs.writeFileSync(path.join(WORK, 'scores', `heldout-word__${name}.json`), JSON.stringify(res, null, 1) + '\n');
  return res;
}
export function mash(name, split = 'mash') {
  const file = split === 'mash' ? 'datasets/bad_english/proofing-v2/mash-eval.jsonl' : null;
  const rows = readJsonl(path.join(ROOT, file)), outs = new Map(readJsonl(path.join(WORK, 'outputs', `${name}__${split}.jsonl`)).map(r => [r.id, r.output]));
  const k = rows.filter(r => norm(outs.get(r.id) ?? '') === norm(r.prompt)).length;
  const res = {name, unchanged: rate(k, rows.length), examples_changed: rows.filter(r => norm(outs.get(r.id) ?? '') !== norm(r.prompt)).slice(0, 6).map(r => [r.prompt, outs.get(r.id)])};
  fs.writeFileSync(path.join(WORK, 'scores', `mash__${name}.json`), JSON.stringify(res, null, 1) + '\n');
  return res;
}
const score = (name, tag) => { const f = path.join(WORK, 'scores', `${name}__${tag}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).summary : null; };
function select(names) {
  const rows = [];
  for (const name of names) {
    const dev = score(name, 'dev2300'), bg = score(name, 'devbg'), ho = score(name, 'heldout'), m = mash(name);
    const good = s => (s?.repair ? s.repair.good.pct : null);
    const idDev = dev?.identity?.left_untouched, idBg = bg?.identity?.left_untouched;
    const idK = (idDev?.k ?? 0) + (idBg?.k ?? 0), idN = (idDev?.n ?? 0) + (idBg?.n ?? 0);
    rows.push({name, dev2300_repair_good: good(dev), devbg_repair_good: good(bg), heldout_repair_good: good(ho), heldout_word_kept: heldout(name).total.pct, devbg_chrf: bg?.repair?.chrf?.mean ?? null,
      identity_untouched_pct: idN ? Math.round(1000 * idK / idN) / 10 : null, mash_unchanged_pct: m.unchanged.pct, selection_score: ((good(bg) ?? 0) + (good(ho) ?? 0)) / 2});
  }
  const eligible = rows.filter(r => (r.identity_untouched_pct ?? 0) >= 95 && (r.mash_unchanged_pct ?? 0) >= 90).sort((a, b) => b.selection_score - a.selection_score || (b.devbg_chrf ?? 0) - (a.devbg_chrf ?? 0));
  console.log(JSON.stringify({rows, eligible: eligible.map(r => r.name), selected: eligible[0]?.name ?? null}, null, 1));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2), arg = n => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
  fs.mkdirSync(path.join(WORK, 'scores'), {recursive: true});
  if (cmd === 'heldout') console.log(JSON.stringify(heldout(arg('--name')), null, 1));
  else if (cmd === 'mash') console.log(JSON.stringify(mash(arg('--name'), arg('--split') ?? 'mash'), null, 1));
  else if (cmd === 'select') select(String(arg('--names')).split(','));
  else { console.error('usage: heldout|mash|select'); process.exitCode = 2; }
}
