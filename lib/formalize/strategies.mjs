/**
 * The named formalization strategies of the request parser (DS022 "Formalization strategies"): how a chat message becomes a
 * model-surface SOP circuit. All three return the result shape of `authorQuery` and feed the same symbolic path (validator,
 * KnowledgeLinker, StrategyRouter, oracle verification, rendering).
 *
 *   CodingAgent         an agentic coding model through omp (subscription chain) writes query.sop; the validator repairs it.
 *   LocalLLMDirect      a local GGUF model writes query.sop as plain completion text (same guide, validator and repair loop).
 *   LocalLLMStepByStep  a local GGUF model only answers short questions and numbered choices; the system assembles the circuit.
 *
 * Both local strategies use one shared managed llama-server (lib/local-llm) with one dedicated slot each and a prewarmed stable prefix.
 */
import {authorQuery, completionBackend} from '../query-author/index.mjs';
import {buildContext} from '../query-author/context.mjs';
import {stepByStepQuery, createOracle, STEP_BY_STEP_SYSTEM} from '../query-author/step-by-step/index.mjs';
import {FIRST_TURN_PREFIX} from '../query-author/step-by-step/prompts.mjs';
import {protocolQuery, PROTOCOL_PREFIX, METHODS as STEP_METHODS} from '../query-author/step-by-step/protocol.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {localServer, localChat, DEFAULT_LLAMA_SERVER, GPU_LOCKS} from '../local-llm/index.mjs';

export const FORMALIZATION_STRATEGIES = Object.freeze(['CodingAgent', 'LocalLLMDirect', 'LocalLLMStepByStep']);
export const LOCAL_STRATEGIES = Object.freeze(['LocalLLMDirect', 'LocalLLMStepByStep']);
export const DEFAULT_LOCAL = Object.freeze({gguf: '~/models/qwen3.8-27b/Qwen3.8-27B-UD-Q4_K_M.gguf', alias: 'qwen3.8-27b', port: 19601, endpoint: null,
  slots: ['direct', 'steps'], ctxPerSlot: 16384, maxTokens: 1500, thinking: false, method: 'A'});
/** The question protocols of LocalLLMStepByStep: A (the first protocol) and the generic protocol's methods (DS022 "LocalLLMStepByStep"). */
export const STEP_BY_STEP_METHODS = Object.freeze(['A', ...Object.keys(STEP_METHODS)]);
/** The byte-identical first-turn prefix of a step-by-step method (cached with the system message). */
export const stepPrefix = method => (method ?? 'A') === 'A' ? FIRST_TURN_PREFIX : PROTOCOL_PREFIX;
/** The parser name a strategy writes into the parse record of a turn. */
export const PARSER_NAMES = Object.freeze({CodingAgent: 'coding_agent', LocalLLMDirect: 'local_llm_direct', LocalLLMStepByStep: 'local_llm_step_by_step'});

const noThinking = local => local.thinking ? {} : {chat_template_kwargs: {enable_thinking: false}};
/** The byte-identical system prompt of LocalLLMDirect: the author guide, which does not depend on the request or the memory. */
export const directSystem = () => buildContext({message: '.', lexicon: {predicates: {}, entities: {}}, vocabulary: null}).system;

/**
 * Whether the local strategies can run, without starting anything: an external endpoint must answer `/health`; a managed server
 * needs its GGUF and the llama-server binary, and no GPU lock (training) may be held. `running` tells whether it is loaded now.
 */
export async function localReadiness(local = {}, fetchImpl = globalThis.fetch) {
  const s = {...DEFAULT_LOCAL, ...local};
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
  if (!FORMALIZATION_STRATEGIES.includes(name)) throw Object.assign(new Error(`unknown formalization strategy ${JSON.stringify(name)}; use one of ${FORMALIZATION_STRATEGIES.join(', ')}`), {code: 'invalid_strategy', status: 400});
  return name;
}

/** Evaluate and keep the stable prefixes of both local roles (on start, and again when the guide or the prompts change). */
export async function prewarmStrategies(server, local = DEFAULT_LOCAL) {
  const out = {};
  if (server.slots.includes('direct')) out.direct = await server.prewarm('direct', [{role: 'system', content: directSystem()}, {role: 'user', content: ''}], {extraBody: noThinking(local)});
  if (server.slots.includes('steps')) out.steps = await server.prewarm('steps', [{role: 'system', content: STEP_BY_STEP_SYSTEM}, {role: 'user', content: stepPrefix(local.method)}], {extraBody: noThinking(local)});
  return out;
}

/**
 * A runnable local strategy: `run({message, lexicon, circuits, repo, session, execute, selfCheck, onProgress, ...authorOptions})`.
 * `serverFactory` lets tests inject a stub server.
 */
export function localStrategy(name, local = {}, {serverFactory = localServer, fetchImpl = globalThis.fetch, timeoutMs = 180_000} = {}) {
  if (!LOCAL_STRATEGIES.includes(checkStrategy(name))) throw new TypeError(`${name} is not a local strategy`);
  const settings = {...DEFAULT_LOCAL, ...local};
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
      const role = name === 'LocalLLMDirect' ? 'direct' : 'steps';
      const turn = await server.begin(role);
      try {
        if (name === 'LocalLLMDirect') {
          const backend = completionBackend({endpoint: server.endpoint, model: settings.alias, timeoutMs, maxTokens: settings.maxTokens, fetchImpl,
            extraBody: {id_slot: turn.slot, ...noThinking(settings)}});
          return {...await authorQuery({message, lexicon, ...rest, backend, maxFixRounds, onProgress}), prefix_restore_ms: turn.ms};
        }
        const chat = (messages, maxTokens) => localChat({endpoint: server.endpoint, model: settings.alias, messages, maxTokens, slot: turn.slot, timeoutMs, extraBody: noThinking(settings), fetchImpl});
        const {circuits, repo, session, derived = null} = rest;
        const method = settings.method ?? 'A';
        if (!STEP_BY_STEP_METHODS.includes(method)) throw Object.assign(new Error(`unknown step-by-step method ${JSON.stringify(method)}; use one of ${STEP_BY_STEP_METHODS.join(', ')}`), {code: 'invalid_strategy'});
        const query = method === 'A' ? stepByStepQuery : protocolQuery;
        return {...await query({message, lexicon, circuits, repo, session, derived, oracle: createOracle({chat}), model: settings.alias, method, onProgress}), prefix_restore_ms: turn.ms};
      } finally { turn.release(); }
    },
  };
}
