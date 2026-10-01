/**
 * What the server keeps open and what it does not (DS012 "Model lifecycle", DS030 "Server models"; owner request 2026-10-01).
 *
 * `config/server-models.json` holds the editable lifecycle settings; the API `GET|POST /v1/server/models` and the chat's
 * Settings, "Server models" section read and change them at runtime, and every change is written back to the file.
 *
 *   {"maxRunning": 6, "idleMinutes": 60, "memoryBudgetMb": null, "turnWindowSeconds": 30, "warmup": true,
 *    "models": {"symbolic-lm": "keep_open", "smollm2-360m-base": "on_demand", "gemma-3-270m-base": "off"}}
 *
 * A model is in exactly one of three modes: `keep_open` (pinned: started at server start in the background, warmed with a probe request,
 * never evicted and never idled out; restarted if it dies), `on_demand` (started when a request needs it, stopped after the idle
 * timeout, evicted least-recently-used when room is needed) or `off` (never started; a request that needs it is answered as if it could
 * not start, and the callers degrade: the translator falls back, the analysis reports the component in `errors`).
 * Models the file does not list are `keep_open` when they belong to the chat pipeline (the four of CHAT_PIPELINE) and `on_demand` otherwise.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const SERVER_MODELS_FILE = path.join(ROOT, 'config/server-models.json');
export const MODEL_MODES = Object.freeze(['keep_open', 'on_demand', 'off']);
export const SERVER_MODELS_FORMAT = 'chatsop-server-models-v1';

/** The models one chat turn needs (proofread or translate, analyse, rewrite): kept open by default. */
export const CHAT_PIPELINE = Object.freeze(['symbolic-lm', 'language-proofing-llm', 'translator-llm', 'symbolic-proofing-llm']);

/** Room for every pipeline model plus one other model (another model). */
export const DEFAULT_MAX_RUNNING = CHAT_PIPELINE.length + 1;

export const DEFAULTS = Object.freeze({maxRunning: DEFAULT_MAX_RUNNING, idleMinutes: 60, memoryBudgetMb: null, turnWindowSeconds: 30, warmup: true});

const bad = (message, code = 'invalid_parameter') => Object.assign(new Error(message), {status: 400, code});
const integer = (value, name, min, max) => {
  if (!Number.isInteger(value) || value < min || value > max) throw bad(`${name} must be an integer from ${min} to ${max}`);
  return value;
};

/** The mode of model `id` in `settings` (listed mode, else the default by role). */
export const modeOf = (settings, id) => settings.models?.[id] ?? (CHAT_PIPELINE.includes(id) ? 'keep_open' : 'on_demand');

/** The default memory budget: half of the machine's RAM (an estimate-based guard, not a limit the operating system enforces). */
export const defaultBudgetMb = () => Math.floor(os.totalmem() / 2 / 1048576);

/**
 * Checks and completes a settings object. `known` is the set of managed model ids (an unknown id is refused). A partial `input`
 * keeps the values of `base`. Returns a new complete object `{maxRunning, idleMinutes, memoryBudgetMb, turnWindowSeconds, warmup, models}`
 * (`models` lists every managed model with its effective mode).
 */
export function normalizeSettings(input, known, base = DEFAULTS) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('Expected a settings object');
  const allowed = ['maxRunning', 'idleMinutes', 'memoryBudgetMb', 'turnWindowSeconds', 'warmup', 'models', 'format', 'description'];
  const extra = Object.keys(input).filter(key => !allowed.includes(key));
  if (extra.length) throw bad(`Unsupported setting ${JSON.stringify(extra[0])}; accepted: maxRunning, idleMinutes, memoryBudgetMb, turnWindowSeconds, warmup, models`, 'unsupported_parameter');
  const merged = {...DEFAULTS, ...base, ...Object.fromEntries(Object.entries(input).filter(([key]) => !['format', 'description'].includes(key)))};
  const models = {};
  const given = {...(base.models ?? {}), ...(input.models ?? {})};
  if (input.models !== undefined && (typeof input.models !== 'object' || !input.models || Array.isArray(input.models))) throw bad('models must be an object of model id to mode');
  for (const id of Object.keys(given)) {
    if (!known.has(id)) {
      if (input.models && id in input.models) throw bad(`Unknown managed model ${JSON.stringify(id)}`, 'unknown_model');
      continue; // a stale id of the saved file is ignored
    }
  }
  for (const id of known) {
    const mode = given[id] ?? modeOf({}, id);
    if (!MODEL_MODES.includes(mode)) throw bad(`models.${id} must be one of ${MODEL_MODES.join(', ')}`);
    models[id] = mode;
  }
  const kept = Object.values(models).filter(mode => mode === 'keep_open').length;
  const out = {
    maxRunning: integer(merged.maxRunning, 'maxRunning', 1, 32),
    idleMinutes: integer(merged.idleMinutes, 'idleMinutes', 1, 10080),
    memoryBudgetMb: merged.memoryBudgetMb === null ? null : integer(merged.memoryBudgetMb, 'memoryBudgetMb', 512, 4_194_304),
    turnWindowSeconds: integer(merged.turnWindowSeconds, 'turnWindowSeconds', 0, 3600),
    warmup: typeof merged.warmup === 'boolean' ? merged.warmup : (() => { throw bad('warmup must be a boolean'); })(),
    models,
  };
  if (kept > out.maxRunning) throw bad(`maxRunning ${out.maxRunning} is below the ${kept} models kept open; raise it or put a model on demand`, 'invalid_settings');
  return out;
}

