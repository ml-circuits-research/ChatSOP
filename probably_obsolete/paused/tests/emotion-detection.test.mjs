// EmotionDetectionSystem (DS023): the component, the symbolic strategy, the pragmatic wire, the reasoner advice and
// the chat turn's courtesy short-circuit and tone. The strategies other than the symbolic one were removed; the generic costly-strategy budget is tested with a fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmotionDetectionSystem, createDefaultEmotionDetectionSystem, createSymbolicStrategy, classifyLeftovers, adviceFor, signalsToSop, loadConfig} from '../lib/emotion-detection/index.mjs';
import {courtesyReply} from '../lib/emotion-detection/courtesy.mjs';
import {parse, validateGraph} from '../sop/parser.mjs';
import {PRAGMATIC_KINDS} from '../sop/enums.mjs';
import {Agent} from '../server/agent.mjs';
import {context, lex} from './helpers.mjs';

const system = (extra = {}) => createEmotionDetectionSystem({strategies: [createSymbolicStrategy()], ...extra});
const kinds = async (message, options) => (await system().detect(message, options)).signals.map(s => s.kind);

test('the symbolic strategy recognizes courtesy, urgency and hedges in English and Romanian', async () => {
  assert.deepEqual((await kinds('Hello! Could you please tell me where Ana works? Thanks a lot!!!')).sort(), ['emphasis', 'greeting', 'politeness', 'thanks']);
  assert.ok((await kinds('I need it ASAP')).includes('urgency'));
  assert.ok((await kinds('Maybe Maria works at Alpha Lab.')).includes('hedge'));
  assert.ok((await kinds('Bună ziua! Vă rog, unde lucrează Ana? Mulțumesc mult.')).includes('greeting'));
  assert.ok((await kinds('Vă rog, unde lucrează Ana?')).includes('politeness'));
  assert.ok((await kinds('Cred că Ana lucrează la Alpha Lab.')).includes('hedge'));
  assert.ok((await kinds('Mulțumesc mult!')).includes('thanks'));
  assert.ok((await kinds('Am nevoie urgent de adresă')).includes('urgency'));
});

test('tag questions, discourse markers, frustration and swearing', async () => {
  assert.ok((await kinds('Maria works at Alpha Lab, right?')).includes('confirmation_request'));
  assert.ok((await kinds('Maria lucrează la Alpha Lab, nu-i așa?')).includes('confirmation_request'));
  assert.ok((await kinds('By the way, who leads the choir?')).includes('topic_shift'));
  assert.ok((await kinds('Ugh, again? Why is it still not working')).includes('frustration'));
  assert.ok((await kinds('This is bullshit')).includes('profanity'));
  assert.ok((await kinds('You are so stupid')).includes('offensive'));
  const irony = (await system().detect('Yeah right, the train is always on time.')).signals.find(s => s.kind === 'irony_possible');
  assert.ok(irony && irony.score <= 0.5, 'irony is a soft signal');
});

test('neutral messages, Romanian modal "poate" and acronyms produce no signal', async () => {
  for (const m of ['Where does Ana work?', 'Ana poate conduce echipa.', 'Marie Curie died in 1934.', 'Is the NASA budget approved?', 'Cine conduce proiectul Delta?']) assert.deepEqual(await kinds(m), [], m);
});

test('a signal carries kind, label, score, span, source and basis, and spans are verbatim', async () => {
  const message = 'Ugh, thanks anyway';
  const {signals} = await system().detect(message);
  for (const s of signals) {
    assert.ok(PRAGMATIC_KINDS.includes(s.kind));
    assert.equal(typeof s.label, 'string'); assert.ok(s.score > 0 && s.score <= 1);
    assert.equal(s.source, 'symbolic'); assert.ok(['lexicon', 'pattern'].includes(s.basis));
    assert.ok(message.includes(s.span), `${s.span} is a verbatim part of the message`);
  }
});

