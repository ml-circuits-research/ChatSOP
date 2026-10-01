#!/usr/bin/env node
/** Latency of the SymbolicLM rewrite-pipeline gate per sentence unit (experiment eval-symbolic-pipeline-gate-v1).
 *   node tools/eval/symbolic-pipeline-gate-latency.mjs --device cuda|cpu [--threads 4] [--n 60] [--url http://127.0.0.1:PORT]
 * Measures, on a fixed sample of working-test and sealed-repair units: `parse` (one Stanza parse, what SymbolicLM does anyway),
 * `inspect` (the gate: both Stanza packages on the unit plus the rules, `SymbolicLM.inspectUnit`) and, with --url, the model call. */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {createSymbolicLM} from '../../lib/symbolic-lm/index.mjs';
import {maskMessage} from '../../lib/ud-to-sop/index.mjs';

const argv = process.argv.slice(2), opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const device = opt('device', 'cpu'), threads = Number(opt('threads', 4)), n = Number(opt('n', 60)), url = opt('url', null);
const units = JSON.parse(fs.readFileSync(path.join(ROOT, 'eval/reports/current/symbolic-pipeline-gate/units.json'), 'utf8'));
const pool = [...new Set([...units.sym500, ...units.test].flatMap(r => r.units))];
const sample = pool.filter((_, i) => i % Math.floor(pool.length / n) === 0).slice(0, n);
const quantiles = list => { const s = [...list].sort((a, b) => a - b); return {mean: Math.round(s.reduce((a, b) => a + b, 0) / s.length), p50: Math.round(s[Math.floor(s.length * 0.5)]), p90: Math.round(s[Math.floor(s.length * 0.9)])}; };
const lm = await createSymbolicLM({device, threads});
try {
  await lm.inspectUnit(sample[0]);
  const parse = [], inspect = [], model = [];
  for (const u of sample) {
    let t = performance.now(); await lm.parse(maskMessage(u), 'en'); parse.push(performance.now() - t);
    t = performance.now(); await lm.inspectUnit(u); inspect.push(performance.now() - t);
    if (url) {
      t = performance.now();
      const res = await fetch(`${url}/v1/chat/completions`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({model: 'proofreader', messages: [{role: 'user', content: u}], temperature: 0, top_k: 1, seed: 0, cache_prompt: false, max_tokens: 256})});
      await res.json(); model.push(performance.now() - t);
    }
  }
  console.log(JSON.stringify({device, threads: device === 'cpu' ? threads : null, units: sample.length, parse_ms: quantiles(parse), inspect_ms: quantiles(inspect), model_ms: model.length ? quantiles(model) : null}));
} finally { await lm.stop(); }
