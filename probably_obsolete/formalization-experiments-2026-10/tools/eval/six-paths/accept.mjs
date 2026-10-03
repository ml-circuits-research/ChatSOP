/**
 * Acceptance with the direct answer Z (owner, 2026-10-03):
 *   (a) Z and at least one symbolic path agree on the problem's numbers, the symbolic path executing on every perturbation: accepted,
 *       the symbolic circuit is the proof (a yes/no that no perturbation moves needs Z plus two symbolic paths: run.mjs `need`);
 *   (b) two symbolic paths agree (run.mjs `decide`, numbers and perturbations), whatever Z says: accepted, the symbolic answer;
 *   (c) otherwise unresolved. Z alone is never accepted.
 * Z's short text is compared with a symbolic value by the symbolic catalog of lib/formalize/equivalence.mjs (the calibrated tier only
 * for free text, and only after a calibration without false positives).
 */
import {decide, need, sameAnswers, strategyOf} from './run.mjs';
import {equivalent} from './equivalence.mjs';
import {yesNoOf} from '../../../lib/formalize/equivalence.mjs';

/** Every value of a symbolic answer list states one of Z's parts. */
export async function matchesZ(values, z, {chat, problem = ''}) {
  if (!values?.length || !z?.length) return false;
  // Z's parts are short answers; a symbolic value of a kind Z never states (a name next to Z's numbers) is not compared, every other
  // value must state one of Z's parts, and at least one must.
  const zKinds = new Set(z.map(p => (yesNoOf(p) !== null && !/\d/.test(p) ? 'boolean' : /\d/.test(p) ? 'number' : 'string')));
  const compared = values.filter(v => zKinds.has(typeof v));
  if (!compared.length) return false;
  for (const v of compared) {
    let hit = false;
    for (const part of z) if (await equivalent(v, part, {chat, problem})) { hit = true; break; }
    if (!hit) return false;
  }
  return true;
}

/** {status: 'verified'|'unresolved', kind: 'a'|'b'|'ab'|null, paths, answers} */
export async function accept(profiles, z, {chat = null, problem = ''} = {}) {
  const sym = decide(profiles);
  const complete = p => Array.isArray(p) && p.length > 0 && p.every(a => Array.isArray(a) && a.length);
  const withZ = [];
  for (const [n, p] of Object.entries(profiles)) if (complete(p) && (await matchesZ(p[0], z, {chat, problem}))) withZ.push(n);
  if (sym.status === 'verified') return {status: 'verified', kind: sym.paths.some(n => withZ.includes(n)) ? 'ab' : 'b', paths: sym.paths, answers: sym.answers, z: withZ};
  // (a): the symbolic paths that state Z's answer, grouped by the same answer on the original numbers; the largest group with Z.
  const groups = [];
  for (const n of withZ) { const g = groups.find(x => sameAnswers(profiles[x[0]][0], profiles[n][0])); if (g) g.push(n); else groups.push([n]); }
  groups.sort((x, y) => y.length - x.length);
  const votes = g => new Set(g.map(strategyOf)).size;
  if (groups.length && (groups.length === 1 || votes(groups[0]) > votes(groups[1])) && votes(groups[0]) + 1 >= need(profiles[groups[0][0]]))
    return {status: 'verified', kind: 'a', paths: [...groups[0], 'Z'], answers: profiles[groups[0][0]][0], z: withZ};
  return {status: 'unresolved', kind: null, paths: [], answers: [], z: withZ};
}
