/**
 * v1.4 tree repairs of the UD → SOP converter (proposals.md "Tree repairs"): deterministic re-attachments of a
 * Stanza sentence before conversion, for parse-error families the rules would otherwise misread. Each repair uses
 * only function words, POS shapes and named-entity spans; none consults content vocabulary, so the model boundary
 * (no lexicon, no context) is untouched. Input and output are worker sentences `{words: [{id, head, deprel, …}]}`;
 * the input is never mutated.
 *
 *   TR-NAME   one named entity (a B-…E- span) or one capitalized title run with an inner of/from/to that the parser
 *             split over several dependents is re-attached under one head ("CS Alexandria", "Letters to a Young
 *             Engineer", "Notes from the Night Train").
 *   TR-WH     a fronted question phrase with a stranded, dependent-less preposition: the preposition becomes the
 *             phrase's case marker and the phrase an oblique or nominal modifier of the predicate ("How many choirs
 *             is Mirela a member of?", "find out who Petru is a child of", "which platform does X leave from").
 *   TR-CONJ   "Do you know if P and Q?": a clausal conjunct with its own subject attached to the wrapper verb moves
 *             under the embedded question.
 */
const fold = text => String(text ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const WH = new Set(['who', 'whom', 'what', 'which', 'where', 'how']);
const JOINERS = new Set(['of', 'from', 'to', 'for', 'and', '&', 'the', 'a', 'an', 'on', 'in', 'at']);
const STRANDABLE = new Set(['of', 'by', 'to', 'from', 'for', 'with', 'about', 'at', 'on', 'in', 'after', 'into']);
const EMBED = new Set(['know', 'check', 'verify', 'confirm', 'tell', 'wonder', 'see', 'find', 'ask', 'sti', 'verifica', 'afla', 'confirma']);

const clone = sentence => ({...sentence, words: sentence.words.map(w => ({...w}))});
const byIdOf = words => new Map(words.map(w => [w.id, w]));
const children = (words, id) => words.filter(w => w.head === id);
function inSubtree(words, id, root) {
  const byId = byIdOf(words);
  for (let w = byId.get(id), guard = 0; w && guard < 100; w = byId.get(w.head), guard++) if (w.id === root) return true;
  return false;
}

/** Named-entity spans of a sentence: arrays of consecutive words tagged B-X … E-X (or S-X). */
function entitySpans(words) {
  const spans = [];
  let current = null;
  for (const w of words) {
    const tag = w.ner ?? 'O';
    if (/^B-/.test(tag)) { current = [w]; continue; }
    if (current && /^[IE]-/.test(tag) && tag.slice(2) === current[0].ner.slice(2)) { current.push(w); if (/^E-/.test(tag)) { spans.push(current); current = null; } continue; }
    current = null;
  }
  return spans;
}

/** Capitalized title runs: a capitalized non-initial word, then joiners and capitalized words, ending capitalized. */
function titleRuns(words) {
  const runs = [];
  const content = words.filter(w => w.upos !== 'PUNCT');
  for (let i = 1; i < content.length; i++) {
    if (!/^\p{Lu}/u.test(content[i].text) || /^\p{Lu}/u.test(content[i - 1].text)) continue;
    let j = i + 1, last = i;
    while (j < content.length && (JOINERS.has(fold(content[j].text)) || /^\p{Lu}/u.test(content[j].text))) { if (/^\p{Lu}/u.test(content[j].text)) last = j; j++; }
    const run = content.slice(i, last + 1);
    // Only a run that opens as an object or subject (a title), never one that opens after a preposition ("from Cluj to Iași").
    if (run.length >= 3 && run.slice(1, -1).some(w => ['of', 'from', 'to'].includes(fold(w.text))) && /^(obj|nsubj|appos|root)/.test(run[0].deprel)) runs.push(run);
    i = last;
  }
  return runs;
}

/** TR-NAME: one head per entity span or title run; returns the number of re-attachments. */
function repairNames(words) {
  let changed = 0;
  for (const span of [...entitySpans(words), ...titleRuns(words)]) {
    const ids = new Set(span.map(w => w.id));
    const outside = span.filter(w => !ids.has(w.head));
    if (outside.length < 2) continue;
    // The span head is the outside-attached word with an argument relation; the first one wins.
    const head = outside.find(w => /^(obj|obl|nsubj|nmod|iobj|root|conj|appos)/.test(w.deprel)) ?? outside[0];
    for (const w of outside) {
      if (w === head) continue;
      const ownCase = children(words, w.id).some(c => c.deprel === 'case' && ids.has(c.id) && c.id > head.id);
      w.head = head.id;
      w.deprel = ownCase || w.id > head.id + 1 && span.some(x => x.id < w.id && x.id > head.id && ['ADP'].includes(x.upos)) ? 'nmod' : (w.id < head.id ? 'compound' : 'flat');
      changed++;
    }
    // A case word of the span that precedes the head but belongs to a later word stays with that word.
  }
  return changed;
}

/** TR-WH: a fronted question phrase and a stranded preposition. */
function repairStranded(words) {
  let changed = 0;
  const byId = byIdOf(words);
  const lastContent = [...words].reverse().find(w => w.upos !== 'PUNCT');
  // (b) "find out who Petru is a child of": obj(V, wh) + acl:relcl(wh, P) + case(wh, prep) with the preposition last.
  for (const wh of words.filter(w => WH.has(fold(w.text)) && ['obj', 'obl', 'nsubj'].includes(w.deprel))) {
    const rel = children(words, wh.id).find(c => c.deprel === 'acl:relcl');
    const prep = children(words, wh.id).find(c => c.deprel === 'case' && c.id > (rel?.id ?? Infinity));
    if (!rel || !prep) continue;
    const isNominal = ['NOUN', 'PROPN', 'ADJ'].includes(rel.upos) && children(words, rel.id).some(c => c.deprel === 'cop');
    Object.assign(rel, {head: wh.head, deprel: 'ccomp'});
    Object.assign(wh, {head: rel.id, deprel: isNominal ? 'nmod' : 'obl'});
    changed++;
  }
  // (d) "Who is the fire engine repaired by?": a fronted wh subject with its own trailing case word and a second subject.
  for (const wh of words.filter(w => WH.has(fold(w.text)) && /^nsubj/.test(w.deprel))) {
    const prep = children(words, wh.id).find(c => c.deprel === 'case' && c.id > wh.head);
    const other = children(words, wh.head).find(c => /^nsubj/.test(c.deprel) && c !== wh);
    if (!prep || !other) continue;
    Object.assign(wh, {deprel: 'obl'});
    changed++;
  }
  // (c) "which platform does X leave from at Y": a fronted which/what-N object and a second case word on an oblique.
  const fronted = words.find(w => w.deprel === 'obj' && children(words, w.id).some(d => ['which', 'what'].includes(fold(d.text)) && d.deprel === 'det') && byId.get(w.head)?.upos === 'VERB' && w.id < w.head);
  if (fronted) {
    const verb = byId.get(fronted.head);
    for (const o of children(words, verb.id).filter(c => /^obl/.test(c.deprel) && c.id > verb.id)) {
      const cases = children(words, o.id).filter(c => c.deprel === 'case').sort((a, b) => a.id - b.id);
      if (cases.length === 2 && STRANDABLE.has(fold(cases[0].text)) && cases[1].id === cases[0].id + 1) {
        Object.assign(cases[0], {head: fronted.id});
        Object.assign(fronted, {deprel: 'obl'});
        changed++;
        break;
      }
    }
    // A clause-final stranded preposition attached to the verb.
    if (lastContent && lastContent.upos === 'ADP' && lastContent.head === verb.id && STRANDABLE.has(fold(lastContent.text)) && fronted.deprel === 'obj') {
      Object.assign(lastContent, {head: fronted.id, deprel: 'case'});
      Object.assign(fronted, {deprel: 'obl'});
      changed++;
    }
  }
  return changed;
}

/** TR-RO-WH: Romanian "cine/ce întreține X?" parsed with the question word as a second object: it is the subject. */
function repairRomanianWhObject(words) {
  let changed = 0;
  for (const wh of words.filter(w => ['cine', 'ce'].includes(fold(w.text)) && w.deprel === 'obj')) {
    const other = children(words, wh.head).find(c => c !== wh && ['obj', 'nsubj'].includes(c.deprel) && ['NOUN', 'PROPN'].includes(c.upos) && c.id > wh.head);
    if (!other || children(words, wh.head).some(c => c.deprel === 'nsubj' && c !== other)) continue;
    Object.assign(wh, {deprel: 'nsubj'});
    Object.assign(other, {deprel: 'obj'});
    changed++;
  }
  return changed;
}

/** TR-CONJ: "Do you know if P and Q?" with Q attached to the wrapper verb. */
function repairEmbeddedConjunct(words) {
  let changed = 0;
  const root = words.find(w => w.head === 0);
  if (!root || !EMBED.has(fold(root.lemma ?? root.text))) return 0;
  const complement = children(words, root.id).find(c => ['ccomp', 'advcl'].includes(c.deprel) && children(words, c.id).some(m => m.deprel === 'mark' && ['if', 'whether', 'daca', 'dacă'].includes(fold(m.text))));
  if (!complement) return 0;
  const between = (a, b) => words.filter(w => w.id > a && w.id < b);
  for (const k of children(words, root.id).filter(c => c.deprel === 'conj' && c.id > complement.id)) {
    const subject = children(words, k.id).find(c => /^nsubj/.test(c.deprel));
    const inverted = children(words, k.id).some(c => c.upos === 'AUX' && subject && c.id < subject.id);
    if (!subject || inverted || between(complement.id, k.id).some(w => /[?.!]/.test(w.text))) continue;
    Object.assign(k, {head: complement.id});
    changed++;
  }
  return changed;
}


// ---------------------------------------------------------------------------------------------------------------
// v2.0 repairs for the Stanza `accurate` package (electra-large parser): tree shapes it produces where the rules of
// v1.x expected another one. Each repair uses function words, POS and morphology only.
// ---------------------------------------------------------------------------------------------------------------
const WRAPPER_VERBS = new Set(['know', 'check', 'tell', 'explain', 'wonder', 'say', 'ask', 'see', 'find', 'confirm', 'verify', 'count', 'remember', 'remind', 'understand', 'learn', 'show', 'clarify', 'figure', 'determine', 'sti', 'verifica', 'spune', 'explica', 'afla']);
const WH_WORDS = new Set(['why', 'when', 'where', 'how', 'who', 'whom', 'what', 'which', 'whether', 'if']);

/** Words of the subtree of `id` (including it). */
const subtreeOf = (words, id) => words.filter(w => inSubtree(words, w.id, id));

/**
 * AR-NAMES: two adjacent proper nouns with the same head and relation ("Ms Reddy" as two subjects, "Mr Mocanu" as two
 * conjuncts) are one name: the second is a `flat` of the first.
 */
function repairAdjacentNames(words) {
  let changed = 0;
  for (const b of words) {
    const a = words.find(w => w.id === b.id - 1);
    if (!a || a.upos !== 'PROPN' || b.upos !== 'PROPN' || a.head !== b.head || a.deprel !== b.deprel || ['flat', 'compound', 'punct', 'appos'].includes(b.deprel)) continue;
    b.head = a.id; b.deprel = 'flat'; changed++;
  }
  return changed;
}

/**
 * AR-WH-HIGH: a question phrase ("why", "where", "since when", "how many times", "how long") that follows a wrapper verb
 * ("do you know", "tell me", "could you check", "count") but was attached to it belongs to the embedded clause.
 */
function repairWhHigh(words) {
  let changed = 0;
  const byId = byIdOf(words);
  for (const x of words) {
    const v = byId.get(x.head);
    if (!v || x.id < v.id || !WRAPPER_VERBS.has(fold(v.lemma ?? v.text)) || !/^(obj|obl|advmod|xcomp|nmod)/.test(x.deprel)) continue;
    const sub = subtreeOf(words, x.id);
    const wh = sub.find(w => ['why', 'when', 'where', 'how'].includes(fold(w.text)) && (w === x || w.deprel === 'advmod'));
    if (!wh || (x !== wh && !['long', 'often', 'many', 'much', 'times'].includes(fold(x.text)) && !children(words, x.id).some(c => c === wh))) continue;
    const clause = children(words, v.id).filter(c => ['ccomp', 'advcl', 'csubj', 'xcomp'].includes(c.deprel) && c.id > x.id && !sub.includes(c)).sort((a, b) => a.id - b.id)[0];
    if (!clause || children(words, clause.id).some(c => WH_WORDS.has(fold(c.text)) && c.id < clause.id && ['advmod', 'obj', 'obl', 'nsubj'].includes(c.deprel))) continue;
    x.head = clause.id;
    x.deprel = x === wh ? 'advmod' : (x.deprel === 'obj' ? 'obl' : x.deprel);
    changed++;
  }
  return changed;
}

/**
 * AR-PASSIVE: a participle after "be" is passive, not a predicate of "be": (a) "Are at least 3 players … certified?"
 * (`cop` on a verb) and (b) "Is every employee … certified?" (`be` as root with the participle as `xcomp`).
 */
function repairPassiveBe(words) {
  let changed = 0;
  for (const c of words.filter(w => w.deprel === 'cop')) {
    const h = words.find(w => w.id === c.head);
    if (!h || h.upos !== 'VERB' || !/^(VBN|VBG)$/.test(h.xpos ?? '')) continue;
    const passive = h.xpos === 'VBN';
    c.deprel = passive ? 'aux:pass' : 'aux';
    if (passive) for (const s of children(words, h.id).filter(k => k.deprel === 'nsubj')) s.deprel = 'nsubj:pass';
    changed++;
  }
  for (const a of words.filter(w => w.deprel === 'aux' && fold(w.lemma ?? w.text) === 'be')) {
    const h = words.find(w => w.id === a.head);
    if (!h || h.upos !== 'VERB' || h.xpos !== 'VBN') continue;
    a.deprel = 'aux:pass';
    for (const s of children(words, h.id).filter(k => k.deprel === 'nsubj')) s.deprel = 'nsubj:pass';
    changed++;
  }
  for (const v of words.filter(w => fold(w.lemma ?? w.text) === 'be' && ['VERB', 'AUX'].includes(w.upos))) {
    const x = children(words, v.id).find(c => ['xcomp', 'advcl'].includes(c.deprel) && c.id > v.id && c.upos === 'VERB' && /^(VBN|VBG)$/.test(c.xpos ?? '') && !children(words, c.id).some(k => k.deprel === 'mark'));
    const subject = x && [...children(words, v.id), ...children(words, x.id)].find(c => /^nsubj/.test(c.deprel) && c.id > v.id);
    if (!x || !subject) continue;
    const passive = x.xpos === 'VBN';
    x.head = v.head; x.deprel = v.deprel;
    for (const k of children(words, v.id)) if (k !== x) { k.head = x.id; }
    if (passive) subject.deprel = 'nsubj:pass';
    v.head = x.id; v.deprel = passive ? 'aux:pass' : 'aux';
    changed++;
  }
  return changed;
}

/**
 * AR-WH-RELCL: "Tell me which book Vertex Analytics publishes" (a which/what noun with the embedded clause as its
 * relative clause) and "do you know who is the spouse of X" (the wh pronoun as the object with the predicate noun as its
 * subject) are embedded questions: the clause is a `ccomp` of the wrapper verb.
 */
function repairEmbeddedWh(words) {
  let changed = 0;
  const byId = byIdOf(words);
  for (const n of words) {
    const v = byId.get(n.head);
    if (!v || n.id < v.id || !WRAPPER_VERBS.has(fold(v.lemma ?? v.text))) continue;
    const rel = children(words, n.id).find(c => c.deprel === 'acl:relcl' && c.id > n.id && children(words, c.id).some(k => /^nsubj/.test(k.deprel)));
    if (rel && n.deprel === 'obj' && children(words, n.id).some(d => d.deprel === 'det' && ['which', 'what'].includes(fold(d.text)))) {
      Object.assign(rel, {head: v.id, deprel: 'ccomp'});
      Object.assign(n, {head: rel.id, deprel: 'obj'});
      changed++;
      continue;
    }
    if (n.upos === 'PRON' && WH_WORDS.has(fold(n.text)) && n.deprel === 'ccomp' && !children(words, n.id).length) {
      const noun = children(words, v.id).find(c => c !== n && c.deprel === 'ccomp' && c.id > n.id && children(words, c.id).some(k => k.deprel === 'cop' && k.id === n.id + 1) && !children(words, c.id).some(k => /^nsubj/.test(k.deprel)));
      if (noun) { Object.assign(n, {head: noun.id, deprel: 'nsubj'}); changed++; continue; }
    }
    if (n.upos === 'PRON' && WH_WORDS.has(fold(n.text)) && ['obj', 'ccomp'].includes(n.deprel)) {
      const noun = children(words, n.id).find(c => c.deprel === 'nsubj' && c.id > n.id && children(words, c.id).some(k => k.deprel === 'cop'));
      if (noun) { Object.assign(noun, {head: v.id, deprel: 'ccomp'}); Object.assign(n, {head: noun.id, deprel: 'nsubj'}); changed++; }
    }
  }
  return changed;
}

/** AR-APPOS: a clause (own subject or copula) attached as `appos` to a label noun ("Quick question: is he …?") is a `parataxis`. */
function repairClausalAppos(words) {
  let changed = 0;
  for (const a of words.filter(w => w.deprel === 'appos')) {
    if (!children(words, a.id).some(k => /^(nsubj|cop|aux)/.test(k.deprel))) continue;
    a.deprel = 'parataxis'; changed++;
  }
  return changed;
}

/** AR-DISCOURSE: a sentence-initial "So", "Well", "Now" attached as an adverb of the predicate is a `discourse` marker. */
function repairDiscourse(words) {
  let changed = 0;
  const first = words.find(w => w.upos !== 'PUNCT');
  if (first && first.deprel === 'advmod' && ['so', 'well', 'now', 'anyway', 'then', 'okay', 'ok'].includes(fold(first.text))) { first.deprel = 'discourse'; changed++; }
  return changed;
}


/**
 * AR-WH-ROOT: "Why is the payments gateway out of service?": a question adverb parsed as the root with the copula and
 * the subject, and the predicate as its oblique. The predicate is the root; the adverb modifies it.
 */
function repairWhAdverbRoot(words) {
  let changed = 0;
  const root = words.find(w => w.head === 0);
  if (!root || root.upos !== 'ADV' || !['why', 'where', 'when', 'how'].includes(fold(root.text))) return 0;
  const kids = children(words, root.id);
  const predicate = kids.find(c => c.deprel === 'obl' && ['NOUN', 'ADJ', 'PROPN'].includes(c.upos) && children(words, c.id).some(k => /^nsubj/.test(k.deprel)));
  if (!predicate || !(kids.some(c => c.deprel === 'cop') || children(words, predicate.id).some(c => c.deprel === 'cop'))) return 0;
  for (const c of kids) if (c !== predicate) { c.head = predicate.id; }
  predicate.head = 0; predicate.deprel = 'root';
  root.head = predicate.id; root.deprel = 'advmod';
  return changed + 1;
}

/**
 * AR-DATE: a date or year introduced by on/in/at/since/until that hangs on a noun ("the spouse of Julien in 2021", "the
 * search index on March 2, 2023") is the time of the clause: an oblique of the nearest predicate.
 */
function repairDateAttachment(words) {
  let changed = 0;
  const byId = byIdOf(words);
  for (const d of words.filter(w => w.deprel === 'nmod' && (w.upos === 'NUM' || /DATE/.test(w.ner ?? '') || (w.upos === 'PROPN' && children(words, w.id).some(c => c.upos === 'NUM'))))) {
    const cases = children(words, d.id).filter(c => c.deprel === 'case');
    const isYear = /^(1[89]|20)\d\d$/.test(d.text) || /DATE/.test(d.ner ?? '') || children(words, d.id).some(c => /^(1[89]|20)\d\d$/.test(c.text));
    if (!isYear || !cases.some(c => ['on', 'in', 'at', 'since', 'until', 'during', 'as'].includes(fold(c.text)))) continue;
    let h = byId.get(d.head);
    for (let guard = 0; h && guard < 10 && !(h.head === 0 || children(words, h.id).some(c => ['cop', 'nsubj', 'nsubj:pass', 'aux', 'aux:pass'].includes(c.deprel)) || ['VERB'].includes(h.upos)); guard++) h = byId.get(h.head);
    if (!h) continue;
    d.head = h.id; d.deprel = 'obl'; changed++;
  }
  return changed;
}

/**
 * AR-IDIOM-PP: a bare plural noun object with a prepositional nmod ("give classes in biology", "teach lessons in math")
 * keeps the phrase on the verb, where the rules read verb + noun + preposition as one relation.
 */
function repairBareObjectPP(words) {
  let changed = 0;
  const byId = byIdOf(words);
  for (const n of words.filter(w => w.deprel === 'obj' && w.upos === 'NOUN' && w.xpos === 'NNS')) {
    const v = byId.get(n.head);
    if (!v || v.upos !== 'VERB' || children(words, n.id).some(c => ['det', 'amod', 'nummod', 'nmod:poss', 'compound'].includes(c.deprel))) continue;
    const pp = children(words, n.id).find(c => c.deprel === 'nmod' && c.id > n.id && children(words, c.id).some(k => k.deprel === 'case' && ['in', 'at', 'for', 'on'].includes(fold(k.text))));
    if (!pp) continue;
    pp.head = v.id; pp.deprel = 'obl'; changed++;
  }
  return changed;
}


/** AR-FRAGMENT: a sentence cut after "Did Linh" (a name before its surname) keeps the name as a vocative of the auxiliary. */
function repairAuxFragment(words) {
  const root = words.find(w => w.head === 0);
  const content = words.filter(w => w.upos !== 'PUNCT');
  if (!root || root.upos !== 'AUX' || content.length > 3) return 0;
  let changed = 0;
  for (const c of children(words, root.id)) if (c.deprel === 'obj' && c.upos === 'PROPN') { c.deprel = 'vocative'; changed++; }
  return changed;
}


/**
 * AR-NOUN-ROOT: "Orion Robotics supplies Tisa Textiles, correct?": a plural-noun root between a proper-name subject and a
 * proper-name object is the verb.
 */
function repairVerbAsNoun(words) {
  const root = words.find(w => w.head === 0);
  if (!root || root.upos !== 'NOUN' || !/^(NNS|NN)$/.test(root.xpos ?? '') || !/s$/i.test(root.text)) return 0;
  const kids = children(words, root.id);
  const before = kids.filter(c => c.deprel === 'compound' && c.upos === 'PROPN' && c.id < root.id);
  const after = kids.find(c => ['vocative', 'obj', 'nmod', 'appos'].includes(c.deprel) && c.upos === 'PROPN' && c.id > root.id);
  if (!before.length || !after || kids.some(c => ['det', 'cop', 'amod', 'nummod'].includes(c.deprel))) return 0;
  const head = before.at(-1);
  for (const b of before) if (b !== head) { b.head = head.id; b.deprel = 'compound'; }
  head.deprel = 'nsubj'; head.head = root.id;
  after.deprel = 'obj';
  root.upos = 'VERB'; root.xpos = 'VBZ';
  return 1;
}


/** AR-STRANDED-CASE: "Where did Julien move from?": a stranded preposition attached as `case` of the question adverb belongs to the verb. */
function repairStrandedCase(words) {
  let changed = 0;
  const byId = byIdOf(words);
  for (const c of words.filter(w => w.deprel === 'case' && w.upos === 'ADP' && STRANDABLE.has(fold(w.text)))) {
    const wh = byId.get(c.head);
    if (!wh || wh.upos !== 'ADV' || !['where', 'how'].includes(fold(wh.text)) || c.id < wh.id || children(words, c.id).length) continue;
    const verb = byId.get(wh.head);
    if (!verb || !['VERB', 'AUX'].includes(verb.upos)) continue;
    c.head = verb.id; c.deprel = 'obl'; changed++;
  }
  return changed;
}

/**
 * AR-DUMMY-SUBJECT: "Is that because she is ill?" (two subjects, the first a demonstrative under "because") and
 * "Could it be that the kebab made X sick?" (`it` as outer subject with `be`): the dummy words are expletives.
 */
function repairDummyWrapper(words) {
  let changed = 0;
  for (const head of words.filter(w => children(words, w.id).some(c => c.deprel === 'mark' && ['because', 'that'].includes(fold(c.text))))) {
    const kids = children(words, head.id);
    const subjects = kids.filter(c => /^nsubj/.test(c.deprel));
    const dummy = subjects.find(c => ['that', 'this', 'it'].includes(fold(c.text)) && c.id < (kids.find(k => k.deprel === 'mark')?.id ?? 0) + 0.5);
    if (dummy && subjects.length > 1 && dummy.upos === 'PRON') { dummy.deprel = 'expl'; changed++; }
    const outer = kids.find(c => c.deprel === 'nsubj:outer' && fold(c.text) === 'it');
    if (outer) {
      outer.deprel = 'expl';
      for (const c of kids.filter(k => (k.deprel === 'cop' && fold(k.text) === 'be') || (k.deprel === 'aux' && ['could', 'would', 'might', 'may', 'can'].includes(fold(k.text)) && k.id < outer.id))) c.deprel = 'discourse';
      changed++;
    }
  }
  return changed;
}


/**
 * AR-STRANDED-COPULA: "which team Aditya is on", "the team that Ananya is on", "which town X is in": the parser makes the
 * stranded preposition the predicate (`cop` + `nsubj` on an ADP). The copula heads the clause instead, the wh noun (or
 * relative pronoun) is its oblique and the preposition its case marker.
 */
function repairStrandedCopula(words) {
  let changed = 0;
  const byId = byIdOf(words);
  for (const p of words.filter(w => w.upos === 'ADP' && children(words, w.id).some(c => c.deprel === 'cop') && children(words, w.id).some(c => /^nsubj/.test(c.deprel)))) {
    const kids = children(words, p.id);
    const cop = kids.find(c => c.deprel === 'cop');
    const isWhNoun = n => n && (['who', 'whom', 'which', 'what', 'that'].includes(fold(n.text)) || children(words, n.id).some(d => d.deprel === 'det' && ['which', 'what'].includes(fold(d.text))));
    let noun = kids.find(c => ['obj', 'obl'].includes(c.deprel) && c.id < p.id && isWhNoun(c));
    let ownHead = null;
    if (!noun) {
      const head = byId.get(p.head);
      if (head && ['acl:relcl', 'ccomp', 'acl'].includes(p.deprel) && children(words, head.id).some(d => d.deprel === 'det' && ['which', 'what'].includes(fold(d.text)))) { noun = head; ownHead = head; }
    }
    if (!noun || cop.id > p.id) continue;
    const outerHead = ownHead ? byId.get(ownHead.head)?.id ?? 0 : p.head;
    const outerRel = ownHead ? (ownHead.deprel === 'obj' || ownHead.deprel === 'nsubj' ? 'ccomp' : ownHead.deprel) : p.deprel;
    cop.head = outerHead; cop.deprel = outerRel; cop.upos = 'VERB'; cop.lemma = 'be';
    for (const k of kids) if (k !== cop && k !== noun) { k.head = cop.id; }
    if (ownHead) { for (const k of children(words, ownHead.id)) if (k === p) continue; noun.head = cop.id; noun.deprel = 'obl'; }
    else { noun.head = cop.id; noun.deprel = 'obl'; }
    p.head = noun.id; p.deprel = 'case';
    changed++;
  }
  return changed;
}


/**
 * AR-VAGUE: "at some point in 2020", "on their own": phrases that state nothing checkable are discourse; a date they carry
 * moves to the predicate.
 */
function repairVaguePhrases(words) {
  let changed = 0;
  const byId = byIdOf(words);
  const drop = (w) => { for (const k of subtreeOf(words, w.id)) if (!words.some(o => o !== k && o.head === k.id && o.deprel === 'nmod' && /^(1[89]|20)\d\d$/.test(o.text))) k.deprel = 'discourse'; };
  for (const w of words.filter(x => ['obl', 'advmod'].includes(x.deprel))) {
    const kids = children(words, w.id);
    const some = fold(w.text) === 'point' && kids.some(c => c.deprel === 'det' && fold(c.text) === 'some') && kids.some(c => c.deprel === 'case' && fold(c.text) === 'at');
    const own = fold(w.text) === 'own' && kids.some(c => c.deprel === 'case' && fold(c.text) === 'on') && kids.some(c => c.deprel === 'nmod:poss');
    if (!some && !own) continue;
    for (const d of kids.filter(c => c.deprel === 'nmod' && /^(1[89]|20)\d\d$/.test(c.text))) { d.head = w.head; d.deprel = 'obl'; }
    for (const k of [w, ...kids.filter(c => c.deprel !== 'obl')]) k.deprel = 'discourse';
    changed++;
  }
  return changed;
}


/** AR-OTHER-THAN: "Other than X, …" (like "apart from X"): "other than" is the fixed case marker of X. */
function repairOtherThan(words) {
  let changed = 0;
  for (const other of words.filter(w => fold(w.text) === 'other' && ['ADJ', 'ADV'].includes(w.upos) && w.deprel === 'advmod')) {
    const x = children(words, other.id).find(c => c.deprel === 'obl' && children(words, c.id).some(k => k.deprel === 'case' && fold(k.text) === 'than'));
    if (!x) continue;
    const than = children(words, x.id).find(k => k.deprel === 'case' && fold(k.text) === 'than');
    x.head = other.head; x.deprel = 'obl';
    other.head = x.id; other.deprel = 'case';
    than.head = other.id; than.deprel = 'fixed';
    changed++;
  }
  return changed;
}


/**
 * AR-WH-OBL: "Tell me since when X works", "Do you know until when X was on Y": the accurate parser makes the question
 * word an `obl` of the embedded verb with "since"/"until" as its case marker. The rules read the shape of the default
 * parser: the question word is an `advmod` and "since"/"until" a `mark` of the embedded verb.
 */
function repairWhObl(words) {
  let changed = 0;
  for (const x of words.filter(w => ['when', 'where', 'why', 'how'].includes(fold(w.text)) && w.upos === 'ADV' && w.deprel === 'obl')) {
    const verb = words.find(w => w.id === x.head);
    if (!verb || !['VERB', 'AUX', 'ADJ', 'NOUN'].includes(verb.upos)) continue;
    x.deprel = 'advmod';
    for (const c of children(words, x.id).filter(k => k.deprel === 'case' && ['since', 'until', 'till', 'from'].includes(fold(k.text)))) { c.head = verb.id; c.deprel = 'mark'; }
    changed++;
  }
  return changed;
}

/** AR-MONTH: "on December 1, 2020" with the month attached to the predicate and the day as a separate oblique: the month is a compound of the day. */
function repairMonthDay(words) {
  let changed = 0;
  const MONTHS = new Set(['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']);
  for (const m of words.filter(w => MONTHS.has(fold(w.text)) && w.upos === 'PROPN' && ['nmod', 'obl', 'obj', 'advmod', 'dep', 'appos'].includes(w.deprel))) {
    const day = words.find(w => w.id === m.id + 1 && w.upos === 'NUM' && /^\d{1,2}(st|nd|rd|th)?$/.test(w.text));
    if (!day || m.head === day.id || inSubtree(words, day.id, m.id)) continue;
    m.head = day.id; m.deprel = 'compound'; changed++;
  }
  return changed;
}


/**
 * AR-WH-NOUN: "Do you know the date since when X works?", "Tell me the year when X started": a wrapper noun ("the date",
 * "the year") whose relative clause carries the question word. The noun is discourse; the clause is the embedded question.
 */
function repairWhNounWrapper(words) {
  let changed = 0;
  const NOUNS = new Set(['date', 'time', 'year', 'day', 'moment', 'period', 'month', 'reason', 'place']);
  const byId = byIdOf(words);
  for (const n of words.filter(w => w.upos === 'NOUN' && NOUNS.has(fold(w.lemma ?? w.text)) && w.deprel === 'obj')) {
    const v = byId.get(n.head);
    if (!v || n.id < v.id || !WRAPPER_VERBS.has(fold(v.lemma ?? v.text))) continue;
    const rel = children(words, n.id).find(c => ['acl', 'acl:relcl'].includes(c.deprel) && c.id > n.id && ['VERB', 'AUX'].includes(c.upos) && children(words, c.id).some(k => ['advmod', 'obl'].includes(k.deprel) && ['when', 'where', 'why', 'how'].includes(fold(k.text))));
    if (!rel) continue;
    for (const k of children(words, n.id).filter(c => c.deprel === 'det')) k.deprel = 'discourse';
    for (const x of children(words, rel.id).filter(k => ['when', 'where', 'why', 'how'].includes(fold(k.text)) && ['advmod', 'obl'].includes(k.deprel))) {
      x.deprel = 'advmod';
      for (const c of children(words, x.id).filter(k => k.deprel === 'case' && ['since', 'until', 'till', 'from'].includes(fold(k.text)))) { c.head = rel.id; c.deprel = 'mark'; }
    }
    rel.head = v.id; rel.deprel = 'ccomp';
    n.deprel = 'discourse';
    changed++;
  }
  return changed;
}

/** All v1.4 tree repairs of one worker sentence; returns a repaired copy (`repairs` counts the changes). */
export function repairSentence(sentence) {
  const out = clone(sentence);
  const monthDay = repairMonthDay(out.words); // first: a month attached away from its day would be re-attached wrongly by TR-NAME
  const repairs = {monthDay, name: repairNames(out.words), wh: repairStranded(out.words), conj: repairEmbeddedConjunct(out.words), roWh: sentence.language === 'ro' ? repairRomanianWhObject(out.words) : 0};
  if (sentence.language !== 'ro') Object.assign(repairs, {names2: repairAdjacentNames(out.words), whNoun: repairWhNounWrapper(out.words), whHigh: repairWhHigh(out.words), passive: repairPassiveBe(out.words), embeddedWh: repairEmbeddedWh(out.words), appos: repairClausalAppos(out.words), discourse: repairDiscourse(out.words), whRoot: repairWhAdverbRoot(out.words), date: repairDateAttachment(out.words), idiomPP: repairBareObjectPP(out.words), fragment: repairAuxFragment(out.words), nounRoot: repairVerbAsNoun(out.words), strandedCase: repairStrandedCase(out.words), dummy: repairDummyWrapper(out.words), strandedCopula: repairStrandedCopula(out.words), vague: repairVaguePhrases(out.words), otherThan: repairOtherThan(out.words), whObl: repairWhObl(out.words)});
  return {...out, repairs};
}
