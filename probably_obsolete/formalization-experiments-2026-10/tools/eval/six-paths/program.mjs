/**
 * The common back end of the paths whose heuristics end in arithmetic (B compute, C equations, D backward, E controlled English,
 * F analogy): numbered lines `name = expression` over the registry v1..vn, analysed once on the problem's numbers by
 * lib/formalize/expression-program.mjs (references, types, coverage) and lowered to SOP session rules for any set of numbers, so the
 * same formal result runs on the original and on the perturbed numbers. Each path builds its lines by its own deterministic heuristic;
 * this module only checks and lowers them.
 */
import {analyseProgram, lowerProgram} from '../../../lib/formalize/expression-program.mjs';
import {runCircuit, withValues} from './common.mjs';

/**
 * `lines`: [{name, text}] in order (the answers are named answer1.. or the last line); `unusedAll`: list every registry number not
 * referenced as unused (the paths other than B do not ask for coverage). Returns {ok, analysis, violations, exec, program}.
 */
export function programResult(lines, registry, {message, unusedAll = true} = {}) {
  const read = {lines: lines.map((l, i) => ({n: i + 1, name: l.name, text: l.text})), unused: []};
  if (unusedAll) {
    const used = new Set(lines.flatMap(l => [...String(l.text).matchAll(/\bv(\d+)\b/g)].map(m => Number(m[1]))));
    read.unused = registry.map(v => v.index).filter(k => !used.has(k));
  }
  const analysis = analyseProgram(read, registry);
  // An answer that depends on no number of the problem is a value the model wrote, not a computation: refused (every path).
  if (analysis.ok) {
    const byName = new Map(analysis.program.lines.map(l => [l.name, l]));
    const reaches = (name, seen = new Set()) => { if (seen.has(name)) return false; seen.add(name); const l = byName.get(name); return Boolean(l) && l.refs.some(r => /^v\d+$/.test(r) || reaches(r, seen)); };
    const constant = analysis.program.answers.filter(a => !reaches(a));
    // An answer that only copies one number of the problem (answer = v7, or through names that each copy one) did its work outside
    // the circuit (a median picked by eye, a value read off): refused like a written value (batch2: two paths verified a median so).
    const copies = name => { const l = byName.get(name); return Boolean(l) && l.ast.type === 'ref' && (/^v\d+$/.test(l.ast.value) || copies(l.ast.value)); };
    const copied = analysis.program.answers.filter(a => copies(a));
    if (copied.length) return {ok: false, analysis, violations: [`${copied.join(', ')} copies a number of the problem instead of computing it`]};
    if (constant.length) return {ok: false, analysis, violations: [`${constant.join(', ')} computes nothing from the numbers of the problem (a written value, not a computation)`]};
  }
  if (!analysis.ok) return {ok: false, analysis, violations: analysis.violations.map(v => v.message)};
  try { lowerProgram(analysis, registry); } catch (error) { return {ok: false, analysis, violations: [`not lowerable: ${error.message}`]}; }
  const exec = async values => {
    const reg = withValues(registry, values);
    const low = lowerProgram(analysis, reg);
    return runCircuit(low.sop, {message, numbers: [...values.values()]});
  };
  return {ok: true, analysis, exec, program: analysis.program.lines.map(l => `${l.name} = ${l.text}`).join('\n')};
}
