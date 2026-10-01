// Runs the chat questions through SymbolicLM (CPU Stanza) once and caches the SOP: node eval/world-kb/symbolic.mjs
import fs from 'node:fs';
import {SymbolicLM} from '../../lib/symbolic-lm/index.mjs';
const qs = JSON.parse(fs.readFileSync(new URL('./questions.json', import.meta.url)));
const out = new URL('../reports/current/world-kb/symbolic-lm-sop.json', import.meta.url);
const lm = new SymbolicLM({device: 'auto', threads: 4});
await lm.start();
const result = {};
for (const q of qs) {
  const t = Date.now();
  try { const r = await lm.analyze(q.q); result[q.id] = {q: q.q, sop: r.sop ?? r, ms: Date.now() - t, trace: r.trace?.route ?? null}; }
  catch (e) { result[q.id] = {q: q.q, error: e.message}; }
  console.error(q.id, Date.now() - t, 'ms');
}
await lm.stop();
fs.writeFileSync(out, JSON.stringify(result, null, 1));
