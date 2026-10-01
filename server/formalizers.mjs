/** Model registry and the on-demand processes behind it (DS012 "Formalizer models").
 *
 * `config/formalizers.json` lists the models the product uses. Each entry has an explicit `capabilities` list, a subset of
 * `formalize` (SOP Lang; only a `service` entry, the SymbolicLM service, is a formalizer), `proofread` (LanguageProofingLLM),
 * `proofread-symbolic` (SymbolicProofingLLM) and `translate-clean` (the translator LLM). The fine-tuned FormalizerLLM entries
 * and the base-model Chat and Translate modes were removed on 2026-10-01; their artifacts and reports stay as evidence.
 * A `gguf` entry is run by this module: the
 * server starts one CPU `llama-server` for it when it is first selected, on a free loopback port, with the flags of
 * the evaluation harness (`-ngl 0 --jinja -np 1 -c 8192`, GPU hidden), reuses it while it runs, stops it after an
 * idle period, keeps at most `maxRunning` (5 by default: the four models of one chat turn plus one) alive within a memory budget
 * (the least recently used idle, unleased, not kept-open one is stopped to make room, never one a turn is using) and
 * stops all of them when the server closes or the process exits. Each model has a mode (server/server-models.mjs): `keep_open`
 * (pinned, warmed at server start, never evicted or idled out), `on_demand` or `off` (DS012 "Model lifecycle"). The request is `predictMessage`
 * (lib/llama-chat.mjs): the message alone, greedy, the checkpoint's own chat template.
 * A `service` entry names a local Node script that serves the same llama.cpp chat-completion interface itself
 * (`<script> serve --host H --port P --device cpu`), SymbolicLM `lib/symbolic-lm/serve.mjs` (Stanza, symbolic
 * translation and the UD rules, lib/symbolic-lm/); it is started, reused, idled and stopped exactly like a `gguf` model,
 * on the CPU with the GPU hidden.
 */
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {predictMessage} from '../lib/llama-chat.mjs';
import {DEFAULT_MAX_RUNNING, defaultBudgetMb, residentMb} from './server-models.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * Registry capabilities: `formalize` (SOP Lang, the SymbolicLM service), `proofread`, the textToCleanEnglish step's
 * LanguageProofingLLM, `proofread-symbolic`, SymbolicProofingLLM, the optional rewrite of SymbolicLM's pipeline, and
 * `translate-clean`, the translator LLM (Qwen3-4B-Instruct Q4_K_M) that textToCleanEnglish uses for Romanian and mixed sentences.
 */
export const CAPABILITIES = Object.freeze(['formalize', 'proofread', 'proofread-symbolic', 'translate-clean']);

/** The four states a model reports on /readyz, /v1/models, the home page and the chat. */
export const STATES = Object.freeze(['stopped', 'starting', 'ready', 'error']);

/**
 * Reads and checks a registry file. Returns `{file, default, defaults, models}`; each model is
 * `{id, label, note, capabilities, kind: 'gguf'|'service', gguf?, service?}` with `gguf` and
 * `service` resolved against `root`.
 * `default` is the default formalizer; `defaults` maps every capability that some model offers to its default model
 * (the file's `defaults` entry, else `default` for formalize, else the first model of that capability).
 */
