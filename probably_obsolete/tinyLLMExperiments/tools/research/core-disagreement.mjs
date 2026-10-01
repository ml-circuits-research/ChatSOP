/** Core-arc agreement of a Stanza sentence and a spaCy parse of the same text (research only: the spaCy second parser was removed from
 * SymbolicLM on 2026-10-01, hygiene H19; the `parsers_disagree` check of two Stanza models replaced it). */
/** Offsets are relative to `offset`. Returns null when they agree, else a short description of the first differences. */
export function coreDisagreement(sentence, spacyTokens, offset = 0) {
  const classOfStanza = w => (w.head === 0 ? 'root' : /^nsubj/.test(w.deprel) ? 'subj' : w.deprel === 'obj' ? 'obj' : w.deprel === 'iobj' ? 'iobj' : (w.deprel === 'advmod' && /^(not|n't|never)$/i.test(w.text)) ? 'neg' : null);
  const classOfSpacy = t => (t.dep === 'ROOT' ? 'root' : ['nsubj', 'nsubjpass'].includes(t.dep) ? 'subj' : t.dep === 'dobj' ? 'obj' : t.dep === 'dative' ? 'iobj' : t.dep === 'neg' ? 'neg' : null);
  const byId = new Map(sentence.words.map(w => [w.id, w]));
  // A multiword name is headed by its first word in UD (flat) and by its last in spaCy (compound): both sides use
  // the start of the proper-noun run that contains the word.
  const runStart = (list, index, isName, start) => { let i = index; while (i > 0 && isName(list[i]) && isName(list[i - 1])) i--; return start(list[i]); };
  const sw = sentence.words;
  const sStart = w => runStart(sw, sw.indexOf(w), x => x?.upos === 'PROPN', x => x.start - offset);
  const tStart = t => runStart(spacyTokens, t.i, x => x?.pos === 'PROPN', x => x.start);
  const a = new Set(), b = new Set();
  for (const w of sw) {
    const c = classOfStanza(w);
    if (!c) continue;
    const head = w.head === 0 ? null : byId.get(w.head);
    a.add(`${c}:${sStart(w)}:${head ? sStart(head) : '-'}`);
  }
  for (const t of spacyTokens) {
    const c = classOfSpacy(t);
    if (!c) continue;
    const head = c === 'root' ? null : spacyTokens[t.head];
    b.add(`${c}:${tStart(t)}:${head ? tStart(head) : '-'}`);
  }
  const onlyA = [...a].filter(x => !b.has(x)), onlyB = [...b].filter(x => !a.has(x));
  if (!onlyA.length && !onlyB.length) return null;
  return `stanza ${onlyA.slice(0, 3).join(',')} / spacy ${onlyB.slice(0, 3).join(',')}`;
}

