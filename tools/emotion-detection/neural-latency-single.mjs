#!/usr/bin/env node
/** Per-model CPU latency (one message per call, 4 threads, first 60 evaluation messages): the cost of each neural model
 * alone, to choose the speed/quality compromise (DS029). Writes eval/reports/current/emotion-detection/neural-latency-per-model.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConfig, createNeuralStrategy} from '../../lib/emotion-detection/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'eval/reports/current/emotion-detection');
const config = loadConfig().strategies.neural;
const items = fs.readFileSync(path.join(DIR, 'eval-set.jsonl'), 'utf8').trim().split('\n').slice(0, 60).map(l => JSON.parse(l));
const out = {};
for (const name of Object.keys(config.models)) {
  const s = createNeuralStrategy({...config, threads: 4, models: {[name]: config.models[name]}});
  await s.scoreBatch(['warm up']);
  const lat = [];
  for (const i of items) { const t = performance.now(); await s.scoreBatch([i.message]); lat.push(performance.now() - t); }
  lat.sort((a, b) => a - b);
  out[name] = {meanMs: Math.round(lat.reduce((a, b) => a + b, 0) / lat.length), p95Ms: Math.round(lat[Math.floor(lat.length * 0.95)])};
  s.close();
}
fs.writeFileSync(path.join(DIR, 'neural-latency-per-model.json'), JSON.stringify({threads: 4, messages: items.length, perModel: out}, null, 1) + '\n');
console.log(JSON.stringify(out));
