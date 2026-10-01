/** How the reasoner may use pragmatic signals (DS029 "Use by the reasoner"). Signals are advisory: they regulate how the
 * host thinks and answers (depth, strategy, wording, confirmation) and never become facts about the world, evidence or
 * knowledge. The function is pure; the host applies the result.
 */
const COURTESY = new Set(['greeting', 'closing', 'thanks', 'apology', 'politeness']);
const NEGATIVE = new Set(['frustration', 'anger', 'disappointment']);

/**
 * @param signals pragmatic signals ({kind, score, span?}) or runtime packets of `pragmatic` wires
 * @param context `hasContent`: the message also states or asks something (default true)
 * @returns {{courtesyOnly, answerStyle, thinkingLevel, strategyHint, recheckInterpretation, offerClarification, requireConfirmation, confirmAnswerFirst, resetReferences, hedgedSpans, tone, notes}}
 */
export function adviceFor(signals, {hasContent = true, minScore = 0.5} = {}) {
  const live = signals.filter(s => s.score >= minScore);
  const kinds = new Set(live.map(s => s.kind));
  const has = k => kinds.has(k);
  const advice = {courtesyOnly: false, answerStyle: 'normal', thinkingLevel: 'normal', strategyHint: null, recheckInterpretation: false, offerClarification: false, requireConfirmation: false, confirmAnswerFirst: false, resetReferences: false, hedgedSpans: [], tone: 'neutral', notes: []};
  if (kinds.size && !hasContent && [...kinds].every(k => COURTESY.has(k))) {
    advice.courtesyOnly = true; advice.answerStyle = 'short'; advice.thinkingLevel = 'none';
    advice.notes.push('Courtesy only: a short courtesy reply, no computation.');
  }
  if (has('urgency')) { advice.answerStyle = 'short'; advice.thinkingLevel = 'low'; advice.strategyHint = 'fast'; advice.notes.push('Urgency: shorter answer and a faster strategy.'); }
  if ([...kinds].some(k => NEGATIVE.has(k))) { advice.recheckInterpretation = true; advice.thinkingLevel = advice.thinkingLevel === 'low' ? 'low' : 'high'; advice.tone = 'calm'; advice.notes.push('Frustration or anger: re-check the previous interpretation.'); }
  if (has('confusion')) { advice.recheckInterpretation = true; advice.offerClarification = true; advice.answerStyle = advice.answerStyle === 'short' ? 'short' : 'explained'; advice.notes.push('Confusion: re-check and offer a clarification.'); }
  if (has('hedge')) { advice.hedgedSpans = live.filter(s => s.kind === 'hedge' && s.span).map(s => s.span); advice.notes.push('Hedge: treat the hedged statement as a supposition (certainty hedged).'); }
  if (has('irony_possible')) { advice.requireConfirmation = true; advice.notes.push('Possible irony: do not act on the literal meaning without confirmation.'); }
  if (has('confirmation_request')) { advice.confirmAnswerFirst = true; advice.notes.push('Tag question: open the answer with the confirmation or its denial.'); }
  if (has('topic_shift')) { advice.resetReferences = true; advice.notes.push('Topic shift: do not resolve references against the previous topic.'); }
  if (has('fear') || has('sadness')) { advice.tone = 'supportive'; advice.notes.push('Fear or sadness: supportive tone, no extra detail.'); }
  if (has('profanity') || has('offensive')) { advice.tone = advice.tone === 'neutral' ? 'calm' : advice.tone; advice.notes.push('Profanity or offence: answer the content neutrally; never mirror it and never refuse because of it.'); }
  if (has('curiosity') && advice.answerStyle === 'normal') advice.answerStyle = 'explained';
  return advice;
}
