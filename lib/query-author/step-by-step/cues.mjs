/**
 * The cue table of the generic question protocol (DS022 "LocalLLMStepByStep"): literal English cues of the aspects a request can
 * have (a number limit, a choice between named things, an exclusion, a date, a supposition, a two-sided comparison, a second question,
 * a reason), of quantifiers, of time measures and of chains. Cues are regular expressions over the message, never a parse; each cue
 * keeps its span so the protocol can show it to the oracle. The protocol combines them with the oracle's checklist answer (the
 * two-signal rule): cue and model agree, no question; they disagree, one question with the span; literal cues win for limits,
 * exclusions and dates.
 */
import {readDates} from './answers.mjs';

/** The aspects of the checklist question (Q2), in the fixed order of the cached prompt. */
export const ASPECTS = Object.freeze([
  ['limit', 'a number limit (more than, fewer than, at least, at most, between two numbers, before or after a year)'],
  ['options', 'a choice between named things (A or B)'],
  ['exclusion', 'something to leave out (not X, except X, besides X, other than X)'],
  ['date', 'a calendar date or period'],
  ['supposition', 'a supposition (if, suppose, were)'],
  ['twoSided', 'two named things compared with each other (before X did, more than X, the same as, both X and Y)'],
  ['second', 'a second question'],
  ['reason', 'a reason (because)'],
]);
/** Aspects whose literal cue is trusted even when the oracle did not tick them. */
export const LITERAL_ASPECTS = Object.freeze(['limit', 'exclusion', 'date']);

const fold = s => String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replaceAll('_', ' ');
const YEAR = '(?:1[5-9]|20)\\d{2}';

/** Positions of the linked mentions in the folded message: [{surface, at, end, mention}], in order. */
export function mentionSpans(message, mentions = []) {
  const text = fold(message), out = [];
  for (const m of mentions) {
    const surface = fold(m.surface);
    if (!surface) continue;
    let at = text.indexOf(surface);
    while (at >= 0) {
      const before = text[at - 1], after = text[at + surface.length];
      if (!(before && /[\p{L}\p{N}]/u.test(before)) && !(after && /[\p{L}\p{N}]/u.test(after))) out.push({surface: m.surface, at, end: at + surface.length, mention: m});
      at = text.indexOf(surface, at + 1);
    }
  }
  // Longest mention wins where two overlap ("the Falcon team" over "Falcon").
  out.sort((a, b) => a.at - b.at || (b.end - b.at) - (a.end - a.at));
  return out.filter((s, i) => !out.some((o, j) => j !== i && o.at <= s.at && o.end >= s.end && (o.end - o.at) > (s.end - s.at)));
}

const LIMITS = [
  [new RegExp(`\\bbetween\\s+(-?\\d+)\\s+and\\s+(-?\\d+)`, 'g'), m => [['at_least', Number(m[1])], ['at_most', Number(m[2])]]],
  [/\b(?:more|greater|higher|larger|bigger|longer|older)\s+than\s+(-?\d+)(?![\d-])/g, m => [['above', Number(m[1])]]],
  [/\b(?:fewer|less|lower|smaller|shorter|younger)\s+than\s+(-?\d+)(?![\d-])/g, m => [['below', Number(m[1])]]],
  [/\b(?:above|over|exceeding)\s+(-?\d+)(?![\d-])/g, m => [['above', Number(m[1])]]],
  [/\b(?:under|below)\s+(-?\d+)(?![\d-])/g, m => [['below', Number(m[1])]]],
  [/\b(?:at least|no fewer than|no less than)\s+(\d+)(?![\d-])/g, m => [['at_least', Number(m[1])]]],
  [/\b(?:at most|no more than|up to)\s+(\d+)(?![\d-])/g, m => [['at_most', Number(m[1])]]],
  [new RegExp(`\\b(?:before|earlier than|prior to)\\s+(${YEAR})(?![\\d-])`, 'g'), m => [['below', Number(m[1])]]],
  [new RegExp(`\\b(?:after|later than)\\s+(${YEAR})(?![\\d-])`, 'g'), m => [['above', Number(m[1])]]],
];

