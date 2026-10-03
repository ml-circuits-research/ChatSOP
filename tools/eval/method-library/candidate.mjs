/**
 * The method tree as a candidate of the N-way formalization (variant B, lib/formalize/dual-check.mjs, owned by the dual-formalization
 * work; this module only produces a candidate in its format and never edits it). Offline research path.
 *
 *   const c = await methodTreeCandidate(problem, {tier: 'good'});
 *   // c: {name, kind: 'tree', sop, answers, status, goals, tree, composed}
 *
 * `problem` is a book item ({question}) or a message string. The tier fills a method tree from the frozen library
 * (config/knowledge/formalizer-methods-v1, no worked solution), the machine executes it node by node; `answers` are the executed goal
 * values. `sop` is ONE circuit whose stated values are the problem's registry numbers, so `candidateProfile` can execute it and
 * `perturbCircuit` can move its numbers: for an arithmetic tree it is the composed expression program (machine.mjs composeCalculation;
 * `composed.agrees` says whether it reproduces the node-by-node answers); for a single goal answered by one node that reads only the
 * problem (an order, a deduction, a choice over stated scores) it is that node's own circuit; otherwise null (answers only, no profile).
 */
import {loadLibrary} from './library.mjs';
import {runTree, composeCalculation} from './machine.mjs';
import {executedAnswers} from './score.mjs';
import {solveOne} from './run.mjs';
import {extractNumbers} from '../../../lib/formalize/registry.mjs';
import {analyseProgram, lowerProgram} from '../../../lib/formalize/expression-program.mjs';

const same = (a, b) => typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)) : JSON.stringify(a) === JSON.stringify(b);

export async function methodTreeCandidate(problem, {tier = 'good', run = 'ml-candidate', lib = loadLibrary()} = {}) {
  const item = typeof problem === 'string' ? {id: 'message', question: problem, answer: ''} : problem;
  const registry = extractNumbers(item.question, {max: 40});
  const r = await solveOne(item, lib, {run, solution: false, tier, score: false});
  const name = `method-${tier}`;
  if (!r.tree) return {name, kind: 'tree', sop: null, answers: [], status: r.outcome, goals: [], tree: null, composed: null};
  const exec = await runTree(r.tree, {lib, registry});
  const answers = executedAnswers(exec);
  let sop = null, composed = null;
  const c = await composeCalculation(r.tree, {lib, registry, analyse: analyseProgram, lower: lowerProgram});
  if (c) {
    const want = c.answers.map(id => answers.find(a => a.goal === id)?.value);
    // The composed circuit is checked against the node-by-node answers by the interpreter of the same program (no engine call).
    const {evaluateProgram} = await import('../../../lib/formalize/expression-program.mjs');
    let got = null;
    try { const v = evaluateProgram(c.program, new Map(registry.map(x => [x.index, x.value]))); got = c.answers.map((_, i) => v[`answer${i + 1}`]); } catch { got = null; }
    composed = {agrees: Boolean(got) && want.every((w, i) => w !== undefined && same(w, got[i]))};
    sop = c.sop;
  } else if (exec.goals.length === 1 && exec.goals[0].state === 'EXECUTED') {
    const node = r.tree.nodes.find(n => n.id === String(exec.goals[0].node).trim());
    if (node && !/"n\d+"/.test(JSON.stringify(node.slots ?? {}))) sop = exec.goals[0].result.sop ?? null;
  }
  return {name, kind: 'tree', sop, answers: answers.map(a => a.value), status: r.outcome, goals: exec.goals.map(g => ({id: g.id, type: g.type, state: g.state})), tree: r.tree, composed};
}
