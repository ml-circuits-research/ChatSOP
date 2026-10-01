#!/usr/bin/env node
/** Termination fuzz of the UD → SOP rules (DS021 "Rules budget"): runs `convertParse` over recorded Stanza parses with a
 * per-row wall-clock measurement and reports every row that hit the rules budget, threw, left a head cycle in the
 * repaired tree or took longer than `--slow` ms (default 250). No GPU is needed for the recorded parses.
 *
 *   node tools/ud-rules-fuzz.mjs [--parses file]...              # default: the symbolic-regression parse cache
 *   node tools/ud-rules-fuzz.mjs --collect [--device auto|cpu]   # also parses every other message of datasets/ and eval/suites/
 *                                                                # (new parses go to eval/reports/current/ud-rules-fuzz/parses.json)
 * Exit code 1 when a row hit the budget, threw or produced a cyclic tree.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {convertParse} from '../lib/ud-to-sop/index.mjs';
import {Analysis} from '../lib/ud-to-sop/analyze.mjs';
import {repairSentence} from '../lib/ud-to-sop/repair.mjs';
import {cycleWords} from '../lib/ud-to-sop/tree.mjs';
import {readJsonlShardedSync, jsonlExists} from '../lib/jsonl-shards.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT_DIR = path.join(ROOT, 'eval/reports/current/ud-rules-fuzz');
const o = {parses: []};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--parses') o.parses.push(process.argv[++i]);
  else if (a.startsWith('--')) o[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true;
}
if (!o.parses.length) o.parses.push('eval/reports/current/symbolic-regression/parses.json');
const slowMs = Number(o.slow ?? 250);

function messages() {
  const out = new Set();
  const walk = dir => { for (const e of fs.readdirSync(dir, {withFileTypes: true})) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f); else if (/\.jsonl$/.test(e.name)) read(f); } };
  const read = file => { for (const row of readJsonlShardedSync(file.replace(/\.part-\d+\.jsonl$/, '.jsonl'))) for (const k of ['message', 'question', 'input', 'text']) if (typeof row[k] === 'string' && row[k].length < 2000) out.add(row[k]); };
  for (const dir of ['datasets', 'eval/suites']) if (fs.existsSync(path.join(ROOT, dir))) walkSafe(path.join(ROOT, dir), walk);
  return [...out];
}
function walkSafe(dir, walk) { try { walk(dir); } catch (error) { process.stderr.write(`skip ${dir}: ${error.message}\n`); } }

const parses = new Map();
for (const file of o.parses) {
  const cache = JSON.parse(fs.readFileSync(path.resolve(ROOT, file), 'utf8'));
  for (const [key, parse] of Object.entries(cache.parses ?? cache)) parses.set(key, parse);
}
if (o.collect) {
  const extra = path.join(OUT_DIR, 'parses.json');
  fs.mkdirSync(OUT_DIR, {recursive: true});
  const known = fs.existsSync(extra) ? JSON.parse(fs.readFileSync(extra, 'utf8')).parses : {};
  for (const [key, parse] of Object.entries(known)) parses.set(key, parse);
  const seen = new Set([...parses.keys()].map(k => k.replace(/^[a-z]+\|/, '')));
  const todo = messages().filter(m => !seen.has(m));
  console.error(`parsing ${todo.length} new messages`);
  const {StanzaWorker} = await import('../lib/ud-to-sop/stanza.mjs');
  const worker = new StanzaWorker({device: o.device ?? 'auto'});
  try {
    for (let i = 0; i < todo.length; i += 64) {
      const batch = todo.slice(i, i + 64);
      const {parses: got} = await worker.parseMany(batch);
      batch.forEach((m, j) => { known[`auto|${m}`] = got[j]; parses.set(`auto|${m}`, got[j]); });
      if ((i / 64) % 20 === 0) { fs.writeFileSync(extra, JSON.stringify({parses: known})); process.stderr.write(`\r${i + batch.length}/${todo.length}`); }
    }
  } finally { fs.writeFileSync(extra, JSON.stringify({parses: known})); await worker.stop(); }
}

const findings = [];
const times = [];
let n = 0;
for (const [key, parse] of parses) {
  const message = parse.text ?? key.replace(/^[a-z]+\|/, '');
  const started = performance.now();
  let outcome = null, problem = null;
  try {
    for (const s of parse.sentences ?? []) {
      const repaired = repairSentence({...s, language: s.language ?? parse.language});
      if (cycleWords(repaired.words).length) problem = 'cyclic tree after repairs';
      if (repaired.repairs?.rejected) findings.push({kind: 'repair_rejected', message, repairs: repaired.repairs.rejected});
    }
    const result = convertParse(parse, message);
    outcome = result.outcome;
    if (outcome === 'budget') problem = 'budget: ' + result.notes[0];
  } catch (error) { problem = 'threw: ' + String(error.message).slice(0, 120); }
  const ms = performance.now() - started;
  times.push(ms);
  n++;
  if (problem) findings.push({kind: 'failure', message, problem, ms});
  else if (ms > slowMs) findings.push({kind: 'slow', message, ms: Math.round(ms), outcome});
}
times.sort((a, b) => a - b);
const pct = q => Math.round(times[Math.min(times.length - 1, Math.floor(times.length * q))] * 100) / 100;
const summary = {rows: n, p50_ms: pct(0.5), p99_ms: pct(0.99), max_ms: pct(1), failures: findings.filter(f => f.kind === 'failure').length, slow: findings.filter(f => f.kind === 'slow').length, repairs_rejected: findings.filter(f => f.kind === 'repair_rejected').length};
fs.mkdirSync(OUT_DIR, {recursive: true});
fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify({summary, findings}, null, 1) + '\n');
console.log(JSON.stringify(summary));
for (const f of findings.slice(0, 20)) console.log(JSON.stringify(f));
process.exit(summary.failures ? 1 : 0);
