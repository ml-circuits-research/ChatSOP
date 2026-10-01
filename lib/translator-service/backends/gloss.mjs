/**
 * TranslatorService mode `gloss`: a morphology-aware word-by-word Romanian → English gloss that KEEPS the Romanian
 * word order (owner idea of 2026-10-01; DS021 "TranslatorService gloss mode"). It is the input of LanguageProofingLLM
 * as a post-editor: the vocabulary is already English, the model only repairs word order and grammar. The existing
 * `symbolic` backend (clause realizer that reorders) is not changed; this is a separate file that reuses its closed
 * tables (`GLOSS_TABLES`) and the English realizer (english.mjs).
 *
 * Per Romanian token, from the Stanza Romanian parse (lemma, UPOS, features) and LanguagesUtil's language id:
 *   - nouns: dictionary sense of the lemma, plural from Number, "the" from Definite, "of" before a genitive;
 *   - verbs: the dictionary verb inflected from the features, including the Romanian compound forms (perfect
 *     "am lucrat" → past, future "va lucra" → "will work", conditional "aș lucra" → "would work", passive
 *     "este înscris" → "is enrolled"), negation "nu" with do-support when the group is simple, the clitic "se"
 *     (passive, or dropped for a reflexive), clitic pronouns ("mi-" → "to me");
 *   - function words from the closed tables; possessives, demonstratives, numerals, prepositions in place;
 *   - English words, names, numbers and quoted text are copied unchanged.
 * The ROMANIAN WORD ORDER IS KEPT ("nepoata mea" → "the niece my").
 *
 * Unknown content lemmas are copied unchanged in SQUARE BRACKETS with the surface as written: `[nepoată]`. The
 * brackets tell the post-editor which words the gloss could not translate (translate or keep), cost two ASCII tokens,
 * and never occur in the training prompts otherwise. Option `mark: ['', '']` copies without marking.
 *
 * Romglish (Romanian grammar with English words): an English stem with a Romanian enclitic article or plural
 * ("deadline-ul", "update-urile") becomes "the deadline", "the updates"; an English verb with Romanian inflection
 * ("forwardat", "share-uiesc", "checkuiesc") is recovered from a suffix rule set and re-inflected from the Romanian
 * morphology ("am forwardat" → "I forwarded"); an English-frame sentence (LanguagesUtil frame detection) keeps its
 * English and only the inserted Romanian runs are glossed on their own ("Can you check the factura" → "... the invoice").
 */
import {indexSentence, kids, base} from '../../ud-to-sop/tree.mjs';
import {fold} from '../../../sop/dictionary.mjs';
import {inflectVerb, pluralize, indefinite} from './english.mjs';
import {GLOSS_TABLES as T, joinPieces} from './symbolic.mjs';
import {detectFrame} from '../../languages-util/frame.mjs';
import {functionLanguage} from '../../languages-util/langid.mjs';

export const GLOSS_VERSION = 'translator-gloss-v1';
export const DEFAULT_MARK = Object.freeze(['[', ']']);

