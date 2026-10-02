/**
 * Runs omp non-interactively on one folder (DS022 "omp integration", skills/omp-run/SKILL.md).
 *
 *   omp -p --model M --cwd FOLDER --session-dir FOLDER/.omp-session --mode json --no-extensions --no-skills --no-rules --no-lsp
 *       --tools read,write,edit --approval-mode yolo --max-time S [-c] [@file ...] PROMPT
 *
 * The fence: the agent starts in the folder, has only the read, write and edit tools (no shell, so it cannot reach the network or
 * other folders through a command), loads no extensions, skills or rules from the user's profile, and is told by TASK.md to work
 * only inside the folder. Files go in by `@name` (relative to the folder). The prompt is a fixed short instruction; no secret is
 * ever put in a prompt, and the environment passed on never carries the server's own credentials. The run has a wall-clock limit
 * (omp's own `--max-time` plus a hard kill). Output and cost are read from what omp wrote: the JSON event stream and the session
 * file (`message.usage.cost`, omp's nominal list-price cost; for a subscription model it is not an invoice).
 */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Environment variables of the server that never reach omp. */
export const SECRET_ENV = Object.freeze(['CHATSOP_API_KEY', 'RECALL_LLM_KEY', 'CHATSOP_ADMIN_PASSWORD']);

export function ompEnvironment(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !SECRET_ENV.includes(key)));
}

/** The argument vector of one run; exported so the fence is testable. */
export function ompArguments({folder, prompt, files = [], model = null, thinking = null, continueSession = false, timeoutMs = 600_000}) {
  const args = ['-p', '--cwd', folder, '--session-dir', path.join(folder, '.omp-session'), '--mode', 'json',
    '--no-extensions', '--no-skills', '--no-rules', '--no-lsp', '--no-title',
    '--tools', 'read,write,edit', '--approval-mode', 'yolo', '--max-time', String(Math.max(30, Math.floor(timeoutMs / 1000)))];
  if (model) args.push('--model', model);
  if (thinking) args.push('--thinking', thinking);
  if (continueSession) args.push('-c');
  for (const file of files) {
    if (path.isAbsolute(file) || file.split(path.sep).includes('..')) throw new Error(`Attached file ${JSON.stringify(file)} must be a path inside the folder`);
    args.push('@' + file);
  }
  args.push(prompt);
  return args;
}

/** Cost, tokens and the last assistant text from the session files omp wrote under `sessionDir`. */
export function readSessionUsage(sessionDir) {
  const usage = {turns: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cost_usd: 0};
  let finalText = '';
  if (!fs.existsSync(sessionDir)) return {...usage, final_text: finalText};
  for (const name of fs.readdirSync(sessionDir).filter(n => n.endsWith('.jsonl')).sort()) {
    for (const line of fs.readFileSync(path.join(sessionDir, name), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      const message = event.message;
      if (event.type !== 'message' || message?.role !== 'assistant') continue;
      if (message.usage) {
        usage.turns += 1;
        usage.input_tokens += message.usage.input ?? 0;
        usage.output_tokens += message.usage.output ?? 0;
        usage.cache_read_tokens += message.usage.cacheRead ?? 0;
        usage.cost_usd += message.usage.cost?.total ?? 0;
      }
      const text = (Array.isArray(message.content) ? message.content : []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
      if (text) finalText = text;
    }
  }
  usage.cost_usd = Math.round(usage.cost_usd * 1e6) / 1e6;
  return {...usage, final_text: finalText};
}

/**
 * Runs omp once. Returns {ok, exit_code, timed_out, duration_ms, model, usage, final_text, output_file, stderr}. It never throws for a
 * failed run: a missing binary or a timeout is a result with `ok: false` and a `reason`.
 */
export function runOmp({folder, prompt, files = [], model = null, thinking = null, continueSession = false, timeoutMs = 600_000, graceMs = 15_000, bin = 'omp', env = process.env, spawnProcess = spawn}) {
  const started = Date.now();
  // A continued run appends to the same session files, so the cost of this run is the usage after it minus the usage before it.
  const before = readSessionUsage(path.join(folder, '.omp-session'));
  const outputFile = path.join(folder, `omp-output-${Date.now().toString(36)}.jsonl`);
  const args = ompArguments({folder, prompt, files, model, thinking, continueSession, timeoutMs});
  return new Promise(resolve => {
    const out = fs.createWriteStream(outputFile);
    let stderr = '';
    let timedOut = false;
    let child;
    const finish = (extra) => {
      out.end(() => {
        const after = readSessionUsage(path.join(folder, '.omp-session'));
        const {final_text: finalText, ...totals} = after;
        const counts = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, k === 'cost_usd' ? Math.round((v - before[k]) * 1e6) / 1e6 : v - before[k]]));
        resolve({duration_ms: Date.now() - started, model, usage: counts, final_text: finalText, output_file: path.basename(outputFile), stderr: stderr.slice(-2000), ...extra});
      });
    };
    try { child = spawnProcess(bin, args, {cwd: folder, env: ompEnvironment(env), stdio: ['ignore', 'pipe', 'pipe'], detached: true}); } catch (error) {
      return finish({ok: false, exit_code: null, timed_out: false, reason: `omp could not be started: ${error.message}`});
    }
    child.stdout.on('data', d => out.write(d));
    child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
      setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }, 5000).unref();
    }, timeoutMs + graceMs);
    child.on('error', error => { clearTimeout(timer); finish({ok: false, exit_code: null, timed_out: false, reason: `omp could not be started: ${error.message}`}); });
    child.on('close', code => {
      clearTimeout(timer);
      finish({ok: code === 0 && !timedOut, exit_code: code, timed_out: timedOut, ...(timedOut ? {reason: `omp exceeded the ${Math.round(timeoutMs / 1000)} s limit`} : code !== 0 ? {reason: `omp exited with code ${code}`} : {})});
    });
  });
}
