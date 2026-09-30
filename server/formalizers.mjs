/** Model registry and the on-demand CPU `llama-server` processes behind it (DS012 "Formalizer models", "Chat modes").
 *
 * `config/formalizers.json` lists the models the chat can use. Each entry has `capabilities`, a subset of
 * `chat`, `translate` and `formalize` (default `["formalize"]`): fine-tuned formalizers have `formalize` only,
 * the unmodified base instruct models `chat` and `translate` only, since a base model cannot write SOP Lang.
 * A `gguf` entry is run by this module: the
 * server starts one CPU `llama-server` for it when it is first selected, on a free loopback port, with the flags of
 * the evaluation harness (`-ngl 0 --jinja -np 1 -c 8192`, GPU hidden), reuses it while it runs, stops it after an
 * idle period, keeps at most `maxRunning` (3) alive (the least recently used idle one is stopped to make room) and
 * stops all of them when the server closes or the process exits. The request is `predictMessage`
 * (lib/formalizer-endpoint.mjs): the message alone, greedy, the checkpoint's own chat template.
 * A `service` entry names a local Node script that serves the same llama.cpp chat-completion interface itself
 * (`<script> serve --host H --port P --device cpu`), for example SymbolicLM `tools/symbolic-lm.mjs` (Stanza, symbolic
 * translation and the UD rules, lib/symbolic-lm/); it is started, reused, idled and stopped exactly like a `gguf` model,
 * on the CPU with the GPU hidden.
 * The `runtime-endpoint` entry stands for the independently started `formalizer.url` of the runtime configuration.
 */
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {predictMessage, chatMessages} from '../lib/formalizer-endpoint.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** What a registry model can do; the chat page's MODE selector offers the models of the chosen mode. */
export const MODES = Object.freeze(['chat', 'formalize', 'translate']);

/** The four states a model reports on /readyz, /v1/models, the home page and the chat. */
export const STATES = Object.freeze(['stopped', 'starting', 'ready', 'error']);

