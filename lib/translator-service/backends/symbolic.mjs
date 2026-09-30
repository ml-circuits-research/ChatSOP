/**
 * TranslatorService backend `symbolic`: deterministic Romanian → English translation from the Romanian UD parse
 * (DS021 "TranslatorService"). Moved out of SymbolicLM (owner decision 2026-09-29): SymbolicLM keeps language id,
 * spelling, UD parsing and SOP generation, and calls TranslatorService (lib/translator-service/index.mjs) when a
 * route needs translation. This file and lib/translator-service/backends/english.mjs are the former
 * lib/symbolic-lm/translate.mjs and lib/symbolic-lm/english.mjs, moved without a behaviour change.
 *
 * The English text is never shown to anyone: it only has to be intelligible enough that the English Stanza parse
 * and the English UD → SOP rules recover the message's structure. The translator is deterministic:
 *   1. every Romanian word is glossed from its lemma, UPOS and features through closed function-word tables (this
 *      file) and the host dictionary (sop/dictionary.mjs, config/dictionary/); a verb with the preposition of its
 *      first oblique is first looked up as a whole relation phrase ("lucra la" → "work at", "fi înscris la" →
 *      "be enrolled at");
 *   2. a small English realizer rebuilds each clause from the tree, not from the Romanian word order: subject, verb
 *      group (tense, person, negation with do-support, future, conditional, modals), objects and obliques, question
 *      inversion for yes/no and non-subject wh questions, fronted wh phrases, relative clauses, articles from the
 *      Romanian definite suffix, adjectives before the noun, "N de N" compounds, and pro-drop subjects;
 *   3. names (capitalized non-initial words and name runs, as labelled by the language identifier), numbers,
 *      English words inside the Romanian message and unit phrases ("75 lei") are copied verbatim;
 *   4. a Romanian content word the dictionary does not know is copied verbatim and reported as `untranslated`;
 *      it is never guessed.
 * Every English piece keeps the Romanian words it came from (`src`), so the SOP values produced from the English
 * text can be mapped back to verbatim spans of the original message (lib/symbolic-lm/index.mjs).
 */
import {indexSentence, kids, base} from '../../ud-to-sop/tree.mjs';
import {fold} from '../../../sop/dictionary.mjs';
import {inflectVerb, pluralize, indefinite} from './english.mjs';

export const TRANSLATE_VERSION = 'symbolic-lm-translate-v1';

// ------------------------------------------------------------------ closed tables (folded Romanian → English)

const PREPOSITIONS = Object.freeze({
  la: 'at', in: 'in', lui: 'of', lu: 'of', dintre: 'of', intr: 'in', 'intr-un': 'in a', 'intr-o': 'in a', din: 'from', 'de la': 'from', pe: 'on', cu: 'with', de: 'of', pentru: 'for', despre: 'about',
  fara: 'without', sub: 'under', peste: 'over', intre: 'between', dintre: 'among', dupa: 'after', 'inainte de': 'before', inainte: 'before', 'pana la': 'until', pana: 'until',
  'pana in': 'until', 'pana pe': 'until', catre: 'to', spre: 'towards', langa: 'near', prin: 'through', 'din cauza': 'because of', 'in loc de': 'instead of',
  'in afara de': 'besides', 'cu exceptia': 'except', 'in legatura cu': 'about', 'impreuna cu': 'with', 'incepand cu': 'from', 'inceput cu': 'from', contra: 'against',
  impotriva: 'against', 'de pe': 'from', 'de sub': 'from under', 'pe langa': 'besides', 'fata de': 'towards', 'potrivit': 'according to', 'conform': 'according to',
  'datorita': 'thanks to', 'in timpul': 'during', 'de-a lungul': 'along', 'dinainte de': 'before', 'dinspre': 'from', a: 'of', al: 'of', ale: 'of', ai: 'of',
});
const CONJUNCTIONS = Object.freeze({si: 'and', sau: 'or', ori: 'or', dar: 'but', insa: 'but', iar: 'and', ci: 'but', nici: 'nor', deci: 'so'});
const MARKS = Object.freeze({
  ca: 'that', daca: 'whether', 'pentru ca': 'because', fiindca: 'because', deoarece: 'because', caci: 'because', intrucat: 'because', desi: 'although',
  'cu toate ca': 'although', 'chiar daca': 'even if', cand: 'when', 'atunci cand': 'when', 'dupa ce': 'after', 'inainte sa': 'before', 'inainte ca': 'before',
  'inainte de a': 'before', 'pana cand': 'until', 'pana sa': 'before', 'in timp ce': 'while', 'pe cand': 'while', 'de cand': 'since', 'ca sa': 'so that',
  'astfel incat': 'so that', incat: 'so that', 'in caz ca': 'if', 'decat daca': 'unless', 'cu conditia sa': 'if', 'cu conditia ca': 'if', 'din moment ce': 'since',
  'odata ce': 'once', 'imediat ce': 'as soon as', 'ori de cate ori': 'whenever', 'de parca': 'as if', 'ca si cum': 'as if', 'pentru a': 'in order to', ca_: 'than',
  de: '', a: 'to', decat: 'than',
});
// Question words: the English word and whether it replaces a noun phrase (pronoun) or modifies a noun (determiner).
const WH = Object.freeze({
  cine: 'who', ce: 'what', care: 'which', unde: 'where', cand: 'when', cum: 'how', cat: 'how much', cata: 'how much', cati: 'how many', cate: 'how many', cui: 'whom', incotro: 'where',
});
const WH_PHRASES = Object.freeze([
  [['din', 'ce', 'motiv'], 'why'], [['pentru', 'ce', 'motiv'], 'why'], [['care', 'e', 'motivul'], 'why'], [['cum', 'de'], 'why'], [['in', 'ce', 'an'], 'in what year'],
  [['de', 'cate', 'ori'], 'how many times'], [['de', 'cand'], 'since when'], [['pana', 'cand'], 'until when'], [['de', 'ce'], 'why'], [['cat', 'timp'], 'how long'],
  [['cata', 'vreme'], 'how long'], [['pentru', 'ce'], 'why'], [['de', 'unde'], 'where from'], [['pana', 'la', 'ce', 'data'], 'until what date'],
  [['de', 'la', 'ce', 'data'], 'since what date'], [['in', 'ce', 'an'], 'in what year'], [['la', 'ce', 'ora'], 'at what time'], [['cat', 'de', 'des'], 'how often'],
]);
const DETERMINERS = Object.freeze({
  un: 'a', o: 'a', unui: 'a', unei: 'a', unor: 'some', niste: 'some', acest: 'this', aceasta: 'this', acesti: 'these', aceste: 'these', acel: 'that', acea: 'that', acei: 'those', acele: 'those',
  asta: 'this', ista: 'this', fiecare: 'every', orice: 'any', oricare: 'any', niciun: 'no', nicio: 'no', vreun: 'any', vreo: 'any', tot: 'all', toata: 'all', toti: 'all',
  toate: 'all', alt: 'another', alta: 'another', alti: 'other', alte: 'other', celalalt: 'the other', cealalta: 'the other', ambii: 'both', ambele: 'both', amandoi: 'both',
  amandoua: 'both', multi: 'many', multe: 'many', mult: 'much', multa: 'much', putini: 'few', putine: 'few', cativa: 'some', cateva: 'some', majoritatea: 'most',
  aceeasi: 'the same', acelasi: 'the same', aceiasi: 'the same', aceleasi: 'the same', nostru: 'our', noastra: 'our', nostri: 'our', noastre: 'our', vostru: 'your',
  voastra: 'your', meu: 'my', mea: 'my', mei: 'my', mele: 'my', tau: 'your', ta: 'your', tai: 'your', tale: 'your', sau: 'his', sa: 'his', sai: 'his', sale: 'his', lor: 'their',
});
const POSSESSIVES = new Set(['meu', 'mea', 'mei', 'mele', 'tau', 'ta', 'tai', 'tale', 'sau', 'sa', 'sai', 'sale', 'nostru', 'noastra', 'nostri', 'noastre', 'vostru', 'voastra', 'lor']);
const PRONOUNS = Object.freeze({
  // [nominative, accusative]
  eu: ['I', 'me'], tu: ['you', 'you'], el: ['he', 'him'], ea: ['she', 'her'], noi: ['we', 'us'], voi: ['you', 'you'], ei: ['they', 'them'], ele: ['they', 'them'],
  dumneavoastra: ['you', 'you'], dansul: ['he', 'him'], dansa: ['she', 'her'], dansii: ['they', 'them'], sine: ['oneself', 'oneself'],
  cineva: ['someone', 'someone'], ceva: ['something', 'something'], nimeni: ['nobody', 'anyone'], nimic: ['nothing', 'anything'], oricine: ['anyone', 'anyone'],
  orice: ['anything', 'anything'], toti: ['everyone', 'everyone'], toata: ['all', 'all'], toate: ['all', 'all'], fiecare: ['everyone', 'everyone'], altcineva: ['someone else', 'someone else'],
  acesta: ['this one', 'this one'], aceasta: ['this', 'this'], asta: ['this', 'this'], aia: ['that', 'that'], aceea: ['that', 'that'], acela: ['that one', 'that one'],
  ceilalti: ['the others', 'the others'], celelalte: ['the others', 'the others'], unul: ['one', 'one'], una: ['one', 'one'], unii: ['some', 'some'], unele: ['some', 'some'],
  niciunul: ['none', 'none'], niciuna: ['none', 'none'], amandoi: ['both', 'both'], ambii: ['both', 'both'], multi: ['many', 'many'], cati: ['how many', 'how many'],
});
// Personal pronoun forms by Person/Number/Gender (clitics and strong oblique forms whose lemma is the nominative).
const PERSONAL = {'1Sing': ['I', 'me'], '2Sing': ['you', 'you'], '3SingMasc': ['he', 'him'], '3SingFem': ['she', 'her'], '3Sing': ['he', 'him'], '1Plur': ['we', 'us'], '2Plur': ['you', 'you'], '3Plur': ['they', 'them']};
const ADVERBS = Object.freeze({
  nu: 'not', mai: 'still', inca: 'still', deja: 'already', acum: 'now', azi: 'today', astazi: 'today', ieri: 'yesterday', maine: 'tomorrow', aici: 'here', acolo: 'there',
  foarte: 'very', doar: 'only', numai: 'only', tot: 'still', iar: 'again', din_nou: 'again', niciodata: 'ever', mereu: 'always', intotdeauna: 'always', uneori: 'sometimes',
  des: 'often', deseori: 'often', rar: 'rarely', atunci: 'then', apoi: 'then', dupa: 'afterwards', inainte: 'before', curand: 'soon', tarziu: 'late', devreme: 'early',
  probabil: 'probably', poate: 'maybe', sigur: 'surely', desigur: 'of course', chiar: 'really', totusi: 'still', oricum: 'anyway', asa: 'so', bine: 'well', rau: 'badly',
  cumva: 'somehow', oare: '', aproape: 'almost', cam: 'about', exact: 'exactly', si: 'also', la_fel: 'likewise', impreuna: 'together', inapoi: 'back', acasa: 'home',
  deci: 'so', adica: 'that is', altfel: 'otherwise', ipotetic: 'hypothetically', aparent: 'apparently', momentan: 'currently', actualmente: 'currently', vreodata: 'ever',
  anume: '', anterior: 'previously', ulterior: 'later', recent: 'recently', inclusiv: 'including', cel_putin: 'at least', cel_mult: 'at most', peste: 'over', sub: 'under', mult: 'much', putin: 'little',
});
const MONTHS = Object.freeze({ian: 'January', feb: 'February', apr: 'April', iun: 'June', iul: 'July', aug: 'August', sep: 'September', sept: 'September', oct: 'October', noi: 'November', nov: 'November', dec: 'December', ianuarie: 'January', februarie: 'February', martie: 'March', aprilie: 'April', mai: 'May', iunie: 'June', iulie: 'July', august: 'August',
  septembrie: 'September', octombrie: 'October', noiembrie: 'November', decembrie: 'December'});
