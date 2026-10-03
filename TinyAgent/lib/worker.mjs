// An operation of the server (a job, a task, a skill, a planned `run`, the skill list) runs in a worker thread of the server: its
// modules (the job runner, project SkillPlugins and the project code they import) are loaded fresh for every operation, a crash
// does not stop the server, and every model call goes back to the server's core over a message port (the same HTTP API as outside).
import fs from 'node:fs';
import path from 'node:path';
import {parentPort, workerData} from 'node:worker_threads';
import {portFetch} from './inproc.mjs';
import {createTinyAgent} from './client.mjs';
import {loadSkills, validateInputs, catalogOf} from './skills.mjs';
import {loadJob, runJob, RunStore, publishSummary, liveTiers, runTask} from './jobs/index.mjs';
import {HOME} from './settings.mjs';

const {kind, args, tags, config, opDir, port} = workerData;
export const INPROC_URL = 'http://tinyagent.local';
const fetchImpl = portFetch(port);
const log = line => parentPort.postMessage({type: 'log', line: String(line).slice(0, 2000)});
const ta = createTinyAgent({url: INPROC_URL, fetchImpl, purpose: tags.purpose, run: tags.run ?? null, autostart: false, env: {}});

/** The job runner's configuration from the TinyAgent configuration (runner section; the endpoint is the server itself). */
export function runnerConfig(c) {
  const r = c.runner ?? {};
  return {file: null, endpoint: INPROC_URL, dataDir: r.dataDir, roles: r.roles ?? {}, fallback: {}, limits: r.limits ?? {}, tasks: r.tasks ?? {keepDays: 7}, templatesDir: r.templatesDir ?? null};
}
const rc = runnerConfig(config);

const attachmentsOf = list => (list ?? []).map(a => {
  const st = a.path ? fs.statSync(a.path) : null;
  return {name: a.name ?? path.basename(a.path), path: a.path ?? null, text: a.text ?? null, bytes: st?.size ?? Buffer.byteLength(a.text ?? '')};
});

async function runJobHere(dir, o = {}) {
  const live = await liveTiers(INPROC_URL, {fetchImpl});
  const job = await loadJob(path.resolve(dir), {config: rc, live});
  const r = await runJob(job, {endpoint: INPROC_URL, fetchImpl, store: new RunStore({root: rc.dataDir}), stage: o.stage ?? null, resume: o.resume ?? null, refresh: !!o.refresh, register: o.register !== false, priority: o.priority ?? null,
    log: m => log(`[${job.spec.name}] ${m}`)});
  const published = o.publish ? publishSummary(r.dir, o.publish, {job: job.spec.name, run: r.run}) : null;
  return {status: r.status, summary: r.summary, run: r.run, dir: r.dir, counts: r.counts, published};
}

async function runTaskHere(t) {
  const r = await runTask({instructions: t.instructions ?? '', attachments: attachmentsOf(t.attachments).map(a => ({name: a.name, path: a.path ?? undefined, text: a.text ?? undefined})),
    target: t.target ?? {kind: 'none'}, template: t.template ?? null, params: t.params ?? null, config: rc, endpoint: INPROC_URL, fetchImpl, log: m => log(`[task] ${m}`)});
  return {status: r.status, summary: r.summary, task: r.task, dir: r.dir, result: r.result ?? null};
}

function contextFor(skill, inputs, attachments, dir) {
  return {
    ta: ta.with({purpose: `skill:${skill.name}`}), inputs, attachments, dir, log, config, runner: rc, home: HOME,
    readAttachment: async name => { const a = attachments.find(x => x.name === name); if (!a) throw new Error(`no attachment ${name}`); return a.text ?? fs.readFileSync(a.path, 'utf8'); },
    jobs: {runJob: runJobHere, runTask: runTaskHere},
  };
}

async function runSkill(skills, name, given, attachments, dir) {
  const skill = skills.get(name);
  if (!skill) return {status: 'failed', summary: `no skill ${name} (skills: ${[...skills.keys()].join(', ')})`};
  const v = validateInputs(skill.inputs, given);
  if (!v.ok) return {status: 'failed', summary: `invalid inputs for ${name}: ${v.problems.join('; ')}`};
  log(`skill ${name} (${skill.source})`);
  const r = await skill.run(contextFor(skill, v.inputs, attachments, dir));
  return r && typeof r === 'object' ? {status: r.status ?? 'finished', ...r} : {status: 'finished', summary: String(r ?? '')};
}

