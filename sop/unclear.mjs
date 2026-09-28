/**
 * The single table of `unclear` kinds (DS021). The small model has no context
 * and does not reason, so it reports only what it can recognise from the text
 * itself: unintelligible text, a message with neither a statement nor a
 * question, or a visible ambiguity it prefers not to resolve (`ambiguous`, with
 * `reading "…"` lines paraphrasing each candidate reading). The host renders the
 * reply from this table, never the model; for `ambiguous` it lists the readings.
 * Renaming or adding a kind is a change to this table only (plus DS021 and the
 * wire help page).
 */
export const UNCLEAR_KINDS = Object.freeze({
  gibberish: {
    en: 'I did not understand the message. Could you rephrase?',
    ro: 'Nu am înțeles mesajul. Îl puteți reformula?',
  },
  no_request: {
    en: 'I did not find a statement or a question in the message. What would you like to know?',
    ro: 'Nu am găsit o afirmație sau o întrebare în mesaj. Ce doriți să aflați?',
  },
  ambiguous: {
    en: 'Your message can be read in more than one way. Which do you mean?',
    ro: 'Mesajul poate fi înțeles în mai multe feluri. La care vă referiți?',
  },
});
/** Kinds that carry `reading` lines; every other kind takes none. */
export const READING_KINDS = Object.freeze(['ambiguous']);

/** Languages with a complete reply table; the host answers only in these. */
export const REPLY_LANGUAGES = Object.freeze(['en', 'ro']);

export function unclearReply(kind, language = 'en', readings = []) {
  const entry = UNCLEAR_KINDS[kind];
  if (!entry) throw Error('Unknown unclear kind ' + kind);
  const text = entry[REPLY_LANGUAGES.includes(language) ? language : 'en'];
  // The readings are the model's own paraphrases, listed verbatim as numbered choices.
  return readings.length ? text + '\n' + readings.map((reading, index) => `(${index + 1}) ${reading}`).join('\n') : text;
}
