/**
 * LanguagesUtil (lib/languages-util/): per-token language identification, Romanian or English (DS021
 * "LanguagesUtil"). Moved out of SymbolicLM's former lib/symbolic-lm/langid.mjs (owner decision 2026-09-29)
 * without a behaviour change; SymbolicLM now calls it instead of implementing language id itself.
 *
 * Deterministic and inspectable. Every word token of the message gets one label with the evidence that decided it:
 *   - `name`   a capitalized word that is not a known ordinary word at a sentence start, or any capitalized word
 *              inside a sentence (proper names are kept as written and never translated);
 *   - `num`    a number or a token with digits; `punct` punctuation; `other` a URL, e-mail or code-like token;
 *   - `ro`     Romanian: Romanian diacritics, a Romanian-only function word, a word of the Romanian lexicons only,
 *              or the clearly more frequent reading of a word both lexicons know, or Romanian morphology;
 *   - `en`     English: the same evidence for English (English-only letters w, y, k, q count as a hint);
 *   - `unk`    in neither lexicon and without morphological evidence; the context label is still assigned.
 * A word both lexicons know with no clear frequency winner ("care", "are", "an", "e") and an `unk` word take the
 * label of the nearest decided content words around them (a window of three on each side), else the message's
 * majority. The result also gives the message language (`en`, `ro` or `mixed`) and the maximal same-language runs.
 *
 * Resources (read-only, never per-message context): the Hunspell word lists and unigram frequencies of
 * lib/languages-util/spellfix.mjs (vendor/spellfix/, recorded in dependencies.md) and the host dictionary
 * sop/dictionary.mjs.
 */
import {fold} from '../../sop/dictionary.mjs';

export const LANGID_VERSION = 'symbolic-lm-langid-v1';

