/**
 * Interpretation CNL (DS021 "Interpretation CNL"): a deterministic realizer from SymbolicLM's grammatical analysis
 * (the compact UD parse stored in `analysis`: sentences of rows [id, form, lemma, upos, head, deprel]) to a controlled
 * English that states, in short sentences from a small fixed set of templates, what the analysis says.
 * No model, no parser, no I/O: pure functions of the analysis.
 *
 *   extractStructures(analysis)  -> {atoms, notRepresented, framing, notes}   predicate-argument structures per clause
 *   realize(structures)          -> {cnl, sentences}                          one CNL sentence per atom
 *   interpret(analysis)          -> {cnl, atoms, notRepresented, framing, notes, text}   "I understood: ..."
 *   roundTrip(source, cnlStructures) -> {pass, onlySource, onlyCnl, reasons}  structural equality (modulo the normalizations)
 *
 * A structure ("atom") is one clause: kind (statement, yn, wh, imperative), predicate lemma (+ particle), voice
 * normalized to active when the agent is present, tense and aspect, polarity, modal, subject, object, indirect object,
 * obliques with their preposition, a questioned role, a complement clause (`that`/`whether`), an infinitive
 * complement, adverbials and clause links (because, if, unless, although, before, after, when, while, since, until, ...).
 * The templates (see `renderClause`): `S V O.`, `S does not V O.`, `Does S V O?`, `Who V O?`, `Wh does S V?`,
 * `If A, then B.`, `B because A.`, `A, or B.`, `S says that A.`, `S is C.`, `There is C.`.
 * Names, numbers and quoted text are copied token for token. Request wrappers ("Can you confirm that", "Is it true that",
 * "Please find out whether") are not statements: they turn the wrapped clause into a question, and are listed as a
 * normalization. Relative clauses become separate statements about the head noun when that is equivalent (an affirmative
 * top-level statement, a head without a quantifier); otherwise they stay inline, copied. Coordinated subjects and objects
 * become separate sentences only for `and` in an affirmative top-level statement whose predicate is not collective or
 * reciprocal and that has no `together`/`both`/`each other`; every other coordination is kept inline, copied, and noted.
 * Every token the extraction does not use is reported as `not represented: "<span>"`, never dropped; the words of the
 * fixed framing list (please, thanks, also, okay, ...) are listed separately as `framing`.
 */
import {inflectVerb} from '../translator-service/backends/english.mjs';

export const ANALYSIS_CNL_VERSION = 'analysis-cnl-v1';

const set = s => new Set(s.split(/\s+/).filter(Boolean));
const WH = set('who whom whose what which where when why how');
const WH_ADV_ROLE = {where: 'place', when: 'time', why: 'reason', how: 'manner'};
const NEG = set("not n't nt never");
const MODAL_FORMS = set('can could may might must should would shall will cannot');
const LINKS = {because: 'because', if: 'if', unless: 'unless', although: 'although', though: 'although', before: 'before', after: 'after', when: 'when', while: 'while', since: 'since', until: 'until', till: 'until', once: 'once', whereas: 'whereas', whenever: 'when'};
const FRAMING = set('please thanks thank okay ok so also plus well just hello hi hey sorry actually anyway then hmm oh yes background hypothetically basically honestly');
const HEDGE_ADV = set('maybe perhaps probably possibly apparently allegedly supposedly');
const SENTENCE_FRAMING_ROOTS = set('thanks thank hello hi okay ok sorry bye cheers');
const ASK_VERBS = set('confirm check verify tell find know wonder ask see determine remind say mention clarify explain');
const DESIRE_VERBS = set('want need wish like');
const TRUTH_ADJ = set("true correct right sure certain");
const CHANCE_NOUNS = set('chance idea clue');
const COLLECTIVE = set('meet marry gather collaborate share compete resemble differ agree fight talk join cooperate unite combine split divorce');
const COLLECTIVE_WORDS = set('together both jointly respectively between');
const RECIPROCAL = set('each other');
const QUANT = set('every each all some any no none most few many several both either neither half only nobody nothing everyone everybody everything someone anyone somebody anybody something anything');
const MID_ADV = set('still always already often usually ever just really sometimes also soon');
const PARTICLE_ADV = set('back away out up down off over home along around in');
const PAST_AUX = set('was were had did');
const PRONOUN_NUMBER = {i: [1, 'Sing'], we: [1, 'Plur'], you: [2, 'Plur'], he: [3, 'Sing'], she: [3, 'Sing'], it: [3, 'Sing'], they: [3, 'Plur'], who: [3, 'Sing'], what: [3, 'Sing']};

/* ------------------------------------------------------------------ tokens and text */

const base = rel => String(rel ?? 'dep').split(':')[0];
const byId = (a, b) => a.id - b.id;

/** Token objects with kids for one sentence of a compact analysis. */
function prepSentence(s) {
  const tokens = s.tokens.map(([id, form, lemma, upos, head, deprel], i) => ({
    i, id, form: String(form), lower: String(form).toLowerCase(), lemma: String(lemma ?? form).toLowerCase(), upos, head, rel: deprel ?? 'dep', base: base(deprel), kids: [], used: false, framing: false,
  }));
  const map = new Map(tokens.map(t => [t.id, t]));
  for (const t of tokens) { t.parent = t.head ? map.get(t.head) ?? null : null; t.parent?.kids.push(t); }
  for (const t of tokens) t.kids.sort(byId);
  tokens.forEach((t, i) => { t.initial = i === 0 || [':', ';', '—', '–', '-'].includes(tokens[i - 1].form); });
  // whether a space preceded each token in the parsed text (keeps "Seo-yeon", "5,000", "o'clock" together)
  const text = String(s.text ?? '');
  let cursor = 0;
  for (const t of tokens) {
    const at = text.indexOf(t.form, cursor);
    if (at < 0 || at - cursor > 3) { t.space = null; continue; }
    t.space = /\s/.test(text.slice(cursor, at));
    cursor = at + t.form.length;
  }
  return {text: s.text, tokens, map, root: tokens.find(t => t.head === 0) ?? null};
}

