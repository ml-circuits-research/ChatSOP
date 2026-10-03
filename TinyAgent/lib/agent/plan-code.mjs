// A plan is a small JavaScript module (plan.mjs) a person can read, edit and check with `node --check`:
//
//   export const meta = {name, task, params: {<name>: {type, description, default?, enum?}}, example: {<values>}, skills: [...]};
//   export default async function run(tools, params) { ...; return {answer, outputs}; }
//   export async function check(tools, params, result) { ...; return {ok, reason}; }      // optional: the plan's own check
//
// It never imports anything: the sandbox has no module loader. For the sandbox, `planScript` turns the `export` keywords into plain
// declarations (line numbers are kept, so an error's "plan.js:12" is line 12 of plan.mjs).
import { createHash } from 'node:crypto';

export const PARAM_TYPES = Object.freeze(['string', 'integer', 'number', 'boolean', 'string[]', 'object']);

/** The sha256 (hex, first 16 characters) of a plan's text, line endings normalised. */
export const planHash = (code) => createHash('sha256').update(String(code).replace(/\r\n/g, '\n').trim()).digest('hex').slice(0, 16);

/** The code of a model reply: the first ```js / ```javascript / ```mjs block, else null. */
export function codeBlockOf(text) {
  const m = /```(?:js|javascript|mjs)[ \t]*\r?\n([\s\S]*?)```/i.exec(String(text ?? '')) ?? /```[ \t]*\r?\n([\s\S]*?)```/.exec(String(text ?? ''));
  return m ? m[1].trim() : null;
}

/** The plan text as a sandbox script, or {error}. */
export function planScript(code) {
  const src = String(code ?? '');
  if (/^\s*import\s[\s\S]*?from\s|^\s*import\s*['"]|\bimport\s*\(/m.test(src)) return { error: 'a plan never imports anything: use only tools.* and plain JavaScript' };
  if (/\brequire\s*\(/.test(src)) return { error: 'a plan never calls require: use only tools.* and plain JavaScript' };
  let out = src.replace(/^export\s+default\s+(async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(/m, (_, a, name) => `${a ?? ''}function run(`);
  if (/^export\s+default\b/m.test(out)) return { error: 'the default export must be a function declaration: export default async function run(tools, params) { ... }' };
  out = out.replace(/^export\s+(?=(?:const|let|var|async\s+function|function|class)\b)/gm, '');
  if (/^export\b/m.test(out)) return { error: 'unsupported export: use export const meta, export default async function run and export async function check' };
  return { script: out };
}

/** Problems of a plan's meta: [] when it is usable (name, task, a typed parameter schema, example values that fit it). */
export function metaProblems(meta, validate) {
  const p = [];
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return ['the plan must export const meta = {name, task, params, example, skills}'];
  if (typeof meta.name !== 'string' || !/^[a-z0-9][a-z0-9-]{1,47}$/.test(meta.name)) p.push('meta.name: a short lowercase-hyphenated name, for example "sum-csv-column"');
  if (typeof meta.task !== 'string' || meta.task.trim().length < 10) p.push('meta.task: one sentence that says what the plan does in general');
  if (!meta.params || typeof meta.params !== 'object' || Array.isArray(meta.params)) p.push('meta.params: an object {<name>: {type, description}}');
  else for (const [k, d] of Object.entries(meta.params)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(k)) p.push(`meta.params.${k}: a parameter name is letters, digits and _`);
    if (!d || !PARAM_TYPES.includes(d.type)) p.push(`meta.params.${k}.type: one of ${PARAM_TYPES.join(', ')}`);
    if (!d || typeof d.description !== 'string' || !d.description.trim()) p.push(`meta.params.${k}.description: say what the value is`);
  }
  if (!p.length && validate) {
    const v = validate(meta.params, meta.example ?? {});
    for (const x of v.problems) p.push(`meta.example: ${x}`);
  }
  if (meta.skills !== undefined && (!Array.isArray(meta.skills) || meta.skills.some((s) => typeof s !== 'string'))) p.push('meta.skills: a list of skill names');
  return p;
}
