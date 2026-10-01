/** Headless Claude Haiku client for the LLM diversification pipeline (DS022 "LLM diversification").
 *
 * Calls go through Claude Code headless exactly like tools/research/haiku-baseline.mjs: `claude -p` with the
 * pinned model, `MAX_THINKING_TOKENS=0`, no tools, empty settings, no MCP, no session persistence, and a scratch
 * working directory, so the model sees only the system prompt and the one user turn. Every response is cached by
 * the sha256 of (model, system prompt, user turn, sample index), so a rerun is free and reproducible; every call
 * that reaches the network is logged with latency, tokens and cost. A shared pool bounds concurrency, and rate
 * limits pause every worker with exponential backoff.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';

export const MODEL = 'claude-haiku-4-5-20251001';
export const sha256 = text => createHash('sha256').update(text).digest('hex');

/** A client bound to one cache directory and one call log. */
export function createClient({cacheDir, logFile, concurrency = 8, timeoutMs = 180000, model = MODEL}) {
  fs.mkdirSync(cacheDir, {recursive: true});
  fs.mkdirSync(path.dirname(logFile), {recursive: true});
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-diversify-'));
  let active = 0, pauseUntil = 0;
  const queue = [];
  const stats = {calls: 0, cached: 0, failed: 0, cost_usd: 0, ms: []};

  const acquire = () => new Promise(resolve => { if (active < concurrency) { active++; resolve(); } else queue.push(resolve); });
  const release = () => { const next = queue.shift(); if (next) next(); else active--; };

  function spawnClaude(system, user) {
    return new Promise(resolve => {
      const args = ['-p', '--model', model, '--output-format', 'json', '--tools', '', '--system-prompt', system,
        '--no-session-persistence', '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands'];
      const child = spawn('claude', args, {cwd: scratch, env: {...process.env, MAX_THINKING_TOKENS: '0'}, stdio: ['pipe', 'pipe', 'pipe']});
      child.stdin.end(user);
      let out = '', err = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
      child.stdout.on('data', chunk => { out += chunk; });
      child.stderr.on('data', chunk => { err += chunk; });
      child.on('close', code => { clearTimeout(timer); resolve({code, out, err}); });
    });
  }

  /** One completion. `purpose` labels the log line; `sample` distinguishes deliberate repeats of one prompt. */
  async function complete({system, user, purpose, sample = 0}) {
    const key = sha256(JSON.stringify([model, system, user, sample]));
    const file = path.join(cacheDir, `${key}.json`);
    if (fs.existsSync(file)) { stats.cached++; return {...JSON.parse(fs.readFileSync(file, 'utf8')), cached: true}; }
    await acquire();
    try {
      for (let attempt = 0; attempt < 7; attempt++) {
        while (Date.now() < pauseUntil) await new Promise(r => setTimeout(r, 1000));
        const started = Date.now();
        const {code, out, err} = await spawnClaude(system, user);
        let data = null;
        try { data = JSON.parse(out); } catch {}
        const ms = Date.now() - started;
        if (code === 0 && data && !data.is_error && typeof data.result === 'string') {
          const record = {key, ok: true, model, purpose, date: new Date().toISOString(), system_sha256: sha256(system), user_sha256: sha256(user), text: data.result, ms,
            usage: data.usage ? {input_tokens: data.usage.input_tokens, cache_read_input_tokens: data.usage.cache_read_input_tokens ?? 0, output_tokens: data.usage.output_tokens} : null,
            cost_usd: data.total_cost_usd ?? 0};
          fs.writeFileSync(file, JSON.stringify(record) + '\n');
          fs.appendFileSync(logFile, JSON.stringify({ts: record.date, purpose, key, ms, cost_usd: record.cost_usd, usage: record.usage, attempt}) + '\n');
          stats.calls++; stats.cost_usd += record.cost_usd; stats.ms.push(ms);
          return {...record, cached: false};
        }
        const text = `${out}\n${err}`;
        const limited = /rate.?limit|429|overloaded|529|usage limit|too many/i.test(text);
        const wait = Math.min(300000, (limited ? 30000 : 4000) * 2 ** attempt);
        if (limited) pauseUntil = Math.max(pauseUntil, Date.now() + wait);
        fs.appendFileSync(logFile, JSON.stringify({ts: new Date().toISOString(), purpose, key, ms, error: limited ? 'rate_limit' : `exit ${code}`, detail: text.slice(0, 200), attempt, wait_ms: wait}) + '\n');
        await new Promise(r => setTimeout(r, wait));
      }
      stats.failed++;
      return {key, ok: false, text: '', error: 'exhausted retries'};
    } finally { release(); }
  }

  const close = () => fs.rmSync(scratch, {recursive: true, force: true});
  return {complete, stats, close, model};
}

/** The first JSON value in a model answer (tolerates a Markdown fence or a sentence around it). */
export function parseJsonAnswer(text) {
  let body = String(text ?? '').trim();
  const fenced = body.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) body = fenced[1].trim();
  for (const [open, close] of [['[', ']'], ['{', '}']]) {
    const start = body.indexOf(open), end = body.lastIndexOf(close);
    if (start >= 0 && end > start) { try { return JSON.parse(body.slice(start, end + 1)); } catch {} }
  }
  return null;
}
