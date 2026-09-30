/** Decomposition cases and the target-style contract (DS021 "Limited English for SymbolicLM", DS008 "Decomposition coverage").
 *
 * A decomposition case: the message holds more than one finite clause (or several questions) and the target splits it into
 * several simple sentences. Clause counts come from the stored grammatical analysis (a Stanza parse of the message: neuro_english) or,
 * without one (bad_english), from surface cues, and are marked approximate. The contract check reads the SymbolicLM analysis of each
 * TARGET sentence: clauses per sentence and whether the subject is explicit. Pure functions over rows and compact analyses.
 */
import {splitSentences} from '../../../lib/sentence-split.mjs';

/** Connectives a sentence may keep (sop/enums.mjs LINK_KEYWORDS) and the marks under which SymbolicLM parses them (inventory of symbolic_english). */
export const CONNECTIVES = new Set(['because', 'so', 'if', 'unless', 'although', 'though', 'before', 'after', 'when', 'while', 'since', 'until', 'as']);
const FRAME_VERBS = new Set(['know', 'tell', 'wonder', 'check', 'confirm', 'say', 'see', 'find', 'verify', 'ask', 'need', 'want', 'think', 'remind', 'let']);
const QUESTION_START = /^(who|whom|whose|what|which|when|where|why|how|does|do|did|is|are|was|were|can|could|will|would|should|has|have|had)\b/i;
const SUBJECT_RELS = /^(nsubj|nsubj:pass|csubj|csubj:pass|expl)$/;

/** Finite clause heads of one analysed sentence: tokens with an explicit subject, plus a subjectless imperative root. */
export function clausesOfSentence(sentence) {
  const tokens = sentence.tokens, byId = new Map(tokens.map(t => [t[0], t]));
  const kids = new Map();
  for (const t of tokens) (kids.get(t[4]) ?? kids.set(t[4], []).get(t[4])).push(t);
  const heads = [];
  for (const t of tokens) {
    const children = kids.get(t[0]) ?? [];
    const subject = children.some(c => SUBJECT_RELS.test(c[5]));
    const isRoot = t[5] === 'root';
    if (!subject && !(isRoot && t[3] === 'VERB')) continue;
    if (!subject && isRoot) { heads.push({id: t[0], lemma: t[2], rel: 'root', subject: false, imperative: true, connective: null}); continue; }
    const mark = children.find(c => c[5] === 'mark')?.[2]?.toLowerCase() ?? null;
    const cc = children.find(c => c[5] === 'cc')?.[2]?.toLowerCase() ?? null;
    // A copular predicate carries the clause: the subject hangs on it, not on the copula.
    heads.push({id: t[0], lemma: t[2], upos: t[3], rel: t[5], subject, imperative: false, connective: mark, coordinator: cc, parent: byId.get(t[4])?.[2] ?? null});
  }
  return heads;
}

/** Contract verdict of one target sentence: `{clauses, single, linked, coordinated, relative, complement, elided_subject, ok}`. */
export function contractOfSentence(sentence) {
  const heads = clausesOfSentence(sentence);
  const tokens = sentence.tokens, byId = new Map(tokens.map(t => [t[0], t]));
  const finite = heads.filter(h => h.rel !== 'root' || h.subject || h.imperative);
  const extra = finite.filter(h => h.rel !== 'root');
  const linked = extra.filter(h => h.rel === 'advcl' && h.connective && CONNECTIVES.has(h.connective)).length;
  const complement = extra.filter(h => h.rel === 'ccomp' || h.rel === 'csubj').length;
  const coordinated = extra.filter(h => h.rel === 'conj').length;
  const relative = extra.filter(h => h.rel === 'acl:relcl').length;
  const other = extra.length - linked - complement - coordinated - relative;
  // A coordinated verb without its own subject shares the subject of the first clause (elided): the contract repeats it.
  const conjVerbs = tokens.filter(t => t[5] === 'conj' && ['VERB', 'AUX'].includes(t[3]) && byId.get(t[4]) && !heads.some(h => h.id === t[0]));
  const elided = conjVerbs.length;
  return {clauses: finite.length, single: finite.length <= 1 && !elided, linked, complement, coordinated, relative, other, elided_subject: elided, ok: coordinated === 0 && relative === 0 && other === 0 && elided === 0};
}