export function loadRegistry(file = path.join(ROOT, 'config/formalizers.json'), {root = ROOT} = {}) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!data || !Array.isArray(data.models) || !data.models.length) throw Error(`${file}: expected a non-empty "models" list`);
  const seen = new Set();
  const models = data.models.map((entry, index) => {
    const where = `${file}: models[${index}]`;
    if (!entry || typeof entry !== 'object') throw Error(`${where} must be an object`);
    if (typeof entry.id !== 'string' || !ID.test(entry.id)) throw Error(`${where}: id must be lowercase letters, digits, ".", "_" or "-"`);
    if (seen.has(entry.id)) throw Error(`${where}: duplicate id ${entry.id}`);
    seen.add(entry.id);
    if (typeof entry.label !== 'string' || !entry.label.trim()) throw Error(`${where}: label is required`);
    const capabilities = entry.capabilities;
    if (!Array.isArray(capabilities) || !capabilities.length || capabilities.some(mode => !CAPABILITIES.includes(mode)) || new Set(capabilities).size !== capabilities.length) {
      throw Error(`${where}: capabilities is required: a non-empty list of distinct ${CAPABILITIES.join(', ')}`);
    }
    const base = {id: entry.id, label: entry.label, note: typeof entry.note === 'string' ? entry.note : '', capabilities: CAPABILITIES.filter(mode => capabilities.includes(mode))};
    // `rewrite.mode` of the SymbolicLM entry (off, gated or always): the default of the chat's SymbolicProofingLLM setting.
    if (typeof entry.rewrite?.mode === 'string') base.rewriteMode = entry.rewrite.mode;
    // Optional lifecycle facts: the estimated resident memory and the typical start time, shown in the server-models settings.
    if (Number.isFinite(entry.memoryMb) && entry.memoryMb > 0) base.memoryMb = entry.memoryMb;
    if (Number.isFinite(entry.startEstimateMs) && entry.startEstimateMs > 0) base.startEstimateMs = entry.startEstimateMs;
    if (typeof entry.gguf === 'string' && entry.gguf && entry.endpoint === undefined && entry.service === undefined) {
      if (base.capabilities.includes('formalize')) throw Error(`${where}: only a service (SymbolicLM) is a formalizer; a gguf model cannot have the formalize capability`);
      return {...base, kind: 'gguf', gguf: path.resolve(root, entry.gguf)};
    }
    if (typeof entry.service === 'string' && entry.service && entry.gguf === undefined && entry.endpoint === undefined) {
      if (base.capabilities.join() !== 'formalize') throw Error(`${where}: a service is a formalizer; its only capability is formalize`);
      return {...base, kind: 'service', service: path.resolve(root, entry.service)};
    }
    throw Error(`${where}: give exactly one of "gguf" (a model file) or "service" (a local serve script); the runtime endpoint entry was removed with FormalizerLLM`);
  });
  const offers = (id, mode) => models.find(model => model.id === id)?.capabilities.includes(mode);
  const formalizers = models.filter(model => model.capabilities.includes('formalize'));
  const fallback = data.default ?? (formalizers[0] ?? models[0]).id;
  if (!seen.has(fallback)) throw Error(`${file}: default ${fallback} is not a listed model`);
  if (formalizers.length && !offers(fallback, 'formalize')) throw Error(`${file}: default ${fallback} is not a formalize model`);
  const defaults = {};
  for (const mode of CAPABILITIES) {
    const chosen = data.defaults?.[mode] ?? (mode === 'formalize' && offers(fallback, mode) ? fallback : models.find(model => model.capabilities.includes(mode))?.id);
    if (chosen === undefined) continue;
    if (!offers(chosen, mode)) throw Error(`${file}: defaults.${mode} ${chosen} is not a listed ${mode} model`);
    defaults[mode] = chosen;
  }
  return {file, default: fallback, defaults, models};
}

/**
 * The `llama-server` binary: `LLAMA_SERVER_BIN`, then `LLAMA_SERVER` (training/cli.mjs `serve-cpu`), then
 * `LLAMA_CPP_DIR/build/bin`, `vendor/llama.cpp/build/bin` and `~/llama-cpp-venv/llama.cpp/build/bin`.
 * Returns the first existing path, or null.
 */
export function findLlamaServer(env = process.env) {
  const candidates = [env.LLAMA_SERVER_BIN, env.LLAMA_SERVER,
    env.LLAMA_CPP_DIR && path.join(env.LLAMA_CPP_DIR, 'build/bin/llama-server'),
    path.join(ROOT, 'vendor/llama.cpp/build/bin/llama-server'),
    path.join(os.homedir(), 'llama-cpp-venv/llama.cpp/build/bin/llama-server')].filter(Boolean);
  return candidates.find(file => fs.statSync(file, {throwIfNoEntry: false})?.isFile()) ?? null;
}

async function freePort(host) {
  const probe = net.createServer();
  await new Promise((resolve, reject) => probe.once('error', reject).listen(0, host, resolve));
  const {port} = probe.address();
  await new Promise(resolve => probe.close(resolve));
  return port;
}

const failure = (message, status = 503, code = 'model_unavailable') => Object.assign(new Error(message), {status, code});

/** Models this module starts and stops (llama-server GGUF models and local service scripts). */
export const isManaged = model => model?.kind === 'gguf' || model?.kind === 'service';