const ORDERED = {before: 'below', earlier: 'below', less: 'below', fewer: 'below', younger: 'below', lower: 'below', smaller: 'below', shorter: 'below',
  after: 'above', later: 'above', more: 'above', older: 'above', higher: 'above', bigger: 'above', larger: 'above', longer: 'above', taller: 'above'};

/**
 * Every cue of a message. `mentions` are the entity hints (retrieval.mjs `entityHints`); names are found by their spans.
 * Returns {limit: [{span, comparisons: [[comparator, number]]}], options, exclusion: [{span, surface, mention}], date: {span, dates},
 * supposition: {span, connective}, twoSided: {span, kind, comparator, names}, second: {span}, reason: {span}, quantifier: {word, span},
 * measure, reach, fewest, howMany}; an absent cue is null (or an empty list).
 */
export function readCues(message, mentions = []) {
  const raw = String(message ?? '');
  const text = fold(raw);
  const spans = mentionSpans(raw, mentions);
  const nameAt = at => spans.find(s => s.at === at);
  const limit = [];
  const puzzle = /\blet\s+[a-z]\s+be\b|\b[a-z]\s*(?:\+|plus)\s*[a-z]\b/.test(text);
  if (!puzzle) for (const [re, read] of LIMITS) for (const m of text.matchAll(re)) {
    if (limit.some(l => l.at <= m.index && m.index < l.at + l.span.length)) continue;
    // The span keeps the counted noun that follows the number ("more than 4 members").
    const noun = /^\s+(?!and\b|or\b|but\b|inclusive\b|exclusive\b)([\p{L}-]+)/u.exec(text.slice(m.index + m[0].length));
    limit.push({span: raw.slice(m.index, m.index + m[0].length + (noun ? noun[0].length : 0)), at: m.index, comparisons: read(m)});
  }
  const exclusion = [];
  for (const m of text.matchAll(/\b(?:not|except(?:\s+for)?|besides|excluding|other than|apart from|but not|aside from)\s+(?:the\s+|for\s+)?/g)) {
    const name = nameAt(m.index + m[0].length);
    if (name) exclusion.push({span: raw.slice(m.index, name.end), surface: name.surface, mention: name.mention});
  }
  const dates = readDates(raw);
  const yearOnly = [...text.matchAll(new RegExp(`(?<![\\w-])${YEAR}(?![\\w-])`, 'g'))].filter(m => !limit.some(l => l.at <= m.index && m.index < l.at + l.span.length));
  const date = dates.length || yearOnly.length ? {span: dates.length ? dates.join(', ') : yearOnly.map(m => m[0]).join(', '), dates} : null;
  const sup = /(?:^|[,;.]\s*|\b)(if|unless|suppose that|suppose|supposing|assuming that|assuming|imagine that|what if|in case)\b/.exec(text);
  const supposition = sup && !/\b(?:even|as) if\b/.test(text.slice(Math.max(0, sup.index - 5), sup.index + 3)) && !puzzle
    ? {connective: sup[1].split(' ')[0], span: raw.slice(sup.index + sup[0].indexOf(sup[1])).split(/[,;?]/)[0].trim()} : null;
  let options = null;
  for (const m of text.matchAll(/\s+or\s+/g)) {
    const before = spans.filter(s => s.end <= m.index && text.slice(s.end, m.index).trim().split(/\s+/).filter(Boolean).length <= 1).at(-1);
    const after = spans.find(s => s.at >= m.index + m[0].length && text.slice(m.index + m[0].length, s.at).trim().split(/\s+/).filter(Boolean).length <= 1);
    if (before && after && before.surface !== after.surface) { options = {span: raw.slice(before.at, after.end), names: [before, after]}; break; }
  }
  let twoSided = null;
  const named = spans.map(s => s.surface);
  if (/\bhow many more\b[\s\S]*\bthan\b/.test(text)) {
    const than = text.lastIndexOf(' than ');
    twoSided = {kind: 'difference', span: raw.slice(text.indexOf('how many more')), names: spans.filter((s, i) => spans.findIndex(o => o.surface === s.surface) === i).slice(0, 2), comparator: null, than};
  } else {
    const ordered = new RegExp(`\\b(before|after)\\s+`, 'g');
    for (const m of text.matchAll(ordered)) {
      const name = nameAt(m.index + m[0].length);
      if (name && /^\s*(?:did|does|do|had|has|have|was|were|is|are|could|can)\b/.test(text.slice(name.end))) {
        const other = spans.find(s => s.end <= m.index && s.surface !== name.surface);
        twoSided = {kind: m[1], comparator: ORDERED[m[1]], span: raw.slice(m.index, name.end + /^\s*\w+/.exec(text.slice(name.end))[0].length), names: other ? [other, name] : [name]};
        break;
      }
    }
    if (!twoSided) {
      const both = /\bboth\s+/.exec(text);
      const first = both && nameAt(both.index + both[0].length);
      const second = first && /^\s+and\s+/.exec(text.slice(first.end)) && nameAt(first.end + /^\s+and\s+/.exec(text.slice(first.end))[0].length);
      if (first && second) twoSided = {kind: 'both', comparator: null, span: raw.slice(both.index, second.end), names: [first, second]};
    }
    if (!twoSided && /\b(?:the )?same\b/.test(text) && new Set(named).size >= 2) {
      const pair = spans.filter((s, i) => spans.findIndex(o => o.surface === s.surface) === i).slice(0, 2);
      twoSided = {kind: 'same', comparator: null, span: raw.slice(/\b(?:the )?same\b/.exec(text).index).split(/[?,]/)[0], names: pair};
    }
    if (!twoSided) {
      const m = /\b(earlier|later|more|less|fewer|older|younger|higher|lower|bigger|smaller|larger|longer|shorter|taller)\b(?:\s+\w+){0,4}?\s+than\s+(?:the\s+)?/.exec(text);
      const name = m && nameAt(m.index + m[0].length);
      if (name && !/^\s*-?\d/.test(text.slice(m.index + m[0].length))) {
        const other = spans.find(s => s.end <= m.index && s.surface !== name.surface);
        twoSided = {kind: m[1], comparator: ORDERED[m[1]], span: raw.slice(m.index, name.end), names: other ? [other, name] : [name]};
      }
    }
  }
  const questions = (raw.match(/\?/g) ?? []).length;
  const and = /(?:,\s*|\s+)and\s+(who|what|whom|whose|where|which|when|why|how)\b/.exec(text);
  const second = questions >= 2 ? {span: raw.slice(raw.indexOf('?') + 1).trim()} : and ? {span: raw.slice(and.index).replace(/^[,\s]*and\s+/i, '').trim()} : null;
  const because = /\b(because|due to|given that|as a result of)\b/.exec(text);
  const reason = because ? {span: raw.slice(because.index).split(/[,;?]/)[0]} : null;
  const q = [[/\bnot all\b/, 'not_all'], [/\b(?:nobody|no one|none of the|no)\b/, 'none'], [/\bnone\b/, 'none'], [/\bat least (\d+)\b/, 'at_least'],
    [/\b(?:most of the|most)\b(?!\s+(?:\w+est|\w+ly|popul|spoken|common|famous|import|expensive|valuable|recent|frequent))/, 'most'], [/\bhalf\b/, 'half'],
    [/\b(?:all|every|each|everyone|everybody|anyone|anybody)\b/, 'all']];
  let quantifier = null;
  for (const [re, word] of q) {
    const m = re.exec(text);
    if (m) { quantifier = {word: word === 'at_least' ? `at_least ${m[1]}` : word, span: m[0]}; break; }
  }
  const measure = /\bsince when\b/.test(text) ? 'start' : /\buntil when\b|\buntil what\b|\bwhen will\b.*\bend\b/.test(text) ? 'end' : /\b(?:for )?how long\b/.test(text) ? 'duration' : null;
  const reach = /\b(?:reach|reached|reachable|get from|get to|travel from|go from|route from|path from|following|follow)\b/.test(text);
  // "can be reached", "reachable": the chain is literal; "following trails" alone is only a cue.
  const reachLiteral = /\b(?:reached|reachable)\b/.test(text);
  const fewest = reach && /\b(?:smallest|fewest|least|minimum|minimal|shortest)\b/.test(text);
  return {limit, options, exclusion, date, supposition, twoSided, second, reason, quantifier, measure, reach, reachLiteral, fewest, howMany: /\bhow many\b/.test(text), spans};
}

