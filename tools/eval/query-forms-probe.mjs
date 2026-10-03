#!/usr/bin/env node
/**
 * Probe for the query-form work (experiment eval-query-forms-v1): asks questions of the base memory world-v1 through the product
 * Agent, either with the step-by-step formalizer (config/runtime.json queryParser; `--tier tiny|small|medium|good` answers its questions
 * on one TinyAgent tier, default the product ladder; LLMDirect is archived) or with a given SOP (`--sop file`).
 *   node tools/eval/query-forms-probe.mjs --q "How many countries border Germany?" [--sop file] [--base world-v1] [--tier T]
 * Prints the SOP, the circuit status, the answer and the retrieval/linking summary. Sessions are private to user `qf-probe` and deleted.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SessionStore} from '../../server/session-store.mjs';
import {ChatData} from '../../lib/chat-data/index.mjs';
import {BaseMemories, BASE_NAME} from '../../lib/chat-data/memories.mjs';
import {Sessions} from '../../lib/chat-data/sessions.mjs';
import {TheoryCache} from '../../reasoning/slice/index.mjs';
import {createQueryParser} from '../../server/query-parser.mjs';
import {tierParserSettings} from './tier-parser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };

/** The private chat data root with the world-v1 rebuilt on the current core-en (`QF_CHAT_ROOT`), else the product root. */
export const defaultRoot = () => process.env.QF_CHAT_ROOT ?? ['chat_data2', 'chat_data'].map(d => path.join(ROOT, 'datasets_sources/query-forms', d)).find(d => fs.existsSync(path.join(d, 'base_memories/world-v1'))) ?? path.join(ROOT, 'chat_data');

export function openWorld({root = defaultRoot()} = {}) {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'runtime.json'), 'utf8'));
  config.chatData = {...config.chatData, root};
  const chatData = ChatData.open(config, {}, ROOT);
  const memories = new BaseMemories({chatData, memory: config.memory});
  const sessions = new Sessions({chatData, memories, memory: config.memory});
  return {config, sessions};
}

/** The formalizer of the probe: the step-by-step questions over the session's memory (no cache, so every call is a measurement). */
export function agentClient({config, lexicon, tier = opt('--tier', null), headers = null}) {
  const queryParser = createQueryParser({settings: tierParserSettings(config, {tier, cacheEntries: 0, ...(headers ? {headers} : {})})});
  return {id: 'step-by-step', last: null, async formalize(text) { const r = await queryParser.parse({source: 'eval:query-forms', message: text, lexicon, memoryKey: lexicon.circuitsSha256 ?? null}); this.last = r.parse; return r.sop; }};
}

export function openSession({base = 'world-v1', id = 'qf-probe'} = {}) {
  const {config, sessions} = openWorld();
  fs.rmSync(sessions.dir(id), {recursive: true, force: true});
  sessions.create({base, user: 'qf-probe', id, name: 'query forms probe'});
  const repo = sessions.repository(id);
  const theories = new TheoryCache();
  // like the product (server/session-runtime.mjs): the chat turn plans with the rules of the memory's circuits
  const store = new SessionStore({repo, lexicon: sessions.lexicon(id), config: {...config, policy: {...(config.policy ?? {}), reinforce: false, ...JSON.parse(process.env.QF_LIMITS ?? '{}')}}, root: path.join(sessions.dir(id), 'agent'),
    circuitRules: () => theories.get([...sessions.baseCircuits(id), ...sessions.circuits(id)]).chatRules()});
  return {store, sessions, id, theories, config, lexicon: sessions.lexicon(id), close: () => fs.rmSync(sessions.dir(id), {recursive: true, force: true})};
}

if (process.argv[1] === fileURLToPath(import.meta.url) && opt('--batch', null)) {
  // --batch file: one question per line; prints one compact JSON line per question (status, answer values, linked relation, clarification)
  const s = openSession({base: opt('--base', 'world-v1')});
  try {
    for (const q of fs.readFileSync(opt('--batch'), 'utf8').split('\n').map(l => l.trim()).filter(Boolean)) {
      const entry = s.store.get('qf', 'c' + Math.random().toString(36).slice(2), BASE_NAME);
      let line;
      try {
        const res = await entry.agent.turn(q, {formalizer: agentClient({config: s.config, lexicon: s.lexicon})});
        const p = res.packet ?? {};
        line = {q, status: p.status, kind: p.kind, count: p.count, values: (p.answers ?? []).slice(0, 8).map(a => Object.values(a.binding ?? {}).join('/')), complete: p.complete, text: p.status === 'supported' || p.status === 'refuted' ? undefined : String(res.text).slice(0, 160)};
      } catch (error) { line = {q, error: String(error.message).slice(0, 200)}; }
      console.log(JSON.stringify(line));
    }
  } finally { s.close(); }
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const q = opt('--q', null);
  const sopFile = opt('--sop', null);
  const s = openSession({base: opt('--base', 'world-v1')});
  const formalizer = sopFile ? {id: 'fixed', formalize: async () => fs.readFileSync(sopFile, 'utf8')} : agentClient({config: s.config, lexicon: s.lexicon});
  try {
    const entry = s.store.get('qf', 'c1', BASE_NAME);
    const res = await entry.agent.turn(q, {formalizer});
    console.log(JSON.stringify({sop: res.sop, text: res.text, status: res.packet?.status, kind: res.packet?.kind, count: res.packet?.count, answers: (res.packet?.answers ?? []).slice(0, 12).map(a => a.binding), reason: res.packet?.reason, complete: res.packet?.complete, retrieval: res.packet?.retrieval && {complete: res.packet.retrieval.complete, why: res.packet.retrieval.why ?? res.packet.retrieval.reason}, linking: res.packet?.linking?.slice?.(0, 6)}, null, 1));
  } finally { s.close(); }
  process.exit(0);
}
