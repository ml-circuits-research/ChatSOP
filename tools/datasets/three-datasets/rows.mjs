/** Small predicates over symbolic_english / neuro_english rows shared by the tools (DS008 "Three datasets", analysis-layer membership). */

/**
 * The SOP Lang built from the analysis equals the row's gold SOP (strictly). Since the analysis-layer re-split this is the SOP layer (`sop_layer.status: match`),
 * not the membership criterion. `analysis_verified: gold_sop_match` is the retired name that production rows (tools/datasets/add-case.mjs) still carry.
 */
export const hasGoldMatch = row => row?.sop_layer?.status === 'match' || (row?.sop_layer === undefined && row?.analysis_verified === 'gold_sop_match');

/** A row whose analysis passed the gate, or that the SOP rules placed because the gate cannot judge it (`no_analysis`, `unparsed_span`). */
export const isAnalysisVerified = row => ['analysis_gate', 'sop_rule'].includes(row?.analysis_verified);
