/**
 * The request parser of a chat turn (DS009 "Request parser", DS014 "The circuit author"): a model turns the user's message into the
 * model-surface SOP that the shared symbolic path (admission, KnowledgeLinker, slice retrieval, StrategyRouter, oracle verification,
 * completeness guard, rendering) executes.
 *
 * Owner decision 2026-10-02: every formalization calls its model directly (a chat-completion request through the proxy LLMAPIProvider);
 * none runs through omp. The default strategy LLMDirect reads the message and the vocabulary of the session's memory (lib/query-author)
 * and writes circuits: a query, or a labelled `unclear` verdict. It never answers and never adds a fact. The validator's problems go
 * back to the model for at most `maxFixRounds` rounds. There is no other parser and no fallback parser: when no model of the chain can
 * run, the turn fails with the honest code `parse_unavailable` (503); a model that ran but delivered no valid circuit fails with
 * `parse_failed` (422). Both errors carry the `parse` record for the trace.
 *
 * `queryParser.models` is the model chain (`<provider>/<model>` entries of `llmProviders`, tried in order: openference Qwen3.8 27b, then
 * DeepSeek flash through OpenRouter); an unreachable provider is skipped with its reason, and a run that does not deliver (transport
 * failure, timeout) moves on to the next model. Whatever produced the circuit, the answer is executed and checked symbolically, and the
 * packet carries `parse: {parser: 'llm_direct', strategy, model, tried, rounds, cost_usd, ms, cache, ...}`. Identical requests are
 * cached per memory version, model and guide version. One formalization per turn (owner 2026-10-02: cheap and fast; no voting);
 * quality control is offline (the proxy's request log, reviewed in batch).
 */
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {authorExecution} from '../lib/query-author/execution-context.mjs';
import {buildContext} from '../lib/query-author/context.mjs';
import {checkStrategy, localStrategy, directStrategy, localReadiness, usesTier, LOCAL_STRATEGIES, DEFAULT_LOCAL, PARSER_NAMES} from '../lib/formalize/strategies.mjs';
import {FORMALIZATION_STRATEGIES as FORMALIZATION_STRATEGY_LABELS} from './status.mjs';
import {chainEntry, providerSettings, providerReadiness} from '../lib/llm-providers.mjs';
import {authorQuery} from '../lib/query-author/index.mjs';

/** The formalizer chain (owner 2026-10-02): the proxy tier `small` (openference Qwen3.8 27b; the proxy falls back to DeepSeek v4 flash).
 * Concrete `<provider>/<model>` entries may follow it in `queryParser.models`; config names tiers, not models. */
export const DEFAULT_MODELS = Object.freeze(['small']);
export const DEFAULT_QUERY_PARSER = Object.freeze({
  strategy: 'LLMDirect', mode: 'id', candidates: 24, indexMax: 300, models: DEFAULT_MODELS, timeoutSeconds: 120, maxFixRounds: 2, maxConcurrent: 4, cacheEntries: 500,
  local: DEFAULT_LOCAL,
});

/**
 * The settings of the request parser: the defaults, `config.queryParser`, and the model chain resolved against `llmProviders`.
 * `strategy` names the formalization strategy (LLMDirect | LocalLLMStepByStep | InternalReasoningStepByStep; the earlier names
 * CodingAgent and LocalLLMDirect read as LLMDirect; environment CHATSOP_FORMALIZER overrides it); `local` configures the small model of
 * the two step-by-step strategies: the proxy tier `tiny` by default, or an explicit endpoint or GGUF (evaluation harnesses).
 */
export function queryParserSettings(config = {}, env = process.env) {
  const merged = {...DEFAULT_QUERY_PARSER, ...(config.queryParser ?? {})};
  merged.strategy = checkStrategy(env.CHATSOP_FORMALIZER || merged.strategy);
  merged.local = {...DEFAULT_LOCAL, ...(config.queryParser?.local ?? {})};
  merged.providers = providerSettings(config);
  const chain = Array.isArray(merged.models) && merged.models.length ? merged.models : DEFAULT_MODELS;
  merged.entries = [...new Map(chain.map(m => chainEntry(m, {providers: merged.providers})).map(e => [e.id, e])).values()];
  merged.models = merged.entries.map(e => e.id);
  return merged;
}

/** The first entry of the LLMDirect chain (evaluation tools that need the model id). */
export const remoteDirectEntry = settings => settings.entries?.[0] ?? null;

