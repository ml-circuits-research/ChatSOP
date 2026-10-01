/**
 * Measure question forms of the UD -> SOP rules (owner priority 2026-10-01; no version number, the rules were frozen the same day): superlatives, ordinals, comparative
 * choices and age at death, and the nested noun phrases of a multi-hop question. The rules read the UD tree (degree
 * features, lemmas, function words) and write the message's own words; which measure "large" or "populous" stands for
 * is knowledge (the lexemes of the memory), never decided here. English only.
 *
 *   superlative  "What is the largest country in Europe?", "Which city has the biggest population?", "Who is the tallest
 *                player of the team?" -> one query: the class of the noun (`be a`), its restriction (`be in`), the
 *                attribute match (`be large` with a value variable, or `population of` for "has the biggest population")
 *                and `rank highest|lowest ?v`;
 *   ordinal      "the second largest country in Asia" -> the same with `rank highest ?v position 2`;
 *   choice       "Which is bigger, Canada or Brazil?", "Which city is more populous, Rome or Madrid?" -> the attribute
 *                match, `compare any` over the options and `rank`;
 *   age          "How old was Ana when she died?", "At what age did Ana die?" -> `relation "die at the age of"` with the
 *                age as the object (the knowledge derives it from the birth and death dates);
 *   nested       "the director of Inception", "the country where Einstein was born" as the argument of a question ->
 *                an inner query whose answers (`$q`) are the argument (`nestDescriptions`).
 */
import {kids, subtree, spanText} from './tree.mjs';

const ORDINALS = new Map(Object.entries({second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10}));
/** Adjectives whose superlative asks for the lowest value of the measure. */
const LOWEST = new Set(['small', 'short', 'young', 'low', 'light', 'narrow', 'cheap', 'little', 'slow', 'weak', 'shallow', 'thin', 'few', 'near', 'close']);
const DEATH_VERBS = new Set(['die', 'pass', 'perish']);
const MODAL_AUX = new Set(['can', 'could', 'will', 'would', 'should', 'may', 'might', 'must', 'shall']);
const WH_PRONOUNS = new Set(['what', 'who', 'which']);
const GENERIC_NOUNS = new Set(['one', 'thing', 'person', 'place']);

const isWhDet = n => kids(n, 'det').some(d => ['which', 'what'].includes(d.folded) && d.id < n.id);
const isWhPronoun = w => WH_PRONOUNS.has(w.folded) && ['PRON', 'DET'].includes(w.upos);
const article = word => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/** The ordinal word of `words` ("second" -> 2), marking it used, or null. */
function ordinalOf(words) {
  for (const w of words) {
    const n = ORDINALS.get(w.folded) ?? (/^(\d+)(st|nd|rd|th)$/.test(w.folded) ? Number(w.folded.replace(/\D/g, '')) : null);
    if (n && n >= 2) { w.used = true; return n; }
  }
  return null;
}

/** The superlative reading of an adjective: {lemma, direction, n} or null. "the most populous", "the second largest". */
function superlative(adj) {
  if (adj.upos !== 'ADJ') return null;
  const advs = kids(adj, 'advmod');
  const degree = adj.feats?.Degree === 'Sup' ? 'est' : advs.find(x => ['most', 'least'].includes(x.folded) && x.feats?.Degree === 'Sup')?.folded ?? null;
  if (!degree) return null;
  const lemma = String(adj.lemma ?? adj.text).toLowerCase();
  if (!/^[a-z]+$/.test(lemma) || lemma === 'many' || lemma === 'much') return null;
  const flip = degree === 'least';
  const lowest = LOWEST.has(lemma) !== flip;
  const n = ordinalOf([...advs, ...kids(adj, 'amod', 'nummod')]);
  for (const x of advs) if (['most', 'least'].includes(x.folded)) x.used = true;
  adj.used = true;
  return {lemma, direction: lowest ? 'lowest' : 'highest', n};
}

const rankOf = (v, sup) => [sup.direction, v, ...(sup.n ? ['position', String(sup.n)] : [])];

