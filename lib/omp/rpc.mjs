import {spawn} from 'node:child_process';
import {StringDecoder} from 'node:string_decoder';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ompEnvironment} from './run.mjs';

const MAX_WORKERS = 2;
const IDLE_MS = 30_000;
const MAX_FRAME = 1024 * 1024;
const EMPTY_USAGE = () => ({turns: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cost_usd: 0});
const workers = new Map();
const owned = new Set();
process.once('exit', () => {
  for (const worker of owned) {
    if (worker.child.pid) {
      try { process.kill(-worker.child.pid, 'SIGKILL'); } catch { /* already exited */ }
    }
    try { fs.rmSync(worker.directory, {recursive: true, force: true}); } catch { /* exiting */ }
  }
});
const sessions = new WeakMap();
const jobs = [];
let sequence = 0;
let draining = false;

function terminate(worker, graceMs = 1000) {
  if (worker.dead) return;
  worker.dead = true;
  clearTimeout(worker.idle);
  if (workers.get(worker.key) === worker) workers.delete(worker.key);
  const child = worker.child;
  const signal = name => { try { process.kill(-child.pid, name); } catch { try { child.kill(name); } catch { /* already exited */ } } };
  signal('SIGTERM');
  const killer = setTimeout(() => signal('SIGKILL'), Math.max(0, graceMs));
  killer.unref();
  for (const [, pending] of worker.pending) pending.reject(new Error('omp RPC process exited'));
  worker.pending.clear();
  if (worker.active) worker.active.fail(new Error('omp RPC process exited'));
  drain();
}

function openWorker(job) {
  const {system, model, thinking, bin, env} = job.options;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chatsop-omp-rpc-'));
  const args = ['--mode', 'rpc', '--cwd', directory, '--session-dir', path.join(directory, 'sessions'),
    '--no-tools', '--no-extensions', '--no-skills', '--no-rules', '--no-lsp', '--no-title', '--system-prompt', system];
  if (model) args.push('--model', model);
  if (thinking) args.push('--thinking', thinking);
  const worker = {key: job.key, child: null, directory, pending: new Map(), active: null, buffer: '',
    decoder: new StringDecoder('utf8'), dead: false, idle: null, sessionCount: 0};
  let child;
  try { child = spawn(bin, args, {cwd: directory, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true}); }
  catch (error) { fs.rmSync(directory, {recursive: true, force: true}); throw error; }
  worker.child = child;
  owned.add(worker);
  child.unref();
  child.stdin.unref?.();
  child.stdout.unref?.();
  child.stderr.unref?.();
  child.stdin.on('error', error => { worker.active?.fail(error); terminate(worker); });
  child.stdout.on('data', chunk => {
    worker.buffer += worker.decoder.write(chunk);
    if (worker.buffer.length > MAX_FRAME * 2) return terminate(worker);
    let index;
    while (!worker.dead && (index = worker.buffer.indexOf('\n')) !== -1) {
      const line = worker.buffer.slice(0, index);
      worker.buffer = worker.buffer.slice(index + 1);
      if (Buffer.byteLength(line) > MAX_FRAME) return terminate(worker);
      try { onFrame(worker, JSON.parse(line)); }
      catch (error) {
        worker.active?.fail(new Error(`omp RPC malformed frame: ${error.message}`));
        return terminate(worker);
      }
    }
  });
  child.stderr.on('data', chunk => { worker.stderr = (worker.stderr ?? '') + chunk.toString('utf8'); worker.stderr = worker.stderr.slice(-2000); });
  child.on('error', error => { worker.active?.fail(new Error(`omp could not be started: ${error.message}`)); terminate(worker); });
  child.on('close', code => {
    worker.active?.fail(new Error(`omp exited with code ${code}`));
    terminate(worker, 0);
    owned.delete(worker);
    fs.rmSync(directory, {recursive: true, force: true});
    drain();
  });
  workers.set(worker.key, worker);
  return worker;
}

