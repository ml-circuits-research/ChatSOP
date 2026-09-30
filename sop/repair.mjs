/**
 * Symbolic repair of `unparsed` spans (DS021 "Honest partial formalization", owner decision of 2026-09-29).
 *
 * The small model marks the parts of a message it could not formalize as `unparsed` wires (a verbatim span, an
 * optional `near $id` and `hint`). Before linking, the host tries deterministic repairs, in this order:
 *   1. dates and times (`sop/linking.mjs` normalizeTime), for a `time` hint or a span that reads as a date;
 *   2. numbers, money and units ("1.140 euro", "2380 lei", "12 km", number words up to twenty, EN and RO);
 *   3. a reference to the conversation ("aia", "el", "de mai devreme", "that one"): resolved from the caller-owned
 *      conversation context (the previous query's quoted values), only when exactly one candidate exists;
 *   4. a proper name: a span of capitalized words, or a surface the host lexicon knows as one entity;
 *   5. the bilingual dictionary (sop/dictionary.mjs): a Romanian common noun with exactly one English reading,
 *      or one the host lexicon accepts.
 * A resolved span fills the placeholder it is paired with. An unresolved span becomes one targeted clarification
 * question; nothing is guessed. The repairs and the unresolved spans are reported in the packet.
 */
import {normalizeTime} from './linking.mjs';

const NUMBER_WORDS = {zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  unu: 1, una: 1, un: 1, o: 1, doi: 2, doua: 2, trei: 3, patru: 4, cinci: 5, sase: 6, sapte: 7, opt: 8, noua: 9, zece: 10, unsprezece: 11, doisprezece: 12, douasprezece: 12, treisprezece: 13, paisprezece: 14, cincisprezece: 15, saisprezece: 16, saptesprezece: 17, optsprezece: 18, nouasprezece: 19, douazeci: 20};
const UNITS = {lei: 'RON', ron: 'RON', leu: 'RON', eur: 'EUR', euro: 'EUR', '€': 'EUR', usd: 'USD', '$': 'USD', dolari: 'USD', dollars: 'USD', dollar: 'USD', gbp: 'GBP', '£': 'GBP', lire: 'GBP', '%': '%', procent: '%', procente: '%', percent: '%',
  km: 'km', kilometri: 'km', kilometers: 'km', kg: 'kg', kilograme: 'kg', ore: 'hours', hours: 'hours', zile: 'days', days: 'days', luni: 'months', months: 'months', ani: 'years', years: 'years', minute: 'minutes', minutes: 'minutes'};