const normalize = text => String(text).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

class Lru {
  constructor(max) { this.max = max; this.map = new Map(); }
  get(key) { if (!this.map.has(key)) return undefined; const value = this.map.get(key); this.map.delete(key); this.map.set(key, value); return value; }
  set(key, value) { if (this.max <= 0) return; this.map.delete(key); this.map.set(key, value); while (this.map.size > this.max) this.map.delete(this.map.keys().next().value); }
  get size() { return this.map.size; }
}

/**
 * `chatData`: for the gap log; `fetchImpl`: the HTTP client of the model calls and the readiness probes; `backendFactory(entry)` builds
 * the completion backend of a chain entry (tests inject a stub); `probe(entry)` overrides the readiness probe (default: the provider's
 * endpoint answers; with an injected backend factory and no probe, every entry counts as reachable).
 */
export function createQueryParser({settings = queryParserSettings(), chatData = null, fetchImpl = undefined, backendFactory = null, probe = null, localFactory = localStrategy, now = Date.now} = {}) {
  const cache = new Lru(settings.cacheEntries);
  const defaultStrategy = settings.strategy ?? 'LLMDirect';
  const locals = new Map();
  // The proxy's default path (the openference provider entry): the step-by-step strategies ask their tier there.
  const proxyEndpoint = () => settings.providers?.openference?.baseUrl ?? 'http://127.0.0.1:18080/v1';
  const localFor = name => {
    if (!locals.has(name)) locals.set(name, localFactory(name, settings.local, {timeoutMs: settings.timeoutSeconds * 1000, proxyEndpoint: proxyEndpoint(), ...(fetchImpl ? {fetchImpl} : {})}));
    return locals.get(name);
  };
  const entryOf = id => settings.entries.find(e => e.id === id) ?? chainEntry(id, {providers: settings.providers});
  const directs = new Map();
  const directFor = id => {
    if (!directs.has(id)) {
      const entry = entryOf(id);
      directs.set(id, backendFactory
        ? {name: 'LLMDirect', entry, run: async args => ({...await authorQuery({...args, backend: backendFactory(entry)}), model: entry.id, provider: entry.provider})}
        : directStrategy(entry, {timeoutMs: settings.timeoutSeconds * 1000, ...(fetchImpl ? {fetchImpl} : {})}));
    }
    return directs.get(id);
  };
  let running = 0;
  const stats = {requests: 0, cache_hits: 0, parsed: 0, failures: 0, model_switches: 0};

  const readiness = new Map();
  /** Whether a chain entry's endpoint answers (cached for 10 s, so a burst of turns probes once). */
  async function entryReady(entry) {
    if (probe) return probe(entry);
    if (backendFactory) return {available: true};
    const key = `${entry.endpoint}#${entry.tier ?? ''}`;
    const hit = readiness.get(key);
    // A reachable entry is trusted for 10 s; an unreachable one for 2 s, and it is probed twice (a restarting proxy is not a lost turn).
    if (hit && now() - hit.at < (hit.state.available ? 10_000 : 2_000)) return hit.state;
    const ask = () => providerReadiness(entry.endpoint, {...(fetchImpl ? {fetchImpl} : {}), tier: entry.tier ?? null});
    let state = await ask();
    if (!state.available && !fetchImpl) { await new Promise(r => setTimeout(r, 1000)); state = await ask(); }
    readiness.set(key, {at: now(), state});
    return state;
  }

  /** Which models of the chain can run now, and why not for the others. */
  async function availability(preferredModel = null, strategy = defaultStrategy) {
    if (LOCAL_STRATEGIES.includes(strategy)) return localFor(strategy).availability();
    let chain = settings.models;
    if (preferredModel) {
      try { chain = [...new Set([entryOf(preferredModel).id, ...settings.models])]; }
      catch { /* an unknown preferred model is ignored: the configured chain runs */ }
    }
    const usable = [], skipped = [];
    for (const id of chain) {
      const state = await entryReady(entryOf(id));
      if (state.available) usable.push(id); else skipped.push({model: id, reason: state.reason ?? 'not reachable'});
    }
    if (!usable.length) return {available: false, reason: `no model of the formalizer chain is reachable: ${skipped.map(s => `${s.model} (${s.reason})`).join('; ')}`, models: [], skipped};
    return {available: true, models: usable, skipped};
  }

  const authorOptions = ({message, lexicon, onProgress}) => ({message, lexicon, ...authorExecution.getStore(), maxFixRounds: settings.maxFixRounds, mode: settings.mode, k: settings.candidates, indexMax: settings.indexMax,
    vocabularyDialog: settings.vocabularyDialog !== false, maxVocabularyBytes: settings.maxVocabularyBytes ?? 24_000, onProgress});

  async function runModel({model, message, lexicon, onProgress, strategy = defaultStrategy}) {
    if (LOCAL_STRATEGIES.includes(strategy)) return localFor(strategy).run(authorOptions({message, lexicon, onProgress}));
    return directFor(model).run(authorOptions({message, lexicon, onProgress}));
  }

  /** A gap of the memory (a clear question no predicate expresses): material for core-en growth through the approved authoring path. Gitignored (chat_data/). */
  function logGap(entry) {
    if (!chatData?.root) return;
    try { fs.appendFileSync(path.join(chatData.root, 'query-gaps.jsonl'), JSON.stringify({ts: new Date(now()).toISOString(), ...entry}) + '\n'); } catch { /* a log never fails a turn */ }
  }

  const fail = (code, status, message, parse) => Object.assign(new Error(message), {code, status, parse});
  const recordOf = (r, extra = {}) => ({parser: PARSER_NAMES[r.strategy] ?? 'llm_direct', strategy: r.strategy ?? 'LLMDirect', ...(r.steps ? {steps: r.steps.length, dialog: r.steps.map(s => ({name: s.name, answer: s.answer}))} : {}), ...(typeof r.report === 'string' && r.report.startsWith('{') ? {report: r.report} : {}), model: r.model ?? null, backend: r.backend ?? 'completion', rounds: r.rounds ?? 0, cost_usd: r.usage?.cost_usd ?? r.cost_usd ?? 0, ms: r.ms ?? r.duration_ms ?? 0, cache: r.cache ?? 'miss',
    ...(r.usage?.cache_read_tokens ? {cache_read_tokens: r.usage.cache_read_tokens} : {}), ...(r.runs?.some(x => x.served) ? {served: [...new Set(r.runs.map(x => x.served).filter(Boolean))]} : {}),
    ...(r.unlinked?.length ? {unlinked: r.unlinked} : {}), ...(r.context_version ? {guide: r.context_version} : {}), ...(r.mode ? {mode: r.mode, retrieval: {predicates: r.retrieval?.predicates?.length ?? 0, entity_mentions: r.retrieval?.entities?.length ?? 0, neighbourhood: r.retrieval?.neighbourhood ?? null, bytes: r.retrieval?.bytes ?? 0, byte_budget: r.retrieval?.byte_budget ?? 0, truncated: r.retrieval?.truncated ?? false}} : {}), ...(r.vocabulary_dialog ? {vocabulary_dialog: r.vocabulary_dialog} : {}), ...(r.closest ? {closest: r.closest} : {}), ...(r.self_check ? {self_check: r.self_check} : {}), ...(r.repairs?.length ? {repairs: r.repairs} : {}), ...extra});

  /** One formalization down the chain (the first model that delivers); `{result, tried}`, `result` null when none delivered. */
  async function formalize({models, message, lexicon, onProgress, strategy}) {
    const tried = [];
    let last = null;
    for (const model of models) {
      const result = {...await runModel({model, message, lexicon, onProgress, strategy}), strategy};
      last = result;
      if (result.ok) return {result, tried};
      tried.push({model, reason: result.reason ?? `invalid circuit: ${(result.validation?.problems ?? []).map(p => p.code).join(', ') || 'no output'}`, status: result.status});
      // A model that ran but wrote an invalid circuit after every repair round is a final answer about this message; a run that delivered nothing moves on to the next model.
      if (result.status !== 'failed') break;
      stats.model_switches++;
    }
    return {result: null, last, tried};
  }

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
    if (!free.available) { stats.failures++; throw fail('parse_unavailable', 503, free.reason, {parser: PARSER_NAMES[strategy], strategy, model: null, ms: now() - started, failed: free.reason, tried: free.skipped}); }
    const skipped = [...free.skipped];
    const store = authorExecution.getStore();
    const key = createHash('sha256').update([memoryKey ?? '', store?.key ?? '', settings.runTag ?? '', buildContext({message, lexicon, mode: settings.mode, vocabulary: null}).version, String(settings.vocabularyDialog !== false), String(settings.maxVocabularyBytes ?? 24_000), String(store?.selfCheck ?? false), strategy,
      local ? (localFor(strategy).tag ?? `${settings.local.tier ?? settings.local.alias}@${settings.local.endpoint ?? settings.local.gguf ?? ''}#${settings.local.method ?? 'A'}`) : free.models.join('|'), normalize(message)].join('\0')).digest('hex');
    const hit = cache.get(key);
    if (hit && (!hit.fragment || hit.contextKey === store?.contextKey)) { stats.cache_hits++; stats.parsed++; return {sop: hit.sop, parse: recordOf({...hit.result, strategy, cache: 'hit', ms: now() - started, cost_usd: 0, usage: {cost_usd: 0}}, {tried: skipped.map(t => t.model)})}; }
    if (running >= settings.maxConcurrent) { stats.failures++; throw fail('parse_unavailable', 503, 'the formalizer is busy', {parser: PARSER_NAMES[strategy], strategy, model: null, ms: now() - started, failed: 'the formalizer is busy', status: 'busy'}); }
    running++;
    let outcome;
    try { outcome = await formalize({models: local ? [null] : free.models, message, lexicon, onProgress, strategy}); }
    finally { running--; }
    const tried = [...skipped, ...outcome.tried];
    const result = outcome.result;
    if (result) {
      cache.set(key, {sop: result.sop, result: {...result, usage: {cost_usd: 0}}, fragment: result.program?.wires.some(w => w.fields.fragment), contextKey: store?.contextKey});
      if (result.unclear === 'relation_not_in_memory') logGap({message, memory: memoryKey, closest: result.closest, model: result.model});
      stats.parsed++;
      return {sop: result.sop, parse: recordOf({...result, ms: now() - started}, {tried: tried.map(t => t.model), ...(tried.length ? {tried_reasons: tried.map(t => ({model: t.model, reason: t.reason}))} : {}), ...(result.unclear ? {unclear: result.unclear} : {})})};
    }
    stats.failures++;
    const last = outcome.last;
    const reason = last?.reason ?? `the formalizer's circuit was invalid: ${(last?.validation?.problems ?? []).map(p => p.code).join(', ') || 'no output'}`;
    const record = recordOf({strategy, ...(last ?? {}), ms: now() - started}, {failed: reason, tried: tried.map(t => ({model: t.model, reason: t.reason}))});
    if (last && last.status === 'failed') throw fail('parse_unavailable', 503, reason, record);
    // The last invalid circuit and its problems stay on the error for the trace and the evaluations (never executed).
    throw Object.assign(fail('parse_failed', 422, reason, record), {attempt: {sop: last?.sop ?? null, problems: (last?.validation?.problems ?? []).slice(0, 12)}});
  }

  /**
   * The formalization strategies of this parser with their availability (server/status.mjs). A local strategy is reported available
   * when its model file and llama-server exist (or its external endpoint answers); its server starts on the first turn that uses it.
   */
  async function strategies() {
    const direct = await availability(null, 'LLMDirect');
    const localState = await localReadiness(settings.local, fetchImpl, proxyEndpoint());
    return FORMALIZATION_STRATEGY_LABELS.map(s => s.id === 'LLMDirect'
      ? {...s, available: direct.available === true, ...(direct.reason ? {reason: direct.reason} : {}), backend: 'completion',
        models: settings.entries.map(e => ({id: e.id, endpoint: e.endpoint, available: direct.models.includes(e.id), ...(direct.skipped.find(k => k.model === e.id) ? {reason: direct.skipped.find(k => k.model === e.id).reason} : {})}))}
      : usesTier(settings.local) ? {...s, ...localState, backend: 'completion', model: settings.local.tier, endpoint: proxyEndpoint()}
      : {...s, ...localState, backend: 'llama-server', model: settings.local.alias, ...(settings.local.endpoint ? {endpoint: settings.local.endpoint} : {gguf: settings.local.gguf})});
  }

  /** Stops the managed local model server this parser started (chat server shutdown). */
  const stop = async () => { for (const l of locals.values()) await l.server.stop(); };
  return {parse, availability, strategies, defaultStrategy, stop, stats: () => ({...stats, cache_size: cache.size, running}), settings, clearCache: () => cache.map.clear()};
}
