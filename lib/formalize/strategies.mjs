/**
 * The named formalization strategies of the request parser (DS022 "Formalization strategies"): how a chat message becomes a
 * model-surface SOP circuit. All return the same result shape (status validated | invalid | failed, sop, validation, unclear, usage,
 * steps) and feed the same symbolic path (validator, KnowledgeLinker, StrategyRouter, oracle verification, rendering).
 *
 * Owner decision 2026-10-02: formalization is step by step only. The system asks short questions and assembles the circuit itself; a
 * model only answers the questions. Larger tiers answer the SAME questions (like with like), never write a whole circuit.
 *
 *   LocalLLMStepByStep  the default: the protocol of lib/query-author/step-by-step (method B) asks short questions and numbered choices.
 *   InternalReasoningStepByStep  the same kind of short questions, but the protocol is wires in a base memory
 *                       (config/knowledge/formalizer-protocol-v1) and the JS oracle plans the next question (lib/formalize/internal-reasoning).
 *
 * Who answers: a ladder of proxy tiers (`queryParser.local.ladder`, default `[tier]`; the product configures tiny, small, good). Each
 * question goes to the first tier and escalates to the next only when the answer cannot be read or the tier does not answer
 * (createOracle in lib/query-author/step-by-step/index.mjs). The one-shot strategy LLMDirect (a model writes the whole circuit) is
 * archived in probably_obsolete/one-shot-formalization/; the names LLMDirect, CodingAgent and LocalLLMDirect resolve to the default
 * step-by-step strategy with a note in the trace. Every strategy calls its model directly (a chat-completion request); none runs
 * through omp. Without a tier, an explicit endpoint or GGUF runs the questions on one shared managed llama-server (lib/local-llm) with
 * one dedicated slot per strategy and a prewarmed stable prefix (evaluation harnesses).
 */
import {stepByStepQuery, createOracle, STEP_BY_STEP_SYSTEM} from '../query-author/step-by-step/index.mjs';
import {FIRST_TURN_PREFIX} from '../query-author/step-by-step/prompts.mjs';
import {protocolQuery, PROTOCOL_PREFIX, METHODS as STEP_METHODS} from '../query-author/step-by-step/protocol.mjs';
import {internalReasoningQuery, internalReasoningPrefix, createReasoningOracle, CONTROLS as REASONING_CONTROLS} from './internal-reasoning/index.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {localServer, localChat, DEFAULT_LLAMA_SERVER, GPU_LOCKS} from '../local-llm/index.mjs';
import {providerReadiness, DEFAULT_PROVIDERS} from '../llm-providers.mjs';
import {replayChat, modelIdentity} from './replay-cache.mjs';

const DEFAULT_PROXY = DEFAULT_PROVIDERS.openference.baseUrl;

export const FORMALIZATION_STRATEGIES = Object.freeze(['LocalLLMStepByStep', 'InternalReasoningStepByStep']);
/** The default strategy of the chat and the API (owner decision 2026-10-02). */
export const DEFAULT_STRATEGY = 'LocalLLMStepByStep';
/** Archived one-shot strategy names (stored session settings, older run commands): read as the default step-by-step strategy. */
export const ARCHIVED_STRATEGIES = Object.freeze(['LLMDirect', 'CodingAgent', 'LocalLLMDirect']);
export const LOCAL_STRATEGIES = Object.freeze(['LocalLLMStepByStep', 'InternalReasoningStepByStep']);
/** The llama-server slot of each local strategy (one conversation per slot at a time, each with its own cached prefix). */
export const STRATEGY_SLOTS = Object.freeze({LocalLLMStepByStep: 'steps', InternalReasoningStepByStep: 'reasoning'});
/**
 * The small model of the step-by-step strategies: by default the proxy tier `tiny` (owner 2026-10-02: the local Qwen3-4B behind
 * LLMAPIProvider, started on demand when the GPU is free, falling back to DeepSeek v4 flash; the local 27B never runs). An explicit
 * `endpoint` (an external llama-server) or `gguf` (a managed llama-server, evaluation harnesses only) takes precedence over the tier.
 */