export class FormalizerManager {
  /**
   * `registry` from `loadRegistry`. Options: `bin` (llama-server path; default `findLlamaServer()`), `threads`
   * (at most 8), `maxRunning` (5: the four models of one chat turn plus one), `idleMs` (15 minutes; applies to on-demand models only),
   * `memoryBudgetMb` (default: half of the RAM; the estimated memory of the running models plus the one to start must fit),
   * `turnWindowMs` (30 s: a model used this recently is the last choice for an eviction), `contextSize` (8192),
   * `maxTokens` (6144, as the evaluation scripts),
   * `startTimeoutMs` (120 s), `host` (127.0.0.1), `logDir` (one log file per model, plus `manager-events.jsonl`),
   * `modes` (model id to `keep_open`|`on_demand`|`off`; server/server-models.mjs).
   */
  constructor({registry, bin = findLlamaServer(), threads = Math.min(8, os.availableParallelism()), maxRunning = DEFAULT_MAX_RUNNING, idleMs = 15 * 60 * 1000,
    memoryBudgetMb = defaultBudgetMb(), turnWindowMs = 30000, contextSize = 8192, maxTokens = 6144, startTimeoutMs = 120000, host = '127.0.0.1', logDir = null, sweepMs = 60000, modes = {}} = {}) {
    if (!registry) throw Error('FormalizerManager requires a registry');
    Object.assign(this, {registry, bin, threads: Math.max(1, Math.min(8, threads)), maxRunning, idleMs, memoryBudgetMb, turnWindowMs, contextSize, maxTokens, startTimeoutMs, host, logDir});
    this.entries = new Map(registry.models.filter(isManaged).map(model => [model.id, {model, state: 'stopped', error: null, child: null, port: null, lastUsed: 0, order: 0, busy: 0, starting: null, mode: modes[model.id] ?? 'on_demand', startMs: null, startedAt: null, warmed: false, revivedAt: 0}]));
    this.uses = 0; // least-recently-used order, independent of clock resolution
    this.warmHook = null; // async id => probe request, set by server/capabilities.mjs
    this.autoRevive = false; // set by the server: a kept-open model that died is started again by the sweep
    this.eventLog = [];
    this.sweeper = setInterval(() => this.sweep(), sweepMs);
    this.sweeper.unref();
    this.onExit = () => this.killAll();
    process.once('exit', this.onExit);
  }

  /** Records a lifecycle event (start, ready, stop, evict, off, error) in memory (the last 300) and in `<logDir>/manager-events.jsonl`. */
  event(type, id, detail = {}) {
    const record = {t: new Date().toISOString(), event: type, model: id, ...detail};
    this.eventLog.push(record);
    if (this.eventLog.length > 300) this.eventLog.shift();
    if (this.logDir) { try { fs.mkdirSync(this.logDir, {recursive: true}); fs.appendFileSync(path.join(this.logDir, 'manager-events.jsonl'), JSON.stringify(record) + '\n'); } catch { /* logging never fails a request */ } }
  }

  /** The lifecycle events so far, oldest first (`limit`: the last N). */
  events(limit = 300) { return this.eventLog.slice(-limit); }

  /** Applies lifecycle settings (server/server-models.mjs `normalizeSettings` output): limits and per-model modes. Starts kept-open models and stops `off` ones in the background. */
  applySettings(settings, previous = null) {
    this.maxRunning = settings.maxRunning;
    this.idleMs = settings.idleMinutes * 60000;
    this.turnWindowMs = settings.turnWindowSeconds * 1000;
    this.memoryBudgetMb = settings.memoryBudgetMb ?? defaultBudgetMb();
    for (const [id, entry] of this.entries) {
      const mode = settings.models[id] ?? 'on_demand', before = entry.mode;
      entry.mode = mode;
      if (!previous || before === mode) continue;
      this.event('mode', id, {from: before, to: mode});
      if (mode === 'off') this.stop(id).catch(() => {});
      else if (mode === 'keep_open') this.openAndWarm(id);
    }
  }

  /** Starts a model in the background and, once it runs, sends it the probe request of `warmHook` (set by the capabilities); failures are logged, never thrown. */
  openAndWarm(id) {
    return this.ensure(id).then(() => this.warmHook?.(id)).catch(error => this.event('error', id, {message: String(error.message).slice(0, 200)}));
  }

  /** Every managed model that is `keep_open`. */
  keptOpen() { return [...this.entries.values()].filter(entry => entry.mode === 'keep_open').map(entry => entry.model.id); }

