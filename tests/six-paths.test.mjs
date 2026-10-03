// The six-paths harness (tools/eval/six-paths): the robust readers, the question data layer, the deterministic heuristics of the
// paths (C's algebra, D's combinations, E's controlled English, F's substitution) executed by the engines, the comparison by executed
// result on perturbations, and the format-normalizing scorer. No model is called; every problem text here is invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readIndex, readRef, readChoice, questions, fill, registryFor, conditions} from '../tools/eval/six-paths/common.mjs';
import {solve} from '../tools/eval/six-paths/path-c.mjs';
import {parseCnl, cnlProgram} from '../tools/eval/six-paths/path-e.mjs';
import {asTemplate} from '../tools/eval/six-paths/path-f.mjs';
import {readLogic} from '../tools/eval/six-paths/path-a.mjs';
import {programResult} from '../tools/eval/six-paths/program.mjs';
import {agree, decide, sameAnswers} from '../tools/eval/six-paths/run.mjs';
import {judgeDeterministic, goldDefect} from '../tools/eval/six-paths/score.mjs';
import {parseExpression} from '../sop/expression.mjs';
import {sameDeterministic} from '../tools/eval/six-paths/equivalence.mjs';
import {accept} from '../tools/eval/six-paths/accept.mjs';

test('readers accept small variations of an index and a menu choice', () => {
  for (const t of ['v3', 'V3', '3', '#3', '(3)', 'the third value', ' v3. ', '**v3**']) assert.equal(readIndex(t, 5), 3, t);
  assert.equal(readIndex('v9', 5), null);
  const reg = registryFor('A plant makes 820 parts, 25% are spare, in 3 shifts.');
  assert.equal(readRef('820', reg), 1, 'a copied number is its registry index');
  assert.equal(readRef('25%', reg), 2);
  assert.equal(readRef('2', reg), 2, 'a small integer equal to no registry number is an index');
  assert.equal(readRef('3', reg), 3);
  assert.equal(readRef('74 * 1.5', reg), null);
  assert.equal(readChoice('2.', ['a', 'b', 'c']), 2);
  assert.equal(readChoice('Choice 3', ['a', 'b', 'c']), 3);
  assert.equal(readChoice('0', ['a'], {zero: true}), 0);
  assert.equal(readChoice('none of them', ['a', 'b']), null);
});

test('every question of the data layer fills its placeholders', () => {
  const q = questions();
  assert.match(q.system, /symbolic system/);
  assert.ok(q.combine.length >= 20);
  assert.match(fill(q.text('D_goal'), {problem: 'P', numbers: 'v1 = 2'}), /^Problem:\nP/);
  assert.ok(q.again('C_conditions'));
});

test('C: propagation solves a chain of equations into session rules executed by the engines', async () => {
  const msg = 'A crate holds 12 bottles and costs 7 coins. How much do 5 crates cost, and how many bottles is that?';
  const reg = registryFor(msg);
  const names = new Set(['cost', 'bottles']);
  const conds = [{left: 'cost', op: '=', right: 'v3 * v2'}, {left: 'bottles', op: '=', right: 'v1 * v3'}];
  const sol = solve(conds, [{kind: 'value', name: 'cost'}, {kind: 'value', name: 'bottles'}], names, reg, new Map(reg.map(v => [v.index, v.value])));
  const res = programResult(sol.lines, reg, {message: msg});
  assert.ok(res.ok, JSON.stringify(res.violations));
  assert.deepEqual(await res.exec(new Map(reg.map(v => [v.index, v.value]))), [35, 60]);
});

