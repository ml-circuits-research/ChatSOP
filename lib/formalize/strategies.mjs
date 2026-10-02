/**
 * The named formalization strategies of the request parser (DS022 "Formalization strategies"): how a chat message becomes a
 * model-surface SOP circuit. All return the result shape of `authorQuery` and feed the same symbolic path (validator,
 * KnowledgeLinker, StrategyRouter, oracle verification, rendering). Owner decision 2026-10-02: every strategy calls its model directly
 * (a chat-completion request); no formalization runs through omp or any other agentic tool.
 *
 *   LLMDirect           a model of the chain (`queryParser.models`, through the proxy LLMAPIProvider: openference Qwen3.8 27b, then
 *                       DeepSeek flash through OpenRouter) writes query.sop as plain completion text; the validator repairs it in
 *                       bounded rounds. The default.
 *   LocalLLMStepByStep  a local GGUF model only answers short questions and numbered choices; the system assembles the circuit.
 *   InternalReasoningStepByStep  the same kind of short questions, but the protocol is wires in a base memory
 *                       (config/knowledge/formalizer-protocol-v1) and the JS oracle plans the next question (lib/formalize/internal-reasoning).
 *
 * The earlier names `CodingAgent` (omp) and `LocalLLMDirect` are read as `LLMDirect` (stored session settings, older run commands).
 * The two step-by-step strategies use one shared managed llama-server (lib/local-llm) with one dedicated slot each and a prewarmed
 * stable prefix, or an external endpoint (`queryParser.local.endpoint`).
 */
import {authorQuery, completionBackend} from '../query-author/index.mjs';
import {buildContext} from '../query-author/context.mjs';
import {stepByStepQuery, createOracle, STEP_BY_STEP_SYSTEM} from '../query-author/step-by-step/index.mjs';
import {FIRST_TURN_PREFIX} from '../query-author/step-by-step/prompts.mjs';
import {protocolQuery, PROTOCOL_PREFIX, METHODS as STEP_METHODS} from '../query-author/step-by-step/protocol.mjs';
import {internalReasoningQuery, internalReasoningPrefix, createReasoningOracle, CONTROLS as REASONING_CONTROLS} from './internal-reasoning/index.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {localServer, localChat, DEFAULT_LLAMA_SERVER, GPU_LOCKS} from '../local-llm/index.mjs';
import {providerReadiness, DEFAULT_PROVIDERS} from '../llm-providers.mjs';

const DEFAULT_PROXY = DEFAULT_PROVIDERS.openference.baseUrl;

export const FORMALIZATION_STRATEGIES = Object.freeze(['LLMDirect', 'LocalLLMStepByStep', 'InternalReasoningStepByStep']);
/** Earlier strategy names, read as the current one. */
export const STRATEGY_ALIASES = Object.freeze({CodingAgent: 'LLMDirect', LocalLLMDirect: 'LLMDirect'});
export const LOCAL_STRATEGIES = Object.freeze(['LocalLLMStepByStep', 'InternalReasoningStepByStep']);
/** The llama-server slot of each local strategy (one conversation per slot at a time, each with its own cached prefix). */
export const STRATEGY_SLOTS = Object.freeze({LocalLLMStepByStep: 'steps', InternalReasoningStepByStep: 'reasoning'});
/**
 * The small model of the step-by-step strategies: by default the proxy tier `tiny` (owner 2026-10-02: the local Qwen3-4B behind
 * LLMAPIProvider, started on demand when the GPU is free, falling back to DeepSeek v4 flash; the local 27B never runs). An explicit
 * `endpoint` (an external llama-server) or `gguf` (a managed llama-server, evaluation harnesses only) takes precedence over the tier.
 */
export const DEFAULT_LOCAL = Object.freeze({tier: 'tiny', gguf: null, alias: 'qwen3-4b', port: 19601, endpoint: null,
  slots: ['steps', 'reasoning'], ctxPerSlot: 16384, maxTokens: 1500, thinking: false, method: 'B', reasoningControl: 'plan'});
/** Whether the step-by-step model is the proxy tier (no llama-server is started or managed). */
export const usesTier = local => Boolean(local?.tier) && !local?.endpoint && !local?.gguf;
/** The proxy request tag of every formalization call (LLMAPIProvider `x-llmapiprovider-purpose`). */
export const FORMALIZE_HEADERS = Object.freeze({'x-llmapiprovider-purpose': 'formalize'});
/** The question protocols of LocalLLMStepByStep: A (the first protocol) and the generic protocol's methods (DS022 "LocalLLMStepByStep"). */
export const STEP_BY_STEP_METHODS = Object.freeze(['A', ...Object.keys(STEP_METHODS)]);
/** The byte-identical first-turn prefix of a step-by-step method (cached with the system message). */
export const stepPrefix = method => (method ?? 'A') === 'A' ? FIRST_TURN_PREFIX : PROTOCOL_PREFIX;
/** The parser name a strategy writes into the parse record of a turn. */
export const PARSER_NAMES = Object.freeze({LLMDirect: 'llm_direct', LocalLLMStepByStep: 'local_llm_step_by_step', InternalReasoningStepByStep: 'internal_reasoning_step_by_step'});

