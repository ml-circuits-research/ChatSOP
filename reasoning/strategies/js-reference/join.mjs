/**
 * Nested-loop evaluation of an ordered conjunction of leaves over the evidence tables (deliberately naive: one pass per leaf,
 * no indexes beyond the key lookup of a ground atom). Every candidate examined costs one probe of the budget (`maxJoins`).
 *
 * Leaves: a positive atom (P), `not` (N), `absent` (no P; only over a closed predicate, checked at compile time),
 * `compare`, `compute`, `order`, `start_of`/`end_of` over the stored facts of the time view.
 */
import {isVarTerm, groundArgs, termIn, compareValues, orderValues, compute} from './values.mjs';

/** Extend `env` so that `args` equals `values`; null on a mismatch. */
export function unify(args, values, env) {
  if (args.length !== values.length) return null;
  let out = env;
  for (let k = 0; k < args.length; k++) {
    const a = args[k], v = values[k];
    if (isVarTerm(a)) {
      if (a.var in out) { if (out[a.var] !== v) return null; } else {
        if (out === env) out = {...env};
        out[a.var] = v;
      }
    } else if (a !== v) return null;
  }
  return out;
}

/** Generator of {env, prem}; `ctx` = {ev, stored, budget, notes}. */
export function* join(leaves, i, env, prem, ctx) {
  if (i === leaves.length) { yield {env, prem}; return; }
  const l = leaves[i];
  const {ev, budget} = ctx;
  switch (l.kind) {
    case 'atom': {
      if (l.mode === 'absent') {
        const g = groundArgs(l.args, env);
        budget.probe();
        if (!ev.get(false, l.p, g)) yield* join(leaves, i + 1, env, [...prem, {absent: {p: l.p, args: g}}], ctx);
        return;
      }
      const neg = l.mode === 'not';
      const g = groundArgs(l.args, env);
      if (g) {
        budget.probe();
        const n = ev.get(neg, l.p, g);
        if (n) yield* join(leaves, i + 1, env, [...prem, n], ctx);
        return;
      }
      for (const n of ev.list(neg, l.p)) {
        budget.probe();
        const e2 = unify(l.args, n.args, env);
        if (e2) yield* join(leaves, i + 1, e2, [...prem, n], ctx);
      }
      return;
    }
    case 'compare':
      if (compareValues(l.word, termIn(l.left, env), termIn(l.right, env))) yield* join(leaves, i + 1, env, prem, ctx);
      return;
    case 'compute': {
      const v = compute(l.word, termIn(l.left, env), termIn(l.right, env));
      if (v === undefined) { ctx.notes.add('arithmetic_undefined'); return; }
      if (l.out in env) { if (env[l.out] === v) yield* join(leaves, i + 1, env, prem, ctx); return; }
      yield* join(leaves, i + 1, {...env, [l.out]: v}, prem, ctx);
      return;
    }
    case 'order':
      if (orderValues(l.word, env[l.left], env[l.right])) yield* join(leaves, i + 1, env, prem, ctx);
      return;
    case 'timeof': {
      for (const f of ctx.stored.get(l.p) ?? []) {
        if (f.neg) continue;
        budget.probe();
        const e2 = unify(l.args, f.args, env);
        if (!e2) continue;
        const t = l.which === 'start_of' ? (f.valid?.fromText ?? 'beginning') : (f.valid?.toText ?? 'open');
        const e3 = l.out in e2 ? (e2[l.out] === t ? e2 : null) : {...e2, [l.out]: t};
        if (e3) yield* join(leaves, i + 1, e3, [...prem, ev.get(false, f.p, f.args)], ctx);
      }
      return;
    }
    default: throw new Error('unknown leaf ' + l.kind);
  }
}
