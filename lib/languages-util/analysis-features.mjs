/**
 * Comparable features of a grammatical analysis (DS016 "Analysis comparison"): the compact CoNLL-U-like analysis of
 * SymbolicLM (`compactAnalysis`: sentences of rows [id, form, lemma, upos, head, deprel]) is reduced to dependency triples,
 * proper names, numbers, quantifiers, negation cues, question type, connectives and the predicates with their
 * polarity and logical subject/object. Pure and deterministic: no parser, no IO. Logical roles: `nsubj:pass` counts as
 * object and `obl:agent` as subject, so an active and a passive sentence of one meaning give equal features (the
 * voice difference is reported, not penalised).
 */
export const FEATURES_VERSION = 'analysis-features-v1';

const set = s => new Set(s.split(/\s+/).filter(Boolean));
export const IGNORED_RELATIONS = set('punct det discourse aux aux:pass cop dep reparandum goeswith orphan vocative');
export const FILLERS = set('hello hi hey okay ok please well so just quick actually basically honestly really thanks thank sorry plus also then now anyway btw hmm oh yes background question hypothetically');
export const TITLES = set('mr mrs ms miss dr prof professor sir madam madame mx');
const NEG_WORDS = set("not n't never cannot nt nor");
const NONE_WORDS = set('no none nobody nothing nowhere neither');
const WH = {who: 'who', whom: 'who', whose: 'whose', what: 'what', which: 'what', where: 'where', when: 'when', why: 'why', how: 'how'};
const PERSON_PRONOUNS = set('i you we me us');
const WRAPPER_VERBS = set('tell ask know wonder let say verify check confirm want like need wish find determine see hope mind curious understand learn remember explain');
const WRAPPER_ADJ = set('true correct right sure curious certain possible');
const VERIFY_VERBS = set('verify check confirm determine validate');
const ASK_COMPLEMENT_VERBS = set('wonder ask know check see tell confirm verify determine find say understand learn curious sure idea');
const LIGHT_AUX = set('be do have will would shall should can could may might must');
const CONNECTIVES = {because: 'because', although: 'although', though: 'although', unless: 'unless', before: 'before', after: 'after', until: 'until', till: 'until', or: 'or', but: 'but', however: 'but', whereas: 'whereas'};
const QUANT_CLASS = {
  all: 'ALL', every: 'ALL', each: 'ALL', everyone: 'ALL', everybody: 'ALL', everything: 'ALL',
  most: 'MOST', some: 'SOME', any: 'SOME', someone: 'SOME', anyone: 'SOME', somebody: 'SOME', anybody: 'SOME', something: 'SOME', anything: 'SOME', somewhere: 'SOME', anywhere: 'SOME',
  no: 'NONE', none: 'NONE', nobody: 'NONE', nothing: 'NONE', nowhere: 'NONE', neither: 'NONE',
  few: 'FEW', many: 'MANY', several: 'SEVERAL', either: 'EITHER', half: 'HALF', only: 'ONLY', always: 'ALWAYS',
};
const BOUNDS = [['no', 'more', 'than'], ['no', 'less', 'than'], ['at', 'least'], ['at', 'most'], ['more', 'than'], ['less', 'than'], ['fewer', 'than'], ['up', 'to'], ['exactly'], ['not', 'all'], ['not', 'every'], ['not', 'everyone'], ['not', 'everybody'], ['not', 'everything']];
const ONES = {zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90};
const SCALES = {hundred: 100, thousand: 1e3, million: 1e6, billion: 1e9};
const THIRD_PERSON = set('he she they him her them his hers their theirs himself herself themselves');
const MODALS = {will: 'future', shall: 'future', would: 'would', should: 'should', can: 'can', could: 'can', may: 'may', might: 'may', must: 'must'};
const PAST_AUX = set('did was were had');
const CONTENT_SKIP = set('also just there here then too really very quite still even thing one way kind sort lot bit actually now again yet already only anyway please sure reason cause claim idea fact other apart besides except curiosity');
const INVERSION_AUX = set('do does did is are was were has have had can could will would should may might must shall');
const SEMANTIC_PREPOSITIONS = set('to from in on at for with before after until since during into onto over under between through against near behind about without');
const DATE_WORDS = set('january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday');
const DATE_WORD_ONLY_PROPER = set('may');

