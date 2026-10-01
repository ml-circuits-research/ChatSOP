/** Scoring of a text-to-text rewriter on composed paragraphs (K2 neuro, K3 identity, K4 bad, K5 reference), in two modes
 * (DS008 "Composed evaluation suites"):
 *   paragraph  the rewriter gets the whole paragraph;
 *   sentence   the host splits the paragraph, a gate keeps the sentences that are fine, the rewriter gets only the others, one
 *              at a time, and the host reassembles. The gate is SymbolicLM (`symbolic`: a sentence goes to the rewriter when
 *              SymbolicLM does not handle it alone: invalid, unparsed or uncertain) for SymbolicProofingLLM cases, and the
 *              clean-English gate (`clean-english`) for LanguageProofingLLM cases.
 * The output is aligned with the expected components (align.mjs) and, end to end, SymbolicLM analyses it and its SOP is
 * compared with the concatenated expected SOPs (expected SOP of a component: stored, else SymbolicLM on the expected text).
 */
import {splitSentences} from '../../../lib/sentence-split.mjs';
import {classifyMessage} from '../../datasets/three-datasets/sources.mjs';
import {alignRewrite, normSpace} from './align.mjs';
import {compareParagraph} from './sop-canon.mjs';
import {handled} from './lm.mjs';
import {rateBy, wilson} from './stats.mjs';

/** Units of a paragraph: `host` (lib/sentence-split.mjs) or `stanza` (the sentences of SymbolicLM's analysis). */
export async function unitsOf(message, splitter, lm) {
  if (splitter === 'stanza') { const r = await lm.run(message); return r.sentences.map(s => ({text: s.text, start: s.start, end: s.end})); }
  return splitSentences(message).map(({text, start, end}) => ({text, start, end}));
}

/** Whether the splitter cut the paragraph exactly where the components end: its units equal the units of the components alone. */
export async function splitterAgrees(row, splitter, lm) {
  const units = (await unitsOf(row.message, splitter, lm)).map(u => normSpace(u.text));
  const expected = [];
  for (const c of row.components) for (const u of await unitsOf(c.text, splitter, lm)) expected.push(normSpace(u.text));
  return {ok: units.length === expected.length && units.every((u, i) => u === expected[i]), units: units.length, expected: expected.length};
}

export const GATES = {
  symbolic: lm => async unit => !handled(await lm.run(unit)),
  'clean-english': () => async unit => classifyMessage(unit).partition !== 'clean_en',
  // every sentence goes to the rewriter (the chat sends all sentences since the owner rule "if uncertainty cannot be detected, always")
  all: () => async () => true,
};

/** Rewrite `message` in the given mode; returns {output, sent, units, calls}. */
export async function rewriteParagraph(message, {mode, rewriter, gate = null, splitter = 'host', lm = null}) {
  if (mode === 'paragraph') return {output: await rewriter(message), sent: null, units: null, calls: 1, sent_texts: null};
  const units = await unitsOf(message, splitter, lm);
  let output = message, sent = 0;
  const results = [], sentTexts = [];
  for (const [i, u] of units.entries()) { const needs = await gate(u.text); if (needs) { sent++; sentTexts.push(u.text); results.push([i, await rewriter(u.text)]); } }
  for (const [i, text] of results.reverse()) output = output.slice(0, units[i].start) + text + output.slice(units[i].end);
  return {output, sent, units: units.length, calls: sent, sent_texts: sentTexts};
}

/** Expected programs of a case: stored, else what SymbolicLM gives the expected text alone. */
export async function expectedPrograms(row, lm) {
  const out = [];
  for (const c of row.components) out.push(c.expected_sop ?? (await lm.run(c.expected_text)).sop);
  return out;
}

