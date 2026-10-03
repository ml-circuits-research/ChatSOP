// Prompted backends of the JSON tiers (owner, 2026-10-03): a tier entry with `prompt` serves /v1/structure or /v1/fol with a chat
// model (e.g. the local Qwen3-4B of `tiny`) and a prompt template from prompts/<name>.md, under the same endpoint contract as the
// dedicated models (GLiNER, T5), so clients and converters do not change. The model's reply is validated deterministically
// (structure only: JSON shape, labels, spans copied verbatim, sentence numbers, balanced parentheses); an invalid reply is re-asked once
// with the problems named; what stays invalid after that is dropped and counted in `dropped`.
//
// Template file: sections `<<<options>>>` (JSON: {mode: "problem"|"per-input", output: "json"|"text", maxTokens, temperature}),
// `<<<system>>>`, `<<<user>>>`, `<<<again>>>` with {{placeholders}}:
//   structure  {{text}} {{labels}} (one "label: description" per line) {{relations}} (one "type: description" per line)
//   fol        {{sentences}} (numbered s1..sn) {{sentence}} (per-input mode) {{inventory}} (request context.inventory or "(none)")
//   again      {{problems}}
// Node built-ins only.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

/** Parses a template file into {options, system, user, again}. */
export function parseTemplate(text) {
  const out = { options: {}, system: '', user: '', again: '' };
  const parts = String(text).split(/^<<<(\w+)>>>\s*$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const name = parts[i], body = parts[i + 1].replace(/^\n/, '').replace(/\s+$/, '');
    if (name === 'options') out.options = JSON.parse(body || '{}');
    else out[name] = body;
  }
  if (!out.user) throw new Error('template has no <<<user>>> section');
  return out;
}

export function loadTemplate(dir, name) {
  const file = join(dir, `${name}.md`);
  if (!/^[\w.-]+$/.test(name) || !existsSync(file)) throw new Error(`prompt template ${name} not found in ${dir}`);
  const text = readFileSync(file, 'utf8');
  return { ...parseTemplate(text), name, hash: createHash('sha256').update(text).digest('hex').slice(0, 16) };
}

export const fill = (t, vars) => String(t).replace(/\{\{(\w+)\}\}/g, (_, k) => { if (!(k in vars)) throw new Error(`template variable ${k} has no value`); return String(vars[k]); });

