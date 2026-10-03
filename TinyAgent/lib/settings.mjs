// Secrets and paths. A key is read only from an env file in the user's home or from the environment, never from a configuration
// file. Env files are looked up by name in the key folders (~/.tinyagent/keys, then the key folder of earlier versions as a
// migration fallback, legacy.mjs); a value found in an earlier folder wins, and the process environment wins over every file.
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OLD_KEYS_DIR, OLD_ENV } from './legacy.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The TinyAgent folder (built-in defaults, prompts, built-in TaskLambdas). */
export const HOME = resolve(HERE, '..');
export const DEFAULT_URL = 'http://127.0.0.1:18080';
/** The user's TinyAgent home: configuration, keys, data, cache, audit, logs, runs and models (TINYAGENT_HOME overrides). */
export const tinyHome = (env = process.env) => resolve(expandHome(env.TINYAGENT_HOME || '~/.tinyagent'));
export const secretDirs = (env = process.env) => [join(tinyHome(env), 'keys'), expandHome(OLD_KEYS_DIR)];

export function expandHome(p) {
  return typeof p === 'string' && p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

export function parseEnvFile(path) {
  const out = {};
  if (!path || !existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

/** The env-file values of an upstream, merged over the secret folders (earlier folders win). */
export function envValues(envFile, dirs = secretDirs()) {
  if (!envFile) return {};
  const name = basename(expandHome(envFile));
  const candidates = [...dirs.map((d) => join(expandHome(d), name)), ...(envFile.includes('/') ? [expandHome(envFile)] : [])];
  const out = {};
  for (const c of candidates.reverse()) Object.assign(out, parseEnvFile(c));
  return out;
}

// Resolves secrets per upstream: process env wins over the env files.
export function resolveUpstream(name, up, env = process.env, dirs = secretDirs(env)) {
  const file = envValues(up.envFile, dirs);
  const get = (k) => (k ? (env[k] ?? file[k]) : undefined);
  return {
    ...up,
    name,
    baseUrl: String(get(up.baseUrlVar) || up.baseUrl).replace(/\/+$/, ''),
    key: get(up.keyVar) || null,
  };
}

export function resolveProxyToken(config, env = process.env) {
  if (env.TINYAGENT_TOKEN || env[OLD_ENV.token]) return env.TINYAGENT_TOKEN || env[OLD_ENV.token];
  for (const up of Object.values(config.providers ?? config.upstreams ?? {})) {
    const v = envValues(up?.envFile);
    if (v.TINYAGENT_TOKEN) return v.TINYAGENT_TOKEN;
  }
  return null;
}