test('the default system suggests an emoji per kind for the UI, and every kind has one', async () => {
  const config = loadConfig();
  for (const kind of PRAGMATIC_KINDS) assert.ok(config.kindEmoji[kind], `${kind} has an emoji`);
  const {signals} = await createDefaultEmotionDetectionSystem(config).detect('Thanks a lot!');
  assert.equal(signals[0].emoji, config.kindEmoji.thanks);
});

test('a disabled system returns no signal and runs nothing; it can be toggled', async () => {
  const off = system({enabled: false});
  assert.deepEqual((await off.detect('Hello, thanks!')).signals, []);
  off.setEnabled(true);
  assert.ok((await off.detect('Hello, thanks!')).signals.length);
});

test('leftover spans that signals explain are classified; the others stay unparsed', async () => {
  const result = await system().detect('Hi! Ugh, again?! Where does Ana work?', {leftoverSpans: [{span: 'Hi!'}, {span: 'again'}, {span: 'where Ana'}]});
  assert.deepEqual(result.leftovers.classified.map(c => c.span).sort(), ['Hi!', 'again']);
  assert.deepEqual(result.leftovers.remaining, [{span: 'where Ana'}]);
  assert.ok(result.signals.some(s => s.kind === 'greeting' && s.leftover));
  const direct = classifyLeftovers([{span: 'by the way'}, {span: 'blue van'}], result.signals.concat([{kind: 'topic_shift', span: 'by the way'}]));
  assert.equal(direct.classified.length, 1);
});

test('kindPolicy off drops a kind, experimental marks it, and a failing or slow costly strategy never blocks', async () => {
  const sys = createEmotionDetectionSystem({strategies: [createSymbolicStrategy()], kindPolicy: {'symbolic.thanks': 'off', 'symbolic.greeting': 'experimental'}});
  const {signals} = await sys.detect('Hello, thanks!');
  assert.deepEqual(signals.map(s => s.kind), ['greeting']);
  assert.equal(signals[0].experimental, true);
  const slow = {id: 'slow', cost: 'costly', detect: () => new Promise(r => setTimeout(() => r([{kind: 'anger', label: 'x', score: 0.9, source: 'slow', basis: 'classifier'}]), 300))};
  const broken = {id: 'broken', cost: 'costly', detect: async () => { throw new Error('boom'); }};
  const guarded = createEmotionDetectionSystem({strategies: [createSymbolicStrategy(), slow, broken], latencyBudgetMs: 30});
  const r = await guarded.detect('Where does Ana work and I am confused why');
  assert.ok(r.trace.strategies.find(x => x.id === 'slow').error.includes('latency budget'));
  assert.equal(r.trace.strategies.find(x => x.id === 'broken').error, 'boom');
  assert.ok(!r.signals.some(s => s.source === 'slow'));
});

test('a costly strategy is skipped when the symbolic signals already cover the message, and its signals merge otherwise', async () => {
  let calls = 0;
  const neural = {id: 'fake', cost: 'costly', detect: async () => { calls++; return [{kind: 'sadness', label: 'sadness', score: 0.8, source: 'fake', basis: 'classifier'}]; }};
  const sys = createEmotionDetectionSystem({strategies: [createSymbolicStrategy(), neural]});
  const covered = await sys.detect('Thank you so much');
  assert.equal(calls, 0);
  assert.equal(covered.trace.strategies.find(x => x.id === 'fake').skipped, 'covered_by_symbolic');
  const open = await sys.detect('The roof is gone and nothing remains');
  assert.equal(calls, 1);
  assert.deepEqual(open.signals.map(s => [s.kind, s.source]), [['sadness', 'fake']]);
});

test('signals render as pragmatic wires that parse, pass the graph check and use fresh ids', async () => {
  const {signals} = await system().detect('Hi! Where does Ana work, please? Thanks!');
  const sop = signalsToSop(signals, {taken: new Set(['p1'])});
  const program = parse(sop);
  validateGraph(program);
  assert.ok(program.wires.every(w => w.type === 'pragmatic' && w.id !== 'p1'));
  assert.equal(signalsToSop([]), '');
  assert.throws(() => signalsToSop([{kind: 'annoyed', score: 0.5, source: 'x', basis: 'lexicon'}]), /unknown pragmatic kind/);
});