/** The JSON object in a reply (fences and a think block stripped), or null. */
export function jsonOf(text) {
  const s = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

// ---------------------------------------------------------------- structure

const labelMap = (entities) => (Array.isArray(entities) ? Object.fromEntries(entities.map((l) => [l, ''])) : { ...(entities || {}) });

export function structureVars(body) {
  const labels = labelMap(body.entities);
  return {
    text: body.text,
    labels: Object.entries(labels).map(([k, d]) => (d ? `${k}: ${d}` : k)).join('\n'),
    relations: Object.entries(body.relations || {}).map(([k, v]) => `${k}: ${v.description || ''} (head ${[].concat(v.head || []).join('/')}, tail ${[].concat(v.tail || []).join('/')})`).join('\n') || '(none)',
  };
}

/** Validates a structure reply: {problems, entities, relations, dropped}. */
export function validateStructure(reply, body) {
  const json = jsonOf(reply), problems = [];
  if (!json || !Array.isArray(json.spans)) return { problems: ['the reply is not a JSON object with a "spans" list'], entities: {}, relations: [], dropped: 0 };
  const labels = labelMap(body.entities), text = String(body.text), used = new Set();
  const entities = {}, located = [];
  let dropped = 0;
  for (const s of json.spans) {
    const label = s?.label, t = typeof s?.text === 'string' ? s.text.trim() : '';
    if (!Object.hasOwn(labels, label)) { problems.push(`label "${label}" is not one of ${Object.keys(labels).join(', ')}`); dropped++; continue; }
    let at = t ? text.indexOf(t) : -1;
    while (at >= 0 && used.has(`${label}@${at}`)) at = text.indexOf(t, at + 1);
    if (at < 0 && t) { const i = text.toLowerCase().indexOf(t.toLowerCase()); if (i >= 0) at = i; }
    if (at < 0) { problems.push(`span "${t.slice(0, 60)}" is not copied exactly from the text`); dropped++; continue; }
    used.add(`${label}@${at}`);
    const span = { text: text.slice(at, at + t.length), start: at, end: at + t.length, confidence: null };
    (entities[label] ??= []).push(span); located.push({ label, ...span });
  }
  const relations = [];
  for (const r of Array.isArray(json.relations) ? json.relations : []) {
    const spec = (body.relations || {})[r?.type];
    const find = (x) => located.find((s) => s.text.toLowerCase() === String(x ?? '').trim().toLowerCase());
    const h = find(r?.head), t = find(r?.tail);
    if (!spec) { if (body.relations) problems.push(`relation type "${r?.type}" is not one of ${Object.keys(body.relations).join(', ')}`); dropped++; continue; }
    if (!h || !t) { problems.push(`relation ${r.type}: head and tail must be span texts`); dropped++; continue; }
    relations.push({ type: r.type, head: { text: h.text, start: h.start, end: h.end }, tail: { text: t.text, start: t.start, end: t.end }, confidence: null });
  }
  return { problems, entities, relations, dropped };
}

// ---------------------------------------------------------------- fol

const balanced = (s) => { let d = 0; for (const c of s) { if (c === '(') d++; if (c === ')') d--; if (d < 0) return false; } return d === 0; };

export function folVars(body, extra = {}) {
  return { sentences: body.inputs.map((s, i) => `s${i + 1}: ${s}`).join('\n'), inventory: body.context?.inventory || '(none)', sentence: '', ...extra };
}

/** Validates a problem-mode FOL reply: {problems, perInput: [[lines]], dropped}. */
export function validateFol(reply, body) {
  const json = jsonOf(reply), n = body.inputs.length, perInput = Array.from({ length: n }, () => []), problems = [];
  let dropped = 0;
  if (!json || !Array.isArray(json.fol)) return { problems: ['the reply is not a JSON object with a "fol" list'], perInput, dropped: 0 };
  for (const e of json.fol) {
    if (!Number.isInteger(e?.s) || e.s < 1 || e.s > n) { problems.push(`an entry has no sentence number s between 1 and ${n}`); dropped++; continue; }
    for (const f of Array.isArray(e.fol) ? e.fol : []) {
      const line = String(f ?? '').trim();
      if (!line) continue;
      if (!balanced(line)) { problems.push(`s${e.s}: unbalanced parentheses in "${line.slice(0, 60)}"`); dropped++; continue; }
      perInput[e.s - 1].push(line);
    }
  }
  if (body.inputs.some((s) => /\?\s*$/.test(s)) && !perInput.flat().some((l) => l.startsWith('?'))) problems.push('no query: the question must be written as a formula starting with "? "');
  return { problems, perInput, dropped };
}

/** A per-input text reply → its first non-empty line (the formula). */
export const firstLine = (reply) => String(reply ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```\w*/g, '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';

/**
 * Serves one JSON-tier request with a chat model. `chat(messages, {temperature, maxTokens})` → {ok, text, status, error} is the proxy's
 * own forwarding (logged, limited, tagged). Returns {status, body} in the endpoint contract.
 */
export async function serveprompted({ path, body, entry, template, chat }) {
  const t0 = Date.now();
  const opt = template.options || {};
  const call = async (messages, temperature) => chat(messages, { temperature, maxTokens: entry.maxTokens ?? opt.maxTokens ?? 2000 });
  const ask = async (vars, validate, temperature = opt.temperature ?? 0) => {
    const messages = [...(template.system ? [{ role: 'system', content: fill(template.system, vars) }] : []), { role: 'user', content: fill(template.user, vars) }];
    let r = await call(messages, temperature);
    if (!r.ok) return { error: r };
    let v = validate(r.text), rounds = 0;
    if (v.problems.length && template.again) {
      rounds = 1;
      const r2 = await call([...messages, { role: 'assistant', content: r.text }, { role: 'user', content: fill(template.again, { ...vars, problems: v.problems.slice(0, 8).map((p) => `- ${p}`).join('\n') }) }], temperature);
      if (r2.ok) { const v2 = validate(r2.text); if (v2.problems.length <= v.problems.length) { v = v2; r = r2; } }
    }
    return { v, rounds };
  };
  if (path === '/v1/structure') {
    const a = await ask(structureVars(body), (text) => validateStructure(text, body));
    if (a.error) return { status: a.error.status || 502, body: { error: { type: 'backend_error', message: a.error.error || 'chat model failed' } } };
    return { status: 200, body: { object: 'structure', model: `${entry.model}+${template.name}`, entities: a.v.entities, relations: a.v.relations, structures: {}, dropped: a.v.dropped, unresolved: a.v.problems.length, reasks: a.rounds, ms: Date.now() - t0 } };
  }
  if (path === '/v1/fol') {
    const n = Math.max(1, Math.min(body.candidates ?? 1, 8));
    const results = body.inputs.map((input) => ({ input, candidates: [], tokens: null }));
    let dropped = 0, unresolved = 0, reasks = 0;
    for (let k = 0; k < n; k++) {
      const temperature = k === 0 ? (opt.temperature ?? 0) : 0.7;
      if (opt.mode === 'per-input') {
        for (const [i, input] of body.inputs.entries()) {
          const a = await ask(folVars(body, { sentence: input }), (text) => { const l = firstLine(text); return { problems: l && balanced(l) ? [] : ['the reply must be one balanced FOL formula'], line: l }; }, temperature);
          if (a.error) return { status: a.error.status || 502, body: { error: { type: 'backend_error', message: a.error.error || 'chat model failed' } } };
          reasks += a.rounds;
          if (!a.v.problems.length && !results[i].candidates.includes(a.v.line)) results[i].candidates.push(a.v.line);
        }
        continue;
      }
      const a = await ask(folVars(body), (text) => validateFol(text, body), temperature);
      if (a.error) return { status: a.error.status || 502, body: { error: { type: 'backend_error', message: a.error.error || 'chat model failed' } } };
      dropped += a.v.dropped; unresolved += a.v.problems.length; reasks += a.rounds;
      a.v.perInput.forEach((lines, i) => { const c = lines.join('\n'); if (c && !results[i].candidates.includes(c)) results[i].candidates.push(c); });
    }
    return { status: 200, body: { object: 'fol', model: `${entry.model}+${template.name}`, results, dropped, unresolved, reasks, ms: Date.now() - t0 } };
  }
  return { status: 400, body: { error: { type: 'invalid_request', message: `a prompted tier serves /v1/structure or /v1/fol, not ${path}` } } };
}
