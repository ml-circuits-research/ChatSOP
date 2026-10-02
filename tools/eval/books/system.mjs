/**
 * The system under test of the books evaluation: the product chat turn (server/agent.mjs) over the default chat base memory, with the
 * request parser of the strategy LocalLLMStepByStep (method B) on a local Qwen3-4B-Instruct Q4_K_M llama-server (lib/local-llm: prompt
 * cache on, dedicated slots, stable prefixes prewarmed). One session, one fresh conversation entry per problem: the facts a problem
 * states are turn evidence of that entry only (caller-owned context), never written to the memory.
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
import fs from 'node:fs';
import {localServer, localChat} from '../../../lib/local-llm/index.mjs';
import {ompSettings, createOmpModels} from '../../../lib/omp/index.mjs';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const MODEL_GGUF = path.join(os.homedir(), 'models/local-judge/Qwen3-4B-Instruct-2507-Q4_K_M.gguf');
export const LOCAL = {...DEFAULT_LOCAL, gguf: MODEL_GGUF, alias: 'qwen3-4b-instruct', port: 19611, slots: ['direct', 'steps'], ctxPerSlot: 16384, maxTokens: 1500, thinking: false, method: 'B'};

/** The default chat base memory (config chatData.defaultBase, world-v1 over core-en and commonsense-v1) in a private session; `endpoint` reuses a running llama-server. */
export async function openChatTurn({base = null, endpoint = null, wallMs = 300_000, strategy = 'LocalLLMStepByStep', model = null} = {}) {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'runtime.json'), 'utf8'));
  const chatData = ChatData.open(config, {}, ROOT);
  const memories = new BaseMemories({chatData, memory: config.memory});
  const sessions = new Sessions({chatData, memories, memory: config.memory});
  const baseId = base ?? config.chatData?.defaultBase ?? 'world-v1';
  const id = `books-eval-${process.pid}`;
  fs.rmSync(sessions.dir(id), {recursive: true, force: true});
  sessions.create({base: baseId, user: 'books-eval', id, name: 'books evaluation'});
  const theories = new TheoryCache();
  const lexicon = sessions.lexicon(id);
  const store = new SessionStore({repo: sessions.repository(id), lexicon, config: {...config, policy: {...(config.policy ?? {}), reinforce: false}}, root: path.join(sessions.dir(id), 'agent'),
    circuitRules: () => theories.get([...sessions.baseCircuits(id), ...sessions.circuits(id)]).chatRules()});
  const local = {...LOCAL, ...(endpoint ? {endpoint} : {})};
  const coding = strategy === 'CodingAgent';
  const settings = queryParserSettings({queryParser: {...(config.queryParser ?? {}), strategy, local, cacheEntries: 0, timeoutSeconds: wallMs / 1000,
    ...(model ? {models: [model], backend: {...(config.queryParser?.backend ?? {}), model}} : {})}});
  const omp = coding ? ompSettings(config) : null;
  const parser = createQueryParser({settings, ...(coding ? {ompConfig: omp, ompModels: createOmpModels(omp)} : {})});
  const server = coding ? null : localServer(local);
  if (!coding && !endpoint && await server.healthy()) throw new Error(`port ${local.port} already answers (another llama-server); use --endpoint to reuse it deliberately`);
  let n = 0;
  return {
    baseId, sessionId: id, lexicon, local, server, memoryDigest: lexicon.circuitsSha256 ?? null,
    /** One chat turn: the problem is the user message. Never throws: `error` carries code and message of a failed turn. */
    async ask(message) {
      const entry = store.get('books', `c${++n}`, BASE_NAME);
      let parse = null, steps = null;
      const formalizer = {id: 'books-eval', formalize: async text => {
        const done = await parser.parse({message: text, lexicon, memoryKey: lexicon.circuitsSha256 ?? null, strategy});
        parse = done.parse; return done.sop;
      }};
      const started = Date.now();
      try {
        const res = await entry.agent.turn(message, {formalizer});
        return {ok: true, ms: Date.now() - started, sop: res.sop, executionSop: res.executionSop, text: res.text, packet: res.packet, trace: res.trace, parse,
          userStatements: res.userStatements, unclear: res.unclear, steps};
      } catch (e) {
        return {ok: false, ms: Date.now() - started, error: {code: e.code ?? e.name, message: String(e.message).slice(0, 400)}, parse: e.parse ?? parse, sop: e.modelSop ?? null};
      } finally {
        // Each problem is its own conversation: release its repository session (a clone of the base memory is large) and its state.
        store.agents.delete(entry.key);
        try { store.repo.discard(entry.agent.session); } catch { /* already gone */ }
      }
    },
    /** The baseline: the same model answers directly (short working, then a final line), on the direct slot of the same server. */
    async direct(message, {maxTokens = 1024} = {}) {
      await server.ensure();
      const turn = await server.begin('direct');
      try {
        return await localChat({endpoint: server.endpoint, model: local.alias, slot: turn.slot, maxTokens, timeoutMs: wallMs,
          extraBody: {chat_template_kwargs: {enable_thinking: false}},
          messages: [{role: 'system', content: DIRECT_SYSTEM}, {role: 'user', content: message}]});
      } finally { turn.release(); }
    },
    async close() { fs.rmSync(sessions.dir(id), {recursive: true, force: true}); await parser.stop(); await server?.stop(); },
  };
}

export const DIRECT_SYSTEM = 'You solve reasoning problems. Use only the facts and rules given in the problem. Work briefly step by step, then finish with one line that starts with "Final answer:" and states the answer concisely (numbers with units, a name, yes or no, or "not enough information" when the data do not decide).';
