#!/usr/bin/env node
/**
 * TinyAgent command line. Every command except `serve`, `migrate-home` and `probe` is a client of the server on the default port
 * (http://127.0.0.1:18080, TINYAGENT_URL); when no server answers, the first client starts one in the background (detached) and uses it.
 *
 *   tinyagent serve [--port N] [--host H] [--config file]       the server (one per machine)
 *   tinyagent run "<instructions>" [--workdir DIR] [--plans DIR] [--plan-only|--dry-run] [--no-cache] [--json]
 *                                                                the agent: reuse a cached plan or write one (plan as code), run it
 *   tinyagent plans list|show <id>|verify <id>|rm <id>|promote <id> --name <skill> [--to DIR]   [--workdir DIR] [--plans DIR]
 *   tinyagent run-skills "<request>" [--attach file]... [--plan-only]   plan server skills as steps on the planner tier, then run them
 *   tinyagent skills | skill <name> [--inputs '{json}'] [--attach file]... [--detach]
 *   tinyagent job <dir> [--stage s] [--resume run-id] [--refresh] [--no-register] [--publish dir]
 *   tinyagent check <dir> | list [job] | show <job> <run-id> | prune
 *   tinyagent task --instructions "..." [--attach file]... [--target memory:<id>|session:<id>|none] [--template name --params '{json}']
 *   tinyagent chat [--tier small] [--system "..."] "<prompt>"
 *   tinyagent stats [--json] | health | models [start|stop <name>] | ops [id]
 *   tinyagent migrate-home [--yes]                               copy the data of the earlier proxy into ~/.tinyagent (verified)
 *   tinyagent probe --yes --model <id> [...]                     measure a provider's real rate limits (spends quota)
 * Common: --config <file> (project layer), --url <server>, --purpose <tag> (default skill:cli).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createTinyAgent } from '../lib/client.mjs';
import { loadLayers } from '../lib/config.mjs';

const args = process.argv.slice(2);
const FLAGS = new Set(['--refresh', '--no-register', '--json', '--plan-only', '--dry-run', '--no-cache', '--yes', '--detach']);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const opts = (n) => args.flatMap((a, i) => (a === `--${n}` ? [args[i + 1]] : []));
const flag = (n) => args.includes(`--${n}`);
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !FLAGS.has(args[i - 1])));
const [cmd, ...rest] = positional;
const out = (o) => console.log(typeof o === 'string' ? o : JSON.stringify(o, null, 1));

const layers = () => loadLayers({ project: opt('config') });
const client = (purpose = opt('purpose', 'skill:cli')) => createTinyAgent({ url: opt('url'), purpose, autostart: process.env.TINYAGENT_AUTOSTART !== '0', config: layers().project });
const logLine = (l) => process.stderr.write(`${l}\n`);
const finishOp = (op) => { out(op.result?.summary ?? op.error ?? op.status); if (op.status !== 'finished') process.exitCode = 3; };

async function main() {
  switch (cmd) {
    case 'serve': {
      const { serve } = await import('../lib/server.mjs');
      const s = await serve({ port: opt('port'), host: opt('host'), project: opt('config') });
      if (s?.already) process.exit(0);
      return;
    }
    case 'run': return agentRun();
    case 'plans': return plansCommand();
    case 'run-skills': return finishOp(await client().run(rest.join(' '), { attach: opts('attach'), planOnly: flag('plan-only'), onLog: logLine }));
    case 'skills': { const r = await client().skills(); for (const s of r.skills) out(`${s.name.padEnd(22)} ${s.description.slice(0, 110)}`); for (const p of r.problems ?? []) logLine(`problem: ${p}`); return; }
    case 'skill': {
      // --detach: start the operation and print its id at once (the background form); `tinyagent ops <id>` follows it.
      const op = await client().skill(rest[0], opt('inputs') ? JSON.parse(opt('inputs')) : {}, { attach: opts('attach'), onLog: logLine, ...(flag('detach') ? { wait: false } : {}) });
      return flag('detach') ? out({ id: op.id, status: op.status ?? 'started', follow: `tinyagent ops ${op.id}` }) : finishOp(op);
    }
    case 'job': {
      const op = await client().runJob(rest[0], { stage: opt('stage'), resume: opt('resume'), refresh: flag('refresh'), register: !flag('no-register'), publish: opt('publish'), onLog: logLine });
      if (op.result?.published) logLine(`published: ${op.result.published}`);
      return finishOp(op);
    }
    case 'task': {
      const [kind, ...id] = String(opt('target', 'none')).split(':');
      return finishOp(await client().task({ instructions: opt('instructions', ''), attachments: opts('attach'), target: { kind, id: id.join(':') || null }, template: opt('template'), params: opt('params') ? JSON.parse(opt('params')) : null }, { onLog: logLine }));
    }
    case 'chat': {
      const r = await client().chat({ tier: opt('tier', 'small'), system: opt('system') ?? undefined, prompt: rest.join(' '), maxTokens: Number(opt('max-tokens', 2000)), retryCut: true });
      if (!r.ok) { logLine(r.reason); process.exitCode = 3; return; }
      return out(r.text);
    }
    case 'stats': {
      const s = await client().stats();
      if (flag('json')) return out(s);
      out(`tiers: ${s.tiers.map((t) => `${t.id}=${t.x_tier.serves ?? 'unavailable'}`).join(', ')}`);
      out(`last hour: ${s.windows.hour.calls} calls, ${s.windows.hour.cost_usd.toFixed(4)} USD, ${s.windows.hour.plan_requests.toFixed(2)} plan credits; cache ${s.cache.hits} hits`);
      for (const [n, p] of Object.entries(s.plan ?? {})) for (const l of p.limits) out(`${n} ${l.name}: ${l.used}/${l.max} ${l.unit}${l.warn ? ' (warn)' : ''}`);
      for (const [n, u] of Object.entries(s.upstreams ?? {})) if (u.depth || u.active) out(`${n}: active ${u.active}, queued interactive ${u.queued?.interactive ?? 0}, normal ${u.queued?.normal ?? 0}, background ${u.queued?.background ?? 0}${u.held_reason ? ` (held: ${u.held_reason})` : ''}`);
      for (const [n, l] of Object.entries(s.local ?? {})) out(`local ${n}: ${l.managed ? `running pid ${l.pid}` : 'not managed'}${l.last_refusal ? ` (last refusal: ${l.last_refusal.reason})` : ''}`);
      return;
    }
    case 'health': return out(await client().health());
    case 'models': {
      const ta = client();
      if (rest[0] === 'start' || rest[0] === 'stop') return out(await ta.model(rest[1], rest[0]));
      for (const [n, m] of Object.entries(await ta.models())) out(`${n.padEnd(12)} ${String(m.model).padEnd(18)} ${m.running ? (m.managed ? `running (pid ${m.pid})` : 'running (not started by this server)') : 'stopped'}  slots ${m.slots ?? '-'}  active ${m.active}/${m.max_concurrent}  queued ${m.queued}  ${m.always_on ? 'always on' : `idle stop ${Math.round(m.idle_stop_ms / 60000)} min`}${m.last_refusal ? `  last refusal: ${m.last_refusal.reason}` : ''}`);
      return;
    }
    case 'ops': return out(rest[0] ? await client().op(rest[0]) : await client().ops());
    case 'check': case 'list': case 'show': case 'prune': return localJobCommand();
    case 'migrate-home': { const { migrateHome } = await import('../lib/migrate.mjs'); return out(await migrateHome({ apply: flag('yes'), log: logLine })); }
    case 'probe': { process.argv.splice(2, 1); await import('../lib/probe.mjs'); return; }
    default:
      console.error(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith(' *')).map((l) => l.slice(3)).join('\n'));
      process.exit(2);
  }
}

/** `tinyagent run`: the agent in this process (tools confined to the work folder), its model calls through the server. */
async function agentRun() {
  const { runAgent } = await import('../lib/agent/index.mjs');
  const { config } = layers();
  const r = await runAgent({ request: rest.join(' '), workdir: path.resolve(opt('workdir', '.')), plansDir: opt('plans') ? path.resolve(opt('plans')) : null, ta: client('run:cli'), config,
    planOnly: flag('plan-only') || flag('dry-run'), useCache: !flag('no-cache'), log: logLine });
  if (flag('json')) return out(r);
  logLine(`plans: ${r.plans}`);
  logLine(`run: ${r.runDir} (${r.status}, ${r.how ?? '-'}${r.plan ? ` ${r.plan}` : ''}, ${r.rounds ?? 0} planner round(s), ${r.stats.calls} model call(s), ${r.stats.credits} credits, ${r.ms} ms)`);
  if (r.code) out(r.code);
  out(r.summary ?? r.status);
  if (!['finished', 'planned'].includes(r.status)) process.exitCode = 3;
}

