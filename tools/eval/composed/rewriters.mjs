/** Text-to-text rewriters the composed scorer can call: an OpenAI-compatible chat endpoint (message-only prompt, as in training),
 * a shell command (text on stdin, rewritten text on stdout) or the identity (no rewrite, the baseline row).
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

/** Message-only chat completion, greedy; `maxTokens` scales with the input length. */
export function endpointRewriter(url, {model = 'proofreader', maxNew = 4096} = {}) {
  const base = url.replace(/\/$/, '');
  return async text => {
    const res = await fetch(`${base}/v1/chat/completions`, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({model, messages: [{role: 'user', content: text}], temperature: 0, top_k: 1, seed: 0, max_tokens: Math.min(maxNew, Math.max(96, Math.ceil(text.length / 2) + 96))})});
    if (!res.ok) throw Error(`rewriter endpoint ${res.status}`);
    const data = await res.json();
    return String(data.choices?.[0]?.message?.content ?? '').trim();
  };
}

export function commandRewriter(command) {
  return text => new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', command], {stdio: ['pipe', 'pipe', 'inherit']});
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve(out.trim()) : reject(Error(`rewriter command exited ${code}`))));
    child.stdin.end(text);
  });
}

export const identityRewriter = Object.assign(async text => text, {identity: true});

/** `--endpoint URL`, `--command CMD` or `identity`. */
export function rewriterFromArgs(o) {
  if (o.endpoint) return {name: o.name ?? o.endpoint, fn: endpointRewriter(o.endpoint, {model: o.model ?? 'proofreader'})};
  if (o.command) return {name: o.name ?? o.command, fn: commandRewriter(o.command)};
  return {name: 'identity (no rewrite)', fn: identityRewriter};
}

/** A rewriter whose answers are kept in a JSONL file (one line per input text), so a re-score under new rules never calls the model again. */
export function cachedRewriter(fn, file) {
  const cache = new Map();
  if (fs.existsSync(file)) for (const line of fs.readFileSync(file, 'utf8').split('\n')) if (line.trim()) { const r = JSON.parse(line); cache.set(r.in, r.out); }
  fs.mkdirSync(path.dirname(file), {recursive: true});
  return async text => {
    if (cache.has(text)) return cache.get(text);
    const out = await fn(text);
    cache.set(text, out);
    fs.appendFileSync(file, JSON.stringify({in: text, out}) + '\n');
    return out;
  };
}
