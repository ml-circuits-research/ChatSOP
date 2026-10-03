/**
 * Shared parts of the six-paths experiment (experiments/proposal/six-paths-results.md): the question data (the research layer
 * config/knowledge/formalizer-six-paths-v1), the proxy client of tier `small` (purpose `job:six-paths`, the proxy's response cache on,
 * no fallback to another model), the asking discipline (one re-ask with the question's format reminder, then the path stops honestly),
 * the registry of numbers, and the execution of a path's circuits through the product's engines on the problem's numbers and on
 * perturbed numbers. Offline evaluation harness; never the product path.
 *
 * A path returns {status, questions, trace, exec?}: `exec(values)` (values: Map registry index → number) compiles the path's formal
 * result deterministically for those numbers into SOP, runs it through the engines and returns the answers [value, ...] in the order
 * asked (numbers, yes/no as booleans, names as strings), or null when the engines give no answer.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {factsOf} from '../../../lib/formalize/protocol-data.mjs';
import {localChat} from '../../../lib/local-llm/client.mjs';
import {registryOf} from '../../../lib/formalize/expression-program.mjs';
import {perturbations} from '../../../lib/formalize/dual-check.mjs';
import {executeQueries} from '../../../lib/formalize/dual-check.mjs';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const LAYER = path.join(ROOT, 'config/knowledge/formalizer-six-paths-v1');
const PROXY = process.env.LLMAPIPROVIDER_URL ?? 'http://127.0.0.1:18080/v1';

let data = null;
/** The question data: {text(id), again(id), system, combine: [[op, text]]}. */
export function questions() {
  if (data) return data;
  const f = factsOf(fs.readdirSync(LAYER).filter(n => n.endsWith('.sop')).sort().map(file => ({file, text: fs.readFileSync(path.join(LAYER, file), 'utf8')})));
  const map = p => new Map((f.get(p) ?? []).map(([k, v]) => [String(k), String(v)]));
  const text = map('sp_text'), again = map('sp_again');
  data = {text: id => { if (!text.has(id)) throw new Error(`no question ${id}`); return text.get(id); }, again: id => again.get(id) ?? null,
    system: map('sp_system').get('all'), combine: (f.get('sp_combine') ?? []).map(([op, t]) => [String(op), String(t)])};
  return data;
}

/** Fills {{name}} placeholders (an unknown placeholder is an authoring error). */
export function fill(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => { if (!(k in values)) throw new Error(`placeholder ${k} has no value`); return String(values[k]); });
}

/** The registry block of a prompt: `vK = span   [context]`. */
// A percentage is its fraction wherever it is used (the registry's convention): the prompt says so, so no path divides it by 100 again.
export const numbersBlock = registry => registry.map(v => `v${v.index} = ${v.span}${v.percent ? ` (a percentage: v${v.index} already means ${v.value / 100}; never divide it by 100)` : ''}   [${v.context}]`).join('\n') || '(none)';

/** A proxy client for `tier`: {chat(messages, maxTokens) → {ok, text, ms, usage, cached}, cost}. */
export function client({tier = 'small', run = 'six-paths', live = true, purpose = tier === 'small' ? 'job:six-paths' : `job:six-paths-${tier}`, thinking = false} = {}) {
  const cost = {calls: 0, hits: 0, ms: 0, tokens: 0, failures: 0};
  const extraBody = ['tiny', 'small'].includes(tier) ? {chat_template_kwargs: {enable_thinking: thinking}} : {};
  const headers = {'x-llmapiprovider-purpose': purpose, 'x-llmapiprovider-run': run, 'x-llmapiprovider-no-fallback': '1', ...(live ? {} : {'x-llmapiprovider-cache': 'strict'})};
  // The cache flag is read from the response header; localChat does not expose headers, so a cached reply is recognised by its time.
  const chat = async (messages, maxTokens = 600) => {
    // Infrastructure errors (the local server restarting, a 5xx, a timeout) are retried with a growing pause; never answered by
    // another model (no fallback) and, after the last attempt, reported as `unavailable` (the row is not scored).
    for (let attempt = 0; attempt < 6; attempt++) {
      const r = await localChat({endpoint: PROXY, model: tier, messages, maxTokens, timeoutMs: 600_000, extraBody, headers});
      cost.calls++; cost.ms += r.ms ?? 0; cost.tokens += (r.usage?.input_tokens ?? 0) + (r.usage?.output_tokens ?? 0);
      if (r.ok) { if ((r.ms ?? 0) < 150) cost.hits++; return r; }
      cost.failures++;
      if (/409|cache_miss|402|403/.test(r.reason ?? '')) return r;
      await new Promise(res => setTimeout(res, 5000 * 2 ** attempt));
    }
    return {ok: false, text: '', reason: 'no answer after 6 attempts'};
  };
  return {chat, cost};
}

