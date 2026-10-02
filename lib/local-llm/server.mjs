/**
 * The managed local model server (DS022 "Formalization strategies: the local runtime"): one private llama.cpp `llama-server` per
 * GGUF, started with the flags that make repeated short requests cheap, and the slot operations that keep a stable prompt prefix
 * evaluated once:
 *
 *   - full GPU offload and flash attention, context sized to the need (`ctx` is the total over all slots);
 *   - one dedicated slot per role (`slots: ['direct', 'steps']` gives `--parallel 2`; a request is pinned with `id_slot`), so the
 *     LocalLLMDirect author and the LocalLLMStepByStep oracle never evict each other's prefix;
 *   - `--cache-reuse` (shifted reuse of matching chunks; models whose memory is recurrent fall back to prefix checkpoints);
 *   - `--slot-save-path`: the evaluated stable prefix of a slot is saved per base memory and restored after a restart.
 *
 * Only one GPU worker runs per machine (AGENTS.md direction 2): `start` refuses while a training or parse lock is held and never
 * stops a process it did not start.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
export const DEFAULT_LLAMA_SERVER = path.join(os.homedir(), 'llama-cpp-venv/llama.cpp/build/bin/llama-server');
export const GPU_LOCKS = Object.freeze(['models/.training.lock', 'models/.parse-gpu.lock']);
const expand = file => String(file ?? '').replace(/^~(?=\/|$)/, os.homedir());

/** The llama-server arguments of a managed server; pure, so the tests and the documentation show exactly what runs. */
export function serverArgs({gguf, port, alias = 'local', slots = ['direct'], ctxPerSlot = 8192, ngl = 99, cacheReuse = 256, slotSavePath = null, threads = null, extraArgs = []}) {
  if (!gguf || !Number.isInteger(port)) throw new TypeError('a managed local server needs a gguf and an integer port');
  if (!Array.isArray(slots) || !slots.length || new Set(slots).size !== slots.length) throw new TypeError('slots must be a non-empty list of distinct role names');
  return ['-m', expand(gguf), '--host', '127.0.0.1', '--port', String(port), '-a', alias, '--jinja', '--no-webui',
    '-ngl', String(ngl), '-fa', 'on', '--parallel', String(slots.length), '-c', String(ctxPerSlot * slots.length), '--no-kv-unified',
    '--cache-reuse', String(cacheReuse), '--slots', '--metrics',
    ...(slotSavePath ? ['--slot-save-path', expand(slotSavePath)] : []), ...(threads ? ['-t', String(threads)] : []), ...extraArgs];
}

/** The slot-file name of a stable prefix: model, role and the prefix digest (the memory version is part of the prefix). */
export function slotFile({alias, role, prefix}) {
  const digest = createHash('sha256').update(prefix).digest('hex').slice(0, 16);
  return `${alias}-${role}-${digest}.bin`.replace(/[^\w.-]/g, '_');
}

export class LocalLLMServer {
  constructor({gguf, port = 19601, alias = 'local', slots = ['direct'], ctxPerSlot = 8192, ngl = 99, cacheReuse = 256, slotSavePath = path.join(ROOT, 'state/local-llm/slots'),
    bin = process.env.LLAMA_SERVER ?? DEFAULT_LLAMA_SERVER, logFile = null, endpoint = null, threads = null, extraArgs = [], fetchImpl = globalThis.fetch, startTimeoutMs = 600_000} = {}) {
    Object.assign(this, {gguf: expand(gguf), port, alias, slots: [...slots], ctxPerSlot, ngl, cacheReuse, slotSavePath: slotSavePath && expand(slotSavePath), bin: expand(bin), threads, extraArgs, fetchImpl, startTimeoutMs});
    this.logFile = logFile ?? path.join(ROOT, 'state/local-llm', `${alias}.log`);
    this.external = Boolean(endpoint);
    this.base = endpoint ? endpoint.replace(/\/+$/, '').replace(/\/v1$/, '') : `http://127.0.0.1:${port}`;
    this.child = null; this.starting = null;
    this.prefixes = new Map(); // role -> saved slot file of its stable prefix
    this.locks = new Map();    // role -> the end of its latest request
  }

  get endpoint() { return `${this.base}/v1`; }
  slotOf(role) {
    const id = this.slots.indexOf(role);
    if (id < 0) throw Object.assign(new Error(`the local server has no slot for role ${JSON.stringify(role)}; configured: ${this.slots.join(', ')}`), {code: 'invalid_slot'});
    return id;
  }

  async healthy() {
    try { return (await this.fetchImpl(`${this.base}/health`, {signal: AbortSignal.timeout(2000)})).ok; } catch { return false; }
  }

  /** Starts the managed server once (concurrent callers share the start); an external endpoint is only checked. */
  async ensure() {
    if (await this.healthy()) return this;
    if (this.external) throw Object.assign(new Error(`the local model endpoint ${this.base} is not reachable`), {code: 'local_unavailable'});
    this.starting ??= this.#start().finally(() => { this.starting = null; });
    return this.starting;
  }

