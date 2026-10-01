/** Back-generated pairs of LanguageProofingLLM iteration 2 (datasets_sources/language_backgen, written by DeepSeek through omp):
 * mechanical filters (a) (b) (c) (e) of the owner brief; the meaning-judge filter (d) is applied by the builder from the verdicts.
 * Pure functions over parsed lines; the sealed texts are known only as the folded hashes and signatures written by
 * tools/eval/language-proofing-v2-sealed.mjs.
 */
import {splitSentences} from '../../../lib/sentence-split.mjs';
import {cleanEnglishGate} from '../clean-english.mjs';
import {languageResources} from '../three-datasets/sources.mjs';
import {lightWords} from '../three-datasets/forms.mjs';
import {pairProblems, pairKind, hasNegation, hashText, norm} from './pairs.mjs';

// Negation parity, relaxed for two false positives of the it1 check: a Romanian tag question ("..., nu?") and English contractions typed without the apostrophe ("doesnt").
const NO_APOSTROPHE = /(?:^|[^\p{L}])(?:do|does|did|is|are|was|were|have|has|had|would|could|should|must|need|ai|wo)nt(?=$|[^\p{L}])/iu;
const negV2 = text => hasNegation(String(text).replace(/,\s*nu\s*\?/giu, '?')) || NO_APOSTROPHE.test(text);
/** Consistency of the targets with the identity pairs (iteration 2, after the epoch-1 dev evidence of attempts A2 and A3): the model must not add or drop what clean input lacks.
 * (1) a target keeps the absence of final punctuation of its prompt (the final period is not added), (2) quotation marks around English spans that the prompt does not have are not
 * added (identity pairs carry unquoted English titles; Romanian titles keep their quotes). Returns the harmonized target, or null when quotes were added to a prompt that already had some. */
export function harmonize(prompt, target) {
  let t = target;
  if (t.split('"').length - 1 > prompt.split('"').length - 1) {
    if (prompt.includes('"')) return null;
    // quotes around a span that is not English (a Romanian title) stay: they are what keeps the span out of the English text; quotes around an English span are not added
    t = t.replace(/"([^"]+)"/g, (m, span) => (gateClean(span).clean ? span : m));
  }
  if (!/[.!?…]["”)]?\s*$/.test(prompt.trim()) && /\.\s*$/.test(t) && !/\.\.\.\s*$/.test(t)) t = t.replace(/\.\s*$/, '');
  return t;
}
/** A repair pair whose prompt already passes the clean-English gate is an identity pair: what the gate accepts the model leaves untouched (case and final period are not edited). */
export const promptIsGateClean = prompt => gateClean(prompt).clean;
/** pairProblems of it1 with the relaxed negation rule. */
export function pairProblemsV2(message, target) {
  const problems = pairProblems(message, target).filter(p => p !== 'negation differs');
  if (negV2(message) !== negV2(target)) problems.push('negation differs');
  return problems;
}
/** projectRow of it1 (sentence-aligned pairs) with pairProblemsV2. */
export function projectRow(row) {
  const us = splitSentences(row.message), ts = splitSentences(row.target);
  if (!norm(row.message) || !norm(row.target)) return {pairs: [], skipped: 'no_target', dropped: []};
  if (us.length !== ts.length) return {pairs: [], skipped: 'sentence_count_differs', dropped: []};
  const pairs = [], dropped = [];
  us.forEach((u, i) => {
    const problems = pairProblemsV2(u.text, ts[i].text);
    if (problems.length) { dropped.push({problems}); return; }
    pairs.push({prompt: u.text, target: ts[i].text, kind: pairKind(u.text, ts[i].text), sentences: us.length});
  });
  return {pairs, skipped: null, dropped};
}

export const LANGS = ['ro', 'mixed', 'noisy_en'];
export const gateClean = text => cleanEnglishGate({question: text, language: 'en'}, languageResources());
export const signatureOfText = text => { const w = lightWords(text); return w.length >= 2 ? w.join(' ') : null; };

/** Entries of one back-generation line: {src: same|new, lang, bad, clean}, plus the row-level rejections. */
export function entriesOf(line, input, sealed, stats) {
  const out = [];
  if (!line.same && !line.new) { stats.null_rows++; return out; }
  const bump = k => { stats[k] = (stats[k] ?? 0) + 1; };
  const inWords = new Set(lightWords(input)), sides = [];
  if (line.same) {
    if (!gateClean(input).clean) bump('same_input_fails_gate');
    else if (sealed.hashes.has(hashText(input))) bump('same_input_sealed_match');
    else sides.push({src: 'same', clean: input, bad: line.same});
  }
  if (line.new?.en) {
    const en = line.new.en, words = lightWords(en), fresh = words.filter(w => !inWords.has(w));
    if (!gateClean(en).clean) bump('new_en_fails_gate');
    else if (norm(en).toLowerCase() === norm(input).toLowerCase() || !fresh.length) bump('new_en_no_new_content_word');
    else if (sealed.hashes.has(hashText(en))) bump('new_en_sealed_match');
    else if (signatureOfText(en) && sealed.signatures.has(signatureOfText(en))) bump('new_en_sealed_content_word_duplicate');
    else sides.push({src: 'new', clean: en, bad: line.new});
  }
  for (const s of sides) for (const lang of LANGS) {
    const bad = s.bad[lang];
    if (typeof bad !== 'string' || !norm(bad)) { bump('missing_version'); continue; }
    out.push({src: s.src, lang, bad: norm(bad), clean: s.clean});
  }
  return out;
}

/** Sentence-level pairs of one entry after the mechanical meaning checks (b) and the language checks (c). */
export function pairsOfEntry(entry, stats) {
  const bump = k => { stats[k] = (stats[k] ?? 0) + 1; };
  const res = projectRow({message: entry.bad, target: entry.clean, language_kind: entry.lang});
  if (res.skipped) { bump(`skipped_${res.skipped}`); return []; }
  for (const d of res.dropped) bump(`dropped_${d.problems[0].replace(/:.*$/, '').replace(/ [\d.]+$/, '')}`);
  const out = [];
  for (const p of res.pairs) {
    if (entry.lang === 'ro' && !['ro', 'mixed'].includes(p.kind)) { bump('ro_version_not_ro_or_mixed'); continue; }
    if (entry.lang === 'noisy_en' && !['noisy_en', 'mixed'].includes(p.kind)) { bump(`noisy_en_version_is_${p.kind}`); continue; }
    if (entry.lang === 'mixed' && p.kind === 'clean') { bump('mixed_version_is_clean'); continue; }
    if (norm(p.prompt) === norm(p.target)) { bump('prompt_equals_target'); continue; }
    out.push({prompt: p.prompt, target: p.target, kind: entry.lang, langid_kind: p.kind, sentences: p.sentences, gate_clean_prompt: entry.lang === 'noisy_en' ? gateClean(p.prompt).clean : null});
  }
  return out;
}
export {splitSentences};
