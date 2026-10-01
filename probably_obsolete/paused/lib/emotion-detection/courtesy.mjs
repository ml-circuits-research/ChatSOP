/** Deterministic courtesy replies for a message that only greets, thanks, apologizes or closes (DS029 "Use by the
 * reasoner": no computation, a short courtesy reply). Host text, never model output. */
/** English only: the output edge translates the final answer (DS021 "English-only core"). */
const REPLIES = {greeting: 'Hello! What would you like to know?', thanks: "You're welcome.", closing: 'Goodbye!', apology: 'No problem.', politeness: 'How can I help?'};
const ORDER = ['closing', 'thanks', 'apology', 'greeting', 'politeness'];

/** The courtesy reply for the kinds of the signals, in English. */
export function courtesyReply(signals) {
  const table = REPLIES;
  const kinds = new Set(signals.map(s => s.kind));
  const parts = ORDER.filter(k => kinds.has(k)).slice(0, 2);
  // A greeting together with thanks answers the thanks first; politeness alone invites the question.
  return (parts.length ? parts : ['politeness']).map(k => table[k]).join(' ');
}
