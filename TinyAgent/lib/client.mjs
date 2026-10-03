// The TinyAgent library: a client of the TinyAgent server (`tinyagent serve`). Every model call of a program goes through it, by tier
// name, tagged with a purpose (required) and optionally a run id. Outside the server it talks HTTP to the server's URL; inside the
// server (skills, jobs, plugins) it is given the in-process or worker-port transport, so the same code runs in both places.
//
//   const ta = createTinyAgent({purpose: 'job:my-batch'});
//   const r = await ta.chat({tier: 'small', messages: [{role: 'user', content: 'Hello'}]});   // {ok, text, finish, cut, usage, served, ...}
//   const j = await ta.json({tier: 'good', prompt: 'Return {"a": 1}'});                       // {..., json}
//   await ta.role('structure').structure({text, entities});                                   // prompted JSON tiers
//   await ta.runJob('jobs/my-job');  await ta.skill('extract-table', {columns: ['price']}, {attach: ['a.txt']});
//   await ta.run('Extract the prices of the attached file', {attach: ['a.txt']});            // plan on tier good, then execute
//   await ta.stats();  await ta.models();
import { spawn } from 'node:child_process';
import { openSync, closeSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_URL, tinyHome } from './settings.mjs';
import { withOldHeaders, headerOf, OLD_ENV } from './legacy.mjs';
import { httpFetch } from './http-fetch.mjs';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'tinyagent.mjs');
const H = { purpose: 'x-tinyagent-purpose', run: 'x-tinyagent-run', cache: 'x-tinyagent-cache', noFallback: 'x-tinyagent-no-fallback', priority: 'x-tinyagent-priority', client: 'x-client-name' };
export const PRIORITIES = Object.freeze(['interactive', 'normal', 'background']);
export const CACHE_MODES = Object.freeze(['use', 'strict', 'record', 'off']);

/** Text of a reply without a thinking block (closed or left open by a cut reply). */
export const stripThinking = (text) => String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*$/g, '').trim();

