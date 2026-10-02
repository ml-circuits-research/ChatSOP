#!/usr/bin/env node
/**
 * Runs every integrity constraint of commonsense-v1 over a base memory (default world-v1) through the product path (askMemory) and
 * reports the violations each one finds (up to --limit witnesses), the status and the time: the consistency check of the layer against the
 * world facts. A violation is a data problem or a wrong constraint; both are reported, never hidden.
 *   QF_CHAT_ROOT=<chat data root> node tools/commonsense/integrity.mjs [--base world-v1] [--limit 20] [--out <file.json>]
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openSession} from '../eval/query-forms-probe.mjs';
import {askMemory} from '../../reasoning/slice/index.mjs';
import {parse} from '../../sop/knowledge/index.mjs';
import {seedCircuits} from '../../lib/knowledge-seeds.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const limit = Number(opt('--limit', 20));
const s = openSession({base: opt('--base', 'world-v1'), id: 'cs-integrity-' + process.pid});
const session = s.store.get('cs', 'i', 'main').agent.session;
const theory = s.theories.get([...s.sessions.baseCircuits(s.id), ...s.sessions.circuits(s.id)]);
const ids = seedCircuits('commonsense-v1').flatMap(c => parse(c.text).wires.filter(w => w.type === 'integrity').map(w => ({id: w.id, file: c.file, severity: w.fields.find(f => f.key === 'severity')?.value.trim() ?? 'error'})));
const out = [];
for (const c of ids) {
  const t0 = Date.now();
  let r;
  try { r = askMemory({theory, repo: s.sessions.repository(s.id), session, query: `@q query\n  select ?w\n  where violation ${c.id} ?w\n`, limits: {maxLookups: 300000, maxProbes: 600000, maxFacts: 60000, retrievalMs: 60000}, budget: {timeoutMs: 120000}}); }
  catch (error) { r = {status: 'error', error: error.message}; }
  const witnesses = (r.rows ?? []).map(x => Object.values(x)[0]);
  out.push({...c, status: r.status, complete: r.complete ?? null, violations: witnesses.length, witnesses: witnesses.slice(0, limit), ms: Date.now() - t0, ...(r.error ? {error: r.error} : {})});
  console.error(c.id, r.status, witnesses.length, Date.now() - t0 + 'ms');
}
s.close();
const report = {base: opt('--base', 'world-v1'), ran_at: new Date().toISOString(), constraints: out};
if (opt('--out', null)) { fs.mkdirSync(path.dirname(path.resolve(opt('--out'))), {recursive: true}); fs.writeFileSync(path.resolve(opt('--out')), JSON.stringify(report, null, 1) + '\n'); }
console.log(JSON.stringify(out.map(({id, severity, status, violations, witnesses, ms}) => ({id, severity, status, violations, witnesses: witnesses.slice(0, 5), ms}))));
process.exit(0);