const NO_SPACE_BEFORE = /^(?:[,.;:?!)\]%”’]|'s|’s|n't|'ll|'re|'ve|'d|'m)$/i;
const NO_SPACE_AFTER = /^[(\[“‘$€£]$/;
const lowerInitial = t => (t.initial && t.upos !== 'PROPN' && t.form !== 'I' && /^\p{Lu}\p{Ll}+$/u.test(t.form) ? t.form[0].toLowerCase() + t.form.slice(1) : t.form);
/** Join tokens into text (copy of the words, spacing rebuilt; a sentence-initial common word loses its capital). */
export function joinTokens(tokens) {
  let out = '', prev = null;
  for (const t of tokens) {
    const w = lowerInitial(t);
    const space = t.space === null || t.space === undefined ? !NO_SPACE_BEFORE.test(w) && !NO_SPACE_AFTER.test(prev ?? '') : t.space && !NO_SPACE_AFTER.test(prev ?? '') || (t.space === false && false);
    out += prev && (t.space === false && !/^[,.;:?!]$/.test(w) ? false : space) ? ' ' + w : w;
    prev = w;
  }
  return out.replace(/^[\s,;:]+|[\s,;]+$/g, '');
}
const use = (...ts) => ts.forEach(t => { if (t) t.used = true; });
const useAll = ts => ts.forEach(t => { t.used = true; });

/** Tokens of the subtree of `head` in order; `skip(child, parent)` removes a whole subtree. */
function collect(head, skip = () => false) {
  const out = [];
  const walk = t => { out.push(t); for (const k of t.kids) if (!skip(k, t)) walk(k); };
  walk(head);
  return out.sort(byId);
}
// A wh word inside a relative clause below the examined phrase is a relativizer, not a question word.
const underRelative = (t, tokens) => {
  const set = new Set(tokens);
  for (let p = t.parent; p && set.has(p); p = p.parent) if (p.rel === 'acl:relcl' && set.has(p.parent)) return true;
  return false;
};
const hasWhToken = tokens => tokens.some(t => WH.has(t.lower) && !underRelative(t, tokens) && (['PRON', 'DET', 'ADV', 'ADJ'].includes(t.upos) || (t.upos === 'SCONJ' && ['where', 'why', 'how'].includes(t.lower))));
// Words are copied with the capital of the source; a sentence-initial common word was already lower-cased by joinTokens, names keep theirs.
const lcFirst = text => text;
const ucFirst = text => text.replace(/^(\W*)(\p{L})/u, (m, a, b) => a + b.toUpperCase());

/* ------------------------------------------------------------------ noun phrases */

/**
 * A noun phrase: `text` copied from its tokens (everything under the head except the pieces the caller lifts out),
 * quantifiers, person and number (for agreement), and whether it holds a wh word.
 */
function makeNP(S, head, {skip = () => false, exclude = new Set()} = {}) {
  const tokens = collect(head, (k, p) => skip(k, p) || exclude.has(k));
  useAll(tokens);
  const quants = [...new Set(tokens.filter(t => QUANT.has(t.lower) && (t.base === 'det' || t === head || t.base === 'amod' || t.base === 'advmod' || t.base === 'nummod' || t.base === 'obl' || t.base === 'nmod')).map(t => t.lower))];
  const lower = head.lower;
  let person = 3, number = 'Sing';
  if (head.upos === 'PRON' && PRONOUN_NUMBER[lower]) [person, number] = PRONOUN_NUMBER[lower];
  else if (head.upos === 'NOUN' && head.lower !== head.lemma && /(?:s|ople|ren|men)$/.test(head.lower)) number = 'Plur';
  else if (tokens.some(t => ['many', 'several', 'few', 'both', 'all', 'most'].includes(t.lower) && t.parent === head)) number = 'Plur';
  else if (tokens.some(t => t.base === 'nummod' && t.parent === head && !/^(?:1|one)$/i.test(t.form))) number = 'Plur';
  const coordInline = tokens.some(t => t.base === 'conj' && t.parent === head);
  if (coordInline && tokens.some(t => t.base === 'cc' && /^(?:and|&)$/i.test(t.form) && t.parent?.parent === head)) number = 'Plur';
  return {text: joinTokens(tokens), head, quants, proper: tokens.every(t => t.upos === 'PROPN' || t.upos === 'PUNCT'), person, number, wh: hasWhToken(tokens), tokens};
}
const coordWord = k => (k.kids.find(c => c.base === 'cc')?.lower ?? null);

/** The relativizer gap of a relative clause R: {tok, role, prep} or null when it cannot be told. */
function relativeGap(R) {
  const rel = R.kids.find(k => ['who', 'whom', 'which', 'that'].includes(k.lower) && ['PRON', 'DET'].includes(k.upos) && ['nsubj', 'obj', 'iobj', 'obl', 'nmod'].includes(k.base));
  if (rel) {
    if (rel.base === 'nsubj') return {tok: rel, role: rel.rel === 'nsubj:pass' ? 'patient' : 'subj', prep: null};
    if (rel.base === 'obj') return {tok: rel, role: 'obj', prep: null};
    const prep = rel.kids.filter(k => k.base === 'case');
    return prep.length ? {tok: rel, role: 'obl', prep: joinTokens(prep)} : null;
  }
  if (R.kids.some(k => k.base === 'nsubj') && !R.kids.some(k => k.base === 'obj') && R.upos === 'VERB') return {tok: null, role: 'obj', prep: null};
  if (!R.kids.some(k => k.base === 'nsubj' || k.base === 'csubj') && R.upos === 'VERB') return {tok: null, role: 'subj', prep: null};
  return null;
}

/* ------------------------------------------------------------------ clauses */

const isQuestionSentence = S => S.tokens.at(-1)?.form === '?' || S.tokens.filter(t => t.upos !== 'PUNCT').length === 0 ? S.tokens.at(-1)?.form === '?' : false;

function finiteInfo(V, auxs) {
  const modalTok = auxs.find(a => MODAL_FORMS.has(a.lower) || ['ca', 'wo', 'sha'].includes(a.lower));
  const info = {modal: null, tense: 'present', perfect: false, progressive: false, passive: false};
  if (modalTok) {
    const f = modalTok.lower === 'ca' ? 'can' : modalTok.lower === 'wo' ? 'will' : modalTok.lower === 'sha' ? 'shall' : modalTok.lower === 'cannot' ? 'can' : modalTok.lower;
    if (f === 'will' || f === 'shall') info.tense = 'future'; else info.modal = f;
  } else if (auxs.length) info.tense = PAST_AUX.has(auxs[0].lower) ? 'past' : 'present';
  else if (V.lemma === 'be') info.tense = PAST_AUX.has(V.lower) ? 'past' : 'present';
  else if (V.lower === V.lemma && V.upos === 'VERB' && V.kids.some(k => k.rel === 'nsubj' && (['he', 'she', 'it'].includes(k.lower) || k.upos === 'PROPN') && !k.kids.some(m => m.base === 'conj')) && !V.kids.some(k => k.base === 'mark' && k.lower === 'to') && !/^(?:be|can|will|may|must|shall|might|could|would|should)$/.test(V.lemma)) info.tense = 'past'; // a bare 3rd-person form ("she quit") is the past
  else if (V.lower !== V.lemma && !V.lower.endsWith('ing') && inflectVerb(V.lemma, 's').toLowerCase() !== V.lower) info.tense = 'past';
  for (const a of auxs) {
    if (a.lemma === 'have' && a.base === 'aux') info.perfect = true;
    if (a.lemma === 'be' && a.rel === 'aux' && V.lower.endsWith('ing')) info.progressive = true;
    if (a.rel === 'aux:pass') info.passive = true;
  }
  return info;
}

/**
 * Build one clause from head token V. `o`: kind (statement|yn|wh|imperative), top (a main clause of the text: coordinated
 * arguments may be split, relative clauses lifted), fill (relative clause gap), notes.
 * Returns null when V is not a predicate (a fragment): its tokens stay unused and are reported.
 */
function buildClause(S, V, o = {}) {
  const notes = o.notes ?? [];
  const kids = V.kids;
  const cop = kids.find(k => k.base === 'cop');
  const isVerb = V.upos === 'VERB' || (V.upos === 'AUX' && !cop);
  if (!isVerb && !cop) return null;
  const c = {pos: V.id, kind: o.kind ?? 'statement', pred: null, subj: null, obj: null, iobj: null, comp: null, compFront: null, compTail: null, obl: [], advs: [], leadAdvs: [], neg: false, modal: null, tense: 'present', aspect: 'simple', passive: false, wh: null, speaker: null, resultive: null, advsEarly: [], advsMid: [], xcomp: null, ccomp: null, ccompKind: null, links: [], lifts: [], there: false, subjItems: null, objItems: null, voiceChanged: false};
  use(V);
  const auxs = kids.filter(k => k.base === 'aux' || k.base === 'cop').sort(byId);
  useAll(auxs);
  const info = finiteInfo(V, auxs);
  Object.assign(c, {modal: info.modal, tense: info.tense, aspect: info.perfect && info.progressive ? 'perfect progressive' : info.perfect ? 'perfect' : info.progressive ? 'progressive' : 'simple'});
  const copTok = cop;
  if (copTok && !auxs.some(a => a !== copTok && a.base === 'aux' && (MODAL_FORMS.has(a.lower)))) {
    if (!info.modal && info.tense !== 'future') c.tense = auxs.find(a => !MODAL_FORMS.has(a.lower))?.lower && PAST_AUX.has(auxs.find(a => !MODAL_FORMS.has(a.lower)).lower) ? 'past' : 'present';
  }
  for (const k of kids.filter(k => k.base === 'advmod' && NEG.has(k.lower))) { c.neg = true; use(k); if (k.lower === 'never') c.advs.push('ever'); }
  if (kids.some(k => k.base === 'advmod' && ['no'].includes(k.lower) && false)) c.neg = true;
  const clauseTokens = collect(V, (k, p) => p === V && ['ccomp', 'advcl', 'conj', 'parataxis', 'acl'].includes(k.base));
  const collective = COLLECTIVE.has(V.lemma) || clauseTokens.some(t => COLLECTIVE_WORDS.has(t.lower)) || (clauseTokens.some(t => t.lower === 'each') && clauseTokens.some(t => t.lower === 'other')) || (cop && /married|friends|related|neighbo/.test(joinTokens(clauseTokens).toLowerCase()));
  const topStatement = Boolean(o.top) && c.kind === 'statement' && !c.neg && !collective;
  const ctxNP = {split: topStatement, lift: topStatement};
  let subjTok = kids.find(k => k.base === 'nsubj' && k.rel !== 'nsubj:pass');
  let passTok = kids.find(k => k.rel === 'nsubj:pass');
  // "Is she certified?" parsed as an active verb with the auxiliary `be` and a participle: a passive without agent
  if (!passTok && !cop && isVerb && subjTok && V.lower !== V.lemma && !V.lower.endsWith('ing') && auxs.some(a => a.lemma === 'be' && a.base === 'aux') && !kids.some(k => k.base === 'obj' || k.base === 'iobj')) { passTok = subjTok; subjTok = null; }
  const agentTok = kids.find(k => k.rel === 'obl:agent') ?? (passTok ? kids.find(k => k.base === 'obl' && k.kids.some(m => m.base === 'case' && m.lower === 'by')) : null);
  const expl = kids.find(k => k.base === 'expl');
  const there = expl && expl.lower === 'there';
  if (expl) use(expl);

  const sub = {fill: o.fill ?? null};
  const argNP = (tok, extra = {}) => {
    if (sub.fill && tok === sub.fill.tok) { const f = sub.fill.np; return {items: [f], filled: true}; }
    const relKids = ctxNP.lift ? tok.kids.filter(k => k.rel === 'acl:relcl' && !QUANT_HEAD(tok)) : [];
    const lifted = [];
    for (const R of relKids) { const gap = relativeGap(R); if (gap) lifted.push({R, gap}); }
    const conjKids = ctxNP.split && !extra.noSplit ? tok.kids.filter(k => k.base === 'conj' && /^(?:and|&)$/i.test(coordWord(k) ?? '')) : [];
    const skipFor = head => (k, p) => (p === head && (k.base === 'cc' || k.base === 'punct')) || (p === tok && k.base === 'conj' && conjKids.length > 0) || lifted.some(l => l.R === k);
    const heads = [tok, ...conjKids];
    const items = heads.map(h => makeNP(S, h, {skip: (k, p) => (p === h && (k.base === 'cc' || k.base === 'punct' || (extra.skipCase && k.base === 'case'))) || (p === tok && k.base === 'conj' && conjKids.length > 0) || lifted.some(l => l.R === k)}));
    if (!conjKids.length && !extra.noSplit) { /* a coordination kept inline: note it when the coordinated word is `and`/`or` */ }
    for (const h of conjKids) h.kids.filter(k => k.base === 'cc' || k.base === 'punct').forEach(use);
    if (conjKids.length) notes.push({type: 'coordination_split', text: items.map(i => i.text).join(' / ')});
    else if (tok.kids.some(k => k.base === 'conj')) notes.push({type: 'coordination_kept', text: items[0].text});
    for (const l of lifted) {
      const head = items[0];
      const fillNP = {...head, text: head.text.replace(/^(?:a|an)\s+/i, 'the ')};
      const gapFill = {tok: l.gap.tok, role: l.gap.role, prep: l.gap.prep, np: fillNP};
      const lc = buildClause(S, l.R, {kind: 'statement', top: false, notes, fill: gapFill});
      if (lc) { c.lifts.push(lc); notes.push({type: 'relative_lifted', text: joinTokens(collect(l.R))}); }
    }
    void skipFor;
    return {items};
  };
  function QUANT_HEAD(tok) { return collect(tok, (k, p) => p === tok && !['det', 'amod', 'nummod', 'advmod'].includes(k.base)).some(t => QUANT.has(t.lower) && t !== tok.parent); }

  // voice
  if (passTok) {
    c.passive = true;
    if (c.tense === 'present' && auxs.length && PAST_AUX.has(auxs[0].lower)) c.tense = 'past';
    const patient = argNP(passTok);
    if (agentTok) {
      const byTok = agentTok.kids.find(k => k.base === 'case' && k.lower === 'by');
      use(byTok);
      const agent = argNP(agentTok, {skipCase: true});
      c.subjItems = agent.items; c.objItems = patient.items; c.voiceChanged = true; c.passive = false;
      notes.push({type: 'voice', text: 'passive to active'});
    } else { c.objItems = patient.items; }
    subjTok = null;
  } else if (subjTok) {
    const r = argNP(subjTok);
    c.subjItems = r.items;
  }
  const objTok = kids.find(k => k.base === 'obj');
  const iobjTok = kids.find(k => k.base === 'iobj');
  if (objTok) c.objItems = argNP(objTok).items;
  if (iobjTok) c.iobj = argNP(iobjTok, {noSplit: true}).items[0];
  c.subj = c.subjItems?.[0] ?? null;
  c.obj = c.objItems?.[0] ?? null;
  if (!c.subj && o.fill?.role === 'subj' && !subjTok) { c.subj = o.fill.np; c.subjItems = [c.subj]; }
  if (!c.obj && o.fill?.role === 'obj' && !objTok && !passTok) { c.obj = o.fill.np; c.objItems = [c.obj]; }
  if (o.fill?.role === 'patient' && passTok === o.fill.tok) { /* handled by argNP */ }

  if (!cop && there && V.lemma === 'be' && c.subj) {
    c.there = true; c.comp = c.subj.text; c.subj = null; c.subjItems = null;
  }
  // predicate
  const prt = kids.find(k => k.rel === 'compound:prt');
  use(prt);
  if (cop) {
    c.pred = {lemma: 'be', cop: true, prt: null};
    c.there = Boolean(there);
    const compSkip = (k, p) => p === V && (['nsubj', 'csubj', 'cop', 'aux', 'aux:pass', 'punct', 'mark', 'advcl', 'conj', 'cc', 'expl', 'discourse', 'parataxis', 'ccomp', 'xcomp'].includes(k.rel) || (k.base === 'advmod' && (NEG.has(k.lower) || FRAMING.has(k.lower) || HEDGE_ADV.has(k.lower))) || (k.rel === 'nsubj:pass'));
    const compTokens = collect(V, compSkip);
    const subjIds = subjTok ? collect(subjTok).map(t => t.id) : [];
    const subjMin = subjIds.length ? Math.min(...subjIds) : Infinity;
    if (hasWhToken(compTokens) && subjTok) {
      c.compFront = joinTokens(compTokens.filter(t => t.id < subjMin)); c.compTail = joinTokens(compTokens.filter(t => t.id > subjMin));
      c.kind = 'wh';
      c.wh = {role: 'complement', text: c.compFront};
      useAll(compTokens);
      const qs = c.compFront.length ? c.compFront : '';
      void qs;
    } else {
      // an inline complement keeps its relative clause and coordination as written
      c.comp = joinTokens(compTokens);
      useAll(compTokens);
      if (!c.comp) return null;
    }
  } else if (c.there) {
    c.pred = {lemma: 'be', cop: true, prt: null};
  } else {
    c.pred = {lemma: V.lemma, cop: false, prt: prt ? prt.lower : null};
  }

  // obliques, adverbials, complements, links
  const own = [];
  for (const k of kids) if (!k.used && k !== passTok && WH_ADV_ROLE[k.lower] && ['mark', 'advmod'].includes(k.base) && ['SCONJ', 'ADV'].includes(k.upos)) { const ph = collect(k); useAll(ph); c.wh = {role: WH_ADV_ROLE[k.lower], text: joinTokens(ph)}; }
  for (const k of kids) {
    if (k.used && !['advmod'].includes(k.base)) { if (k !== agentTok) continue; }
    if (k === passTok || k === subjTok || k === objTok || k === iobjTok) continue;
    if (k !== agentTok && (k.base === 'obl' || (k.base === 'nmod' && !cop))) {
      if (sub.fill && k === sub.fill.tok && sub.fill.role === 'obl') { own.push({pos: k.id, prep: sub.fill.prep, np: sub.fill.np, k}); use(k); continue; }
      const caseToks = k.kids.filter(x => x.base === 'case' || x.rel === 'fixed' || (x.base === 'mark' && false));
      const fixedToks = caseToks.flatMap(x => collect(x));
      const prepToks = [...new Set([...caseToks, ...fixedToks])].sort(byId);
      useAll(prepToks);
      const np = makeNP(S, k, {skip: (x, p) => p === k && (x.base === 'case' || x.base === 'punct')});
      if (prepToks.map(t => t.lower).join(' ') === 'according to' && !c.speaker) { c.speaker = np; continue; }
      own.push({pos: k.id, prep: prepToks.length ? joinTokens(prepToks) : null, np, k, whRole: np.wh});
    } else if (k.base === 'advmod' && !k.used) {
      use(k);
      const phrase = collect(k);
      if (FRAMING.has(k.lower) && !hasWhToken(phrase)) { k.framing = true; useAll(phrase); (o.framing ?? S.framing)?.push?.(k.form); continue; }
      if (HEDGE_ADV.has(k.lower)) { useAll(phrase); c.leadAdvs.push(k.lower); notes.push({type: 'hedge', text: k.lower}); continue; }
      if (WH.has(k.lower) && k.lower in WH_ADV_ROLE) { useAll(phrase); c.wh = {role: WH_ADV_ROLE[k.lower], text: joinTokens(phrase)}; continue; }
      if (hasWhToken(phrase)) { useAll(phrase); own.push({pos: k.id, prep: null, np: {text: joinTokens(phrase), wh: true, number: 'Plur', person: 3}, k, whRole: true, adv: true}); continue; }
      useAll(phrase);
      if (['only', 'even'].includes(k.lower)) notes.push({type: 'scope_adverb', text: k.lower});
      if (MID_ADV.has(k.lower) && phrase.length === 1) c.advsMid.push(k.lower); else (PARTICLE_ADV.has(k.lower) ? c.advsEarly : c.advs).push(joinTokens(phrase));
    }
  }
  // wh role of an oblique or object-position wh phrase
  for (const ob of own) {
    if (ob.np.wh && ob.whRole) { c.wh = {role: ob.adv ? 'manner' : 'oblique', text: [ob.prep, ob.np.text].filter(Boolean).join(' ')}; ob.removed = true; }
  }
  c.obl = own.filter(x => !x.removed).sort((a, b) => a.pos - b.pos).map(x => ({prep: x.prep, np: x.np}));
  // wh in the subject / object arguments
  if (c.subj?.wh && !c.wh) { c.wh = {role: 'subject', text: c.subj.text}; }
  if (c.obj?.wh && !c.wh) { c.wh = {role: 'object', text: c.obj.text}; c.obj = null; c.objItems = null; }
  if (c.iobj?.wh && !c.wh) { c.wh = {role: 'iobject', text: c.iobj.text}; c.iobj = null; }
  if (c.wh && c.kind !== 'imperative' && !o.embedded) c.kind = 'wh';
  if (c.wh && o.embedded) c.kind = 'wh';

  // complements
  for (const k of [...kids, ...(o.extraKids ?? [])]) {
    if (k.used) continue;
    if (k.base === 'xcomp' && k.upos !== 'VERB' && !k.kids.some(m => m.base === 'mark' && m.lower === 'to')) {
      const tokens = collect(k, (x, p) => p === k && ['punct'].includes(x.base));
      useAll(tokens);
      c.resultive = joinTokens(tokens);
    } else if (k.base === 'xcomp' && k.upos === 'VERB' && k.kids.some(m => m.base === 'mark' && m.lower === 'to')) {
      const to = k.kids.find(m => m.base === 'mark' && m.lower === 'to');
      use(to);
      const x = buildClause(S, k, {kind: 'statement', top: false, notes, embedded: true, infinitive: true});
      if (x) { c.xcomp = x; }
    } else if (k.base === 'xcomp' && k.upos === 'VERB' && k.lower === k.lemma && !k.kids.some(m => m.base === 'nsubj')) {
      const x = buildClause(S, k, {kind: 'statement', top: false, notes, embedded: true, infinitive: true});
      if (x) { x.bare = true; c.xcomp = x; }
    } else if (k.base === 'ccomp') {
      const mark = k.kids.find(m => m.base === 'mark' && ['that', 'if', 'whether'].includes(m.lower));
      const phrase = collect(k, (x, p) => p === k && x.base !== 'mark' && false);
      use(mark);
      const whish = hasWhToken(k.kids.flatMap(x => collect(x, (y, p) => ['ccomp', 'advcl', 'acl'].includes(y.base))));
      const kind = mark && ['if', 'whether'].includes(mark.lower) ? 'yn' : whish ? 'wh' : 'statement';
      const x = buildClause(S, k, {kind, top: false, notes, embedded: true});
      void phrase;
      if (x) { c.ccomp = x; c.ccompKind = kind === 'yn' ? 'whether' : kind === 'wh' ? 'wh' : 'that'; }
    } else if (k.base === 'advcl') {
      const mark = k.kids.find(m => m.base === 'mark' && LINKS[m.lower]);
      if (!mark) continue;
      use(mark);
      const x = buildClause(S, k, {kind: 'statement', top: false, notes, embedded: true});
      if (x) c.links.push({rel: LINKS[mark.lower], clause: x, pos: k.id});
      else mark.used = false;
    }
  }
  for (const k of kids) if (!k.used && (k.base === 'mark' && ['then'].includes(k.lower))) use(k);
  for (const k of kids) if (!k.used && k.base === 'discourse' && FRAMING.has(k.lower)) { use(k); k.framing = true; S.framingWords.push(k.form); }
  for (const k of kids) if (!k.used && (k.base === 'punct')) use(k);
  if (!c.subj && !c.passive && c.pred.cop && c.there) { /* existential */ }
  if (c.kind === 'statement' && o.top && !c.subj && !c.passive && !c.there && V.upos === 'VERB' && !cop && info.tense === 'present' && V.lower === V.lemma && !auxs.length) c.kind = 'imperative';
  if (c.kind === 'imperative' && c.neg) { /* "do not V" */ }
  if (c.speaker && c.kind === 'statement') return reported(c);
  if (c.speaker) { c.obl.push({prep: 'according to', np: c.speaker}); }
  return c;
}

/** "According to X, S" is the explicit marker `X says that S`: a clause with the predicate say and S as its complement. */
function reported(inner) {
  const speaker = inner.speaker;
  inner.speaker = null;
  return {pos: inner.pos, kind: 'statement', pred: {lemma: 'say', cop: false, prt: null}, subj: speaker, obj: null, iobj: null, comp: null, compFront: null, compTail: null, obl: [], advs: [], advsEarly: [], advsMid: [], leadAdvs: [], neg: false, modal: null, tense: 'present', aspect: 'simple', passive: false, wh: null, speaker: null, resultive: null, xcomp: null, ccomp: inner, ccompKind: 'that', links: [], lifts: inner.lifts, there: false, subjItems: [speaker], objItems: null, voiceChanged: false};
}

/* ------------------------------------------------------------------ request wrappers and sentence structure */

const subjLemma = V => V.kids.find(k => k.base === 'nsubj')?.lower ?? null;

/** If V is a request wrapper ("Can you confirm that", "Is it true that", "Any idea where"), the wrapped clause head and its kind. */
function unwrap(S, V, question, depth = 0) {
  if (!V || depth > 3) return null;
  const subj = subjLemma(V);
  const clauseKid = V.kids.find(k => ['ccomp', 'csubj', 'parataxis'].includes(k.base) && (k.upos === 'VERB' || k.upos === 'AUX' || k.kids.some(m => m.base === 'cop')));
  const imperative = !subj && V.upos === 'VERB' && V.lower === V.lemma;
  const addressee = V.kids.find(k => k.base === 'iobj' || (k.base === 'obj' && ['PRON', 'NOUN', 'PROPN'].includes(k.upos)));
  const toSpeaker = !addressee || ['me', 'us'].includes(addressee.lower);
  if (V.upos === 'VERB' && ASK_VERBS.has(V.lemma) && toSpeaker && (!subj || ['you', 'i', 'we'].includes(subj)) && (question || imperative || V.lemma === 'wonder') && clauseKid) return {wrapper: V, target: clauseKid};
  if (V.upos === 'VERB' && DESIRE_VERBS.has(V.lemma) && ['i', 'we'].includes(subj ?? '')) {
    const x = V.kids.find(k => k.base === 'xcomp' && k.upos === 'VERB');
    const inner = x && unwrap(S, x, true, depth + 1);
    if (inner) return {wrapper: V, target: inner.target, via: [x, ...(inner.via ?? []), inner.wrapper]};
  }
  const cop = V.kids.find(k => k.base === 'cop');
  const expl = V.kids.find(k => k.base === 'expl' && k.lower === 'it');
  if (cop && expl && clauseKid && ((V.upos === 'ADJ' && TRUTH_ADJ.has(V.lemma)) || (V.lemma === 'case' && V.kids.some(k => k.base === 'det' && k.lower === 'the')) || (V.lemma === 'possible'))) return {wrapper: V, target: clauseKid, via: [cop, expl]};
  if (CHANCE_NOUNS.has(V.lemma) && V.kids.some(k => k.base === 'det' && k.lower === 'any')) {
    const t = V.kids.find(k => ['ccomp', 'acl', 'parataxis', 'advcl', 'dep'].includes(k.base) && (k.upos === 'VERB' || k.upos === 'AUX' || k.kids.some(m => m.base === 'cop')));
    if (t) return {wrapper: V, target: t};
  }
  return null;
}

const wrapperTokens = W => {
  const own = [W.wrapper, ...(W.via ?? [])];
  const out = [];
  for (const w of own) {
    out.push(w);
    for (const k of w.kids) if (['aux', 'aux:pass', 'cop', 'nsubj', 'expl', 'det', 'iobj', 'obj', 'compound:prt', 'mark', 'discourse', 'advmod', 'punct', 'case'].includes(k.rel) && !['ccomp', 'xcomp', 'csubj', 'parataxis', 'acl', 'advcl'].includes(k.base)) {
      if (k.base === 'obj' && !['me', 'us'].includes(k.lower)) continue;
      if (k.base === 'advmod' && !FRAMING.has(k.lower)) continue;
      out.push(k);
    }
  }
  return out;
};

const KIND_OF_TARGET = (S, T, question) => {
  const mark = T.kids.find(k => k.base === 'mark' && ['if', 'whether'].includes(k.lower));
  if (mark) return 'yn';
  const sub = collect(T, (k, p) => ['ccomp', 'advcl', 'acl', 'parataxis'].includes(k.base) && p === T);
  return hasWhToken(sub) ? 'wh' : (question ? 'yn' : 'yn');
};

/** The clauses (atoms) of one sentence: the root and its coordinated or parenthetical sibling clauses, wrappers removed. */
function sentenceAtoms(S, out) {
  const atoms = [];
  const root = S.root;
  if (!root) return atoms;
  S.framingWords = out.framing;
  const first = S.tokens.find(t => t.upos !== 'PUNCT');
  const inverted0 = first && ['aux', 'cop'].includes(first.base) && first.parent === root && root.kids.some(k => (k.base === 'nsubj' || (k.base === 'expl' && k.lower === 'there')) && k.id > first.id) && !SENTENCE_FRAMING_ROOTS.has(root.lemma);
  const question = S.tokens.at(-1)?.form === '?' || Boolean(inverted0);
  // a sentence of pure framing
  if (SENTENCE_FRAMING_ROOTS.has(root.lemma) && !root.kids.some(k => k.base === 'nsubj')) { useAll(S.tokens); out.framing.push(joinTokens(S.tokens.filter(t => t.upos !== 'PUNCT'))); return atoms; }
  // framing prefix before a colon ("Fact-check:", "Here's what I know:")
  const colon = S.tokens.findIndex(t => t.form === ':');
  if (colon > 0 && colon <= 6 && colon < S.tokens.length - 2) {
    const prefix = S.tokens.slice(0, colon);
    useAll(prefix); prefix.forEach(t => { t.framing = true; });
    out.framing.push(joinTokens(prefix));
    S.tokens[colon].used = true;
    const rest = S.tokens.slice(colon + 1);
    rest[0].initial = true;
    // heads inside the rest that depend on the prefix (or are the root)
    const restIds = new Set(rest.map(t => t.id));
    const heads = rest.filter(t => !restIds.has(t.head) && t.upos !== 'PUNCT');
    for (const h of heads) {
      const next = clauseFrom(S, h, {top: true, question, out});
      atoms.push(...next);
    }
    return atoms;
  }
  for (const k of root.kids) if (k.base === 'cc' && S.tokens[0] === k) { use(k); out.framing.push(k.form); }
  atoms.push(...clauseFrom(S, root, {top: true, question, out}));
  return atoms;
}

/** Clauses for head H: unwrap, build, then siblings by coordination or parataxis. */
function clauseFrom(S, H, {top, question, out}) {
  const atoms = [];
  const notes = out.notes;
  let W = unwrap(S, H, question);
  let main = H, kindHint = null;
  if (W) {
    useAll(wrapperTokens(W).filter(t => t.upos !== 'PUNCT' || true));
    out.notes.push({type: 'wrapper', text: joinTokens(wrapperTokens(W).sort(byId))});
    main = W.target;
    for (const m of main.kids.filter(k => k.base === 'mark' && ['that', 'if', 'whether'].includes(k.lower))) use(m);
    kindHint = KIND_OF_TARGET(S, main, question);
    // the wrapper's own punctuation, links and conj siblings stay with the target
    for (const k of H.kids) if (k.base === 'punct') use(k);
    // a clause coordinated with the wrapper ("do you know if A and B") is not safe to split off: its words stay unrepresented
  }
  const inv = k => { const subj = k.kids.find(n => n.base === 'nsubj'); return Boolean(subj) && k.kids.some(m => ['aux', 'cop'].includes(m.base) && m.id < subj.id); };
  const whIn = k => hasWhToken(collect(k, (x, p) => p === k && ['ccomp', 'advcl', 'acl', 'conj', 'parataxis'].includes(x.base)));
  const sibs = main.kids.filter(k => k.base === 'conj' && (k.upos === 'VERB' || k.upos === 'AUX' || k.kids.some(m => m.base === 'cop')));
  const otherQuestion = top && S.tokens.some(t => t !== main && !W && t.kids.some(k => k.base === 'nsubj') && (inv(t) || whIn(t)));
  const rootQuestion = question && (inv(main) || whIn(main) || !(otherQuestion || (top && sibs.some(k => inv(k) || whIn(k)))));
  const kind = kindHint ?? (rootQuestion ? (hasWhToken(collect(main, (k, p) => ['ccomp', 'advcl', 'acl', 'conj', 'parataxis'].includes(k.base) && p === main)) ? 'wh' : 'yn') : 'statement');
  const c = buildClause(S, main, {kind, top, notes, framing: out.framing, extraKids: W ? H.kids.filter(k => k.base === 'advcl') : []});
  if (!c) return atoms;
  if (c.kind === 'wh' && kind === 'yn' && !c.wh) c.kind = 'yn';
  if (c.kind === 'statement' && rootQuestion) c.kind = c.wh ? 'wh' : 'yn';
  // coordination and parataxis
  const subs = main.kids.filter(k => (k.base === 'conj' && (k.upos === 'VERB' || k.upos === 'AUX' || k.kids.some(m => m.base === 'cop'))) || k.base === 'parataxis');
  const followers = [];
  for (const s of subs) {
    if (s.used) continue;
    const cw = coordWord(s) ?? s.kids.find(k => k.base === 'advmod' && ['so', 'therefore', 'thus', 'hence'].includes(k.lower))?.lower ?? null;
    const cc = s.kids.find(k => k.base === 'cc'); use(cc);
    if (s.kids.find(k => k.base === 'advmod' && k.lower === 'so')) use(s.kids.find(k => k.base === 'advmod' && k.lower === 'so'));
    const inverted = k => k.kids.some(m => ['aux', 'cop'].includes(m.base) && k.kids.find(n => n.base === 'nsubj') && m.id < k.kids.find(n => n.base === 'nsubj').id);
    const subKind = W && s.base === 'conj' ? (c.kind === 'wh' ? 'yn' : c.kind) : s.base === 'parataxis' ? (question && S.tokens.at(-1).form === '?' ? 'yn' : 'statement') : (question && (inverted(s) || hasWhToken(collect(s, (k, p) => p === s && ['ccomp', 'advcl', 'conj'].includes(k.base)))) ? 'yn' : (c.kind === 'imperative' ? 'imperative' : 'statement'));
    if ((cw == null || cw === 'and') && unwrap(S, s, question)) { followers.push({conn: 'and', atoms: clauseFrom(S, s, {top, question, out})}); continue; }
    let sc = buildClause(S, s, {kind: subKind, top, notes, framing: out.framing});
    if (!sc) { if (cc) cc.used = false; continue; }
    if (sc.kind === 'yn' && sc.wh) sc.kind = 'wh';
    // a coordinated verb phrase shares the subject (and, when it has no auxiliary, the question form) of the first clause
    if (!sc.subj && !sc.passive && c.subj && !sc.there) { sc.subj = c.subj; sc.subjItems = [c.subj]; sc.sharedSubject = true; }
    if (sc.kind === 'statement' && c.kind !== 'statement' && !s.kids.some(k => k.base === 'aux' || k.base === 'cop') && sc.sharedSubject) { sc.kind = c.kind; }
    if (sc.sharedSubject && c.kind === 'wh' && c.wh?.role === 'subject') { sc.kind = 'wh'; sc.wh = {...c.wh}; }
    followers.push({conn: cw ?? (s.base === 'parataxis' ? null : 'and'), clause: sc, tok: s});
  }
  atoms.push(...expandClause(c, out));
  for (const f of followers) {
    if (f.atoms) { atoms.push(...f.atoms); continue; }
    const mine = expandClause(f.clause, out);
    if ((f.conn === 'and' || f.conn == null) && !(f.conn === 'and' && c.kind !== 'statement' && c.kind !== 'imperative')) atoms.push(...mine);
    else {
      // a connective between clauses (or, but, so, yet): one composite atom with the previous atom
      const left = atoms.pop();
      mine.forEach((m, i) => atoms.push(i === 0 ? {conn: f.conn === 'yet' ? 'but' : f.conn, left, right: m, kind: left.kind, pos: left.pos} : m));
    }
  }
  return atoms;
}

/** Split coordinated subjects/objects of a main clause into atoms (cartesian, at most 6), lifted relative clauses after them. */
function expandClause(c, out) {
  const subjects = c.subjItems?.length ? c.subjItems : [c.subj];
  const objects = c.objItems?.length ? c.objItems : [c.obj];
  const list = [];
  if (subjects.length * objects.length > 6 || (subjects.length === 1 && objects.length === 1)) list.push(c);
  else for (const s of subjects) for (const ob of objects) list.push({...c, subj: s, obj: ob, subjItems: [s], objItems: [ob], lifts: []});
  const lifts = c.lifts.flatMap(l => expandClause(l, out));
  return [...list, ...lifts];
}

/* ------------------------------------------------------------------ structures */

/**
 * Extract the predicate-argument structures of a compact analysis. Returns {atoms, notRepresented, framing, notes}; every
 * token neither used by a structure nor part of the framing list is in `notRepresented` as a verbatim span.
 */
export function extractStructures(analysis, {message = null} = {}) {
  const out = {atoms: [], notRepresented: [], framing: [], notes: []};
  const sentences = (analysis?.sentences ?? []).map(prepSentence);
  for (const S of sentences) {
    try {
      out.atoms.push(...sentenceAtoms(S, out));
    } catch (error) { out.notes.push({type: 'extractor_error', text: String(error.message ?? error).slice(0, 120)}); }
    for (const t of S.tokens) if (t.upos === 'PUNCT') t.used = true;
    let run = [];
    const flush = () => { if (run.length) out.notRepresented.push(joinTokens(run)); run = []; };
    for (const t of S.tokens) { if (t.used) flush(); else run.push(t); }
    flush();
  }
  out.atoms.forEach(a => { a.key = clauseKey(a); });
  if (message != null) {
    for (const span of unanalysedSpans(analysis, String(message))) {
      if (/:$/.test(span) || /^(?:please|hi|hello|hey|thanks|thank you|correct|right|ok|okay|yes|no)\W*$/i.test(span)) out.framing.push(span); else out.notRepresented.push(span);
    }
  }
  return out;
}

// Key text: lower case; commas, hyphens and a final period do not count (the parser splits "Seo-yeon" and glues "Eze." differently).
const plain = t => String(t).toLowerCase().replace(/[’]/g, "'").replace(/[,;-]/g, '').replace(/\s+/g, ' ').replace(/\.+\s*$/, '').trim();
/** Spans of the message the analysis does not cover: text before, between and after the sentences, and the runs SymbolicLM masked before parsing (lead-ins, labels, as-of dates). */
export function unanalysedSpans(analysis, message) {
  const spans = [];
  const sentences = analysis?.sentences ?? [];
  const add = (from, to) => { const t = message.slice(from, to); if (/[\p{L}\p{N}]/u.test(t)) spans.push(t.replace(/\s+/g, ' ').trim()); };
  let at = 0;
  for (const s of sentences) {
    if (!Number.isInteger(s.start) || !Number.isInteger(s.end)) continue;
    add(at, s.start);
    const text = String(s.text ?? '');
    let from = null;
    for (let i = 0; i <= text.length; i++) {
      const masked = i < text.length && /\s/.test(text[i]) && message[s.start + i] !== undefined && !/\s/.test(message[s.start + i]);
      if (masked && from === null) from = i;
      if (!masked && from !== null) { add(s.start + from, s.start + i); from = null; }
    }
    at = Math.max(at, s.end);
  }
  if (sentences.length) add(at, message.length);
  return spans;
}

const npKey = n => (n ? plain(n.text) : '');
const oblKey = o => `${(o.prep ?? '').toLowerCase()}|${npKey(o.np)}`;
/** Canonical key of an atom (the structural identity compared by the round trip): voice, contraction and order of obliques are normalized. */
export function clauseKey(c) {
  if (!c) return '';
  if (c.conn) { // a chain of one connective is one flat, unordered group
    const leaves = x => (x.conn === c.conn ? [...leaves(x.left), ...leaves(x.right)] : [clauseKey(x)]);
    return `${c.conn}(${leaves(c).sort().join(';')})`;
  }
  if (c.passive && c.pred?.cop) c = {...c, passive: false, subj: c.obj, obj: null};
  // "Who is the spouse of Irina?" parses with the wh word as subject or as complement: one key for both
  if (c.kind === 'wh' && c.pred?.cop && !c.there) {
    const wsub = c.wh.role === 'subject' && /^(?:who|what)$/i.test(c.subj?.text ?? '') && c.comp ? c.comp : null;
    const wcomp = c.wh.role === 'complement' && /^(?:who|what)$/i.test(c.compFront ?? '') && c.subj ? [c.subj.text, c.compTail].filter(Boolean).join(' ') : null;
    const rest = wsub ?? wcomp;
    if (rest) return ['wh', 'be', c.neg ? 'neg' : 'pos', c.modal ?? '', c.tense, c.aspect, `wh=copula:${(wsub ? c.subj.text : c.compFront).toLowerCase()}`, `rest=${rest.toLowerCase()}`, ...c.links.map(l => `link=${l.rel}(${clauseKey(l.clause)})`).sort()].join('|');
  }
  // an agentless passive and a copula with a participle complement are one structure ("is certified")
  if (c.passive && !c.pred.cop && !c.wh && !c.xcomp && !c.ccomp && !c.resultive) {
    const part = inflectVerb(c.pred.lemma + (c.pred.prt ? ' ' + c.pred.prt : ''), 'part');
    c = {...c, pred: {lemma: 'be', cop: true, prt: null}, passive: false, subj: c.obj, obj: null, comp: [part, ...c.obl.map(o => [o.prep, o.np.text].filter(Boolean).join(' '))].join(' '), obl: []};
  }
  const f = [c.kind, c.pred?.lemma + (c.pred?.prt ? ' ' + c.pred.prt : ''), c.neg ? 'neg' : 'pos', c.modal ?? '', c.tense, c.aspect, c.passive ? 'passive' : ''];
  if (c.there) f.push('there');
  if (c.wh) f.push(`wh=${c.wh.role}:${c.wh.text.toLowerCase()}`);
  if (c.subj) f.push(`S=${npKey(c.subj)}`);
  if (c.iobj) f.push(`I=${npKey(c.iobj)}`);
  if (c.obj) f.push(`O=${npKey(c.obj)}`);
  if (c.comp) f.push(`C=${plain(c.comp)}`);
  if (c.resultive) f.push(`R=${plain(c.resultive)}`);
  if (c.compTail) f.push(`CT=${plain(c.compTail)}`);
  for (const o of c.obl.map(oblKey).sort()) f.push(`L=${o}`);
  for (const a of [...c.advs, ...c.advsEarly, ...c.advsMid, ...c.leadAdvs].map(x => x.toLowerCase()).sort()) f.push(`A=${a}`);
  if (c.xcomp) f.push(`X=(${clauseKey(c.xcomp)})`);
  if (c.ccomp) f.push(`K=${c.ccompKind}(${clauseKey(c.ccomp)})`);
  for (const l of [...c.links].map(x => `${x.rel}(${clauseKey(x.clause)})`).sort()) f.push(`link=${l}`);
  return f.join('|');
}

/* ------------------------------------------------------------------ realization */

function verbWords(c, {question = false, person = 3, number = 'Sing', infinitive = false, imperative = false, extraMid = []}) {
  const main = c.pred.cop ? 'be' : c.pred.lemma;
  const seq = [];
  let req = infinitive || imperative ? 'base' : 'finite';
  if (c.modal) { seq.push({l: c.modal, req: 'modal'}); req = 'base'; }
  else if (c.tense === 'future' && !infinitive && !imperative) { seq.push({l: 'will', req: 'modal'}); req = 'base'; }
  if (c.aspect.includes('perfect')) { seq.push({l: 'have', req}); req = 'part'; }
  if (c.aspect.includes('progressive')) { seq.push({l: 'be', req}); req = 'ing'; }
  if (c.passive) { seq.push({l: 'be', req}); req = 'part'; }
  seq.push({l: main, req, main: true});
  if (seq[0].req === 'finite' && seq[0].main && (c.neg || question) && !(seq[0].l === 'be')) { seq[0].req = 'base'; seq.unshift({l: 'do', req: 'finite'}); }
  if (imperative && c.neg) { seq.unshift({l: 'do', req: 'base'}); }
  const form = ({l, req}) => {
    if (req === 'modal') return l;
    if (req === 'finite') return inflectVerb(l, c.tense === 'past' ? 'past' : 'present', {person, number});
    return inflectVerb(l, req, {});
  };
  const words = seq.map(form);
  if (c.pred.prt) words[words.length - 1] += ' ' + c.pred.prt;
  if (c.neg) words.splice(1, 0, 'not');
  const mid = [...(c.advsMid ?? []), ...extraMid];
  if (mid.length) { if (words.length === 1 && main !== 'be') words.unshift(...mid); else words.splice(c.neg ? 2 : 1, 0, ...mid); }
  const lead = mid.length && words[0] === mid[0] && words.length === mid.length + 1;
  return {first: lead ? mid[0] : words[0], notWord: c.neg ? 'not' : null, rest: words.slice(c.neg ? 2 : 1), words};
}

const obliqueText = o => [o.prep, o.np.text].filter(Boolean).join(' ');

function renderVP(c) {
  const v = verbWords({...c, neg: false}, {infinitive: true});
  return [c.bare ? (c.neg ? 'not' : '') : c.neg ? 'not to' : 'to', ...v.words, ...postParts(c)].filter(Boolean).join(' ');
}

function postParts(c, {skipWh = false} = {}) {
  const parts = [];
  if (c.iobj) parts.push(c.iobj.text);
  if (c.obj && !c.passive) parts.push(c.obj.text);
  if (c.resultive) parts.push(c.resultive);
  parts.push(...c.advsEarly);
  if (c.comp) parts.push(c.comp);
  for (const o of c.obl) parts.push(obliqueText(o));
  if (c.xcomp) parts.push(renderVP(c.xcomp));
  if (c.ccomp) parts.push(renderCcomp(c));
  parts.push(...c.advs);
  return parts.filter(Boolean);
}

function renderCcomp(c) {
  const inner = renderClause(c.ccomp, {embedded: true});
  if (c.ccompKind === 'whether') return `whether ${inner}`;
  if (c.ccompKind === 'wh') return inner;
  return `that ${inner}`;
}

/** The text of one clause without capital or final punctuation (links included). */
export function renderClause(c, o = {}) {
  if (c.conn) return `${renderClause(c.left)}, ${c.conn} ${lcFirst(renderClause(c.right))}`;
  const embedded = Boolean(o.embedded);
  const subj = c.passive ? c.obj : c.subj; // an agentless passive keeps its patient as the grammatical subject
  const person = subj?.person ?? 3, number = subj?.number ?? 'Sing';
  let s;
  const lead = c.leadAdvs.length ? c.leadAdvs.join(' ') + ' ' : '';
  const hedgeMid = c.kind === 'statement' || c.kind === 'imperative' ? [] : c.leadAdvs;
  if (c.there) {
    const v = verbWords(c, {question: c.kind === 'yn' && !embedded, person, number: /^(?:[2-9]|\d{2,}|two|three|four|five|six|seven|eight|nine|ten|many|several|few|some)\b/i.test(c.comp ?? '') || /\band\b/.test(c.comp ?? '') ? 'Plur' : number});
    s = c.kind === 'yn' && !embedded ? `${v.first} there ${v.notWord ? 'not ' : ''}${v.rest.join(' ')} ${c.comp ?? ''}` : `there ${v.words.join(' ')} ${c.comp ?? ''}`;
  } else if (c.kind === 'imperative') {
    const v = verbWords(c, {imperative: true});
    s = [...v.words, ...postParts(c)].join(' ');
  } else if (c.kind === 'yn' && !embedded) {
    const v = verbWords(c, {question: true, person, number, extraMid: hedgeMid});
    s = [v.first, subj?.text, v.notWord, ...v.rest, ...postParts(c)].filter(Boolean).join(' ');
  } else if (c.kind === 'wh') {
    if (c.wh.role === 'complement') {
      const v = verbWords(c, {question: false, person, number});
      s = [c.compFront, ...v.words, subj?.text, c.compTail].filter(Boolean).join(' ');
    } else if (c.wh.role === 'subject') {
      const v = verbWords(c, {question: false, person, number, extraMid: hedgeMid});
      s = [subj.text, ...v.words, ...postParts(c)].join(' ');
    } else {
      const v = verbWords(c, {question: !embedded, person, number, extraMid: hedgeMid});
      s = embedded
        ? [c.wh.text, subj?.text, ...v.words, ...postParts(c)].filter(Boolean).join(' ')
        : [c.wh.text, v.first, subj?.text, v.notWord, ...v.rest, ...postParts(c)].filter(Boolean).join(' ');
    }
  } else {
    const v = verbWords(c, {question: false, person, number});
    s = [lead.trim(), subj?.text, ...v.words, ...postParts(c)].filter(Boolean).join(' ');
  }
  s = s.replace(/\s+/g, ' ').trim();
  for (const l of [...c.links].sort((a, b) => a.pos - b.pos)) {
    const inner = renderClause(l.clause, {embedded: true});
    s = l.rel === 'if' ? `if ${inner}, then ${lcFirst(s)}` : `${l.rel} ${inner}, ${lcFirst(s)}`;
  }
  return s;
}

/** One CNL sentence (capital, final punctuation) per atom. */
export function renderSentence(atom) {
  const text = renderClause(atom);
  const last = x => (x.conn ? last(x.right) : x);
  const question = ['yn', 'wh'].includes(last(atom).kind); // a chain of clauses ends with the mark of its last clause
  return `${ucFirst(text)}${question ? '?' : '.'}`;
}

/** The realization of extracted structures: {cnl, sentences}. */
export function realize(structures) {
  const sentences = structures.atoms.map(renderSentence);
  return {cnl: sentences.join(' '), sentences};
}

/** "I understood: ..." text from an analysis, with what was not represented. */
export function interpret(analysis) {
  const structures = extractStructures(analysis);
  const {cnl, sentences} = realize(structures);
  const text = [`I understood: ${cnl || '(nothing)'}`, ...structures.notRepresented.map(s => `not represented: "${s}"`)].join('\n');
  return {cnl, sentences, atoms: structures.atoms, notRepresented: structures.notRepresented, framing: structures.framing, notes: structures.notes, text};
}

/**
 * Round trip: the structures extracted from the parse of the CNL text must equal the source structures (same multiset of
 * atom keys: voice, contraction and the order of obliques are normalized by the keys) and the CNL parse must leave no
 * unused word. Returns {pass, onlySource, onlyCnl, reasons}.
 */
export function roundTrip(source, cnlStructures) {
  const a = source.atoms.map(x => x.key).sort();
  const b = cnlStructures.atoms.map(x => x.key).sort();
  const count = list => list.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map());
  const ca = count(a), cb = count(b);
  const onlySource = [], onlyCnl = [];
  for (const [k, n] of ca) for (let i = cb.get(k) ?? 0; i < n; i++) onlySource.push(k);
  for (const [k, n] of cb) for (let i = ca.get(k) ?? 0; i < n; i++) onlyCnl.push(k);
  const reasons = [];
  if (onlySource.length || onlyCnl.length) reasons.push('structures differ');
  if (cnlStructures.notRepresented.length) reasons.push('the CNL has words the extraction does not use');
  return {pass: reasons.length === 0, onlySource, onlyCnl, reasons};
}
