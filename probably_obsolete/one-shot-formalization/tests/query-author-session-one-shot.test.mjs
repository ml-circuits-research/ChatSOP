// ARCHIVED 2026-10-02 (one-shot formalization obsolete): the authorQuery tests of the test file of the same base name. Not run.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ChatData} from '../lib/chat-data/index.mjs';
import {BaseMemories} from '../lib/chat-data/memories.mjs';
import {Sessions} from '../lib/chat-data/sessions.mjs';
import {SessionRuntimes} from '../server/session-runtime.mjs';
import {Theory, askMemory} from '../reasoning/slice/index.mjs';
import {authorQuery, validateQuery} from '../lib/query-author/index.mjs';
import {admitCircuits} from '../lib/query-author/session.mjs';
import {AuthorRuntime} from '../lib/query-author/runtime.mjs';
import {tempDir} from './helpers.mjs';

const KNOWLEDGE = `@employee predicate
  args subject:entity
  closed true
@eligible predicate
  args subject:entity
@away predicate
  args subject:entity
@ada entity
  kind entity
  label en "Ada"
@bea entity
  kind entity
  label en "Bea"
@e1 fact
  holds employee ada
@e2 fact
  holds employee bea
@a1 fact
  holds away bea
@not_eligible fact
  holds not eligible bea
@typically_eligible default
  when employee ?x
  then eligible ?x
  except away ?x
@workforce predicate
  args subject:integer
@headcount aggregate
  over employee ?person
  count ?person as ?n
  yields workforce ?n
`;
const match = (p, who = '?person') => `  where match\n    relation "${p}"\n    role subject ${who}\n    polarity affirmed\n  end\n`;
const QUERY = `@q query\n  select ?person\n${match('eligible')}`;
function fixture(t) {
  const data = ChatData.open({chatData: {root: tempDir(t, 'author-session-')}}, {}, process.cwd());
  const memories = new BaseMemories({chatData: data, memory: {engine: 'sqlite'}});
  memories.create({id: 'work', name: 'Work', strategy: 'sqlite'});
  memories.addKnowledge('work', {circuits: [{name: 'people', text: KNOWLEDGE}], approvedBy: 'test'});
  const sessions = new Sessions({chatData: data, memories, memory: {engine: 'sqlite'}});
  sessions.create({base: 'work', user: 'test', id: 'turn'});
  const runtime = new SessionRuntimes({sessions, memories, config: {policy: {reinforce: false}}});
  const opened = runtime.open('turn', {user: 'test'});
  return {sessions, memories, opened, agent: opened.entry('test').agent};
}
const turn = (agent, sop, message = 'Who is eligible?') => agent.turn(message, {formalizer: {id: 'test-author', formalize: async () => sop}});

test('authoring skips execution-shape feedback unless explicitly enabled', async t => {
  const f = fixture(t);
  for (const options of [{}, {selfCheck: false}]) {
    let calls = 0;
    const r = await authorQuery({
      message: 'Who is eligible?', lexicon: f.agent.lexicon, circuits: f.sessions.baseCircuits('turn'),
      backend: {id: 'one-round', kind: 'completion', generate: async () => {
        calls++;
        if (calls > 1) throw new Error('unexpected self-check round');
        return {ok: true, sop: QUERY, usage: {turns: 1}};
      }},
      execute: async () => { throw new Error('unexpected execution-shape preview'); },
      maxFixRounds: 0, ...options,
    });
    assert.equal(r.ok, true);
    assert.equal(r.sop, QUERY);
    assert.equal(r.rounds, 1);
    assert.equal(calls, 1);
    assert.equal(r.self_check, undefined);
  }
});

test('one shape-only self-check revises a wrong circuit and rejects an invalid revision', async t => {
  const f = fixture(t);
  const responses = [QUERY.replace('eligible', 'employee'), QUERY];
  const contexts = [];
  const backend = {id: 'test', kind: 'completion', async generate(request) { contexts.push(request); return {ok: true, sop: responses.shift(), usage: {turns: 1}}; }};
  const execute = async sop => (await turn(f.agent, sop)).packet;
  const r = await authorQuery({message: 'Who is eligible?', lexicon: f.agent.lexicon, circuits: f.sessions.baseCircuits('turn'), backend, execute, selfCheck: true, maxFixRounds: 0});
  assert.equal(r.self_check.status, 'revised');
  assert.equal(r.rounds, 2);
  assert.match(contexts[1].history.at(-1).problems[0].message, /cardinality.*2/);
  assert.doesNotMatch(contexts[1].history.at(-1).problems[0].message, /"ada"|"bea"/);
  assert.deepEqual((await execute(r.sop)).answers.map(x => x.binding['?person']), ['ada']);
  const invalid = await authorQuery({message: 'Who is eligible?', lexicon: f.agent.lexicon, circuits: f.sessions.baseCircuits('turn'), execute, selfCheck: true, maxFixRounds: 0, backend: {id: 'bad', kind: 'completion', generate: async ({history}) => ({ok: true, sop: history.length ? '@q query\n  where bogus\n' : QUERY, usage: {}})}});
  assert.equal(invalid.ok, false);
  assert.equal(invalid.self_check.status, 'invalid');
});

test('count self-check exposes one scalar result, not its numerical answer', async t => {
  const f = fixture(t);
  const sop = `@q query\n  mode count\n${match('employee')}`;
  const r = await authorQuery({message: 'How many employees are there?', lexicon: f.agent.lexicon, circuits: f.sessions.baseCircuits('turn'), maxFixRounds: 0, selfCheck: true, execute: async source => (await turn(f.agent, source)).packet, backend: {id: 'count', kind: 'completion', generate: async () => ({ok: true, sop, usage: {}})}});
  assert.deepEqual(Object.keys(r.self_check.shape).sort(), ['cardinality', 'circuit', 'status']);
  assert.equal(r.self_check.shape.cardinality, 1);
});

