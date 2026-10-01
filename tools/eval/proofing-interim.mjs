#!/usr/bin/env node
/**
 * Interim check of a SymbolicProofingLLM epoch snapshot on a stratified sample of the training mix's DEV split (never the sealed sets); inference only.
 *   node tools/eval/proofing-interim.mjs --model-dir models/gemma/RUN/proofreader --epoch N --name LABEL [--dev datasets/neuro_english/proofing-it3-mix/proofreader/dev.jsonl]
 *   node tools/eval/proofing-interim.mjs --hf-dir DIR --name LABEL                      (a merged model directory, e.g. the it2 epoch 3 as the reference)
 * Sample (seed 20261001): 150 decomposition repairs (target with 3 or more sentences), 100 other repairs, 100 identity pairs. Metrics, text only (no parser):
 * decomposition: sentence count equal to the target; repair: output equals the target, output changed; identity: output differs from the prompt; runaway or empty outputs.
 * Writes eval/reports/current/symbolic-proofing-it3/interim/LABEL.{jsonl,json}.
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {sentencesOf} from '../datasets/symbolic-proofing-v2/units.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.join(ROOT, 'eval/reports/current/symbolic-proofing-it3/interim'); fs.mkdirSync(OUT, {recursive: true});
const dev = path.join(ROOT, arg('--dev', 'datasets/neuro_english/proofing-it3-mix/proofreader/dev.jsonl')), name = arg('--name');
const rows = fs.readFileSync(dev, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (list, n) => { const r = rng(20261001), a = [...list].sort((x, y) => x.id < y.id ? -1 : 1); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); };
const isDecomp = r => r.kind === 'repair' && sentencesOf(r.target).length >= 3;
const sample = [...pick(rows.filter(isDecomp), 150).map(r => ({...r, stratum: 'decomposition'})), ...pick(rows.filter(r => r.kind === 'repair' && !isDecomp(r)), 100).map(r => ({...r, stratum: 'repair'})), ...pick(rows.filter(r => r.kind === 'identity'), 100).map(r => ({...r, stratum: 'identity'}))];
let model = arg('--hf-dir');
if (!model) {
  const dir = path.join(ROOT, arg('--model-dir')), ep = arg('--epoch'); model = path.join(dir, `merged-epoch-${ep}`);
  if (!fs.existsSync(path.join(model, 'model.safetensors'))) {
    const base = path.join(ROOT, 'models/gemma/bases/99073d6b6edb0e298d163f964ec2b9d970b3408d');
    const r = spawnSync(path.join(process.env.HOME, 'proofreader-export-venv/bin/python'), [path.join(ROOT, 'training/python/merge.py'), '--checkpoint', path.join(dir, `epoch-${ep}`), '--output', model, '--base', base], {encoding: 'utf8'});
    if (r.status !== 0) throw Error('merge failed: ' + r.stderr.slice(-500));
  }
}
const inFile = path.join(OUT, `${name}.in.jsonl`), outFile = path.join(OUT, `${name}.out.jsonl`);
fs.writeFileSync(inFile, sample.map(r => JSON.stringify({id: r.id, text: r.prompt})).join('\n') + '\n');
const g = spawnSync(path.join(process.env.HOME, 'nlp-venv/bin/python'), [path.join(ROOT, 'training/python/generate_causal.py'), '--model', model, '--in', inFile, '--out', outFile, '--batch', '32', '--device', 'cuda', '--max-new', '700'], {encoding: 'utf8'});
if (g.status !== 0) throw Error('generate failed: ' + g.stderr.slice(-500));
const out = new Map(fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(r => [r.id, r]));
const norm = s => String(s).replace(/\s+/g, ' ').trim();
const stats = {};
const rec = [];
for (const r of sample) {
  const o = out.get(r.id), text = norm(o?.output ?? ''), s = (stats[r.stratum] ??= {n: 0, equals_target: 0, changed: 0, count_equals_target: 0, empty_or_capped: 0});
  s.n++; if (!text || o?.truncated) s.empty_or_capped++;
  if (text === norm(r.target)) s.equals_target++;
  if (text !== norm(r.prompt)) s.changed++;
  if (sentencesOf(text).length === sentencesOf(r.target).length) s.count_equals_target++;
  rec.push({id: r.id, stratum: r.stratum, prompt: r.prompt, target: r.target, output: text});
}
fs.writeFileSync(path.join(OUT, `${name}.jsonl`), rec.map(r => JSON.stringify(r)).join('\n') + '\n');
fs.unlinkSync(inFile);
const pct = (k, n) => `${k}/${n} = ${(100 * k / n).toFixed(1)}%`;
const summary = Object.fromEntries(Object.entries(stats).map(([k, s]) => [k, {...s, text: k === 'identity' ? `identity changed ${pct(s.changed, s.n)}` : `equals target ${pct(s.equals_target, s.n)}, sentence count = target ${pct(s.count_equals_target, s.n)}, changed ${pct(s.changed, s.n)}`}]));
fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({name, model, sample: sample.length, summary}, null, 1) + '\n');
console.log(JSON.stringify(summary, null, 1));
