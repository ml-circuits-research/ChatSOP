#!/usr/bin/env node
/**
 * Harness of experiment eval-ingest-v1 (status/preregistrations/eval-ingest-v1.json): questions over documents ingested into task-type
 * base memories, answered by three arms.
 *
 *   node tools/eval/ingest-v1.mjs pipeline --doc handbook|europa [--ids h01,h02] [--model zai/glm-5.3] [--base ID] [--tag T]
 *        the product path: a session cloned from the base memory, the CodingAgent strategy with ONE model (no fallback), the shared
 *        symbolic path, the rendered English answer
 *   node tools/eval/ingest-v1.mjs direct --doc ... --arm glm [--model zai/glm-5.3]      the model reads the whole document (omp, no tools)
 *   node tools/eval/ingest-v1.mjs direct --doc ... --arm local --endpoint URL [--model NAME]   a local llama-server reads the document
 *   node tools/eval/ingest-v1.mjs score [--files a.jsonl,b.jsonl]                       correct / wrong / unknown per arm and document
 *
 * Answers go to eval/reports/current/ingest-v1/<arm>-<doc>[-tag].jsonl (one line per question). The questions and the gold are
 * eval/ingest-v1/questions.json; no model ever sees the gold.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SessionStore} from '../../server/session-store.mjs';
import {ChatData} from '../../lib/chat-data/index.mjs';
import {BaseMemories, BASE_NAME} from '../../lib/chat-data/memories.mjs';
import {Sessions} from '../../lib/chat-data/sessions.mjs';
import {TheoryCache} from '../../reasoning/slice/index.mjs';
import {agentClient} from './query-forms-probe.mjs';
import {runOmp} from '../../reasoning/strategies/llm-agent/runner.mjs';
import {localChat} from '../../lib/local-llm/client.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OUT = path.join(ROOT, 'eval/reports/current/ingest-v1');
const args = process.argv.slice(2);
const opt = (name, fallback = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
export const QUESTIONS = JSON.parse(fs.readFileSync(path.join(ROOT, 'eval/ingest-v1/questions.json'), 'utf8'));
export const DOCS = {
  handbook: {file: 'datasets_sources/ingest-v1/handbook/brindlewood-handbook.md', base: 'exp-ingest-handbook'},
  europa: {file: 'datasets_sources/ingest-v1/europa-facts/europa-facts.md', base: 'exp-ingest-europa'},
};

export function openProduct(root = path.join(ROOT, 'chat_data')) {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'runtime.json'), 'utf8'));
  config.chatData = {...config.chatData, root};
  const chatData = ChatData.open(config, {}, ROOT);
  const memories = new BaseMemories({chatData, memory: config.memory});
  return {config, memories, sessions: new Sessions({chatData, memories, memory: config.memory})};
}

/** A private session on `base` (user eval-ingest), with the chat turn machinery of the product (server/session-runtime.mjs). */
export function openSession({base, id, product = openProduct()}) {
  const {config, sessions} = product;
  fs.rmSync(sessions.dir(id), {recursive: true, force: true});
  sessions.create({base, user: 'eval-ingest', id, name: `eval-ingest-v1 ${base}`});
  const theories = new TheoryCache();
  const store = new SessionStore({repo: sessions.repository(id), lexicon: sessions.lexicon(id), config: {...config, policy: {...(config.policy ?? {}), reinforce: false}}, root: path.join(sessions.dir(id), 'agent'),
    circuitRules: () => theories.get([...sessions.baseCircuits(id), ...sessions.circuits(id)]).chatRules()});
  return {store, config, lexicon: sessions.lexicon(id), close: () => fs.rmSync(sessions.dir(id), {recursive: true, force: true})};
}

/** One question through the product path in a fresh conversation; returns the record of the answer. */
export async function askPipeline(s, question, {model}) {
  const entry = s.store.get('eval-ingest', 'c' + Math.random().toString(36).slice(2), BASE_NAME);
  const client = agentClient({config: s.config, lexicon: s.lexicon, model});
  const started = Date.now();
  try {
    const res = await entry.agent.turn(question, {formalizer: client});
    const p = res.packet ?? {};
    return {text: String(res.text ?? ''), status: p.status ?? null, kind: p.kind ?? null, count: p.count ?? null, answers: (p.answers ?? []).slice(0, 12).map(a => a.binding),
      sop: res.sop ?? null, session_circuits: p.session_circuits?.text ?? null, parse: client.last && {model: client.last.model, rounds: client.last.rounds, repairs: client.last.repairs, ms: client.last.ms, cost_usd: client.last.cost_usd, procedures: client.last.retrieval?.procedures ?? null},
      ms: Date.now() - started};
  } catch (error) {
    return {text: '', error: String(error.message).slice(0, 400), code: error.code ?? null, parse: client.last && {model: client.last.model, rounds: client.last.rounds, repairs: client.last.repairs}, ms: Date.now() - started};
  }
}

export const DIRECT_SYSTEM = 'You answer questions about one document. Use only the document. Reply with the answer in one short sentence. If the document does not contain the answer, reply exactly: The document does not say.';
const directPrompt = (doc, q) => `<document>\n${doc}\n</document>\n\nQuestion: ${q}`;

