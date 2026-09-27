#!/usr/bin/env node
import {spawn, spawnSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync, renameSync, rmSync, statfsSync, openSync, closeSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const models = join(root, 'models');
const jobs = join(models, '.container-runs');
const lock = join(models, '.training.lock');
const reports = join(root, 'eval/reports/current');
const image = 'localhost/chatsop-spark-training:cu130-20260927';
const gib = 1024 ** 3;
const limits = {cpus: 6, memoryGiB: 32, pids: 256, shmGiB: 1, availableHostGiB: 48, stopHostGiB: 16, freeDiskGiB: 40, stopDiskGiB: 20, freeCudaGiB: 48};
function fail(message) { throw Error(message); }
function cmd(args, options = {}) {
  const result = spawnSync('podman', args, {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options});
  if (result.error || result.status !== 0) fail(`podman ${args[0]} failed: ${result.stderr?.trim() || result.error?.message || result.stdout?.trim() || result.status}`);
  return result.stdout?.trim() || '';
}
function save(path, value) {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', {mode: 0o600});
  renameSync(temp, path);
}
function parseJob(args) {
  if (args[0] !== '--job' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(args[1] || '') || args[1].includes('..')) fail('Specify --job SAFE_NAME');
  return {name: args[1], rest: args.slice(2), dir: join(jobs, args[1])};
}
function containerId(dir) {
  const value = readFileSync(join(dir, 'cid'), 'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(value)) fail('Invalid owned container ID');
  const expected = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
  const inspect = JSON.parse(cmd(['inspect', value]));
  if (inspect.length !== 1 || inspect[0].Id !== value || expected.containerId !== value || inspect[0].Image !== expected.imageId || inspect[0].Config?.Labels?.['chatsop.training.job'] !== basename(dir)) fail('Container identity/ownership mismatch');
  return {id: value, inspect: inspect[0]};
}
function diagnostic(dir) {
  const {id, inspect} = containerId(dir);
  const state = inspect.State;
  const evidence = join(dir, 'inside-cgroups.json');
  const details = {id, status: state.Status, exitCode: state.ExitCode, startedAt: state.StartedAt, finishedAt: state.FinishedAt, oomKilled: state.OOMKilled, cgroupEvidence: existsSync(evidence) ? evidence : null, configured: {memoryBytes: inspect.HostConfig?.Memory, cpuNano: inspect.HostConfig?.NanoCpus, pids: inspect.HostConfig?.PidsLimit, network: inspect.HostConfig?.NetworkMode, ipc: inspect.HostConfig?.IpcMode}};
  save(join(dir, 'diagnostic.json'), {...details, limits, at: new Date().toISOString()});
  return details;
}
function hostGate() {
  const text = readFileSync('/proc/meminfo', 'utf8');
  const available = Number(text.match(/^MemAvailable:\s+(\d+) kB/m)?.[1]) * 1024;
  const fs = statfsSync(root, {bigint: true});
  const disk = Number(fs.bavail * fs.bsize);
  if (!Number.isSafeInteger(available) || available < limits.availableHostGiB * gib) fail(`Host MemAvailable below ${limits.availableHostGiB} GiB`);
  if (disk < limits.freeDiskGiB * gib) fail(`Host disk free below ${limits.freeDiskGiB} GiB`);
  return {availableHostBytes: available, freeDiskBytes: disk};
}
function build() {
  if (existsSync(lock)) fail(`Training lock exists: ${lock}`);
  const host = hostGate();
  cmd(['build', '--platform', 'linux/arm64', '--pull=always', '--jobs=1', '--memory=16g', '--memory-swap=16g', '--cpu-period=100000', '--cpu-quota=400000', '--file', 'training/container/Containerfile', '--tag', image, '.'], {cwd: root, stdio: 'inherit'});
  const info = JSON.parse(cmd(['image', 'inspect', image]))[0];
  if (info.Architecture !== 'arm64') fail(`Built unexpected architecture: ${info.Architecture}`);
  mkdirSync(jobs, {recursive: true});
  const provenance = {image, imageId: info.Id, imageDigest: info.Digest || null, baseArm64Digest: 'sha256:450d11555d20ac8ebbbc13ebf17589c2bd42869171a90179ce7098b4a5e64c6a', nodeArm64Digest: 'sha256:f71fb9ca71b1b47d4d1a009af78147ed6cdc74f9c7cfc36cbde78ff985169051', builtAt: new Date().toISOString(), buildLimits: {cpus: 4, memoryGiB: 16, jobs: 1}, hostAtStart: host, limits};
  save(join(jobs, 'image-provenance.json'), provenance);
  console.log(JSON.stringify({provenance}, null, 2));
}
async function run(args) {
  const {name, rest, dir} = parseJob(args);
  const wallMinutes = Number(rest[1]);
  if (rest[0] !== '--wall-minutes' || !Number.isSafeInteger(wallMinutes) || wallMinutes < 1 || wallMinutes > 1440 || rest[2] !== '--' || !['preflight', 'train', 'token-audit', 'merge'].includes(rest[3])) fail('Usage: run --job NAME --wall-minutes 15 -- preflight|train|token-audit|merge [training CLI options]');
  if (rest[3] === 'train') {
    const cliArgs = rest.slice(4);
    for (const flag of ['--qualification', '--authorization']) {
      const at = cliArgs.indexOf(flag);
      if (at < 0 || !cliArgs[at + 1] || cliArgs[at + 1].startsWith('--')) fail(`Container train requires ${flag} FILE before image or lock operations`);
      const path = realpathSync(resolve(root, cliArgs[at + 1]));
      if (!path.startsWith(`${root}/`) || !statSync(path).isFile()) fail(`${flag} must be a regular file inside the bind-mounted repository`);
    }
    const probe = spawnSync(process.execPath, ['training/cli.mjs', 'train', ...cliArgs, ...(cliArgs.includes('--dry-run') ? [] : ['--dry-run'])], {cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
    if (probe.error || probe.status !== 0) fail(`Host training authorization dry-run refused: ${probe.stderr?.trim() || probe.error?.message || probe.status}`);
    let report;
    try { report = JSON.parse(probe.stdout); } catch { fail('Host training authorization dry-run did not return JSON'); }
    if (report.training_executed !== false || report.dataset_qualified !== true || report.training_authorized !== true) fail(`Host training authorization refused: ${report.gate_error || 'qualification and fresh explicit user authorization must both pass'}`);
  }
  if (existsSync(dir)) fail(`Job exists (never reuse or overwrite): ${dir}`);
  if (existsSync(lock)) fail(`Training lock exists: ${lock}`);
  const host = hostGate();
  const img = JSON.parse(cmd(['image', 'inspect', image]))[0];
  if (img.Architecture !== 'arm64') fail('Local image architecture must be arm64');
  mkdirSync(models, {recursive: true});
  mkdirSync(jobs, {recursive: true});
  mkdirSync(reports, {recursive: true});
  const token = randomBytes(32).toString('hex');
  try { mkdirSync(lock); } catch (error) { if (error.code === 'EEXIST') fail(`Training lock exists: ${lock}`); throw error; }
  let safelyExited = true;
  try {
    mkdirSync(dir);
    const owner = {kind: 'container', token, pid: process.pid, hostname: process.env.HOSTNAME || null, startedAt: new Date().toISOString(), container_id: null};
    save(join(lock, 'owner.json'), owner);
    const state = {name, command: rest.slice(3), wallMinutes, lockTokenSha256: createHash('sha256').update(token).digest('hex'), imageId: img.Id, host, limits, startedAt: owner.startedAt};
    save(join(dir, 'state.json'), state);
    const label = name;
    const runArgs = ['run', '-d', '--pull=never', '--cidfile', join(dir, 'cid'), '--name', `chatsop-training-${name}`, '--label', `chatsop.training.job=${label}`,
      '--device', 'nvidia.com/gpu=all', '--network=none', '--ipc=private', '--cgroupns=private', '--read-only', '--cap-drop=all', '--security-opt=no-new-privileges',
      '--cpus=6', '--memory=32g', '--memory-swap=32g', '--pids-limit=256', '--shm-size=1g', '--tmpfs=/tmp:rw,nosuid,size=2g',
      '--mount', `type=bind,src=${root},dst=${root},ro=true`, '--mount', `type=bind,src=${models},dst=${models}`, '--mount', `type=bind,src=${reports},dst=${reports}`,
      '--workdir', root, '--env', 'HOME=/tmp', '--env', `HF_HOME=${join(dir, 'cache')}`, '--env', `XDG_CACHE_HOME=${join(dir, 'cache/xdg')}`, '--env', `TRITON_CACHE_DIR=${join(dir, 'cache/triton')}`,
      '--env', 'TRAIN_MIN_FREE_GIB=40', '--env', 'TRAIN_STOP_FREE_GIB=20', '--env', 'TRAIN_MIN_AVAILABLE_GIB=48', '--env', 'TRAIN_STOP_AVAILABLE_GIB=16', '--env', 'TRAIN_MIN_CUDA_FREE_GIB=48', '--env', 'TRAIN_EXTERNAL_LOCK=1', '--env', `TRAIN_LOCK_TOKEN=${token}`, '--env', `TRAIN_CONTAINER_EVIDENCE=${join(dir, 'inside-cgroups.json')}`,
      '--entrypoint=node', img.Id, 'training/container/inside.mjs', ...rest.slice(3)];
    safelyExited = false;
    const id = cmd(runArgs);
    if (!/^[a-f0-9]{64}$/.test(id)) fail(`Unexpected Podman container ID: ${id}`);
    owner.container_id = id;
    save(join(lock, 'owner.json'), owner);
    save(join(dir, 'state.json'), {...state, containerId: id});
    console.log(JSON.stringify({job: name, containerId: id, imageId: img.Id, limits, wallMinutes, diagnostic: join(dir, 'diagnostic.json')}));
    const logger = spawn('podman', ['logs', '--follow', id], {stdio: 'inherit'});
    logger.once('error', error => console.error(`Podman live logs unavailable: ${error.message}`));
    let refusal = null;
    const halt = (reason, observed = null) => {
      if (refusal) return;
      refusal = {reason, observed, at: new Date().toISOString()};
      save(join(dir, 'runtime-refusal.json'), refusal);
      try { cmd(['stop', '--time=90', id]); } catch (error) { console.error(error.message); }
    };
    const watch = setInterval(() => {
      try {
        const available = Number(readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+) kB/m)?.[1]) * 1024;
        const fs = statfsSync(root, {bigint: true});
        const disk = Number(fs.bavail * fs.bsize);
        if (!Number.isSafeInteger(available) || available < limits.stopHostGiB * gib || disk < limits.stopDiskGiB * gib) halt('host_resource_floor', {availableHostBytes: available, freeDiskBytes: disk});
      } catch (error) { halt('host_monitor_failed', {error: error.message}); }
    }, 30_000);
    const deadline = setTimeout(() => halt('wall_time_exceeded', {wallMinutes}), wallMinutes * 60_000);
    const onInt = () => halt('launcher_SIGINT');
    const onTerm = () => halt('launcher_SIGTERM');
    process.once('SIGINT', onInt);
    process.once('SIGTERM', onTerm);
    try {
      const wait = await new Promise((done, reject) => {
        const waiter = spawn('podman', ['wait', id], {stdio: ['ignore', 'pipe', 'pipe']});
        let stdout = '', stderr = '';
        waiter.stdout.setEncoding('utf8');
        waiter.stderr.setEncoding('utf8');
        waiter.stdout.on('data', chunk => { stdout += chunk; });
        waiter.stderr.on('data', chunk => { stderr += chunk; });
        waiter.once('error', reject);
        waiter.once('close', code => code === 0 ? done(stdout.trim()) : reject(Error(`podman wait failed: ${stderr.trim() || code}`)));
      });
      const details = diagnostic(dir);
      if (details.status === 'exited') safelyExited = true;
      save(join(dir, 'result.json'), {...details, wait, refusal: refusal || (existsSync(join(dir, 'stop-request.json')) ? JSON.parse(readFileSync(join(dir, 'stop-request.json'), 'utf8')) : null), finishedAt: new Date().toISOString()});
      logger.kill('SIGTERM');
      const fd = openSync(join(dir, 'container.log'), 'w', 0o600);
      try { cmd(['logs', id], {stdio: ['ignore', fd, fd]}); } finally { closeSync(fd); }
      if (details.status !== 'exited' || details.exitCode !== 0 || refusal) fail(`Container ended ${details.status}, exit ${details.exitCode}${refusal ? ` (${refusal.reason})` : ''}; see ${join(dir, 'container.log')}`);
      console.log(JSON.stringify(details));
    } finally {
      clearInterval(watch);
      clearTimeout(deadline);
      logger.kill('SIGTERM');
      process.removeListener('SIGINT', onInt);
      process.removeListener('SIGTERM', onTerm);
    }
  } finally {
    if (safelyExited) rmSync(lock, {recursive: true});
    else console.error(`Lock retained until confirmed exit: ${lock}; inspect owned job ${dir}`);
  }
}
function status(args, stopping = false) {
  const {rest, dir} = parseJob(args);
  if (rest.length) fail('Unexpected arguments');
  const {id, inspect} = containerId(dir);
  const needsStop = stopping && inspect.State.Status !== 'exited';
  if (needsStop) {
    save(join(dir, 'stop-request.json'), {reason: 'operator_requested', containerId: id, at: new Date().toISOString()});
    cmd(['stop', '--time=90', id]);
    const fd = openSync(join(dir, 'container.log'), 'w', 0o600);
    try { cmd(['logs', id], {stdio: ['ignore', fd, fd]}); } finally { closeSync(fd); }
  }
  const details = diagnostic(dir);
  if (stopping && details.status === 'exited') {
    if (needsStop) save(join(dir, 'result.json'), {...details, refusal: JSON.parse(readFileSync(join(dir, 'stop-request.json'), 'utf8')), stoppedAt: new Date().toISOString()});
    if (existsSync(lock)) {
      const owner = JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8'));
      const expected = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
      if (owner.kind !== 'container' || owner.container_id !== id || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || owner.hostname !== (process.env.HOSTNAME || null) || !/^[a-f0-9]{64}$/.test(owner.token || '') || createHash('sha256').update(owner.token).digest('hex') !== expected.lockTokenSha256) fail('Lock identity mismatch; lock left untouched');
      let alive = true;
      try { process.kill(owner.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
      if (!alive) rmSync(lock, {recursive: true});
    }
  }
  console.log(JSON.stringify(details, null, 2));
}
try {
  const [action, ...args] = process.argv.slice(2);
  if (action === 'build' && !args.length) build();
  else if (action === 'run') await run(args);
  else if (action === 'status') status(args);
  else if (action === 'stop') status(args, true);
  else fail('Usage: node training/container/podman.mjs build | run --job NAME --wall-minutes 15 -- preflight|train ... | status --job NAME | stop --job NAME');
} catch (error) { console.error(error.message); process.exitCode = 1; }
