/** Stage A of the oracle, shared by the train/dev side (tools/datasets/neuro-targets-oracle.mjs) and the sealed side
 * (tools/eval/neuro-oracle-test.mjs): SymbolicLM on every candidate of a set of neuro rows (the current rules over the
 * recorded accurate parses), the strict gold comparison (the SOP layer and the meaning signal of a gold row) and the tree agreement of the default and accurate packages
 * (the first half of the analysis gate, for every candidate).
 * The caller supplies the rows, the legacy gold files and, for wild rows, the accepted-gold scorer, so this module never
 * names a sealed file.
 */
import {normalText} from '../three-datasets/inputs.mjs';
import {mainForm} from '../three-datasets/forms.mjs';
import {classifyRow} from '../three-datasets/decomposition.mjs';
import {maskMessage} from '../../../lib/ud-to-sop/index.mjs';
import {candidateList, readTargets, ParseStore} from './common.mjs';
import {analyseCandidates, goldSources, goldMatches, defaultTrees, treeAgreement} from './classify.mjs';

/** Candidates of the rows by id: matching counts for a set of rows (`others`: rows of symbolic_english, to count the moved ones). */
export function matchRows(rows, symbolicIds = new Set()) {
  const {inputs, outputs} = readTargets();
  const byId = new Map(rows.map(r => [r.id, r]));
  const counts = {rows: rows.length, rows_with_output: 0, rows_with_candidates: 0, rows_unchanged: 0, rows_without_output: 0, candidates: 0, message_changed: 0};
  for (const r of rows) {
    const out = outputs.get(r.id);
    if (!out) { counts.rows_without_output++; continue; }
    counts.rows_with_output++;
    if (out.unchanged) counts.rows_unchanged++; else counts.rows_with_candidates++;
    counts.candidates += out.candidates?.length ?? 0;
    if (inputs.get(r.id) !== r.message) counts.message_changed++;
  }
  const moved = {ids_now_in_symbolic_english: 0, candidates_dropped_symbolic: 0};
  for (const [id, out] of outputs) if (!byId.has(id) && symbolicIds.has(id)) { moved.ids_now_in_symbolic_english++; moved.candidates_dropped_symbolic += out.candidates?.length ?? 0; }
  return {outputs, byId, counts, moved};
}

/** One record per row: split, failure kind, form, structural type, output state (no message text). */
export function rowRecords(rows, outputs) {
  return rows.map(r => {
    const shape = classifyRow({message: r.message, analysis: r.analysis});
    const out = outputs.get(r.id);
    return {id: r.id, split: r.split, failure_kind: r.failure_kind ?? null, has_gold: Boolean(r.gold_sop), rewrite_target: r.rewrite_target !== false, form: mainForm(r.analysis) ?? 'no analysis', shape_type: shape.candidate ? (shape.type ?? 'other') : 'single clause', output: out ? (out.unchanged ? 'unchanged' : 'candidates') : 'none', corpus: r.source?.corpus ?? null};
  });
}

/** Stage records of every candidate of `rows`. */
export async function stageRows({rows, outputs, goldFiles, wildScore = null}) {
  const byId = new Map(rows.map(r => [r.id, r]));
  const list = candidateList(outputs, rows).filter(c => byId.has(c.id));
  const results = await analyseCandidates(list);
  const {sources, missing} = goldSources(rows, goldFiles);
  const gold = await goldMatches(list, results, byId, sources, {wildScore});
  const defaults = new ParseStore('default').load();
  const stage = list.map(c => {
    const row = byId.get(c.id), r = results.get(c.cid), g = gold.get(c.cid), hasGold = Boolean(row.gold_sop);
    const parsed = r.sentences.length > 0;
    const sopOk = r.valid && r.unparsed.length === 0 && r.outcome === 'converted';
    // The tree half of the analysis gate applies to every candidate, gold or not (analysis-layer verification, DS008 "Three datasets").
    const trees = parsed ? treeAgreement(r.sentences, defaultTrees(c.text, defaults, maskMessage)) : null;
    // SOP layer (the later layer; engine-gaps and the row kinds read it): what SymbolicLM built from the candidate and, for a gold row, the gold comparison.
    let sopStage;
    if (normalText(c.text) === normalText(row.message)) sopStage = 'equals_message';
    else if (!r.valid || r.outcome === 'crash') sopStage = 'invalid_sop';
    else if (r.unparsed.length) sopStage = 'unparsed_span';
    else if (r.outcome !== 'converted') sopStage = 'not_converted';
    else if (hasGold) sopStage = !sources.has(c.id) ? 'gold_unscorable' : g?.ok ? 'gold_match' : 'gold_mismatch';
    else sopStage = 'no_gold';
    // Analysis layer: the candidate needs an analysis whose trees agree between the packages; the judge half (DeepSeek a and c) and the meaning follow in merge.mjs.
    // A strict or normalized gold match is a meaning signal; every other candidate goes to `to_judge` (gate, then the meaning check).
    let stage;
    if (sopStage === 'equals_message') stage = 'equals_message';
    else if (!parsed) stage = 'no_analysis';
    else if (!trees.identical) stage = 'tree_disagree';
    else if (sopStage === 'gold_match') stage = 'gold_match';
    else if (sopStage === 'gold_mismatch' && g?.frame_ok) stage = 'gold_mismatch';
    else stage = 'to_judge';
    return {cid: c.cid, id: c.id, n: c.n, src: c.src, split: row.split, has_gold: hasGold, stage, sop_stage: sopStage, sop_ok: sopOk, frame_ok: Boolean(g?.frame_ok && !g?.ok), outcome: r.outcome, unparsed: r.unparsed, uncertain: r.uncertain, reasons: r.reasons, sentences: r.sentences.length, trees: trees?.sentences ?? null, sop: r.sop};
  });
  return {stage, candidates: list, gold_sources_missing: missing.length};
}
