/**
 * Path C, equations (declarative, Pólya): the unknowns → the data with their roles → the conditions as equations or inequalities
 * between data and unknowns → what is asked (value, largest, smallest, check, possible) → on no solution or several solutions, one
 * question for the corrected conditions. The solver is deterministic algebra over the conditions' syntax trees:
 *   propagation  an equation with exactly one unsolved unknown, occurring once, is solved for it by inverting the operations on the
 *                path to it (a session rule `unknown = expression` over the data and solved unknowns);
 *   bounds       largest/smallest of an unknown: every inequality in that unknown alone is isolated into a bound (the direction of a
 *                multiplication or division by a negative value flips, decided on the numbers being compiled) and the bound is
 *                rounded to a whole number;
 *   residual     unknowns left in a system of equations are solved by the integer constraint wire (`constraint`, finite domains from
 *                the data's magnitude), when the system is small enough; otherwise the path gives no result.
 * SOP: the solved lines are lowered to session rules (lib/formalize/expression-program.mjs), the residual system is one `constraint`
 * wire. Everything is structure over the model's expressions; nothing reads the problem's words.
 */
import {parseExpression, evaluateExpression} from '../../../sop/expression.mjs';
import {ask, numbersBlock, answerLines, ident} from './common.mjs';
import {programResult} from './program.mjs';
import {constraints} from '../method-library/primitives.mjs';

const REL = /(<=|>=|==|=|<|>)/;
const FLIP = {'<': '>', '<=': '>=', '>': '<', '>=': '<=', '=': '='};

/** A condition line → {left, op, right} (texts), or null. */
function readCondition(line, names) {
  const s = line.replace(/^\s*(?:c\d+\s*[:.)]\s*)/i, '').replace(/[.;]\s*$/, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').trim();
  const parts = s.split(REL);
  if (parts.length !== 3) return null;
  const [left, op, right] = parts.map(x => x.trim());
  const norm = op === '==' ? '=' : op;
  for (const side of [left, right]) {
    try { check(parseExpression(side), names); } catch { return null; }
  }
  return {left, op: norm, right, text: `${left} ${norm} ${right}`};
}

/** Only numbers, vK, known unknown names, + - * / and parentheses. */
function check(n, names) {
  if (n.type === 'literal') { if (typeof n.value !== 'number') throw new Error('literal'); return; }
  if (n.type === 'name') { if (!/^v\d+$/.test(n.value) && !names.has(n.value)) throw new Error(`name ${n.value}`); return; }
  if (n.type === 'unary' && n.op === '-') return check(n.arg, names);
  if (n.type === 'binary' && ['+', '-', '*', '/'].includes(n.op)) { check(n.left, names); check(n.right, names); return; }
  throw new Error('construct');
}

const unknownsIn = (n, names, out = new Set()) => {
  if (n.type === 'name' && names.has(n.value)) out.add(n.value);
  for (const k of ['arg', 'left', 'right']) if (n[k]) unknownsIn(n[k], names, out);
  return out;
};
const countOf = (n, name) => (n.type === 'name' && n.value === name ? 1 : 0) + ['arg', 'left', 'right'].reduce((s, k) => s + (n[k] ? countOf(n[k], name) : 0), 0);
const text = n => n.type === 'literal' ? String(n.value) : n.type === 'name' ? n.value : n.type === 'unary' ? `(-${text(n.arg)})` : `(${text(n.left)} ${n.op} ${text(n.right)})`;

/**
 * Isolates `name` (occurring once in `n`) in `n op other` → {expr: text, op, flips: [texts whose sign flips the relation if negative]}.
 */
