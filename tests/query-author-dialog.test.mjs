import test from 'node:test';
import assert from 'node:assert/strict';
import {ChatData} from '../lib/chat-data/index.mjs';
import {BaseMemories} from '../lib/chat-data/memories.mjs';
import {Sessions} from '../lib/chat-data/sessions.mjs';
import {SessionRuntimes} from '../server/session-runtime.mjs';
import {createQueryParser, queryParserSettings} from '../server/query-parser.mjs';
import {authorQuery, buildContext} from '../lib/query-author/index.mjs';
import {Lexicon} from '../sop/lexicon.mjs';
import {tempDir} from './helpers.mjs';

const KNOWLEDGE = `@edge predicate
  args subject:entity object:entity
  closed true
@ada entity
  kind entity
  label en "Ada"
@bea entity
  kind entity
  label en "Bea"
@road fact
  holds edge ada bea
`;
const circuits = [{name: 'roads', text: KNOWLEDGE}];
const lexicon = Lexicon.fromCircuits(circuits);
const UNCLEAR = '@u unclear\n  kind relation_not_in_memory\n';
const match = (p, subject, object) => `@q query\n  where match\n    relation "${p}"\n    role subject ${subject}\n    role object ${object}\n    polarity affirmed\n  end\n`;
const DEFINITION = '@path predicate\n  args subject:entity object:entity\n@direct_path rule\n  when edge ?x ?y\n  then path ?x ?y\n' + match('path', '"Ada"', '"Bea"');
const sequence = responses => ({id: 'deterministic-author', kind: 'completion', model: 'test', generate: async () => ({ok: true, sop: responses.shift() ?? UNCLEAR, usage: {turns: 1}})});

function fixture(t, backend, extra = '') {
  const data = ChatData.open({chatData: {root: tempDir(t, 'vocabulary-dialog-')}}, {}, process.cwd());
  const memories = new BaseMemories({chatData: data, memory: {engine: 'sqlite'}});
  memories.create({id: 'roads', name: 'Roads', strategy: 'sqlite'});
  memories.addKnowledge('roads', {circuits: [...circuits, ...(extra ? [{name: 'attributes', text: extra}] : [])], approvedBy: 'test'});
  const sessions = new Sessions({chatData: data, memories, memory: {engine: 'sqlite'}});
  sessions.create({base: 'roads', user: 'test', id: 'turn'});
  const runtimes = new SessionRuntimes({sessions, memories, config: {policy: {reinforce: false}, queryParser: {selfCheck: false}}});
  const agent = runtimes.open('turn', {user: 'test'}).entry('test').agent;
  const parser = createQueryParser({settings: queryParserSettings({queryParser: {backend: {kind: 'completion'}, maxFixRounds: 0}}), backendFactory: () => backend});
  return {agent, parser, sessions, memories};
}

test('a vocabulary refusal becomes a validated turn rule, labelled answer and unaccepted draft', async t => {
  const f = fixture(t, sequence([UNCLEAR, DEFINITION]));
  let parse;
  const r = await f.agent.turn('Can Ada reach Bea?', {formalizer: {id: 'test', formalize: async message => {
    const authored = await f.parser.parse({message, lexicon: f.agent.lexicon, memoryKey: 'roads'});
    parse = authored.parse;
    return authored.sop;
  }}});
  assert.equal(r.packet.status, 'supported');
  assert.match(r.text, /definition by coding agent/);
  assert.equal(parse.vocabulary_dialog.rounds, 1);
  assert.equal(parse.retrieval.neighbourhood.hops, 2);
  assert.ok(parse.retrieval.neighbourhood.predicates.some(p => p.id === 'edge' && p.examples.length));
  assert.equal(f.sessions.draft('turn', r.packet.session_circuits.draft_id).status, 'proposed');
  assert.equal(f.sessions.circuits('turn').length, 0);
  assert.equal(f.memories.circuits('roads').length, 1);
  const later = await f.agent.turn('Can Ada reach Bea?', {formalizer: {id: 'test', formalize: async () => match('path', '"Ada"', '"Bea"')}});
  assert.equal(later.packet.status, 'clarify');
});

