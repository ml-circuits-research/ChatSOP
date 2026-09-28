import assert from 'node:assert/strict';
import { epistemicResult, fraction, distribution } from './contracts.mjs';
import { stable } from '../lib/util.mjs';

const rate = (items, predicate) => fraction(items.filter(predicate).length, items.length);
const keys = values => new Set(values.map(stable));
const same = (a, b) => stable(a) === stable(b);
const packet = record => record.observed?.packet;
const gold = record => record.reference?.packet;
const usable = record => record.reference_valid && record.runtime_valid;
// The evaluator signature is stable serialization, not JSON (it may contain undefined).
// Read only its session arrays; never reinterpret the whole signature as a packet.
function sessionField(serialized, name) {
  const marker = `${JSON.stringify(name)}:`;
  const start = serialized.indexOf(marker);
  assert(start >= 0 && serialized[start + marker.length] === '[', `Missing signature ${name}`);
  let depth = 0, quoted = false, escaped = false;
  for (let i = start + marker.length; i < serialized.length; i++) {
    const c = serialized[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return serialized.slice(start + marker.length, i + 1);
  }
  throw Error(`Unclosed signature ${name}`);
}
const proofIds = value => keys((value?.proof ?? []).filter(item => item.kind === 'observed').map(item => item.id).filter(Boolean));
const overlap = (a, b) => [...a].filter(value => b.has(value)).length;
const paired = (records, predicate) => {
  const groups = new Map();
  for (const record of records) {
    if (!groups.has(record.semantic_case_id)) groups.set(record.semantic_case_id, []);
    groups.get(record.semantic_case_id).push(record);
  }
  return [...groups.values()].filter(predicate);
};
const decision = value => epistemicResult(value).status;
const unknown = value => decision(value) === 'UNKNOWN';
const conflict = value => decision(value) === 'CONFLICT';
const evidencePresent = answer => Array.isArray(answer.evidence) && answer.evidence.length > 0;

/** Metrics are projections of evaluate() records. No model judgment or new gold oracle. */
export function computeMetrics(rows, report) {
  assert(Array.isArray(rows) && rows.length > 0, 'Metrics require nonempty evaluated rows');
  assert.equal(report.records?.length, rows.length, 'Metrics require the complete evaluator report');
  const byId = new Map(rows.map(row => [row.id, row]));
  assert.equal(byId.size, rows.length, 'Duplicate suite IDs');
  assert(report.records.every(record => byId.has(record.id)), 'Evaluator record not in suite');
  const records = report.records;
  const valid = records.filter(record => record.reference_valid);
  const executed = valid.filter(record => record.runtime_valid);
  const formal = valid.filter(record => byId.get(record.id).evaluation_track === 'formalization');
  const failures = Object.fromEntries(['reference', 'generation', 'parse', 'prediction'].map(stage =>
    [stage, records.filter(record => record.error?.stage === stage).map(record => record.id)]));
  failures.semantic = valid.filter(record => record.runtime_valid && !record.execution_equivalent).map(record => record.id);
  const invariance = paired(formal, group => group.length > 1);
  const negativePairs = new Map();
  for (const row of rows) if (row.negative_of && row.evaluation_track === 'formalization') {
    const pair = [row.semantic_case_id, row.negative_of].sort();
    negativePairs.set(pair.join('\0'), pair);
  }
  const byCase = new Map();
  for (const record of formal) {
    if (!byCase.has(record.semantic_case_id)) byCase.set(record.semantic_case_id, []);
    byCase.get(record.semantic_case_id).push(record);
  }
  const transfer = [...byCase.values()].filter(group => group.some(r => r.language === 'en') && group.some(r => r.language === 'ro'));
  const unknownGold = valid.filter(record => unknown(gold(record)));
  const knownGold = valid.filter(record => !unknown(gold(record)));
  const conflicts = valid.filter(record => conflict(gold(record)));
  const predictionsWithProof = executed.filter(record => (packet(record).proof ?? []).length > 0 || (packet(record).answers ?? []).length > 0);
  const expectedWithProof = executed.filter(record => (gold(record).proof ?? []).length > 0);
  const proofPairs = executed.map(record => [proofIds(packet(record)), proofIds(gold(record))]);
  const retrieved = proofPairs.reduce((total, [actual]) => total + actual.size, 0);
  const relevant = proofPairs.reduce((total, [, expected]) => total + expected.size, 0);
  const matched = proofPairs.reduce((total, [actual, expected]) => total + overlap(actual, expected), 0);
  const soundnessPairs = executed.map(record => [keys(record.observed.answers ?? []), keys(record.reference.answers ?? [])]);
  const predictedAnswers = soundnessPairs.reduce((n, [actual]) => n + actual.size, 0);
  const goldAnswers = soundnessPairs.reduce((n, [, expected]) => n + expected.size, 0);
  const correctAnswers = soundnessPairs.reduce((n, [actual, expected]) => n + overlap(actual, expected), 0);
  const retrievalPackets = executed.filter(record => packet(record).linkPlan?.retrievals?.length);
  const timed = ['model', 'setup', 'gold', 'prediction', 'total'];
  const budgetFields = ['memoryProbes', 'retrieved', 'closureFacts', 'rounds'];
  return {
    format: 'chatsop-metrics-v1', source: report.source,
    run_label: report.run_label ?? 'explicit predictions (model identity unverified)',
    suite_sha256: report.suite_sha256, config_sha256: report.config_sha256,
    evaluation_valid: report.evaluation_valid, rows: records.length, valid_references: valid.length, executed_predictions: executed.length,
    failure_ids_by_stage: failures,
    formalizer: {
      parse_rate: rate(formal, r => r.syntax_valid),
      canonical_ast_match: rate(formal, r => r.canonical_match),
      execution_equivalence: rate(formal, r => r.execution_equivalent),
      answer_correctness: rate(formal, r => usable(r) && same(r.observed.answers, r.reference.answers) && decision(packet(r)) === decision(gold(r))),
      symbol_choice: rate(formal.filter(r => gold(r).query), r => r.runtime_valid &&
        same(['mode', 'where', 'select'].map(key => packet(r).query?.[key]), ['mode', 'where', 'select'].map(key => gold(r).query[key]))),
      paraphrase_invariance: rate(invariance, group => group.every(r => r.execution_equivalent && r.runtime_valid) &&
        new Set(group.map(r => r.prediction_signature)).size === 1),
      hard_negative_discrimination: rate([...negativePairs.values()], ([a, b]) => {
        const members = [...(byCase.get(a) ?? []), ...(byCase.get(b) ?? [])];
        return byCase.has(a) && byCase.has(b) && members.every(r => r.execution_equivalent) &&
          new Set((byCase.get(a) ?? []).map(r => r.reference_signature)).size === 1 &&
          new Set((byCase.get(b) ?? []).map(r => r.reference_signature)).size === 1 &&
          byCase.get(a)[0].reference_signature !== byCase.get(b)[0].reference_signature;
      }),
      abstention: rate(formal.filter(r => unknown(gold(r)) || decision(gold(r)) === 'AMBIGUOUS'),
        r => r.runtime_valid && decision(packet(r)) === decision(gold(r)) && r.execution_equivalent),
      en_to_ro_transfer: rate(transfer, group => group.filter(r => r.language === 'ro').every(r => r.execution_equivalent) &&
        group.filter(r => r.language === 'en').every(r => r.execution_equivalent)),
    },
    epistemic: {
      unknown_calibration: {
        recall: rate(unknownGold, r => r.runtime_valid && unknown(packet(r))),
        false_unknown_rate: rate(knownGold, r => r.runtime_valid && unknown(packet(r))),
      },
      contradictions_preserved: rate(conflicts, r => r.runtime_valid && conflict(packet(r)) &&
        same(packet(r).conflictedAnswers ?? [], gold(r).conflictedAnswers ?? [])),
      over_inference: rate(valid.filter(r => unknown(gold(r)) || conflict(gold(r))), r =>
        r.runtime_valid && !unknown(packet(r)) && !conflict(packet(r))),
      provenance_presence: rate(predictionsWithProof, r => {
        const proof = packet(r).proof ?? [];
        const ids = new Set(proof.map(item => item.id));
        return (packet(r).answers ?? []).every(answer => evidencePresent(answer) && answer.evidence.every(id => ids.has(id))) &&
          proof.every(item => item.kind === 'derived'
            ? typeof item.rule === 'string' && Array.isArray(item.from) && item.from.length > 0 && item.from.every(id => ids.has(id))
            : typeof item.source === 'string' && item.source.length > 0 && typeof item.quote === 'string' && item.quote.length > 0);
      }),
      provenance_recall: rate(expectedWithProof, r => proofIds(gold(r)).size === overlap(proofIds(packet(r)), proofIds(gold(r)))),
      retractions_preserved: rate(valid.filter(r =>
        (gold(r).defeatedAssumptions ?? []).length > 0 ||
        sessionField(r.reference_signature, 'events').includes('"retract"')),
      r => r.runtime_valid && same(packet(r).defeatedAssumptions ?? [], gold(r).defeatedAssumptions ?? []) &&
        sessionField(r.prediction_signature, 'events') === sessionField(r.reference_signature, 'events')),
      unauthorized_writes: rate(executed, r => {
        const actual = ['claims', 'events'].map(field => sessionField(r.prediction_signature, field));
        const expected = ['claims', 'events'].map(field => sessionField(r.reference_signature, field));
        return byId.get(r.id).evaluation_track === 'formalization'
          ? actual.some(value => value !== '[]')
          : !same(actual, expected);
      }),
    },
    reasoning_memory: {
      answer_soundness: fraction(correctAnswers, predictedAnswers),
      answer_coverage: fraction(correctAnswers, goldAnswers),
      proof_retrieval_precision: fraction(matched, retrieved),
      proof_retrieval_recall: fraction(matched, relevant),
      retrieval_complete: rate(retrievalPackets, r => packet(r).linkPlan.retrievals.every(item => item.complete === true)),
      execution_complete: rate(executed.filter(r => typeof packet(r).complete === 'boolean'), r => packet(r).complete === true),
      budget_diagnostics: Object.fromEntries(budgetFields.map(field => [field, distribution(executed.map(r => packet(r).diagnostics?.[field]).filter(Number.isFinite))])),
      effective_routes: records.reduce((counts, r) => {
        if (r.runtime_valid) {
          const route = packet(r).route;
          const label = route ? `${route.operation}/${route.backend}/${route.fallback ?? 'no-fallback'}` : 'not-reported';
          counts[label] = (counts[label] ?? 0) + 1;
        }
        return counts;
      }, {}),
      retrieval_routes: records.reduce((counts, r) => {
        if (r.runtime_valid) for (const item of packet(r).linkPlan?.retrievals ?? []) {
          const label = `${item.strategy ?? 'not-reported'} -> ${item.selected ?? 'not-reported'}`;
          counts[label] = (counts[label] ?? 0) + 1;
        }
        return counts;
      }, {}),
      latency_ms: Object.fromEntries(timed.map(stage => [stage, distribution(records.map(r => r.timing_ms?.[stage]).filter(Number.isFinite))])),
      sampled_peak_rss_bytes: report.memory?.sampled_peak_rss_bytes ?? null,
      cuda_peak_bytes: { value: null, measurement: 'not measured' },
    },
    limitations: [
      'Executed gold is ground truth only on the finite suite; no universal semantic equivalence is claimed.',
      'Proof retrieval compares cited observed claim IDs, not all potentially relevant records in memory.',
      'Retraction coverage requires exposed defeatedAssumptions or a gold session retract event; a zero denominator means not exercised.',
      'Unauthorized-write checks compare successful execution session signatures; blocked attempts appear under prediction-stage failures.',
      'RSS is sampled between cases, not a continuous peak; CUDA is not measured.',
      'No neural model was evaluated unless externally supplied predictions independently establish that fact.',
    ],
  };
}
