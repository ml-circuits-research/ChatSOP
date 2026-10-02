#!/usr/bin/env node
/**
 * End-to-end evaluation on the owner's problem books (docs/runtime.html "Evaluating on the owner's problem books"):
 *   node tools/eval/books/run.mjs --n 100 [--seed s] [--books math,science,...] [--areas text,...] [--arms steps,direct[,remote-direct]]
 *     [--include-seen] [--ids a,b] [--resume dir] [--endpoint http://127.0.0.1:PORT/v1] [--concurrency N]
 * Arms: steps = the product chat turn with LocalLLMStepByStep (method B) and Qwen3-4B-Instruct Q4_K_M, the problem text as the user
 * message, the chat default base memory; direct = the same model answering the problem directly (baseline); remote-direct = the same chat
 * turn with LLMDirect on the remote default model (queryParser.models: the openference Qwen3.8 27b through LLMAPIProvider; one completion plus validator repairs), only when asked. Items already run are not repeated unless --include-seen.
 * Writes eval/reports/current/books-eval/run-<timestamp>/records.jsonl, scores deterministically (tools/eval/books/score.mjs) and
 * prepares the judge batches; the report is tools/eval/books/report.mjs. One llama-server at a time; stops what it started.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadItems, loadSeen, markSeen, sampleItems} from './sample.mjs';
import {openChatTurn, ROOT, MODEL_GGUF} from './system.mjs';
import {attribution, finalLine} from './attribution.mjs';
import {GPU_LOCKS} from '../../../lib/local-llm/index.mjs';

const opt = (args, name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const list = v => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : null);
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

export async function main(args = process.argv.slice(2)) {
  const n = Number(opt(args, '--n', 100)), seed = opt(args, '--seed', 'books-1'), arms = list(opt(args, '--arms', 'steps,direct'));
  const unknown = arms.filter(a => !['steps', 'direct', ...Object.keys(REMOTE_ARMS)].includes(a));
  if (unknown.length) throw new Error(`arms: steps, direct, ${Object.keys(REMOTE_ARMS).join(', ')} (got ${unknown})`);
  const endpoint = opt(args, '--endpoint', null);
  for (const lock of GPU_LOCKS) if (fs.existsSync(path.join(ROOT, lock))) throw new Error(`the GPU is reserved (${lock}); nothing started`);
  if (!endpoint && arms.some(a => !REMOTE_ARMS[a]) && !fs.existsSync(MODEL_GGUF)) throw new Error(`missing model ${MODEL_GGUF}`);
  const resume = opt(args, '--resume', null);
  const out = path.resolve(ROOT, resume ?? `eval/reports/current/books-eval/run-${stamp()}`);
  fs.mkdirSync(out, {recursive: true});
  const itemsFile = path.join(out, 'items.json');
  let sample;
  if (resume && fs.existsSync(itemsFile)) sample = JSON.parse(fs.readFileSync(itemsFile, 'utf8'));
  else {
    const all = loadItems(ROOT);
    sample = sampleItems(all, {n, seed, books: list(opt(args, '--books', null)), areas: list(opt(args, '--areas', null)), ids: list(opt(args, '--ids', null)), seen: loadSeen(ROOT), includeSeen: args.includes('--include-seen')});
    fs.writeFileSync(itemsFile, JSON.stringify(sample, null, 1));
  }
  if (!sample.length) throw new Error('no unseen items match; use --include-seen or other filters');
  console.error(`run ${path.basename(out)}: ${sample.length} items, arms ${arms.join(',')}, seed ${seed}`);
  const file = path.join(out, 'records.jsonl');
  const done = new Set(fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { const r = JSON.parse(l); return `${r.arm}/${r.id}`; }) : []);
  const started = new Date().toISOString();
  const localArms = arms.filter(a => !REMOTE_ARMS[a]);
  let system = null;
  const append = rec => fs.appendFileSync(file, JSON.stringify(rec) + '\n');
  try {
    for (const arm of arms) {
      if (REMOTE_ARMS[arm]) { await remoteArm(arm, sample, done, append, args, out); continue; }
      system ??= await openChatTurn({endpoint});
      let k = 0;
      for (const item of sample) {
        if (done.has(`${arm}/${item.id}`)) continue;
        const base = {run: path.basename(out), arm, id: item.id, book: item.book, area: item.area, grade: item.grade, question: item.question, gold: item.answer, gold_kind: item.answer_kind, gold_value: item.answer_value};
        if (arm === 'steps') {
          const r = await system.ask(item.question);
          append({...base, ms: r.ms, ok: r.ok, text: r.text ?? null, error: r.error ?? null, system: attribution(r)});
          console.error(`[${++k}/${sample.length}] steps ${item.id} ${r.ok ? r.packet?.status : 'ERR ' + r.error?.code} ${r.ms} ms`);
        } else {
          const r = await system.direct(item.question);
          append({...base, ms: r.ms, ok: r.ok, text: r.text ?? null, final: r.ok ? finalLine(r.text) : null, error: r.ok ? null : {code: 'direct_failed', message: r.reason}, tokens: r.usage ?? null, finish: r.finish ?? null});
          console.error(`[${++k}/${sample.length}] direct ${item.id} ${r.ok ? (finalLine(r.text) ?? '(no final line)').slice(0, 50) : 'ERR'} ${r.ms} ms`);
        }
      }
    }
  } finally { await system?.close(); }
  fs.writeFileSync(path.join(out, 'run.json'), JSON.stringify({run: path.basename(out), started, finished: new Date().toISOString(), n: sample.length, seed, arms, model: path.basename(MODEL_GGUF), method: 'B',
    base_memory: system?.baseId ?? null, memory_circuits_sha256: system?.memoryDigest ?? null, filters: {books: opt(args, '--books', null), areas: opt(args, '--areas', null)}}, null, 1));
  if (!args.includes('--include-seen') && !resume) markSeen(ROOT, sample.map(i => i.id), path.basename(out));
  void localArms;
  console.error(`records: ${path.relative(ROOT, file)}\nnext: node tools/eval/books/score.mjs --run ${path.relative(ROOT, out)}`);
}

/** The arms that run the chat turn with a remote formalizer (no local model): the strategy and its default model. */
// No omp (owner order 2026-10-02): both arms call the proxy directly (LLMDirect). 'coding-agent' keeps its record name and is pinned to the 27B;
// 'remote-direct' uses the chain queryParser.models of the runtime configuration.
export const REMOTE_ARMS = Object.freeze({'coding-agent': {strategy: 'LLMDirect', model: 'openference/Qwen3.8 27b'}, 'remote-direct': {strategy: 'LLMDirect', model: null}});

/** A remote arm: the same chat turn with the arm's strategy; only when asked. */
async function remoteArm(arm, sample, done, append, args, out) {
  const {strategy, model} = REMOTE_ARMS[arm];
  const system = await openChatTurn({strategy, model});
  // `--concurrency N` (default 2): remote turns wait on the provider, so a few run at once (the proxy enforces the plan's rate limits).
  const width = Math.max(1, Number(opt(args, '--concurrency', 2)));
  const queue = sample.filter(item => !done.has(`${arm}/${item.id}`));
  let k = 0;
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const r = await system.ask(item.question);
      append({run: path.basename(out), arm, id: item.id, book: item.book, area: item.area, grade: item.grade, question: item.question, gold: item.answer, gold_kind: item.answer_kind, gold_value: item.answer_value, ms: r.ms, ok: r.ok, text: r.text ?? null, error: r.error ?? null, system: attribution(r)});
      console.error(`[${++k}/${sample.length}] ${arm} ${item.id} ${r.ok ? r.packet?.status : 'ERR ' + r.error?.code} ${r.ms} ms`);
    }
  };
  try { await Promise.all(Array.from({length: width}, worker)); } finally { await system.close(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