test('C: the largest whole value under an inequality is isolated, with the direction kept', async () => {
  const msg = 'Tickets cost 25 coins and the budget is 1000 coins. How many tickets at most?';
  const reg = registryFor(msg);
  const values = new Map(reg.map(v => [v.index, v.value]));
  const sol = solve([{left: 'v1 * n', op: '<=', right: 'v2'}], [{kind: 'largest', name: 'n'}], new Set(['n']), reg, values);
  const res = programResult(sol.lines, reg, {message: msg});
  assert.deepEqual(await res.exec(values), [40]);
  assert.deepEqual(await res.exec(new Map([[1, 30], [2, 1000]])), [33]);
});

test('C: a linear system is solved by elimination into rules over the data (and on perturbed numbers)', async () => {
  const msg = 'There are 40 heads and 140 legs; chickens have 2 legs, rabbits 4.';
  const reg = registryFor(msg);
  const at = v => new Map(reg.map(x => [x.index, v[x.index - 1]]));
  const conds = [{left: 'chickens + rabbits', op: '=', right: 'v1'}, {left: 'v3 * chickens + v4 * rabbits', op: '=', right: 'v2'}];
  const sol = solve(conds, [{kind: 'value', name: 'rabbits'}], new Set(['chickens', 'rabbits']), reg, at([40, 140, 2, 4]));
  const res = programResult(sol.lines, reg, {message: msg});
  assert.deepEqual(await res.exec(at([40, 140, 2, 4])), [30]);
  assert.deepEqual(await res.exec(at([50, 160, 2, 4])), [30]);
});

test('E: the controlled English parser compiles quantities and rejects free sentences', async () => {
  const msg = 'A crate holds 12 bottles. A shop sells 3 crates. How many bottles?';
  const p = parseCnl('The bottles per crate is 12.\nThe crates is 3.\nThe bottles is the bottles per crate times the crates.\nWhat is the bottles?\nThe shop is happy today because of sales.');
  assert.deepEqual(p.rejected, ['The shop is happy today because of sales.']);
  const reg = registryFor(msg);
  const res = programResult(cnlProgram(p, reg).lines, reg, {message: msg});
  assert.ok(res.ok);
  assert.deepEqual(await res.exec(new Map(reg.map(v => [v.index, v.value]))), [36]);
  const logic = parseCnl('Rex is a dog.\nEvery dog is an animal.\nIs Rex an animal?');
  assert.deepEqual(logic.logicQ, [{name: 'Rex', negated: false, p: 'animal'}]);
});

test('F: an exemplar becomes a template over inputs xK; A reads the logic notation', () => {
  const t = asTemplate({numbers: 'v1 = 18, v2 = 10%', program: 'rate = v1 * (1 - v2)\nanswer1 = rate * 2'});
  assert.deepEqual(t.inputs.map(i => [i.x, i.percent]), [['x1', false], ['x2', true]]);
  const l = readLogic('fact: dog "Rex"\nrule: if dog ?x then animal ?x\nquestion: animal "Rex"');
  assert.equal(l.question, 'animal "Rex"');
  assert.deepEqual(l.rules[0].if, ['dog ?x']);
});

test('agreement is by executed result on the numbers and on perturbations, never by syntax', () => {
  assert.ok(sameAnswers([35, 60], [60, 35]));
  const a = [[35], [40], [50], [20]], b = [[35], [40], [50], [20]], c = [[35], [41], [50], [20]];
  assert.ok(agree(a, b));
  assert.ok(!agree(a, c), 'a coincidence on the original numbers is not an agreement');
  assert.ok(agree([[true]], [[true]]), 'no numbers: the original only');
  assert.equal(decide({A: [[true]], B: [[true]]}).status, 'unresolved', 'a constant yes/no needs three paths');
  assert.equal(decide({A: [[true]], B: [[true]], C: [[true]]}).status, 'verified');
  assert.equal(decide({A: [[true], [false], [true], [true]], B: [[true], [false], [true], [true]]}).status, 'verified', 'a yes/no the numbers move needs two');
  assert.equal(decide({A: a, B: b, C: c}).status, 'verified');
  assert.equal(decide({A: a, C: c}).status, 'unresolved');
  assert.equal(decide({A: a, B: b, C: c, D: c}).status, 'verified', 'tied clusters that agree on the problem\'s own numbers');
  assert.equal(decide({A: a, B: b, C: [[36], [41], [50], [20]], D: [[36], [41], [50], [20]]}).status, 'unresolved');
  const reg = registryFor('5 boxes of 12');
  assert.equal(conditions(reg).length, 4);
});

