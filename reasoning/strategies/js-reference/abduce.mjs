/**
 * Abduction: ALL inclusion-minimal explanations of an observation (not only the cheapest).
 *
 * A candidate is a `hypothesis` wire (its `holds`/`assume` atoms). An explanation is a set of candidates whose atoms, added to the
 * facts, make the observation (the query's `where`) hold. Subsets are tried by increasing size; a superset of an explanation already
 * found is skipped, so every returned set is minimal under inclusion. Explanations are hypotheses, never facts. More than
 * `maxHypotheses` candidates is `budget_exhausted` (reason `hypotheses`), never a silently shortened search.
 */
import {saturate} from './engine.mjs';
import {evaluatePart, readBudget} from './query.mjs';
import {atomText} from './values.mjs';
import {BudgetStop} from './budget.mjs';

function* subsetsOfSize(n, k, start = 0, chosen = []) {
  if (chosen.length === k) { yield chosen; return; }
  for (let i = start; i < n; i++) yield* subsetsOfSize(n, k, i + 1, [...chosen, i]);
}

export function abduce({program, facts, qp, budget, limit = Infinity}) {
  const cands = program.hypotheses;
  if (cands.length > budget.limits.maxHypotheses) return {status: 'budget_exhausted', complete: false, reason: 'hypotheses'};
  const ctx = (ev, notes) => ({ev, stored: new Map(), budget: readBudget(budget), notes});
  const holds = subset => {
    const extra = subset.flatMap(i => cands[i].atoms.map(a => ({neg: a.neg, p: a.p, args: a.args, claim: {id: cands[i].id, version: 1}, status: 'supposed', speaker: null, valid: null})));
    const closure = saturate(program, [...facts, ...extra], budget.child());
    if (closure.exhausted) throw new BudgetStop(closure.exhausted.key);
    const out = evaluatePart(qp, closure.ev, ctx(closure.ev, new Set()));
    return out.rows.length > 0 && ['supported', 'both'].includes(out.status);
  };
  const found = [];
  try {
    for (let k = 0; k <= cands.length; k++) {
      for (const subset of subsetsOfSize(cands.length, k)) {
        budget.count('maxCandidates');
        if (found.some(f => f.every(i => subset.includes(i)))) continue;
        if (holds(subset)) found.push(subset);
      }
      if (k === 0 && found.length) break; // already true without any hypothesis
    }
  } catch (e) {
    if (e instanceof BudgetStop) return {status: 'budget_exhausted', complete: false, reason: e.reason};
    throw e;
  }
  const explanations = found.map(s => ({hypotheses: s.map(i => cands[i].id), atoms: s.flatMap(i => cands[i].atoms.map(a => atomText(a.neg, a.p, a.args))), cost: s.reduce((c, i) => c + cands[i].cost, 0)}))
    .sort((a, b) => a.cost - b.cost || a.atoms.length - b.atoms.length || (a.atoms.join() < b.atoms.join() ? -1 : 1));
  if (!explanations.length) return {status: 'unknown', complete: true, reason: 'no_explanation', hypotheses: [], explanations: []};
  const shown = explanations.slice(0, limit);
  return {status: 'hypotheses', complete: shown.length === explanations.length, hypotheses: shown.map(e => e.atoms), explanations: shown, ...(shown.length < explanations.length ? {truncated: true} : {})};
}
