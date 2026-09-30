#!/usr/bin/env node
/** Evaluation of eval-parse-judge-haiku-v1 (preregistered: status/preregistrations/eval-parse-judge-haiku-v1.json).
 *   node tools/research/parse-judge-reference.mjs                              # reference.jsonl (513, clean flag)
 *   node tools/research/parse-judge-eval.mjs run --stage 1|2 --cond a,b,c [--parallel 6]
 *   node tools/research/parse-judge-eval.mjs report                            # metrics.json from the results-<cond>.jsonl files
 */
import fs from 'node:fs';
import path from 'node:path';
import {judgeRows, Ledger, HAIKU} from './parse-judge.mjs';
const OUT = 'eval/reports/current/parse-judge';
const rl = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(x => x.trim()).map(JSON.parse) : []);
import {mulberry, report} from './parse-judge-report.mjs';

/** Stage-1 order: a seeded shuffle round-robin over the reference labels so the first 100 are stratified. */
export function stageRows(stage, population = 'clean') {
  if (population === 'ext') return rl(`${OUT}/extension.jsonl`);
  const all = rl(`${OUT}/reference.jsonl`).filter(r => population === 'all' || r.clean_en);
  const rand = mulberry(20260930);
  const byLabel = {};
  for (const r of all) (byLabel[r.ref] ??= []).push(r);
  for (const list of Object.values(byLabel)) for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  const first = [];
  const labels = Object.keys(byLabel).sort();
  // proportional allocation of the first 100 (at least 1 per non-empty label)
  const quota = Object.fromEntries(labels.map(l => [l, Math.max(1, Math.round(100 * byLabel[l].length / all.length))]));
  for (const l of labels) first.push(...byLabel[l].slice(0, quota[l]));
  const firstIds = new Set(first.map(r => r.id));
  const rest = all.filter(r => !firstIds.has(r.id));
  return stage === 1 ? first : [...first, ...rest];
}

async function run(args) {
  const rows = stageRows(Number(args.stage ?? 1), args.population ?? 'clean').map(r => ({id: r.id, message: r.message, analysis: r.analysis}));
  const ledger = new Ledger(`${OUT}/ledger.json`, 15);
  for (const cond of String(args.cond ?? 'a').split(',')) {
    const t = Date.now();
    const out = await judgeRows(rows, {condition: cond, model: HAIKU, thinking: 2048, parallel: Number(args.parallel ?? 6), dir: `${OUT}/cache`, ledger});
    const file = `${OUT}/results-${cond}.jsonl`;
    const prior = new Map(rl(file).map(r => [r.id, r]));
    for (const r of out) prior.set(r.id, r);
    fs.writeFileSync(file, [...prior.values()].map(r => JSON.stringify(r)).join('\n') + '\n');
    const dist = out.reduce((a, r) => ({...a, [r.verdict ?? 'unusable']: (a[r.verdict ?? 'unusable'] ?? 0) + 1}), {});
    console.log(`cond ${cond} stage ${args.stage}: ${out.length} rows in ${((Date.now() - t) / 1000).toFixed(0)} s`, dist, 'ledger', ledger.data.total_usd);
  }
}

const args = {};
const argv = process.argv.slice(2);
for (let i = 1; i < argv.length; i++) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
if (argv[0] === 'run') run(args).catch(e => { console.error(e.stack); process.exitCode = 1; });
else if (argv[0] === 'report') report(args);