/** The class phrase of a noun ("female director"): its non-degree modifiers and its lemma. */
function classPhrase(noun) {
  const mods = kids(noun, 'compound', 'amod').filter(m => !m.used && m.upos !== 'DET').sort((a, b) => a.id - b.id);
  for (const m of mods) m.used = true;
  return [...mods.map(m => m.text.toLowerCase()), String(noun.lemma ?? noun.text).toLowerCase()].join(' ');
}

/** Restriction blocks from the prepositional modifiers of `noun` ("in Europe") on the variable `x`. */
function restrictions(a, noun, S, ctx, x) {
  const out = [];
  for (const n of kids(noun, 'nmod', 'obl')) {
    const prep = kids(n, 'case').map(c => c.folded).join(' ');
    if (!prep || n.used) continue;
    const value = a.value(n, S, ctx, {skipCase: true}).value;
    if (!value) continue;
    out.push({relation: 'be ' + prep, roles: [{name: 'subject', value: x}, {name: a.prepRole(prep, n, S, ['be']), value}], polarity: 'affirmed'});
    for (const w of subtree(n)) w.used = true;
    for (const c of kids(n, 'case')) c.used = true;
  }
  return out;
}

/** A proposition shell with the fields of `Analysis.proposition()`. */
const shell = h => ({relation: '', roles: [], polarity: 'affirmed', times: [], subordinate: [], complements: [], relatives: [], leftovers: [], hedged: false, heads: [h], coord: null, whAdverbs: [], universal: null, phrase: null, aspect: null, compares: [], rank: null, excepts: [], extraBlocks: []});

/** The words of the whole question are consumed: the form accounts for every one of them. */
const consumeAll = (S, except = []) => { for (const w of S.words) if (!except.includes(w)) w.used = true; };

/**
 * Forms recognized before the generic question path. Returns `{p, mode: null}` (and sets `q.rank`, `q.options`, the selected
 * variable) or null.
 */
export function measureForm(a, h, S, ctx, q) {
  if (S.language === 'ro' || ctx.as !== 'query' || ctx.embedded) return null;
  return ageForm(a, h, S, ctx, q) ?? superlativeForm(a, h, S, ctx, q) ?? comparativeYesNo(a, h, S, ctx, q) ?? choiceForm(a, h, S, ctx, q);
}

/** "How old was X when she died?", "At what age did X die?" */
function ageForm(a, h, S, ctx, q) {
  let subject = null;
  if (h.lemmaFolded === 'old' && h.upos === 'ADJ' && kids(h, 'advmod').some(x => x.folded === 'how')) {
    const when = kids(h, 'advcl').find(c => kids(c, 'advmod', 'mark').some(m => m.folded === 'when') && DEATH_VERBS.has(c.lemmaFolded));
    subject = kids(h, 'nsubj')[0];
    if (!when || !subject) return null;
  } else if (DEATH_VERBS.has(h.lemmaFolded) && kids(h, 'obl').some(o => o.lemmaFolded === 'age' && isWhDet(o))) {
    subject = kids(h, 'nsubj', 'nsubj:pass')[0];
    if (!subject) return null;
  } else if (h.lemmaFolded === 'live' && h.upos === 'VERB' && !kids(h, 'obl', 'advcl', 'xcomp', 'ccomp', 'obj').filter(o => !(o.lemmaFolded === 'year' && kids(o, 'amod', 'advmod').some(m => m.folded === 'many'))).length
    && (kids(h, 'obj').some(o => o.lemmaFolded === 'year' && kids(o, 'amod', 'advmod').some(m => m.folded === 'many')) || kids(h, 'advmod').some(m => m.folded === 'long' && kids(m, 'advmod').some(w => w.folded === 'how')))) {
    // "How many years did X live?", "How long did X live?": the years lived (a bare "live" with nothing else asked)
    subject = kids(h, 'nsubj')[0];
    if (!subject || subject.upos === 'PRON') return null;
    const p = shell(h);
    const years = q.variable('years');
    q.selectVar(years);
    p.relation = 'live for';
    p.roles.push({name: 'subject', value: a.value(subject, S, ctx).value, word: subject}, {name: 'object', value: years});
    consumeAll(S);
    return {p, mode: null};
  } else return null;
  if (subject.upos === 'PRON') return null;
  const p = shell(h);
  const age = q.variable('age');
  q.selectVar(age);
  p.relation = 'die at the age of';
  p.roles.push({name: 'subject', value: a.value(subject, S, ctx).value, word: subject}, {name: 'object', value: age});
  consumeAll(S);
  return {p, mode: null};
}

