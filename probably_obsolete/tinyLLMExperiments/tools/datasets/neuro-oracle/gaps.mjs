/** Engine gaps of the gold-row candidates: what SymbolicLM does not reproduce of the gold SOP when it reads a DeepSeek rewrite.
 *
 * Every candidate of a gold row that is not a strict match (`gold_mismatch`, `unparsed_span`, `not_converted`) becomes a record
 * with the candidate and the gold SOP, the structural diff categories of tools/research/symbolic-layers-diff.mjs (`R_*` the rules
 * miss or build wrongly, `P_*` parser or lemma, `C_*` gold convention) and mechanical gap tags recognised from the wording:
 * numeric word problems (a constraint the engine does not build), alternative questions, partitive counts, besides/other than,
 * a stranded preposition at the end of a question. A tag says the wording has that shape, not that it is the only cause.
 */
import {diffCategories, classesOf} from '../../research/symbolic-layers-diff.mjs';

const TAGS = [
  ['numeric_word_problem', text => (text.match(/\b\d+(?:[.,]\d+)?\b/g) ?? []).length >= 2 && /\bhow (?:many|much|long|far|old)\b/i.test(text)],
  ['alternative_question', text => /\?/.test(text) && /\b(?:is|are|was|were|does|do|did|can|which|who|what)\b[^?.]*\bor\b[^?.]*\?/i.test(text)],
  ['partitive_count', text => /\bhow many of\b|\bhow many\b[^?.]*\bof (?:the|these|those|my|our|his|her|their)\b/i.test(text)],
  ['besides_except', text => /\b(?:besides|other than|apart from|aside from|except(?: for)?|excluding)\b/i.test(text)],
  ['stranded_preposition', text => /\b(?:of|to|in|on|at|by|for|with|from|about|under|over|near)\s*\?\s*$/i.test(text.trim())],
  // a relative pronoun after a noun; indirect questions ("do you know who ...") are not relative clauses
  ['relative_clause', text => /[a-z0-9,]\s+(?:who|which|whose)\s+\w+/i.test(text.replace(/\b(?:know|tell|ask|check|wonder|wondering|see|confirm|verify|find out|find|me|us|remind|say|explain|show|learn|understand|whether|if)\s+(?:me\s+)?(?:who|which|whose)\b/gi, ' '))],
  ['several_sentences', text => (text.match(/[.?!](?:\s|$)/g) ?? []).length >= 3],
];

export const gapTags = text => TAGS.filter(([, test]) => test(text)).map(([name]) => name);

/**
 * `stage`: stage records; `cands`: Map(cid -> {text}); `rows`: Map(id -> neuro row, for `message` and `gold_sop`).
 * Returns {rows: [...], byTag, byCategory, byStage}.
 */
export function engineGaps(stage, cands, rows) {
  const out = [], byTag = {}, byCategory = {}, byStage = {};
  for (const r of stage) {
    const sopStage = r.sop_stage ?? r.stage; // the SOP layer of the candidate (the analysis-layer `stage` may be tree_disagree for the same candidate)
    if (!r.has_gold || !['gold_mismatch', 'unparsed_span', 'not_converted'].includes(sopStage)) continue;
    const row = rows.get(r.id), cand = cands.get(r.cid);
    if (!row?.gold_sop || !cand) continue;
    let categories = [];
    try { categories = diffCategories(r.sop, row.gold_sop, {executed: row.source?.corpus !== 'formalizer-wild-v1', message: cand.text}); } catch { categories = [{cat: 'diff_error', detail: ''}]; }
    const classes = classesOf(categories), tags = [...new Set([...gapTags(cand.text), ...gapTags(row.message)])];
    const cats = [...new Set(categories.map(c => c.cat))];
    const record = {cid: r.cid, id: r.id, src: r.src, split: r.split, stage: sopStage, normalized_match: Boolean(r.frame_ok), failure_kind: row.failure_kind ?? null, message: row.message, candidate: cand.text, candidate_sop: r.sop, gold_sop: row.gold_sop, unparsed: r.unparsed, classes, categories: categories.slice(0, 8), tags};
    out.push(record);
    byStage[sopStage] = (byStage[sopStage] ?? 0) + 1;
    for (const t of tags) byTag[t] = (byTag[t] ?? 0) + 1;
    for (const c of cats) byCategory[c] = (byCategory[c] ?? 0) + 1;
  }
  return {rows: out, byTag, byCategory, byStage};
}
