// Courtesy and emotion in the chat turn (DS023): the formalizer writes them as `pragmatic` wires in the same understanding step;
// the reply and the tone are rendered from the wires. There is no word list or pattern pre-step (AGENTS.md "No hardcoded understanding").
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Agent} from '../server/agent.mjs';
import {courtesyReply, toneAnswer} from '../sop/pragmatic-text.mjs';
import {context, lex} from './helpers.mjs';

const ASK = '@q query\n  where match\n    relation "work at"\n    role subject "Ana"\n    role object "Alpha Lab"\n    polarity affirmed\n  end\n';
const wire = (id, kind, span = null) => `@${id} pragmatic\n  kind ${kind}\n${span ? `  span ${JSON.stringify(span)}\n` : ''}  basis llm\n`;

/** An agent over a fresh repository whose formalizer returns a fixed SOP and records every message it receives. */
function agentWith(t, sop) {
  const c = context({});
  t.after(c.dispose);
  const seen = [];
  const agent = new Agent({repo: c.repo, session: c.session, lexicon: lex, config: {}});
  return {agent, seen, formalizer: {id: 'fake', formalize: async message => { seen.push(message); return sop; }}};
}

test('the lexicon pre-step is gone: the formalizer reads every message, including a bare greeting', async t => {
  assert.equal(fs.existsSync(new URL('../lib/emotion-detection', import.meta.url)), false);
  const {agent, seen, formalizer} = agentWith(t, wire('p1', 'greeting', 'hello'));
  const hello = await agent.turn('hello', {formalizer});
  assert.deepEqual(seen, ['hello']);
  assert.equal(hello.text, 'Hello! What would you like to know?');
  assert.equal(hello.packet.status, 'courtesy');
  assert.equal(hello.packet.pragmatic[0].kind, 'greeting');
  assert.deepEqual(hello.userStatements, []);
  assert.match(hello.executionSop, /@p1 pragmatic\n {2}kind greeting/);
});

test('thanks written as `unclear no_request` plus its pragmatic wire is a courtesy reply too', async t => {
  const {agent, formalizer} = agentWith(t, `@u unclear\n  kind no_request\n\n${wire('p1', 'thanks')}`);
  const result = await agent.turn('thanks!', {formalizer});
  assert.equal(result.text, "You're welcome.");
  assert.equal(result.packet.status, 'courtesy');
});

test('a greeting and frustration next to a question set the tone; the message reaches the formalizer whole', async t => {
  const message = 'Hi, this is the third time I ask: does Ana work at Alpha Lab?';
  const {agent, seen, formalizer} = agentWith(t, `${wire('p1', 'greeting', 'Hi')}\n${ASK}\n${wire('p2', 'frustration', 'this is the third time I ask')}`);
  const result = await agent.turn(message, {formalizer});
  assert.deepEqual(seen, [message]);
  assert.match(result.text, /^Hello! Sorry for the trouble\. /);
  assert.notEqual(result.packet.status, 'courtesy');
  assert.deepEqual(result.packet.pragmatic.map(s => s.kind), ['greeting', 'frustration']);
  assert.deepEqual(result.packet.pragmatic_use.applied, ['courtesy:greeting', 'apology']);
  assert.deepEqual(result.userStatements, [], 'a pragmatic signal never becomes a statement');
});

test('a span that is not in the message is rejected at admission', async t => {
  const {agent, formalizer} = agentWith(t, `${ASK}\n${wire('p1', 'thanks', 'many thanks')}`);
  await assert.rejects(agent.turn('does Ana work at Alpha Lab?', {formalizer}), /pragmatic_span_not_in_message/);
});

test('the reply and tone templates render the closed kinds only from the packet', () => {
  assert.equal(courtesyReply([{kind: 'thanks'}, {kind: 'greeting'}]), "Hello! What would you like to know? You're welcome.");
  assert.match(courtesyReply([{kind: 'confusion'}]), /^Sorry for the confusion\./);
  assert.equal(courtesyReply([]), 'What would you like to know?');
  assert.deepEqual(toneAnswer('Yes.\nProof: ...', [{kind: 'urgency'}]), {text: 'Yes.', applied: ['shortened']});
  assert.deepEqual(toneAnswer('Which one?', [{kind: 'greeting'}], 'clarify'), {text: 'Which one?', applied: []});
});