const fold = text => String(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
/** References to something said earlier in the conversation (demonstratives, pronouns, "the earlier one"). */
const REFERENCE = /^(?:aia|asta|acela|aceea|acesta|aceasta|ala|ăla|el|ea|ei|ele|lui|ei|de mai devreme|de mai sus|cel de mai devreme|cea de mai devreme|that|that one|this|this one|it|him|her|them|the one from before|the earlier one|the same one|same)$/i;
const CONNECTORS = new Set(['de', 'din', 'la', 'of', 'the', 'and', 'și', 'si', '&', 'von', 'van', 'da', 'di', 'du', 'le', 'la']);

/** A deterministic numeric reading of a span: a safe integer, or "<number> <UNIT>" for an amount with a unit. */
export function parseQuantity(span) {
  const text = fold(span).replace(/\s+/g, ' ');
  if (Object.hasOwn(NUMBER_WORDS, text)) return NUMBER_WORDS[text];
  const m = /^([-+]?\d{1,3}(?:[ .]\d{3})+|[-+]?\d+)(?:[.,](\d+))?\s*([^\d\s]+)?$/.exec(text) ?? /^([€$£])\s*(\d+)(?:[.,](\d+))?$/.exec(text);
  if (!m) return null;
  let [whole, fraction, unit] = [m[1], m[2], m[3]];
  if (/^[€$£]$/.test(m[1])) [whole, fraction, unit] = [m[2], m[3], m[1]];
  const integer = Number(whole.replace(/[ .]/g, ''));
  if (!Number.isSafeInteger(integer)) return null;
  const code = unit ? UNITS[unit] : null;
  if (unit && !code) return null;
  if (!code && !fraction) return integer;
  return (fraction ? whole.replace(/[ .]/g, '') + '.' + fraction : String(integer)) + (code ? ' ' + code : '');
}

const isName = span => {
  const tokens = String(span).trim().split(/\s+/);
  return tokens.some(t => /^\p{Lu}/u.test(t)) && tokens.every(t => /^\p{Lu}/u.test(t) || /^\d/.test(t) || CONNECTORS.has(t.toLowerCase()));
};

/** Candidate referents in the caller-owned context: the quoted values of the previous query, in order. */
function contextReferents(context) {
  const text = context?.lastQuery ?? '';
  const values = [...String(text).matchAll(/^\s*role\s+\w+\s+("(?:\\.|[^"\\])*")\s*$/gm)].map(m => JSON.parse(m[1]));
  return [...new Set(values)];
}

/**
 * Repair one span. Returns {value, method} or null. `lexicon` (host Lexicon), `dictionary` (sop/dictionary.mjs) and
 * `context` (caller-owned conversation context) are optional; `now` is the host clock for time expressions.
 */
export function repairSpan(span, {hint = null, lexicon = null, dictionary = null, context = {}, now = Date.now()} = {}) {
  const text = String(span).trim();
  if (hint === 'relation') return null; // a relation span is tried by the compiler against the near wire's linking
  if (hint === 'time' || (hint !== 'reference' && /\d/.test(text) && normalizeTime(text, now))) {
    if (normalizeTime(text, now)) return {value: text, method: 'time'};
    if (hint === 'time') return null;
  }
  if (hint !== 'time') {
    const quantity = parseQuantity(text);
    if (quantity !== null) return {value: quantity, method: typeof quantity === 'number' ? 'number' : 'quantity'};
  }
  if (hint === 'reference' || REFERENCE.test(fold(text))) {
    const referents = contextReferents(context);
    return referents.length === 1 ? {value: referents[0], method: 'conversation'} : null;
  }
  const entity = lexicon ? lexicon.matching(text, {language: 'auto', kind: 'entity'}) : null;
  if (entity?.found.length === 1) return {value: text, method: 'lexicon_entity'};
  if (isName(text)) return {value: text, method: 'proper_name'};
  if (dictionary) {
    const c = dictionary.candidates(text, 'value');
    if (c.status === 'translated') {
      const known = lexicon ? c.candidates.filter(candidate => lexicon.matching(candidate, {language: 'auto', kind: 'entity'}).found.length === 1) : [];
      if (known.length === 1) return {value: known[0], method: 'dictionary'};
      if (c.candidates.length === 1) return {value: c.candidates[0], method: 'dictionary'};
    }
  }
  return null;
}

const QUESTIONS = {
  en: {subject: s => `Who or what do you mean by "${s}"?`, object: s => `Who or what do you mean by "${s}"?`, time: s => `Which date or period do you mean by "${s}"?`, location: s => `Which place do you mean by "${s}"?`,
    value: s => `Which value do you mean by "${s}"?`, relation: s => `What do you mean by "${s}"?`, reference: s => `What does "${s}" refer to?`, other: s => `What do you mean by "${s}"?`},
  ro: {subject: s => `La cine sau la ce vă referiți prin „${s}”?`, object: s => `La cine sau la ce vă referiți prin „${s}”?`, time: s => `La ce dată sau perioadă vă referiți prin „${s}”?`, location: s => `La ce loc vă referiți prin „${s}”?`,
    value: s => `Ce valoare aveți în vedere prin „${s}”?`, relation: s => `Ce înțelegeți prin „${s}”?`, reference: s => `La ce se referă „${s}”?`, other: s => `Ce înțelegeți prin „${s}”?`},
};
/** The one targeted clarification question of an unresolved span, in the answer language. */
export function spanQuestion(span, hint, language = 'en') {
  const table = QUESTIONS[language] ?? QUESTIONS.en;
  return (table[hint] ?? table.other)(span);
}
