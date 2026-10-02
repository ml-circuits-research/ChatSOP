/**
 * Rendering of the `pragmatic` wires of a turn (DS023 "Chat turn"): deterministic English templates keyed by the closed kinds of
 * sop/enums.mjs PRAGMATIC_KINDS. The formalizer decides which kinds a message has (understanding); this module only renders the
 * result packet: the reply to a message without a request, and the tone of an answer. The output edge (server/answer-language.mjs)
 * phrases the final text in the language of the message, like every other answer.
 *
 *   pragmaticOf(wire)                 -> {id, kind, score, span, near, source, basis}
 *   courtesyReply(kinds)              -> the reply to a message that is only courtesy or emotion
 *   toneAnswer(text, kinds, status)   -> {text, applied}
 */
import {one, unquote} from './parser.mjs';
import {PRAGMATIC_KINDS} from './enums.mjs';

const COURTESY = ['greeting', 'thanks', 'apology', 'closing', 'politeness'];
/** The order in which an emotion decides the reply when there is no courtesy. */
const EMOTION = ['confusion', 'frustration', 'anger', 'disappointment', 'sadness', 'fear', 'urgency', 'joy', 'curiosity'];

const REPLY = {
  greeting: 'Hello! What would you like to know?',
  thanks: "You're welcome.",
  closing: 'Goodbye!',
  apology: 'No problem.',
  politeness: 'How can I help?',
  confusion: 'Sorry for the confusion. Tell me which part is unclear, or ask a question, and I will explain it.',
  frustration: 'I am sorry about the trouble. Tell me what you need and I will go through it step by step.',
  anger: 'I am sorry about the trouble. Tell me what you need and I will go through it step by step.',
  disappointment: 'I am sorry about the trouble. Tell me what you need and I will go through it step by step.',
  sadness: 'I am sorry to hear that. Ask me anything whenever you are ready.',
  fear: 'I am sorry to hear that. Ask me anything whenever you are ready.',
  joy: 'Glad to hear it! What would you like to know?',
  urgency: 'I am here. What do you need?',
  curiosity: 'What would you like to know?',
  none: 'What would you like to know?',
};
const OPENING = {greeting: 'Hello!', thanks: 'Happy to help.', apology: 'No problem.', politeness: 'Of course.'};
const SORRY = new Set(['frustration', 'anger', 'disappointment']);

/** The packet form of one `pragmatic` wire. */
export function pragmaticOf(wire) {
  const kind = one(wire, 'kind');
  if (!PRAGMATIC_KINDS.includes(kind)) throw new Error('unknown pragmatic kind ' + kind);
  return {id: wire.id, kind, score: Number(one(wire, 'score', '1')), span: wire.fields.span ? unquote(one(wire, 'span')) : null,
    near: wire.fields.near ? one(wire, 'near').slice(1) : null, source: one(wire, 'source', null), basis: one(wire, 'basis')};
}

const kindsOf = signals => new Set(signals.filter(s => (s.score ?? 1) >= 0.5).map(s => s.kind ?? s));

/** The reply to a message without a request: courtesy first (at most two kinds, in message-act order), else the first emotion, else an invitation. */
export function courtesyReply(signals = []) {
  const kinds = kindsOf(signals);
  const courtesy = COURTESY.filter(k => kinds.has(k)).slice(0, 2);
  const keys = courtesy.length ? courtesy : [EMOTION.find(k => kinds.has(k)) ?? 'none'];
  return keys.map(k => REPLY[k]).join(' ');
}

/** The answer text with the courtesy phrase and tone the signals ask for. A clarification or an `unclear` answer is returned unchanged. */
export function toneAnswer(text, signals = [], status = null) {
  if (!text || ['unclear', 'clarify', 'courtesy'].includes(status)) return {text, applied: []};
  const kinds = kindsOf(signals), applied = [];
  let body = text;
  if (kinds.has('urgency') && body.includes('\n')) { body = body.split('\n')[0]; applied.push('shortened'); }
  const before = [], after = [];
  const opening = ['greeting', 'thanks', 'apology', 'politeness'].find(k => kinds.has(k));
  if (opening) { before.push(OPENING[opening]); applied.push('courtesy:' + opening); }
  if ([...kinds].some(k => SORRY.has(k))) { before.push('Sorry for the trouble.'); applied.push('apology'); }
  else if (kinds.has('sadness') || kinds.has('fear')) { before.push('I am sorry to hear that.'); applied.push('support'); }
  if (kinds.has('confusion')) { after.push('If something is still unclear, tell me which part and I will explain it differently.'); applied.push('clarification'); }
  if (kinds.has('closing')) { after.push('Goodbye!'); applied.push('courtesy:closing'); }
  return {text: [...before, body, ...after].join(' ').replace(/ \n/g, '\n').replace(/\n /g, '\n'), applied};
}
