/**
 * The models omp can use (DS022 "omp integration"): `omp models --json` lists the catalog of the providers omp is signed in to or
 * has keys for. Each model gets a cost class so the page can offer subscription models first:
 *   subscription  a provider reached through a subscription login (OAuth) or a flat plan (openai-codex, xai-oauth, zai, ...)
 *   paid_api      a provider billed per token (deepseek, openrouter, ...)
 *   unknown       anything else
 * The price in the answer is omp's listed price per million tokens; for a subscription model it is the nominal list price, not
 * what the owner pays. The result is cached in memory for `ttlMs`.
 */
import {spawn} from 'node:child_process';

export const DEFAULT_SUBSCRIPTION_PROVIDERS = Object.freeze(['openai-codex', 'xai-oauth', 'zai', 'github-copilot', 'anthropic-oauth', 'google-gemini-cli']);
export const DEFAULT_PAID_PROVIDERS = Object.freeze(['deepseek', 'openrouter', 'openai', 'anthropic', 'google', 'xai', 'mistral', 'groq']);

export function costClassOf(provider, {subscription = DEFAULT_SUBSCRIPTION_PROVIDERS, paid = DEFAULT_PAID_PROVIDERS} = {}) {
  if (subscription.includes(provider) || /oauth|subscription/.test(provider)) return 'subscription';
  if (paid.includes(provider)) return 'paid_api';
  return 'unknown';
}

/** Runs a command and returns {code, stdout, stderr}; a timeout kills it. */
export function runCommand(bin, args, {timeoutMs = 30_000, cwd, env = process.env} = {}) {
  return new Promise(resolve => {
    let child;
    try { child = spawn(bin, args, {cwd, env, stdio: ['ignore', 'pipe', 'pipe']}); } catch (error) { return resolve({code: null, stdout: '', stderr: error.message, error}); }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', error => { clearTimeout(timer); resolve({code: null, stdout, stderr: error.message, error}); });
    child.on('close', code => { clearTimeout(timer); resolve({code, stdout, stderr, timedOut}); });
  });
}

/** The default model omp is configured with (`modelRoles.default` of its config.yml), read without touching credentials. */
export async function ompDefaultModel(readFile) {
  try {
    const text = await readFile();
    const match = /^\s*default:\s*([^\s#]+)/m.exec(text.slice(text.indexOf('modelRoles:')));
    return match ? match[1] : null;
  } catch { return null; }
}

export function normalizeModel(entry, classes) {
  const input = entry.cost?.input;
  const output = entry.cost?.output;
  return {
    id: entry.selector ?? `${entry.provider}/${entry.id}`,
    provider: entry.provider,
    name: entry.name ?? entry.id,
    context_window: entry.contextWindow ?? null,
    reasoning: Boolean(entry.reasoning),
    thinking: entry.thinking ?? [],
    cost_class: costClassOf(entry.provider, classes),
    price_per_mtok: typeof input === 'number' ? {input, output: typeof output === 'number' ? output : null} : null,
  };
}

export class OmpModels {
  /** `run(bin, args, opts)` is injectable for tests. */
  constructor({bin = 'omp', ttlMs = 600_000, run = runCommand, readConfig = null, classes = {}, now = () => Date.now()} = {}) {
    Object.assign(this, {bin, ttlMs, run, readConfig, classes, now});
    this.cached = null;
  }

  async list({force = false} = {}) {
    if (!force && this.cached && this.now() - this.cached.at < this.ttlMs) return {...this.cached.value, cached: true};
    const version = await this.run(this.bin, ['--version'], {timeoutMs: 10_000});
    if (version.code !== 0) {
      const value = {available: false, reason: version.error ? `omp could not be started (${version.stderr})` : `omp --version exited with ${version.code}`, models: [], providers: [], fetched_at: new Date(this.now()).toISOString()};
      return {...value, cached: false};
    }
    const listing = await this.run(this.bin, ['models', '--json'], {timeoutMs: 60_000});
    let entries = [];
    let reason = null;
    try { entries = JSON.parse(listing.stdout).models ?? []; } catch { reason = `omp models --json gave no JSON (exit ${listing.code}${listing.timedOut ? ', timed out' : ''})`; }
    const models = entries.filter(e => (e.kind ?? 'chat') === 'chat').map(e => normalizeModel(e, this.classes));
    const providers = [...models.reduce((map, m) => map.set(m.provider, {id: m.provider, cost_class: m.cost_class, models: (map.get(m.provider)?.models ?? 0) + 1}), new Map()).values()];
    const defaultModel = this.readConfig ? await ompDefaultModel(this.readConfig) : null;
    const value = {available: models.length > 0, ...(reason ? {reason} : {}), omp_version: version.stdout.trim(), default_model: defaultModel, models, providers, fetched_at: new Date(this.now()).toISOString()};
    if (value.available) this.cached = {at: this.now(), value};
    return {...value, cached: false};
  }

  clear() { this.cached = null; }
}
