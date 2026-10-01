#!/usr/bin/env node
/**
 * Evaluation harness of milestone P0 (programming plan): follow an instruction, produce a small function, verify it.
 *
 *   node eval/programming-kb/run-p0.mjs [--ids ci-01,ci-02] [--concurrency 4] [--model M] [--refresh] [--max-rounds 3] [--max-paid-usd 5]
 *
 * For every task of the sealed suite `eval/suites/code-instructions-v1/` the host loop (`lib/programming/solve-instruction.mjs`) is given only the
 * instruction, the entry name and the visible examples. When it has committed its packet (and its own `verified` flag), this harness runs the HIDDEN
 * tests on the final candidate in the code-sandbox: a `verified` packet that fails a hidden test is a FALSE-VERIFIED. Every run leaves an episode in the dream
 * store `eval/reports/current/programming-kb/p0-dream/`. The report is `eval/reports/current/programming-kb/p0.json` and `summary.md` (regenerable observations).
 * Early stopping: the run stops when more than 20 percent of the first 5 tasks end with a provider error or an unreadable reply (a broken condition).
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {solveInstruction} from '../../lib/programming/solve-instruction.mjs';
import {codeSandbox} from '../../reasoning/strategies/code-sandbox/index.mjs';
import {DreamStore} from '../../reasoning/strategies/dreaming-session/records.mjs';
import {loadConfig} from '../../reasoning/strategies/llm-agent/index.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const flag = n => args.includes(n);
const outDir = path.join(repo, 'eval/reports/current/programming-kb');

const rows = fs.readFileSync(path.join(repo, 'eval/suites/code-instructions-v1/test.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const wanted = opt('--ids')?.split(',');
const tasks = rows.filter(r => !wanted || wanted.includes(r.id));
const cfg = loadConfig();
const maxPaid = Number(opt('--max-paid-usd', cfg.maxPaidUsd ?? 5)), maxRounds = Number(opt('--max-rounds', 3)), concurrency = Number(opt('--concurrency', 4));
const model = opt('--model') ?? undefined;

fs.mkdirSync(outDir, {recursive: true});
const store = new DreamStore(path.join(outDir, 'p0-dream'));
store.episodes = []; store.tasks = {}; store.serial = 0; // a fresh store per run: one episode per task

async function one(row) {
  // the proposer sees id (as the task symbol), entry, instruction and the visible examples; never `hidden` or `reference`
  const task = {id: 't1', key: row.id, entry: row.entry, instruction: row.instruction, examples: row.examples};
  const packet = await solveInstruction(task, {maxRounds, maxPaidUsd: maxPaid, store, keepTask: true, model, refresh: flag('--refresh')});
  let hidden = null;
  if (packet.files?.['candidate.sop']) {
    const r = await codeSandbox.ask({code: packet.files['candidate.sop'], tests: row.hidden.map((h, i) => ({id: 'h' + (i + 1), call: h.call, expect: h.expect, kind: 'sealed'}))}, {perTestMs: 5000});
    hidden = {status: r.status, passed: r.tests.passed, total: r.tests.total, failures: (r.failures ?? []).map(f => ({id: f.id, call: f.call, expected: f.expected, actual: f.actual, error: f.error}))};
  }
  const falseVerified = packet.status === 'verified' && hidden?.status !== 'verified';
  return {id: row.id, topic: row.topic, entry: row.entry, status: packet.status, route: packet.route, solved_on: packet.solved_on, rounds: packet.rounds, failure_type: packet.failure_type, family: packet.family, guarantee: packet.guarantee,
    cost: packet.cost, ms: packet.ms, sandbox_ms: packet.sandbox_ms, episode: packet.episode, attempts: packet.attempts.map(a => ({round: a.round, model: a.model, outcome: a.outcome, failure_type: a.failure_type, ms: a.ms, problems: a.problems, failures: a.sandbox?.failures})),
    hidden, false_verified: falseVerified, honest_abstain: packet.status !== 'verified' && hidden?.status !== 'verified', missed_correct: packet.status !== 'verified' && hidden?.status === 'verified', packet_trace_facts: packet.sandbox?.trace?.length ?? 0};
}

const results = [];
const t0 = Date.now();
let next = 0, stopped = null;
async function worker() {
  while (next < tasks.length && !stopped) {
    const row = tasks[next++];
    const r = await one(row);
    results.push(r);
    console.log(`${r.id} ${r.entry.padEnd(18)} ${r.status.padEnd(16)} ${r.solved_on ?? r.failure_type} rounds=${r.rounds} hidden=${r.hidden ? r.hidden.passed + '/' + r.hidden.total : '-'}${r.false_verified ? '  FALSE-VERIFIED' : ''} ${Math.round(r.ms / 1000)}s`);
    const early = results.slice(0, 5);
    if (results.length >= 5 && early.filter(x => ['provider', 'malformed_output'].includes(x.failure_type)).length / early.length > 0.2) stopped = 'more than 20 percent of the first 5 tasks ended in a provider error or an unreadable reply';
  }
}
await Promise.all(Array.from({length: Math.max(1, concurrency)}, worker));
results.sort((a, b) => a.id.localeCompare(b.id));
store.save();

const n = results.length, verified = results.filter(r => r.status === 'verified');
const byType = {};
for (const r of results.filter(x => x.status !== 'verified')) byType[r.failure_type ?? 'other'] = (byType[r.failure_type ?? 'other'] ?? 0) + 1;
const attemptFailures = {};
for (const r of results) for (const a of r.attempts) if (a.failure_type) attemptFailures[a.failure_type] = (attemptFailures[a.failure_type] ?? 0) + 1;
const sum = f => results.reduce((s, r) => s + f(r), 0);
const summary = {
  tasks: n, verified: verified.length, first_try: results.filter(r => r.solved_on === 'first_try').length, after_repair: results.filter(r => r.solved_on === 'after_repair').length, failed: results.filter(r => r.status === 'failed').length, budget_exhausted: results.filter(r => r.status === 'budget_exhausted').length,
  failure_types_final: byType, failure_types_all_attempts: attemptFailures,
  false_verified: results.filter(r => r.false_verified).length, honest_abstain: results.filter(r => r.honest_abstain).length, missed_correct: results.filter(r => r.missed_correct).length,
  episodes: store.episodes.length, every_run_left_an_episode: results.every(r => r.episode), hidden_pass_of_verified: `${verified.filter(r => r.hidden?.status === 'verified').length}/${verified.length}`,
  model_calls: sum(r => r.cost.calls), paid_usd: sum(r => r.cost.paid_usd), notional_usd: Number(sum(r => r.cost.notional_usd).toFixed(4)), models: results.reduce((m, r) => { for (const [k, v] of Object.entries(r.cost.models)) m[k] = (m[k] ?? 0) + v; return m; }, {}),
  wall_s: Math.round((Date.now() - t0) / 1000), model_ms_total: Math.round(sum(r => r.ms)), sandbox_ms_total: Math.round(sum(r => r.sandbox_ms))
};
summary.success_signal = {verified_at_least_15_of_20: summary.verified >= 15 && n === 20, false_verified_zero: summary.false_verified === 0, every_run_left_an_episode: summary.every_run_left_an_episode};
const report = {format: 'chatsop-programming-kb-p0-v1', generated: new Date().toISOString(), note: 'Regenerable observation (eval/programming-kb/run-p0.mjs). Subscription models first; the pass rate is a baseline for later dreaming, not a benchmark claim.', config: {model: model ?? cfg.model, fallbackModels: cfg.fallbackModels, maxRounds, maxPaidUsd: maxPaid, concurrency, suite: 'eval/suites/code-instructions-v1'}, stopped, summary, results};
fs.writeFileSync(path.join(outDir, 'p0.json'), JSON.stringify(report, null, 1) + '\n');
const pct = x => (n ? Math.round(100 * x / n) : 0) + '%';
const md = [`# Programming P0: follow an instruction, produce a function, verify it`, '', `Generated ${report.generated}. Model ${report.config.model} (fallback ${(cfg.fallbackModels ?? []).join(', ')}), at most ${maxRounds} repair rounds, paid cap ${maxPaid} USD. Suite \`code-instructions-v1\` (${n} tasks, hidden tests sealed).`, stopped ? `\nSTOPPED EARLY: ${stopped}\n` : '',
  '## Result', '', `| measure | value |`, `| --- | --- |`, `| verified | ${summary.verified} of ${n} (${pct(summary.verified)}) |`, `| solved on the first try | ${summary.first_try} |`, `| solved after repair | ${summary.after_repair} |`, `| failed | ${summary.failed} |`, `| budget exhausted | ${summary.budget_exhausted} |`,
  `| false-verified (verified, fails a hidden test) | ${summary.false_verified} |`, `| verified programs passing all hidden tests | ${summary.hidden_pass_of_verified} |`, `| honest abstain (not verified, hidden tests also fail) | ${summary.honest_abstain} |`, `| not verified but correct on hidden tests | ${summary.missed_correct} |`, `| episodes recorded | ${summary.episodes} |`,
  `| model calls | ${summary.model_calls} |`, `| paid USD | ${summary.paid_usd} |`, `| notional USD (subscription, not paid) | ${summary.notional_usd} |`, `| wall time | ${summary.wall_s} s |`, '',
  `Final failure types: ${JSON.stringify(byType)}. Failure types over all attempts: ${JSON.stringify(attemptFailures)}.`, '',
  '## Success signal', '', ...Object.entries(summary.success_signal).map(([k, v]) => `- ${k}: ${v ? 'yes' : 'NO'}`), '',
  '## Tasks', '', '| task | entry | status | solved on | rounds | failure | hidden | seconds |', '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ...results.map(r => `| ${r.id} | ${r.entry} | ${r.status}${r.false_verified ? ' (FALSE-VERIFIED)' : ''} | ${r.solved_on ?? '-'} | ${r.rounds} | ${r.failure_type ?? '-'} | ${r.hidden ? r.hidden.passed + '/' + r.hidden.total : '-'} | ${Math.round(r.ms / 1000)} |`), ''].join('\n');
fs.writeFileSync(path.join(outDir, 'summary.md'), md);
console.log('\n' + JSON.stringify(summary, null, 1));
console.log('report: eval/reports/current/programming-kb/p0.json');
