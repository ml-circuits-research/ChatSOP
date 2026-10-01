#!/usr/bin/env node
/**
 * Worker of the unified-ft data build: SymbolicLM certification (accurate Stanza, default and accurate trees identical) of clean-English targets of
 * datasets/bad_english/proofing-prod1 whose target is in neither neuro_english/proofing-it3-mix nor symbolic_english (those two give their own limited English).
 *   node tools/research/unified-ft-certify.mjs --worker K --of N --train 5000 --dev 400
 * Deterministic sample (seeded shuffle), one output file per worker: eval/reports/current/unified-ft/data/cert-K.jsonl ({id, split, target, certified}), append-only, resumable.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createSymbolicLM} from '../../lib/symbolic-lm/index.mjs';
import {ROOT} from '../../lib/dataset-paths.mjs';
const A = process.argv.slice(2), val = (k, d) => (A.includes(k) ? A[A.indexOf(k) + 1] : d);
const worker = Number(val('--worker', 0)), of = Number(val('--of', 1)), nTrain = Number(val('--train', 5000)), nDev = Number(val('--dev', 400));
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const norm = s => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
const known = new Set([...rd('datasets/neuro_english/proofing-it3-mix/train.jsonl'), ...rd('datasets/neuro_english/proofing-it3-mix/dev.jsonl')].map(r => norm(r.prompt)));
for (const s of ['train', 'dev']) for (const r of rd(`datasets/symbolic_english/${s}.jsonl`)) known.add(norm(r.message));
const key = id => crypto.createHash('sha256').update('unified-ft-v1|' + id).digest('hex');
const pick = (split, n) => rd(`datasets/bad_english/proofing-prod1/${split}.jsonl`)
  .filter(r => ['ro', 'mixed', 'noisy_en'].includes(r.language_kind) && r.kind === 'repair' && !known.has(norm(r.target)) && r.target.split(/\s+/).length >= 3 && r.target.length <= 220)
  .sort((a, b) => (key(a.id) < key(b.id) ? -1 : 1)).slice(0, n).map(r => ({id: r.id, split, target: r.target}));
const todo = [...pick('train', nTrain), ...pick('dev', nDev)].filter((_, i) => i % of === worker);
const out = path.join(ROOT, `eval/reports/current/unified-ft/data/cert-${worker}.jsonl`);
const done = new Set(fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).id) : []);
const lm = await createSymbolicLM({device: 'cpu'});
let n = 0;
for (const r of todo) {
  if (done.has(r.id)) continue;
  let certified = null;
  try { certified = (await lm.inspectUnit(r.target)).certified === true; } catch (e) { certified = null; }
  fs.appendFileSync(out, JSON.stringify({...r, certified}) + '\n');
  if (++n % 200 === 0) console.log(worker, n, todo.length);
}
await lm.stop();
console.log(JSON.stringify({worker, done: n, of: todo.length}));
process.exit(0);
