/**
 * The request parsers of a chat turn (DS031 "Request parsers"): two ways to turn the user's English message into the model-surface SOP that
 * the shared symbolic path (admission, KnowledgeLinker, slice retrieval, StrategyRouter, oracle verification, completeness guard,
 * rendering) executes.
 *
 *   localQuery        SymbolicLM (Stanza analysis + the UD-to-SOP rules) and the KnowledgeLinker, the path of the product so far;
 *   codingAgentQuery  a coding agent (lib/query-author: omp with the fence of lib/omp, or any chat-completion endpoint) that reads the message
 *                     and the vocabulary of the session's memory and writes `query.sop`; it never answers and never adds a fact.
 *
 * `parser` is `coding_agent` (the default) or `local`: a request field, else the session setting, else `queryParser.default` of
 * config/runtime.json. Whatever produced the circuit, the answer is executed and checked symbolically, and the packet carries
 * `parse: {parser, model, rounds, cost_usd, ms, fallback, ...}`. A failing coding agent (omp missing, timeout, invalid output, a
 * message that is not a query) falls back to localQuery and says so; a localQuery that abstains (`unclear`) or fails is retried with
 * the coding agent when the default is local. Identical requests are cached per memory version, model and guide version.
 */
import {createHash} from 'node:crypto';
import {parse as parseSop} from '../sop/parser.mjs';
import {authorQuery, backendFrom} from '../lib/query-author/index.mjs';

export const PARSERS = Object.freeze(['coding_agent', 'local']);
export const DEFAULT_QUERY_PARSER = Object.freeze({
  default: 'coding_agent', backend: {kind: 'omp', model: 'openai-codex/gpt-6-luna'}, timeoutSeconds: 120, maxFixRounds: 2, maxConcurrent: 4, cacheEntries: 500, fallbackOnLocalAbstain: true, keepFolders: false,
});

export function queryParserSettings(config = {}) {
  const merged = {...DEFAULT_QUERY_PARSER, ...(config.queryParser ?? {})};
  merged.backend = {...DEFAULT_QUERY_PARSER.backend, ...(config.queryParser?.backend ?? {})};
  if (!PARSERS.includes(merged.default)) throw Error(`queryParser.default must be one of ${PARSERS.join(', ')}`);
  return merged;
}

const bad = (message, code = 'invalid_parameter', status = 400) => Object.assign(new Error(message), {status, code});
export function checkParser(value, where = 'parser') {
  if (value !== undefined && value !== null && !PARSERS.includes(value)) throw bad(`${where} must be one of ${PARSERS.join(', ')}`);
  return value ?? null;
}

const normalize = text => String(text).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
const abstains = sop => { try { const wires = parseSop(sop).wires; return wires.length === 1 && wires[0].type === 'unclear'; } catch { return false; } };

class Lru {
  constructor(max) { this.max = max; this.map = new Map(); }
  get(key) { if (!this.map.has(key)) return undefined; const value = this.map.get(key); this.map.delete(key); this.map.set(key, value); return value; }
  set(key, value) { if (this.max <= 0) return; this.map.delete(key); this.map.set(key, value); while (this.map.size > this.max) this.map.delete(this.map.keys().next().value); }
  get size() { return this.map.size; }
}

/**
 * `ompModels`: the OmpModels of lib/omp (availability and the model list), `ompConfig`: ompSettings(config), `chatData`: for the request folders,
 * `backendFactory(settings)` builds the backend (tests inject a stub or a stub omp runner).
 */
