/**
 * Scope detector (PROTOTYPE, owner question of 2026-10-01; not wired into the chat or the API).
 *
 * What limit has the formalizer, and how do we notice that a message needs more than it can write? The small model's surface
 * (`stated`, `assumed`, `unclear`, `query`, `constraint`, `unparsed`, clause links) holds ground statements, suppositions,
 * questions and numeric problems. It has no way to say "every X does Y", "usually", "must", "first ... then ...", "the total is the
 * sum of ...", "these are the only ...", "from 2020 until 2023", "the manual says ...", "what if the fee were ...". Those are the
 * KNOWLEDGE wires that a coding agent writes (experiments/proposal/reasoning-wires-proposal.md 4.3 and 8.2).
 *
 * `detectScope(sentence)` reads ONE sentence of the compact analysis SymbolicLM already returns (`compactAnalysis`: rows
 * `[id, form, lemma, upos, head, deprel]`, no features, no model call) and returns
 *   `label`    `surface_ok` | `needs_knowledge_authoring` | `needs_clarification`,
 *   `wires`    the suggested knowledge wire types with a score and the cue ids that support them (`rule` `default` `norm` `method`
 *              `aggregate` `integrity` `closed` `definition` `temporal` `sourced` `amendment`),
 *   `cues`     every cue as evidence: `{id, wire, type, text, tokens, weight}`,
 *   `features` question / imperative / subject kind, so a reader sees why a cue was muted.
 * Deterministic and cheap (a few thousand token comparisons per sentence). English and Romanian lexicons; the Romanian forms are
 * matched with diacritics folded because the owner writes without them. A wire counts when its noisy-or cue score reaches
 * `THRESHOLD`. Questions are queries and are muted except the "what if the rule were different" form (`amendment`), a bare
 * imperative is a request and is muted except where an ordered sequence or a standing prohibition is present.
 */
export const SCOPE_DETECT_VERSION = 'scope-detect-v2';
export const THRESHOLD = 0.5;
export const LABELS = Object.freeze(['surface_ok', 'needs_knowledge_authoring', 'needs_clarification']);
/** Suggested wire type -> the knowledge wire(s) of the reasoning proposal that would carry it. */
export const WIRE_TARGETS = Object.freeze({
  rule: ['predicate', 'rule'],
  default: ['default'],
  norm: ['norm'],
  method: ['method', 'action'],
  aggregate: ['aggregate', 'rule(compute)'],
  integrity: ['integrity'],
  closed: ['predicate(closed true)'],
  definition: ['predicate', 'rule'],
  temporal: ['fact(valid)'],
  sourced: ['fact(source, quote)'],
  amendment: ['amendment', 'hypothesis'],
});
export const WIRES = Object.freeze(Object.keys(WIRE_TARGETS));

const set = s => new Set(s.split(/\s+/).filter(Boolean));
export const fold = t => String(t).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const WH = set('what who whom whose which where when why how cine ce care unde cand cum cat cate');
const AUX_Q = set('do does did is are was were can could will would should shall may might must has have had');
const GREETING = set('ok okay da nu thanks thank multumesc mersi hi hello hey yes no good great super perfect bine sigur salut buna please te rog');
const PRON_DEICTIC = set('it this that these those them they he she there thing things stuff something asta aceasta acesta aia acestea acela lucrul chestia chestii lucruri');
const NAME_HELPERS = set('mr mrs ms dr');

