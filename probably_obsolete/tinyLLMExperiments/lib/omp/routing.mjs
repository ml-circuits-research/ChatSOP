/**
 * Routing of a chat message (DS022 "Routing"): SymbolicLM and the small formalizer, or the coding agent (omp) that writes SOP circuits.
 *
 * `decideRoute` is pure. It reads the caller's choices and the signals of what SymbolicLM already did, and answers the path with
 * its reason, so the "I understood" panel can show both. Only an explicit act of the user sends a message to the coding agent
 * (owner decision of 2026-10-01); a detection only SUGGESTS it:
 *
 *   1. attached files (the user's own act)      -> authoring, `attached_files`
 *   2. the setting `authoring: always`          -> authoring, `setting_always`
 *   3. a detection (the default setting is `authoring: off`: the coding agent runs only on the user's act) -> symbolic WITH a `suggestion`: the scope detector (lib/symbolic-lm/scope-detect.mjs)
 *      says `needs_knowledge_authoring` (wire types with a confidence, the cue quoted), or a SymbolicLM failure is detected (a failed
 *      sentence, uncertain sentences at or above `uncertainRatio`, at least `minNotRepresented` spans not represented, a clarify
 *      result, an unavailable analysis). `scopeNote: ask` (default) makes the page ask the user "send it to the coding agent?";
 *      `mark` only marks the sentence, `none` shows nothing. A wire type the user declined in this session is not suggested again.
 *   4. otherwise                                -> symbolic,  `default`
 *
 * When omp is wanted (rules 1 and 2) but unavailable, the answer is the symbolic path with a `fallback` that says why: a total
 * failure never happens. A suggestion is still shown when omp is unavailable, without the question. Clicking yes on the note is the
 * user's act: the page then calls `POST /v1/author`.
 */
export const DEFAULT_DETECTOR = Object.freeze({uncertainRatio: 0.5, minNotRepresented: 1, clarifyTriggers: true});

/** The signals of a `POST /v1/understand` answer (DSx030). */
export function symbolicSignals(understanding) {
  if (!understanding || typeof understanding !== 'object') return null;
  const sentences = understanding.interpretation?.sentences ?? [];
  const items = understanding.clarify_items ?? [];
  const count = status => sentences.filter(s => s.status === status).length;
  return {
    status: understanding.status ?? null,
    total_sentences: sentences.length,
    failed_sentences: count('failed'),
    uncertain_sentences: count('uncertain'),
    not_represented: items.filter(i => i.kind === 'not_represented').length,
    clarify: Boolean(understanding.clarify),
    unavailable: understanding.status === 'unavailable',
  };
}

export function symbolicFailure(signals, detector = DEFAULT_DETECTOR) {
  if (!signals) return null;
  const d = {...DEFAULT_DETECTOR, ...detector};
  const reasons = [];
  if (signals.unavailable) reasons.push('SymbolicLM could not analyse the message');
  if (signals.failed_sentences > 0) reasons.push(`${signals.failed_sentences} sentence(s) failed`);
  if (signals.total_sentences > 0 && signals.uncertain_sentences / signals.total_sentences >= d.uncertainRatio && signals.uncertain_sentences > 0) reasons.push(`${signals.uncertain_sentences} of ${signals.total_sentences} sentence(s) uncertain`);
  if (signals.not_represented >= d.minNotRepresented && signals.not_represented > 0) reasons.push(`${signals.not_represented} span(s) not represented`);
  if (d.clarifyTriggers && signals.clarify && !reasons.length) reasons.push('SymbolicLM asks for a clarification');
  return reasons.length ? reasons.join('; ') : null;
}

/** Wire types the detector measured as reliable (precision 86 to 100%); the others are offered as "may need". */
export const RELIABLE_WIRES = Object.freeze(['norm', 'method', 'definition', 'amendment', 'sourced', 'closed', 'integrity']);

