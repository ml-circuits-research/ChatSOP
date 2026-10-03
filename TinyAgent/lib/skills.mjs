// Skills: what the server can do for a client or for the planner of `run`. A skill is a module `{name, description, inputs, run(ctx)}`
// (`inputs`: {<name>: {type, enum?, min?, max?, required?, default?, description}}; types string, integer, number, boolean, string[],
// object). Sources, in this order (a later source cannot replace an earlier name):
//   1. built-in skills (TinyAgent/skills/*.mjs: chat, json, job, task, write-plugin)
//   2. SkillPlugins named by the configuration (`skills.plugins`: files or folders of .mjs modules; a project's own plugins)
//   3. one skill per job folder named in `skills.jobs` ({name: dir | {dir, description}})
//   4. one skill per task template of `runner.templatesDir` (the template's parameters are the skill's inputs)
// Skills are loaded inside a worker thread of the server for every operation, so a changed plugin is used at its next run.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HOME } from './settings.mjs';
import { loadTemplates } from './jobs/planner.mjs';

const TYPES = {
  string: (v) => typeof v === 'string', integer: Number.isInteger, number: (v) => typeof v === 'number' && Number.isFinite(v), boolean: (v) => typeof v === 'boolean',
  'string[]': (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'), object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
};
const NAME = /^[a-z0-9][a-z0-9_.-]{0,63}$/;

/** Validates inputs against a schema: {ok, inputs (defaults applied), problems}. */
export function validateInputs(schema = {}, given = {}) {
  const problems = [], inputs = {};
  const g = given && typeof given === 'object' ? given : {};
  for (const k of Object.keys(g)) if (!schema[k]) problems.push(`inputs.${k}: not an input (inputs: ${Object.keys(schema).join(', ') || 'none'})`);
  for (const [k, d] of Object.entries(schema)) {
    let v = g[k];
    if (v === undefined || v === null) {
      if (d.default !== undefined) v = d.default;
      else if (d.required !== false) { problems.push(`inputs.${k}: required`); continue; }
      else continue;
    }
    if (!(TYPES[d.type] ?? (() => true))(v)) { problems.push(`inputs.${k}: must be ${d.type}`); continue; }
    if (d.enum && ![].concat(v).every((x) => d.enum.includes(x))) { problems.push(`inputs.${k}: one of ${d.enum.join(', ')}`); continue; }
    const size = typeof v === 'number' ? v : v?.length;
    if (d.min != null && size < d.min) { problems.push(`inputs.${k}: at least ${d.min}`); continue; }
    if (d.max != null && size > d.max) { problems.push(`inputs.${k}: at most ${d.max}`); continue; }
    inputs[k] = v;
  }
  return { ok: !problems.length, inputs, problems };
}

const modulesOf = (p) => {
  if (!existsSync(p)) return [];
  if (statSync(p).isDirectory()) return readdirSync(p).filter((f) => f.endsWith('.mjs') && !f.startsWith('_') && !f.endsWith('.test.mjs')).sort().map((f) => join(p, f));
  return [p];
};

/** Imports a module fresh (a query string with the file's modification time defeats the module cache of a long-running process). */
export const freshImport = (file) => import(`${pathToFileURL(file).href}?v=${Math.round(statSync(file).mtimeMs)}`);

function checkSkill(s, source) {
  if (!s || typeof s !== 'object' || typeof s.run !== 'function') throw new Error(`${source}: a skill exports {name, description, inputs, run(ctx)}`);
  if (!NAME.test(s.name ?? '')) throw new Error(`${source}: skill name ${JSON.stringify(s.name)} must be lowercase letters, digits, . _ -`);
  if (typeof s.description !== 'string' || !s.description.trim()) throw new Error(`${source}: skill ${s.name} needs a description`);
  return { name: s.name, description: s.description.trim(), inputs: s.inputs ?? {}, run: s.run, source, attachments: s.attachments ?? 'optional' };
}

/** Loads every skill: Map name -> {name, description, inputs, source, run}. Problems (a broken plugin) are collected, not thrown. */
export async function loadSkills(config) {
  const skills = new Map(), problems = [];
  const add = (s) => { if (skills.has(s.name)) problems.push(`skill ${s.name} of ${s.source} is already defined by ${skills.get(s.name).source}`); else skills.set(s.name, s); };
  const sources = [...modulesOf(join(HOME, 'skills')).map((f) => ['built-in', f]), ...(config.skills?.plugins ?? []).flatMap((p) => modulesOf(resolve(p)).map((f) => ['plugin', f]))];
  for (const [kind, file] of sources) {
    try {
      const m = await freshImport(file);
      for (const s of [m.default, ...(Array.isArray(m.skills) ? m.skills : [])].filter(Boolean)) add(checkSkill(s, `${kind}:${file}`));
    } catch (e) { problems.push(`${file}: ${e.message}`); }
  }
  for (const [name, v] of Object.entries(config.skills?.jobs ?? {})) {
    const dir = typeof v === 'string' ? v : v?.dir;
    if (!dir || !existsSync(join(dir, 'job.json'))) { problems.push(`skills.jobs.${name}: no job.json in ${dir}`); continue; }
    let spec = {};
    try { spec = JSON.parse(readFileSync(join(dir, 'job.json'), 'utf8')); } catch (e) { problems.push(`${dir}/job.json: ${e.message}`); continue; }
    add({ name, source: `job:${dir}`, description: (typeof v === 'object' && v.description) || spec.description || `the job ${spec.name ?? name}`,
      inputs: { stage: { type: 'string', required: false, description: `run through this stage only (${(spec.stages ?? []).map((s) => s.name).join(', ') || 'all'})` } },
      run: (ctx) => ctx.jobs.runJob(dir, { stage: ctx.inputs.stage ?? null }) });
  }
  try {
    for (const t of Object.values(loadTemplates(config.runner?.templatesDir))) {
      add({ name: t.name, source: `template:${t.dir}`, description: t.description,
        inputs: { ...(t.params ?? {}), target: { type: 'string', required: false, description: `where results go: ${(t.targets ?? ['none']).map((k) => (k === 'none' ? 'none' : `${k}:<id>`)).join(' | ')}` } },
        run: (ctx) => {
          const { target = 'none', ...params } = ctx.inputs;
          const [kind, ...id] = String(target).split(':');
          return ctx.jobs.runTask({ template: t.name, params, attachments: ctx.attachments, target: { kind, id: id.join(':') || null } });
        } });
    }
  } catch (e) { problems.push(`templates: ${e.message}`); }
  return { skills, problems };
}

/** The catalog a planner sees (one JSON object per line; no code). */
export const catalogOf = (skills) => [...skills.values()].map((s) => JSON.stringify({ skill: s.name, description: s.description, inputs: s.inputs })).join('\n');
