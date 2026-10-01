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
  COMPARATORS, RANK_VALUES, QUANTIFIERS, START_VERBS, STOP_VERBS, fold} from './lexicon.mjs';
import {base, indexSentence, kids, subtree, spanText, rangeOf} from './tree.mjs';

const ROLE_HINT = {subject: 'subject', object: 'object', time: 'time', location: 'location'};
const hintFor = role => ROLE_HINT[role] ?? 'value';
/** Adverbs that carry no proposition content (dropped without an unparsed span). */
const FUNCTION_ADVERBS = new Set(['also', 'too', 'still', 'again', 'just', 'already', 'only', 'even', 'then', 'really', 'actually', 'ever', 'yet', 'currently', 'anymore', 'there', 'here', 'as', 'well', 'so', 'very', 'else', 'exactly', 'definitely', 'certainly', 'surely', 'indeed', 'altogether', 'anyway', 'though', 'however', 'besides', 'otherwise', 'rather', 'quite', 'pretty', 'right', 'once', 'twice', 'first', 'finally', 'always', 'usually', 'often', 'sometimes', 'recently', 'lately', 'meanwhile',
  'si', 'tot', 'inca', 'deja', 'doar', 'numai', 'chiar', 'atunci', 'mai', 'oare', 'cumva', 'totusi', 'insa', 'iar', 'foarte', 'exact', 'sigur', 'intr-adevar', 'aici', 'acolo', 'bine', 'asa', 'cam', 'vreodata', 'defapt', 'de', 'fapt', 'anume', 'apropo', 'deci', 'acuma', 'mereu', 'uneori', 'adesea', 'recent', 'totodata', 'desigur', 'oricum']);
const PARTICLES = new Set(['back', 'out', 'up', 'down', 'away', 'off', 'over', 'around', 'along', 'through']);
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
const caseText = k => caseWords(k).flatMap(c => [c, ...kids(c, 'fixed', 'flat')]).sort((a, b) => a.id - b.id).map(w => w.folded).join(' ').trim();
const markText = k => kids(k, 'mark').flatMap(m => [m, ...kids(m, 'fixed', 'flat')]).sort((a, b) => a.id - b.id).map(w => w.folded).join(' ').trim();

