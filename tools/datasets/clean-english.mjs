/** Clean-English partition (owner decision 2026-09-30, journaled): formalization evaluation focuses on valid,
 * clean English; Romanian, code-switched ("romgleza") and badly written English (typos, garbled, confusing input)
 * are out of scope here and are handled by a separate textToCleanEnglish service in the chat UI. This module
 * defines, operationally and re-checkably, which rows of a DS022 model-language corpus are "clean English", so the
 * definition does not rest on the generator's own self-reported tags alone.
 *
 * Four partitions, in this order of precedence:
 *   1. `mixed`     the row is tagged `code_switch`, OR LanguagesUtil's own `identify()` (lib/languages-util) calls
 *                   the message's un-quoted text `mixed` (Romanian and English content words both present).
 *   2. `ro`        not mixed, and the row's own `language` field is `ro` (monolingual Romanian, clean or noisy:
 *                   Romanian-language quality is the textToCleanEnglish service's concern, not this filter's).
 *   3. `clean_en`  not mixed, `language` is `en`, and every clean-English gate below passes.
 *   4. `noisy_en`  not mixed, `language` is `en`, and at least one gate fails (typos, garbled or unclear English).
 *
 * The clean-English gate (`cleanEnglishGate`), all re-checkable from the row's `question` text and metadata alone:
 *   (a) `no_generator_noise`   `row.noise` is empty/absent, `row.noise_level` is null and `row.code_switch` is null
 *                              (DS022 tools/datasets/diversity/noise.mjs deliberately injects and labels exactly
 *                              this kind of damage; a row it marks noisy is never clean by construction);
 *   (b) `no_spelling_fix`      `lib/languages-util/spellfix.mjs` `Spellfix.fix(question)` proposes zero corrections
 *                              (its own quote-aware, conservative editor; a flagged word is a typo or an unknown
 *                              spelling, not clean English);
 *   (c) `all_tokens_english`   every word token of the message, with quoted spans, proper names and numbers
 *                              excluded, is labelled `en` by LanguagesUtil's `identify()` (lib/languages-util);
 *                              equivalently, the unquoted text's overall `identify()` language is `en`, never `ro`
 *                              or `mixed`. Quoted spans (the same quote patterns spellfix.mjs protects) are excluded
 *                              because they may carry a claim under review or a foreign/kept proper name, not
 *                              necessarily the user's own register.
 *   (d) `not_gibberish`        `eval/reference-free.mjs` `gibberishVerdict(message)` is not `gibberish` (a keyboard
 *                              mash such as "rtyui;; vbnkvbn" contains no Romanian evidence and no word the
 *                              spellchecker would touch, so gates (b)-(c) alone let it through as spurious "clean
 *                              English"; a manual spot-check of an early version of this filter caught exactly this
 *                              case on a gold `unclear kind gibberish` row, `fv1_019088_0`). Gibberish is not valid
 *                              English text at all, so it belongs in `noisy_en`, not `clean_en`.
 *   (e) `grammar_check`        not implemented: no local grammar checker is installed (AGENTS.md forbids adding
 *                              new dependencies without recording them in dependencies.md); recorded as a follow-up
 *                              in TODO.md rather than skipped silently. Its absence never makes the gate stricter
 *                              or looser; a row can be `clean_en` on (a)-(d) alone.
 *
 * A short but well-formed English fragment ("she coaches them", "yes") passes: nothing here penalizes length.
 * `classifyPartition` and `cleanEnglishGate` are pure functions of one row plus loaded LanguagesUtil resources, so
 * a caller loads `loadSpellfix()` and `defaultDictionary()` once and reuses them across a whole corpus.
 */
import {identify, lexiconsFromSpellfix} from '../../lib/languages-util/langid.mjs';
import {gibberishVerdict} from '../../eval/reference-free.mjs';

// Same quote patterns as lib/languages-util/spellfix.mjs `fix()` `protectedSpans`, reused here so the langid gate
// excludes exactly the spans the spellchecker already treats as quoted (claims under review, kept proper names).
const QUOTE_SPANS = /"[^"\n]*"|“[^”\n]*”|„[^”“\n]*[”“]|«[^»\n]*»|(?<=^|\s)'[^'\n]+'(?=$|[\s.,;:!?])/gu;

/** The message with every quoted span blanked out (same length, so offsets elsewhere are unaffected). */
export function stripQuotedSpans(text) {
  return String(text ?? '').replace(QUOTE_SPANS, match => ' '.repeat(match.length));
}

/**
 * Gate (c): every non-name, non-numeric word token of the unquoted message is English.
 * `resources` = {spellfix, dictionary} from `loadSpellfix()`/`defaultDictionary()`.
 */