/** The noun phrase of a copular superlative question: the nominal of "What/Which/Who is the ... N ..." (or null). */
function copularNoun(a, h, S) {
  const wh = [h, ...S.words.filter(w => w.head === h.id)].find(w => isWhPronoun(w) && (w === h || w.deprel === 'root'));
  if (wh) return kids(wh, 'nsubj').find(n => n.upos === 'NOUN') ?? null;
  // the tree repair may root the sentence at the noun: "What is the largest country in Europe?"
  if (h.upos === 'NOUN' && kids(h, 'cop').length && kids(h, 'nsubj').some(isWhPronoun)) return h;
  return null;
}

/** Does the adjective carry a superlative degree ("largest", "most populous")? No side effect. */
const isSuperlative = k => k.upos === 'ADJ' && (k.feats?.Degree === 'Sup' || kids(k, 'advmod').some(m => ['most', 'least'].includes(m.folded) && m.feats?.Degree === 'Sup'));

function superlativeForm(a, h, S, ctx, q) {
  // "Which country has the biggest area in Africa?": the measure is the object noun of "have"
  if (h.lemmaFolded === 'have' && h.upos === 'VERB') {
    const subject = kids(h, 'nsubj')[0];
    const object = kids(h, 'obj')[0];
    const adj = object && kids(object, 'amod').find(isSuperlative);
    if (!subject || !object || !adj || subject.upos !== 'NOUN' || !isWhDet(subject)) return null;
    const sup = superlative(adj);
    return sup ? buildSuperlative(a, h, S, ctx, q, {noun: subject, sup, measureNoun: object}) : null;
  }
  const noun = copularNoun(a, h, S);
  if (!noun || GENERIC_NOUNS.has(noun.lemmaFolded)) return null;
  const adj = kids(noun, 'amod').find(isSuperlative);
  const sup = adj ? superlative(adj) : null;
  return sup ? buildSuperlative(a, h, S, ctx, q, {noun, sup, measureNoun: null}) : null;
}

function buildSuperlative(a, h, S, ctx, q, {noun, sup, measureNoun}) {
  const p = shell(h);
  const x = q.variable('x'), v = q.variable('v');
  q.selectVar(x);
  if (measureNoun) {
    const m = String(measureNoun.lemma ?? measureNoun.text).toLowerCase();
    p.relation = `have ${article(m)} ${m} of`;
    p.roles.push({name: 'subject', value: x}, {name: 'object', value: v});
  } else {
    p.relation = 'be ' + sup.lemma;
    p.roles.push({name: 'subject', value: x}, {name: 'object', value: v});
  }
  const host = measureNoun ?? noun;
  p.extraBlocks.push({relation: 'be a', roles: [{name: 'subject', value: x}, {name: 'object', value: classPhrase(noun)}], polarity: 'affirmed'});
  p.extraBlocks.push(...restrictions(a, host, S, ctx, x));
  if (measureNoun && host !== noun) p.extraBlocks.push(...restrictions(a, noun, S, ctx, x));
  q.rank = rankOf(v, sup);
  consumeAll(S);
  return {p, mode: null};
}

/** Collective person nouns: "have people", "have residents" stay the relation phrase (the memory's lexemes know them as the population). */
const PEOPLE = new Set(['person', 'people', 'resident', 'inhabitant', 'citizen']);
const COMPARATIVE_LOWEST = new Set([...LOWEST, 'less', 'few', 'fewer']);