export const fold = text => String(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Build token objects with children for each sentence of a compact analysis. */
function sentencesOf(analysis) {
  return (analysis?.sentences ?? []).map(s => {
    const tokens = s.tokens.map(([id, form, lemma, upos, head, deprel]) => ({id, form: String(form), lower: String(form).toLowerCase(), lemma: String(lemma ?? form).toLowerCase(), upos, head, deprel: deprel ?? 'dep', kids: []}));
    const byId = new Map(tokens.map(t => [t.id, t]));
    for (const t of tokens) { t.parent = t.head ? byId.get(t.head) ?? null : null; t.parent?.kids.push(t); }
    return {text: s.text ?? tokens.map(t => t.form).join(' '), tokens, byId};
  });
}

const SENTENCE_STARTERS = new Set(['.', '?', '!', ':', '—', '–', '-', '"', '(', '“', ';']);
const isCapital = t => /^\p{Lu}/u.test(t.form);
/** Proper-name tokens: capitalised PROPN, or a capitalised word inside a sentence that the tagger missed (typos and odd parses move the tag, not the capital). */
export function nameTokens(sentence) {
  return sentence.tokens.filter((t, i) => {
    if (FILLERS.has(t.lower) || TITLES.has(t.lower.replace(/\.$/, '')) || t.upos === 'PUNCT' || t.form === 'I') return false;
    if (DATE_WORDS.has(t.lower)) return false;
    if (t.upos === 'PROPN') return isCapital(t);
    const prev = sentence.tokens[i - 1];
    const nextToken = sentence.tokens[i + 1];
    const initialName = i === 0 && isCapital(t) && ['ADJ', 'NOUN', 'X'].includes(t.upos) && nextToken?.upos === 'PROPN' && isCapital(nextToken);
    if (initialName) return true;
    return isCapital(t) && i > 0 && !SENTENCE_STARTERS.has(prev.form) && t.upos !== 'NUM' && !WH[t.lower] && t.upos !== 'DET' && t.upos !== 'PRON' && t.upos !== 'AUX' && t.upos !== 'ADP' && t.upos !== 'SCONJ' && t.upos !== 'CCONJ';
  });
}

/** Logical relation of an arc: passive subject counts as object, agent as subject. */
export function logicalRelation(deprel) {
  if (deprel === 'nsubj:pass' || deprel === 'csubj:pass') return 'obj';
  if (deprel === 'obl:agent') return 'nsubj';
  return deprel.replace(/^(obl|nmod|advcl|acl|nsubj|obj|iobj|csubj|ccomp|xcomp|conj|appos|compound|flat|advmod|amod|nummod|mark|case|cc|root|parataxis|expl|list)(:.*)?$/, '$1');
}

const isPredicateVerb = t => t.upos === 'VERB' && !['amod', 'compound', 'nmod', 'flat', 'fixed', 'compound:prt'].includes(t.deprel);
const hasCop = t => t.kids.some(k => k.deprel === 'cop');
const isPredicate = t => isPredicateVerb(t) || (hasCop(t) && ['ADJ', 'NOUN', 'PROPN', 'ADV', 'NUM', 'VERB', 'ADP'].includes(t.upos) && t.deprel !== 'amod') || (t.deprel === 'root' && t.upos === 'AUX' && !LIGHT_AUX.has(t.lemma));

function numbersOf(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const digits = t.lower.match(/\d+(?:[.,]\d+)*/g);
    if (digits) { for (const d of digits) out.push(String(Number(d.replace(/,(?=\d{3}\b)/g, '').replace(',', '.')))); continue; }
    if (t.upos === 'NUM' && (t.lower in ONES || t.lower in SCALES) && !(t.lower === 'one' && t.deprel !== 'nummod')) {
      let current = 0, total = 0, j = i;
      for (; j < tokens.length && (tokens[j].lower in ONES || tokens[j].lower in SCALES || tokens[j].lower === '-'); j++) {
        const w = tokens[j].lower;
        if (w in ONES) current += ONES[w];
        else if (w === 'hundred') current = (current || 1) * 100;
        else if (w in SCALES) { total += (current || 1) * SCALES[w]; current = 0; }
      }
      out.push(String(total + current));
      i = j - 1;
    } else if (DATE_WORDS.has(t.lower) && !(DATE_WORD_ONLY_PROPER.has(t.lower) && t.upos !== 'PROPN')) out.push('date:' + t.lower.slice(0, 3));
  }
  return out;
}