  async #start() {
    for (const lock of GPU_LOCKS) if (this.ngl > 0 && fs.existsSync(path.join(ROOT, lock))) throw Object.assign(new Error(`the GPU is reserved (${lock} exists)`), {code: 'gpu_busy'});
    if (!fs.existsSync(this.gguf)) throw Object.assign(new Error(`missing model file ${this.gguf}`), {code: 'local_unavailable'});
    if (!fs.existsSync(this.bin)) throw Object.assign(new Error(`missing llama-server binary ${this.bin}`), {code: 'local_unavailable'});
    if (this.slotSavePath) fs.mkdirSync(this.slotSavePath, {recursive: true});
    fs.mkdirSync(path.dirname(this.logFile), {recursive: true});
    const log = fs.openSync(this.logFile, 'w');
    const args = serverArgs(this);
    const child = spawn(this.bin, args, {stdio: ['ignore', log, log]});
    fs.closeSync(log);
    let exited = false;
    child.on('exit', () => { exited = true; if (this.child === child) { this.child = null; this.prefixes.clear(); } });
    this.child = child;
    const deadline = Date.now() + this.startTimeoutMs;
    while (Date.now() < deadline) {
      if (exited) throw Object.assign(new Error(`llama-server exited during start; see ${this.logFile}`), {code: 'local_unavailable'});
      if (await this.healthy()) return this;
      await new Promise(r => setTimeout(r, 500));
    }
    await this.stop();
    throw Object.assign(new Error('llama-server did not become healthy in time'), {code: 'local_unavailable'});
  }

  /** Stops only the server this object started. */
  async stop() {
    const child = this.child;
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    await new Promise(resolve => { const t = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 15_000); child.on('exit', () => { clearTimeout(t); resolve(); }); });
    this.child = null; this.prefixes.clear();
  }

  async #slotAction(id, action, filename) {
    const response = await this.fetchImpl(`${this.base}/slots/${id}?action=${action}`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({filename})});
    const body = await response.json().catch(() => ({}));
    return {ok: response.ok, body};
  }

  /**
   * Evaluates the stable prefix of `role` exactly once and saves it: `messages` end with the user turn whose content is the stable
   * start of every first turn of that role ('' when the whole turn varies). The chat template renders them, the text is cut where the
   * variable part begins, `/completion` evaluates exactly that prefix (`n_predict` 0) and the slot is saved to a file named by the
   * prefix digest (a prefix that contains a memory's vocabulary gets its own file). A saved file is reused after a restart.
   * Returns `{slot, state: 'restored'|'evaluated'|'unsupported', file, tokens, ms}`; never throws for a slot-file problem.
   */
  async prewarm(role, messages, {extraBody = {}} = {}) {
    await this.ensure();
    const id = this.slotOf(role), started = Date.now();
    const MARK = '\u0001chatsop-variable\u0001';
    const turns = messages.map((m, i) => i === messages.length - 1 ? {...m, content: m.content + MARK} : m);
    let prefix;
    try {
      const response = await this.fetchImpl(`${this.base}/apply-template`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({messages: turns, ...extraBody})});
      const rendered = (await response.json()).prompt;
      prefix = typeof rendered === 'string' && rendered.includes(MARK) ? rendered.slice(0, rendered.indexOf(MARK)) : null;
    } catch { prefix = null; }
    if (!prefix) return {slot: id, state: 'unsupported', ms: Date.now() - started};
    const file = slotFile({alias: this.alias, role, prefix});
    this.prefixes.set(role, file);
    // An external server may have been started with --slot-save-path too (tools/local-llm/serve.mjs): try its file as well.
    if (this.external || (this.slotSavePath && fs.existsSync(path.join(this.slotSavePath, file)))) {
      const restored = await this.#slotAction(id, 'restore', file).catch(() => ({ok: false}));
      if (restored.ok) return {slot: id, state: 'restored', file, tokens: restored.body?.n_restored ?? null, ms: Date.now() - started};
    }
    const response = await this.fetchImpl(`${this.base}/completion`, {method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify({prompt: prefix, n_predict: 0, cache_prompt: true, id_slot: id})});
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { this.prefixes.delete(role); return {slot: id, state: 'failed', file, status: response.status}; }
    let saved = false;
    if (this.slotSavePath || this.external) {
      saved = (await this.#slotAction(id, 'save', file).catch(() => ({ok: false}))).ok;
      // Only the current prefix of a role is kept: older files of the same model and role are stale.
      if (saved && !this.external) for (const old of fs.readdirSync(this.slotSavePath)) if (old !== file && old.startsWith(`${this.alias}-${role}-`.replace(/[^\w.-]/g, '_'))) fs.rmSync(path.join(this.slotSavePath, old), {force: true});
    }
    if (!saved) this.prefixes.delete(role);
    return {slot: id, state: 'evaluated', file, saved, tokens: body.timings?.prompt_n ?? body.tokens_evaluated ?? null, ms: Date.now() - started};
  }

  /**
   * Starts one request of `role`: waits until the role's previous request ended (one conversation per slot at a time), then restores
   * the saved stable prefix so that only the request's own tokens are evaluated (recurrent and hybrid models cannot reuse a prefix
   * from a diverged conversation otherwise). Returns `{slot, restored, ms, release}`; `release()` must be called when the request ends.
   */
  async begin(role) {
    const id = this.slotOf(role);
    const previous = this.locks.get(role) ?? Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    this.locks.set(role, previous.then(() => current));
    await previous;
    const started = Date.now();
    const file = this.prefixes.get(role);
    const restored = file ? (await this.#slotAction(id, 'restore', file).catch(() => ({ok: false}))).ok : false;
    return {slot: id, restored, ms: Date.now() - started, release};
  }

  /** The server's own slot counters (llama-server `/slots`), for checking that the cached prefix is reused. */
  async slotStates() {
    try { return await (await this.fetchImpl(`${this.base}/slots`)).json(); } catch { return null; }
  }
}
