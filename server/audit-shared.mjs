/** Small helpers shared by the visual corpus audit router (`server/audit.mjs`) and its per-type row modules
 * (`server/audit-proofreading.mjs`, `server/audit-cleantext.mjs`), so none of them import from another — only
 * from here — and the three stay free of a circular dependency.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readJsonlShardedSync} from '../lib/jsonl-shards.mjs';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
// Corpus splits may be stored as shards (lib/jsonl-shards.mjs); the logical base path reads either form.
export const readJsonl = file => readJsonlShardedSync(file);
export const label = value => (value === undefined || value === null || value === '' ? 'none' : typeof value === 'object' ? JSON.stringify(value) : String(value));

export const tally = values => {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
};

/** Reads a file once and re-reads it only when its size or mtime changes. */
export function cachedFile(parse) {
  const cache = new Map();
  return file => {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      cache.delete(file);
      return null;
    }
    const stamp = `${stat.size}:${stat.mtimeMs}`;
    const hit = cache.get(file);
    if (hit?.stamp === stamp) return hit.value;
    const value = parse(fs.readFileSync(file, 'utf8'));
    cache.set(file, {stamp, value});
    return value;
  };
}

/**
 * The value(s) of one case's facet, for both filtering and tallying, for any corpus type: `split` and `language`
 * read the case's `splits`/`languages` arrays, `verdict` needs the current ledger's lookup, and any other key
 * reads the case's own field of the same name, taken as multi-valued when it already is an array (for example a
 * cleanText case's `category`, which can hold several tags) and wrapped in a one-element array otherwise.
 */
export const facetValues = (item, key, verdictOf) => {
  if (key === 'split') return item.splits;
  if (key === 'language') return item.languages;
  if (key === 'verdict') return [verdictOf(item.id)];
  const value = item[key];
  return Array.isArray(value) ? value : [value];
};

/** JSON-safe copy of a runtime or SymbolicLM trace (BigInt as string, cycles cut). */
export function plain(value) {
  const seen = new WeakSet();
  return JSON.parse(JSON.stringify(value ?? null, (key, item) => {
    if (typeof item === 'bigint') return item.toString();
    if (item instanceof Map) return Object.fromEntries(item);
    if (item instanceof Set) return [...item];
    if (item && typeof item === 'object') {
      if (seen.has(item)) return '[circular]';
      seen.add(item);
    }
    return item;
  }));
}

/**
 * On-demand SymbolicLM checks for the proofreading and cleanText audit views (DS020 "Type-specific case views").
 * The checker starts one CPU Stanza worker on first use (never at server start), serialises requests through one
 * queue, and reports an unavailable worker as `{ok: false, error}` instead of throwing, so the page can say so.
 * Tests inject `create` (an async function returning an object with `analyze(message)` and optional `stop()`).
 */
export function symbolicChecker({create = null} = {}) {
  let starting = null;
  let queue = Promise.resolve();
  const start = () => (starting ??= (async () => {
    const {SymbolicLM, createSymbolicLM} = await import('../lib/symbolic-lm/index.mjs');
    if (!create) {
      const missing = SymbolicLM.missing();
      if (missing) throw new Error(missing);
    }
    return create ? create() : createSymbolicLM({});
  })().catch(error => { starting = null; throw error; }));
  const analyze = async (message, options = {route: 'auto'}) => {
    const started = performance.now();
    try {
      const lm = await start();
      const result = await lm.analyze(String(message ?? ''), options);
      const sop = String(result.sop ?? '');
      return {
        ok: true,
        sop,
        valid: Boolean(result.valid),
        outcome: result.outcome ?? null,
        route: result.route ?? null,
        language: result.language ?? null,
        english: result.english ?? null,
        uncertain: Boolean(result.uncertain),
        reasons: (result.reasons ?? []).map(reason => (typeof reason === 'string' ? reason : reason?.kind ?? reason?.reason ?? JSON.stringify(reason))),
        unparsed: (sop.match(/^\s*(?:@\S+\s+)?unparsed\b/gm) ?? []).length,
        // The result in the stored dataset shape (sop, sop_valid, outcome, unparsed spans, grammatical analysis), for regression checks.
        current: {sop, sop_valid: Boolean(result.valid), outcome: result.outcome ?? null, unparsed: (result.trace?.unparsed ?? []).map(entry => entry.span), analysis: result.analysis ?? null},
        ms: Math.round(performance.now() - started),
      };
    } catch (error) {
      return {ok: false, error: String(error?.message ?? error)};
    }
  };
  return {
    check: (message, options) => { const run = queue.then(() => analyze(message, options)); queue = run.catch(() => null); return run; },
    async stop() { try { const lm = starting ? await starting : null; await lm?.stop?.(); } catch { /* not started */ } starting = null; },
  };
}

/** Whether two SymbolicLM results agree, and whether `after` is a usable improvement over `before`. */
export function compareChecks(before, after) {
  if (!before?.ok || !after?.ok) return {same_sop: null, improved: null};
  const usable = check => check.valid && check.unparsed === 0;
  return {same_sop: before.sop.trim() === after.sop.trim(), improved: !usable(before) && usable(after)};
}

/** Cases are limited to a few rows per on-demand check, so one click never queues dozens of Stanza parses. */
export const CHECK_ROW_LIMIT = 6;
