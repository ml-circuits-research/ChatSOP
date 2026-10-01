/** Deterministic courtesy replies for a message that only greets, thanks, apologizes or closes (DS029 "Use by the
 * reasoner": no computation, a short courtesy reply). Host text, never model output. */
const REPLIES = {
  en: {greeting: 'Hello! What would you like to know?', thanks: "You're welcome.", closing: 'Goodbye!', apology: 'No problem.', politeness: 'How can I help?'},
  ro: {greeting: 'Bună! Ce ați dori să aflați?', thanks: 'Cu plăcere.', closing: 'La revedere!', apology: 'Nicio problemă.', politeness: 'Cu ce vă pot ajuta?'},
};
const ORDER = ['closing', 'thanks', 'apology', 'greeting', 'politeness'];

/** The courtesy reply for the kinds of the signals, in `language` ('ro' or English). */
export function courtesyReply(signals, language = 'en') {
  const table = REPLIES[language] ?? REPLIES.en;
  const kinds = new Set(signals.map(s => s.kind));
  const parts = ORDER.filter(k => kinds.has(k)).slice(0, 2);
  // A greeting together with thanks answers the thanks first; politeness alone invites the question.
  return (parts.length ? parts : ['politeness']).map(k => table[k]).join(' ');
}