export class Analysis {
  /** `parse` is the worker's `{text, language, sentences}`; `message` the original text (offsets refer to it). */
  constructor(parse, message = parse.text) {
    this.message = message;
    this.language = parse.language;
    this.sentences = (parse.sentences ?? []).map(indexSentence);
    this.wires = [];
    this.ids = {s: 0, q: 0, a: 0, u: 0};
    this.people = []; // earlier proper-name subjects, for third-person pronouns
    this.lastSubject = null; // for Romanian pro-drop
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
    return this;
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
        break;
      }
    }
  }

  sentence(S) {
    const content = S.words.filter(w => w.upos !== 'PUNCT' && !/^[\p{P}\p{S}\s]+$/u.test(w.text));
    if (!content.length) return;
    if (content.every(w => SMALL_TALK.has(w.folded) || SMALL_TALK.has(w.lemmaFolded) || w.upos === 'INTJ')) { this.smallTalk++; return; }
    this.markPhrases(S);
    const endsWithQuestion = S.words.some(w => w.text.includes('?'));
    const heads = this.clauseHeads(S);
    const own = new Set(heads.filter(h => this.questionMarked(h, S)).map(h => h.id));
    if (endsWithQuestion && !own.size) own.add(S.root.id);
    this.clause(S.root, S, {as: own.has(S.root.id) ? 'query' : 'stated', certainty: 'asserted', speaker: null, questions: own});
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
      const found = kids(h, label).find(k => isClausal(k) && (label !== 'advcl' || noun || /^(if|whether|daca|de)$/.test(markText(k)) || kids(k, 'advmod').some(a => WH[a.folded])) && (label !== 'conj' || !kids(k, 'nsubj').length) && (label !== 'parataxis' || noun));
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
    if (/^(ask|tell|want|need|intreba|cere|spune|vrea)/.test(fold(p.relation)) && p.roles.some(r => r.name !== 'subject' && r.value === 'the user')) return true;
    const subject = p.roles.find(r => r.name === 'subject') ?? (h.feats?.Person === '1' && !this.subjectOf(h) ? {value: 'the user'} : null);
    if (!subject || !(subject.value === 'the user' || /^the user's /.test(subject.value) || /^(we|noi)$/i.test(subject.value))) return false;
    const progressive = kids(h, 'aux').some(a => ['am', "'m", 'are', "'re", 'is'].includes(a.folded)) && h.feats?.VerbForm === 'Part' && h.feats?.Tense === 'Pres';
    const intention = /^(have to|need|want|plan|try|going|will|would like|hope|intend|prepare|organize|organise|avea de|trebui|vrea|dori|planifica|incerca|pregati|organiza)/.test(fold(p.relation));
    const future = kids(h, 'aux').some(a => ['will', "'ll", 'o', 'voi', 'vom'].includes(a.folded));
    const meeting = /^(have|avea)$/.test(fold(p.relation)) && /^(we|noi)$/i.test(subject.value);
    if (h.feats?.Person === '1' && !this.subjectOf(h) && h.feats?.Tense === 'Pres' && this.language !== 'en') return true;
    return progressive || intention || future || meeting;
  }
  isFirstPerson(w) { return Boolean(w) && (FIRST_PERSON.has(w.folded) || w.folded === 'we' || w.folded === 'noi'); }
  isSecondPerson(w) { return Boolean(w) && SECOND_PERSON.has(w.folded); }
  imperative(h) {
    if (h.feats?.Mood === 'Imp') return true;
    if (this.subjectOf(h) || h.upos !== 'VERB') return false;
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
    // "I'm trying to find out who …", "vreau să aflu dacă …": the wrapper verb sits in a subjectless complement.
    let embedVerb = EMBED_QUESTION.has(lemma) ? h : null;
    for (let x = h, depth = 0; !embedVerb && depth < 3; depth++) {
      x = kids(x, 'xcomp', 'ccomp').find(k => k.upos === 'VERB' && !this.subjectOf(k));
      if (!x) break;
      const c = this.complement(x);
      if (EMBED_QUESTION.has(x.lemmaFolded) && c && this.opensQuestion(c.clause)) { embedVerb = x; inner = c; x.used = true; }
    }
    if (inner) {
      const wrapperVerb = Boolean(embedVerb) && (ctx.as === 'query' || this.imperative(h) || this.isSecondPerson(subject) || (this.isFirstPerson(subject) && (this.opensQuestion(inner.clause) || ['wonder', 'intreba'].includes(embedVerb.lemmaFolded))))
        && (!subject || this.isSecondPerson(subject) || this.isFirstPerson(subject));
      const done = [inner.clause];
      // Question and request wrappers (C6): "do you know if P", "check whether P", "tell me who …", "any idea where …".
      if (wrapperVerb || (wrapperNoun && (ctx.as === 'query' || !subject))) {
        if (inner.word) inner.word.used = true;
        const excepts = kids(h, 'obl', 'advmod').filter(k => EXCEPT_PREPS.has(caseText(k)) || (k.whPhrase === undefined && EXCEPT_PREPS.has(fold(spanText(this.message, caseWords(k).length ? caseWords(k) : [])))));
        for (const k of excepts) k.used = true;
        const main = this.clause(inner.clause, S, {...ctx, as: 'query', certainty: 'asserted', wh: inner.wh ?? ctx.wh, excepts: excepts.map(k => this.value(k, S, ctx).value)});
        this.siblings(h, S, ctx, main, done);
        return main;
      }
      // Reported speech and belief (C10): "Ion says that P", "I think P", "cred că P", "suppose P".
      if (SAY.has(lemma) && subject && !this.isSecondPerson(subject) && ctx.as !== 'query') {
        const speaker = this.isFirstPerson(subject) ? null : this.value(subject, S, ctx).value;
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
    // The user's own asking ("I'm asking because P", "întreb pentru că P") is a remark (C4): its reason is stated.
    if (['ask', 'intreba'].includes(lemma) && (this.isFirstPerson(subject) || !subject) && ctx.as !== 'query') {
      let main = null;
      for (const k of kids(h, 'advcl', 'ccomp')) main = this.clause(k, S, {...ctx, as: 'stated', certainty: 'asserted'}) ?? main;
      this.siblings(h, S, ctx, main, kids(h, 'advcl', 'ccomp'));
      return main;
    }
    // A pure action request with no question (C8): "write a poem", "traduce textul".
    if (ctx.as !== 'query' && ACTION_REQUESTS.has(lemma) && (this.imperative(h) || this.isSecondPerson(subject))) {
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
    const passive = kids(h, 'aux:pass').length > 0 || (kids(h, 'nsubj:pass').length > 0 && h.upos === 'VERB');
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
        parts.push(be, h.text.toLowerCase());
        // "how old is X", "cât de mare e X": the asked value of an adjective predicate (Q-LANG-1).
        const how = kids(h, 'advmod').find(a => ['how', 'cat', 'cit'].includes(a.folded));
        if (how && query) { how.used = true; const v = query.variable(/^(old|batran|vechi)$/.test(h.folded) ? 'age' : 'v'); query.selectVar(v); p.roles.push({name: 'object', value: v}); }
        if (p.compareVar) p.roles.push({name: 'object', value: p.compareVar});
      } else {
        const marker = caseText(h);
        const nmod = kids(h, 'nmod').find(n => (caseText(n) || (!en && (/Gen|Dat/.test(n.feats?.Case ?? '') || kids(n, 'det').some(d => ['lui', 'al', 'a', 'ai', 'ale'].includes(d.folded))))) && !kids(n, 'nmod:poss').length && !n.used);
        if (marker) {
          parts.push(be, marker);
          prepInRelation = marker;
          this.addArgument(p, h, S, ctx, query, this.prepRole(marker, h, S, [be]), {skipCase: true});
        } else if (nmod && !this.whWord(h)) {
          const head = spanText(this.message, subtree(h, k => k === nmod || k.used || ['nsubj', 'nsubj:pass', 'cop', 'punct', 'aux', 'mark', 'cc', 'conj', 'advcl', 'acl:relcl', 'parataxis', 'csubj', 'discourse', 'advmod', 'obl', 'expl'].includes(base(k.deprel)) || k.deprel === 'acl:relcl'));
          const caseOf = caseText(nmod);
          for (const d of kids(nmod, 'det')) if (['lui', 'al', 'a', 'ai', 'ale'].includes(d.folded)) d.used = true;
          parts.push(be, head.toLowerCase(), caseOf);
          this.addArgument(p, nmod, S, ctx, query, this.prepRole(caseOf, nmod, S, [be]), {skipCase: true});
        } else {
          parts.push(be);
          this.addArgument(p, h, S, ctx, query, 'object', {predicate: true});
        }
      }
    } else if (passive) {
      parts.push(be, h.text.toLowerCase());
    } else if (EXISTENTIAL.has(h.lemmaFolded) || (h.lemmaFolded === 'be' && kids(h, 'expl').some(e => e.folded === 'there'))) {
      p.existential = true;
      parts.push(h.lemma.toLowerCase());
    } else {
      const reflexive = !en && kids(h, 'expl:pv', 'expl', 'expl:impers', 'expl:pass').some(k => /^(se|s|si|isi)-?$/.test(k.folded));
      if (reflexive) parts.push('se');
      parts.push(h.lemma.toLowerCase());
      for (const prt of kids(h, 'compound:prt')) parts.push(prt.folded);
      for (const adv of kids(h, 'advmod')) if (en && PARTICLES.has(adv.folded) && adv.id === h.id + 1) { parts.push(adv.folded); adv.used = true; }
    }
    // Merge a subjectless verbal complement: "plan to study", "start living", "poate să semneze" → "putea semna".
    let head = h;
    for (let depth = 0; depth < 3 && !cop; depth++) {
      const x = kids(head, 'xcomp', 'ccomp').find(k => ['VERB', 'AUX'].includes(k.upos) && !kids(k, 'cop').length && !this.subjectOf(k) && !k.used && (base(k.deprel) === 'xcomp' || (MERGE_VERBS.has(head.lemmaFolded) && /^(sa|to|s)$/.test(markText(k)))));
      if (!x) break;
      // "When did X start/stop V": since when / until when of V (the aspect verb is not part of the relation).
      if (START_VERBS.has(head.lemmaFolded) || STOP_VERBS.has(head.lemmaFolded)) {
        p.aspect = START_VERBS.has(head.lemmaFolded) ? 'start' : 'end';
        parts.splice(parts.indexOf(head.lemma.toLowerCase()), 1);
      } else if (en && markText(x) === 'to') parts.push('to');
      if (!en && kids(x, 'expl:pv').length) parts.push('se');
      parts.push(x.lemma.toLowerCase());
      for (const prt of kids(x, 'compound:prt')) parts.push(prt.folded);
      p.heads.push(x);
      x.merged = true;
      head = x;
    }
    // A bare-noun object of a light verb joins the relation: "take part in", "have access to", "lua parte la".
    const bare = p.heads.flatMap(hd => kids(hd, 'obj')).find(o => o.upos === 'NOUN' && !o.kids.some(c => ['det', 'nmod:poss', 'det:poss', 'nummod', 'amod', 'acl', 'acl:relcl', 'conj', 'compound', 'nmod'].includes(c.deprel)) && p.heads.some(hd => kids(hd, 'obl').some(o2 => caseText(o2))) && !WH[o.folded]);
    if (bare && ['take', 'have', 'pay', 'make', 'lua', 'avea', 'face', 'give', 'keep'].includes(p.heads[0].lemmaFolded)) { parts.push(bare.folded); bare.used = true; p.lightNoun = true; }
    // Fixed verb + noun idioms ("take place", "avea loc", "lua parte", "face parte").
    const idiom = !bare && p.heads.flatMap(hd => kids(hd, 'obj', 'nsubj')).find(o => /^(place|loc|parte)$/.test(o.folded) && !o.kids.some(c => ['det', 'amod', 'nmod'].includes(base(c.deprel))) && /^(take|avea|lua|face)$/.test(p.heads[0].lemmaFolded));
    if (idiom) { parts.push(idiom.folded); idiom.used = true; p.lightNoun = true; }
    // Romanian "face naveta", "da examen": an undetermined object noun of a light verb completes the relation.
    const roBare = !en && !bare && !idiom && /^(face|da|lua|tine)$/.test(p.heads[0].lemmaFolded) ? kids(p.heads[0], 'obj').find(o => o.upos === 'NOUN' && !o.kids.length) : null;
    if (roBare) { parts.push(roBare.folded); roBare.used = true; }
    // Arguments of every merged head.
    const obliques = [];
    for (const hd of p.heads) for (const k of hd.kids) {
      if (k.whPhrase) { p.phrase = k.whPhrase; continue; }
      if (k.merged || k.used) continue;
      const label = k.deprel, b = base(label);
      if (!en && ['obj', 'iobj', 'expl', 'expl:pv'].includes(label) && k.upos === 'PRON' && RO_CLITICS.has(k.folded.replace(/-$/, '').replace(/^-/, ''))) continue;
      if (label === 'nsubj' || label === 'nsubj:pass' || (b === 'csubj' && !isClausal(k))) {
        const taken = p.roles.some(r => r.name === 'subject') || kids(hd, 'nsubj', 'nsubj:pass').some(o => o !== k && o.id < k.id);
        this.addArgument(p, k, S, ctx, query, taken && !p.roles.some(r => r.name === 'object') ? 'object' : 'subject', {skipCase: true});
        continue;
      }
      if (b === 'expl') continue;
      if (b === 'csubj' || label === 'ccomp' || (b === 'xcomp' && isClausal(k))) { p.complements.push(k); continue; }
      if (b === 'obj') {
        const visited = /^(visit|vizita)$/.test(hd.lemmaFolded) && (/GPE|LOC|FAC/.test(subtree(k).map(w => w.ner ?? '').join(' ')) || (!en && k.upos === 'PROPN'));
        this.addArgument(p, k, S, ctx, query, visited ? 'destination' : p.roles.some(r => r.name === 'object') && !p.roles.some(r => r.name === 'subject') && k.id < h.id ? 'subject' : 'object', {skipCase: true});
        continue;
      }
      if (b === 'iobj') { this.addArgument(p, k, S, ctx, query, 'recipient'); continue; }
      if (label === 'obl:agent') { if (en && !parts.includes('by')) parts.push('by'); prepInRelation ??= 'by'; this.addArgument(p, k, S, ctx, query, 'object', {skipCase: true}); continue; }
      if (b === 'obl' || (b === 'nmod' && hd === h && !cop) || label === 'nmod:tmod' || (b === 'xcomp' && !isClausal(k))) { obliques.push(k); continue; }
      if (b === 'advmod' || b === 'neg' || (b === 'det' && NEGATIONS.has(k.folded) && hd.upos === 'VERB')) { this.adverb(p, k, S, ctx, query); continue; }
      if (b === 'advcl') { p.subordinate.push(k); continue; }
      if (b === 'acl') { if (isClausal(k)) p.subordinate.push(k); continue; }
      if (b === 'aux' && (NEGATIONS.has(k.folded) || k.feats?.Polarity === 'Neg')) { p.polarity = 'negated'; continue; }
      if (['aux', 'cop', 'mark', 'punct', 'cc', 'case', 'discourse', 'vocative', 'fixed', 'flat', 'det', 'conj', 'parataxis', 'goeswith', 'clf'].includes(b)) continue;
      if (b === 'compound' && label === 'compound:prt') continue;
      p.leftovers.push([k, b === 'compound' ? 'relation' : 'other']);
    }
    // Obliques: time, "besides X", then the relation's preposition from the first argument, then the others.
    obliques.sort((a, b) => a.id - b.id);
    for (const k of obliques) {
      if (k.used) continue;
      const prep = caseText(k);
      if (this.isTime(k, prep)) { this.addTime(p, k, S, prep); continue; }
      if (EXCEPT_PREPS.has(prep) && query) { p.excepts.push(this.value(k, S, ctx).value); continue; }
      if (!en && prep === 'pe' && !p.roles.some(r => r.name === 'object')) { this.addArgument(p, k, S, ctx, query, 'object', {skipCase: true}); continue; }
      if (prep && prepInRelation === null && k.upos === 'NOUN' && !k.kids.some(c => !['case', 'punct'].includes(c.deprel)) && (en ? ['to', 'at', 'from'].includes(prep) && /^(work|school|church|bed|college|class|home|university|lunch|dinner)$/.test(k.folded) : ['la', 'de la'].includes(prep) && k.feats?.Definite === 'Ind')) {
        parts.push(prep, k.folded); prepInRelation = prep; k.used = true; continue;
      }
      const role = p.lightNoun && prepInRelation === null && prep ? 'object' : this.prepRole(prep, k, S, parts);
      if (prep && prepInRelation === null && role !== 'topic' && !p.existential) {
        prepInRelation = prep;
        parts.push(prep);
      }
      this.addArgument(p, k, S, ctx, query, role, {skipCase: true});
    }
    if (!p.roles.some(r => r.name === 'subject')) {
      const subSubject = !en ? p.heads.flatMap(hd => kids(hd, 'advcl')).flatMap(k => [...subtree(k)]).find(w => ['nsubj', 'nsubj:pass'].includes(w.deprel) && w.upos === 'PROPN') : null;
      const inherited = ctx.inherit ?? (!en && !this.imperative(h) && !p.existential && h.feats?.Person !== '1' && h.feats?.Person !== '2' ? (subSubject ? {value: this.value(subSubject, S, ctx).value} : this.lastSubject) : null);
      if (inherited && !isVariable(inherited.value ?? '')) {
        if (inherited.word) this.addArgument(p, inherited.word, S, ctx, query, 'subject'); else if (inherited.value) p.roles.unshift({name: 'subject', value: inherited.value});
      }
    }
    if (h.feats?.Polarity === 'Neg' && !['SCONJ', 'CCONJ'].includes(h.upos)) p.polarity = 'negated';
    for (const r of p.roles) if (r.name !== 'subject' && r.word && en && /PERSON/.test(subtree(r.word).map(w => w.ner ?? '').join(' ')) && !isVariable(r.value)) this.people.push(r.value);
    p.relation = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const subjectRole = p.roles.find(r => r.name === 'subject');
    if (subjectRole && !isVariable(subjectRole.value)) {
      this.lastSubject = {value: subjectRole.value, word: subjectRole.word};
      if (subjectRole.word?.upos === 'PROPN' && (!en || /PERSON/.test(subtree(subjectRole.word).map(w => w.ner ?? '').join(' ')))) this.people.push(subjectRole.value);
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
    if (words.some(w => /DATE|TIME/.test(w.ner ?? ''))) return true;
    if (k.deprel === 'obl:tmod' || k.deprel === 'nmod:tmod') return true;
    if (TIME_WORDS.has(k.lemmaFolded) || TIME_WORDS.has(k.folded)) return true;
    const text = words.map(w => w.text).join(' ');
    if (DATE.test(text) && words.length <= 5) return true;
    return Boolean(TIME_PREPS[prep]) && words.some(w => /^\d/.test(w.text) || TIME_WORDS.has(w.folded));
  }

  addTime(p, k, S, prep) {
    const cases = new Set(caseWords(k).map(w => w.id));
    const words = subtree(k, c => cases.has(c.id) || ['acl:relcl', 'advcl', 'punct'].includes(c.deprel));
    const text = spanText(this.message, words);
    if (!text) return;
    p.times.push({form: TIME_PREPS[prep] ?? 'on', prep, text, words: [...words, ...caseWords(k)]});
  }

  /** Role of an oblique argument from its preposition class and entity type (C3). */
  prepRole(prep, k, S, relationParts = []) {
    const ner = subtree(k).map(w => w.ner ?? 'O').join(' ');
    const verb = fold(relationParts.filter(Boolean).at(-1) ?? '');
    const role = PREP_ROLE[prep] ?? PREP_ROLE[prep.split(' ').at(-1)];
    if (role === 'recipient') return /PERSON|ORG|NORP/.test(ner) || k.upos === 'PRON' ? 'recipient' : 'topic';
    if (role === 'destination' && GIVE_VERBS.has(verb)) return 'recipient';
    if (role === 'instrument' && (/PERSON|ORG/.test(ner) || (k.upos === 'PROPN' && S.language === 'ro'))) return 'object';
    if (role === 'source' && /^(de|din|de la)$/.test(prep) && S.language === 'ro' && !/^(muta|pleca|veni|sosi|intoarce|reveni|primi|cumpara|lua|imprumuta)/.test(verb)) return 'object';
    if (role) return role;
    if (MOTION_VERBS.test(verb) && ['la', 'in', 'spre', 'into', 'to'].includes(prep)) return 'destination';
    if (prep === 'to' && GIVE_VERBS.has(verb)) return 'recipient';
    const place = PLACE_PREPS.has(prep) || (S.language === 'ro' && ['in', 'la', 'pe', 'din'].includes(prep));
    if (place) {
      if (/GPE|LOC|FAC/.test(ner)) return 'location';
      if (/ORG|PERSON|WORK_OF_ART|EVENT|PRODUCT/.test(ner)) return 'object';
      return ['in', 'inside', 'near', 'langa', 'behind'].includes(prep) ? 'location' : 'object';
    }
    return 'object';
  }

  adverb(p, k, S, ctx, query) {
    const f = k.folded;
    if (k.used) return;
    if (k.whPhrase) { p.phrase = k.whPhrase; return; }
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
    if (RESULT_ADVERBS.has(f) || FUNCTION_ADVERBS.has(f) || COLLECTIVE.has(f) || f === 'not') return;
    if (k.kids.some(c => c.deprel === 'fixed')) return;
    p.leftovers.push([k, 'other']);
  }

  whWord(w) {
    if (!w) return null;
    const f = w.folded;
    if (!WH[f]) return null;
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
      if (howMany) query.count(variable); else if (!predicate || wh) query.selectVar(variable);
      p.roles.push({name: role, value: variable, word: k});
      for (const r of kids(k, 'acl:relcl', 'acl').filter(isClausal)) p.relatives.push({noun: k, clause: r, variable, role});
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
      const quantifier = atLeast ? 'at_least ' + atLeast.text : QUANTIFIERS[quantWord.folded] ?? (NONE.has(quantWord.folded) ? null : negatedAll ? 'not_all' : null);
      p.universal = {word: k, quantifier: quantWord ?? atLeast, variable, none: Boolean(quantWord && NONE.has(quantWord.folded)), role, words: quantifier};
      for (const r of kids(k, 'acl:relcl', 'acl')) if (isClausal(r)) p.relatives.push({noun: k, clause: r, variable, role, restriction: true});
      return;
    }
    // Indefinite ("anyone working at X", "vreun om care …") and relative clauses in a question: a shared variable (C9).
    const relatives = kids(k, 'acl:relcl', 'acl').filter(isClausal);
    const indefinite = INDEFINITE.has(k.folded) || det.some(d => INDEFINITE_DET.has(d.folded) && (relatives.length || p.existential));
    if (query && (indefinite || (relatives.length && !predicate))) {
      const variable = query.variable(indefinite ? 'x' : 'p');
      p.roles.push({name: role, value: variable, word: k});
      for (const r of relatives) p.relatives.push({noun: k, clause: r, variable, role});
      if (NONE.has(k.folded)) p.negatedExistence = true;
      if (!relatives.length && !indefinite) p.leftovers.push([k, hintFor(role)]);
      return;
    }
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
      || (predicate && ['advmod', 'obl', 'expl'].includes(base(c.deprel))) || (['conj', 'cc'].includes(base(c.deprel)) && c.head === k.id && !(base(c.deprel) === 'conj' ? sameEntity(S, k, c) : c.text === '&' || kids(k, 'conj').some(x => x.id > c.id && sameEntity(S, k, x)))) || (base(c.deprel) === 'acl' && isClausal(c) && kids(c, 'nsubj').length > 0);
    const words = subtree(k, skip);
    const full = spanText(this.message, subtree(k, c => (skipCase && cases.has(c.id)) || ['acl:relcl', 'advcl', 'parataxis'].includes(c.deprel)));
    // English "my X" → "the user's X".
    const possessive = words.find(w => FIRST_POSSESSIVE.has(w.folded) && ['nmod:poss', 'det:poss', 'det'].includes(w.deprel) && w.head === k.id && S.language !== 'ro');
    if (possessive) {
      const rest = spanText(this.message, words.filter(w => w !== possessive));
      return {value: rest ? "the user's " + rest : 'the user', full, derived: true};
    }
    // A third-person pronoun with one earlier named person resolves to it (a single possible antecedent).
    if (k.upos === 'PRON' && THIRD_PERSON.has(k.folded) && ['nsubj', 'obj', 'iobj', 'obl', 'nsubj:pass'].includes(k.deprel)) {
      const people = [...new Set(this.people.filter(Boolean))];
      if (people.length === 1) return {value: people[0], full: people[0], resolved: true};
      if (people.length > 1) {
        const chosen = people.at(-1);
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
    if (ctx.certainty === 'asserted' && !ctx.speaker && this.isRemark(h, p)) { this.notes.push('remark dropped: ' + p.relation); return null; }
    if (!p.relation || !p.roles.length) {
      const words = subtree(h, k => ['conj', 'parataxis', 'advcl', 'punct'].includes(base(k.deprel)) && k !== h);
      this.unparsed(words, null, p.roles.length ? 'relation' : 'other', 'no proposition');
      return null;
    }
    const certainty = ctx.certainty === 'asserted' && p.hedged ? 'hedged' : ctx.certainty;
    const variants = p.coord ? p.coord.options.map(option => p.roles.map(r => (r.name === p.coord.role ? {...r, value: option} : r))) : [p.roles];
    const ids = [];
    for (const roles of variants) {
      const wire = {type: 'stated', id: this.id('s'), relation: p.relation, roles: roles.map(({name, value}) => ({name, value})), polarity: p.polarity, certainty, speaker: ctx.speaker ?? null, valid: {}, links: []};
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
      if (['da', 'give'].includes(k.lemmaFolded) && kids(k, 'ccomp').length && /^(dat fiind|given)/.test(fold(this.message.slice(Math.min(...subtree(k).map(w => w.start)), k.end + 8)))) { const inner = kids(k, 'ccomp')[0]; inner.connective = 'because'; k = inner; }
      const marker = [markText(k), ...kids(k, 'advmod').filter(a => ['when', 'while', 'once', 'cand', 'cind', 'whenever'].includes(a.folded)).map(a => a.folded)].filter(Boolean).join(' ').trim();
      const keyword = k.connective ?? CONNECTIVES[marker] ?? CONNECTIVES[marker.split(' ').slice(-2).join(' ')] ?? CONNECTIVES[marker.split(' ')[0]] ?? null;
      const certainty = ['if', 'unless', 'so_that'].includes(keyword) ? 'supposed' : (ctx.certainty === 'supposed' ? 'supposed' : 'asserted');
      const inherit = this.subjectOf(k) ? undefined : (keyword === 'so_that' || !marker || S.language === 'ro' ? p.roles.find(r => r.name === 'subject' && !isVariable(r.value)) : undefined);
      const sub = this.clause(k, S, {...ctx, as: 'stated', certainty, speaker: ctx.speaker, inherit: inherit ? {value: inherit.value, word: inherit.word} : undefined, wh: undefined});
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
    const nominal = ['NOUN', 'PROPN', 'NUM', 'PRON'].includes(h.upos) && !kids(h, 'cop', 'nsubj', 'aux').length;
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
      const role = kind === 'where_from' || moveFrom ? 'source' : kind === 'where_to' ? 'destination' : 'location';
      // A locative question keeps the locative preposition of the relation ("where does X live" → "live in").
      if (role === 'location' && !/\s(in|at|on|la|in|pe|din)$/.test(fold(p.relation)) && !/^(be|fi)$/.test(p.relation) && !/^(go|come|move|travel|merge|veni|muta|pleca|calatori|ajunge|get)/.test(p.heads[0].lemmaFolded)) p.relation += S.language === 'ro' ? ' în' : ' in';
      q.selectVar(addRole(role, q.variable('place')));
    } else if (['when', 'since_when', 'until_when', 'how_long'].includes(kind)) {
      q.selectVar(addRole('time', q.variable('t')));
      q.measure = {since_when: 'start', until_when: 'end', how_long: 'duration'}[kind] ?? (kind === 'when' ? p.aspect : null) ?? null;
    } else if (kind === 'how_many_times') { const t = addRole('time', q.variable('t')); q.count(t); }
    else if (kind === 'how' && !existingVar) q.selectVar(addRole('instrument', q.variable('how')));
    else if ((kind === 'how_much' || kind === 'how_many') && !existingVar) q.count(addRole('object', q.variable('x')));
    // A time on a question is its period.
    for (const t of p.times) {
      if (q.during || q.at) { this.unparsed(t.words, null, 'time', 'second time expression'); continue; }
      if (['from', 'until'].includes(t.form)) { t.pending = true; continue; }
      // A day ("on 3 March", "pe 01.06.2018") is a point in time; a year, month or range is a period.
      if (['on', 'at', 'pe', 'la'].includes(t.prep) || /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b\d{1,2}(st|nd|rd|th)?\s+\p{L}+\s+\d{4}\b|\b\p{L}+\s+\d{1,2},?\s+\d{4}\b/u.test(t.text)) q.at = t.text; else q.during = t.text;
    }
    if (p.rank && p.rankVar) q.rank = [p.rank, p.rankVar];
    q.compares.push(...p.compares);
    q.excepts.push(...p.excepts.filter(Boolean), ...(ctx.excepts ?? []));
    const main = {relation: p.relation, roles: p.roles.map(({name, value}) => ({name, value})), polarity: p.polarity};
    // Existential questions ("is there anyone who …", "e vreun om care …"): the relative clauses are the question.
    if (p.existential) {
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
    if (p.coord && p.coord.or) for (const option of p.coord.options) variants.push(option);
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
    for (const t of p.times.filter(t => t.pending)) this.unparsed(t.words, ids[0], 'time', 'query period ' + t.form);
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
      for (const [k, hint] of p.leftovers) this.unparsed(subtree(k), null, hint, 'relative clause leftover');
      out.push({relation: p.relation, roles: kept.slice(0, 4).map(({name, value}) => ({name, value})), polarity: p.polarity});
    }
    return out;
  }

  /** The restriction of a universal question: the quantified noun's relative clause, its "of/at X", or the noun. */
  restriction(u, S, ctx, q) {
    const noun = u.word;
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
    if (nmod) {
      const prep = caseText(nmod);
      const siblings = kids(noun, 'nmod').filter(n => n !== nmod && sameEntity(S, nmod, n));
      const value = siblings.length ? spanText(this.message, [nmod, ...siblings].flatMap(n => subtree(n)).filter(w => !caseWords(nmod).includes(w))) : this.value(nmod, S, ctx).value;
      for (const n of siblings) n.used = true;
      const role = this.prepRole(prep, nmod, S, []);
      return [{relation: [en ? 'be' : 'fi', head, prep].filter(Boolean).join(' '), roles: [{name: 'subject', value: u.variable}, {name: role, value}], polarity: 'affirmed'}];
    }
    return [{relation: [en ? 'be' : 'fi', head || (en ? 'someone' : 'cineva')].join(' '), roles: [{name: 'subject', value: u.variable}], polarity: 'affirmed'}];
  }
}

/** Variables and question fields of one query under construction. */
class QueryBuilder {
  constructor() { Object.assign(this, {names: new Set(), select: [], mode: null, measure: null, blocks: [], scope: null, during: null, at: null, quantifier: null, compares: [], excepts: [], rank: null, order: null}); }
  variable(name) { let v = '?' + name, i = 2; while (this.names.has(v)) v = '?' + name + i++; this.names.add(v); return v; }
  selectVar(v) { if (!this.select.includes(v)) this.select.push(v); }
  count(v) { this.mode = 'count'; this.select = [v]; }
  wire(id) {
    const blocks = this.blocks.map(b => ({relation: b.relation, polarity: b.polarity, roles: b.roles.filter(r => r.value !== undefined && r.value !== '')}));
    const scope = this.scope ? {relation: this.scope.relation, polarity: this.scope.polarity, roles: this.scope.roles.filter(r => r.value !== undefined && r.value !== '')} : null;
    const used = new Set([...blocks, scope].filter(Boolean).flatMap(b => b.roles.map(r => r.value)).filter(isVariable));
    let select = this.mode === 'explain' || this.mode === 'every' ? [] : this.select.filter(v => used.has(v)).slice(0, 1);
    const compares = this.compares.filter(([v]) => used.has(v));
    const excepts = select.length ? this.excepts.map(value => [select[0], value]) : [];
    const rank = this.rank && used.has(this.rank[1]) ? this.rank : null;
    const mode = this.mode === 'count' && !select.length ? null : this.mode ?? (select.length ? null : used.size ? 'exists' : null);
    if (mode === 'count' && !select.length) select = [];
    return {type: 'query', id, mode, quantifier: mode === 'every' ? this.quantifier : null, select, measure: select.length && this.measure ? this.measure : null, blocks, scope: mode === 'every' ? scope : null,
      during: this.during, at: this.at, compares, excepts, rank, order: this.order, links: []};
  }
}

/** Is the message unintelligible (C12 `gibberish`)? Most alphabetic words unknown to the parser, or untaggable. */
export function isGibberish(parse) {
  const words = (parse.sentences ?? []).flatMap(s => s.words).filter(w => /\p{L}/u.test(w.text));
  if (!words.length) return !/\p{N}/u.test(parse.text ?? '');
  const unknown = words.filter(w => w.oov).length / words.length;
  const untagged = words.filter(w => w.upos === 'X').length / words.length;
  const anyVerb = words.some(w => ['VERB', 'AUX'].includes(w.upos) && !w.oov);
  return unknown >= 0.75 || untagged >= 0.5 || (unknown >= 0.6 && !anyVerb && words.length <= 6);
}

export {rangeOf};