  /** The estimated resident memory (MB) of a model: the registry's `memoryMb`, else the GGUF size plus the context buffers, else 1 GB. */
  estimateMb(entry) {
    if (entry.model.memoryMb) return entry.model.memoryMb;
    if (entry.model.kind === 'service') return 2500;
    const size = fs.statSync(entry.model.gguf, {throwIfNoEntry: false})?.size ?? 0;
    return Math.round(size / 1048576 * 1.15 + 300);
  }

  /** Memory (MB) a running model holds: the measured resident size when /proc has it, else the estimate. */
  usedMb(entry) { return (entry.child?.pid && residentMb(entry.child.pid)) || this.estimateMb(entry); }

  /** A row for the server-models API: the state, the mode, the memory and when the model was last used. */
  describe(entry) {
    const model = entry.model, status = this.status(model.id), running = entry.state === 'starting' || entry.state === 'ready';
    return {id: model.id, label: model.label, kind: model.kind, capabilities: model.capabilities, mode: entry.mode, state: status.state, error: status.error ?? null, running, ready: entry.state === 'ready',
      warm: entry.state === 'ready' && entry.warmed, pid: entry.child?.pid ?? null, port: entry.state === 'ready' ? entry.port : null,
      memory_mb: running ? this.usedMb(entry) : null, memory_estimate_mb: this.estimateMb(entry),
      last_used: entry.lastUsed ? new Date(entry.lastUsed).toISOString() : null, idle_s: entry.lastUsed && entry.state === 'ready' ? Math.round((Date.now() - entry.lastUsed) / 1000) : null,
      busy: entry.busy, started_at: entry.startedAt ? new Date(entry.startedAt).toISOString() : null,
      start_ms: entry.startMs, start_estimate_ms: entry.startMs ?? model.startEstimateMs ?? (model.kind === 'service' ? 25000 : model.gguf && this.estimateMb(entry) > 1500 ? 6000 : 3000)};
  }

  /** Marks a model warm (its probe request answered); the server-models view and /health report it. */
  markWarm(id, warmed = true) { const entry = this.entries.get(id); if (entry) entry.warmed = warmed; }

  /**
   * Holds `ids` for one turn: a held model is never evicted or idled out until the returned function is called (a turn that needs
   * a translator and then a proofreader holds both for its whole duration). Unknown ids are ignored.
   */
  hold(ids) {
    const held = [...new Set(ids)].map(id => this.entries.get(id)).filter(Boolean);
    for (const entry of held) entry.busy++;
    let released = false;
    return () => { if (released) return; released = true; for (const entry of held) { entry.busy--; this.touch(entry); } };
  }

  model(id) { return this.registry.models.find(model => model.id === id) ?? null; }

  /** Public state of one managed model: `{state, error, port, threads}`. */
  status(id) {
    const entry = this.entries.get(id);
    if (!entry) return null;
    const missing = this.missing(entry);
    if (missing && (entry.state === 'stopped' || entry.state === 'error')) return {state: 'error', error: missing, mode: entry.mode};
    return {state: entry.state, error: entry.error, mode: entry.mode, ...(entry.state === 'ready' ? {port: entry.port, threads: this.threads, warm: entry.warmed} : {})};
  }

  /** Why the model cannot start (no binary, no GGUF file, no service script), or null. */
  missing(entry) {
    if (entry.model.kind === 'service') return fs.existsSync(entry.model.service) ? null : 'service script not found: ' + path.relative(ROOT, entry.model.service);
    if (!this.bin) return 'llama-server not found (set LLAMA_SERVER_BIN)';
    return fs.existsSync(entry.model.gguf) ? null : 'GGUF file not found: ' + path.relative(ROOT, entry.model.gguf);
  }

  running() { return [...this.entries.values()].filter(entry => entry.state === 'starting' || entry.state === 'ready'); }

  /** Starts the model's server when needed and resolves with its base URL once `/health` answers. */
  async ensure(id) {
    const entry = this.entries.get(id);
    if (!entry) throw failure('Unknown managed formalizer ' + id, 400, 'unknown_model');
    if (entry.mode === 'off') throw failure(`Model ${id} is switched off in the server settings (Settings, Server models)`, 503, 'model_off');
    this.touch(entry);
    if (entry.state === 'ready') return this.url(entry);
    if (entry.state === 'starting') return entry.starting;
    entry.starting = this.start(entry);
    try {
      return await entry.starting;
    } finally {
      entry.starting = null;
    }
  }

