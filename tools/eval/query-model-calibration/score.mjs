/**
 * Executed scoring: the circuit a model wrote is run through the product path (Agent turn: admission, KnowledgeLinker, slice, router) on
 * world-v1; the answer is compared with the gold. Outcomes: correct, wrong (a definite different answer), unknown (the path gave no
 * definite answer: incomplete, clarification, unlinked), unclear (the model itself answered `unclear`), invalid (no valid circuit
 * after the repair rounds), failed (the backend did not deliver).
 */
const norm = v => (typeof v === 'number' ? v : String(v).toLowerCase());
const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));

export function answerOf(packet) {
  if (!packet) return {definite: false, value: null, why: 'no packet'};
  const definite = ['supported', 'refuted'].includes(packet.status) && packet.complete !== false;
  if (packet.kind === 'count' || packet.query?.mode === 'count') return {definite, value: packet.count ?? null, type: 'count', status: packet.status};
  if (packet.kind === 'exists' || packet.query?.mode === 'exists' || !(packet.answers?.length)) {
    if (packet.status === 'supported' && !(packet.answers?.length)) return {definite, value: true, type: 'bool', status: packet.status};
    if (packet.status === 'refuted') return {definite, value: false, type: 'bool', status: packet.status};
  }
  return {definite, value: (packet.answers ?? []).map(a => Object.values(a.binding ?? a)[0]).map(norm), type: 'set', status: packet.status};
}

export function compare(answer, gold, mode = 'equal') {
  if (typeof gold === 'boolean') return answer.value === gold;
  if (typeof gold === 'number') return answer.type === 'count' ? answer.value === gold : Array.isArray(answer.value) && answer.value.map(String).includes(String(gold));
  const g = gold.map(norm);
  if (!Array.isArray(answer.value)) return false;
  return mode === 'any' ? answer.value.length > 0 && g.some(x => answer.value.includes(x)) : sameSet(answer.value, g);
}

export function classify({author, packet, row}) {
  if (author.status === 'failed') return {outcome: 'failed', reason: author.reason};
  if (author.status !== 'validated') return {outcome: 'invalid', reason: author.validation?.problems?.[0]?.message ?? 'invalid'};
  if (author.unclear) return {outcome: 'unclear', reason: author.unclear};
  const answer = answerOf(packet);
  if (!answer.definite) return {outcome: 'unknown', answer, reason: packet?.status ?? 'no packet'};
  return {outcome: compare(answer, row.gold, row.gold_mode) ? 'correct' : 'wrong', answer};
}
