#!/usr/bin/env node
/** No-copy check of translate-jargon-v1: no word 8-gram of a row's source or target occurs in the cached OPUS bitexts (datasets_sources/opus-jargon). Report: eval/reports/current/translate-distill/no-copy.json. Exit 1 on a hit. */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {ROOT} from '../../../lib/dataset-paths.mjs';
const N = 8, norm = t => String(t).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').split(/[^a-z0-9]+/).filter(Boolean);
const grams = new Map();
for (const split of ['train', 'dev']) for (const l of fs.readFileSync(path.join(ROOT, `datasets/bad_english/translate-jargon-v1/${split}.jsonl`), 'utf8').trim().split('\n')) {
  const r = JSON.parse(l);
  for (const t of [r.source, r.target]) { const w = norm(t); for (let i = 0; i + N <= w.length; i++) grams.set(w.slice(i, i + N).join(' '), r.id); }
}
const hits = [], files = [];
for (const c of ['KDE4', 'GNOME', 'Ubuntu', 'EMEA', 'JRC-Acquis']) for (const side of ['en', 'ro']) {
  const f = path.join(ROOT, `datasets_sources/opus-jargon/${c}/${c}.en-ro.${side}`); files.push(path.relative(ROOT, f));
  for await (const line of readline.createInterface({input: fs.createReadStream(f, 'utf8')})) {
    const w = norm(line); for (let i = 0; i + N <= w.length; i++) { const g = w.slice(i, i + N).join(' '); if (grams.has(g)) hits.push({corpus: c, side, id: grams.get(g), gram: g}); }
  }
}
const out = {generated_at: new Date().toISOString(), n: N, row_grams: grams.size, files, hits: hits.length, examples: hits.slice(0, 10)};
fs.mkdirSync(path.join(ROOT, 'eval/reports/current/translate-distill'), {recursive: true});
fs.writeFileSync(path.join(ROOT, 'eval/reports/current/translate-distill/no-copy.json'), JSON.stringify(out, null, 1) + '\n');
const hf = path.join(ROOT, 'datasets_sources/tj_work/nocopy-hits.json'), prev = fs.existsSync(hf) ? JSON.parse(fs.readFileSync(hf, 'utf8')) : [];
fs.writeFileSync(hf, JSON.stringify([...new Set([...prev, ...hits.map(h => h.id.replace('translate-jargon-v1::', ''))])]));
console.log(out); process.exit(hits.length ? 1 : 0);
