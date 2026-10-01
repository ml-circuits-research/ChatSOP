/**
 * Regression comparison of one symbolic_english row (DS008 "Three datasets") with what SymbolicLM produces now.
 * Pure functions; the runner is tools/symbolic-regression.mjs.
 *
 * Classes (in order of severity):
 *   same                        analysis and SOP identical
 *   analysis_changed_sop_same   the UD parse changed but the SOP did not (reported, not a failure)
 *   sop_changed_equivalent      the SOP text changed but still matches the gold SOP strictly (same or better)
 *   sop_changed                 the SOP changed and nothing verifies the new one (no gold, or gold no longer matched
 *                               is `now_failing`); fails the run until the row is re-judged or re-baselined
 *   now_failing                 the row was handled and now is not: invalid SOP, crash, a new unparsed span, or a lost
 *                               gold match; fails the run
 */
export const REGRESSION_CLASSES = Object.freeze(['same', 'analysis_changed_sop_same', 'sop_changed_equivalent', 'sop_changed', 'now_failing']);
export const FAILING_CLASSES = Object.freeze(['sop_changed', 'now_failing']);

const tokensOf = analysis => JSON.stringify((analysis?.sentences ?? []).map(s => [s.text, s.tokens]));

/** The current result of SymbolicLM in the stored shape (`sop`, `sop_valid`, `outcome`, `unparsed`, `analysis`). */
export function currentOf(result) {
  return {sop: result.sop, sop_valid: Boolean(result.valid), outcome: result.outcome, unparsed: (result.trace?.unparsed ?? []).map(u => u.span), analysis: result.analysis ?? null};
}

/**
 * Class of one row. `goldStillMatches` is true/false when the gold SOP of a gold-verified row was re-scored on the
 * new SOP, and null when there is no gold or it was not re-scored.
 */
export function classifyRow(row, now, {goldStillMatches = null} = {}) {
  const sameSop = row.sop === now.sop;
  const sameAnalysis = tokensOf(row.analysis) === tokensOf(now.analysis);
  const newUnparsed = now.unparsed.filter(span => !(row.unparsed ?? []).includes(span));
  const broken = !now.sop_valid || now.outcome === 'crash' || newUnparsed.length > 0;
  if (sameSop && sameAnalysis) return 'same';
  if (broken || goldStillMatches === false) return 'now_failing';
  if (sameSop) return 'analysis_changed_sop_same';
  return goldStillMatches === true ? 'sop_changed_equivalent' : 'sop_changed';
}

/** Zero-count table of the classes. */
export const emptyCounts = () => Object.fromEntries(REGRESSION_CLASSES.map(name => [name, 0]));
