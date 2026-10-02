// The small-talk collections (config/knowledge/smalltalk-*-v1, tools/smalltalk/build.mjs; DS022 "Composing a base memory"): each
// loads alone (it imports conversation-v1) or with the others, passes the knowledge validator, uses only the slots its situations get,
// and the JS oracle chooses its replies by the layer's own data: new situations by pragmatic kind and priority, the variants that name
// the memory's topics, the formal register of smalltalk-professional-v1 outranking its base, and the answer still first.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {SEEDS_DIR, seedCircuits, seedInfo} from '../lib/knowledge-seeds.mjs';
import {indexLayer, fill} from '../sop/replies.mjs';
import {chooseReplies, turnFacts} from '../lib/conversation/index.mjs';
import {COLLECTIONS, TAXONOMY, checkCollections, items, nearDuplicate, distinct, diverse} from '../tools/smalltalk/build.mjs';

const ids = Object.values(COLLECTIONS).map(c => c.id);
const layerOf = list => indexLayer(['conversation-v1', ...list].flatMap(id => seedCircuits(id).map(c => ({name: `${id}:${c.file}`, text: c.text}))), list.join('+') || 'conversation-v1');
const DEFAULT = ['smalltalk-core-v1', 'smalltalk-empathy-v1', 'smalltalk-self-v1', 'smalltalk-playful-v1'];
const courtesy = (...kinds) => turnFacts({status: 'courtesy', pragmatic: kinds.map(kind => ({kind, score: 1}))}, {});

test('the collections pass the knowledge validator alone and together, use only their slots and have no priority ties', () => {
  assert.deepEqual(checkCollections(), []);
});

test('every collection has a manifest with licence, provenance (inspired-by, no text copied) and counts that match its wires', () => {
  for (const id of ids) {
    assert.ok(fs.existsSync(path.join(SEEDS_DIR, id, 'seed.json')), id);
    const info = seedInfo(id);
    assert.deepEqual(info.imports, ['conversation-v1'], `${id} loads alone over conversation-v1`);
    assert.equal(info.role, 'conversation');
    assert.ok(info.licence && info.provenance?.inspired_by?.length && info.provenance.inspired_by.every(x => x.text_copied === false), id);
    const replies = seedCircuits(id).flatMap(c => [...c.text.matchAll(/^@\S+ reply$/gm)]).length;
    assert.equal(info.counts.replies, replies, `${id} counts its replies`);
    assert.ok(replies > 0, `${id} holds replies`);
  }
  assert.equal(seedInfo('smalltalk-professional-v1').group, 'register');
});

test('the oracle picks the collections\' situations by the layer\'s data: kinds, priorities, topics variants, the answer first', () => {
  const layer = layerOf(DEFAULT);
  assert.equal(chooseReplies(courtesy('grief'), {layer, seed: 1}).body.situation, 'empathy_grief');
  assert.equal(chooseReplies(courtesy('greeting', 'grief'), {layer, seed: 1}).body.situation, 'empathy_grief', 'grief outranks a greeting');
  assert.equal(chooseReplies(courtesy('greeting', 'how_are_you'), {layer, seed: 1}).body.situation, 'smalltalk_how_are_you');
  assert.equal(chooseReplies(courtesy('crisis', 'sadness'), {layer, seed: 1}).body.situation, 'empathy_crisis');
  assert.equal(chooseReplies(courtesy('ask_abilities'), {layer, seed: 1}).body.situation, 'self_abilities');
  const withTopics = turnFacts({status: 'courtesy', pragmatic: [{kind: 'ask_abilities'}]}, {topics: ['cities']});
  assert.equal(chooseReplies(withTopics, {layer, seed: 1}).body.situation, 'self_abilities_topics');
  assert.equal(chooseReplies(courtesy('greeting'), {layer, seed: 1}).body.situation, 'courtesy_greeting', 'without the professional collection the base situation is used');
  const answered = chooseReplies(turnFacts({status: 'supported', rows: [{x: 'paris'}], pragmatic: [{kind: 'how_are_you'}]}, {answerText: 'A.'}), {layer, seed: 1});
  assert.equal(answered.body.situation, 'answer_found', 'an answer still outranks small talk');
  assert.equal(answered.opening.situation, 'open_how_are_you');
  assert.equal(chooseReplies(turnFacts({status: 'unclear', unclear_kind: 'relation_not_in_memory'}, {}), {layer, seed: 1}).body.situation, 'relation_missing');
});

test('loading smalltalk-professional-v1 makes the formal register win; smalltalk-playful-v1 adds variants to the same situations', () => {
  const pro = layerOf([...DEFAULT.filter(id => id !== 'smalltalk-playful-v1'), 'smalltalk-professional-v1']);
  const greet = chooseReplies(courtesy('greeting'), {layer: pro, seed: 1});
  assert.equal(greet.body.situation, 'courtesy_greeting_formal');
  assert.ok(greet.body.why.some(l => l.includes('stf_r_formal')), 'the derivation names the register rule');
  assert.equal(chooseReplies(courtesy('grief'), {layer: pro, seed: 1}).body.situation, 'empathy_grief_formal');
  const plain = layerOf(['smalltalk-core-v1']), playful = layerOf(['smalltalk-core-v1', 'smalltalk-playful-v1']);
  assert.ok(playful.bySituation.get('courtesy_greeting').length > plain.bySituation.get('courtesy_greeting').length);
});

test('every reply of the collections fills from the slots its situation gets', () => {
  const slots = {topics: 'cities and rivers', readings: '(1) a\n(2) b', mention: 'Socrate', candidate: 'Socrates', candidate_description: 'a philosopher', relations: '"born in"', aside_fact: 'Paris is in France.'};
  for (const id of ids) for (const r of layerOf([id]).replies.values()) if (r.part !== 'line') assert.doesNotThrow(() => fill(r.text, slots, r.situation), `${r.id}`);
});

test('the build is deterministic structure: items name only allowed slots, the diversity filter drops near duplicates', () => {
  const its = items();
  assert.equal(its.length, TAXONOMY.situations.length);
  for (const it of its) for (const s of it.required) assert.ok(it.allowed.includes(s), `${it.id}: required slot ${s} is allowed`);
  assert.ok(nearDuplicate('Hello! What can I do for you?', 'Hello! What can I do for you today?'));
  assert.ok(!nearDuplicate('Hello! What can I do for you?', 'Good to see you. Ask me anything.'));
  assert.deepEqual(diverse(['Hi there, what can I look up?', 'Hi there, what can I look up for you?', 'Good evening.'], {cap: 5}).kept, ['Hi there, what can I look up?', 'Good evening.']);
  assert.ok(distinct(['a b c', 'a b d'], 1) < 1 && distinct(['a b c', 'd e f'], 2) === 1);
});