export function allTokensEnglish(message, resources) {
  const stripped = stripQuotedSpans(message);
  const lexicons = lexiconsFromSpellfix(resources.spellfix);
  const result = identify(stripped, {lexicons, dictionary: resources.dictionary});
  // A capitalized token is a proper name (Romanian first names such as "Mihai" or "Mei" are labelled `ro` by the
  // function-word/lexicon evidence) and a lower-case word that the English dictionary also lists ("merge",
  // "certificate") is valid English: neither makes an English message non-English (deviation D1, 2026-09-30).
  const offenders = result.tokens.filter(t => t.kind === 'word' && t.label === 'ro' && !/^\p{Lu}/u.test(t.text) && !resources.spellfix.dict.en.has(t.text.toLowerCase()));
  return {ok: offenders.length === 0, language: result.language, offenders: offenders.map(t => t.text)};
}

const AMERICAN = word => word.toLowerCase().replace(/ae/g, 'e').replace(/oe/g, 'e').replace(/is(e|es|ed|ing|ation|ations)\b/g, 'iz$1').replace(/our\b/g, 'or').replace(/ence\b/g, 'ense');

/** A spellfix proposal that is not a typo: a compound the checker would split ("lockbox" -> "lock box"), a
 * British/American spelling variant ("specialised" -> "specialized") or a capitalized name (deviation D1). */
function benignFix({from, to}) {
  const a = String(from ?? ''), b = String(to ?? '');
  return b.replace(/\s+/g, '').toLowerCase() === a.toLowerCase() || AMERICAN(a) === AMERICAN(b) || /^\p{Lu}/u.test(a);
}

/** Gate (b): the symbolic spellchecker proposes no correction on the message. */
export function noSpellingFix(message, resources) {
  const fix = resources.spellfix.fix(String(message ?? ''));
  const changes = fix.changes.filter(ch => !benignFix(ch));
  return {ok: changes.length === 0, changes};
}

/** Gate (a): no generator-injected noise, typing noise level, or code-switch tag. */
export function noGeneratorNoise(row) {
  const ok = !(row.noise && row.noise.length) && row.noise_level == null && !row.code_switch;
  return {ok, noise: row.noise ?? [], noise_level: row.noise_level ?? null, code_switch: row.code_switch ?? null};
}

/** Gate (d): the message is not a keyboard mash or other unintelligible text (eval/reference-free.mjs, symbolic). */
export function notGibberish(message) {
  const verdict = gibberishVerdict(message);
  return {ok: verdict !== 'gibberish', verdict};
}

/** All clean-English gates on one row; `resources` = {spellfix, dictionary}. */
export function cleanEnglishGate(row, resources) {
  const message = row.question ?? '';
  const a = noGeneratorNoise(row);
  const b = noSpellingFix(message, resources);
  const c = allTokensEnglish(message, resources);
  const d = notGibberish(message);
  const reasons = [];
  if (!a.ok) reasons.push(`generator noise (${JSON.stringify({noise_level: a.noise_level, noise: a.noise.map(n => n.op ?? n), code_switch: a.code_switch})})`);
  if (!b.ok) reasons.push(`spellfix would change: ${b.changes.map(ch => `${ch.from}->${ch.to}`).join(', ')}`);
  if (!c.ok) reasons.push(c.offenders.length ? `non-English tokens: ${c.offenders.join(', ')}` : `unquoted-text language ${c.language}`);
  if (!d.ok) reasons.push(`gibberish verdict: ${d.verdict}`);
  return {clean: a.ok && b.ok && c.ok && d.ok, gates: {no_generator_noise: a.ok, no_spelling_fix: b.ok, all_tokens_english: c.ok, not_gibberish: d.ok}, reasons};
}

/**
 * One of `clean_en`, `noisy_en`, `ro`, `mixed` for a row, plus the reasons the clean-English gate gave (empty for
 * `ro` and `mixed`, whose own text quality is out of scope here). `resources` = {spellfix, dictionary}.
 */
export function classifyPartition(row, resources) {
  const message = row.question ?? '';
  const stripped = stripQuotedSpans(message);
  const lexicons = lexiconsFromSpellfix(resources.spellfix);
  const mixedByLangid = identify(stripped, {lexicons, dictionary: resources.dictionary}).language === 'mixed';
  if (row.code_switch || mixedByLangid) return {partition: 'mixed', reasons: row.code_switch ? ['code_switch tag'] : ['langid mixed on unquoted text']};
  if (row.language === 'ro') return {partition: 'ro', reasons: []};
  if (row.language !== 'en') return {partition: 'mixed', reasons: [`unexpected row.language ${row.language}`]};
  const gate = cleanEnglishGate(row, resources);
  return {partition: gate.clean ? 'clean_en' : 'noisy_en', reasons: gate.reasons};
}
