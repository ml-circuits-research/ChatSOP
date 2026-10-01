// Base memories (DS031): the library over every memory strategy and the /v1/memories API.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {ChatData} from '../lib/chat-data/index.mjs';
import {BaseMemories, STRATEGIES, validateCircuits, cloneRepository} from '../lib/chat-data/memories.mjs';
import {FAMILY, FAMILY_QUERY, productServer, runtimeConfig} from './product-helpers.mjs';
import {tempDir} from './helpers.mjs';

const library = t => new BaseMemories({chatData: ChatData.open({chatData: {root: tempDir(t, 'bm-') + '/cd'}}, {}), memory: runtimeConfig().memory});
const family = [{name: 'family', text: FAMILY}];
const parentOf = rows => rows.parent?.map(r => r.args.join('>')).sort();

test('base memory: every memory strategy stores, reads back and forks', t => {
  const bm = library(t);
  assert.deepEqual([...STRATEGIES], ['recall-memory', 'holo-memory', 'sqlite', 'scan', 'hybrid']);
  for (const strategy of STRATEGIES) {
    const m = bm.create({name: 'm-' + strategy, strategy});
    assert.equal(m.strategy, strategy);
    const added = bm.addKnowledge(m.id, {circuits: family, approvedBy: 'admin', reason: 'test'});
    assert.equal(added.added[0].ingest.facts_ingested, 3, strategy);
    assert.deepEqual(parentOf(bm.facts(m.id)), ['ann>bob', 'bob>cy', 'cy>di'], strategy);
    const fork = bm.fork(m.id, {name: 'fork-' + strategy});
    assert.equal(fork.method, 'clone');
    assert.equal(fork.memory.parent.id, m.id);
    assert.deepEqual(parentOf(bm.facts(fork.memory.id)), ['ann>bob', 'bob>cy', 'cy>di'], 'a same-strategy fork reads the same facts');
  }
});

test('base memory: a fork is copy-on-write (hard links) and independent of its parent', t => {
  const bm = library(t);
  const parent = bm.create({name: 'parent', strategy: 'sqlite'});
  bm.addKnowledge(parent.id, {circuits: family, approvedBy: 'admin'});
  const {memory} = bm.fork(parent.id, {name: 'child'});
  const snaps = id => fs.readdirSync(path.join(bm.dir(id), 'repo/snapshots'));
  const file = path.join(bm.dir(parent.id), 'repo/snapshots', snaps(parent.id)[0]);
  assert.ok(fs.statSync(file).nlink >= 2, 'the snapshot file is shared by hard link');
  bm.addKnowledge(memory.id, {circuits: [{name: 'more', text: '@f9 fact\n  holds parent di eve\n  source "t"\n'}], approvedBy: 'admin'});
  assert.equal(bm.facts(memory.id).parent.length, 4);
  assert.equal(bm.facts(parent.id).parent.length, 3, 'the parent did not change');
  assert.equal(bm.circuits(parent.id).length, 1);
  assert.equal(bm.circuits(memory.id).length, 2);
});

test('base memory: a fork that changes the strategy replays the circuits into the new engine', t => {
  const bm = library(t);
  const parent = bm.create({name: 'parent', strategy: 'recall-memory'});
  bm.addKnowledge(parent.id, {circuits: family, approvedBy: 'admin'});
  const {memory, method, rebuilt} = bm.fork(parent.id, {name: 'exact', strategy: 'sqlite'});
  assert.equal(method, 'replay');
  assert.equal(rebuilt.facts_ingested, 3);
  assert.equal(memory.strategy, 'sqlite');
  assert.deepEqual(parentOf(bm.facts(memory.id)), ['ann>bob', 'bob>cy', 'cy>di']);
  assert.ok(bm.provenance(memory.id).some(p => p.kind === 'fork' && p.strategy_to === 'sqlite'));
  assert.throws(() => bm.fork(parent.id, {name: 'x', strategy: 'nonsense'}), /strategy must be one of/);
});

test('base memory: adding knowledge validates, records provenance and writes nothing on failure', t => {
  const bm = library(t);
  const m = bm.create({name: 'k', strategy: 'scan'});
  assert.throws(() => bm.addKnowledge(m.id, {circuits: family}), /approving administrator/);
  const broken = [{name: 'broken', text: '@r1 rule\n  when parent ?x ?y\n'}];
  assert.throws(() => bm.addKnowledge(m.id, {circuits: broken, approvedBy: 'admin'}), e => e.code === 'validation_failed' && e.problems.length > 0);
  for (const text of ['@j jsEval\n  expression 1\n', '@s stated\n  relation "x"\n', '@q query\n  where parent ?x ?y\n  select ?x\n']) {
    assert.throws(() => bm.addKnowledge(m.id, {circuits: [{name: 'bad', text}], approvedBy: 'admin'}), e => e.code === 'validation_failed');
  }
  assert.equal(bm.circuits(m.id).length, 0, 'a failed validation wrote no circuit');
  assert.equal(bm.provenance(m.id).length, 0);
  const withApproval = '@p predicate\n  args subject:entity object:entity\n\n@r rule\n  when p ?x ?y\n  then p ?y ?x\n  approval approved\n';
  assert.ok(validateCircuits([{name: 'a', text: withApproval}]).problems.some(p => p.code === 'governance_field'));
  const ok = bm.addKnowledge(m.id, {circuits: family, approvedBy: 'owner', reason: 'family demo', source: 'smoke case 03'});
  const record = bm.provenance(m.id)[0];
  assert.equal(record.approved_by, 'owner');
  assert.equal(record.reason, 'family demo');
  assert.match(record.sha256, /^[a-f0-9]{64}$/);
  assert.equal(ok.memory.circuits, 1);
  assert.match(bm.theory(m.id), /@r_grand rule/);
  // Another circuit is validated together with the stored ones: a duplicate wire id is refused.
  assert.throws(() => bm.addKnowledge(m.id, {circuits: [{name: 'dup', text: '@f1 fact\n  holds parent x y\n  source "s"\n'}], approvedBy: 'owner'}), e => e.problems.some(p => p.code === 'duplicate_id'));
});

