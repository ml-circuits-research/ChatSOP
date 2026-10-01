import assert from 'node:assert/strict';
import { epistemicResult, fraction, distribution } from './contracts.mjs';
import { stable } from '../lib/util.mjs';
import { referenceFreeMetrics } from './reference-free.mjs';
import { slices } from './slices.mjs';
import { parse } from '../sop/parser.mjs';
import { wireItems, matchItems, foldText } from './propositions.mjs';

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

/**
 * Partial-credit wire match (DS016 "Wire F1"). Every wire of the gold and of the prediction becomes an
 * order- and id-free item (`wireItems` in eval/propositions.mjs): a `stated`/`assumed` wire is its kind, folded
 * relation phrase, role names with folded values, polarity, validity and link lines (certainty, speaker and basis
 * are ignored); any other wire (`query`, `constraint`, `unclear`) is its kind plus its fields with quoted strings
 * folded (case, diacritics, whitespace), variables renamed by first appearance and `basis` dropped. Wire ids never
 * matter: a `$id` role value, a link target or a `near` is keyed as the referenced wire's own item. `unparsed`
 * wires are not matched; they are counted apart and drive the understood-part credit. Gold and prediction are
 * matched as multisets, strictly (equal keys) and tolerantly (relation phrases and quoted values compared by
 * `Dictionary.sameMeaning`). The prediction is parsed wire by wire, so a truncated or partly malformed output
 * still earns credit for its well-formed wires (an unparsable wire counts as predicted and unmatched). This is a
 * diagnostic beside execution equivalence, not a replacement.
 */
export const WIRE_GROUPS = Object.freeze({ stated: 'statements', assumed: 'statements', query: 'problems', constraint: 'problems', unclear: 'unclear', unparsed: 'unparsed' });
const wireBlocks = text => String(text ?? '').split(/\n(?=@)/).map(block => block.trim()).filter(block => block.startsWith('@'));
const INVALID = Object.freeze({ group: 'invalid', key: null, skeleton: null, slots: [] });
/** Items of a program's wires; with `lenient`, each `@` block is parsed alone and an unparsable one keeps a null key. */
export function wireKeyItems(text, { lenient = false } = {}) {
  const keyed = wires => wireItems(wires).map(item => ({ ...item, group: WIRE_GROUPS[item.type] ?? 'other' }));
  if (!lenient) return keyed(parse(text).wires);
  const blocks = wireBlocks(text);
  if (!blocks.length && String(text ?? '').trim()) return [INVALID];
  const parsed = blocks.map(block => { try { return parse(block).wires; } catch { return null; } });
  const items = keyed(parsed.filter(Boolean).flat());
  let at = 0;
  return parsed.flatMap(wires => wires ? wires.map(() => items[at++]) : [INVALID]);
}
/** Keys of a program's wires ({group, key}); see `wireKeyItems`. */
export const wireKeys = (text, options) => wireKeyItems(text, options).map(({ group, key }) => ({ group, key }));
/** The span text of an `unparsed` item (the slot after its `span` keyword). */
const spanOf = item => { const at = item.parts.indexOf(' span '); return at >= 0 && typeof item.parts[at + 1] === 'object' ? item.parts[at + 1].text : null; };
const f1Of = (matched, gold, predicted) => gold + predicted === 0 ? 1 : 2 * matched / (gold + predicted);
const harmonic = (p, r) => p === null || r === null ? null : p + r === 0 ? 0 : 2 * p * r / (p + r);
const ratio = (n, d) => d ? n / d : null;
/**
 * Wire comparison of one prediction against one gold SOP text (see `wireItems`). Besides the strict counts it
 * reports `tolerant_matched`/`tolerant_f1` and the understood-part counts: a gold wire is `excluded` when one of
 * its quoted values lies inside a span of a predicted `unparsed` wire (folded containment); `understood_*` is
 * precision over predicted non-`unparsed` wires and recall over the gold wires not excluded.
 */