/** Clauses and questions of a message from its stored analysis (neuro_english) or from cues (approximate). */
export function messageShape(row) {
  const sentences = row.analysis?.sentences ?? null;
  const text = row.message;
  const questions = (text.match(/\?/g) ?? []).length;
  if (sentences?.length) {
    // A complement clause ("Do you know whether ...", "Is it correct that ...") belongs to its frame and is not counted.
    const clauses = sentences.reduce((n, s) => n + Math.max(1, clausesOfSentence(s).filter(h => !['ccomp', 'csubj', 'csubj:pass'].includes(h.rel)).length), 0);
    const rels = sentences.flatMap(s => s.tokens.map(t => t[5]));
    return {source: 'analysis', clauses, questions, has_conj: rels.includes('conj'), has_relcl: rels.includes('acl:relcl'), has_sub: rels.includes('advcl') || rels.includes('ccomp')};
  }
  const cueClauses = 1 + (text.match(/(,\s*|\s)(and|but|or|so|then)\s/gi) ?? []).length + (text.match(/\b(because|if|unless|although|before|after|when|while|since|who|which)\b/gi) ?? []).length;
  return {source: 'cues', clauses: cueClauses, questions, has_conj: /\b(and|but|or|so|then)\b/i.test(text), has_relcl: /\b(who|which|whose)\b/i.test(text), has_sub: /\b(because|if|unless|although|before|after|when|while|since)\b/i.test(text)};
}

/** Whether a message with several clauses has no sentence punctuation inside (a run-on). */
export const isRunOn = (text, clauses) => text.split(/\s+/).filter(Boolean).length >= 14 && !/[.?!;:]\s+\S/.test(text) && clauses >= 2;

/** Structural types of a decomposition candidate (a message may have several). */
export function decompositionTypes(row, shape = messageShape(row)) {
  const text = row.message, types = [];
  if (/(^|\n)\s*([-*•]|\d+[.)])\s/.test(text) || (text.includes('\n') && text.split('\n').length > 2)) types.push('list');
  const questionStarts = text.split(/\s*(?:,|;|\band\b|\bbut\b|\bor\b|\bthen\b)\s+/i).filter(part => QUESTION_START.test(part.trim())).length;
  if (shape.questions >= 2 || splitSentences(text).filter(s => /\?$/.test(s.text)).length >= 2 || (questionStarts >= 2 && /\?\s*$/.test(text))) types.push('multiple_questions');
  if (shape.has_conj && shape.clauses >= 2) types.push('coordination');
  if (shape.has_relcl) types.push('relative_clause');
  if (shape.has_sub && shape.clauses >= 2) types.push('subordinate_clause');
  return types;
}

const PRIORITY = ['list', 'multiple_questions', 'coordination', 'subordinate_clause', 'relative_clause'];

/** One row: `{candidate, decomposition, type, types, shape, message_sentences, target_sentences, has_target}`. */
export function classifyRow(row) {
  const shape = messageShape(row), types = decompositionTypes(row, shape);
  const messageSentences = splitSentences(row.message).length;
  const targetSentences = row.target ? splitSentences(row.target).length : 0;
  const candidate = types.length > 0 || shape.clauses >= 2;
  const decomposition = candidate && targetSentences >= 2 && targetSentences > messageSentences;
  return {candidate, decomposition, unpunctuated: candidate && isRunOn(row.message, shape.clauses), type: PRIORITY.find(t => types.includes(t)) ?? (candidate ? 'other' : null), types, shape: {source: shape.source, clauses: shape.clauses, questions: shape.questions}, message_sentences: messageSentences, target_sentences: targetSentences, has_target: Boolean(row.target)};
}
