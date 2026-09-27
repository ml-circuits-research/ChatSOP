import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../eval/run.mjs';
import { epistemicResult } from '../eval/contracts.mjs';

function fixture() {
  return {
    id: 'parent-en', semantic_case_id: 'parent-case', language: 'en', structure_id: 'parent-direct', evaluation_track: 'formalization',
    question: 'Who is the parent of person B?',
    context: {
      now: '2026-09-26T12:00:00Z', language: 'en',
      entities: [{ id: 'person_a', label: 'Person A', type: 'person' }, { id: 'person_b', label: 'Person B', type: 'person' }, { id: 'person_c', label: 'Person C', type: 'person' }],
      predicates: [{ id: 'parent', args: ['person', 'person'], meaning: 'parent of a person' }],
      approvedTemplates: [], procedures_sop: [],
    },
    setup_sop: '@f fact\n  holds parent person_a person_b\n  valid timeless\n  source synthetic\n',
    sop_target: '@q query\n  select ?who\n  where parent ?who person_b\n',
    expected: { status: 'supported', answers: [['person_a']], outputs: {} },
  };
}

const config = { memory: { engine: 'scan' }, policy: { reasoningStrategy: 'reference', retrievalStrategy: 'auto' } };

test('evaluation distinguishes wrong semantics from invalid syntax and endpoint failure', async () => {
  const row = fixture();
  const correct = await evaluate([row], { config, predictor: () => row.sop_target });
  assert.equal(correct.metrics.execution_equivalence.numerator, 1);
  assert.equal(correct.model_identity_verified, false);
  const wrong = await evaluate([row], { config, predictor: () => row.sop_target.replace('parent ?who person_b', 'parent ?who person_c') });
  assert.equal(wrong.metrics.syntax.numerator, 1);
  assert.equal(wrong.metrics.runtime.numerator, 1);
  assert.equal(wrong.metrics.execution_equivalence.numerator, 0);
  assert.equal(wrong.records[0].predicted_status, 'unknown');
  const invalid = await evaluate([row], { config, predictor: () => 'not a SOP circuit' });
  assert.equal(invalid.metrics.syntax.numerator, 0);
  assert.equal(invalid.records[0].error.stage, 'parse');
  const unavailable = await evaluate([row], { config, source: 'endpoint', predictor: () => { throw Error('endpoint unavailable'); } });
  assert.equal(unavailable.requests_succeeded, 0);
  assert.equal(unavailable.evaluated_rows, 0);
  assert.equal(unavailable.evaluation_valid, false);
});

test('a broken gold oracle is a reference failure, not a model error', async () => {
  const row = fixture();
  row.expected.answers = [['person_c']];
  let invoked = false;
  const report = await evaluate([row], { config, predictor: () => { invoked = true; return row.sop_target; } });
  assert.equal(invoked, false);
  assert.equal(report.records[0].error.stage, 'reference');
  assert.equal(report.metrics.execution_equivalence.denominator, 0);
  assert.equal(report.evaluation_valid, false);
});

test('epistemic projection retains conflict, possibility and conditional incompleteness', () => {
  assert.deepEqual(epistemicResult({ status: 'both', complete: false, hypothetical: true }), {
    status: 'CONFLICT', runtime_status: 'both', complete: false, hypothetical: true, epistemic: null,
  });
  assert.equal(epistemicResult({ status: 'possible', complete: true }).status, 'POSSIBLE');
  assert.equal(epistemicResult({ status: 'hypotheses' }).status, 'PLAUSIBLE');
});

test('explicitly remembered user facts are isolated from predictions that omit them', async () => {
  const row = fixture();
  row.evaluation_track = 'system';
  row.input_mode = 'assertions_query';
  row.context_assertions = ['Person A is a parent of person B.'];
  row.setup_sop = '';
  const queryOnly = row.sop_target + '@s solve\n  query $q\n@answer cnl\n  result $s\n  language en\n';
  row.sop_target = `@observation fact\n  holds parent person_a person_b\n  valid timeless\n  source user\n  quote ${JSON.stringify(row.context_assertions[0])}\n@remember remember\n  input $observation\n  scope session\n` + queryOnly.replace('  query $q', '  query $q\n  after $remember');
  row.expected.session_claims = [{ holds:'parent person_a person_b', valid:'timeless', source:'user', quote:'Person A is a parent of person B.', retention:'normal' }];
  const correct = await evaluate([row], { config, predictor: () => row.sop_target });
  assert.equal(correct.records[0].reference_valid, true);
  assert.equal(correct.records[0].execution_equivalent, true);
  const missingAssertion = await evaluate([row], { config, predictor: () => queryOnly });
  assert.equal(missingAssertion.records[0].predicted_status, 'unknown');
  assert.equal(missingAssertion.records[0].execution_equivalent, false);
  const readOnly = await evaluate([row], { config: { ...config, policy: { ...config.policy, allowWrite: false } }, predictor: () => row.sop_target });
  assert.equal(readOnly.records[0].reference_valid, false);
  assert.equal(readOnly.records[0].error.stage, 'reference');
  const withoutProvenance = row.sop_target.replace(/  quote[^\n]*\n/, '');
  const wrongGold = await evaluate([{ ...row, sop_target:withoutProvenance }], { config, predictor: () => { throw Error('must not be called'); } });
  assert.equal(wrongGold.records[0].reference_valid, false);
  assert.equal(wrongGold.records[0].error.stage, 'reference');
});

test('a host-supplied case ontology is used by both execution guards without widening the model shortlist', async () => {
  const row = fixture();
  row.input_mode = 'query_only';
  row.ontology_sop = '@guides predicate\n  args person person\n  label en "guides"\n@person_a entity\n  kind person\n  label en "Person A"\n@person_b entity\n  kind person\n  label en "Person B"\n@person_c entity\n  kind person\n  label en "Person C"\n';
  row.context.predicates = [{ id: 'guides', args: ['person', 'person'] }];
  row.setup_sop = row.setup_sop.replace('parent ', 'guides ');
  row.sop_target = row.sop_target.replace('parent ', 'guides ');
  row.expected.packet = { complete: true };
  const correct = await evaluate([row], { config, predictor: () => row.sop_target });
  assert.deepEqual(correct.records[0].reference.answers, [['person_a']]);
  assert.equal(correct.records[0].execution_equivalent, true);
  const outside = await evaluate([row], { config, predictor: () => row.sop_target.replace('guides ', 'parent ') });
  assert.equal(outside.records[0].reference_valid, true);
  assert.equal(outside.records[0].runtime_valid, false);
  assert.equal(outside.records[0].error.stage, 'prediction');
});

test('literal answer packets cannot masquerade as executed reasoning or CNL', async () => {
  const row = fixture();
  const packet = { status:'supported', complete:true, answers:[{ binding:{ '?who':'person_a' } }] };
  const candidates = [
    `@fake value\n  data ${JSON.stringify(packet)}\n@answer cnl\n  result $fake\n  language en\n`,
    `@fake value\n  data ${JSON.stringify({ kind:'cnl', text:'Invented answer', packet })}\n`,
  ];
  for (const candidate of candidates) {
    const report = await evaluate([row], { config, predictor: () => candidate });
    assert.equal(report.records[0].reference_valid, true);
    assert.equal(report.records[0].runtime_valid, false);
    assert.equal(report.records[0].execution_equivalent, false);
    assert.equal(report.records[0].error.stage, 'prediction');
  }
});
