// Sessions (DS031): the library (clone of a base memory, drafts, accept, reject, commit), the /v1/sessions API and the chat running
// in a session with its own repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {ChatData} from '../lib/chat-data/index.mjs';
import {BaseMemories} from '../lib/chat-data/memories.mjs';
import {Sessions} from '../lib/chat-data/sessions.mjs';
import {FAMILY, FAMILY_QUERY, mockFormalizer, productServer, runtimeConfig} from './product-helpers.mjs';
import {tempDir} from './helpers.mjs';

const EXTRA = '@f9 fact\n  holds parent di eve\n  source "chat"\n';

function library(t) {
  const chatData = ChatData.open({chatData: {root: tempDir(t, 'ss-') + '/cd'}}, {});
  const memory = runtimeConfig().memory;
  const memories = new BaseMemories({chatData, memory});
  const sessions = new Sessions({chatData, memories, memory});
  const base = memories.create({id: 'family', name: 'Family', strategy: 'sqlite'});
  memories.addKnowledge(base.id, {circuits: [{name: 'family', text: FAMILY}], approvedBy: 'admin'});
  return {chatData, memories, sessions, base};
}
const factsOf = (sessions, id) => {
  const repo = sessions.repository(id);
  const s = repo.session('main', 'reader', 'probe');
  const rows = repo.recall(s, {p: 'parent', a: ['?x', '?y'], neg: false}, {asof: Infinity}, {limit: 100}).rows.map(r => r.atom.a.join('>')).sort();
  repo.closeSession(s);
  return rows;
};

test('session: starting clones the base memory into its own folder', t => {
  const {sessions, memories, base} = library(t);
  const s = sessions.create({base: base.id, user: 'alice'});
  assert.match(s.id, /^s-/);
  assert.equal(s.base.id, 'family');
  assert.equal(s.base.strategy, 'sqlite');
  for (const sub of ['repo', 'circuits', 'drafts', 'requests', 'base_circuits', 'agent']) assert.ok(fs.statSync(path.join(sessions.dir(s.id), sub)).isDirectory(), sub);
  assert.equal(sessions.baseCircuits(s.id).length, 1);
  assert.deepEqual(factsOf(sessions, s.id), ['ann>bob', 'bob>cy', 'cy>di']);
  const snap = fs.readdirSync(path.join(sessions.dir(s.id), 'repo/snapshots'))[0];
  assert.ok(fs.statSync(path.join(sessions.dir(s.id), 'repo/snapshots', snap)).nlink >= 2, 'the clone shares the immutable files');
  assert.throws(() => sessions.create({base: 'missing', user: 'alice'}), e => e.status === 404);
  assert.throws(() => sessions.create({base: base.id, user: 'alice', settings: {authoring: 'sometimes'}}), /authoring must be one of/);
  assert.throws(() => sessions.create({base: base.id, user: 'alice', settings: {bogus: 1}}), /Unknown session setting/);
  assert.equal(memories.circuits(base.id).length, 1);
});

test('session: a session is visible to its owner and to an administrator only', t => {
  const {sessions, base} = library(t);
  const s = sessions.create({base: base.id, user: 'alice'});
  assert.equal(sessions.visible(s.id, {user: 'alice'}).id, s.id);
  assert.throws(() => sessions.visible(s.id, {user: 'bob'}), e => e.status === 403);
  assert.equal(sessions.visible(s.id, {user: 'bob', admin: true}).id, s.id);
  assert.equal(sessions.list({user: 'bob'}).length, 0);
  assert.equal(sessions.list({user: 'alice'}).length, 1);
});

test('session: drafts are not knowledge until accepted; accepting adds to the session layer only, base unchanged', t => {
  const {sessions, memories, base} = library(t);
  const s = sessions.create({base: base.id, user: 'alice'});
  const draft = sessions.addDraft(s.id, {name: 'extra', text: EXTRA, request: 'r-1', model: 'stub/model'});
  assert.equal(draft.state, 'draft');
  assert.equal(draft.validation.ok, true);
  assert.deepEqual(factsOf(sessions, s.id), ['ann>bob', 'bob>cy', 'cy>di'], 'a draft is not in the memory');
  assert.doesNotMatch(sessions.theory(s.id), /di eve/);
  const accepted = sessions.acceptDraft(s.id, draft.id, {approvedBy: 'alice'});
  assert.equal(accepted.draft.state, 'accepted');
  assert.equal(accepted.record.approved_by, 'alice');
  assert.equal(accepted.record.ingest.facts_ingested, 1);
  assert.deepEqual(factsOf(sessions, s.id), ['ann>bob', 'bob>cy', 'cy>di', 'di>eve']);
  assert.match(sessions.theory(s.id), /di eve/);
  assert.deepEqual(memories.facts('family').parent.map(r => r.args.join('>')).sort(), ['ann>bob', 'bob>cy', 'cy>di'], 'the base memory did not change');
  assert.throws(() => sessions.acceptDraft(s.id, draft.id, {approvedBy: 'alice'}), e => e.code === 'draft_closed');
  const second = sessions.addDraft(s.id, {name: 'second', text: '@f10 fact\n  holds parent eve fay\n  source "chat"\n'});
  assert.equal(sessions.rejectDraft(s.id, second.id).state, 'rejected');
  assert.throws(() => sessions.acceptDraft(s.id, second.id, {approvedBy: 'alice'}), e => e.code === 'draft_closed');
  assert.equal(sessions.provenance(s.id).length, 1);
});