// ---- English lexicon -------------------------------------------------------------------------------------------------------
const EN = {
  universal: set('every each all any whoever whatever whichever everyone everybody anyone anybody'),
  recurrence: set('day week month year night morning evening hour minute quarter monday tuesday wednesday thursday friday saturday sunday weekday'),
  defaultStrong: set('usually normally typically generally ordinarily commonly mostly mainly'),
  defaultWeak: set('often sometimes frequently'),
  defaultPhrases: ['as a rule', 'by default', 'in general', 'on the whole', 'tends to', 'tend to', 'tended to', 'for the most part', 'more often than not'],
  exceptWords: set('except excepting excluding'),
  exceptPhrases: ['apart from', 'other than', 'save for', 'with the exception of', 'with the exceptions of', 'unless otherwise', 'barring'],
  defineLemma: set('define definition denote constitute'),
  definePhrases: ['refers to', 'refer to', 'is called', 'are called', 'is known as', 'are known as', 'by definition', 'stands for', 'stand for', 'is defined as', 'are defined as', 'in this document', 'for the purposes of', 'for purposes of', 'is any', 'is a person who', 'is someone who'],
  deonticStrong: set('must shall'),
  deonticPhrases: ['have to', 'has to', 'had to', 'need to', 'needs to', 'is to', 'are to', 'not allowed', 'not permitted', 'is not to', 'be sure to', 'make sure to', 'at all times', 'no later than', 'not later than', 'at the latest', 'by the end of', 'by no later'],
  deonticAdj: set('required obliged obligated mandatory compulsory forbidden prohibited banned barred allowed permitted entitled authorised authorized'),
  deonticNoun: set('obligation duty requirement prohibition permission deadline penalty violation compliance sanction fine'),
  deonticVerbs: set('require prohibit forbid ban permit oblige entitle'),
  sequencers: ['first', 'firstly', 'second', 'secondly', 'third', 'thirdly', 'then', 'next', 'after that', 'afterwards', 'afterward', 'finally', 'lastly', 'subsequently', 'once done', 'once that is done', 'step one', 'step two', 'step 1', 'step 2'],
  failure: ['if it fails', 'if this fails', 'if that fails', 'if the step fails', 'if it does not work', 'if this does not work', 'on failure', 'in case of failure', 'in case of error', 'otherwise', 'if not successful', 'if unsuccessful', 'if that does not work', 'if it still fails', 'if the check fails'],
  stepWords: set('procedure process steps instructions workflow protocol checklist routine'),
  aggNoun: set('total sum average subtotal aggregate tally median maximum minimum'),
  aggPhrases: ['the number of', 'the count of', 'in total', 'multiplied by', 'divided by', 'added up', 'adds up', 'add up', 'sum of', 'a percentage of', 'percent of', 'per cent of'],
  aggVerbs: set('calculate compute multiply divide subtract deduct sum total average'),
  compareWords: set('above below over under exceeding exceeds exceed greater less fewer more'),
  comparePhrases: ['at least', 'at most', 'no more than', 'no less than', 'up to', 'more than', 'less than', 'fewer than', 'greater than', 'not exceed', 'not more than'],
  integrityPhrases: ['no two', 'at most one', 'exactly one', 'only one', 'mutually exclusive', 'at the same time', 'at once', 'never both', 'cannot both', 'can not both', 'not both', 'more than one', 'twice', 'duplicate', 'duplicates', 'unique', 'overlap', 'overlaps', 'double-booked', 'double booked', 'double booking'],
  closedPhrases: ['no other', 'no others', 'nobody else', 'no one else', 'nothing else', 'none other', 'all and only', 'complete list', 'exhaustive list', 'full list', 'these are all', 'that is all', 'that is the full list', 'there are no more', 'nothing more', 'exactly the following', 'exactly these', 'and nobody else', 'and no one else', 'and nothing else', 'is exhaustive', 'are exhaustive', 'no exceptions', 'are the only', 'is the only', 'were the only', 'was the only'],
  closedStrong: ['all and only', 'complete list', 'exhaustive list', 'full list', 'these are all', 'that is the full list', 'exactly the following', 'exactly these'],
  temporalVerbs: set('expire expires expired expiring'),
  temporalPhrases: ['no longer', 'used to', 'formerly', 'previously', 'until further notice', 'from now on', 'as of', 'valid from', 'valid until', 'valid through', 'valid for', 'remain valid', 'remains valid', 'valid for a period', 'effective from', 'effective on', 'effective as of', 'in force', 'takes effect', 'take effect', 'came into effect', 'comes into effect', 'came into force', 'comes into force', 'with effect from', 'starting from', 'starting on', 'beginning on', 'beginning in', 'until recently', 'not until', 'remains valid', 'remained valid', 'is valid', 'was valid', 'are valid', 'were valid', 'retroactive', 'retroactively', 'superseded', 'is replaced', 'was replaced', 'came into', 'applies from', 'applied until'],
  sourcePhrases: ['according to', 'as stated in', 'as stated by', 'as per', 'pursuant to', 'as specified in', 'as set out in', 'as defined in', 'as required by', 'as provided in', 'as provided by', 'as laid down in', 'in accordance with', 'under section', 'under article', 'under clause', 'under the terms of', 'as described in', 'per section', 'per the', 'in line with'],
  sourceSayers: set('manual policy handbook contract regulation regulations report document standard guideline guidelines specification law act agreement protocol agency authority statute directive memo rulebook code ordinance charter bylaws manual'),
  sourceSayVerbs: set('say state specify provide require stipulate note define list prescribe mandate establish set lay indicate declare describe'),
  sourceRef: /^(section|article|clause|chapter|paragraph|annex|appendix|rule|schedule)$/,
  hypo: ['what if', 'suppose', 'supposing', 'assume that', 'assuming that', 'imagine', 'hypothetically', 'were to', 'would it still', 'would that change', 'what would happen if', 'what would change if', 'what happens if', 'how would', 'if instead', 'what about if', 'say that'],
  hypoSubjunctive: /\bif\b.*\bwere\b|\bwere\b.*\bif\b|\bif\b.*\bwould\b|\bhad\b.*\bwould\b|\bwhat (would|will)\b.*\bif\b|\bhow (would|will)\b.*\bif\b/,
  policyNoun: set('rule rules policy policies limit limits threshold thresholds fee fees rate rates deadline deadlines requirement requirements procedure procedures regulation regulations law laws tariff tariffs exception exceptions penalty penalties quota quotas cap caps norm norms clause clauses restriction restrictions allowance allowance tax taxes discount discounts guideline guidelines cutoff'),
  condMarks: set('if when whenever once provided assuming'),
  condPhrases: ['as soon as', 'in case', 'provided that', 'in the event', 'every time', 'each time', 'any time', 'anytime'],
  failureNeg: set('not'),
  sequencerBlockers: set('if when whenever'),
  vague: set('it this that these those them'),
  stopwordsClass: set('a an the'),
};