/** Reads the settings file (defaults when it is missing or unreadable) for the managed model ids `known`. */
export function loadServerModelSettings(file = SERVER_MODELS_FILE, known = new Set(CHAT_PIPELINE)) {
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* no file: the defaults */ }
  // A model id the registry no longer has is dropped, not an error.
  if (data?.models && typeof data.models === 'object') data = {...data, models: Object.fromEntries(Object.entries(data.models).filter(([id]) => known.has(id)))};
  try { return normalizeSettings(data, known, {}); }
  catch { return normalizeSettings({}, known, {}); }
}

/** Writes the settings atomically (temporary file, then rename). Returns the saved object. */
export function saveServerModelSettings(file, settings) {
  const text = JSON.stringify({format: SERVER_MODELS_FORMAT, description: DESCRIPTION, ...settings}, null, 2) + '\n';
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, text);
  fs.renameSync(temporary, file);
  return settings;
}

const DESCRIPTION = 'What the server keeps open and what it does not (DS012 "Model lifecycle"). Edited by the chat page (Settings, Server models) and by POST /v1/server/models; the server also reads it at start. keep_open: started at server start, warmed, never evicted or idled out. on_demand: started when needed, stopped after idleMinutes, evicted least-recently-used. off: never started. maxRunning: how many models may run at once (at least the number kept open; one chat turn needs up to four pipeline models plus one more). memoryBudgetMb: null means half of the RAM; the estimated memory of the running models plus the one to start must fit, else an idle on-demand model is stopped first. turnWindowSeconds: a model used this recently is the last choice for an eviction. warmup: start and probe the kept-open models in the background at server start.';

/** `/proc` resident memory (MB) of a process and its descendants, or null where /proc is not available. */
export function residentMb(pid) {
  try {
    const parent = new Map();
    for (const name of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const stat = fs.readFileSync(`/proc/${name}/stat`, 'utf8');
        parent.set(Number(name), Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]));
      } catch { /* the process ended */ }
    }
    const tree = new Set([pid]);
    for (let grew = true; grew;) { grew = false; for (const [child, up] of parent) if (!tree.has(child) && tree.has(up)) { tree.add(child); grew = true; } }
    let kb = 0;
    for (const id of tree) {
      try { kb += Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${id}/status`, 'utf8'))?.[1] ?? 0); } catch { /* ended */ }
    }
    return Math.round(kb / 1024);
  } catch { return null; }
}

/**
 * The server-models API and its state: `read()` is the settings plus every managed model's live state; `update(patch)` validates, applies to the manager,
 * persists and returns the same object. Model changes take effect at once: a model put `off` is stopped, one put `keep_open` starts in the background.
 */
export function createServerModels({registry, manager, file = SERVER_MODELS_FILE, warm = () => null, persist = true}) {
  const known = new Set([...manager.entries.keys()]);
  let settings = loadServerModelSettings(file, known);
  manager.applySettings(settings);

  const view = () => {
    const rows = [...manager.entries.values()].map(entry => manager.describe(entry));
    return {
      object: 'server.models', settings: {maxRunning: settings.maxRunning, idleMinutes: settings.idleMinutes, memoryBudgetMb: settings.memoryBudgetMb, memoryBudgetEffectiveMb: manager.memoryBudgetMb,
        turnWindowSeconds: settings.turnWindowSeconds, warmup: settings.warmup},
      modes: MODEL_MODES, models: rows, running: rows.filter(r => r.running).length,
      memory: {estimated_mb: rows.filter(r => r.running).reduce((sum, r) => sum + (r.memory_mb ?? 0), 0), budget_mb: manager.memoryBudgetMb, total_mb: Math.round(os.totalmem() / 1048576)},
      warm: warm(), file: path.relative(ROOT, file),
    };
  };

  return {
    settings: () => settings,
    read: view,
    update(patch) {
      const next = normalizeSettings(patch, known, settings);
      const previous = settings;
      settings = next;
      manager.applySettings(next, previous);
      if (persist) saveServerModelSettings(file, next);
      return view();
    },
  };
}
