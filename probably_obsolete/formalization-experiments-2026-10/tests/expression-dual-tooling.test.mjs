// ARCHIVED 2026-10-03 (probably_obsolete/formalization-experiments-2026-10/README.md): the tests of the dual-formalization tooling split
// out of tests/expression-program.test.mjs (strict scoring and recording replay of tools/eval/formalization-regression/expression.mjs,
// the semantic obligations of lib/formalize/obligations.mjs, the cross-family and tiny-only verifiers of lib/formalize/verifier.mjs).
// History only: the imports name the paths of the time and do not resolve from this folder. Every problem text here is invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {expressionFormalize, registryOf, PROMPT_VERSION} from '../lib/formalize/expression-program.mjs';
import {readFormulas, arithmeticCircuit} from '../lib/query-author/step-by-step/problem.mjs';
import {executor, replayRecording, score, RECORDINGS} from '../tools/eval/formalization-regression/expression.mjs';

const CRATES = 'A crate holds 12 bottles. A shop needs 50 bottles and each crate costs 7 coins. What do the crates cost?';
const crates = registryOf(CRATES);
/** A tree circuit built independently, by the problem mode's own assembler from named values and formulas. */
const tree = formula => arithmeticCircuit({values: [{name: 'per_crate', value: 12}, {name: 'needed', value: 50}, {name: 'price', value: 7}], formulas: readFormulas(`cost = ${formula}`, ['per_crate', 'needed', 'price']), lexicon: null});

test.after(async () => (await executor()).dispose());

test('strict scoring: asked values against gold numbers, yes/no by value', () => {
  assert.equal(score({kind: 'number', values: [35]}, [35]), 'correct');
  assert.equal(score({kind: 'number', values: [35, 5]}, [35]), 'wrong');
  assert.equal(score({kind: 'yes_no', value: false}, [false]), 'correct');
  assert.equal(score({kind: 'number', values: [35]}, [null]), 'unanswered');
});

test('offline replay: a recording replays with no model, and a changed answer names its first diverging step', async () => {
  const rec = {id: 'fixture/crates', tier: 'tiny', steps: [{name: 'expr_program', qsha: null, answer: '1. crates = Math.ceil(v2 / v1)\n2. answer = crates * v3'}], tree_sop: tree('ceil(needed / per_crate) * price'),
    expect: {status: 'ok', violations: [], answers: ['answer'], values: [35], verdict: 'agree'}};
  const r = await replayRecording(rec, {message: CRATES});
  assert.ok(r.ok, JSON.stringify(r));
  const changed = await replayRecording({...rec, steps: [{...rec.steps[0], answer: 'answer = v2 / v1 * v3'}]}, {message: CRATES});
  assert.equal(changed.ok, false);
  assert.equal(changed.first.step, 'execute');
});

test('recorded book cases replay offline (fast tier; local recordings only)', {skip: !fs.existsSync(`${RECORDINGS}/tiny.jsonl`)}, async () => {
  const {loadItems} = await import('../tools/eval/formalization-regression/cases.mjs');
  const items = loadItems();
  const recs = [...new Map(fs.readFileSync(`${RECORDINGS}/tiny.jsonl`, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => (r.prompt_version ?? 1) === PROMPT_VERSION).map(r => [r.id, r])).values()].slice(0, 20);
  for (const rec of recs) {
    if (!items.get(rec.id)) continue;
    const r = await replayRecording(rec, {message: items.get(rec.id).question});
    assert.ok(r.ok, `${rec.id}: ${r.first?.kind}@${r.first?.step}: ${r.first?.why}`);
  }
});

