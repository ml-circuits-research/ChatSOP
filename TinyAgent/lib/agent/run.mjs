// `tinyagent run`: a small coding-style agent for clear, simple, repetitive tasks in a work folder.
//
//   1. Skills: the Agent Skills of the work folder (.agents/skills) and of `agent.skillDirs`; the planner sees names and descriptions.
//   2. Fast match: BM25 over the cached plans, then the cheap tier decides "same task, other parameters?" and extracts the values
//      (lib/agent/match.mjs). A match with valid values runs the cached plan directly: no planner, no new code.
//   3. Otherwise the planner tier writes a plan (lib/agent/plan-code.mjs) against `tools.*`; it runs in the sandbox (lib/sandbox.mjs
//      runPlan) with the tools served by the host over the message channel, confined to the work folder (lib/agent/workspace.mjs). A
//      failure (load error, exception, failed check) goes back to the planner, at most `agent.maxRounds` rounds.
//   4. A plan that ran and passed its own check is stored `verified` in the plan cache (lib/agent/plan-cache.mjs) and reused; one
//      without a check is stored `draft` until a person confirms it (`tinyagent plans verify`).
// Every run owns a folder (<workdir>/.tinyagent/runs/<run-id>/): request.json, decision.json, plan-<round>.mjs, calls.jsonl, errors.jsonl,
// result.json. Model calls go through the TinyAgent library (`ta`), tagged with the run's purpose and budget.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runPlan } from '../sandbox.mjs';
import { validateInputs } from '../skills.mjs';
import { jsonOf } from '../client.mjs';
import { createWorkspace } from './workspace.mjs';
import { discoverSkills, skillRoots, skillCatalog, skillBody, runSkillScript } from './agent-skills.mjs';
import { codeBlockOf, planScript, metaProblems, planHash } from './plan-code.mjs';
import { PlanCache } from './plan-cache.mjs';
import { matchPlan } from './match.mjs';

const PROMPTS = fileURLToPath(new URL('../../prompts/', import.meta.url));
export const AGENT_DEFAULTS = Object.freeze({
  plansDir: null, runsDir: null, skillDirs: [], plannerTier: null, matchTier: 'tiny', askTiers: null, maxRounds: 3, maxAsks: 30, maxToolCalls: 2000,
  timeMs: 120000, heapMb: 128, maxCodeBytes: 40000, checkOnReuse: true, budget: null,
  match: { k: 3, minScore: 0, grounded: true, extraBody: { chat_template_kwargs: { enable_thinking: false } }, maxTokens: 400 },
  planner: { maxTokens: 8000 },
});

/** The agent settings: AGENT_DEFAULTS under the configuration's `agent` section. */
export function agentSettings(config = {}) {
  const a = config.agent ?? {};
  return { ...AGENT_DEFAULTS, ...a, match: { ...AGENT_DEFAULTS.match, ...(a.match ?? {}) }, planner: { ...AGENT_DEFAULTS.planner, ...(a.planner ?? {}) },
    plannerTier: a.plannerTier ?? config.runner?.roles?.planner ?? 'good', askTiers: a.askTiers ?? config.sandbox?.tiers ?? ['nano', 'micro', 'tiny', 'small', 'medium'] };
}

/** The plan folder of a work folder: --plans, else agent.plansDir, else <workdir>/.tinyagent/plans. */
export const plansDirOf = (workdir, settings, explicit = null) => path.resolve(workdir, explicit ?? settings.plansDir ?? path.join('.tinyagent', 'plans'));
const runsDirOf = (workdir, settings) => path.resolve(workdir, settings.runsDir ?? path.join('.tinyagent', 'runs'));
const newRunId = () => `${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '')}-agent-${randomBytes(3).toString('hex')}`;
const clip = (v, n = 200) => JSON.parse(JSON.stringify(v ?? null, (k, x) => (typeof x === 'string' && x.length > n ? `${x.slice(0, n)}… (${x.length} chars)` : x)));

