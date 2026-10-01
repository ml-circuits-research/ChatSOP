/**
 * Reasoning question forms of the UD → SOP rules (v2.7, owner priority 2026-10-01): the question forms of DS021
 * "Question forms" that are modes of a `query` beyond select/exists/count/explain/every. The rules read the UD tree
 * (function words, lemmas, part of speech and morphology only), never a lexicon of the knowledge, and write the
 * message's own words; the host links them. English only.
 *
 *   why_not    "Why can't I hard-reset the router?", "Why isn't Ana allowed to approve X?" (a modal negative "why"; the
 *              claim is the affirmed proposition, the modal is the mode); "What is stopping Ana from joining X?",
 *              "What prevents D from finishing?", "What is missing for the invoice to be approved?", "What would it
 *              take for Ana to join the lab?" (the claim is the blocked clause);
 *   plan       "How do I reset the router?", "How can we get access to the lab?", "How to deploy the service?",
 *              "What are the steps to reset the router?", "What do I need to do to get a refund?" (the goal is the
 *              claim; a first-person, "one" or subjectless "how");
 *   abduce     "What could explain the outage?", "What might have caused the delay?", "What could be the cause of the
 *              fever?", "What may be behind the failure of the pump?" (the observation is the claim; a nominal
 *              observation is its noun phrase as the subject of `occur`);
 *   procedure  "What is the procedure for resetting the router?", "What is the reset procedure?" (the task is the claim);
 *   conform    "Did we follow the reset procedure?", "Was the reset compliant?", "Was the procedure followed?" (the
 *              literal proposition; the performed trace is the host's).
 *   explain    "What is the reason that X doesn't qualify?" (the clause is explained; a negated clause stays negated).
 *   every      "Which teams have only certified players?" (a grouped universal: the groups whose members all satisfy the scope).
 * "Why isn't Ana a member?" and "What is the reason that X isn't Y?" stay `explain` with a negated claim (the corpus
 * convention); a plain "How does Ana commute?" stays an instrument question.
 */
import {kids, subtree} from './tree.mjs';

/** Modal words that open a relation phrase; in why_not and plan the mode says "can", so the claim drops it. */
export const MODAL_PREFIX = /^(?:can|could|will|would|should|may|might|must|shall|ought to) /;
const BLOCK_VERBS = new Set(['stop', 'prevent', 'block', 'hinder', 'impede', 'keep', 'bar']);
const MISSING_VERBS = new Set(['miss', 'lack', 'take', 'need', 'require']);
const ABDUCE_VERBS = new Set(['explain', 'cause', 'trigger', 'underlie', 'precipitate', 'account']);
const ABDUCE_NOUNS = new Set(['cause', 'explanation', 'culprit', 'origin', 'trigger']);
const PROCEDURE_NOUNS = new Set(['procedure', 'process', 'protocol', 'policy', 'checklist', 'routine', 'workflow', 'guideline', 'regulation', 'playbook', 'runbook']);
const REASON_NOUNS = new Set(['reason', 'explanation', 'motive']);
const STEP_NOUNS = new Set(['step', 'way', 'method', 'approach', 'instruction']);
const COMPLY_VERBS = new Set(['follow', 'comply', 'observe', 'adhere', 'conform', 'violate', 'breach']);
const COMPLY_ADJECTIVES = new Set(['compliant', 'conformant', 'noncompliant']);
/** Subjects of a how-question that make it a request for a plan (the asker, "one", "someone"). */
const GENERIC_SUBJECTS = new Set(['one', 'someone', 'somebody', 'we', 'i', 'me']);
/** A clause head: a verb, or a predicate adjective or noun with a copula ("to be wet"). */
const VERBAL = w => ['VERB', 'AUX'].includes(w.upos) || kids(w, 'cop').length > 0;

