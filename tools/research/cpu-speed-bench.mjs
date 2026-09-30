#!/usr/bin/env node
/** Laptop-CPU emulation for eval-cpu-speed-laptop-v1 (preregistered: status/preregistrations/eval-cpu-speed-laptop-v1.json).
 *
 * Runs `llama-bench` CPU-only (-ngl 0) on GGUF models pinned to 4 or 8 cores of one core type of this host
 * (10 Cortex-X925 cores 5-9,15-19 at 3.9 GHz; 10 Cortex-A725 cores 0-4,10-14 at 2.8 GHz), measuring
 * prompt processing (pp30), generation (tg30, tg64) and a typical message (input 30 + output 30 tokens, `-pg 30,30`).
 *
 *   node tools/research/cpu-speed-bench.mjs run [--models a,b] [--threads 4,8] [--cores x925,a725] [--reps 5]
 *   node tools/research/cpu-speed-bench.mjs list
 *
 * Model list: tools/research/cpu-speed-models.json. Results are appended to eval/reports/current/cpu-speed/llama-bench.jsonl
 * (one line per run). It never starts a second GPU job and uses no GPU (CUDA_VISIBLE_DEVICES is emptied).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = path.join(ROOT, 'eval/reports/current/cpu-speed');
const BIN = path.join(os.homedir(), 'llama-cpp-venv/llama.cpp/build/bin');
const CORES = {
  x925: {1: '5', 4: '5-8', 8: '5-9,15-17'},
  a725: {1: '0', 4: '0-3', 8: '0-4,10-12'},
};
const models = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./cpu-speed-models.json', import.meta.url)), 'utf8'));
const [command, ...rest] = process.argv.slice(2);
const o = {};
for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) o[rest[i].slice(2)] = rest[i + 1];

if (command === 'list') { for (const m of models) console.log(m.id, fs.existsSync(m.path.replace('~', os.homedir())) ? 'present' : 'MISSING', m.path); process.exit(0); }
if (command !== 'run') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 14).join('\n')); process.exit(0); }

const wantModels = o.models ? o.models.split(',') : models.map(m => m.id);
const wantThreads = (o.threads ?? '4,8').split(',').map(Number);
const pass = o.pass ?? '1';
const wantCores = (o.cores ?? 'x925,a725').split(',');
const reps = o.reps ?? '5';
fs.mkdirSync(OUT, {recursive: true});
const file = path.join(OUT, 'llama-bench.jsonl');
for (const m of models.filter(x => wantModels.includes(x.id))) {
  const p = m.path.replace('~', os.homedir());
  if (!fs.existsSync(p)) { console.error('missing', p); continue; }
  for (const core of wantCores) for (const t of wantThreads) {
    const args = ['-c', CORES[core][t], path.join(BIN, 'llama-bench'), '-m', p, '-t', String(t), '-ngl', '0', '-p', '30', '-n', '64', '-pg', '30,30', '-r', reps, '-o', 'jsonl'];
    let out;
    try { out = execFileSync('taskset', args, {env: {...process.env, LD_LIBRARY_PATH: BIN, CUDA_VISIBLE_DEVICES: ''}, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore']}); } catch (e) { console.error('FAILED', m.id, core, t, String(e.message).slice(0, 200)); continue; }
    const rows = out.split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l));
    const rec = {ts: new Date().toISOString(), pass, loadavg_1m: os.loadavg()[0], model: m.id, quant: m.quant, size_bytes: fs.statSync(p).size, core_type: core, cores: CORES[core][t], threads: t, results: rows.map(r => ({n_prompt: r.n_prompt, n_gen: r.n_gen, avg_ts: r.avg_ts, stddev_ts: r.stddev_ts, build_commit: r.build_commit, cpu_info: r.cpu_info, backends: r.backends}))};
    fs.appendFileSync(file, JSON.stringify(rec) + '\n');
    const g = rec.results.find(r => r.n_gen === 64 && !r.n_prompt);
    const pg = rec.results.find(r => r.n_prompt === 30 && r.n_gen === 30);
    console.log(`${m.id.padEnd(30)} ${core} t${t}  tg ${g?.avg_ts?.toFixed(1)} t/s  pp+tg(30+30) ${pg ? (60 / pg.avg_ts * 1000).toFixed(0) : '?'} ms`);
  }
}