export function createQueryParser({settings = DEFAULT_QUERY_PARSER, ompConfig = {}, ompModels = null, chatData = null, runner = undefined, fetchImpl = undefined, backendFactory = null, now = Date.now} = {}) {
  const cache = new Lru(settings.cacheEntries);
  let running = 0;
  const stats = {requests: 0, cache_hits: 0, coding_agent: 0, local: 0, fallbacks: 0};

  const backend = () => (backendFactory ?? (s => backendFrom(s, {
    timeoutMs: settings.timeoutSeconds * 1000, ...(s.kind === 'omp' ? {bin: ompConfig.bin ?? 'omp', thinking: ompConfig.thinking ?? null, ...(runner ? {runner} : {})} : {...(fetchImpl ? {fetchImpl} : {})}),
  })))({...settings.backend});

  /** Whether the coding agent can run now; `reason` otherwise. */
  async function availability() {
    if (settings.backend.kind !== 'omp') return {available: true};
    if (ompConfig.enabled === false) return {available: false, reason: 'the coding agent (omp) is disabled by the omp.enabled setting'};
    if (!ompModels) return {available: true};
    const listing = await ompModels.list();
    if (!listing.available) return {available: false, reason: `the coding agent (omp) is not available: ${listing.reason ?? 'no models'}`};
    if (settings.backend.model && !listing.models.some(m => m.id === settings.backend.model)) return {available: false, reason: `omp cannot use the model ${settings.backend.model}`};
    return {available: true};
  }

  async function runAgent({message, lexicon, memoryKey, onProgress}) {
    const started = now();
    const key = createHash('sha256').update([memoryKey ?? '', settings.backend.kind, settings.backend.model ?? '', settings.backend.endpoint ?? '', normalize(message)].join('\0')).digest('hex');
    const hit = cache.get(key);
    if (hit) { stats.cache_hits++; return {...hit, cache: 'hit', ms: now() - started, cost_usd: 0}; }
    const free = await availability();
    if (!free.available) return {ok: false, reason: free.reason, status: 'unavailable', cache: 'miss', ms: now() - started};
    if (running >= settings.maxConcurrent) return {ok: false, reason: 'the coding agent is busy', status: 'busy', cache: 'miss', ms: now() - started};
    running++;
    let result;
    try {
      const folder = chatData ? chatData.tmpFolder('qp') : null;
      result = await authorQuery({message, lexicon, backend: backend(), folder, maxFixRounds: settings.maxFixRounds, onProgress});
      if (folder && !settings.keepFolders) { try { (await import('node:fs')).rmSync(folder, {recursive: true, force: true}); } catch { /* the cleanup policy removes it */ } }
    } finally { running--; }
    const out = {ok: result.ok, status: result.status, sop: result.sop, reason: result.reason ?? (result.ok ? null : `the coding agent's query was invalid: ${(result.validation?.problems ?? []).map(p => p.code).join(', ') || 'no output'}`),
      unclear: result.unclear, rounds: result.rounds, cost_usd: result.usage.cost_usd, usage: result.usage, model: result.model, backend: result.backend, unlinked: result.unlinked, context_version: result.context_version, cache: 'miss', ms: now() - started};
    if (result.ok) cache.set(key, out);
    return out;
  }

  const record = (parser, extra) => ({parser, ...extra});

  /**
   * Parses one message. `local: async () => sop` is the localQuery path (it sets its own side effects, for example the understanding of the
   * turn). Returns {sop, parse}; throws only when no parser produced anything (the local error is rethrown).
   */
  async function parse({parser, message, lexicon, memoryKey, local, onProgress}) {
    stats.requests++;
    const choice = checkParser(parser) ?? settings.default;
    const model = settings.backend.model ?? null;
    const agentFields = r => ({model: r.model ?? model, backend: r.backend ?? settings.backend.kind, rounds: r.rounds ?? 0, cost_usd: r.cost_usd ?? 0, ms: r.ms ?? 0, cache: r.cache ?? 'miss', ...(r.unlinked?.length ? {unlinked: r.unlinked} : {}), ...(r.context_version ? {guide: r.context_version} : {})});
    const viaLocal = async (fallback, requested) => {
      const t = now();
      const sop = await local();
      stats.local++;
      return {sop, parse: record('local', {requested, model: 'symbolic-lm', rounds: 0, cost_usd: 0, ms: now() - t, fallback})};
    };
    if (choice === 'coding_agent') {
      const r = await runAgent({message, lexicon, memoryKey, onProgress});
      if (r.ok && r.unclear !== 'no_request') {
        stats.coding_agent++;
        return {sop: r.sop, parse: record('coding_agent', {requested: choice, ...agentFields(r), fallback: null})};
      }
      stats.fallbacks++;
      const reason = r.ok ? 'not_a_query: the coding agent found no request in the message' : r.reason;
      const out = await viaLocal({to: 'local', from: 'coding_agent', reason, status: r.status ?? 'invalid'}, choice);
      out.parse.agent = {...agentFields(r), status: r.status};
      return out;
    }
    // localQuery is the choice. A local failure or an abstention is retried with the coding agent (the verified LLM proposal).
    let sop = null, failure = null;
    const t0 = now();
    try { sop = await local(); stats.local++; } catch (error) { failure = error; }
    const localMs = now() - t0;
    if (sop !== null && !abstains(sop)) return {sop, parse: record('local', {requested: choice, model: 'symbolic-lm', rounds: 0, cost_usd: 0, ms: localMs, fallback: null})};
    if (settings.fallbackOnLocalAbstain) {
      const r = await runAgent({message, lexicon, memoryKey, onProgress});
      if (r.ok && r.unclear !== 'no_request') {
        stats.coding_agent++; stats.fallbacks++;
        return {sop: r.sop, parse: record('coding_agent', {requested: choice, ...agentFields(r), fallback: {to: 'coding_agent', from: 'local', reason: failure ? `localQuery failed: ${String(failure.message).slice(0, 200)}` : 'localQuery abstained (unclear)'}})};
      }
    }
    if (failure) throw failure;
    return {sop, parse: record('local', {requested: choice, model: 'symbolic-lm', rounds: 0, cost_usd: 0, ms: localMs, fallback: null, abstained: true})};
  }

  return {parse, availability, stats: () => ({...stats, cache_size: cache.size, running}), settings, clearCache: () => cache.map.clear()};
}