/** The relation of a measure noun held by the subject: "have people", "have an area of", "have a population of". */
function measureRelation(noun) {
  const lemma = String(noun.lemma ?? noun.text).toLowerCase();
  if (PEOPLE.has(lemma)) return 'have ' + noun.text.toLowerCase();
  return `have ${article(lemma)} ${lemma} of`;
}

/** The direction of a comparative word: "more", "larger", "greater" are above; "less", "fewer", "smaller" below. */
function lowerThan(comparative, lessWord) {
  const lemma = String(comparative.lemma ?? comparative.text).toLowerCase();
  return (COMPARATIVE_LOWEST.has(lemma) || COMPARATIVE_LOWEST.has(lemma.replace(/er$/, ''))) !== Boolean(lessWord);
}

const isCmp = k => k.upos === 'ADJ' && (k.feats?.Degree === 'Cmp' || ['more', 'less', 'fewer'].includes(k.folded));
const named = k => k && ['PROPN', 'NOUN'].includes(k.upos);

/** "Is Tokyo more populous than Seoul?", "Is Russia larger in area than Canada?", "Does Japan have more people than Germany?", "Does Indonesia exceed Pakistan in population?" -> two value matches and `compare ?a above|below ?b`. */
function comparativeYesNo(a, h, S, ctx, q) {
  const thanOf = k => kids(k, 'obl', 'advcl', 'nmod').find(o => kids(o, 'case', 'mark').some(c => c.folded === 'than'));
  let first = null, second = null, relation = null, lowest = false, words = [];
  if (h.upos === 'ADJ' && kids(h, 'cop').length) {
    const less = kids(h, 'advmod').find(m => ['more', 'less'].includes(m.folded));
    if (!(h.feats?.Degree === 'Cmp' || less)) return null;
    first = kids(h, 'nsubj')[0]; second = thanOf(h);
    if (!named(first) || !named(second)) return null;
    // a bare measure noun after "in" ("larger in area"); "in your view" is not one
    const via = kids(h, 'obl').find(o => o !== second && o.upos === 'NOUN' && kids(o, 'case').some(c => c.folded === 'in') && !kids(o, 'det', 'nmod:poss', 'det:poss', 'amod').length);
    relation = via ? measureRelation(via) : 'be ' + String(h.lemma ?? h.text).toLowerCase();
    lowest = lowerThan(h, less?.folded === 'less');
    words = [h, via, ...(less ? [less] : [])];
  } else if (h.lemmaFolded === 'have' && h.upos === 'VERB') {
    const object = kids(h, 'obj')[0];
    const cmp = object && kids(object, 'amod').find(isCmp);
    first = kids(h, 'nsubj')[0]; second = thanOf(h) ?? (object && thanOf(object));
    if (!cmp || !named(first) || !named(second) || isWhDet(first) || isWhPronoun(first)) return null;
    relation = measureRelation(object); lowest = lowerThan(cmp, false); words = [cmp, object];
  } else if (['exceed', 'surpass', 'outnumber', 'outweigh'].includes(h.lemmaFolded) && h.upos === 'VERB') {
    first = kids(h, 'nsubj')[0]; second = kids(h, 'obj')[0];
    const via = kids(h, 'obl').find(o => o.upos === 'NOUN' && kids(o, 'case').some(c => c.folded === 'in'));
    if (!named(first) || !named(second) || !via) return null;
    relation = measureRelation(via); words = [via];
  } else return null;
  // a modal or any other modifier is not part of the form: the generic path keeps its words (and the unparsed spans say what is left)
  const accounted = new Set([first, second, ...words].filter(Boolean));
  if (kids(h, 'aux').some(m => MODAL_AUX.has(m.folded)) || kids(h, 'obl', 'advcl', 'xcomp', 'ccomp', 'advmod', 'nmod').some(k => !accounted.has(k) && !(k.upos === 'ADV' && ['not', "n't"].includes(k.folded)))) return null;
  const p = shell(h);
  const x = q.variable('a'), y = q.variable('b');
  p.relation = relation;
  // role order as the v2.8 comparative ("older than"): the value first, then the subject
  p.roles.push({name: 'object', value: x}, {name: 'subject', value: a.value(first, S, ctx).value, word: first});
  p.extraBlocks.push({relation, roles: [{name: 'object', value: y}, {name: 'subject', value: a.value(second, S, ctx, {skipCase: true}).value}], polarity: 'affirmed'});
  q.compares.push([x, lowest ? 'below' : 'above', y]);
  q.mode = 'exists';
  void words;
  consumeAll(S);
  return {p, mode: 'exists'};
}

