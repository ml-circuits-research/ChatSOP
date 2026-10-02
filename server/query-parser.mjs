/**
 * The request parser of a chat turn (DS009 "Request parser", DS014 "The circuit author"): the coding agent (omp, or any chat-completion
 * endpoint) turns the user's message into the model-surface SOP that the shared symbolic path (admission, KnowledgeLinker, slice
 * retrieval, StrategyRouter, oracle verification, completeness guard, rendering) executes.
 *
 * The coding agent reads the message and the vocabulary of the session's memory (lib/query-author) and writes circuits: a query, or a
 * labelled `unclear` verdict. It never answers and never adds a fact. There is no other parser and no fallback: when no model of the
 * subscription chain can run, the turn fails with the honest code `parse_unavailable` (503); a coding agent that ran but delivered no
 * valid circuit fails with `parse_failed` (422). Both errors carry the `parse` record for the trace.
 *
 * `queryParser.models` is the subscription chain (a list of model ids tried in order; a model omp cannot use is skipped, a run that does
 * not deliver moves on to the next one); without it the chain is `[backend.model]`. Whatever produced the circuit, the answer is executed
 * and checked symbolically, and the packet carries `parse: {parser: 'coding_agent', model, tried, rounds, cost_usd, ms, cache, ...}`.
 * Identical requests are cached per memory version, model and guide version.
 */
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {authorQuery, backendFrom} from '../lib/query-author/index.mjs';
import {authorExecution} from '../lib/query-author/execution-context.mjs';
import {buildContext} from '../lib/query-author/context.mjs';
import {checkStrategy, localStrategy, remoteDirectStrategy, localReadiness, LOCAL_STRATEGIES, DEFAULT_LOCAL, PARSER_NAMES} from '../lib/formalize/strategies.mjs';
import {FORMALIZATION_STRATEGIES as FORMALIZATION_STRATEGY_LABELS} from './status.mjs';
import {chainEntry, providerSettings, providerReadiness} from '../lib/llm-providers.mjs';

export const DEFAULT_QUERY_PARSER = Object.freeze({
  strategy: 'CodingAgent', mode: 'id', candidates: 24, indexMax: 300, backend: {kind: 'omp', model: 'openai-codex/gpt-6-luna'}, models: [], timeoutSeconds: 120, maxFixRounds: 2, maxConcurrent: 4, cacheEntries: 500, keepFolders: false,
  local: DEFAULT_LOCAL,
});

/**
 * The settings of the request parser: the defaults, `config.queryParser`, and the model chain (`models`, else the backend's model).
 * `strategy` names the formalization strategy (CodingAgent | LocalLLMDirect | LocalLLMStepByStep; environment CHATSOP_FORMALIZER
 * overrides it); `local` configures the managed local model of the two local strategies (lib/local-llm).
 */
export function queryParserSettings(config = {}, env = process.env) {
  const merged = {...DEFAULT_QUERY_PARSER, ...(config.queryParser ?? {})};
  merged.strategy = checkStrategy(env.CHATSOP_FORMALIZER || merged.strategy);
  merged.local = {...DEFAULT_LOCAL, ...(config.queryParser?.local ?? {})};
  merged.backend = {...DEFAULT_QUERY_PARSER.backend, ...(config.queryParser?.backend ?? {})};
  merged.providers = providerSettings(config);
  const chain = Array.isArray(merged.models) && merged.models.length ? merged.models : [merged.backend.model].filter(Boolean);
  merged.models = [...new Set(chain)];
  return merged;
}

/** The chain entry of the remote LocalLLMDirect, or null when it runs on the local model. */
export function remoteDirectEntry(settings) {
  const direct = settings.direct ?? {};
  const source = direct.source ?? 'auto';
  const hasLocal = Boolean(settings.local?.endpoint || settings.local?.gguf);
  if (source === 'local' || (source === 'auto' && hasLocal)) return null;
  return chainEntry({kind: 'completion', provider: direct.provider ?? 'openference', ...(direct.model ? {model: direct.model} : {})}, {providers: settings.providers});
}