export function compareWires(goldText, predictedText) {
  const goldAll = wireKeyItems(goldText), predictedAll = typeof predictedText === 'string' ? wireKeyItems(predictedText, { lenient: true }) : [];
  const gold = goldAll.filter(item => item.group !== 'unparsed'), predicted = predictedAll.filter(item => item.group !== 'unparsed');
  const goldUnparsed = goldAll.filter(item => item.group === 'unparsed'), predictedUnparsed = predictedAll.filter(item => item.group === 'unparsed');
  const strict = matchItems(gold, predicted), tolerant = matchItems(gold, predicted, { tolerant: true });
  const part = group => {
    const g = gold.filter(item => item.group === group), p = predicted.filter(item => item.group === group);
    return { gold: g.length, predicted: p.length, matched: matchItems(g, p).matched };
  };
  const problems = part('problems');
  // Understood parts: spans the prediction marked `unparsed` excuse the gold wires whose values they contain.
  const spans = predictedUnparsed.map(spanOf).filter(Boolean).map(foldText).filter(Boolean);
  const excluded = new Set(gold.map((item, index) => [item, index]).filter(([item]) =>
    item.slots.some(s => s.slot === 'value' && foldText(s.text) && spans.some(span => span.includes(foldText(s.text))))).map(([, index]) => index));
  const understood = matches => {
    const goldCount = gold.length - excluded.size;
    const goldMatched = [...matches.goldMatched].filter(index => !excluded.has(index)).length;
    const precision = ratio(matches.matched, predicted.length), recall = ratio(goldMatched, goldCount);
    return { gold: goldCount, gold_matched: goldMatched, predicted: predicted.length, matched: matches.matched,
      f1: goldCount + predicted.length === 0 ? 1 : harmonic(precision ?? 0, recall ?? 0) };
  };
  return {
    gold: gold.length, predicted: predicted.length, matched: strict.matched, f1: f1Of(strict.matched, gold.length, predicted.length),
    tolerant_matched: tolerant.matched, tolerant_f1: f1Of(tolerant.matched, gold.length, predicted.length),
    statements: part('statements'), problems, unparsable: predicted.filter(item => item.group === 'invalid').length,
    problems_correct: problems.gold > 0 && problems.matched === problems.gold && problems.predicted === problems.gold,
    gold_unparsed: goldUnparsed.length, unparsed: predictedUnparsed.length, unparsed_matched: matchItems(goldUnparsed, predictedUnparsed).matched,
    excluded_by_unparsed: excluded.size, understood: understood(strict), understood_tolerant: understood(tolerant),
  };
}
/**
 * Tolerant canonical match: every wire of the prediction pairs with a wire of the gold and back, with relation
 * phrases and quoted values compared by the dictionary (`unparsed` wires strictly), and nothing is unparsable.
 */
