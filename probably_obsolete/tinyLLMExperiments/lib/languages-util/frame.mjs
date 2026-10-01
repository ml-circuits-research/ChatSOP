/**
 * LanguagesUtil: matrix-language (frame) detection for a code-switched message, symbolically from its function
 * words (Myers-Scotton's Matrix Language Frame model: the frame language supplies the grammatical morphemes —
 * conjunctions, prepositions, determiners, pronouns, auxiliaries — while the other, "embedded" language supplies
 * isolated content items). Used by the `matrix` route of `eval-translator-compare-v1`: the frame language is
 * parsed as-is, and only the embedded-language content words are translated into it, rather than the whole
 * message.
 */
import {tokenize, functionLanguage} from './langid.mjs';

export const FRAME_VERSION = 'languages-util-frame-v1';

/**
 * `message` → `{frame: 'ro'|'en'|null, roFunction, enFunction, tokens}`. `frame` is the language with strictly
 * more function-word tokens (`null` on a tie or when no function word was found, meaning the frame is
 * undetermined and a caller should fall back to a whole-message route). `tokens` is the tokenize() list, each
 * annotated with `functionLanguage` (`'ro'`, `'en'`, `'both'`, or `null` for a content word).
 */
export function detectFrame(message) {
  const tokens = tokenize(message).map(t => ({...t, functionLanguage: /[\p{L}]/u.test(t.text) ? functionLanguage(t.text) : null}));
  let roFunction = 0, enFunction = 0;
  for (const t of tokens) {
    if (t.functionLanguage === 'ro') roFunction++;
    else if (t.functionLanguage === 'en') enFunction++;
  }
  const frame = roFunction === enFunction ? null : roFunction > enFunction ? 'ro' : 'en';
  return {frame, roFunction, enFunction, tokens};
}