test('session: an invalid draft stays a draft and cannot be accepted', t => {
  const {sessions, base} = library(t);
  const s = sessions.create({base: base.id, user: 'alice'});
  const bad = sessions.addDraft(s.id, {name: 'bad', text: '@r rule\n  when parent ?x ?y\n'});
  assert.equal(bad.validation.ok, false);
  assert.throws(() => sessions.acceptDraft(s.id, bad.id, {approvedBy: 'alice'}), e => e.code === 'validation_failed');
  assert.equal(sessions.draft(s.id, bad.id).state, 'draft');
  assert.equal(sessions.circuits(s.id).length, 0);
});

test('session: commit makes a new base memory (a fork plus the session circuits), explicit and recorded', t => {
  const {sessions, memories, base} = library(t);
  const s = sessions.create({base: base.id, user: 'alice'});
  assert.throws(() => sessions.commit(s.id, {name: 'x', approvedBy: 'admin'}), e => e.code === 'nothing_to_commit');
  sessions.acceptDraft(s.id, sessions.addDraft(s.id, {name: 'extra', text: EXTRA}).id, {approvedBy: 'alice'});
  assert.throws(() => sessions.commit(s.id, {name: 'x'}), e => e.code === 'approval_required');
  const committed = sessions.commit(s.id, {name: 'Family plus Eve', approvedBy: 'owner', newId: 'family-eve'});
  assert.equal(committed.memory.id, 'family-eve');
  assert.equal(committed.memory.parent.id, 'family');
  assert.deepEqual(memories.facts('family-eve').parent.map(r => r.args.join('>')).sort(), ['ann>bob', 'bob>cy', 'cy>di', 'di>eve']);
  assert.ok(memories.provenance('family-eve').some(p => p.kind === 'commit' && p.approved_by === 'owner' && p.source === `session:${s.id}`));
  assert.equal(memories.facts('family').parent.length, 3, 'the original base memory is untouched');
  assert.equal(sessions.info(s.id).committed_to[0].id, 'family-eve');
  const other = sessions.commit(s.id, {name: 'Exact copy', strategy: 'scan', approvedBy: 'owner'});
  assert.equal(other.memory.strategy, 'scan');
  assert.equal(other.fork_method, 'replay');
  assert.equal(memories.facts(other.memory.id).parent.length, 4);
});

test('session: the transcript is kept and an abandoned session is removed by the cleanup policy', t => {
  const {sessions, chatData, base} = library(t);
  const s = sessions.create({base: base.id, user: 'alice'});
  sessions.appendTranscript(s.id, {role: 'user', text: 'hello'});
  assert.equal(sessions.transcript(s.id)[0].text, 'hello');
  assert.equal(chatData.cleanup({now: Date.now() + 30 * 86400_000, dryRun: true}).sessions.length, 1);
  assert.equal(chatData.cleanup({now: Date.now() + 1000, dryRun: true}).sessions.length, 0);
  const report = chatData.cleanup({now: Date.now() + 30 * 86400_000});
  assert.deepEqual(report.sessions, [s.id]);
  assert.ok(fs.existsSync(path.join(chatData.baseMemoriesDir, 'family')), 'the base memory stays');
});

