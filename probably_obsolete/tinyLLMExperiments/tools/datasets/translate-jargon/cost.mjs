#!/usr/bin/env node
/** Sum of `usage.cost.total` of omp sessions whose first line mentions a folder prefix: node cost.mjs tj_tgt_ [tj_msg_ ...] */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root = path.join(os.homedir(), '.omp/agent/sessions'), out = {};
const walk = d => fs.readdirSync(d, {withFileTypes: true}).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.jsonl') ? [path.join(d, e.name)] : []));
for (const f of walk(root)) {
  const text = fs.readFileSync(f, 'utf8');
  for (const p of process.argv.slice(2)) {
    if (!text.slice(0, 20000).includes(`datasets_sources/${p}`)) continue;
    let total = 0, model = null;
    for (const l of text.split('\n')) { if (!l.includes('"cost"')) continue; try { const r = JSON.parse(l); const u = r.message?.usage ?? r.usage; if (u?.cost?.total) { total += u.cost.total; model = r.message?.model ?? r.model ?? model; } } catch {} }
    const k = `${p}|${model}`; out[k] = (out[k] ?? 0) + total;
  }
}
console.log(out, 'total', Object.values(out).reduce((a, b) => a + b, 0));
