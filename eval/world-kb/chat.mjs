/**
 * The 30-question chat check of the base memory world-v1 (eval/world-kb/questions.json), end to end and in process:
 * message -> SymbolicLM (CPU Stanza; the SOP cached by eval/world-kb/symbolic.mjs, or --live) -> the product Agent
 * (host linking with the world lexicon, retrieval slice from the SQLite repository, js-reference reasoning) -> answer packet.
 *   node eval/world-kb/chat.mjs [--live] [--only q01,q02] [--memory world-v1]
 * Writes eval/reports/current/world-kb/chat-results.json. No server and no port: the product Agent is called as a library
 * (the HTTP path adds only transport and sessions). Reads the memory; writes nothing into it (allowWrite false).
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ChatData} from '../../lib/chat-data/index.mjs';
import {BaseMemories, BASE_NAME} from '../../lib/chat-data/memories.mjs';
import {Agent} from '../../server/agent.mjs';
import {loadWorldLexicon} from '../../tools/world-kb/lexicon.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const memoryId = opt('--memory', 'world-v1');
const only = opt('--only', null)?.split(',');
const questions = JSON.parse(fs.readFileSync(path.join(project, 'eval/world-kb/questions.json'), 'utf8')).filter(q => !only || only.includes(q.id));
const cached = JSON.parse(fs.readFileSync(path.join(project, 'eval/reports/current/world-kb/symbolic-lm-sop.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(project, 'config/runtime.json'), 'utf8'));

let lm = null;
if (args.includes('--live')) { const {SymbolicLM} = await import('../../lib/symbolic-lm/index.mjs'); lm = new SymbolicLM({device: 'auto', threads: 4}); await lm.start(); }
const formalizer = id => ({id: 'symbolic-lm', formalize: async text => (lm ? (await lm.analyze(text)).sop : cached[id].sop)});

const t0 = Date.now();
const lexicon = loadWorldLexicon(path.join(project, 'datasets_sources/world-kb/ontology'));
const memories = new BaseMemories({chatData: ChatData.open(config), memory: config.memory});
const repo = memories.repository(memoryId);
const loadMs = Date.now() - t0;
const results = [];
for (const q of questions) {
  const session = repo.session(BASE_NAME, 'worldcheck', `chat-${q.id}-${Date.now()}`);
  const agent = new Agent({repo, session, lexicon, config: {...config, policy: {...config.policy, allowWrite: false, allowRules: false, allowPin: false}}});
  const started = performance.now();
  let out;
  try { out = await agent.turn(q.q, {language: 'en', rewrite: false, formalizer: formalizer(q.id)}); }
  catch (error) { out = {error: error.message}; }
  const ms = Math.round(performance.now() - started);
  const packet = out.packet ?? {};
  const text = out.cnl ?? out.text ?? '';
  const blob = (text + ' ' + JSON.stringify(packet)).toLowerCase();
  const hit = q.expect.filter(e => blob.includes(String(e).toLowerCase()));
  results.push({id: q.id, kind: q.kind, question: q.q, ms, status: packet.status ?? (out.error ? 'error' : null), answer: text, expected: q.expect, matched: hit, pass: hit.length > 0 && !out.error,
    error: out.error ?? null, retrieval: packet.retrieval ?? packet.link_plan ?? null, reason: packet.reason ?? null, required: packet.required ?? null, packet_keys: Object.keys(packet)});
  console.error(q.id, ms + 'ms', packet.status ?? out.error?.slice(0, 80), '|', text.replace(/\s+/g, ' ').slice(0, 110));
  repo.closeSession?.(session);
}
if (lm) await lm.stop();
fs.writeFileSync(path.join(project, 'eval/reports/current/world-kb/chat-results.json'), JSON.stringify({memory: memoryId, lexicon_load_ms: loadMs, results}, null, 1));
console.log(JSON.stringify({passed: results.filter(r => r.pass).length, total: results.length}));