export function tolerantCanonicalMatch(goldText, predictedText) {
  const c = compareWires(goldText, predictedText);
  return c.unparsable === 0 && c.tolerant_matched === c.gold && c.gold === c.predicted && c.unparsed_matched === c.gold_unparsed && c.gold_unparsed === c.unparsed;
}
/** Best wire comparison over the primary gold and every accepted gold of a row (highest F1, then most matches). */
export function rowWireComparison(row, predictedText) {
  const targets = [row.sop_target ?? row.target, ...(row.sop_targets_accepted ?? [])].filter(text => typeof text === 'string');
  return targets.map(text => compareWires(text, predictedText)).sort((a, b) => b.f1 - a.f1 || b.matched - a.matched || b.tolerant_f1 - a.tolerant_f1)[0];
}
export const WIRE_F1_THRESHOLD = 0.9;
/** Aggregate wire comparisons: micro precision/recall/F1, mean row F1, rows at F1 >= 0.9 and query-only correctness. */
export function wireMetrics(comparisons) {
  const sum = (key, group) => comparisons.reduce((n, c) => n + ((group ? c[group][key] : c[key]) ?? 0), 0);
  const micro = group => {
    const matched = sum('matched', group), gold = sum('gold', group), predicted = sum('predicted', group);
    return { precision: fraction(matched, predicted), recall: fraction(matched, gold), f1: gold + predicted ? 2 * matched / (gold + predicted) : null };
  };
  const withProblems = comparisons.filter(c => c.problems.gold > 0);
  const tolerantMicro = () => {
    const matched = sum('tolerant_matched'), gold = sum('gold'), predicted = sum('predicted');
    return { precision: fraction(matched, predicted), recall: fraction(matched, gold), f1: gold + predicted ? 2 * matched / (gold + predicted) : null };
  };
  const understoodMicro = name => {
    const total = key => comparisons.reduce((n, c) => n + (c[name]?.[key] ?? 0), 0);
    const precision = fraction(total('matched'), total('predicted')), recall = fraction(total('gold_matched'), total('gold'));
    return { precision, recall, f1: harmonic(precision.value, recall.value) };
  };
  return {
    rows: comparisons.length, ...micro(null),
    mean_row_f1: comparisons.length ? comparisons.reduce((n, c) => n + c.f1, 0) / comparisons.length : null,
    rows_f1_at_least_0_9: fraction(comparisons.filter(c => c.f1 >= WIRE_F1_THRESHOLD).length, comparisons.length),
    statements: micro('statements'), problems: micro('problems'),
    problems_correct: fraction(withProblems.filter(c => c.problems_correct).length, withProblems.length),
    unparsable_wires: sum('unparsable'),
    // Tolerant: relation phrases and quoted values compared by the dictionary (Dictionary.sameMeaning).
    tolerant: tolerantMicro(),
    mean_row_f1_tolerant: comparisons.length ? comparisons.reduce((n, c) => n + (c.tolerant_f1 ?? 0), 0) / comparisons.length : null,
    // Partial credit over the understood parts (DS016 "Honest partial formalization").
    understood: understoodMicro('understood'), understood_tolerant: understoodMicro('understood_tolerant'),
    unparsed_wires: sum('unparsed'), gold_unparsed_wires: sum('gold_unparsed'), gold_wires_excluded_by_unparsed: sum('excluded_by_unparsed'),
  };
}

/** Metrics are projections of evaluate() records. No model judgment or new gold oracle. */
export function computeMetrics(rows, report, {withSlices = true} = {}) {
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
      // Equivalence tolerance (DS016): the strict metrics above accept any accepted gold (`sop_targets_accepted`);
      // `_primary` compares with `sop_target` only; `_tolerant` also links with evaluation-only relation synonyms.
      execution_equivalence_tolerant: rate(formal, r => r.execution_equivalent_tolerant),
      canonical_ast_match_tolerant: rate(formal, r => r.canonical_match_tolerant),
      canonical_ast_match_primary: rate(formal, r => r.canonical_match_primary),
      execution_equivalence_primary: rate(formal, r => r.execution_equivalent_primary),
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
      // Partial credit (DS016 "Wire F1"): an additional diagnostic; the execution metrics above stay primary.
      wire_match: wireMetrics(formal.map(r => rowWireComparison(byId.get(r.id), r.prediction))),
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
    // Reference-free metrics: computed from the message and the prediction only (eval/reference-free.mjs).
    reference_free: referenceFreeMetrics(records.map(r => r.reference_free)),
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
    // Every metric above by question type, language (en/ro/mixed), noise level, family and the hard slice (eval/slices.mjs).
    ...(withSlices ? { slices: slices(records, group => {
      const ids = new Set(group.map(r => r.id));
      const part = computeMetrics(rows.filter(row => ids.has(row.id)), { ...report, records: group }, { withSlices: false });
      return { rows: part.rows, valid_references: part.valid_references, formalizer: part.formalizer, epistemic: part.epistemic, reference_free: part.reference_free };
    }) } : {}),
    limitations: [
      'Executed gold is ground truth only on the finite suite; no universal semantic equivalence is claimed.',
      'Reference-free metrics are plausibility checks with heuristic EN/RO detectors (question form, negation cues, gibberish); passing them does not make a prediction correct.',
      'Proof retrieval compares cited observed claim IDs, not all potentially relevant records in memory.',
      'Retraction coverage requires exposed defeatedAssumptions or a gold session retract event; a zero denominator means not exercised.',
      'Unauthorized-write checks compare successful execution session signatures; blocked attempts appear under prediction-stage failures.',
      'RSS is sampled between cases, not a continuous peak; CUDA is not measured.',
      'No neural model was evaluated unless externally supplied predictions independently establish that fact.',
    ],
  };
}
