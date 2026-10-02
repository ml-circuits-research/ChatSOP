#!/usr/bin/env node
/**
 * eval-pragmatics-v1: how well each formalization strategy understands courtesy and emotion (DS023), on the 300 labelled messages of
 * eval/pragmatics-v1/messages.jsonl (labels: a kind is positive when both judges of emotion-detection-v1, Grok and GLM, listed it,
 * negative when neither did; disputed kinds are left out of that message's numbers).
 *
 * Arms:
 *   stepbystep  LocalLLMStepByStep's first question (Q1 kind and message acts, then the emotion question) on a local llama-server
 *   coding      CodingAgent: the full circuit author through omp (the world-v1 vocabulary), the pragmatic wires of its query.sop
 *   lexicon     the archived lexicon/regex EmotionDetectionSystem (probably_obsolete/paused/), reference only
 *
 *   node tools/eval/pragmatics/run.mjs --arm stepbystep --endpoint http://127.0.0.1:19611/v1 --model qwen3-4b-instruct --limit 50
 *   node tools/eval/pragmatics/run.mjs --arm coding --omp-model 'llmapiprovider/Qwen3.8 27b' --limit 50 --concurrency 4
 *   node tools/eval/pragmatics/run.mjs --arm lexicon
 *   node tools/eval/pragmatics/run.mjs --report            (every arm's records → summary.json and summary.md)
 * Records: eval/reports/current/pragmatics/<arm>.jsonl (resumable). The first `--limit` messages are a fixed stratified order
 * (every message with a positive label interleaved with the neutral ones, seed-free: by id).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PRAGMATIC_KINDS} from '../../../sop/enums.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SET = path.join(ROOT, 'eval/pragmatics-v1/messages.jsonl');
const OUT = path.join(ROOT, 'eval/reports/current/pragmatics');
const opt = (args, name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const jl = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
/** The kinds the step-by-step first question can name (its message acts and emotions); the comparable core of every arm. */
export const CORE = Object.freeze(['greeting', 'thanks', 'apology', 'closing', 'politeness', 'frustration', 'confusion', 'urgency', 'anger', 'disappointment', 'joy', 'sadness', 'fear', 'curiosity']);
export const ALL = Object.freeze(PRAGMATIC_KINDS.filter(k => k !== 'unclassified'));

/** Messages in a fixed order: labelled and neutral messages alternate, so any prefix has both. */
export function ordered(rows) {
  const labelled = rows.filter(r => r.positive.length), neutral = rows.filter(r => !r.positive.length), out = [];
  for (let i = 0; out.length < rows.length; i++) { if (labelled[i]) out.push(labelled[i]); if (neutral[i]) out.push(neutral[i]); }
  return out;
}

/** The pragmatic kinds of a circuit text (structural: the `kind` line of each `pragmatic` wire). */
export const kindsOfSop = sop => [...String(sop ?? '').matchAll(/^@\w+\s+pragmatic\s*\n((?:[ \t]+.*\n?)*)/gm)].map(m => /^\s+kind\s+(\w+)/m.exec(m[1])?.[1]).filter(Boolean);

async function stepByStepArm(rows, args) {
  const {createOracle} = await import('../../../lib/query-author/step-by-step/index.mjs');
  const {firstQuestion} = await import('../../../lib/query-author/step-by-step/protocol.mjs');
  const {localChat} = await import('../../../lib/local-llm/client.mjs');
  const endpoint = opt(args, '--endpoint', 'http://127.0.0.1:19611/v1'), model = opt(args, '--model', 'qwen3-4b-instruct');
  const chat = (messages, maxTokens) => localChat({endpoint, model, messages, maxTokens, extraBody: {chat_template_kwargs: {enable_thinking: false}}});
  return async row => {
    const oracle = createOracle({chat});
    const started = Date.now();
    const first = await firstQuestion(oracle, row.message);
    return {kinds: first.pragmatic, form: first.form, questions: oracle.steps.length, ms: Date.now() - started, answers: oracle.steps.map(s => s.answer)};
  };
}

async function codingArm(rows, args) {
  const {authorQuery, ompBackend} = await import('../../../lib/query-author/index.mjs');
  const {openSession} = await import('../query-forms-probe.mjs');
  const session = openSession({base: 'world-v1', id: `pragmatics-${process.pid}`});
  process.on('exit', () => session.close());
  (await import('../../../lib/omp/index.mjs')).ompSettings();   // registers the llmapiprovider overlay for omp
  const model = opt(args, '--omp-model', 'llmapiprovider/Qwen3.8 27b');
  return async row => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'pragmatics-'));
    try {
      const r = await authorQuery({message: row.message, lexicon: session.lexicon, backend: ompBackend({model, timeoutMs: 180_000}), folder, maxFixRounds: 2});
      return {kinds: kindsOfSop(r.sop), status: r.status, ms: r.duration_ms, sop: r.sop, problems: (r.validation?.problems ?? []).map(p => p.code)};
    } finally { fs.rmSync(folder, {recursive: true, force: true}); }
  };
}