const noThinking = local => local.thinking ? {} : {chat_template_kwargs: {enable_thinking: false}};
/** The byte-identical system prompt of LLMDirect: the author guide, which does not depend on the request or the memory (the cached prefix). */
export const directSystem = () => buildContext({message: '.', lexicon: {predicates: {}, entities: {}}, vocabulary: null}).system;

/**
 * Whether the local strategies can run, without starting anything: an external endpoint must answer `/health`; a managed server
 * needs its GGUF and the llama-server binary, and no GPU lock (training) may be held. `running` tells whether it is loaded now.
 */
export async function localReadiness(local = {}, fetchImpl = globalThis.fetch, proxyEndpoint = DEFAULT_PROXY) {
  const s = {...DEFAULT_LOCAL, ...local};
  if (usesTier(s)) return {...await providerReadiness(proxyEndpoint, {fetchImpl, tier: s.tier}), running: null};
  const expand = f => String(f ?? '').replace(/^~(?=\/|$)/, os.homedir());
  const base = s.endpoint ? s.endpoint.replace(/\/+$/, '').replace(/\/v1$/, '') : `http://127.0.0.1:${s.port}`;
  let running = false;
  try { running = (await fetchImpl(`${base}/health`, {signal: AbortSignal.timeout(1500)})).ok; } catch { running = false; }
  if (s.endpoint) return running ? {available: true, running} : {available: false, running, reason: `the local model endpoint ${s.endpoint} does not answer`};
  if (!fs.existsSync(expand(s.gguf))) return {available: false, running, reason: `the local model file ${s.gguf} is missing`};
  if (!fs.existsSync(expand(s.bin ?? process.env.LLAMA_SERVER ?? DEFAULT_LLAMA_SERVER))) return {available: false, running, reason: 'llama-server is not installed'};
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  const lock = GPU_LOCKS.find(l => fs.existsSync(path.join(root, l)));
  if (lock && !running) return {available: false, running, reason: `the GPU is reserved (${lock})`};
  return {available: true, running};
}

export function checkStrategy(name) {
  name = STRATEGY_ALIASES[name] ?? name;
  if (!FORMALIZATION_STRATEGIES.includes(name)) throw Object.assign(new Error(`unknown formalization strategy ${JSON.stringify(name)}; use one of ${FORMALIZATION_STRATEGIES.join(', ')}`), {code: 'invalid_strategy', status: 400});
  return name;
}

/** Evaluate and keep the stable prefixes of both local roles (on start, and again when the guide or the prompts change). */
export async function prewarmStrategies(server, local = DEFAULT_LOCAL) {
  const out = {};
  if (server.slots.includes('steps')) out.steps = await server.prewarm('steps', [{role: 'system', content: STEP_BY_STEP_SYSTEM}, {role: 'user', content: stepPrefix(local.method)}], {extraBody: noThinking(local)});
  // InternalReasoningStepByStep: the prefix rendered from the protocol memory (byte-identical per protocol version).
  if (server.slots.includes('reasoning')) { const prefix = internalReasoningPrefix(); out.reasoning = await server.prewarm('reasoning', [{role: 'system', content: prefix.system}, {role: 'user', content: prefix.firstTurn}], {extraBody: noThinking(local)}); }
  return out;
}

/**
 * A runnable local strategy: `run({message, lexicon, circuits, repo, session, execute, selfCheck, onProgress, ...authorOptions})`.
 * `serverFactory` lets tests inject a stub server.
 */
export function localStrategy(name, local = {}, {serverFactory = localServer, fetchImpl = globalThis.fetch, timeoutMs = 180_000, proxyEndpoint = DEFAULT_PROXY} = {}) {
  if (!LOCAL_STRATEGIES.includes(checkStrategy(name))) throw new TypeError(`${name} is not a local strategy`);
  const settings = {...DEFAULT_LOCAL, ...local};
  if (usesTier(settings)) return tierStrategy(name, settings, {fetchImpl, timeoutMs, proxyEndpoint});
  const server = serverFactory({...settings, fetchImpl});
  let warmed = null, warmedFor = null;
  // The stable prefixes are evaluated once per server process (a restarted server restores them from its slot files).
  const ready = async () => {
    await server.ensure();
    const instance = server.child?.pid ?? 'external';
    if (warmedFor !== instance) { warmedFor = instance; warmed = prewarmStrategies(server, settings).catch(error => { warmedFor = null; throw error; }); }
    return warmed;
  };
  return {
    name, server, settings,
    async availability() {
      try { await ready(); return {available: true, models: [settings.alias], skipped: []}; }
      catch (error) { return {available: false, reason: `the local model is not available: ${error.message}`, models: [], skipped: []}; }
    },
    async run({message, lexicon, onProgress = () => {}, maxFixRounds = 2, ...rest}) {
      await ready();
      const role = STRATEGY_SLOTS[name];
      const turn = await server.begin(role);
      try {
        const chat = (messages, maxTokens) => localChat({endpoint: server.endpoint, model: settings.alias, messages, maxTokens, slot: turn.slot, timeoutMs, extraBody: noThinking(settings), fetchImpl});
        return {...await stepQuery(name, settings, {message, lexicon, onProgress, chat, model: settings.alias, ...rest}), prefix_restore_ms: turn.ms};
      } finally { turn.release(); }
    },
  };
}