  touch(entry) {
    entry.lastUsed = Date.now();
    entry.order = ++this.uses;
  }

  url(entry) { return `http://${this.host}:${entry.port}`; }

  /**
   * Stops models until `entry` fits: fewer than `maxRunning` others and the estimated memory within the budget. A victim is an idle,
   * unheld model that is not `keep_open`; models used within `turnWindowMs` go last. A model a turn holds, one that is busy or starting and
   * a kept-open one is never a victim; with no victim the start fails with a retryable 503 (`formalizer_capacity`).
   */
  async makeRoom(entry) {
    const need = this.estimateMb(entry);
    for (;;) {
      const others = this.running().filter(other => other !== entry);
      const used = others.reduce((sum, other) => sum + this.usedMb(other), 0);
      const tooMany = others.length >= this.maxRunning, tooBig = this.memoryBudgetMb > 0 && used + need > this.memoryBudgetMb;
      if (!tooMany && !tooBig) return;
      const now = Date.now();
      const victim = others.filter(other => other.state === 'ready' && other.busy === 0 && other.mode !== 'keep_open')
        .sort((a, b) => (now - a.lastUsed < this.turnWindowMs) - (now - b.lastUsed < this.turnWindowMs) || a.order - b.order)[0];
      if (!victim) {
        const reason = tooMany ? `at most ${this.maxRunning} models run at once` : `the memory budget of ${this.memoryBudgetMb} MB is used (${used} MB running, ${need} MB needed)`;
        throw failure(`${reason} and every other model is busy, held by a turn or kept open; try again shortly or raise the limit in Settings, Server models`, 503, 'formalizer_capacity');
      }
      this.event('evict', victim.model.id, {for: entry.model.id, reason: tooMany ? 'max_running' : 'memory'});
      await this.stop(victim.model.id);
    }
  }