/** `tinyagent plans`: the plan cache of a work folder (a plain folder; no model call). */
async function plansCommand() {
  const { PlanCache, agentSettings, plansDirOf, extractMeta, promotedPluginSource } = await import('../lib/agent/index.mjs');
  const { config } = layers();
  const S = agentSettings(config);
  const workdir = path.resolve(opt('workdir', '.'));
  const cache = new PlanCache(plansDirOf(workdir, S, opt('plans') ? path.resolve(opt('plans')) : null));
  const [sub, id] = rest;
  logLine(`plans: ${cache.dir}`);
  if (!sub || sub === 'list') {
    const plans = await cache.load({ extractMeta: (code) => extractMeta(code, S) });
    if (flag('json')) return out(plans.map(({ code, md, ...p }) => p));
    for (const p of plans) out(`${p.id.padEnd(40)} ${p.status.padEnd(9)} runs ${String(p.front.runs ?? 0).padStart(3)}  ${p.metaError ? `[${p.metaError.slice(0, 60)}] ` : ''}${(p.meta?.task ?? '').slice(0, 90)}`);
    if (!plans.length) out('(no plans)');
    return;
  }
  if (!id) throw new Error(`tinyagent plans ${sub} <id>`);
  if (sub === 'show') { const p = cache.read(id); out(`${p.dir}  (status ${p.status}, hash ${p.hash})\n`); out(p.md); out('--- plan.mjs ---'); out(p.code); return; }
  if (sub === 'verify') {
    const m = await extractMeta(cache.read(id).code, S);
    if (m.error) throw new Error(`the plan cannot be verified: ${m.error}`);
    const p = cache.verify(id);
    return out(`${id}: verified (hash ${p.hash})`);
  }
  if (sub === 'rm') { cache.remove(id); return out(`${id}: removed`); }
  if (sub === 'promote') {
    const name = opt('name');
    if (!name || !/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(name)) throw new Error('--name <skill-name> (lowercase letters, digits, . _ -)');
    const p = cache.read(id);
    if (p.status !== 'verified') throw new Error(`${id} is ${p.status}; only a verified plan is promoted (tinyagent plans verify ${id})`);
    const m = await extractMeta(p.code, S);
    if (m.error) throw new Error(m.error);
    const toDir = path.resolve(opt('to', path.join(workdir, '.tinyagent', 'skill-plugins')));
    fs.mkdirSync(toDir, { recursive: true });
    const file = path.join(toDir, `${name}.mjs`);
    if (fs.existsSync(file) && !flag('yes')) throw new Error(`${file} exists (--yes replaces it)`);
    fs.writeFileSync(file, promotedPluginSource({ name, plan: p, meta: m.meta, toDir }));
    return out(`${file}: SkillPlugin ${name} (add ${toDir} to skills.plugins of a configuration layer to serve it)`);
  }
  throw new Error(`unknown plans command ${sub} (list, show, verify, rm, promote)`);
}

