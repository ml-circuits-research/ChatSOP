/** LanguagesUtil (lib/languages-util/): conservative, dictionary-based spelling correction of a user message
 * (English and Romanian), for evaluation as an optional host pre-step before the small formalizer (experiment
 * `eval-spellfix-preproc-v1`, DS010). Moved out of SymbolicLM's former call site at `lib/spellfix.mjs` into
 * LanguagesUtil (owner decision 2026-09-29, DS021 "LanguagesUtil") without a behaviour change.
 *
 * The corrector is deterministic and symbolic: a word is changed only when it is in neither Hunspell dictionary
 * (en_US, ro) nor among the most frequent words of either frequency list, and one known candidate is clearly
 * better than every other by keyboard-aware edit cost and unigram frequency. Never touched: capitalized tokens
 * (proper names; a sentence-initial word only when it corrects to a very common word), all-caps tokens, numbers,
 * dates, e-mails, URLs, tokens with digits, quoted text, hyphenated or apostrophized tokens, and short words
 * (fewer than 4 letters, except a diacritic restoration). No change may produce a negation or quantifier cue
 * word. Every change is returned with its reason, so a run can be audited.
 *
 * Resources (not in the repository; see dependencies.md): `vendor/spellfix/{en,ro}_index.{aff,dic}` (wooorm/dictionaries)
 * and `vendor/spellfix/{en,ro}_full.txt` (hermitdave/FrequencyWords 2018). `CHATSOP_SPELLFIX_DIR` overrides the folder.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {expandDic, parseAff} from './spellfix/hunspell.mjs';
import {adjacentKeys, diacriticVariants, foldDiacritics} from './spellfix/keyboard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SPELLFIX_VERSION = 'spellfix-v1';

/** Frozen parameters (preregistered with the experiment; changing one is a new corrector version). */
export const DEFAULTS = Object.freeze({
  knownTop: 20000,        // words ranked at most this high in either frequency list count as known
  minLength: 4,           // shortest word eligible for an edit correction
  minPerMillion: 1,       // a correction target must be at least this frequent (per million, in the weighted list)
  minPerMillionLong: 0.05, // the same floor for words of 8 letters or more, whose edit neighbourhood is sparse
  margin: 1.0,            // best score minus runner-up score (log10 units) required to change a word
  costWeight: 2.0,        // score = log10(per-million frequency) - costWeight * edit cost
  otherLanguageWeight: 0.25, // frequency weight of the language the message is not written in
  initialCapTop: 500,     // a capitalized sentence-initial word is corrected only into one of the N most frequent words
  contextRatio: 5,        // diacritic restoration of a known word requires the variant to be this many times more frequent
  splitPerMillion: 50,    // both halves of a split word must be at least this frequent
});

const LETTERS = 'abcdefghijklmnopqrstuvwxyzăâîșț';
const DIACRITIC_CHARS = /[ăâîșțşţĂÂÎȘȚŞŢ]/u;
const WORD = /^[\p{L}\p{M}]+$/u;
// Cue words a label depends on (DS022): a correction never produces one.
const CUES = new Set(('not no never nobody none nothing nowhere neither nor without all every each any some only still again ' +
  'nu niciun nicio niciunul niciuna nimeni nimic niciodată nicăieri fără toți toate tot toată fiecare orice oricare încă iar ' +
  'mai doar numai').split(' '));

function normalizeCedilla(word) { return word.replace(/ş/g, 'ș').replace(/ţ/g, 'ț').replace(/Ş/g, 'Ș').replace(/Ţ/g, 'Ț'); }

function readFrequencies(file, map, key) {
  let total = 0, rank = 0;
  const ranks = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const space = line.lastIndexOf(' ');
    if (space < 1) continue;
    const count = Number(line.slice(space + 1));
    total += count;
    if (count < 3) continue;
    const word = normalizeCedilla(line.slice(0, space).toLowerCase());
    const entry = map.get(word) ?? {en: 0, ro: 0};
    entry[key] += count;
    map.set(word, entry);
    if (!ranks.has(word)) ranks.set(word, ++rank);
  }
  return {total, ranks};
}

