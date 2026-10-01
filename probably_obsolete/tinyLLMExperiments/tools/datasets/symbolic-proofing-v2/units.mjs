/** Sentence units and mechanical filters of the SymbolicProofingLLM iteration-2 pairs (experiment train-symbolic-proofing-gemma270m-it2).
 *
 * Unit = one sentence as cut by the host splitter (lib/sentence-split.mjs): the model sees what the chat sends it, one sentence, and
 * writes one or several simple sentences. Pure functions, no I/O, so that tests/symbolic-proofing-units.test.mjs can execute them.
 */
import {splitSentences} from '../../../lib/sentence-split.mjs';

export const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();
export const fold = s => norm(s).normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();
export const foldWords = s => fold(s).replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();
export const sentencesOf = text => splitSentences(String(text)).map(u => norm(u.text)).filter(Boolean);

/** Longest common subsequence of the sentence lists under equality of the folded text: [[i, j], ...] anchor pairs in order. */
function lcs(a, b) {
  const n = a.length, m = b.length, t = Array.from({length: n + 1}, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const out = [];
  for (let i = 0, j = 0; i < n && j < m;) { if (a[i] === b[j]) { out.push([i, j]); i++; j++; } else if (t[i + 1][j] >= t[i][j + 1]) i++; else j++; }
  return out;
}

/**
 * Sentence units of a (prompt, target) pair. Sentences that are identical in prompt and target are anchors and produce no repair unit;
 * between two anchors one prompt sentence with one or more target sentences is a unit; k prompt sentences with exactly k target sentences are
 * taken one to one; every other gap (several prompt sentences that became a different number of sentences, or target sentences without a prompt
 * sentence) is dropped, never guessed. Returns {units: [{prompt, target, index}], dropped, anchors}.
 */
export function alignUnits(prompt, target) {
  const P = sentencesOf(prompt), T = sentencesOf(target);
  if (P.length === 1) return {units: T.length ? [{prompt: P[0], target: T.join(' '), index: 0}] : [], dropped: 0, anchors: 0, prompt_sentences: 1, target_sentences: T.length};
  const anchors = lcs(P.map(fold), T.map(fold));
  const bounds = [[-1, -1], ...anchors, [P.length, T.length]];
  const units = [];
  let dropped = 0;
  for (let k = 0; k + 1 < bounds.length; k++) {
    const p = P.slice(bounds[k][0] + 1, bounds[k + 1][0]), t = T.slice(bounds[k][1] + 1, bounds[k + 1][1]);
    if (!p.length && !t.length) continue;
    if (p.length === 1 && t.length >= 1) units.push({prompt: p[0], target: t.join(' '), index: bounds[k][0] + 1});
    else if (p.length > 1 && p.length === t.length) p.forEach((s, i) => units.push({prompt: s, target: t[i], index: bounds[k][0] + 1 + i}));
    else dropped += Math.max(p.length, 1);
  }
  return {units, dropped, anchors: anchors.length, prompt_sentences: P.length, target_sentences: T.length};
}

// ------------------------------------------------------------------ fillers (lead-ins and tags the model keeps)
/** Preregistered policy: NO filler may be dropped. SymbolicLM handles lead-ins and tags, so a repair target keeps every one that the prompt has. */
export const LEAD_INS = ['also', 'plus', 'honestly', 'hypothetically', 'background', 'question', 'quick question', 'quick one', 'just checking', 'out of curiosity', 'true or false', 'check this',
  'fact-check', 'remind me', 'one more thing', 'hey', 'hey there', 'random question', 'please', 'help me with this one', "i'm not 100% sure", 'okay', 'ok', 'thanks', 'thanks a lot', 'thank you', 'hi', 'hello',
  'lol', 'haha', 'nice', 'great', 'good morning', 'good evening', 'here\'s what i know', 'btw', 'by the way', 'sorry in advance', 'just so you know', 'fyi', 'for context'];
export const TAGS = ['right', 'correct', 'do you know', 'any idea', 'if you know', 'yes or no', 'is that so', 'am i right'];
export const FRAMES = ['any chance', 'would you say', 'is it the case that', 'is it true that', 'could it be that', 'i was wondering if', 'i wonder if'];
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LEAD_RE = new RegExp(`^(${[...LEAD_INS].sort((a, b) => b.length - a.length).map(esc).join('|')})(?=[,:!.\\s-])`, 'i');
const TAG_RE = new RegExp(`,\\s*(${[...TAGS].sort((a, b) => b.length - a.length).map(esc).join('|')})\\s*[?.!]*$`, 'i');
const FRAME_RE = new RegExp(`^(${[...FRAMES].sort((a, b) => b.length - a.length).map(esc).join('|')})\\b`, 'i');

/** The fillers of a sentence: {lead, tag, frame} (lower case phrases or null). */
export function fillersOf(sentence) {
  const s = norm(sentence), lead = LEAD_RE.exec(s), tag = TAG_RE.exec(s), frame = FRAME_RE.exec(s);
  return {lead: lead ? lead[1].toLowerCase() : null, tag: tag ? tag[1].toLowerCase() : null, frame: frame ? frame[1].toLowerCase() : null};
}
export const hasFiller = sentence => { const f = fillersOf(sentence); return Boolean(f.lead || f.tag || f.frame); };

/** Fillers of the prompt that the target lost (empty when every lead-in, tag and question frame is kept, in any position). */
export function lostFillers(prompt, target) {
  const f = fillersOf(prompt), low = foldWords(target), lost = [];
  for (const kind of ['lead', 'tag', 'frame']) if (f[kind] && !low.includes(foldWords(f[kind]))) lost.push(`${kind}:${f[kind]}`);
  return lost;
}

// ------------------------------------------------------------------ pronouns, names, numbers
const PRONOUN = /\b(?:he|she|him|his|hers?|himself|herself|they|them|their|theirs|themselves)\b/gi;
export const pronounCount = text => (String(text).match(PRONOUN) ?? []).length;
const names = text => { const out = new Map(); for (const m of String(text).matchAll(/(?<=[\p{L}\p{N},;:()"'] )\p{Lu}[\p{L}'’-]+/gu)) out.set(m[0].toLowerCase(), (out.get(m[0].toLowerCase()) ?? 0) + 1); return out; };
const namesAnySentence = text => { const out = new Set(); for (const s of sentencesOf(text)) { const w = s.split(/\s+/); w.forEach((x, i) => { const t = x.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’-]+$/gu, ''); if (/^\p{Lu}/u.test(t) && t.length > 1 && (i > 0 || false)) out.add(t.toLowerCase()); }); } return out; };
const numbersOf = text => (String(text).match(/\d+(?:[.,:]\d+)?/g) ?? []).sort().join('|');

/** Names that appear in the target but not in the prompt (an invented or substituted name), compared case-insensitively on non-initial capitalized tokens; sentence-initial tokens of the target count when they are not in the prompt at all. */
export function addedNames(prompt, target) {
  const promptWords = new Set((fold(prompt).match(/[\p{L}\p{N}'’-]+/gu) ?? []).flatMap(w => [w, w.replace(/['’]s$/, '')]));
  const out = [];
  for (const s of sentencesOf(target)) for (const [i, x] of s.split(/\s+/).entries()) {
    const t = x.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’-]+$/gu, '');
    if (!/^\p{Lu}/u.test(t) || t.length < 2) continue;
    const f = fold(t);
    if (i > 0 && !promptWords.has(f) && !promptWords.has(f.replace(/['’]s$/, ''))) out.push(t);
  }
  return out;
}
export const lostNames = (prompt, target) => [...namesAnySentence(prompt)].filter(n => !fold(target).includes(fold(n)));
const COMMON_INITIAL = new Set(`a an the and or but if so then it its this that these those there here who whom whose what which when where why how whether do does did is are was were am be been has have had can could will would shall should may might must please also plus not no yes i we you he she they my our your his her their thank thanks hi hello hey okay ok now next first second third finally background question honestly hypothetically besides apart given since because although while before after as for with without at in on by from to of into over under until during one two three four five six seven eight nine ten each every all any some both either neither most many few several other another such only just even still already again too very more less much`.split(/\s+/));

/** Words (stems) of the target that the prompt does not have: a rough signal that the target adds content. Stem = lower case, plural/ed/ing trimmed. */
const stem = w => (w.length >= 5 ? w.slice(0, 4) : w);
const CONTENT_SKIP = new Set(`have has had been being does did done make made take took taken give gave given need needs know knew known tell told ask asked say said check find found work works worked get got goes went gone come came want wants like mean means`.split(/\s+/));
export function newContent(prompt, target) {
  const p = new Set((fold(prompt).match(/[\p{L}\p{N}]+/gu) ?? []).map(stem));
  const out = new Set();
  for (const w of fold(target).match(/[\p{L}]{4,}/gu) ?? []) { const s = stem(w); if (!p.has(s) && !COMMON_INITIAL.has(w) && !CONTENT_SKIP.has(w)) out.add(w); }
  return [...out];
}

/** Mechanical verdict of a repair unit: {ok, reasons}. `pronouns` reproduces the owner rule that a target never replaces a pronoun by a name. */
const INTERROGATIVE_START = /^(?:who|whom|whose|what|which|when|where|why|how|is|are|was|were|do|does|did|can|could|will|would|should|shall|may|might|has|have|had|am|unless|if|given|since|because|although|whether|to whom|from whom|in what|on what|at what|for what|by whom|with whom|with what|about what|after what|before what|until when|since when|how many|how much)\b/i;
const EMBEDDED_QUESTION = /\b(?:i wonder|do you know|let me know|tell me|can you|could you|would you|please tell|i'd like to know|i would like to know|i need to know|i want to know|find out|any idea|if you know)\b/i;
/** A prompt without a question mark that becomes a question is allowed only when the prompt already asks one (inverted word order, a question word, an embedded question); a statement never becomes a question. */
export const asksQuestion = text => { const t = norm(text).replace(/^[^\p{L}\p{N}]+/u, ''); return INTERROGATIVE_START.test(t) || EMBEDDED_QUESTION.test(t) || /\?/.test(t); };

export function mechanicalUnit(prompt, target, {cut = false, rules = process.env.SYMPROOF_RULES ?? 'v2'} = {}) {
  if (rules === 'v3') return mechanicalUnitV3(prompt, target, {cut});
  const reasons = [];
  if (!norm(prompt) || !norm(target)) reasons.push('empty');
  if (norm(prompt) === norm(target)) reasons.push('equals_prompt');
  if (pronounCount(target) < pronounCount(prompt)) reasons.push('pronoun_dropped');
  const lost = lostNames(prompt, target);
  if (lost.length) reasons.push(`name_lost:${lost[0]}`);
  const added = addedNames(prompt, target);
  if (added.length) reasons.push(`name_added:${added[0]}`);
  if (numbersOf(prompt) !== numbersOf(target)) reasons.push('numbers');
  const fill = lostFillers(prompt, target);
  if (fill.length) reasons.push(`filler_dropped:${fill[0]}`);
  const count = (text, re) => (String(text).match(re) ?? []).length;
  const NEG = /\b(?:not|never|no|nobody|none|nothing|neither|nor|without|cannot)\b|n't\b/gi;
  const np = count(prompt, NEG), nt = count(target, NEG);
  if ((np > 0 && nt < np) || (np === 0 && nt > 0)) reasons.push('negation');
  // an embedded question may become a plain question (the target gains a question mark); a question never loses its mark
  if (/\?/.test(prompt) && !/\?/.test(target)) reasons.push('question_mark');
  if (/\?/.test(target) && !asksQuestion(prompt)) reasons.push('statement_to_question');
  // content the prompt does not have: two or more new stems, one already when the unit was cut out of a longer pair (the referent lived in another sentence)
  const fresh = newContent(prompt, target);
  if (fresh.length >= 2 || (cut && fresh.length >= 1)) reasons.push(`content_added:${fresh.join('+')}`);
  return {ok: reasons.length === 0, reasons};
}

// ------------------------------------------------------------------ rules v3 (audit of the rejected candidates, 2026-10-01)
// The audit of 20 rejected pairs per category (eval/reports/current/symbolic-proofing-it3/data/audit-rejected.md) found most v2 rejections wrong:
// detector artifacts (possessives, contractions and capitalized words after a colon read as names), legitimate embedded-question and exclusion
// paraphrases, resumptive pronouns, list numbering, and a filler rule that also blocked frame conversions. The rules that protect the meaning stay:
// a pronoun replaced by a name, a lost or invented name, a changed number, a lost negation, a statement turned into a question. What the
// two-vote meaning judge decides anyway (an added fact, a changed relation) is no longer pre-filtered by a lexical heuristic.

const NAME_STOP = new Set(`i i'm i'd i'll i've a an the and or but if so then it its this that these those there here who whom whose what which when where why how whether do does did is are was were am be been has have had can could will would shall should may might must please also plus not no yes we you he she they my our your his her their thank thanks hi hello hey okay ok now next first second third finally background question quick honestly hypothetically besides apart given since because although while before after as for with without at in on by from to of into over under until during one two three four five six seven eight nine ten each every all any some both either neither most many few several other another such only just even still already again too very more less much true false fact-check help tell let remind ask name list count find check set mum dad`.split(/\s+/));
import fs from 'node:fs';
let DICT = null;
/** Common English words (the system word list when present): a sentence-initial capitalized word that is one of them is not a name. */
const commonWord = w => { if (!DICT) { try { DICT = new Set(fs.readFileSync('/usr/share/dict/american-english', 'utf8').split('\n').filter(x => x && x === x.toLowerCase())); } catch { DICT = new Set(); } } return DICT.has(w.toLowerCase()); };
const cleanToken = x => x.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/['’]s$/i, '').replace(/['’]$/, '');
/** Proper-name tokens of a text: capitalized tokens that are not sentence-initial common words, not after a colon, dash or opening quote, and not a stop word; possessive 's and punctuation stripped. */
export function nameTokens(text) {
  const out = [];
  for (const s of sentencesOf(text)) {
    const words = s.split(/\s+/);
    words.forEach((raw, i) => {
      const t = cleanToken(raw);
      if (!/^\p{Lu}/u.test(t) || t.length < 2 || NAME_STOP.has(t.toLowerCase()) || /^\p{Lu}+$/u.test(t) && t.length <= 3 && false) return;
      const prev = i > 0 ? words[i - 1] : '';
      if (/[:\u2014\u2013"\u201c\u201e(]$/.test(prev) || /^[\u201c"\u201e(]/.test(raw)) return; // after a colon, a dash or an opening quote: a sentence start in disguise
      if (i === 0 && (NAME_STOP.has(t.toLowerCase()) || commonWord(t))) return;
      out.push(t);
    });
  }
  return out;
}
const occurrences = (text, name) => (fold(text).match(new RegExp(`(?<![\\p{L}\\p{N}])${fold(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'gu')) ?? []).length;
const stripPossessive = text => String(text).replace(/(\p{L})['’]s\b/gu, '$1');
export function lostNamesV3(prompt, target) { const tgt = fold(stripPossessive(target)); return [...new Set(nameTokens(prompt))].filter(n => !tgt.includes(fold(n))); }
export function addedNamesV3(prompt, target) {
  const pr = fold(stripPossessive(prompt));
  return [...new Set(nameTokens(target))].filter(n => !pr.includes(fold(n)));
}
/** A pronoun is replaced by a name when the pronoun count falls AND some name occurs more often in the target than in the prompt (a resumptive pronoun that duplicates a fronted name, or a pronoun that disappears with the clause it belonged to, does not count). */
export function pronounReplacedByName(prompt, target) {
  if (pronounCount(target) >= pronounCount(prompt)) return false;
  const names = new Set(nameTokens(target));
  for (const n of names) if (occurrences(target, n) > occurrences(prompt, n)) return true;
  return false;
}
const NEG_EQUIV = /\b(?:not|never|no|nobody|none|nothing|neither|nor|without|cannot|other than|besides|apart from|aside from|excluding|except|rather than|instead of|un[a-z]{3,}|non-?[a-z]{3,}|false|isn't|aren't|wasn't|weren't|doesn't|don't|didn't|won't|can't)\b|n't\b/i;
const NEG = /\b(?:not|never|no|nobody|none|nothing|neither|nor|without|cannot)\b|n't\b/gi;
/** Negations of a text that carry meaning: the exclusion idioms ("not counting X", "not 40") and tag questions (", isn't he?") are paraphrased by other words and are not counted. */
const meaningfulNegations = text => String(text).replace(/\b(?:not|n't)\s+(?:counting|including|to mention|\d)/gi, ' ').replace(/,\s*(?:is|are|was|were|do|does|did|can|could|will|would|should|has|have|had)n't\s+(?:he|she|it|they|you|we|I|there)\s*\?/gi, '?').replace(/,\s*\w+n't\s+\w+\?$/i, '?');
const DROPPABLE_LEADS = new Set(['quick question', 'quick one', 'just checking', 'out of curiosity', 'honestly', 'hey', 'hey there', 'hi', 'hello', 'thanks', 'thanks a lot', 'thank you', 'help me with this one', 'random question', 'one more thing', 'btw', 'by the way', 'just so you know', 'fyi', 'sorry in advance', 'please', 'okay', 'ok', 'lol', 'haha', 'nice', 'great', 'good morning', 'good evening']);
/** Fillers the target must keep under v3: the ones that carry a function (the labels of a structured message, the truth question, the fact-check, the hypothetical, the connectives, the hedge). The content-free lead-ins above may be dropped; frames and tags may be converted into a plain question. */
export function protectedFillersLost(prompt, target) {
  const f = fillersOf(prompt), low = foldWords(target).replace(/\bok\b/, 'okay'), lost = [];
  if (f.lead && !DROPPABLE_LEADS.has(f.lead) && !low.includes(foldWords(f.lead).replace(/\bok\b/, 'okay'))) lost.push(`lead:${f.lead}`);
  if (f.tag && !/\?/.test(target) && !low.includes(foldWords(f.tag))) lost.push(`tag:${f.tag}`);
  return lost;
}
const INTERROGATIVE_ANYWHERE = /\b(?:who|whom|whose|what|which|when|where|why|how|whether)\b|(?:^|[,;:.!?\u2014-]\s*|\b(?:so|and|but|then)\s+)(?:is|are|was|were|do|does|did|can|could|will|would|should|shall|may|might|has|have|had)\s+\p{L}|\b(?:i was wondering|i wonder|do you know|can you|could you|would you|please tell|i'd like to know|i would like to know|i need to know|i want to know|find out|any idea|if you know|tell me)\b/iu;

export function mechanicalUnitV3(prompt, target, {cut = false} = {}) {
  void cut;
  const reasons = [];
  if (!norm(prompt) || !norm(target)) reasons.push('empty');
  if (norm(prompt) === norm(target)) reasons.push('equals_prompt');
  if (pronounReplacedByName(prompt, target)) reasons.push('pronoun_replaced_by_name');
  const lost = lostNamesV3(prompt, target);
  if (lost.length) reasons.push(`name_lost:${lost[0]}`);
  const added = addedNamesV3(prompt, target);
  if (added.length) reasons.push(`name_added:${added[0]}`);
  // numbers: the set of numbers (a split sentence repeats a number); list markers ("1)", "2.") are not numbers
  const nums = text => [...new Set((String(text).replace(/(^|[\s:;,])\d{1,2}[.)](?=\s+\p{L})/gu, '$1').match(/\d+(?:[.,:]\d+)?/g) ?? []))].sort().join('|');
  if (nums(prompt) !== nums(target)) reasons.push('numbers');
  const np = (meaningfulNegations(prompt).match(NEG) ?? []).length, nt = (String(target).match(NEG_EQUIV) ?? []).length;
  if (np > 0 && nt < 1) reasons.push('negation');
  if (np === 0 && (meaningfulNegations(target).match(NEG) ?? []).length > 0 && !NEG_EQUIV.test(prompt)) reasons.push('negation_added');
  if (/\?/.test(target) && !INTERROGATIVE_ANYWHERE.test(prompt) && !/\?/.test(prompt)) reasons.push('statement_to_question');
  const lostFiller = protectedFillersLost(prompt, target);
  if (lostFiller.length) reasons.push(`filler_dropped:${lostFiller[0]}`);
  return {ok: reasons.length === 0, reasons};
}