/**
 * One question of a path: asks `id` filled with `values`, reads the answer with `reader(text)` (null = unreadable), and on an
 * unreadable answer asks once more with the format reminder. Returns {value, text} or null (the path stops honestly). Every call is
 * recorded in `ctx.trace` and counted in `ctx.questions`.
 */
export async function ask(ctx, id, values, reader, {maxTokens = 500, extra = ''} = {}) {
  const q = questions();
  const prompt = fill(q.text(id), values) + (extra ? `\n\n${extra}` : '');
  const messages = [{role: 'system', content: q.system}, {role: 'user', content: prompt}];
  for (let round = 0; round < 2; round++) {
    if (ctx.questions >= ctx.maxQuestions) { ctx.trace.push({id, stop: 'question budget'}); return null; }
    ctx.questions++;
    const r = await ctx.chat(messages, maxTokens);
    let value = null, complaint = null;
    if (r.ok) { try { value = reader(r.text); } catch (error) { value = null; if (error instanceof ReadError) complaint = error.message; } }
    ctx.trace.push({id, round, answer: r.ok ? r.text.slice(0, 1500) : null, reason: r.ok ? null : r.reason, read: value === null || value === undefined ? null : 'ok', ...(complaint ? {complaint} : {})});
    if (!r.ok) { ctx.infra = true; return null; }
    if (value !== null && value !== undefined) return {value, text: r.text};
    const again = q.again(id);
    if (!again) return null;
    messages.push({role: 'assistant', content: r.text}, {role: 'user', content: `That answer could not be used${complaint ? `: ${complaint}` : ''}. ${again}`});
  }
  return null;
}
/** A reader's complaint about a readable but unusable answer; it is named in the one re-ask. */
export class ReadError extends Error {}

/** A fresh path context. */
export const context = (chat, maxQuestions = 10) => ({chat, questions: 0, maxQuestions, trace: []});

/** The registry of a problem (lib/formalize/registry.mjs numbers, normalized). */
export const registryFor = message => registryOf(message);

/** The registry with other values (perturbation): same indices, spans and contexts. */
export const withValues = (registry, values) => registry.map(v => ({...v, value: values.get(v.index) ?? v.value, span: String(values.get(v.index) ?? v.value) + (v.percent ? '%' : '')}));

/** The original values and `k` perturbations: [Map index → value]. */
export function conditions(registry, {k = 3, seed = 'six'} = {}) {
  const orig = new Map(registry.map(v => [v.index, v.value]));
  if (!registry.length) return [orig];
  return [orig, ...perturbations(registry, {k, seed}).map(m => new Map(registry.map(v => [v.index, m.get(v.value) ?? v.value])))];
}

let world = null;
/** The product's engines over a scratch memory: `execute(sop, message, numbers)` → {status, values}. */
export async function engines() {
  if (world) return world;
  const {executor} = await import('../formalization-regression/expression.mjs');
  world = await executor();
  return world;
}