function quantifiersOf(tokens, negatedExplicit) {
  const out = [];
  const lowers = tokens.map(t => t.lower);
  const used = new Array(tokens.length).fill(false);
  for (const pattern of BOUNDS) {
    for (let i = 0; i + pattern.length <= lowers.length; i++) {
      if (pattern.every((w, k) => !used[i + k] && (lowers[i + k] === w || (w === 'not' && lowers[i + k] === "n't")))) {
        out.push(pattern.join('_').replace(/^not_(every\w*)$/, 'not_all'));
        pattern.forEach((_, k) => { used[i + k] = true; });
      }
    }
  }
  tokens.forEach((t, i) => {
    if (used[i] || t.upos === 'INTJ' || t.upos === 'PUNCT') return;
    const cls = QUANT_CLASS[t.lower];
    if (!cls) return;
    if (t.lower === 'each' && lowers[i + 1] === 'other') return;
    if (t.lower === 'any' && ['idea', 'chance', 'way'].includes(lowers[i + 1])) return;
    if (t.lower === 'either' && t.upos === 'ADV') return;
    out.push(cls);
  });
  return out.map(c => (negatedExplicit && c === 'SOME' ? 'NONE' : c)).sort();
}

const WH_NOUN_CLASS = {reason: 'why', cause: 'why', time: 'when', date: 'when', day: 'when', year: 'when', month: 'when', moment: 'when', place: 'where', town: 'where', city: 'where', country: 'where', location: 'where', person: 'who', people: 'who'};
const ASK_IMPERATIVES = set('name list identify state');

/** The wh-words of a sentence as classes (`how many`, `how long` keep their subtype); `what reason` counts as why, `which town` as where. */
function whOf(sentence) {
  const out = [];
  const questionLike = /\?/.test(sentence.text) || sentence.tokens.some(t => ASK_COMPLEMENT_VERBS.has(t.lemma) && (t.upos === 'VERB' || (t.lemma === 'idea' && t.upos === 'NOUN'))) || sentence.tokens.find(t => t.upos !== 'PUNCT' && !FILLERS.has(t.lower)) && WH[sentence.tokens.find(t => t.upos !== 'PUNCT' && !FILLERS.has(t.lower)).lower];
  if (!questionLike) return out;
  for (const t of sentence.tokens) {
    const cls = WH[t.lower];
    if (!cls || t.deprel === 'mark' || !['PRON', 'ADV', 'DET', 'ADJ'].includes(t.upos)) continue;
    // a wh-pronoun that is a direct dependent of a relative clause is not a question ("people who work"); one inside a larger wh-phrase ("how many times") is
    if (t.parent && (t.parent.deprel === 'acl:relcl' || t.parent.deprel === 'acl') && ['nsubj', 'obj', 'obl', 'advmod', 'nsubj:pass'].includes(t.deprel)) continue;
    const next = sentence.tokens[t.id];
    if (t.lower === 'how' && next && ['many', 'much', 'long', 'often', 'old', 'far', 'big'].includes(next.lower)) { out.push(`how ${next.lower}`); continue; }
    const noun = t.deprel === 'det' ? t.parent : t.kids.find(k => ['reason', 'cause'].includes(k.lemma)) ?? (t.parent && ['reason', 'cause'].includes(t.parent.lemma) ? t.parent : null);
    if (cls === 'what' && noun && WH_NOUN_CLASS[noun.lemma]) out.push(WH_NOUN_CLASS[noun.lemma]);
    else out.push(cls === 'what' && t.deprel === 'det' ? 'what*' : cls);
  }
  return out;
}