const UNITS = new Set(['lei', 'leu', 'ron', 'euro', 'eur', 'dolari', 'dolar', 'usd', 'km', 'kg', 'm', 'cm', 'mm', 'l', 'ml', 'g', 'mg', 'h', '%', 'bani']);
const MODAL_VERBS = Object.freeze({putea: ['can', 'could'], trebui: ['must', 'had to']});
// Multiword expressions (folded word sequences) rendered as one English phrase; the syntactic head of the
// expression carries the phrase and the other words are absorbed.
const MWE = Object.freeze([
  ['avand in vedere ca', 'given that'], ['dat fiind ca', 'given that'], ['adevarat sau fals', 'true or false:'], ['sa zicem ca', 'suppose that'],
  ['sa presupunem ca', 'suppose that'], ['se pare ca', 'apparently'], ['probabil ca', 'probably'], ['nu cumva', ''], ['cel putin', 'at least'],
  ['cel mult', 'at most'], ['mai mult de', 'more than'], ['mai putin de', 'fewer than'], ['mai mult decat', 'more than'], ['mai putin decat', 'fewer than'],
  ['cel mai mult', 'the most'], ['cel mai putin', 'the least'], ['cea mai mult', 'the most'], ['in afara de', 'besides'], ['pe langa', 'besides'],
  ['cu exceptia', 'except'], ['de fapt', 'in fact'], ['de asemenea', 'also'], ['in plus', 'also'], ['de obicei', 'usually'], ['pana acum', 'so far'],
  ['deocamdata', 'for now'], ['la fel', 'likewise'], ['din nou', 'again'], ['in continuare', 'still'], ['parca', 'I think'], ['cat de cat', 'somewhat'],
  ['in timp ce', 'while'], ['dupa ce', 'after'], ['inainte sa', 'before'], ['pentru ca', 'because'], ['din cauza ca', 'because'], ['chiar daca', 'even if'],
  ['cu toate ca', 'although'], ['ca sa', 'so that'], ['in caz ca', 'if'], ['nu mai', 'no longer'],
].map(([ro, en]) => [ro.split(' '), en]).sort((a, b) => b[0].length - a[0].length));
const NUMERALS = Object.freeze({unu: 'one', una: 'one', doi: 'two', doua: 'two', trei: 'three', patru: 'four', cinci: 'five', sase: 'six', sapte: 'seven', opt: 'eight',
  noua: 'nine', zece: 'ten', unsprezece: 'eleven', doisprezece: 'twelve', douasprezece: 'twelve', douazeci: 'twenty', treizeci: 'thirty', patruzeci: 'forty',
  cincizeci: 'fifty', suta: 'hundred', sute: 'hundred', mie: 'thousand', mii: 'thousand', jumatate: 'half', sfert: 'quarter'});
// Verbs of a request in the imperative ("Spune-mi dacă …", "Verifică: …").
const REQUEST = Object.freeze({spune: 'tell', zice: 'tell', verifica: 'check', afla: 'find out', confirma: 'confirm', arata: 'show', explica: 'explain',
  rezerva: 'book', trimite: 'send', scrie: 'write', da: 'give', numara: 'count', enumera: 'list', ajuta: 'help', calcula: 'calculate', traduce: 'translate',
  lamuri: 'explain', gasi: 'find', cauta: 'look for', compune: 'write', programa: 'schedule', aminti: 'remind'});
// Verb + bare object expressions ("am nevoie de" = "I need").
const VERB_OBJECT = Object.freeze({'avea nevoie': 'need', 'avea voie': 'be allowed', 'avea loc': 'take place', 'avea acces': 'have access', 'avea dreptul': 'have the right',
  'lua parte': 'take part', 'da seama': 'realize', 'avea grija': 'take care', 'face naveta': 'commute', 'avea chef': 'feel like', 'avea idee': 'have an idea',
  'face parte': 'be part', 'avea impresia': 'think', 'tine minte': 'remember'});
const MOTION = new Set(['muta', 'merge', 'pleca', 'veni', 'calatori', 'zbura', 'ajunge', 'intra', 'trimite', 'duce', 'transfera', 'emigra', 'reveni', 'intoarce']);
// Forms of "a vrea" (Stanza often tags "vreau" or "vrea" as an imperfect): person, number.
const VREA_FORMS = Object.freeze({vreau: [1, 'Sing'], vrei: [2, 'Sing'], vrea: [3, 'Sing'], vrem: [1, 'Plur'], vreti: [2, 'Plur'], vor: [3, 'Plur']});
const RO_KEY_FUNCTION = new Set(['fi', 'se', 'la', 'de', 'pe', 'in', 'cu', 'lui', 'a', 'al', 'ale', 'din', 'pentru', 'despre', 'o', 'un', 's', 'sa', 'nu', 'si', 'e', 'este', 'a fost', 'fost', 'au', 'am', 'catre', 'spre']);
const EN_KEY_FUNCTION = new Set(['be', 'is', 'are', 'was', 'the', 'a', 'an', 'of', 'to', 'at', 'in', 'on', 'for', 'with', 'from', 'by', 'about', 'into', 'up', 'out', 'off', 'as', 'it']);
const RO_ARTICLE_SUFFIX = /^-(?:ul|ului|ii|ilor|urile|urilor|uri|le|lor|a|ei|i|l)$/i;
const INTERJECTIONS = Object.freeze({uite: 'look', iata: 'here is', mersi: 'thanks', multumesc: 'thank you', salut: 'hello', buna: 'hello', pa: 'bye', ok: 'OK', da: 'yes', hei: 'hey', scuze: 'sorry'});
const GENITIVE_ARTICLES = new Set(['lui', 'lu', 'al', 'a', 'ai', 'ale']);

// Reflexive verbs whose meaning differs from the plain verb ("mă întreb" = "I wonder", not "I ask").
// Experiencer verbs whose first-person clitic is the English subject ("mă interesează X" → "I wonder X").
const EXPERIENCER = Object.freeze({interesa: 'wonder', preocupa: 'wonder', intriga: 'wonder', mira: 'wonder', bucura: 'be glad', ingrijora: 'worry'});
const REFLEXIVE = Object.freeze({intreba: 'wonder', gandi: 'think', intampla: 'happen', numi: 'be called', simti: 'feel', teme: 'fear', bucura: 'enjoy',
  muta: 'move', casatori: 'marry', uita: 'look', ocupa: 'take care of', afla: 'be', gasi: 'be', mira: 'wonder', parea: 'seem', putea: 'be possible', referi: 'refer to',
  descurca: 'cope', intalni: 'meet', inscrie: 'enrol', angaja: 'get a job', trata: 'be treated', deschide: 'open', inchide: 'close', termina: 'end', incepe: 'begin'});

const ORDER = (a, b) => a.id - b.id;

// ------------------------------------------------------------------ pieces

