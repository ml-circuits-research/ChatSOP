/**
 * Device selection of the Stanza parse worker (DS021 "Parse device"): `--device auto` picks `cuda` only when the GPU is
 * free and takes the single GPU-parse-worker lock; otherwise the CPU. The lock file `models/.parse-gpu.lock` holds the
 * pid of the owner; a lock whose process is gone is stale and taken over. Nothing here ever stops another process.
 *
 * `auto` picks cuda when `nvidia-smi` lists a GPU, `models/.training.lock` is absent, no `/opt/trainer/bin/python`
 * process runs and the parse lock is free (or stale). Explicit `cuda` skips the training checks (an operator's choice)
 * but still honours the one-worker lock, falling back to the CPU when another process holds it. `cpu` is never changed.
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const PARSE_LOCK = path.join(ROOT, 'models/.parse-gpu.lock');
export const TRAINING_LOCK = path.join(ROOT, 'models/.training.lock');
export const TRAINER_PYTHON = '/opt/trainer/bin/python';

const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

/** True when `nvidia-smi -L` lists a GPU. */
export function gpuPresent() {
  const r = spawnSync('nvidia-smi', ['-L'], {encoding: 'utf8', timeout: 5000});
  return r.status === 0 && /GPU \d+:/.test(r.stdout ?? '');
}

/** True when a process runs the training interpreter (`/opt/trainer/bin/python`), read from /proc. */
export function trainerRunning(procDir = '/proc') {
  let entries = [];
  try { entries = fs.readdirSync(procDir).filter(n => /^\d+$/.test(n)); } catch { return false; }
  for (const pid of entries) {
    try {
      const argv = fs.readFileSync(path.join(procDir, pid, 'cmdline'), 'utf8').split('\0');
      if (argv[0] === TRAINER_PYTHON || argv[0]?.startsWith(TRAINER_PYTHON)) return true;
    } catch { /* process ended */ }
  }
  return false;
}

/** Pid holding the parse lock (a live process), or null; a stale lock file is removed. */
export function parseLockHolder(lock = PARSE_LOCK) {
  let pid;
  try { pid = Number(fs.readFileSync(lock, 'utf8').trim().split(/\s+/)[0]); } catch { return null; }
  if (Number.isInteger(pid) && pid > 0 && alive(pid)) return pid;
  try { fs.unlinkSync(lock); } catch { /* raced */ }
  return null;
}

/** Takes the single GPU parse lock; returns a release function or null when another live process holds it. */
export function acquireParseLock(lock = PARSE_LOCK) {
  fs.mkdirSync(path.dirname(lock), {recursive: true});
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(lock, `${process.pid} ${new Date().toISOString()}\n`, {flag: 'wx'});
      let released = false;
      const release = () => { if (released) return; released = true; try { if (Number(fs.readFileSync(lock, 'utf8').split(/\s+/)[0]) === process.pid) fs.unlinkSync(lock); } catch { /* gone */ } };
      process.once('exit', release);
      return release;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (parseLockHolder(lock) !== null) return null;
    }
  }
  return null;
}

/**
 * Resolves a requested device to `{device: 'cuda'|'cpu', release, reason}`. `release()` frees the GPU lock (a no-op on
 * the CPU). `checks` replaces the probes in tests.
 */
export function resolveDevice(requested = 'auto', {lock = PARSE_LOCK, checks = {}} = {}) {
  const probe = {gpu: gpuPresent, training: () => fs.existsSync(TRAINING_LOCK), trainer: trainerRunning, ...checks};
  const cpu = reason => ({device: 'cpu', release: () => {}, reason});
  if (requested === 'cpu') return cpu('requested');
  if (requested !== 'auto' && requested !== 'cuda') throw Error(`unknown device "${requested}" (auto, cuda or cpu)`);
  if (!probe.gpu()) return cpu('no GPU reported by nvidia-smi');
  if (requested === 'auto') {
    if (probe.training()) return cpu('models/.training.lock is present');
    if (probe.trainer()) return cpu(`a ${TRAINER_PYTHON} process is running`);
  }
  const release = acquireParseLock(lock);
  if (!release) return cpu(`another GPU parse worker holds ${path.relative(ROOT, lock)} (pid ${parseLockHolder(lock)})`);
  return {device: 'cuda', release, reason: requested === 'auto' ? 'GPU free' : 'requested'};
}
