// Local llama-server upstreams started on demand (config.upstreams.<name>.start).
// The server starts only when the GPU is free: no reservation lock file and no compute process of another program on the GPU.
// A start that is not allowed or fails returns false; the request then fails as unreachable and falls back down its chain.
// An idle server is stopped after start.idleStopMs so the GPU is free for other work.
import { spawn as spawnDefault, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandHome } from './settings.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export function gpuComputePids() {
  try {
    const out = execFileSync('nvidia-smi', ['--query-compute-apps=pid', '--format=csv,noheader'], { encoding: 'utf8', timeout: 5000 });
    return out.split('\n').map((s) => Number(s.trim())).filter(Boolean);
  } catch { return null; } // no nvidia-smi: unknown
}

// Relative paths in `start` (gguf, bin, locks, logFile) resolve against baseDir: config.baseDir, itself relative to this folder.
export function createLocalStarter(up, { spawn = spawnDefault, fetchImpl = fetch, gpuPids = gpuComputePids, now = Date.now, baseDir = HERE } = {}) {
  const abs = (p) => { const e = expandHome(p); return isAbsolute(e) ? e : join(baseDir, e); };
  const s = up.start;
  const port = Number(new URL(up.baseUrl).port);
  let child = null, starting = null, lastUse = 0, lastRefusal = null, timer = null;

  const healthy = async () => {
    try { return (await fetchImpl(up.baseUrl + '/health', { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
  };
  function refuse(reason) { lastRefusal = { reason, at: new Date(now()).toISOString() }; return false; }

  async function start() {
    for (const lock of s.locks || []) if (existsSync(abs(lock))) return refuse(`GPU reserved (${lock})`);
    if (s.requireFreeGpu !== false) {
      const pids = gpuPids();
      if (pids && pids.length) return refuse(`GPU busy (compute pids ${pids.join(',')})`);
    }
    // Two kinds of local server: a llama-server over a GGUF (`bin`, `gguf`), or a Node script (`script`, e.g. the small-model
    // service of the structure and formalizer tiers) run with this Node binary and `--port`.
    let cmd, argv;
    if (s.script) {
      const script = abs(s.script);
      if (!existsSync(script)) return refuse(`missing script ${script}`);
      for (const f of s.requires || []) if (!existsSync(abs(f))) return refuse(`missing ${abs(f)}`);
      cmd = process.execPath; argv = [script, '--port', String(port), ...(s.args || [])];
    } else {
      const gguf = abs(s.gguf), bin = abs(s.bin);
      if (!existsSync(gguf)) return refuse(`missing model ${gguf}`);
      if (!existsSync(bin)) return refuse(`missing llama-server ${bin}`);
      cmd = bin; argv = ['-m', gguf, '--host', '127.0.0.1', '--port', String(port), '-a', s.alias || up.name, ...(s.args || [])];
    }
    const logFile = abs(s.logFile || `~/.local/share/llmapiprovider/${up.name}.log`);
    mkdirSync(dirname(logFile), { recursive: true });
    const fd = openSync(logFile, 'a');
    const c = spawn(cmd, argv, { stdio: ['ignore', fd, fd] });
    closeSync(fd);
    let exited = false;
    c.on('exit', () => { exited = true; if (child === c) child = null; });
    child = c;
    const deadline = now() + (s.startTimeoutMs ?? 120000);
    while (now() < deadline) {
      if (exited) return refuse(`local server exited during start; see ${logFile}`);
      if (await healthy()) { lastRefusal = null; return true; }
      await new Promise((r) => setTimeout(r, 500));
    }
    stop();
    return refuse('local server did not become healthy in time');
  }

  function stop() { if (child && child.exitCode === null) child.kill('SIGTERM'); child = null; }

  function armIdleStop() {
    if (!s.idleStopMs || timer) return;
    timer = setInterval(() => {
      if (child && now() - lastUse > s.idleStopMs) stop();
      if (!child) { clearInterval(timer); timer = null; }
    }, Math.min(60000, s.idleStopMs));
    timer.unref?.();
  }

  return {
    async ensure() {
      lastUse = now();
      if (await healthy()) return true; // ours or started by someone else on that port
      starting ??= start().finally(() => { starting = null; });
      const ok = await starting;
      if (ok) armIdleStop();
      return ok;
    },
    stop,
    status: () => ({ managed: !!child, pid: child?.pid ?? null, last_refusal: lastRefusal }),
  };
}
