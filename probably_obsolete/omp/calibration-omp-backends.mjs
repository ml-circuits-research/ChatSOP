/**
 * Archived (owner order 2026-10-02: no omp on any path): the omp backends of the query-model calibration, `timedOmpBackend` (the agentic
 * omp backend with per-round model time) and `ompOneShotBackend` (omp as a plain chat transport). History only; they imported
 * `ompBackend` from lib/query-author and `readSessionUsage` from lib/omp/run.mjs, both archived.
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {extractSop, ompBackend} from '../../lib/query-author/index.mjs';
import {readSessionUsage} from './lib-omp/run.mjs';

/** The model time (sum of the assistant turns' own durations) and the span of an omp session folder. */
export function ompSessionTiming(sessionDir) {
  let model_ms = 0, turns = 0, ttft_ms = 0;
  if (!fs.existsSync(sessionDir)) return {model_ms, turns, ttft_ms};
  for (const name of fs.readdirSync(sessionDir).filter(n => n.endsWith('.jsonl'))) {
    for (const line of fs.readFileSync(path.join(sessionDir, name), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let event; try { event = JSON.parse(line); } catch { continue; }
      const m = event.message;
      if (event.type === 'message' && m?.role === 'assistant' && typeof m.duration === 'number') { model_ms += m.duration; turns += 1; ttft_ms += m.ttft ?? 0; }
    }
  }
  return {model_ms: Math.round(model_ms), turns, ttft_ms: Math.round(ttft_ms)};
}

/** The omp backend with the per-round model time kept next to the wall clock (start-up = wall - model time). */
export function timedOmpBackend(settings) {
  const inner = ompBackend(settings);
  let before = 0;
  return {...inner, async generate(args) {
    const dir = path.join(args.folder, '.omp-session');
    if (args.history.length === 0) before = 0;
    const out = await inner.generate(args);
    const t = ompSessionTiming(dir);
    out.timing = {wall_ms: out.duration_ms, model_ms: t.model_ms - before, startup_ms: out.duration_ms - (t.model_ms - before), model_turns: t.turns};
    before = t.model_ms;
    return out;
  }};
}

/** omp without tools and with a single message: system + request (+ the earlier answers and validator output on a repair round). */
export function ompOneShotBackend({model, bin = 'omp', timeoutMs = 120_000, env = process.env}) {
  return {
    id: 'omp-oneshot', model,
    async generate({context, history, folder}) {
      const started = Date.now();
      const dir = path.join(folder, `oneshot-${history.length}`);
      fs.mkdirSync(dir, {recursive: true});
      let prompt = `${context.system}\n\n---\n\n${context.user}`;
      for (const turn of history) prompt += `\n\n---\n\nYour previous answer:\n${turn.sop}\n\n${context.repair(turn.problems)}`;
      const args = ['-p', '--cwd', dir, '--session-dir', path.join(dir, '.omp-session'), '--mode', 'json', '--no-extensions', '--no-skills', '--no-rules', '--no-lsp', '--no-title', '--no-tools', '--model', model, prompt];
      const child = spawn(bin, args, {env, stdio: ['ignore', 'ignore', 'ignore']});
      const code = await new Promise(resolve => { const t = setTimeout(() => child.kill('SIGKILL'), timeoutMs); child.on('close', c => { clearTimeout(t); resolve(c); }); child.on('error', () => resolve(-1)); });
      const usage = readSessionUsage(path.join(dir, '.omp-session'));
      const t = ompSessionTiming(path.join(dir, '.omp-session'));
      const sop = extractSop(usage.final_text);
      const wall = Date.now() - started;
      return {ok: code === 0 && Boolean(usage.final_text), sop, raw: usage.final_text, usage: {...usage, final_text: undefined}, duration_ms: wall, timing: {wall_ms: wall, model_ms: t.model_ms, startup_ms: wall - t.model_ms, model_turns: t.turns},
        ...(code !== 0 ? {reason: `omp exited with ${code}`} : sop ? {} : {reason: 'the reply holds no wire'})};
    },
  };
}