async function lexiconArm() {
  const {createSymbolicStrategy} = await import('../../../probably_obsolete/paused/lib/emotion-detection/strategies/symbolic.mjs');
  const strategy = createSymbolicStrategy();
  return async row => ({kinds: [...new Set(strategy.detect(row.message).filter(s => s.score >= 0.5).map(s => s.kind))]});
}

/** Per kind and micro precision/recall over both-judge positives and neither-judge negatives (disputed kinds left out). */
export function score(records, rowsById, kinds) {
  const perKind = Object.fromEntries(kinds.map(k => [k, {tp: 0, fp: 0, fn: 0}]));
  for (const r of records) {
    const row = rowsById.get(r.id);
    if (!row || r.error) continue;
    for (const k of kinds) {
      if (row.disputed.includes(k)) continue;
      const p = r.kinds.includes(k), a = row.positive.includes(k);
      if (p && a) perKind[k].tp++; else if (p) perKind[k].fp++; else if (a) perKind[k].fn++;
    }
  }
  const sum = key => Object.values(perKind).reduce((n, x) => n + x[key], 0);
  const ratio = (a, b) => b ? Math.round(1000 * a / b) / 10 : null;
  const tp = sum('tp'), fp = sum('fp'), fn = sum('fn');
  return {n: records.filter(r => !r.error).length, errors: records.filter(r => r.error).length, micro: {precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn), tp, fp, fn},
    perKind: Object.fromEntries(Object.entries(perKind).filter(([, x]) => x.tp + x.fp + x.fn).map(([k, x]) => [k, {...x, precision: ratio(x.tp, x.tp + x.fp), recall: ratio(x.tp, x.tp + x.fn)}]))};
}

function report() {
  const rows = jl(SET), byId = new Map(rows.map(r => [r.id, r]));
  const summary = {};
  const lines = ['| arm | n | errors | core P | core R | all-kinds P | all-kinds R | p50 ms |', '|---|---|---|---|---|---|---|---|'];
  for (const arm of ['stepbystep', 'coding', 'guide-haiku', 'lexicon']) {
    const records = jl(path.join(OUT, `${arm}.jsonl`));
    if (!records.length) continue;
    // Every arm is scored on the messages the smallest arm has, so the numbers compare like with like.
    const core = score(records, byId, CORE), all = score(records, byId, ALL);
    const ms = records.map(r => r.ms).filter(Number.isFinite).sort((a, b) => a - b);
    summary[arm] = {core, all, p50_ms: ms.length ? ms[Math.floor(ms.length / 2)] : null, ids: records.map(r => r.id)};
    lines.push(`| ${arm} | ${core.n} | ${core.errors} | ${core.micro.precision} | ${core.micro.recall} | ${all.micro.precision} | ${all.micro.recall} | ${summary[arm].p50_ms ?? '-'} |`);
  }
  // The same messages for every arm: the intersection of the scored ids.
  const common = Object.values(summary).map(s => new Set(s.ids)).reduce((a, b) => new Set([...a].filter(x => b.has(x))));
  lines.push('', `Paired on the ${common.size} messages every arm has:`, '', '| arm | core P | core R |', '|---|---|---|');
  for (const arm of Object.keys(summary)) {
    const s = score(jl(path.join(OUT, `${arm}.jsonl`)).filter(r => common.has(r.id)), byId, CORE);
    summary[arm].paired = s;
    lines.push(`| ${arm} | ${s.micro.precision} | ${s.micro.recall} |`);
  }
  for (const s of Object.values(summary)) delete s.ids;
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  fs.writeFileSync(path.join(OUT, 'summary.md'), lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}

export async function main(args = process.argv.slice(2)) {
  fs.mkdirSync(OUT, {recursive: true});
  if (args.includes('--report')) return report();
  const arm = opt(args, '--arm', null);
  const factory = {stepbystep: stepByStepArm, coding: codingArm, lexicon: lexiconArm}[arm];
  if (!factory) throw new Error('--arm stepbystep|coding|lexicon');
  const limit = Number(opt(args, '--limit', 300)), concurrency = Number(opt(args, '--concurrency', 1));
  const rows = ordered(jl(SET)).slice(0, limit);
  const file = path.join(OUT, `${arm}.jsonl`);
  const done = new Set(jl(file).map(r => r.id));
  const run = await factory(rows, args);
  const queue = rows.filter(r => !done.has(r.id));
  const worker = async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      let record;
      try { record = {id: row.id, ...await run(row)}; } catch (error) { record = {id: row.id, kinds: [], error: error.message}; }
      fs.appendFileSync(file, JSON.stringify(record) + '\n');
      console.error(`${row.id} ${record.error ? 'ERROR ' + record.error : record.kinds.join(',') || '-'} | gold ${row.positive.join(',') || '-'}`);
    }
  };
  await Promise.all(Array.from({length: concurrency}, worker));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