/** The scope suggestion of a `detectAnalysis` result: the sentences that need authoring, with wires, confidence and the quoted cues. */
export function scopeSuggestion(scope, declined = []) {
  if (scope?.label !== 'needs_knowledge_authoring') return null;
  const skip = new Set(declined);
  const sentences = [];
  for (const s of scope.sentences ?? []) {
    const wires = (s.wires ?? []).filter(w => !skip.has(w.wire));
    if (!wires.length) continue;
    const used = new Set(wires.flatMap(w => w.cues ?? []));
    sentences.push({text: s.text, wires: wires.map(w => ({wire: w.wire, score: w.score, confidence: RELIABLE_WIRES.includes(w.wire) ? 'reliable' : 'may_need', targets: w.targets})),
      cues: (s.cues ?? []).filter(c => used.has(c.id)).map(c => ({wire: c.wire, type: c.type, text: c.text}))});
  }
  const messageWires = (scope.wires ?? []).filter(w => !skip.has(w.wire) && !sentences.length);
  if (!sentences.length && !messageWires.length) return null;
  const wires = [...new Set(sentences.flatMap(s => s.wires.map(w => w.wire)).concat(messageWires.map(w => w.wire)))];
  return {sentences, wires, message_wires: messageWires.map(w => ({wire: w.wire, score: w.score, note: w.note ?? null}))};
}

export function decideRoute({filesAttached = 0, authoring = 'off', scopeNote = 'ask', declined = [], omp = {available: false}, understanding = null, scope = null, detector = DEFAULT_DETECTOR}) {
  const signals = symbolicSignals(understanding);
  const scopeInfo = scope ? {label: scope.label, wires: (scope.wires ?? []).map(w => w.wire)} : null;
  let wanted = null;
  if (filesAttached > 0) wanted = {trigger: 'attached_files', text: `${filesAttached} file(s) attached: only the coding agent can read them`};
  else if (authoring === 'always') wanted = {trigger: 'setting_always', text: 'the setting "Always use the coding agent" is on'};
  if (wanted) {
    if (!omp.available) return result('symbolic', wanted, {from: 'authoring', to: 'symbolic', reason: omp.reason ?? 'the coding agent (omp) is not available'});
    return result('authoring', wanted);
  }
  // Detections only suggest. The page asks the user (scopeNote ask), marks the sentence (mark) or shows nothing (none); nothing is sent without a yes.
  if (scopeNote === 'none') return result('symbolic', {trigger: 'default', text: 'SymbolicLM answers; suggestions are switched off'});
  const suggestionScope = scopeSuggestion(scope, declined);
  const failure = symbolicFailure(signals, detector);
  let suggestion = null;
  if (suggestionScope) suggestion = {trigger: 'scope_needs_knowledge_authoring', text: `the message states knowledge SymbolicLM cannot write (${suggestionScope.wires.join(', ')})`, scope: suggestionScope};
  else if (failure) suggestion = {trigger: 'symbolic_failure', text: `SymbolicLM did not cope: ${failure}`, scope: null};
  if (!suggestion) return result('symbolic', {trigger: 'default', text: 'SymbolicLM understood the message'});
  const ask = scopeNote === 'ask' && Boolean(omp.available);
  return {...result('symbolic', {trigger: 'default', text: 'SymbolicLM answers; a detection suggests the coding agent'}), suggestion: {...suggestion, mode: ask ? 'ask' : 'mark', omp_available: Boolean(omp.available), ...(omp.available ? {} : {unavailable: omp.reason ?? 'the coding agent (omp) is not available'})}, ask};

  function result(path, reason, fallback = null) {
    return {path, reason, fallback, suggestion: null, ask: false, signals, scope: scopeInfo, settings: {authoring, scope_note: scopeNote}, omp: {available: Boolean(omp.available), ...(omp.model ? {model: omp.model, cost_class: omp.cost_class} : {}), ...(omp.reason ? {reason: omp.reason} : {})}};
  }
}