function questionOf(sentences) {
  const wh = [];
  let yn = 0, asks = false;
  for (const [index, s] of sentences.entries()) {
    const w = whOf(s);
    // the sentence splitter sometimes cuts a question in two ("Do you know how many times / Ms Hughes was absent?"): a piece after an unfinished one is a continuation
    const previous = sentences[index - 1];
    if (previous && !/[.?!:;]\s*$/.test(previous.text) && !w.length) continue;
    const imperativeAsk = s.tokens.find(t => t.upos === 'VERB' && t.deprel === 'root' && ASK_IMPERATIVES.has(t.lemma) && !t.kids.some(k => k.deprel === 'nsubj'));
    const verify = s.tokens.some(t => t.upos === 'VERB' && VERIFY_VERBS.has(t.lemma) && (!t.kids.some(k => k.deprel === 'nsubj') || t.kids.some(k => k.deprel === 'nsubj' && k.lower === 'you')));
    const first = s.tokens.find(t => t.upos !== 'PUNCT' && !FILLERS.has(t.lower));
    const second = first ? s.tokens[s.tokens.indexOf(first) + 1] : null;
    const inverted = first && ['AUX', 'VERB'].includes(first.upos) && INVERSION_AUX.has(first.lower) && second && ['PROPN', 'NOUN', 'PRON', 'DET'].includes(second.upos) && first.kids.some(k => k.deprel === 'nsubj' || k.deprel === 'nsubj:pass') || (first && INVERSION_AUX.has(first.lower) && first.upos === 'AUX' && second && ['PROPN', 'NOUN', 'PRON', 'DET'].includes(second.upos) && second.deprel.startsWith('nsubj'));
    // "Could you give me X?" is a request, not a yes/no question
    const request = s.tokens.some(t => MODALS[t.lower] === 'can' || t.lower === 'would' || t.lower === 'will') && s.tokens.some(t => t.lower === 'you' && t.deprel === 'nsubj') && !w.length && !s.tokens.some(t => t.lower === 'whether' || t.lower === 'if');
    const mark = /\?/.test(s.text) && !request || (!!inverted && !request);
    const whether = s.tokens.some(t => t.lower === 'whether' || (t.lower === 'if' && t.deprel === 'mark' && ['ccomp', 'csubj', 'xcomp'].includes(t.parent?.deprel)));
    if (w.length) { wh.push(...w); asks = true; }
    else if (imperativeAsk) { const obj = imperativeAsk.kids.find(k => k.deprel === 'obj'); wh.push(obj && WH_NOUN_CLASS[obj.lemma] ? WH_NOUN_CLASS[obj.lemma] : 'what*'); asks = true; }
    else if (mark || whether || verify) { yn++; asks = true; }
  }
  return {asks, wh: wh.sort(), yn: yn > 0};
}

const childrenOf = (t, rels) => t.kids.filter(k => rels.includes(k.deprel));
function argumentLemma(t) {
  if (t.upos === 'PRON' || t.upos === 'DET' || WH[t.lower] || t.kids.some(k => WH[k.lower] && ['det', 'advmod'].includes(k.deprel))) return null;
  return t.upos === 'PROPN' ? fold(t.form) : t.lemma;
}
/** Argument lemmas filling `rels` of a predicate, expanding coordination. */
function argumentsOf(p, rels) {
  const out = new Set();
  const add = t => { const l = argumentLemma(t); if (l) out.add(l); for (const c of t.kids.filter(k => k.deprel === 'conj')) add(c); };
  for (const k of p.kids) if (rels.includes(k.deprel)) add(k);
  return out;
}