/** Loads the dictionaries and frequency lists (about 5 s and 1 GB of memory, once per process). */
export function loadSpellfix({dir = process.env.CHATSOP_SPELLFIX_DIR ?? path.join(ROOT, 'vendor/spellfix'), ...options} = {}) {
  const params = {...DEFAULTS, ...options};
  const dict = {en: new Set(), ro: new Set()};
  for (const lang of ['en', 'ro']) {
    const aff = parseAff(fs.readFileSync(path.join(dir, `${lang}_index.aff`), 'utf8'));
    expandDic(fs.readFileSync(path.join(dir, `${lang}_index.dic`), 'utf8'), aff, word => dict[lang].add(normalizeCedilla(word.toLowerCase())));
  }
  const freq = new Map();
  const en = readFrequencies(path.join(dir, 'en_full.txt'), freq, 'en');
  const ro = readFrequencies(path.join(dir, 'ro_full.txt'), freq, 'ro');
  const perMillion = {en: 1e6 / en.total, ro: 1e6 / ro.total};
  const folded = new Map(); // folded Romanian form -> dictionary words that carry diacritics
  for (const word of dict.ro) {
    if (!DIACRITIC_CHARS.test(word)) continue;
    const key = foldDiacritics(word);
    const list = folded.get(key);
    if (list) list.push(word); else folded.set(key, [word]);
  }
  const topWords = new Set();
  for (const {ranks} of [en, ro]) for (const [word, rank] of ranks) if (rank <= params.initialCapTop) topWords.add(word);
  return new Spellfix({params, dict, freq, perMillion, folded, topWords, ranks: {en: en.ranks, ro: ro.ranks},
    sources: {dir, files: ['en_index.aff', 'en_index.dic', 'ro_index.aff', 'ro_index.dic', 'en_full.txt', 'ro_full.txt']}});
}

class Spellfix {
  constructor(state) { Object.assign(this, state); }

  inDictionary(word) { return this.dict.en.has(word) || this.dict.ro.has(word); }

  known(word) {
    if (this.inDictionary(word)) return true;
    const top = this.params.knownTop;
    return (this.ranks.en.get(word) ?? Infinity) <= top || (this.ranks.ro.get(word) ?? Infinity) <= top;
  }

  /** Per-million frequency weighted by the message language. */
  frequency(word, language) {
    const entry = this.freq.get(word);
    if (!entry) return 0;
    const w = this.params.otherLanguageWeight;
    const en = entry.en * this.perMillion.en * (language === 'ro' ? w : 1);
    const ro = entry.ro * this.perMillion.ro * (language === 'en' ? w : 1);
    return Math.max(en, ro);
  }

  /** Single-edit candidates that are known words, with a keyboard-aware cost. */
  editCandidates(word) {
    const out = new Map();
    const add = (candidate, cost, kind) => {
      if (candidate === word || !this.known(candidate)) return;
      const previous = out.get(candidate);
      if (!previous || previous.cost > cost) out.set(candidate, {cost, kind});
    };
    const chars = [...word];
    for (let i = 0; i < chars.length; i++) {
      // Deleting chars[i] undoes an inserted key: cheap when it doubles or neighbours an adjacent letter.
      const neighbour = chars[i] === chars[i - 1] || chars[i] === chars[i + 1] || adjacentKeys(chars[i], chars[i - 1]) || adjacentKeys(chars[i], chars[i + 1]);
      add([...chars.slice(0, i), ...chars.slice(i + 1)].join(''), neighbour ? 0.5 : 0.9, 'insertion');
      for (const letter of LETTERS) {
        if (letter === chars[i]) continue;
        const cost = diacriticVariants(letter, chars[i]) ? 0.15 : adjacentKeys(letter, chars[i]) ? 0.5 : 1.0;
        add([...chars.slice(0, i), letter, ...chars.slice(i + 1)].join(''), cost, cost === 0.15 ? 'diacritic' : 'substitution');
      }
      if (i + 1 < chars.length && chars[i] !== chars[i + 1]) {
        add([...chars.slice(0, i), chars[i + 1], chars[i], ...chars.slice(i + 2)].join(''), 0.6, 'transposition');
      }
    }
    for (let i = 0; i <= chars.length; i++) for (const letter of LETTERS) {
      add([...chars.slice(0, i), letter, ...chars.slice(i)].join(''), 0.8, 'deletion');
    }
    for (const candidate of this.folded.get(foldDiacritics(word)) ?? []) {
      let changed = 0;
      [...candidate].forEach((char, i) => { if (char !== chars[i]) changed++; });
      add(candidate, Math.min(0.5, 0.15 * changed), 'diacritic');
    }
    return out;
  }