test('sessions API: create on a base memory, drafts, accept, theory, query, commit (admin), delete', async t => {
  const s = await productServer(t);
  await s.admin('/v1/memories', 'POST', {name: 'Family', id: 'family', strategy: 'hybrid', circuits: [{name: 'family', text: FAMILY}]});
  assert.equal((await s.user('/v1/sessions', 'POST', {})).status, 400);
  assert.equal((await s.user('/v1/sessions', 'POST', {base: 'nope'})).status, 404);
  const created = await s.user('/v1/sessions', 'POST', {base: 'family', name: 'Test chat', settings: {authoring: 'off'}});
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal(created.body.settings.authoring, 'off');
  assert.equal(created.body.base.strategy, 'hybrid');
  assert.equal((await s.user('/v1/sessions')).body.data.length, 1);
  const settings = await s.user(`/v1/sessions/${id}/settings`, 'POST', {authoring: 'always', omp_model: 'xai-oauth/grok-4.20-0309-non-reasoning'});
  assert.equal(settings.body.settings.authoring, 'always');
  assert.equal((await s.user(`/v1/sessions/${id}/settings`, 'POST', {authoring: 'x'})).status, 400);
  const theory = await s.user(`/v1/sessions/${id}/theory`);
  assert.match(theory.body.theory, /@r_grand rule/);
  const query = await s.user(`/v1/sessions/${id}/query`, 'POST', {query: FAMILY_QUERY});
  assert.equal(query.status, 200);
  assert.equal(query.body.answer.status, 'supported');
  // A draft written by the authoring path (here: directly by the library) is accepted by the user and then used by the query.
  const sessionsLib = s.server.sessions ?? null;
  assert.ok(sessionsLib, 'the server exposes its session store for the authoring path');
  const draft = sessionsLib.addDraft(id, {name: 'eve', text: EXTRA});
  assert.equal((await s.user(`/v1/sessions/${id}/drafts`)).body.data.length, 1);
  const accepted = await s.user(`/v1/sessions/${id}/drafts/${draft.id}/accept`, 'POST');
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.draft.state, 'accepted');
  assert.equal((await s.user(`/v1/sessions/${id}/drafts/${draft.id}/accept`, 'POST')).status, 409);
  const grown = await s.user(`/v1/sessions/${id}/query`, 'POST', {query: '@q query\n  where parent di ?who\n  select ?who\n'});
  assert.deepEqual(grown.body.answer.rows?.map?.(r => r.who) ?? grown.body.answer.result?.rows?.map(r => r.who), ['eve']);
  const noAdmin = await s.user(`/v1/sessions/${id}/commit`, 'POST', {name: 'Nope'});
  assert.equal(noAdmin.status, 403);
  const commit = await s.admin(`/v1/sessions/${id}/commit`, 'POST', {name: 'Family plus Eve', id: 'family-eve'});
  assert.equal(commit.status, 201);
  assert.equal(commit.body.memory.parent.id, 'family');
  assert.equal(commit.body.added[0].approved_by, 'admin');
  const view = await s.user(`/v1/sessions/${id}?transcript=1`);
  assert.equal(view.body.committed_to[0].id, 'family-eve');
  assert.ok(Array.isArray(view.body.transcript));
  assert.equal((await s.user(`/v1/sessions/${id}`, 'DELETE')).body.deleted, true);
  assert.equal((await s.user(`/v1/sessions/${id}`)).status, 404);
  assert.equal((await s.user('/v1/sessions', 'PUT')).status, 405);
});

test('chat in a session: its own repository, a transcript, an automatic session without session_id, and isolation', async t => {
  const likes = '@q query\n  where match\n    relation "likes"\n    role subject "Ana"\n    role object "Alpha Lab"\n    polarity affirmed\n  end';
  const formalizer = await mockFormalizer(t, likes);
  const s = await productServer(t, {formalizer});
  await s.admin('/v1/memories', 'POST', {name: 'Family', id: 'family', circuits: [{name: 'family', text: FAMILY}]});
  const a = (await s.user('/v1/sessions', 'POST', {base: 'family'})).body.id;
  const b = (await s.user('/v1/sessions', 'POST', {base: 'family'})).body.id;
  const chat = (extra = {}) => s.user('/v1/chat/completions', 'POST', {model: 'chatsop-local', messages: [{role: 'user', content: 'Does Ana like Alpha Lab?'}], ...extra});
  const first = await chat({session_id: a});
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.chatSop.session.id, a);
  assert.equal(first.body.chatSop.session.base.id, 'family');
  const view = await s.user(`/v1/sessions/${a}?transcript=1`);
  assert.deepEqual(view.body.transcript.map(x => x.role), ['user', 'assistant']);
  assert.ok(fs.readdirSync(path.join(s.chatData.sessionsDir, a, 'agent')).length >= 1, 'the conversation context is stored in the session folder');
  assert.equal((await s.user(`/v1/sessions/${b}?transcript=1`)).body.transcript.length, 0, 'another session is untouched');
  assert.ok(fs.existsSync(path.join(s.chatData.sessionsDir, a, 'repo/sessions')), 'the agent reads and writes the session repository');
  assert.ok(!fs.existsSync(path.join(s.chatData.baseMemoriesDir, 'family', 'repo/sessions')), 'never the base memory');
  assert.equal((await chat({session_id: 'nope'})).status, 404);
  assert.equal((await chat({session_id: 'Bad/Id'})).status, 400);
  const auto = await chat({conversation_id: 'work'});
  assert.equal(auto.status, 200, JSON.stringify(auto.body));
  assert.match(auto.body.chatSop.session.id, /^auto-/);
  assert.equal(auto.body.chatSop.session.base.id, 'default');
  const again = await chat({conversation_id: 'work'});
  assert.equal(again.body.chatSop.session.id, auto.body.chatSop.session.id, 'the same conversation reuses its automatic session');
  assert.ok((await s.user('/v1/memories')).body.data.some(m => m.id === 'default'), 'the empty default base memory exists');
});
