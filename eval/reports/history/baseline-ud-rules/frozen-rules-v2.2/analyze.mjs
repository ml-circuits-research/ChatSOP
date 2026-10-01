/**
 * UD → SOP clause analysis (baseline-ud-rules-v1). Deterministic rules over a Stanza Universal Dependencies parse:
 *
 *   - one finite clause → one wire: a declarative clause is `stated` (asserted; hedged under "I think"/"cred că"
 *     or a hedging adverb; supposed under "suppose"/"să presupunem" and in if/unless/so-that clauses), a question
 *     clause is a `query` (a question word gives a `?variable` + `select`, "why" gives `mode explain`, "how many"
 *     `mode count`, "when" `role time ?t`, "since when"/"until when"/"how long" add `measure`);
 *   - the relation is the predicate lemma with its modal, particle and preposition ("work at", "lucra la");
 *     subject/object/recipient come from nsubj/obj/iobj, the other roles from `obl` by the preposition class and
 *     the named-entity type; polarity from `not`/`never`/`nu`;
 *   - an adverbial clause is linked to its main clause with the conjunction keyword line (`because $s2`, `if $s1`);
 *     a relative clause in a question is a match block sharing a variable, in a statement a second statement that
 *     repeats the head noun (C9); "X says that P" gives `speaker`; "all/every/toți" in a question gives `mode every`;
 *     "over 40" gives `compare`, "the most" `rank`, "besides X" `except`, "before X did" `order`;
 *   - every value is a verbatim span of the message (or "the user" for the first person, Q-LANG-5); anything the
 *     rules cannot place becomes an `unparsed` wire with the verbatim span, `near` and a `hint`, never a guess.
 *
 * The analysis is an intermediate representation (`wires`); emit.mjs prints it as SOP Lang.
 */
import {CONNECTIVES, RESULT_ADVERBS, NEGATIONS, WH, WH_PHRASES, EMBED_QUESTION, EMBED_WRAPPER_NOUNS, SAY, THINK, SUPPOSE, HEDGE_ADVERBS, MODALS, MERGE_VERBS,
  FIRST_PERSON, FIRST_POSSESSIVE, THIRD_PERSON, UNIVERSAL, NONE, PREP_ROLE, PLACE_PREPS, TIME_PREPS, TIME_WORDS, SMALL_TALK, ACTION_REQUESTS, RO_CLITICS, EXCEPT_PREPS,
  COMPARATORS, RANK_VALUES, QUANTIFIERS, START_VERBS, STOP_VERBS, THANKS, fold} from './lexicon.mjs';
import {base, indexSentence, kids, subtree, spanText, rangeOf} from './tree.mjs';
import {repairSentence} from './repair.mjs';

const ROLE_HINT = {subject: 'subject', object: 'object', time: 'time', location: 'location'};
const hintFor = role => ROLE_HINT[role] ?? 'value';
/** Adverbs that carry no proposition content (dropped without an unparsed span). */
const FUNCTION_ADVERBS = new Set(['also', 'too', 'still', 'again', 'just', 'already', 'only', 'even', 'then', 'really', 'actually', 'ever', 'yet', 'currently', 'anymore', 'there', 'here', 'as', 'well', 'so', 'very', 'else', 'exactly', 'definitely', 'certainly', 'surely', 'indeed', 'altogether', 'anyway', 'though', 'however', 'besides', 'otherwise', 'rather', 'quite', 'pretty', 'right', 'once', 'twice', 'first', 'finally', 'always', 'usually', 'often', 'sometimes', 'recently', 'lately', 'meanwhile',
  'si', 'tot', 'inca', 'deja', 'doar', 'numai', 'chiar', 'atunci', 'mai', 'oare', 'cumva', 'totusi', 'insa', 'iar', 'foarte', 'exact', 'sigur', 'intr-adevar', 'aici', 'acolo', 'bine', 'asa', 'cam', 'vreodata', 'defapt', 'de', 'fapt', 'anume', 'apropo', 'deci', 'acuma', 'mereu', 'uneori', 'adesea', 'recent', 'totodata', 'desigur', 'oricum']);
