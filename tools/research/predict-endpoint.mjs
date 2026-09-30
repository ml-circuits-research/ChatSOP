#!/usr/bin/env node
/** Message-only predictions and latency from a local OpenAI-compatible endpoint (llama.cpp `llama-server`).
 *
 * The formalizer's input is the user's message and nothing else (DS021): each row's `question` is sent as the
 * only user message, with greedy decoding. The output `{id, sop}` rows feed `node eval/run.mjs --predictions`;
 * a separate timing file records per-message latency and the server's own token timings. The script runs no
 * model itself, reads no gold field and writes nothing but its two outputs. The request itself is
 * `predictMessage` in lib/formalizer-endpoint.mjs, shared with the chat server so both send the same call.
 *
 *   node tools/research/predict-endpoint.mjs --suite eval/suites/formalizer-v1/test.jsonl --url http://127.0.0.1:8091 \
 *     --out predictions.jsonl --timing timing.json [--parallel 4] [--sample 300 --seed 42] [--max-tokens 1024]
 *     [--min-chars N] [--max-chars N]   # only messages whose length is in [min, max] characters
 *     [--grammar file.gbnf]              # constrained decoding with a llama.cpp GBNF grammar (tools/sop-gbnf.mjs)
 */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {predictMessage} from '../../lib/formalizer-endpoint.mjs';

const OPTIONS = ['suite', 'url', 'out', 'timing', 'parallel', 'sample', 'seed', 'max-tokens', 'label', 'min-chars', 'max-chars', 'grammar'];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].replace(/^--/, '');
    if (!OPTIONS.includes(name) || !argv[i].startsWith('--')) throw Error(`Unknown option ${argv[i]}`);
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw Error(`Missing value for ${argv[i]}`);
    out[name] = argv[++i];
  }
  for (const name of ['suite', 'url', 'out', 'timing']) if (!out[name]) throw Error(`--${name} is required`);
  return out;
}

/** Deterministic sample of `count` rows (mulberry32 shuffle), kept in suite order. */
export function sampleRows(rows, count, seed) {
  if (!count || count >= rows.length) return rows;
  let state = seed >>> 0;
  const random = () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const index = rows.map((_, i) => i);
  for (let i = index.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [index[i], index[j]] = [index[j], index[i]]; }
  return index.slice(0, count).sort((a, b) => a - b).map(i => rows[i]);
}

const predictOne = (url, message, maxTokens, grammar) => predictMessage(url, message, {maxTokens, grammar});

function quantiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = q => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null;
  return {count: sorted.length, mean: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null, p50: at(0.5), p95: at(0.95), max: sorted.at(-1) ?? null};
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const parallel = Number(args.parallel ?? 1), maxTokens = Number(args['max-tokens'] ?? 1024);
  const grammar = args.grammar ? fs.readFileSync(args.grammar, 'utf8') : null;
  const min = Number(args['min-chars'] ?? 0), max = Number(args['max-chars'] ?? Infinity);
  const rows = sampleRows(readJsonlShardedSync(args.suite).filter(row => String(row.question).length >= min && String(row.question).length <= max), Number(args.sample ?? 0), Number(args.seed ?? 42));
  const results = new Array(rows.length);
  let next = 0;
  const started = performance.now();
  async function worker() {
    while (next < rows.length) {
      const index = next++, row = rows[index];
      if (typeof row.question !== 'string') throw Error(`${row.id}: row has no message`);
      try { results[index] = {id: row.id, ...(await predictOne(args.url, row.question, maxTokens, grammar))}; }
      catch (error) { results[index] = {id: row.id, text: '', error: error.message, ms: null}; }
    }
  }
  await Promise.all(Array.from({length: parallel}, worker));
  const wall = (performance.now() - started) / 1000;
  fs.mkdirSync(path.dirname(path.resolve(args.out)), {recursive: true});
  // A generation error or a truncated output stays in the denominator as an empty or partial prediction.
  fs.writeFileSync(args.out, results.map(r => JSON.stringify({id: r.id, sop: r.text})).join('\n') + '\n');
  const ok = results.filter(r => r.ms !== null);
  const timing = {
    format: 'chatsop-endpoint-timing-v1', label: args.label ?? null, suite: args.suite, url: args.url, rows: rows.length,
    sample: args.sample ? {count: Number(args.sample), seed: Number(args.seed ?? 42)} : null, message_chars: {min, max: Number.isFinite(max) ? max : null}, parallel, max_tokens: maxTokens, grammar: args.grammar ?? null,
    wall_seconds: wall, messages_per_second: rows.length / wall,
    errors: results.filter(r => r.error).map(r => ({id: r.id, error: r.error})),
    truncated: results.filter(r => r.finish === 'length').map(r => r.id),
    raw_completion_fallback: results.filter(r => r.raw).map(r => r.id),
    latency_ms: quantiles(ok.map(r => r.ms)),
    prompt_tokens: quantiles(ok.map(r => r.usage?.prompt_tokens).filter(Number.isFinite)),
    completion_tokens: quantiles(ok.map(r => r.usage?.completion_tokens).filter(Number.isFinite)),
    server_prompt_tokens_per_second: quantiles(ok.map(r => r.timings?.prompt_per_second).filter(Number.isFinite)),
    server_generation_tokens_per_second: quantiles(ok.map(r => r.timings?.predicted_per_second).filter(Number.isFinite)),
    aggregate_completion_tokens_per_second: ok.reduce((n, r) => n + (r.usage?.completion_tokens ?? 0), 0) / wall,
  };
  fs.writeFileSync(args.timing, JSON.stringify(timing, null, 2) + '\n');
  console.log(JSON.stringify({rows: timing.rows, errors: timing.errors.length, truncated: timing.truncated.length, wall_seconds: +wall.toFixed(1), latency_p50_ms: timing.latency_ms.p50, gen_tps_p50: timing.server_generation_tokens_per_second.p50}));
  return timing;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
