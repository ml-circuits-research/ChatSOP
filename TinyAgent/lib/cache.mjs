// Response cache, opt-in per request with the header `x-tinyagent-cache`:
//   use     a hit is served from the cache (no model call, no cost); a miss calls the model and stores the answer
//   strict  a hit is served; a miss is refused (409 cache_miss) without calling any model: for regressions that must not call models
//   record  always calls the model and stores the answer (refreshes the entry)
// The key is the whole request body (model or tier, messages, sampling settings; `stream` excluded) plus the target (the tier, or the
// upstream) and the identity of the model behind it (the first entry of a tier's chain; for a local model its GGUF file size and
// modification time). Changing a prompt, a setting or the model changes the key, so nothing is ever invalidated by hand.
// Only complete, non-streamed 200 answers are stored. Entries live under <dir>/<2 hex>/<sha256>.json.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const CACHE_MODES = Object.freeze(['use', 'strict', 'record']);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  return value;
}

export function createCache({ dir }) {
  mkdirSync(dir, { recursive: true });
  const counts = { hits: 0, misses: 0, stored: 0, refused: 0 };
  const fileOf = (key) => join(dir, key.slice(0, 2), key + '.json');
  return {
    key({ path, target, identity, body }) {
      const { stream, stream_options, ...rest } = body || {};
      return createHash('sha256').update(JSON.stringify(canonical({ path, target, identity, body: rest }))).digest('hex');
    },
    get(key) {
      const f = fileOf(key);
      if (!existsSync(f)) { counts.misses += 1; return null; }
      try { const e = JSON.parse(readFileSync(f, 'utf8')); counts.hits += 1; return e; } catch { counts.misses += 1; return null; }
    },
    put(key, entry) {
      const f = fileOf(key);
      mkdirSync(join(dir, key.slice(0, 2)), { recursive: true });
      const tmp = f + '.' + process.pid + '.tmp';
      writeFileSync(tmp, JSON.stringify({ ...entry, stored_at: new Date().toISOString() }));
      renameSync(tmp, f);
      counts.stored += 1;
    },
    refused() { counts.refused += 1; },
    stats: () => ({ dir, ...counts }),
  };
}

// The identity of what serves a target: a local upstream started from a GGUF is identified by the file's size and mtime.
export function localIdentity(file) {
  try { const s = statSync(file); return `${s.size}:${Math.round(s.mtimeMs)}`; } catch { return null; }
}
