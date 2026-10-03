#!/usr/bin/env node
/**
 * Side-by-side comparison of two arms of the six-paths experiment on the same problem ids (owner, 2026-10-03: tier small next to
 * tier tiny): per path correct / wrong / no result on each tier; per question the share of unreadable answers on each tier; the
 * problems where one tier's path is correct and the other's is not, with the step where the other stopped; verified coverage and
 * precision of "2 of N agree" on each tier.
 *
 *   node tools/eval/six-paths/compare.mjs --a dev1 --b dev1-tiny [--out FILE]
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './common.mjs';
import {isCorrect} from './score.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const load = run => new Map(fs.readFileSync(path.join(ROOT, 'state/six-paths', run, 'results.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(r => [r.id, r]));

/** Where a path stopped: its status and the last question it asked (with the unreadable mark). */
const stopOf = p => !p ? 'not run' : p.verdict === 'no_result' ? `${p.status}${p.why ? ` at ${String(p.why).slice(0, 60)}` : ''}` : p.verdict;

export function compare(A, B, {a = 'small', b = 'tiny'} = {}) {
  const ids = [...A.keys()].filter(id => B.has(id));
  const names = [...new Set(ids.flatMap(id => [...Object.keys(A.get(id).paths), ...Object.keys(B.get(id).paths)]))].sort();
  const L = [`# Six paths, ${a} vs ${b}: ${ids.length} common problems`, '', `| path | ${a} correct | ${a} wrong | ${a} no result | ${b} correct | ${b} wrong | ${b} no result | only ${a} correct | only ${b} correct |`, '|---|---|---|---|---|---|---|---|---|'];
  const only = {};
  for (const n of names) {
    const c = (M, k) => ids.filter(id => (k === 'correct' ? isCorrect(M.get(id).paths[n]?.verdict) : M.get(id).paths[n]?.verdict === k)).length;
    const oa = ids.filter(id => isCorrect(A.get(id).paths[n]?.verdict) && !isCorrect(B.get(id).paths[n]?.verdict));
    const ob = ids.filter(id => isCorrect(B.get(id).paths[n]?.verdict) && !isCorrect(A.get(id).paths[n]?.verdict));
    only[n] = {oa, ob};
    L.push(`| ${n} | ${c(A, 'correct')} | ${c(A, 'wrong')} | ${c(A, 'no_result')} | ${c(B, 'correct')} | ${c(B, 'wrong')} | ${c(B, 'no_result')} | ${oa.length} | ${ob.length} |`);
  }
  // Per question: how often it was asked and how often its first answer was unreadable, per tier.
  const qstats = M => {
    const out = new Map();
    for (const id of ids) for (const p of Object.values(M.get(id).paths)) for (const t of p.trace ?? []) {
      if (t.round) continue;
      const s = out.get(t.id) ?? {asked: 0, unread: 0}; s.asked++; if (t.read === null && t.answer !== undefined && !/^B_|^E_/.test(t.id)) s.unread++; out.set(t.id, s);
    }
    return out;
  };
  const qa = qstats(A), qb = qstats(B);
  L.push('', `| question | ${a} asked | ${a} unreadable | ${b} asked | ${b} unreadable |`, '|---|---|---|---|---|');
  for (const q of [...new Set([...qa.keys(), ...qb.keys()])].sort()) L.push(`| ${q} | ${qa.get(q)?.asked ?? 0} | ${qa.get(q)?.unread ?? 0} | ${qb.get(q)?.asked ?? 0} | ${qb.get(q)?.unread ?? 0} |`);
  L.push('', 'Where one tier is right and the other is not (the other tier\'s outcome):');
  for (const n of names) {
    if (only[n].oa.length) L.push(`- ${n} only ${a}: ${only[n].oa.map(id => `${id} (${b}: ${stopOf(B.get(id).paths[n])})`).join('; ')}`);
    if (only[n].ob.length) L.push(`- ${n} only ${b}: ${only[n].ob.map(id => `${id} (${a}: ${stopOf(A.get(id).paths[n])})`).join('; ')}`);
  }
  for (const [label, M] of [[a, A], [b, B]]) {
    const ver = ids.filter(id => M.get(id).decision?.status === 'verified');
    const ok = ver.filter(id => isCorrect(M.get(id).decision.verdict)), sc = ver.filter(id => ['correct', 'format', 'wrong'].includes(M.get(id).decision.verdict));
    const scorable = ids.filter(id => !Object.values(M.get(id).paths).some(p => p.verdict === 'gold_defect')).length;
    L.push('', `${label}: verified ${sc.length}/${scorable} scorable, precision ${ok.length}/${sc.length} (gold defects excluded); at least one path correct ${ids.filter(id => Object.values(M.get(id).paths).some(p => isCorrect(p.verdict))).length}/${ids.length}.`);
  }
  return L.join('\n') + '\n';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const text = compare(load(args.a), load(args.b), {a: args.la ?? 'small', b: args.lb ?? 'tiny'});
  if (args.out) fs.writeFileSync(args.out, text);
  console.log(text);
}
