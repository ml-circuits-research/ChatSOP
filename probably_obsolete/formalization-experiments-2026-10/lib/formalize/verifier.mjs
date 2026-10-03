/**
 * Cross-family verification of a formalization: an EVALUATION REFERENCE only since the owner's course correction of 2026-10-03 (the 4B
 * formalizes; larger tiers judge where it is right and never vote; the decision rule is `verifyTinyPaths` below). Two expression-path programs from two model families are executed by the engines and compared on the
 * problem's numbers and on perturbations; an answer is VERIFIED only when they agree and both meet their obligations. Otherwise:
 *   (a) a candidate with an unmet obligation is asked again, with the failing obligation named, on the next tier of its ladder
 *       (tiny → small, medium → good), once;
 *   (b) still no verified agreement → `unresolved`, reported with `formalized` (%) and the open obligations. Never a guess.
 * Asked parts count only when two signals agree: the parts list (one closed question) and a program's number of answers, or the two
 * programs' numbers of answers; with no agreement the parts are not checked (reported as `parts: unconfirmed`).
 * Everything here is structure over the candidates' results; the model calls and the engines are injected.
 */
import {candidateProfile, profilesAgree, perturbations} from './dual-check.mjs';
import {obligationsOf} from './obligations.mjs';

const COMPUTABLE = new Set(['number', 'yes or no', 'which thing']);
const kindOf = v => typeof v === 'boolean' ? 'yes or no' : typeof v === 'number' ? 'number' : 'which thing';
const answersOf = profile => (profile ? profile[0].filter(q => q.values.length).map(q => q.values[0]) : null);

/**
 * The asked parts both signals support: {goals, source} where source is `list` (the list agrees with a program's answer count),
 * `programs` (the two programs agree on the count; the parts are then the programs' answers, kinds from the values), or `unconfirmed`.
 */
export function confirmedParts(goals, counts, values, others = null) {
  const parts = (goals ?? []).filter(g => COMPUTABLE.has(g.kind)), explain = (goals ?? []).filter(g => !COMPUTABLE.has(g.kind));
  const known = counts.filter(n => Number.isInteger(n) && n > 0);
  // A part's kind follows the programs when both answer it with the same kind against the list (two signals against one).
  const kinds = (i) => (others ?? []).map(v => (v && v[i] !== undefined && v[i] !== null ? kindOf(v[i]) : null));
  const fixed = parts.map((g, i) => { const k = kinds(i); return k.length === 2 && k[0] && k[0] === k[1] && k[0] !== g.kind ? {...g, kind: k[0], sign: 'any', kind_from: 'programs'} : g; });
  if (parts.length && known.includes(parts.length)) return {goals: [...fixed, ...explain], source: 'list'};
  if (known.length === 2 && known[0] === known[1]) return {goals: [...(values ?? []).slice(0, known[0]).map((v, i) => ({k: i + 1, what: `asked value ${i + 1}`, kind: kindOf(v), sign: 'any'})), ...explain], source: 'programs'};
  return {goals: explain.length ? explain : null, source: 'unconfirmed'};
}

/**
 * `candidates`: [{name, family, run(hint) → expression result, next: {name, run(hint)} | null}] (exactly two, of different families);
 * `goals`: the parts list or null; `execute(sop, numbers)`. Returns {status: 'verified'|'unresolved', answers, stage, agreed,
 * parts, obligations: {name: record}, formalized, open, reasked: [names], candidates: {name: {status, answers}}}.
 */
export async function verifyCrossFamily({candidates, goals, registry, execute, seed = 'verify', k = 3, third = null}) {
  const maps = perturbations(registry, {k, seed});
  const state = [];
  for (const c of candidates) { const result = await c.run(null); state.push({c, name: c.name, result, profile: await candidateProfile({kind: 'expr', result}, {registry, execute, maps})}); }
  const evaluate = () => {
    const counts = state.map(s => answersOf(s.profile)?.length ?? null);
    const parts = confirmedParts(goals, counts, answersOf(state[0].profile) ?? answersOf(state[1].profile), state.map(s => answersOf(s.profile)));
    const records = state.map(s => obligationsOf({expr: s.result, values: answersOf(s.profile) ?? [], goals: parts.goals}));
    const agreed = profilesAgree(state[0].profile, state[1].profile);
    return {parts, records, agreed, ok: agreed && records.every(r => !r.blocking)};
  };
  let ev = evaluate(), stage = 'first';
  const reasked = [];
  if (!ev.ok) {
    // (a) every candidate with an unmet obligation is asked again on its next tier, with the failing obligation named.
    for (const [i, s] of state.entries()) {
      const r = ev.records[i];
      if (!r.blocking || !s.c.next || s.result?.status === 'no_numbers') continue;
      const result = await s.c.next.run(r.question);
      Object.assign(s, {name: s.c.next.name, result, profile: await candidateProfile({kind: 'expr', result}, {registry, execute, maps})});
      reasked.push(s.name);
    }
    if (reasked.length) { ev = evaluate(); stage = 'reask'; }
  }
  // A structurally different candidate ({name, sop}: an executed circuit, e.g. the method tree) counts only when BOTH families agree
  // with it: it can then stand in for obligations the agreeing pair did not meet (reported apart, never in `status`).
  let withThird = null;
  if (third?.sop) {
    const profile = await candidateProfile({kind: 'tree', sop: third.sop}, {registry, execute, maps});
    const both = state.every(s => profilesAgree(profile, s.profile));
    withThird = {name: third.name, answers: answersOf(profile), agrees_with_both: both, status: ev.ok || both ? 'verified' : 'unresolved',
      answer: ev.ok || both ? answersOf(state[0].profile) : []};
  }
  const obligations = Object.fromEntries(state.map((s, i) => [s.name, ev.records[i]]));
  const formalized = Math.min(...ev.records.map(r => r.formalized));
  const open = [...new Set(ev.records.flatMap(r => r.unresolved))];
  return {status: ev.ok ? 'verified' : 'unresolved', answers: ev.ok ? answersOf(state[0].profile) : [], stage, agreed: ev.agreed, parts: ev.parts.source,
    obligations, formalized, open, reasked, ...(withThird ? {with_third: withThird} : {}), candidates: Object.fromEntries(state.map(s => [s.name, {status: s.result?.status ?? null, answers: answersOf(s.profile)}]))};
}

