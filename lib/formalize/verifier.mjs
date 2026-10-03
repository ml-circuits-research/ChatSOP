/**
 * Cross-family verification of a formalization (coordinator decision 2026-10-02, after `medium` (DeepSeek) and `tiny`+F1 (Qwen) agreed
 * 22 of 22 times, all correct). Two expression-path programs from two model families are executed by the engines and compared on the
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
export function confirmedParts(goals, counts, values) {
  const parts = (goals ?? []).filter(g => COMPUTABLE.has(g.kind)), explain = (goals ?? []).filter(g => !COMPUTABLE.has(g.kind));
  const known = counts.filter(n => Number.isInteger(n) && n > 0);
  if (parts.length && known.includes(parts.length)) return {goals: [...parts, ...explain], source: 'list'};
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
    const parts = confirmedParts(goals, counts, answersOf(state[0].profile) ?? answersOf(state[1].profile));
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
  // A structurally different third candidate ({name, sop}: an executed circuit, e.g. the method tree): reported apart, as the rule
  // "verified when the two families agree, OR when the third agrees with one of them and that one meets its obligations".
  let withThird = null;
  if (third?.sop) {
    const profile = await candidateProfile({kind: 'tree', sop: third.sop}, {registry, execute, maps});
    const agrees = state.map((s, i) => (profilesAgree(profile, s.profile) && !ev.records[i].blocking ? s.name : null)).filter(Boolean);
    withThird = {name: third.name, answers: answersOf(profile), agrees_with: agrees, status: ev.ok || agrees.length ? 'verified' : 'unresolved',
      answer: ev.ok ? answersOf(state[0].profile) : agrees.length ? answersOf(state[state.findIndex(s => s.name === agrees[0])].profile) : []};
  }
  const obligations = Object.fromEntries(state.map((s, i) => [s.name, ev.records[i]]));
  const formalized = Math.min(...ev.records.map(r => r.formalized));
  const open = [...new Set(ev.records.flatMap(r => r.unresolved))];
  return {status: ev.ok ? 'verified' : 'unresolved', answers: ev.ok ? answersOf(state[0].profile) : [], stage, agreed: ev.agreed, parts: ev.parts.source,
    obligations, formalized, open, reasked, ...(withThird ? {with_third: withThird} : {}), candidates: Object.fromEntries(state.map(s => [s.name, {status: s.result?.status ?? null, answers: answersOf(s.profile)}]))};
}
