#!/usr/bin/env node
// TEMPORARY shim (phase 1 of the TinyAgent migration; removed in phase 2): the job runner moved to TinyAgent. This keeps the earlier
// command line for the agents still using it (the job runs in this process; its model calls go to the configured endpoint).
// New work: node TinyAgent/bin/tinyagent.mjs job <dir> | task ... | check | list | show | prune.
import fs from 'node:fs';
import path from 'node:path';
import {loadJob, runJob, RunStore, publishSummary, loadConfig, liveTiers, loadInputs, chooseStart, readTierStats, runTask, pruneTasks} from '../TinyAgent/lib/jobs/index.mjs';

const args = process.argv.slice(2);
const FLAGS = new Set(['--refresh', '--no-register']);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const opts = n => args.flatMap((a, i) => (a === `--${n}` ? [args[i + 1]] : []));
const flag = n => args.includes(`--${n}`);
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !FLAGS.has(args[i - 1])));

async function main() {
  const [cmd, ...rest] = positional;
  if (!cmd) { console.error('usage: node TinyAgent/bin/tinyagent.mjs job <dir> | task ... (this LLMJobs shim keeps the earlier commands)'); process.exit(2); }
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
    console.log(JSON.stringify({job: job.spec.name, spec_hash: job.hash, items: items.length, models: job.spec.models.map(name), ladder, start: start && {tier: ladder[start.start].tier, reason: start.reason}, stages: job.spec.stages, budget: job.spec.budget}, null, 1));
    return;
  }
  const r = await runJob(job, {stage: opt('stage'), resume: opt('resume'), store, refresh: flag('refresh'), register: !flag('no-register'), log: m => process.stderr.write(`[${job.spec.name}] ${m}\n`)});
  console.log(r.summary);
  if (opt('publish')) console.log(`published: ${publishSummary(r.dir, path.resolve(opt('publish')), {job: job.spec.name, run: r.run})}`);
  if (r.status !== 'finished') process.exitCode = 3;
}
main().catch(e => { console.error(e.message); process.exit(1); });
