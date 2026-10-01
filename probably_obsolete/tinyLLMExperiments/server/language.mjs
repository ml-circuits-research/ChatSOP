/**
 * Answer-language selection (DS021, DS012). English is the default. A caller
 * may select `en` or `ro` explicitly (the chat API `language` field), which is
 * then used as is; with `auto` or no selection an explicit request inside the
 * message is honoured. The detector is a fixed,
 * deterministic list of request phrases, not a language classifier: writing in
 * Romanian does not by itself switch the answer language.
 */
export const ANSWER_LANGUAGES = Object.freeze(['en', 'ro']);
/** The chat API `language` choices: a forced answer language, or `auto` (infer it from the message). */
export const LANGUAGE_CHOICES = Object.freeze([...ANSWER_LANGUAGES, 'auto']);

const fold = text => String(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ');
// Each pattern needs a request verb or phrase next to the language name.
const REQUESTS = [
  ['ro', /\b(?:raspunde|raspundeti|raspunzi|scrie|scrieti|vorbeste|vorbiti|reply|respond|answer|write|speak)\b[^.?!\n]{0,24}\b(?:in|în)\s+(?:limba\s+)?(?:romana|romaneste|romanian)\b/],
  ['ro', /\b(?:in|în)\s+(?:limba\s+)?(?:romana|romaneste|romanian)\s*,?\s*(?:te rog|va rog|please)\b/],
  ['ro', /\b(?:te rog|va rog|please)\s*,?\s*(?:raspunde|raspundeti|answer|reply)?\s*(?:in|în)\s+(?:limba\s+)?(?:romana|romaneste|romanian)\b/],
  ['en', /\b(?:raspunde|raspundeti|raspunzi|scrie|scrieti|vorbeste|vorbiti|reply|respond|answer|write|speak)\b[^.?!\n]{0,24}\b(?:in|în)\s+(?:limba\s+)?(?:engleza|englezeste|english)\b/],
  ['en', /\b(?:in|în)\s+(?:limba\s+)?(?:engleza|englezeste|english)\s*,?\s*(?:te rog|va rog|please)\b/],
  ['en', /\b(?:te rog|va rog|please)\s*,?\s*(?:raspunde|raspundeti|answer|reply)?\s*(?:in|în)\s+(?:limba\s+)?(?:engleza|englezeste|english)\b/],
];

/** The language explicitly requested in the message text, or null. */
export function requestedLanguage(text) {
  const folded = fold(text);
  for (const [language, pattern] of REQUESTS) if (pattern.test(folded)) return language;
  return null;
}

/**
 * Resolve the answer language: an explicit caller selection (`en`, `ro`) wins
 * and nothing is detected; otherwise (`auto`, or no selection) an explicit
 * request in the message, then English.
 * Returns {language, source} with source `request`, `prompt` or `default`.
 */
export function answerLanguage(text, selected) {
  if (selected !== undefined && selected !== null && selected !== 'auto') {
    if (!ANSWER_LANGUAGES.includes(selected)) throw Error('language must be en or ro');
    return {language: selected, source: 'request'};
  }
  const requested = requestedLanguage(text);
  return requested ? {language: requested, source: 'prompt'} : {language: 'en', source: 'default'};
}
