/**
 * SymbolicLM uncertainty signal (DS021 "SymbolicLM"): deterministic reasons why an analysis may be wrong, used to
 * gate an optional rewrite of the English text (SymbolicProofingLLM) before parsing. Every reason is a fact about
 * this analysis, never a guess about the message:
 *   untranslated       Romanian words the dictionary does not know (copied into the English text);
 *   spelling           the spelling corrector changed words;
 *   unparsed           the rules left an `unparsed` span;
 *   rule_fallback      the rules repaired an inadmissible program, dropped a wire or fell back to `no_request`;
 *   value_unmapped     a translated value could not be mapped back to a message span;
 *   oov                a sentence whose words are mostly outside the parser's vocabulary;
 *   tree_shape         an unusual dependency tree (a root that is not a predicate, `dep`/`orphan`/`goeswith`/`list`
 *                      arcs, two subjects of one head, a long sentence without a verb);
 *   parsers_disagree   the other Stanza package (default vs accurate, config/symbolic-lm.json) parses an English
 *                      sentence with a different core arc (optional, off by default: it runs a second worker, so it
 *                      about doubles latency on the GPU and multiplies it by four to five on the CPU).
 * `uncertain` is true when any reason is present; `score` counts the distinct reason kinds.
 */

const PREDICATE_ROOT = new Set(['VERB', 'AUX', 'ADJ', 'NOUN', 'PROPN', 'PRON', 'ADV', 'NUM']);
const ODD_ARCS = new Set(['dep', 'orphan', 'goeswith', 'list', 'reparandum']);

/** Tree-shape findings of one Stanza sentence (words with id, head, deprel, upos). */
export function treeShape(sentence) {
  const findings = [];
  const words = sentence.words ?? [];
  const content = words.filter(w => w.upos !== 'PUNCT');
  if (!content.length) return findings;
  const root = words.find(w => w.head === 0);
  const kidsOf = id => words.filter(w => w.head === id);
  if (root && !PREDICATE_ROOT.has(root.upos)) findings.push(`root ${root.upos} "${root.text}"`);
  if (root && ['NOUN', 'PROPN', 'PRON', 'NUM'].includes(root.upos) && !kidsOf(root.id).some(k => ['cop', 'nsubj', 'nsubj:pass', 'csubj'].includes(k.deprel)) && content.length > 3) findings.push(`verbless root "${root.text}"`);
  for (const w of words) if (ODD_ARCS.has(String(w.deprel).split(':')[0])) findings.push(`${w.deprel} "${w.text}"`);
  for (const w of words) {
    const subjects = kidsOf(w.id).filter(k => /^nsubj/.test(k.deprel));
    if (subjects.length > 1) findings.push(`two subjects of "${w.text}"`);
  }
  if (content.length > 12 && !content.some(w => w.upos === 'VERB' || w.upos === 'AUX')) findings.push('long sentence without a verb');
  return findings;
}

const CORE_BASES = new Set(['root', 'nsubj', 'csubj', 'obj', 'iobj', 'obl', 'ccomp', 'xcomp', 'advcl', 'acl', 'conj', 'cop', 'aux', 'mark']);
const base = deprel => String(deprel).split(':')[0];

/**
 * Compare the compact tokens (`[id, form, lemma, upos, head, deprel]`) of one sentence in two trees. `identical`: same
 * tokens, every head and deprel equal. `core_diff`: a token differs (head or relation) and it is a core arc: its
 * relation in either tree is root, nsubj*, csubj*, obj, iobj, obl*, ccomp, xcomp, advcl, acl*, conj, cop, aux* or mark;
 * it is a `case` token; or it heads a `case` dependent in either tree; a subtype-only difference on a non-subject
 * relation with the same head is not core. A different tokenization is a core_diff. Otherwise `noncore_diff`.
 */
export function compareSentence(a, b) {
  if (!a || !b || a.length !== b.length || a.some((t, i) => t[1] !== b[i][1])) return 'core_diff';
  const caseHeadsA = new Set(a.filter(t => t[5] === 'case').map(t => t[4])), caseHeadsB = new Set(b.filter(t => t[5] === 'case').map(t => t[4]));
  let differs = false;
  for (let i = 0; i < a.length; i++) {
    const [id, , , , headA, relA] = a[i], [, , , , headB, relB] = b[i];
    if (headA === headB && relA === relB) continue;
    differs = true;
    const subtypeOnly = headA === headB && base(relA) === base(relB) && !['nsubj', 'csubj'].includes(base(relA));
    if (subtypeOnly) continue;
    if (CORE_BASES.has(base(relA)) || CORE_BASES.has(base(relB)) || relA === 'case' || relB === 'case' || caseHeadsA.has(id) || caseHeadsB.has(id)) return 'core_diff';
  }
  return differs ? 'noncore_diff' : 'identical';
}

const compactOf = sentence => (sentence?.words ?? []).map(w => [w.id, w.text, w.lemma, w.upos, w.head, w.deprel]);

/** `parsers_disagree` detail of one sentence parsed by two Stanza packages (worker sentences), or null when the core arcs agree. */
export function parsersDisagreement(sentence, other) {
  return compareSentence(compactOf(sentence), compactOf(other)) === 'core_diff' ? 'default and accurate trees differ on a core arc' : null;
}

/** Collect the reasons of one analysis trace (see lib/symbolic-lm/index.mjs `analyze`). */
export function uncertaintyOf(trace, {englishSentences = [], otherStanza = null} = {}) {
  const reasons = [];
  const add = (kind, detail) => reasons.push({kind, detail});
  for (const u of trace.translation?.untranslated ?? []) add('untranslated', u.word);
  for (const c of trace.spelling?.changes ?? []) add('spelling', `${c.from} → ${c.to}`);
  for (const u of trace.unparsed ?? []) add('unparsed', u.span);
  const rules = trace.rules ?? {};
  if (rules.repaired?.length) add('rule_fallback', 'admission repair: ' + rules.repaired[0]);
  for (const note of rules.notes ?? []) if (/^dropped @/.test(note)) add('rule_fallback', note);
  if (['fallback', 'nothing_formalized'].includes(rules.outcome)) add('rule_fallback', 'outcome ' + rules.outcome);
  for (const m of trace.value_mapping ?? []) if (!m.source && !m.dropped && m.english !== undefined && m.why !== 'first person') add('value_unmapped', `${m.english} (${m.why})`);
  for (const s of englishSentences) {
    if ((s.oov_rate ?? 0) > 0.34 && (s.words?.length ?? 0) >= 3) add('oov', `${Math.round(s.oov_rate * 100)}% of "${s.text}"`);
    for (const f of treeShape(s)) add('tree_shape', f);
  }
  if (otherStanza) {
    if (otherStanza.length !== englishSentences.length) add('parsers_disagree', 'the two Stanza packages split the text differently');
    else englishSentences.forEach((s, i) => { const d = parsersDisagreement(s, otherStanza[i]); if (d) add('parsers_disagree', `${d}: "${s.text}"`); });
  }
  const kinds = [...new Set(reasons.map(r => r.kind))];
  return {uncertain: reasons.length > 0, score: kinds.length, kinds, reasons};
}
