/** Scoring of K6 decomposition cases: a tangled message that must become several short, simple sentences (DS021 "Limited English for SymbolicLM").
 *
 * Per case, for the output of a rewriter (or of no rewrite, the identity row):
 *   count_match / count_at_least   number of output sentences equals / reaches the expected number
 *   sentences_ok                   every output sentence has at most one finite clause (connective-linked and complement clauses allowed),
 *                                  no coordinated or relative clause and no elided subject (contract check on the SymbolicLM analysis)
 *   handled                        SymbolicLM handles every output sentence alone (valid conversion, nothing unparsed, not uncertain)
 *   preserved_*                    names, numbers, negations and connectives of the message are still in the output
 *   sop_gold                       where a gold SOP exists, SymbolicLM's SOP on the output equals it modulo id renumbering
 */
import {splitSentences} from '../../../lib/sentence-split.mjs';
import {contractOfSentence, CONNECTIVES} from '../../datasets/three-datasets/decomposition.mjs';
import {compareParagraph} from './sop-canon.mjs';
import {handled} from './lm.mjs';
import {rateBy, wilson} from './stats.mjs';

const fold = text => String(text).normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();
const wordsOf = text => fold(text).match(/[\p{L}\p{N}']+/gu) ?? [];
const NEGATIONS = new Set(['not', "n't", 'never', 'no', 'none', 'nobody', 'nothing', 'neither', 'nor', "don't", "doesn't", "didn't", "isn't", "aren't", "wasn't", "won't", "can't", "cannot"]);

/** Items of a category that the reference target keeps (so a filler the target drops is not demanded). */
function kept(message, output, reference, extract) {
  const wanted = extract(message).filter(item => extract(reference).includes(item));
  return {total: wanted.length, present: wanted.filter(item => extract(output).includes(item)).length};
}
const names = text => [...new Set((String(text).match(/\p{Lu}[\p{L}'’-]+/gu) ?? []).map(fold))];
const numbers = text => [...new Set(String(text).match(/\d+(?:[.,:]\d+)*/g) ?? [])];
const negations = text => [...new Set(wordsOf(text).filter(w => NEGATIONS.has(w)))];
const connectives = text => [...new Set(wordsOf(text).filter(w => CONNECTIVES.has(w)))];

export async function scoreDecomposition(row, {rewriter, lm, mode = 'whole'}) {
  const t0 = Date.now();
  const c = row.components[0];
  let output;
  try {
    // mode `sentence`: the host splitter cuts the message and EVERY sentence goes to the rewriter (the chat's sendAll), the outputs are joined; `whole`: the message as one input
    if (mode === 'sentence') { const parts = []; for (const u of splitSentences(row.message)) parts.push(await rewriter(u.text)); output = parts.join(' '); }
    else output = await rewriter(row.message);
  } catch (error) { return {id: row.id, kind: row.kind, error: String(error.message ?? error).slice(0, 200)}; }
  const units = splitSentences(output).map(u => u.text);
  let allOk = true, allHandled = true, subjectMissing = 0, multiClause = 0;
  const per = [];
  for (const unit of units) {
    const rec = await lm.run(unit);
    const sentence = rec.sentences?.[0];
    const verdict = sentence && rec.sentences.length === 1 ? contractOfSentence(sentence) : {ok: false, clauses: 0, single: false};
    if (!verdict.ok) allOk = false;
    if (verdict.clauses === 0) subjectMissing++;
    if (verdict.clauses > 1) multiClause++;
    if (!handled(rec)) allHandled = false;
    per.push({ok: verdict.ok, handled: handled(rec)});
  }
  const outFull = await lm.run(output);
  const preserved = {names: kept(row.message, output, c.expected_text, names), numbers: kept(row.message, output, c.expected_text, numbers), negations: kept(row.message, output, c.expected_text, negations), connectives: kept(row.message, output, c.expected_text, connectives)};
  const sopGold = c.expected_sop ? compareParagraph(outFull.sop, [c.expected_sop]).exact : null;
  return {
    id: row.id, kind: row.kind, stratum: row.stratum, decomposition: row.decomposition, expected_sentences: row.n_sentences, output_sentences: units.length,
    count_match: units.length === row.n_sentences, count_at_least: units.length >= row.n_sentences, changed: output.trim() !== row.message.trim(), exact_target: output.replace(/\s+/g, ' ').trim() === c.expected_text.replace(/\s+/g, ' ').trim(),
    sentences_ok: allOk, all_handled: allHandled, sentences_with_no_subject: subjectMissing, sentences_with_several_clauses: multiClause, preserved, sop_gold: sopGold, sop_valid: outFull.valid, output, ms: Date.now() - t0,
  };
}

export function summarizeDecomposition(records) {
  const ok = records.filter(r => !r.error), by = r => r.stratum ?? 'other';
  const share = key => { const k = ok.reduce((a, r) => a + r.preserved[key].present, 0), n = ok.reduce((a, r) => a + r.preserved[key].total, 0); return wilson(k, n); };
  const withGold = ok.filter(r => r.sop_gold !== null);
  return {
    cases: ok.length, errors: records.length - ok.length,
    changed: wilson(ok.filter(r => r.changed).length, ok.length), output_sentence_count_matches: rateBy(ok, by, r => r.count_match), output_at_least_expected_sentences: wilson(ok.filter(r => r.count_at_least).length, ok.length),
    every_sentence_within_contract: rateBy(ok, by, r => r.sentences_ok), every_sentence_handled_by_symbolic_lm: rateBy(ok, by, r => r.all_handled),
    exact_target: wilson(ok.filter(r => r.exact_target).length, ok.length),
    preserved: {names: share('names'), numbers: share('numbers'), negations: share('negations'), connectives: share('connectives')},
    sop_equals_gold: wilson(withGold.filter(r => r.sop_gold).length, withGold.length),
  };
}