const AUX_FORMS = new Set(['am', 'ai', 'a', 'au', 'ati', 'as', 'ar']);
const PLURAL_SUFFIX = new Set(['uri', 'urile', 'urilor', 'ii', 'ilor', 'le', 'lele', 'lor']);
const GENITIVE_SUFFIX = new Set(['ului', 'urilor', 'ilor', 'ei']);
// Enclitic article / plural endings of a foreign noun, folded; value [definite, plural, genitive].
const NOUN_SUFFIX = Object.freeze({ul: [1, 0, 0], ului: [1, 0, 1], uri: [0, 1, 0], urile: [1, 1, 0], urilor: [1, 1, 1], le: [1, 1, 0], lele: [1, 1, 0], ii: [1, 1, 0], ilor: [1, 1, 1], lor: [1, 1, 1], i: [0, 1, 0], ele: [1, 1, 0]});
// Verb suffixes of an English verb with Romanian inflection: [suffix, form, person, number].
const VERB_SUFFIX = Object.freeze([
  ['uiesc', 'pres', 1, 'Sing'], ['uiești', 'pres', 2, 'Sing'], ['uiește', 'pres', 3, 'Sing'], ['uim', 'pres', 1, 'Plur'], ['uiți', 'pres', 2, 'Plur'], ['uit', 'part'], ['uind', 'ing'], ['ui', 'inf'],
  ['uiesti', 'pres', 2, 'Sing'], ['uieste', 'pres', 3, 'Sing'], ['uiti', 'pres', 2, 'Plur'],
  ['ez', 'pres', 1, 'Sing'], ['ezi', 'pres', 2, 'Sing'], ['ează', 'pres', 3, 'Sing'], ['eaza', 'pres', 3, 'Sing'], ['ăm', 'pres', 1, 'Plur'], ['am', 'pres', 1, 'Plur'], ['ați', 'pres', 2, 'Plur'], ['ati', 'pres', 2, 'Plur'],
  ['at', 'part'], ['ând', 'ing'], ['a', 'inf'],
]);
const CLITICS = Object.freeze({mi: 'to me', ti: 'to you', ne: 'us', va: 'you', i: 'to him', ii: 'to him', le: 'them', li: 'to them', l: 'him', il: 'him', o: 'her', m: 'me', te: 'you', ma: 'me', v: 'you', s: ''});
const REFLEXIVE_CLITICS = new Set(['se', 'si', 'isi', 'ma', 'te', 'ne', 'va', 'm', 'ti', 'mi', 's']);
const EXTRA_PHRASES = [[['asa', 'e'], 'right'], [['asa', 'este'], 'right'], [['te', 'rog'], 'please'], [['va', 'rog'], 'please'], [['va', 'rugam'], 'please'], [['multumesc', 'anticipat'], 'thanks in advance'], [['mersi', 'anticipat'], 'thanks in advance']];
// "a avea" + bare noun: "am nevoie" = "I need", "am voie" = "I am allowed".
const VERB_OBJECT = Object.freeze({nevoie: 'need', voie: 'be allowed'});
// Surfaces whose lemma a diacritic-less parse loses, and verb endings of an unknown surface mapped to the infinitive.
const IRREGULAR_SURFACE = Object.freeze({poti: 'putea', pot: 'putea', poate: 'putea', putem: 'putea', puteti: 'putea', pute: 'putea'});
const INFINITIVE_ENDINGS = Object.freeze([['ici', 'ica'], ['ezi', 'a'], ['eaza', 'a'], ['ez', 'a'], ['ati', 'a'], ['esti', 'i'], ['este', 'i'], ['esc', 'i'], ['imi', 'i'], ['im', 'i']]);
const CLOSED_ADP = new Set(['la', 'in', 'din', 'pe', 'cu', 'pentru', 'fara', 'spre', 'catre', 'intre', 'despre', 'dupa', 'prin']);
const QUOTES = new Set(['"', '“', '”', '„', '«', '»']);
const EN_DETERMINERS = new Set(['the', 'a', 'an', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her', 'our', 'their', 'some', 'any', 'no', 'every']);

const clean = verb => String(verb).replace(/^to /, '');
const feat = (word, key) => word?.feats?.[key] ?? null;
const has = (word, key, value) => String(feat(word, key) ?? '').split(',').includes(value);
const lower1 = text => (/^I(?=[ ']|$)/.test(text) ? text : text.charAt(0).toLowerCase() + text.slice(1));

/** Realize an English verb group from a form; `verb` is the base phrase ("work", "be", "take part in"). */
export function verbGroup({verb, form, person = 3, number = 'Sing', neg = false, passive = false}) {
  const v = clean(verb);
  const head = v.split(' ')[0].toLowerCase();
  const not = neg ? ' not' : '';
  if (passive) {
    const be = verbGroup({verb: 'be', form, person, number, neg});
    return `${be} ${inflectVerb(v, 'part')}`;
  }
  if (head === 'be') {
    switch (form) {
      case 'pres': return `${inflectVerb('be', 'present', {person, number})}${not}${v.slice(2)}`;
      case 'past': return `${inflectVerb('be', 'past', {person, number})}${not}${v.slice(2)}`;
      case 'fut': return `will${not} be${v.slice(2)}`;
      case 'cnd': return `would${not} be${v.slice(2)}`;
      case 'cndperf': return `would${not} have been${v.slice(2)}`;
      case 'pqp': return `had${not} been${v.slice(2)}`;
      case 'part': return 'been';
      case 'ing': return 'being';
      default: return `${neg ? 'not ' : ''}be${v.slice(2)}`;
    }
  }
  switch (form) {
    case 'pres': return neg ? `${number === 'Sing' && person === 3 ? 'does' : 'do'} not ${v}` : inflectVerb(v, 'present', {person, number});
    case 'past': return neg ? `did not ${v}` : inflectVerb(v, 'past');
    case 'fut': return `will${not} ${v}`;
    case 'cnd': return `would${not} ${v}`;
    case 'cndperf': return `would${not} have ${inflectVerb(v, 'part')}`;
    case 'pqp': return `had${not} ${inflectVerb(v, 'part')}`;
    case 'part': return inflectVerb(v, 'part');
    case 'ing': return inflectVerb(v, 'ing');
    case 'imp': return neg ? `do not ${v}` : v;
    default: return `${neg ? 'not ' : ''}${v}`;
  }
}

/** Gloss one parsed Romanian sentence. Instances are per message. */
export class Glosser {
  /**
   * `dictionary`: sop/dictionary.mjs Dictionary; `labels`: Map "start:end" → LanguagesUtil label of a token;
   * `isEnglish(word)` / `isRomanian(word)`: spellchecker lexicon tests; `senses`: 1 (first dictionary sense) or 2
   * ("granddaughter/niece"); `mark`: [open, close] around an untranslated word.
   */
  constructor({dictionary, labels = new Map(), isEnglish = () => false, isRomanian = () => false, senses = 1, mark = DEFAULT_MARK}) {
    Object.assign(this, {dictionary, labels, isEnglish, isRomanian, senses, mark, events: []});
  }

  // ------------------------------------------------------------------ lexical lookup

  entries(surface, allowed) {
    const hits = this.dictionary.ro.get(fold(surface)) ?? [];
    return hits.map(([index, flag]) => ({entry: this.dictionary.entries[index], flag}))
      .filter(({entry}) => entry.en.length && (!allowed || allowed.includes(entry.pos)))
      .sort((a, b) => (a.entry.priority ?? 100) - (b.entry.priority ?? 100) || (a.flag === 'l' ? -1 : 1) - (b.flag === 'l' ? -1 : 1));
  }

  /** English gloss of a content word: UPOS-agreeing entries first, then any part of speech; null when unknown. */
  lookup(word, allowed) {
    for (const pass of allowed ? [allowed, null] : [null]) {
      for (const surface of [word.lemma, word.text]) {
        if (!surface) continue;
        const [hit] = this.entries(surface, pass);
        if (!hit) continue;
        const en = hit.entry.en.map(clean);
        let text = en[0];
        if (this.senses > 1 && en.length > 1 && !en[1].includes(en[0]) && !en[0].includes(en[1])) text = `${en[0]}/${en[1]}`;
        return {text, senses: en, entry: hit.entry.id, mismatch: Boolean(allowed && !pass)};
      }
    }
    // Diacritic-less or mis-lemmatized verb surfaces: irregular forms and endings mapped to an infinitive.
    if (allowed?.includes('verb') || word.upos === 'VERB' || word.upos === 'AUX') {
      const f = fold(word.text);
      const candidates = [IRREGULAR_SURFACE[f], ...INFINITIVE_ENDINGS.filter(([end]) => f.endsWith(end) && f.length > end.length + 2).map(([end, inf]) => f.slice(0, -end.length) + inf)].filter(Boolean);
      for (const infinitive of candidates) {
        const [hit] = this.entries(infinitive, ['verb', 'relation']);
        if (hit) return {text: clean(hit.entry.en[0]), senses: hit.entry.en.map(clean), entry: hit.entry.id, mismatch: false, repaired: infinitive};
      }
    }
    return null;
  }

  label(word) {
    const exact = this.labels.get(`${word.start}:${word.end}`);
    if (exact) return exact;
    for (const [key, label] of this.labels) {
      const [a, b] = key.split(':').map(Number);
      if (a <= word.start && word.end <= b) return label;
    }
    return null;
  }

  /** An English stem with a Romanian enclitic article or plural, unsplit ("updateurile", "update-urile"): [stem, def, plural, gen] or null. */
  stemSplit(text, relaxed = false) {
    const m = /^(.{3,}?)-?(ului|urilor|urile|uri|lele|lele|ilor|lor|ul|ii)$/iu.exec(text);
    if (!m) return null;
    const stem = m[1];
    const [def, plural, gen] = NOUN_SUFFIX[fold(m[2])] ?? [];
    const hyphen = /-/.test(text);
    if (def === undefined || !this.isEnglish(stem) || (!hyphen && !relaxed && this.isRomanian(text)) || this.dictionary.ro.has(fold(text)) || this.dictionary.ro.has(fold(stem))) return null;
    return [stem, def, plural, gen];
  }

  /** An English verb with Romanian inflection: {stem, form, person, number} or null. The whole token must be neither Romanian nor English. */
  verbSplit(text) {
    if (!/^\p{L}[\p{L}-]*$/u.test(text) || this.isRomanian(text) || this.dictionary.ro.has(fold(text)) || this.isEnglish(text)) return null;
    const lowered = text.toLowerCase();
    for (const [suffix, form, person, number] of VERB_SUFFIX) {
      if (!lowered.endsWith(suffix)) continue;
      const raw = lowered.slice(0, -suffix.length).replace(/-$/, '');
      if (raw.length < 3) continue;
      const candidates = [raw, raw + 'e', raw.at(-1) === raw.at(-2) ? raw.slice(0, -1) : null].filter(Boolean);
      const stem = candidates.find(c => this.isEnglish(c) && !this.dictionary.ro.has(fold(c)));
      if (stem) return {stem, form, person, number};
    }
    return null;
  }

  // ------------------------------------------------------------------ pieces

  piece(text, word, kind, extra = {}) {
    return {text, src: word ? [word.text] : [], kind, ...extra};
  }

  note(word, kind, en, extra = {}) {
    this.events.push({ro: word.text, lemma: word.lemma, upos: word.upos, kind, en, ...extra});
  }

  /** The content-word piece: a dictionary gloss, a copy, or a marked unknown. */
  content(word, allowed, S, {form = null} = {}) {
    const found = this.lookup(word, allowed);
    if (found) { this.note(word, 'tr', found.text, {entry: found.entry, mismatch: found.mismatch, senses: found.senses}); return found.text; }
    return this.unknown(word);
  }

  unknown(word) {
    if (!/\p{L}/u.test(word.text)) return word.text;
    // A word the dictionary lacks but the English lexicon has ("backup"), or an English stem with a Romanian ending ("clusterul").
    const cl = CLITICS[fold(word.text.replace(/-$/, ''))];
    if (cl !== undefined && word.text.length <= 3 && word.upos !== 'NOUN') { this.note(word, 'fn', cl); return cl; }
    if (word.text.length > 2 && this.isEnglish(word.text)) { this.note(word, 'en', word.text); return word.text; }
    const split = word.text.length > 5 && !/^\p{Lu}/u.test(word.text) ? this.stemSplit(word.text, true) : null;
    if (split && split[0].length >= 4) { word.enNoun = {stem: split[0], def: Boolean(split[1]), plural: Boolean(split[2]), gen: Boolean(split[3])}; return this.enNoun(word); }
    this.note(word, 'unk', null);
    return `${this.mark[0]}${word.text}${this.mark[1]}`;
  }

  isName(word, S) {
    const label = this.label(word);
    if (label === 'name') return true;
    if (!/^\p{Lu}/u.test(word.text)) return false;
    if (S.words[0] === word && (T.WH[fold(word.text)] !== undefined || T.MARKS[fold(word.text)] || T.CONJUNCTIONS[fold(word.text)] || ['deci', 'dar', 'insa', 'apoi', 'sincer', 'daca', 'cand', 'unde'].includes(fold(word.text)))) return false;
    if (word.upos === 'PROPN') return true;
    if (S.words[0] === word && /^[,:;]$/.test(S.words[1]?.text ?? '') && this.lookup(word, null)) return false;
    if (word.upos === 'NOUN' && /^\p{Lu}/u.test(word.lemma ?? '')) return true;
    // A capitalized word inside a sentence (not after a sentence or clause start) is a name; ALL CAPS is noise, not a name.
    if (!/^\p{Lu}\p{Ll}/u.test(word.text) || S.words[0] === word || word.upos === 'ADP') return false;
    const prev = S.byId.get(word.id - 1);
    if (prev && prev.upos === 'PUNCT' && /[.!?:;"“„«(]/.test(prev.text)) return false;
    return label !== 'en' || true;
  }

  // ------------------------------------------------------------------ sentence

  /** Gloss one sentence of the parse (an indexed sentence or a raw one with `words`); returns the pieces. */
  sentence(raw, index = 0) {
    const S = raw.byId ? raw : indexSentence(raw, index);
    this.S = S;
    this.used = new Set();
    this.out = new Map();
    const words = S.words;
    // Quoted spans are copied verbatim.
    let quote = false;
    for (const w of words) {
      if (QUOTES.has(w.text)) { quote = !quote; continue; }
      w.quoted = quote;
    }
    this.markEnglishTokens(S);
    this.markPhrases(S);
    this.markEnclitics(S);
    this.markGroups(S);
    const pieces = [];
    for (const w of words) {
      if (this.out.has(w.id)) pieces.push(...this.out.get(w.id));
      if (this.used.has(w.id)) continue;
      pieces.push(...this.word(w, S));
    }
    for (let i = 0; i + 1 < pieces.length; i++) if (/(^|\s)of$/.test(pieces[i].text) && /^of( |$)/.test(pieces[i + 1].text)) pieces[i + 1].text = pieces[i + 1].text.replace(/^of ?/, '');
    for (let i = 0; i + 1 < pieces.length; i++) if (pieces[i].kind === 'copy' && EN_DETERMINERS.has(pieces[i].text.toLowerCase()) && /^the /.test(pieces[i + 1].text)) pieces[i + 1].text = pieces[i + 1].text.replace(/^the /, '');
    // "a" → "an" before a vowel sound.
    pieces.forEach((p, i) => { if (p.kind === 'indef') { const next = pieces.slice(i + 1).find(q => q.text); if (next) p.text = indefinite(next.text); } });
    const first = pieces.find(p => p.text && /\p{L}/u.test(p.text));
    if (first && /^\p{Ll}/u.test(first.text) && /^\p{Lu}/u.test(words.find(w => /\p{L}/u.test(w.text))?.text ?? '')) first.text = first.text[0].toUpperCase() + first.text.slice(1);
    return pieces;
  }

  /** English stems with a Romanian suffix and English verbs with Romanian inflection become `enNoun` / `enVerb`. */
  markEnglishTokens(S) {
    for (const w of S.words) {
      if (w.quoted || !/\p{L}/u.test(w.text)) continue;
      const next = S.words[w.id]; // the word after w (ids are 1-based and dense)
      const suffix = next && next.id === w.id + 1 && /^-\p{L}+$/u.test(next.text) ? fold(next.text.slice(1)) : null;
      const label = this.label(w);
      const initial = S.words.find(x => /\p{L}/u.test(x.text)) === w;
      const englishStem = (label === 'en' || label === 'ro' || (label === 'name' && initial)) && this.isEnglish(w.text) && !this.dictionary.ro.has(fold(w.text));
      // An explicit enclitic article after a word that is neither Romanian nor English is a foreign noun with a Romanian article ("feedback-ul").
      const foreignStem = !englishStem && /^\p{L}{3,}$/u.test(w.text) && !this.isRomanian(w.text) && !this.dictionary.ro.has(fold(w.text)) && label !== 'en';
      if (suffix && NOUN_SUFFIX[suffix] && (englishStem || foreignStem)) {
        const [def, plural, gen] = NOUN_SUFFIX[suffix];
        w.enNoun = {stem: w.text, def: Boolean(def), plural: Boolean(plural), gen: Boolean(gen)};
        this.used.add(next.id);
        continue;
      }
      if (next && next.id === w.id + 1 && /^-\p{L}+$/u.test(next.text)) {
        const joined = this.verbSplit(w.text + next.text);
        if (joined) { w.enVerb = joined; this.used.add(next.id); continue; }
      }
      const split = /^\p{Lu}/u.test(w.text) && !(initial && /-/.test(w.text)) ? null : this.stemSplit(w.text);
      if (split) { w.enNoun = {stem: split[0], def: Boolean(split[1]), plural: Boolean(split[2]), gen: Boolean(split[3])}; continue; }
      if ((/^\p{Ll}/u.test(w.text) || initial) && (['VERB', 'NOUN', 'ADJ', 'X', 'PROPN', 'AUX'].includes(w.upos) || label === 'ro' || label === 'name')) {
        let verb = this.verbSplit(w.text.replace(/-$/, '').toLowerCase());
        if (verb && /^\p{Lu}/u.test(w.text) && verb.stem.length < 4) verb = null;
        // The bare infinitive ending -a needs the infinitive marker before it ("a forwarda", "să forwarda").
        if (verb && (verb.form !== 'inf' || ['a', 'sa'].includes(fold(S.byId.get(w.id - 1)?.text ?? '')) || /ui$/i.test(w.text))) w.enVerb = verb;
      }
    }
  }

  /** Multiword expressions and compound prepositions ("de la" → "from", "de câte ori" → "how many times") become one piece. */
  markPhrases(S) {
    const words = S.words;
    const folded = words.map(w => fold(w.text));
    const compound = Object.entries(T.PREPOSITIONS).filter(([k]) => k.includes(' ')).map(([k, v]) => [k.split(' '), v]);
    const list = [...T.WH_PHRASES, ...EXTRA_PHRASES, ...T.MWE.filter(([ro]) => ro[0] !== 'nu'), ...compound].sort((a, b) => b[0].length - a[0].length);
    for (let i = 0; i < words.length; i++) {
      if (this.used.has(words[i].id) || words[i].quoted) continue;
      for (const [ro, en] of list) {
        if (ro.length < 2 || i + ro.length > words.length) continue;
        if (!ro.every((x, k) => folded[i + k] === x && !words[i + k].quoted && !this.used.has(words[i + k].id) && !words[i + k].enNoun && !words[i + k].enVerb)) continue;
        if (this.label(words[i]) === 'en') continue;
        for (let k = 0; k < ro.length; k++) this.used.add(words[i + k].id);
        const p = this.piece(en, words[i], 'fn');
        this.out.set(words[i].id, [...(this.out.get(words[i].id) ?? []), p]);
        this.note(words[i], 'fn', en, {phrase: ro.join(' ')});
        i += ro.length - 1;
        break;
      }
    }
  }

  /** Enclitic articles split off by the parser ("-ul", "-urile") decorate their noun. */
  markEnclitics(S) {
    for (const w of S.words) {
      if (!/^-\p{L}+$/u.test(w.text) || w.upos !== 'DET' || w.feats?.PronType !== 'Art') continue;
      const head = S.byId.get(w.head);
      if (!head || head.enNoun || this.used.has(w.id)) continue;
      const s = fold(w.text.slice(1));
      head.deco = {def: true, plural: PLURAL_SUFFIX.has(s) || has(w, 'Number', 'Plur'), gen: GENITIVE_SUFFIX.has(s)};
      this.used.add(w.id);
    }
  }

  // ------------------------------------------------------------------ verb groups

  subjectOf(M, S) {
    const P = this.predicateOf(M, S);
    const real = k => !T.WH[fold(k.lemma ?? k.text)];
    return kids(P, 'nsubj').find(real) ?? kids(M, 'nsubj').find(real) ?? null;
  }
  predicateOf(M, S) { return M.deprel === 'cop' ? S.byId.get(M.head) ?? M : M; }

  personNumber(M, carrier, S) {
    const subj = this.subjectOf(M, S);
    if (subj) {
      if (subj.upos === 'PRON') {
        const p = feat(subj, 'Person'), n = feat(subj, 'Number');
        if (p && n) return {person: Number(p), number: n};
      }
      const plural = has(subj, 'Number', 'Plur') || kids(subj, 'conj').length > 0 || subj.deco?.plural || subj.enNoun?.plural;
      return {person: 3, number: plural ? 'Plur' : 'Sing'};
    }
    const f = carrier.feats ?? {};
    return {person: Number(f.Person ?? 3), number: f.Number ?? 'Sing'};
  }

  /** Build the verb group of every main verb of the sentence and absorb its auxiliaries and "nu". */
  markGroups(S) {
    const mains = S.words.filter(w => (w.enVerb || !this.isName(w, S)) && (w.upos === 'VERB' || w.enVerb || (w.upos === 'AUX' && (w.deprel === 'cop' || !['aux', 'aux:pass'].includes(w.deprel)))) && !w.quoted);
    for (const M of mains) {
      if (this.used.has(M.id)) continue;
      const P = this.predicateOf(M, S);
      const owners = M === P ? [M] : [M, P];
      const auxes = owners.flatMap(o => kids(o, 'aux')).filter(a => a.upos === 'AUX' || a.upos === 'PART' || a.upos === 'VERB');
      // Parser misses: a Romanian auxiliary form right before the participle or infinitive.
      for (let id = M.id - 1; id >= Math.max(1, M.id - 2); id--) {
        const prev = S.byId.get(id);
        if (!prev || auxes.includes(prev) || this.used.has(prev.id) || prev.head === M.head && prev.deprel !== 'aux') continue;
        if (['AUX'].includes(prev.upos) && !kids(M, 'cop').includes(prev) || (AUX_FORMS.has(fold(prev.text)) && prev.upos === 'AUX')) auxes.push(prev);
      }
      auxes.sort((a, b) => a.id - b.id);
      const neg = owners.flatMap(o => kids(o, 'advmod', 'neg')).filter(n => fold(n.lemma) === 'nu' || fold(n.text) === 'nu');
      let expl = kids(M, 'expl').filter(k => REFLEXIVE_CLITICS.has(fold(k.text.replace(/-$/, ''))));
      // A reflexive clitic of a verb listed in the reflexive table ("mă întreb", also without diacritics) is absorbed with it.
      if (T.REFLEXIVE[fold(M.lemma ?? M.text)]) expl = [...new Set([...expl, ...kids(M, 'obj', 'iobj', 'expl', 'nsubj', 'dep', 'obl').filter(k => k.upos === 'PRON' && ['ma', 'te', 'se', 'ne', 'va'].includes(fold(k.text.replace(/-$/, ''))))])];
      const mark = kids(M, 'mark').filter(m => ['a', 'sa'].includes(fold(m.lemma ?? m.text)) || m.upos === 'PART');
      const lemmaM = fold(M.lemma ?? M.text);
      let forced = null;
      if (T.EXPERIENCER[lemmaM]) {
        const clitics = kids(M, 'obj', 'iobj', 'expl', 'dep', 'obl').filter(k => k.upos === 'PRON' && ['ma', 'mi', 'm'].includes(fold(k.text.replace(/-$/, ''))));
        if (clitics.length) { forced = {verb: T.EXPERIENCER[lemmaM], person: 1, number: 'Sing'}; expl = [...expl, ...clitics]; }
      }
      const need = lemmaM === 'avea' ? [...kids(M, 'obj', 'obl', 'dep', 'nmod'), S.byId.get(M.id + 1)].find(k => k && VERB_OBJECT[fold(k.lemma ?? k.text)]) : null;
      if (need) { forced = {verb: VERB_OBJECT[fold(need.lemma ?? need.text)]}; this.used.add(need.id); }
      // Light verb with a bare English noun ("am dat check" → "I checked").
      const light = lemmaM === 'da' ? kids(M, 'obj').find(k => /^[a-z]+$/.test(k.text) && !kids(k, 'det').length && this.isEnglish(k.text) && !this.dictionary.ro.has(fold(k.text))) : null;
      if (light) { forced = {verb: light.text}; this.used.add(light.id); }
      const spec = this.groupSpec(M, auxes, neg, expl, mark, S, forced);
      if (!spec) continue;
      // An unknown verb keeps its auxiliaries, "nu" and clitics as separate words (a negation is never swallowed by a copied verb).
      const first = spec.known ? [...auxes, ...neg, M].sort((a, b) => a.id - b.id)[0] : M;
      if (spec.known) for (const w of [...auxes, ...neg, ...expl]) { if (w !== M) this.used.add(w.id); }
      const text = spec.text;
      this.used.add(M.id);
      const piece = this.piece(text, M, 'verb', {group: auxes.concat(neg).map(w => w.text)});
      const list = this.out.get(first.id) ?? [];
      list.push(piece);
      this.out.set(first.id, list);
      if (spec.known) this.note(M, 'tr', spec.en, {form: spec.form, entry: spec.entry, senses: spec.senses});
    }
  }

  groupSpec(M, auxes, neg, expl, mark, S, forced = null) {
    const lemma = fold(M.lemma ?? M.text);
    const auxLemmas = auxes.map(a => fold(a.lemma ?? a.text));
    const mf = M.feats ?? {};
    let verb, known = true, entry = null, senses = null;
    const modal = T.MODAL_VERBS[lemma];
    if (forced?.verb) verb = forced.verb;
    else if (M.enVerb) verb = M.enVerb.stem;
    else if (lemma === 'fi') verb = 'be';
    else if (modal) verb = modal[0];
    else {
      const reflexive = expl.length && !expl.some(e => e.deprel === 'expl:pass') ? T.REFLEXIVE[lemma] : null;
      if (reflexive) verb = reflexive;
      else {
        const found = this.lookup(M, ['verb', 'relation']);
        if (found) { verb = found.text.split('/')[0]; entry = found.entry; senses = found.senses; if (this.senses > 1 && found.text.includes('/')) verb = found.text; }
        else { known = false; verb = null; }
      }
    }
    if (!verb) {
      // Unknown verb: copy marked; the group's function words are glossed on their own.
      for (const a of auxes) this.used.delete(a.id);
      return {text: this.unknown(M), known: false, en: null, form: null};
    }
    // Form of the group.
    const inf = mf.VerbForm === 'Inf' && !modal;
    const has = l => auxLemmas.includes(l);
    const aux = x => auxes.find(a => fold(a.lemma ?? a.text) === x);
    const feniForm = M.enVerb?.form;
    let form, passive = false;
    const partLike = mf.VerbForm === 'Part' || feniForm === 'part';
    const infLike = mf.VerbForm === 'Inf' || feniForm === 'inf';
    const fiAux = aux('fi');
    const saBefore = fold(S.byId.get(M.id - 1)?.text ?? '') === 'sa' || (auxes.length && fold(S.byId.get(auxes[0].id - 1)?.text ?? '') === 'sa');
    if (mark.length || saBefore || mf.Mood === 'Sub' || (infLike && !auxes.length)) form = 'base';
    else if (auxes.length) {
      if (has('vrea') && (infLike || mf.VerbForm === 'Inf')) form = 'fut';
      else if (has('avea') && infLike) form = 'cnd';
      else if (has('avea') && fiAux && fold(fiAux.text) === 'fi' && (partLike || lemma === 'fi')) form = 'cndperf';
      else if (has('fi') && partLike && lemma !== 'fi') { passive = true; form = has('avea') ? 'past' : (has('vrea') ? 'fut' : (fiAux.feats?.Tense === 'Past' || fiAux.feats?.Tense === 'Imp' ? 'past' : 'pres')); }
      else if (has('avea') && (partLike || lemma === 'fi')) form = 'past';
      else if (has('fi') && lemma === 'fi') form = 'past';
      else form = 'pres';
    } else if (partLike) form = 'part';
    else if (mf.VerbForm === 'Ger' || feniForm === 'ing') form = 'ing';
    else if (M.enVerb && feniForm === 'pres') form = 'pres';
    else if (mf.Mood === 'Imp') form = 'imp';
    else if (mf.Tense === 'Pqp') form = 'pqp';
    else if (mf.Tense === 'Past' || mf.Tense === 'Imp') form = 'past';
    else if (M.enVerb && feniForm) form = feniForm === 'pres' ? 'pres' : 'pres';
    else form = 'pres';
    // Passive "se": "se spune că" → "is said".
    if (expl.some(e => ['expl:pass', 'expl:impers'].includes(e.deprel)) && !passive && ['pres', 'past'].includes(form)) passive = true;
    // Modal "putea"/"trebui" with an infinitive: "can work".
    const carrier = auxes[0] ?? M;
    let {person, number} = this.personNumber(M, carrier, S);
    if (forced?.person) ({person, number} = forced);
    // The Romanian ending of an English verb carries the person ("share-uiesc" = 1 singular); a third person keeps the subject's number.
    if (M.enVerb?.person && (M.enVerb.person !== 3 || !this.subjectOf(M, S))) ({person, number} = {person: M.enVerb.person, number: M.enVerb.number});
    const negated = neg.length > 0;
    const vrea = lemma === 'vrea' ? T.VREA_FORMS[fold(M.text)] : null;
    if (vrea && form === 'past') { form = 'pres'; person = vrea[0]; number = vrea[1]; }
    let text;
    if (modal && ['pres', 'past', 'fut', 'cnd'].includes(form)) {
      const past = form === 'past' || mf.Tense === 'Past' || mf.Tense === 'Imp';
      if (lemma === 'putea') text = past ? (negated ? 'could not' : 'could') : (negated ? 'cannot' : 'can');
      else text = past ? (negated ? 'did not have to' : 'had to') : (negated ? 'must not' : 'must');
      if (form === 'cnd') text = lemma === 'putea' ? (negated ? 'could not' : 'could') : (negated ? 'should not' : 'should');
      if (form === 'fut') text = lemma === 'putea' ? (negated ? 'will not be able to' : 'will be able to') : (negated ? 'will not have to' : 'will have to');
    } else text = verbGroup({verb, form, person, number, neg: negated, passive});
    // Pro-drop: a finite first or second person verb without a subject gets its pronoun ("am forwardat" → "I forwarded").
    const carrierPerson = Number(forced?.person ?? vrea?.[0] ?? (carrier === M ? M.enVerb?.person : null) ?? carrier.feats?.Person ?? M.enVerb?.person ?? 0);
    const prevWord = S.byId.get([...auxes, ...neg, M].sort((a, b) => a.id - b.id)[0].id - 1);
    const markBefore = ['sa', 'a'].includes(fold(prevWord?.text ?? ''));
    const explicitSubject = markBefore || !expl.includes(prevWord) && prevWord?.upos === 'PRON' && ['eu', 'tu', 'noi', 'voi'].includes(fold(prevWord.lemma ?? prevWord.text));
    const coordinated = M.deprel === 'conj' && S.byId.get(M.head)?.upos === 'VERB';
    if ((forced?.person || (vrea && vrea[0] < 3) || (M.enVerb?.person && M.enVerb.person < 3) || !this.subjectOf(M, S)) && !explicitSubject && !coordinated && !passive && ['pres', 'past', 'fut', 'cnd', 'pqp', 'cndperf'].includes(form) && !mark.length && [1, 2].includes(carrierPerson)) {
      const pronoun = {'1Sing': 'I', '2Sing': 'you', '1Plur': 'we', '2Plur': 'you'}[`${carrierPerson}${number}`];
      if (pronoun) text = `${pronoun} ${text}`;
    }
    return {text, known, en: verb, form, entry, senses};
  }

  // ------------------------------------------------------------------ words

  word(w, S) {
    const text = w.text;
    const label = this.label(w);
    if (w.quoted || QUOTES.has(text) || !/\p{L}/u.test(text)) {
      const kind = w.upos === 'PUNCT' || /^[\p{P}\p{S}\s]+$/u.test(text) ? 'punct' : 'copy';
      if (kind === 'copy' && !QUOTES.has(text)) this.note(w, 'copy', text);
      return [this.piece(text, w, kind)];
    }
    if (text === 'I' && w.upos !== 'ADP') { this.note(w, 'en', text); return [this.piece(text, w, 'copy')]; }
    if (w.enNoun) return [this.piece(this.enNoun(w), w, 'noun')];
    if (w.enVerb) return [this.piece(w.enVerb.stem, w, 'verb')];
    const fold1 = fold(text), foldL = fold(w.lemma ?? text);
    if (CLOSED_ADP.has(fold1) && ['NOUN', 'ADJ', 'X', 'VERB', 'PROPN', 'ADV'].includes(w.upos) && !/^\p{Lu}/u.test(text.slice(0, 1)) ) w = {...w, upos: 'ADP'};
    if (label === 'en') { this.note(w, 'en', text); return [this.piece(text, w, 'copy')]; }
    if (this.isName(w, S) && !['ADP', 'DET', 'PRON', 'AUX', 'SCONJ', 'CCONJ'].includes(w.upos)) { this.note(w, 'name', text); return [this.piece(text, w, 'copy')]; }
    if (T.UNITS.has(fold1) && !['ADP', 'AUX'].includes(w.upos)) { this.note(w, 'fn', text); return [this.piece(text, w, 'copy')]; }
    if (fold1 === 'cui' && w.upos !== 'PRON') { this.note(w, 'fn', 'whom'); return [this.piece('whom', w, 'fn')]; }
    const fn = (kind, en) => { if (en !== undefined && en !== null) { this.note(w, 'fn', en); return [this.piece(en, w, kind)]; } return null; };
    switch (w.upos) {
      case 'ADP': if (fold1 === 'pe' && w.deprel === 'case') { const h = S.byId.get(w.head); if (h && base(h.deprel) === 'obj' && ['PROPN', 'PRON'].includes(h.upos)) { this.note(w, 'fn', ''); return []; } } return fn('fn', T.PREPOSITIONS[fold1] ?? T.PREPOSITIONS[foldL]) ?? this.contentPiece(w, S, ['prep', 'adv']);
      case 'CCONJ': return fn('fn', T.CONJUNCTIONS[fold1] ?? T.CONJUNCTIONS[foldL]) ?? this.contentPiece(w, S, ['conj']);
      case 'SCONJ': return this.sconj(w, S) ?? this.contentPiece(w, S, ['conj']);
      case 'PART': return this.part(w, S);
      case 'NUM': return this.num(w, S);
      case 'DET': return this.det(w, S);
      case 'PRON': return this.pron(w, S);
      case 'ADV': return this.adv(w, S);
      case 'INTJ': return fn('fn', T.INTERJECTIONS[fold1]) ?? this.contentPiece(w, S, null);
      case 'AUX': return this.leftoverAux(w, S);
      case 'VERB': return this.contentPiece(w, S, ['verb', 'relation'], {verb: true});
      case 'ADJ': return this.adj(w, S);
      case 'NOUN': case 'PROPN': return this.noun(w, S);
      default: return this.contentPiece(w, S, null);
    }
  }

  contentPiece(w, S, allowed, {verb = false} = {}) {
    let text = this.content(w, allowed, S);
    if (verb && !/^\[/.test(text)) text = inflectVerb(text, 'present');
    return [this.piece(text, w, 'content')];
  }

  enNoun(w) {
    const {stem, def, plural, gen} = w.enNoun;
    const prefix = [gen ? 'of' : null, def ? 'the' : null].filter(Boolean).join(' ');
    this.note(w, 'en', stem, {enclitic: true});
    const bare = prefix && /^\p{Lu}\p{Ll}/u.test(stem) && this.S.words[0] === w ? lower1(stem) : stem;
    return `${prefix ? prefix + ' ' : ''}${plural ? pluralize(bare) : bare}`;
  }

  genitiveLinker(w, S) {
    const prev = S.byId.get(w.id - 1);
    if (!prev) return false;
    const f = fold(prev.text);
    return prev.upos === 'ADP' || T.GENITIVE_ARTICLES.has(f) || (prev.upos === 'DET' && ['al', 'a', 'ai', 'ale'].includes(f));
  }

  noun(w, S) {
    const found = this.lookup(w, ['noun', 'relation']);
    if (!found) return [this.piece(this.unknown(w), w, 'content')];
    this.note(w, 'tr', found.text, {entry: found.entry, mismatch: found.mismatch, senses: found.senses});
    let text = found.text;
    const plural = has(w, 'Number', 'Plur') || w.deco?.plural;
    if (plural) text = text.includes('/') ? text.split('/').map(pluralize).join('/') : pluralize(text);
    const def = has(w, 'Definite', 'Def') || w.deco?.def;
    const indefGen = kids(w, 'det').some(d => ['unui', 'unei', 'unor'].includes(fold(d.text)));
    const gen = (has(w, 'Case', 'Gen') && !has(w, 'Case', 'Acc') && (def || indefGen)) || w.deco?.gen;
    const parts = [];
    if (gen && !this.genitiveLinker(w, S)) parts.push('of');
    if (def) parts.push('the');
    parts.push(text);
    return [this.piece(parts.join(' '), w, 'content')];
  }

  adj(w, S) {
    // A participle used as an adjective: its dictionary adjective, else the past participle of its verb.
    let found = this.lookup(w, ['adj']);
    if (found && !found.mismatch) { this.note(w, 'tr', found.text, {entry: found.entry, senses: found.senses}); return [this.piece(found.text, w, 'content')]; }
    if (w.feats?.VerbForm === 'Part') {
      const verb = this.lookup({...w, text: w.lemma}, ['verb', 'relation']);
      if (verb) { const text = inflectVerb(verb.text.split('/')[0], 'part'); this.note(w, 'tr', text, {entry: verb.entry}); return [this.piece(text, w, 'content')]; }
    }
    if (found) { this.note(w, 'tr', found.text, {entry: found.entry, mismatch: true, senses: found.senses}); return [this.piece(found.text, w, 'content')]; }
    return [this.piece(this.unknown(w), w, 'content')];
  }

  adv(w, S) {
    const f = fold(w.text), l = fold(w.lemma ?? w.text);
    if (l === 'mai' || f === 'mai') {
      const head = S.byId.get(w.head);
      const en = head && ['ADJ', 'ADV', 'DET', 'NUM', 'NOUN', 'PRON'].includes(head.upos) ? 'more' : (this.S.words.some(x => fold(x.text) === 'nu' && x.head === w.head) ? 'anymore' : 'still');
      this.note(w, 'fn', en); return [this.piece(en, w, 'fn')];
    }
    const t = T.ADVERBS[f] ?? T.ADVERBS[l] ?? (T.WH[l] ?? null);
    if (t !== undefined && t !== null) { this.note(w, 'fn', t); return t ? [this.piece(t, w, 'fn')] : []; }
    return this.contentPiece(w, S, ['adv', 'adj']);
  }

  sconj(w, S) {
    const f = fold(w.text), l = fold(w.lemma ?? w.text);
    if (f === 'sa' || l === 'sa') { this.note(w, 'fn', 'to'); return [this.piece('to', w, 'fn')]; }
    const t = f === 'daca' ? 'if' : (T.MARKS[f] ?? T.MARKS[l]);
    if (t === undefined) return null;
    this.note(w, 'fn', t); return t ? [this.piece(t, w, 'fn')] : [];
  }

  part(w, S) {
    const f = fold(w.text), l = fold(w.lemma ?? w.text);
    let en;
    if (f === 'nu' || l === 'nu') en = 'not';
    else if (f === 'sa' || f === 'a' || l === 'sa' || l === 'a') en = 'to';
    else if (f === 'o' && S.byId.get(w.head)) en = 'will';
    else return this.contentPiece(w, S, null);
    this.note(w, 'fn', en); return [this.piece(en, w, 'fn')];
  }

  num(w, S) {
    const f = fold(w.text);
    const t = T.NUMERALS[f] ?? T.NUMERALS[fold(w.lemma ?? w.text)];
    if (t) { this.note(w, 'fn', t); return [this.piece(t, w, 'fn')]; }
    if (T.MONTHS[f]) return [this.piece(T.MONTHS[f], w, 'fn')];
    return this.contentPiece(w, S, ['num', 'noun', 'adj']);
  }

  det(w, S) {
    const f = fold(w.text), l = fold(w.lemma ?? w.text);
    if (f === 'sa') {
      const head = S.byId.get(w.head), next = S.byId.get(w.id + 1);
      if (head?.upos === 'VERB' && head.id > w.id || next?.upos === 'VERB') { this.note(w, 'fn', 'to'); return [this.piece('to', w, 'fn')]; }
    }
    if (['un', 'o'].includes(f)) { this.note(w, 'fn', 'a'); return [this.piece('a', w, 'indef')]; }
    if (['unui', 'unei'].includes(f)) {
      const head = S.byId.get(w.head);
      const text = head && !this.genitiveLinker(head, S) ? (String(head.deprel).startsWith('nmod') ? 'of a' : head.deprel === 'iobj' ? 'to a' : 'a') : 'a';
      this.note(w, 'fn', text); return [this.piece(text, w, text === 'a' ? 'indef' : 'fn')];
    }
    if (T.GENITIVE_ARTICLES.has(f)) { this.note(w, 'fn', 'of'); return [this.piece('of', w, 'fn')]; }
    const t = T.DETERMINERS[f] ?? T.DETERMINERS[l] ?? T.PRONOUNS[f]?.[0] ?? T.PRONOUNS[l]?.[0] ?? T.WH[l];
    if (t !== undefined) { this.note(w, 'fn', t); return t ? [this.piece(t, w, 'fn')] : []; }
    return this.contentPiece(w, S, ['det', 'adj', 'pron']);
  }

  pron(w, S) {
    const f = fold(w.text), l = fold(w.lemma ?? w.text);
    const caseOf = w.feats?.Case ?? '';
    if (['se', 'si', 'isi'].includes(f) && (w.deprel.startsWith('expl') || w.feats?.Reflex === 'Yes' || ['se', 'sine'].includes(l))) { this.note(w, 'fn', ''); return []; }
    if (w.deprel.startsWith('expl') && ['se', 'si', 'isi', 'ma', 'te', 'ne', 'va', 'm', 'ti', 'mi', 's'].includes(f.replace(/-$/, ''))) { this.note(w, 'fn', ''); return []; }
    const personKey = `${w.feats?.Person ?? ''}${w.feats?.Number ?? ''}`;
    let pair = T.PRONOUNS[l] ?? T.PRONOUNS[f] ?? (w.feats?.PronType === 'Prs' ? T.PERSONAL[personKey + (w.feats?.Gender ?? '')] ?? T.PERSONAL[personKey] : null);
    const clitic = CLITICS[f.replace(/-$/, '')];
    if (clitic && (w.upos === 'PRON' && !T.PRONOUNS[l])) { this.note(w, 'fn', clitic); return [this.piece(clitic, w, 'fn')]; }
    const wh = T.WH[l] ?? T.WH[f];
    if (wh && (w.feats?.PronType === 'Int' || w.feats?.PronType === 'Rel' || !pair)) { this.note(w, 'fn', wh); return [this.piece(wh, w, 'fn')]; }
    if (pair && pair === T.PRONOUNS.el && (w.feats?.Gender === 'Fem' || f === 'o')) pair = ['she', 'her'];
    if (pair) {
      const subject = base(w.deprel) === 'nsubj' || (/Nom/.test(caseOf) && !/Acc|Dat/.test(caseOf));
      let en = subject ? pair[0] : pair[1];
      if (/Dat/.test(caseOf) && !/Acc/.test(caseOf) && w.feats?.Strength === 'Weak') en = `to ${pair[1]}`;
      else if (/Dat/.test(caseOf) && base(w.deprel) === 'iobj') en = `to ${pair[1]}`;
      this.note(w, 'fn', en); return [this.piece(en, w, 'fn')];
    }
    return this.contentPiece(w, S, ['pron', 'noun']);
  }

  leftoverAux(w, S) {
    const l = fold(w.lemma ?? w.text);
    const f = w.feats ?? {};
    const person = Number(f.Person ?? 3), number = f.Number ?? 'Sing';
    let en;
    if (l === 'fi') en = inflectVerb('be', f.Tense === 'Past' ? 'past' : 'present', {person, number});
    else if (l === 'avea') en = inflectVerb('have', 'present', {person, number});
    else if (l === 'vrea') en = 'will';
    else return this.contentPiece(w, S, ['verb']);
    const prev = S.byId.get(w.id - 1);
    if (['fi', 'avea'].includes(l) && [1, 2].includes(person) && f.Person && !(prev?.upos === 'PRON' && ['eu', 'tu', 'noi', 'voi'].includes(fold(prev.lemma ?? prev.text)))) en = `${{'1Sing': 'I', '2Sing': 'you', '1Plur': 'we', '2Plur': 'you'}[`${person}${number}`] ?? ''} ${en}`.trim();
    this.note(w, 'fn', en); return [this.piece(en, w, 'fn')];
  }
}

// ---------------------------------------------------------------------------------------------- message level

/** Glossed text and the events of one parse, sentence by sentence (no frame logic). */
export function glossParse(parse, message, {dictionary, labels = new Map(), isEnglish, isRomanian, senses = 1, mark = DEFAULT_MARK}) {
  const g = new Glosser({dictionary, labels, isEnglish, isRomanian, senses, mark});
  const all = [];
  (parse.sentences ?? []).forEach((sentence, index) => all.push(...g.sentence(sentence, index)));
  return {version: GLOSS_VERSION, text: joinPieces(all).text, events: g.events};
}

/** Statistics of a list of events: content words translated, copied marked, English words kept. */
export function glossStats(events) {
  const count = kind => events.filter(e => e.kind === kind).length;
  const tr = count('tr'), unk = count('unk');
  return {content: tr + unk, translated: tr, unknown: unk, english: count('en'), names: count('name'), function: count('fn')};
}

/** Sentences of a message with their offsets (a sentence ends at . ! ? … before a capital, or at a line break). */
export function sentenceSpans(text) {
  const spans = [];
  const re = /[^\n]+/g;
  for (let m; (m = re.exec(text));) {
    const line = m[0], base0 = m.index;
    let from = 0;
    const cut = /[.!?…]+["”»)]*\s+(?=[\p{Lu}"„«¿(\d-])/gu;
    for (let c; (c = cut.exec(line));) {
      const end = c.index + c[0].trimEnd().length;
      if (end > from) spans.push({start: base0 + from, end: base0 + end});
      from = c.index + c[0].length;
    }
    if (line.slice(from).trim()) spans.push({start: base0 + from, end: base0 + line.trimEnd().length});
  }
  return spans;
}

/** Clause chunks of a code-switched sentence: cut at , ; : and a dash followed by a space. */
function chunkSpans(text, span) {
  const raw = text.slice(span.start, span.end);
  const chunks = [];
  let from = 0;
  const re = /[,;:]\s+|\s[-–—]\s/g;
  for (let m; (m = re.exec(raw));) {
    chunks.push({start: span.start + from, end: span.start + m.index + (m[0].trim().length ? 1 : 0)});
    from = m.index + m[0].length;
  }
  chunks.push({start: span.start + from, end: span.end});
  return chunks.filter(c => c.end > c.start);
}

const CARRIER = 'Vezi ';
const parseMany = async (lm, texts) => {
  if (!texts.length) return [];
  // The Stanza worker takes a `languages` list next to `texts` (the JS parseMany helper does not forward it): the Romanian model is forced.
  if (typeof lm.worker.request === 'function' && typeof lm.worker.parseMany === 'function') return (await lm.worker.request({id: 0, texts, languages: texts.map(() => 'ro')})).parses;
  const out = [];
  for (const t of texts) out.push((await lm.parse(t, 'ro')).parse);
  return out;
};

/**
 * Gloss a whole message with a started SymbolicLM `lm` (Stanza worker + language id + spelling).
 * Options: `spell` (LanguagesUtil spelling first, default true), `senses`, `mark`.
 * The message is cut into sentences; a sentence with English tokens is cut further into clause chunks. Per chunk the
 * frame (LanguagesUtil frame detection, token counts on a tie) decides: a Romanian frame is parsed with Stanza
 * Romanian and glossed with its English tokens copied, an English frame keeps its English and only the inserted
 * Romanian runs are parsed and glossed on their own, a chunk without Romanian tokens is copied.
 * Returns {text, language, events, stats, spelling, mode, ms}.
 */
export async function glossMessage(lm, message, {spell = true, senses = 1, mark = DEFAULT_MARK} = {}) {
  const started = performance.now();
  let text = String(message);
  let spelling = [];
  if (spell) { const fixed = lm.correct(text); spelling = fixed.changes; text = fixed.text; }
  const lid = lm.identify(text);
  if (!lid.counts.ro && lid.language === 'en') return {text, language: 'en', events: [], stats: glossStats([]), spelling, mode: 'copy', ms: performance.now() - started};
  const isEnglish = word => lm.lexicons.has('en', String(word).toLowerCase());
  const isRomanian = word => lm.lexicons.has('ro', String(word).toLowerCase());
  // A Romanian function word, clitic or verb form that the language id took for a name ("Mă", "Dacă", "Vreau") is Romanian.
  const initials = new Set(sentenceSpans(text).map(sp => sp.start));
  const glosser0 = new Glosser({dictionary: lm.dictionary});
  const words = lid.tokens.filter(t => t.kind === 'word').map(t => {
    if (t.label !== 'name') return t;
    const ro = functionLanguage(t.text.toLowerCase()) === 'ro' || t.text.length <= 3 && CLITICS[fold(t.text)] !== undefined || ['sincer', 'deci', 'dar', 'insa', 'apoi'].includes(fold(t.text)) || T.WH[fold(t.text)] !== undefined
      || (initials.has(t.start) && /^\p{Lu}\p{Ll}+$/u.test(t.text) && glosser0.entries(t.text, ['verb']).length > 0 && !lm.lexicons.has('en', t.text.toLowerCase()));
    return ro ? {...t, label: 'ro'} : t;
  });
  const options = {dictionary: lm.dictionary, isEnglish, isRomanian, senses, mark};
  const g = new Glosser({...options});
  const stemOf = t => g.stemSplit(t.text);
  // Plan: units in message order.
  const units = [];
  for (const span of sentenceSpans(text)) {
    const inside = words.filter(t => t.start >= span.start && t.end <= span.end);
    const en = inside.filter(t => t.label === 'en').length;
    const chunks = en > 0 ? chunkSpans(text, span) : [span];
    for (const chunk of chunks) {
      const toks = inside.filter(t => t.start >= chunk.start && t.end <= chunk.end);
      const ro = toks.filter(t => t.label === 'ro').length, e = toks.filter(t => t.label === 'en').length;
      const stems = toks.filter(stemOf).length;
      let mode;
      if (ro === 0 && !stems) mode = 'copy';
      else {
        const frame = e === 0 ? 'ro' : (detectFrame(text.slice(chunk.start, chunk.end)).frame ?? (ro >= e ? 'ro' : 'en'));
        mode = frame === 'en' ? 'en-frame' : 'ro-frame';
      }
      units.push({...chunk, toks, mode});
    }
  }
  // Parse jobs: ro-frame chunks, and the Romanian runs of English-frame chunks.
  const jobs = [];
  for (const u of units) {
    if (u.mode === 'ro-frame') { u.job = jobs.length; jobs.push(text.slice(u.start, u.end)); }
    if (u.mode === 'en-frame') {
      u.runs = englishRuns(text, u, g);
      // A lone Romanian word is parsed after a carrier verb ("Vezi cuvânt"): the parser tags a bare word badly (an interjection without features).
      for (const r of u.runs) if (r.replace === undefined) { r.single = !/\s/.test(text.slice(r.start, r.end)); r.job = jobs.length; jobs.push((r.single ? CARRIER : '') + text.slice(r.start, r.end)); }
    }
  }
  const parses = await parseMany(lm, jobs);
  const idTokens = new Map();
  const labelsFor = (piece, offset) => {
    const key = `${offset}:${piece.length}`;
    if (!idTokens.has(key)) idTokens.set(key, new Map(words.filter(t => t.start >= offset && t.end <= offset + piece.length).map(t => [`${t.start - offset}:${t.end - offset}`, t.label])));
    return idTokens.get(key);
  };
  let result = '', cursor = 0;
  const modes = new Set();
  for (const u of units) {
    result += text.slice(cursor, u.start);
    cursor = u.end;
    modes.add(u.mode);
    const raw = text.slice(u.start, u.end);
    if (u.mode === 'copy') { result += raw; continue; }
    if (u.mode === 'ro-frame') {
      const glosser = new Glosser({...options, labels: labelsFor(raw, u.start)});
      const pieces = [];
      (parses[u.job].sentences ?? []).forEach((s, i) => pieces.push(...glosser.sentence(s, i)));
      result += joinPieces(pieces).text;
      g.events.push(...glosser.events);
      continue;
    }
    let out = raw;
    for (const run of [...u.runs].sort((a, b) => b.start - a.start)) {
      let replacement = run.replace;
      if (replacement === undefined) {
        const piece = text.slice(run.start, run.end);
        const labels = run.single ? new Map([[`0:${CARRIER.length - 1}`, 'ro'], ...[...labelsFor(piece, run.start)].map(([k, v]) => { const [a, b] = k.split(':').map(Number); return [`${a + CARRIER.length}:${b + CARRIER.length}`, v]; })]) : labelsFor(piece, run.start);
        const sub = new Glosser({...options, labels});
        let pieces = [];
        (parses[run.job].sentences ?? []).forEach((s, i) => pieces.push(...sub.sentence(s, i)));
        if (run.single) { pieces = pieces.filter(p => p.src[0] !== CARRIER.trim()); sub.events = sub.events.filter(e => e.ro !== CARRIER.trim()); }
        replacement = lower1(joinPieces(pieces).text);
        g.events.push(...sub.events);
      } else g.events.push({ro: text.slice(run.start, run.end), kind: 'en', en: replacement, enclitic: true});
      const before = out.slice(0, run.start - u.start);
      const prev = /(\p{L}+)\s*$/u.exec(before)?.[1]?.toLowerCase();
      if (prev && EN_DETERMINERS.has(prev)) replacement = replacement.replace(/^(?:the|a|an) /, '');
      out = before + replacement + out.slice(run.end - u.start);
    }
    result += out;
  }
  result += text.slice(cursor);
  return {text: result.trim(), language: lid.language, events: g.events, stats: glossStats(g.events), spelling, mode: [...modes].join('+'), ms: performance.now() - started};
}

/** Runs of an English-frame chunk to replace: enclitic English stems, and consecutive Romanian tokens. */
function englishRuns(text, unit, g) {
  const runs = [];
  for (const t of unit.toks) {
    const stem = g.stemSplit(t.text);
    if (stem) { runs.push({start: t.start, end: t.end, replace: `${stem[1] ? 'the ' : ''}${stem[2] ? pluralize(stem[0]) : stem[0]}`}); continue; }
    if (t.label !== 'ro') continue;
    const last = runs.at(-1);
    if (last && last.replace === undefined && /^\s*$/.test(text.slice(last.end, t.start))) { last.end = t.end; continue; }
    runs.push({start: t.start, end: t.end});
  }
  return runs;
}
