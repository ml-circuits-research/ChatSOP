/**
 * Meaning comparison of two English texts by their grammatical analyses (DS016 "Analysis comparison"): a fast,
 * deterministic pre-judge that is cheaper than the LLM meaning judge. `compareAnalyses(a, b)` takes two compact
 * analyses (SymbolicLM `analysis`: sentences of rows [id, form, lemma, upos, head, deprel]; parse with
 * `SymbolicLM.analyzeMany`, see tools/eval/analysis-compare.mjs) and returns
 *   {verdict: 'equivalent' | 'different' | 'uncertain', reasons, checks, tripleF1, voiceChange, ...}.
 * `different` needs a failed core check (names, numbers, polarity, quantifiers, question type, subject/object roles,
 * logical connectives); `equivalent` needs every core check plus the same main predicate lemmas, the same sentence
 * count and a dependency-triple F1 of at least `minTripleF1`; everything else is `uncertain` (different predicate lemmas
 * that might be synonyms, a different sentence count, a low triple F1, a missing parse). Voice is normalised
 * (passive subject = object, agent = subject) and reported, never penalised. It never replaces the LLM judge for
 * `different`/`uncertain`; it only lets a confident `equivalent` skip it.
 */
import {featuresOf} from './analysis-features.mjs';
import {createSynonymOracle} from './synonyms.mjs';
import {defaultDictionary} from '../../sop/dictionary.mjs';

export const ANALYSIS_COMPARE_VERSION = 'analysis-compare-v1';
export const DEFAULTS = Object.freeze({minTripleF1: 0.6, synonymPolicy: 'uncertain', checks: Object.freeze(['names', 'numbers', 'polarity', 'quantifiers', 'question', 'roles', 'connectives'])});

let oracle = null;
/** The default synonym oracle: WordNet 3.0 cache plus the reviewed dictionary (memoised; load about 1 s). */
export function defaultSynonyms() {
  if (!oracle) { let dictionary = null; try { dictionary = defaultDictionary(); } catch { /* optional */ } oracle = createSynonymOracle({dictionary}); }
  return oracle;
}

/** Connectives whose loss or change is a meaning change; `because` and `but` are often dropped by a legitimate rewrite and only make the pair uncertain. */
const STRONG_CONNECTIVES = new Set(['or', 'although', 'unless', 'before', 'after', 'until', 'if']);
const count = list => { const m = new Map(); for (const x of list) m.set(x, (m.get(x) ?? 0) + 1); return m; };
/** Multiset difference {onlyA, onlyB, common}. */
export function multisetDiff(a, b) {
  const ca = count(a), cb = count(b);
  const onlyA = [], onlyB = [];
  let common = 0;
  for (const [k, n] of ca) { const m = cb.get(k) ?? 0; common += Math.min(n, m); for (let i = m; i < n; i++) onlyA.push(k); }
  for (const [k, m] of cb) { const n = ca.get(k) ?? 0; for (let i = n; i < m; i++) onlyB.push(k); }
  return {onlyA, onlyB, common};
}
const f1Of = (a, b) => {
  if (!a.length && !b.length) return {precision: 1, recall: 1, f1: 1, common: 0, a: 0, b: 0};
  const {common} = multisetDiff(a, b);
  const precision = b.length ? common / b.length : 0, recall = a.length ? common / a.length : 0;
  return {precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0, common, a: a.length, b: b.length};
};

/** Map predicate lemmas of B onto synonymous, unmatched predicate lemmas of A; returns the map and the unmatched lists. */
function matchPredicates(fa, fb, areSynonyms) {
  const la = [...fa.predicates.keys()], lb = [...fb.predicates.keys()];
  const exactA = la.filter(l => !fb.predicates.has(l)), exactB = lb.filter(l => !fa.predicates.has(l));
  const map = new Map();
  const usedA = new Set();
  for (const y of exactB) {
    const x = exactA.find(c => !usedA.has(c) && areSynonyms(c, y));
    if (x) { map.set(y, x); usedA.add(x); }
  }
  return {map, onlyA: exactA, onlyB: exactB, unmatchedA: exactA.filter(x => !usedA.has(x)), unmatchedB: exactB.filter(y => !map.has(y))};
}

