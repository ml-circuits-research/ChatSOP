/**
 * The system under test of the books evaluation: the product chat turn (server/agent.mjs) over the default chat base memory, with the
 * request parser of the step-by-step strategy LocalLLMStepByStep (method B; or InternalReasoningStepByStep) whose questions go to one
 * proxy tier (`tier`, like with like: every tier answers the same questions), to the product's tier ladder (`ladder: true`), or to a
 * local Qwen3-4B-Instruct Q4_K_M llama-server (lib/local-llm: prompt cache on, dedicated slots, stable prefixes prewarmed). One-shot
 * formalization (LLMDirect) was archived on 2026-10-02 (probably_obsolete/one-shot-formalization/). One session, one fresh conversation
 * entry per problem: the facts a problem states are turn evidence of that entry only (caller-owned context), never written to the memory.
 */
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SessionStore} from '../../../server/session-store.mjs';
import {ChatData} from '../../../lib/chat-data/index.mjs';
import {BaseMemories, BASE_NAME} from '../../../lib/chat-data/memories.mjs';
import {Sessions} from '../../../lib/chat-data/sessions.mjs';
import {TheoryCache} from '../../../reasoning/slice/index.mjs';
import {createQueryParser, queryParserSettings} from '../../../server/query-parser.mjs';
import {DEFAULT_LOCAL} from '../../../lib/formalize/strategies.mjs';
import {createChatSOPAdapter, parserFormalizer} from '../../../lib/adapter/index.mjs';
import fs from 'node:fs';
import {localServer, localChat} from '../../../lib/local-llm/index.mjs';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const MODEL_GGUF = path.join(path.dirname(new URL(import.meta.url).pathname), '../../../models/qwen3-4b-instruct/gguf/q4_k_m.gguf');
export const LOCAL = {...DEFAULT_LOCAL, gguf: MODEL_GGUF, alias: 'qwen3-4b-instruct', port: 19611, slots: ['direct', 'steps'], ctxPerSlot: 16384, maxTokens: 1500, thinking: false, method: 'B'};

