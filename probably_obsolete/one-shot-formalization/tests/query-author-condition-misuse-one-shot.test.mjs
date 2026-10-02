// ARCHIVED 2026-10-02 (one-shot formalization obsolete): the authorQuery tests of the test file of the same base name. Not run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Repository} from '../memory/repository.mjs';
import {ingestFacts} from '../lib/chat-data/memories.mjs';
import {Lexicon} from '../sop/lexicon.mjs';
import {Theory, askMemory} from '../reasoning/slice/wire.mjs';
import {AuthorRuntime} from '../lib/query-author/runtime.mjs';
import {authorQuery, validateQuery} from '../lib/query-author/index.mjs';
import {tempDir} from './helpers.mjs';

function memory(t, knowledge) {
  const circuits = [{name: 'test-memory', text: knowledge}];
  const repo = new Repository(tempDir(t, 'condition-misuse-'), {memory: {engine: 'sqlite'}});
  repo.init('base');
  ingestFacts(repo, 'base', knowledge, {knownAt: Date.parse('2020-01-01')});
  const session = repo.session('base', 'test', 'turn');
  const lexicon = Lexicon.fromCircuits(circuits), theory = new Theory(circuits);
  return {repo, session, lexicon, theory, circuits,
    ask: (condition, extra = '', options = {}) => askMemory({repo, session, lexicon, theory,
      query: `@q query\n  mode exists\n  where ${condition}\n${extra}`, ...options}),
    run: (sop, message) => new AuthorRuntime({repo, session, lexicon, schema: lexicon.predicates, circuits, policy: {reinforce: false}})
      .run(sop, {origin: 'model', inputText: message})};
}

for (const id of ['f2-dev-096', 'f2-dev-048', 'f2-dev-090']) {
  test(`saved ${id} circuit is repairable misuse, never a confident negative`, async t => {
    const read = file => fs.readFileSync(new URL(`./fixtures/condition-misuse/${id}/${file}`, import.meta.url), 'utf8');
    const m = memory(t, read('knowledge.sop')), authored = read('authored.sop'), message = read('question.txt');
    const admitted = validateQuery({...m, sop: authored, message});
    assert.equal(admitted.ok, false);
    assert.ok(admitted.problems.some(p => p.code === 'condition_misuse' && p.predicate === 'department_pay'));
    const result = await m.run(authored, message);
    const packet = result.result.packet;
    assert.equal(packet.status, 'unknown');
    assert.equal(packet.reason, 'condition_misuse');
    assert.ok(packet.misuses.some(p => p.predicate === 'department_pay' && p.position === 2 && p.values.length));
    const gold = askMemory({...m, query: read('query.sop')});
    assert.equal(gold.status, 'supported');
    assert.deepEqual(gold.rows, JSON.parse(read('expected.json')).rows);
  });
}

const KNOWLEDGE = `@assigned predicate
  args subject:entity object:entity
  closed true
  label en "assigned to"
@pay predicate
  args subject:entity object:integer
  closed true
@ada entity
  kind person
  label en "Ada"
@bea entity
  kind person
  label en "Bea"
@cal entity
  kind person
  label en "Cal"
@lab entity
  kind organization
  label en "Lab"
@office entity
  kind organization
  label en "Office"
@a fact
  holds assigned ada lab
@b fact
  holds assigned bea office
@p fact
  holds pay ada 10
@derived predicate
  args subject:entity object:entity
@derived_rule rule
  when assigned ?x ?y
  then derived ?x ?y
`;

test('author repair receives condition misuse with memory positions, without an execution preview', async t => {
  const m = memory(t, KNOWLEDGE);
  const bad = '@q query\n  where match\n    relation "assigned"\n    role subject "Lab"\n    role object "Ada"\n    polarity affirmed\n  end\n';
  const good = bad.replace('role subject "Lab"', 'role subject "Ada"').replace('role object "Ada"', 'role object "Lab"');
  const result = await authorQuery({...m, message: 'Is Ada assigned to Lab?', maxFixRounds: 1,
    vocabularyDialog: false, backend: {id: 'saved-circuit-repair', kind: 'completion', generate: async ({history}) => {
      if (!history.length) return {ok: true, sop: bad};
      assert.ok(history.at(-1).problems.some(p => p.code === 'condition_misuse' && p.values.includes('ada')));
      return {ok: true, sop: good};
    }}, execute: async () => { throw new Error('repair must not execute an answer-shape preview'); }});
  assert.equal(result.status, 'validated');
  assert.equal(result.rounds, 2);
  const packet = (await m.run(result.sop, 'Is Ada assigned to Lab?')).result.packet;
  assert.equal(packet.status, 'supported');
});
