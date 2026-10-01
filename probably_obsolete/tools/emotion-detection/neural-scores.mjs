#!/usr/bin/env node
/** Runs the neural strategy's models over the evaluation set, one message per call (the chat use), on 4 CPU threads, and
 * stores raw label probabilities plus per-message latency: eval/reports/current/emotion-detection/neural-scores.jsonl and
 * neural-latency.json. Run in the background; the worker uses ~/emotion-venv.
 *   node tools/emotion-detection/neural-scores.mjs [--threads 4]
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConfig, createNeuralStrategy} from '../../lib/emotion-detection/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'eval/reports/current/emotion-detection');
const threads = Number(process.argv[process.argv.indexOf('--threads') + 1]) || 4;
const config = {...loadConfig().strategies.neural, threads};
const items = fs.readFileSync(path.join(DIR, 'eval-set.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const strategy = createNeuralStrategy(config);
const t0 = performance.now();
await strategy.scoreBatch(['warm up']);
const loadMs = performance.now() - t0;
const out = [], lat = [];
for (const item of items) {
  const s = performance.now();
  const [scores] = await strategy.scoreBatch([item.message]);
  const ms = performance.now() - s;
  lat.push(ms);
  out.push({id: item.id, ms: Math.round(ms * 10) / 10, scores});
}
fs.writeFileSync(path.join(DIR, 'neural-scores.jsonl'), out.map(o => JSON.stringify(o)).join('\n') + '\n');
lat.sort((a, b) => a - b);
const q = p => Math.round(lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] * 10) / 10;
fs.writeFileSync(path.join(DIR, 'neural-latency.json'), JSON.stringify({threads, models: Object.keys(config.models), loadAndWarmupMs: Math.round(loadMs), messages: lat.length, meanMs: Math.round(lat.reduce((a, b) => a + b, 0) / lat.length * 10) / 10, p50Ms: q(0.5), p95Ms: q(0.95), maxMs: q(1)}, null, 1) + '\n');
strategy.close();
console.log('done');