/** "Which is bigger, Canada or Brazil?", "Which city is more populous, Rome or Madrid?", "Who lived longer, A or B?", "Who was born first, A or B?" */
function choiceForm(a, h, S, ctx, q) {
  const cmpAdj = h.upos === 'ADJ' && (h.feats?.Degree === 'Cmp' || kids(h, 'advmod').some(m => ['more', 'less'].includes(m.folded)));
  const cmpVerb = h.upos === 'VERB' && h.lemmaFolded === 'live' && kids(h, 'advmod').some(m => m.folded === 'longer');
  const early = h.upos === 'VERB' && ['bear', 'die'].includes(h.lemmaFolded) ? kids(h, 'advmod').find(m => ['first', 'earlier', 'later', 'last'].includes(m.folded)) : null;
  // "Which country has more residents, A or B?", "Which has the greater area, A or B?", "Between A and B, which has more people?"
  const object = h.lemmaFolded === 'have' && h.upos === 'VERB' ? kids(h, 'obj')[0] : null;
  const measure = object ? kids(object, 'amod').find(isCmp) : null;
  if (!cmpAdj && !cmpVerb && !early && !measure) return null;
  const subject = kids(h, 'nsubj', 'nsubj:pass')[0];
  if (!subject || !(isWhPronoun(subject) || isWhDet(subject))) return null;
  const pairIn = k => k && named(k) && kids(k, 'conj').some(named);
  const first = [...kids(h, 'parataxis', 'appos', 'obl', 'conj', 'vocative'), ...(object ? kids(object, 'appos', 'conj', 'nmod') : [])].find(pairIn);
  if (!first) return null;
  const options = [first, ...kids(first, 'conj').filter(c => ['PROPN', 'NOUN'].includes(c.upos))].map(k => a.value(k, S, ctx, {skipCase: true}).value);
  if (options.length < 2 || options.some(o => !o)) return null;
  const p = shell(h);
  const x = q.variable('x'), v = q.variable('v');
  q.selectVar(x);
  let lowest;
  if (measure) {
    p.relation = measureRelation(object); lowest = lowerThan(measure, false);
    p.roles.push({name: 'subject', value: x}, {name: 'object', value: v});
  } else if (early) {
    // the time of the event is the compared value: "first" is the earliest
    p.relation = h.lemmaFolded === 'bear' ? 'be born' : 'die';
    lowest = ['first', 'earlier'].includes(early.folded);
    p.roles.push({name: 'subject', value: x}, {name: 'time', value: v});
  } else if (cmpVerb) { p.relation = 'live'; lowest = false; p.roles.push({name: 'subject', value: x}, {name: 'object', value: v}); }
  else {
    const lemma = String(h.lemma ?? h.text).toLowerCase();
    const lessMore = kids(h, 'advmod').find(m => ['more', 'less'].includes(m.folded));
    p.relation = 'be ' + lemma.replace(/^(.*)er$/, '$1').replace(/^bigg$/, 'big');
    lowest = (LOWEST.has(lemma.replace(/er$/, '')) || LOWEST.has(lemma)) !== (lessMore?.folded === 'less');
    p.roles.push({name: 'subject', value: x}, {name: 'object', value: v});
  }
  if (subject.upos === 'NOUN') p.extraBlocks.push({relation: 'be a', roles: [{name: 'subject', value: x}, {name: 'object', value: classPhrase(subject)}], polarity: 'affirmed'});
  q.rank = [lowest ? 'lowest' : 'highest', v];
  q.options = [x, options];
  consumeAll(S);
  return {p, mode: null};
}

