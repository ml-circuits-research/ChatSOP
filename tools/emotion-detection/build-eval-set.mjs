#!/usr/bin/env node
/** Builds the 300-message evaluation set of the EmotionDetectionSystem (DS023, experiment emotion-detection-v1):
 * 119 messages sampled with a fixed seed from the project datasets (bad_english, neuro_english, symbolic_english,
 * new_cases) plus the 181 handwritten ones. Output: eval/reports/current/emotion-detection/eval-set.jsonl.
 *   node tools/emotion-detection/build-eval-set.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {HANDWRITTEN} from './handwritten.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'eval/reports/current/emotion-detection');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8').trim().split('\n').map(line => JSON.parse(line));
let seed = 20261001;
const rand = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const sample = (rows, n) => { const pool = [...rows]; const out = []; while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]); return out; };
const ok = m => typeof m === 'string' && m.length >= 8 && m.length <= 200 && !m.includes('\n');

const items = [];
const add = (source, message, extra = {}) => items.push({id: `emo-${String(items.length + 1).padStart(3, '0')}`, source, message, ...extra});
for (const d of ['bad_english', 'neuro_english', 'symbolic_english']) {
  const rows = [...read(`datasets/${d}/train.jsonl`), ...read(`datasets/${d}/dev.jsonl`)].filter(r => ok(r.message));
  for (const r of sample(rows, 30)) add(d, r.message, {dataset_id: r.id});
}
const cases = read('datasets_sources/new_cases/cases.jsonl').filter(r => ok(r.message));
const casual = cases.filter(r => r.categories.includes('casual_register'));
for (const r of [...sample(casual, 15), ...sample(cases.filter(r => !r.categories.includes('casual_register')), 14)]) add('new_cases', r.message, {dataset_id: r.id});
for (const m of HANDWRITTEN) add('handwritten', m);
fs.mkdirSync(OUT, {recursive: true});
fs.writeFileSync(path.join(OUT, 'eval-set.jsonl'), items.map(i => JSON.stringify(i)).join('\n') + '\n');
console.log(JSON.stringify({total: items.length, bySource: Object.fromEntries([...new Set(items.map(i => i.source))].map(s => [s, items.filter(i => i.source === s).length]))}));