// ---- Romanian lexicon (forms folded: no diacritics) --------------------------------------------------------------------------------------
const RO = {
  universal: set('fiecare orice toti toate tot oricine oricare oricui oricat'),
  recurrence: set('zi saptamana luna an noapte dimineata seara ora minut trimestru luni marti miercuri joi vineri sambata duminica'),
  defaultStrong: set('uzual obisnuit implicit'),
  defaultWeak: set('adesea deseori uneori frecvent'),
  defaultPhrases: ['de obicei', 'in general', 'in mod normal', 'in mod obisnuit', 'de regula', 'de cele mai multe ori', 'in mod implicit', 'majoritatea', 'tind sa', 'tinde sa', 'in principiu'],
  exceptWords: set('exceptand exceptie'),
  exceptPhrases: ['cu exceptia', 'in afara de', 'mai putin', 'cu exceptia cazului', 'exceptand', 'in afara cazului', 'cu exceptiile'],
  defineLemma: set('defini definitie'),
  definePhrases: ['inseamna', 'se numeste', 'se numesc', 'se defineste', 'se refera la', 'reprezinta', 'este definit', 'este definita', 'prin definitie', 'in sensul', 'in intelesul', 'prin * se intelege', 'se intelege prin'],
  deonticStrong: set('trebuie'),
  deonticAdj: set('obligatoriu obligatorie obligat obligata interzis interzisa interzise interzisi permis permisa permise permisi necesar necesara autorizat autorizata'),
  deonticNoun: set('obligatie obligatii cerinta cerinte interdictie permisiune termen sanctiune penalitate amenda incalcare conformitate'),
  deonticPhrases: ['are voie', 'au voie', 'nu are voie', 'nu au voie', 'ar trebui', 'nu este permis', 'nu e permis', 'nu se permite', 'se interzice', 'este necesar sa', 'e nevoie sa', 'este nevoie sa', 'se cere', 'este obligat', 'nu se poate', 'in cel mult', 'in termen de', 'pana cel tarziu', 'cel tarziu', 'in maximum', 'la maximum', 'in maxim', 'nu trebuie'],
  sequencers: ['mai intai', 'intai', 'apoi', 'dupa aceea', 'dupa asta', 'ulterior', 'in final', 'la sfarsit', 'in cele din urma', 'pasul 1', 'pasul 2', 'pasul unu', 'pasul doi', 'prima data', 'a doua oara', 'urmatorul pas', 'si dupa', 'iar apoi', 'dupa care', 'in continuare', 'la urma'],
  failure: ['daca nu reuseste', 'daca esueaza', 'daca nu merge', 'daca da gres', 'in caz de esec', 'in caz de eroare', 'altfel', 'in caz contrar', 'daca tot nu', 'daca nu functioneaza'],
  stepWords: set('procedura proces pasi pasii instructiuni flux protocol lista'),
  aggNoun: set('total suma media subtotal agregat maxim minim mediana'),
  aggPhrases: ['numarul de', 'numarul total', 'in total', 'inmultit cu', 'impartit la', 'adunat', 'se aduna', 'procent din', 'la suta din', 'suma dintre', 'suma de', 'pe cap de'],
  aggVerbs: set('calcula inmulti imparti scadea aduna totaliza insuma'),
  compareWords: set('peste sub depaseste depasi mai'),
  comparePhrases: ['cel putin', 'cel mult', 'mai mult de', 'mai putin de', 'mai mare de', 'mai mic de', 'nu mai mult de', 'nu mai putin de', 'pana la', 'nu depaseste', 'nu trebuie sa depaseasca'],
  integrityPhrases: ['nu pot fi doua', 'nu pot exista doua', 'nu pot fi doi', 'cel mult un', 'cel mult o', 'exact un', 'exact o', 'doar un', 'doar o', 'unic', 'unica', 'se exclud reciproc', 'in acelasi timp', 'simultan', 'duplicat', 'duplicate', 'se suprapun', 'suprapunere', 'de doua ori'],
  closedPhrases: ['nu exista altii', 'nu exista alte', 'nimeni altcineva', 'nimic altceva', 'nu mai exista', 'lista completa', 'lista exhaustiva', 'doar acestea', 'numai acestea', 'acestea sunt toate', 'si nimeni altcineva', 'singurii', 'singurele', 'singurul', 'singura', 'unicii', 'unicele', 'fara alte', 'fara exceptii'],
  closedStrong: ['lista completa', 'lista exhaustiva', 'acestea sunt toate', 'doar acestea', 'numai acestea', 'nu exista altii', 'nimeni altcineva'],
  temporalVerbs: set('expira expirat expirata'),
  temporalPhrases: ['nu mai', 'pana la noua dispozitie', 'de acum incolo', 'incepand cu', 'incepand de la', 'valabil pana', 'valabil de la', 'valabila pana', 'valabila de la', 'valabil', 'valabila', 'in vigoare', 'intra in vigoare', 'a intrat in vigoare', 'cu efect de la', 'pana recent', 'odinioara', 'altadata', 'pe vremuri', 'fostul', 'fosta', 'anterior', 'inlocuit', 'inlocuita', 'retroactiv', 'se aplica de la', 'se aplica pana'],
  sourcePhrases: ['conform', 'potrivit', 'in baza', 'in temeiul', 'asa cum prevede', 'asa cum se precizeaza', 'dupa cum prevede', 'in conformitate cu', 'in sensul', 'conform articolului', 'in baza articolului', 'prevazut in', 'prevazut de', 'stabilit in', 'stabilit prin'],
  sourceSayers: set('manual politica regulament regulamentul contract contractul lege legea norma norme raport documentul document standard standardul ghid ghidul specificatia acord acordul protocol protocolul autoritate autoritatea codul statut ordin ordinul hotarare hotararea'),
  sourceSayVerbs: set('spune prevede stabilesc stabileste precizeaza specifica cere impune defineste enumera indica declara descrie mentioneaza'),
  sourceRef: /^(sectiunea|articolul|art|clauza|capitolul|paragraful|anexa|punctul|alineatul|alin)$/,
  hypo: ['ce se intampla daca', 'ce s-ar intampla daca', 'sa presupunem', 'presupunem ca', 'sa zicem ca', 'sa zicem', 'imagineaza-ti', 'ipotetic', 'daca in schimb', 'ce-ar fi daca', 'ce ar fi daca', 'ce ar schimba', 'ar schimba'],
  hypoSubjunctive: /\bdaca\b.*\b(ar|ar fi|s-ar|ar putea)\b/,
  policyNoun: set('regula reguli politica politici limita limite prag praguri taxa taxe rata rate termen termene cerinta cerinte procedura proceduri regulament lege legi tarif tarife exceptie exceptii penalitate penalitati cota cote norma norme restrictie restrictii discount reducere reduceri'),
  condMarks: set('daca cand oricand'),
  condPhrases: ['ori de cate ori', 'in cazul', 'in cazul in care', 'de indata ce', 'cu conditia ca', 'in situatia in care', 'de fiecare data cand', 'atunci cand'],
  sequencerBlockers: set('daca cand'),
  vague: set('asta aceasta acesta aia acestea acela'),
};

EN.isEn = true; RO.isRo = true;
/** Both lexicons merged, for a message identified as mixed Romanian and English. */
const mergeLex = (a, b) => Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map(k => { const x = a[k], y = b[k]; return [k, x === undefined ? y : y === undefined ? x : x instanceof Set ? new Set([...x, ...y]) : Array.isArray(x) ? [...x, ...y] : x instanceof RegExp ? {test: t => x.test(t) || y.test(t)} : x || y]; }));
const MIXED = mergeLex(EN, RO);
const lexiconOf = language => (language === 'ro' ? RO : language === 'mixed' ? MIXED : EN);

const phraseAt = (words, i, phrase) => { const p = phrase.split(' '); if (i + p.length > words.length) return 0; for (let k = 0; k < p.length; k++) if (p[k] !== '*' && words[i + k] !== p[k]) return 0; return p.length; };
const findPhrasesRaw = (words, phrases) => { const out = []; for (let i = 0; i < words.length; i++) for (const ph of phrases) { const n = phraseAt(words, i, ph); if (n) out.push({text: ph, at: i, n}); } return out; };
const isYear = w => /^(1[5-9]|20)\d\d$/.test(w);
const MONTHS = set('january february march april may june july august september october november december ianuarie februarie martie aprilie mai iunie iulie august septembrie octombrie noiembrie decembrie');
const isDateish = w => isYear(w) || MONTHS.has(w) || /^\d{1,2}[./-]\d{1,2}([./-]\d{2,4})?$/.test(w);
const IRREGULAR_PAST = set('was were had did went took got made said came ran gave found left paid held wrote began sold bought built sent met saw knew thought told felt kept brought stood lost');

/** Rows of one analysis sentence -> tokens with children and folded text. */
export function treeOf(sentence) {
  const toks = (sentence.tokens ?? []).map(([id, form, lemma, upos, head, deprel]) => ({id, form: String(form), w: fold(form), lemma: fold(lemma ?? form), upos, head, deprel: deprel ?? 'dep', kids: []}));
  const byId = new Map(toks.map(t => [t.id, t]));
  for (const t of toks) { t.parent = t.head ? byId.get(t.head) ?? null : null; t.parent?.kids.push(t); }
  return {toks, byId, text: sentence.text ?? toks.map(t => t.form).join(' ')};
}

