/**
 * The server status (DS009 "Server status"): what this server can run now, read by `GET /v1/status` and the chat page's Settings tab.
 *
 *   - formalization: the formalization strategies (CodingAgent, LocalLLMDirect, LocalLLMStepByStep, InternalReasoningStepByStep), each with whether it can run and
 *     why not, and for CodingAgent the model chain with the availability of every model in omp;
 *   - memories: the base memories with their size and whether the start-up warming decoded them (`server.warmMemories`);
 *   - reasoning: the StrategyRouter's engines and whether each one is installed (probed once per process, read only);
 *   - caches: the request parser's circuit cache.
 *
 * A request parser that implements several strategies exposes `strategies()` (`[{id, label, available, reason?, backend, ...}]`); this
 * module then reports exactly that list. Without it the request parser runs one strategy, the one of `queryParser.backend`
 * (`omp`: CodingAgent, `completion`: LocalLLMDirect), and the others are reported as not available on this server.
 * `strategyRequest` is the matching rule for a turn: a session's chosen strategy is passed to the request parser when it runs that
 * strategy and is otherwise refused with `parse_unavailable`; a strategy is never replaced by another one.
 */
import {ENGINES} from '../reasoning/router/engines.mjs';

export const FORMALIZATION_STRATEGIES = Object.freeze([
  {id: 'CodingAgent', label: 'CodingAgent (omp coding agent writes the circuit)'},
  {id: 'LocalLLMDirect', label: 'LocalLLMDirect (a local model writes the circuit in one step)'},
  {id: 'LocalLLMStepByStep', label: 'LocalLLMStepByStep (the symbolic system asks a small local model step by step)'},
  {id: 'InternalReasoningStepByStep', label: 'InternalReasoningStepByStep (the questioning protocol is a base memory; reasoning plans each question)'},
]);

/** The strategy the request parser runs when no strategy is asked for. */
export const defaultStrategy = queryParser => queryParser?.defaultStrategy ?? (queryParser?.settings?.backend?.kind === 'completion' ? 'LocalLLMDirect' : 'CodingAgent');

/** The formalization strategies with their availability now. */
export async function formalizationStrategies(queryParser, ompModels = null) {
  if (typeof queryParser?.strategies === 'function') return queryParser.strategies();
  const own = defaultStrategy(queryParser);
  const free = queryParser ? await queryParser.availability() : {available: false, reason: 'no request parser'};
  const listing = own === 'CodingAgent' && ompModels ? await ompModels.list().catch(() => null) : null;
  return FORMALIZATION_STRATEGIES.map(s => {
    if (s.id !== own) return {...s, available: false, reason: 'not configured in this server', backend: s.id === 'CodingAgent' ? 'omp' : 'llama-server'};
    const models = (queryParser.settings.models ?? []).map(id => {
      if (!listing) return {id};
      const ok = listing.available && listing.models.some(m => m.id === id);
      return {id, available: ok, ...(ok ? {} : {reason: listing.available ? 'omp cannot use this model' : listing.reason ?? 'omp is not available'})};
    });
    return {...s, available: free.available === true, ...(free.reason ? {reason: free.reason} : {}), backend: queryParser.settings.backend.kind,
      ...(queryParser.settings.backend.endpoint ? {endpoint: queryParser.settings.backend.endpoint} : {}), models};
  });
}

/** The extra arguments of `queryParser.parse` for a session's strategy; throws `parse_unavailable` (503) for a strategy this server cannot run. */
export function strategyRequest(queryParser, strategy) {
  if (!strategy) return {};
  if (typeof queryParser?.strategies === 'function') return {strategy};
  if (strategy === defaultStrategy(queryParser)) return {};
  throw Object.assign(new Error(`the formalization strategy ${strategy} is not available on this server; choose another one in Settings`),
    {code: 'parse_unavailable', status: 503, parse: {parser: 'coding_agent', strategy, model: null, ms: 0, failed: `strategy ${strategy} not available`}});
}

/** The status document of `GET /v1/status`. `warm` is the result of the start-up warming (server/warm-memories.mjs), or null. */
export async function serverStatus({queryParser, ompModels = null, memories = null, defaultBase = null, warm = null, startedAt, now = Date.now()}) {
  const strategies = await formalizationStrategies(queryParser, ompModels);
  const warmOf = id => warm?.find(w => w.id === id) ?? null;
  const memoryRows = memories ? memories.list().map(m => {
    const w = warmOf(m.id);
    return {id: m.id, name: m.name, strategy: m.strategy, circuits: m.circuits ?? null, facts: m.facts ?? null,
      warm: w ? (w.skipped ? {skipped: w.skipped} : {ms: w.ms, facts: w.facts, layers: w.layers}) : null};
  }) : [];
  const engines = Object.entries(ENGINES).map(([id, engine]) => {
    let available = false;
    try { available = Boolean(engine.available()); } catch { available = false; }
    return {id, routable: engine.routable, available};
  });
  const def = defaultStrategy(queryParser);
  return {
    object: 'status', ready: strategies.some(s => s.id === def && s.available), started_at: new Date(startedAt).toISOString(), uptime_s: Math.round((now - startedAt) / 1000),
    formalization: {default: def, strategies},
    memories: memoryRows, default_base: defaultBase,
    reasoning: {router: 'StrategyRouter v1', oracle: 'js-reference', engines},
    caches: queryParser ? {'query-parser': {entries: queryParser.stats().cache_size, hits: queryParser.stats().cache_hits, requests: queryParser.stats().requests}} : {},
  };
}