/** v1.4 (R6b): determinerless nouns that form a relation with their preposition ('in stock', 'out of service', 'on hold'). */
const IDIOM_NOUNS = /^(stock|service|hold|order|charge|use|touch|office|hospital|prison|debt|love|trouble|danger|business|operation|production|progress|place|effect|force)$/;
const MONTH_WORDS = new Set(['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'septembrie', 'octombrie', 'noiembrie', 'decembrie']);
/** v1.4 (R2): partitive quantifier words ("half of the players of X"). */
const PARTITIVES = new Set(['half', 'most', 'all', 'each', 'any', 'some', 'many', 'none', 'majority', 'one', 'two', 'three', 'both', 'few']);
const PARTICLES = new Set(['back', 'out', 'up', 'down', 'away', 'off', 'over', 'around', 'along', 'through']);
/** v1.6 (R2): post-verbal adverbs that are the time of the clause in a statement and join the relation in a query. */
const TIME_ADVERBS = new Set(['early', 'late', 'soon', 'overnight', 'immediately', 'promptly', 'shortly', 'eventually', 'beforehand', 'afterwards', 'overnight', 'today', 'tomorrow', 'yesterday', 'tonight']);
/** v1.6 (R2): manner adverbs that join the relation phrase ("pack separately", "hold apart", "work alone"). */
const MANNER_ADVERBS = new Set(['separately', 'alone', 'apart', 'instead', 'individually', 'personally', 'manually', 'automatically', 'briefly', 'permanently', 'temporarily', 'jointly']);
/** v1.6 (R1): duration nouns after "for" ("for a week", "for four hours") that make the phrase a time. */
const FOR_DURATION = new Set(['week', 'month', 'year', 'day', 'hour', 'minute', 'night', 'weekend', 'fortnight', 'quarter', 'semester', 'term', 'season', 'while', 'moment', 'second', 'decade']);
const MOTION_VERBS = /^(calatori|merge|pleca|veni|zbura|ajunge|intra|go|come|fly|drive|walk|ride|return|travel|head|move|se muta|muta|trimite|duce|visit|vizita|relocate|commute|get|arrive|emigrate|send|bring|take|deliver|ship|transfer)$/;
const GIVE_VERBS = new Set(['give', 'send', 'sell', 'write', 'tell', 'lend', 'show', 'offer', 'pay', 'hand', 'deliver', 'da', 'trimite', 'vinde', 'scrie', 'spune', 'oferi', 'plati', 'preda', 'livra', 'imprumuta']);
const INDEFINITE = new Set(['anyone', 'anybody', 'someone', 'somebody', 'anything', 'something', 'cineva', 'ceva', 'vreunul', 'vreuna']);
const INDEFINITE_DET = new Set(['any', 'some', 'vreun', 'vreo', 'vreunul', 'niciun', 'nicio']);
const COLLECTIVE = new Set(['together', 'jointly', 'impreuna', 'amandoi', 'amandoua', 'both']);
const SECOND_PERSON = new Set(['you', 'u', 'tu', 'voi', 'dumneavoastra', 'dvs', 'ya']);
const RELATIVE_WORDS = new Set(['who', 'which', 'that', 'whom', 'whose', 'care', 'ce', 'where', 'unde', 'cine', 'when', 'cand']);
const EXISTENTIAL = new Set(['exista', 'exist']);
const DATE = /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b(1[89]|20)\d\d\b/;
const CLAUSE_EDGE = ['conj', 'parataxis', 'advcl', 'acl', 'ccomp', 'csubj', 'acl:relcl', 'advcl:relcl'];
const isClausal = w => ['VERB', 'AUX'].includes(w.upos) || kids(w, 'cop', 'nsubj', 'aux', 'aux:pass', 'nsubj:pass').length > 0;
const isVariable = v => typeof v === 'string' && /^\?/.test(v);
/** A sentence-final period glued to the last word ("Baia Mare.") is not part of the value; abbreviations keep theirs. */
const trimStop = text => (/\S{4,}\.$/.test(text) && !/\b[A-Z]\.$/.test(text) ? text.slice(0, -1) : text);

/** v1.4 (DS021 C1): a Romanian feminine or plural participle or adjective in its masculine singular lemma form. */
function masculine(w) {
  const text = w.text.toLowerCase();
  if (!/Fem|Plur/.test((w.feats?.Gender ?? '') + (w.feats?.Number ?? ''))) return text;
  return text.replace(/(at|it|ut|ât|s|t)(ă|e|i)$/u, '$1').replace(/ați$/u, 'at').replace(/iți$/u, 'it');
}

/** Do words a and b lie inside one named entity (a contiguous B-…I-…E- span), or join with "&"? */
function sameEntity(S, a, b) {
  const [from, to] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
  const span = S.words.filter(w => w.id >= from && w.id <= to);
  if (span.some(w => w.text === '&')) return true;
  if (span.some(w => !w.ner || w.ner === 'O' || w.ner.startsWith('S-'))) return false;
  return !span.slice(1).some(w => w.ner.startsWith('B-')) && !span.slice(0, -1).some(w => w.ner.startsWith('E-'));
}
/** Words of a name chain (the head with its flat/fixed/compound parts): a case marker may hang on any of them. */
const chain = k => [k, ...k.kids.filter(c => ['flat', 'fixed', 'flat:name', 'flat:foreign', 'compound'].includes(c.deprel)).flatMap(chain)];
/** Case markers of an argument: `case` children of the head or of its name chain that precede the head's first word. */
function caseWords(k) {
  const heads = new Set(chain(k).map(w => w.id));
  const first = Math.min(...subtree(k).map(w => w.id));
  return subtree(k).filter(w => w.deprel === 'case' && !w.used && heads.has(w.head) && (w.id <= first || w.head === k.id)).sort((a, b) => a.id - b.id);
}
const caseText = k => caseWords(k).flatMap(c => [c, ...kids(c, 'fixed', 'flat')]).sort((a, b) => a.id - b.id).map(w => w.folded).filter((w, i, all) => w !== all[i - 1]).join(' ').trim();
const markText = k => kids(k, 'mark').flatMap(m => [m, ...kids(m, 'fixed', 'flat')]).sort((a, b) => a.id - b.id).map(w => w.folded).join(' ').trim();

/**
 * v1.3: "Who is the chef at X?" parsed with the question word as root and the predicate noun as its nsubj (with
 * the copula) is re-rooted to the UD analysis: the noun is the root, the question word its nsubj.
 */
function rerootWhCopula(sentence) {
  const words = sentence.words;
  const root = words.find(w => w.head === 0);
  if (!root || root.upos !== 'PRON' || !['who', 'what', 'which'].includes(fold(root.text))) return sentence;
  // v1.4 (R19): "What's the half-life of X?", "Who is the head of X?": the wh word is the root with the copula; a
  // relational noun subject (a determiner and a case-marked nmod) becomes the predicate, the wh word its subject.
  // (v2.0: the v1.3 shape of the default parser, a predicate noun with its own copula under the wh root, never
  // occurs in the accurate trees of the development rows and was removed.)
  if (!words.some(c => c.head === root.id && c.deprel === 'cop')) return sentence;
  const noun = words.find(w => w.head === root.id && w.deprel === 'nsubj' && w.upos === 'NOUN' && words.some(d => d.head === w.id && d.deprel === 'det' && ['the', 'a', 'an'].includes(fold(d.text))) && words.some(n => n.head === w.id && n.deprel === 'nmod' && words.some(c => c.head === n.id && c.deprel === 'case')));
  if (!noun) return sentence;
  return {...sentence, words: words.map(w => (w === noun ? {...w, head: 0, deprel: 'root'} : w === root ? {...w, head: noun.id, deprel: 'nsubj'} : w.head === root.id ? {...w, head: noun.id} : w))};
}
/** v1.3: prepositions that may be stranded as an adverb at the end of a question ("which system does X look after?"). */
/** v1.3: English question words; a Romanian question word ("care", "ce") is not one in an English sentence ("take care of"). */
const EN_WH = new Set(['who', 'whom', 'whose', 'what', 'which', 'where', 'when', 'why', 'how']);
const whIn = (w, S) => Boolean(WH[w.folded]) && (S.language === 'ro' || EN_WH.has(w.folded));
const STRANDABLE = new Set(['after', 'about', 'at', 'for', 'with', 'on', 'in', 'of', 'by', 'into', 'up']);
/** v1.3: prepositions whose phrase right after a definite argument stays inside that value (C9: "the vineyard near Sibiu"). */
const VALUE_PREPS = new Set(['in', 'near', 'by', 'on', 'of']);

export class Analysis {
  /** `parse` is the worker's `{text, language, sentences}`; `message` the original text (offsets refer to it). */
  constructor(parse, message = parse.text) {
    this.message = message;
    this.language = parse.language;
    this.sentences = (parse.sentences ?? []).map((s, i) => indexSentence(repairSentence(rerootWhCopula({...s, language: s.language ?? parse.language})), i));
    this.wires = [];
    this.ids = {s: 0, q: 0, a: 0, u: 0};
    this.people = []; // earlier proper-name subjects, for third-person pronouns
    this.lastSubject = null; // for Romanian pro-drop
    this.subjectPeople = []; // v1.3: person subjects, in order
    this.objectPeople = []; // v1.3: persons in other roles
    this.things = []; // v1.4: non-person subjects, for "it"
    this.ambiguous = null; // v1.3: a pronoun after two parallel clauses
    this.notes = [];
    this.smallTalk = 0;
    this.actionRequests = 0;
  }

  id(kind) {
    this.ids[kind]++;
    if (kind === 'q') return this.ids.q === 1 ? 'q' : 'q' + this.ids.q;
    return kind + this.ids[kind];
  }

  /** Records an unparsed span (verbatim, ≤200 chars) near a wire; returns the wire or null for an empty span. */
  unparsed(words, near, hint = 'other', why = '') {
    const text = spanText(this.message, words.filter(w => !w.used));
    if (!text || /^[\p{P}\p{S}\s]*$/u.test(text)) return null;
    const span = text.length > 200 ? text.slice(0, 200).replace(/\s+\S*$/, '') : text;
    if (this.wires.some(w => w.type === 'unparsed' && fold(w.span) === fold(span))) return null;
    const wire = {type: 'unparsed', id: this.id('u'), span, near: near ?? null, hint, why};
    this.wires.push(wire);
    return wire;
  }

  run() {
    for (const S of this.sentences) this.sentence(S);
    this.resolveLatePronouns();
    return this;
  }

  /**
   * v1.3: a third-person pronoun left as a value because its antecedent was formalized later (a "Since P, is Q?"
   * clause is written after the question) is resolved at the end like any other: one person → that person; several
   * → the latest person subject with an `assumed refer to`.
   */
  resolveLatePronouns() {
    const people = [...new Set(this.people.filter(Boolean))];
    if (!people.length || this.ambiguous) { this.resolveLateIt(); return; }
    const subjects = [...new Set(this.subjectPeople)];
    const chosen = people.length === 1 ? people[0] : subjects.at(-1) ?? people.at(-1);
    const found = [];
    for (const w of this.wires.filter(x => x.type !== 'assumed')) for (const roles of [w.roles, ...(w.blocks ?? []).map(b => b.roles)]) for (const r of roles ?? []) if (typeof r.value === 'string' && /^(he|she|him|her)$/i.test(r.value)) found.push(r);
    for (const r of found) { if (people.length > 1) this.assume(r.value, chosen); r.value = chosen; }
    // v1.4 (R9b): a late "it" with exactly one non-person antecedent.
    const things = [...new Set(this.things)];
    if (things.length === 1) for (const w of this.wires.filter(x => x.type !== 'assumed')) for (const roles of [w.roles, ...(w.blocks ?? []).map(b => b.roles)]) for (const r of roles ?? []) if (r.value === 'it') r.value = things[0];
  }

  resolveLateIt() {
    const things = [...new Set(this.things)];
    if (things.length === 1) for (const w of this.wires.filter(x => x.type !== 'assumed')) for (const roles of [w.roles, ...(w.blocks ?? []).map(b => b.roles)]) for (const r of roles ?? []) if (r.value === 'it') r.value = things[0];
  }

  wire(id) { return this.wires.find(w => w.id === id); }

  // ---------------------------------------------------------------- sentences and clause types

  /** Marks multi-word question phrases ("how many times", "de câte ori", "cât timp") on the words that spell them. */
  markPhrases(S) {
    S.phraseHeads = new Map();
    const words = S.words.filter(w => w.upos !== 'PUNCT');
    for (let i = 0; i < words.length; i++) for (const [phrase, kind] of WH_PHRASES) {
      const parts = phrase.split(' ');
      if (parts.every((p, j) => words[i + j]?.folded === p)) {
        const phrase = words.slice(i, i + parts.length);
        for (const w of phrase) Object.assign(w, {whPhrase: kind, used: true});
        // The clause the phrase asks about: climb from the phrase's external head to a clausal head.
        const ids = new Set(phrase.map(w => w.id));
        let head = S.byId.get(phrase.find(w => !ids.has(w.head))?.head);
        while (head && !isClausal(head) && head.head) head = S.byId.get(head.head);
        if (head) S.phraseHeads.set(head.id, kind);
        // v1.3: the words of a matched phrase are not matched again by a shorter phrase ("until what date" → not "what date").
        i += parts.length - 1;
        break;
      }
    }
  }

  sentence(S) {
    const content = S.words.filter(w => w.upos !== 'PUNCT' && !/^[\p{P}\p{S}\s]+$/u.test(w.text));
    if (!content.length) return;
    if (content.every(w => SMALL_TALK.has(w.folded) || SMALL_TALK.has(w.lemmaFolded) || w.upos === 'INTJ')) { this.smallTalk++; return; }
    // v1.4 (R13b): a short thanks ("thx bro u saved me") is small talk.
    if (content.length <= 6 && content.some(w => THANKS.has(w.folded)) && !S.words.some(w => w.text.includes('?'))) { this.smallTalk++; return; }
    if (this.offeredAnswer(S, content)) return;
    this.markPhrases(S);
    const endsWithQuestion = S.words.some(w => w.text.includes('?'));
    const heads = this.clauseHeads(S);
    const own = new Set(heads.filter(h => this.questionMarked(h, S)).map(h => h.id));
    if (endsWithQuestion && !own.size) own.add(S.root.id);
    const before = this.wires.length;
    this.clause(S.root, S, {as: own.has(S.root.id) ? 'query' : 'stated', certainty: 'asserted', speaker: null, questions: own});
    // Every wire remembers where its sentence starts (labelled simple-text lines are applied by position).
    for (const w of this.wires.slice(before)) w.pos ??= Math.min(S.start, ...S.words.filter(x => x.upos !== 'PUNCT').map(x => x.start));
  }

  /**
   * v1.4 (R12, C6): an offered answer right after a wh-question ("Where does Lukas live? In Bistrița, I think?",
   * "Who trains CS Brașov? Petru, right?") turns that question into a yes/no query on the offered value.
   */
  offeredAnswer(S, content) {
    const last = this.wires.at(-1);
    if (!last || last.type !== 'query' || last.select?.length !== 1 || last.mode || last.measure || last.blocks.length !== 1) return false;
    const variable = last.select[0];
    const role = last.blocks[0].roles.find(r => r.value === variable);
    if (!role || role.name === 'time') return false;
    const tail = new Set(['i', 'think', 'guess', 'believe', 'maybe', 'perhaps', 'probably', 'right', 'no', 'or', 'cred', 'poate', 'nu', 'banuiesc']);
    const words = content.filter(w => !tail.has(w.folded));
    if (!words.length || content.length > 8 || words.some(w => ['or', 'sau', 'ori'].includes(w.folded)) || words.some(w => ['VERB', 'AUX'].includes(w.upos) || WH[w.folded]) || content.some(w => ['VERB', 'AUX'].includes(w.upos) && !['think', 'guess', 'believe', 'crede', 'banui'].includes(w.lemmaFolded))) return false;
    const valueWords = words.filter(w => !(w.upos === 'ADP' && w === words[0]));
    const value = spanText(this.message, valueWords);
    if (!value || !valueWords.some(w => ['PROPN', 'NOUN', 'NUM'].includes(w.upos))) return false;
    role.value = trimStop(value);
    last.select = [];
    last.excepts = [];
    last.placeholders = (last.placeholders ?? []).filter(v => v !== variable);
    return true;
  }

  /** Heads of the independent clauses of a sentence: the root, its clausal conjuncts and parataxis. */
  clauseHeads(S) {
    const out = [S.root];
    for (let i = 0; i < out.length; i++) for (const k of kids(out[i], 'conj', 'parataxis')) if (isClausal(k)) out.push(k);
    return out;
  }

  /** A clause that shows its own question form: a clause-initial question word or English subject-auxiliary inversion. */
  questionMarked(h, S) {
    const own = subtree(h, k => CLAUSE_EDGE.includes(k.deprel) || CLAUSE_EDGE.includes(base(k.deprel))).filter(w => w.upos !== 'PUNCT').sort((a, b) => a.id - b.id);
    if (own.some(w => w.whPhrase)) return true;
    const lead = own.filter(w => !['cc', 'discourse', 'vocative', 'mark', 'intj'].includes(base(w.deprel)) && w.upos !== 'INTJ');
    const first = lead[0];
    if (!first) return false;
    const sentenceHasQuestionMark = /\?/.test(this.message.slice(first.start, S.end + 1));
    if (WH[first.folded] && !(first.upos === 'SCONJ' && !['when', 'where', 'how', 'why'].includes(first.folded))) {
      if (['care', 'ce', 'cand', 'cind', 'cum'].includes(first.folded)) return sentenceHasQuestionMark || first.feats?.PronType === 'Int';
      return true;
    }
    if (S.language === 'en' && first.upos === 'AUX' && (first.head === h.id || first.id === h.id)) {
      const subject = kids(h, 'nsubj', 'nsubj:pass', 'expl')[0];
      if (!subject || subject.id > first.id) return true;
    }
    const det = lead.slice(0, 3).find(w => ['which', 'what', 'ce', 'care', 'cati', 'cate', 'how'].includes(w.folded));
    return Boolean(det && sentenceHasQuestionMark);
  }

  /** The clausal complement a wrapper introduces: {clause, wh} (the question word it hangs on, if any). */
  complement(h, noun = false) {
    for (const label of ['ccomp', 'csubj', 'xcomp', 'advcl', 'acl', 'acl:relcl', 'dep', 'parataxis', 'conj']) {
      // v1.3: an adverbial clause with a causal, concessive or temporal connective ("Since P, is it the case that Q?")
      // is never the wrapped question.
      const found = kids(h, label).find(k => isClausal(k) && !(label === 'advcl' && CONNECTIVES[markText(k)] && !/^(if|whether|daca|de)$/.test(markText(k)) && !kids(k, 'advmod').some(a => WH[a.folded]) && !subtree(k).some(w => w.whPhrase)) && (label !== 'advcl' || noun || /^(if|whether|daca|de)$/.test(markText(k)) || kids(k, 'advmod').some(a => WH[a.folded])) && (label !== 'conj' || !kids(k, 'nsubj').length) && (label !== 'parataxis' || noun));
      if (found) return {clause: found, wh: null};
    }
    // "explain why P" parsed with "why" as the object and P hanging on it.
    for (const k of kids(h, 'obj', 'obl', 'advmod')) if (WH[k.folded] || k.whPhrase) {
      const inner = k.kids.find(c => isClausal(c) && c.upos !== 'PUNCT');
      if (inner) return {clause: inner, wh: k.whPhrase ?? WH[k.folded], word: k};
    }
    return null;
  }

  subjectOf(h) { return kids(h, 'nsubj', 'nsubj:pass')[0] ?? null; }
  /** Does a complement clause open with a question word, a question phrase or if/whether/dacă? */
  opensQuestion(c) {
    const first = subtree(c, k => ['parataxis', 'discourse', 'vocative', 'punct'].includes(base(k.deprel))).filter(w => w.upos !== 'PUNCT' && w.upos !== 'INTJ').sort((a, b) => a.id - b.id)[0];
    return Boolean(first && (WH[first.folded] || first.whPhrase || /^(if|whether|daca)$/.test(first.folded)));
  }
  /**
   * A remark about the user's own plans, purpose or situation (C4): a first-person (or "my X") subject with a
   * progressive, future or intention predicate ("I am planning the trip", "I have to answer", "we have a meeting").
   */
  isRemark(h, p) {
    // v1.3 (C4): a statement about the user, the listener or a dummy "it/this/that" whose sentence names no entity
    // ("I have a quick question", "It has been a hectic week", "This is mostly for my own notes") is chit-chat.
    const subj = p.roles.find(r => r.name === 'subject');
    const S = this.sentences[h.sentence];
    const named = S && S.words.some(w => w.upos === 'PROPN' || (w.ner && w.ner !== 'O' && !/DATE|TIME|CARDINAL|ORDINAL/.test(w.ner)));
    if (!named && this.language !== 'ro' && (!subj || /^(the user|the user's .*|we|you|u|it|this|that|there|they)$/i.test(String(subj.value)))) return true;
    if (/^(ask|tell|want|need|intreba|cere|spune|vrea)/.test(fold(p.relation)) && p.roles.some(r => r.name !== 'subject' && r.value === 'the user')) return true;
    const subject = p.roles.find(r => r.name === 'subject') ?? (h.feats?.Person === '1' && !this.subjectOf(h) ? {value: 'the user'} : null);
    if (!subject || !(subject.value === 'the user' || /^the user's /.test(subject.value) || /^(we|noi)$/i.test(subject.value))) return false;
    const progressive = kids(h, 'aux').some(a => ['am', "'m", 'are', "'re", 'is'].includes(a.folded)) && h.feats?.VerbForm === 'Part' && h.feats?.Tense === 'Pres';
    const intention = /^(have to|need|want|plan|avea nevoie|try|going|will|would like|hope|intend|prepare|organize|organise|avea de|trebui|vrea|dori|planifica|incerca|pregati|organiza)/.test(fold(p.relation));
    const future = kids(h, 'aux').some(a => ['will', "'ll", 'o', 'voi', 'vom'].includes(a.folded));
    const meeting = /^(have|avea)$/.test(fold(p.relation)) && /^(we|noi)$/i.test(subject.value);
    if (h.feats?.Person === '1' && !this.subjectOf(h) && h.feats?.Tense === 'Pres' && (this.sentences[h.sentence]?.language ?? this.language) !== 'en') return true;
    return progressive || intention || future || meeting;
  }
  isFirstPerson(w) { return Boolean(w) && (FIRST_PERSON.has(w.folded) || w.folded === 'we' || w.folded === 'noi'); }
  isSecondPerson(w) { return Boolean(w) && SECOND_PERSON.has(w.folded); }
  imperative(h) {
    if (h.feats?.Mood === 'Imp') return true;
    if (this.subjectOf(h) || h.upos !== 'VERB') return false;
    // v1.4: a finite third-person or past verb is never an imperative; a conjunct is one only if its head is.
    if (this.sentences[h.sentence]?.language !== 'ro' && (h.feats?.Person === '3' || h.feats?.Tense === 'Past' || h.feats?.VerbForm === 'Part' || h.feats?.VerbForm === 'Ger')) return false;
    if (base(h.deprel) === 'conj' && h.head) { const head = this.sentences[h.sentence]?.byId.get(h.head); if (head && !this.imperative(head)) return false; }
    const lead = subtree(h).filter(w => w.upos !== 'PUNCT' && !['discourse', 'cc', 'vocative', 'advmod', 'intj'].includes(base(w.deprel)) && !w.used).sort((a, b) => a.id - b.id)[0];
    return lead === h || (lead && kids(h, 'aux').includes(lead) && ['do', 'please'].includes(lead.folded));
  }

  /**
   * One clause and its dependants. `ctx` = {as: 'stated'|'query', certainty, speaker, questions, inherit?, wh?}.
   * Returns the id of the clause's main wire, or null when nothing was formalized.
   */
  clause(h, S, ctx) {
    const lemma = h.lemmaFolded;
    const subject = this.subjectOf(h);
    const ideaObject = ['have', 'avea'].includes(lemma) ? kids(h, 'obj').find(o => EMBED_WRAPPER_NOUNS.has(o.lemmaFolded) || EMBED_WRAPPER_NOUNS.has(o.folded)) : null;
    const wrapperNoun = EMBED_WRAPPER_NOUNS.has(lemma) || EMBED_WRAPPER_NOUNS.has(h.folded) || Boolean(ideaObject);
    let inner = this.complement(h, wrapperNoun) ?? (ideaObject ? this.complement(ideaObject, true) : null);
    // v1.4 (R13, C8): action requests in question form ("can you write …", "could you draft …"), "help me write …"
    // and a conjoined "… and draft a reminder" with the listener as subject ask nothing checkable.
    const inherited = ctx.inherit?.word ?? ctx.inherit;
    const listener = this.isSecondPerson(subject) || (!subject && inherited?.folded && this.isSecondPerson(inherited));
    const politeModal = kids(h, 'aux').some(a => ['can', 'could', 'would', 'will', 'ca', 'wo'].includes(a.folded));
    const helpAction = ['help', 'ajuta'].includes(lemma) && kids(h, 'xcomp', 'ccomp').some(k => ACTION_REQUESTS.has(k.lemmaFolded));
    const bareConjunct = !subject && h.feats?.VerbForm === 'Inf' && base(h.deprel) === 'conj' && !kids(h, 'aux', 'mark').length;
    if (S.language !== 'ro' && ((ACTION_REQUESTS.has(lemma) && ctx.as === 'query' && ((listener && (politeModal || inherited)) || bareConjunct)) || (helpAction && (this.imperative(h) || listener)))) {
      this.actionRequests++;
      for (const k of kids(h, 'xcomp', 'ccomp')) k.used = true;
      this.siblings(h, S, ctx, null, kids(h, 'xcomp', 'ccomp'));
      return null;
    }
    // "I'm trying to find out who …", "vreau să aflu dacă …": the wrapper verb sits in a subjectless complement.
    // v1.4: "vreau să știu cine …", "I want to know who …": the desire verb is not the wrapper; its complement is.
    // v2.0: "Let's say P" / "Let's assume P" supposes P: a stated wire with certainty supposed, never a wrapped question.
    if (lemma === 'let' && S.language !== 'ro' && ctx.as !== 'query') {
      const say = kids(h, 'xcomp').find(k => ['say', 'suppose', 'assume', 'imagine', 'pretend'].includes(k.lemmaFolded));
      const said = say && kids(say, 'ccomp').find(k => isClausal(k));
      if (said) {
        for (const w of [h, say, ...kids(h, 'obj')]) w.used = true;
        const main = this.clause(said, S, {...ctx, as: 'stated', certainty: 'supposed'});
        this.siblings(h, S, ctx, main, [say]);
        return main;
      }
    }
    let embedVerb = EMBED_QUESTION.has(lemma) && !(['vrea', 'dori', 'want', 'like', 'interesa', 'curious'].includes(lemma) && inner && EMBED_QUESTION.has(inner.clause.lemmaFolded)) ? h : null;
    for (let x = h, depth = 0; !embedVerb && depth < 3; depth++) {
      x = kids(x, 'xcomp', 'ccomp').find(k => k.upos === 'VERB' && !this.subjectOf(k));
      if (!x) break;
      const c = this.complement(x);
      if (EMBED_QUESTION.has(x.lemmaFolded) && c && this.opensQuestion(c.clause)) { embedVerb = x; inner = c; x.used = true; }
    }
    if (inner) {
      // v1.4: a Romanian first-person verb without a subject ("Mă întreb dacă P") is the user asking.
      // A subjectless "(I was) wondering whether P", "checking if P" is the user asking too.
      const firstPerson = this.isFirstPerson(subject) || (!subject && (h.feats?.Person === '1' || (['Part', 'Ger'].includes(h.feats?.VerbForm) && this.opensQuestion(inner.clause))));
      const wrapperVerb = Boolean(embedVerb) && (ctx.as === 'query' || this.imperative(h) || this.isSecondPerson(subject) || (firstPerson && (this.opensQuestion(inner.clause) || ['wonder', 'intreba'].includes(embedVerb.lemmaFolded))))
        && (!subject || this.isSecondPerson(subject) || this.isFirstPerson(subject));
      const done = [inner.clause];
      // Question and request wrappers (C6): "do you know if P", "check whether P", "tell me who …", "any idea where …".
      if (wrapperVerb || (wrapperNoun && (ctx.as === 'query' || !subject))) {
        if (inner.word) inner.word.used = true;
        const excepts = kids(h, 'obl', 'advmod').filter(k => EXCEPT_PREPS.has(caseText(k)) || (k.whPhrase === undefined && EXCEPT_PREPS.has(fold(spanText(this.message, caseWords(k).length ? caseWords(k) : [])))));
        for (const k of excepts) k.used = true;
        // v1.3: "Not counting X, find out who …", "apart from X, …" on the wrapper.
        for (const k of kids(h, 'advcl', 'advmod')) {
          if (k === inner.clause || k.used) continue;
          if (['count', 'include'].includes(k.lemmaFolded) && kids(k, 'advmod').some(a => NEGATIONS.has(a.folded)) && kids(k, 'obj').length) { excepts.push(kids(k, 'obj')[0]); for (const w of subtree(k)) if (w !== kids(k, 'obj')[0]) w.used = true; }
          else if (['apart', 'aside'].includes(k.folded) && kids(k, 'obl').length) { excepts.push(kids(k, 'obl')[0]); k.used = true; }
        }
        const main = this.clause(inner.clause, S, {...ctx, as: 'query', embedded: true, certainty: 'asserted', wh: inner.wh ?? ctx.wh, excepts: excepts.map(k => this.value(k, S, ctx).value)});
        // v1.3: an adverbial clause on the wrapper ("Since P, do you know if Q?") is a statement linked to the query.
        const wrapperClauses = kids(h, 'advcl').filter(k => k !== inner.clause && !k.used && isClausal(k) && (markText(k) || (['da', 'give'].includes(k.lemmaFolded) && kids(k, 'ccomp').length)));
        if (main && wrapperClauses.length) this.dependants({leftovers: [], complements: [], subordinate: wrapperClauses, relatives: []}, S, {...ctx, as: 'stated'}, main, this.wire(main));
        this.siblings(h, S, ctx, main, [...done, ...wrapperClauses]);
        return main;
      }
      // Reported speech and belief (C10): "Ion says that P", "I think P", "cred că P", "suppose P".
      if (SAY.has(lemma) && subject && !this.isSecondPerson(subject) && ctx.as !== 'query') {
        const speaker = this.isFirstPerson(subject) ? null : this.value(subject, S, ctx).value;
        // v2.0: "Priya says she plans …": the speaker is the antecedent of a pronoun in the reported clause.
        if (speaker && subject.upos === 'PROPN' && S.language !== 'ro' && kids(inner.clause, 'nsubj', 'nsubj:pass').some(k => k.upos === 'PRON' && THIRD_PERSON.has(k.folded))) { this.people.push(speaker); this.subjectPeople.push(speaker); }
        const main = this.clause(inner.clause, S, {...ctx, as: 'stated', speaker: speaker ?? ctx.speaker, certainty: THINK.has(lemma) ? 'hedged' : ctx.certainty});
        this.siblings(h, S, ctx, main, done);
        return main;
      }
      if (THINK.has(lemma) && !(SUPPOSE.has(lemma) && !subject)) {
        const own = this.isFirstPerson(subject) || !subject || this.isSecondPerson(subject);
        const main = this.clause(inner.clause, S, ctx.as === 'query' ? {...ctx} : {...ctx, as: 'stated', certainty: 'hedged', speaker: own ? ctx.speaker : this.value(subject, S, ctx).value});
        this.siblings(h, S, ctx, main, done);
        return main;
      }
      if (SUPPOSE.has(lemma) && (!subject || this.isFirstPerson(subject))) {
        const main = this.clause(inner.clause, S, {...ctx, as: 'stated', certainty: 'supposed'});
        this.siblings(h, S, ctx, main, done);
        return main;
      }
    }
    // v1.4 (C10): "I'm not (100%) sure, but P" hedges P and is itself a remark; "I'm not sure whether P" asks P.
    if (['sure', 'certain', 'positive', 'sigur'].includes(lemma) && (this.isFirstPerson(subject) || (!subject && h.feats?.Person === '1')) && ctx.as !== 'query' && (kids(h, 'advmod').some(a => NEGATIONS.has(a.folded)) || kids(h, 'aux').some(a => NEGATIONS.has(a.folded)))) {
      let main = null;
      const asked = kids(h, 'ccomp', 'advcl').find(k => isClausal(k) && /^(if|whether|daca)$/.test(markText(k)));
      if (asked) main = this.clause(asked, S, {...ctx, as: 'query', certainty: 'asserted', inherit: undefined});
      for (const k of [...kids(h, 'conj'), ...kids(h, 'parataxis'), ...kids(h, 'ccomp')].filter(k => k !== asked && isClausal(k))) main = this.clause(k, S, {...ctx, as: ctx.questions?.has(k.id) ? 'query' : 'stated', certainty: 'hedged', inherit: undefined}) ?? main;
      for (const w of subtree(h, k => isClausal(k) && k !== h)) w.used = true;
      return main;
    }
    // The user's own asking ("I'm asking because P", "întreb pentru că P") is a remark (C4): its reason is stated.
    if (['ask', 'intreba'].includes(lemma) && (this.isFirstPerson(subject) || !subject) && ctx.as !== 'query') {
      let main = null;
      for (const k of kids(h, 'advcl', 'ccomp')) main = this.clause(k, S, {...ctx, as: 'stated', certainty: 'asserted'}) ?? main;
      this.siblings(h, S, ctx, main, kids(h, 'advcl', 'ccomp'));
      return main;
    }
    // A pure action request with no question (C8): "write a poem", "traduce textul".
    if (ctx.as !== 'query' && (ACTION_REQUESTS.has(lemma) || (S.language !== 'ro' && !subject && h.upos === 'VERB' && this.imperative(h) && !kids(h, 'aux').length)) && (this.imperative(h) || this.isSecondPerson(subject))) {
      this.actionRequests++;
      this.siblings(h, S, ctx, null, []);
      return null;
    }
    const main = ctx.as === 'query' ? this.query(h, S, ctx) : this.statement(h, S, ctx);
    this.siblings(h, S, ctx, main, []);
    return main;
  }

  /** Clausal conjuncts and parataxis of `h` (C5 coordination of clauses, "so" results). */
  siblings(h, S, ctx, mainId, done) {
    for (const k of [...kids(h, 'conj'), ...kids(h, 'parataxis')]) {
      if (done.includes(k) || k.absorbed || !isClausal(k)) continue;
      const own = ctx.questions?.has(k.id);
      const as = own ? 'query' : base(k.deprel) === 'conj' && ctx.as === 'query' && !this.subjectOf(k) ? 'query' : base(k.deprel) === 'parataxis' && ctx.questions?.size ? 'stated' : ctx.as;
      const inherit = !this.subjectOf(k) && base(k.deprel) === 'conj' ? (this.subjectOf(h) ?? ctx.inherit ?? null) : null;
      const id = this.clause(k, S, {...ctx, as, inherit: inherit ?? undefined, wh: undefined, certainty: as === 'query' ? 'asserted' : ctx.certainty});
      const before = fold(this.message.slice(Math.max(0, Math.min(...subtree(k).map(w => w.start)) - 14), Math.min(...subtree(k).map(w => w.start)))).split(/[,;\s]+/).filter(Boolean);
      const result = [...kids(k, 'advmod', 'mark', 'cc')].some(a => RESULT_ADVERBS.has(a.folded)) || RESULT_ADVERBS.has(before.slice(-1).join(' ')) || RESULT_ADVERBS.has(before.slice(-2).join(' '));
      if (result && id && mainId) {
        const wire = this.wire(id), cause = this.wire(mainId);
        if (wire && cause && wire.links && ['stated', 'assumed'].includes(cause.type) && wire.links.length < 3) wire.links.push(['so', mainId]);
      }
    }
  }

  // ---------------------------------------------------------------- propositions

  /**
   * The proposition of the clause headed by `h`: {relation, roles: [{name, value, word}], polarity, times,
   * subordinate, complements, relatives, leftovers, hedged, heads, coord, whAdverbs, universal, compare, rank, except}.
   * Values are verbatim spans; `query` (a QueryBuilder) enables question words and variables.
   */
  proposition(h, S, ctx, query = null) {
    const en = S.language !== 'ro';
    const p = {relation: '', roles: [], polarity: 'affirmed', times: [], subordinate: [], complements: [], relatives: [], leftovers: [], hedged: false, heads: [h], coord: null, whAdverbs: [], universal: null, phrase: null, aspect: null, compares: [], rank: null, excepts: []};
    const be = en ? 'be' : 'fi';
    const cop = kids(h, 'cop')[0];
    // v1.4: a Romanian reflexive passive ("se eliberează la X") is the reflexive verb ("se elibera la"), not "fi …".
    const reflexivePassive = !en && kids(h, 'expl:pass', 'expl:pv').some(k => /^(se|s)-?$/.test(k.folded)) && !kids(h, 'aux:pass').length;
    // v2.0: a reduced relative participle ("a firm based in X") is a passive.
    const passive = !reflexivePassive && (kids(h, 'aux:pass').length > 0 || (kids(h, 'nsubj:pass').length > 0 && h.upos === 'VERB') || (en && h.deprel === 'acl' && h.xpos === 'VBN' && h.upos === 'VERB' && !kids(h, 'aux', 'nsubj').length));
    const modal = en ? kids(h, 'aux').filter(a => MODALS.has(a.lemmaFolded) || MODALS.has(a.folded)).map(a => a.folded.replace("n't", '').replace(/^ca$/, 'can').replace(/^wo$/, 'will').replace(/^sha$/, 'shall')) : [];
    const parts = [...modal];
    let prepInRelation = null;
    this.comparisons(h, p, S, query);
    // Dates the parser attached anywhere in the clause ("din 01.06.2018 până pe 01.02.2020" as nummod): times.
    for (const w of subtree(h, k => CLAUSE_EDGE.includes(k.deprel) && k !== h)) {
      if (w === h || w.used || !/^(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})$/.test(w.text)) continue;
      if (['obl', 'obl:tmod', 'nmod:tmod'].includes(w.deprel)) continue;
      this.addTime(p, w, S, caseText(w));
      for (const c of [w, ...caseWords(w)]) c.used = true;
    }
    const than = en && query && cop && h.upos === 'ADJ' && h.feats?.Degree === 'Cmp' ? kids(h, 'obl', 'advcl').find(k => caseText(k) === 'than' || markText(k) === 'than') : null;
    if (cop && query && ['NOUN', 'PRON'].includes(h.upos) && (INDEFINITE.has(h.folded) || kids(h, 'det').some(d => INDEFINITE_DET.has(d.folded))) && kids(h, 'acl', 'acl:relcl').some(isClausal)) {
      p.existential = true;
      parts.push(be);
      const variable = query.variable('x');
      h.used = true;
      p.roles.push({name: 'subject', value: variable, word: h});
      for (const r of kids(h, 'acl', 'acl:relcl').filter(isClausal)) p.relatives.push({noun: h, clause: r, variable, role: 'subject'});
    } else if (cop && (this.whWord(h) || h.whPhrase) && ['ADV', 'PRON'].includes(h.upos)) {
      // "Where is X?", "Until when was X on Y?": the question word heads the clause.
      parts.push(be);
      if (h.whPhrase) p.phrase = h.whPhrase; else if (['where', 'when', 'how', 'why'].includes(WH[h.folded])) p.whAdverbs.push(h);
      else if (query) { const v = query.variable('x'); query.selectVar(v); p.roles.push({name: 'object', value: v}); }
    } else if (than) {
      // "Is Pablo older than Tamás?" → two value blocks and `compare ?a above ?b` (Q-LANG-1).
      const a = query.variable('a'), b = query.variable('b');
      parts.push(be, h.lemma.toLowerCase());
      p.roles.push({name: 'object', value: a});
      p.comparative = {other: this.value(than, S, ctx).value, a, b, op: /^(less|young|small|short|cheap|low|few)/.test(h.lemmaFolded) || kids(h, 'advmod').some(x => x.folded === 'less') ? 'below' : 'above'};
      than.used = true;
    } else if (cop) {
      if (['ADJ', 'VERB'].includes(h.upos) || (h.upos === 'ADV' && !caseWords(h).length)) {
        parts.push(be, en ? h.text.toLowerCase() : masculine(h));
        // "how old is X", "cât de mare e X": the asked value of an adjective predicate (Q-LANG-1).
        const how = kids(h, 'advmod').find(a => ['how', 'cat', 'cit'].includes(a.folded));
        if (how && query) { how.used = true; const v = query.variable(/^(old|batran|vechi)$/.test(h.folded) ? 'age' : 'v'); query.selectVar(v); p.roles.push({name: 'object', value: v}); }
        if (p.compareVar) p.roles.push({name: 'object', value: p.compareVar});
      } else {
        const marker = caseText(h);
        const nmod = kids(h, 'nmod').find(n => (caseText(n) || (!en && (/Gen|Dat/.test(n.feats?.Case ?? '') || kids(n, 'det').some(d => ['lui', 'al', 'a', 'ai', 'ale'].includes(d.folded))))) && !kids(n, 'nmod:poss').length && !n.used);
        const markerNmod = marker && h.upos === 'NOUN' && kids(h, 'det').some(d => ['the', 'a', 'an'].includes(d.folded)) ? kids(h, 'nmod').find(n => caseText(n) && !n.used && !this.isTime(n, caseText(n))) : null;
        if (markerNmod) {
          // v1.3: "is on the payroll of X" → relation "be on the payroll of", object X (like "be the trainer of").
          const skipped = new Set(caseWords(h).map(w => w.id));
          const head = spanText(this.message, subtree(h, k => k === markerNmod || skipped.has(k.id) || k.used || ['nsubj', 'nsubj:pass', 'cop', 'punct', 'aux', 'mark', 'cc', 'conj', 'advcl', 'acl:relcl', 'parataxis', 'csubj', 'discourse', 'advmod', 'obl', 'expl', 'acl'].includes(base(k.deprel)) || k.deprel === 'acl:relcl'));
          const caseOf = caseText(markerNmod);
          parts.push(be, marker, head.toLowerCase(), caseOf);
          prepInRelation = caseOf;
          for (const c of caseWords(h)) c.used = true;
          this.addArgument(p, markerNmod, S, ctx, query, this.prepRole(caseOf, markerNmod, S, [be]), {skipCase: true});
          markerNmod.used = true;
        } else if (marker && en && h.upos === 'NOUN' && IDIOM_NOUNS.test(h.folded) && !kids(h, 'det', 'nmod:poss', 'amod', 'nummod', 'compound', 'nmod').length) {
          // v1.4 (R6b): a copula + preposition + determinerless idiom noun is the relation ("be out of service", "be in stock").
          parts.push(be, marker, h.folded);
          prepInRelation = marker;
          for (const c of caseWords(h)) c.used = true;
          h.used = true;
        } else if (marker) {
          parts.push(be, marker);
          prepInRelation = marker;
          p.headIsValue = true;
          this.addArgument(p, h, S, ctx, query, this.prepRole(marker, h, S, [be]), {skipCase: true});
        } else if (nmod && !this.whWord(h)) {
          // v1.4: dependents of the noun after its nmod ("head of accounts payable for the Cluj office") stay in the value.
          const trailing = en ? h.kids.filter(k => k.id > nmod.id && !k.used && ['amod', 'nmod', 'acl', 'appos'].includes(base(k.deprel)) && k.deprel !== 'acl:relcl') : [];
          const head = spanText(this.message, subtree(h, k => k === nmod || trailing.includes(k) || k.used || ['nsubj', 'nsubj:pass', 'cop', 'aux', 'mark', 'cc', 'conj', 'advcl', 'acl:relcl', 'parataxis', 'csubj', 'discourse', 'advmod', 'obl', 'expl'].includes(base(k.deprel)) || (base(k.deprel) === 'punct' && k.text !== '-') || k.deprel === 'acl:relcl'));
          const caseOf = caseText(nmod);
          // v1.4: the Romanian genitive article "lui" stays in the relation ("fi părintele lui" + "Ion", DS021 C1).
          const genitive = kids(nmod, 'det').find(d => d.folded === 'lui' && d.id < nmod.id);
          for (const d of kids(nmod, 'det')) if (['lui', 'al', 'a', 'ai', 'ale'].includes(d.folded)) d.used = true;
          if (!en && genitive && !caseOf) { parts.push(be, head.toLowerCase(), 'lui'); } else parts.push(be, en ? head.replace(/\s*-\s*/g, '-').replace(/^(the|a|an)\s+/i, m => m.toLowerCase()) : head.toLowerCase(), caseOf);
          p.headInRelation = true;
          const before = p.roles.length;
          this.addArgument(p, nmod, S, ctx, query, this.prepRole(caseOf, nmod, S, [be]), {skipCase: true});
          nmod.used = true;
          const added = p.roles[before];
          if (added && trailing.length && !isVariable(added.value)) {
            const end = Math.max(...trailing.flatMap(k => subtree(k)).map(w => w.end));
            const from = this.message.indexOf(added.value, nmod.start - 1);
            if (from >= 0 && end > from) { added.value = trimStop(this.message.slice(from, end).replace(/\s+/g, ' ').trim()); for (const w of trailing.flatMap(k => subtree(k))) w.used = true; }
          }
        } else if (query && ['something', 'ceva'].includes(h.folded) && kids(h, 'amod').length) {
          // "Who is old something?" (simple text): the adjective is the relation, "something" the asked value.
          const adj = kids(h, 'amod')[0];
          adj.used = true;
          parts.push(be, adj.text.toLowerCase());
          const v = query.variable('v');
          query.placeholders.push(v);
          h.used = true;
          p.roles.push({name: 'object', value: v, word: h});
        } else {
          parts.push(be);
          p.nominalPredicate = true;
          this.addArgument(p, h, S, ctx, query, 'object', {predicate: true});
        }
      }
    } else if (passive) {
      parts.push(be, en ? h.text.toLowerCase() : masculine(h));
    } else if (EXISTENTIAL.has(h.lemmaFolded) || (h.lemmaFolded === 'be' && kids(h, 'expl').some(e => e.folded === 'there'))) {
      p.existential = true;
      parts.push(h.lemma.toLowerCase());
    } else {
      const reflexive = !en && kids(h, 'expl:pv', 'expl', 'expl:impers', 'expl:pass').some(k => /^(se|s|si|isi)-?$/.test(k.folded));
      if (reflexive) parts.push('se');
      parts.push(h.lemma.toLowerCase());
      for (const prt of kids(h, 'compound:prt')) { parts.push(prt.folded); prt.used = true; }
      // v1.4: a fixed noun of a verb idiom ("are loc la" → "avea loc la").
      for (const f of kids(h, 'fixed').filter(f => f.upos === 'NOUN' && f.id === h.id + 1)) { parts.push(f.folded); f.used = true; }
      for (const adv of kids(h, 'advmod')) if (en && PARTICLES.has(adv.folded) && adv.id === h.id + 1) { parts.push(adv.folded); adv.used = true; }
    }
    // Merge a subjectless verbal complement: "plan to study", "start living", "poate să semneze" → "putea semna".
    let head = h;
    for (let depth = 0; depth < 3 && !cop; depth++) {
      const lifted = !en && ['putea', 'trebui'].includes(head.lemmaFolded) && !this.subjectOf(head);
      const x = kids(head, 'xcomp', 'ccomp').find(k => ['VERB', 'AUX'].includes(k.upos) && !kids(k, 'cop').length && (!this.subjectOf(k) || lifted) && !k.used && (base(k.deprel) === 'xcomp' || (MERGE_VERBS.has(head.lemmaFolded) && /^(sa|to|s)$/.test(markText(k)))));
      if (!x) break;
      // "When did X start/stop V": since when / until when of V (the aspect verb is not part of the relation).
      if (START_VERBS.has(head.lemmaFolded) || STOP_VERBS.has(head.lemmaFolded)) {
        p.aspect = START_VERBS.has(head.lemmaFolded) ? 'start' : 'end';
        parts.splice(parts.indexOf(head.lemma.toLowerCase()), 1);
      } else if (en && markText(x) === 'to') parts.push('to');
      if (!en && kids(x, 'expl:pv').length) parts.push('se');
      parts.push(x.lemma.toLowerCase());
      for (const prt of kids(x, 'compound:prt')) { parts.push(prt.folded); prt.used = true; }
      p.heads.push(x);
      x.merged = true;
      head = x;
    }
    // v2.0: a resultative adjective joins the relation: "make X sick", "get sick from".
    if (en && !cop && ['make', 'get', 'become', 'turn', 'render', 'drive'].includes(head.lemmaFolded)) {
      const result = kids(head, 'xcomp').find(k => k.upos === 'ADJ' && !k.used && !kids(k, 'cop', 'nsubj').length && k.kids.every(c => ['advmod', 'punct'].includes(base(c.deprel))));
      if (result) { parts.push(result.folded); result.used = true; }
    }
    // A bare-noun object of a light verb joins the relation: "take part in", "have access to", "lua parte la".
    const bare = p.heads.flatMap(hd => kids(hd, 'obj')).find(o => o.upos === 'NOUN' && !o.kids.some(c => ['det', 'nmod:poss', 'det:poss', 'nummod', 'amod', 'acl', 'acl:relcl', 'conj', 'compound', 'nmod'].includes(c.deprel)) && p.heads.some(hd => kids(hd, 'obl').some(o2 => caseText(o2))) && !whIn(o, S));
    // v1.4 (R6): any verb's determinerless, lower-case object noun joins the relation when a non-time oblique follows
    // ("attend classes at X", "switch ISPs to X"); a capitalized noun is a title, never a light noun (R11c).
    const lightVerb = ['take', 'have', 'pay', 'make', 'lua', 'avea', 'face', 'give', 'keep'].includes(p.heads[0].lemmaFolded);
    const generalBare = bare && en && !/^\p{Lu}/u.test(bare.text) && p.heads.some(hd => kids(hd, 'obl').some(o2 => caseText(o2) && o2.id > bare.id && !this.isTime(o2, caseText(o2)) && !EXCEPT_PREPS.has(caseText(o2))));
    if (bare && (lightVerb || generalBare) && !/^\p{Lu}/u.test(bare.text)) { parts.push(bare.folded); bare.used = true; p.lightNoun = true; }
    // A bare object noun with its own prepositional complement joins the relation: "give classes in X", "ține ore de X".
    // v1.4: after a light verb an indefinite noun counts too ("have an allergy to X", "have a job at X").
    const lightHead = en && ['have', 'get', 'take', 'give', 'make', 'pay', 'keep', 'do'].includes(p.heads[0].lemmaFolded);
    const onlyIndefinite = o => lightHead && kids(o, 'det').length === 1 && ['a', 'an'].includes(kids(o, 'det')[0].folded) && !o.kids.some(c => ['nmod:poss', 'det:poss', 'nummod', 'amod', 'compound'].includes(c.deprel));
    const nounPrep = !bare ? p.heads.flatMap(hd => kids(hd, 'obj')).find(o => o.upos === 'NOUN' && !o.used && (en ? !/^\p{Lu}/u.test(o.text) : o.feats?.Definite !== 'Def') && (!o.kids.some(c => ['det', 'nmod:poss', 'det:poss', 'nummod', 'amod'].includes(c.deprel)) || onlyIndefinite(o)) && kids(o, 'nmod').some(n => caseText(n) && !n.used && !this.isTime(n, caseText(n))) && !whIn(o, S)) : null;
    // "has a job at X" with the place attached to the verb: the same relation.
    const lightObl = !bare && !nounPrep && lightHead ? p.heads.flatMap(hd => kids(hd, 'obj')).find(o => o.upos === 'NOUN' && !o.used && onlyIndefinite(o) && !kids(o, 'nmod', 'acl', 'acl:relcl').length && !whIn(o, S)) : null;
    const lightPlace = lightObl ? kids(p.heads[0], 'obl').find(o => caseText(o) && o.id > lightObl.id && !this.isTime(o, caseText(o)) && !EXCEPT_PREPS.has(caseText(o))) : null;
    if (lightObl && lightPlace) {
      const prep = caseText(lightPlace);
      parts.push(kids(lightObl, 'det')[0].folded, lightObl.folded, prep);
      for (const w of [lightObl, ...kids(lightObl, 'det')]) w.used = true;
      prepInRelation = prep;
      this.addArgument(p, lightPlace, S, ctx, query, 'object', {skipCase: true});
      lightPlace.used = true;
    }
    if (nounPrep && (!p.heads.flatMap(hd => kids(hd, 'obl')).some(o => caseText(o)) || onlyIndefinite(nounPrep))) {
      const n = kids(nounPrep, 'nmod').find(x => caseText(x) && !x.used && !this.isTime(x, caseText(x)));
      const prep = caseText(n);
      if (onlyIndefinite(nounPrep)) { parts.push(kids(nounPrep, 'det')[0].folded); kids(nounPrep, 'det')[0].used = true; }
      parts.push(nounPrep.folded, prep);
      nounPrep.used = true;
      prepInRelation = prep;
      this.addArgument(p, n, S, ctx, query, 'object', {skipCase: true});
      n.used = true;
    }
    // Fixed verb + noun idioms ("take place", "avea loc", "lua parte", "face parte").
    const idiom = !bare && p.heads.flatMap(hd => kids(hd, 'obj', 'nsubj')).find(o => /^(place|loc|parte)$/.test(o.folded) && !o.kids.some(c => ['det', 'amod', 'nmod'].includes(base(c.deprel))) && /^(take|avea|lua|face)$/.test(p.heads[0].lemmaFolded));
    if (idiom) { parts.push(idiom.folded); idiom.used = true; p.lightNoun = true; }
    // Romanian "face naveta", "da examen": an undetermined object noun of a light verb completes the relation.
    const roBare = !en && !bare && !idiom && /^(face|da|lua|tine|avea)$/.test(p.heads[0].lemmaFolded) ? kids(p.heads[0], 'obj').find(o => o.upos === 'NOUN' && !o.kids.length) : null;
    if (roBare) { parts.push(roBare.folded); roBare.used = true; }
    // Arguments of every merged head.
    const obliques = [];
    for (const hd of p.heads) for (const k of hd.kids) {
      if (k.whPhrase) { p.phrase = k.whPhrase; continue; }
      if (k.merged || k.used) continue;
      const label = k.deprel, b = base(label);
      // The modifiers of a nominal predicate ("the oldest person working at X") are part of its value.
      if ((p.nominalPredicate || ((p.headIsValue || p.headInRelation) && ['compound', 'flat', 'fixed', 'amod', 'det', 'nummod', 'appos', 'punct'].includes(b))) && hd === h && ['det', 'amod', 'nmod', 'acl', 'compound', 'nummod', 'flat', 'fixed', 'case', 'nmod:poss', 'det:poss', 'appos'].includes(label === 'acl:relcl' ? 'relcl' : b)) continue;
      if (!en && ['obj', 'iobj', 'expl', 'expl:pv'].includes(label) && k.upos === 'PRON' && RO_CLITICS.has(k.folded.replace(/-$/, '').replace(/^-/, ''))) continue;
      if (label === 'nsubj' || label === 'nsubj:pass' || (b === 'csubj' && !isClausal(k))) {
        const taken = p.roles.some(r => r.name === 'subject') || kids(hd, 'nsubj', 'nsubj:pass').some(o => o !== k && o.id < k.id);
        this.addArgument(p, k, S, ctx, query, taken && !p.roles.some(r => r.name === 'object') ? 'object' : 'subject', {skipCase: true});
        continue;
      }
      if (b === 'expl') continue;
      if (b === 'csubj' || label === 'ccomp' || (b === 'xcomp' && isClausal(k))) { p.complements.push(k); continue; }
      // v1.3: a fronted question word with a stranded preposition ("who does X report to?") is an oblique.
      if (b === 'obj' && query && this.whWord(k) && caseWords(k).some(c => c.id > hd.id)) { obliques.push(k); continue; }
      if (b === 'obj') {
        const visited = /^(visit|vizita)$/.test(hd.lemmaFolded) && (/GPE|LOC|FAC/.test(subtree(k).map(w => w.ner ?? '').join(' ')) || (!en && k.upos === 'PROPN') || (en && k.upos === 'PROPN' && k.ner === 'S-ORG' && !k.kids.some(c => ['flat', 'compound'].includes(c.deprel))));
        this.addArgument(p, k, S, ctx, query, visited ? 'destination' : p.roles.some(r => r.name === 'object') && !p.roles.some(r => r.name === 'subject') && k.id < h.id ? 'subject' : 'object', {skipCase: true});
        continue;
      }
      if (b === 'iobj') { this.addArgument(p, k, S, ctx, query, 'recipient'); continue; }
      if (label === 'obl:agent') { if (en && !parts.includes('by')) parts.push('by'); prepInRelation ??= 'by'; this.addArgument(p, k, S, ctx, query, 'object', {skipCase: true}); continue; }
      if (b === 'obl' || (b === 'nmod' && hd === h && !cop) || label === 'nmod:tmod' || (b === 'xcomp' && !isClausal(k))) { obliques.push(k); continue; }
      if (b === 'advmod' || b === 'neg' || (b === 'det' && NEGATIONS.has(k.folded) && hd.upos === 'VERB')) { this.adverb(p, k, S, ctx, query); continue; }
      if (b === 'advcl') {
        // v1.3: "Not counting X, who …" → except.
        if (query && ['count', 'include'].includes(k.lemmaFolded) && kids(k, 'advmod').some(a => NEGATIONS.has(a.folded)) && kids(k, 'obj').length) { p.excepts.push(this.value(kids(k, 'obj')[0], S, ctx).value); for (const w of subtree(k)) w.used = true; continue; }
        p.subordinate.push(k); continue;
      }
      if (b === 'acl') { if (isClausal(k)) p.subordinate.push(k); continue; }
      if (b === 'aux' && (NEGATIONS.has(k.folded) || k.feats?.Polarity === 'Neg')) { p.polarity = 'negated'; continue; }
      if (['aux', 'cop', 'mark', 'punct', 'cc', 'case', 'discourse', 'vocative', 'fixed', 'flat', 'det', 'conj', 'parataxis', 'goeswith', 'clf'].includes(b)) continue;
      if (b === 'compound' && label === 'compound:prt') continue;
      p.leftovers.push([k, b === 'compound' ? 'relation' : 'other']);
    }
    // A stranded preposition ("When does X open at?", "Where did Y move from?") belongs to the relation.
    for (const hd of p.heads) for (const k of hd.kids) if (!k.used && (k.upos === 'ADP' || (k.upos === 'ADV' && STRANDABLE.has(k.folded) && !kids(hd, 'obl').some(o => o.id > k.id))) && !k.kids.length && ['obl', 'obj', 'compound:prt', 'case', 'advmod', 'dep'].includes(k.deprel) && k.id > hd.id && (!['from', 'to'].includes(k.folded) || (k.folded === 'to' && query && !GIVE_VERBS.has(hd.lemmaFolded) && !MOTION_VERBS.test(hd.lemmaFolded)))) { parts.push(k.folded); k.used = true; prepInRelation ??= k.folded; }
    // Obliques: time, "besides X", then the relation's preposition from the first argument, then the others.
    obliques.sort((a, b) => a.id - b.id);
    for (const k of obliques) {
      if (k.used) continue;
      const prep = caseText(k);
      // v1.4 (R6c): "go on a trip to X" → relation "go on a trip to", the place as destination.
      if (en && prep === 'on' && prepInRelation === null && /^(trip|visit|journey|tour|flight|holiday|vacation|cruise|excursion)$/.test(k.lemmaFolded) && kids(k, 'det').some(d => ['a', 'an'].includes(d.folded))) {
        const to = kids(k, 'nmod').find(n => caseText(n) === 'to') ?? obliques.find(o => !o.used && o !== k && caseText(o) === 'to');
        if (to) {
          parts.push('on', kids(k, 'det')[0].folded, k.folded, 'to');
          prepInRelation = 'to';
          for (const w of [k, ...kids(k, 'det'), ...caseWords(k)]) w.used = true;
          this.addArgument(p, to, S, ctx, query, this.prepRole('to', to, S, ['go']), {skipCase: true});
          to.used = true;
          continue;
        }
      }
      // v1.4 (R14): "without NP" has no role; it joins the relation ("give without a second checker").
      if (prep === 'without' && en) { const text = spanText(this.message, subtree(k).filter(w => !w.used)); (p.tail ??= []).push(text); for (const w of subtree(k)) w.used = true; continue; }
      // v1.3: "According to X, P" → P with speaker X (C10).
      if (prep === 'according to' && !query) { p.speaker = this.value(k, S, ctx).value; for (const w of subtree(k)) w.used = true; if (k.upos === 'PROPN') { this.people.push(p.speaker); this.subjectPeople.push(p.speaker); } continue; }
      if (this.isTime(k, prep)) { this.addTime(p, k, S, prep); continue; }
      if (EXCEPT_PREPS.has(prep) && query) { p.excepts.push(this.value(k, S, ctx).value); continue; }
      // v1.3 (C9): a place phrase right after a definite argument belongs to that value ("the vineyard near Sibiu").
      if (VALUE_PREPS.has(prep) && this.mergeIntoValue(p, k, S)) continue;
      if (!en && prep === 'pe' && !p.roles.some(r => r.name === 'object')) { this.addArgument(p, k, S, ctx, query, 'object', {skipCase: true}); continue; }
      if (prep && prepInRelation === null && k.upos === 'NOUN' && !k.kids.some(c => !['case', 'punct'].includes(c.deprel)) && (en ? (['to', 'at', 'from'].includes(prep) && /^(work|school|church|bed|college|class|home|university|lunch|dinner)$/.test(k.folded)) || IDIOM_NOUNS.test(k.folded) : ['la', 'de la'].includes(prep) && k.feats?.Definite === 'Ind')) {
        parts.push(prep, k.folded); prepInRelation = prep; k.used = true; continue;
      }
      // v1.4 (C2): the by-agent of a passive is the object ("be repaired by").
      let role = passive && prep === 'by' ? 'object' : p.lightNoun && prepInRelation === null && prep ? 'object' : this.prepRole(prep, k, S, parts);
      // v1.6 (R1): an oblique that cannot take the object slot is still a role. A common-noun place has no NER,
      // so `prepRole` fell back to `object` and the phrase was dropped whenever the clause already had an object
      // ("keeps the record at reception"); it is the location. A time phrase is the time, "for" + duration a time,
      // "for" + person the recipient.
      if (role === 'object' && p.roles.some(r => r.name === 'object')) {
        const argumentNer = [...chain(k), ...kids(k, 'det', 'amod')].map(w => w.ner ?? 'O').join(' ');
        if (TIME_PREPS[prep] || TIME_WORDS.has(fold(k.text))) role = 'time';
        else if (PLACE_PREPS.has(prep)) role = 'location';
        else if (prep === 'for' && (FOR_DURATION.has(fold(k.text)) || subtree(k).some(w => w.upos === 'NUM'))) role = 'time';
        else if (prep === 'for' && /PERSON|ORG|NORP/.test(argumentNer)) role = 'recipient';
      }
      // v2.0: the roles of "send X to Y" (recipient) and of "move from X to Y" (source, destination) carry the preposition.
      const carried = en && ((role === 'recipient' && prep === 'to') || (['source', 'destination'].includes(role) && /^(move|relocate|emigrate)$/.test(p.heads[0].lemmaFolded)));
      if (prep && prepInRelation === null && (role !== 'topic' || (en && prep === 'because of')) && !p.existential) {
        prepInRelation = prep;
        if (!carried) parts.push(prep);
      }
      this.addArgument(p, k, S, ctx, query, role, {skipCase: true});
    }
    if (!p.roles.some(r => r.name === 'subject')) {
      const subSubject = !en ? p.heads.flatMap(hd => kids(hd, 'advcl')).flatMap(k => [...subtree(k)]).find(w => ['nsubj', 'nsubj:pass'].includes(w.deprel) && w.upos === 'PROPN') : null;
      const inherited = ctx.inherit ?? (!en && !this.imperative(h) && !p.existential && h.feats?.Person !== '1' && h.feats?.Person !== '2' ? (subSubject ? {value: this.value(subSubject, S, ctx).value} : this.lastSubject) : null);
      if (inherited && !isVariable(inherited.value ?? '')) {
        // v1.4: a conjunct inherits its head's subject word ("Ana works at Acme and lives in Cluj").
        if (inherited.word) this.addArgument(p, inherited.word, S, ctx, query, 'subject'); else if (inherited.value) p.roles.unshift({name: 'subject', value: inherited.value}); else if (inherited.upos) { this.addArgument(p, inherited, S, ctx, query, 'subject'); const r = p.roles.find(x => x.name === 'subject'); if (r) { p.roles.splice(p.roles.indexOf(r), 1); p.roles.unshift(r); } }
      }
    }
    if (query) for (let i = p.leftovers.length - 1; i >= 0; i--) {
      const [k] = p.leftovers[i];
      const slot = subtree(k).find(w => ['something', 'ceva'].includes(w.folded) && !w.used);
      const role = ['object', 'topic'].find(r => !p.roles.some(x => x.name === r));
      if (!slot || !role || subtree(k).some(w => w !== slot && !w.used && w.upos !== 'PUNCT' && !['det', 'case'].includes(w.deprel) && w !== k)) continue;
      const v = query.variable('v');
      query.placeholders.push(v);
      p.roles.push({name: role, value: v, word: k});
      for (const w of subtree(k)) w.used = true;
      p.leftovers.splice(i, 1);
    }
    if (h.feats?.Polarity === 'Neg' && !['SCONJ', 'CCONJ'].includes(h.upos)) p.polarity = 'negated';
    // v1.4 (R8, DS021 "unclear"): "All the X are not Y" has two readings (no X is Y / not every X is Y): ambiguous.
    const quantSubject = kids(h, 'nsubj', 'nsubj:pass')[0];
    if (en && quantSubject && p.polarity === 'negated' && !p.notAll && !this.scopeAmbiguity && [quantSubject, ...kids(quantSubject, 'det', 'det:predet')].some(w => ['all', 'every', 'each', 'everyone', 'everybody'].includes(w.folded)) && kids(h, 'advmod', 'aux', 'aux:pass').some(a => ['not', "n't"].includes(a.folded) && a.id > quantSubject.id)) {
      const np = spanText(this.message, subtree(quantSubject).filter(w => !['all', 'every', 'each', 'the'].includes(w.folded) || w.id > quantSubject.id));
      const pred = spanText(this.message, subtree(h, k => k === quantSubject || ['punct', 'parataxis', 'conj', 'advcl', 'cc'].includes(base(k.deprel)) || (['not', "n't"].includes(k.folded))).filter(w => w.id > quantSubject.id));
      if (np && pred) this.scopeAmbiguity = [`no ${np} ${pred}`.replace(/\s+/g, ' '), `not all ${np} ${pred}`.replace(/\s+/g, ' ')];
    }
    // v1.4 (R9c): a "person" after for/on/at/in is usually an organization the tagger misread ("plays for Rapid Suceava").
    for (const r of p.roles) if (r.name !== 'subject' && r.word && en && /PERSON/.test(chain(r.word).map(w => w.ner ?? '').join(' ')) && !isVariable(r.value) && !['for', 'on', 'at', 'in'].includes(caseText(r.word))) { this.people.push(r.value); this.objectPeople.push(r.value); }
    // v1.3: a word never repeats back to back in a relation ("show up up", "find out out").
    p.relation = [...parts, ...(p.tail ?? [])].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().split(' ').filter((w, i, all) => w !== all[i - 1]).join(' ');
    const subjectRole = p.roles.find(r => r.name === 'subject');
    if (subjectRole && !isVariable(subjectRole.value)) {
      this.lastSubject = {value: subjectRole.value, word: subjectRole.word};
      // v1.4 (R9c): a proper-name subject is a person unless its entity type says otherwise ("Chloé" untagged).
      const subjectNer = chain(subjectRole.word ?? {kids: []}).map(w => w.ner ?? '').join(' ');
      // v2.0: the accurate NER tags many first names ORG ("Alina", "Constantin"): a single capitalized word that is
      // the whole subject is a person for "he"/"she" (and still a possible thing for "it") unless it is a place.
      const loneName = en && subjectRole.word?.upos === 'PROPN' && !subjectRole.word.kids.some(c => ['flat', 'compound', 'nmod', 'det'].includes(base(c.deprel))) && /^S-(ORG|PERSON)$/.test(subjectRole.word.ner ?? '') && /^\p{Lu}\p{Ll}+$/u.test(subjectRole.value);
      if (subjectRole.word?.upos === 'PROPN' && !(en && subjectRole.word.kids.some(c => c.deprel === 'det' && c.folded === 'the')) && (!en || /PERSON/.test(subjectNer) || loneName || !/ORG|GPE|FAC|LOC|PRODUCT|NORP|EVENT|WORK_OF_ART|DATE|TIME/.test(subjectNer))) { this.people.push(subjectRole.value); this.subjectPeople.push(subjectRole.value); }
      // v1.4 (R9b): a non-person subject ("the Brașov Tax Office", an organization) is an antecedent for "it".
      else if (en && subjectRole.word && (/ORG|FAC|PRODUCT|GPE|WORK_OF_ART|EVENT/.test(subjectNer) || /^the \p{Lu}/u.test(subjectRole.value) || (subjectRole.word.upos === 'NOUN' && subjectRole.word.kids.some(c => c.deprel === 'det' && c.folded === 'the')))) this.things.push(subjectRole.value);
    }
    return p;
  }

  /** "over 40", "peste 40", "more than 8": a comparison of the clause's value (Q-LANG-1); the words are consumed. */
  comparisons(h, p, S, query) {
    if (!query) return;
    const own = subtree(h, k => CLAUSE_EDGE.includes(k.deprel) && k !== h).filter(w => w.upos !== 'PUNCT').sort((a, b) => a.id - b.id);
    for (let i = 0; i < own.length; i++) for (const [phrase, word] of COMPARATORS) {
      const parts = phrase.split(' ');
      if (!parts.every((x, j) => own[i + j]?.folded === x)) continue;
      const number = own[i + parts.length];
      if (!number || !/^\d+$/.test(number.text)) continue;
      const v = query.variable(/(old|years|ani|varsta)/.test(own.slice(i, i + parts.length + 3).map(w => w.folded).join(' ')) || /^(old|batran)$/.test(h.folded) ? 'age' : 'v');
      p.compares.push([v, word, number.text]);
      p.compareVar = v;
      for (const w of own.slice(i, i + parts.length + 1)) w.used = true;
      const unit = own[i + parts.length + 1];
      if (unit && /^(years?|ani|an|old)$/.test(unit.folded)) unit.used = true;
      if (own[i + parts.length + 2]?.folded === 'old') own[i + parts.length + 2].used = true;
      return;
    }
  }

  isTime(k, prep) {
    const words = subtree(k, c => ['acl:relcl', 'acl', 'advcl'].includes(c.deprel) || c.used);
    // v1.3: a DATE label on a compound or adjective modifier of a non-time noun ("the spring book fair") is not a time.
    if (words.some(w => /DATE|TIME/.test(w.ner ?? '') && !(w !== k && ['compound', 'amod'].includes(w.deprel) && !/DATE|TIME/.test(k.ner ?? '') && !TIME_WORDS.has(k.lemmaFolded)))) return true;
    if (k.deprel === 'obl:tmod' || k.deprel === 'nmod:tmod') return true;
    if ((TIME_WORDS.has(k.lemmaFolded) || TIME_WORDS.has(k.folded)) && (k.upos !== 'PROPN' || /DATE|TIME/.test(k.ner ?? ''))) return true;
    const text = words.map(w => w.text).join(' ');
    if (DATE.test(text) && words.length <= 5) return true;
    // v1.4 (R11a): a day or month with a number ("în ziua de 1 decembrie 2021", "on the 13th of May 2020") is a time.
    if (words.some(w => MONTH_WORDS.has(w.folded)) && words.some(w => /^\d{1,4}(st|nd|rd|th)?$/.test(w.text)) && words.length <= 8) return true;
    return Boolean(TIME_PREPS[prep]) && words.some(w => /^\d/.test(w.text) || (TIME_WORDS.has(w.folded) && w.upos !== 'PROPN'));
  }

  /**
   * v1.4 (R3, R4): a block restricting a question variable by the noun's case-marked modifier: `class` gives
   * "be an employee in" ?x "the Iasi office" (the counted class), `place` gives "be in" ?c "Timișoara".
   */
  modifierBlock(p, k, variable, S, ctx, kind) {
    const n = kids(k, 'nmod').find(x => caseText(x) && !x.used && !this.isTime(x, caseText(x)) && !kids(x, 'acl:relcl').length);
    if (!n) return;
    const prep = caseText(n);
    const place = /GPE|LOC/.test(subtree(n).map(w => w.ner ?? '').join(' '));
    if (kind === 'place' && !(place && ['in', 'at', 'near', 'from'].includes(prep))) return;
    const value = this.value(n, S, ctx).value;
    if (!value) return;
    for (const w of [...subtree(n), ...caseWords(n)]) w.used = true;
    const noun = k.lemma.toLowerCase();
    const relation = kind === 'place' ? 'be ' + prep : 'be ' + (/^[aeiou]/.test(noun) ? 'an ' : 'a ') + noun + ' ' + prep;
    (p.extraBlocks ??= []).push({relation, roles: [{name: 'subject', value: variable}, {name: place && prep !== 'from' ? 'location' : this.prepRole(prep, n, S, ['be']), value}], polarity: 'affirmed'});
  }

  /** v1.3 (C9): appends phrase `k` to the definite argument that ends right before it; true when merged. */
  mergeIntoValue(p, k, S) {
    const start = Math.min(...subtree(k).map(w => w.start));
    const r = p.roles.find(x => x.word && !isVariable(x.value) && typeof x.value === 'string' && x.value !== 'the user' && (/^the\s/i.test(x.value) || x.word.upos === 'PROPN')
      && Math.max(...subtree(x.word, c => c.used && c !== x.word).map(w => w.end)) <= start && !this.whWord(k)
      && /^\s*$/.test(this.message.slice(Math.max(...subtree(x.word, c => c.used && c !== x.word).map(w => w.end)), start)));
    if (!r) return false;
    const end = Math.max(...subtree(k).map(w => w.end));
    const from = this.message.indexOf(r.value, Math.min(...subtree(r.word).map(w => w.start)) - 1);
    if (from < 0) return false;
    r.value = this.message.slice(from, end).replace(/\s+/g, ' ').trim();
    for (const w of subtree(k)) w.used = true;
    return true;
  }

  addTime(p, k, S, prep) {
    const cases = new Set(caseWords(k).map(w => w.id));
    const words = subtree(k, c => cases.has(c.id) || ['acl:relcl', 'advcl', 'punct'].includes(c.deprel));
    // v1.4: "the day of X", "ziua de X" is X.
    const text = spanText(this.message, words).replace(/^(?:(?:în|in)\s+)?(?:ziua|data) de\s+/iu, '').replace(/^the day of\s+/i, '');
    if (!text) return;
    // v2.0: a vague time ("a while ago", "these days", "lately") states no period and is dropped.
    if (/^(?:a while ago|a while back|these days|nowadays|lately|recently|at the moment|right now|for now|currently|not long ago)$/iu.test(text)) { for (const w of [...words, ...caseWords(k)]) w.used = true; return; }
    // v2.0: "between X and Y" is a period: valid from X, valid until Y.
    const second = prep === 'between' ? kids(k, 'conj')[0] : null;
    if (second) {
      const skipSecond = subtree(second);
      const first = spanText(this.message, words.filter(w => !skipSecond.includes(w) && w.upos !== 'CCONJ'));
      const last = spanText(this.message, subtree(second, c => ['punct'].includes(c.deprel)).filter(w => w.deprel !== 'cc' && w.id > k.id));
      for (const w of subtree(second)) w.used = true;
      if (first && last) {
        p.times.push({form: 'from', prep: 'from', text: first, words: [...words.filter(w => !skipSecond.includes(w)), ...caseWords(k)]});
        p.times.push({form: 'until', prep: 'until', text: last, words: skipSecond});
        return;
      }
    }
    p.times.push({form: TIME_PREPS[prep] ?? 'on', prep, text, words: [...words, ...caseWords(k)]});
  }

  /** Role of an oblique argument from its preposition class and entity type (C3). */
  prepRole(prep, k, S, relationParts = []) {
    // v1.4: the entity type of the argument's own name chain, not of its modifiers ("a company in Timișoara").
    const ner = [...chain(k), ...kids(k, 'det', 'amod')].map(w => w.ner ?? 'O').join(' ');
    // v1.4: the verb is the relation's motion or giving verb when one occurs ("move from … to"), else its last word.
    const verb = fold(relationParts.filter(Boolean).find(x => MOTION_VERBS.test(fold(x)) || GIVE_VERBS.has(fold(x))) ?? relationParts.filter(Boolean).at(-1) ?? '');
    const role = PREP_ROLE[prep] ?? PREP_ROLE[prep.split(' ').at(-1)];
    if (role === 'recipient') return /PERSON|ORG|NORP/.test(ner) || k.upos === 'PRON' ? 'recipient' : 'topic';
    if (role === 'destination' && GIVE_VERBS.has(verb)) return 'recipient';
    if (role === 'instrument' && (/PERSON|ORG/.test(ner) || (k.upos === 'PROPN' && S.language === 'ro'))) return 'object';
    if (role === 'source' && /^(de|din|de la)$/.test(prep) && S.language === 'ro' && !/^(muta|pleca|veni|sosi|intoarce|reveni|primi|cumpara|lua|imprumuta)/.test(verb)) return 'object';
    if (role) return role;
    // v1.4 (DS021 C3): a named organization, institution, venue or event after a motion verb's "to" is the object
    // ("go to Vlădescu Primary School", "go to the junior chess tournament"); a geographic place is the destination.
    // v2.0: "send X to Y", "give X to Y": the receiver is the recipient unless it is a geographic place.
    if (prep === 'to' && S.language !== 'ro' && GIVE_VERBS.has(verb) && !/GPE|LOC/.test(ner)) return 'recipient';
    if (MOTION_VERBS.test(verb) && prep === 'to' && S.language !== 'ro' && /ORG|FAC|EVENT|WORK_OF_ART|PERSON/.test(ner) && !/GPE|LOC/.test(ner)) return 'object';
    if (MOTION_VERBS.test(verb) && prep === 'to' && S.language !== 'ro' && !/GPE|LOC/.test(ner) && /\b(tournament|competition|contest|conference|festival|fair|concert|party|meeting|workshop|course|class|school|college|university|academy|seminar|ceremony|match|game|event|show|exhibition)\b/.test(fold(spanText(this.message, subtree(k))))) return 'object';
    if (MOTION_VERBS.test(verb) && ['la', 'in', 'spre', 'into', 'to'].includes(prep)) return 'destination';
    if (prep === 'to' && GIVE_VERBS.has(verb)) return 'recipient';
    const place = PLACE_PREPS.has(prep) || (S.language === 'ro' && ['in', 'la', 'pe', 'din'].includes(prep));
    if (place) {
      // v1.4 (DS021 C3): a named facility (school, arena, clinic) is an institution or venue, not a geographic place.
      // v2.0: the accurate tagger reads team and person names as places ("on Rapid Sighișoara", "under Larissa"): after a
      // preposition that does not locate a thing in a place (on, under, above, between) a name is the object.
      if (/GPE|LOC/.test(ner)) return S.language !== 'ro' && ['on', 'under', 'above', 'between'].includes(prep) && /GPE/.test(ner) ? 'object' : 'location';
      if (/FAC/.test(ner)) return 'object';
      if (/ORG|PERSON|WORK_OF_ART|EVENT|PRODUCT/.test(ner)) return 'object';
      return ['in', 'inside', 'near', 'langa', 'behind'].includes(prep) ? 'location' : 'object';
    }
    return 'object';
  }

  adverb(p, k, S, ctx, query) {
    const f = k.folded;
    if (k.used) return;
    if (k.whPhrase) { p.phrase = k.whPhrase; return; }
    // v1.3: a stranded preposition tagged ADV is left for the relation (see the stranded-preposition step).
    if (k.upos === 'ADV' && STRANDABLE.has(f) && !k.kids.length && k.id > k.head && query) return;
    // v1.3: "apart from X", "aside from X" in a question → except.
    if (['apart', 'aside'].includes(f) && query && kids(k, 'obl').length) { const o = kids(k, 'obl')[0]; p.excepts.push(this.value(o, S, ctx).value); for (const w of subtree(k)) w.used = true; return; }
    if (f === 'nu' && k.kids.some(c => c.folded === 'cumva') || (f === 'cumva' && p.polarity === 'negated')) return; // "nu cumva …?" asks, it does not negate
    if (NEGATIONS.has(f) || (k.feats?.Polarity === 'Neg' && !['SCONJ', 'CCONJ'].includes(k.upos)) || f === "n't") {
      const next = S.words.find(w => w.id === k.id + 1);
      if (f === 'nu' && next?.folded === 'cumva') return;
      if (next && UNIVERSAL.has(next.folded) && query) { p.notAll = true; return; }
      p.polarity = p.polarity === 'negated' && f === 'nu' ? 'negated' : 'negated';
      return;
    }
    if (WH[f] && ['where', 'when', 'why', 'how'].includes(WH[f])) { p.whAdverbs.push(k); return; }
    if (HEDGE_ADVERBS.has(f) && !(f === 'poate' && k.upos === 'VERB')) { p.hedged = true; return; }
    if (TIME_WORDS.has(f) || TIME_WORDS.has(k.lemmaFolded)) { this.addTime(p, k, S, ''); return; }
    if (UNIVERSAL.has(f) || NONE.has(f)) { p.floatingAll = k; return; }
    if (RANK_VALUES[f] && query) { p.rank = RANK_VALUES[f]; return; }
    // v1.4 (R14): a collective adverb and a locative adverb complement join the relation ("buy together", "stay home").
    if ((COLLECTIVE.has(f) && f !== 'both') || (/^(home|abroad|away|upstairs|downstairs|overseas|outside|indoors|back)$/.test(f) && k.id > k.head && !k.kids.length)) { (p.tail ??= []).push(f); k.used = true; return; }
    if (RESULT_ADVERBS.has(f) || FUNCTION_ADVERBS.has(f) || COLLECTIVE.has(f) || f === 'not') return;
    if (k.kids.some(c => c.deprel === 'fixed')) return;
    // v1.6 (R2): a post-verbal time adverb is the clause's time ("arrive early"), a manner adverb joins the
    // relation ("pack separately", "hold apart"); without this both fell into `leftovers` → unparsed, and no
    // faithful rewriting could avoid them. In a query the time adverb joins the relation (there is no time slot
    // left after the question word).
    if (k.id > k.head && TIME_ADVERBS.has(f)) {
      if (query) { (p.tail ??= []).push(f); k.used = true; } else this.addTime(p, k, S, '');
      return;
    }
    if (k.id > k.head && MANNER_ADVERBS.has(f)) { (p.tail ??= []).push(f); k.used = true; return; }
    p.leftovers.push([k, 'other']);
  }

  whWord(w) {
    if (!w) return null;
    const f = w.folded;
    if (!WH[f]) return null;
    if (this.sentences[w.sentence]?.language !== 'ro' && !EN_WH.has(f)) return null;
    if (w.feats?.PronType && !/Int|Rel/.test(w.feats.PronType) && !['who', 'what'].includes(f)) return null;
    return WH[f];
  }

  /**
   * Adds one argument: a verbatim value (first person → "the user"), or in a query a question variable, a
   * universal/indefinite variable or a relative-clause variable. Coordinated values are recorded for splitting.
   */
  addArgument(p, k, S, ctx, query, role, {skipCase = false, predicate = false} = {}) {
    if (k.used) return;
    if (p.roles.some(r => r.name === role) || p.roles.length >= 4) { p.leftovers.push([k, hintFor(role)]); return; }
    const det = kids(k, 'det', 'amod', 'advmod', 'nummod', 'nmod:poss').concat(k.kids.filter(c => c.whPhrase));
    // Superlative value: "costs the most", "costă cel mai mult" → rank over a value variable.
    const folded = fold(spanText(this.message, subtree(k)));
    if (query && RANK_VALUES[folded]) {
      const v = query.variable(/cost|pay|plati|costa/.test(p.heads.map(hd => hd.lemmaFolded).join(' ')) ? 'price' : 'v');
      p.rank = RANK_VALUES[folded]; p.rankVar = v;
      p.roles.push({name: role, value: v, word: k});
      return;
    }
    // Question word or "which/what N" determiner; "how many N" / "câți N".
    const whDet = det.map(d => this.whWord(d)).find(w => ['which', 'what', 'who'].includes(w));
    const wh = this.whWord(k) ?? (whDet ? 'which' : null);
    const howMany = det.some(d => (['many', 'much'].includes(d.folded) && kids(d, 'advmod').some(a => a.folded === 'how')) || ['cati', 'cate', 'cata', 'cat'].includes(d.folded) || d.whPhrase === 'how_many' || d.whPhrase === 'how_much') || (['cati', 'cate'].includes(k.folded));
    if (query && (wh || howMany)) {
      const name = role === 'location' ? 'place' : role === 'time' ? 't' : role === 'instrument' ? 'how' : ctx.meaning ? 'm' : 'x';
      const variable = query.variable(name);
      if (howMany) query.count(variable); else if (!predicate || wh) { if (whDet && query.select.length) query.multiSelect = true; query.selectVar(variable); }
      p.roles.push({name: role, value: variable, word: k});
      for (const r of kids(k, 'acl:relcl', 'acl').filter(isClausal)) p.relatives.push({noun: k, clause: r, variable, role});
      // v1.4 (R3, R4): "how many employees in the Iasi office", "which companies in Reșița": the noun's place or group
      // modifier restricts the variable in a block of its own.
      if (S.language !== 'ro' && k.upos === 'NOUN') this.modifierBlock(p, k, variable, S, ctx, howMany ? 'class' : 'place');
      return;
    }
    // v1.4 (R2b): "one of the parents of X" in a question is a variable ?m with a block "be a parent of" ?m X.
    if (query && S.language !== 'ro' && ['one', 'any', 'some', 'two'].includes(k.folded) && !kids(k, 'det').length) {
      const group = kids(k, 'nmod', 'obl').find(n => caseText(n) === 'of' && kids(n, 'det').some(d => d.folded === 'the'));
      const owner = group ? kids(group, 'nmod').find(n => caseText(n)) : null;
      if (group && owner && group.upos === 'NOUN') {
        const variable = query.variable('m');
        p.roles.push({name: role, value: variable, word: k});
        const noun = group.lemma.toLowerCase();
        const ownerValue = this.value(owner, S, ctx).value;
        const prep = caseText(owner);
        const ownerRole = this.prepRole(prep, owner, S, ['be']);
        for (const w of subtree(k)) w.used = true;
        (p.extraBlocks ??= []).push({relation: 'be ' + (/^[aeiou]/.test(noun) ? 'an ' : 'a ') + noun + ' ' + prep, roles: [{name: 'subject', value: variable}, {name: ownerRole, value: ownerValue}], polarity: 'affirmed'});
        return;
      }
    }
    // v1.4 (R4): an indefinite argument with a place modifier in a question ("works at a company in Timișoara").
    if (query && S.language !== 'ro' && k.upos === 'NOUN' && det.some(d => ['a', 'an', 'any', 'some'].includes(d.folded)) && !kids(k, 'acl:relcl', 'acl').some(isClausal) && ['object', 'location'].includes(role) && kids(k, 'nmod').some(n => ['in', 'at', 'near'].includes(caseText(n)) && /GPE|LOC/.test(subtree(n).map(w => w.ner ?? '').join(' ')))) {
      const variable = query.variable('c');
      p.roles.push({name: role === 'location' ? 'object' : role, value: variable, word: k});
      this.modifierBlock(p, k, variable, S, ctx, 'place');
      for (const w of subtree(k)) w.used = true;
      return;
    }
    // Universal and negative quantifiers on a question argument ("all players", "everyone", "nobody", "most X").
    const quantWord = [k, ...det].find(d => UNIVERSAL.has(d.folded) || NONE.has(d.folded) || QUANTIFIERS[d.folded]) ?? (p.floatingAll && role === 'subject' ? p.floatingAll : null);
    const atLeast = det.find(d => /^\d+$/.test(d.text) && d.kids.some(a => ['least', 'putin'].includes(a.folded) || kids(a, 'fixed').some(x => ['least', 'putin'].includes(x.folded))));
    if (query && (quantWord || atLeast) && (role === 'subject' || role === 'object') && !INDEFINITE.has(k.folded)) {
      const variable = query.variable('m');
      p.roles.push({name: role, value: variable, word: k});
      const negatedAll = p.notAll || (quantWord && quantWord.kids.some(c => NEGATIONS.has(c.folded))) || (quantWord && S.words.find(w => w.id === quantWord.id - 1 && NEGATIONS.has(w.folded)));
      if (negatedAll && quantWord) for (const w of S.words) if (w.id === quantWord.id - 1 || (w.head === quantWord.id && NEGATIONS.has(w.folded))) w.used = true;
      // v1.4 (Q-LANG-2): "none of the N" is `quantifier none` over an affirmed scope; "no N", "nobody" keep the negated scope.
      const noneOf = quantWord && ['none', 'niciunul', 'niciuna'].includes(quantWord.folded);
      const quantifier = atLeast ? 'at_least ' + atLeast.text : noneOf ? 'none' : QUANTIFIERS[quantWord.folded] ?? (NONE.has(quantWord.folded) ? null : negatedAll ? 'not_all' : null);
      p.universal = {word: k, quantifier: quantWord ?? atLeast, variable, none: Boolean(quantWord && NONE.has(quantWord.folded)) && !noneOf, role, words: quantifier};
      for (const r of kids(k, 'acl:relcl', 'acl')) if (isClausal(r)) p.relatives.push({noun: k, clause: r, variable, role, restriction: true});
      return;
    }
    // Indefinite ("anyone working at X", "vreun om care …") and relative clauses in a question: a shared variable (C9).
    const relatives = kids(k, 'acl:relcl', 'acl').filter(isClausal);
    const indefinite = INDEFINITE.has(k.folded) || det.some(d => INDEFINITE_DET.has(d.folded) && (relatives.length || p.existential));
    if (query && (indefinite || (relatives.length && !predicate))) {
      const variable = query.variable(indefinite ? 'x' : 'p');
      if (['something', 'ceva', 'anything'].includes(k.folded)) query.placeholders.push(variable);
      p.roles.push({name: role, value: variable, word: k});
      for (const r of relatives) p.relatives.push({noun: k, clause: r, variable, role});
      if (NONE.has(k.folded)) p.negatedExistence = true;
      if (!relatives.length && !indefinite) p.leftovers.push([k, hintFor(role)]);
      return;
    }
    // v1.4 (R11a): a date inside an argument's noun phrase is a time of the clause, never part of the value.
    if (!predicate) for (const n of [k, ...chain(k)].flatMap(x => kids(x, 'nmod', 'nmod:tmod', 'obl'))) if (!n.used && this.isTime(n, caseText(n)) && !/DATE|TIME/.test(k.ner ?? '')) { this.addTime(p, n, S, caseText(n)); for (const w of [...subtree(n), ...caseWords(n)]) w.used = true; }
    const value = this.value(k, S, ctx, {skipCase, predicate});
    if (!value.value) { p.leftovers.push([k, hintFor(role)]); return; }
    const conj = kids(k, 'conj').filter(c => ['NOUN', 'PROPN', 'PRON', 'NUM', 'ADJ'].includes(c.upos) && !c.used && !sameEntity(S, k, c));
    if (conj.length && !p.coord && !predicate) {
      const cc = kids(conj[0], 'cc')[0]?.folded ?? 'and';
      const options = [k, ...conj].map(w => this.value(w, S, ctx, {skipCase: true}).value).filter(Boolean);
      const collective = [...p.heads.flatMap(hd => kids(hd, 'advmod', 'obl')), ...subtree(k)].some(w => COLLECTIVE.has(w.folded));
      if (options.length > 1 && !collective) p.coord = {role, options, or: ['or', 'sau', 'ori', 'either'].includes(cc)};
      p.roles.push({name: role, value: collective ? value.full : value.value, word: k});
    } else p.roles.push({name: role, value: value.value, word: k});
    // A relative clause of a statement's argument becomes its own statement that repeats the noun (C9).
    for (const r of relatives) if (!query) p.relatives.push({noun: k, clause: r, value: value.value, role});
  }

  /** The verbatim value of an argument head: first person → "the user" / "the user's …" (Q-LANG-5). */
  value(k, S, ctx, {skipCase = true, predicate = false} = {}) {
    if (!k) return {value: ''};
    if (k.upos === 'PRON' && FIRST_PERSON.has(k.folded)) return {value: 'the user', full: 'the user', derived: true};
    const cases = new Set(caseWords(k).map(w => w.id));
    const skip = c => (skipCase && cases.has(c.id)) || c.used || (c.deprel === 'punct' && /[?!;]/.test(c.text)) || ['mark', 'acl:relcl', 'advcl', 'parataxis', 'cop', 'aux', 'aux:pass', 'nsubj', 'nsubj:pass', 'csubj', 'ccomp', 'discourse', 'vocative', 'dislocated', 'advcl:relcl'].includes(c.deprel)
      || (predicate && c.head === k.id && ['advmod', 'obl', 'expl'].includes(base(c.deprel))) || (['conj', 'cc'].includes(base(c.deprel)) && c.head === k.id && !(base(c.deprel) === 'conj' ? sameEntity(S, k, c) : c.text === '&' || kids(k, 'conj').some(x => x.id > c.id && sameEntity(S, k, x)))) || (base(c.deprel) === 'acl' && isClausal(c) && kids(c, 'nsubj').length > 0);
    const words = subtree(k, skip);
    const full = spanText(this.message, subtree(k, c => (skipCase && cases.has(c.id)) || ['acl:relcl', 'advcl', 'parataxis'].includes(c.deprel)));
    // English "my X" → "the user's X".
    const possessive = words.find(w => FIRST_POSSESSIVE.has(w.folded) && ['nmod:poss', 'det:poss', 'det'].includes(w.deprel) && w.head === k.id && S.language !== 'ro');
    if (possessive) {
      const rest = spanText(this.message, words.filter(w => w !== possessive));
      return {value: rest ? "the user's " + rest : 'the user', full, derived: true};
    }
    // v1.4 (R9b): "it" with exactly one earlier non-person subject resolves to it (never an expletive "it").
    if (k.upos === 'PRON' && k.folded === 'it' && ['nsubj', 'obj', 'nsubj:pass', 'obl'].includes(k.deprel) && !kids(this.sentences[k.sentence]?.byId.get(k.head) ?? {kids: []}, 'expl').length) {
      const things = [...new Set(this.things)];
      if (things.length === 1) return {value: things[0], full: things[0], resolved: true};
    }
    // A third-person pronoun with one earlier named person resolves to it (a single possible antecedent).
    if (k.upos === 'PRON' && THIRD_PERSON.has(k.folded) && ['nsubj', 'obj', 'iobj', 'obl', 'nsubj:pass'].includes(k.deprel)) {
      const people = [...new Set(this.people.filter(Boolean))];
      if (people.length === 1) return {value: people[0], full: people[0], resolved: true};
      if (people.length > 1) {
        // v1.3 (DS021 convention): the subject of the preceding asymmetric sentence; after two parallel clauses
        // (two person subjects, no person in another role) no reading is preferable: unclear ambiguous.
        const subjects = [...new Set(this.subjectPeople)];
        const pronounText = spanText(this.message, [k]);
        if (subjects.length >= 2 && !this.objectPeople.length && !this.ambiguous) this.ambiguous = {pronoun: pronounText, readings: subjects.slice(-2)};
        const chosen = subjects.at(-1) ?? people.at(-1);
        this.assume(spanText(this.message, [k]), chosen);
        return {value: chosen, full: chosen, resolved: true};
      }
    }
    return {value: trimStop(spanText(this.message, words)), full: trimStop(full)};
  }

  /** `assumed … relation "refer to" … basis disambiguation` for a pronoun read as the latest named person. */
  assume(pronoun, antecedent) {
    if (this.wires.some(w => w.type === 'assumed' && w.roles.some(r => r.name === 'subject' && r.value === pronoun))) return;
    this.wires.push({type: 'assumed', id: this.id('a'), relation: 'refer to', roles: [{name: 'subject', value: pronoun}, {name: 'object', value: antecedent}], polarity: 'affirmed', basis: 'disambiguation', links: []});
  }

  // ---------------------------------------------------------------- statements

  statement(h, S, ctx) {
    const p = this.proposition(h, S, ctx, null);
    if (ctx.certainty === 'asserted' && !ctx.speaker && !p.speaker && this.isRemark(h, p)) { this.notes.push('remark dropped: ' + p.relation); return null; }
    if (!p.relation || !p.roles.length) {
      const words = subtree(h, k => ['conj', 'parataxis', 'advcl', 'punct'].includes(base(k.deprel)) && k !== h);
      this.unparsed(words, null, p.roles.length ? 'relation' : 'other', 'no proposition');
      return null;
    }
    const certainty = ctx.certainty === 'asserted' && p.hedged ? 'hedged' : ctx.certainty;
    const variants = p.coord ? p.coord.options.map(option => p.roles.map(r => (r.name === p.coord.role ? {...r, value: option} : r))) : [p.roles];
    const ids = [];
    for (const roles of variants) {
      const wire = {type: 'stated', id: this.id('s'), relation: p.relation, roles: roles.map(({name, value}) => ({name, value})), polarity: p.polarity, certainty, speaker: ctx.speaker ?? p.speaker ?? null, valid: {}, links: []};
      for (const t of p.times) {
        const form = ['from', 'until'].includes(t.form) ? t.form : 'on';
        if (wire.valid[form] || (form === 'on' && (wire.valid.from || wire.valid.until)) || (form !== 'on' && wire.valid.on)) { t.extra = true; continue; }
        wire.valid[form] = t.text;
      }
      this.wires.push(wire);
      ids.push(wire.id);
    }
    const main = ids[0];
    for (const t of p.times) if (t.extra) this.unparsed(t.words, main, 'time', 'second time expression');
    this.dependants(p, S, ctx, main, null);
    return main;
  }

  /** Leftovers, complements, adverbial and relative clauses of a proposition; links go on wire `main`. */
  dependants(p, S, ctx, main, query) {
    for (const [k, hint] of p.leftovers) this.unparsed(subtree(k, c => ['punct'].includes(c.deprel) || c.used), main, hint, 'unmapped ' + k.deprel);
    for (const k of p.complements) {
      if (k.used || k.merged) continue;
      const sub = this.clause(k, S, {...ctx, as: 'stated', certainty: ctx.certainty === 'supposed' ? 'supposed' : 'asserted', inherit: undefined, wh: undefined});
      const w = this.wire(main);
      if (sub && w && this.wire(sub)?.type === 'stated') {
        const roles = query ? w.blocks[0].roles : w.roles;
        const free = ['object', 'topic'].find(name => !roles.some(r => r.name === name));
        if (free && !roles.some(r => String(r.value).startsWith('$')) && roles.length < 4) roles.push({name: free, value: '$' + sub});
      }
    }
    for (let k of p.subordinate) {
      if (base(k.deprel) === 'acl' || k.used || k.absorbed) continue;
      // "Dat fiind că P" / "given that P": the connective phrase heads the clause; P is its complement.
      let given = null;
      if (['da', 'give'].includes(k.lemmaFolded) && kids(k, 'ccomp').length && /^(dat fiind|given)/.test(fold(this.message.slice(Math.min(...subtree(k).map(w => w.start)), k.end + 8)))) { const inner = kids(k, 'ccomp')[0]; inner.connective = 'because'; given = k; k = inner; }
      const marker = [markText(k), ...kids(k, 'advmod').filter(a => ['when', 'while', 'once', 'cand', 'cind', 'whenever'].includes(a.folded)).map(a => a.folded)].filter(Boolean).join(' ').trim();
      const keyword = k.connective ?? CONNECTIVES[marker] ?? CONNECTIVES[marker.split(' ').slice(-2).join(' ')] ?? CONNECTIVES[marker.split(' ')[0]] ?? null;
      const certainty = ['if', 'unless', 'so_that'].includes(keyword) ? 'supposed' : (ctx.certainty === 'supposed' ? 'supposed' : 'asserted');
      const inherit = this.subjectOf(k) ? undefined : (keyword === 'so_that' || !marker || S.language === 'ro' ? p.roles.find(r => r.name === 'subject' && !isVariable(r.value)) : undefined);
      const sub = this.clause(k, S, {...ctx, as: 'stated', certainty, speaker: ctx.speaker, inherit: inherit ? {value: inherit.value, word: inherit.word} : undefined, wh: undefined});
      // v2.0: "Given that P; Q, …": the accurate parser makes Q a conjunct of "Given"; it is a premise like P.
      if (given) for (const c of kids(given, 'conj').filter(x => isClausal(x) && !x.used && !x.absorbed && this.subjectOf(x))) this.clause(c, S, {...ctx, as: 'stated', certainty, speaker: ctx.speaker, wh: undefined});
      const subWire = this.wire(sub);
      const w = this.wire(main);
      if (!subWire || !w || !['stated', 'assumed'].includes(subWire.type)) continue;
      if (keyword && (!['if', 'unless', 'so_that'].includes(keyword) || (subWire.type === 'stated' && subWire.certainty === 'supposed'))) {
        if (w.links.length < 3 && !w.links.some(([kw, t]) => kw === keyword && t === sub)) w.links.push([keyword, sub]);
      } else if (marker && !k.connective) this.unparsed(kids(k, 'mark'), sub, 'other', 'unknown connective ' + marker);
    }
    for (const rel of p.relatives) if (!query) this.relativeStatement(rel, S, ctx);
  }

  /** "The company that won the tender repaired it" → a second statement "the company" won "the tender" (C9). */
  relativeStatement(rel, S, ctx) {
    for (const r of [rel.clause, ...kids(rel.clause, 'conj').filter(c => isClausal(c) && !this.subjectOf(c))]) {
      const pronoun = r.kids.find(k => ['PRON', 'DET', 'ADV'].includes(k.upos) && (k.feats?.PronType === 'Rel' || RELATIVE_WORDS.has(k.folded)));
      r.absorbed = true;
      const p = this.proposition(r, S, {...ctx, inherit: undefined}, null);
      if (!p.relation) continue;
      const roles = p.roles.filter(x => x.word !== pronoun && x.word !== rel.noun);
      const pronounRole = pronoun ? p.roles.find(x => x.word === pronoun)?.name : null;
      const fill = pronounRole ?? (roles.some(x => x.name === 'subject') ? (roles.some(x => x.name === 'object') ? null : 'object') : 'subject');
      if (!fill || !rel.value) { this.unparsed(subtree(r), null, 'other', 'relative clause'); continue; }
      const kept = roles.filter(x => x.name !== fill);
      kept.push({name: fill, value: rel.value});
      const wire = {type: 'stated', id: this.id('s'), relation: p.relation, roles: kept.slice(0, 4).map(({name, value}) => ({name, value})), polarity: p.polarity, certainty: ctx.certainty, speaker: ctx.speaker ?? null, valid: {}, links: []};
      for (const t of p.times) if (!wire.valid.on && t.form === 'on') wire.valid.on = t.text;
      this.wires.push(wire);
      this.dependants({...p, relatives: []}, S, ctx, wire.id, null);
    }
  }

  // ---------------------------------------------------------------- questions

  /** An elliptical follow-up ("And Priya?", "Dar în Debrecen?", Q-LANG-4): only what the message gives. */
  fragment(h, S) {
    const nominal = (['NOUN', 'PROPN', 'NUM', 'PRON'].includes(h.upos) || (['INTJ', 'X', 'ADJ'].includes(h.upos) && (/^\p{Lu}/u.test(h.text) || /PERSON|ORG|GPE/.test(h.ner ?? '')))) && !kids(h, 'cop', 'nsubj', 'aux').length;
    const lead = subtree(h).filter(w => w.upos !== 'PUNCT').sort((a, b) => a.id - b.id);
    const opener = ['and', 'but', 'what', 'how', 'si', 'dar', 'iar', 'or', 'sau', 'also'].includes(lead[0]?.folded);
    if (!nominal || !opener || lead.length > 8 || S.words.some(w => ['VERB', 'AUX'].includes(w.upos))) return null;
    const roles = [];
    for (const k of [h, ...kids(h, 'conj')].slice(0, 2)) {
      const prep = caseText(k);
      const time = this.isTime(k, prep);
      const role = time ? 'time' : prep ? this.prepRole(prep, k, S, []) : 'subject';
      if (roles.some(r => r.name === role)) continue;
      const value = this.value(k, S, {}, {skipCase: true}).value.replace(/^(and|but|what about|how about|si|dar|iar|also)\s+/i, '');
      if (value) roles.push({name: role, value});
    }
    if (!roles.length) return null;
    const wire = {type: 'query', id: this.id('q'), fragment: 'follow_up', mode: null, select: [], measure: null, blocks: [{relation: null, roles, polarity: 'affirmed'}], scope: null, during: null, at: null, compares: [], excepts: [], rank: null, order: null, links: []};
    this.wires.push(wire);
    return wire.id;
  }

  query(h, S, ctx) {
    const fragment = this.fragment(h, S);
    if (fragment) return fragment;
    const q = new QueryBuilder();
    const p = this.proposition(h, S, ctx, q);
    const phraseHead = p.heads.find(hd => S.phraseHeads?.has(hd.id)) ?? (h === S.root && S.phraseHeads?.size === 1 && !p.phrase ? S.byId.get([...S.phraseHeads.keys()][0]) : null);
    let kind = p.phrase ?? (phraseHead ? S.phraseHeads.get(phraseHead.id) : null) ?? ctx.wh ?? (p.whAdverbs[0] ? WH[p.whAdverbs[0].folded] : null);
    if (phraseHead) S.phraseHeads.delete(phraseHead.id);
    if (!p.relation || (!p.roles.length && !kind && !p.existential)) {
      this.unparsed(subtree(h, k => ['conj', 'parataxis', 'punct'].includes(base(k.deprel)) && k !== h), null, 'other', 'no proposition');
      return null;
    }
    // Definitions (C8): "what does X mean", "ce înseamnă X" → select ?m, relation "mean", the term as subject.
    if (/^(mean|insemna)$/.test(p.heads[0].lemmaFolded) && p.roles.some(r => isVariable(r.value))) {
      const term = p.roles.find(r => !isVariable(r.value)) ?? (() => { const i = p.leftovers.findIndex(([k]) => ['NOUN', 'PROPN', 'ADJ', 'X'].includes(k.upos)); if (i < 0) return null; const [k] = p.leftovers.splice(i, 1)[0]; return {value: spanText(this.message, subtree(k))}; })();
      if (term) {
        q.select = []; q.names.clear();
        const m = q.variable('m');
        q.selectVar(m);
        p.roles = [{name: 'subject', value: term.value}, {name: 'object', value: m}];
      }
    }
    // Question adverbs and phrases.
    const addRole = (name, variable) => { if (!p.roles.some(r => r.name === name) && p.roles.length < 4) p.roles.push({name, value: variable}); return variable; };
    const existingVar = p.roles.some(r => isVariable(r.value));
    if (kind === 'why') q.mode = 'explain';
    else if (kind === 'where' || kind === 'where_from' || kind === 'where_to') {
      const stranded = S.words.find(w => ['from', 'to'].includes(w.folded) && p.heads.some(hd => hd.id === w.head) && !w.kids.length);
      if (stranded) stranded.used = true;
      p.roles = p.roles.filter(r => !stranded || r.word !== stranded);
      p.leftovers = p.leftovers.filter(([k]) => k !== stranded);
      const moveFrom = (stranded?.folded === 'from') || (/^(muta|pleca|veni|move|come|leave)/.test(p.heads[0].lemmaFolded) && kind === 'where' && /^(de unde|where from)/.test(fold(this.message.slice(S.start, S.end))));
      if (stranded?.folded === 'to' && kind === 'where') kind = 'where_to';
      p.relation = p.relation.replace(/ (from|to)$/, '');
      // v1.4: "where did X travel/fly/go/move" asks for the destination ("travel to" ?place).
      const toward = kind === 'where' && !moveFrom && !stranded && /^(travel|fly|go|move|relocate|emigrate|head|calatori|zbura|merge|muta|se muta|emigra)$/.test(p.heads[0].lemmaFolded) && !kids(p.heads[0], 'obl').some(o => ['to', 'la', 'in', 'spre'].includes(caseText(o)));
      if (toward) { kind = 'where_to'; if (!/\s(to|la)$/.test(p.relation)) p.relation += S.language === 'ro' ? ' la' : ' to'; }
      const role = kind === 'where_from' || moveFrom ? 'source' : kind === 'where_to' ? 'destination' : 'location';
      // A locative question keeps the locative preposition of the relation ("where does X live" → "live in").
      if (role === 'location' && !/\s(in|at|on|la|in|pe|din)$/.test(fold(p.relation)) && !/^(be|fi)$/.test(p.relation) && !/^(go|come|move|travel|merge|veni|muta|pleca|calatori|ajunge|get)/.test(p.heads[0].lemmaFolded)) p.relation += S.language === 'ro' ? ' în' : ' in';
      q.selectVar(addRole(role, q.variable('place')));
    } else if (['when', 'since_when', 'until_when', 'how_long'].includes(kind)) {
      q.selectVar(addRole('time', q.variable('t')));
      q.measure = {since_when: 'start', until_when: 'end', how_long: 'duration'}[kind] ?? (kind === 'when' ? p.aspect : null) ?? null;
    } else if (kind === 'how_many_times') { const t = addRole('time', q.variable('t')); q.count(t); }
    else if (kind === 'how' && !existingVar) q.selectVar(addRole('instrument', q.variable('how')));
    else if (kind === 'how_much' && !existingVar && /^(cost|price)$/.test(p.heads[0].lemmaFolded)) q.selectVar(addRole('object', q.variable('price')));
    else if ((kind === 'how_much' || kind === 'how_many') && !existingVar) q.count(addRole('object', q.variable('x')));
    // A time on a question is its period.
    for (const t of p.times) {
      if (q.during || q.at) { this.unparsed(t.words, null, 'time', 'second time expression'); continue; }
      if (['from', 'until'].includes(t.form)) { t.pending = true; continue; }
      // A day ("on 3 March", "pe 01.06.2018") is a point in time; a year, month or range is a period.
      // v1.4 (R18): a recurring time ("on Sundays", "every Monday", "at weekends") is a period.
      if (/^(?:(?:every|each)\s+\p{L}+|(?:mon|tues|wednes|thurs|fri|satur|sun)days|weekends|weekdays|business hours|working hours)$/iu.test(t.text)) { q.during = t.text; continue; }
      if (['on', 'at', 'pe', 'la', 'as of'].includes(t.prep) || /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}(st|nd|rd|th)?\s+(?:of\s+)?\p{L}+\s+\d{4}\b|\b\p{L}+\s+\d{1,2},?\s+\d{4}\b/u.test(t.text)) q.at = t.text; else q.during = t.text;
    }
    if (p.rank && p.rankVar) q.rank = [p.rank, p.rankVar];
    q.compares.push(...p.compares);
    q.excepts.push(...p.excepts.filter(Boolean), ...(ctx.excepts ?? []));
    const main = {relation: p.relation, roles: p.roles.map(({name, value}) => ({name, value})), polarity: p.polarity};
    // Existential questions ("is there anyone who …", "e vreun om care …"): the relative clauses are the question.
    // v1.6 (R3): an existential question without a relative clause keeps its own block; skipping it left the
    // query empty and reported the whole sentence ("Is there a pharmacy near the hotel?").
    if (p.existential && p.relatives.length) {
      main.skip = true;
      q.mode = p.negatedExistence ? q.mode : q.mode;
    }
    // Universal questions (mode every): the restriction from the quantified noun, the scope from the clause.
    if (p.universal?.variable) {
      const u = p.universal;
      q.mode = 'every';
      q.quantifier = u.words;
      q.select = q.select.filter(v => v !== u.variable);
      const restriction = this.restriction(u, S, ctx, q);
      q.blocks.push(...restriction);
      q.scope = {...main, polarity: u.none ? 'negated' : p.polarity};
    } else if (!main.skip) q.blocks.push(main);
    if (p.extraBlocks?.length) q.blocks.push(...p.extraBlocks);
    for (const rel of p.relatives) if (!rel.restriction) q.blocks.push(...this.relativeBlocks(rel, S, ctx, q));
    // A conjoined predicate that shares the question's variable subject is another block of the same question
    // ("who works at X and is over 40?").
    const variableSubject = main.roles.find(r => r.name === 'subject' && isVariable(r.value));
    if (variableSubject && !main.skip) for (const c of kids(h, 'conj').filter(c => isClausal(c) && !this.subjectOf(c) && !c.absorbed)) {
      c.absorbed = true;
      const cp = this.proposition(c, S, {...ctx, inherit: undefined}, q);
      if (!cp.relation) continue;
      q.compares.push(...cp.compares);
      if (cp.rank && cp.rankVar) q.rank = [cp.rank, cp.rankVar];
      q.blocks.push({relation: cp.relation, roles: [{name: 'subject', value: variableSubject.value}, ...cp.roles.filter(r => r.name !== 'subject').map(({name, value}) => ({name, value}))].slice(0, 4), polarity: cp.polarity});
      for (const [k, hint] of cp.leftovers) this.unparsed(subtree(k), null, hint, 'conjoined predicate leftover');
    }
    // v1.4 (R7, C6): conjoined clauses inside one embedded question ("Do you know if P and Q?", "Știi dacă P și Q?")
    // are further blocks of the same query; a conjunct without a subject shares the first clause's subject.
    if (ctx.embedded && !main.skip && !p.universal && q.blocks.length >= 1) for (const c of kids(h, 'conj').filter(c => isClausal(c) && !c.absorbed && !ctx.questions?.has(c.id) && !kids(c, 'mark').some(m => CONNECTIVES[m.folded]))) {
      if (variableSubject) break;
      c.absorbed = true;
      // "check if P and draft a reminder": a bare-infinitive action conjunct is the listener's task, not part of P.
      if (S.language !== 'ro' && ACTION_REQUESTS.has(c.lemmaFolded) && !this.subjectOf(c) && c.feats?.VerbForm === 'Inf') { this.actionRequests++; for (const w of subtree(c)) w.used = true; continue; }
      const own = this.subjectOf(c);
      const cp = this.proposition(c, S, {...ctx, inherit: own ? undefined : this.subjectOf(h) ?? undefined}, q);
      if (!cp.relation || !cp.roles.length) continue;
      q.compares.push(...cp.compares);
      q.blocks.push({relation: cp.relation, roles: cp.roles.slice(0, 4).map(({name, value}) => ({name, value})), polarity: cp.polarity});
      for (const [k, hint] of cp.leftovers) this.unparsed(subtree(k), null, hint, 'conjoined clause leftover');
    }
    // "Did X start living in Y before Z did?" → two timed blocks and `order ?t1 before ?t2` (Q-LANG-3).
    for (const k of p.subordinate) {
      const marker = markText(k);
      const keyword = CONNECTIVES[marker];
      if (!['before', 'after'].includes(keyword) || q.blocks.length !== 1 || q.mode) continue;
      const elliptic = ['do', 'face'].includes(k.lemmaFolded) || k.upos === 'AUX' || k.lemmaFolded === p.heads.at(-1).lemmaFolded || p.heads.some(hd => hd.lemmaFolded === k.lemmaFolded);
      const other = this.subjectOf(k);
      if (!elliptic || !other) continue;
      k.absorbed = true;
      const first = q.blocks[0];
      const t1 = q.variable('t1'), t2 = q.variable('t2');
      const second = {...first, roles: first.roles.map(r => (r.name === 'subject' ? {...r, value: this.value(other, S, ctx).value} : r))};
      first.roles = [...first.roles.filter(r => r.name !== 'time'), {name: 'time', value: t1}].slice(0, 4);
      second.roles = [...second.roles.filter(r => r.name !== 'time'), {name: 'time', value: t2}].slice(0, 4);
      q.blocks.push(second);
      q.order = [t1, keyword, t2];
      q.mode = 'exists';
    }
    if (p.comparative && q.blocks.length === 1) {
      const c = p.comparative;
      q.blocks.push({...q.blocks[0], roles: q.blocks[0].roles.map(r => (r.name === 'subject' ? {...r, value: c.other} : r.value === c.a ? {...r, value: c.b} : r))});
      q.compares.push([c.a, c.op, c.b]);
      q.mode = 'exists';
    }
    if (!q.blocks.length) { this.unparsed(subtree(h, k => ['punct'].includes(k.deprel)), null, 'other', 'empty question'); return null; }
    // Alternatives "X or Y?" → one query per option (C7); "X and Y" in a question → one block per conjunct.
    const variants = [];
    // v2.0: "What do X and Y mean?" is one definition query per term.
    if (p.coord && (p.coord.or || (p.coord.role === 'subject' && /^(mean|insemna)$/.test(p.heads[0].lemmaFolded)))) for (const option of p.coord.options) variants.push(option);
    else if (p.coord && q.blocks[0] === main) {
      const first = q.blocks[0];
      const extra = p.coord.options.slice(1).map(option => ({...first, roles: first.roles.map(r => (r.name === p.coord.role ? {...r, value: option} : r))}));
      first.roles = first.roles.map(r => (r.name === p.coord.role ? {...r, value: p.coord.options[0]} : r));
      q.blocks.splice(1, 0, ...extra);
    }
    const build = option => {
      const wire = q.wire(this.id('q'));
      if (option !== undefined) wire.blocks = wire.blocks.map((b, i) => (i === 0 ? {...b, roles: b.roles.map(r => (r.name === p.coord.role ? {...r, value: option} : r))} : b));
      this.wires.push(wire);
      return wire.id;
    };
    const ids = variants.length ? variants.map(build) : [build()];
    // v1.6 (R4): a lone "before/until <time>" phrase of a question is the question's period, exactly as in the
    // statement form ("Do I need the documents before Friday?"); only a second explicit time is reported.
    for (const t of p.times.filter(t => t.pending)) {
      if (q.during || q.at) { this.unparsed(t.words, ids[0], 'time', 'query period ' + t.form); continue; }
      q.during = t.text;
    }
    this.dependants({...p, subordinate: p.subordinate.filter(k => !k.absorbed)}, S, ctx, ids[0], this.wire(ids[0]));
    for (const id of ids.slice(1)) this.wire(id).links = [...this.wire(ids[0]).links];
    return ids[0];
  }

  /** Match blocks of a relative clause (and its conjuncts) sharing the noun's variable. */
  relativeBlocks(rel, S, ctx, q) {
    const out = [];
    for (const r of [rel.clause, ...kids(rel.clause, 'conj').filter(c => isClausal(c) && !this.subjectOf(c))]) {
      r.absorbed = true;
      const pronoun = r.kids.find(k => (k.feats?.PronType === 'Rel' || RELATIVE_WORDS.has(k.folded)) && ['PRON', 'DET', 'ADV', 'SCONJ'].includes(k.upos));
      const p = this.proposition(r, S, {...ctx, inherit: undefined}, q);
      if (!p.relation) continue;
      q.compares.push(...p.compares);
      if (p.rank && p.rankVar) q.rank = [p.rank, p.rankVar];
      const roles = p.roles.filter(x => x.word !== pronoun && x.word !== rel.noun);
      const pronounRole = pronoun ? p.roles.find(x => x.word === pronoun)?.name : null;
      const fill = pronounRole ?? (roles.some(x => x.name === 'subject') ? (roles.some(x => x.name === 'object') ? null : 'object') : 'subject');
      if (!fill) continue;
      const kept = roles.filter(x => x.name !== fill);
      kept.push({name: fill, value: rel.variable});
      // v1.4 (R16): "anyone at X who works there": the noun's place phrase replaces "there" in the relative clause.
      const place = kids(rel.noun, 'nmod').find(n => caseText(n) && !this.isTime(n, caseText(n)));
      let relation = p.relation;
      if (place && S.language !== 'ro' && kids(r, 'advmod').some(a => a.folded === 'there') && !kept.some(x => x.name === 'object')) {
        relation = relation + ' ' + caseText(place);
        kept.push({name: 'object', value: this.value(place, S, ctx).value});
        place.placed = true;
      }
      for (const [k, hint] of p.leftovers) this.unparsed(subtree(k), null, hint, 'relative clause leftover');
      out.push({relation, roles: kept.slice(0, 4).map(({name, value}) => ({name, value})), polarity: p.polarity});
    }
    const place = S.language !== 'ro' && INDEFINITE.has(rel.noun.folded) ? kids(rel.noun, 'nmod').find(n => caseText(n) && !this.isTime(n, caseText(n))) : null;
    if (place && !place.placed && out.length) { out.push({relation: 'be ' + caseText(place), roles: [{name: 'subject', value: rel.variable}, {name: this.prepRole(caseText(place), place, S, ['be']), value: this.value(place, S, ctx).value}], polarity: 'affirmed'}); place.placed = true; }
    return out;
  }

  /** The restriction of a universal question: the quantified noun's relative clause, its "of/at X", or the noun. */
  restriction(u, S, ctx, q) {
    let noun = u.word;
    // v1.4 (R2): a partitive "half of the players of X", "most of the nurses at X" restricts on the inner noun.
    const partitive = PARTITIVES.has(noun.folded) ? kids(noun, 'nmod', 'obl').find(n => caseText(n) === 'of' && kids(n, 'det', 'nmod:poss').length) : null;
    if (partitive) { for (const w of caseWords(partitive)) w.used = true; noun = partitive; }
    const rel = kids(noun, 'acl:relcl', 'acl').find(isClausal);
    if (rel) {
      const blocks = this.relativeBlocks({clause: rel, noun, variable: u.variable}, S, ctx, q);
      if (blocks.length) return blocks;
    }
    const en = S.language !== 'ro';
    const nmod = kids(noun, 'nmod').find(n => caseText(n));
    const quantifierWords = new Set([u.quantifier?.id, ...(u.quantifier ? subtree(u.quantifier).map(w => w.id) : [])]);
    const bareQuantifier = UNIVERSAL.has(noun.folded) || NONE.has(noun.folded) || INDEFINITE.has(noun.folded);
    const head = bareQuantifier ? '' : spanText(this.message, subtree(noun, c => c === nmod || (base(c.deprel) === 'nmod' && nmod && sameEntity(S, nmod, c)) || quantifierWords.has(c.id) || ['det', 'punct', 'acl:relcl', 'acl', 'case', 'advmod', 'nummod', 'conj', 'cc'].includes(base(c.deprel)) || c.deprel === 'acl:relcl')).toLowerCase();
    // v1.4 (R2): the restriction names the class with the noun's lemma and an article: "be a player of", "be an employee in".
    const classPhrase = () => {
      if (!en || bareQuantifier || !head) return head;
      const lemma = noun.lemmaFolded && noun.upos === 'NOUN' ? head.replace(new RegExp('\\b' + noun.folded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), noun.lemma.toLowerCase()) : head;
      if (!noun.feats?.Number || noun.upos !== 'NOUN') return lemma;
      return (/^[aeiou]/i.test(lemma) ? 'an ' : 'a ') + lemma;
    };
    if (nmod) {
      const prep = caseText(nmod);
      const siblings = kids(noun, 'nmod').filter(n => n !== nmod && sameEntity(S, nmod, n));
      const value = siblings.length ? spanText(this.message, [nmod, ...siblings].flatMap(n => subtree(n)).filter(w => !caseWords(nmod).includes(w))) : this.value(nmod, S, ctx).value;
      for (const n of siblings) n.used = true;
      const role = this.prepRole(prep, nmod, S, []);
      return [{relation: [en ? 'be' : 'fi', classPhrase(), prep].filter(Boolean).join(' '), roles: [{name: 'subject', value: u.variable}, {name: role, value}], polarity: 'affirmed'}];
    }
    return [{relation: [en ? 'be' : 'fi', classPhrase() || (en ? 'someone' : 'cineva')].join(' '), roles: [{name: 'subject', value: u.variable}], polarity: 'affirmed'}];
  }
}

/** Variables and question fields of one query under construction. */
class QueryBuilder {
  constructor() { Object.assign(this, {placeholders: [], names: new Set(), select: [], mode: null, measure: null, blocks: [], scope: null, during: null, at: null, quantifier: null, compares: [], excepts: [], rank: null, order: null}); }
  variable(name) { let v = '?' + name, i = 2; while (this.names.has(v)) v = '?' + name + i++; this.names.add(v); return v; }
  selectVar(v) { if (!this.select.includes(v)) this.select.push(v); }
  count(v) { this.mode = 'count'; this.select = [v]; }
  wire(id) {
    const blocks = this.blocks.map(b => ({relation: b.relation, polarity: b.polarity, roles: b.roles.filter(r => r.value !== undefined && r.value !== '')}));
    const scope = this.scope ? {relation: this.scope.relation, polarity: this.scope.polarity, roles: this.scope.roles.filter(r => r.value !== undefined && r.value !== '')} : null;
    const used = new Set([...blocks, scope].filter(Boolean).flatMap(b => b.roles.map(r => r.value)).filter(isVariable));
    // v1.4 (R4): two question determiners ("which people … which companies") select two variables.
    let select = this.mode === 'explain' || this.mode === 'every' ? [] : this.select.filter(v => used.has(v)).slice(0, this.multiSelect && this.mode !== 'count' ? 2 : 1);
    const compares = this.compares.filter(([v]) => used.has(v));
    const excepts = select.length ? this.excepts.map(value => [select[0], value]) : [];
    const rank = this.rank && used.has(this.rank[1]) ? this.rank : null;
    const mode = this.mode === 'count' && !select.length ? null : this.mode ?? (select.length ? null : used.size ? 'exists' : null);
    if (mode === 'count' && !select.length) select = [];
    return {type: 'query', id, mode, quantifier: mode === 'every' ? this.quantifier : null, select, measure: select.length && this.measure ? this.measure : null, blocks, scope: mode === 'every' ? scope : null,
      during: this.during, at: this.at, compares, excepts, rank, order: this.order, links: [], placeholders: this.placeholders.filter(v => used.has(v))};
  }
}

/** Is the message unintelligible (C12 `gibberish`)? Most alphabetic words unknown to the parser, or untaggable. */
export function isGibberish(parse) {
  const words = (parse.sentences ?? []).flatMap(s => s.words).filter(w => /\p{L}/u.test(w.text));
  if (!words.length) return !/\p{N}/u.test(parse.text ?? '');
  // v1.4 (R17): a short follow-up ("And Ghiță Stoian?", "and Tuesday?") is a fragment even when its name is unknown.
  const opener = fold(words.slice(0, 2).map(w => w.text).join(' '));
  if (words.length <= 5 && /^(and|but|what about|how about|same for|si|dar|iar|also)\b/.test(opener) && words.slice(1).some(w => /^\p{Lu}/u.test(w.text) || TIME_WORDS.has(w.folded ?? fold(w.text)))) return false;
  // v2.0: a run of lowercase words the tagger read as proper nouns, with no verb and no entity ("gam mif bla").
  if (words.length >= 2 && words.length <= 8 && words.every(w => ['PROPN', 'X'].includes(w.upos) && /^\p{Ll}/u.test(w.text) && (!w.ner || w.ner === 'O'))) return true;
  if (words.length >= 5 && words.length <= 8 && words.every(w => ['PROPN', 'X', 'NOUN'].includes(w.upos) && /^\p{Ll}/u.test(w.text) && (!w.ner || w.ner === 'O'))) return true;
  const unknown = words.filter(w => w.oov).length / words.length;
  const untagged = words.filter(w => w.upos === 'X').length / words.length;
  const anyVerb = words.some(w => ['VERB', 'AUX'].includes(w.upos) && !w.oov);
  return unknown >= 0.75 || untagged >= 0.5 || (unknown >= 0.6 && !anyVerb && words.length <= 6);
}

export {rangeOf};
