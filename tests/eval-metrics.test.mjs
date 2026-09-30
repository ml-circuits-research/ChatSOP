import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../eval/run.mjs';
import { computeMetrics } from '../eval/metrics.mjs';
import { readJsonlShardedSync } from '../lib/jsonl-shards.mjs';
import { repoPath } from './helpers.mjs';

// The evaluator over the model-language corpus (DS022): a stratified dev sample, two rows per family, so every
// question form and family is executed through eval/run.mjs with its referenced verification world.
const config = { memory: { engine: 'scan' }, policy: { reasoningStrategy: 'reference', retrievalStrategy: 'auto' } };
const dev = readJsonlShardedSync(repoPath('datasets_archive/formalizer-v1/dev.jsonl'));
const byFamily = new Map();
for (const row of dev) { if (!byFamily.has(row.family)) byFamily.set(row.family, []); byFamily.get(row.family).push(row); }
const sample = [...byFamily.values()].flatMap(rows => rows.slice(0, 2));

async function run(rows, changes = {}) {
  return evaluate(rows, { config, predictor: ({ id }) => changes[id] ?? rows.find(row => row.id === id).sop_target });
}

test('executed gold sanity check over every family preserves status, UNKNOWN and provenance', async () => {
  const report = await run(sample);
  const metrics = computeMetrics(sample, report);
  assert.equal(report.evaluation_valid, true, JSON.stringify(report.records.filter(record => record.error).slice(0, 3).map(record => [record.id, record.error])));
  assert.deepEqual(metrics.failure_ids_by_stage, { reference: [], generation: [], parse: [], prediction: [], semantic: [] });
  assert.equal(metrics.formalizer.execution_equivalence.value, 1);
  assert.equal(metrics.formalizer.wire_match.f1, 1); // gold predictions match every wire (DS016 "Wire F1")
  assert.equal(metrics.epistemic.unknown_calibration.recall.value, 1);
  assert.equal(metrics.epistemic.unauthorized_writes.numerator, 0);
  assert(metrics.reasoning_memory.effective_routes['deduce/js/no-fallback'] > 0);
  assert.equal(metrics.reasoning_memory.cuda_peak_bytes.value, null);
  // Every question type of the sample is grouped separately in the report.
  const types = new Set(sample.map(row => row.question_type));
  assert.deepEqual(new Set(Object.keys(report.by_question_type)), types);
});

test('syntax, semantic error and over-inference use executed outcomes', async () => {
  const whether = sample.filter(row => row.question_type === 'yes_no' && row.surface_ir?.query && !row.surface_ir.stated.length);
  const supported = whether.find(row => row.expected.status === 'supported'), unknown = whether.find(row => row.expected.status === 'unknown');
  const parseFailure = sample.find(row => row.id !== supported.id && row.id !== unknown.id);
  // An UNKNOWN row answered with another row's target is a semantic error (and not a formalization of it).
  const changes = { [parseFailure.id]: 'not a SOP circuit', [unknown.id]: supported.sop_target };
  const report = await run(sample, changes);
  const metrics = computeMetrics(sample, report);
  assert.deepEqual(metrics.failure_ids_by_stage.parse, [parseFailure.id]);
  assert.equal(metrics.formalizer.parse_rate.numerator, sample.length - 1);
  const record = report.records.find(item => item.id === unknown.id);
  assert.equal(record.execution_equivalent, false);
  assert.equal(record.canonical_match, false);
});

test('CONFLICT remains a conflict rather than supported or UNKNOWN', async () => {
  const rows = [...dev, ...readJsonlShardedSync(repoPath('eval/suites/formalizer-v1/test.jsonl'))].filter(row => row.expected?.status === 'both').slice(0, 3);
  assert.ok(rows.length > 0, 'the corpus has conflicting-report cases (query-v2 anchor)');
  const report = await run(rows);
  assert.equal(report.evaluation_valid, true);
  assert.ok(report.records.every(record => record.gold_status === 'both'));
  const metrics = computeMetrics(rows, report);
  assert.deepEqual(metrics.epistemic.contradictions_preserved, { numerator: rows.length, denominator: rows.length, value: 1 });
});

test('a prediction that records a session write the reference does not make is an unauthorized write', async () => {
  // A trusted system-track row that is allowed to write; its reference circuit only answers, so any recorded
  // claim in the prediction is unauthorized.
  const row = {
    id: 'system-no-write', semantic_case_id: 'system-no-write', split: 'test', language: 'en', evaluation_track: 'system', input_mode: 'assertions_query',
    question: 'Who is a parent of Sorin?', context: { now: '2026-09-28T12:00:00Z' },
    ontology_sop: '@mara entity\n  kind person\n  label en "Mara"\n@sorin entity\n  kind person\n  label en "Sorin"\n@victor entity\n  kind person\n  label en "Victor"\n@parent predicate\n  role subject person\n  role object person\n  label en "be a parent of"\n',
    setup_sop: '@f1 fact\n  holds parent mara sorin\n  valid timeless\n  source world\n',
    sop_target: '@q query\n  select ?who\n  where parent ?who sorin\n@answer solve\n  query $q\n',
    expected: { status: 'supported', answers: [['mara']] },
  };
  const write = '@w fact\n  holds parent victor sorin\n  valid timeless\n  source user\n@ws remember\n  input $w\n';
  const faithful = computeMetrics([row], await run([row]));
  assert.deepEqual(faithful.epistemic.unauthorized_writes, { numerator: 0, denominator: 1, value: 0 });
  const writing = await run([row], { [row.id]: write + row.sop_target });
  assert.equal(writing.records[0].runtime_valid, true, JSON.stringify(writing.records[0].error));
  assert.deepEqual(computeMetrics([row], writing).epistemic.unauthorized_writes, { numerator: 1, denominator: 1, value: 1 });
});