function polarityOf(p) {
  if (p.kids.some(k => NEG_WORDS.has(k.lower) || NEG_WORDS.has(k.lemma))) return true;
  if (p.kids.some(k => k.deprel === 'aux' && (NEG_WORDS.has(k.lower)))) return true;
  for (const k of p.kids) if (/^(nsubj|obj|iobj|obl|nsubj:pass)/.test(k.deprel) && (NONE_WORDS.has(k.lower) || k.kids.some(g => NONE_WORDS.has(g.lower) && (g.deprel === 'det' || g.deprel === 'advmod')))) return true;
  return false;
}

function predicatesOf(sentences) {
  const preds = new Map();
  for (const s of sentences) for (const t of s.tokens) {
    if (!isPredicate(t) || t.upos === 'ADP') continue;
    const lemma = t.lemma;
    if (LIGHT_AUX.has(lemma) && t.upos === 'AUX') continue;
    if (WH[t.lower]) continue;
    const subj = childrenOf(t, ['nsubj']).find(k => true);
    const subjectIsPerson = subj && PERSON_PRONOUNS.has(subj.lower);
    if (WRAPPER_VERBS.has(lemma) && t.upos === 'VERB' && (!subj || subjectIsPerson) && t.deprel !== 'conj') continue;
    if (WRAPPER_VERBS.has(lemma) && t.upos === 'VERB' && subjectIsPerson) continue;
    if (WRAPPER_ADJ.has(lemma) && ['ADJ', 'ADV'].includes(t.upos)) continue;
    const entry = preds.get(lemma) ?? {lemma, neg: false, subj: new Set(), obj: new Set(), iobj: new Set(), tense: new Set(), passive: false, active: false, n: 0};
    for (const k of t.kids) if (['aux', 'aux:pass', 'cop'].includes(k.deprel)) { if (MODALS[k.lower]) entry.tense.add(MODALS[k.lower]); else if (PAST_AUX.has(k.lower)) entry.tense.add('past'); }
    entry.n++;
    const neg = polarityOf(t);
    entry.neg = entry.neg || neg;
    const passive = t.kids.some(k => k.deprel === 'nsubj:pass' || k.deprel === 'aux:pass' || k.deprel === 'obl:agent');
    if (passive) entry.passive = true; else entry.active = true;
    for (const l of argumentsOf(t, ['nsubj', 'obl:agent', 'csubj'])) entry.subj.add(l);
    for (const l of argumentsOf(t, ['obj', 'nsubj:pass'])) entry.obj.add(l);
    for (const l of argumentsOf(t, ['iobj'])) entry.iobj.add(l);
    // coordinated predicates share the subject of the first one
    if (t.deprel === 'conj' && t.parent && !entry.subj.size) for (const l of argumentsOf(t.parent, ['nsubj'])) entry.subj.add(l);
    preds.set(lemma, entry);
  }
  return preds;
}

/**
 * Name attachments: for each proper name the set of `head|role|preposition` where head is the word the name phrase hangs on
 * (through coordination), role is subj/obj/iobj/obl. A swap of two names keeps the
 * name set and changes these attachments,.
 */
function nameAttachments(sentences) {
  const out = new Map();
  for (const s of sentences) {
    const names = new Set(nameTokens(s));
    for (const t of s.tokens) {
      if (!names.has(t) || ['flat', 'compound', 'flat:name', 'appos'].includes(t.deprel)) continue;
      let node = t;
      while (node.deprel === 'conj' && node.parent) node = node.parent;
      const head = node.parent;
      if (!head) continue;
      const rel = logicalRelation(node.deprel);
      const cls = rel === 'nsubj' ? 'subj' : rel === 'obj' ? 'obj' : rel === 'iobj' ? 'iobj' : ['obl', 'nmod'].includes(rel) ? 'obl' : null;
      if (!cls) continue;
      const rawPrep = cls === 'obl' ? node.kids.find(k => k.deprel === 'case')?.lemma ?? '' : '';
      const prep = rawPrep === "'s" || rawPrep === 's' ? 'of' : rawPrep;
      for (const part of [t, ...t.kids.filter(k => names.has(k))]) {
        const name = fold(part.form).replace(/[^\p{L}\p{N}]/gu, '');
        const set = out.get(name) ?? new Set();
        set.add(`${head.lemma}|${cls}|${prep}`);
        out.set(name, set);
      }
    }
  }
  return out;
}