const normalize = text => String(text).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

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
export function createQueryParser({settings = queryParserSettings(), ompConfig = {}, ompModels = null, chatData = null, runner = undefined, fetchImpl = undefined, backendFactory = null, localFactory = localStrategy, now = Date.now} = {}) {
  const cache = new Lru(settings.cacheEntries);
  // The strategy of a turn: the session's choice, else `settings.strategy`. The two local strategies share one managed llama-server
  // (started on first use, prewarmed, one dedicated slot each); CodingAgent runs the omp (or completion) backend chain below.
  const defaultStrategy = settings.strategy ?? 'CodingAgent';
  const locals = new Map();
  // LocalLLMDirect runs on a remote model (llmProviders, default the openference proxy) when `queryParser.direct.source` is 'remote', or 'auto' (the
  // default) with no local model configured; 'local' keeps the managed GGUF. LocalLLMStepByStep always uses the local model.
  const directEntry = remoteDirectEntry(settings);
  const localFor = name => {
    if (!locals.has(name)) locals.set(name, name === 'LocalLLMDirect' && directEntry ? remoteDirectStrategy(directEntry, {timeoutMs: settings.timeoutSeconds * 1000, ...(fetchImpl ? {fetchImpl} : {})}) : localFactory(name, settings.local, {timeoutMs: settings.timeoutSeconds * 1000, ...(fetchImpl ? {fetchImpl} : {})}));
    return locals.get(name);
  };
  let running = 0;
  const stats = {requests: 0, cache_hits: 0, coding_agent: 0, failures: 0, model_switches: 0};

  const backendFor = model => (backendFactory ?? (s => backendFrom(s, {
    timeoutMs: settings.timeoutSeconds * 1000, ...(s.kind === 'omp' ? {bin: ompConfig.bin ?? 'omp', thinking: ompConfig.thinking ?? null, ...(runner ? {runner} : {})} : {...(fetchImpl ? {fetchImpl} : {})}),
  })))({...settings.backend, ...(model ? {model} : {})});
  const readiness = new Map();
  /** Whether a provider endpoint answers (cached for 10 s, so a burst of turns probes once). */
  async function endpointReady(endpoint) {
    const hit = readiness.get(endpoint);
    if (hit && now() - hit.at < 10_000) return hit.state;
    const state = await providerReadiness(endpoint, {...(fetchImpl ? {fetchImpl} : {})});
    readiness.set(endpoint, {at: now(), state});
    return state;
  }

  /** Which models of the chain can run now, and why not for the others. */
  async function availability(preferredModel = null, strategy = defaultStrategy) {
    if (LOCAL_STRATEGIES.includes(strategy)) return localFor(strategy).availability();
    const chain = preferredModel ? [...new Set([preferredModel, ...settings.models])] : settings.models.length ? settings.models : [null];
    if (settings.backend.kind !== 'omp') return {available: true, models: chain, skipped: []};
    if (ompConfig.enabled === false) return {available: false, reason: 'the coding agent (omp) is disabled by the omp.enabled setting', models: [], skipped: []};
    if (!ompModels) return {available: true, models: chain, skipped: []};
    const listing = await ompModels.list();
    if (!listing.available) return {available: false, reason: `the coding agent (omp) is not available: ${listing.reason ?? 'no models'}`, models: [], skipped: []};
    const usable = chain.filter(model => !model || listing.models.some(m => m.id === model));
    const skipped = chain.filter(model => model && !usable.includes(model)).map(model => ({model, reason: `omp cannot use the model ${model}`}));
    if (!usable.length) return {available: false, reason: `omp cannot use any model of the chain (${chain.join(', ')})`, models: [], skipped};
    return {available: true, models: usable, skipped};
  }

  async function runModel({model, message, lexicon, onProgress, strategy = defaultStrategy}) {
    if (LOCAL_STRATEGIES.includes(strategy)) return localFor(strategy).run({message, lexicon, ...authorExecution.getStore(), maxFixRounds: settings.maxFixRounds, mode: settings.mode, k: settings.candidates, indexMax: settings.indexMax, vocabularyDialog: settings.vocabularyDialog !== false, maxVocabularyBytes: settings.maxVocabularyBytes ?? 24_000, onProgress});
    const folder = settings.backend.kind !== 'omp' ? null : chatData ? chatData.tmpFolder('qp') : fs.mkdtempSync(path.join(os.tmpdir(), 'chatsop-qp-'));
    try {
      return await authorQuery({message, lexicon, ...authorExecution.getStore(), backend: backendFor(model), folder, maxFixRounds: settings.maxFixRounds, mode: settings.mode, k: settings.candidates, indexMax: settings.indexMax, vocabularyDialog: settings.vocabularyDialog !== false, maxVocabularyBytes: settings.maxVocabularyBytes ?? 24_000, onProgress});
    } finally { if (folder && !settings.keepFolders) { try { fs.rmSync(folder, {recursive: true, force: true}); } catch { /* the cleanup policy removes it */ } } }
  }

  /** A gap of the memory (a clear question no predicate expresses): material for core-en growth through the approved authoring path. Gitignored (chat_data/). */
  function logGap(entry) {
    if (!chatData?.root) return;
    try { fs.appendFileSync(path.join(chatData.root, 'query-gaps.jsonl'), JSON.stringify({ts: new Date(now()).toISOString(), ...entry}) + '\n'); } catch { /* a log never fails a turn */ }
  }

  const fail = (code, status, message, parse) => Object.assign(new Error(message), {code, status, parse});
  const recordOf = (r, extra = {}) => ({parser: PARSER_NAMES[r.strategy] ?? 'coding_agent', strategy: r.strategy ?? (settings.backend.kind === 'omp' ? 'CodingAgent' : 'LocalLLMDirect'), ...(r.steps ? {steps: r.steps.length} : {}), model: r.model ?? null, backend: r.backend ?? settings.backend.kind, rounds: r.rounds ?? 0, cost_usd: r.usage?.cost_usd ?? r.cost_usd ?? 0, ms: r.ms ?? r.duration_ms ?? 0, cache: r.cache ?? 'miss',
    ...(r.unlinked?.length ? {unlinked: r.unlinked} : {}), ...(r.context_version ? {guide: r.context_version} : {}), ...(r.mode ? {mode: r.mode, retrieval: {predicates: r.retrieval?.predicates?.length ?? 0, entity_mentions: r.retrieval?.entities?.length ?? 0, neighbourhood: r.retrieval?.neighbourhood ?? null, bytes: r.retrieval?.bytes ?? 0, byte_budget: r.retrieval?.byte_budget ?? 0, truncated: r.retrieval?.truncated ?? false}} : {}), ...(r.vocabulary_dialog ? {vocabulary_dialog: r.vocabulary_dialog} : {}), ...(r.closest ? {closest: r.closest} : {}), ...(r.self_check ? {self_check: r.self_check} : {}), ...(r.repairs?.length ? {repairs: r.repairs} : {}), ...extra});

  /**
   * Parses one message. Returns `{sop, parse}`; throws `parse_unavailable` (no model of the chain can run or all delivered nothing) or
   * `parse_failed` (the models ran, no valid circuit came back), each with `error.parse`.
   */
  async function parse({message, lexicon, memoryKey, onProgress, preferredModel = null, strategy = null}) {
    stats.requests++;
    const started = now();
    strategy = checkStrategy(strategy ?? defaultStrategy);
    const local = LOCAL_STRATEGIES.includes(strategy);
    const free = await availability(local ? null : preferredModel, strategy);
    if (!free.available) { stats.failures++; throw fail('parse_unavailable', 503, free.reason, {parser: PARSER_NAMES[strategy], strategy, model: null, ms: now() - started, failed: free.reason}); }
    const tried = [...free.skipped];
    let last = null;
    // A model the session prefers is first in the chain when omp can use it (availability puts it there), then the configured models.
    for (const model of free.models) {
      const key = createHash('sha256').update([memoryKey ?? '', authorExecution.getStore()?.key ?? '', settings.runTag ?? '', buildContext({message, lexicon, mode: settings.mode, vocabulary: null}).version, String(settings.vocabularyDialog !== false), String(settings.maxVocabularyBytes ?? 24_000), String(authorExecution.getStore()?.selfCheck ?? false), settings.backend.kind, strategy, local ? (localFor(strategy).tag ?? `${settings.local.alias}@${settings.local.endpoint ?? settings.local.gguf}#${settings.local.method ?? 'A'}`) : '', model ?? '', settings.backend.endpoint ?? '', normalize(message)].join('\0')).digest('hex');
      const hit = cache.get(key);
      if (hit && (!hit.fragment || hit.contextKey === authorExecution.getStore()?.contextKey)) { stats.cache_hits++; stats.coding_agent++; return {sop: hit.sop, parse: recordOf({...hit.result, strategy, cache: 'hit', ms: now() - started, cost_usd: 0, usage: {cost_usd: 0}}, {tried: tried.map(t => t.model)})}; }
      if (running >= settings.maxConcurrent) { stats.failures++; throw fail('parse_unavailable', 503, 'the coding agent is busy', {parser: 'coding_agent', model, ms: now() - started, failed: 'the coding agent is busy', status: 'busy'}); }
      running++;
      let result;
      try { result = {...await runModel({model, message, lexicon, onProgress, strategy}), strategy}; } finally { running--; }
      last = result;
      if (result.ok) {
        cache.set(key, {sop: result.sop, result: {...result, usage: {cost_usd: 0}}, fragment: result.program?.wires.some(w => w.fields.fragment), contextKey: authorExecution.getStore()?.contextKey});
        if (result.unclear === 'relation_not_in_memory') logGap({message, memory: memoryKey, closest: result.closest, model: result.model});
        stats.coding_agent++;
        return {sop: result.sop, parse: recordOf({...result, ms: now() - started}, {tried: tried.map(t => t.model), ...(tried.length ? {tried_reasons: tried.map(t => ({model: t.model, reason: t.reason}))} : {}), ...(result.unclear ? {unclear: result.unclear} : {})})};
      }
      tried.push({model, reason: result.reason ?? `invalid circuit: ${(result.validation?.problems ?? []).map(p => p.code).join(', ') || 'no output'}`, status: result.status});
      // A model that ran but wrote an invalid circuit after every repair round is a final answer about this message; a run that delivered nothing moves on to the next model.
      if (result.status !== 'failed') break;
      stats.model_switches++;
    }
    stats.failures++;
    const reason = last?.reason ?? `the coding agent's circuit was invalid: ${(last?.validation?.problems ?? []).map(p => p.code).join(', ') || 'no output'}`;
    const record = recordOf({strategy, ...(last ?? {}), ms: now() - started}, {failed: reason, tried: tried.map(t => ({model: t.model, reason: t.reason}))});
    if (last && last.status === 'failed') throw fail('parse_unavailable', 503, reason, record);
    throw fail('parse_failed', 422, reason, record);
  }

  /**
   * The formalization strategies of this parser with their availability (server/status.mjs). A local strategy is reported available
   * when its model file and llama-server exist (or its external endpoint answers); its server starts on the first turn that uses it.
   */
  async function strategies() {
    const coding = await availability(null, 'CodingAgent');
    const localState = await localReadiness(settings.local, fetchImpl);
    const direct = directEntry ? {...(await endpointReady(directEntry.endpoint)), backend: 'completion', model: directEntry.id, endpoint: directEntry.endpoint} : null;
    return FORMALIZATION_STRATEGY_LABELS.map(s => s.id === 'CodingAgent'
      ? {...s, available: coding.available === true, ...(coding.reason ? {reason: coding.reason} : {}), backend: settings.backend.kind, models: settings.models.map(id => ({id}))}
      : s.id === 'LocalLLMDirect' && direct ? {...s, ...direct}
      : {...s, ...localState, backend: 'llama-server', model: settings.local.alias, ...(settings.local.endpoint ? {endpoint: settings.local.endpoint} : {gguf: settings.local.gguf})});
  }

  /** Stops the managed local model server this parser started (chat server shutdown). */
  const stop = async () => { for (const l of locals.values()) await l.server.stop(); };
  return {parse, availability, strategies, defaultStrategy, stop, stats: () => ({...stats, cache_size: cache.size, running}), settings, clearCache: () => cache.map.clear()};
}