test('unknown predicates enter the dialog but cannot override accepted memory', async () => {
  const r = await authorQuery({message: 'Can Ada reach Bea?', lexicon, circuits, backend: sequence([
    match('path', '"Ada"', '"Bea"'), '@edge predicate\n  args subject:entity object:entity\n' + match('edge', '"Ada"', '"Bea"')
  ]), maxFixRounds: 0});
  assert.equal(r.ok, false);
  assert.ok(r.validation.problems.some(p => p.code === 'duplicate_id'));
  assert.equal(r.vocabulary_dialog.rounds, 1);
});

test('persistent vocabulary refusal stops after two extra rounds and remains honest', async () => {
  const r = await authorQuery({message: 'Can Ada reach Bea?', lexicon, circuits, backend: sequence([]), maxFixRounds: 0});
  assert.equal(r.unclear, 'relation_not_in_memory');
  assert.equal(r.rounds, 3);
  assert.equal(r.vocabulary_dialog.rounds, 2);
  assert.equal(r.circuits.some(c => c.role === 'definition'), false);
});

test('confirmed position misuse triggers repair and cannot be overridden by an execution preview', async t => {
  const wrong = '@q query\n  select ?who\n  where match\n    relation "edge"\n    role subject ?who\n    role object "Ada"\n    polarity affirmed\n  end\n';
  const correct = '@q query\n  select ?who\n  where match\n    relation "edge"\n    role subject "Ada"\n    role object ?who\n    polarity affirmed\n  end\n';
  const f = fixture(t, sequence([wrong, correct]));
  let parse;
  const r = await f.agent.turn('Who is connected to Ada?', {formalizer: {id: 'test', formalize: async message => {
    const authored = await f.parser.parse({message, lexicon: f.agent.lexicon, memoryKey: 'roads'});
    parse = authored.parse;
    return authored.sop;
  }}});
  assert.deepEqual(r.packet.answers.map(a => a.binding['?who']), ['bea']);
  const nonempty = await authorQuery({message: 'Who is connected to Ada?', lexicon, circuits, backend: sequence([wrong]), maxFixRounds: 0,
    vocabularyDialog: false, execute: async () => { throw new Error('misuse must be rejected before an execution preview'); }});
  assert.equal(nonempty.ok, false);
  assert.ok(nonempty.validation.problems.some(p => p.code === 'condition_misuse'));
});

test('a surface-name integer-role mismatch receives schema feedback before answer execution', async t => {
  const wrong = '@q query\n  select ?n\n  where match\n    relation "weight"\n    role subject ?n\n    role object "Ada"\n    polarity affirmed\n  end\n';
  const correct = '@q query\n  select ?n\n  where match\n    relation "weight"\n    role subject "Ada"\n    role object ?n\n    polarity affirmed\n  end\n';
  const f = fixture(t, sequence([wrong, correct]), '@weight predicate\n  args subject:entity object:integer\n@load fact\n  holds weight ada 10\n');
  let parse;
  const r = await f.agent.turn('What weight does Ada carry?', {formalizer: {id: 'test', formalize: async message => {
    const authored = await f.parser.parse({message, lexicon: f.agent.lexicon, memoryKey: 'weights'});
    parse = authored.parse;
    return authored.sop;
  }}});
  assert.deepEqual(r.packet.answers.map(a => a.binding['?n']), [10]);
  assert.equal(parse.vocabulary_dialog.rounds, 1);
});

test('UTF-8 vocabulary budgets bound examples and supplementary schema together', () => {
  const big = Lexicon.fromCircuits([...circuits, {name: 'more', text: Array.from({length: 50}, (_, i) => `@extra_${i} predicate\n  args subject:entity\n  description "${'é'.repeat(80)}"\n`).join('')}]);
  for (const budget of [1024, 4096, 24000]) {
    const c = buildContext({message: 'Can Ada reach Bea?', lexicon: big, circuits, maxVocabularyBytes: budget});
    const bytes = c.files.filter(f => /^input\/(candidates|entities|vocabulary)\.md$/.test(f.path)).reduce((n, f) => n + Buffer.byteLength(f.text), 0);
    assert.ok(bytes <= budget, `${bytes} exceeds ${budget}`);
    assert.equal(c.retrieval.bytes, bytes);
  }
});