async function plan(skills, request, attachments) {
  const maxSteps = config.run?.maxSteps ?? 5;
  const tier = rc.roles?.planner ?? 'good';
  const catalog = catalogOf(new Map([...skills].filter(([, s]) => s.name !== 'job')));
  const system = fs.readFileSync(path.join(HOME, 'prompts', 'run-planner.md'), 'utf8').replace('{{maxSteps}}', String(maxSteps)).replace('{{catalog}}', catalog);
  const user = `REQUEST:\n${request}\n\nATTACHMENTS:\n${attachments.map(a => `- ${a.name} (${a.bytes} bytes): ${JSON.stringify((a.text ?? (a.path ? fs.readFileSync(a.path, 'utf8') : '')).slice(0, 300))}`).join('\n') || '(none)'}`;
  const messages = [{role: 'system', content: system}, {role: 'user', content: user}];
  let problems = [];
  for (let round = 0; round < 2; round++) {
    const r = await ta.with({purpose: 'run:planner'}).json({tier, messages, maxTokens: 4000, temperature: 0, retryCut: true});
    if (!r.ok && !r.text) return {ok: false, problems: [`planner call failed: ${r.reason}`]};
    problems = [];
    const steps = Array.isArray(r.json?.steps) ? r.json.steps : null;
    if (!steps) problems.push('no "steps" list');
    else {
      if (steps.length > maxSteps) problems.push(`at most ${maxSteps} steps`);
      for (const [i, s] of steps.entries()) {
        const skill = skills.get(s?.skill);
        if (!skill) { problems.push(`steps[${i}].skill: one of ${[...skills.keys()].join(', ')}`); continue; }
        const v = validateInputs(skill.inputs, s.inputs ?? {});
        problems.push(...v.problems.map(p => `steps[${i}] (${s.skill}): ${p}`));
      }
    }
    if (!problems.length) return {ok: true, steps, reason: String(r.json.reason ?? '').slice(0, 300), tier};
    messages.push({role: 'assistant', content: r.text}, {role: 'user', content: `The plan is invalid:\n${problems.map(p => `- ${p}`).join('\n')}\nWrite the corrected JSON object only.`});
  }
  return {ok: false, problems};
}

async function main() {
  if (kind === 'skills') {
    const {skills, problems} = await loadSkills(config);
    return {status: 'finished', skills: [...skills.values()].map(({name, description, inputs, source}) => ({name, description, inputs, source})), problems};
  }
  if (kind === 'job') return runJobHere(args.dir, args);
  if (kind === 'task') return runTaskHere(args);
  const {skills, problems} = await loadSkills(config);
  for (const p of problems) log(`skill problem: ${p}`);
  const attachments = attachmentsOf(args.attachments);
  if (kind === 'skill') return runSkill(skills, args.name, args.inputs ?? {}, attachments, opDir);
  if (kind === 'run') {
    // A planned run spends from one registered budget (config.run.budget): the server refuses its calls beyond it.
    try { await ta.registerRun({job: 'run', run: tags.run, purpose: tags.purpose, budget: config.run?.budget ?? {usd: 0.5}}); } catch (e) { log(`budget not registered: ${e.message}`); }
    const p = await plan(skills, args.request, attachments);
    fs.writeFileSync(path.join(opDir, 'plan.json'), JSON.stringify(p, null, 1) + '\n');
    if (!p.ok) return {status: 'plan_refused', summary: `plan refused: ${p.problems.slice(0, 5).join('; ')}`, plan: p};
    if (args.planOnly || !p.steps.length) return {status: p.steps.length ? 'planned' : 'no_plan', summary: p.steps.length ? p.steps.map(s => `${s.skill} ${JSON.stringify(s.inputs ?? {})}`).join('\n') : `no skill fits: ${p.reason}`, plan: p};
    const results = [];
    for (const [i, s] of p.steps.entries()) {
      const dir = path.join(opDir, `step-${i + 1}-${s.skill}`);
      fs.mkdirSync(dir, {recursive: true});
      const r = await runSkill(skills, s.skill, s.inputs ?? {}, attachments, dir);
      results.push({skill: s.skill, inputs: s.inputs ?? {}, ...r});
      if (!['finished', 'ok'].includes(r.status)) break;
    }
    try { await ta.finishRun({run: tags.run, status: 'finished'}); } catch { /* the registration expires */ }
    const failed = results.find(r => !['finished', 'ok'].includes(r.status));
    return {status: failed ? 'failed' : 'finished', plan: p, results,
      summary: [`plan (${p.tier}): ${p.steps.map(s => s.skill).join(' -> ')}: ${p.reason}`, ...results.map((r, i) => `${i + 1}. ${r.skill}: ${r.status}: ${String(r.summary ?? '').split('\n').slice(0, 3).join(' | ').slice(0, 400)}`)].join('\n')};
  }
  throw new Error(`unknown operation ${kind}`);
}

main().then(result => parentPort.postMessage({type: 'result', result}), e => parentPort.postMessage({type: 'error', error: String(e?.stack ?? e).slice(0, 3000)}));