function isolate(n, name, other, op, flips = []) {
  if (n.type === 'name' && n.value === name) return {expr: other, op, flips};
  if (n.type === 'unary') return isolate(n.arg, name, `(-(${other}))`, FLIP[op], flips);
  const inLeft = countOf(n.left, name) > 0, a = text(n.left), b = text(n.right);
  switch (n.op) {
    case '+': return inLeft ? isolate(n.left, name, `(${other}) - ${b}`, op, flips) : isolate(n.right, name, `(${other}) - ${a}`, op, flips);
    case '-': return inLeft ? isolate(n.left, name, `(${other}) + ${b}`, op, flips) : isolate(n.right, name, `${a} - (${other})`, FLIP[op], flips);
    case '*': return inLeft ? isolate(n.left, name, `(${other}) / ${b}`, op, [...flips, b]) : isolate(n.right, name, `(${other}) / ${a}`, op, [...flips, a]);
    case '/': return inLeft ? isolate(n.left, name, `(${other}) * ${b}`, op, [...flips, b]) : isolate(n.right, name, `${a} / (${other})`, op, [...flips, a, `(${other})`]);
    default: throw new Error('not invertible');
  }
}

/** A tree's text with solved unknowns replaced by their rule names (u_<name>). */
const subst = (n, solved) => n.type === 'name' && solved.has(n.value) ? `u_${n.value}` : n.type === 'literal' || n.type === 'name' ? text(n) : n.type === 'unary' ? `(-${subst(n.arg, solved)})` : `(${subst(n.left, solved)} ${n.op} ${subst(n.right, solved)})`;

/** Value of a text over registry values and solved rule values `env` (for the sign of a flip factor while compiling). */
const valueOf = (t, env) => {
  const toRef = n => { if (n.type === 'name') return {type: 'ref', value: n.value}; for (const k of ['arg', 'left', 'right']) if (n[k]) n[k] = toRef(n[k]); return n; };
  return evaluateExpression(toRef(parseExpression(t)), {refs: env}).value;
};

/**
 * Solves the conditions for the asked items on numbers `values`. Returns {lines} ([{name, text}] for the session rules, answers
 * answer1..) or {residual: true, why} (a system left for the constraint wire) or {why} (no solution by algebra).
 */