/** A proposition shell with the fields of `Analysis.proposition()`. */
const shell = h => ({relation: '', roles: [], polarity: 'affirmed', times: [], subordinate: [], complements: [], relatives: [], leftovers: [], hedged: false, heads: [h], coord: null, whAdverbs: [], universal: null, phrase: null, aspect: null, compares: [], rank: null, excepts: []});

/** Stanza lemmatizes "resetting" as "resett" with the accurate package; a doubled consonant the surface form does not need is dropped. */
export function gerundLemma(word) {
  const lemma = String(word.lemma ?? word.text).toLowerCase();
  const form = String(word.text).toLowerCase();
  if (word.upos === 'VERB' && form.endsWith('ing') && lemma === form.slice(0, -3) && /([bdgmnprt])\1$/.test(lemma) && !/^(add|odd|err|egg|inn|purr|butt|putt|ebb|mitt)$/.test(lemma)) return lemma.slice(0, -1);
  return lemma;
}

/** A question word, a question phrase, or a noun with a `which`/`what` determiner ("which fault"). */
const isWh = (a, w) => Boolean(w) && (Boolean(a.whWord(w)) || Boolean(w.whPhrase) || kids(w, 'det').some(d => ['which', 'what'].includes(d.folded) && d.id < w.id));
const hasModal = h => kids(h, 'aux').some(x => ['can', 'could', 'should', 'would', 'will', 'may', 'might', 'ca', 'wo'].includes(x.folded));
const hasMark = (k, ...words) => kids(k, 'mark').some(m => words.includes(m.folded));
const claimOf = (a, head, S, ctx, q, subject) => a.proposition(head, S, {...ctx, as: 'query', wh: undefined, inherit: subject ?? undefined}, q);
const usable = p => Boolean(p.relation) && p.roles.length > 0;

/** Marks the words of `nodes` except `keep` as consumed: a wrapper is never an unparsed span. */
const consume = (nodes, keep = []) => { const kept = new Set(keep); for (const w of nodes) if (!kept.has(w)) w.used = true; };

/** The relation of a clause built from `clause`, with the gerund's wrong lemma repaired. */
function fixLemma(p, clause) {
  const wrong = String(clause.lemma ?? '').toLowerCase();
  const right = gerundLemma(clause);
  if (wrong && right !== wrong) p.relation = p.relation.split(' ').map(w => (w === wrong ? right : w)).join(' ');
}

/** The observation: a clause is read as is, a noun phrase is the subject of `occur`. */
function observation(a, node, S, ctx, q, wrapper) {
  const clause = VERBAL(node) ? node : kids(node, 'acl', 'acl:relcl').find(VERBAL);
  if (clause && clause !== wrapper) {
    const p = claimOf(a, clause, S, ctx, q, null);
    if (usable(p)) return p;
  }
  const p = shell(wrapper);
  p.relation = 'occur';
  p.roles.push({name: 'subject', value: a.value(node, S, ctx, {skipCase: true}).value, word: node});
  consume(subtree(wrapper).filter(w => w.upos !== 'PUNCT'));
  return p;
}

/** The task a procedure noun names: its `for` gerund or infinitive clause, else its compound word and `for NP`. */
function taskOf(a, noun, S, ctx, q) {
  const clause = kids(noun, 'acl').find(VERBAL);
  if (clause) {
    const p = claimOf(a, clause, S, ctx, q, null);
    if (usable(p)) { fixLemma(p, clause); return p; }
  }
  const compound = kids(noun, 'compound').filter(k => ['NOUN', 'VERB', 'PROPN'].includes(k.upos)).sort((x, y) => x.id - y.id);
  const forNp = kids(noun, 'nmod').find(k => kids(k, 'case').some(c => c.folded === 'for'));
  if (!compound.length && !forNp) return null;
  const p = shell(noun);
  p.relation = compound.length ? compound.map(gerundLemma).join(' ') : 'perform';
  p.roles.push({name: 'object', value: forNp ? a.value(forNp, S, ctx, {skipCase: true}).value : q.variable('x'), ...(forNp ? {word: forNp} : {})});
  consume([...compound, ...(forNp ? subtree(forNp) : [])]);
  return p;
}

