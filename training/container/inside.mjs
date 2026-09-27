import {readFileSync, statfsSync, writeFileSync} from 'node:fs';
import {spawn, spawnSync} from 'node:child_process';

const gib = 1024 ** 3;
const limits = {cpus: 6, memory: 32 * gib, pids: 256, shm: gib};
function file(name) { return readFileSync(`/sys/fs/cgroup/${name}`, 'utf8').trim(); }
function finite(name) {
  const value = file(name);
  if (!/^\d+$/.test(value)) throw Error(`${name} is not enforced: ${value}`);
  return Number(value);
}
try {
  file('cgroup.controllers');
  const [quota, period] = file('cpu.max').split(' ').map(Number);
  if (!Number.isSafeInteger(quota) || !Number.isSafeInteger(period) || quota <= 0 || period <= 0 || quota / period > limits.cpus) throw Error(`cpu.max not enforced: ${file('cpu.max')}`);
  const memory = finite('memory.max'), pids = finite('pids.max'), swap = finite('memory.swap.max');
  if (memory > limits.memory || memory <= 0 || pids > limits.pids || pids <= 0 || swap !== 0) throw Error(`cgroup limits not enforced: memory=${memory} pids=${pids} swap=${swap}`);
  const fs = statfsSync('/dev/shm');
  const shm = Number(fs.blocks) * Number(fs.bsize);
  if (shm > limits.shm || shm <= 0) throw Error(`shared memory size not enforced: ${shm}`);
  const observed = {cpuMax: file('cpu.max'), memoryMax: memory, memoryCurrent: finite('memory.current'), memorySwapMax: swap, pidsMax: pids, pidsCurrent: finite('pids.current'), shmBytes: shm};
  console.log(JSON.stringify({containerCgroups: observed, gpuUnifiedMemoryNotBoundedByMemoryMax: true}));
  const gpu = spawnSync(process.env.TRAIN_PYTHON, ['-c', 'import torch,sys; assert torch.cuda.is_available(), "CUDA unavailable"; free,total=torch.cuda.mem_get_info(); print(f"CUDA free={free} total={total} device={torch.cuda.get_device_name(0)}"); sys.exit(0 if free >= 48 * 1024**3 else 2)'], {encoding: 'utf8'});
  if (gpu.error || gpu.status !== 0) throw Error(`CUDA availability/free floor (48 GiB) failed: ${gpu.stderr?.trim() || gpu.stdout?.trim() || gpu.error?.message}`);
  process.stdout.write(gpu.stdout);
  writeFileSync(process.env.TRAIN_CONTAINER_EVIDENCE, JSON.stringify({observed, cuda: gpu.stdout.trim(), limits, checkedAt: new Date().toISOString(), gpuUnifiedMemoryNotBoundedByMemoryMax: true}, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  const args = process.argv.slice(2);
  if (!['preflight', 'train', 'token-audit', 'merge'].includes(args[0])) throw Error('Only reviewed offline training commands are allowed');
  const child = spawn('node', ['training/cli.mjs', ...args], {stdio: 'inherit'});
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.once('error', error => { console.error(error); process.exitCode = 1; });
  child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 128 + (signal === 'SIGTERM' ? 15 : 2) : 1); });
} catch (error) {
  console.error(`Container guard: ${error.message}`);
  process.exitCode = 1;
}
