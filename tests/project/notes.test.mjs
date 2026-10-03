// Topic notes (lib/notes.mjs, tools/notes.mjs) and task records (lib/tasks.mjs):
// append-only storage, validation, supersede chains, the CLI, and the tracked store.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {appendNote, readTopicNotes, readAllNotes, validateNote, validateStore, newestFirst, supersededBy, noteId, NOTE_KINDS} from '../../lib/notes.mjs';
import {readTasks, readTaskRegistry, validateTask, mentions} from '../../lib/tasks.mjs';
import {readExperiments} from '../../lib/journal.mjs';
import {repoPath, tempDir} from '../helpers.mjs';

/** A scratch status directory with two registered topics. */
function store(t) {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, 'topics.json'), JSON.stringify({format: 'chatsop-topics-v1', topics: [
    {id: 'evaluation', title: 'Evaluation', scope: 'Suites and metrics.'},
    {id: 'training-experiments', title: 'Training', scope: 'Runs.'},
  ]}));
  return dir;
}
const note = extra => ({topic: 'evaluation', kind: 'result', author: 'tester', title: 'Dev score', body: '**92.3%** of 5,131', links: ['eval/reports/current/x.json'], ...extra});

test('notes append one line each and never rewrite earlier lines', t => {
  const dir = store(t);
  const first = appendNote(note({ts: '2026-09-28T08:00:00Z'}), {dir});
  const file = path.join(dir, 'notes/evaluation.jsonl');
  const before = fs.readFileSync(file, 'utf8');
  const second = appendNote(note({ts: '2026-09-28T09:00:00Z', title: 'Sealed score', kind: 'observation'}), {dir});
  const after = fs.readFileSync(file, 'utf8');
  assert.ok(after.startsWith(before), 'the earlier bytes are unchanged');
  assert.equal(after.trim().split('\n').length, 2);
  assert.deepEqual(readTopicNotes('evaluation', {dir}), [first, second]);
  assert.deepEqual(newestFirst(readAllNotes({dir})).map(item => item.title), ['Sealed score', 'Dev score']);
  assert.equal(first.id, noteId({topic: 'evaluation', ts: '2026-09-28T08:00:00Z', title: 'Dev score'}));
  assert.match(first.id, /^evaluation-20260928-080000-[0-9a-f]{6}$/);
});

test('a note is validated: kind, topic, fields, links and time', t => {
  const dir = store(t);
  assert.throws(() => appendNote(note({kind: 'rumour'}), {dir}), /kind must be one of/);
  assert.throws(() => appendNote(note({topic: 'marketing'}), {dir}), /Unknown topic marketing/);
  assert.throws(() => appendNote(note({title: ' '}), {dir}), /title must not be empty/);
  assert.throws(() => appendNote(note({body: ''}), {dir}), /body must not be empty/);
  assert.throws(() => appendNote(note({links: 'x'}), {dir}), /links must be an array/);
  assert.throws(() => appendNote(note({ts: 'yesterday'}), {dir}), /ISO 8601/);
  assert.throws(() => validateNote({...note(), id: 'a', ts: '2026-09-28T08:00:00Z', extra: 1}), /Unknown note field/);
  assert.equal(fs.existsSync(path.join(dir, 'notes')), false, 'nothing is written for an invalid note');
  assert.deepEqual(NOTE_KINDS, ['decision', 'suggestion', 'analysis', 'observation', 'experiment', 'result', 'plan', 'question', 'correction']);
});

test('notes are never replaced: duplicate ids are refused and corrections supersede', t => {
  const dir = store(t);
  const wrong = appendNote(note({ts: '2026-09-29T05:16:00Z', topic: 'training-experiments', title: 'Gemma short rows 73.2%'}), {dir});
  assert.throws(() => appendNote(note({ts: '2026-09-29T05:16:00Z', topic: 'training-experiments', title: 'Gemma short rows 73.2%'}), {dir}), /already exists; notes are never replaced/);
  assert.throws(() => appendNote(note({kind: 'correction', title: 'Fix', supersedes: 'no-such-note'}), {dir}), /supersedes names unknown note/);
  // A correction may live in another topic; both notes stay.
  const fix = appendNote(note({ts: '2026-09-29T05:19:00Z', kind: 'correction', title: 'GGUF lost turn tokens; 73.2% invalid', supersedes: wrong.id}), {dir});
  const all = readAllNotes({dir});
  assert.equal(all.length, 2);
  assert.deepEqual(supersededBy(all).get(wrong.id), [fix.id]);
  assert.deepEqual(validateStore({dir}).problems, []);
  assert.throws(() => validateNote({...fix, supersedes: fix.id}), /cannot supersede itself/);
});

