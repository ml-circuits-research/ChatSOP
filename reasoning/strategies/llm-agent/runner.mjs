/**
 * Minimal local omp runner of the llm-agent strategy. NOTE: product-agent is building `lib/omp/` (run omp in a temp folder, list models)
 * and the skill `skills/omp-run/`; when they exist, switch `runOmp` to them and delete this file.
 *
 * One call = one `omp -p --model M --no-session --mode json --no-tools --system-prompt ...` process started in a fresh temporary folder
 * (the working directory is that folder and no tools are enabled, so the model can neither read nor write anything of the repository).
 * `--mode json` prints the events of the session, including the usage and cost of every assistant message: the cost is read from
 * `usage.cost.total` (a subscription model reports a notional cost that is not paid).
 */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Models served by a subscription (not paid per token). Everything else counts toward the paid-cost budget. */
export const SUBSCRIPTION_PREFIXES = ['xai-oauth/', 'zai/', 'zai-coding-plan/'];
export const isSubscription = model => SUBSCRIPTION_PREFIXES.some(p => model.startsWith(p));

/** Pull the final assistant text, the usage and any error out of the JSON event lines printed by `omp --mode json`. */
export function parseEvents(stdout) {
  let text = null, usage = null, error = null, stop = null;
  for (const line of stdout.split('\n')) {
    if (!line.startsWith('{')) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type === 'message_end' && e.message?.role === 'assistant') {
      const t = (e.message.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('');
      text = t;
      usage = e.message.usage ?? usage;
      stop = e.message.stopReason ?? stop;
      if (e.message.errorMessage) error = e.message.errorMessage;
    }
  }
  return {text, usage, error, stop};
}

/**
 * Run omp once. Returns {ok, text, cost, usage, ms, timedOut, error}. Never throws for provider failures; a spawn failure is `ok: false`.
 */
export function runOmp({model, prompt, system, timeoutMs = 120000, thinking = null, bin = 'omp'}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-agent-'));
  const args = ['-p', '--model', model, '--no-session', '--mode', 'json', '--no-tools', '--no-skills', '--no-rules', '--no-extensions', '--no-title', '--no-lsp'];
  if (system) args.push('--system-prompt', system);
  if (thinking) args.push('--thinking', thinking);
  args.push(prompt);
  const t0 = Date.now();
  return new Promise(resolve => {
    let out = '', err = '', timedOut = false, done = false;
    const finish = r => { if (done) return; done = true; clearTimeout(timer); fs.rmSync(dir, {recursive: true, force: true}); resolve({ms: Date.now() - t0, ...r}); };
    let child;
    try { child = spawn(bin, args, {cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, NO_COLOR: '1'}}); }
    catch (e) { finish({ok: false, error: 'spawn: ' + e.message}); return; }
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => finish({ok: false, error: 'spawn: ' + e.message}));
    child.on('close', code => {
      if (timedOut) return finish({ok: false, timedOut: true, error: 'wall timeout'});
      const ev = parseEvents(out);
      const cost = ev.usage?.cost?.total ?? 0;
      if (ev.text === null || ev.stop === 'error' || ev.error) return finish({ok: false, error: ev.error ?? (err.trim().split('\n').pop() || `omp exited ${code} without an answer`), cost, usage: ev.usage});
      finish({ok: true, text: ev.text, cost, usage: ev.usage});
    });
  });
}
