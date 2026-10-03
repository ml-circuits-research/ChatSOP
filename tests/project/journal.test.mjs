import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {appendJournal, readJournal, recentEvents, validateEvent, readExperiments, validateExperiment} from '../../lib/journal.mjs';
import {repoPath, tempDir} from '../helpers.mjs';

const event = extra => ({area: 'data', actor: 'tester', title: 'Pilot audited', detail: 'ok', links: ['status/journal.jsonl'], state: 'done', ...extra});

test('journal appends validated events one per line and never rewrites earlier lines', t => {
  const file = path.join(tempDir(t), 'status/journal.jsonl');
  const first = appendJournal(event({ts: '2026-09-28T08:00:00Z'}), {file});
  const before = fs.readFileSync(file, 'utf8');
  appendJournal(event({ts: '2026-09-28T09:00:00Z', title: 'Second', state: 'progress'}), {file});
  const after = fs.readFileSync(file, 'utf8');
  assert.ok(after.startsWith(before), 'the earlier bytes are unchanged');
  assert.equal(after.split('\n').filter(Boolean).length, 2);
  assert.deepEqual(readJournal({file})[0], first);
  assert.deepEqual(recentEvents({file}).map(item => item.title), ['Second', 'Pilot audited'], 'newest first');
  assert.deepEqual(recentEvents({file, state: 'done'}).map(item => item.title), ['Pilot audited']);
  assert.equal(recentEvents({file, area: 'eval'}).length, 0);
});

test('journal defaults fill time, actor, links and state', t => {
  const file = path.join(tempDir(t), 'journal.jsonl');
  const record = appendJournal({area: 'process', title: 'Only a title'}, {file});
  assert.ok(Number.isFinite(Date.parse(record.ts)));
  assert.equal(record.state, 'done');
  assert.deepEqual(record.links, []);
  assert.equal(typeof record.actor, 'string');
});

test('journal schema rejects bad areas, states, timestamps, unknown fields and empty titles', t => {
  const file = path.join(tempDir(t), 'journal.jsonl');
  assert.throws(() => appendJournal(event({area: 'marketing'}), {file}), /area must be one of/);
  assert.throws(() => appendJournal(event({state: 'finished'}), {file}), /state must be one of/);
  assert.throws(() => appendJournal(event({ts: 'yesterday'}), {file}), /ISO 8601/);
  assert.throws(() => appendJournal(event({title: '  '}), {file}), /title must not be empty/);
  assert.throws(() => appendJournal(event({links: 'x'}), {file}), /links must be an array/);
  assert.throws(() => validateEvent({...event(), ts: '2026-09-28T08:00:00Z', extra: 1}), /Unknown journal field/);
  assert.equal(fs.existsSync(file), false, 'nothing is written for an invalid event');
});

test('a damaged journal is refused, not repaired', t => {
  const file = path.join(tempDir(t), 'journal.jsonl');
  fs.writeFileSync(file, '{"broken":');
  assert.throws(() => appendJournal(event(), {file}), /does not end with a newline/);
  fs.writeFileSync(file, '{"area":"data"}\n');
  assert.throws(() => readJournal({file}), /journal\.jsonl:1: Missing journal field/);
});

test('experiment registry validates entries and rejects duplicates', t => {
  const file = path.join(tempDir(t), 'experiments.json');
  assert.deepEqual(readExperiments({file}).experiments, [], 'a missing registry is empty');
  const entry = {id: 'exp-1', hypothesis: 'h', preregistration: 'docs/specs/DS007-experiment-preregistration.md', data_version: 'v1', status: 'proposed', results: null, conclusions: null};
  assert.equal(validateExperiment(entry), entry);
  assert.throws(() => validateExperiment({...entry, status: 'won'}), /status must be one of/);
  fs.writeFileSync(file, JSON.stringify({format: 'chatsop-experiments-v1', experiments: [entry, entry]}));
  assert.throws(() => readExperiments({file}), /Duplicate experiment id/);
});

test('the tracked journal and experiment registry are valid and every preregistered run is owner-approved and frozen', () => {
  const events = readJournal({file: repoPath('status/journal.jsonl')});
  assert.ok(events.length >= 10);
  assert.ok(events.some(item => item.state === 'decision'));
  const approvals = events.filter(item => item.area === 'training' && item.state === 'decision' && /authoriz|approv/i.test(item.title));
  const registry = readExperiments({file: repoPath('status/experiments.json')}).experiments;
  for (const entry of registry.filter(item => item.category && item.category !== 'preregistered')) {
    assert.match(entry.preregistration, /^none: /, `${entry.id}: a ${entry.category} states why it has no preregistration`);
  }
  for (const run of registry.filter(item => ['running', 'done'].includes(item.status) && (item.category ?? 'preregistered') === 'preregistered')) {
    assert.ok(approvals.length, `${run.id}: a run needs an owner training decision in the journal`);
    const record = run.preregistration.split(' ')[0];
    assert.ok(fs.existsSync(repoPath(record)), `${run.id}: preregistration record ${record} must exist`);
    // An unfilled field holds the placeholder as its value; the record's own explanation may name the placeholder.
    assert.doesNotMatch(fs.readFileSync(repoPath(record), 'utf8'), /:\s*"PENDING_DATA_FINAL/, `${run.id}: data hashes must be frozen before a run`);
  }
});

test('tools/journal.mjs adds, lists and validates from the shell', t => {
  const dir = tempDir(t);
  const env = {...process.env, CHATSOP_STATUS_DIR: dir, CHATSOP_ACTOR: 'cli-test'};
  const run = args => execFileSync(process.execPath, [repoPath('tools/journal.mjs'), ...args], {env, encoding: 'utf8'});
  const added = JSON.parse(run(['add', '--area', 'eval', '--title', 'CLI event', '--detail', 'd', '--state', 'blocked', '--link', 'a', '--link', 'b']));
  assert.equal(added.actor, 'cli-test');
  assert.deepEqual(added.links, ['a', 'b']);
  assert.match(run(['list', '--area', 'eval']), /\[eval\/blocked\] CLI event/);
  assert.equal(JSON.parse(run(['validate'])).events, 1);
  assert.throws(() => execFileSync(process.execPath, [repoPath('tools/journal.mjs'), 'add', '--area', 'nope', '--title', 'x'], {env, stdio: 'pipe'}), /area must be one of/);
});
