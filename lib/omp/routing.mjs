/**
 * Routing of a chat message (DS031 "Routing"): SymbolicLM and the small formalizer, or the coding agent (omp) that writes SOP circuits.
 *
 * `decideRoute` is pure. It reads the caller's choices and the signals of what SymbolicLM already did, and answers the path with
 * its reason, so the "I understood" panel can show both:
 *
 *   1. attached files or indications            -> authoring, `attached_files`
 *   2. the setting `authoring: always`          -> authoring, `setting_always` (when omp is configured)
 *   3. the setting `authoring: off`             -> symbolic,  `setting_off`
 *   4. the scope detector says
 *      `needs_knowledge_authoring`              -> authoring, `scope_needs_knowledge_authoring`
 *   5. a detected SymbolicLM failure            -> authoring, `symbolic_failure`:
 *        a failed sentence, uncertain sentences at or above `uncertainRatio` of the sentences, at least `minNotRepresented`
 *        spans the interpretation does not represent, a clarify result (`clarifyTriggers`), or an unavailable analysis
 *   6. otherwise                                -> symbolic,  `default`
 *
 * When omp is wanted (rules 1, 2, 4, 5) but unavailable, the answer is the symbolic path with a `fallback` that says why: a total
 * failure never happens. Rule 3 is the user's explicit choice and also wins over rules 4 and 5, but never over attached files
 * (nothing else can read them).
 */
export const DEFAULT_DETECTOR = Object.freeze({uncertainRatio: 0.5, minNotRepresented: 1, clarifyTriggers: true});

/** The signals of a `POST /v1/understand` answer (DS030). */
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

export function decideRoute({filesAttached = 0, authoring = 'auto', omp = {available: false}, understanding = null, scope = null, detector = DEFAULT_DETECTOR}) {
  const signals = symbolicSignals(understanding);
  const scopeInfo = scope ? {label: scope.label, wires: (scope.wires ?? []).map(w => w.wire)} : null;
  let wanted = null;
  if (filesAttached > 0) wanted = {trigger: 'attached_files', text: `${filesAttached} file(s) attached: only the coding agent can read them`};
  else if (authoring === 'always') wanted = {trigger: 'setting_always', text: 'the setting "Always use the coding agent" is on'};
  else if (authoring === 'off') return result('symbolic', {trigger: 'setting_off', text: 'the coding agent is switched off in the settings'});
  else if (scope?.label === 'needs_knowledge_authoring') wanted = {trigger: 'scope_needs_knowledge_authoring', text: `the message states knowledge SymbolicLM cannot write (${scopeInfo.wires.join(', ')})`};
  else {
    const failure = symbolicFailure(signals, detector);
    if (failure) wanted = {trigger: 'symbolic_failure', text: `SymbolicLM did not cope: ${failure}`};
  }
  if (!wanted) return result('symbolic', {trigger: 'default', text: 'SymbolicLM understood the message'});
  if (!omp.available) return result('symbolic', {trigger: wanted.trigger, text: wanted.text}, {from: 'authoring', to: 'symbolic', reason: omp.reason ?? 'the coding agent (omp) is not available'});
  return result('authoring', wanted);

  function result(path, reason, fallback = null) {
    return {path, reason, fallback, signals, scope: scopeInfo, settings: {authoring}, omp: {available: Boolean(omp.available), ...(omp.model ? {model: omp.model, cost_class: omp.cost_class} : {}), ...(omp.reason ? {reason: omp.reason} : {})}};
  }
}