const TOKEN = /[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*|\d+(?:[.,:/-]\d+)*[\p{L}%]*|[^\s\p{L}\p{M}\d]+/gu;
const RO_LETTERS = /[ăâîșşțţ]/iu;
const EN_ONLY_LETTERS = /[wyqk]/iu; // rare in native Romanian words (loanwords aside), used as a weak hint only
// Closed-class words that decide a token alone (folded, diacritics removed). Words shared by both languages
// ("a", "care", "are", "an", "de"? no: "de" is Romanian only) are resolved by frequency and context instead.
const RO_FUNCTION = new Set(('si sau dar insa iar ori nici ca daca desi fiindca deoarece incat cand cum unde cine ce cat cata cati cate cui ' +
  'al ale ai lui unui unei unor ei lor le li ii il o un niste cel cea cei cele acest aceasta acesti aceste acel acea acei acele asta ' +
  'ala aia ăsta aceea acela eu tu el ea noi voi ele mie tie mine tine sine meu mea mei mele tau ta tai tale sau sai sale nostru noastra ' +
  'vostru voastra de la din pe cu pentru despre fara sub peste intre dupa pana spre catre langa prin inainte in intr intro dintr dintre ' +
  'nu mai foarte doar numai tot toti toata toate fiecare niciun nicio vreun vreo este e sunt era erau fost fi fie va vor ar am ai au ati ' +
  'aveti avem are sa se isi imi iti ne va mi ti si-a s-a s-au l-a i-a m-am azi ieri maine acum aici acolo inca deja atunci ' +
  'da ba mersi multumesc salut buna zi te rog vreau stii poti trebuie poate cumva oare nimeni nimic niciodata').split(/\s+/).map(w => fold(w)));
const EN_FUNCTION = new Set(('the of and or but not no is are was were be been being am do does did have has had will would can could should ' +
  'may might must shall of in on at to for from by with about into onto over under between after before until since because if unless ' +
  'although though while when where who whom whose what which why how that this these those i you he she it we they me him her us them ' +
  'my your his its our their there here any anyone someone everyone all every each please thanks thank hello hi yes ok okay know tell ' +
  'check than then also just only still again ever never really very').split(/\s+/));
// Shared spellings whose reading must come from context, not from a frequency list skewed by subtitles.
const SHARED = new Set(['a', 'are', 'care', 'an', 'e', 'o', 'in', 'fi', 'ai', 'am', 'era', 'die', 'dare', 'mare', 'cat', 'sale', 'nor', 'ton', 'sub', 'ban', 'face', 'fac', 'vine', 'pot', 'sat', 'pace', 'plan', 'real', 'social', 'local', 'central', 'final', 'total', 'cost', 'test', 'ore', 'sport', 'film', 'hotel', 'program', 'doctor', 'director']);
const RO_SUFFIX = /(?:ului|ilor|elor|urile|urilor|ează|eaza|ește|ția|ției|ție|ții|ăm|ați|ăți|ul|ule|ii|esc|ească|easca|ând)$/iu;
const EN_SUFFIX = /(?:ing|ed|tion|tions|ness|ment|ments|ly|ship|ful|less|ous|ies|'s|’s)$/iu;

/**
 * Is `text` a closed-class function word (conjunction, preposition, determiner, pronoun, auxiliary, ...) of
 * Romanian, English, both (a shared spelling) or neither? Used by `frame.mjs` to find the grammatical frame of a
 * code-switched message from its function words, not its content words.
 */
export function functionLanguage(text) {
  const key = fold(text), lower = String(text).toLowerCase();
  const ro = RO_FUNCTION.has(key), en = EN_FUNCTION.has(lower);
  if (SHARED.has(key)) return null;
  if (ro && en) return 'both';
  if (ro) return 'ro';
  if (en) return 'en';
  return null;
}

/** Word-list access built from a loaded lib/languages-util/spellfix.mjs instance (Hunspell sets + frequency lists). */
export function lexiconsFromSpellfix(spellfix) {
  return {
    has: (language, word) => spellfix.dict[language].has(word),
    perMillion: (language, word) => {
      const entry = spellfix.freq.get(word);
      return entry ? entry[language] * spellfix.perMillion[language] : 0;
    },
  };
}

/** Tokens with character offsets: {text, start, end, kind: word|num|punct|other}. */
export function tokenize(message) {
  const out = [];
  for (const match of String(message).matchAll(TOKEN)) {
    const text = match[0];
    const kind = /^[\p{L}\p{M}]/u.test(text) ? 'word' : /^\d/.test(text) ? 'num' : 'punct';
    out.push({text, start: match.index, end: match.index + text.length, kind});
  }
  // URLs and e-mails are glued back into one `other` token.
  const text = String(message);
  for (const m of text.matchAll(/\b(?:https?:\/\/|www\.)\S+|\S+@\S+\.\w+/g)) {
    const inside = out.filter(t => t.start >= m.index && t.end <= m.index + m[0].length);
    if (!inside.length) continue;
    const first = out.indexOf(inside[0]);
    out.splice(first, inside.length, {text: m[0], start: m.index, end: m.index + m[0].length, kind: 'other'});
  }
  return out;
}

const lowerWord = word => word.normalize('NFC').toLocaleLowerCase('ro').replace(/ş/g, 'ș').replace(/ţ/g, 'ț');

/**
 * Evidence for one lower-case word: {ro, en, reasons[]} with scores in [0, 1] and a decided label or null.
 * `lexicons` = {has(lang, word), perMillion(lang, word)}; `dictionary` = sop/dictionary.mjs Dictionary (optional).
 */
export function wordEvidence(word, {lexicons, dictionary = null}) {
  const lower = lowerWord(word);
  const key = fold(lower);
  const reasons = [];
  let ro = 0, en = 0;
  if (RO_LETTERS.test(lower)) { ro += 3; reasons.push('ro-diacritic'); }
  // A hyphenated clitic cluster ("i-a", "s-au", "mi-a", "nu-i") is Romanian.
  if (/^[\p{L}]{1,4}-[\p{L}]{1,4}$/u.test(lower) && lower.split('-').every(part => RO_FUNCTION.has(fold(part)) || /^(i|l|m|s|n|v|a|o|au|am|ai|ar|ți|și|-)$/.test(part))) { ro += 3; reasons.push('ro-clitic'); }
  if (RO_FUNCTION.has(key) && !EN_FUNCTION.has(key) && !SHARED.has(key)) { ro += 2; reasons.push('ro-function'); }
  if (EN_FUNCTION.has(lower) && !RO_FUNCTION.has(key) && !SHARED.has(key)) { en += 2; reasons.push('en-function'); }
  if (/['’]/.test(lower) && /^[a-z'’]+$/.test(lower)) { en += 1; reasons.push('en-apostrophe'); }
  const inRo = lexicons.has('ro', lower) || lexicons.has('ro', key) || Boolean(dictionary?.roTokens.has(key));
  const inEn = lexicons.has('en', lower) || Boolean(dictionary?.enTokens.has(key));
  if (inRo && !inEn) { ro += 1.5; reasons.push('ro-lexicon'); }
  if (inEn && !inRo) { en += 1.5; reasons.push('en-lexicon'); }
  if (inRo && inEn && !SHARED.has(key)) {
    const fr = lexicons.perMillion('ro', lower) + lexicons.perMillion('ro', key), fe = lexicons.perMillion('en', lower);
    const ratio = Math.log10((fr + 0.01) / (fe + 0.01));
    if (ratio > 1) { ro += 1; reasons.push('ro-frequency'); } else if (ratio < -1) { en += 1; reasons.push('en-frequency'); } else reasons.push('shared');
  } else if (inRo && inEn) reasons.push('shared');
  if (!inRo && !inEn) {
    if (RO_SUFFIX.test(lower)) { ro += 0.75; reasons.push('ro-morphology'); }
    if (EN_SUFFIX.test(lower)) { en += 0.75; reasons.push('en-morphology'); }
    if (EN_ONLY_LETTERS.test(lower) && !RO_LETTERS.test(lower)) { en += 0.5; reasons.push('en-letters'); }
    if (!reasons.length) reasons.push('unknown');
  }
  const label = ro - en >= 1 ? 'ro' : en - ro >= 1 ? 'en' : null;
  return {ro, en, label, known: inRo || inEn, reasons};
}

/**
 * Identify the language of every token of `message`. Returns
 * {version, tokens: [{text, start, end, label, decided, reasons}], language, counts, runs}.
 */
export function identify(message, {lexicons, dictionary = null, isCommonWord = null} = {}) {
  const tokens = tokenize(message).map(t => ({...t}));
  const common = isCommonWord ?? (w => lexicons.has('en', w) || lexicons.has('ro', w) || Boolean(dictionary?.roTokens.has(fold(w))));
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.kind === 'num') { token.label = 'num'; token.reasons = ['digits']; continue; }
    if (token.kind === 'punct') { token.label = 'punct'; token.reasons = []; continue; }
    if (token.kind === 'other') { token.label = 'other'; token.reasons = ['url-or-email']; continue; }
    const previous = tokens.slice(0, i).reverse().find(t => t.kind !== 'punct' || /[.!?:\n]/.test(t.text));
    const sentenceStart = !previous || (previous.kind === 'punct' && /[.!?:]/.test(previous.text)) || /\n\s*$/.test(String(message).slice(0, token.start));
    const capitalized = /^\p{Lu}/u.test(token.text);
    const allCaps = token.text.length > 1 && token.text === token.text.toUpperCase();
    if (allCaps && !/^(?:I)$/.test(token.text)) { token.label = 'name'; token.reasons = ['all-caps']; continue; }
    // Capitalized inside a sentence: a name. At a sentence start: a name unless its lower-case form is a known word
    // and the next word is not capitalized too (a name run such as "Grădina Botanică" stays a name).
    if (capitalized && token.text !== 'I') {
      const next = tokens[i + 1];
      const lower = lowerWord(token.text);
      const known = common(lower) || RO_FUNCTION.has(fold(lower)) || EN_FUNCTION.has(lower);
      const nameRun = next && next.kind === 'word' && /^\p{Lu}/u.test(next.text) && next.start - token.end === 1;
      if (!sentenceStart || !known || nameRun) { token.label = 'name'; token.reasons = [sentenceStart ? 'capitalized-unknown' : 'capitalized']; continue; }
    }
    token.sentenceStart = sentenceStart;
    const evidence = wordEvidence(token.text, {lexicons, dictionary});
    token.label = evidence.label;
    token.decided = Boolean(evidence.label);
    token.reasons = evidence.reasons;
    token.score = {ro: evidence.ro, en: evidence.en};
    if (token.text === 'I') { token.label = 'en'; token.decided = true; token.reasons = ['en-pronoun-I']; }
  }
  const decided = tokens.filter(t => t.decided);
  const majority = decided.filter(t => t.label === 'ro').length > decided.filter(t => t.label === 'en').length ? 'ro' : decided.length ? 'en' : 'en';
  const content = tokens.map((t, i) => ({t, i})).filter(({t}) => t.kind === 'word' && !['name'].includes(t.label));
  for (let k = 0; k < content.length; k++) {
    const {t} = content[k];
    if (t.decided) continue;
    // Nearer decided neighbours weigh more (1/distance); the next word counts slightly more than the previous one,
    // since a shared function word ("a", "care", "in") belongs to the phrase it introduces.
    let ro = 0, en = 0;
    for (let d = 1; d <= 3; d++) for (const [j, w] of [[k + d, 1.1 / d], [k - d, 1 / d]]) {
      const n = content[j]?.t;
      if (!n?.decided) continue;
      if (n.label === 'ro') ro += w; else if (n.label === 'en') en += w;
    }
    t.label = ro > en ? 'ro' : en > ro ? 'en' : (t.score && t.score.ro > t.score.en ? 'ro' : t.score && t.score.en > t.score.ro ? 'en' : majority);
    t.reasons = [...t.reasons, ro !== en ? `context(ro ${ro.toFixed(2)}, en ${en.toFixed(2)})` : 'message-majority'];
  }
  // A capitalized sentence-initial word whose language disagrees with the rest of its sentence is a name
  // ("Ștefania works at …", "Radu lives in …"): first names are ordinary words of the Romanian lexicons.
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t.sentenceStart || !/^\p{Lu}/u.test(t.text) || !['ro', 'en'].includes(t.label) || t.reasons.includes('ro-function') || t.reasons.includes('en-function')) continue;
    const rest = [];
    for (let j = i + 1; j < tokens.length && rest.length < 6; j++) {
      if (tokens[j].kind === 'punct' && /[.!?]/.test(tokens[j].text)) break;
      if (tokens[j].decided && ['ro', 'en'].includes(tokens[j].label)) rest.push(tokens[j].label);
    }
    const other = t.label === 'ro' ? 'en' : 'ro';
    if (rest.length >= 2 && rest.filter(l => l === other).length >= 0.75 * rest.length) { t.label = 'name'; t.reasons = [...t.reasons, 'sentence-initial-disagrees']; }
  }
  const counts = {ro: 0, en: 0, name: 0, num: 0, other: 0};
  for (const t of tokens) if (counts[t.label] !== undefined) counts[t.label]++;
  const words = counts.ro + counts.en;
  const language = !words ? majority : counts.ro === 0 ? 'en' : counts.en === 0 ? 'ro' : (Math.min(counts.ro, counts.en) / words < 0.08 && Math.min(counts.ro, counts.en) <= 1 ? (counts.ro > counts.en ? 'ro' : 'en') : 'mixed');
  // Runs: maximal spans of one language; names, numbers and punctuation join the run around them.
  const runs = [];
  for (const t of tokens) {
    if (t.label !== 'ro' && t.label !== 'en') continue;
    const last = runs.at(-1);
    if (last && last.language === t.label) { last.end = t.end; last.tokens++; } else runs.push({language: t.label, start: t.start, end: t.end, tokens: 1});
  }
  return {version: LANGID_VERSION, tokens: tokens.map(({kind, decided, score, sentenceStart, ...t}) => ({...t, kind})), language, counts, runs};
}
