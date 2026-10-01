/** Placement of the working-data additions (composed paragraphs, form variants) by the analysis gate (DS008 "Three datasets", analysis-layer membership).
 *
 * The generators (tools/datasets/composed-train.mjs, form-variants.mjs) build a candidate row with the fields both datasets share. Its
 * dataset is then decided like every other clean-English row: `symbolic_english` when every sentence of the message passes the gate of
 * analysis-gate.mjs, `neuro_english` otherwise (a paragraph whose sentences fail has no rewrite target unless the generator built one). The SOP comparison
 * that the generator made (an exact match with the concatenated expected SOPs, or none) is kept as `sop_layer`.
 */
import {GATE_NAME, verdictRecord, judgeSummary} from './analysis-gate.mjs';

/** Gate decisions for candidate rows `{message, analysis}`: stages the missing parses and judge items, returns {decisions: Map(message -> decision), summary}. */
export async function decideAdditions(gate, rows, {record = true, log = () => {}} = {}) {
  const {stage} = await import('./analysis-gate.mjs');
  const entries = rows.map(r => ({text: r.message, analysis: r.analysis}));
  const summary = await stage(gate, entries, {record, log});
  const decisions = new Map(rows.map(r => [r.message, gate.compute(r.message, r.analysis)]));
  return {decisions, summary};
}

/**
 * The row in its dataset. `base`: the candidate's common fields (id, split, split_group_id, message, source, rights, quality_flags, review_status, analysis, sop, sop_valid, outcome,
 * unparsed, uncertain, symbolic_lm and the generator's own fields). `opts`: {gold_sop, sopMatch (true, false or null), target, targetSource, targets, verification (extra keys)}.
 */
export function placeRow(base, decision, {gold_sop = null, sopMatch = null, target = null, targetSource = null, targets = [], verification = {}, failureExtra = {}} = {}) {
  const sop_layer = {status: sopMatch === null ? 'no_gold' : sopMatch ? 'match' : 'mismatch', handled: Boolean(base.sop_valid) && base.outcome === 'converted' && !(base.unparsed ?? []).length, failure_kind: sopMatch === false ? 'unknown' : null, failure: null};
  const analysis_verdict = {...verdictRecord(decision, {unparsed: base.unparsed ?? []}), placed_by: 'analysis_gate'};
  const common = {...base, gold_sop, analysis_verdict, sop_layer};
  const verify = {sop_gold_match: sopMatch, judge: judgeSummary(decision), stanza_spacy_agree: null, stanza_default_accurate: decision.worst_tree ?? 'not_measured', ...verification};
  if (decision.state === 'pass') return {...common, dataset: 'symbolic_english', analysis_verified: 'analysis_gate', verification: verify};
  const pending = decision.state === 'pending';
  const flags = [...(target ? [] : ['no_target']), ...(pending ? ['pending_judge'] : [])];
  return {...common, dataset: 'neuro_english', failure_kind: pending ? 'pending_judge' : (decision.failure_kind ?? 'unknown'),
    failure: {layer: 'analysis', reasons: decision.reasons, categories: pending ? ['pending_judge'] : [...new Set(decision.reasons.map(x => x.kind))], classes: [], frame_recoverable: false, proofing_layer: null, also_gold_convention: false, unparsed: base.unparsed ?? [], gate: GATE_NAME, ...failureExtra},
    rewrite_target: true, target, target_source: targetSource, targets, ...(flags.length ? {flags} : {}), analysis_verified: pending ? 'analysis_pending_judge' : 'analysis_gate_failed', verification: verify};
}
