#!/usr/bin/env node
/**
 * CPU latency per sentence of the translate-compare arms on a fixed small sample (every 17th study sentence, 25 sentences), one request at a time.
 * Records the median, p90 and mean in milliseconds, the load average at the time (the machine is shared) and model size; writes latency.json.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {T, sentences, writeJsonl, wordCount} from './lib.mjs';

const sample = sentences().filter((_, i) => i % 17 === 0);
writeJsonl(path.join(T, 'in-latency.jsonl'), sample.map(s => ({id: s.id, text: s.text})));
const stats = ms => { const a = [...ms].sort((x, y) => x - y); return {n: a.length, median_ms: Math.round(a[Math.floor(a.length / 2)]), p90_ms: Math.round(a[Math.floor(a.length * 0.9)]), mean_ms: Math.round(a.reduce((s, x) => s + x, 0) / a.length)}; };
const out = {sample: sample.length, words_median: sample.map(s => wordCount(s.text)).sort((a, b) => a - b)[Math.floor(sample.length / 2)], loadavg_start: os.loadavg(), cpus: os.cpus().length, arms: {}};
const llm = async (endpoint, system, text, thinking = false) => {
  const t0 = performance.now();
  const res = await fetch(`${endpoint}/v1/chat/completions`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({messages: [...(system ? [{role: 'system', content: system}] : []), {role: 'user', content: text}], temperature: 0, max_tokens: Math.min(700, wordCount(text) * 3 + 60), chat_template_kwargs: {enable_thinking: thinking}})});
  const j = await res.json();
  return {ms: performance.now() - t0, tokens: j.usage?.completion_tokens ?? 0};
};
// the translate prompt of llm-translate.mjs (shortened), the same for every chat model
const SYSTEM = 'Translate the user message into English. Keep the meaning exactly; output only the English translation.';
for (const [name, port, threads, size] of [['qwen3-4b', 18902, 6, '4.28 GB (Q8_0 GGUF, 4B)'], ['qwen3-4b-q4', 18905, 6, '2.50 GB (Q4_K_M GGUF made from the Q8_0, 4B)'], ['qwen3-1.7b', 18903, 4, '2.17 GB (Q8_0 GGUF, 1.7B)'], ['eurollm-1.7b-q4', 18904, 4, '1.05 GB (Q4_K_M GGUF, 1.7B)'], ['prod1', 18901, 4, '0.55 GB (F16 GGUF, 270M)']]) {
  const rows = [];
  for (const s of sample) rows.push(await llm(`http://127.0.0.1:${port}`, name === 'prod1' ? null : SYSTEM, s.text));
  const tok = rows.reduce((a, r) => a + r.tokens, 0), sec = rows.reduce((a, r) => a + r.ms, 0) / 1000;
  out.arms[name] = {...stats(rows.map(r => r.ms)), tokens_per_second: Number((tok / sec).toFixed(1)), server_threads: threads, size};
}
for (const [name, model, size] of [['opus-romance', 'models/opus-mt/bases/e9ca9975e3972afd80732f08ce01d3a1339f47f8', '0.58 GB (safetensors fp32, 78M)'], ['opus-biblebig', 'models/opus-mt-tc-bible-big-roa-en/bases/4d4757865ab116b39daa3b4ca3cfe1e7daf43cbe', '0.93 GB (safetensors fp32, 233M)']]) {
  const f = path.join(T, `arms/lat-${name}.raw.jsonl`);
  const p = spawnSync(path.join(os.homedir(), 'mt-venv/bin/python'), ['training/python/translate_sentences.py', '--model', model, '--in', path.join(T, 'in-latency.jsonl'), '--out', f, '--single', '--threads', '4'], {encoding: 'utf8', cwd: path.join(T, '../../../..')});
  const rows = fs.readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  out.arms[name] = {...stats(rows.map(r => r.ms)), server_threads: 4, size};
}
out.loadavg_end = os.loadavg();
fs.writeFileSync(path.join(T, 'latency.json'), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out, null, 1));
process.exit(0);