/** Commands that read the run folders of the job runner (no model call). */
async function localJobCommand() {
  const { RunStore, loadJob, loadInputs, liveTiers, chooseStart, readTierStats, pruneTasks } = await import('../lib/jobs/index.mjs');
  const { config } = layers();
  const r = config.runner ?? {};
  const rc = { endpoint: client().url, dataDir: r.dataDir, roles: r.roles ?? {}, fallback: {}, limits: r.limits ?? {}, tasks: r.tasks ?? {}, templatesDir: r.templatesDir ?? null };
  const store = new RunStore({ root: rc.dataDir });
  if (cmd === 'list') { for (const x of store.runs(rest[0] ?? null)) out(JSON.stringify(x)); return; }
  if (cmd === 'show') { process.stdout.write(fs.readFileSync(path.join(store.runDir(rest[0], rest[1]), 'summary.md'), 'utf8')); return; }
  if (cmd === 'prune') { out(`removed ${pruneTasks(rc).length} task folder(s)`); return; }
  const ta = client();
  await ta.health(); // starts the server when none runs
  const live = await liveTiers(ta.url);
  const job = await loadJob(rest[0], { config: rc, live });
  const items = await loadInputs(job.spec.inputs, { dir: job.dir, ctx: { params: null } });
  const name = (m) => (m.upstream ? `${m.upstream}/${m.model}` : `tier:${m.model}`);
  const ladder = job.spec.ladderChains?.map((l) => ({ tier: l.tier, chain: l.chain.map(name) })) ?? null;
  const start = ladder ? chooseStart({ kind: job.spec.kind, ladder: ladder.map((l) => l.tier), quality: job.spec.quality, adaptive: job.spec.adaptive, rows: readTierStats(rc.dataDir) }) : null;
  out({ job: job.spec.name, spec_hash: job.hash, data_dir: rc.dataDir, server: ta.url, live_tiers: [...live], items: items.length, first_ids: items.slice(0, 5).map((i) => i.id), models: job.spec.models.map(name), ladder,
    start: start && { tier: ladder[start.start].tier, reason: start.reason, probe: start.probe }, decider: job.spec.decider?.map(name) ?? null, auditor: job.spec.audit?.models?.map(name) ?? null, stages: job.spec.stages, budget: job.spec.budget });
}

main().catch((e) => { console.error(e.message); process.exit(1); });
