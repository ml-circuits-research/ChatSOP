// The formalization-machine research harness (tools/eval/method-library, experiments/proposal/formalization-machine-phase1.md): the
// method library loads from its fp_ layer, a filled method tree executes node by node through the primitives' SOP circuits on the
// product's engines, a missing method or a bad fill ends in a known state, and the outcome taxonomy is applied. No model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadLibrary, renderLibrary, checkMethod} from '../tools/eval/method-library/library.mjs';
import {runTree, readTree, composeCalculation} from '../tools/eval/method-library/machine.mjs';
import {analyseProgram, lowerProgram, evaluateProgram} from '../lib/formalize/expression-program.mjs';
import {renderAnswers} from '../tools/eval/method-library/score.mjs';
import {classify} from '../tools/eval/method-library/score.mjs';
import {engines} from '../tools/eval/method-library/primitives.mjs';

const lib = loadLibrary();
const reg = values => values.map((value, i) => ({index: i + 1, value}));

test('the library layer loads: primitives, goal types and methods with slots and formulas, rendered for the prompt', () => {
  assert.ok(lib.primitives.size >= 6 && lib.primitives.size <= 10);
  assert.ok(lib.goalTypes.size >= 10 && lib.goalTypes.size <= 30);
  assert.ok(lib.methods.has('units_needed') && lib.methods.get('units_needed').formula === 'ceil(amount / capacity)');
  for (const m of lib.methods.values()) assert.ok(lib.primitives.has(m.solver), `${m.id}: solver ${m.solver}`);
  assert.match(renderLibrary(lib), /\* order_by_clues .*solver constraints/);
  assert.deepEqual(checkMethod({id: 'units_needed', achieves: ['find_value'], solver: 'calculate', formula: 'x', slots: []}, lib).length > 0, true);
});

test('a composed numeric tree executes: whole blocks, then a linear time, then a check against the limit', async () => {
  const tree = readTree('```json\n{"goals": [{"id": "g1", "type": "check_condition", "node": "n3"}], "nodes": [' +
    '{"id": "n1", "method": "units_needed", "slots": {"amount": "v1", "capacity": "v3"}},' +
    '{"id": "n2", "method": "linear_cost", "slots": {"fixed": "v5", "per_unit": "v4", "quantity": "n1"}},' +
    '{"id": "n3", "method": "compare_values", "slots": {"left": "n2", "cmp": "at_most", "right": "v2"}}]}\n```');
  const r = await runTree(tree, {lib, registry: reg([46, 39, 16, 6, 7, 9])});
  assert.equal(r.goals[0].state, 'EXECUTED');
  assert.equal(r.nodes.n2.value, 25);
  assert.equal(r.goals[0].result.value, true);
  assert.deepEqual(r.usedMethods.sort(), ['compare_values', 'linear_cost', 'units_needed']);
});

test('an order from clues, a choice among feasible options, a deduction and an earliest finish', async () => {
  const tree = {goals: [{id: 'g1', type: 'find_order', node: 'n1'}, {id: 'g2', type: 'choose_option', node: 'n4'}, {id: 'g3', type: 'is_forced', node: 'n5'}, {id: 'g4', type: 'earliest_finish', node: 'n6'}],
    nodes: [{id: 'n1', method: 'order_by_clues', slots: {things: ['Ana', 'Mara', 'Daria', 'Luca'], clues: [{kind: 'before', a: 'Mara', b: 'Daria'}, {kind: 'before', a: 'Ana', b: 'Mara'}, {kind: 'before', a: 'Daria', b: 'Luca'}]}},
      {id: 'n2', method: 'compare_values', slots: {left: 'v1', cmp: 'at_most', right: 'v3'}},
      {id: 'n3', method: 'compare_values', slots: {left: 'v2', cmp: 'at_most', right: 'v3'}},
      {id: 'n4', method: 'choose_best_option', slots: {options: ['Option A', 'Option B'], score: ['v1', 'v2'], feasible: ['n2', 'n3'], direction: 'lowest'}},
      {id: 'n5', method: 'derive_forced', slots: {facts: ['intermittent "alarm"'], rules: [{if: ['continuous ?x'], then: 'leave_east ?x'}], question: {atom: 'leave_east "alarm"'}}},
      {id: 'n6', method: 'earliest_completion', slots: {tasks: [{name: 'a', duration: {const: 3, why: 'test'}}, {name: 'b', duration: {const: 4, why: 'test'}}, {name: 'c', duration: {const: 2, why: 'test'}}], after: [['c', 'a'], ['c', 'b']]}}]};
  const r = await runTree(tree, {lib, registry: reg([140, 120, 130])});
  assert.deepEqual(r.goals.map(g => g.state), ['EXECUTED', 'EXECUTED', 'EXECUTED', 'EXECUTED']);
  assert.deepEqual(r.goals[0].result.value, ['Ana', 'Mara', 'Daria', 'Luca']);
  assert.equal(r.goals[1].result.value, 'Option B');
  assert.equal(r.goals[2].result.value, false);
  assert.equal(r.goals[3].result.value, 6);
  assert.equal(r.consts.length, 3);
});

