/**
 * FOL (the LFM's output, parsed by ./parse.mjs) → SOP-IR, deterministically (owner decision 2026-10-03: the models write what they
 * were built for; WE translate). The IR is what SOP Lang can execute: ground facts, Horn rules with (strongly) negated literals,
 * named numeric values, and queries. What has no such reading is rejected with a reason, never approximated.
 *
 * Clausification (classical, structural):
 *   A ∧ B                     both, separately
 *   ∀x̄ (B → H)                one rule per head literal and per disjunct of B (B in disjunctive normal form; an existential in B
 *                             is a rule variable); H may be a conjunction, a nested implication (curried into the body) or a
 *                             universal (lifted); a disjunction or an existential in H is not Horn → rejected
 *   ∀x̄ (A ↔ B)                both directions
 *   ¬∃x̄ (L1 ∧ … ∧ Ln)          the constraint L1 ∧ … ∧ Ln-1 → ¬Ln
 *   ∃x̄ φ (outside any ∀)      φ with a fresh constant per variable (Skolem constant `sk1`, …)
 *   a ground literal          a fact; a literal with variables and no condition is rejected (an unrestricted universal)
 *   a rule whose head variable no positive body literal binds is rejected (unsafe)
 *
 * The agreed extension (only where FOL cannot say it; §5 of the proposal), by exact reserved names:
 *   Value(q, t)        the quantity q is the term t; t: a number, another quantity, or add/sub/mul/div/mod/min/max/ceil/floor/
 *                      round/abs of terms
 *   Ask(q)             (in a question) the value of q is asked
 *   Lt/Le/Gt/Ge/Eq(a, b) between numeric terms (in a question) a comparison is asked
 *   Before(a, b), After(a, b)   order of events: ordinary facts, with transitivity and After(a, b) ≡ Before(b, a) added by ./to-sop.mjs
 * Questions (an input unit that ends with `?`, structure): a ground literal → yes/no; ∃x (L1 ∧ … ∧ Ln) → which x; Ask/compare as
 * above; anything else is rejected as a question.
 */
export const ARITH = Object.freeze({add: '+', sub: '-', mul: '*', div: '/', mod: '%'});
export const MATH = Object.freeze(['min', 'max', 'ceil', 'floor', 'round', 'abs']);
export const COMPARE = Object.freeze({Lt: '<', Le: '<=', Gt: '>', Ge: '>=', Eq: '=='});
export const RESERVED = Object.freeze({value: 'Value', ask: 'Ask', before: 'Before', after: 'After'});

class Reject extends Error {}
const no = why => { throw new Reject(why); };
const isLit = n => n.type === 'atom' || (n.type === 'not' && n.a.type === 'atom');
const lit = n => (n.type === 'atom' ? {pred: n.pred, args: n.args, negated: false} : {pred: n.a.pred, args: n.a.args, negated: true});
const varsOf = l => l.args.flatMap(function walk(t) { return t.var ? [t.var] : t.fn ? t.args.flatMap(walk) : []; });

function substitute(node, v, term) {
  const t = x => (x.var === v ? term : x.fn ? {fn: x.fn, args: x.args.map(t)} : x);
  switch (node.type) {
    case 'atom': return {...node, args: node.args.map(t)};
    case 'not': return {type: 'not', a: substitute(node.a, v, term)};
    case 'forall': case 'exists': return node.v === v ? node : {type: node.type, v: node.v, a: substitute(node.a, v, term)};
    default: return {type: node.type, a: substitute(node.a, v, term), b: substitute(node.b, v, term)};
  }
}

/** Disjunctive normal form of a rule body: [[literal]] (existentials stripped: their variables are rule variables). */
function dnf(n) {
  if (isLit(n)) return [[lit(n)]];
  if (n.type === 'and') { const out = []; for (const x of dnf(n.a)) for (const y of dnf(n.b)) out.push([...x, ...y]); if (out.length > 16) no('the condition has too many cases'); return out; }
  if (n.type === 'or') return [...dnf(n.a), ...dnf(n.b)];
  if (n.type === 'exists') return dnf(n.a);
  if (n.type === 'not' && n.a.type === 'not') return dnf(n.a.a);
  return no(`a condition with ${n.type === 'forall' ? 'a universal' : n.type === 'not' ? 'a negated compound' : n.type.toUpperCase()} is not a Horn body`);
}

/** Head of a rule: {extra: [[literal]] (curried conditions), heads: [literal]}. */
function headOf(n) {
  if (isLit(n)) return {extra: [[]], heads: [lit(n)]};
  if (n.type === 'and') { const a = headOf(n.a), b = headOf(n.b); if (a.extra.length > 1 || b.extra.length > 1 || a.extra[0].length || b.extra[0].length) no('a conjunction of conditional conclusions'); return {extra: [[]], heads: [...a.heads, ...b.heads]}; }
  if (n.type === 'implies') { const h = headOf(n.b); const out = []; for (const x of dnf(n.a)) for (const y of h.extra) out.push([...x, ...y]); return {extra: out, heads: h.heads}; }
  if (n.type === 'forall') return headOf(n.a);
  if (n.type === 'not' && n.a.type === 'not') return headOf(n.a.a);
  return no(`a conclusion with ${n.type === 'exists' ? 'an existential' : n.type === 'not' ? 'a negated compound' : n.type.toUpperCase()} is not Horn`);
}

