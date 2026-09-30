#!/usr/bin/env node
/** Aggregates eval/reports/current/cpu-speed/llama-bench.jsonl (cpu-speed-bench.mjs) into cpu-speed-table.json and prints a table.
 * Per cell (model, quantization, core type, threads): tokens/s of generation (tg64) and ms per typical message (pp30 + tg30) over
 * the passes; "best" is the highest pass (least contended by other jobs on the host), "median" the median pass.
 * Conservative laptop estimate = median A725 4-thread tokens/s capped by bandwidth/size at 30 GB/s; optimistic = best X925 4-thread capped at 60 GB/s.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const OUT = path.join(fileURLToPath(new URL('../../', import.meta.url)), 'eval/reports/current/cpu-speed');
const rows = fs.readFileSync(path.join(OUT, 'llama-bench.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const cells = new Map();
for (const r of rows) {
  const key = [r.model, r.core_type, r.threads].join('|');
  const tg = r.results.find(x => x.n_gen === 64 && !x.n_prompt)?.avg_ts, pp = r.results.find(x => x.n_prompt === 30 && !x.n_gen)?.avg_ts, pg = r.results.find(x => x.n_prompt === 30 && x.n_gen === 30)?.avg_ts;
  const c = cells.get(key) ?? {model: r.model, quant: r.quant, size_bytes: r.size_bytes, core_type: r.core_type, threads: r.threads, tg: [], pp: [], msg_ms: [], load: []};
  if (tg) c.tg.push(tg); if (pp) c.pp.push(pp); if (pg) c.msg_ms.push(60 / pg * 1000); c.load.push(r.loadavg_1m);
  cells.set(key, c);
}
const table = [...cells.values()].map(c => ({model: c.model, quant: c.quant, size_mb: Math.round(c.size_bytes / 1048576), core_type: c.core_type, threads: c.threads, passes: c.tg.length, tg_best: Math.max(...c.tg), tg_median: median(c.tg), tg_min: Math.min(...c.tg), pp30_best: c.pp.length ? Math.max(...c.pp) : null, msg_ms_best: Math.min(...c.msg_ms), msg_ms_median: median(c.msg_ms), eff_gbps_best: Math.max(...c.tg) * c.size_bytes / 1e9, load_mean: c.load.reduce((s, x) => s + x, 0) / c.load.length}));
const get = (model, core, t) => table.find(x => x.model === model && x.core_type === core && x.threads === t);
const models = [...new Set(table.map(x => x.model))];
const summary = models.map(m => {
  const a4 = get(m, 'a725', 4), x4 = get(m, 'x925', 4), a8 = get(m, 'a725', 8), x8 = get(m, 'x925', 8);
  const size = (a4 ?? x4).size_mb * 1048576 / 1e9;
  const cap = bw => bw / size;
  const conservative = a4 ? Math.min(a4.tg_median, cap(30)) : null, optimistic = x4 ? Math.min(x4.tg_best, cap(60)) : null;
  return {model: m, size_gb: Number(size.toFixed(2)), a725_t4_median: a4?.tg_median, a725_t4_best: a4?.tg_best, x925_t4_median: x4?.tg_median, x925_t4_best: x4?.tg_best, a725_t8_best: a8?.tg_best, x925_t8_best: x8?.tg_best,
    ceiling_30gbps: cap(30), ceiling_60gbps: cap(60), conservative_tps: conservative, optimistic_tps: optimistic, msg_ms_a725_t4: a4?.msg_ms_median, msg_ms_x925_t4_best: x4?.msg_ms_best,
    verdict: conservative >= 30 ? 'meets 30 t/s (conservative)' : optimistic >= 40 && conservative >= 20 ? 'probably meets' : optimistic >= 30 ? 'borderline (optimistic only)' : 'does not meet'};
});
fs.writeFileSync(path.join(OUT, 'cpu-speed-table.json'), JSON.stringify({cells: table, summary}, null, 1) + '\n');
const f = x => (x == null ? '-' : x.toFixed(1));
console.log('model'.padEnd(34), 'GB', 'A725x4 med/best', 'X925x4 med/best', 'A725x8', 'X925x8', 'ceil30/60', 'conserv/optim', 'msg ms (A725x4 | X925x4 best)');
for (const s of summary) console.log(s.model.padEnd(34), s.size_gb.toFixed(2), `${f(s.a725_t4_median)}/${f(s.a725_t4_best)}`.padEnd(12), `${f(s.x925_t4_median)}/${f(s.x925_t4_best)}`.padEnd(12), f(s.a725_t8_best).padEnd(6), f(s.x925_t8_best).padEnd(6), `${f(s.ceiling_30gbps)}/${f(s.ceiling_60gbps)}`.padEnd(12), `${f(s.conservative_tps)}/${f(s.optimistic_tps)}`.padEnd(12), `${Math.round(s.msg_ms_a725_t4 ?? 0)} | ${Math.round(s.msg_ms_x925_t4_best ?? 0)}`, s.verdict);