/** Per-sentence name sets in order, and per head lemma the multiset of name frames (one per head token: its name dependents with role and preposition). */
function nameLayout(sentences) {
  const perSentence = sentences.map(s => [...new Set(nameTokens(s).map(t => fold(t.form).replace(/[^\p{L}\p{N}]/gu, '')))].sort().join(' '));
  const frames = new Map();
  for (const s of sentences) {
    const names = new Set(nameTokens(s));
    for (const h of s.tokens) {
      const parts = [];
      for (const k of h.kids) {
        if (!names.has(k) || ['flat', 'compound', 'flat:name', 'appos'].includes(k.deprel)) continue;
        const rel = logicalRelation(k.deprel);
        const cls = rel === 'nsubj' ? 'subj' : rel === 'obj' ? 'obj' : rel === 'iobj' ? 'iobj' : ['obl', 'nmod'].includes(rel) ? 'obl' : null;
        if (!cls) continue;
        const rawPrep = cls === 'obl' ? k.kids.find(x => x.deprel === 'case')?.lemma ?? '' : '';
        const prep = rawPrep === "'s" || rawPrep === 's' ? 'of' : rawPrep;
        parts.push(`${cls}:${prep}:${[k, ...k.kids.filter(x => names.has(x))].map(x => fold(x.form).replace(/[^\p{L}\p{N}]/gu, '')).sort().join('+')}`);
      }
      if (!parts.length) continue;
      const list = frames.get(h.lemma) ?? [];
      list.push(parts.sort().join(' '));
      frames.set(h.lemma, list);
    }
  }
  return {perSentence, frames};
}

const FOCUS = set('also only even merely');
function focusOf(tokens) {
  return [...new Set(tokens.filter(t => FOCUS.has(t.lower) && t.parent).map(t => `${t.lower}|${t.parent.upos === 'PROPN' ? fold(t.parent.form) : t.parent.lemma}`))].sort();
}

export function tripleList(sentences) {
  const out = [];
  for (const s of sentences) for (const t of s.tokens) {
    if (!t.parent || IGNORED_RELATIONS.has(t.deprel) || FILLERS.has(t.lemma) || FILLERS.has(t.parent.lemma)) continue;
    if (t.upos === 'PUNCT' || t.upos === 'PART' && t.lemma === 'to') continue;
    const ent = x => (x.upos === 'PROPN' ? fold(x.form) : x.lemma);
    out.push(`${ent(t.parent)}|${logicalRelation(t.deprel)}|${ent(t)}`);
  }
  return out;
}

/** Numbers and date words of the raw text: SymbolicLM masks lead-ins such as "As of 3 October 2025," before parsing, so the analysis cannot see them. */
export function rawNumbers(text) {
  const out = [];
  for (const d of String(text ?? '').match(/\d+(?:[.,]\d+)*/g) ?? []) out.push(String(Number(d.replace(/,(?=\d{3}\b)/g, '').replace(',', '.'))));
  for (const w of String(text ?? '').toLowerCase().match(/\p{L}+/gu) ?? []) if (DATE_WORDS.has(w) && !(w === 'may' && !/\bMay\b/.test(text))) out.push('date:' + w.slice(0, 3));
  return out;
}