export function solve(conds, asked, names, registry, values, whole = new Map()) {
  const env = Object.create(null);
  for (const [k, v] of values) env[`v${k}`] = registry.find(r => r.index === k)?.percent ? v / 100 : v;
  const solved = new Map(), order = [], pending = new Map();
  const trees = conds.map(c => ({...c, l: parseExpression(c.left), r: parseExpression(c.right)}));
  const open = t => [...unknownsIn(t, names)];
  const eqs = trees.filter(c => c.op === '=');
  // A tree's text: solved unknowns as their rule names, unknowns eliminated by substitution inlined (Gaussian elimination by text).
  const sub = (n, depth = 0) => n.type === 'name' && solved.has(n.value) ? `u_${n.value}` : n.type === 'name' && pending.has(n.value) && depth < 12 ? `(${sub(parseExpression(pending.get(n.value)), depth + 1)})`
    : n.type === 'literal' || n.type === 'name' ? text(n) : n.type === 'unary' ? `(-${sub(n.arg, depth)})` : `(${sub(n.left, depth)} ${n.op} ${sub(n.right, depth)})`;
  const setSolved = (u, expr) => {
    const w = whole.get(u);
    solved.set(u, w ? `Math.${w === 'up' ? 'ceil' : 'floor'}(${expr})` : expr); order.push(u); pending.delete(u);
    try { env[`u_${u}`] = valueOf(solved.get(u), env); } catch { /* evaluated again when lowered */ }
  };
  const replaced = (t, u, by) => sub(parseExpression(t.replace(new RegExp(`\\b${u}\\b`, 'g'), `(${by})`)));
  for (let changed = true; changed;) {
    changed = false;
    for (const c of eqs) {
      if (c.used) continue;
      const tt = `(${sub(c.l)}) - (${sub(c.r)})`, t = parseExpression(tt);
      const left = open(t);
      if (!left.length) { c.used = true; continue; }
      if (left.length !== 1) continue;
      const u = left[0];
      if (countOf(t, u) === 1) {
        try { setSolved(u, isolate(t, u, '0', '=').expr); c.used = true; changed = true; } catch { /* not invertible */ }
        continue;
      }
      // The unknown occurs several times: solved when the equation is linear in it on these numbers (f(0), f(1), f(2) on a line),
      // as u = -f(0) / (f(1) - f(0)), written over the data so the rules compute it.
      try {
        const f0 = replaced(tt, u, '0'), f1 = replaced(tt, u, '1'), f2 = replaced(tt, u, '2');
        const [a0, a1, a2] = [f0, f1, f2].map(x => valueOf(x, env));
        if (Math.abs(a2 - 2 * a1 + a0) <= 1e-9 * Math.max(1, Math.abs(a0), Math.abs(a1)) && Math.abs(a1 - a0) > 1e-12) { setSolved(u, `(0 - (${f0})) / ((${f1}) - (${f0}))`); c.used = true; changed = true; }
      } catch { /* not linear or not evaluable */ }
    }
    for (const [u, e] of [...pending]) { const t = parseExpression(sub(parseExpression(e))); if (!open(t).length) { setSolved(u, sub(parseExpression(e))); changed = true; } }
    if (changed) continue;
    // Elimination: an equation with several unknowns, one of which occurs once, defines that one in terms of the others.
    for (const c of eqs) {
      if (c.used) continue;
      const t = parseExpression(`(${sub(c.l)}) - (${sub(c.r)})`);
      const u = open(t).find(x => countOf(t, x) === 1 && !pending.has(x));
      if (!u) continue;
      try { pending.set(u, isolate(t, u, '0', '=').expr); c.used = true; changed = true; break; } catch { /* next */ }
    }
  }
  const answers = [];
  for (let a of asked) {
    a = {...a};
    if (a.kind === 'value' && !solved.has(a.name)) {
      // The value of an unknown that only inequalities bound is the bound itself (Pólya's selection criterion implied): lower bounds
      // only → the smallest value, upper bounds only → the largest; rounded to a whole number only when the unknown counts whole things.
      const sides = trees.filter(x => x.op !== '=').map(c => { const t = parseExpression(`(${sub(c.l)}) - (${sub(c.r)})`); const us = open(t); return us.length === 1 && us[0] === a.name ? c : null; }).filter(Boolean);
      if (!sides.length) return {residual: true, why: `${a.name} is not determined by single equations`};
      a.kind = 'bounded';
    }
    if (a.kind === 'value') {
      answers.push(`u_${a.name}`);
    } else if (a.kind === 'largest' || a.kind === 'smallest' || a.kind === 'bounded') {
      if (solved.has(a.name)) { answers.push(a.kind === 'largest' ? `Math.floor(u_${a.name})` : `Math.ceil(u_${a.name})`); continue; }
      const bounds = [];
      for (const c of trees.filter(x => x.op !== '=')) {
        const t = parseExpression(`(${sub(c.l)}) - (${sub(c.r)})`);
        const us = open(t);
        if (us.length !== 1 || us[0] !== a.name || countOf(t, a.name) !== 1) continue;
        let iso;
        try { iso = isolate(t, a.name, '0', c.op); } catch { continue; }
        let op = iso.op, bad = false;
        for (const f of iso.flips) { let v; try { v = valueOf(f, env); } catch { bad = true; break; } if (v < 0) op = FLIP[op]; if (v === 0) bad = true; }
        if (!bad) bounds.push({op, expr: iso.expr});
      }
      const want = a.kind === 'bounded' ? (bounds.some(b => ['>', '>='].includes(b.op)) && !bounds.some(b => ['<', '<='].includes(b.op)) ? 'smallest' : !bounds.some(b => ['>', '>='].includes(b.op)) ? 'largest' : null) : a.kind;
      if (!want) return {why: `${a.name} has bounds on both sides; the question must say largest or smallest`};
      if (a.kind === 'bounded' && !whole.has(a.name)) {
        const side0 = bounds.filter(b => (want === 'largest' ? ['<', '<='] : ['>', '>=']).includes(b.op));
        answers.push(side0.length === 1 ? side0[0].expr : `Math.${want === 'largest' ? 'min' : 'max'}(${side0.map(b => b.expr).join(', ')})`);
        continue;
      }
      a = {...a, kind: want};
      const side = bounds.filter(b => (a.kind === 'largest' ? ['<', '<='] : ['>', '>=']).includes(b.op));
      if (!side.length) return {why: `no ${a.kind === 'largest' ? 'upper' : 'lower'} bound for ${a.name}`};
      // A strict bound excludes the bound itself: x < b → the largest whole x is ceil(b) - 1.
      const each = side.map(b => a.kind === 'largest' ? (b.op === '<' ? `(Math.ceil(${b.expr}) - 1)` : `Math.floor(${b.expr})`) : (b.op === '>' ? `(Math.floor(${b.expr}) + 1)` : `Math.ceil(${b.expr})`));
      answers.push(each.length === 1 ? each[0] : `Math.${a.kind === 'largest' ? 'min' : 'max'}(${each.join(', ')})`);
    } else if (a.kind === 'check') {
      const l = sub(parseExpression(a.cond.left)), r = sub(parseExpression(a.cond.right));
      if (open(parseExpression(`${l} - ${r}`)).length) return {residual: true, why: 'the checked relation has unsolved unknowns'};
      answers.push(`${l} ${a.cond.op === '=' ? '==' : a.cond.op} ${r}`);
    } else return {residual: true, why: 'possible'};
  }
  return {lines: [...order.map(n => ({name: `u_${n}`, text: solved.get(n)})), ...answers.map((t, i) => ({name: `answer${i + 1}`, text: t}))]};
}