/** The aspects the cue table finds, as a set of aspect ids (Q2's vocabulary). */
export function cueAspects(cues) {
  const out = new Set();
  if (cues.limit.length) out.add('limit');
  if (cues.options) out.add('options');
  if (cues.exclusion.length) out.add('exclusion');
  if (cues.date) out.add('date');
  if (cues.supposition) out.add('supposition');
  if (cues.twoSided) out.add('twoSided');
  if (cues.second) out.add('second');
  if (cues.reason) out.add('reason');
  return out;
}

/** The span of a cue to show when the oracle and the cue disagree. */
export function cueSpan(cues, aspect) {
  switch (aspect) {
    case 'limit': return cues.limit.map(l => l.span).join('; ');
    case 'exclusion': return cues.exclusion.map(e => e.span).join('; ');
    default: return cues[aspect]?.span ?? null;
  }
}

/** The noun a wh-question asks for ("In which country …" → "country"), or null. */
export function answerNoun(message) {
  const m = /^\s*(?:(?:in|at|from|of|on|for|to|with)\s+)?(?:which|what|how many)\s+([\p{L}-]+)/iu.exec(String(message ?? ''));
  return m && !/^(?:is|are|was|were|do|does|did|has|have|had|can|could|will|would|kind|sort|type|the|a|an)$/i.test(m[1]) ? m[1].toLowerCase() : null;
}