const article = noun => (/^[aeiou]/i.test(noun) ? 'an' : 'a');

/**
 * "Which teams have only certified players?": the groups (selected) whose members (the object noun, a relation
 * "be a player of" to the group) all satisfy the participle or adjective (the scope). Returns `{p, mode, group}` or null.
 */
function onlyForm(a, h, S, ctx, q) {
  if (h.lemmaFolded !== 'have' || h.upos !== 'VERB') return null;
  const group = kids(h, 'nsubj')[0];
  const members = kids(h, 'obj')[0];
  if (!group || !members || !isWh(a, group) || members.upos !== 'NOUN') return null;
  const property = kids(members, 'amod').find(k => ['ADJ', 'VERB'].includes(k.upos) && !kids(k, 'nsubj', 'obl', 'obj').length);
  const only = [h, members, property].filter(Boolean).some(w => kids(w, 'advmod').some(x => x.folded === 'only'));
  if (!property || !only || kids(members, 'nmod', 'acl', 'acl:relcl', 'nummod').length) return null;
  const g = q.variable('g'), m = q.variable('m');
  const noun = members.lemmaFolded;
  const p = shell(h);
  p.relation = `be ${article(noun)} ${noun} of`;
  p.roles.push({name: 'subject', value: m}, {name: 'object', value: g});
  p.universalScope = {relation: 'be ' + property.text.toLowerCase(), polarity: 'affirmed', roles: [{name: 'subject', value: m}]};
  p.groupBy = g;
  consume(subtree(h));
  return {p, mode: 'every', group: g};
}

/**
 * Forms recognized before the generic question path, where the claim is a different clause than the root.
 * Returns `{p, mode}` (the claim's proposition and the query mode) or null.
 */
