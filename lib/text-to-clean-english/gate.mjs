/**
 * textToCleanEnglish's cheap gate (`lib/text-to-clean-english/`, DS012 "textToCleanEnglish", DS021
 * "textToCleanEnglish"): decides whether a chat message is worth cleaning, using LanguagesUtil
 * (`lib/languages-util/`) alone and a handful of cheap regexes — never a backend, never a network call, never a
 * model. An already-clean English message is skipped for free.
 *
 * Three signals, any one of which is enough:
 *   1. non-English tokens (`identify()`): the message's own language is not `en` (`ro` or `mixed`);
 *   2. a spelling signal (`Spellfix.fix()`): the deterministic corrector proposes at least one change;
 *   3. a cheap grammar-trouble regex: a doubled word, a missing capital after sentence-ending punctuation, a
 *      lone lowercase "i", a run of two or more spaces, or a letter glued to the next sentence's punctuation.
 * `gate()` lazily loads and caches the (expensive, ~5 s / ~1 GB) LanguagesUtil resources once per process; a
 * caller that already has them (tests, or another component sharing the same process) can pass them in to skip
 * that cost and to avoid depending on the git-ignored vendor word lists.
 */
import {identify, lexiconsFromSpellfix, loadSpellfix} from '../languages-util/index.mjs';
import {defaultDictionary} from '../../sop/dictionary.mjs';

let cached = null;
/** The lazily loaded, process-wide LanguagesUtil resources `{spellfix, lexicons, dictionary}` (shared with the backends). */
export function resources() {
  if (!cached) {
    const spellfix = loadSpellfix();
    cached = {spellfix, lexicons: lexiconsFromSpellfix(spellfix), dictionary: defaultDictionary()};
  }
  return cached;
}

const GRAMMAR_CHECKS = [
  {id: 'doubled_word', re: /\b(\p{L}+)\s+\1\b/iu},
  {id: 'missing_capital', re: /[.!?]\s+\p{Ll}/u},
  {id: 'lone_lowercase_i', re: /(?:^|\s)i(?:\s|$)/},
  {id: 'double_space', re: /\S {2,}\S/},
  {id: 'glued_sentence', re: /\p{Ll}[.,][\p{L}]/u},
];

/** The grammar-trouble regexes alone, as `{needed, matches}` (`matches` the rule ids that fired). */
export function grammarTrouble(text) {
  const matches = GRAMMAR_CHECKS.filter(check => check.re.test(text)).map(check => check.id);
  return {needed: matches.length > 0, matches};
}

/**
 * Should `message` be cleaned before formalization? `resources` overrides `{identify, lexicons, dictionary,
 * spellfix}` for tests or a caller that already loaded LanguagesUtil; any resource left out falls back to the
 * lazily loaded default (spelling/dictionary) or is skipped (a caller-supplied `identify`/`lexicons` pair is
 * required together, or neither runs). Returns `{needed, language, reasons}`; `reasons` is a short list of
 * strings (`non_english`, `mixed`, `spelling`, `grammar`) fit to show a user ("Why: non_english, spelling").
 */
export function gate(message, overrides = {}) {
  const text = String(message ?? '');
  // `resources()` loads ~1 GB of vendor word lists; only pay for it when `overrides` does not already cover
  // everything it would supply (tests, and any caller that already has LanguagesUtil loaded, skip it entirely).
  const needsDefaults = ['lexicons', 'spellfix'].some(key => !(key in overrides));
  const base = needsDefaults ? resources() : {};
  const {identify: identifyFn = identify, lexicons, dictionary, spellfix} = {...base, ...overrides};
  const reasons = [];
  let language = 'en';
  if (identifyFn && lexicons) {
    language = identifyFn(text, {lexicons, dictionary}).language;
    if (language !== 'en') reasons.push(language === 'mixed' ? 'mixed' : 'non_english');
  }
  if (spellfix && spellfix.fix(text).changes.length) reasons.push('spelling');
  if (grammarTrouble(text).needed) reasons.push('grammar');
  return {needed: reasons.length > 0, language, reasons};
}
