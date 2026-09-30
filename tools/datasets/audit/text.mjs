/** Language-light text helpers for the corpus audit: normalization, tokens, fuzzy matching and cue lexicons.
 *
 * Everything here is deterministic and dictionary-free apart from the short EN/RO cue and stopword lists
 * below. Matching tolerates case, Romanian diacritics (both comma and cedilla forms), simple inflection
 * (shared-prefix stems) and small typos (bounded edit distance). It never calls a model.
 */

/** Lowercase, strip diacritics, and reduce punctuation to spaces. Hyphens and underscores become spaces. */
export const normalize = text => String(text ?? '')
  .normalize('NFD').replace(/\p{M}+/gu, '')
  .toLowerCase()
  .replace(/[’`´]/g, "'")
  .replace(/[^\p{L}\p{N}']+/gu, ' ')
  .replace(/'/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export const tokens = text => {
  const value = normalize(text);
  return value ? value.split(' ') : [];
};

export const STOPWORDS = new Set([
  // English function words
  'a', 'an', 'the', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'and', 'or', 'from', 'its', 'it', 'is', 'was', 'are',
  'were', 'be', 'been', 'this', 'that', 'these', 'those', 'as', 'into', 'about', 'than', 'their', 'his', 'her', 'has', 'have', 'had',
  // Romanian function words (diacritics already stripped)
  'un', 'o', 'al', 'ai', 'ale', 'de', 'la', 'in', 'pe', 'cu', 'si', 'din', 'pentru', 'lui', 'ei', 'este', 'sunt', 'care', 'ce', 'cel',
  'cea', 'cei', 'cele', 'sau', 'mai', 'nr',
]);

const ROMANIAN_MARKERS = /[ăâîșşțţ]|\b(?:de|la|pentru|si|din|care|este|sunt|al|ale|cu|pe)\b/i;
/** Very small language guess, used only to downgrade cross-lingual label mismatches to warnings. */
export const guessLanguage = text => ROMANIAN_MARKERS.test(String(text ?? '')) ? 'ro' : 'en';

/** Content tokens: no stopwords, no one-letter tokens (single digits are kept). */
export const contentTokens = text => tokens(text).filter(token => !STOPWORDS.has(token) && (token.length > 1 || /\d/.test(token)));

/** Tokens that were capitalized in the original text (proper-name evidence), excluding stopwords. */
export function nameTokens(text) {
  const out = [];
  for (const raw of String(text ?? '').split(/[\s,;:()«»"“”]+/)) {
    if (!/^\p{Lu}/u.test(raw)) continue;
    for (const token of tokens(raw)) if (!STOPWORDS.has(token) && token.length > 1) out.push(token);
  }
  return out;
}

/** Bounded Levenshtein distance: returns max + 1 as soon as the distance must exceed `max`. */
export function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({length: b.length + 1}, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (current[j] < best) best = current[j];
    }
    if (best > max) return max + 1;
    previous = current;
  }
  return previous[b.length];
}

const commonPrefix = (a, b) => {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) index++;
  return index;
};

/** Romanian case endings on short names and nouns: Ana -> Anei, Maria -> Mariei, Ion -> Ionului. */
const RO_SUFFIXES = ['ei', 'ai', 'ul', 'ului', 'lui', 'a', 'ii', 'ilor', 'elor', 'le', 'i'];
function romanianInflection(token, candidate) {
  const base = /[aeiu]$/.test(token) ? token.slice(0, -1) : token;
  if (base.length < 2 || !candidate.startsWith(base)) return false;
  return RO_SUFFIXES.includes(candidate.slice(base.length));
}

/** True when `token` matches one of the message tokens exactly, by a shared inflection stem, or by a small typo. */
export function tokenPresent(token, messageTokens) {
  if (messageTokens.has(token)) return true;
  if (/^\d+$/.test(token)) return false;
  for (const candidate of messageTokens) {
    if (/^\d+$/.test(candidate)) continue;
    const shorter = Math.min(token.length, candidate.length);
    if (romanianInflection(token, candidate)) return true;
    if (shorter >= 4 && commonPrefix(token, candidate) >= Math.max(4, shorter - 2)) return true;
    if (token.length >= 5) {
      const budget = token.length >= 8 ? 2 : 1;
      if (editDistance(token, candidate, budget) <= budget) return true;
    }
  }
  return false;
}

/** Whole-phrase containment on normalized text, respecting token boundaries. */
export const phrasePresent = (phrase, normalizedMessage) => {
  const value = normalize(phrase);
  return Boolean(value) && ` ${normalizedMessage} `.includes(` ${value} `);
};

/** Negation cues: explicit negators in English and Romanian. Applied to lowercased, diacritic-free text. */
const NEGATION_CUES = [
  /\b(?:not|no|never|none|nobody|nothing|neither|nor|without|cannot|nowhere)\b/,
  /n't\b/, // don't, didn't, isn't
  /\b(?:dont|didnt|doesnt|isnt|wasnt|arent|werent|hasnt|havent|hadnt|cant|wont|wouldnt|couldnt|shouldnt)\b/, // apostrophe typos
  /\b(?:nu|nici|niciodata|niciun|nicio|niciunul|niciuna|nimic|nimeni|fara)\b/,
  /\bn-(?:a|au|am|ai|ar|o|as|ati|ati)\b/,
  /\bnu-(?:i|s|l|mi)\b/,
];
/** Omission/denial lexemes: enough to ground a lexically negative predicate such as `omitted`. */
const OMISSION_CUES = /\b(?:omit\w*|exclud\w*|left out|leave\w* out|lack\w*|absent|missing|den(?:y|ies|ied|ial|ials)|refut\w*|reject\w*|contradict\w*|negat\w*|negativ\w*|negare\w*|nega\b|lipse\w*|lipsi\w*|omis\w*|exclus\w*|absen\w*|neag\w*|respins\w*)\b/;

const cueText = text => String(text ?? '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[’`´]/g, "'");
export const hasNegationCue = text => {
  const value = cueText(text);
  return NEGATION_CUES.some(pattern => pattern.test(value));
};
export const hasOmissionCue = text => OMISSION_CUES.test(cueText(text));

/**
 * A predicate whose own meaning is negative (for example "record explicitly omits the named entry"). Only the
 * head of the gloss is read: text after ";" or "(" is usually a caveat ("no gender implied") and does not make
 * the relation negative. Plain "not"/"no" in a gloss is ignored for the same reason; omission verbs decide.
 */
const NEGATIVE_MEANING = /\b(?:omit\w*|exclud\w*|lacks?|lacking|absent|missing|den(?:y|ies|ied)|refus\w*|lipse\w*|omis\w*|exclus\w*)\b/;
export const negativeMeaning = text => NEGATIVE_MEANING.test(cueText(String(text ?? '').split(/[;(]/)[0]).replace(/_/g, ' '));

export const QUANTIFIER_MEANING = /\b(?:every|each|all|some|several|any|most|none|toti|toate|fiecare|unii|unele|cativa|cateva|oricare)\b/;
export const COMPARISON_MEANING = /\b(?:than|more|less|fewer|greater|smaller|larger|higher|lower|above|below|exceed\w*|outrank\w*|rank\w*|earlier|later|decat|peste|sub|superior|inferior)\b/;
export const TEMPORAL_MEANING = /\b(?:before|after|earlier|later|until|since|during|prior|when|date[sd]?|dating|time|timeless|inainte|dupa|pana|cand|data|timp|perioad\w*)\b/;
export const meaningMatches = (pattern, text) => pattern.test(cueText(text).replace(/_/g, ' '));

/** Deterministic 32-bit FNV-1a hash. */
export function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