/** Is `k` a definite description of another thing by a named one: "the director of Inception"? */
function genitiveOf(k) {
  if (!k || k.upos !== 'NOUN' || !kids(k, 'det').some(d => d.folded === 'the')) return null;
  // the target is a name (or itself such a description): "the plot of land" is one thing, not a function of "land"
  const of = kids(k, 'nmod').find(n => kids(n, 'case').some(c => c.folded === 'of') && (n.upos === 'PROPN' || genitiveOf(n)));
  return of ?? null;
}

/**
 * Nested descriptions of a question: an argument that is "the N of Y" (Y a name or itself such a description) or
 * "the N where P" becomes the answers of an inner query (`$q`), written first: "Where was the director of Inception
 * born?" asks who directed Inception, then where that person was born. Only arguments of a question clause with a
 * variable in it are nested; a statement keeps its noun phrase as one value (convention C9).
 */
export function nestDescriptions(a, p, h, S, ctx, q) {
  if (S.language === 'ro' || ctx.as !== 'query' || ctx.embedded || !q) return;
  // only a question that asks for something (a variable in its roles) has a missing link to chain; "Is Lin the author of X?" is one fact
  const relativeVariables = new Set(p.relatives.map(rel => rel.variable));
  if (!p.whAdverbs.length && !p.roles.some(r => String(r.value).startsWith('?') && !relativeVariables.has(r.value))) return;
  // "the country where Einstein was born": the relative clause is asked as a where-question, the noun is the class of its answer
  for (const rel of [...p.relatives]) {
    if (rel.noun.upos !== 'NOUN' || !kids(rel.clause, 'advmod').some(w => w.folded === 'where')) continue;
    const role = p.roles.find(r => r.value === rel.variable);
    if (!role) continue;
    const id = a.query(rel.clause, S, {...ctx, as: 'query', wh: undefined});
    const wire = id && a.wire(id);
    if (!wire || wire.select.length !== 1 || wire.blocks.length !== 1) continue;
    wire.blocks.push({relation: 'be a', roles: [{name: 'subject', value: wire.select[0]}, {name: 'object', value: classPhrase(rel.noun)}], polarity: 'affirmed'});
    p.relatives.splice(p.relatives.indexOf(rel), 1);
    role.value = '$' + id;
    role.word = null;
    for (const w of subtree(rel.clause)) w.used = true;
  }
  for (const role of p.roles) {
    const k = role.word;
    if (!k || typeof role.value !== 'string' || role.value.startsWith('?') || role.value.startsWith('$')) continue;
    const id = describe(a, k, S, ctx);
    if (id) { role.value = '$' + id; role.word = null; }
  }
}

/** Writes the inner query of a description and returns its id, or null. */
function describe(a, k, S, ctx) {
  const target = genitiveOf(k);
  if (target) {
    const inner = a.queryBuilder();
    const y = inner.variable('x');
    inner.selectVar(y);
    const value = nestedValue(a, target, S, ctx);
    if (!value) return null;
    const noun = String(k.lemma ?? k.text).toLowerCase();
    const mods = kids(k, 'compound', 'amod').filter(m => !m.used).sort((m, n) => m.id - n.id).map(m => m.text.toLowerCase());
    inner.blocks.push({relation: ['be', 'the', ...mods, noun, 'of'].join(' '), roles: [{name: 'subject', value: y}, {name: 'object', value}], polarity: 'affirmed'});
    const wire = inner.wire(a.id('q'));
    a.wires.push(wire);
    for (const w of subtree(k)) w.used = true;
    return wire.id;
  }
  return null;
}

/** The object of a description: a name, or the answers of a nested description. */
function nestedValue(a, target, S, ctx) {
  const deeper = describe(a, target, S, ctx);
  if (deeper) return '$' + deeper;
  return a.value(target, S, ctx, {skipCase: true}).value;
}
