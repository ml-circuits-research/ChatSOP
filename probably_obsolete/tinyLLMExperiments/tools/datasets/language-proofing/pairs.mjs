/** Sentence-level pairs for LanguageProofingLLM (owner decisions 2026-09-30: the proofing LLMs work sentence by sentence).
 * A bad_english row (message, clean-English target) becomes one pair per sentence when the host splitter (lib/sentence-split.mjs)
 * cuts the message and the target into the same number of sentences; a single-sentence row is one pair; a multi-sentence row
 * whose counts differ is skipped and counted (no guessing of an alignment). A pair is kept only when the mechanical meaning
 * checks of tools/eval/bad-english-targets.mjs hold (names, numbers and quoted spans of the message occur in the target,
 * question marks equal, length ratio sane). Pure functions; no sealed file is opened here.
 */
import crypto from 'node:crypto';
import {splitSentences} from '../../../lib/sentence-split.mjs';
import {protectedItems, fold} from '../../eval/bad-english-targets.mjs';
import {identify, lexiconsFromSpellfix} from '../../../lib/languages-util/langid.mjs';
import {stripQuotedSpans, cleanEnglishGate} from '../clean-english.mjs';
import {languageResources} from '../three-datasets/sources.mjs';

export const hashText = text => crypto.createHash('sha256').update(String(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()).digest('hex').slice(0, 24);
export const norm = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const qmarks = text => (text.match(/\?/g) ?? []).length;
// negation in English or Romanian (mechanical parity check: a negated message must give a negated target and the reverse)
const NEGATION = /(?:^|[^\p{L}])(?:not|no|never|none|nobody|nothing|nowhere|neither|nor|cannot|without|nu|nici|niciun|nicio|nimeni|nimic|niciodată|niciodata|fără|fara)(?=$|[^\p{L}])|n['’]t(?=$|[^\p{L}])|(?:^|[^\p{L}])nu-/iu;
export const hasNegation = text => NEGATION.test(String(text ?? ''));

/** Mechanical meaning check of one pair: returns the list of problems (empty = ok). */
export function pairProblems(message, target) {
  const problems = [];
  if (!norm(target)) return ['empty target'];
  if (/\n/.test(target)) problems.push('line break in target');
  const folded = fold(target);
  // a Romanian definite-article suffix after a hyphen ("Volvo-ul") is not part of the name
  for (const item of protectedItems(message)) if (!folded.includes(fold(item)) && !folded.includes(fold(item.replace(/-\p{L}{1,5}$/u, '')))) problems.push(`lost: ${item}`);
  if (hasNegation(message) !== hasNegation(target)) problems.push('negation differs');
  if (qmarks(target) !== qmarks(message)) problems.push('question marks differ');
  const ratio = target.length / Math.max(1, message.length);
  if (ratio < 0.4 || ratio > 2.5) problems.push(`length ratio ${ratio.toFixed(2)}`);
  return problems;
}

/** Language label of one sentence from LanguagesUtil on its unquoted text: `ro`, `mixed` or `en`. */
export function sentenceLanguage(sentence) {
  const resources = languageResources();
  return identify(stripQuotedSpans(sentence), {lexicons: lexiconsFromSpellfix(resources.spellfix), dictionary: resources.dictionary}).language;
}

/** Sentence-kind of a pair: `ro`, `mixed`, `noisy_en`, or `clean` (an English sentence that passes the clean-English gate and whose target equals it). */
export function pairKind(sentence, target = null) {
  const language = sentenceLanguage(sentence);
  if (language === 'ro') return 'ro';
  if (language === 'mixed') return 'mixed';
  const gate = cleanEnglishGate({question: sentence, language: 'en'}, languageResources());
  return gate.clean && (target === null || norm(sentence) === norm(target)) ? 'clean' : 'noisy_en';
}

/** Sentence units of a row without a target (sealed test only: reference-free metrics): {id, prompt, target: null, kind, row_kind, sentences};
 * a sentence that is already clean English is an identity unit (its target is itself). */
export function projectUnlabelled(row) {
  const us = splitSentences(row.message);
  return us.map((u, i) => {
    const kind = pairKind(u.text, null), id = us.length === 1 ? row.id : `${row.id}#${i + 1}`;
    return {id, prompt: u.text, target: kind === 'clean' ? u.text : null, kind, row_kind: row.language_kind, sentences: us.length};
  });
}

/** Pairs of one row: {pairs: [{id, prompt, target, kind, row_kind, sentences}], skipped: reason|null, dropped: [{id, problems}]}. */
export function projectRow(row) {
  const target = row.target;
  if (!target || !norm(row.message)) return {pairs: [], skipped: 'no_target', dropped: []};
  const us = splitSentences(row.message), ts = splitSentences(target);
  if (us.length !== ts.length) return {pairs: [], skipped: 'sentence_count_differs', dropped: []};
  const pairs = [], dropped = [];
  us.forEach((u, i) => {
    const id = us.length === 1 ? row.id : `${row.id}#${i + 1}`, problems = pairProblems(u.text, ts[i].text);
    if (problems.length) { dropped.push({id, problems}); return; }
    pairs.push({id, prompt: u.text, target: ts[i].text, kind: pairKind(u.text, ts[i].text), row_kind: row.language_kind, sentences: us.length});
  });
  return {pairs, skipped: null, dropped};
}

export function countBy(list, f) { const o = {}; for (const x of list) { const k = f(x); o[k] = (o[k] ?? 0) + 1; } return Object.fromEntries(Object.entries(o).sort()); }