/**
 * The tiny-only verifier (owner, 2026-10-03: the 4B formalizes; larger tiers only evaluate). Two independent formalizations, both
 * answered by tiny through different question sets or representations, must agree on the problem's numbers and on perturbations:
 *   program  the expression path ({run(hint)} → an expressionFormalize result; F1 exemplars by default);
 *   tree     the step-by-step question tree's circuit ({sop} or null);
 *   third    a third, differently structured tiny path, asked only when the first two do not verify (async () → {name, sop} | null),
 *            e.g. the method tree filled by tiny; accepted only when it agrees with one of the two and that one meets its obligations.
 * Order: (1) program and tree agree and both meet their obligations → verified; (2) the program's first failed obligation is asked
 * again to tiny (the same tier: no larger model decides) → re-check; (3) the third path; (4) unresolved, never a guess.
 * The tree's obligations are the same checks on its answer values (parts, kinds, signs).
 */
export async function verifyTinyPaths({program, tree = null, third = null, goals, registry, execute, seed = 'tiny', k = 3}) {
  const maps = perturbations(registry, {k, seed});
  const treeAsExpr = {status: 'ok', analysis: {violations: []}};
  let prog = await program.run(null);
  let p1 = await candidateProfile({kind: 'expr', result: prog}, {registry, execute, maps});
  const p2 = tree?.sop ? await candidateProfile({kind: 'tree', sop: tree.sop}, {registry, execute, maps}) : null;
  const evaluate = () => {
    const parts = confirmedParts(goals, [answersOf(p1)?.length ?? null, answersOf(p2)?.length ?? null], answersOf(p1) ?? answersOf(p2), [answersOf(p1), answersOf(p2)]);
    const r1 = obligationsOf({expr: prog, values: answersOf(p1) ?? [], goals: parts.goals});
    const r2 = p2 ? obligationsOf({expr: treeAsExpr, values: answersOf(p2) ?? [], goals: parts.goals}) : null;
    const agreed = Boolean(p1 && p2 && profilesAgree(p1, p2));
    return {parts, r1, r2, agreed, ok: agreed && !r1.blocking && !r2.blocking};
  };
  let ev = evaluate(), stage = 'first', answers = ev.ok ? answersOf(p1) : null, reasked = false, thirdInfo = null;
  if (!ev.ok && ev.r1.blocking && ev.r1.question && prog?.status === 'ok') {
    reasked = true;
    prog = await program.run(ev.r1.question);
    p1 = await candidateProfile({kind: 'expr', result: prog}, {registry, execute, maps});
    ev = evaluate();
    if (ev.ok) { stage = 'reask'; answers = answersOf(p1); }
  }
  if (!answers && third) {
    const t = await third();
    const p3 = t?.sop ? await candidateProfile({kind: 'tree', sop: t.sop}, {registry, execute, maps}) : null;
    const r3 = p3 ? obligationsOf({expr: treeAsExpr, values: answersOf(p3) ?? [], goals: ev.parts.goals}) : null;
    const withP1 = p3 && p1 && profilesAgree(p3, p1) && !ev.r1.blocking && !r3.blocking;
    const withP2 = p3 && p2 && profilesAgree(p3, p2) && !ev.r2?.blocking && !r3.blocking;
    thirdInfo = {name: t?.name ?? 'third', has_circuit: Boolean(p3), answers: answersOf(p3), agrees_with: [withP1 ? 'program' : null, withP2 ? 'tree' : null].filter(Boolean)};
    if (withP1 || withP2) { stage = 'third'; answers = answersOf(withP1 ? p1 : p2); }
  }
  const records = [ev.r1, ev.r2].filter(Boolean);
  return {status: answers ? 'verified' : 'unresolved', answers: answers ?? [], stage, agreed: ev.agreed, parts: ev.parts.source, reasked,
    formalized: Math.min(...records.map(r => r.formalized)), open: [...new Set(records.flatMap(r => r.unresolved))], ...(thirdInfo ? {third: thirdInfo} : {}),
    candidates: {program: {status: prog?.status ?? null, answers: answersOf(p1)}, tree: {status: tree?.sop ? 'ok' : 'none', answers: answersOf(p2)}}};
}