/** The default chat base memory (config chatData.defaultBase, world-v1 over core-en and commonsense-v1) in a private session; `endpoint` reuses a running llama-server. */
// `sessionId` lets several turn systems run side by side (one session each); `parserOptions` adds query-parser settings (for example
// `reportErrors: false` for a harness that reports by itself) and `headers` tag the proxy calls of a tier (purpose, no fallback).
export async function openChatTurn({base = null, endpoint = null, wallMs = 300_000, strategy = 'LocalLLMStepByStep', tier = null, ladder = false, sessionId = null, parserOptions = {}, headers = null, replay = null, localExtra = {}, mode = 'stepwise'} = {}) {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'runtime.json'), 'utf8'));
  const chatData = ChatData.open(config, {}, ROOT);
  const memories = new BaseMemories({chatData, memory: config.memory});
  const sessions = new Sessions({chatData, memories, memory: config.memory});
  const baseId = base ?? config.chatData?.defaultBase ?? 'world-v1';
  const id = sessionId ?? `books-eval-${process.pid}`;
  fs.rmSync(sessions.dir(id), {recursive: true, force: true});
  sessions.create({base: baseId, user: 'books-eval', id, name: 'books evaluation'});
  const theories = new TheoryCache();
  const lexicon = sessions.lexicon(id);
  const store = new SessionStore({repo: sessions.repository(id), lexicon, config: {...config, policy: {...(config.policy ?? {}), reinforce: false}}, root: path.join(sessions.dir(id), 'agent'),
    circuitRules: () => theories.get([...sessions.baseCircuits(id), ...sessions.circuits(id)]).chatRules()});
  // `tier`: the step-by-step questions go to one proxy tier (`tiny`, `small`, `good`, ...) instead of a llama-server endpoint; `ladder`:
  // to the product's configured ladder (queryParser.local.ladder), escalating per question.
  const tiered = tier || ladder;
  const local = tiered ? {method: 'B', tier: tier ?? config.queryParser?.local?.tier ?? 'tiny', ladder: ladder ? config.queryParser?.local?.ladder ?? null : tierRung(config, tier),
    maxTokens: LOCAL.maxTokens, thinking: false, ...(headers ? {headers} : {}), ...(replay ? {replay} : {}), ...localExtra} : {...LOCAL, ...(endpoint ? {endpoint} : {})};
  const settings = queryParserSettings({queryParser: {...(config.queryParser ?? {}), ...parserOptions, strategy, local, cacheEntries: 0, timeoutSeconds: wallMs / 1000}});
  const parser = createQueryParser({settings});
  // ChatSOPAdapter (lib/adapter): the same backend as the chat; `mode` stepwise unless a harness asks for routed or direct-verified.
  const adapter = createChatSOPAdapter({config});
  // A proxy tier needs no local llama-server (LLMDirect was archived on 2026-10-02).
  const remote = Boolean(tiered);
  const server = remote ? null : localServer(local);
  if (!remote && !endpoint && await server.healthy()) throw new Error(`port ${local.port} already answers (another llama-server); use --endpoint to reuse it deliberately`);
  let n = 0;
  return {
    baseId, sessionId: id, lexicon, local, server, memoryDigest: lexicon.circuitsSha256 ?? null,
    /**
     * One chat turn: the problem is the user message. Never throws: `error` carries code and message of a failed turn. `sop` replays a
     * stored circuit instead of formalizing (no model call); `authored` is the circuit the formalizer returned, as it returned it.
     */
    async ask(message, {sop = null} = {}) {
      const entry = store.get('books', `c${++n}`, BASE_NAME);
      let parse = null, steps = null, authored = null;
      // The circuit author of the chat (ChatSOPAdapter's parserFormalizer); `sop` replays a stored circuit without a model call.
      const author = parserFormalizer(parser, {lexicon, source: 'eval:books', request: {strategy}});
      const formalizer = {id: 'books-eval', formalize: async text => {
        if (sop != null) { parse = {strategy: 'replay'}; authored = sop; return sop; }
        authored = await author.formalize(text); parse = author.parse; return authored;
      }};
      const started = Date.now();
      // Problems are independent: a session definition one problem adds to the session layer is removed after it (no carry-over).
      const circuitsDir = path.join(sessions.dir(id), 'circuits');
      const before = new Set(fs.existsSync(circuitsDir) ? fs.readdirSync(circuitsDir) : []);
      try {
        // The turn through ChatSOPAdapter (lib/adapter), the chat's own backend: `mode` stepwise is the chat turn above; routed and
        // direct-verified answer the problem as the chat does in those modes.
        const answered = await adapter.answer({message, mode, stepwise: {agent: entry.agent, formalizer}, lexicon});
        if (answered.mode !== 'stepwise') {
          const {packet, turn, ...summary} = answered;
          return {ok: true, ms: Date.now() - started, sop: answered.circuits.map(c => c.sop).join('\n\n') || null, authored: null, executionSop: null, text: answered.answer.text, packet: {...(packet ?? {}), adapter: summary}, trace: [], parse: null, userStatements: [], unclear: null, steps, adapter: summary};
        }
        const res = answered.turn;
        return {ok: true, ms: Date.now() - started, sop: res.sop, authored, executionSop: res.executionSop, text: res.text, packet: res.packet, trace: res.trace, parse,
          userStatements: res.userStatements, unclear: res.unclear, steps};
      } catch (e) {
        return {ok: false, ms: Date.now() - started, authored, error: {code: e.code ?? e.name, message: String(e.message).slice(0, 400), ...(e.attempt ? {problems: e.attempt.problems} : {})}, parse: e.parse ?? parse, sop: e.modelSop ?? e.attempt?.sop ?? null};
      } finally {
        // Each problem is its own conversation: release its repository session (a clone of the base memory is large) and its state.
        store.agents.delete(entry.key);
        try { store.repo.discard(entry.agent.session); } catch { /* already gone */ }
        if (fs.existsSync(circuitsDir)) for (const f of fs.readdirSync(circuitsDir)) if (!before.has(f)) fs.rmSync(path.join(circuitsDir, f), {recursive: true, force: true});
      }
    },
    /** The baseline: the same model answers directly (short working, then a final line), on the direct slot of the same server. */
    async direct(message, {maxTokens = 1024} = {}) {
      // On a proxy tier the baseline asks the same tier (same model as the steps arm), tagged like the steps calls.
      if (tiered) return localChat({endpoint: PROXY_ENDPOINT, model: local.tier, maxTokens, timeoutMs: wallMs, headers: headers ?? {}, extraBody: {chat_template_kwargs: {enable_thinking: false}},
        messages: [{role: 'system', content: DIRECT_SYSTEM}, {role: 'user', content: message}]});
      await server.ensure();
      const turn = await server.begin('direct');
      try {
        return await localChat({endpoint: server.endpoint, model: local.alias, slot: turn.slot, maxTokens, timeoutMs: wallMs,
          extraBody: {chat_template_kwargs: {enable_thinking: false}},
          messages: [{role: 'system', content: DIRECT_SYSTEM}, {role: 'user', content: message}]});
      } finally { turn.release(); }
    },
    async close() { fs.rmSync(sessions.dir(id), {recursive: true, force: true}); adapter.dispose(); await parser.stop(); await server?.stop(); },
  };
}

/**
 * The single-rung ladder of one tier, with the request settings the product ladder gives that tier (for example reasoning off on
 * `good`), so a tier answers exactly as it would inside the product ladder; null when the product ladder does not name it.
 */
export function tierRung(config, tier) {
  const rung = (config.queryParser?.local?.ladder ?? []).find(r => (typeof r === 'string' ? r : r?.tier) === tier);
  return rung && typeof rung === 'object' ? [rung] : null;
}

/** LLMAPIProvider (OpenAI-compatible); a tier name is the model. */
export const PROXY_ENDPOINT = 'http://127.0.0.1:18080/v1';
export const DIRECT_SYSTEM = 'You solve reasoning problems. Use only the facts and rules given in the problem. Work briefly step by step, then finish with one line that starts with "Final answer:" and states the answer concisely (numbers with units, a name, yes or no, or "not enough information" when the data do not decide).';
