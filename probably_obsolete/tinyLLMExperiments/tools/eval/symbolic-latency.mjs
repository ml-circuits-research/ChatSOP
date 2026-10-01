#!/usr/bin/env node
/** End-to-end latency of SymbolicLM (message in, SOP and analysis out) per Stanza package, experiment
 * eval-symbolic-accurate-adopt-v1 (DS010 registration, measurement `latency`).
 *
 *   node tools/eval/symbolic-latency.mjs all [--n 60]              # every configuration below, one child process each
 *   node tools/eval/symbolic-latency.mjs bench --package default|accurate --device cuda|cpu [--batch 64] [--n 60] [--parsers-disagree]
 *
 * Messages: a fixed seeded sample of clean-English train messages of datasets/symbolic_english (never the sealed test).
 * GPU: `analyzeMany` in batches (after one warm-up batch) and one `analyze` call per message; CPU: one call per message
 * with OMP_NUM_THREADS=4 on four cores (`taskset -c`; this host has 10 Cortex-A725 and 10 Cortex-X925 cores). Model load
 * time is reported apart. `--parsers-disagree` adds the optional second worker of the uncertainty reason.
 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync} from '../../lib/jsonl-shards.mjs';
import {createSymbolicLM} from '../../lib/symbolic-lm/index.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = path.join(ROOT, 'eval/reports/current/symbolic-accurate');
const args = argv => { const o = {command: argv[0]}; for (let i = 1; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; return o; };

function sample(n) {
  const rows = readJsonlShardedSync(path.join(ROOT, 'datasets/symbolic_english/train.jsonl')).filter(r => r.message.length < 200 && !/\n/.test(r.message));
  let a = 20260930; const rand = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
  const picked = [];
  for (const r of rows) if (rand() < (n * 3) / rows.length) picked.push(r.message);
  return picked.slice(0, n);
}

async function bench(o) {
  const n = Number(o.n ?? 60), batch = Number(o.batch ?? 64);
  const messages = sample(n);
  const t0 = performance.now();
  const lm = await createSymbolicLM({device: o.device, package: o.package, threads: 4, parsersDisagree: Boolean(o['parsers-disagree'])});
  const loadMs = performance.now() - t0;
  const words = messages.reduce((s, m) => s + m.split(/\s+/).length, 0);
  const result = {package: o.package, device: o.device, parsers_disagree: Boolean(o['parsers-disagree']), messages: messages.length, words, load_s: loadMs / 1000};
  try {
    // Batched: 64 messages per call on the GPU, 10 on the CPU (the protocol of eval-stanza-accurate-v1).
    const size = o.batch ? batch : o.device === 'cuda' ? 64 : 10;
    await lm.analyzeMany(messages.slice(0, size), {route: 'direct', language: 'auto'}); // warm-up
    const tb = performance.now();
    for (let i = 0; i < messages.length; i += size) await lm.analyzeMany(messages.slice(i, i + size), {route: 'direct', language: 'auto'});
    result.batched_ms_per_message = (performance.now() - tb) / messages.length;
    result.batch_size = size;
    await lm.analyze(messages[0], {route: 'direct', language: 'auto'}); // warm-up of the single path
    const t = performance.now();
    for (const m of messages) await lm.analyze(m, {route: 'direct', language: 'auto'});
    result.single_ms_per_message = (performance.now() - t) / messages.length;
    const rulesStart = performance.now();
    result.rss_mb = process.memoryUsage().rss / 1e6;
    void rulesStart;
  } finally { await lm.stop(); }
  console.log(JSON.stringify(result));
}

function all(o) {
  const configs = [];
  for (const pkg of ['default', 'accurate']) {
    configs.push({package: pkg, device: 'cuda', cores: null});
    configs.push({package: pkg, device: 'cpu', cores: '0-3', label: 'CPU 4 threads (A725 cores 0-3)'});
    configs.push({package: pkg, device: 'cpu', cores: '5-8', label: 'CPU 4 threads (X925 cores 5-8)'});
  }
  configs.push({package: 'accurate', device: 'cuda', cores: null, pd: true});
  configs.push({package: 'accurate', device: 'cpu', cores: '5-8', label: 'CPU 4 threads (X925 cores 5-8)', pd: true});
  const results = [];
  for (const c of configs) {
    const cmd = ['node', fileURLToPath(import.meta.url), 'bench', '--package', c.package, '--device', c.device, '--n', String(o.n ?? 60), ...(c.pd ? ['--parsers-disagree'] : [])];
    const [bin, ...rest] = c.cores ? ['taskset', '-c', c.cores, ...cmd] : cmd;
    const out = execFileSync(bin, rest, {env: {...process.env, OMP_NUM_THREADS: '4', MKL_NUM_THREADS: '4'}, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26});
    const line = out.trim().split('\n').filter(l => l.startsWith('{')).at(-1);
    results.push({...JSON.parse(line), label: c.label ?? 'GPU (GB10)', cores: c.cores});
    console.error(JSON.stringify(results.at(-1)));
  }
  fs.mkdirSync(OUT, {recursive: true});
  fs.writeFileSync(path.join(OUT, 'latency.json'), JSON.stringify({at: new Date().toISOString(), note: 'tools/eval/symbolic-latency.mjs all', results}, null, 1) + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = args(process.argv.slice(2));
  Promise.resolve({bench, all}[o.command]?.(o)).catch(e => { console.error(e.stack); process.exit(1); });
}