  async start(entry) {
    const missing = this.missing(entry);
    if (missing) {
      Object.assign(entry, {state: 'error', error: missing});
      throw failure('Formalizer ' + entry.model.id + ' cannot start: ' + missing);
    }
    // The entry counts as running from here on, so concurrent starts see each other when they check the limits.
    const before = {state: entry.state, error: entry.error};
    entry.state = 'starting';
    entry.error = null;
    const began = Date.now();
    try {
      await this.makeRoom(entry);
    } catch (error) {
      Object.assign(entry, before);
      throw error;
    }
    this.event('start', entry.model.id, {mode: entry.mode, running: this.running().length, max: this.maxRunning});
    try {
      entry.port = await freePort(this.host);
      const service = entry.model.kind === 'service';
      const command = service ? process.execPath : this.bin;
      const args = service ? [entry.model.service, 'serve', '--host', this.host, '--port', String(entry.port), '--device', 'cpu']
        : ['-m', entry.model.gguf, '--alias', entry.model.id, '--host', this.host, '--port', String(entry.port),
          '-ngl', '0', '-t', String(this.threads), '-np', '1', '-c', String(this.contextSize), '--jinja'];
      let log = 'ignore';
      if (this.logDir) {
        fs.mkdirSync(this.logDir, {recursive: true});
        log = fs.openSync(path.join(this.logDir, `${entry.model.id}.log`), 'a');
      }
      // CPU only: the GPU is hidden and no layer is offloaded (AGENTS.md: one GPU worker per machine).
      const child = spawn(command, args, {stdio: ['ignore', log, log], env: {...process.env, CUDA_VISIBLE_DEVICES: ''}});
      if (typeof log === 'number') fs.closeSync(log);
      entry.child = child;
      let exited = null;
      child.once('error', error => { exited = error.message; });
      child.once('exit', (code, signal) => {
        exited ??= `llama-server exited (${signal ?? 'code ' + code})`;
        if (entry.child !== child) return;
        entry.child = null;
        if (entry.state !== 'stopped') Object.assign(entry, {state: 'error', error: exited, port: null});
      });
      const deadline = Date.now() + this.startTimeoutMs;
      while (Date.now() < deadline) {
        if (exited) throw Error(exited);
        if (entry.state === 'stopped') throw Error('Stopped while starting');
        try {
          const response = await fetch(this.url(entry) + '/health', {signal: AbortSignal.timeout(1000)});
          if (response.ok) {
            entry.state = 'ready';
            entry.startMs = Date.now() - began;
            entry.startedAt = Date.now();
            this.touch(entry);
            this.event('ready', entry.model.id, {ms: entry.startMs});
            return this.url(entry);
          }
        } catch {
          // not listening yet
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      throw Error('llama-server did not become ready in time');
    } catch (error) {
      const child = entry.child;
      entry.child = null;
      child?.kill('SIGKILL');
      Object.assign(entry, {state: 'error', error: error.message, port: null});
      this.event('error', entry.model.id, {message: String(error.message).slice(0, 200)});
      throw failure('Formalizer ' + entry.model.id + ' could not start: ' + error.message);
    }
  }

  /** Runs `work(url)` on the model (starting it if needed) after checking that it offers `mode`. */
  async use(id, mode, work) {
    const model = this.entries.get(id)?.model;
    if (model && !model.capabilities.includes(mode)) throw failure(`Model ${id} does not offer ${mode}`, 400, 'unsupported_mode');
    const entry = this.entries.get(id);
    if (!entry) throw failure('Unknown managed formalizer ' + id, 400, 'unknown_model');
    // Held from before the start until the work ends, so no other start can evict the model between the two.
    entry.busy++;
    try {
      return await work(await this.ensure(id));
    } finally {
      entry.busy--;
      this.touch(entry);
    }
  }

  /** Runs `work(url)` on LanguageProofingLLM-style model `id` (starting it if needed): the textToCleanEnglish backend. */
  proofread(id, work) { return this.use(id, 'proofread', work); }

  /** Runs `work(url)` on the translator model `id` (starting it if needed): the textToCleanEnglish backend for Romanian and mixed sentences. */
  translateClean(id, work) { return this.use(id, 'translate-clean', work); }

  /** Runs `work(url)` on SymbolicProofingLLM-style model `id` (starting it if needed): the optional rewrite of SymbolicLM. */
  proofreadSymbolic(id, work) { return this.use(id, 'proofread-symbolic', work); }

  /**
   * Formalizes one message with a service formalizer, SymbolicLM (starting it if needed): `{sop, ms, raw, symbolic}`. `extra` holds
   * host options for the service (SymbolicLM's `symbolic_lm`); `symbolic` is the service's own report (analysis, rewrite trace,
   * interpretation) or null.
   */
  async formalize(id, message, {timeoutMs, extra = null} = {}) {
    return this.use(id, 'formalize', async url => {
      const result = await predictMessage(url, message, {maxTokens: this.maxTokens, ...(timeoutMs ? {timeoutMs} : {}), ...(extra ? {extra} : {})});
      if (result.finish === 'length') throw Error('Model output was truncated; no command executed');
      return {sop: result.text.trim(), ms: result.ms, raw: result.raw === true, symbolic: result.symbolic_lm ?? null};
    });
  }

  async stop(id) {
    const entry = this.entries.get(id);
    if (!entry) return;
    const child = entry.child;
    const was = entry.state;
    Object.assign(entry, {state: 'stopped', error: null, child: null, port: null, warmed: false});
    if (was !== 'stopped') this.event('stop', id);
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.kill('SIGTERM');
    });
  }

  /**
   * Stops the on-demand servers unused for `idleMs` (a kept-open or held model is never stopped); with `autoRevive`, starts a kept-open model
   * that died again in the background (at most once a minute per model).
   */
  async sweep(now = Date.now()) {
    for (const entry of this.entries.values()) {
      if (entry.mode === 'on_demand' && entry.state === 'ready' && entry.busy === 0 && now - entry.lastUsed >= this.idleMs) { this.event('idle', entry.model.id, {idle_s: Math.round((now - entry.lastUsed) / 1000)}); await this.stop(entry.model.id); }
      else if (this.autoRevive && entry.mode === 'keep_open' && (entry.state === 'stopped' || entry.state === 'error') && !this.missing(entry) && now - entry.revivedAt >= 60000) {
        entry.revivedAt = now;
        this.event('revive', entry.model.id);
        this.openAndWarm(entry.model.id);
      }
    }
  }

  async stopAll() {
    clearInterval(this.sweeper);
    process.removeListener('exit', this.onExit);
    await Promise.all([...this.entries.keys()].map(id => this.stop(id)));
  }

  /** Synchronous last resort on process exit. */
  killAll() {
    for (const entry of this.entries.values()) entry.child?.kill('SIGKILL');
  }
}