export function reasoningForm(a, h, S, ctx, q) {
  if (S.language === 'ro' || ctx.as !== 'query') return null;
  // the plain `nsubj` (a parse may add an outer one: "what I need to know: can you explain …")
  const subject = kids(h, 'nsubj').find(k => k.deprel === 'nsubj') ?? a.subjectOf(h);
  const whSubject = isWh(a, subject);
  const whObject = kids(h, 'obj').find(k => isWh(a, k));
  const lemma = h.lemmaFolded;
  const noun = kids(h, 'nsubj')[0];
  const copular = kids(h, 'cop').length > 0;

  const only = onlyForm(a, h, S, ctx, q);
  if (only) return only;
  // why_not: "What is stopping X from V-ing?", "What prevents D from finishing?"
  if (BLOCK_VERBS.has(lemma) && whSubject && h.upos === 'VERB') {
    const target = kids(h, 'obj', 'iobj')[0];
    const from = kids(h, 'advcl', 'xcomp').find(k => hasMark(k, 'from') && VERBAL(k));
    if (target && from) {
      const p = claimOf(a, from, S, ctx, q, target);
      if (usable(p)) { consume(subtree(h), subtree(from)); return {p, mode: 'why_not'}; }
    }
  }
  // why_not: "What is missing for X to V?", "What would it take for X to V?"
  if (MISSING_VERBS.has(lemma) && (whSubject || whObject) && h.upos === 'VERB') {
    const claim = kids(h, 'advcl', 'csubj', 'xcomp', 'ccomp').find(k => hasMark(k, 'for') && VERBAL(k) && kids(k, 'nsubj', 'nsubj:pass').length);
    if (claim) {
      const p = claimOf(a, claim, S, ctx, q, null);
      if (usable(p)) { consume(subtree(h), subtree(claim)); return {p, mode: 'why_not'}; }
    }
  }
  // plan: "What are the steps to V X?", "What is the way to V X?"
  if (isWh(a, h) && copular && noun && STEP_NOUNS.has(noun.lemmaFolded)) {
    const goal = kids(noun, 'acl').find(VERBAL);
    if (goal) {
      const p = claimOf(a, goal, S, ctx, q, null);
      if (usable(p)) { consume(subtree(h), subtree(goal)); return {p, mode: 'plan'}; }
    }
  }
  // plan: "What do I need to do to V X?", "What should we do to V X?"
  const doVerb = lemma === 'do' && whObject ? h : kids(h, 'xcomp').find(k => k.lemmaFolded === 'do' && kids(k, 'obj').some(o => isWh(a, o)));
  if (doVerb && (['need', 'do', 'have', 'want'].includes(lemma) || hasModal(h))) {
    const purpose = kids(doVerb, 'advcl', 'xcomp').find(k => hasMark(k, 'to') && VERBAL(k));
    if (purpose && subject && (a.isFirstPerson(subject) || GENERIC_SUBJECTS.has(subject.folded))) {
      const p = claimOf(a, purpose, S, ctx, q, subject);
      if (usable(p)) { consume(subtree(h), subtree(purpose)); return {p, mode: 'plan'}; }
    }
  }
  // abduce, verbal: "What could explain the outage?", "What might have caused the server to crash?"
  // (a modal marks the hypothesis: "What caused the outage?" without one asks a recorded fact and stays a select)
  if (ABDUCE_VERBS.has(lemma) && whSubject && h.upos === 'VERB' && hasModal(h)) {
    const object = lemma === 'account' ? kids(h, 'obl').find(k => kids(k, 'case').some(c => c.folded === 'for')) : kids(h, 'obj', 'iobj').find(k => ['NOUN', 'PROPN', 'PRON'].includes(k.upos) && !isWh(a, k));
    const inner = kids(h, 'xcomp', 'ccomp', 'advcl').find(k => VERBAL(k) && hasMark(k, 'to'));
    if (object && inner) {
      const p = claimOf(a, inner, S, ctx, q, object);
      if (usable(p)) { consume(subtree(h), subtree(inner)); return {p, mode: 'abduce'}; }
    }
    if (object) { const p = observation(a, object, S, ctx, q, h); if (usable(p)) return {p, mode: 'abduce'}; }
    // "What could explain why the grass is wet?": the clause under `why` is the observation
    const why = kids(h, 'obj').find(k => k.folded === 'why');
    const reason = why && kids(why, 'advcl', 'acl', 'ccomp').find(k => VERBAL(k) || kids(k, 'cop').length);
    if (reason) { const p = claimOf(a, reason, S, ctx, q, null); if (usable(p)) { consume(subtree(h), subtree(reason)); return {p, mode: 'abduce'}; } }
  }
  // abduce, nominal: "What could be the cause of the fever?", "What is the cause of the delay?"
  if (copular && isWh(a, noun) && ABDUCE_NOUNS.has(lemma) && h.upos === 'NOUN' && hasModal(h)) {
    const of = kids(h, 'nmod').find(k => kids(k, 'case').some(c => ['of', 'for'].includes(c.folded)));
    if (of) { const p = observation(a, of, S, ctx, q, h); if (usable(p)) return {p, mode: 'abduce'}; }
  }
  // abduce: "What may be behind the failure of the pump?": the noun behind is the observation.
  if (copular && isWh(a, noun) && h.upos === 'NOUN' && hasModal(h) && kids(h, 'case').some(c => c.folded === 'behind')) {
    const p = observation(a, h, S, ctx, q, h);
    if (usable(p)) return {p, mode: 'abduce'};
  }
  // explain: "What is the reason that X doesn't qualify?", "What is the reason why Ana left?": the clause is explained (a negated clause stays negated, the corpus convention).
  if (isWh(a, h) && copular && noun && REASON_NOUNS.has(noun.lemmaFolded)) {
    const clause = kids(noun, 'acl', 'acl:relcl', 'ccomp').find(VERBAL) ?? kids(noun, 'acl', 'acl:relcl', 'ccomp').find(k => kids(k, 'cop', 'nsubj').length);
    if (clause) {
      const p = claimOf(a, clause, S, ctx, q, null);
      if (usable(p)) { consume(subtree(h), subtree(clause)); return {p, mode: 'explain'}; }
    }
  }
  // procedure: "What is the procedure for resetting the router?", "What is the reset procedure?"
  if (isWh(a, h) && copular && noun && PROCEDURE_NOUNS.has(noun.lemmaFolded)) {
    const p = taskOf(a, noun, S, ctx, q);
    if (p) { consume(subtree(h)); return {p, mode: 'procedure'}; }
  }
  // the tree repair may hang the question word under the noun: "What is the onboarding protocol for new hires?"
  if (copular && isWh(a, noun) && PROCEDURE_NOUNS.has(lemma) && h.upos === 'NOUN') {
    const p = taskOf(a, h, S, ctx, q);
    if (p) { consume(subtree(h)); return {p, mode: 'procedure'}; }
  }
  return null;
}

