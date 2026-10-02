/**
 * A custom omp provider without touching the owner's global omp configuration (owner decision 2026-10-02: the openference
 * `Qwen3.8 27b`, through the local proxy LLMAPIProvider, is the first model of the CodingAgent chain).
 *
 * omp reads providers from `<agent dir>/models.yml` and takes the agent dir from `PI_CODING_AGENT_DIR` (the `--config` overlay carries
 * settings only, not providers). `ensureAgentDir` builds an overlay directory (default `~/.cache/chatsop/omp-agent`, outside the
 * repository): every entry of the real agent dir (credentials, sessions, caches) is a symlink, and `models.yml` is the real file with
 * the extra provider added. The proxy listens on 127.0.0.1 and holds the upstream key, so the provider's key is a placeholder.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PROXY_PROVIDER = 'llmapiprovider';

/** The YAML block of one OpenAI-compatible provider with its models, indented as a child of `providers:`. */
export function providerYaml(name, {baseUrl, models}) {
  const lines = [`  ${name}:`, `    baseUrl: ${JSON.stringify(baseUrl)}`, '    api: openai-completions', '    apiKey: "local"', '    authHeader: true', '    models:'];
  for (const m of models) lines.push(`      - id: ${JSON.stringify(m.id)}`, `        name: ${JSON.stringify(m.name ?? m.id)}`, `        contextWindow: ${m.contextWindow ?? 131072}`, `        maxTokens: ${m.maxTokens ?? 8000}`);
  return lines.join('\n') + '\n';
}

/** models.yml text with the provider block added under `providers:` (the block is replaced when it is already there). */
export function mergeModelsYaml(original, name, block) {
  const text = String(original ?? '');
  const lines = text.split('\n');
  const own = lines.findIndex(l => l.startsWith(`  ${name}:`));
  if (own >= 0) { let end = own + 1; while (end < lines.length && (/^\s{3,}/.test(lines[end]) || !lines[end].trim())) end++; lines.splice(own, end - own); }
  const head = lines.findIndex(l => /^providers:\s*$/.test(l));
  if (head < 0) return `providers:\n${block}${lines.join('\n') ? '\n' + lines.join('\n') : ''}`;
  lines.splice(head + 1, 0, ...block.replace(/\n$/, '').split('\n'));
  return lines.join('\n');
}

/** Creates or refreshes the overlay directory and returns its path. */
export function ensureAgentDir({name = PROXY_PROVIDER, provider, home = os.homedir(), target = path.join(home, '.cache/chatsop/omp-agent')} = {}) {
  const real = path.join(home, '.omp/agent');
  fs.mkdirSync(target, {recursive: true, mode: 0o700});
  if (fs.existsSync(real)) {
    for (const entry of fs.readdirSync(real)) {
      if (entry === 'models.yml') continue;
      const link = path.join(target, entry);
      try { fs.lstatSync(link); } catch { fs.symlinkSync(path.join(real, entry), link); }
    }
  }
  const original = fs.existsSync(path.join(real, 'models.yml')) ? fs.readFileSync(path.join(real, 'models.yml'), 'utf8') : '';
  const merged = mergeModelsYaml(original, name, providerYaml(name, provider));
  const file = path.join(target, 'models.yml');
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== merged) fs.writeFileSync(file, merged, {mode: 0o600});
  return target;
}