/** The question protocol of a step-by-step strategy over a `chat(messages, maxTokens)` client. */
async function stepQuery(name, settings, {message, lexicon, onProgress, chat, model, circuits, repo, session, derived = null}) {
  if (name === 'InternalReasoningStepByStep') {
    const control = settings.reasoningControl ?? 'plan';
    if (!REASONING_CONTROLS.includes(control)) throw Object.assign(new Error(`unknown reasoning control ${JSON.stringify(control)}; use one of ${REASONING_CONTROLS.join(', ')}`), {code: 'invalid_strategy'});
    return internalReasoningQuery({message, lexicon, circuits, repo, session, derived, oracle: createReasoningOracle({chat}), model, control, onProgress});
  }
  const method = settings.method ?? 'A';
  if (!STEP_BY_STEP_METHODS.includes(method)) throw Object.assign(new Error(`unknown step-by-step method ${JSON.stringify(method)}; use one of ${STEP_BY_STEP_METHODS.join(', ')}`), {code: 'invalid_strategy'});
  const query = method === 'A' ? stepByStepQuery : protocolQuery;
  return query({message, lexicon, circuits, repo, session, derived, oracle: createOracle({chat}), model, method, onProgress});
}

/**
 * A step-by-step strategy on the proxy tier (`settings.tier`, default `tiny`): every short question is one chat-completion request to the
 * proxy LLMAPIProvider with `model: "<tier>"`; the proxy starts the local model on demand and falls back down the tier's chain. No
 * llama-server is managed here; the stable system prefix is byte-identical, so the serving model's prefix cache can reuse it.
 */
function tierStrategy(name, settings, {fetchImpl, timeoutMs, proxyEndpoint}) {
  return {
    name, settings, tier: settings.tier, tag: `tier:${settings.tier}@${proxyEndpoint}#${settings.method ?? 'A'}`,
    server: {stop: async () => {}},
    async availability() {
      const state = await providerReadiness(proxyEndpoint, {fetchImpl, tier: settings.tier});
      return state.available ? {available: true, models: [settings.tier], skipped: []} : {available: false, reason: `the proxy tier ${settings.tier} is not available: ${state.reason}`, models: [], skipped: []};
    },
    async run({message, lexicon, onProgress = () => {}, maxFixRounds = 2, ...rest}) {
      void maxFixRounds;
      const chat = (messages, maxTokens) => localChat({endpoint: proxyEndpoint, model: settings.tier, messages, maxTokens, timeoutMs, extraBody: noThinking(settings), headers: FORMALIZE_HEADERS, fetchImpl});
      return {...await stepQuery(name, settings, {message, lexicon, onProgress, chat, model: settings.tier, ...rest}), backend: 'completion'};
    },
  };
}

/**
 * LLMDirect: one model of the chain, called directly (owner decisions 2026-10-02). The author guide is the system message (byte-identical
 * across requests, so a provider's prefix cache reuses it), the retrieved vocabulary and the request follow in the user message; the
 * validator's problems go back in the same conversation for at most `maxFixRounds` rounds. `entry` is a resolved chain entry (`chainEntry`).
 */
export function directStrategy(entry, {fetchImpl = globalThis.fetch, timeoutMs = 120_000} = {}) {
  return {
    name: 'LLMDirect', entry, tag: `direct:${entry.id}@${entry.endpoint}`,
    async availability() {
      const state = await providerReadiness(entry.endpoint, {fetchImpl, tier: entry.tier ?? null});
      return state.available ? {available: true, models: [entry.id], skipped: []} : {available: false, reason: state.reason, models: [], skipped: [{model: entry.id, reason: state.reason}]};
    },
    async run({message, lexicon, onProgress = () => {}, maxFixRounds = 2, temperature = 0, ...rest}) {
      const backend = completionBackend({endpoint: entry.endpoint, model: entry.model, timeoutMs: Math.max(timeoutMs, entry.timeoutMs ?? 0), maxTokens: entry.maxTokens, apiKeyEnv: entry.apiKeyEnv,
        cachePrompt: false, temperature, extraBody: entry.extraBody, headers: {...FORMALIZE_HEADERS, ...(entry.headers ?? {})}, fetchImpl});
      return {...await authorQuery({message, lexicon, ...rest, backend, maxFixRounds, onProgress}), model: entry.id, provider: entry.provider};
    },
  };
}