test('known states: an unknown method is MISSING_METHOD, a bad reference is FILL_ERROR, a declared status stands', async () => {
  const tree = {goals: [{id: 'g1', type: 'find_value', node: 'n1'}, {id: 'g2', type: 'find_value', node: 'n2'}, {id: 'g3', status: 'missing_concept', reason: 'needs a definition'}],
    nodes: [{id: 'n1', method: 'invented_method', slots: {}}, {id: 'n2', method: 'divide', slots: {a: 'v1', b: 'v9'}}]};
  const r = await runTree(tree, {lib, registry: reg([10])});
  assert.deepEqual(r.goals.map(g => g.state), ['MISSING_METHOD', 'FILL_ERROR', 'MISSING_CONCEPT']);
  assert.equal(classify(r, {verdict: null}).outcome, 'MISSING_METHOD');
  const ok = await runTree({goals: [{id: 'g1', type: 'find_value', node: 'n1'}], nodes: [{id: 'n1', method: 'divide', slots: {a: 'v1', b: 'v2'}}]}, {lib, registry: reg([10, 4])});
  assert.equal(classify(ok, {verdict: 'match'}).outcome, 'SOLVED');
  assert.equal(classify(ok, {verdict: 'mismatch'}).outcome, 'WRONG');
  assert.equal(classify(r, {verdict: 'partial'}).outcome, 'MISSING_METHOD');
});

test('an arithmetic tree composes into one perturbable circuit over the registry, and a clock result renders as a clock time', async () => {
  const tree = {goals: [{id: 'g1', type: 'check_condition', node: 'n3'}], nodes: [
    {id: 'n1', method: 'units_needed', slots: {amount: 'v1', capacity: 'v3'}},
    {id: 'n2', method: 'linear_cost', slots: {fixed: 'v5', per_unit: 'v4', quantity: 'n1'}},
    {id: 'n3', method: 'compare_values', slots: {left: 'n2', cmp: 'at_most', right: 'v2'}}]};
  const registry = reg([46, 39, 16, 6, 7, 9]);
  const c = await composeCalculation(tree, {lib, registry, analyse: analyseProgram, lower: lowerProgram});
  assert.ok(c && /@s\d+ stated[\s\S]*role object 46/.test(c.sop));
  assert.equal(evaluateProgram(c.program, new Map(registry.map(v => [v.index, v.value]))).answer1, true);
  assert.equal(evaluateProgram(c.program, new Map(registry.map(v => [v.index, v.index === 2 ? 20 : v.value]))).answer1, false);
  assert.equal(await composeCalculation({goals: [{id: 'g1', node: 'n1'}], nodes: [{id: 'n1', method: 'derive_who', slots: {}}]}, {lib, registry, analyse: analyseProgram, lower: lowerProgram}), null);
  const r = await runTree({goals: [{id: 'g1', type: 'find_value', node: 'n1'}], nodes: [{id: 'n1', method: 'clock_after', slots: {start_hour: 'v1', start_minute: 'v2', duration_minutes: 'v3'}}]}, {lib, registry: reg([22, 30, 150])});
  assert.match(renderAnswers([{...r.goals[0].result, kind: 'number'}]), /01:00 \(a clock time\)/);
});

test.after(async () => (await engines()).dispose());