/** The residual integer system as a constraint frame (data numbers substituted, decimals cleared by scaling each condition). */
function residualFrame(conds, asked, names, registry, values) {
  const used = [...names];
  const ints = [...values].filter(([k]) => !registry.find(r => r.index === k)?.percent).map(([, v]) => Math.abs(v));
  const top = Math.max(10, ...ints.filter(Number.isInteger));
  const per = Math.floor(Math.pow(90_000, 1 / used.length));
  if (per < 4) return null;
  const max = Math.min(top, per);
  const words = {'+': 'plus', '-': 'minus', '*': 'times', '/': 'divided_by'};
  const lin = (n) => n.type === 'literal' ? String(n.value) : n.type === 'name' ? (/^v\d+$/.test(n.value) ? String(values.get(Number(n.value.slice(1)))) : `?${n.value}`) : n.type === 'unary' ? `0 minus ${lin(n.arg)}` : `${lin(n.left)} ${words[n.op]} ${lin(n.right)}`;
  const req = [];
  for (const c of conds) {
    const l = parseExpression(c.left), r = parseExpression(c.right);
    const s = `${lin(l)} ${{'=': 'equal', '<': 'below', '<=': 'at_most', '>': 'above', '>=': 'at_least'}[c.op]} ${lin(r)}`;
    if (/\d\.\d|divided_by/.test(s)) return null;
    req.push(s);
  }
  const selectNames = asked.filter(a => a.kind === 'value').map(a => `?${a.name}`);
  return {variables: used.map(n => ({name: `?${n}`, min: 0, max})), require: req, task: 'possible', select: selectNames, possible: asked.some(a => a.kind === 'possible')};
}