/** Runs every query of a circuit through the engines; the answers in order (first value of each query), or null. */
export async function runCircuit(sop, {message = 'problem', numbers = []} = {}) {
  const w = await engines();
  const qs = await executeQueries(sop, (s, nums) => w.execute(s, message, [...(nums ?? []), ...numbers]), numbers);
  const out = qs.map(q => (q.values.length ? q.values[0] : null));
  return out.some(v => v !== null && v !== undefined) ? out.filter(v => v !== null && v !== undefined) : null;
}

// ---------------------------------------------------------------- readers (structure only: indices, menus, lines)

const clean = t => String(t ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/\*\*|`/g, '').trim();
export const answerLines = t => clean(t).split('\n').map(s => s.replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+(?=\S))/, '').trim()).filter(Boolean);
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];

/** A registry index from "v3", "V3", "3", "#3", "(3)", "the third value", "third number"; null when none or out of range. */
export function readIndex(text, n) {
  const s = clean(text).toLowerCase().replace(/[.,;:!]+$/, '').trim();
  let m = /^(?:the\s+)?v\s*(\d+)\b/.exec(s) ?? /^#?\(?(\d+)\)?$/.exec(s) ?? /\bv(\d+)\b/.exec(s);
  let k = m ? Number(m[1]) : null;
  if (k === null) { const o = ORDINALS.findIndex(w => new RegExp(`\\b${w}\\b`).test(s)); if (o >= 0) k = o + 1; }
  return k !== null && k >= 1 && k <= n ? k : null;
}

/**
 * A registry reference from an answer that should name one: "v3", "the third value", or a number copied from the problem (a literal
 * equal to exactly one registry number is that number's index, as written: "820", "10%"); a bare small integer that equals no registry
 * number is read as an index. Null otherwise.
 */
export function readRef(text, registry) {
  const s = clean(text).toLowerCase().replace(/[.,;:!]+$/, '').trim();
  if (/^(?:the\s+)?v\s*\d+\b/.test(s) || /\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\b/.test(s)) return readIndex(s, registry.length);
  const m = /^(-?\d[\d,]*(?:\.\d+)?)\s*(%)?$/.exec(s);
  if (!m) return null;
  const x = Number(m[1].replace(/,/g, ''));
  const hits = registry.filter(v => v.value === x && (!m[2] || v.percent));
  if (hits.length >= 1 && hits.every(h => h.value === hits[0].value) && new Set(hits.map(h => h.index)).size === 1) return hits[0].index;
  if (hits.length > 1) return null;
  return Number.isInteger(x) && x >= 1 && x <= registry.length ? x : null;
}

/** A menu choice 1..n from "2", "2.", "choice 2", "(2)", or the option's own words; null when unreadable. */
export function readChoice(text, options, {zero = false} = {}) {
  const s = clean(text).toLowerCase();
  const m = /^\D{0,20}?(\d+)\b/.exec(s);
  if (m) { const k = Number(m[1]); if ((zero && k === 0) || (k >= 1 && k <= options.length)) return k; }
  const hits = options.map((o, i) => [i + 1, String(o).toLowerCase()]).filter(([, o]) => o && s.includes(o));
  return hits.length === 1 ? hits[0][0] : null;
}

/** `key: value` lines → [[key, value]] (keys lowercased, trimmed). */
export function keyLines(text) {
  return answerLines(text).map(l => /^([A-Za-z_][\w ]{0,40}?)\s*[:=]\s*(.*)$/.exec(l)).filter(Boolean).map(m => [m[1].trim().toLowerCase().replace(/\s+/g, '_'), m[2].trim()]);
}

/** A lowercase identifier from a model's name. */
export const ident = s => { const x = String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40); return x ? (/^[a-z]/.test(x) ? x : `q_${x}`) : null; };

/** Yes/no from an answer. */
export function readYesNo(text) {
  const s = clean(text).toLowerCase();
  if (/^\W*yes\b/.test(s)) return true;
  if (/^\W*no\b/.test(s)) return false;
  return null;
}