function onFrame(worker, frame) {
  if (frame.type === 'response') {
    const pending = worker.pending.get(frame.id);
    if (!pending) {
      if (!frame.success || frame.command === 'parse') terminate(worker);
      return;
    }
    if (frame.command !== pending.command) return terminate(worker);
    if (!frame.success) {
      worker.pending.delete(frame.id);
      pending.reject(new Error(frame.error || `omp RPC ${frame.command} failed`));
    } else if (!pending.prompt) {
      worker.pending.delete(frame.id);
      pending.resolve(frame.data ?? {});
    } else {
      pending.ack = true; // A prompt acknowledgement is not completion; later errors share this id.
    }
    return;
  }
  const active = worker.active;
  if (!active || !active.promptId) return;
  if (frame.type === 'tool_execution_start' || frame.type === 'extension_error') {
    active.fail(new Error('omp RPC emitted a forbidden tool or extension event'));
    terminate(worker);
  } else if (frame.type === 'message_end' && frame.message?.role === 'assistant') {
    const message = frame.message;
    active.sawAssistant = true;
    const u = message.usage;
    if (u) {
      active.usage.turns += 1;
      active.usage.input_tokens += u.input ?? 0;
      active.usage.output_tokens += u.output ?? 0;
      active.usage.cache_read_tokens += u.cacheRead ?? 0;
      active.usage.cost_usd += u.cost?.total ?? 0;
    }
    if (message.errorMessage || ['error', 'aborted', 'length'].includes(message.stopReason)) {
      active.fail(new Error(message.errorMessage || `omp assistant turn incomplete (${message.stopReason})`));
      return;
    }
    const text = (message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n').trim();
    if (text) active.text = text;
  } else if (frame.type === 'agent_end') {
    // Allow a correlated async prompt error in the same stdout batch to supersede completion.
    setImmediate(() => {
      if (worker.active !== active || active.done) return;
      const pending = worker.pending.get(active.promptId);
      worker.pending.delete(active.promptId);
      if (!pending?.ack) active.fail(new Error('omp RPC prompt never acknowledged'));
      else if (!active.sawAssistant) active.fail(new Error('omp RPC ended without an assistant message'));
      else {
        pending.resolve({});
        active.finish();
      }
    });
  }
}

function command(worker, type, args = {}, prompt = false) {
  const id = `omp-${++sequence}`;
  return new Promise((resolve, reject) => {
    if (worker.dead) return reject(new Error('omp RPC process exited'));
    worker.pending.set(id, {command: type, resolve, reject, prompt, ack: false});
    if (prompt) worker.active.promptId = id;
    worker.child.stdin.write(JSON.stringify({id, type, ...args}) + '\n', error => {
      if (error && worker.pending.delete(id)) reject(error);
    });
  });
}

async function execute(worker, job) {
  const started = job.started;
  let done = false;
  const result = (ok, reason, timedOut = false) => ({ok, ...(reason ? {reason} : {}), ...(timedOut ? {timed_out: true} : {}),
    duration_ms: Date.now() - started, model: job.options.model, usage: active.usage,
    final_text: ok ? active.text : ''});
  const active = {promptId: null, usage: EMPTY_USAGE(), text: '', sawAssistant: false, done: false, finish: () => settle(true),
    fail: error => settle(false, error.message), timeout: () => settle(false, `omp exceeded the ${Math.round(job.options.timeoutMs / 1000)} s limit`, true)};
  function settle(ok, reason, timedOut = false) {
    if (done) return;
    done = true;
    active.done = true;
    clearTimeout(job.timer);
    if (active.promptId) worker.pending.delete(active.promptId);
    if (worker.active === active) worker.active = null;
    if (!ok && (active.promptId || timedOut)) terminate(worker, job.options.graceMs);
    if (!worker.dead) {
      worker.idle = setTimeout(() => terminate(worker), IDLE_MS);
      worker.idle.unref();
    }
    active.usage.cost_usd = Math.round(active.usage.cost_usd * 1e6) / 1e6;
    job.resolve(result(ok, reason, timedOut));
    drain();
  }
  job.active = active;
  worker.active = active;
  try {
    const prior = sessions.get(job.sessionKey);
    if (job.options.continueSession) {
      if (!prior || prior.worker !== worker || worker.dead) throw new Error('omp RPC repair session is no longer available');
      await command(worker, 'switch_session', {sessionPath: prior.path});
    } else {
      const reset = await command(worker, 'new_session');
      if (reset.cancelled) throw new Error('omp RPC new session was cancelled');
    }
    if (done) return;
    const state = await command(worker, 'get_state');
    if (done) return;
    if (!state.sessionFile) throw new Error('omp RPC did not provide a session path');
    if (Array.isArray(state.dumpTools) && state.dumpTools.length) throw new Error('omp RPC enabled tools despite --no-tools');
    if (job.options.continueSession) {
      if (state.sessionFile !== prior.path) throw new Error('omp RPC switched to a different session');
    } else {
      if (state.messageCount !== 0 || state.queuedMessageCount !== 0 || state.isStreaming) {
        throw new Error('omp RPC new session was not empty');
      }
      worker.sessionCount++;
      sessions.set(job.sessionKey, {worker, path: state.sessionFile});
    }
    await command(worker, 'prompt', {message: job.options.prompt}, true);
  } catch (error) { settle(false, error.message); }
}

function drain() {
  if (draining) return;
  draining = true;
  try {
    for (let i = 0; i < jobs.length;) {
      const job = jobs[i];
      let worker = workers.get(job.key);
      if (worker?.active) { i++; continue; }
      if (worker && !job.options.continueSession && worker.sessionCount >= 64) {
        terminate(worker);
        worker = undefined;
      }
      if (!worker) {
        if (workers.size >= MAX_WORKERS || owned.size >= MAX_WORKERS) {
          const idle = [...workers.values()].find(w => !w.active);
          if (idle) terminate(idle);
          if (owned.size >= MAX_WORKERS) { i++; continue; }
        }
        try { worker = openWorker(job); }
        catch (error) {
          jobs.splice(i, 1);
          clearTimeout(job.timer);
          job.resolve({ok: false, reason: `omp could not be started: ${error.message}`, duration_ms: Date.now() - job.started,
            model: job.options.model, usage: EMPTY_USAGE(), final_text: ''});
          continue;
        }
      }
      jobs.splice(i, 1);
      clearTimeout(worker.idle);
      execute(worker, job);
    }
  } finally { draining = false; }
}

/** A request starts a new isolated session; only continueSession with the same object resumes it. */
export function runOmpRpc({folder, system, prompt, model = null, thinking = null, continueSession = false,
  sessionKey, timeoutMs = 600_000, bin = 'omp', env = process.env, graceMs = 1000}) {
  const key = sessionKey ?? {};
  const options = {folder, system, prompt, model, thinking, continueSession, timeoutMs,
    bin, env: ompEnvironment(env), graceMs};
  const poolKey = JSON.stringify([system, model, thinking, bin, options.env]);
  return new Promise(resolve => {
    const job = {key: poolKey, options, sessionKey: key, resolve, started: Date.now()};
    job.timer = setTimeout(() => {
      if (jobs.includes(job)) {
        jobs.splice(jobs.indexOf(job), 1);
        resolve({ok: false, timed_out: true, reason: `omp exceeded the ${Math.round(timeoutMs / 1000)} s limit`,
          duration_ms: Date.now() - job.started, model, usage: EMPTY_USAGE(), final_text: ''});
      } else job.active?.timeout();
    }, timeoutMs);
    jobs.push(job);
    drain();
  });
}

/** Release all workers and reject queued work (suitable for application shutdown and tests). */
export function closeOmpRpc() {
  for (const job of jobs.splice(0)) {
    clearTimeout(job.timer);
    job.resolve({ok: false, reason: 'omp RPC closed', duration_ms: Date.now() - job.started,
      model: job.options.model, usage: EMPTY_USAGE(), final_text: ''});
  }
  for (const worker of [...workers.values()]) terminate(worker, 0);
}
