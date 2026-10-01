/** Reconstruct the clean text of a generator-noised English row from its recorded noise operations.
 *
 * `tools/datasets/diversity/noise.mjs` records every operation it applies on the row (`noise`). Word-level
 * operations keep `from` and `to`, so they can be undone exactly; formatting operations are undone by rule. When an
 * operation cannot be undone with confidence (`strip_diacritics`, `chat_spelling` outside the small map, a `from`
 * that is not found exactly once) the reconstruction is refused and the caller falls back to another target source.
 * The caller additionally requires the result to pass the clean-English gate.
 */

const APOSTROPHE = new Map(Object.entries({isnt: "isn't", arent: "aren't", dont: "don't", doesnt: "doesn't", didnt: "didn't", cant: "can't", wont: "won't",
  wasnt: "wasn't", werent: "weren't", hasnt: "hasn't", havent: "haven't", hadnt: "hadn't", shouldnt: "shouldn't", wouldnt: "wouldn't", couldnt: "couldn't",
  im: "I'm", ive: "I've", thats: "that's", whats: "what's", whos: "who's", theyre: "they're", youre: "you're"}));
const CHAT = new Map(Object.entries({u: 'you', ur: 'your', pls: 'please', plz: 'please', thx: 'thanks', cuz: 'because', bc: 'because', tho: 'though', r: 'are', gonna: 'going to', wanna: 'want to'}));
const WORD_OPS = new Set(['typo', 'autocorrect', 'dictation', 'phonetic', 'sms', 'space_split', 'space_merge', 'regional']);
const QUESTION_START = /^(?:who|whom|whose|what|when|where|why|how|which|is|are|do|does|did|can|could|has|have|was|were|will|would|should|may|might)\b/i;

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordy = text => /^[\p{L}\p{N}'’-]+$/u.test(text);

/** Replace the one occurrence of `to` (as a whole word when it is a word) by `from`; null when not found exactly once. */
function undoWord(text, from, to) {
  if (!to || from === undefined) return null;
  const pattern = new RegExp(wordy(to) ? `(?<![\\p{L}\\p{N}])${escape(to)}(?![\\p{L}\\p{N}])` : escape(to), 'gu');
  const hits = [...text.matchAll(pattern)];
  if (hits.length !== 1) return null;
  return text.slice(0, hits[0].index) + from + text.slice(hits[0].index + to.length);
}

function undoFormatting(text, op) {
  switch (op.op) {
    case 'space_before_punctuation': return text.replace(/[ \t]+([.,;:!?])/g, '$1');
    case 'no_space_after_comma': return text.replace(/,(?=\p{L})/gu, ', ');
    case 'lowercase_i': return text.replace(/(?<![\p{L}\p{N}'])i(?![\p{L}\p{N}])/gu, 'I');
    case 'lowercase_start': return text.replace(/^(\P{L}*)(\p{Ll})/u, (all, lead, letter) => lead + letter.toUpperCase());
    case 'repeated_punctuation': return text.replace(/\s*([?!.])\1+/g, '$1');
    case 'drop_question_mark': {
      const last = text.trimEnd().split('\n').pop().trim();
      return /[.?!"”]$/.test(last) || !QUESTION_START.test(last.replace(/^.*?[:.!?]\s+/, '')) ? null : text.trimEnd() + '?';
    }
    case 'missing_apostrophe': {
      let changed = false;
      const out = text.replace(/(?<![\p{L}\p{N}'])([A-Za-z]+)(?![\p{L}\p{N}'])/gu, word => { const fixed = APOSTROPHE.get(word.toLowerCase()); if (!fixed) return word; changed = true; return word[0] === word[0].toUpperCase() && fixed[0] !== 'I' ? fixed[0].toUpperCase() + fixed.slice(1) : fixed; });
      return changed ? out : null;
    }
    case 'chat_spelling': {
      let changed = false;
      const out = text.replace(/(?<![\p{L}\p{N}'])([A-Za-z]+)(?![\p{L}\p{N}'])/gu, word => { const fixed = CHAT.get(word.toLowerCase()); if (!fixed) return word; changed = true; return fixed; });
      return changed ? out : null;
    }
    default: return null;
  }
}

function attempt(text, ops) {
  let current = text;
  for (const op of ops) {
    const next = WORD_OPS.has(op.op) ? undoWord(current, op.from, op.to) : undoFormatting(current, op);
    if (next === null) return null;
    current = next;
  }
  return current;
}

/** The reconstructed clean text of `message` given its recorded noise operations, or null. */
export function undoNoise(message, ops = []) {
  if (!ops.length) return null;
  const reverse = attempt(message, [...ops].reverse());
  const result = reverse ?? attempt(message, ops);
  return result && result !== message ? result : null;
}

/** Coarse noise categories of a row for the bad_english `noise_categories` field. */
export function noiseCategories(ops = []) {
  const map = {typo: 'typo', autocorrect: 'autocorrect', dictation: 'homophone', phonetic: 'phonetic_spelling', sms: 'chat_abbreviation', chat_spelling: 'chat_abbreviation',
    space_split: 'spacing', space_merge: 'spacing', space_before_punctuation: 'punctuation_spacing', no_space_after_comma: 'punctuation_spacing', repeated_punctuation: 'punctuation',
    drop_question_mark: 'missing_question_mark', missing_apostrophe: 'missing_apostrophe', lowercase_i: 'casing', lowercase_start: 'casing',
    diacritic_drop: 'diacritics', diacritic_cedilla: 'diacritics', diacritic_wrong: 'diacritics', strip_diacritics: 'diacritics', regional: 'regional_spelling'};
  return [...new Set(ops.map(op => map[op.op] ?? op.op))];
}