/** The comparable features of a compact analysis; `text` (the raw text it came from) adds the numbers of masked lead-ins. */
export function featuresOf(analysis, text = null) {
  const sentences = sentencesOf(analysis);
  const tokens = sentences.flatMap(s => s.tokens);
  const names = [...new Set(sentences.flatMap(nameTokens).map(t => fold(t.form).replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean))].sort();
  const negCues = tokens.filter(t => (NEG_WORDS.has(t.lower) || NEG_WORDS.has(t.lemma)) && t.upos !== 'PUNCT').length;
  const noneCues = tokens.filter(t => NONE_WORDS.has(t.lower) && t.upos !== 'INTJ').length;
  const connectives = [];
  for (const t of tokens) {
    let c = CONNECTIVES[t.lower];
    if (t.lower === 'if' && t.deprel === 'mark' && t.parent?.deprel === 'advcl') c = 'if';
    if (c && t.deprel !== 'compound:prt' && (t.upos === 'SCONJ' || t.upos === 'CCONJ' || t.upos === 'ADP' || t.upos === 'ADV')) connectives.push(c);
  }
  const question = questionOf(sentences);
  // "Check this:" and "Verify that" lead-ins are masked before parsing; in the raw text they make the message a yes/no check
  if (text !== null && !question.asks && /(^|[.!?:—]\s*)(check|verify|confirm|true or false|is (this|that|it) (correct|true|right))\b/i.test(text)) { question.asks = true; question.yn = true; }
  const predicates = predicatesOf(sentences);
  return {
    version: FEATURES_VERSION,
    sentences: sentences.length,
    triples: tripleList(sentences),
    names,
    numbers: [...new Set([...numbersOf(tokens), ...(text === null ? [] : rawNumbers(text))])].sort(),
    quantifiers: quantifiersOf(tokens, negCues > 0),
    negated: negCues + noneCues > 0,
    negCues: negCues + noneCues,
    question,
    connectives: connectives.sort(),
    predicates,
    nameAttach: nameAttachments(sentences),
    focus: focusOf(tokens),
    nameLayout: nameLayout(sentences),
    hasPredicate: predicates.size > 0,
    answerWords: tokens.filter(t => t.upos === 'INTJ' && ['yes', 'no', 'yeah', 'yep', 'nope'].includes(t.lower)).map(t => t.lower).sort(),
    lowerForms: new Set(tokens.filter(t => /^\p{Ll}/u.test(t.form)).map(t => fold(t.form).replace(/[^\p{L}\p{N}]/gu, ''))),
    lemmas: new Set(tokens.filter(t => t.upos !== 'PUNCT').map(t => (t.upos === 'PROPN' ? fold(t.form) : t.lemma))),
    passive: [...predicates.values()].some(p => p.passive),
    prepositions: tokens.filter(t => t.upos === 'ADP' && t.deprel === 'case' && SEMANTIC_PREPOSITIONS.has(t.lemma)).map(t => t.lemma).sort(),
    pronouns: [...new Set(tokens.filter(t => THIRD_PERSON.has(t.lower)).map(t => ({him: 'he', his: 'he', himself: 'he', her: 'she', hers: 'she', herself: 'she', them: 'they', their: 'they', theirs: 'they', themselves: 'they'}[t.lower] ?? t.lower)))].sort(),
    tense: [...new Set([...predicates.values()].flatMap(p => [...p.tense]))].sort(),
    content: [...new Set(tokens.filter(t => ['NOUN', 'VERB', 'ADJ', 'ADV'].includes(t.upos) && !FILLERS.has(t.lemma) && !CONTENT_SKIP.has(t.lemma) && !WH[t.lower] && !LIGHT_AUX.has(t.lemma) && !WRAPPER_VERBS.has(t.lemma) && !WRAPPER_ADJ.has(t.lemma) && !NEG_WORDS.has(t.lower) && !QUANT_CLASS[t.lower] && t.deprel !== 'discourse' && !(t.upos === 'VERB' && ASK_IMPERATIVES.has(t.lemma) && !t.kids.some(k => k.deprel === 'nsubj'))).map(t => t.lemma))].sort(),
  };
}