  /** Chooses one correction for an unknown lower-case word, or null. */
  choose(word, language, {initialCap = false, allowEdits = true, merges = []} = {}) {
    const {params} = this;
    const candidates = allowEdits ? this.editCandidates(word) : new Map();
    // A word split by a stray space: joining it with a neighbour gives a dictionary word.
    for (const merge of merges) if (this.inDictionary(merge.to) && !CUES.has(merge.to)) candidates.set(merge.to, {cost: 0.3, kind: 'merge', span: merge.span});
    if (!allowEdits) for (const candidate of this.folded.get(foldDiacritics(word)) ?? []) {
      if (candidate !== word) candidates.set(candidate, {cost: 0.15, kind: 'diacritic'});
    }
    // Two words merged by a missing space; a one-letter half only for the one-letter words of the language.
    const single = new Set(language === 'en' ? ['a', 'i'] : language === 'ro' ? ['a', 'o', 'e'] : ['a', 'i', 'o', 'e']);
    if (allowEdits && word.length >= 4) for (let i = 1; i <= word.length - 1; i++) {
      const a = word.slice(0, i), b = word.slice(i);
      if ((a.length === 1 && !single.has(a)) || (b.length === 1 && !single.has(b)) || (a.length === 1 && b.length === 1)) continue;
      if (!this.inDictionary(a) || !this.inDictionary(b) || CUES.has(a) || CUES.has(b)) continue;
      if (Math.min(this.frequency(a, language), this.frequency(b, language)) < params.splitPerMillion) continue;
      candidates.set(`${a} ${b}`, {cost: 0.5, kind: 'split', parts: [a, b]});
    }
    // A Romanian word typed without diacritics is far more likely than two merged words ("intretine").
    if ([...candidates.values()].some(info => info.kind === 'diacritic')) {
      for (const [candidate, info] of candidates) if (info.kind === 'split') candidates.delete(candidate);
    }
    const scored = [];
    for (const [candidate, info] of candidates) {
      if (CUES.has(candidate)) continue;
      const f = info.parts ? Math.min(...info.parts.map(p => this.frequency(p, language))) : this.frequency(candidate, language);
      scored.push({to: candidate, kind: info.kind, cost: info.cost, span: info.span, perMillion: f, score: Math.log10(f + 1e-3) - params.costWeight * info.cost});
    }
    scored.sort((x, y) => y.score - x.score || x.to.localeCompare(y.to));
    const [best, second] = scored;
    const floor = [...word].length >= 8 ? params.minPerMillionLong : params.minPerMillion;
    if (!best || best.perMillion < floor) return null;
    if (second && best.score - second.score < params.margin) return null;
    if (initialCap && !this.topWords.has(best.to)) return null;
    return {...best, runner_up: second ? {to: second.to, score: +second.score.toFixed(3)} : null};
  }

  /** Language of the message from dictionary-exclusive words: `en`, `ro` or `mixed`. */
  detectLanguage(words) {
    let en = 0, ro = 0;
    for (const word of words) {
      const inEn = this.dict.en.has(word), inRo = this.dict.ro.has(word);
      if (inEn && !inRo) en++;
      if (inRo && !inEn) ro++;
      if (DIACRITIC_CHARS.test(word)) ro++;
    }
    if (ro >= 2 * Math.max(en, 1) || (en === 0 && ro > 0)) return 'ro';
    if (en >= 2 * Math.max(ro, 1) || (ro === 0 && en > 0)) return 'en';
    return 'mixed';
  }

