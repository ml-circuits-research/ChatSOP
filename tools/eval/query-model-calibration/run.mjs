#!/usr/bin/env node
/**
 * Runs one model of eval-query-model-calibration-v1 over a stage and appends one JSON line per question (resumable).
 *   node tools/eval/query-model-calibration/run.mjs --model qwen3-4b-q4 --stage 50 [--cpu] [--limit N] [--out DIR] [--rows dev.jsonl]
 * For a local model the script starts its llama-server on a private port (refusing when the GPU is busy), runs, and stops it.
 * Latency is wall clock from the message in to the validated circuit out (authorQuery), split by round; execution of the circuit
 * on world-v1 is timed separately (it is the same for every model).
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {authorQuery} from '../../../lib/query-author/index.mjs';
import {BASE_NAME} from '../../../lib/chat-data/memories.mjs';
import {openSession} from '../query-forms-probe.mjs';
import {MODELS, CPU_VARIANT} from './models.mjs';
import {timedOmpBackend, ompOneShotBackend, localBackend} from './backends.mjs';
import {startServer} from './servers.mjs';
import {loadRows, stageRows} from './rows.mjs';
import {classify} from './score.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const flag = n => args.includes(n);
const key = opt('--model');
const cpu = flag('--cpu');
const stage = opt('--stage', '50');
const out = path.resolve(ROOT, opt('--out', 'eval/reports/current/query-model-calibration'));
const spec = MODELS[key];
if (!spec) throw new Error(`unknown model ${key}; one of ${Object.keys(MODELS).join(', ')}`);
const runId = cpu ? CPU_VARIANT[key]?.id : key;
if (!runId) throw new Error(`no CPU variant of ${key}`);
fs.mkdirSync(out, {recursive: true});
const resultFile = path.join(out, `${runId}.jsonl`);
const done = new Set(fs.existsSync(resultFile) ? fs.readFileSync(resultFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).id) : []);
let rows = stageRows(loadRows({dev: opt('--rows') ? path.resolve(opt('--rows')) : undefined}), stage);
if (opt('--limit')) rows = rows.slice(0, Number(opt('--limit')));
rows = rows.filter(r => !done.has(r.id));
console.error(`[${runId}] ${rows.length} rows to run (${done.size} already done), stage ${stage}`);

let server = null;
const sink = [];
let backend;
if (spec.kind === 'local') {
  const v = cpu ? CPU_VARIANT[key] : {port: spec.port, threads: null, ngl: 99};
  server = await startServer({gguf: spec.gguf, port: v.port, ctx: spec.ctx, threads: v.threads, ngl: v.ngl, logFile: path.join(out, `llama-server-${runId}.log`), alias: key});
  backend = localBackend({endpoint: server.endpoint, model: key, extraBody: spec.extraBody ?? {}, sink});
} else if (spec.kind === 'omp-oneshot') backend = ompOneShotBackend({model: spec.model});
else backend = timedOmpBackend({model: spec.model, timeoutMs: 180_000});

const stop = async () => { if (server) await server.stop(); };
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await stop(); process.exit(1); });

const s = openSession({base: 'world-v1', id: `qmc-${runId}`});
const lexicon = s.sessions.lexicon(`qmc-${runId}`);
const folders = path.join(out, 'folders', runId);
fs.rmSync(folders, {recursive: true, force: true});
let budgetUsd = 0;
try {
  for (const row of rows) {
    const timings = [];
    const wrapped = {...backend, async generate(a) { const o = await backend.generate(a); timings.push(o.timing ?? {wall_ms: o.duration_ms}); return o; }};
    let author;
    try { author = await authorQuery({message: row.question, lexicon, backend: wrapped, folder: path.join(folders, row.id), maxFixRounds: 3}); }
    catch (error) { author = {status: 'failed', reason: String(error.message).slice(0, 200), rounds: 0, usage: {}, duration_ms: 0, runs: []}; }
    let packet = null, execMs = null, execError = null;
    if (author.status === 'validated' && !author.unclear) {
      const entry = s.store.get('qf', 'c' + Math.random().toString(36).slice(2), BASE_NAME);
      const t0 = Date.now();
      try { packet = (await entry.agent.turn(row.question, {formalizer: {id: 'fixed', formalize: async () => author.sop}})).packet ?? null; }
      catch (error) { execError = String(error.message).slice(0, 200); }
      execMs = Date.now() - t0;
    }
    const verdict = classify({author, packet, row});
    const record = {id: row.id, set: row.set, form: row.form, question: row.question, model: runId, outcome: verdict.outcome, reason: verdict.reason ?? execError ?? null, answer: verdict.answer ?? null, gold: row.gold,
      author_status: author.status, rounds: author.rounds, repairs: Math.max(0, (author.rounds ?? 1) - 1), unclear: author.unclear ?? null, unlinked: author.unlinked ?? [],
      latency_ms: author.duration_ms, round_ms: (author.runs ?? []).map(r => r.duration_ms), timings, exec_ms: execMs,
      tokens_in: author.usage?.input_tokens ?? 0, tokens_out: author.usage?.output_tokens ?? 0, cost_usd: author.usage?.cost_usd ?? 0, sop: author.sop, packet_status: packet?.status ?? null};
    budgetUsd += record.cost_usd;
    fs.appendFileSync(resultFile, JSON.stringify(record) + '\n');
    console.error(`${row.id} ${row.form} ${record.outcome} rounds=${record.rounds} ${record.latency_ms}ms out=${record.tokens_out} cost=${record.cost_usd}`);
  }
} finally { s.close(); await stop(); }
console.log(JSON.stringify({model: runId, stage, ran: rows.length, cost_usd: Math.round(budgetUsd * 1e6) / 1e6}));
process.exit(0);
