/**
 * Deterministic decomposition of a request for the clause-first protocol (DS022 "LocalLLMStepByStep", methods C and D): sentences,
 * then finite clauses introduced by a link connective (DS014 "Clauses and links"), then a second question joined by "and" + a question
 * word. The split never enters a relative clause (who, which, that are not connectives), "A and B" between names stays coordination,
 * a connective group without a finite verb ("After 1 rule steps,") stays in its clause, and an elliptical comparison ("before Felix
 * did") is left to the two-sided comparison. The main clause is the question (the last one when there are several); every other
 * clause gets the clause-role question.
 */
const CONNECTIVES = ['if', 'unless', 'because', 'although', 'even though', 'though', 'before', 'after', 'when', 'while', 'whenever', 'once', 'so that',
  'provided that', 'assuming that', 'assuming', 'suppose that', 'suppose', 'supposing', 'given that', 'since'];
/** The link keyword of each connective (sop/enums.mjs LINK_KEYWORDS). */
export const LINK_OF = Object.freeze({if: 'if', unless: 'unless', because: 'because', although: 'although', 'even though': 'although', though: 'although',
  before: 'before', after: 'after', once: 'after', when: 'when', whenever: 'when', while: 'while', 'so that': 'so_that', 'provided that': 'if',
  'assuming that': 'if', assuming: 'if', 'suppose that': 'if', suppose: 'if', supposing: 'if', 'given that': 'because', since: 'after'});

const FINITE = /\b(?:is|are|was|were|be|been|being|do|does|did|has|have|had|can|could|will|would|may|might|must|should|shall|went|came|got|left|took|made|said|built|began|ran|won|wrote|paid|sold|bought|met|lost|\w{3,}ed)\b/i;
const QUESTION_WORD = /^(?:who|whom|whose|what|which|where|when|why|how|is|are|was|were|do|does|did|can|could|may|might|has|have|had|will|would|should|must|in which|in what|among)\b/i;
const connectivePattern = CONNECTIVES.map(c => c.replace(/ /g, '\\s+')).join('|');

/** Sentences: split after . ? ! followed by a capital, never after an initial ("J. K.") or a number ("1. "). */
export function splitSentences(text) {
  const out = [];
  let start = 0;
  const t = String(text ?? '');
  for (const m of t.matchAll(/[.?!]+(?=\s+["'(]?[A-Z])/g)) {
    const before = t.slice(start, m.index);
    if (/(?:^|\s)(?:[A-Z]|Mr|Mrs|Ms|Dr|St|No|vs)$/.test(before) || /\d$/.test(before) && m[0] === '.') continue;
    out.push(t.slice(start, m.index + m[0].length).trim());
    start = m.index + m[0].length;
  }
  const rest = t.slice(start).trim();
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

const isElliptic = clause => /^\S+\s+(?:[\p{Lu}][\p{L}'’-]*\s*){1,4}(?:did|does|do|had|has|was|were|is|are)\s*[?.!]?$/u.test(clause.trim());

/** The clauses of one sentence: [{text, connective, link, kind: 'main'|'sub'|'second'}]. */
export function splitClauses(sentence) {
  let s = String(sentence).trim();
  const out = [];
  // A leading subordinate clause: "If Dovecote were closed, could one ...".
  const lead = new RegExp(`^(${connectivePattern})\\s+([^,]+?),\\s+(.+)$`, 'i').exec(s);
  // "When did Ana join, ..." is a question word, not a connective.
  if (lead && FINITE.test(lead[2]) && !/^(?:did|does|do|is|are|was|were|has|have|had|will|would|can|could)\b/i.test(lead[2])) {
    const connective = lead[1].toLowerCase().replace(/\s+/g, ' ');
    out.push({text: `${lead[1]} ${lead[2]}`, connective, link: LINK_OF[connective], kind: 'sub'});
    s = lead[3];
  }
  // A second question joined by "and" + a question word: "Who wrote X and how many copies were sold?".
  const second = /,?\s+and\s+(?=(?:who|whom|whose|what|which|where|when|why|how)\b)/i.exec(s);
  let tail = null;
  if (second && second.index > 0) { tail = s.slice(second.index + second[0].length); s = s.slice(0, second.index); }
  // A trailing subordinate clause: "... is interest due if the invoice is paid late?".
  const trail = new RegExp(`^(.+?\\S)\\s*,?\\s+(${connectivePattern})\\s+(.+)$`, 'i').exec(s);
  if (trail && FINITE.test(trail[3]) && !isElliptic(`${trail[2]} ${trail[3]}`) && !/\b(?:who|which|that)\s*$/i.test(trail[1])) {
    const connective = trail[2].toLowerCase().replace(/\s+/g, ' ');
    out.push({text: trail[1].trim(), connective: null, link: null, kind: 'main'});
    out.push({text: `${trail[2]} ${trail[3]}`.replace(/[?.!]+$/, '').trim(), connective, link: LINK_OF[connective], kind: 'sub'});
  } else out.push({text: s.trim(), connective: null, link: null, kind: 'main'});
  if (tail) out.push({text: tail.trim(), connective: 'and', link: null, kind: 'second'});
  return out;
}

/**
 * The decomposition of a request: {main: {text, sentence}, extras: [{text, connective, link, kind}]}. The main clause is the last
 * question clause (or the last clause); all others are extras, in message order.
 */
export function decompose(message) {
  const sentences = splitSentences(message);
  const clauses = sentences.flatMap((sentence, i) => splitClauses(sentence).map(c => ({...c, sentence: i, question: /\?\s*$/.test(sentence) || QUESTION_WORD.test(sentence)})));
  const mains = clauses.filter(c => c.kind === 'main');
  const main = [...mains].reverse().find(c => c.question) ?? mains.at(-1) ?? clauses[0];
  const extras = clauses.filter(c => c !== main).map(c => c.kind === 'main' ? {...c, kind: c.question ? 'second' : 'sentence'} : c);
  return {main, extras, sentences};
}
