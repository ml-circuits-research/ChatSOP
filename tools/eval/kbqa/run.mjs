/**
 * Runs the product chain on every question of a suite stage (tools/eval/kbqa.mjs `run`), in process:
 *   question -> SymbolicLM service (private port, KBQA_SLM_URL, default http://127.0.0.1:19411; message only) -> Agent (server/agent.mjs:
 *   admission, KnowledgeLinker over the lexicon of the session's base memory, reference route) -> packet.
 * Every question gets its own conversation (no carried context); the session is the clone of the stage's base memory, and reads do not
 * reinforce (policy.reinforce false), so the questions of a stage cannot influence each other. Nothing of the gold reaches the chain.
 * One record per question is appended to eval/reports/current/kbqa/<suite>/stage-<n>.jsonl; a rerun resumes unless --force.
 */
import fs from 'node:fs';
import path from 'node:path';
import {SessionStore} from '../../../server/session-store.mjs';
import {BASE_NAME} from '../../../lib/chat-data/memories.mjs';
import {ROOT} from './benchmarks.mjs';
import {readSuite} from './suites.mjs';
import {openData, memoryId} from './memory.mjs';

export const reportDir = suite => path.join(ROOT, 'eval', 'reports', 'current', 'kbqa', suite);
export const stageFile = (suite, stage, tag = '') => path.join(reportDir(suite), `stage-${stage}${tag}.jsonl`);
const SLM_URL = process.env.KBQA_SLM_URL ?? 'http://127.0.0.1:19411';
const TIMEOUT_MS = Number(process.env.KBQA_TURN_TIMEOUT_MS ?? 60000);

/** The message-only SymbolicLM client; keeps the last service report (route, language, uncertainty, analysis) for the record. */
function symbolicLm() {
  const client = {id: 'symbolic-lm', last: null, async formalize(text) {
    const res = await fetch(`${SLM_URL}/v1/chat/completions`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({messages: [{role: 'user', content: text}]}), signal: AbortSignal.timeout(TIMEOUT_MS)});
    if (!res.ok) throw Object.assign(new Error(`SymbolicLM HTTP ${res.status}`), {layer: 'symbolic_lm_service'});
    const body = await res.json();
    client.last = {route: body.symbolic_lm?.route ?? null, language: body.symbolic_lm?.language ?? null, uncertainty: body.symbolic_lm?.uncertainty ?? null, ms: body.timings?.total_ms ?? null};
    return body.choices[0].message.content;
  }};
  return client;
}

const healthNow = async () => { try { const r = await fetch(`${SLM_URL}/health`, {signal: AbortSignal.timeout(8000)}); return r.ok; } catch { return false; } };
async function waitHealthy(ms) { const end = Date.now() + ms; while (Date.now() < end) { if (await healthNow()) return true; await new Promise(r => setTimeout(r, 5000)); } return false; }

const bindingValue = v => (typeof v === 'string' ? v : v == null ? null : String(v));

/** The comparable answer of a result packet: {kind: 'entities'|'boolean'|'number'|'values'|'none', ...}. */
export function answerOfPacket(packet) {
  if (!packet) return {kind: 'none'};
  const status = packet.status;
  // Open world: a packet whose status is not a definite one (unknown, clarify, ...) carries no answer, whatever count or bindings it holds.
  if (!['supported', 'refuted', 'contradicted', 'false', 'conflicted'].includes(status)) return {kind: 'none', status};
  const answers = (packet.answers ?? []).map(a => Object.values(a.binding ?? {})).filter(v => v.length);
  if (packet.kind === 'count' || typeof packet.count === 'number') return {kind: 'number', value: packet.count ?? answers.length, status};
  if (packet.kind === 'exists' || (packet.query?.mode === 'exists')) {
    if (status === 'supported') return {kind: 'boolean', value: true, status};
    if (status === 'refuted' || status === 'contradicted' || status === 'false') return {kind: 'boolean', value: false, status};
    return {kind: 'none', status};
  }
  if (answers.length) return {kind: 'values', values: answers.flat().map(bindingValue).filter(Boolean), status};
  return {kind: 'none', status};
}

function conclude(packet) {
  const q = packet?.query ?? {};
  return {status: packet?.status ?? null, kind: packet?.kind ?? null, reason: packet?.reason ?? null, complete: packet?.complete ?? null, mode: q.mode ?? null,
    where: (q.where ?? []).map(w => ({p: w.p, a: w.a, neg: w.neg})), required: packet?.required ?? null, answer: answerOfPacket(packet),
    route: packet?.route ? {backend: packet.route.backend, fallback: packet.route.fallback} : null, strategy: packet?.reasoningStrategy ?? null,
    unresolved_spans: packet?.unresolved_spans?.map(s => ({span: s.span, hint: s.hint})) ?? [], clarification: packet?.text ?? null,
    linking: packet?.linking ?? null, retrieval: packet?.retrieval ?? null, reason_detail: packet?.reason ?? null};
}

