/**
 * Path F, analogy: retrieve verified solved problems with their computations (the F1 exemplar index of the dual-formalization work
 * plus this experiment's own verified pool), never the same problem, never the same book section, never a content-word duplicate
 * (strict leave-one-out, tools/eval/formalization-regression/expression.mjs sectionExclude); rank by book and registry shape; ask which
 * computation has the same steps, map each of its inputs to a number of this problem by index, and ask whether the mapped computation
 * answers exactly the question (an input without a counterpart, or a "no", stops the path honestly). SOP is the verified computation
 * with this problem's numbers substituted, lowered to session rules. The exemplar's problem text is never shown (DS011).
 */
import fs from 'node:fs';
import path from 'node:path';
import {loadExemplarIndex, shapeOf, shapeDistance} from '../../../lib/formalize/exemplars.mjs';
import {ask, numbersBlock, answerLines, readChoice, readIndex, readRef, readYesNo, ROOT} from './common.mjs';
import {programResult} from './program.mjs';

export const POOL = path.join(ROOT, 'datasets_sources/six-paths/pool.jsonl');
const readJsonl = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

/** Exemplars: the F1 index and the own pool (rows {id, shape, numbers: "v1 = 18, v2 = 10%", program, meta: {book, stratum, words}}). */
export const exemplars = () => [...loadExemplarIndex(), ...readJsonl(POOL)];

/** The `k` best exemplars: same chapter (another section) and same book first, then the nearest registry shape; `exclude(row)` is the leave-one-out. */
export function nearest(rows, registry, item, {k = 3, exclude}) {
  const shape = shapeOf(registry);
  const seen = new Set();
  return rows.filter(r => !exclude(r) && r.program && !seen.has(r.program) && seen.add(r.program))
    .map(r => ({r, d: shapeDistance(shape, r.shape) + (r.meta?.book === item.book ? 0 : 3) - (r.meta?.chapter && r.meta.chapter === item.chapter ? 2 : 0)}))
    .sort((a, b) => a.d - b.d || String(a.r.id).localeCompare(String(b.r.id))).slice(0, k).map(x => x.r);
}

/** An exemplar as inputs x1..xk and lines: {inputs: [{x, percent, role}], lines: [{name, text}], shown}. */
export function asTemplate(row) {
  const nums = String(row.numbers).split(/,\s*(?=v\d+\s*=)/).map(s => /^v(\d+)\s*=\s*(.+)$/.exec(s.trim())).filter(Boolean).map(m => ({k: Number(m[1]), percent: /%/.test(m[2])}));
  const lines = String(row.program).split('\n').map(l => /^([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(l.trim())).filter(Boolean).map(m => ({name: m[1], text: m[2].replace(/\bv(\d+)\b/g, 'x$1')}));
  const used = [...new Set(lines.flatMap(l => [...l.text.matchAll(/\bx(\d+)\b/g)].map(m => Number(m[1]))))].sort((a, b) => a - b);
  const inputs = used.map(k => ({x: `x${k}`, percent: nums.find(n => n.k === k)?.percent ?? false, role: lines.find(l => new RegExp(`\\bx${k}\\b`).test(l.text))}));
  return {inputs: inputs.map(i => ({...i, role: `${i.x}${i.percent ? ' (a percentage)' : ''}: used in ${i.role.name} = ${i.role.text}`})), lines,
    shown: lines.map(l => `${l.name} = ${l.text}`).join('\n')};
}

export async function pathF({item, registry, ctx, exclude}) {
  if (!registry.length) return {status: 'no_numbers'};
  const cands = nearest(exemplars(), registry, item, {exclude}).map(asTemplate);
  if (!cands.length) return {status: 'no_exemplar'};
  const base = {problem: item.question, numbers: numbersBlock(registry)};
  const list = cands.map((c, i) => `${i + 1}. inputs ${c.inputs.map(x => x.x + (x.percent ? '%' : '')).join(', ')}\n${c.shown}`).join('\n\n');
  const ch = await ask(ctx, 'F_choose', {...base, exemplars: list}, t => readChoice(t, cands.map(() => ''), {zero: true}), {maxTokens: 20});
  if (!ch) return {status: 'unreadable', at: 'F_choose'};
  if (ch.value === 0) return {status: 'no_analogy'};
  const tpl = cands[ch.value - 1];
  const map = await ask(ctx, 'F_map', {...base, program: tpl.shown, inputs: tpl.inputs.map(i => i.role).join('\n')}, t => {
    const got = new Map();
    for (const l of answerLines(t)) {
      const m = /^(x\d+)\s*(?:=|->|→|:)\s*(.+)$/i.exec(l);
      if (!m) continue;
      const x = m[1].toLowerCase();
      if (/^none\b/i.test(m[2].trim())) { got.set(x, null); continue; }
      const k = readRef(m[2], registry);
      if (k) got.set(x, k);
    }
    return tpl.inputs.every(i => got.has(i.x)) ? got : null;
  }, {maxTokens: 200});
  if (!map) return {status: 'unreadable', at: 'F_map'};
  if ([...map.value.values()].some(v => v === null)) return {status: 'missing', why: 'an input of the computation has no counterpart'};
  // Substitution: xK → the mapped vK, a percentage converted when the two numbers are written differently (structure: the flags).
  const sub = t => t.replace(/\bx(\d+)\b/g, (_, k) => {
    const i = tpl.inputs.find(z => z.x === `x${k}`), v = registry.find(r => r.index === map.value.get(`x${k}`));
    return i.percent === Boolean(v.percent) ? `v${v.index}` : i.percent ? `(v${v.index} / 100)` : `(v${v.index} * 100)`;
  });
  const lines = tpl.lines.map(l => ({name: l.name, text: sub(l.text)}));
  const shown = lines.map(l => `${l.name} = ${l.text.replace(/\bv(\d+)\b/g, (_, k) => registry.find(r => r.index === Number(k)).span)}`).join('\n');
  const ok = await ask(ctx, 'F_extra', {...base, program: shown}, readYesNo, {maxTokens: 10});
  if (!ok) return {status: 'unreadable', at: 'F_extra'};
  if (!ok.value) return {status: 'not_analogous'};
  const res = programResult(lines, registry, {message: item.question});
  if (!res.ok) return {status: 'rejected', why: res.violations.slice(0, 2).join('; ')};
  return {status: 'ok', exec: res.exec, program: res.program};
}
