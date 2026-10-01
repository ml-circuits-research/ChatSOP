/**
 * One private llama-server at a time (AGENTS.md direction 2: a single GPU-intensive worker per machine). `startServer` refuses to start
 * while another training or parse worker holds its lock or a GPU process is running; it never kills anything but its own child.
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawn, execFileSync} from 'node:child_process';
import {LLAMA_SERVER} from './models.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');

export function gpuBusy() {
  for (const lock of ['models/.training.lock', 'models/.parse-gpu.lock']) if (fs.existsSync(path.join(ROOT, lock))) return `${lock} exists`;
  try {
    const util = Number(execFileSync('nvidia-smi', ['--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'], {encoding: 'utf8'}).trim().split('\n')[0]);
    if (util > 20) return `GPU utilization ${util}%`;
  } catch { /* no nvidia-smi: nothing to check */ }
  try {
    // workers that can use the GPU: a llama-server that offloads layers, or a training / fine-tuning script (CPU-only parse workers and `-ngl 0` servers are fine)
    const ps = execFileSync('pgrep', ['-af', 'llama-server|llama-cli|llama-bench|training/python/(train|finetune)|train_'], {encoding: 'utf8'}).trim().split('\n')
      .filter(l => l && !/pgrep/.test(l) && !/-ngl 0\b/.test(l) && !/--port (19511|19512|19513|19514|19515)\b/.test(l));
    if (ps.length) return `other GPU-capable workers: ${ps.join('; ').slice(0, 300)}`;
  } catch { /* pgrep exits 1 when nothing matches */ }
  return null;
}

export async function startServer({gguf, port, ctx = 32768, threads = null, ngl = 99, logFile, extraArgs = [], alias = 'model'}) {
  const busy = ngl > 0 ? gpuBusy() : null;
  if (busy) throw Object.assign(new Error(`the GPU is not free: ${busy}`), {code: 'gpu_busy'});
  if (!fs.existsSync(gguf)) throw new Error(`missing model file ${gguf}`);
  const args = ['-m', gguf, '--host', '127.0.0.1', '--port', String(port), '-c', String(ctx), '-ngl', String(ngl), '--jinja', '-a', alias, '--no-webui', ...(threads ? ['-t', String(threads)] : []), ...extraArgs];
  const log = fs.openSync(logFile, 'w');
  const child = spawn(LLAMA_SERVER, args, {stdio: ['ignore', log, log]});
  let exited = false;
  child.on('exit', () => { exited = true; });
  for (let i = 0; i < 600; i++) {
    if (exited) throw new Error(`llama-server exited early; see ${logFile}`);
    try { const r = await fetch(`http://127.0.0.1:${port}/health`, {signal: AbortSignal.timeout(2000)}); if (r.ok) return {child, endpoint: `http://127.0.0.1:${port}/v1`, stop: () => stopServer(child, logFile)}; } catch { /* still loading */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  child.kill('SIGTERM');
  throw new Error('llama-server did not become healthy in 600 s');
}

export async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise(resolve => { const t = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 15000); child.on('exit', () => { clearTimeout(t); resolve(); }); });
}
