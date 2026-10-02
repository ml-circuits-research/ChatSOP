#!/usr/bin/env node
/**
 * End-to-end evaluation on the owner's problem books (docs/runtime.html "Evaluating on the owner's problem books"):
 *   node tools/eval/books/run.mjs --n 100 [--seed s] [--books math,science,...] [--areas text,...] [--arms steps,direct[,coding-agent]]
 *     [--include-seen] [--ids a,b] [--resume dir] [--endpoint http://127.0.0.1:PORT/v1]
 * Arms: steps = the product chat turn with LocalLLMStepByStep (method B) and Qwen3-4B-Instruct Q4_K_M, the problem text as the user
 * message, the chat default base memory; direct = the same model answering the problem directly (baseline); coding-agent = the same chat
 * turn with the CodingAgent strategy (omp, zai/glm-5.3), only when asked. Items already run are not repeated unless --include-seen.
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
  const unknown = arms.filter(a => !['steps', 'direct', 'coding-agent'].includes(a));
  if (unknown.length) throw new Error(`arms: steps, direct, coding-agent (got ${unknown})`);
  const endpoint = opt(args, '--endpoint', null);
  for (const lock of GPU_LOCKS) if (fs.existsSync(path.join(ROOT, lock))) throw new Error(`the GPU is reserved (${lock}); nothing started`);
  if (!endpoint && !fs.existsSync(MODEL_GGUF)) throw new Error(`missing model ${MODEL_GGUF}`);
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
  const localArms = arms.filter(a => a !== 'coding-agent');
  let system = null;
  const append = rec => fs.appendFileSync(file, JSON.stringify(rec) + '\n');
  try {
    for (const arm of arms) {
      if (arm === 'coding-agent') { await codingAgentArm(sample, done, append, args); continue; }
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

/** The coding-agent arm: the same chat turn with the CodingAgent strategy (omp chain of config/runtime.json); only when asked. */
async function codingAgentArm(sample, done, append, args) {
  const {openChatTurn: open} = await import('./system.mjs');
  const system = await open({strategy: 'CodingAgent', model: opt(args, '--coding-model', 'zai/glm-5.3')});
  try {
    for (const item of sample) {
      if (done.has(`coding-agent/${item.id}`)) continue;
      const r = await system.ask(item.question);
      append({run: null, arm: 'coding-agent', id: item.id, book: item.book, area: item.area, grade: item.grade, question: item.question, gold: item.answer, gold_kind: item.answer_kind, gold_value: item.answer_value, ms: r.ms, ok: r.ok, text: r.text ?? null, error: r.error ?? null, system: attribution(r)});
      console.error(`coding-agent ${item.id} ${r.ok ? r.packet?.status : 'ERR ' + r.error?.code}`);
    }
  } finally { await system.close(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
