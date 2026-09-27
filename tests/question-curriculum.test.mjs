import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../sop/parser.mjs';
import { cases, assumptions, attached, numeric, extra, blockedFamilies } from '../tools/datasets/curriculum/cases.mjs';
import { generateQuestionCurriculum, questionInventory, verifyQuestionGolds } from '../tools/datasets/question-curriculum.mjs';

const sourceCases = [...cases, ...assumptions, ...attached, ...numeric, ...extra];

test('inventory is derived from actual source families, operators, and blocked vision families', () => {
  const inventory = questionInventory();
  assert.deepEqual(inventory.map(entry => entry.family), [...new Set([...sourceCases.map(item => item.family), ...blockedFamilies.map(item => item.family)])].sort());
  for (const item of inventory) {
    const source = sourceCases.filter(entry => entry.family === item.family);
    assert.equal(item.cases, source.length, item.family);
    assert.deepEqual(item.operators, [...new Set(source.flatMap(entry => entry.operators))].sort(), item.family);
    if (item.cases === 0) assert.match(item.reasoning_gap, /.+/);
  }
});

test('family/world filtering and seeded bounded sampling preserve semantic groups and declarative targets', () => {
  const options = { family: 'temporal', world: 'temporal_train', seed: 17, limit: 6 };
  const rows = generateQuestionCurriculum(options);
  assert.equal(rows.length, 6);
  assert.deepEqual(rows, generateQuestionCurriculum(options));
  assert.notDeepEqual(rows.map(row => row.id), generateQuestionCurriculum({ ...options, seed: 18 }).map(row => row.id));
  assert.ok(rows.every(row => row.family === 'temporal' && row.world === 'temporal_train' && row.split === 'train'));
  assert.ok(rows.every(row => row.status === 'executable' && parse(row.target).wires.every(wire => ['premise', 'query', 'constraint'].includes(wire.type))));
  assert.throws(() => generateQuestionCurriculum({ family: 'unknown' }), /Unknown family/);
  assert.throws(() => generateQuestionCurriculum({ family: 'temporal', world: 'family_train' }), /No temporal questions/);
  assert.throws(() => generateQuestionCurriculum({ limit: 1001 }), /limit/);
});

test('independent oracles agree with runtime across supported families and explicit reasoning gaps remain unsupported', async () => {
  const rows = generateQuestionCurriculum({ seed: 7, limit: 1000 });
  const groups = new Map();
  for (const row of rows) {
    if (row.split_group_id) {
      const previous = groups.get(row.split_group_id);
      if (previous) assert.equal(row.split, previous, `Cross-split semantic group ${row.split_group_id}`);
      groups.set(row.split_group_id, row.split);
    }
    if (row.status === 'executable') {
      assert.ok(parse(row.target).wires.every(wire => ['premise', 'query', 'constraint'].includes(wire.type)), row.id);
      assert.match(row.oracle.kind, /.+/);
    } else {
      assert.equal(row.expected.status, 'unsupported');
      assert.equal(row.target, null);
      assert.match(row.reason, /.+/);
    }
  }
  assert.deepEqual(new Set(rows.filter(row => row.case_id === 'time_end').map(row => row.expected.status)), new Set(['refuted']));
  assert.deepEqual(new Set(rows.filter(row => row.case_id === 'conflicted_parent').map(row => row.expected.status)), new Set(['both']));
  assert.deepEqual(new Set(rows.filter(row => row.case_id === 'finite_possible').map(row => row.expected.status)), new Set(['possible']));
  assert.ok(rows.some(row => row.case_id === 'route_approved_procedure' && row.status === 'unsupported'));
  assert.ok(rows.some(row => row.case_id === 'assert_only' && row.reason.includes('remember')));
  assert.ok(rows.some(row => row.case_id === 'unsupported_counterfactual' && row.reason.includes('Interventions')));
  assert.ok(rows.some(row => row.id === 'gap_general_quantification' && row.question === null));
  const verification = await verifyQuestionGolds(rows);
  assert.equal(verification.surfaces, rows.length);
  assert.ok(verification.executed_golds > 40);
  assert.ok(verification.unsupported_surfaces > 20);
});

test('runtime-observed contradiction fails closed even when expected and oracle are both corrupted', async () => {
  const original = generateQuestionCurriculum({ family: 'relation_role', world: 'family_train', seed: 2, limit: 100 });
  const row = original.find(item => item.case_id === 'parent_forward');
  assert.equal(row.oracle.status, 'supported');
  await assert.rejects(verifyQuestionGolds([{ ...row, oracle: { ...row.oracle, status: 'refuted' }, expected: { status: 'refuted' } }]), /oracle refuted, runtime supported/);
  await assert.rejects(verifyQuestionGolds([{ ...row, target: '@x remember\n  input $missing' }]), /forbidden target wire/);
});