/**
 * Refinements of the generic question path: the proposition is the normal one; only the mode, the modal and the asked
 * variable change. `kind` is the question word class the generic path found (`why`, `how`, null).
 * Returns `{mode, kind}` or null.
 */
export function refineReasoning(a, h, S, ctx, p, q, kind) {
  if (S.language === 'ro' || ctx.as !== 'query') return null;
  const subject = a.subjectOf(h);
  // why_not: a modal negative "why" asks what blocks the affirmed claim ("Why can't I hard-reset the router?").
  if (kind === 'why' && p.polarity === 'negated' && MODAL_PREFIX.test(p.relation)) {
    p.relation = p.relation.replace(MODAL_PREFIX, '');
    p.polarity = 'affirmed';
    return {mode: 'why_not', kind: null};
  }
  // why_not: "Why isn't Ana allowed to approve X?" asks what blocks the permission.
  if (kind === 'why' && p.polarity === 'negated' && /^be (?:allowed|permitted|able|authori[sz]ed|entitled|eligible) to\b/.test(p.relation)) {
    p.polarity = 'affirmed';
    return {mode: 'why_not', kind: null};
  }
  // plan: "How do I V X?", "How can we V X?", "How to V X?": the goal is the asker's own action.
  if (kind === 'how' && h.upos === 'VERB' && !kids(h, 'cop').length && p.whAdverbs[0]) {
    // "How can the robot get to C?": a modal can/could/should with how asks for a way, whoever acts
    const asker = subject ? a.isFirstPerson(subject) || GENERIC_SUBJECTS.has(subject.folded) || kids(h, 'aux').some(x => ['can', 'could', 'should'].includes(x.folded)) : hasMark(h, 'to');
    if (asker) {
      p.relation = p.relation.replace(MODAL_PREFIX, '');
      return {mode: 'plan', kind: null};
    }
  }
  // "What would happen if P?": the open consequence keeps the plain verb ("happen"); the modal belongs to the question.
  if (!kind && h.lemmaFolded === 'happen' && isWh(a, subject) && MODAL_PREFIX.test(p.relation)) { p.relation = p.relation.replace(MODAL_PREFIX, ''); return {mode: null, kind}; }
  // conform: following, observing or violating a procedure; being compliant.
  if (!kind) {
    const mentions = kids(h, 'obj', 'obl', 'nsubj:pass', 'nsubj').some(o => PROCEDURE_NOUNS.has(o.lemmaFolded));
    if ((COMPLY_VERBS.has(h.lemmaFolded) && h.upos === 'VERB' && mentions) || (COMPLY_ADJECTIVES.has(h.lemmaFolded) && kids(h, 'cop').length)) return {mode: 'conform', kind: null};
  }
  return null;
}

export const REASONING_MODES = Object.freeze(['why_not', 'plan', 'abduce', 'conform', 'procedure']);