export const DEFAULT_LOCAL = Object.freeze({tier: 'tiny', ladder: null, gguf: null, alias: 'qwen3-4b', port: 19601, endpoint: null,
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
export const PARSER_NAMES = Object.freeze({LocalLLMStepByStep: 'local_llm_step_by_step', InternalReasoningStepByStep: 'internal_reasoning_step_by_step'});

const noThinking = local => local.thinking ? {} : {chat_template_kwargs: {enable_thinking: false}};

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

/**
 * The strategy a name asks for: `{strategy, note}`. An archived one-shot name resolves to `fallback` (the configured default) with a
 * note for the trace; an unknown name is an error (400 `invalid_strategy`).
 */
export function resolveStrategy(name, fallback = DEFAULT_STRATEGY) {
  if (ARCHIVED_STRATEGIES.includes(name)) return {strategy: fallback, note: `the one-shot strategy ${name} is archived (owner decision 2026-10-02); the step-by-step strategy ${fallback} ran instead`};
  if (!FORMALIZATION_STRATEGIES.includes(name)) throw Object.assign(new Error(`unknown formalization strategy ${JSON.stringify(name)}; use one of ${FORMALIZATION_STRATEGIES.join(', ')}`), {code: 'invalid_strategy', status: 400});
  return {strategy: name, note: null};
}

export const checkStrategy = (name, fallback = DEFAULT_STRATEGY) => resolveStrategy(name, fallback).strategy;

/**
 * The tier ladder of a step-by-step run: `[{tier, extraBody}]`, smallest first. `local.ladder` entries are tier names or
 * `{tier, extraBody}`; without a ladder the single `local.tier` answers. `first` (a session's preferred tier) starts the ladder at that
 * rung when it is on it, and is the only rung otherwise.
 */
export function ladderOf(local = {}, first = null) {
  const rungs = (Array.isArray(local.ladder) && local.ladder.length ? local.ladder : [local.tier]).filter(Boolean)
    .map(r => typeof r === 'string' ? {tier: r, extraBody: {}} : {tier: r.tier, extraBody: r.extraBody ?? {}, ...(r.minTokens ? {minTokens: r.minTokens} : {})});
  if (!first) return rungs;
  const at = rungs.findIndex(r => r.tier === first);
  return at >= 0 ? rungs.slice(at) : [{tier: first, extraBody: {}}];
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

/** The question protocol of a step-by-step strategy over a `chat(messages, maxTokens)` client, or a tier `ladder` of `[{tier, chat}]`. */
async function stepQuery(name, settings, {message, lexicon, onProgress, chat, ladder = null, model, circuits, repo, session, derived = null}) {
  if (name === 'InternalReasoningStepByStep') {
    const control = settings.reasoningControl ?? 'plan';
    if (!REASONING_CONTROLS.includes(control)) throw Object.assign(new Error(`unknown reasoning control ${JSON.stringify(control)}; use one of ${REASONING_CONTROLS.join(', ')}`), {code: 'invalid_strategy'});
    return internalReasoningQuery({message, lexicon, circuits, repo, session, derived, oracle: createReasoningOracle({chat, ladder}), model, control, onProgress});
  }
  const method = settings.method ?? 'A';
  if (!STEP_BY_STEP_METHODS.includes(method)) throw Object.assign(new Error(`unknown step-by-step method ${JSON.stringify(method)}; use one of ${STEP_BY_STEP_METHODS.join(', ')}`), {code: 'invalid_strategy'});
  const query = method === 'A' ? stepByStepQuery : protocolQuery;
  // `settings.expression` (queryParser.local.expression): a numeric problem is formalized first by the expression path
  // (lib/formalize/expression-program.mjs), asked on the first rung; the problem questions are its fallback.
  return query({message, lexicon, circuits, repo, session, derived, oracle: createOracle({chat, ladder}), model, method, onProgress,
    ...(settings.expression ? {expression: {chat: ladder?.[0]?.chat ?? chat}} : {})});
}

/** How many questions each tier answered and which questions escalated (from the oracle steps of a run). */
export function ladderUsage(steps = []) {
  const answered = {};
  for (const s of steps) if (s.tier && s.ok && !s.escalated) answered[s.tier] = (answered[s.tier] ?? 0) + 1;
  return {answered, escalated: steps.filter(s => s.escalated).map(s => ({question: s.name, tier: s.tier}))};
}

/**
 * A step-by-step strategy on proxy tiers: every short question is one chat-completion request to the proxy LLMAPIProvider with
 * `model: "<tier>"`, first to the smallest tier of the ladder (`ladderOf(settings)`), escalating per question (createOracle). The proxy
 * starts the local model on demand. No llama-server is managed here; the stable system prefix is byte-identical, so the serving model's
 * prefix cache can reuse it. `run({firstTier})` starts the ladder at a session's preferred tier.
 */
function tierStrategy(name, settings, {fetchImpl, timeoutMs, proxyEndpoint}) {
  const rungs = ladderOf(settings);
  const tiers = rungs.map(r => r.tier);
  return {
    name, settings, tier: tiers[0], ladder: tiers, tag: `tier:${tiers.join('>')}@${proxyEndpoint}#${settings.method ?? 'A'}`,
    server: {stop: async () => {}},
    /** Available when the first tier of the ladder answers (the higher tiers are tried per question; a missing one only stops escalation). */
    async availability(firstTier = null) {
      const first = ladderOf(settings, firstTier)[0]?.tier ?? tiers[0];
      // A strict replay needs no model: every answer comes from the cache.
      if (settings.replay?.mode === 'replay') return {available: true, models: tiers, skipped: []};
      const state = await providerReadiness(proxyEndpoint, {fetchImpl, tier: first});
      return state.available ? {available: true, models: ladderOf(settings, firstTier).map(r => r.tier), skipped: []} : {available: false, reason: `the proxy tier ${first} is not available: ${state.reason}`, models: [], skipped: [{model: first, reason: state.reason}]};
    },
    async run({message, lexicon, onProgress = () => {}, maxFixRounds = 2, firstTier = null, ...rest}) {
      void maxFixRounds;
      const ladder = ladderOf(settings, firstTier).map(rung => {
        const extraBody = {...noThinking(settings), ...rung.extraBody};
        // A reasoning tier needs room to think before its short answer: `minTokens` (a ladder entry's, or the settings') is a floor of
        // max_tokens, so a question's small budget never cuts the thinking (owner, 2026-10-02).
        const floor = rung.minTokens ?? settings.minTokens ?? 0;
        const live = (messages, maxTokens) => localChat({endpoint: proxyEndpoint, model: rung.tier, messages, maxTokens: Math.max(maxTokens ?? 0, floor) || maxTokens, timeoutMs, extraBody, headers: {...FORMALIZE_HEADERS, ...(settings.headers ?? {})}, fetchImpl});
        // `settings.replay` {mode, dir}: the answers come from (and go to) the record/replay cache (lib/formalize/replay-cache.mjs).
        return {tier: rung.tier, chat: settings.replay ? replayChat(live, {...settings.replay, model: modelIdentity(rung.tier), sampling: {temperature: 0, extraBody, ...(floor ? {minTokens: floor} : {})}}) : live};
      });
      const result = await stepQuery(name, settings, {message, lexicon, onProgress, chat: ladder[0].chat, ladder: ladder.length > 1 ? ladder : null, model: ladder[0].tier, ...rest});
      const usage = ladderUsage(result.steps);
      return {...result, backend: 'completion', ladder: ladder.map(r => r.tier), ...(Object.keys(usage.answered).length > 1 || usage.escalated.length ? {tiers: usage} : {}),
        model: usage.escalated.length ? Object.keys(usage.answered).join('+') || ladder[0].tier : ladder[0].tier};
    },
  };
}