test('advice: courtesy only, urgency, frustration, hedge, irony, tag question, topic shift', () => {
  const sig = (kind, extra = {}) => ({kind, score: 0.9, ...extra});
  assert.equal(adviceFor([sig('greeting'), sig('thanks')], {hasContent: false}).courtesyOnly, true);
  assert.equal(adviceFor([sig('greeting')], {hasContent: true}).courtesyOnly, false);
  const urgent = adviceFor([sig('urgency')]);
  assert.deepEqual([urgent.answerStyle, urgent.thinkingLevel, urgent.strategyHint], ['short', 'low', 'fast']);
  assert.equal(adviceFor([sig('frustration')]).recheckInterpretation, true);
  assert.equal(adviceFor([sig('confusion')]).offerClarification, true);
  assert.deepEqual(adviceFor([sig('hedge', {span: 'I think'})]).hedgedSpans, ['I think']);
  assert.equal(adviceFor([sig('irony_possible')]).requireConfirmation, true);
  assert.equal(adviceFor([sig('confirmation_request')]).confirmAnswerFirst, true);
  assert.equal(adviceFor([sig('topic_shift')]).resetReferences, true);
  assert.equal(adviceFor([{kind: 'urgency', score: 0.2}]).strategyHint, null, 'a signal under minScore is ignored');
  assert.equal(adviceFor([sig('profanity')]).courtesyOnly, false);
});

test('the default configuration: enabled, symbolic is the only strategy', () => {
  const config = loadConfig();
  assert.equal(config.enabled, true);
  assert.equal(config.strategies.symbolic.enabled, true);
  assert.deepEqual(Object.keys(config.strategies), ['symbolic'], 'the neural and LLM strategies were removed');
  assert.deepEqual(createDefaultEmotionDetectionSystem(config).strategyIds(), ['symbolic']);
});

