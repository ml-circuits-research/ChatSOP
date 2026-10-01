#!/usr/bin/env node
/** DeepSeek cost of the SymbolicProofingLLM iteration-2 work (data build, decomposition top-up, evaluation judging), from the omp session files and the item counts.
 *
 *   node tools/eval/symbolic-proofing-cost.mjs [--since 2026-09-30T23:54:00Z] [--out eval/reports/current/symbolic-proofing-it2/deepseek-cost.json]
 *
 * Metered: the agent turns of the omp sessions that name one of the task folders (usage.cost.total in the session files). NOT metered: the judge requests
 * issued from the eval kernel with completion(); their cost is estimated from the item sizes and the price implied by the metered turns of the earlier
 * oracle folders (tools/datasets/neuro-oracle/cost.mjs estimateKernel). The estimate is an order of magnitude, not an invoice.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {FOLDERS, sessionCosts, estimateKernel} from '../datasets/neuro-oracle/cost.mjs';

const args = process.argv.slice(2), opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const SINCE = Date.parse(opt('since', '2026-09-30T23:54:00Z'));
const MINE = ['symbolic_proofing_parse_judge', 'symbolic_proofing_it2_meaning_judge', 'symbolic_proofing_it2_eval_meaning_judge', 'decomp_backgen'];
const SESSIONS = path.join(os.homedir(), '.omp/agent/sessions/-work-ChatSOP');
const readJsonl = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

// price from the earlier folders' metered turns
const earlier = sessionCosts();
const price = Object.values(earlier).map(o => o.price_per_m).find(p => p?.input) ?? null;

// metered agent turns of this work
const metered = Object.fromEntries(MINE.map(f => [f, {sessions: 0, turns: 0, cost_usd: 0}]));
for (const name of fs.readdirSync(SESSIONS).filter(n => n.endsWith('.jsonl'))) {
  const stamp = Date.parse(name.slice(0, 24).replace(/T(\d\d)-(\d\d)-(\d\d)-(\d+)Z/, 'T$1:$2:$3.$4Z'));
  if (!(stamp >= SINCE)) continue;
  let folder = null, cost = 0, turns = 0;
  for (const line of fs.readFileSync(path.join(SESSIONS, name), 'utf8').split('\n')) {
    if (!line) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    const m = r.message;
    if (!m) continue;
    if (!folder && m.role === 'user') { const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content); folder = MINE.find(f => text.includes(f)) ?? null; }
    if (m.usage?.cost) { turns++; cost += m.usage.cost.total ?? 0; }
  }
  if (folder) { const o = metered[folder]; o.sessions++; o.turns += turns; o.cost_usd += cost; }
}
for (const o of Object.values(metered)) o.cost_usd = Number(o.cost_usd.toFixed(4));

// estimated kernel calls
const folderItems = (folder, skip = 0) => readJsonl(path.join(ROOT, 'datasets_sources', folder, 'input/items.jsonl')).slice(skip);
const systemChars = (folder, cond) => { const f = path.join(ROOT, 'datasets_sources', folder, `SYSTEM_${cond}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').length : 3000; };
const PARSE_START = Number(opt('parse-items-before', 9166));
const kernel = {};
const plan = [['symbolic_proofing_parse_judge', PARSE_START, {a: 90, c: 90}], ['symbolic_proofing_it2_meaning_judge', 0, {m1: 90, m2: 220}], ['symbolic_proofing_it2_eval_meaning_judge', 0, {m1: 90, m2: 220}]];
let total = 0;
for (const [folder, skip, outTokens] of plan) {
  const items = folderItems(folder, skip), by = {};
  for (const it of items) { const e = by[it.condition] ?? (by[it.condition] = {calls: 0, userChars: 0}); e.calls++; e.userChars += it.user.length; }
  kernel[folder] = {};
  for (const [cond, e] of Object.entries(by)) {
    const usd = estimateKernel({calls: e.calls, systemChars: systemChars(folder, cond), userChars: e.userChars / e.calls, outputTokens: outTokens[cond] ?? 100}, price);
    kernel[folder][cond] = {calls: e.calls, estimated_usd: usd};
    total += usd ?? 0;
  }
}
const meteredTotal = Object.values(metered).reduce((a, o) => a + o.cost_usd, 0);
const report = {generated_at: new Date().toISOString(), since: new Date(SINCE).toISOString(), price_per_m: price, metered_agent_turns: metered, estimated_kernel_judge_calls: kernel, totals: {metered_usd: Number(meteredTotal.toFixed(3)), estimated_kernel_usd: Number(total.toFixed(3)), sum_usd: Number((meteredTotal + total).toFixed(3))},
  note: 'Kernel completion() calls are not in the session files; the estimate uses item sizes and the metered price. DeepSeek-V4.1-Flash through omp for all of it.'};
const outFile = opt('out', null);
if (outFile) fs.writeFileSync(path.resolve(ROOT, outFile), JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify(report, null, 1));
void FOLDERS;