/** A safe rule: every variable of the head and of a negated condition is bound by a positive condition. */
function makeRule(when, then) {
  const bound = new Set(when.filter(l => !l.negated).flatMap(varsOf));
  const loose = varsOf(then).filter(v => !bound.has(v)).concat(when.filter(l => l.negated).flatMap(varsOf).filter(v => !bound.has(v)));
  if (loose.length) no(`unsafe rule: variable ${loose[0]} is bound by no positive condition`);
  if (!when.length) no('a rule without a condition');
  return {when, then};
}

function rulesOf(body, head) {
  const h = headOf(head), out = [];
  for (const b of dnf(body)) for (const extra of h.extra) for (const hl of h.heads) out.push(makeRule([...b, ...extra], hl));
  return out;
}

/** One formula (an AST of a statement) → {facts, rules, values, notes}; throws Reject. */
function statement(n, ctx, univ = false) {
  const out = {facts: [], rules: [], values: []};
  const add = r => { out.facts.push(...r.facts); out.rules.push(...r.rules); out.values.push(...r.values); };
  switch (n.type) {
    case 'forall': return statement(n.a, ctx, true);
    case 'exists': if (univ) no('an existential inside a universal (needs a Skolem function)'); return statement(substitute(n.a, n.v, {const: `sk${++ctx.skolem}`}), ctx, univ);
    case 'and': add(statement(n.a, ctx, univ)); add(statement(n.b, ctx, univ)); return out;
    case 'implies': out.rules.push(...rulesOf(n.a, n.b)); return out;
    case 'iff': out.rules.push(...rulesOf(n.a, n.b), ...rulesOf(n.b, n.a)); return out;
    case 'not':
      if (n.a.type === 'exists') {
        let b = n.a; while (b.type === 'exists') b = b.a;
        const ls = dnf(b);
        if (ls.length !== 1 || ls[0].length < 2) no('a negated existential that is not a conjunction of two or more literals');
        const last = ls[0].at(-1);
        out.rules.push(makeRule(ls[0].slice(0, -1), {...last, negated: !last.negated}));
        return out;
      }
      if (n.a.type === 'not') return statement(n.a.a, ctx, univ);
      if (n.a.type !== 'atom') return no(`NOT over ${n.a.type.toUpperCase()} is not a literal`);
    // falls through: a negated atom
    case 'atom': {
      const l = lit(n);
      if (l.pred === RESERVED.value && !l.negated) { out.values.push(valueOf(l)); return out; }
      if (varsOf(l).length) no('a statement about every thing without a condition');
      out.facts.push(l); return out;
    }
    default: return no(`${n.type.toUpperCase()} at the top of a statement is not Horn`);
  }
}

function valueOf(l) {
  if (l.args.length !== 2 || !l.args[0].const) no('Value needs a quantity name and a term');
  return {name: l.args[0].const, term: l.args[1]};
}

/** A question formula → a query; throws Reject. */
function question(n) {
  let f = n;
  if (isLit(f)) {
    const l = lit(f);
    if (l.pred === RESERVED.ask && l.args.length === 1 && l.args[0].const) return {kind: 'value', name: l.args[0].const};
    if (COMPARE[l.pred] && l.args.length === 2 && !l.negated) return {kind: 'compare', op: COMPARE[l.pred], a: l.args[0], b: l.args[1]};
    if (varsOf(l).length) no('a yes/no question about a literal with variables');
    return {kind: 'yesno', lit: l};
  }
  if (f.type === 'exists') {
    const vs = [];
    while (f.type === 'exists') { vs.push(f.v); f = f.a; }
    const ls = dnf(f);
    if (ls.length !== 1) no('a which-question with alternatives');
    return {kind: 'which', v: vs[0], lits: ls[0]};
  }
  return no(`a question of the form ${f.type.toUpperCase()} is not a query`);
}

/**
 * Units [{ast, question, source}] → SOP-IR {facts, rules, values, queries, rejected: [{source, why}], skolem}. Every unit is converted
 * on its own; a rejected unit is reported and the rest is kept.
 */
export function folToIr(units) {
  const ir = {facts: [], rules: [], values: [], queries: [], rejected: []}, ctx = {skolem: 0};
  for (const u of units) {
    try {
      if (u.question) ir.queries.push({...question(u.ast), source: u.source});
      else { const s = statement(u.ast, ctx); ir.facts.push(...s.facts); ir.rules.push(...s.rules); ir.values.push(...s.values); }
    } catch (error) {
      if (!(error instanceof Reject)) throw error;
      ir.rejected.push({source: u.source, why: error.message});
    }
  }
  ir.skolem = ctx.skolem;
  return ir;
}