/** The JSON object in a reply (fences and a thinking block stripped), or null. */
export function jsonOf(text) {
  const s = stripThinking(text).replace(/```(?:json)?/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A response's body as text (a test double may offer only json()).
const textOf = async (res) => (typeof res.text === 'function' ? res.text() : JSON.stringify(await res.json()));
const num = (h, k) => { const v = h.get(k); const n = Number(v); return v != null && Number.isFinite(n) ? n : null; };

export class TinyAgentUnavailable extends Error {
  constructor(url, cause) {
    super(`TinyAgent server not reachable at ${url} (${cause}); start it with: node TinyAgent/bin/tinyagent.mjs serve`);
    this.code = 'tinyagent_unavailable';
  }
}

/**
 * `url`: the server (default TINYAGENT_URL, else http://127.0.0.1:18080); `fetchImpl`: the transport (tests and the server's own
 * skills pass theirs); `purpose`: required tag of every call (`chat`, `formalize`, `answer-*`, `job:<name>`, `review:<run>`,
 * `skill:<name>`, `test:<name>`); `run`: a run id whose registered budget the server enforces; `client`: the name in the server's log;
 * `cache`: the default cache mode (use | strict | record | off; the server's default otherwise); `priority`: interactive | normal |
 * background (background work runs only when nothing else waits and the plan keeps its headroom; held, never refused); `autostart`: start the server when it
 * is not running (on for a local URL with the default transport; off under node --test, with an injected transport, or TINYAGENT_AUTOSTART=0).
 */
export function createTinyAgent({ url = null, fetchImpl = null, purpose, run = null, client = null, cache = null, priority = null, token = null, autostart = null, config = null, env = process.env } = {}) {
  if (!purpose || typeof purpose !== 'string') throw new TypeError('createTinyAgent: a purpose tag is required (for example "job:<name>", "chat", "test:<name>")');
  const base = String(url ?? env.TINYAGENT_URL ?? env[OLD_ENV.url] ?? DEFAULT_URL).replace(/\/v1\/?$/, '').replace(/\/+$/, '');
  const transport = fetchImpl ?? httpFetch; // no fixed 300 s header timeout: a long model call ends only at its own timeout
  // Auto-start (owner, 2026-10-03): a client on this machine starts the server when none answers, unless it brought its own transport
  // (tests, the server's own skills), runs under node --test, or TINYAGENT_AUTOSTART=0.
  const local = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base);
  const auto = autostart ?? (env.TINYAGENT_AUTOSTART === '1' || (env.TINYAGENT_AUTOSTART !== '0' && !fetchImpl && local && !env.NODE_TEST_CONTEXT));
  const auth = token ?? env.TINYAGENT_TOKEN ?? null;
  let starting = null;

  const tags = (o = {}) => {
    const h = { 'content-type': 'application/json', [H.purpose]: o.purpose ?? purpose };
    const r = o.run === undefined ? run : o.run;
    if (r) h[H.run] = r;
    const c = o.cache ?? cache;
    if (c) { if (!CACHE_MODES.includes(c)) throw new TypeError(`cache mode must be one of ${CACHE_MODES.join(', ')}`); h[H.cache] = c; }
    if (o.noFallback) h[H.noFallback] = '1';
    const p = o.priority ?? priority;
    if (p) { if (!PRIORITIES.includes(p)) throw new TypeError(`priority must be one of ${PRIORITIES.join(', ')}`); h[H.priority] = p; }
    if (o.client ?? client) h[H.client] = String(o.client ?? client).slice(0, 40);
    if (auth) h.authorization = `Bearer ${auth}`;
    return withOldHeaders({ ...h, ...(o.headers ?? {}) });
  };

  async function startServer() {
    const port = new URL(base).port || '18080';
    const logDir = join(tinyHome(env), 'logs');
    mkdirSync(logDir, { recursive: true });
    const fd = openSync(join(logDir, `serve-${port}.log`), 'a');
    const child = spawn(process.execPath, [BIN, 'serve', '--port', port, ...(config ? ['--config', config] : [])], { detached: true, stdio: ['ignore', fd, fd] });
    child.unref(); closeSync(fd);
    for (let i = 0; i < 120; i++) {
      await sleep(500);
      try { if ((await transport(`${base}/health`, { signal: AbortSignal.timeout(1000) })).ok) return true; } catch { /* not yet */ }
    }
    return false;
  }

  /** A raw request to the server (path relative to the server root); retries once after starting the server when autostart is on. */
  async function request(path, { method = 'POST', body = undefined, headers = {}, timeoutMs = 600_000, signal = undefined, tagsOf = {} } = {}) {
    const init = () => ({ method, headers: { ...tags(tagsOf), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body), signal: signal ?? AbortSignal.timeout(timeoutMs) });
    try { return await transport(`${base}${path}`, init()); }
    catch (e) {
      const refused = /ECONNREFUSED|fetch failed|ECONNRESET|socket/i.test(`${e?.cause?.code ?? ''} ${e?.message ?? ''}`) && e?.name !== 'TimeoutError' && e?.name !== 'AbortError';
      if (!refused) throw e;
      if (!auto) throw new TinyAgentUnavailable(base, e?.cause?.code ?? e.message);
      starting ??= startServer().finally(() => { starting = null; });
      if (!(await starting)) throw new TinyAgentUnavailable(base, 'autostart failed; see ~/.tinyagent/logs/serve-*.log');
      return transport(`${base}${path}`, init());
    }
  }
  const getJson = async (path, o = {}) => { const r = await request(path, { method: 'GET', ...o }); const j = await r.json().catch(() => null); if (!r.ok) throw Object.assign(new Error(j?.error?.message ?? `status ${r.status}`), { status: r.status, type: j?.error?.type }); return j; };
  const postJson = async (path, body, o = {}) => { const r = await request(path, { body, ...o }); const j = await r.json().catch(() => null); if (!r.ok) throw Object.assign(new Error(j?.error?.message ?? `status ${r.status}`), { status: r.status, type: j?.error?.type }); return j; };

  /**
   * One chat completion. `tier` (or `upstream` + `model` for a concrete model, calibrations only), `messages` (or `system` + `prompt`),
   * `maxTokens`, `temperature`, `extraBody` (merged into the request body as is: sampling, thinking switches), `cache`, `noFallback`,
   * `retries` (transient failures: unreachable, 429, 5xx), `retryCut` (a reply cut by its token budget is asked again with four times the
   * budget up to `cutCap`, default 32000; a reply still cut is a failure `budget_exhausted`). A cut reply is always marked `cut: true` and
   * never cached by the server. Returns {ok, status, text, raw, reasoning, finish, cut, usage, tier, served, fallback, fallbackReason,
   * cached, credits, usd, ms, body, reason}; never throws on a model failure.
   */
  async function chat(o = {}) {
    const messages = o.messages ?? [...(o.system ? [{ role: 'system', content: o.system }] : []), { role: 'user', content: String(o.prompt ?? '') }];
    const model = o.tier ?? o.model;
    if (!model) throw new TypeError('chat: a tier (or upstream + model) is required');
    const path = o.upstream ? `/u/${encodeURIComponent(o.upstream)}/v1/chat/completions` : '/v1/chat/completions';
    let maxTokens = o.maxTokens;
    const started = Date.now();
    const total = { calls: 0, budget_retries: 0 };
    for (;;) {
      const body = { model, messages, ...(maxTokens != null ? { max_tokens: maxTokens } : {}), ...(o.temperature != null ? { temperature: o.temperature } : {}), ...(o.stream === false ? { stream: false } : {}), ...(o.extraBody ?? {}) };
      const r = await once(path, body, o);
      total.calls += 1;
      if (!(r.ok && r.cut && o.retryCut)) return { ...r, calls: total.calls, budget_retries: total.budget_retries, ms: Date.now() - started };
      const cap = o.cutCap ?? 32000;
      if ((maxTokens ?? 0) >= cap) return { ...r, ok: false, reason: `budget_exhausted: cut at ${maxTokens} tokens`, calls: total.calls, budget_retries: total.budget_retries, ms: Date.now() - started };
      maxTokens = Math.min(cap, (maxTokens ?? 1000) * 4); total.budget_retries += 1;
    }
  }

  async function once(path, body, o) {
    const t0 = Date.now();
    let last = null;
    for (let attempt = 0; attempt <= (o.retries ?? 0); attempt++) {
      if (attempt) await sleep((o.retryPauseMs ?? 2000) * attempt);
      let res, raw;
      try { res = await request(path, { body, timeoutMs: o.timeoutMs ?? 600_000, signal: o.signal, tagsOf: o }); raw = await textOf(res); }
      catch (e) {
        if (e instanceof TinyAgentUnavailable) return { ok: false, status: 0, text: '', reason: e.message, ms: Date.now() - t0 };
        last = { ok: false, status: 0, text: '', reason: e?.name === 'TimeoutError' ? `no answer within ${Math.round((o.timeoutMs ?? 600_000) / 1000)} s` : `unreachable: ${e?.message ?? e}`, ms: Date.now() - t0 };
        continue;
      }
      let j = null;
      try { j = JSON.parse(raw); } catch { /* reported below */ }
      const h = res.headers ?? new Headers();
      const g = (k) => headerOf(h, `x-tinyagent-${k}`);
      const meta = { status: res.status, tier: g('tier'), served: g('model'), fallback: g('fallback'), fallbackReason: g('fallback-reason'), cached: g('cache') === 'hit', credits: num(h, 'x-quota-cost'), cacheKey: g('cache-key') };
      if (!res.ok || !j) {
        last = { ok: false, ...meta, text: '', body: j, error: j?.error ?? null, reason: `status ${res.status}: ${j?.error?.type ? `${j.error.type}: ${j.error.message ?? ''}` : raw.slice(0, 200)}`, ms: Date.now() - t0 };
        if (res.status === 429 || res.status >= 500) continue;
        return last;
      }
      const choice = j.choices?.[0];
      const content = choice ? String(choice.message?.content ?? '') : (j.content || []).map((c) => c.text || '').join('');
      const finish = choice ? choice.finish_reason ?? null : j.stop_reason ?? null;
      const u = j.usage ?? {};
      return { ok: true, ...meta, raw: content, text: stripThinking(content), reasoning: choice?.message?.reasoning_content ?? null, finish, cut: finish === 'length' || finish === 'max_tokens',
        usage: { in: u.prompt_tokens ?? u.input_tokens ?? 0, out: u.completion_tokens ?? u.output_tokens ?? 0, cached: u.prompt_tokens_details?.cached_tokens ?? u.cache_read_input_tokens ?? 0, reasoning: u.completion_tokens_details?.reasoning_tokens ?? 0 },
        usd: u.cost ?? null, body: j, ms: Date.now() - t0 };
    }
    return last;
  }

  /** A chat whose reply must contain one JSON object: the result has `json` (null when unreadable; then `ok` is false). */
  async function json(o = {}) {
    const r = await chat(o);
    if (!r.ok) return { ...r, json: null };
    const parsed = jsonOf(r.text);
    return parsed ? { ...r, json: parsed } : { ...r, ok: false, json: null, reason: 'the reply holds no JSON object' };
  }

  /** A JSON tier endpoint (prompted roles: /v1/structure, /v1/fol): {ok, body, status, ms, cached, served, reason}. */
  async function jsonTier(path, body, o = {}) {
    const t0 = Date.now();
    try {
      const res = await request(path, { body, timeoutMs: o.timeoutMs ?? 600_000, signal: o.signal, tagsOf: o });
      const text = await textOf(res);
      let j = null;
      try { j = JSON.parse(text); } catch { /* below */ }
      if (!res.ok || !j || j.error) return { ok: false, status: res.status, reason: `${res.status} ${j?.error?.message ?? text.slice(0, 200)}`, ms: Date.now() - t0 };
      return { ok: true, status: res.status, body: j, ms: Date.now() - t0, cached: headerOf(res.headers ?? new Headers(), 'x-tinyagent-cache') === 'hit', served: headerOf(res.headers ?? new Headers(), 'x-tinyagent-model') };
    } catch (e) { return { ok: false, status: 0, reason: String(e?.message ?? e), ms: Date.now() - t0 }; }
  }

  /** A prompted role (a tier with a role prompt, e.g. `structure`, `formalizer`, `formalizer-good`): its JSON endpoints and chat. */
  const role = (name) => ({
    name,
    structure: (body, o = {}) => jsonTier('/v1/structure', { model: name, ...body }, o),
    fol: (body, o = {}) => jsonTier('/v1/fol', { model: name, ...body }, o),
    chat: (o = {}) => chat({ ...o, tier: name }),
  });

  /** Waits for an operation of the server (job, task, skill, run) and returns its record {id, kind, status, result, error, log}. */
  async function waitOp(id, { pollSeconds = 20, onLog = null } = {}) {
    let seen = 0;
    for (;;) {
      const op = await getJson(`/v1/ops/${encodeURIComponent(id)}?wait=${pollSeconds}&since=${seen}`, { timeoutMs: (pollSeconds + 30) * 1000 });
      if (onLog) for (const line of op.log ?? []) onLog(line);
      seen = op.log_total ?? seen;
      if (op.status !== 'running' && op.status !== 'queued') return op;
    }
  }
  const startOp = async (path, body, o = {}) => {
    const op = await postJson(path, body, { tagsOf: o });
    return o.wait === false ? op : waitOp(op.id, o);
  };
  const absAll = (files = []) => files.map((f) => (typeof f === 'string' ? { name: f.split('/').pop(), path: resolve(f) } : f.path ? { ...f, path: resolve(f.path) } : f));

  const agent = {
    url: base, purpose, run,
    /** A copy with other tags (purpose, run, client, cache). */
    with: (o = {}) => createTinyAgent({ url: base, fetchImpl: transport, purpose: o.purpose ?? purpose, run: o.run === undefined ? run : o.run, client: o.client ?? client, cache: o.cache ?? cache, priority: o.priority ?? priority, token: auth, autostart: auto, config, env }),
    request, chat, json, role,
    structure: (body, o = {}) => role(o.tier ?? 'structure').structure(body, o),
    fol: (body, o = {}) => role(o.tier ?? 'formalizer').fol(body, o),
    health: () => getJson('/health'),
    /** The tiers the server serves: [{id, x_tier: {serves, fallback} | {error}}]. */
    tiers: async () => (await getJson('/health')).tiers ?? [],
    stats: () => getJson('/stats'),
    models: () => getJson('/v1/local'),
    model: (name, action) => postJson(`/v1/local/${encodeURIComponent(name)}/${action}`, {}),
    registerRun: (b) => postJson('/jobs/register', b),
    finishRun: (b) => postJson('/jobs/finish', b),
    skills: () => getJson('/v1/skills'),
    /** Runs a job folder in the server: {dir} or a path; options stage, resume, refresh, register, publish, wait (false: the op only). */
    runJob: (job, o = {}) => startOp('/v1/jobs', { dir: resolve(typeof job === 'string' ? job : job.dir), stage: o.stage ?? null, resume: o.resume ?? null, refresh: !!o.refresh, register: o.register !== false, publish: o.publish ? resolve(o.publish) : null, priority: o.priority ?? null }, { ...o, priority: undefined }),
    /** A task: instructions + attachments, planned over the template library (or `template` + `params`). */
    task: (t, o = {}) => startOp('/v1/tasks', { instructions: t.instructions ?? '', attachments: absAll(t.attachments ?? t.attach), target: t.target ?? { kind: 'none' }, template: t.template ?? null, params: t.params ?? null }, o),
    /** One skill with its inputs; `attach` lists files given to it. */
    skill: (name, inputs = {}, o = {}) => startOp(`/v1/skills/${encodeURIComponent(name)}`, { inputs, attachments: absAll(o.attach) }, o),
    /** Plan the request on the planner tier (good), then execute the plan deterministically; `planOnly` stops after the plan. */
    run: (requestText, o = {}) => startOp('/v1/run', { request: requestText, attachments: absAll(o.attach), planOnly: !!o.planOnly }, o),
    op: (id) => getJson(`/v1/ops/${encodeURIComponent(id)}`),
    ops: () => getJson('/v1/ops'),
    waitOp,
  };
  return agent;
}
