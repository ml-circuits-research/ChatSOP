/** Device selection of the Stanza parse worker (lib/ud-to-sop/device.mjs): `auto` takes the GPU only when it is free. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {resolveDevice, acquireParseLock, parseLockHolder, trainerRunning} from '../lib/ud-to-sop/device.mjs';
import {tempDir} from './helpers.mjs';

const free = {gpu: () => true, training: () => false, trainer: () => false};

test('auto picks cuda when the GPU is free and takes the single parse lock', t => {
  const lock = path.join(tempDir(t, 'parse-device-'), 'gpu.lock');
  const a = resolveDevice('auto', {lock, checks: free});
  assert.equal(a.device, 'cuda');
  assert.equal(parseLockHolder(lock), process.pid);
  const b = resolveDevice('auto', {lock, checks: free});
  assert.equal(b.device, 'cpu', 'a second GPU parse worker is refused');
  assert.match(b.reason, /holds/);
  a.release();
  assert.equal(fs.existsSync(lock), false);
  const c = resolveDevice('auto', {lock, checks: free});
  assert.equal(c.device, 'cuda');
  c.release();
});

test('auto falls back to the CPU when there is no GPU, a training lock or a trainer process', t => {
  const lock = path.join(tempDir(t, 'parse-device-'), 'gpu.lock');
  assert.equal(resolveDevice('auto', {lock, checks: {...free, gpu: () => false}}).device, 'cpu');
  assert.equal(resolveDevice('auto', {lock, checks: {...free, training: () => true}}).device, 'cpu');
  assert.equal(resolveDevice('auto', {lock, checks: {...free, trainer: () => true}}).device, 'cpu');
  assert.equal(fs.existsSync(lock), false, 'no lock is taken on the CPU');
  assert.equal(resolveDevice('cpu', {lock, checks: free}).device, 'cpu');
  assert.throws(() => resolveDevice('tpu', {lock}), /unknown device/);
});

test('a stale lock of a dead process is taken over', t => {
  const lock = path.join(tempDir(t, 'parse-device-'), 'gpu.lock');
  fs.writeFileSync(lock, '2147483646 old\n');
  assert.equal(parseLockHolder(lock), null);
  const release = acquireParseLock(lock);
  assert.ok(release);
  release();
});

test('trainerRunning reads /proc command lines', t => {
  const proc = tempDir(t, 'fake-proc-');
  fs.mkdirSync(path.join(proc, '42'));
  fs.writeFileSync(path.join(proc, '42/cmdline'), 'node\0x.mjs\0');
  assert.equal(trainerRunning(proc), false);
  fs.mkdirSync(path.join(proc, '43'));
  fs.writeFileSync(path.join(proc, '43/cmdline'), '/opt/trainer/bin/python\0train.py\0');
  assert.equal(trainerRunning(proc), true);
});