test('the scorer counts format-only mismatches apart and finds structural gold defects', () => {
  const item = {question: 'How long does it take, in hours, to walk 9000 metres?', answer: 'It takes 150 minutes.'};
  assert.equal(judgeDeterministic(item, {kind: 'number', values: [150], text: item.answer}, [2.5]).verdict, 'format');
  assert.equal(judgeDeterministic(item, {kind: 'number', values: [0.441], text: '44.1%'}, [44.1]).verdict, 'format');
  assert.equal(judgeDeterministic(item, {kind: 'number', values: [2.7], text: '2.7'}, [2.6667]).verdict, 'format');
  assert.equal(judgeDeterministic(item, {kind: 'number', values: [7, 9], text: '7 and 9'}, [9]).verdict, 'format');
  assert.equal(judgeDeterministic(item, {kind: 'number', values: [28], text: 'Yes, 28 fit.'}, [true]).verdict, 'format');
  assert.equal(judgeDeterministic(item, {kind: 'number', values: [12], text: '12'}, [13]).verdict, 'wrong');
  assert.equal(judgeDeterministic(item, {kind: 'names', values: ['ana', 'mara'], text: 'Mara, Ana'}, ['Mara', 'Ana']).verdict, 'format');
  assert.equal(judgeDeterministic(item, {kind: 'yes_no', value: true, text: 'Yes'}, null).verdict, 'no_result');
  assert.ok(goldDefect({}, {kind: 'number', values: [5], text: 'The answer is 7.'}));
  assert.equal(goldDefect({}, {kind: 'number', values: [7], text: 'The answer is 7.'}), null);
  assert.ok(parseExpression('v1 * 2'));
});

test('the harness compares answers through the symbolic catalog; the tier is never asked about numbers or labels', async () => {
  assert.equal(await sameDeterministic('44.1%', '0.441'), true);
  assert.equal(await sameDeterministic('Yes, 28', 'yes'), true);
  assert.equal(await sameDeterministic('150 minutes', '2.5 hours'), true);
  assert.equal(await sameDeterministic('150 minutes', '2 hours'), false);
  assert.equal(await sameDeterministic('12', '13'), false);
  assert.equal(await sameDeterministic('Plan B', 'Plan A'), false);
  assert.equal(await sameDeterministic(true, 'yes'), true);
  assert.equal(await sameDeterministic('the headline', 'the title'), null, 'a paraphrase is left to the calibrated tier');
});

test('acceptance with the direct answer: (a) Z plus one symbolic path, (b) two symbolic paths, never Z alone', async () => {
  const p40 = [[40], [33], [47], [51]], p12 = [[12], [10], [14], [15]];
  assert.deepEqual(await accept({B: p40, C: [[39]]}, ['40']).then(r => [r.status, r.kind]), ['verified', 'a']);
  assert.deepEqual(await accept({B: p12, C: p12}, ['40']).then(r => [r.status, r.kind, r.answers]), ['verified', 'b', [12]]);
  assert.deepEqual(await accept({B: p40, C: p40}, ['40']).then(r => r.kind), 'ab');
  assert.equal((await accept({B: [[39]]}, ['40'])).status, 'unresolved');
  assert.equal((await accept({B: [[true]]}, ['yes'])).status, 'unresolved', 'a constant yes/no needs Z plus two symbolic paths');
  assert.equal((await accept({B: [[40], null, [47], [51]]}, ['40'])).status, 'unresolved', 'the symbolic path must execute on every perturbation');
});