/** The question / imperative / subject features of a sentence; they decide which cues are muted. */
export function featuresOf(tree, lex) {
  const {toks, text} = tree;
  const words = toks.filter(t => t.upos !== 'PUNCT');
  const first = words[0];
  const root = toks.find(t => t.deprel === 'root') ?? words.find(t => t.upos === 'VERB' || t.upos === 'AUX') ?? null;
  const question = /\?\s*["')\]»”]*\s*$/.test(text.trim()) || (first && (WH.has(first.w) || (first.upos === 'AUX' && AUX_Q.has(first.w) && toks.some(t => t.deprel.startsWith('nsubj') && t.id > first.id && t.head === (root?.id ?? -1)) && !words.some(t => lex.condMarks.has(t.w) && t.id < first.id))));
  const subj = root ? root.kids.find(k => k.deprel === 'nsubj' || k.deprel === 'nsubj:pass') ?? null : null;
  const startsWithVerb = first && (first.upos === 'VERB' || (first.upos === 'ADV' && /^(please|then|never|always|first|finally)$/.test(first.w) && words[1]?.upos === 'VERB') || (first.upos === 'AUX' && /^(do|don|dont|nu)$/.test(first.w) && words.some(t => /^(not|n't|nt)$/.test(t.w))));
  const imperativeEn = !question && root && (root.upos === 'VERB' || root.upos === 'AUX') && !subj && root.w === root.lemma && !(first && first.upos !== 'VERB' && !/^(please|then|first|finally|never|always|do|dont|don)$/.test(first.w) && words.indexOf(first) > 1);
  const imperative = !question && (imperativeEn || (lex.isRo && !!startsWithVerb && !subj && !toks.some(t => /^(am|ai|a|au|este|e|sunt|suntem|eram|fi|va|vor)$/.test(t.w) && t.upos === 'AUX' && t.id < (root?.id ?? 99))));
  let subjectKind = 'none', bare = false;
  if (subj) {
    subjectKind = subj.upos === 'PROPN' ? 'proper' : subj.upos === 'PRON' ? 'pronoun' : /^(NOUN|NUM|ADJ)$/.test(subj.upos) ? 'common' : 'other';
    const dets = subj.kids.filter(k => /^(det|nummod|nmod:poss|det:poss|amod)$/.test(k.deprel) && !/^(new|old|big|small|other|same|following)$/.test(k.w));
    bare = subjectKind === 'common' && lex.isEn && subj.w !== subj.lemma && !dets.some(k => k.deprel !== 'amod') && !subj.kids.some(k => k.deprel === 'nmod:poss');
  }
  const pastish = !!root && (/ed$/.test(root.w) && root.w !== root.lemma || IRREGULAR_PAST.has(root.w) || root.kids.some(k => k.deprel.startsWith('aux') && /^(was|were|had|did|would)$/.test(k.w)));
  return {question, imperative, subject: subj?.form ?? null, subject_kind: subjectKind, bare_plural_subject: bare && !pastish, past: pastish, root: root?.form ?? null, words: words.length};
}

/** All cues of a sentence. Weights are the cue's own strength; muting for questions and imperatives happens in `scoreWires`. */
export function cuesOf(tree, feats, lex, language) {
  const {toks} = tree;
  const ws = toks.map(t => t.w), ls = toks.map(t => t.lemma);
  // a phrase matches on surface forms or on lemmas ("remain valid" for "remains valid", "has to" for "have to")
  const findPhrases = (words, phrases) => { const seen = new Set(), out = []; for (const arr of [words, ls]) if (arr.length === words.length) for (const x of findPhrasesRaw(arr, phrases)) { const k = x.at + ':' + x.text; if (!seen.has(k)) { seen.add(k); out.push(x); } } return out; };
  const cues = [];
  let n = 0;
  const add = (wire, type, weight, text, tokens = [], extra = {}) => cues.push({id: `c${++n}`, wire, type, text, tokens, weight, ...extra});
  const tokIds = (at, len) => toks.slice(at, at + len).map(t => t.id);
  const hasCond = toks.some(t => lex.condMarks.has(t.w) && (t.deprel === 'mark' || t.upos === 'SCONJ' || t.deprel === 'advmod')) || findPhrases(ws, lex.condPhrases).length > 0;
  const subjectGeneric = feats.bare_plural_subject;

  // --- universal quantification and generic statements -> rule -----------------------------------------------------------
  let universal = false;
  for (const t of toks) {
    if (!lex.universal.has(t.w) && !lex.universal.has(t.lemma)) continue;
    if (!/^(DET|ADJ|PRON|ADV)$/.test(t.upos)) continue;
    const head = t.parent;
    if (/^(day|week|month|year|night|morning|evening|hour|minute|time)$/.test(head?.lemma ?? '') || lex.recurrence.has(head?.lemma ?? '')) {
      if (head.kids.some(k => k.deprel === 'case') || ws[Math.max(0, t.id - 2)] === 'at') continue; // "at any time", "during every shift" restate a scope, they are not a trigger
      const everyTime = /^(time|data|dat)$/.test(head?.lemma ?? '');
      add('rule', everyTime ? 'every_time' : 'recurrence', everyTime ? 0.6 : 0.3, `${t.form} ${head.form}`, [t.id, head.id]);
      continue;
    }
    if (t.w === 'any' && !(head && /^(nsubj|nsubj:pass)$/.test(head.deprel))) continue; // "any" in an object or negated clause is a polarity item, not a universal
    if (/^(all|toti|toate|tot)$/.test(t.w) && head?.kids.some(k => k.deprel === 'nummod')) continue; // "all three employees" is specific
    if (/^(all|toti|toate)$/.test(t.w) && t.parent && /^(PROPN|PRON)$/.test(t.parent.upos)) continue;
    if (/^(all|every|each)$/.test(t.w) && head && head.upos === 'PRON' && /^(i|you|we|they|he|she|it)$/.test(head.lemma) && t.deprel !== 'det') continue;
    universal = true;
    add('rule', 'universal_determiner', 0.62, `${t.form}${head && head !== t ? ' ' + head.form : ''}`, [t.id, head?.id].filter(Boolean));
  }
  if (feats.bare_plural_subject && lex.isEn) add('rule', 'bare_plural_generic', 0.5, feats.subject ?? '', []), add('default', 'bare_plural_generic', 0.3, feats.subject ?? '', []);
  for (const t of toks) if (t.deprel === 'acl:relcl' && t.parent && /^(everyone|anyone|whoever|those|people|oricine|cei|cele)$/.test(t.parent.lemma)) add('rule', 'universal_relative', 0.45, `${t.parent.form} ... ${t.form}`, [t.parent.id, t.id]);
  // conditional whose condition clause has an indefinite subject: "if a customer pays late, ..."
  for (const t of toks) {
    if (!(lex.condMarks.has(t.w) && /^(mark|advmod|cc)$/.test(t.deprel))) continue; // the Romanian tagger often calls an undiacritised "daca" an adverb
    const subjOf = v => v?.kids.find(k => (k.deprel === 'nsubj' || k.deprel === 'nsubj:pass') && k.id > t.id);
    const clause = subjOf(t.parent) ? t.parent : toks.find(v => v.id > t.id && v.upos === 'VERB' && subjOf(v)) ?? t.parent; // the parser sometimes hangs "whenever" on the main verb
    const cs = clause ? subjOf(clause) ?? clause.kids.find(k => k.deprel === 'nsubj' || k.deprel === 'nsubj:pass') : null;
    if (!cs) continue;
    const det = cs.kids.find(k => k.deprel === 'det');
    const indefinite = (det && /^(a|an|any|every|each|un|o|orice|fiecare|vreun|vreo)$/.test(det.w)) || (cs.upos === 'NOUN' && !det && !cs.kids.some(k => /^(nmod:poss|nummod)$/.test(k.deprel)) && lex.isEn && cs.w !== cs.lemma) || /^(anyone|everyone|someone|whoever|oricine|cineva)$/.test(cs.lemma);
    if (indefinite && !feats.question) add('rule', 'conditional_indefinite', 0.7, `${t.form} ${det ? det.form + ' ' : ''}${cs.form}`, [t.id, cs.id]);
  }
  if (!feats.question) for (const p of findPhrases(ws, ['only if', 'doar daca', 'numai daca', 'if and only if'])) add('rule', 'only_if', 0.4, p.text, tokIds(p.at, p.n));
  // indefinite singular copular class statement: "A penguin is a bird that cannot fly"
  if (lex.isEn && feats.subject && !feats.question) {
    const subj = toks.find(t => t.form === feats.subject && (t.deprel === 'nsubj'));
    const cop = subj && subj.parent && subj.parent.kids.some(k => k.deprel === 'cop');
    if (subj && cop && subj.kids.some(k => k.deprel === 'det' && /^(a|an)$/.test(k.w))) add('definition', 'class_statement', 0.6, `${subj.kids.find(k => k.deprel === 'det').form} ${subj.form} ...`, [subj.id]), add('rule', 'class_statement', 0.4, subj.form, [subj.id]);
  }

  // bare singular subject, copular predicate nominal with a relative clause: "Photosynthesis is the process by which ..."
  if (lex.isEn && feats.subject && !feats.question) {
    const subj = toks.find(t => t.form === feats.subject && t.deprel === 'nsubj');
    const pred = subj?.parent;
    if (subj && pred && /^(NOUN)$/.test(subj.upos) && !subj.kids.some(k => /^(det|nmod:poss|nummod)$/.test(k.deprel)) && subj.w === subj.lemma && pred.kids.some(k => k.deprel === 'cop') && pred.kids.some(k => /^(acl|acl:relcl)$/.test(k.deprel))) add('definition', 'bare_term_relative', 0.55, `${subj.form} is ... ${pred.form}`, [subj.id, pred.id]);
  }

  // --- defaults and exceptions ---------------------------------------------------------------------------------------------
  for (const t of toks) {
    if (lex.defaultStrong.has(t.w) || lex.defaultStrong.has(t.lemma)) add('default', 'default_adverb', feats.subject_kind === 'proper' || feats.subject_kind === 'pronoun' ? 0.45 : 0.7, t.form, [t.id]);
    else if (lex.defaultWeak.has(t.w)) add('default', 'weak_default_adverb', 0.3, t.form, [t.id]);
    if (lex.exceptWords.has(t.w) && !feats.question) add('default', 'exception', 0.4, t.form, [t.id], {note: 'exception to a general statement'});
    if (/^(unless|except)$/.test(t.w)) add('default', 'unless', 0.3, t.form, [t.id]);
  }
  for (const p of findPhrases(ws, lex.defaultPhrases)) add('default', 'default_phrase', 0.7, p.text, tokIds(p.at, p.n));
  for (const p of findPhrases(ws, lex.exceptPhrases)) add('default', 'exception', 0.4, p.text, tokIds(p.at, p.n));
  for (const t of toks) if (/^(most|majoritatea)$/.test(t.w) && /^(DET|ADJ|NOUN)$/.test(t.upos) && !feats.question && t.parent && /^(NOUN)$/.test(t.parent.upos)) add('default', 'most', 0.55, `${t.form} ${t.parent.form}`, [t.id, t.parent.id]);

  // --- definitions ---------------------------------------------------------------------------------------------------------
  for (const t of toks) if ((lex.defineLemma.has(t.lemma) || lex.defineLemma.has(t.w)) && !/^(undefined)$/.test(t.w)) add('definition', 'define_word', 0.75, t.form, [t.id]);
  for (const p of findPhrases(ws, lex.definePhrases)) add('definition', 'define_phrase', /means|inseamna|refers|defined|stands/.test(p.text) ? 0.6 : 0.5, p.text, tokIds(p.at, p.n));
  for (const t of toks) if (t.lemma === 'mean' && t.upos === 'VERB' && !feats.question && t.kids.some(k => k.deprel === 'nsubj')) add('definition', 'mean_verb', 0.5, t.form, [t.id]);

  // --- norms ---------------------------------------------------------------------------------------------------------------
  const roleSubject = feats.subject_kind === 'common';
  for (const t of toks) {
    const w = t.w;
    if (lex.deonticStrong.has(w) && (t.upos === 'AUX' || t.upos === 'VERB')) add('norm', 'modal_strong', feats.subject_kind === 'pronoun' && /^(i|we)$/.test(fold(feats.subject ?? '')) ? 0.5 : 0.7, t.form, [t.id]);
    else if (lex.isEn && /^(should|ought)$/.test(w)) add('norm', 'modal_weak', roleSubject ? 0.6 : 0.4, t.form, [t.id]);
    else if (lex.isEn && w === 'may' && t.upos === 'AUX') add('norm', 'modal_may', roleSubject ? 0.5 : 0.3, t.form, [t.id]);
    else if (lex.isEn && (w === 'cannot' || (w === 'can' && ws[t.id] === 'not'))) add('norm', 'modal_cannot', roleSubject ? 0.45 : 0.3, t.form, [t.id]);
    else if (lex.deonticAdj.has(w) || lex.deonticAdj.has(t.lemma)) add('norm', 'deontic_word', 0.7, t.form, [t.id]);
    else if (lex.deonticNoun.has(t.lemma) && t.upos === 'NOUN') add('norm', 'deontic_noun', 0.3, t.form, [t.id]);
    else if (lex.deonticVerbs?.has(t.lemma) && t.upos === 'VERB') add('norm', 'deontic_verb', 0.55, t.form, [t.id]);
  }
  for (const p of findPhrases(ws, lex.deonticPhrases)) {
    const weight = /have to|has to|had to|not allowed|not permitted|are to|is to|are not|nu are voie|nu au voie|are voie|au voie|nu este permis|se interzice|ar trebui|nu trebuie|nu se permite|este obligat/.test(p.text) ? 0.65 : /need|nevoie|necesar|sure/.test(p.text) ? 0.35 : /later|latest|cel tarziu|termen|maxim|cel mult|by the end/.test(p.text) ? 0.4 : 0.35;
    add('norm', 'deontic_phrase', roleSubject && weight < 0.5 && !/later|latest|cel tarziu|termen|maxim|cel mult|by the end/.test(p.text) ? weight + 0.15 : weight, p.text, tokIds(p.at, p.n));
  }
  for (let i = 0; i < ws.length; i++) {
    if (ws[i] === 'within' && toks[i + 1] && (toks[i + 1].upos === 'NUM' || /^(a|an|one)$/.test(ws[i + 1]) || /^\d/.test(ws[i + 1])) && toks[i + 2] && /^(second|minute|hour|day|week|month|year|business|working|calendar)/.test(toks[i + 2].lemma)) add('norm', 'deadline', 0.45, `${toks[i].form} ${toks[i + 1].form} ${toks[i + 2].form}`, tokIds(i, 3));
  }

  // --- methods: ordered steps and recovery -----------------------------------------------------------------------------------
  const markIdx = toks.filter(t => lex.sequencerBlockers?.has(t.w) && t.deprel === 'mark').map(t => t.id);
  let seq = 0;
  for (const p of findPhrases(ws, lex.sequencers)) {
    if (p.text === 'then' && markIdx.some(i => i < toks[p.at].id)) continue; // "if A, then B" is a conditional, not a step
    if (p.n === 1 && p.text !== 'then' && toks[p.at].upos !== 'ADV' && p.at > 0) continue; // "the first attempt" is an adjective, not a step marker
    if (p.n === 1 && p.text !== 'then' && toks[p.at].upos === 'ADJ' && toks[p.at].deprel === 'amod') continue;
    seq++; add('method', 'sequencer', 0.35, p.text, tokIds(p.at, p.n));
  }
  for (const p of findPhrases(ws, lex.failure)) add('method', 'on_failure', 0.35, p.text, tokIds(p.at, p.n));
  const imperatives = toks.filter(t => t.upos === 'VERB' && t.w === t.lemma && lex.isEn && !t.kids.some(k => k.deprel === 'nsubj') && (t.deprel === 'root' || (/^(conj|parataxis)$/.test(t.deprel) && t.parent && (t.parent.deprel === 'root' || /^(conj|parataxis)$/.test(t.parent.deprel)) && t.parent.w === t.parent.lemma)));
  if (!feats.question && imperatives.length >= 2) { add('method', 'imperative_chain', Math.min(0.5, 0.3 + 0.1 * (imperatives.length - 2)), imperatives.map(t => t.form).join(' + '), imperatives.map(t => t.id)); if (hasCond) add('method', 'conditional_step', 0.3, 'if ... in a step chain', []); }
  if (lex.isRo) { const rv = toks.filter(t => t.upos === 'VERB' && t.deprel === 'conj' && t.parent?.deprel === 'root' && !t.kids.some(k => k.deprel === 'nsubj')); if (!feats.question && feats.imperative && rv.length >= 1) add('method', 'imperative_chain', 0.25, [feats.root, ...rv.map(t => t.form)].join(' + '), rv.map(t => t.id)); }
  for (const t of toks) if (lex.stepWords.has(t.lemma) && t.upos === 'NOUN' && !feats.question) add('method', 'procedure_noun', 0.25, t.form, [t.id]);
  if (/(?:^|\s)(?:\d\)|\d\.\s|step\s*\d|pasul\s*\d)/i.test(tree.text) && /(?:^|\s)(?:\d\)|\d\.\s)[\s\S]*(?:\d\)|\d\.\s)/.test(tree.text)) add('method', 'numbered_steps', 0.5, 'numbered list', []);

  // --- aggregates and formulas -------------------------------------------------------------------------------------------------
  for (const t of toks) {
    if (lex.aggNoun.has(t.lemma) && /^(NOUN|ADJ|ADV)$/.test(t.upos)) add('aggregate', 'aggregate_noun', 0.3, t.form, [t.id]); // a stated value ("the average is 64") is a ground fact; the formula cues below make it an aggregate
    if (lex.aggVerbs.has(t.lemma) && t.upos === 'VERB') add('aggregate', 'aggregate_verb', 0.5, t.form, [t.id]);
    if (/^(percent|percentage|procent|procente|%)$/.test(t.w) || t.form === '%') add('aggregate', 'percentage', 0.4, t.form, [t.id]);
    if (/^(times|plus|minus|inmultit|impartit)$/.test(t.w) && toks.some(k => k.upos === 'NUM' && Math.abs(k.id - t.id) <= 3)) add('aggregate', 'arithmetic_word', 0.45, t.form, [t.id]);
  }
  for (const p of findPhrases(ws, lex.aggPhrases)) add('aggregate', 'aggregate_phrase', 0.35, p.text, tokIds(p.at, p.n));
  const numeric = toks.some(t => t.upos === 'NUM' || /\d/.test(t.w));
  const cmp = findPhrases(ws, lex.comparePhrases); for (const t of toks) if (lex.compareWords.has(t.w) && t.upos !== 'AUX') cmp.push({text: t.form, at: t.id - 1, n: 1});
  const general = universal || subjectGeneric || hasCond || cues.some(c => c.wire === 'rule' && c.weight >= 0.5);
  if (numeric && cmp.length && general && !feats.question) add('rule', 'numeric_threshold', 0.4, cmp[0].text, tokIds(cmp[0].at, cmp[0].n)), add('aggregate', 'numeric_threshold', 0.2, cmp[0].text, tokIds(cmp[0].at, cmp[0].n));

  // --- integrity: a state that must never occur ------------------------------------------------------------------------------
  for (const p of findPhrases(ws, lex.integrityPhrases)) add('integrity', 'integrity_phrase', /no two|at most one|exactly one|mutually|nu pot fi|cel mult un|exact un|exclud|never both|cannot both|not both/.test(p.text) ? 0.6 : 0.4, p.text, tokIds(p.at, p.n));
  for (const t of toks) if (/^(never|niciodata)$/.test(t.w) && t.parent && /^(be|have|hold|occur|happen|contain|exist|fi|avea)$/.test(t.parent.lemma) && !feats.imperative) add('integrity', 'never_state', 0.5, `${t.form} ${t.parent.form}`, [t.id, t.parent.id]);
  // "No classroom may contain more than thirty students": a negative quantifier subject with an upper bound
  { const neg = toks.find(t => /^(no|niciun|nicio)$/.test(t.w) && /^(det|advmod)$/.test(t.deprel)); const bound = findPhrases(ws, ['more than', 'at most', 'no more than', 'exceed', 'mai mult de', 'cel mult']).length || toks.some(t => /^(exceed|exceeds|depasi|depaseste)$/.test(t.w));
    if (neg && bound && toks.some(t => t.upos === 'NUM' || /\d/.test(t.w)) && !feats.imperative) add('integrity', 'negative_bound', 0.55, `${neg.form} ... bound`, [neg.id]); }
  for (const t of toks) if (/^(exceed|exceeds|depasi|depaseste)$/.test(t.w) || t.lemma === 'exceed') add('integrity', 'limit_exceed', 0.4, t.form, [t.id]);

  // --- closedness ------------------------------------------------------------------------------------------------------------
  for (const p of findPhrases(ws, lex.closedPhrases)) add('closed', 'closed_phrase', lex.closedStrong.includes(p.text) ? 0.8 : 0.55, p.text, tokIds(p.at, p.n));
  for (const t of toks) {
    if (/^(only|doar|numai|sole|solely|exclusively|exclusiv)$/.test(t.w)) {
      const h = t.parent;
      if (!h) continue;
      if (/^(solely|exclusively|exclusiv)$/.test(t.w)) { add('closed', 'solely', 0.5, t.form, [t.id]); continue; }
      const nominal = /^(nsubj|nsubj:pass|obj|nmod|obl)$/.test(h.deprel) || /^(NOUN|PROPN|PRON)$/.test(h.upos);
      if (t.deprel === 'amod' && /^(NOUN)$/.test(h.upos) && t.w === 'only' && /(?:the|these|those)/.test(ws[Math.max(0, t.id - 2)] ?? '')) add('closed', 'the_only', 0.55, `${t.form} ${h.form}`, [t.id, h.id]);
      else if (nominal && /^(advmod|cc|amod|det)$/.test(t.deprel) && (h.deprel.startsWith('nsubj') || h.upos === 'PROPN')) add('closed', 'only_subject', 0.55, `${t.form} ${h.form}`, [t.id, h.id]);
      else add('closed', 'only_adverb', 0.12, t.form, [t.id]);
    }
  }

  // --- temporal validity ---------------------------------------------------------------------------------------------------------
  const dates = ws.map(isDateish);
  for (let i = 0; i < ws.length; i++) {
    if (/^(from|since|de|din|incepand|pana|until|till|through|between)$/.test(ws[i]) || false) {
      const near = [1, 2, 3].some(k => dates[i + k]);
      if (near) add('temporal', 'date_bound', /^(since|din)$/.test(ws[i]) ? 0.4 : 0.4, `${toks[i].form} ${toks[i + 1]?.form ?? ''} ${toks[i + 2]?.form ?? ''}`.trim(), tokIds(i, 3));
    }
  }
  const bounds = cues.filter(c => c.wire === 'temporal' && c.type === 'date_bound');
  if (bounds.length >= 2) add('temporal', 'interval', 0.5, bounds.map(c => c.text).join(' ... '), [], {note: 'two date bounds'});
  for (const p of findPhrases(ws, lex.temporalPhrases)) add('temporal', 'validity_phrase', /no longer|nu mai|used to|formerly|valid|in force|in vigoare|effect|expire|retroactiv|until further|pana la noua/.test(p.text) ? 0.55 : 0.4, p.text, tokIds(p.at, p.n));
  // a statement scoped to a named period ("during the last fiscal year", "throughout the summer term")
  for (const t of toks) if (/^(year|period|window|quarter|term|season|vacation|semester|perioada|trimestru)$/.test(t.lemma) && t.upos === 'NOUN' && t.kids.some(k => k.deprel === 'case' && /^(during|throughout|in timpul)$/.test(k.w)) && t.kids.some(k => /^(amod|det)$/.test(k.deprel) && /^(annual|last|previous|next|current|fiscal|academic|summer|winter|whole|entire|ultimul|anul)$/.test(k.w))) add('temporal', 'period_scope', 0.3, `${t.kids.find(k => k.deprel === 'case').form} ... ${t.form}`, [t.id]);
  for (const t of toks) if (lex.temporalVerbs.has(t.w) || lex.temporalVerbs.has(t.lemma)) add('temporal', 'expiry', 0.55, t.form, [t.id]);

  // --- claims attributed to a document or authority -----------------------------------------------------------------------------
  for (const p of findPhrases(ws, lex.sourcePhrases)) add('sourced', 'source_phrase', /according to|conform|potrivit|pursuant|as per|as stated|in baza|in temeiul/.test(p.text) ? 0.55 : 0.4, p.text, tokIds(p.at, p.n));
  for (const t of toks) {
    if (lex.sourceRef.test(t.w) && toks[t.id] && (toks[t.id].upos === 'NUM' || /^\d/.test(toks[t.id].w) || /^[a-z]\)?$/.test(toks[t.id].w))) add('sourced', 'section_reference', 0.5, `${t.form} ${toks[t.id].form}`, [t.id, t.id + 1]);
    if (lex.sourceSayers.has(t.lemma) && t.upos === 'NOUN' && t.deprel.startsWith('nsubj') && t.parent && lex.sourceSayVerbs.has(t.parent.lemma)) add('sourced', 'document_says', 0.65, `${t.form} ${t.parent.form}`, [t.id, t.parent.id]);
  }

  // --- hypotheticals over rules and policies (also valid in questions) ---------------------------------------------------------
  const lowText = fold(tree.text);
  const hypoHit = findPhrases(ws, lex.hypo)[0] ?? (lex.hypoSubjunctive.test(lowText) ? {text: 'if ... would/were', at: 0, n: 0} : null);
  const policy = toks.find(t => lex.policyNoun.has(t.lemma) && /^(NOUN|PROPN)$/.test(t.upos));
  if (hypoHit && policy) add('amendment', 'hypothetical_policy', 0.7, `${hypoHit.text} ... ${policy.form}`, [policy.id]);
  else if (hypoHit && hypoHit.text !== 'if ... would/were') add('amendment', 'hypothetical_plain', 0.15, hypoHit.text, tokIds(hypoHit.at, hypoHit.n));

  // --- clarification: nothing to act on or an ambiguous referent --------------------------------------------------------------------
  const content = toks.filter(t => /^(NOUN|PROPN|NUM|ADJ)$/.test(t.upos) && !PRON_DEICTIC.has(t.w));
  const verbs = toks.filter(t => t.upos === 'VERB');
  const predicates = toks.filter(t => t.upos === 'VERB' || t.upos === 'AUX');
  const onlyGreeting = toks.every(t => GREETING.has(t.w) || t.upos === 'PUNCT');
  // no predicate at all: a noun phrase or a clipped phrase ("La transformarea spre SOP Lang?", "cumva un fel de clarificatoare ?")
  if (feats.words >= 2 && !predicates.length && !onlyGreeting) add('clarify', 'fragment', 0.5, tree.text.trim(), []);
  // only deictic arguments ("Fix this.", "Is this correct?"): nothing to act on without the earlier turn
  if (predicates.length && content.length === 0 && toks.some(t => lex.vague.has(t.w) || PRON_DEICTIC.has(t.w)) && !onlyGreeting) add('clarify', 'vague_reference', 0.55, 'only pronouns as arguments', []);
  return cues;
}

const noisyOr = ws => 1 - ws.reduce((p, w) => p * (1 - w), 1);

/** Group cues by wire, mute what a question or an imperative cannot carry, and keep wires at or above the threshold. */
export function scoreWires(cues, feats) {
  const by = new Map();
  for (const c of cues) { if (c.wire === 'clarify') continue; (by.get(c.wire) ?? by.set(c.wire, []).get(c.wire)).push(c); }
  const wires = [], pending = [];
  for (const [wire, list] of by) {
    let use = list;
    if (feats.question && wire !== 'amendment') use = []; // a question is a query over knowledge, not knowledge
    else if (feats.imperative) {
      if (wire === 'method') use = list;
      else if (wire === 'norm') use = list.filter(c => /never|always|at all|modal_strong|deontic_word|deontic_phrase/.test(c.type));
      else use = [];
    }
    if (!use.length) continue;
    const score = noisyOr(use.map(c => c.weight));
    if (score >= THRESHOLD) pending.push({wire, score, use});
  }
  // A general statement that is also an obligation, a limit, a list claim, a formula or a procedure is written as that wire: the
  // "every X" / bare-plural cues that only say "this is general" do not add a rule of their own (both judges listed `norm`, not `rule`).
  const strong = new Set(pending.filter(p => p.score >= THRESHOLD && /^(norm|default|closed|integrity|aggregate|definition|method)$/.test(p.wire)).map(p => p.wire));
  for (const p of pending) {
    let use = p.use;
    if (p.wire === 'rule' && strong.size) { const own = use.filter(c => !/^(universal_determiner|bare_plural_generic|numeric_threshold|recurrence|every_time|universal_relative)$/.test(c.type)); if (!own.length || noisyOr(own.map(c => c.weight)) < THRESHOLD) continue; use = own; }
    if (p.wire === 'closed' && strong.has('norm') && use.every(c => c.type === 'only_subject')) continue; // "only nurses may ..." restricts who may, it does not close a list
    if (p.wire === 'aggregate' && strong.has('norm') && use.every(c => /^(numeric_threshold|percentage)$/.test(c.type))) continue; // "refunds cannot exceed 20 percent"
    const score = noisyOr(use.map(c => c.weight));
    wires.push({wire: p.wire, score: Math.round(score * 100) / 100, targets: WIRE_TARGETS[p.wire], cues: use.map(c => c.id)});
  }
  return wires.sort((a, b) => b.score - a.score);
}

/** The scope verdict of one analysis sentence (`{text, tokens}`); `language` is `en`, `ro` or `mixed` (both lexicons). */
export function detectScope(sentence, {language = 'en'} = {}) {
  const lex = lexiconOf(language);
  const tree = treeOf(sentence);
  const feats = featuresOf(tree, lex);
  const cues = cuesOf(tree, feats, lex, language);
  const wires = scoreWires(cues, feats);
  const clar = cues.filter(c => c.wire === 'clarify');
  const label = wires.length ? 'needs_knowledge_authoring' : clar.length ? 'needs_clarification' : 'surface_ok';
  const reason = wires.length ? `${wires.map(w => w.wire).join(', ')}: ${cues.filter(c => wires.some(w => w.cues.includes(c.id))).map(c => `"${c.text}" (${c.type})`).slice(0, 4).join(', ')}`
    : clar.length ? `${clar[0].type}: ${clar[0].text}` : feats.question ? 'a question: the query surface answers it' : 'ground statement, supposition or request';
  return {version: SCOPE_DETECT_VERSION, label, wires, cues, features: {question: feats.question, imperative: feats.imperative, subject: feats.subject, subject_kind: feats.subject_kind, bare_plural_subject: feats.bare_plural_subject, past: feats.past}, clarification: clar.map(c => ({type: c.type, text: c.text})), reason};
}

/** A whole analysis (`compactAnalysis`): one verdict per sentence plus the message-level verdict (a sequence of steps spread over sentences is a method). */
export function detectAnalysis(analysis) {
  const language = ['ro', 'mixed'].includes(analysis?.language) ? analysis.language : 'en';
  const sentences = (analysis?.sentences ?? []).map(s => ({text: s.text, ...detectScope(s, {language})}));
  const wires = new Map();
  for (const s of sentences) for (const w of s.wires) if (!wires.has(w.wire) || wires.get(w.wire).score < w.score) wires.set(w.wire, {...w, sentence: sentences.indexOf(s)});
  const starts = (analysis?.sentences ?? []).filter(s => { const f = (s.tokens ?? []).filter(t => t[3] !== 'PUNCT')[0]; return f && (/^(first|firstly|second|third|then|next|finally|lastly|step|mai|apoi|intai|pasul|in)$/.test(fold(f[1])) || /^\d+[.)]?$/.test(f[1]) || f[3] === 'VERB' && fold(f[1]) === fold(f[2])); }).length;
  if (starts >= 3 && !wires.has('method')) wires.set('method', {wire: 'method', score: 0.6, targets: WIRE_TARGETS.method, cues: [], sentence: null, note: `${starts} consecutive step-like sentences`});
  const label = wires.size ? 'needs_knowledge_authoring' : sentences.some(s => s.label === 'needs_clarification') ? 'needs_clarification' : 'surface_ok';
  return {version: SCOPE_DETECT_VERSION, label, wires: [...wires.values()].sort((a, b) => b.score - a.score), sentences};
}