test('courtesy replies are deterministic host text in English and Romanian', () => {
  assert.equal(courtesyReply([{kind: 'thanks', score: 0.9}]), "You're welcome.");
  assert.match(courtesyReply([{kind: 'greeting', score: 0.9}, {kind: 'thanks', score: 0.9}]), /^You're welcome\. Hello!/);
  assert.equal(courtesyReply([{kind: 'thanks', score: 0.9}], 'ro'), 'Cu plăcere.');
});

const ASK = '@q query\n  where match\n    relation "work at"\n    role subject "Ana"\n    role object "Alpha Lab"\n    polarity affirmed\n  end';
/** An agent over a fresh repository whose formalizer returns a fixed SOP and records every message it receives. */
async function agentWith(t, sop) {
  const c = context({});
  t.after(c.dispose);
  const seen = [];
  const agent = new Agent({repo: c.repo, session: c.session, lexicon: lex, config: {}});
  return {agent, seen, formalizer: {id: 'fake', formalize: async message => { seen.push(message); return sop; }}};
}

test('chat turn: "hello" and "thanks!" are answered at once, with no formalizer call and no wire shown', async t => {
  const {agent, seen, formalizer} = await agentWith(t, '@u unclear\n  kind no_request');
  const hello = await agent.turn('hello', {formalizer});
  assert.equal(hello.text, 'Hello! What would you like to know?');
  assert.equal(hello.packet.status, 'courtesy');
  assert.equal(hello.packet.localized, true);
  assert.deepEqual(hello.trace, []);
  assert.match(hello.executionSop, /@p1 pragmatic\n {2}kind greeting/);
  assert.equal((await agent.turn('thanks!', {formalizer})).text, "You're welcome.");
  assert.equal(seen.length, 0);
});

test('chat turn: a Romanian greeting is answered in Romanian', async t => {
  const {agent, seen, formalizer} = await agentWith(t, ASK);
  const reply = await agent.turn('bună ziua', {formalizer});
  assert.equal(reply.text, 'Bună! Cu ce te pot ajuta?');
  assert.equal(reply.packet.language, 'ro');
  assert.equal(reply.pragmatic.language, 'ro');
  assert.equal(seen.length, 0);
});

test('chat turn: a pure "I\'m confused" gets a clarifying reply without a formalizer call', async t => {
  const {agent, seen, formalizer} = await agentWith(t, ASK);
  const reply = await agent.turn("I'm confused", {formalizer});
  assert.match(reply.text, /^Sorry for the confusion\./);
  assert.equal(reply.packet.reply_kind, 'reaction');
  assert.ok(reply.packet.pragmatic.some(s => s.kind === 'confusion'));
  assert.equal(seen.length, 0);
});

test('chat turn: a greeting before a question is recorded and stripped for the formalizer, and the answer opens with a courtesy phrase', async t => {
  const {agent, seen, formalizer} = await agentWith(t, ASK);
  const result = await agent.turn('Hi, does Ana work at Alpha Lab?', {formalizer});
  assert.deepEqual(seen, ['does Ana work at Alpha Lab?']);
  assert.match(result.text, /^Hello! /);
  assert.notEqual(result.packet.status, 'courtesy');
  assert.equal(result.packet.pragmatic[0].kind, 'greeting');
  assert.deepEqual(result.packet.pragmatic_use.applied, ['courtesy:greeting']);
  assert.equal(result.packet.pragmatic_use.message_for_formalizer, 'does Ana work at Alpha Lab?');
  assert.match(result.executionSop, /@p1 pragmatic/);
  assert.equal(result.pragmatic.advice.courtesyOnly, false);
});

test('chat turn: frustration and a question is answered, with a brief apology; the message is not stripped', async t => {
  const {agent, seen, formalizer} = await agentWith(t, ASK);
  const message = 'this is the third time I ask, does Ana work at Alpha Lab??';
  const result = await agent.turn(message, {formalizer});
  assert.deepEqual(seen, [message]);
  assert.match(result.text, /^Sorry for the trouble\. /);
  assert.ok(result.packet.pragmatic.some(s => s.kind === 'frustration'));
  assert.equal(result.pragmatic.advice.recheckInterpretation, true);
});

test('chat turn: urgency shortens the answer to its first line; pragmatic signals never become facts', async t => {
  const {agent, formalizer} = await agentWith(t, ASK);
  const result = await agent.turn('Does Ana work at Alpha Lab? asap', {formalizer});
  assert.ok(!result.text.includes('\n'));
  assert.deepEqual(result.userStatements, []);
  assert.deepEqual(result.pragmatic.advice.strategyHint, 'fast');
});

test('chat turn: `unclear no_request` from the formalizer is a natural reply, never the raw verdict', async t => {
  const {agent, formalizer} = await agentWith(t, '@u unclear\n  kind no_request');
  const result = await agent.turn('ok then', {formalizer});
  assert.equal(result.text, 'What would you like to know?');
  assert.equal(result.unclear, 'no_request');
  assert.equal(result.packet.localized, true);
  assert.ok(!/@u|unclear/.test(result.text));
  const ro = await agent.turn('bine atunci', {formalizer});
  assert.equal(ro.text, 'Ce ai vrea să afli?', 'a Romanian message gets the invitation in Romanian');
});

test('chat turn: without signals the turn is unchanged (no pragmatic field), and emotion: false turns the component off', async t => {
  const {agent, seen, formalizer} = await agentWith(t, ASK);
  const plain = await agent.turn('Does Ana work at Alpha Lab?', {formalizer});
  assert.equal(plain.pragmatic, undefined);
  assert.equal(plain.packet.pragmatic, undefined);
  const off = await agent.turn('hello', {formalizer, emotion: false});
  assert.equal(seen.at(-1), 'hello');
  assert.equal(off.packet.pragmatic, undefined);
});