function questionsFor(doc) {
  const ids = opt('--ids') ? new Set(opt('--ids').split(',')) : null;
  return QUESTIONS.questions.filter(q => q.doc === doc && (!ids || ids.has(q.id)));
}
const outFile = (arm, doc) => path.join(OUT, `${arm}-${doc}${opt('--tag') ? '-' + opt('--tag') : ''}.jsonl`);
const append = (file, row) => fs.appendFileSync(file, JSON.stringify(row) + '\n');

/** Scores an answer text against the gold patterns of a question: correct, wrong or unknown. */
export function scoreAnswer(question, record) {
  const text = String(record.text ?? '').toLowerCase();
  const unknownText = /does not say|doesn't say|not stated|not specified|unknown|no information|cannot (be )?(determine|answer)|could not|i don't know|not enough|no answer|clarif/.test(text);
  if (record.error || !text.trim()) return question.gold === 'not_stated' ? 'correct' : 'unknown';
  if (question.gold === 'not_stated') return question.accept.some(a => new RegExp(a, 'i').test(text)) || unknownText ? 'correct' : 'wrong';
  const hit = question.accept.some(a => new RegExp(a, 'i').test(text));
  const rejected = (question.reject ?? []).some(a => new RegExp(a, 'i').test(text));
  if (hit && !rejected) return 'correct';
  if (unknownText || ['unknown', 'incomplete', 'clarify', 'not_computable', 'unsupported'].includes(record.status)) return 'unknown';
  return 'wrong';
}

async function main() {
  const command = args[0];
  fs.mkdirSync(OUT, {recursive: true});
  if (command === 'pipeline') {
    const doc = opt('--doc');
    const model = opt('--model', 'zai/glm-5.3');
    const s = openSession({base: opt('--base', DOCS[doc].base), id: `eval-ingest-${doc}${opt('--tag') ? '-' + opt('--tag') : ''}`});
    const file = outFile('pipeline', doc);
    try {
      for (const q of questionsFor(doc)) {
        const r = await askPipeline(s, q.q, {model});
        const row = {id: q.id, q: q.q, arm: 'pipeline', model, ...r};
        row.score = scoreAnswer(q, row);
        append(file, row);
        console.log(JSON.stringify({id: q.id, score: row.score, status: row.status, text: row.text.slice(0, 160), error: row.error, ms: row.ms}));
      }
    } finally { s.close(); }
  } else if (command === 'direct') {
    const doc = opt('--doc');
    const arm = opt('--arm', 'glm');
    const text = fs.readFileSync(path.join(ROOT, DOCS[doc].file), 'utf8');
    const file = outFile(arm, doc);
    for (const q of questionsFor(doc)) {
      let r;
      if (arm === 'glm') {
        const model = opt('--model', 'zai/glm-5.3');
        const out = await runOmp({model, system: DIRECT_SYSTEM, prompt: directPrompt(text, q.q), timeoutMs: 240_000});
        r = {model, text: out.text ?? '', ...(out.ok ? {} : {error: out.error}), cost_usd: out.cost ?? 0, ms: out.ms};
      } else {
        const out = await localChat({endpoint: opt('--endpoint'), model: opt('--model', 'local'), messages: [{role: 'system', content: DIRECT_SYSTEM}, {role: 'user', content: directPrompt(text, q.q)}], maxTokens: 200, timeoutMs: 300_000});
        r = {model: opt('--model', 'local'), text: out.text ?? '', ...(out.ok ? {} : {error: out.reason}), ms: out.ms, usage: out.usage};
      }
      const row = {id: q.id, q: q.q, arm, ...r};
      row.score = scoreAnswer(q, row);
      append(file, row);
      console.log(JSON.stringify({id: q.id, score: row.score, text: row.text.slice(0, 160), error: row.error, ms: row.ms}));
    }
  } else if (command === 'score') {
    const files = opt('--files') ? opt('--files').split(',') : fs.readdirSync(OUT).filter(f => f.endsWith('.jsonl'));
    const byId = new Map(QUESTIONS.questions.map(q => [q.id, q]));
    const table = {};
    for (const f of files) {
      const rows = fs.readFileSync(path.join(OUT, path.basename(f)), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
      const last = new Map(rows.map(r => [r.id, r]));
      const t = {n: 0, correct: 0, wrong: 0, unknown: 0, median_ms: null};
      const ms = [];
      for (const r of last.values()) { const s = r.manual ?? scoreAnswer(byId.get(r.id), r); t.n++; t[s]++; ms.push(r.ms ?? 0); }
      ms.sort((a, b) => a - b);
      t.median_ms = ms.length ? ms[Math.floor(ms.length / 2)] : null;
      table[path.basename(f, '.jsonl')] = t;
    }
    console.log(JSON.stringify(table, null, 2));
  } else {
    console.error('usage: node tools/eval/ingest-v1.mjs pipeline|direct|score ... (see the header)');
    process.exit(2);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().then(() => process.exit(0), error => { console.error(error.stack); process.exit(1); });