const show = list => list.slice(0, 6).join(', ');
const swapOf = (A, B) => {
  const hit = [];
  for (const x of A.subj) if (B.obj.has(x) && !B.subj.has(x)) hit.push(x);
  for (const x of A.obj) if (B.subj.has(x) && !B.obj.has(x)) hit.push(x);
  return hit;
};

/**
 * Compare two compact analyses. Options: `synonyms` (areSynonyms(a, b) oracle; default WordNet plus dictionary; `false`
 * disables), `synonymPolicy` (`uncertain`: a predicate set equal only under synonyms stays uncertain; `accept`: it is
 * equivalent), `minTripleF1`, `checks` (the core checks that can make a pair `different`).
 */
export function compareAnalyses(analysisA, analysisB, options = {}) {
  const {minTripleF1 = DEFAULTS.minTripleF1, synonymPolicy = DEFAULTS.synonymPolicy, checks: enabled = DEFAULTS.checks} = options;
  if (!analysisA?.sentences?.length || !analysisB?.sentences?.length) return {verdict: 'uncertain', reasons: ['missing_parse'], checks: {}, tripleF1: null, tripleF1Synonym: null, voiceChange: [], version: ANALYSIS_COMPARE_VERSION};
  const areSynonyms = options.synonyms === false ? () => false : options.synonyms ?? defaultSynonyms();
  const fa = options.featuresA ?? featuresOf(analysisA, options.textA ?? null), fb = options.featuresB ?? featuresOf(analysisB, options.textB ?? null);
  const match = matchPredicates(fa, fb, areSynonyms);
  const canon = l => match.map.get(l) ?? l;
  const reasons = [], ok = {};

  // core checks
  const names0 = multisetDiff(fa.names, fb.names);
  // a name that the other text only has in lower case (the output lower-cases a title) is the same name
  const names = {onlyA: names0.onlyA.filter(n => !fb.lowerForms.has(n)), onlyB: names0.onlyB.filter(n => !fa.lowerForms.has(n))}; // distinct names: a repeated mention may be dropped or pronominalised
  ok.names = !names.onlyA.length && !names.onlyB.length;
  if (!ok.names) reasons.push(`names: only in a [${show(names.onlyA)}], only in b [${show(names.onlyB)}]`);
  const numbers = multisetDiff([...new Set(fa.numbers)], [...new Set(fb.numbers)]);
  ok.numbers = !numbers.onlyA.length && !numbers.onlyB.length;
  if (!ok.numbers) reasons.push(`numbers: only in a [${show(numbers.onlyA)}], only in b [${show(numbers.onlyB)}]`);

  const flips = [];
  for (const [lemma, pb] of fb.predicates) { const pa = fa.predicates.get(canon(lemma)); if (pa && pa.neg !== pb.neg) flips.push(lemma); }
  ok.polarity = !flips.length && fa.negated === fb.negated;
  if (flips.length) reasons.push(`polarity: negation differs on predicate [${show(flips)}]`);
  else if (fa.negated !== fb.negated) reasons.push(`polarity: negation only in ${fa.negated ? 'a' : 'b'}`);

  const quant = multisetDiff(fa.quantifiers, fb.quantifiers);
  ok.quantifiers = !quant.onlyA.length && !quant.onlyB.length;
  if (!ok.quantifiers) reasons.push(`quantifiers: only in a [${show(quant.onlyA)}], only in b [${show(quant.onlyB)}]`);

  const qa = fa.question, qb = fb.question;
  const whMatch = (la, lb) => {
    const base = l => l.map(x => (x.startsWith('how ') ? 'how' : x)).sort();
    const {onlyA, onlyB} = multisetDiff(base(la), base(lb));
    // `what*` (which + unmapped noun) may stand for any other wh-word left over on the other side
    const wa = onlyA.filter(x => x !== 'what*'), wb = onlyB.filter(x => x !== 'what*');
    const starA = onlyA.length - wa.length, starB = onlyB.length - wb.length;
    return wa.length <= starB && wb.length <= starA && (!wa.length || starB >= wa.length) && (!wb.length || starA >= wb.length);
  };
  const subtypes = l => l.filter(x => x.startsWith('how ')).sort().join();
  const subA = subtypes(qa.wh), subB = subtypes(qb.wh);
  ok.question = qa.asks === qb.asks && qa.yn === qb.yn && whMatch(qa.wh, qb.wh) && (!subA || !subB || subA === subB);
  if (!ok.question) reasons.push(`question: a is ${qa.asks ? (qa.wh.length ? 'wh ' + qa.wh.join('+') : 'yes/no') : 'not a question'}, b is ${qb.asks ? (qb.wh.length ? 'wh ' + qb.wh.join('+') : 'yes/no') : 'not a question'}`);

  const swaps = [];
  for (const [lemma, pb] of fb.predicates) { const pa = fa.predicates.get(canon(lemma)); if (pa) { const s = swapOf(pa, pb); if (s.length) swaps.push(`${lemma}: ${s.join(',')}`); } }
  const nameMoves = [];
  const shared = new Set([...fa.lemmas].filter(l => fb.lemmas.has(l)));
  const restrict = set => new Set([...set].filter(x => shared.has(x.split('|')[0])));
  // a name moved: its attachments (head|role|preposition) share nothing; report it when the same head gives it another role, or when another name took its place
  const moved = new Map();
  for (const [name, attA] of fa.nameAttach) {
    const attB = fb.nameAttach.get(name);
    if (!attB) continue;
    const ra = restrict(attA), rb = restrict(attB);
    if (ra.size && rb.size && ![...ra].some(x => rb.has(x))) moved.set(name, {ra, rb});
  }
  for (const [name, {ra, rb}] of moved) {
    const sameHeadOtherRole = [...ra].some(x => [...rb].some(y => x.split('|')[0] === y.split('|')[0]));
    const exchanged = [...moved].some(([other, o]) => other !== name && [...o.ra].some(x => rb.has(x)) && [...o.rb].some(y => ra.has(y)));
    if (sameHeadOtherRole || exchanged) nameMoves.push(`${name}: ${[...ra].join(' ')} -> ${[...rb].join(' ')}`);
  }
  // names under one head lemma are the same in both texts but grouped differently (swapped between two coordinated clauses)
  const la = fa.nameLayout, lb = fb.nameLayout;
  for (const [lemma, framesA] of la.frames) {
    const framesB = lb.frames.get(lemma);
    if (!framesB) continue;
    const union = frames => new Set(frames.flatMap(f => f.split(' ').map(p => p.split(':').at(-1).split('+')).flat()));
    const ua = union(framesA), ub = union(framesB);
    if (ua.size === ub.size && [...ua].every(x => ub.has(x)) && framesA.length === framesB.length && framesA.length > 1 && framesA.slice().sort().join('|') !== framesB.slice().sort().join('|')) nameMoves.push(`${lemma}: names regrouped`);
  }
  // the same names, sentence by sentence, in a different order (a swap across sentences)
  if (la.perSentence.length === lb.perSentence.length && la.perSentence.length > 1 && la.perSentence.join('|') !== lb.perSentence.join('|') && la.perSentence.slice().sort().join('|') === lb.perSentence.slice().sort().join('|')) nameMoves.push('names reordered across sentences');
  ok.roles = !swaps.length && !nameMoves.length;
  if (swaps.length) reasons.push(`roles: subject and object swapped for [${show(swaps)}]`);
  if (nameMoves.length) reasons.push(`roles: name attached elsewhere [${show(nameMoves)}]`);

  const conn = multisetDiff(fa.connectives, fb.connectives);
  const strongDiff = [...conn.onlyA, ...conn.onlyB].filter(c => STRONG_CONNECTIVES.has(c)), softDiff = [...conn.onlyA, ...conn.onlyB].filter(c => !STRONG_CONNECTIVES.has(c));
  ok.connectives = !strongDiff.length;
  if (strongDiff.length) reasons.push(`connectives: only in one text [${show(strongDiff)}]`);

  // soft checks
  ok.predicates = !match.onlyA.length && !match.onlyB.length;
  ok.predicatesSynonym = !match.unmatchedA.length && !match.unmatchedB.length;
  ok.sentences = fa.sentences === fb.sentences;
  const strictF1 = f1Of(fa.triples, fb.triples);
  const mapEntity = e => canon(e);
  const synF1 = f1Of(fa.triples, fb.triples.map(t => t.split('|').map(mapEntity).join('|')));
  const voiceChange = [];
  for (const [lemma, pb] of fb.predicates) { const pa = fa.predicates.get(canon(lemma)); if (pa && ((pa.passive && !pa.active && pb.active && !pb.passive) || (pb.passive && !pb.active && pa.active && !pa.passive))) voiceChange.push(lemma); }

  const failed = enabled.filter(c => !ok[c]);
  let verdict;
  if (failed.length) verdict = 'different';
  else {
    const soft = [];
    if (!ok.sentences) soft.push(`sentence_count: ${fa.sentences} vs ${fb.sentences}`);
    if (!ok.predicates) {
      if (ok.predicatesSynonym && synonymPolicy === 'accept') reasons.push(`predicates: synonym match [${match.onlyA.map(l => l).join(', ')}] ~ [${match.onlyB.join(', ')}]`);
      else soft.push(ok.predicatesSynonym ? `predicates: only synonyms [${show(match.onlyA)}] ~ [${show(match.onlyB)}]` : `predicates: only in a [${show(match.unmatchedA)}], only in b [${show(match.unmatchedB)}]`);
    }
    const prep = multisetDiff(fa.prepositions, fb.prepositions);
    if (prep.onlyA.length || prep.onlyB.length) soft.push(`prepositions: only in a [${show(prep.onlyA)}], only in b [${show(prep.onlyB)}]`);
    if (fa.pronouns.join() !== fb.pronouns.join()) soft.push(`pronouns: [${fa.pronouns}] vs [${fb.pronouns}]`);
    if (fa.tense.join() !== fb.tense.join()) soft.push(`tense_modality: [${fa.tense}] vs [${fb.tense}]`);
    const cw = {onlyA: fa.content.filter(x => !fb.content.includes(x)), onlyB: fb.content.filter(x => !fa.content.includes(x))};
    const unmatchedA = cw.onlyA.filter(x => !cw.onlyB.some(y => areSynonyms(x, y))), unmatchedB = cw.onlyB.filter(y => !cw.onlyA.some(x => areSynonyms(x, y)));
    if (unmatchedA.length || unmatchedB.length) soft.push(`content_words: only in a [${show(unmatchedA)}], only in b [${show(unmatchedB)}]`);
    const focus = multisetDiff(fa.focus, fb.focus);
    if (focus.onlyA.length || focus.onlyB.length) soft.push(`focus: only in a [${show(focus.onlyA)}], only in b [${show(focus.onlyB)}]`);
    if (!fa.hasPredicate && !fb.hasPredicate) soft.push('no_predicate: neither text has a predicate (fragment or gibberish)');
    if (fa.answerWords.join() !== fb.answerWords.join()) soft.push(`answer_word: [${fa.answerWords}] vs [${fb.answerWords}] (a rewrite that answers instead of rewriting)`);
    if (softDiff.length) soft.push(`connectives: only in one text [${show(softDiff)}]`);
    if (synF1.f1 < minTripleF1) soft.push(`triple_f1: ${synF1.f1.toFixed(2)} < ${minTripleF1}`);
    reasons.push(...soft);
    verdict = soft.length ? 'uncertain' : 'equivalent';
  }
  if (verdict === 'equivalent' && !reasons.length) reasons.push('all core checks pass, same predicates');
  return {
    verdict, reasons, failedChecks: failed, checks: ok,
    tripleF1: {...strictF1}, tripleF1Synonym: {...synF1},
    voiceChange, synonymMatched: [...match.map].map(([b, a]) => `${a}~${b}`),
    version: ANALYSIS_COMPARE_VERSION,
  };
}
