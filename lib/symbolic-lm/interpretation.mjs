/**
 * Interpretation of what SymbolicLM understood (DS021 "Interpretation CNL", DS012 "Understanding in the chat").
 *
 * `interpretResult(lm, result)` takes a started SymbolicLM and the result of `lm.analyze(message, ...)` and returns, per sentence of
 * the analysis SymbolicLM actually used (after any SymbolicProofingLLM rewrite), the interpretation CNL
 * (lib/languages-util/analysis-cnl.mjs), the round-trip verdict (the CNL is parsed by SymbolicLM and must give the same
 * structures), the spans the CNL does not represent, whether the sentence's analysis is certified (identical default and accurate
 * Stanza trees) and, for rewritten text, the original sentence, the rewrite and whether it was accepted. A sentence whose round
 * trip fails is never shown as CNL: its `status` is `uncertain`, `cnl` is null and `summary` is a raw summary of the analysis.
 * No model is called here beyond the Stanza parses of SymbolicLM; the function is a host-side report, not model input.
 */
import {extractStructures, realize, roundTrip, ANALYSIS_CNL_VERSION} from '../languages-util/analysis-cnl.mjs';
import {maskMessage} from '../ud-to-sop/index.mjs';
import {compactAnalysis} from './index.mjs';

export const INTERPRETATION_VERSION = `interpretation-v1(${ANALYSIS_CNL_VERSION})`;

const norm = text => String(text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** A short raw summary of one analysed sentence: the root and its core dependents ("root: works; nsubj: Ana; obl: Lidl"). */
export function analysisSummary(tokens) {
  const root = tokens.find(t => t[4] === 0);
  if (!root) return tokens.map(t => t[1]).join(' ');
  const skip = new Set(['punct', 'case', 'aux', 'aux:pass', 'det', 'mark', 'cc', 'cop']);
  const deps = tokens.filter(t => t[4] === root[0] && !skip.has(t[5]));
  return [`root: ${root[1]}`, ...deps.map(t => `${t[5]}: ${t[1]}`)].join('; ');
}

/** What an interpretation of a result that has none says: `{available: false, reason}`. */
export const unavailable = reason => ({version: INTERPRETATION_VERSION, available: false, reason, sentences: [], not_represented: []});

/**
 * Per-sentence interpretation of `result.analysis`. `result.english ?? result.message` is the text the analysis belongs to (offsets
 * refer to it). Options: `certify` (default true) computes the per-sentence certification with both Stanza packages.
 */
export async function interpretResult(lm, result, {certify = true} = {}) {
  const analysis = result?.analysis;
  if (!analysis?.sentences?.length) return unavailable('SymbolicLM made no grammatical analysis of this message');
  if (analysis.language && analysis.language !== 'en') return unavailable('the message was analysed in its own language (' + analysis.language + '); the interpretation CNL is English only');
  const text = String(result.english ?? result.message ?? '');
  const full = extractStructures(analysis, {message: text});
  const rewrite = result.trace?.rewrite ?? null;
  const units = rewrite?.units ?? [];
  const known = new Map(units.filter(u => !u.accepted).map(u => [norm(u.text), u]));
  const sentences = [];
  for (const [index, sentence] of analysis.sentences.entries()) {
    const one = {...analysis, sentences: [sentence]};
    const structures = extractStructures(one);
    const {cnl, sentences: cnlSentences} = realize(structures);
    const row = {index, text: sentence.text, start: sentence.start, end: sentence.end, status: 'empty', cnl: null, cnl_sentences: [], unverified_cnl: null, round_trip: null,
      not_represented: [], framing: structures.framing, notes: structures.notes.map(n => n.type), summary: analysisSummary(sentence.tokens), certified: null, rewrite: null};
    if (cnl) {
      row.unverified_cnl = cnl;
      try {
        const {parse} = await lm.parse(maskMessage(cnl), 'en');
        const back = extractStructures(compactAnalysis(parse, {language: 'en'}));
        const rt = roundTrip(structures, back);
        row.round_trip = {pass: rt.pass, reasons: rt.reasons};
      } catch (error) { row.round_trip = {pass: false, reasons: ['the CNL could not be parsed: ' + String(error.message).slice(0, 100)]}; }
      if (row.round_trip.pass) Object.assign(row, {status: 'verified', cnl, cnl_sentences: cnlSentences, unverified_cnl: null});
      else row.status = 'uncertain';
    }
    // Rewrite trace: an accepted unit whose output contains this sentence, or a refused unit that equals it.
    const accepted = units.find(u => u.accepted && u.output && norm(u.output).includes(norm(sentence.text)));
    const refused = known.get(norm(sentence.text));
    if (accepted) row.rewrite = {original: accepted.text, rewrite: accepted.output, accepted: true, reasons: [], original_certified: accepted.certified ?? null};
    else if (refused?.sent) row.rewrite = {original: refused.text, rewrite: refused.output, accepted: false, reasons: refused.reasons ?? [], original_certified: refused.certified ?? null};
    if (certify) {
      if (!accepted && refused && typeof refused.certified === 'boolean') row.certified = refused.certified;
      else { try { row.certified = (await lm.inspectUnit(sentence.text)).certified; } catch { row.certified = null; } }
    }
    sentences.push(row);
  }
  // Spans of the whole text, each assigned to the sentence that contains it. A span outside every sentence (a masked lead-in such as
  // "Remind me," or a label) goes to the next sentence, which then shows the text from the span on (`display_text`), or to the last one.
  const global = [];
  for (const span of full.notRepresented) {
    const owner = sentences.find(s => norm(s.text).includes(norm(span)));
    if (owner) { owner.not_represented.push(span); continue; }
    global.push(span);
    const at = text.toLowerCase().indexOf(String(span).toLowerCase());
    const target = at < 0 ? null : sentences.find(s => s.start >= at) ?? sentences.at(-1);
    if (!target) continue;
    target.not_represented.push(span);
    if (at < target.start) target.display_text = text.slice(Math.min(at, target.display_start ?? at), target.end), target.display_start = Math.min(at, target.display_start ?? at);
  }
  // v2.6: a sentence whose CNL leaves a span of the text out is marked partial (the restatement is true but incomplete), never presented as the whole sentence.
  for (const s of sentences) { delete s.display_start; s.partial = s.status === 'verified' && s.not_represented.length > 0; }
  return {version: INTERPRETATION_VERSION, available: true, text, language: analysis.language ?? 'en', sentences,
    not_represented: [...new Set(full.notRepresented)], outside_sentences: global, framing: full.framing,
    rewrite: rewrite ? {gate: rewrite.gate ?? null, acceptance: rewrite.acceptance ?? null, applied: Boolean(rewrite.applied), input: rewrite.input ?? null, output: rewrite.output ?? null,
      units: units.map(({text: t, sent, accepted: a, reasons, output, certified, uncertain}) => ({text: t, sent, accepted: a, reasons, output, certified, uncertain}))} : null,
    certified: sentences.length && sentences.every(s => s.certified === true) ? true : sentences.some(s => s.certified === false) ? false : null};
}
