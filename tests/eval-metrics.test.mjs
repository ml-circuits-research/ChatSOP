import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluate } from '../eval/run.mjs';
import { computeMetrics } from '../eval/metrics.mjs';

const load = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8').trim().split('\n').map(JSON.parse);
const config = { memory: { engine: 'scan' }, policy: { reasoningStrategy: 'reference', retrievalStrategy: 'auto' } };

async function run(rows, changes = {}) {
  return evaluate(rows, { config, predictor: ({ id }) => changes[id] ?? rows.find(row => row.id === id).sop_target });
}

test('executed gold sanity check preserves UNKNOWN, route, provenance, and stage measurements', async () => {
  const rows = load('../eval/suites/core-v2.jsonl');
  const report = await run(rows);
  const metrics = computeMetrics(rows, report);
  assert.equal(report.evaluation_valid, true);
  assert.deepEqual(metrics.failure_ids_by_stage, { reference: [], generation: [], parse: [], prediction: [], semantic: [] });
  assert.equal(metrics.formalizer.execution_equivalence.value, 1);
  assert.equal(metrics.formalizer.en_to_ro_transfer.value, 1);
  assert.equal(metrics.formalizer.hard_negative_discrimination.value, 1);
  assert.equal(metrics.epistemic.unknown_calibration.recall.value, 1);
  assert.equal(metrics.formalizer.abstention.value, 1);
  assert.equal(metrics.epistemic.over_inference.numerator, 0);
  assert.equal(metrics.epistemic.provenance_presence.value, 1);
  assert.equal(metrics.epistemic.unauthorized_writes.numerator, 0);
  assert.equal(metrics.reasoning_memory.answer_soundness.value, 1);
  assert.equal(metrics.reasoning_memory.proof_retrieval_recall.value, 1);
  assert(metrics.reasoning_memory.effective_routes['deduce/js/no-fallback'] > 0);
  assert(metrics.reasoning_memory.latency_ms.total.max >= 0);
  assert.equal(metrics.reasoning_memory.cuda_peak_bytes.value, null);
  assert.equal(metrics.epistemic.contradictions_preserved.value, null);
});

test('syntax, semantic error, over-inference and negative discrimination use executed outcomes', async () => {
  const rows = load('../eval/suites/core-v2.jsonl');
  const byId = new Map(rows.map(row => [row.id, row]));
  const changes = {
    'independent-parent-en': 'not a SOP circuit',
    'independent-reversal-en': byId.get('independent-parent-en').sop_target,
    'independent-missing-en': byId.get('independent-parent-en').sop_target,
  };
  const report = await run(rows, changes);
  const metrics = computeMetrics(rows, report);
  assert.deepEqual(metrics.failure_ids_by_stage.parse, ['independent-parent-en']);
  assert(metrics.failure_ids_by_stage.semantic.includes('independent-reversal-en'));
  assert(metrics.failure_ids_by_stage.semantic.includes('independent-missing-en'));
  assert.equal(metrics.formalizer.parse_rate.numerator, rows.length - 1);
  assert.equal(metrics.formalizer.hard_negative_discrimination.numerator, 0);
  assert(metrics.epistemic.over_inference.numerator > 0);
  assert(metrics.epistemic.unknown_calibration.recall.value < 1);
  assert(metrics.formalizer.en_to_ro_transfer.value < 1);
});

test('CONFLICT remains a conflict rather than supported or UNKNOWN', async () => {
  const row = load('../eval/suites/query-v1/test.jsonl').find(item => item.id === 'incident_conflict_en1');
  const report = await run([row]);
  assert.equal(report.evaluation_valid, true);
  assert.equal(report.records[0].gold_status, 'both');
  const metrics = computeMetrics([row], report);
  assert.deepEqual(metrics.epistemic.contradictions_preserved, { numerator: 1, denominator: 1, value: 1 });
  assert.equal(metrics.epistemic.unknown_calibration.recall.value, null);
});
