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
  // (a) "How many choirs is Mirela a member of?": a copular noun predicate with two nsubj, the first a wh phrase.
  for (const p of words.filter(w => ['NOUN', 'PROPN'].includes(w.upos) && children(words, w.id).some(c => c.deprel === 'cop'))) {
    const subjects = children(words, p.id).filter(c => c.deprel === 'nsubj').sort((a, b) => a.id - b.id);
    const prep = children(words, p.id).find(c => c.upos === 'ADP' && STRANDABLE.has(fold(c.text)) && c.id > p.id && !children(words, c.id).length);
    if (subjects.length !== 2 || !prep) continue;
    const phrase = [subjects[0], ...words.filter(w => inSubtree(words, w.id, subjects[0].id))];
    if (!phrase.some(w => WH.has(fold(w.text)))) continue;
    Object.assign(subjects[0], {deprel: 'nmod'});
    Object.assign(prep, {head: subjects[0].id, deprel: 'case'});
    changed++;
  }
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

/** All v1.4 tree repairs of one worker sentence; returns a repaired copy (`repairs` counts the changes). */
export function repairSentence(sentence) {
  const out = clone(sentence);
  const repairs = {name: repairNames(out.words), wh: repairStranded(out.words), conj: repairEmbeddedConjunct(out.words), roWh: sentence.language === 'ro' ? repairRomanianWhObject(out.words) : 0};
  return {...out, repairs};
}
