#!/usr/bin/env node
/**
 * LLMJobs command line (README.md). Prints only short summaries; everything else stays in the run or task folder.
 *
 *   node LLMJobs/run.mjs <job-dir> [--stage <name>] [--resume <run-id>] [--refresh] [--no-register] [--publish <dir>] [--config <file>]
 *   node LLMJobs/run.mjs check <job-dir>                 validate the spec; show chains, ladder, start tier and selected items (no calls)
 *   node LLMJobs/run.mjs list [<job-name>]               the append-only run index
 *   node LLMJobs/run.mjs show <job-name> <run-id>        a run's summary.md
 *   node LLMJobs/run.mjs task --instructions <text> [--attach <file>]... [--target memory:<id>|session:<id>|none]
 *                             [--template <name> --params <json>]      plan (or use the template) and run a task
 *   node LLMJobs/run.mjs prune                           remove task folders older than tasks.keepDays
 */
import fs from 'node:fs';
import path from 'node:path';
import {loadJob, runJob, RunStore, publishSummary, loadConfig, liveTiers, loadInputs, chooseStart, readTierStats, runTask, pruneTasks} from './lib/index.mjs';

const args = process.argv.slice(2);
const FLAGS = new Set(['--refresh', '--no-register']);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const opts = n => args.flatMap((a, i) => (a === `--${n}` ? [args[i + 1]] : []));
const flag = n => args.includes(`--${n}`);
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !FLAGS.has(args[i - 1])));

async function main() {
  const [cmd, ...rest] = positional;
  const usage = 'usage: node LLMJobs/run.mjs <job-dir> [--stage s] [--resume run-id] | check <job-dir> | list [job] | show <job> <run> | task --instructions ... | prune';
  if (!cmd) { console.error(usage); process.exit(2); }
  const jobDir = ['check'].includes(cmd) ? rest[0] : cmd;
  const config = loadConfig({file: opt('config'), jobDir: jobDir && fs.existsSync(jobDir) ? jobDir : process.cwd()});
  const store = new RunStore({root: config.dataDir});
  if (cmd === 'list') { for (const r of store.runs(rest[0] ?? null)) console.log(JSON.stringify(r)); return; }
  if (cmd === 'show') { process.stdout.write(fs.readFileSync(path.join(store.runDir(rest[0], rest[1]), 'summary.md'), 'utf8')); return; }
  if (cmd === 'prune') { console.log(`removed ${pruneTasks(config).length} task folder(s)`); return; }
  if (cmd === 'task') {
    const [kind, ...id] = String(opt('target', 'none')).split(':');
    const r = await runTask({instructions: opt('instructions', ''), attachments: opts('attach').map(f => ({name: path.basename(f), path: path.resolve(f)})),
      target: {kind, id: id.join(':') || null}, template: opt('template'), params: opt('params') ? JSON.parse(opt('params')) : null, config,
      log: m => process.stderr.write(`[task] ${m}\n`)});
    console.log(r.summary);
    if (r.status !== 'finished') process.exitCode = 3;
    return;
  }
  const live = await liveTiers(config.endpoint);
  const job = await loadJob(jobDir, {config, live});
  if (cmd === 'check') {
    const items = await loadInputs(job.spec.inputs, {dir: job.dir, ctx: {params: null}});
    const name = m => (m.upstream ? `${m.upstream}/${m.model}` : `tier:${m.model}`);
    const ladder = job.spec.ladderChains?.map(l => ({tier: l.tier, chain: l.chain.map(name)})) ?? null;
    const start = ladder ? chooseStart({kind: job.spec.kind, ladder: ladder.map(l => l.tier), quality: job.spec.quality, adaptive: job.spec.adaptive, rows: readTierStats(config.dataDir)}) : null;
    console.log(JSON.stringify({job: job.spec.name, spec_hash: job.hash, config: config.file, data_dir: config.dataDir, endpoint: config.endpoint, live_tiers: [...live],
      items: items.length, first_ids: items.slice(0, 5).map(i => i.id), models: job.spec.models.map(name), ladder, start: start && {tier: ladder[start.start].tier, reason: start.reason, probe: start.probe},
      decider: job.spec.decider?.map(name) ?? null, auditor: job.spec.audit?.models?.map(name) ?? null, stages: job.spec.stages, budget: job.spec.budget}, null, 1));
    return;
  }
  const r = await runJob(job, {stage: opt('stage'), resume: opt('resume'), store, refresh: flag('refresh'), register: !flag('no-register'),
    log: m => process.stderr.write(`[${job.spec.name}] ${m}\n`)});
  console.log(r.summary);
  if (opt('publish')) console.log(`published: ${publishSummary(r.dir, path.resolve(opt('publish')), {job: job.spec.name, run: r.run})}`);
  if (r.status !== 'finished') process.exitCode = 3;
}

// An interrupted run keeps status "running" in run.json; --resume <run-id> continues it in its own folder.
main().catch(e => { console.error(e.message); process.exit(1); });
