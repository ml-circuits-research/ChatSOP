// Configuration and secrets. The key is read only from an env file outside the repo or from the environment.
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

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

export function loadConfig(path = join(HERE, 'config.json')) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Resolves secrets per upstream: process env wins over the env file.
export function resolveUpstream(name, up, env = process.env) {
  const file = parseEnvFile(expandHome(up.envFile));
  const get = (k) => (k ? (env[k] ?? file[k]) : undefined);
  return {
    ...up,
    name,
    baseUrl: String(get(up.baseUrlVar) || up.baseUrl).replace(/\/+$/, ''),
    key: get(up.keyVar) || null,
  };
}

export function resolveProxyToken(config, env = process.env) {
  if (env.LLMAPIPROVIDER_TOKEN) return env.LLMAPIPROVIDER_TOKEN;
  for (const up of Object.values(config.upstreams)) {
    const t = parseEnvFile(expandHome(up.envFile)).LLMAPIPROVIDER_TOKEN;
    if (t) return t;
  }
  return null;
}