test('obligations: asked parts, kinds, signs and coverage; one targeted question for the first failed one', async () => {
  const {readGoals, obligationsOf, packetFields, goalsQuestion} = await import('../lib/formalize/obligations.mjs');
  assert.match(goalsQuestion(CRATES), /gK: <what is asked/);
  const goals = readGoals('g1: cost of the crates | number | positive\ng2: is it under 40 coins | yes or no | any\ng3: why whole crates | explanation | any');
  assert.deepEqual(goals.map(g => [g.kind, g.sign]), [['number', 'positive'], ['yes or no', 'any'], ['explanation', 'any']]);
  assert.equal(readGoals('The cost.'), null);
  const ok = await expressionFormalize({message: CRATES, chat: async () => ({ok: true, text: 'crates = Math.ceil(v2 / v1)\nanswer1 = crates * v3\nanswer2 = answer1 < 40'}), exemplars: []});
  const met = obligationsOf({expr: ok, values: [35, true], goals});
  assert.equal(met.blocking, false);
  assert.deepEqual(met.unresolved, ['explain:g3']);
  assert.ok(met.formalized > 80 && met.formalized < 100);
  const part = obligationsOf({expr: ok, values: [35], goals});
  assert.ok(part.blocking && part.unresolved.includes('part:g2'));
  assert.match(part.question, /asks for 2 things.*answer1 = cost of the crates.*answer2 = is it under 40 coins/);
  const sign = obligationsOf({expr: ok, values: [-35, true], goals});
  assert.ok(sign.blocking && sign.unresolved.includes('sign:g1'));
  assert.match(sign.question, /answer1 \(cost of the crates\) came out -35, but it must be above zero/);
  const kind = obligationsOf({expr: ok, values: [35, 7], goals});
  assert.ok(kind.unresolved.includes('kind:g2'));
  assert.deepEqual(obligationsOf({expr: {status: 'no_numbers'}, goals}).unresolved.slice(0, 1), ['numbers']);
  const fields = packetFields(part);
  assert.ok(fields.formalized < 100 && fields.unresolved_obligations.length && fields.clarification);
  // The re-ask carries the obligation's question as the hint of the next program question.
  const asked = [];
  await expressionFormalize({message: CRATES, chat: async m => { asked.push(m.at(-1).content); return {ok: true, text: 'answer = v1'}; }, exemplars: [], hint: part.question});
  assert.match(asked[0], /previous answer had a problem: The question asks for 2 things/);
});

test('cross-family verifier: agreement plus obligations verifies; an unmet obligation is re-asked on the next tier; otherwise unresolved', async () => {
  const {verifyCrossFamily, confirmedParts} = await import('../lib/formalize/verifier.mjs');
  const {readGoals} = await import('../lib/formalize/obligations.mjs');
  const w = await executor();
  const execute = (sop, numbers) => w.execute(sop, CRATES, numbers);
  const prog = text => async hint => expressionFormalize({message: CRATES, chat: async () => ({ok: true, text}), exemplars: [], hint});
  const right = 'crates = Math.ceil(v2 / v1)\nanswer = crates * v3', wrong = 'answer = v2 / v1 * v3', negative = 'answer = 0 - Math.ceil(v2 / v1) * v3';
  const goals = readGoals('g1: cost of the crates | number | positive');
  const ok = await verifyCrossFamily({registry: crates, execute, goals, seed: 'v', candidates: [{name: 'a', run: prog(right), next: null}, {name: 'b', run: prog(right), next: null}]});
  assert.equal(ok.status, 'verified');
  assert.deepEqual(ok.answers, [35]);
  assert.equal(ok.parts, 'list');
  const split = await verifyCrossFamily({registry: crates, execute, goals, seed: 'v', candidates: [{name: 'a', run: prog(right), next: null}, {name: 'b', run: prog(wrong), next: null}]});
  assert.equal(split.status, 'unresolved');
  assert.deepEqual(split.answers, []);
  // Both agree on -35, which breaks the sign obligation: each is re-asked on its next tier, with the failing obligation named.
  const hints = [];
  const next = name => ({name, run: async hint => { hints.push(hint); return prog(right)(hint); }});
  const fixed = await verifyCrossFamily({registry: crates, execute, goals, seed: 'v', candidates: [{name: 'a', run: prog(negative), next: next('a2')}, {name: 'b', run: prog(negative), next: next('b2')}]});
  assert.equal(fixed.status, 'verified');
  assert.equal(fixed.stage, 'reask');
  assert.deepEqual(fixed.reasked, ['a2', 'b2']);
  assert.match(hints[0], /came out -35, but it must be above zero/);
  // Parts count only when two signals agree.
  const two = readGoals('g1: cost | number | any\ng2: crates | number | whole');
  assert.equal(confirmedParts(two, [2, 1]).source, 'list');
  assert.equal(confirmedParts(two, [1, 1], [35]).source, 'programs');
  assert.equal(confirmedParts(two, [1, 3]).source, 'unconfirmed');
});

