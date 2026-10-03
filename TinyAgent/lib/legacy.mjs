// TEMPORARY migration layer (2026-10-03; delete in phase 2 of the TinyAgent migration, see TODO.md): the proxy of earlier versions
// used headers named `x-llmapiprovider-*`, data in ~/.local/share/llmapiprovider* and keys in ~/.config/llmapiprovider. Until every
// caller is migrated and the server on the default port is TinyAgent, requests may carry the old header names (accepted on input), and
// clients also send them (an older server understands only those). This file is the only place the old names appear.
const OLD = 'x-llmapiprovider-', NEW = 'x-tinyagent-';

/** Copies old-named request headers to their new names (node:http header object, lower case), when the new one is absent. */
export function acceptOldHeaders(headers) {
  for (const [k, v] of Object.entries(headers)) if (k.startsWith(OLD) && headers[NEW + k.slice(OLD.length)] === undefined) headers[NEW + k.slice(OLD.length)] = v;
  return headers;
}

/** Adds the old names of every x-tinyagent-* header (requests to a server that may still be the old proxy; responses when compat is on). */
export function withOldHeaders(headers) {
  const out = { ...headers };
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase().startsWith(NEW)) out[OLD + k.slice(NEW.length)] = v;
  return out;
}

/** A response header by its new name, else its old name. */
export const headerOf = (h, name) => h.get(name) ?? (name.startsWith(NEW) ? h.get(OLD + name.slice(NEW.length)) : null);

/** Old key folder (migration fallback) and old data folders (the `migrate-home` command copies them). */
export const OLD_KEYS_DIR = '~/.config/llmapiprovider';
export const OLD_DATA = Object.freeze({ data: '~/.local/share/llmapiprovider', cache: '~/.local/share/llmapiprovider-cache', audit: '~/.local/share/llmapiprovider-audit' });
export const OLD_ENV = Object.freeze({ url: 'LLMAPIPROVIDER_URL', token: 'LLMAPIPROVIDER_TOKEN', data: 'LLMAPIPROVIDER_DATA' });
/** The job runner's configuration file of earlier versions (read only when no TinyAgent configuration layer has a runner section). */
export const OLD_RUNNER_CONFIG = 'llmjobs.config.json';