export async function pathC({item, registry, ctx}) {
  const base = {problem: item.question, numbers: numbersBlock(registry)};
  const u = await ask(ctx, 'C_unknowns', base, t => {
    const out = answerLines(t).map(l => /^([A-Za-z_][\w ]{0,40}?)\s*(?:[:=-]\s*(.+?))?\s*(?:\|\s*whole\s*(up|down)?\s*)?$/i.exec(l)).filter(Boolean)
      .map(m => ({name: ident(m[1]), what: (m[2] ?? m[1]).slice(0, 100), whole: m[3]?.toLowerCase() ?? (/\|\s*whole/i.test(m[0]) ? 'up' : null)})).filter(x => x.name && !/^v\d+$/.test(x.name));
    return out.length ? out.slice(0, 10) : null;
  }, {maxTokens: 300});
  if (!u) return {status: 'unreadable', at: 'C_unknowns'};
  const names = new Set(u.value.map(x => x.name));
  const whole = new Map(u.value.filter(x => x.whole).map(x => [x.name, x.whole]));
  const unknowns = u.value.map(x => `${x.name}: ${x.what}${x.whole ? ` | whole ${x.whole}` : ''}`).join('\n');
  let data = '(no numbers)';
  if (registry.length) {
    const d = await ask(ctx, 'C_data', {...base, unknowns}, t => {
      const ls = answerLines(t).filter(l => /^v\d+\s*[:=-]/i.test(l));
      return ls.length ? ls.join('\n') : null;
    }, {maxTokens: 400});
    if (!d) return {status: 'unreadable', at: 'C_data'};
    data = d.value;
  }
  const condReader = t => { const cs = answerLines(t).map(l => readCondition(l, names)).filter(Boolean); return cs.length ? cs.slice(0, 16) : null; };
  const c = await ask(ctx, 'C_conditions', {...base, unknowns, data}, condReader, {maxTokens: 500});
  if (!c) return {status: 'unreadable', at: 'C_conditions'};
  let conds = c.value;
  const s = await ask(ctx, 'C_select', {...base, unknowns, conditions: conds.map(x => x.text).join('\n')}, t => {
    const out = [];
    for (const l of answerLines(t)) {
      let m;
      if ((m = /^(value|largest|smallest)\s+(?:of\s+)?([A-Za-z_]\w*)/i.exec(l)) && names.has(ident(m[2]))) out.push({kind: m[1].toLowerCase(), name: ident(m[2])});
      else if ((m = /^check\s+(.+)$/i.exec(l))) { const cond = readCondition(m[1], names); if (cond) out.push({kind: 'check', cond}); }
      else if (/^possible\b/i.test(l)) out.push({kind: 'possible'});
    }
    return out.length ? out.slice(0, 3) : null;
  }, {maxTokens: 150});
  if (!s) return {status: 'unreadable', at: 'C_select'};
  const asked = s.value;
  const compile = async (cs, values) => {
    const sol = solve(cs, asked, names, registry, values, whole);
    if (sol.lines) return {kind: 'rules', lines: sol.lines};
    if (!sol.residual) return {kind: 'fail', why: sol.why};
    const frame = residualFrame(cs, asked, names, registry, values);
    if (!frame) return {kind: 'fail', why: `${sol.why}; the system is not a small integer system`};
    return {kind: 'csp', frame};
  };
  const runCsp = async frame => {
    if (frame.possible) { const r = await constraints({variables: frame.variables, require: frame.require, task: 'possible'}); return r.kind === 'yesno' ? {answers: [r.value]} : {fail: r.detail ?? r.kind}; }
    const r = await constraints({variables: frame.variables, require: frame.require, task: 'possible', select: frame.select});
    if (r.kind === 'assignment') return {answers: frame.select.map(n => r.value[n])};
    return {fail: r.kind === 'contradiction' ? 'no solution' : r.kind === 'undetermined' ? 'several solutions' : r.detail ?? r.kind, outcome: r.kind};
  };
  const orig = new Map(registry.map(v => [v.index, v.value]));
  for (let round = 0; round < 2; round++) {
    const first = await compile(conds, orig);
    let outcome = null;
    if (first.kind === 'rules') {
      const res = programResult(first.lines, registry, {message: item.question});
      if (res.ok) {
        const exec = async values => {
          const again = await compile(conds, values);
          if (again.kind !== 'rules') return null;
          const r = programResult(again.lines, registry, {message: item.question});
          if (!r.ok) return null;
          return r.exec(values);
        };
        const got = await exec(orig);
        if (got) return {status: 'ok', exec, program: res.program, solver: 'rules'};
        outcome = 'no value (a division by zero or an undefined step)';
      } else outcome = `conditions that do not compute (${res.violations[0]})`;
    } else if (first.kind === 'csp') {
      const r = await runCsp(first.frame);
      if (r.answers) {
        const exec = async values => { const f = await compile(conds, values); if (f.kind !== 'csp') return null; const x = await runCsp(f.frame); return x.answers ?? null; };
        return {status: 'ok', exec, solver: 'constraint'};
      }
      outcome = r.outcome === 'contradiction' ? 'no solution' : r.outcome === 'undetermined' ? 'several solutions' : `no answer (${r.fail})`;
    } else outcome = `no answer (${first.why})`;
    if (round === 1) return {status: 'no_solution', why: outcome};
    const f = await ask(ctx, 'C_fix', {...base, unknowns, conditions: conds.map(x => x.text).join('\n'), outcome}, condReader, {maxTokens: 500});
    if (!f) return {status: 'unreadable', at: 'C_fix'};
    conds = f.value;
  }
  return {status: 'no_solution'};
}