export async function runSuite(suite, {stage = '100', limit = null, only = null, force = false, tag = '', variant = '', log = console.error} = {}) {
  const rows = readSuite(suite, stage).filter(r => !only || r.id === only || r.type === only).slice(0, limit ? Number(limit) : undefined);
  const {config, sessions} = openData();
  const base = memoryId(suite, stage, variant);
  const sid = `run-${suite}-${stage}${variant ? `-${variant}` : ''}`.slice(0, 60);
  // A fresh clone of the stage's base memory for every run.
  fs.rmSync(sessions.dir(sid), {recursive: true, force: true});
  sessions.create({base, user: 'kbqa', id: sid, name: `KBQA ${suite} ${stage}`});
  const repo = sessions.repository(sid);
  const store = new SessionStore({repo, lexicon: sessions.lexicon(sid), config: {...config, policy: {...(config.policy ?? {}), reinforce: false}}, root: path.join(sessions.dir(sid), 'agent')});
  const out = stageFile(suite, stage, tag);
  fs.mkdirSync(path.dirname(out), {recursive: true});
  const done = new Set(!force && fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).id) : []);
  if (force) fs.rmSync(out, {force: true});
  const lm = symbolicLm();
  let n = 0, stalled = 0;
  for (const row of rows) {
    if (done.has(row.id)) continue;
    const t0 = performance.now();
    const rec = {id: row.id, type: row.type, question: row.question, stage};
    // A message that hangs SymbolicLM (an infinite loop in the service) shows as a timeout with an unhealthy service: wait for the keeper's
    // restart and retry once; a second hang is the result `symbolic_lm_hang` (a real SymbolicLM failure). A timeout with a healthy
    // service is not recorded (a resume redoes it).
    for (let attempt = 1; attempt <= 2; attempt++) {
      for (const key of Object.keys(rec)) if (!['id', 'type', 'question', 'stage'].includes(key)) delete rec[key];
      lm.last = null;
      try {
        const entry = store.get('kbqa', `c${rows.indexOf(row)}-${attempt}`, BASE_NAME);
        const res = await Promise.race([
          entry.agent.turn(row.question, {language: 'en', answerLanguage: 'en', languageSource: 'api', formalizer: lm}),
          new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('turn time limit'), {layer: 'timeout'})), TIMEOUT_MS + 30000)),
        ]);
        Object.assign(rec, {sop: res.sop, exec_sop: res.executionSop?.slice(0, 4000), text: res.text, ...conclude(res.packet), formalization_ms: res.formalization?.ms, lm: lm.last});
      } catch (error) {
        Object.assign(rec, {error: String(error.message).slice(0, 400), error_layer: error.layer ?? (error.modelSop !== undefined ? 'sop_admission' : 'chain'), sop: error.modelSop ?? null, lm: lm.last});
      }
      if (!(rec.error_layer === 'timeout' || /SymbolicLM|timeout|aborted|fetch failed|ECONNREFUSED|terminated/i.test(rec.error ?? ''))) break;
      const healthy = await waitHealthy(attempt === 1 ? 240000 : 5000);
      if (healthy && attempt === 1 && (await healthNow())) { /* slow but alive: retry once */ }
      if (attempt === 2) { rec.error_layer = 'symbolic_lm_hang'; rec.error = 'SymbolicLM did not answer twice (the service stopped answering health checks); ' + rec.error; }
    }
    rec.ms = Math.round(performance.now() - t0);
    if (rec.error_layer === 'timeout' || (rec.error_layer !== 'symbolic_lm_hang' && /SymbolicLM|timeout|aborted|fetch failed|ECONNREFUSED|terminated/i.test(rec.error ?? ''))) {
      if (++stalled >= 3) throw new Error('SymbolicLM service unresponsive (3 consecutive timeouts); the run stopped and can be resumed');
      continue;
    }
    stalled = 0;
    fs.appendFileSync(out, JSON.stringify(rec) + '\n');
    if (++n % 10 === 0) log(`[kbqa ${suite}/${stage}] ${n + done.size}/${rows.length}`);
  }
  return {suite, stage, questions: rows.length, ran: n, resumed: done.size, file: path.relative(ROOT, out)};
}