/** The superlative of a question ("the highest", "the most", "the cheapest"): 'highest', 'lowest' or null. */
export function superlative(message) {
  const t = fold(message);
  if (/\b(?:how many|how much)\b/.test(t)) return null;
  if (/\b(?:highest|largest|biggest|greatest|oldest|longest|tallest|most|maximum|top|best|richest|heaviest|latest)\b/.test(t)) return 'highest';
  if (/\b(?:lowest|smallest|least|fewest|youngest|shortest|minimum|cheapest|earliest|worst|lightest)\b/.test(t)) return 'lowest';
  return null;
}

/**
 * The answer kinds compatible with an English interrogative's unambiguous grammatical cue (13-kind vocabulary), or null.
 * Only used to detect a conflict with the oracle's kind, never to choose the kind alone.
 */
export function cueKinds13(message) {
  const full = fold(message).trim();
  // A leading phrase before the question proper ("After 9 rule steps, is X eligible?") does not decide the kind.
  const after = /^[^,?]{1,60},\s*(.+)$/.exec(full)?.[1];
  const t = after && /^(?:is|are|was|were|does|do|did|can|could|may|might|has|have|had|will|would|should|must|who|whom|whose|which|what|where|when|why|how)\b/.test(after) && !/^(?:is|are|was|were|does|do|did|can|could|may|might|has|have|had|will|would|should|must|who|whom|whose|which|what|where|when|why|how)\b/.test(full) ? after : full;
  if (/\bhow (many|much)\b/.test(t)) return ['count', 'value'];
  if (/^(why|how come)\b/.test(t)) return ['why'];
  if (/^(since when|until when|how long|for how long)\b/.test(t)) return ['when'];
  if (/^when\b/.test(t)) return ['when', 'list', 'value'];
  if (/^(is|are|was|were|does|do|did|can|could|may|might|has|have|had|will|would|should|must)\b/.test(t)) return ['yesno', 'reach', 'puzzle', 'every', 'why'];
  if (/^(who|whom|whose|which|what|where|in which|in what|at which|among)\b/.test(t)) return ['list', 'value', 'highest', 'lowest', 'count'];
  return null;
}
