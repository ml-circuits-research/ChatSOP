#!/usr/bin/env node
/**
 * Runs jobs/smalltalk-replies (or jobs/smalltalk-judge) through the LLM job runner (LLMJobs/lib) with a fixed worker tier, so tiers
 * can be compared on the same items. Runs write only to state/llm-jobs/<name>/<run-id>/ (gitignored); calls are tagged
 * `x-llmapiprovider-purpose: job:<name>`.
 *
 *   node tools/smalltalk/generate.mjs --tier tiny|small [--n 20 --seed S] [--name smalltalk-replies-tiny] [--stage pilot]
 *   node tools/smalltalk/generate.mjs --job smalltalk-judge --tier medium --input FILE.jsonl [--name ...]
 */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConfig, liveTiers, tierChains, loadJob, runJob, RunStore} from '../../LLMJobs/lib/index.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };

const jobName = opt('job', 'smalltalk-replies');
const tier = opt('tier', 'tiny');
const dir = path.join(ROOT, 'jobs', jobName);
const config = {...loadConfig({jobDir: dir}), dataDir: path.join(ROOT, 'state', 'llm-jobs')};
const live = await liveTiers(config.endpoint);
const base = await loadJob(dir, {config, live});
const overrides = {name: opt('name', `${jobName}-${tier}`), models: `tier:${tier}`};
if (opt('n')) overrides.inputs = {...base.spec.inputs, select: {n: Number(opt('n')), seed: opt('seed', 'smalltalk-tier-comparison')}};
if (opt('input')) overrides.inputs = {...(overrides.inputs ?? base.spec.inputs), path: path.resolve(opt('input')), command: undefined};
if (overrides.inputs?.command === undefined && overrides.inputs) delete overrides.inputs.command;
const job = await loadJob(dir, {config, live, overrides, tiers: tierChains(config, live)});
const r = await runJob(job, {stage: opt('stage'), resume: opt('resume'), store: new RunStore({root: config.dataDir}), log: m => process.stderr.write(`[${job.spec.name}] ${m}\n`)});
console.log(r.summary);
console.log(`run dir: ${path.relative(ROOT, r.dir)}`);
if (r.status !== 'finished') process.exitCode = 3;