export async function scoreRewrite(row, {mode, rewriter, gate, splitter, lm, tokens = null, endToEnd = true}) {
  const t0 = Date.now();
  const split = await splitterAgrees(row, splitter, lm);
  let result;
  try { result = await rewriteParagraph(row.message, {mode, rewriter, gate, splitter, lm}); }
  catch (error) { return {id: row.id, kind: row.kind, mode, error: String(error.message ?? error).slice(0, 200)}; }
  const align = alignRewrite(row.components, result.output);
  let e2e = null;
  if (endToEnd) {
    const run = await lm.run(result.output);
    e2e = {...compareParagraph(run.sop, await expectedPrograms(row, lm)), handled: handled(run)};
  }
  return {
    id: row.id, kind: row.kind, mode, lm_id: lm.id, stratum: row.stratum, mix: row.mix ?? null, position_label: row.position_label ?? null, n_components: row.n_components, n_sentences: row.n_sentences,
    splitter_ok: split.ok, units: result.units, sent: result.sent, calls: result.calls,
    unpunctuated_components: row.components.filter(c => c.punctuated === false).length,
    gate_sent_changes: result.sent_texts ? row.components.filter(c => c.must_change && result.sent_texts.some(t => normSpace(t) === normSpace(c.text))).length : null,
    gate_sent_clean: result.sent_texts ? row.components.filter(c => !c.must_change && result.sent_texts.some(t => normSpace(t) === normSpace(c.text))).length : null,
    clean_components: row.components.filter(c => !c.must_change).length, change_components: row.components.filter(c => c.must_change).length,
    status: align.status, exact: align.exact, order_ok: align.order_ok, added_units: align.added_units, dropped: align.dropped, broken: align.broken, not_repaired: align.not_repaired, repaired: align.repaired, wrong_rewrite: align.wrong_rewrite, preserved: align.preserved,
    e2e_exact: e2e?.exact ?? null, e2e_handled: e2e?.handled ?? null, tokens: tokens ?? null, output: result.output, ms: Date.now() - t0,
  };
}

const sum = (records, key) => records.reduce((a, r) => a + (r[key] ?? 0), 0);

/** Component-level and case-level rates with intervals. */
export function summarizeRewrite(records) {
  const ok = records.filter(r => !r.error);
  const cleanN = sum(ok, 'clean_components'), changeN = sum(ok, 'change_components');
  const by = r => r.stratum ?? String(r.n_components);
  return {
    cases: ok.length, errors: records.length - ok.length,
    clean_sentences_changed: wilson(sum(ok, 'broken'), cleanN), clean_sentences_kept: wilson(sum(ok, 'preserved'), cleanN),
    bad_sentences_fixed: wilson(sum(ok, 'repaired'), changeN), bad_sentences_untouched: wilson(sum(ok, 'not_repaired'), changeN), bad_sentences_wrong_rewrite: wilson(sum(ok, 'wrong_rewrite'), changeN),
    dropped_components: wilson(sum(ok, 'dropped'), cleanN + changeN),
    cases_with_added_text: wilson(ok.filter(r => r.added_units > 0).length, ok.length),
    cases_order_preserved: wilson(ok.filter(r => r.order_ok).length, ok.length),
    cases_exact: rateBy(ok, by, r => r.exact),
    cases_e2e_sop_exact: rateBy(ok.filter(r => r.e2e_exact !== null), by, r => r.e2e_exact),
    splitter_agrees: wilson(ok.filter(r => r.splitter_ok).length, ok.length),
    splitter_agrees_when_all_components_punctuated: wilson(ok.filter(r => r.splitter_ok && !r.unpunctuated_components).length, ok.filter(r => !r.unpunctuated_components).length),
    splitter_agrees_with_an_unpunctuated_component: wilson(ok.filter(r => r.splitter_ok && r.unpunctuated_components).length, ok.filter(r => r.unpunctuated_components).length),
    gate: ok[0]?.mode === 'sentence' ? {recall_of_sentences_that_need_a_rewrite: wilson(sum(ok, 'gate_sent_changes'), changeN), clean_sentences_sent_to_the_rewriter: wilson(sum(ok, 'gate_sent_clean'), cleanN)} : null,
    sentence_mode: ok[0]?.mode === 'sentence' ? {rewriter_calls: sum(ok, 'calls'), sentences: sum(ok, 'units'), share_sent: wilson(sum(ok, 'sent'), sum(ok, 'units'))} : null,
    clean_changed_by_stratum: rateBy(ok.filter(r => r.clean_components), by, r => r.broken === 0),
  };
}