/**
 * Reads and checks a registry file. Returns `{file, default, defaults, models}`; each model is
 * `{id, label, note, capabilities, kind: 'gguf'|'service'|'runtime-endpoint', gguf?, service?}` with `gguf` and
 * `service` resolved against `root`.
 * `default` is the default formalizer; `defaults` maps every mode that some model offers to its default model
 * (the file's `defaults` entry, else `default` for formalize, else the first model of that mode).
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
    const capabilities = entry.capabilities ?? ['formalize'];
    if (!Array.isArray(capabilities) || !capabilities.length || capabilities.some(mode => !MODES.includes(mode)) || new Set(capabilities).size !== capabilities.length) {
      throw Error(`${where}: capabilities must be a non-empty list of distinct ${MODES.join(', ')}`);
    }
    const base = {id: entry.id, label: entry.label, note: typeof entry.note === 'string' ? entry.note : '', capabilities: MODES.filter(mode => capabilities.includes(mode))};
    if (typeof entry.gguf === 'string' && entry.gguf && entry.endpoint === undefined && entry.service === undefined) return {...base, kind: 'gguf', gguf: path.resolve(root, entry.gguf)};
    if (typeof entry.service === 'string' && entry.service && entry.gguf === undefined && entry.endpoint === undefined) {
      if (base.capabilities.join() !== 'formalize') throw Error(`${where}: a service is a formalizer; its only capability is formalize`);
      return {...base, kind: 'service', service: path.resolve(root, entry.service)};
    }
    if (entry.endpoint === 'runtime' && entry.gguf === undefined) {
      if (base.capabilities.join() !== 'formalize') throw Error(`${where}: the runtime endpoint is a formalizer; its only capability is formalize`);
      return {...base, kind: 'runtime-endpoint'};
    }
    throw Error(`${where}: give exactly one of "gguf" (a model file), "service" (a local serve script) or "endpoint": "runtime"`);
  });
  const offers = (id, mode) => models.find(model => model.id === id)?.capabilities.includes(mode);
  const formalizers = models.filter(model => model.capabilities.includes('formalize'));
  const fallback = data.default ?? (formalizers[0] ?? models[0]).id;
  if (!seen.has(fallback)) throw Error(`${file}: default ${fallback} is not a listed model`);
  if (formalizers.length && !offers(fallback, 'formalize')) throw Error(`${file}: default ${fallback} is not a formalize model`);
  const defaults = {};
  for (const mode of MODES) {
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
   * (at most 8), `maxRunning` (3), `idleMs` (15 minutes), `contextSize` (8192), `maxTokens` (6144, as the
   * evaluation scripts), `chatMaxTokens` (512, the cap of a Chat or Translate reply), `startTimeoutMs` (120 s),
   * `host` (127.0.0.1), `logDir` (one log file per model).
   */
  constructor({registry, bin = findLlamaServer(), threads = Math.min(8, os.availableParallelism()), maxRunning = 3, idleMs = 15 * 60 * 1000,
    contextSize = 8192, maxTokens = 6144, chatMaxTokens = 512, startTimeoutMs = 120000, host = '127.0.0.1', logDir = null, sweepMs = 60000} = {}) {
    if (!registry) throw Error('FormalizerManager requires a registry');
    Object.assign(this, {registry, bin, threads: Math.max(1, Math.min(8, threads)), maxRunning, idleMs, contextSize, maxTokens, chatMaxTokens, startTimeoutMs, host, logDir});
    this.entries = new Map(registry.models.filter(isManaged).map(model => [model.id, {model, state: 'stopped', error: null, child: null, port: null, lastUsed: 0, order: 0, busy: 0, starting: null}]));
    this.uses = 0; // least-recently-used order, independent of clock resolution
    this.sweeper = setInterval(() => this.sweep(), sweepMs);
    this.sweeper.unref();
    this.onExit = () => this.killAll();
    process.once('exit', this.onExit);
  }

  model(id) { return this.registry.models.find(model => model.id === id) ?? null; }

  /** Public state of one managed model: `{state, error, port, threads}`. */
  status(id) {
    const entry = this.entries.get(id);
    if (!entry) return null;
    const missing = this.missing(entry);
    if (missing && (entry.state === 'stopped' || entry.state === 'error')) return {state: 'error', error: missing};
    return {state: entry.state, error: entry.error, ...(entry.state === 'ready' ? {port: entry.port, threads: this.threads} : {})};
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

  async start(entry) {
    const missing = this.missing(entry);
    if (missing) {
      Object.assign(entry, {state: 'error', error: missing});
      throw failure('Formalizer ' + entry.model.id + ' cannot start: ' + missing);
    }
    const others = this.running().filter(other => other !== entry);
    if (others.length >= this.maxRunning) {
      const idle = others.filter(other => other.state === 'ready' && other.busy === 0).sort((a, b) => a.order - b.order)[0];
      if (!idle) throw failure(`At most ${this.maxRunning} models run at once and all are busy; try again shortly`, 503, 'formalizer_capacity');
      await this.stop(idle.model.id);
    }
    entry.state = 'starting';
    entry.error = null;
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
            this.touch(entry);
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
      throw failure('Formalizer ' + entry.model.id + ' could not start: ' + error.message);
    }
  }

  /** Runs `work(url)` on the model (starting it if needed) after checking that it offers `mode`. */
  async use(id, mode, work) {
    const model = this.entries.get(id)?.model;
    if (model && !model.capabilities.includes(mode)) throw failure(`Model ${id} does not offer ${mode}`, 400, 'unsupported_mode');
    const url = await this.ensure(id);
    const entry = this.entries.get(id);
    entry.busy++;
    try {
      return await work(url);
    } finally {
      entry.busy--;
      this.touch(entry);
    }
  }

  /** Formalizes one message with the model (starting it if needed): `{sop, ms, raw}`. */
  async formalize(id, message, {timeoutMs} = {}) {
    return this.use(id, 'formalize', async url => {
      const result = await predictMessage(url, message, {maxTokens: this.maxTokens, ...(timeoutMs ? {timeoutMs} : {})});
      if (result.finish === 'length') throw Error('Model output was truncated; no command executed');
      return {sop: result.text.trim(), ms: result.ms, raw: result.raw === true};
    });
  }

  /**
   * A Chat or Translate reply of a base model (`mode` is `chat` or `translate`): `messages` as the chat template
   * takes them, sampled at `temperature` (0: greedy), at most `chatMaxTokens` new tokens. Returns
   * `{text, ms, finish, usage}`; a reply cut at the cap has `finish: 'length'` and is returned as it is.
   */
  async chat(id, mode, messages, {temperature = 0.7, timeoutMs} = {}) {
    if (!['chat', 'translate'].includes(mode)) throw failure('mode must be chat or translate', 400, 'unsupported_mode');
    return this.use(id, mode, async url => {
      const result = await chatMessages(url, messages, {temperature, maxTokens: this.chatMaxTokens, ...(timeoutMs ? {timeoutMs} : {})});
      return {text: result.text.trim(), ms: result.ms, finish: result.finish ?? null, usage: result.usage ?? null};
    });
  }

  async stop(id) {
    const entry = this.entries.get(id);
    if (!entry) return;
    const child = entry.child;
    Object.assign(entry, {state: 'stopped', error: null, child: null, port: null});
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.kill('SIGTERM');
    });
  }

  /** Stops the ready servers unused for `idleMs`. */
  async sweep(now = Date.now()) {
    for (const entry of this.entries.values()) if (entry.state === 'ready' && entry.busy === 0 && now - entry.lastUsed >= this.idleMs) await this.stop(entry.model.id);
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