  /** Corrects a message; returns `{text, changes, language, ms}`. The input is never modified in place. */
  fix(text) {
    const started = performance.now();
    const protectedSpans = [];
    for (const match of text.matchAll(/"[^"\n]*"|“[^”\n]*”|„[^”“\n]*[”“]|«[^»\n]*»|(?<=^|\s)'[^'\n]+'(?=$|[\s.,;:!?])/gu)) {
      protectedSpans.push([match.index, match.index + match[0].length]);
    }
    const quoted = index => protectedSpans.some(([a, b]) => index >= a && index < b);
    // Tokens: whitespace-delimited chunks, with leading and trailing punctuation outside the word core.
    const tokens = [];
    for (const match of text.matchAll(/\S+/gu)) {
      const chunk = match[0];
      const lead = chunk.match(/^[^\p{L}\p{N}]*/u)[0].length;
      const trail = chunk.match(/[^\p{L}\p{N}]*$/u)[0].length;
      const core = chunk.slice(lead, Math.max(lead, chunk.length - trail));
      tokens.push({chunk, core, start: match.index + lead, end: match.index + lead + core.length, chunkStart: match.index});
    }
    const lowerWords = tokens.filter(t => WORD.test(t.core)).map(t => normalizeCedilla(t.core.toLowerCase()));
    const language = this.detectLanguage(lowerWords);
    // A Romanian message typed without any diacritic licenses restoring a known word to a far more frequent variant.
    const strippedMessage = language !== 'en' && !tokens.some(t => /^\p{Ll}/u.test(t.core) && DIACRITIC_CHARS.test(t.core)) &&
      lowerWords.filter(w => this.dict.ro.has(w) && !this.dict.en.has(w)).length >= 3;
    const changes = [];
    // A message whose lower-case words are mostly unknown and one edit away from nothing known is gibberish or
    // another language: it is left as written.
    const eligible = tokens.filter(t => WORD.test(t.core) && /^\p{Ll}/u.test(t.core) && [...t.core].length >= 3).map(t => t.core);
    const hopeless = w => { const n = normalizeCedilla(w); return !this.known(n) && this.editCandidates(n).size === 0; };
    if (eligible.length && eligible.filter(hopeless).length > 0.5 * eligible.length) {
      return {text, changes, language, stripped_message: strippedMessage, skipped: 'mostly-unknown', ms: performance.now() - started};
    }
    const plain = token => token && token.core && WORD.test(token.core) && token.core === token.core.toLowerCase() &&
      token.chunk === token.core && !quoted(token.start);
    let consumed = -1;
    for (let i = 0; i < tokens.length; i++) {
      if (i <= consumed) continue;
      const token = tokens[i];
      const {core, chunk} = token;
      if (!core || !WORD.test(core) || quoted(token.start)) continue;
      if (/[\d@]|:\/\/|^www\./iu.test(chunk) || /\p{L}\.\p{L}/u.test(chunk)) continue;
      if (/(\p{L})\1\1/u.test(core)) continue; // letters repeated three times are deliberate ("aaaah", "noooo")
      const lower = core.toLowerCase();
      const capitalized = core[0] !== core[0].toLowerCase();
      if (capitalized && (core.length > 1 && core === core.toUpperCase())) continue;
      if (capitalized && core.slice(1) !== core.slice(1).toLowerCase()) continue;
      const previous = tokens[i - 1];
      const sentenceStart = !previous || /[.!?:]["”»)]*$/u.test(previous.chunk);
      if (capitalized && !sentenceStart) continue;
      const word = normalizeCedilla(lower);
      // Contractions typed without an apostrophe ("doesnt", "isnt") carry a negation: never edited.
      if ([...Array(word.length).keys()].some(k => k > 0 && this.dict.en.has(`${word.slice(0, k)}'${word.slice(k)}`))) continue;
      // A capitalized word that occurs in the frequency lists is more likely a name than a typo.
      if (capitalized && this.freq.has(word)) continue;
      const merges = [];
      const prevToken = tokens[i - 1], nextToken = tokens[i + 1];
      const lastChange = changes.at(-1);
      if (!capitalized && plain(prevToken) && prevToken.end + 1 === token.start && !(lastChange && lastChange.end >= prevToken.start) && token.chunk.startsWith(core)) {
        merges.push({to: prevToken.core + word, span: [prevToken.start, token.end], from: text.slice(prevToken.start, token.end)});
      }
      if (plain(nextToken) && token.end + 1 === nextToken.start && token.chunk.endsWith(core)) {
        merges.push({to: word + nextToken.core, span: [token.start, nextToken.end], from: text.slice(token.start, nextToken.end), next: true});
      }
      let choice = null;
      if (word !== lower && this.inDictionary(word)) choice = {to: word, kind: 'cedilla', cost: 0, perMillion: this.frequency(word, language), score: 0, runner_up: null};
      else if (!this.known(word)) {
        choice = this.choose(word, language, {initialCap: capitalized, allowEdits: [...word].length >= this.params.minLength, merges});
      } else if (strippedMessage && !capitalized && !this.dict.en.has(word) && !CUES.has(word) && !DIACRITIC_CHARS.test(word)) {
        const variants = (this.folded.get(word) ?? []).map(v => ({to: v, f: this.frequency(v, 'ro')})).sort((a, b) => b.f - a.f);
        const own = this.frequency(word, 'ro');
        if (variants[0] && !CUES.has(variants[0].to) && variants[0].f >= this.params.contextRatio * Math.max(own, 1e-3) &&
          (!variants[1] || variants[0].f >= this.params.contextRatio * variants[1].f)) {
          choice = {to: variants[0].to, kind: 'diacritic_context', cost: 0.15, perMillion: variants[0].f, score: null,
            runner_up: {to: word, perMillion: +own.toFixed(3)}};
        }
      }
      if (!choice) continue;
      const to = capitalized ? choice.to[0].toUpperCase() + choice.to.slice(1) : choice.to;
      const [start, end] = choice.span ?? [token.start, token.end];
      if (choice.span && choice.span[1] > token.end) consumed = i + 1;
      changes.push({start, end, from: text.slice(start, end), to, kind: choice.kind, language,
        cost: choice.cost, per_million: +choice.perMillion.toFixed(3), score: choice.score === null ? null : +choice.score.toFixed(3), runner_up: choice.runner_up});
    }
    let out = text;
    for (const change of [...changes].reverse()) out = out.slice(0, change.start) + change.to + out.slice(change.end);
    return {text: out, changes, language, stripped_message: strippedMessage, ms: performance.now() - started};
  }
}