/** Model-call accounting per role (planner, match, ask): calls, credits, tokens, ms, cache hits, what served. */
function createStats() {
  const roles = {};
  return {
    add(role, r) {
      const s = (roles[role] ??= { calls: 0, ok: 0, credits: 0, usd: 0, in: 0, out: 0, ms: 0, cached: 0, served: [] });
      s.calls += r.calls ?? 1; if (r.ok) s.ok += 1;
      s.credits += Number(r.credits) || 0; s.usd += Number(r.usd) || 0; s.in += r.usage?.in ?? 0; s.out += r.usage?.out ?? 0; s.ms += r.ms ?? 0;
      if (r.cached) s.cached += 1;
      const who = r.served ? `${r.tier ?? '?'}:${r.served}` : null;
      if (who && !s.served.includes(who)) s.served.push(who);
    },
    view: () => ({ roles, calls: Object.values(roles).reduce((n, s) => n + s.calls, 0), credits: Math.round(Object.values(roles).reduce((n, s) => n + s.credits, 0) * 1000) / 1000 }),
  };
}

/** The meta of a plan text, read in the sandbox without running the plan: {meta} or {error}. */
export async function extractMeta(code, limits = {}) {
  const s = planScript(code);
  if (s.error) return { error: s.error };
  const r = await runPlan(s.script, { mode: 'meta' }, {}, { timeMs: 10000, maxCodeBytes: limits.maxCodeBytes ?? 40000 });
  if (!r.ok) return { error: `${r.code}: ${r.message}` };
  const problems = metaProblems(r.value, validateInputs);
  return problems.length ? { meta: r.value, error: problems.join('; ') } : { meta: r.value };
}

/**
 * Runs a plan in the sandbox with the tools of the work folder. Returns {ok, result, check, hasCheck, error, calls, ms}. Every tool call
 * is appended to `<runDir>/calls.jsonl` (when `runDir` is set) and passed to `onCall`.
 */
