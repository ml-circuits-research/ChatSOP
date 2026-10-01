/**
 * Node client of the Stanza UD worker (training/python/ud_parse_worker.py) for the symbolic baseline
 * `baseline-ud-rules-v1`: one long-lived Python child speaking JSON lines, requests answered in order.
 *
 * Package: the English models come from the SymbolicLM configuration `config/symbolic-lm.json` (`stanza.package`
 * `default` or `accurate`), overridden by `CHATSOP_STANZA_PACKAGE`; one worker script serves both (the worker's
 * `--en-package`, `--en-dir` and `--hf-home` options).
 *
 * Environment: `CHATSOP_NLP_PYTHON` (default `~/nlp-venv/bin/python`), `CHATSOP_STANZA_DIR` (default
 * `~/nlp-venv/stanza_resources`; Romanian, the sentence splitter and the `default` English package),
 * `CHATSOP_STANZA_ACCURATE_DIR` and `CHATSOP_STANZA_HF_HOME` (the `accurate` package), `CHATSOP_UD_DEVICE` (`cuda` or
 * `cpu`; default `cuda`, which falls back to the CPU when no GPU is visible).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const WORKER = path.join(ROOT, 'training/python/ud_parse_worker.py');
export const defaultPython = (env = process.env) => env.CHATSOP_NLP_PYTHON ?? path.join(os.homedir(), 'nlp-venv/bin/python');
export const defaultModels = (env = process.env) => env.CHATSOP_STANZA_DIR ?? path.join(os.homedir(), 'nlp-venv/stanza_resources');
const CONFIG_FILE = path.join(ROOT, 'config/symbolic-lm.json');
const expand = p => (typeof p === 'string' && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

/** The SymbolicLM configuration (config/symbolic-lm.json) with the environment overrides applied. */
export function symbolicLmConfig(env = process.env) {
  const file = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  const name = env.CHATSOP_STANZA_PACKAGE ?? file.stanza.package;
  if (!file.stanza.packages[name]) throw Error(`unknown Stanza package "${name}" (config/symbolic-lm.json knows ${Object.keys(file.stanza.packages).join(', ')})`);
  return {...file, stanza: {...file.stanza, package: name}};
}

/** How to start the English pipeline of a package (`default` | `accurate`; default: the configured one). */
export function stanzaSetup(name = null, env = process.env) {
  const config = symbolicLmConfig(env);
  const pkg = name ?? config.stanza.package;
  const entry = config.stanza.packages[pkg];
  if (!entry) throw Error(`unknown Stanza package "${pkg}"`);
  const resourcesDir = pkg === 'default' ? defaultModels(env) : (env.CHATSOP_STANZA_ACCURATE_DIR ?? expand(entry.resources_dir));
  const hfHome = entry.hf_home ? (env.CHATSOP_STANZA_HF_HOME ?? expand(entry.hf_home)) : null;
  return {name: pkg, stanzaPackage: entry.stanza_package, resourcesDir, hfHome};
}

/** Why the worker cannot start (no Python venv, no Stanza models), or null. */
export function workerMissing(env = process.env, pkg = null) {
  if (!fs.existsSync(defaultPython(env))) return 'Stanza venv not found: ' + defaultPython(env) + ' (see dependencies.md)';
  if (!fs.existsSync(path.join(defaultModels(env), 'resources.json'))) return 'Stanza models not found under ' + defaultModels(env);
  const setup = stanzaSetup(pkg, env);
  if (!fs.existsSync(path.join(setup.resourcesDir, 'resources.json'))) return `Stanza package "${setup.name}" models not found under ${setup.resourcesDir}`;
  if (setup.hfHome && !fs.existsSync(setup.hfHome)) return `Hugging Face cache of the "${setup.name}" package not found: ${setup.hfHome}`;
  return null;
}

export class StanzaWorker {
  constructor({python = defaultPython(), models = defaultModels(), device = process.env.CHATSOP_UD_DEVICE ?? 'cuda', env = {}, log = null, package: pkg = null} = {}) {
    Object.assign(this, {python, models, device, env, log, setup: stanzaSetup(pkg), child: null, pending: [], ready: null, info: null});
  }

  /** Name of the English package this worker runs (`default` or `accurate`). */
  get package() { return this.setup.name; }

  /** Starts the worker once; resolves with `{ready, device}` after the models are loaded. */
  start() {
    if (this.ready) return this.ready;
    const extra = this.device === 'cpu' ? {CUDA_VISIBLE_DEVICES: ''} : {};
    const {stanzaPackage, resourcesDir, hfHome} = this.setup;
    const args = [WORKER, '--device', this.device, '--models-dir', this.models, '--en-dir', resourcesDir, '--en-package', stanzaPackage, ...(hfHome ? ['--hf-home', hfHome] : [])];
    this.child = spawn(this.python, args, {stdio: ['pipe', 'pipe', this.log ?? 'ignore'], env: {...process.env, ...extra, ...this.env}});
    const lines = readline.createInterface({input: this.child.stdout});
    this.ready = new Promise((resolve, reject) => {
      let started = false;
      this.child.once('error', reject);
      this.child.once('exit', code => {
        const error = Error('Stanza worker exited with code ' + code);
        if (!started) reject(error);
        for (const job of this.pending.splice(0)) job.reject(error);
        this.child = null;
      });
      lines.on('line', line => {
        let data;
        try { data = JSON.parse(line); } catch { return; }
        if (!started) { if (data.ready) { started = true; this.info = data; resolve(data); } return; }
        const job = this.pending.shift();
        if (!job) return;
        if (data.error) job.reject(Error(data.error)); else job.resolve(data);
      });
    });
    return this.ready;
  }

  async request(payload) {
    await this.start();
    if (!this.child) throw Error('Stanza worker is not running');
    return new Promise((resolve, reject) => {
      this.pending.push({resolve, reject});
      this.child.stdin.write(JSON.stringify(payload) + '\n');
    });
  }

  /** Parse one text: `{parse, ms, device}`. */
  parse(text) { return this.request({id: 0, text}); }
  /** Parse several texts in one batch: `{parses, ms, device}`. */
  parseMany(texts) { return this.request({id: 0, texts}); }

  async stop() {
    const child = this.child;
    if (!child) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.stdin.end();
      child.kill('SIGTERM');
    });
    this.child = null;
    this.ready = null;
  }
}