/** One English piece: `text`, the Romanian words it renders (`src`), and a `kind` for the trace. */
const piece = (text, src = [], kind = 'word') => ({text, src: src.filter(Boolean).map(w => w.key), kind});
const NO_SPACE_BEFORE = /^[.,;:!?)\]}%”»]+$/;
const NO_SPACE_AFTER = /^[(\[{„“«]$/;

/** Join pieces into text with offsets: returns {text, pieces: [{text, start, end, src, kind}]}. */
export function joinPieces(pieces) {
  let text = '';
  const out = [];
  for (const p of pieces) {
    if (!p.text) continue;
    const glue = !text || NO_SPACE_BEFORE.test(p.text) || NO_SPACE_AFTER.test(text.at(-1)) ? '' : ' ';
    text += glue;
    out.push({...p, start: text.length, end: text.length + p.text.length});
    text += p.text;
  }
  return {text, pieces: out};
}

// ------------------------------------------------------------------ translator

export class Translator {
  /** `dictionary` = sop/dictionary.mjs Dictionary; `labels` = Map from "start:end" to the language-id label of a token. */
  constructor({dictionary, labels = new Map(), message = '', isEnglish = () => false}) {
    Object.assign(this, {dictionary, labels, message, isEnglish, untranslated: [], decisions: []});
  }

  // ---------------- lexical lookup

  /** Dictionary entries (all priorities, best first) of a Romanian surface, filtered by part of speech. */
  entries(surface, allowed) {
    const hits = this.dictionary.ro.get(fold(surface)) ?? [];
    return hits.map(([index, flag]) => ({entry: this.dictionary.entries[index], flag}))
      .filter(({entry}) => !allowed || allowed.includes(entry.pos))
      .sort((a, b) => (a.entry.priority ?? 100) - (b.entry.priority ?? 100) || (a.flag === 'l' ? -1 : 1) - (b.flag === 'l' ? -1 : 1));
  }

  /** English gloss of a content word, or null (never guessed). */
  gloss(word, allowed) {
    for (const surface of [word.lemma, word.text]) {
      const found = this.entries(surface, allowed).find(({entry}) => entry.en.length);
      if (found) {
        this.decisions.push({word: word.text, lemma: word.lemma, via: found.entry.source ?? found.entry.file, entry: found.entry.id, en: found.entry.en[0]});
        return found.entry.en[0];
      }
    }
    return null;
  }

  /** Is the word written in English or a name inside this Romanian message (copied verbatim)? */
  label(word) {
    const exact = this.labels.get(`${word.start}:${word.end}`);
    if (exact) return exact;
    // A parser token inside a language-id token ("gateway" of "gateway-ul") takes that token's label.
    for (const [key, label] of this.labels) {
      const [a, b] = key.split(':').map(Number);
      if (a <= word.start && word.end <= b) return label;
    }
    return null;
  }
  isName(word, S) {
    const label = this.label(word);
    if (label === 'name') return true;
    if (word.upos === 'NOUN' && word.kids?.some(k => ['amod', 'det'].includes(base(k.deprel)) && k.id === word.id - 1 && /^\p{Lu}/u.test(k.text) && S.words[0] !== k)) return true;
    if (word.upos === 'NOUN' && S.words[0] !== word && word.kids?.some(k => base(k.deprel) === 'nmod' && k.id === word.id + 1 && /Gen/.test(k.feats?.Case ?? '')) && /^\p{Lu}/u.test(word.text)) return true;
    if (word.upos === 'PROPN' && /^\p{Lu}/u.test(word.text)) return true;
    // A capitalized word inside the sentence (not its first word) is a name.
    return /^\p{Lu}/u.test(word.text) && S.words[0] !== word && !['I'].includes(word.text) && label !== 'ro';
  }

  /** Translate a word the tables do not cover; unknown Romanian words are copied and reported. */
  content(word, allowed, S) {
    if (this.label(word) === 'en') return word.text;
    // "-ul", "-ului", "-urile" after a foreign word ("gateway-ul") is the Romanian definite article.
    if (RO_ARTICLE_SUFFIX.test(word.text)) return '';
    const english = this.gloss(word, allowed) ?? this.gloss(word, null);
    if (english) return english;
    if (!/\p{L}/u.test(word.text) || this.isName(word, S)) return word.text;
    // An English word the Romanian dictionary does not list ("gateway", "backup") is kept as written, also with a
    // Romanian article or plural ending ("clusterul" → "the cluster", "mailuri" → "mails").
    if (this.isEnglish(word.text)) return word.text;
    const stem = /^(.+?)(?:-?)(ului|ul|urile|uri|ii|ile|ele|le|lor)$/iu.exec(word.text);
    if (stem && stem[1].length >= 3 && this.isEnglish(stem[1])) return /uri|ii|ile|ele|le|lor/i.test(stem[2]) ? pluralize(stem[1]) : stem[1];
    return this.unknown(word, S);
  }

  /** A word no table or dictionary knows: a capitalized one is a name; a Romanian one is copied and reported. */
  unknown(word, S = this.sentence) {
    if (!/\p{L}/u.test(word.text) || /^\p{Lu}/u.test(word.text) && S?.words[0] !== word) return word.text;
    if (/^\p{Lu}/u.test(word.text) && !this.dictionary.ro.has(fold(word.text))) return word.text;
    this.untranslated.push({word: word.text, lemma: word.lemma, upos: word.upos, start: word.start, end: word.end});
    return word.text;
  }

  // ---------------- sentences

  /** Translate a parse ({sentences}) of `message`; returns {text, pieces, untranslated, decisions}. */
  translate(parse) {
    const all = [];
    (parse.sentences ?? []).forEach((sentence, index) => {
      const S = indexSentence(sentence, index);
      for (const w of S.words) w.key = `${w.start}:${w.end}:${index}:${w.id}`;
      S.question = S.words.some(w => w.text.includes('?'));
      S.semicolon = Math.max(0, ...S.words.filter(w => /^[;]$/.test(w.text)).map(w => w.id));
      this.sentence = S;
      this.used = new Set();
      this.markExpressions(S);
      const pieces = this.clause(S.root, S, {top: true, question: S.question});
      const first = pieces.find(p => p.text && /\p{L}/u.test(p.text));
      if (first && /^\p{Ll}/u.test(first.text)) first.text = first.text[0].toUpperCase() + first.text.slice(1);
      // Words the realizer did not reach keep their gloss at the end (a parse fragment is never dropped silently).
      const missed = S.words.filter(w => !this.used.has(w.id) && w.upos !== 'PUNCT');
      for (const w of missed) pieces.splice(pieces.length - (pieces.at(-1)?.kind === 'punct' ? 1 : 0), 0, ...this.word(w, S));
      all.push(...pieces);
    });
    const joined = joinPieces(all);
    return {version: TRANSLATE_VERSION, ...joined, untranslated: this.untranslated, decisions: this.decisions};
  }

  use(...words) { for (const w of words.flat()) if (w) this.used.add(w.id); }

  /** Multiword expressions: the head word gets `override`, the other words are absorbed (marked used). */
  markExpressions(S) {
    const words = S.words.slice().sort(ORDER);
    const folded = words.map(w => fold(w.text));
    for (let i = 0; i < words.length; i++) {
      if (words[i].absorbed || words[i].override !== undefined) continue;
      for (const [phrase, english] of MWE) {
        if (i + phrase.length > words.length || !phrase.every((p, j) => folded[i + j] === p)) continue;
        const run = words.slice(i, i + phrase.length);
        if (run.some((w, j) => j && w.id !== run[j - 1].id + 1)) continue;
        // The head: a word whose head lies outside the run, closest to the root.
        const depth = w => { let d = 0, x = w; while (x && x.head && d < 50) { x = S.byId.get(x.head); d++; } return d; };
        const outside = run.filter(w => !run.some(o => o.id === w.head)).sort((a, b) => depth(a) - depth(b));
        const head = outside[0] ?? run[0];
        head.override = english;
        head.mwe = run;
        for (const w of run) if (w !== head) { w.absorbed = true; this.used.add(w.id); }
        break;
      }
    }
  }

  /** Remaining dependants of a nominal head (relative clauses become "who/which/that ..."). */
  rest(n, S) {
    const out = [];
    for (const k of n.kids.filter(k => !this.used.has(k.id)).sort(ORDER)) out.push(...(['acl', 'acl:relcl'].includes(k.deprel) ? this.relative(k, n, S) : this.node(k, S, {})));
    return out;
  }

  /** Generic dispatch of a dependent subtree. */
  node(n, S, ctx = {}) {
    if (n.upos === 'PUNCT') { this.use(n); return [piece(n.text, [n], 'punct')]; }
    if (n.override !== undefined) return this.expression(n, S, ctx);
    if (n.upos === 'VERB' && this.label(n) === 'name' && !kids(n, 'nsubj', 'obj', 'aux').length) return this.np(n, S, ctx);
    if (this.isClause(n)) return this.clause(n, S, ctx);
    return this.np(n, S, ctx);
  }

  /** A multiword expression head: its phrase, then its remaining dependants (clauses keep their own form). */
  expression(n, S, ctx = {}) {
    this.use(n);
    const out = n.override ? [piece(n.override, n.mwe ?? [n], 'expression')] : [];
    for (const k of n.kids.filter(k => !this.used.has(k.id)).sort(ORDER)) {
      if (['ccomp', 'csubj', 'advcl', 'parataxis', 'conj'].includes(base(k.deprel)) && this.isClause(k)) out.push(...this.clause(k, S, {...ctx, embedded: ctx.embedded ?? false, top: true}));
      else out.push(...this.node(k, S, {}));
    }
    return out;
  }

  isClause(n) {
    if (['VERB'].includes(n.upos) && n.feats?.VerbForm !== 'Part') return true;
    if (n.upos === 'VERB' && kids(n, 'aux', 'aux:pass', 'nsubj', 'nsubj:pass').length) return true;
    if (n.upos === 'AUX' && !kids(n, 'cop').length && n.head === 0) return true;
    return kids(n, 'cop').length > 0 || (kids(n, 'nsubj', 'csubj').length > 0 && !['NOUN', 'PROPN', 'PRON'].includes(n.upos));
  }

  /** Word-by-word fallback for one word. */
  word(w, S) {
    this.use(w);
    const f = fold(w.text);
    if (w.upos === 'PUNCT') return [piece(w.text, [w], 'punct')];
    if (w.upos === 'NUM' || /\d/.test(w.text) || this.isName(w, S) || this.label(w) === 'en') return [piece(w.text, [w], 'verbatim')];
    if (w.override !== undefined) return w.override ? [piece(w.override, w.mwe ?? [w], 'expression')] : [];
    if (MONTHS[f] && (f !== 'mai' || (w.upos === 'NOUN' || w.upos === 'PROPN'))) return [piece(MONTHS[f], [w])];
    if (NUMERALS[f]) return [piece(NUMERALS[f], [w])];
    if (INTERJECTIONS[f]) return [piece(INTERJECTIONS[f], [w])];
    if (f === 'si' && w.deprel === 'advmod') return [piece('also', [w])];
    if (RO_ARTICLE_SUFFIX.test(w.text)) return [];
    const table = PREPOSITIONS[f] ?? CONJUNCTIONS[f] ?? ADVERBS[f] ?? DETERMINERS[f] ?? PRONOUNS[f]?.[0] ?? WH[f];
    if (table !== undefined) return table ? [piece(table, [w])] : [];
    if (w.upos === 'PRON') return [piece(this.pronoun(w, 'nom'), [w])];
    if (['expl', 'expl:pv', 'expl:pass', 'expl:poss', 'expl:impers'].includes(w.deprel)) return [];
    const allowed = {VERB: ['verb', 'relation'], AUX: ['verb'], NOUN: ['noun'], ADJ: ['adj'], ADV: ['adv'], ADP: ['prep'], CCONJ: ['conj'], SCONJ: ['conj']}[w.upos];
    return [piece(this.content(w, allowed, S), [w], 'content')];
  }

  pronoun(w, kase = 'nom') {
    const i = kase === 'nom' ? 0 : 1;
    const f = fold(w.lemma ?? w.text), t = fold(w.text);
    if (PRONOUNS[t] && !['ei', 'ea', 'el'].includes(t)) return PRONOUNS[t][i];
    if (w.feats?.PronType === 'Prs' || w.feats?.Strength === 'Weak' || ['eu', 'tu', 'el', 'ea', 'noi', 'voi', 'ei', 'ele', 'sine'].includes(f)) {
      const p = w.feats?.Person ?? (f === 'eu' ? '1' : f === 'tu' ? '2' : '3');
      const n = w.feats?.Number ?? 'Sing';
      const g = p === '3' && n === 'Sing' ? (w.feats?.Gender === 'Fem' ? 'Fem' : w.feats?.Gender === 'Masc' ? 'Masc' : '') : '';
      const forms = PERSONAL[p + n + g] ?? PERSONAL[p + n] ?? ['it', 'it'];
      // Dative/accusative case forms are objects.
      return /Dat|Acc/.test(w.feats?.Case ?? '') && !/Nom/.test(w.feats?.Case ?? '') ? forms[1] : forms[i];
    }
    return PRONOUNS[f]?.[i] ?? WH[f] ?? this.content(w, ['pron'], this.sentence);
  }

  // ---------------- noun phrases

  /** Preposition of a noun phrase from its case markers (with fixed continuations), or null. */
  caseOf(n) {
    const markers = [...kids(n, 'case'), ...kids(n, 'det').filter(d => d.id < n.id && GENITIVE_ARTICLES.has(fold(d.text)) && d.upos !== 'NUM')].sort(ORDER);
    if (!markers.length) return null;
    const words = markers.flatMap(m => [m, ...kids(m, 'fixed')]).sort(ORDER);
    return {words, key: words.map(w => fold(w.text)).join(' ')};
  }

  /** A wh phrase in this noun phrase: {text, words} ("la ce companie" → "at which company"; "cât timp" → "how long"). */
  whPhrase(n, S) {
    const words = [n, ...n.kids.filter(k => ['case', 'det', 'fixed', 'advmod', 'nummod', 'amod'].includes(base(k.deprel)) || k.deprel === 'fixed')].sort(ORDER);
    const folded = words.map(w => fold(w.text));
    for (const [phrase, english] of WH_PHRASES) {
      for (let i = 0; i + phrase.length <= folded.length; i++) {
        if (phrase.every((p, j) => folded[i + j] === p)) {
          const covered = words.slice(i, i + phrase.length);
          const rest = words.filter(w => !covered.includes(w) && w !== n);
          if (covered.includes(n) || rest.every(w => w.upos === 'ADP')) return {text: english, words: covered, head: covered.includes(n)};
          if (english === 'how long' && !covered.includes(n)) return null;
        }
      }
    }
    return null;
  }

  isWh(w) { return Boolean(WH[fold(w.text)]) && /Int/.test(w.feats?.PronType ?? 'Int') && !['acl', 'acl:relcl'].includes(w.deprel); }

  /** Realize a nominal: pieces for `[prep] [det] [adjs] [compound] head [of-phrases] [relative clause]`. */
  np(n, S, ctx = {}) {
    if (n.override !== undefined && !this.used.has(n.id)) return this.expression(n, S, ctx);
    const out = [];
    for (const p of kids(n, 'punct').filter(p => p.id < n.id && !this.used.has(p.id) && p.id === Math.min(...[n, ...n.kids].map(w => w.id)))) { this.use(p); out.push(piece(p.text, [p], 'punct')); }
    for (const c of kids(n, 'cc').filter(c => c.id < n.id && !this.used.has(c.id))) { this.use(c); out.push(piece(CONJUNCTIONS[fold(c.text)] ?? this.content(c, ['conj'], S), [c], 'cc')); }
    const kase = this.caseOf(n);
    const whole = this.whPhrase(n, S);
    const prep = ctx.dropCase || !kase ? null : this.preposition(kase, n);
    if (kase) this.use(kase.words);
    if (whole && whole.head) {
      this.use(whole.words, n);
      const rest = n.kids.filter(k => !whole.words.includes(k) && !this.used.has(k.id));
      out.push(piece(whole.text, whole.words, 'wh'));
      for (const k of rest.sort(ORDER)) out.push(...this.node(k, S, {}));
      return out;
    }
    if (prep) out.push(piece(prep.text, prep.words, 'prep'));
    this.use(n);
    const f = fold(n.text), lemma = fold(n.lemma ?? n.text);
    // Verbatim material: names (with their whole name subtree), numbers with units, English words.
    if (this.isName(n, S)) {
      const inner = [];
      const walk = w => { for (const k of w.kids) if (!['acl', 'acl:relcl', 'advcl', 'conj', 'cc', 'punct', 'appos', 'case', 'parataxis', 'nmod:tmod'].includes(k.deprel) || (w !== n && ['case'].includes(k.deprel)) || (['acl', 'advcl'].includes(k.deprel) && this.label(k) === 'name')) { inner.push(k); walk(k); } };
      walk(n);
      const span = [n, ...inner.filter(w => !kase?.words.includes(w))].sort(ORDER);
      // Keep only the contiguous name run around the head; attached material elsewhere is realized separately.
      const run = contiguous(span, n);
      this.use(run);
      out.push(piece(this.message.slice(run[0].start, run.at(-1).end), run, 'name'));
      out.push(...this.rest(n, S));
      return out;
    }
    if (n.upos === 'NUM' || /\d/.test(n.text)) {
      const unit = n.kids.filter(k => !this.used.has(k.id) && (UNITS.has(fold(k.text)) || MONTHS[fold(k.text)] || /\d/.test(k.text) || k.deprel === 'flat')).sort(ORDER);
      const words = [n, ...unit].sort(ORDER);
      this.use(words);
      out.push(piece(words.map(w => MONTHS[fold(w.text)] ?? w.text).join(' ').replace(/\s+([.,])/g, '$1'), words, 'verbatim'));
      out.push(...this.rest(n, S));
      return out;
    }
    if ((MONTHS[f] || MONTHS[lemma]) && (f !== 'mai' || n.kids.some(k => /\d/.test(k.text)) || S.words.some(w => Math.abs(w.id - n.id) === 1 && /\d/.test(w.text)))) {
      // "1 februarie 2026": the day and year hang on the month name.
      const parts = [n, ...n.kids.filter(k => ['nummod', 'amod', 'flat', 'nmod'].includes(base(k.deprel)) && /\d/.test(k.text))].sort(ORDER);
      this.use(parts);
      out.push(piece(parts.map(w => MONTHS[fold(w.text)] ?? w.text).join(' '), parts, 'date'));
      out.push(...this.rest(n, S));
      return out;
    }
    if (UNITS.has(f) && kids(n, 'nummod').length) {
      const words = [...kids(n, 'nummod'), n].sort(ORDER);
      this.use(words);
      out.push(piece(this.message.slice(words[0].start, words.at(-1).end), words, 'verbatim'));
      out.push(...this.rest(n, S));
      return out;
    }
    // "în ziua de 1 aprilie 2024", "la data de 08.10.2019": the date itself.
    if (['zi', 'data', 'an', 'luna'].includes(lemma) || ['ziua', 'data', 'anul', 'luna'].includes(f)) {
      const date = n.kids.find(k => ['nmod', 'nummod', 'amod', 'appos', 'flat'].includes(base(k.deprel)) && (/\d/.test(k.text) || MONTHS[fold(k.text)] || k.kids.some(x => /\d/.test(x.text))));
      if (date) {
        const inner = this.np(date, S, {dropCase: true});
        this.use(n);
        return [...(prep ? [piece(['an', 'luna'].includes(lemma) || ['anul', 'luna'].includes(f) ? 'in' : 'on', prep.words, 'prep')] : []), ...inner.map(p => ({...p, src: [...p.src]})), ...n.kids.filter(k => !this.used.has(k.id) && k.upos !== 'ADP').sort(ORDER).flatMap(k => this.node(k, S, {}))];
      }
    }
    if (n.upos === 'PRON' || (n.upos === 'DET' && !n.kids.length)) {
      const text = this.isWh(n) ? (fold(n.text) === 'cui' ? 'whom' : WH[fold(n.text)]) : this.pronoun(n, ctx.object ? 'acc' : 'nom');
      out.push(piece(text, [n], this.isWh(n) ? 'wh' : 'pronoun'));
      out.push(...this.rest(n, S));
      return out;
    }
    if (n.upos === 'ADV') {
      out.push(...this.word(n, S));
      out.push(...this.rest(n, S));
      return out;
    }
    if (n.upos === 'ADJ' && !['NOUN'].includes(n.upos)) {
      const adverbs = kids(n, 'advmod').filter(k => !this.used.has(k.id));
      for (const a of adverbs) out.push(...this.word(a, S));
      out.push(piece(this.adjective(n, S), [n], 'content'));
      out.push(...this.rest(n, S));
      return out;
    }
    // Common noun.
    const dets = kids(n, 'det', 'det:poss', 'nummod', 'amod').filter(k => !this.used.has(k.id));
    const pre = [];
    let article = null;
    let possessive = null;
    for (const d of dets.sort(ORDER)) {
      const df = fold(d.text);
      if (d.override !== undefined) { this.use(d); if (d.override) pre.push(piece(d.override, d.mwe ?? [d], 'expression')); continue; }
      if (d.deprel === 'amod' && d.upos === 'ADJ') continue;
      if (NUMERALS[df]) { this.use(d); pre.push(piece(NUMERALS[df], [d])); continue; }
      if (this.isWh(d)) { this.use(d); pre.push(piece(['cati', 'cate'].includes(df) ? 'how many' : ['cat', 'cata'].includes(df) ? 'how much' : df === 'ce' || df === 'care' ? 'which' : WH[df], [d], 'wh')); continue; }
      if (POSSESSIVES.has(df) || d.feats?.Poss === 'Yes') { this.use(d); possessive = piece(DETERMINERS[df] ?? 'the', [d]); continue; }
      if (DETERMINERS[df] !== undefined) { this.use(d); article = piece(DETERMINERS[df], [d]); continue; }
      if (d.upos === 'NUM' || /\d/.test(d.text)) { this.use(d); pre.push(piece(d.text, [d], 'verbatim')); continue; }
      if (d.upos === 'DET' || d.upos === 'PRON') { this.use(d); const t = this.content(d, ['det', 'pron', 'adj'], S); pre.push(piece(t, [d])); }
    }
    const adjectives = kids(n, 'amod').filter(k => !this.used.has(k.id) && !this.isName(k, S)).sort(ORDER);
    const adjPieces = [];
    for (const a of adjectives) {
      this.use(a);
      for (const adv of kids(a, 'advmod').filter(k => !this.used.has(k.id))) adjPieces.push(...this.word(adv, S));
      adjPieces.push(piece(this.adjective(a, S), [a], 'content'));
    }
    // "atelierul de fotografie": a bare "de" noun becomes an English compound ("photography workshop").
    const compounds = [];
    for (const m of kids(n, 'nmod').sort(ORDER)) {
      if (this.used.has(m.id)) continue;
      const mk = this.caseOf(m);
      if (mk?.key === 'de' && m.upos === 'NOUN' && (m.feats?.Definite ?? 'Ind') === 'Ind' && !kids(m, 'det', 'nummod', 'nmod', 'acl').length && !this.isName(m, S)) {
        this.use(m, mk.words);
        for (const a of kids(m, 'amod')) { this.use(a); compounds.push(piece(this.adjective(a, S), [a], 'content')); }
        compounds.push(piece(this.content(m, ['noun'], S), [m], 'content'));
      }
    }
    let head = this.content(n, ['noun'], S);
    if (n.feats?.Number === 'Plur' && head !== n.text && !/\s/.test(head.trim()) && !['people', 'data'].includes(head)) head = pluralize(head);
    else if (n.feats?.Number === 'Plur' && head !== n.text) head = pluralize(head);
    const suffix = n.kids.find(k => RO_ARTICLE_SUFFIX.test(k.text));
    if (suffix) this.use(suffix);
    const definite = n.feats?.Definite === 'Def' || Boolean(suffix) || /-(ul|ului|urile|ii|le)$/i.test(n.text);
    if (possessive) out.push(possessive);
    else if (article) out.push(article.text === 'a' ? piece(indefinite([...pre, ...adjPieces, ...compounds][0]?.text ?? head), article.src.map(k => ({key: k}))) : article);
    else if (definite && !pre.some(p => p.kind === 'wh') && !ctx.bare) out.push(piece('the', [], 'article'));
    out.push(...pre, ...adjPieces, ...compounds, piece(head, [n], 'content'));
    // Genitive and prepositional modifiers follow the noun.
    for (const k of n.kids.filter(k => !this.used.has(k.id)).sort(ORDER)) {
      if (['nmod', 'nmod:poss'].includes(k.deprel) && !this.caseOf(k) && /Gen|Dat/.test(k.feats?.Case ?? '')) {
        const inner = this.np(k, S, {});
        out.push(piece('of', [], 'prep'), ...inner);
        continue;
      }
      if (['acl', 'acl:relcl'].includes(k.deprel)) { out.push(...this.relative(k, n, S)); continue; }
      out.push(...this.node(k, S, {}));
    }
    return out;
  }

  adjective(a, S) {
    if (this.label(a) === 'en') return a.text;
    if (a.feats?.VerbForm === 'Part') {
      const verb = this.gloss({...a, text: a.lemma}, ['verb', 'relation']) ?? this.gloss(a, ['adj']);
      if (verb) return /^(be |the )/.test(verb) || /ed$|en$/.test(verb.split(' ')[0]) ? verb : inflectVerb(verb, 'part');
    }
    return this.content(a, ['adj'], S);
  }

  preposition(kase, n) {
    const key = kase.key;
    let text = PREPOSITIONS[key];
    // "pe" marking a person object is an accusative marker, not "on".
    if (key === 'pe' && ['obj', 'iobj'].includes(base(n.deprel))) text = '';
    if (key === 'pe' && n.feats?.Definite !== 'Def' && /\d/.test(n.text)) text = 'on';
    const parent = this.sentence?.byId.get(n.head);
    // "deținută de X": the agent of a participle; "fără X" in a question about people: an exception.
    if (key === 'de' && parent && (parent.feats?.VerbForm === 'Part') && base(n.deprel) === 'obl') text = 'by';
    if (key === 'fara' && this.sentence?.question && (n.upos === 'PROPN' || this.isName(n, this.sentence))) text = 'except';
    if ((key === 'in' || key === 'la') && parent && MOTION.has(fold(parent.lemma ?? parent.text))) text = 'to';
    if (text === undefined) text = kase.words.map(w => PREPOSITIONS[fold(w.text)] ?? this.content(w, ['prep'], this.sentence)).join(' ');
    return {text, words: kase.words};
  }

  // ---------------- clauses

  /** Relative clause on `head`: "who/which/that ..." or "PREP which ...". */
  relative(c, head, S) {
    const rel = c.kids.find(k => ['care', 'ce', 'cine', 'unde', 'cand'].includes(fold(k.text)) || (k.kids.some(x => ['care', 'cui'].includes(fold(x.text))) && ['obl', 'nmod'].includes(base(k.deprel))));
    const person = head.upos === 'PRON' || head.upos === 'PROPN';
    if (!rel) return this.clause(c, S, {relative: true, participle: c.feats?.VerbForm === 'Part'});
    const relWord = ['care', 'ce', 'cine', 'unde', 'cand'].includes(fold(rel.text)) ? rel : rel.kids.find(x => ['care', 'cui'].includes(fold(x.text)));
    this.use(relWord);
    const role = base(rel.deprel);
    let lead;
    if (fold(rel.text) === 'unde') lead = 'where';
    else if (fold(rel.text) === 'cand') lead = 'when';
    else if (role === 'nsubj') lead = person ? 'who' : 'that';
    else if (role === 'obj') { const k = this.caseOf(rel); if (k) this.use(k.words); lead = person ? 'whom' : 'that'; }
    else {
      const k = this.caseOf(rel);
      if (k) this.use(k.words);
      const verbPrep = this.relationPhrase(c, S, rel)?.prep;
      lead = `${verbPrep ?? (k ? this.preposition(k, rel).text : '')} which`.trim();
      this.use(rel);
      return [piece(lead, [relWord, ...(k?.words ?? []), rel], 'relative'), ...this.clause(c, S, {relative: true, relWord: rel, consumedObl: rel})];
    }
    this.use(rel);
    return [piece(lead, [relWord], 'relative'), ...this.clause(c, S, {relative: true, relWord: rel, relSubject: role === 'nsubj'})];
  }

  /**
   * Relation phrase of a predicate from the dictionary: the verb (with "fi" for a copula, "se" for a reflexive)
   * and the preposition of its first oblique ("lucra la", "fi înscris la", "se ocupa de"), as lemma and as surface.
   * Returns {english, verb, middle, prep, obl, key} or null.
   */
  relationPhrase(h, S, preferObl = null) {
    const cop = kids(h, 'cop')[0];
    const passive = kids(h, 'aux:pass').some(a => fold(a.lemma ?? a.text) === 'fi') || (h.feats?.VerbForm === 'Part' && kids(h, 'aux').some(a => fold(a.lemma ?? a.text) === 'fi'));
    const refl = kids(h, 'expl:pv', 'expl:pass', 'expl', 'obj', 'iobj').find(k => k.upos === 'PRON' && /^(se|s|si|isi|ma|m|te|ne|va|v)$/.test(fold(k.text).replace(/-$/, '')) && (k.deprel.startsWith('expl') || /^(se|s)$/.test(fold(k.text).replace(/-$/, ''))));
    if (refl && !refl.deprel.startsWith('expl')) this.used.add(refl.id);
    const argLabels = cop ? ['obl', 'obj', 'iobj', 'nmod'] : ['obl', 'obj', 'iobj'];
    const obls = [preferObl, ...kids(h, ...argLabels).filter(k => k !== preferObl)].filter(Boolean).filter(k => !this.used.has(k.id) || k === preferObl).filter(k => this.caseOf(k));
    const lemma = fold(h.lemma ?? h.text), surface = fold(h.text);
    const pre = [cop || passive ? 'fi' : null, refl ? 'se' : null].filter(Boolean).join(' ');
    const forms = [...new Set([lemma, surface, h.feats?.VerbForm === 'Part' || h.upos === 'ADJ' ? surface.replace(/(a|ă|i|e)$/, '') : null].filter(Boolean))];
    const own = cop ? this.caseOf(h) : null;
    const heads = [];
    for (const form of forms) {
      if (own) heads.push(`fi ${own.key} ${form}`);
      heads.push(pre ? `${pre} ${form}` : form);
    }
    // The surface from the first auxiliary or copula to the head ("a fost înscrisă", "e în lotul").
    const group = [...kids(h, 'aux', 'aux:pass', 'cop'), ...(own ? own.words : []), h].sort(ORDER);
    if (group.length > 1) heads.push(fold(this.message.slice(group[0].start, h.end)));
    const allowed = ['relation', 'verb'];
    const lookup = (key, list = allowed) => this.entries(key, list).find(({entry}) => entry.en.length);
    // A bare object noun belongs to the expression ("avea nevoie", "lua bonusul" → "get the bonus").
    const object = kids(h, 'obj').find(o => !this.caseOf(o) && ['NOUN'].includes(o.upos) && !this.used.has(o.id) && !this.isName(o, S));
    if (object) {
      const objectObls = kids(object, 'nmod').filter(k => this.caseOf(k) && !this.used.has(k.id));
      for (const form of forms) for (const obj of [fold(object.text), fold(object.lemma ?? object.text)]) {
        const key = `${form} ${obj}`;
        const table = VERB_OBJECT[key];
        for (const o of [...obls, ...objectObls]) {
          const k = this.caseOf(o);
          if (o.upos === 'NOUN' && !kids(o, 'det', 'amod', 'nmod', 'nummod').length) {
            const whole = `${key} ${k.key} ${fold(o.text)}`;
            const hit = lookup(whole);
            if (hit) return this.phrase(hit.entry, h, null, whole, false, [object, o, ...k.words]);
          }
          const found = lookup(`${key} ${k.key}`);
          if (found) return this.phrase(found.entry, h, o, `${key} ${k.key}`, true, [object]);
        }
        if (table) return this.phrase({id: 'symbolic-lm:verb-object:' + key, en: [table], pos: 'verb', source: 'symbolic-lm'}, h, null, key, false, [object]);
        const found = lookup(key);
        if (found) return this.phrase(found.entry, h, null, key, false, [object]);
      }
    }
    // A copular noun with a genitive noun ("e autoarea cărții X" → "be the author of" X).
    if (cop) {
      const gen = kids(h, 'nmod').find(g => !this.caseOf(g) && /Gen/.test(g.feats?.Case ?? '') && g.upos === 'NOUN');
      if (gen) for (const head of heads) {
        const key = `${head} ${fold(gen.text)}`;
        const found = lookup(key);
        const target = gen.kids.find(k => ['nmod', 'appos', 'flat', 'amod'].includes(base(k.deprel)) && this.isName(k, S));
        if (found && target) return this.phrase(found.entry, h, target, key, true, [gen]);
      }
    }
    for (const o of obls) {
      const k = this.caseOf(o);
      if (o.upos === 'NOUN' && !kids(o, 'det', 'amod', 'nmod', 'nummod').length) for (const head of heads) {
        const key = `${head} ${k.key} ${fold(o.text)}`;
        const found = lookup(key);
        if (found) return this.phrase(found.entry, h, null, key, false, [o, ...k.words]);
      }
      for (const head of heads) {
        const found = lookup(`${head} ${k.key}`);
        if (found) return this.phrase(found.entry, h, o, `${head} ${k.key}`, true, own ? own.words : []);
      }
    }
    for (const head of heads) {
      const found = lookup(head, cop ? ['relation', 'verb', 'adj', 'phrase'] : allowed);
      if (found) return this.phrase(found.entry, h, null, head, false, own ? own.words : []);
    }
    // A reflexive without its own entry: the reflexive table ("se întreba" → "wonder"), then the plain verb.
    if ((refl || passive) && !cop) {
      if (refl && REFLEXIVE[lemma]) return this.phrase({id: 'symbolic-lm:reflexive:' + lemma, en: [REFLEXIVE[lemma]], pos: 'verb', source: 'symbolic-lm'}, h, null, 'se ' + lemma, false);
      for (const o of obls) {
        const k = this.caseOf(o);
        for (const form of forms) {
          const found = lookup(`${form} ${k.key}`);
          if (found) return this.passive(this.phrase(found.entry, h, o, `${form} ${k.key}`, true), passive);
        }
      }
      for (const form of forms) {
        const found = lookup(form);
        if (found) return this.passive(this.phrase(found.entry, h, null, form, false), passive);
      }
    }
    return null;
  }

  /** A plain verb phrase found for a passive ("e instruit" → "be trained"). */
  passive(rel, passive) {
    if (!passive || rel.main[0] === 'be') return rel;
    return {...rel, main: ['be', inflectVerb(rel.main[0], 'part'), ...rel.main.slice(1)]};
  }

  /**
   * The English surface of a synonym-set entry closest to the Romanian words: each candidate scores two points per
   * content word shared (by a five-letter stem) with the glosses of the Romanian content words and loses one per
   * other content word; ties go to the shorter candidate, then to the entry order. "fi vaccinat" → "be vaccinated",
   * not "be vaccinated against the flu"; "lua bonusul" → "get the bonus".
   */
  bestEnglish(entry, key) {
    if (entry.en.length < 2) return entry.en[0];
    const stem = w => w.toLowerCase().slice(0, 5);
    const literal = new Set();
    for (const w of key.split(' ')) {
      if (RO_KEY_FUNCTION.has(w)) continue;
      const hits = [...this.entries(w, null), ...(w.length > 4 ? this.entries(w.replace(/(ul|ului|a|ă|i|e|ele|ile|ii)$/u, ''), null) : [])];
      for (const {entry: e} of hits.slice(0, 6)) for (const en of e.en.slice(0, 4)) for (const x of en.split(' ')) if (!EN_KEY_FUNCTION.has(x.toLowerCase())) literal.add(stem(x));
    }
    if (!literal.size) return entry.en[0];
    const scored = entry.en.map((en, i) => {
      const content = en.split(' ').filter(x => !EN_KEY_FUNCTION.has(x.toLowerCase()));
      const overlap = content.filter(x => literal.has(stem(x))).length;
      return {en, i, score: 2 * overlap - (content.length - overlap), words: en.split(' ').length};
    }).sort((a, b) => b.score - a.score || a.words - b.words || a.i - b.i);
    return scored[0].en;
  }

  phrase(entry, h, obl, key, withPrep, consumed = []) {
    const english = this.bestEnglish(entry, key);
    const words = english.split(' ');
    const PREPS = new Set(['at', 'in', 'on', 'to', 'for', 'from', 'with', 'of', 'by', 'about', 'into', 'under', 'after', 'before']);
    const prep = !withPrep ? null : PREPS.has(words.at(-1)) && words.length > 1 ? words.at(-1) : '';
    this.decisions.push({predicate: h.text, key, via: entry.source ?? entry.file, entry: entry.id, en: english});
    // `prep` '' means the Romanian preposition is consumed and the English phrase takes the oblique as its object.
    const main = prep ? words.slice(0, -1) : words;
    return {english, main, verb: words[0], prep, obl: withPrep ? obl : null, key, pos: entry.pos, consumed};
  }

  /** Is a word inside a masked lead-in (the parse is of the masked message, so masked words do not exist)? */
  masked(w) { return !String(this.message.slice(w.start, w.end)).trim(); }

  /** Tense, mood and agreement of a clause: {form, modal, future, conditional, imperative, person, number}. */
  tenseOf(h, S, subj) {
    const aux = kids(h, 'aux', 'aux:pass');
    const cop = kids(h, 'cop')[0];
    const auxLemmas = aux.map(a => fold(a.lemma ?? a.text));
    const auxTexts = aux.map(a => fold(a.text));
    const verb = cop ?? h;
    const t = {form: 'present', modal: null, person: 3, number: 'Sing'};
    const featsOf = w => w?.feats ?? {};
    if (auxLemmas.includes('vrea') || auxTexts.some(x => ['va', 'vor', 'voi', 'vei', 'vom', 'veti'].includes(x)) || (auxTexts.includes('o') && kids(h, 'mark').some(m => fold(m.text) === 'sa'))) t.modal = 'will';
    else if (aux.some(a => featsOf(a).Mood === 'Cnd') || auxTexts.some(x => ['ar', 'as', 'am', 'ati', 'ai'].includes(x)) && (featsOf(verb).VerbForm === 'Inf' || kids(h, 'aux').some(a => fold(a.text) === 'fi'))) t.modal = 'would';
    if (!t.modal) {
      const perfect = auxLemmas.includes('avea') && (featsOf(verb).VerbForm === 'Part' || featsOf(h).VerbForm === 'Part');
      if (perfect) t.form = 'past';
      else if (/Past|Imp|Pqp/.test(featsOf(verb).Tense ?? '') && !(fold(verb.text) === 'vrea' && !aux.length)) t.form = 'past';
      else if (featsOf(h).Mood === 'Imp' || featsOf(verb).Mood === 'Imp') t.form = 'imperative';
      else if (featsOf(verb).Mood === 'Sub' || kids(h, 'mark').some(m => fold(m.text) === 'sa')) t.form = 'base';
      else if (featsOf(verb).VerbForm === 'Inf' && (aux.length || kids(h, 'mark').length || ['xcomp', 'csubj'].includes(h.deprel))) t.form = 'base';
      else if (featsOf(verb).VerbForm === 'Ger') t.form = 'ing';
      else if (featsOf(verb).VerbForm === 'Part' && !aux.length) t.form = 'part';
    }
    // A sentence-initial verb without a subject in a statement, or with a first-person clitic ("spune-mi",
    // "rezervă-mi"), is a request in the imperative (2nd singular imperative and 3rd singular present coincide).
    if (!subj && !aux.length && !cop && h.upos === 'VERB' && t.form === 'present' && (h.head === 0 || h.deprel === 'parataxis') && !kids(h, 'mark').length && (h.feats?.Person ?? '3') !== '1' && !VREA_FORMS[fold(h.text)]) {
      const first = S.words.find(w => !w.absorbed && w.upos !== 'PUNCT' && !this.masked(w));
      const clitic = h.kids.some(k => ['iobj', 'obj', 'expl'].includes(base(k.deprel)) && /^(mi|imi|ne|ni)-?$/.test(fold(k.text)));
      if ((first === h && !S.question) || clitic) t.form = 'imperative';
    }
    // Agreement: the subject decides; else the verb's own person and number.
    const source = [verb, ...aux].find(w => featsOf(w).Person) ?? verb;
    const vrea = fold(h.lemma ?? '') === 'vrea' && !aux.length ? VREA_FORMS[fold(h.text)] : null;
    if (vrea) { t.form = 'present'; if (!subj) { t.person = vrea[0]; t.number = vrea[1]; return t; } }
    if (subj) {
      if (subj.upos === 'PRON' && subj.feats?.Person) { t.person = Number(subj.feats.Person); t.number = subj.feats.Number ?? 'Sing'; }
      else { t.person = 3; t.number = subj.feats?.Number === 'Plur' || kids(subj, 'conj').length ? 'Plur' : 'Sing'; }
      if (['eu'].includes(fold(subj.text))) t.person = 1;
    } else {
      t.person = Number(featsOf(source).Person ?? 3);
      t.number = featsOf(source).Number ?? 'Sing';
    }
    return t;
  }

  /**
   * Realize a clause. ctx: {top, question, embedded, relative, relWord, relSubject, consumedObl, noSubject, modal,
   * subjectPieces}. Returns pieces.
   */
  clause(h, S, ctx = {}) {
    if (h.override !== undefined && !this.used.has(h.id)) return this.expression(h, S, ctx);
    if (h.upos === 'VERB' && this.label(h) === 'name' && !kids(h, 'nsubj', 'obj', 'aux').length) return this.np(h, S, ctx);
    if (INTERJECTIONS[fold(h.text)] && !kids(h, 'nsubj', 'obj', 'cop').length) { h.override = INTERJECTIONS[fold(h.text)]; return this.expression(h, S, ctx); }
    this.use(h);
    const all = h.kids.slice().sort(ORDER);
    const punctEnd = all.filter(k => k.upos === 'PUNCT' && k.id > h.id && k.id === Math.max(...S.words.filter(w => w.head === h.id || w.id === h.id).map(w => w.id)));
    // Modal verbs "poate să vină", "trebuie să plece": the complement is the clause, the modal its auxiliary.
    const lemma = fold(h.lemma ?? h.text);
    const comp = kids(h, 'xcomp', 'ccomp').find(k => k.upos === 'VERB' && (kids(k, 'mark').some(m => fold(m.text) === 'sa') || k.feats?.VerbForm === 'Inf'));
    if (MODAL_VERBS[lemma] && comp && !kids(comp, 'nsubj').length) {
      const t = this.tenseOf(h, S, kids(h, 'nsubj')[0]);
      const modal = MODAL_VERBS[lemma][t.form === 'past' ? 1 : 0];
      for (const m of kids(comp, 'mark')) this.use(m);
      this.use(h);
      // The modal's own dependants (subject, negation, adverbs) move onto the complement clause.
      for (const k of h.kids) if (k !== comp) { k.head = comp.id; comp.kids.push(k); }
      h.kids = [comp];
      return this.clause(comp, S, {...ctx, modal, modalWords: [h]});
    }
    const marks = kids(h, 'mark').filter(k => !this.used.has(k.id)).sort(ORDER);
    const subj = kids(h, 'nsubj', 'nsubj:pass').filter(k => !this.used.has(k.id) || k === ctx.relWord)[0] ?? null;
    const csubj = kids(h, 'csubj', 'csubj:pass')[0] ?? null;
    const negs = kids(h, 'advmod').filter(k => !k.absorbed && k.override === undefined && fold(k.text) === 'nu');
    const cumvaNeg = kids(h, 'advmod').find(k => k.override === '' && fold(k.text) === 'nu');
    if (cumvaNeg) this.use(cumvaNeg);
    const nuCumva = negs.find(k => kids(k, 'fixed').some(x => fold(x.text) === 'cumva') || S.words.some(w => w.id === k.id + 1 && fold(w.text) === 'cumva'));
    // Negative concord: a negative subject ("niciunul", "nimeni") carries the negation in English.
    const NEGATIVE = new Set(['niciunul', 'niciuna', 'nimeni', 'nimic']);
    const negSubject = subj && (NEGATIVE.has(fold(subj.text)) || kids(subj, 'det').some(d => ['niciun', 'nicio'].includes(fold(d.text))));
    const negated = negs.length > 0 && !nuCumva && !negSubject;
    this.use(negs);
    if (nuCumva) this.use(S.words.find(w => w.id === nuCumva.id + 1));
    for (const e of kids(h, 'expl', 'expl:pv', 'expl:pass', 'expl:poss', 'expl:impers')) this.use(e);
    // Clitics that double an overt argument are dropped; a lone clitic object is a pronoun.
    for (const role of ['obj', 'iobj']) {
      const list = kids(h, role);
      const clitics = list.filter(k => k.upos === 'PRON' && k.feats?.Strength === 'Weak');
      if (clitics.length && (list.length > clitics.length || (role === 'iobj' && all.some(k => this.isWh(k) && fold(k.text) === 'cui')))) this.use(clitics);
    }
    const t = this.tenseOf(h, S, subj);
    // Wh word or phrase of this clause (not inside a nested clause).
    let wh = ctx.relative ? null : this.leadingWh(h, S) ?? this.findWh(h, S);
    const copWh = kids(h, 'cop').length && (this.isWh(h) || this.whPhrase(h, S)) && !wh;
    if (copWh) { this.use(h); const w = this.whPhrase(h, S); if (w) this.use(w.words); wh = {arg: h, words: [h], pieces: [piece(w ? w.text : fold(h.text) === 'cui' ? 'whose' : WH[fold(h.text)], [h], 'wh')], stranded: false, copular: true}; }
    for (const m of marks) if (!wh?.words?.includes(m)) this.use(m);
    const whIsSubject = wh && !wh.copular && (wh.arg === subj || (wh.arg && ['nsubj', 'nsubj:pass'].includes(wh.arg.deprel)));
    const beforeSemicolon = S.semicolon && h.id < S.semicolon;
    const question = !beforeSemicolon && Boolean((ctx.question && !ctx.embedded) || (wh && ctx.question));
    const invert = question && !ctx.embedded && !whIsSubject && t.form !== 'imperative' && !ctx.relative;
    // Relation phrase and the verb group.
    const cop = kids(h, 'cop')[0];
    const experiencer = EXPERIENCER[fold(h.lemma ?? h.text)] ? kids(h, 'obj', 'iobj', 'expl', 'expl:pv').find(k => /^(ma|m|mi|imi|ne|ni)-?$/.test(fold(k.text))) : null;
    if (experiencer) { this.use(experiencer); t.person = 1; t.number = /^n/.test(fold(experiencer.text)) ? 'Plur' : 'Sing'; if (t.form === 'imperative') t.form = 'present'; }
    const fixedKey = [fold(h.lemma ?? h.text), ...kids(h, 'fixed').map(w => fold(w.text))].join(' ');
    const rel = experiencer || (kids(h, 'fixed').length && VERB_OBJECT[fixedKey]) ? null : this.relationPhrase(h, S, ctx.consumedObl ?? null);
    let main, predicate = [];
    if (rel && !(cop && rel.pos === 'adj')) main = [...rel.main];
    else if (cop) {
      main = ['be'];
      if (!wh?.copular) predicate = this.predicateNominal(h, S);
    } else if (kids(h, 'fixed').length && VERB_OBJECT[[fold(h.lemma ?? h.text), ...kids(h, 'fixed').map(w => fold(w.text))].join(' ')]) {
      const fixed = kids(h, 'fixed');
      this.use(fixed);
      main = VERB_OBJECT[[fold(h.lemma ?? h.text), ...fixed.map(w => fold(w.text))].join(' ')].split(' ');
    } else if (h.upos === 'AUX') main = [fold(h.lemma) === 'avea' ? 'have' : 'be'];
    else {
      const reflexive = kids(h, 'expl:pv', 'expl').some(k => /^(se|s|ma|m|te|ne|va|isi|imi|iti)$/.test(fold(k.text).replace(/-$/, ''))) ? REFLEXIVE[fold(h.lemma ?? h.text)] : null;
    const request = t.form === 'imperative' ? REQUEST[fold(h.lemma ?? h.text)] : null;
      const gloss = (experiencer ? EXPERIENCER[fold(h.lemma ?? h.text)] : null) ?? request ?? reflexive ?? (this.label(h) === 'en' ? h.text : this.gloss(h, ['verb', 'relation']) ?? this.gloss(h, null));
      main = (gloss ?? this.unknown(h, S)).split(' ');
      const passive = kids(h, 'aux:pass').some(a => fold(a.lemma ?? a.text) === 'fi') || (h.feats?.VerbForm === 'Part' && kids(h, 'aux').some(a => fold(a.lemma ?? a.text) === 'fi'));
      if (passive && main[0] !== 'be') main = ['be', inflectVerb(main[0], 'part'), ...main.slice(1)];
    }
    if (t.form === 'imperative' && rel && REQUEST[fold(h.lemma ?? h.text)] && !rel.obl) main = REQUEST[fold(h.lemma ?? h.text)].split(' ');
    for (const w of rel?.consumed ?? []) this.use(w);
    // "Există cineva care …?" → "Is there someone who …?"
    const INDEFINITE = new Set(['cineva', 'ceva', 'vreun', 'vreo', 'nimeni', 'nimic', 'oricine']);
    const existential = (fold(h.lemma ?? h.text) === 'exista' && subj) || (['fi'].includes(fold(h.lemma ?? h.text)) && subj && INDEFINITE.has(fold(subj.text)));
    const copularExistential = !existential && cop && !subj && INDEFINITE.has(fold(h.text));
    if (existential || copularExistential) main = ['be'];
    if (rel?.obl) this.use(rel.obl);
    const group = this.verbGroup(main, t, {negated, invert, modal: ctx.modal ?? t.modal, ctx});
    const src = [h, cop, ...kids(h, 'aux', 'aux:pass'), ...negs, ...(ctx.modalWords ?? [])].filter(Boolean);
    this.use(src);
    const out = [];
    // Subordinators.
    for (const m of marks.filter(m => !wh?.words?.includes(m))) {
      const key = [m, ...kids(m, 'fixed')].sort(ORDER).map(w => fold(w.text)).join(' ');
      this.use(m, kids(m, 'fixed'));
      if (key === 'sa') { if (!ctx.modal && !subj && !ctx.relative) out.push(piece('to', [m], 'mark')); continue; }
      const english = MARKS[key] ?? MARKS[fold(m.text)] ?? (m.text.toLowerCase() === 'ca' ? 'that' : this.content(m, ['conj'], S));
      if (english) out.push(piece(english === 'whether' && !ctx.embedded && !ctx.complement ? 'if' : english, [m], 'mark'));
    }
    const toInfinitive = out.at(-1)?.text === 'to' && out.at(-1)?.kind === 'mark';
    for (const c of kids(h, 'cc').filter(x => !this.used.has(x.id) && x.id < h.id && x.id === Math.min(...S.words.filter(w => !this.used.has(w.id) || w === x).map(w => w.id)))) {
      this.use(c);
      out.unshift(piece(CONJUNCTIONS[fold(c.text)] ?? 'and', [c], 'cc'));
    }
    // Fronted material: the wh phrase, then clause-initial adverbials.
    if (wh && !whIsSubject) { this.use(wh.words); out.push(...wh.pieces); }
    const subjectFirst = ctx.relative ? null : subj;
    const front = all.filter(k => !this.used.has(k.id) && k.id < h.id && (!subj || k.id < subj.id) && ['advmod', 'obl', 'obl:tmod', 'advcl', 'discourse', 'vocative'].includes(k.deprel) && k.upos !== 'PUNCT' && k !== rel?.obl);
    for (const k of front) { out.push(...this.node(k, S, {embedded: true})); const comma = all.find(p => p.upos === 'PUNCT' && p.id === lastId(k) + 1); if (comma) { this.use(comma); out.push(piece(comma.text, [comma], 'punct')); } }
    let subjectPieces = [];
    if (whIsSubject) { this.use(wh.words); subjectPieces = wh.pieces; }
    else if (subjectFirst) subjectPieces = this.np(subjectFirst, S, {});
    else if (ctx.relative && ctx.relSubject) subjectPieces = [];
    else if (csubj && !subj && (cop || h.upos === 'ADJ')) subjectPieces = [piece('it', [], 'expletive')];
    else if (!ctx.relative && !ctx.noSubject && !toInfinitive && t.form !== 'imperative' && t.form !== 'base' && t.form !== 'ing' && t.form !== 'part' && !(ctx.conj && !subj)) {
      const g = (cop ? h : h).feats?.Gender;
      const p = t.person === 1 ? (t.number === 'Plur' ? 'we' : 'I') : t.person === 2 ? 'you' : t.number === 'Plur' ? 'they' : (csubj || kids(h, 'ccomp').length) && cop ? 'it' : g === 'Fem' ? 'she' : 'he';
      subjectPieces = [piece(p, [], 'pro-drop')];
    }
    if (ctx.relative && ctx.relWord && !ctx.relSubject && subj && subj !== ctx.relWord) subjectPieces = this.np(subj, S, {});
    if (existential && !whIsSubject) { predicate = subjectPieces; subjectPieces = [piece('there', [], 'expletive')]; }
    if (copularExistential) { subjectPieces = [piece('there', [], 'expletive')]; }
    if (!subj && ctx.subjectCopy && !whIsSubject) subjectPieces = ctx.subjectCopy.map(p => ({...p}));
    if (invert) out.push(piece(group.front, [], 'aux'), ...subjectPieces, ...group.rest.map((w, i) => piece(w, i === 0 ? src : [], 'verb')));
    else out.push(...subjectPieces, ...group.all.map((w, i) => piece(w, i === group.all.length - 1 || i === 0 ? src : [], 'verb')));
    out.push(...predicate);
    // Objects, the relation-phrase oblique, then the rest in Romanian order.
    const objects = kids(h, 'obj', 'iobj').filter(k => !this.used.has(k.id)).sort((a, b) => (a.deprel === 'obj' ? 0 : 1) - (b.deprel === 'obj' ? 0 : 1) || a.id - b.id);
    for (const o of objects) {
      if (o.deprel === 'iobj' && !this.caseOf(o) && !(o.upos === 'PRON' && o.feats?.Strength === 'Weak')) { out.push(piece('to', [], 'prep'), ...this.np(o, S, {object: true})); continue; }
      out.push(...this.np(o, S, {object: true}));
    }
    if (rel && rel.prep !== null) {
      const prepPiece = rel.prep ? [piece(rel.prep, [], 'prep')] : [];
      if (rel.obl && rel.obl !== ctx.consumedObl && !(wh && wh.arg === rel.obl)) out.push(...prepPiece, ...this.np(rel.obl, S, {dropCase: true, object: true}));
    }
    if (wh?.stranded) out.push(piece(wh.stranded, [], 'prep'));
    const rest = all.filter(k => !this.used.has(k.id) && !punctEnd.includes(k));
    const conjs = [];
    for (const k of rest) {
      if (this.used.has(k.id)) continue;
      if (k.deprel === 'conj') { conjs.push(k); continue; }
      if (k.deprel === 'cc') continue;
      if (['csubj', 'csubj:pass'].includes(k.deprel)) { out.push(...this.clause(k, S, {embedded: true, complement: true})); continue; }
      if (k.deprel === 'ccomp') { out.push(...this.clause(k, S, {embedded: true, complement: true, question: false})); continue; }
      if (['xcomp'].includes(k.deprel) && k.upos === 'VERB') { out.push(...this.clause(k, S, {embedded: true, noSubject: true})); continue; }
      if (k.deprel === 'advcl') { out.push(...this.clause(k, S, {embedded: true})); continue; }
      if (['acl', 'acl:relcl'].includes(k.deprel)) { out.push(...this.relative(k, h, S)); continue; }
      if (k.deprel === 'parataxis') { out.push(...this.node(k, S, {top: true, question: ctx.question})); continue; }
      out.push(...this.node(k, S, {embedded: true, object: ['obj', 'iobj'].includes(base(k.deprel))}));
    }
    for (const c of conjs) {
      const cc = kids(c, 'cc').concat(kids(h, 'cc').filter(x => x.id > h.id && x.id < c.id));
      for (const x of cc) this.use(x);
      const commas = kids(c, 'punct').filter(p => p.id < c.id);
      for (const p of commas) { this.use(p); out.push(piece(p.text, [p], 'punct')); }
      if (cc.length) out.push(piece(CONJUNCTIONS[fold(cc[0].text)] ?? this.content(cc[0], ['conj'], S), cc, 'cc'));
      // In an inverted question a coordinated predicate without its own subject repeats the subject and the inversion
      // ("Does N visit B and is N enrolled at X?"); elsewhere it shares the subject ("N works at A and lives in B").
      const shared = !kids(c, 'nsubj', 'nsubj:pass').length;
      const copy = invert && shared ? subjectPieces : null;
      out.push(...(this.isClause(c) ? this.clause(c, S, {...ctx, conj: !copy, subjectCopy: copy, top: false, embedded: ctx.embedded, question: copy ? ctx.question : shared ? false : ctx.question}) : this.np(c, S, {})));
    }
    for (const p of punctEnd) if (!this.used.has(p.id)) { this.use(p); out.push(piece(p.text, [p], 'punct')); }
    return out;
  }

  /** A question phrase spelled by the first words of the clause across siblings ("de când", "de ce", "cât timp"). */
  leadingWh(h, S) {
    const inClause = w => { let x = w; for (let d = 0; x && d < 3; d++) { if (x.head === h.id) return x; x = S.byId.get(x.head); } return null; };
    const words = S.words.filter(w => !this.used.has(w.id) && w.id < h.id && w.upos !== 'PUNCT' && inClause(w)).sort(ORDER);
    if (!words.length) return null;
    const folded = words.map(w => fold(w.text));
    for (const [phrase, english] of WH_PHRASES) for (let i = 0; i + phrase.length <= folded.length; i++) {
      if (!phrase.every((p, j) => folded[i + j] === p)) continue;
      const covered = words.slice(i, i + phrase.length);
      if (covered.some((w, j) => j && w.id !== covered[j - 1].id + 1)) continue;
      const args = [...new Set(covered.map(inClause))];
      this.use(covered);
      const arg = args.find(a => covered.includes(a)) ?? args[0];
      // The argument's own remaining words (a noun after "câți": "câți oameni") follow the phrase.
      const rest = arg && !covered.includes(arg) ? [] : (arg ? arg.kids.filter(k => !this.used.has(k.id) && k.upos !== 'PUNCT') : []);
      const pieces = [piece(english, covered, 'wh'), ...rest.sort(ORDER).flatMap(k => this.node(k, S, {}))];
      return {arg, words: covered, pieces, stranded: false};
    }
    return null;
  }

  /** The fronted wh phrase of a clause: {arg, words, pieces, stranded}. */
  findWh(h, S) {
    for (const k of h.kids.slice().sort(ORDER)) {
      if (this.used.has(k.id) || k.upos === 'PUNCT') continue;
      if (['acl', 'acl:relcl', 'ccomp', 'advcl', 'xcomp', 'csubj', 'parataxis', 'conj'].includes(k.deprel)) continue;
      const own = this.isWh(k) || k.kids.some(x => this.isWh(x) && ['det', 'nummod', 'advmod'].includes(base(x.deprel))) || this.whPhrase(k, S);
      if (!own) continue;
      if (k.id > h.id && !['nsubj', 'nsubj:pass'].includes(k.deprel)) continue;
      const before = new Set(this.used);
      const pieces = this.np(k, S, {});
      const words = S.words.filter(w => this.used.has(w.id) && !before.has(w.id));
      // "Cui i-a trimis X Y?" → "Who did X send Y to?" (the dative question word strands "to").
      if (fold(k.text) === 'cui' && !this.caseOf(k)) return {arg: k, words, pieces: [piece('who', [k], 'wh')], stranded: 'to'};
      return {arg: k, words, pieces, stranded: false};
    }
    return null;
  }

  /** The predicate of a copular clause: "e medic" → "a doctor", "e bolnavă" → "ill", "e în lotul de la X" → "in the squad of X". */
  predicateNominal(h, S) {
    this.use(h);
    if (h.upos === 'ADJ' || (h.upos === 'VERB' && h.feats?.VerbForm === 'Part')) {
      const adv = kids(h, 'advmod').filter(k => !this.used.has(k.id) && fold(k.text) !== 'nu');
      const out = adv.flatMap(a => this.word(a, S));
      out.push(piece(this.adjective(h, S), [h], 'content'));
      return out;
    }
    if (this.isWh(h)) return [piece(WH[fold(h.text)] ?? 'what', [h], 'wh')];
    const saved = [...h.kids];
    // Realize the noun phrase without the clause-level dependants (subject, copula, clauses, punctuation, negation).
    const clauseLevel = new Set(['nsubj', 'nsubj:pass', 'cop', 'aux', 'aux:pass', 'mark', 'punct', 'csubj', 'ccomp', 'advcl', 'conj', 'cc', 'parataxis', 'expl', 'expl:pv', 'discourse', 'obl', 'obl:tmod', 'advmod', 'acl', 'acl:relcl']);
    h.kids = saved.filter(k => !clauseLevel.has(k.deprel) || (['obl', 'advmod'].includes(k.deprel) && k.id < h.id && k.upos !== 'ADV'));
    const wasUsed = this.used.has(h.id);
    this.used.delete(h.id);
    const np = h.upos === 'PRON' ? [piece(this.pronoun(h, 'nom'), [h])] : this.np(h, S, {});
    if (wasUsed) this.used.add(h.id);
    h.kids = saved;
    // An indefinite singular noun predicate gets "a": "e medic" → "is a doctor".
    if (h.upos === 'NOUN' && h.feats?.Definite !== 'Def' && h.feats?.Number !== 'Plur' && !kids(h, 'det', 'det:poss', 'nummod').length && !this.caseOf(h)) np.unshift(piece(indefinite(np[0]?.text ?? ''), [], 'article'));
    return np;
  }

  /** English verb group: {all, front, rest}. */
  verbGroup(main, t, {negated, invert, modal}) {
    const [verb, ...tail] = main;
    const person = t.person, number = t.number;
    const isBe = verb === 'be';
    let words;
    if (t.form === 'imperative') words = negated ? ['do', 'not', verb, ...tail] : [verb, ...tail];
    else if (modal) words = [modal, ...(negated ? ['not'] : []), verb, ...tail];
    else if (t.form === 'base') words = [...(negated ? ['not'] : []), verb, ...tail];
    else if (t.form === 'ing') words = [...(negated ? ['not'] : []), inflectVerb(verb, 'ing'), ...tail];
    else if (t.form === 'part') words = [...(negated ? ['not'] : []), inflectVerb(verb, 'part'), ...tail];
    else if (isBe) {
      const be = inflectVerb('be', t.form === 'past' ? 'past' : 'present', {person, number});
      words = [be, ...(negated ? ['not'] : []), ...tail];
    } else if (negated || invert) {
      const aux = t.form === 'past' ? 'did' : number === 'Sing' && person === 3 ? 'does' : 'do';
      words = [aux, ...(negated ? ['not'] : []), verb, ...tail];
    } else words = [inflectVerb(verb, t.form === 'past' ? 'past' : 'present', {person, number}), ...tail];
    const flat = words.join(' ').split(' ').filter(Boolean);
    return {all: flat, front: flat[0], rest: flat.slice(1)};
  }
}

/** The contiguous run of `words` (sorted) that contains `head`. */
function contiguous(words, head) {
  const i = words.indexOf(head);
  let a = i, b = i;
  while (a > 0 && words[a - 1].id === words[a].id - 1) a--;
  while (b < words.length - 1 && words[b + 1].id === words[b].id + 1) b++;
  return words.slice(a, b + 1);
}

const lastId = w => Math.max(w.id, ...w.kids.map(lastId));

/** Translate one Romanian parse. `labels` maps "start:end" to a language-id label (lib/languages-util/langid.mjs). */
export function translateParse(parse, message, {dictionary, labels = new Map(), isEnglish}) {
  return new Translator({dictionary, labels, message, isEnglish}).translate(parse);
}