export async function executePlan({ code, params, check = true, workspace, skills = new Map(), ta, settings, runDir = null, label = 'run', stats = null, log = () => {} }) {
  const S = settings ?? agentSettings({});
  const s = planScript(code);
  if (s.error) return { ok: false, error: { stage: 'load', code: 'plan_syntax', message: s.error }, calls: [] };
  const calls = [];
  let asks = 0;
  const record = (op, args, t0, outcome) => {
    const c = { i: calls.length + 1, label, op, args: clip(args), ms: Date.now() - t0, ...outcome };
    calls.push(c);
    if (runDir) fs.appendFileSync(path.join(runDir, 'calls.jsonl'), JSON.stringify(c) + '\n');
  };
  const wrap = (op, fn) => async (...args) => {
    const t0 = Date.now();
    try { const v = await fn(...args); record(op, args, t0, { ok: true, result: op === 'read' ? { chars: String(v).length } : clip(v, 300) }); return v; }
    catch (e) { record(op, args, t0, { ok: false, error: String(e?.message ?? e).slice(0, 300) }); throw e; }
  };
  const findScript = (skill, script) => {
    const sk = skills.get(skill);
    if (!sk) throw new Error(`no skill ${skill} (skills: ${[...skills.keys()].join(', ') || 'none'})`);
    const name = String(script ?? '').replace(/^\.\//, '');
    return [sk, sk.scripts.includes(name) ? name : sk.scripts.includes(`scripts/${name}`) ? `scripts/${name}` : name];
  };
  const tools = {
    read: wrap('read', (p) => workspace.read(p)),
    list: wrap('list', (dir = '.', o = {}) => workspace.list(dir ?? '.', { recursive: !!o?.recursive })),
    search: wrap('search', (text, o = {}) => workspace.search(text, { dir: o?.dir ?? '.', ignoreCase: o?.ignoreCase !== false, maxResults: o?.maxResults })),
    write: wrap('write', (p, text) => workspace.write(p, text)),
    move: wrap('move', (a, b) => workspace.move(a, b)),
    ask: wrap('ask', async (tier, prompt, o = {}) => {
      if (!S.askTiers.includes(tier)) throw new Error(`tier ${tier} is not allowed (tiers: ${S.askTiers.join(', ')})`);
      if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('ask needs a prompt (a string)');
      if (++asks > S.maxAsks) throw new Error(`the limit of ${S.maxAsks} model calls per run is reached`);
      const r = await ta.chat({ tier, prompt: prompt.slice(0, 60000), system: typeof o?.system === 'string' ? o.system.slice(0, 8000) : undefined, maxTokens: Math.min(Number(o?.maxTokens) || 2000, 8000), temperature: 0, retryCut: true });
      stats?.add('ask', r);
      if (!r.ok) throw new Error(`the model call failed: ${r.reason}`);
      return r.text;
    }),
    runSkillScript: wrap('runSkillScript', async (skill, script, args = []) => {
      const [sk, name] = findScript(skill, script);
      const r = await runSkillScript(sk, name, args ?? [], { cwd: workspace.root });
      return { code: r.code, stdout: r.stdout, stderr: r.stderr.slice(0, 4000), truncated: r.truncated, timedOut: r.timedOut };
    }),
    log: async (message) => { log(`plan: ${String(message).slice(0, 300)}`); return true; },
  };
  const t0 = Date.now();
  const r = await runPlan(s.script, { mode: 'run', params, check }, tools, { timeMs: S.timeMs, heapMb: S.heapMb, maxCodeBytes: S.maxCodeBytes, maxCalls: S.maxToolCalls, maxResultBytes: 500000 });
  const ms = Date.now() - t0;
  if (!r.ok) return { ok: false, error: { stage: 'run', code: r.code, message: r.message }, calls, ms };
  const { result, check: checked, hasCheck } = r.value ?? {};
  const checkOk = checked === true || (checked && typeof checked === 'object' && checked.ok === true);
  if (check && hasCheck && !checkOk) return { ok: false, result, check: checked, hasCheck, error: { stage: 'check', code: 'check_failed', message: `the check failed: ${typeof checked === 'object' ? JSON.stringify(checked).slice(0, 400) : String(checked)}` }, calls, ms };
  return { ok: true, result, check: checked, hasCheck: !!hasCheck, checkOk: hasCheck ? checkOk : null, calls, ms };
}

const answerOf = (result) => { const a = result?.answer ?? result; return typeof a === 'string' ? a : JSON.stringify(a); };
const callsDigest = (calls) => calls.slice(-12).map((c) => `${c.op}(${JSON.stringify(c.args).slice(1, -1).slice(0, 160)}) -> ${c.ok ? JSON.stringify(c.result).slice(0, 160) : `ERROR ${c.error}`}`).join('\n');

/**
 * Runs a request in a work folder. Options: `request`, `workdir` (default the current folder), `plansDir` (--plans), `ta` (a TinyAgent
 * client; its purpose and run are replaced by the run's), `config` (the merged configuration), `planOnly` (show the plan, run nothing),
 * `useCache` (false: skip the match and do not reuse), `log`. Returns the result record (also written to result.json).
 */
export async function runAgent({ request, workdir = process.cwd(), plansDir = null, ta, config = {}, planOnly = false, useCache = true, log = () => {}, runId = null }) {
  if (typeof request !== 'string' || !request.trim()) throw new Error('a request is required');
  const S = agentSettings(config);
  const t0 = Date.now();
  const workspace = createWorkspace(path.resolve(workdir));
  const id = runId ?? newRunId();
  const runDir = path.join(runsDirOf(workspace.root, S), id);
  fs.mkdirSync(runDir, { recursive: true });
  const cache = new PlanCache(plansDirOf(workspace.root, S, plansDir)).ensure();
  const purpose = `run:${id}`.slice(0, 120);
  const agentTa = ta.with ? ta.with({ purpose, run: id }) : ta;
  const stats = createStats();
  const errors = [];
  const err = (e) => { errors.push(e); fs.appendFileSync(path.join(runDir, 'errors.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...e }) + '\n'); };
  fs.writeFileSync(path.join(runDir, 'request.json'), JSON.stringify({ id, request, workdir: workspace.root, plans: cache.dir, planOnly, useCache, at: new Date().toISOString() }, null, 1) + '\n');
  log(`plans: ${cache.dir}`);
  log(`run folder: ${runDir}`);
  if (!planOnly && agentTa.registerRun) {
    try { await agentTa.registerRun({ job: 'agent', run: id, purpose, budget: S.budget ?? config.run?.budget ?? { usd: 0.5, credits: 60, calls: 300 } }); } catch (e) { log(`budget not registered: ${e.message}`); }
  }
  const finish = async (rec) => {
    const out = { id, request, workdir: workspace.root, plans: cache.dir, runDir, ...rec, errors: errors.length, stats: stats.view(), ms: Date.now() - t0 };
    fs.writeFileSync(path.join(runDir, 'result.json'), JSON.stringify(out, null, 1) + '\n');
    if (!planOnly && agentTa.finishRun) { try { await agentTa.finishRun({ run: id, status: rec.status === 'finished' ? 'finished' : 'failed' }); } catch { /* the registration expires */ } }
    return out;
  };

  const { skills, problems: skillProblems } = discoverSkills(skillRoots(workspace.root, S.skillDirs));
  for (const p of skillProblems) log(`skill problem: ${p}`);
  const plans = await cache.load({ extractMeta: (code) => extractMeta(code, S) });

  // 1. The fast match.
  let decision = { decision: 'plan', reason: useCache ? 'no match attempted' : 'the cache is off for this run (--no-cache)' };
  if (useCache) {
    const norm = (s) => String(s).trim().replace(/\s+/g, ' ').toLowerCase();
    const exact = plans.find((p) => p.status === 'verified' && p.meta && norm(p.firstRequest) === norm(request));
    if (exact) decision = { decision: 'reuse', how: 'exact', chosen: exact.id, status: exact.status, values: exact.meta.example ?? {}, reason: 'the same request as the plan\'s first request', candidates: [], bm25Ms: 0 };
    else {
      decision = await matchPlan({ request, plans, promptFile: path.join(PROMPTS, 'agent-match.md'), k: S.match.k, minScore: S.match.minScore, grounded: S.match.grounded,
        ask: async (messages) => { const r = await agentTa.chat({ tier: S.matchTier, messages, maxTokens: S.match.maxTokens, temperature: 0, extraBody: S.match.extraBody ?? undefined, purpose: `${purpose}:match`.slice(0, 120) }); stats.add('match', r); return r; } });
      if (decision.decision === 'reuse') decision.how = 'match';
    }
  }
  fs.writeFileSync(path.join(runDir, 'decision.json'), JSON.stringify(decision, null, 1) + '\n');
  log(`decision: ${decision.decision}${decision.chosen ? ` ${decision.chosen}` : ''} (${decision.reason})`);

  if (decision.decision === 'reuse') {
    const plan = cache.read(decision.chosen);
    fs.writeFileSync(path.join(runDir, 'plan-cached.mjs'), plan.code);
    if (planOnly) return finish({ status: 'planned', how: decision.how, plan: plan.id, params: decision.values, code: plan.code, decision, summary: `cached plan ${plan.id} (${plan.status}) with ${JSON.stringify(decision.values)}` });
    const reverify = plan.status === 'edited';
    const r = await executePlan({ code: plan.code, params: decision.values, check: reverify || S.checkOnReuse, workspace, skills, ta: agentTa, settings: S, runDir, label: 'cached', stats, log });
    const ok = r.ok && (!reverify || (r.hasCheck && r.checkOk));
    cache.recordRun(plan.id, { run: id, how: reverify ? `${decision.how}+reverify` : decision.how, params: decision.values, ok, ms: r.ms ?? null, error: r.error?.message ?? null });
    if (ok) {
      if (reverify) { cache.setStatus(plan.id, 'verified', plan.hash); log(`plan ${plan.id} re-verified by its check (hash ${plan.hash})`); }
      return finish({ status: 'finished', how: reverify ? 'reuse-reverified' : 'reuse', plan: plan.id, params: decision.values, answer: answerOf(r.result), result: r.result, check: r.check ?? null, rounds: 0, decision, summary: answerOf(r.result) });
    }
    err({ stage: 'cached', plan: plan.id, ...(r.error ?? { message: reverify ? 'an edited plan without a passing check is not reused' : 'failed' }) });
    log(`cached plan ${plan.id} failed (${r.error?.message ?? 'not re-verified'}); planning`);
    decision.fallback = { plan: plan.id, error: r.error ?? null };
  }

  // 2. The planner.
  const listing = workspace.list('.', { recursive: true }).slice(0, 80).map((e) => `${e.path}${e.type === 'dir' ? '/' : e.type === 'file' ? ` (${e.bytes} bytes)` : ' (link)'}`).join('\n') || '(empty)';
  const system = fs.readFileSync(path.join(PROMPTS, 'agent-planner.md'), 'utf8').replace('{{tiers}}', S.askTiers.join(', ')).replace('{{maxAsks}}', String(S.maxAsks)).replace('{{skills}}', skillCatalog(skills) || '(none)');
  const messages = [{ role: 'system', content: system }, { role: 'user', content: `REQUEST:\n${request}\n\nWORK FOLDER (first entries):\n${listing}` }];
  if (decision.fallback) messages[1].content += `\n\nNOTE: a saved plan (${decision.fallback.plan}) was tried for this request and failed: ${decision.fallback.error?.message ?? 'its check did not pass'}. Write a new plan.`;
  const plannerTa = agentTa.with ? agentTa.with({ purpose: `${purpose}:planner`.slice(0, 120), run: id }) : agentTa;
  let contextGiven = false, last = null, lastCode = null;
  for (let round = 1; round <= S.maxRounds; round++) {
    let reply = await plannerTa.chat({ tier: S.plannerTier, messages, maxTokens: S.planner.maxTokens, temperature: 0, retryCut: true });
    stats.add('planner', reply);
    if (!reply.ok) { err({ stage: 'planner', round, message: reply.reason }); return finish({ status: 'failed', how: 'plan', rounds: round, decision, summary: `the planner (${S.plannerTier}) failed: ${reply.reason}` }); }
    let code = codeBlockOf(reply.text);
    if (!code && !contextGiven) {
      const want = jsonOf(reply.text);
      if (want && (Array.isArray(want.load_skills) || Array.isArray(want.peek))) {
        contextGiven = true;
        const parts = [];
        for (const n of (want.load_skills ?? []).slice(0, 5)) { const sk = skills.get(n); parts.push(sk ? `SKILL ${n} (folder ${path.relative(workspace.root, sk.dir) || sk.dir}; scripts: ${sk.scripts.join(', ') || 'none'}):\n${skillBody(sk)}` : `SKILL ${n}: no such skill`); }
        for (const f of (want.peek ?? []).slice(0, 5)) { try { parts.push(`FILE ${f} (first lines):\n${workspace.read(f).split('\n').slice(0, 20).join('\n').slice(0, 2500)}`); } catch (e) { parts.push(`FILE ${f}: ${e.message}`); } }
        fs.appendFileSync(path.join(runDir, 'context.txt'), parts.join('\n\n') + '\n');
        log(`planner asked for context: skills ${JSON.stringify(want.load_skills ?? [])}, files ${JSON.stringify(want.peek ?? [])}`);
        messages.push({ role: 'assistant', content: reply.text }, { role: 'user', content: `${parts.join('\n\n')}\n\nNow write the plan, in one js code block.` });
        reply = await plannerTa.chat({ tier: S.plannerTier, messages, maxTokens: S.planner.maxTokens, temperature: 0, retryCut: true });
        stats.add('planner', reply);
        if (!reply.ok) { err({ stage: 'planner', round, message: reply.reason }); return finish({ status: 'failed', how: 'plan', rounds: round, decision, summary: `the planner (${S.plannerTier}) failed: ${reply.reason}` }); }
        code = codeBlockOf(reply.text);
      }
    }
    messages.push({ role: 'assistant', content: reply.text });
    if (!code) { last = { stage: 'planner', code: 'no_code', message: 'the reply holds no js code block' }; err({ round, ...last }); messages.push({ role: 'user', content: 'Your reply holds no plan. Write the whole plan in one ```js code block.' }); continue; }
    lastCode = code;
    fs.writeFileSync(path.join(runDir, `plan-${round}.mjs`), code + '\n');
    const m = await extractMeta(code, S);
    if (m.error) { last = { stage: 'load', code: 'plan_invalid', message: m.error }; err({ round, ...last }); messages.push({ role: 'user', content: `The plan cannot be used: ${m.error}\nWrite the whole corrected plan in one js code block.` }); continue; }
    const params = validateInputs(m.meta.params, m.meta.example ?? {}).inputs;
    if (planOnly) return finish({ status: 'planned', how: 'plan', rounds: round, params, meta: m.meta, code, decision, summary: `plan ${m.meta.name} (${runDir}/plan-${round}.mjs) with ${JSON.stringify(params)}` });
    log(`plan ${round}: ${m.meta.name} ${JSON.stringify(params)}`);
    const r = await executePlan({ code, params, check: true, workspace, skills, ta: agentTa, settings: S, runDir, label: `plan-${round}`, stats, log });
    if (r.ok) {
      const verified = r.hasCheck && r.checkOk === true;
      const planId = cache.save({ code, meta: m.meta, request, verified, check: r.hasCheck ? `check() in plan.mjs; at the first run: ${JSON.stringify(r.check).slice(0, 300)}` : 'none: confirm the plan with `tinyagent plans verify <id>`' });
      cache.recordRun(planId, { run: id, how: 'plan', params, ok: true, ms: r.ms, rounds: round });
      log(`stored ${verified ? 'verified' : 'draft'} plan ${planId}`);
      return finish({ status: 'finished', how: 'plan', rounds: round, plan: planId, planStatus: verified ? 'verified' : 'draft', params, answer: answerOf(r.result), result: r.result, check: r.check ?? null, decision, summary: answerOf(r.result) });
    }
    last = r.error;
    err({ round, plan: `plan-${round}.mjs`, ...r.error });
    log(`plan ${round} failed: ${r.error.stage}: ${r.error.message}`);
    messages.push({ role: 'user', content: `The plan failed (${r.error.stage}, ${r.error.code}): ${r.error.message}\n\nLast tool calls:\n${callsDigest(r.calls) || '(none)'}\n\nWrite the whole corrected plan in one js code block.` });
  }
  return finish({ status: 'failed', how: 'plan', rounds: S.maxRounds, decision, lastCode: lastCode ? path.join(runDir, 'plan-*.mjs') : null, summary: `no plan succeeded in ${S.maxRounds} rounds; last error: ${last?.stage}: ${last?.message}` });
}

/** The code of a SkillPlugin promoted from a verified plan (written by `tinyagent plans promote`). */
export function promotedPluginSource({ name, plan, meta, toDir }) {
  const lib = path.relative(toDir, fileURLToPath(new URL('./index.mjs', import.meta.url))).split(path.sep).join('/');
  const inputs = { ...meta.params, workdir: { type: 'string', description: 'the work folder the plan acts in (an absolute path)' } };
  return `// SkillPlugin promoted from the TinyAgent plan ${plan.id} (hash ${plan.hash}) on ${new Date().toISOString().slice(0, 10)}.
// The plan runs in the sandbox with the tools confined to inputs.workdir; edit the plan in its cache folder and promote it again.
import {runPlanSkill} from '${lib.startsWith('.') ? lib : `./${lib}`}';

const PLAN = ${JSON.stringify(plan.code)};

export default {
  name: ${JSON.stringify(name)},
  description: ${JSON.stringify(meta.task)},
  inputs: ${JSON.stringify(inputs, null, 2).replace(/\n/g, '\n  ')},
  run: (ctx) => runPlanSkill({code: PLAN, ctx}),
};
`;
}

/** The run of a promoted plan inside the server (a SkillPlugin's run): tools confined to inputs.workdir, model calls through ctx.ta. */
export async function runPlanSkill({ code, ctx }) {
  const { workdir, ...params } = ctx.inputs;
  const S = agentSettings(ctx.config ?? {});
  const workspace = createWorkspace(path.resolve(workdir));
  const { skills } = discoverSkills(skillRoots(workspace.root, S.skillDirs));
  const r = await executePlan({ code, params, check: true, workspace, skills, ta: ctx.ta, settings: S, runDir: ctx.dir ?? null, label: 'skill', log: ctx.log ?? (() => {}) });
  return r.ok ? { status: 'finished', summary: answerOf(r.result).slice(0, 1500), value: r.result, check: r.check ?? null } : { status: 'failed', summary: `${r.error.stage}: ${r.error.message}` };
}

export { planHash };