test('tiny-only verification: two tiny formalizations agree; the failing part is re-asked to tiny; a third tiny path counts only with one of them', async () => {
  const {verifyTinyPaths, confirmedParts} = await import('../lib/formalize/verifier.mjs');
  const {readGoals} = await import('../lib/formalize/obligations.mjs');
  const w = await executor();
  const execute = (sop, numbers) => w.execute(sop, CRATES, numbers);
  const prog = (...texts) => { let i = 0; return {run: async hint => expressionFormalize({message: CRATES, chat: async () => ({ok: true, text: texts[Math.min(i++, texts.length - 1)]}), exemplars: [], hint})}; };
  const right = 'crates = Math.ceil(v2 / v1)\nanswer = crates * v3', wrong = 'answer = v2 / v1 * v3', negative = 'answer = 0 - Math.ceil(v2 / v1) * v3';
  const good = {sop: tree('ceil(needed / per_crate) * price')}, bad = {sop: tree('needed / per_crate * price')};
  const goals = readGoals('g1: cost of the crates | number | positive');
  const v = await verifyTinyPaths({program: prog(right), tree: good, goals, registry: crates, execute, seed: 't'});
  assert.equal(v.status, 'verified');
  assert.deepEqual(v.answers, [35]);
  // A sign obligation fails; the re-ask goes to the same tiny path and then agrees with the tree.
  const re = await verifyTinyPaths({program: prog(negative, right), tree: good, goals, registry: crates, execute, seed: 't'});
  assert.equal(re.stage, 'reask');
  assert.equal(re.status, 'verified');
  // Disagreement: the third path decides only by agreeing with one of the two.
  let asked = 0;
  const third = async () => { asked++; return {name: 'method', sop: tree('ceil(needed / per_crate) * price')}; };
  const t = await verifyTinyPaths({program: prog(right), tree: bad, third, goals, registry: crates, execute, seed: 't'});
  assert.equal(t.stage, 'third');
  assert.deepEqual(t.third.agrees_with, ['program']);
  assert.deepEqual(t.answers, [35]);
  const none = await verifyTinyPaths({program: prog(wrong), tree: {sop: tree('price * 5')}, third: async () => null, goals, registry: crates, execute, seed: 't'});
  assert.equal(none.status, 'unresolved');
  assert.equal(asked, 1);
  // Part kinds: two programs answering a number overrule a list that says yes or no.
  const parts = confirmedParts(readGoals('g1: the cost | yes or no | any'), [1, 1], [35], [[35], [35]]);
  assert.equal(parts.goals[0].kind, 'number');
});

test('the cross-family reference: a structural voter counts only when both candidates agree with it', async () => {
  const {verifyCrossFamily} = await import('../lib/formalize/verifier.mjs');
  const w = await executor();
  const execute = (sop, numbers) => w.execute(sop, CRATES, numbers);
  const prog = text => async hint => expressionFormalize({message: CRATES, chat: async () => ({ok: true, text}), exemplars: [], hint});
  const right = 'crates = Math.ceil(v2 / v1)\nanswer = crates * v3', wrong = 'answer = v2 / v1 * v3';
  const cands = [{name: 'a', run: prog(right), next: null}, {name: 'b', run: prog(wrong), next: null}];
  const one = await verifyCrossFamily({registry: crates, execute, goals: null, seed: 't', third: {name: 'tree', sop: tree('ceil(needed / per_crate) * price')}, candidates: cands});
  assert.equal(one.status, 'unresolved');
  assert.equal(one.with_third.agrees_with_both, false);
  assert.equal(one.with_third.status, 'unresolved');
});