test('a damaged notes file is refused, and the store check reports broken chains and misplaced notes', t => {
  const dir = store(t);
  fs.mkdirSync(path.join(dir, 'notes'));
  fs.writeFileSync(path.join(dir, 'notes/evaluation.jsonl'), '{"broken":');
  assert.throws(() => appendNote(note({ts: '2026-09-28T08:00:00Z'}), {dir}), /(does not end with a newline|evaluation\.jsonl:1)/);
  const good = {...note(), id: 'evaluation-x', ts: '2026-09-28T08:00:00Z'};
  fs.writeFileSync(path.join(dir, 'notes/evaluation.jsonl'), JSON.stringify({...good, supersedes: 'ghost'}) + '\n');
  fs.writeFileSync(path.join(dir, 'notes/training-experiments.jsonl'), JSON.stringify({...good, id: 'misplaced'}) + '\n');
  const {problems} = validateStore({dir});
  assert.ok(problems.some(problem => /training-experiments\.jsonl:1: note misplaced has topic evaluation/.test(problem)), problems.join('\n'));
  fs.writeFileSync(path.join(dir, 'notes/training-experiments.jsonl'), '');
  assert.deepEqual(validateStore({dir}).problems, ['evaluation-x: supersedes unknown note ghost']);
});

test('tools/notes.mjs adds, lists, shows topics and validates from the shell', t => {
  const dir = store(t);
  const env = {...process.env, CHATSOP_STATUS_DIR: dir, CHATSOP_ACTOR: 'cli-test'};
  const run = args => execFileSync(process.execPath, [repoPath('tools/notes.mjs'), ...args], {env, encoding: 'utf8'});
  const bodyFile = path.join(dir, 'body.md');
  fs.writeFileSync(bodyFile, '# Result\n\n- 74.1% of 5,033\n');
  const added = JSON.parse(run(['add', '--topic', 'evaluation', '--kind', 'result', '--title', 'CLI note', '--body-file', bodyFile, '--link', 'a', '--link', 'b', '--ts', '2026-09-29T01:00:00Z']));
  assert.equal(added.author, 'cli-test');
  assert.deepEqual(added.links, ['a', 'b']);
  assert.equal(added.body, '# Result\n\n- 74.1% of 5,033');
  const fixed = JSON.parse(run(['add', '--topic', 'evaluation', '--kind', 'correction', '--title', 'CLI fix', '--body', 'Corrected.', '--supersedes', added.id]));
  assert.equal(fixed.supersedes, added.id);
  assert.match(run(['list', '--topic', 'evaluation']), /\[evaluation\/correction\] CLI fix .* supersedes /);
  assert.match(run(['topics']), /evaluation\s+2\s+Evaluation/);
  assert.equal(JSON.parse(run(['validate'])).notes, 2);
  assert.throws(() => execFileSync(process.execPath, [repoPath('tools/notes.mjs'), 'add', '--topic', 'evaluation', '--kind', 'nope', '--title', 'x', '--body', 'y'], {env, stdio: 'pipe'}), /kind must be one of/);
});

test('task records are validated and relate notes and events through match phrases', () => {
  const task = {id: 'long-message-diagnosis', kind: 'task', title: 't', status: 'done', started_at: '2026-09-29T05:16:55Z', summary: 's', owner: 'o', agents: 'a', match: ['long-message'], experiments: []};
  assert.equal(validateTask(task), task);
  assert.throws(() => validateTask({...task, id: 'topics'}), /reserved/);
  assert.throws(() => validateTask({...task, status: 'finished'}), /status must be one of/);
  assert.throws(() => validateTask({...task, owner: ''}), /owner must be a non-empty string/);
  assert.throws(() => validateTask({...task, extra: 1}), /unknown field/);
  assert.equal(mentions(task, 'Long-Message diagnosis started'), true);
  assert.equal(mentions(task, 'unrelated'), false);
});

test('the tracked topics, notes and task records are valid and every task links existing records', () => {
  const {topics, notes, problems} = validateStore({dir: repoPath('status')});
  assert.deepEqual(problems, []);
  for (const id of ['model-language', 'model-boundary', 'data-generation', 'data-quality-and-audit', 'evaluation', 'training-experiments', 'baselines', 'preprocessing', 'long-messages', 'data-improvement-plan', 'server-and-ui', 'docs-and-specs', 'process-and-decisions'])
    assert.ok(topics.some(topic => topic.id === id), `topic ${id}`);
  assert.ok(notes.length >= 50);
  // Owner decisions are attributed to the owner; a note corrected by a later note (`supersedes`) no longer counts.
  const superseded = new Set(notes.map(item => item.supersedes).filter(Boolean));
  assert.ok(notes.filter(item => item.kind === 'decision' && !superseded.has(item.id)).every(item => item.author === 'owner'), 'every current decision note is the owner\'s');
  const {phase, tasks} = readTaskRegistry({file: repoPath('status/tasks.json')});
  assert.ok(phase?.name);
  assert.equal(readTasks({file: repoPath('status/tasks.json')}).length, tasks.length);
  const experiments = new Set(readExperiments({file: repoPath('status/experiments.json')}).experiments.map(entry => entry.id));
  const topicIds = new Set(topics.map(topic => topic.id));
  for (const task of tasks) {
    for (const id of task.experiments ?? []) assert.ok(experiments.has(id), `${task.id}: experiment ${id} is registered`);
    for (const id of task.topics ?? []) assert.ok(topicIds.has(id), `${task.id}: topic ${id} exists`);
  }
});