test('base memory: import builds a memory from circuits, all or nothing', t => {
  const bm = library(t);
  const m = bm.importMemory({name: 'imported', strategy: 'hybrid', circuits: family, approvedBy: 'admin', id: 'imp'});
  assert.equal(m.circuits, 1);
  assert.equal(bm.provenance('imp')[0].kind, 'import');
  assert.throws(() => bm.importMemory({name: 'bad', strategy: 'hybrid', circuits: [{name: 'x', text: 'garbage'}], approvedBy: 'admin', id: 'bad-one'}), /validator/);
  assert.ok(!fs.existsSync(bm.dir('bad-one')), 'a failed import leaves nothing behind');
  assert.throws(() => bm.create({name: 'twice', id: 'imp'}), /already exists/);
  assert.throws(() => bm.manifest('missing'), e => e.status === 404);
  assert.throws(() => bm.dir('../etc'), /Invalid/);
});

test('base memory: cloneRepository shares files and does not copy sessions or users', t => {
  const bm = library(t);
  const m = bm.create({name: 'c'});
  bm.addKnowledge(m.id, {circuits: family, approvedBy: 'admin'});
  const to = path.join(tempDir(t), 'clone');
  cloneRepository(path.join(bm.dir(m.id), 'repo'), to);
  assert.deepEqual(fs.readdirSync(path.join(to, 'snapshots')).sort(), fs.readdirSync(path.join(bm.dir(m.id), 'repo/snapshots')).sort());
  assert.ok(!fs.existsSync(path.join(to, 'sessions')));
});

test('memories API: list, create, import, fork, knowledge, admin only for writes', async t => {
  const s = await productServer(t);
  const list = await s.user('/v1/memories');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.data.map(m => m.id), ['default'], 'only the empty default base memory exists at first');
  assert.equal(list.body.strategies.length, 5);
  const denied = await s.user('/v1/memories', 'POST', {name: 'x'});
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, 'forbidden');
  const created = await s.admin('/v1/memories', 'POST', {name: 'Family', strategy: 'holo-memory', description: 'demo', id: 'family'});
  assert.equal(created.status, 201);
  assert.equal(created.body.strategy, 'holo-memory');
  const added = await s.admin('/v1/memories/family/knowledge', 'POST', {circuits: [{name: 'family', text: FAMILY}], reason: 'api test'});
  assert.equal(added.status, 200);
  assert.equal(added.body.added[0].approved_by, 'admin');
  const bad = await s.admin('/v1/memories/family/knowledge', 'POST', {circuits: [{name: 'bad', text: '@x rule\n  when nothing\n'}]});
  assert.equal(bad.status, 422);
  assert.equal(bad.body.error.code, 'validation_failed');
  assert.ok(bad.body.error.problems.length);
  const forked = await s.admin('/v1/memories/family/fork', 'POST', {name: 'Family exact', strategy: 'sqlite'});
  assert.equal(forked.status, 201);
  assert.equal(forked.body.method, 'replay');
  assert.equal(forked.body.memory.parent.id, 'family');
  const view = await s.user(`/v1/memories/${forked.body.memory.id}?facts=1`);
  assert.equal(view.status, 200);
  assert.equal(view.body.stored_facts.parent.length, 3);
  assert.ok(view.body.provenance.length >= 1);
  const imported = await s.admin('/v1/memories', 'POST', {name: 'Imported', circuits: [{name: 'f', text: FAMILY}]});
  assert.equal(imported.status, 201);
  assert.equal(imported.body.circuits, 1);
  assert.equal((await s.user('/v1/memories')).body.data.length, 4);
  assert.equal((await s.user('/v1/memories/missing')).status, 404);
  assert.equal((await s.admin('/v1/memories', 'POST', {name: 'x', surprise: 1})).status, 400);
  assert.equal((await s.admin('/v1/memories', 'POST', {name: 'x', strategy: 'nope'})).status, 400);
  assert.equal((await s.call('/v1/memories')).status, 401, 'authentication is required');
  const caps = await s.user('/v1/capabilities');
  assert.ok(caps.body.endpoints.some(e => e.path === '/v1/memories/{id}/fork'));
  const removed = await s.admin('/v1/memories/family', 'DELETE');
  assert.equal(removed.body.deleted, true);
});

test('family circuits answer the family query through the exact oracle (the theory a base memory stores)', async t => {
  const bm = library(t);
  const m = bm.create({name: 'oracle', strategy: 'sqlite'});
  bm.addKnowledge(m.id, {circuits: family, approvedBy: 'admin'});
  const {ask} = await import('../reasoning/strategies/js-reference/index.mjs');
  const answer = await ask({theory: {knowledge: bm.theory(m.id)}, query: FAMILY_QUERY}, {});
  assert.equal(answer.status, 'supported');
  assert.deepEqual(answer.rows?.map?.(r => r.who) ?? answer.result?.rows?.map(r => r.who), ['ann']);
});
