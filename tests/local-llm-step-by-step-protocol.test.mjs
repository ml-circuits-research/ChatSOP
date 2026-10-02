import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../tools/eval/symbolic-vs-llm/world.mjs';
import {createOracle} from '../lib/query-author/step-by-step/index.mjs';
import {protocolQuery, METHODS, MAX_QUESTIONS, PROTOCOL_PREFIX} from '../lib/query-author/step-by-step/protocol.mjs';
import {KINDS, MESSAGE_ACTS, EMOTIONS, PRAGMATIC_DESCRIPTIONS} from '../lib/query-author/step-by-step/questions.mjs';
import {PRAGMATIC_KINDS} from '../sop/enums.mjs';
import {STEP_BY_STEP_METHODS, stepPrefix} from '../lib/formalize/strategies.mjs';
import {FIRST_TURN_PREFIX} from '../lib/query-author/step-by-step/prompts.mjs';
import {pairedBootstrap, decide} from '../tools/eval/stepbystep-protocol/summarize.mjs';

const kind = name => String(KINDS.findIndex(f => f[0] === name) + 1);
const entity = (id, label = id.replaceAll('_', ' ')) => `@${id} entity\n  kind entity\n  label en "${label}"\n  alias en "${id}"\n`;
const pred = (id, args, label, description, closed = false) => `@${id} predicate\n  args ${args}\n  label en "${label}"\n  description "${description}"\n${closed ? '  closed true\n' : ''}`;
let n = 0;
const fact = atom => `@f${++n} fact\n  holds ${atom}\n`;

/** A scripted oracle: each rule answers the first matching question; unmatched questions get "0"; every question is recorded. */
function scripted(rules) {
  const asked = [];
  const chat = async messages => {
    const question = messages.at(-1).content;
    asked.push(question);
    const rule = rules.find(r => r.when.test(question));
    return {ok: true, text: rule ? (typeof rule.say === 'function' ? rule.say(question) : rule.say) : '0', ms: 1, usage: {input_tokens: 10, output_tokens: 1}, cached: 8, evaluated: 2};
  };
  return {chat, asked};
}
const lineOf = (question, words) => question.split('\n').find(l => /^\d+\./.test(l) && l.includes(words))?.match(/^(\d+)\./)?.[1];

const act = name => String(KINDS.length + MESSAGE_ACTS.findIndex(a => a[0] === name) + 1);

test('no hardcoded understanding: the protocol has no cue table, and its choice lists cover the closed pragmatic kinds', async () => {
  const fs = await import('node:fs');
  const dir = new URL('../lib/query-author/step-by-step/', import.meta.url);
  assert.ok(!fs.existsSync(new URL('cues.mjs', dir)) && !fs.existsSync(new URL('clauses.mjs', dir)), 'the regex cue table and the connective splitter are gone');
  assert.deepEqual(Object.keys(PRAGMATIC_DESCRIPTIONS).sort(), [...PRAGMATIC_KINDS].sort());
  for (const [kind] of [...MESSAGE_ACTS.filter(a => !['emotion', 'plain'].includes(a[0])), ...EMOTIONS]) assert.ok(PRAGMATIC_KINDS.includes(kind), kind);
});

test('a greeting alone is one question and a pragmatic wire, with no query', async () => {
  const world = teamWorld();
  try {
    const {chat, asked} = scripted([{when: /Which kind of answer/, say: `${kind('none')}, ${act('greeting')}`}]);
    const r = await protocolQuery({message: 'Hello!', lexicon: world.lexicon, repo: world.repo, session: world.session, oracle: createOracle({chat}), method: 'B'});
    assert.equal(r.status, 'validated', JSON.stringify(r.validation?.problems));
    assert.equal(asked.length, 1);
    assert.equal(r.sop, '@p1 pragmatic\n  kind greeting\n  source local_llm_step_by_step\n  basis llm\n');
  } finally { world.dispose(); }
});

test('courtesy and an emotion next to a question become pragmatic wires next to the query', async () => {
  const world = teamWorld();
  try {
    const {chat} = scripted([
      {when: /Which kind of answer/, say: `${kind('count')}, ${act('thanks')}, ${act('emotion')}`},
      {when: /Which feeling does the message show/, say: q => lineOf(q, 'frustration')},
      {when: /Which statements does/, say: q => lineOf(q, 'member of the team')},
      {when: /Which of these says what the request asks/, say: '3'},
    ]);
    const r = await protocolQuery({message: 'Again: how many people are members of the Falcon team? Thanks.', lexicon: world.lexicon, repo: world.repo, session: world.session, oracle: createOracle({chat}), method: 'B'});
    assert.equal(r.status, 'validated', JSON.stringify(r.validation?.problems));
    assert.match(r.sop, /mode count/);
    assert.match(r.sop, /@p1 pragmatic\n  kind thanks\n/);
    assert.match(r.sop, /@p2 pragmatic\n  kind frustration\n/);
  } finally { world.dispose(); }
});

test('the methods have byte-identical cached prefixes and the strategy registry lists them', () => {
  assert.deepEqual(STEP_BY_STEP_METHODS, ['A', ...Object.keys(METHODS)]);
  assert.equal(stepPrefix('A'), FIRST_TURN_PREFIX);
  for (const m of Object.keys(METHODS)) assert.equal(stepPrefix(m), PROTOCOL_PREFIX);
  assert.ok(PROTOCOL_PREFIX.startsWith('Kinds of answer') && PROTOCOL_PREFIX.includes('What a message can also do') && PROTOCOL_PREFIX.includes('Parts a request can have') && PROTOCOL_PREFIX.endsWith('<<<\n'));
  assert.doesNotMatch(PROTOCOL_PREFIX, /\d{4}-\d{2}-\d{2}T/, 'no clock or request data in the prefix');
});

function teamWorld() {
  n = 0;
  return createWorld([entity('falcon', 'Falcon'), entity('orbit', 'Orbit'), entity('ana_pop', 'Ana Pop'), entity('ion_rus', 'Ion Rus'), entity('eva_lup', 'Eva Lup'),
    pred('member_of', 'subject:entity object:entity', 'member of the team', 'A person (subject) is a member of the team (object, a team).', true),
    pred('joined_year', 'subject:entity object:integer', 'joined in year', 'A person (subject) joined in the year (object).', true),
    fact('member_of ana_pop falcon'), fact('member_of ion_rus falcon'), fact('member_of eva_lup orbit'),
    fact('joined_year ana_pop 2004'), fact('joined_year ion_rus 2009'), fact('joined_year eva_lup 2001')].join(''));
}

test('a name recorded in one place of a statement and the asked unknown are placed without a question (observed role fit)', async () => {
  const world = teamWorld();
  try {
    const {chat, asked} = scripted([
      {when: /Which kind of answer/, say: kind('count')},
      {when: /Which parts from the list/, say: '0'},
      {when: /Which statements does/, say: q => lineOf(q, 'member of the team')},
      {when: /Which of these says what the request asks/, say: '3'},
    ]);
    const r = await protocolQuery({message: 'How many people are members of the Falcon team?', lexicon: world.lexicon, repo: world.repo, session: world.session, oracle: createOracle({chat}), method: 'D'});
    assert.equal(r.status, 'validated', JSON.stringify(r.validation?.problems));
    assert.match(r.sop, /mode count/);
    assert.match(r.sop, /relation "member_of"\n\s+role subject \?x\n\s+role object "falcon"/);
    assert.ok(!asked.some(q => /what are A and B/.test(q)), 'no places question');
    assert.ok(r.steps.length <= MAX_QUESTIONS);
  } finally { world.dispose(); }
});

test('a two-sided comparison uses the statement once per name and compares the two values', async () => {
  const world = teamWorld();
  try {
    const {chat} = scripted([
      {when: /Which kind of answer/, say: kind('yesno')},
      {when: /Which parts from the list/, say: '6'},
      {when: /How are they compared/, say: q => lineOf(q, 'smaller, earlier')},
      {when: /Which statements does/, say: q => lineOf(q, 'joined in year')},
      {when: /Which of these says what the request asks/, say: q => q.includes('neither') ? '3' : '1'},
    ]);
    const r = await protocolQuery({message: 'Did Ana Pop join earlier than Ion Rus?', lexicon: world.lexicon, repo: world.repo, session: world.session, oracle: createOracle({chat}), method: 'D'});
    assert.equal(r.status, 'validated', JSON.stringify(r.validation?.problems));
    assert.match(r.sop, /role subject "ana_pop"\n\s+role object \?a\n/);
    assert.match(r.sop, /role subject "ion_rus"\n\s+role object \?b\n/);
    assert.match(r.sop, /compare \?a below \?b/);
  } finally { world.dispose(); }
});

test('a limit on a count per group becomes an aggregate session definition and a comparison', async () => {
  const world = teamWorld();
  try {
    const {chat} = scripted([
      {when: /Which kind of answer/, say: kind('list')},
      {when: /Which parts from the list/, say: '1'},
      {when: /Which limit does the request set with the number 1/, say: q => lineOf(q, 'more than 1')},
      {when: /Which statements does/, say: q => lineOf(q, 'member of the team')},
      {when: /what are A and B|which is [AB] in the request/, say: q => /what are A and B/.test(q) ? `A: ${lineOf(q, 'anything')}\nB: ${lineOf(q, 'asks for')}` : lineOf(q, 'asks for')},
      {when: /What does it limit/, say: q => lineOf(q, '(a count)')},
      {when: /Which of these says what the request asks/, say: q => q.includes('Which X are there such that') ? lineOf(q, 'Which X are there such that') : '3'},
    ]);
    const r = await protocolQuery({message: 'List the teams that have more than 1 member.', lexicon: world.lexicon, repo: world.repo, session: world.session, oracle: createOracle({chat}), method: 'D'});
    assert.equal(r.status, 'validated', JSON.stringify(r.validation?.problems));
    assert.match(r.sop, / aggregate\n\s+over member_of \?m \?g\n\s+group \?g\n\s+count \?m as \?n/);
    assert.match(r.sop, /compare \?n1 above 1/);
  } finally { world.dispose(); }
});

test('the old yes/no confirmation is kept as the B-yesno ablation and the budget bounds every dialog', async () => {
  const world = teamWorld();
  try {
    const {chat, asked} = scripted([
      {when: /Which kind of answer/, say: kind('count')},
      {when: /Which statements does/, say: q => lineOf(q, 'member of the team')},
      {when: /Is this what the request asks/, say: 'yes'},
    ]);
    const r = await protocolQuery({message: 'How many people are members of the Falcon team?', lexicon: world.lexicon, repo: world.repo, session: world.session, oracle: createOracle({chat}), method: 'B-yesno'});
    assert.equal(r.status, 'validated');
    assert.equal(r.confirmed, true);
    assert.ok(asked.some(q => /Is this what the request asks/.test(q)));
    await assert.rejects(protocolQuery({message: 'x', lexicon: world.lexicon, oracle: createOracle({chat}), method: 'Z'}), /unknown step-by-step method/);
  } finally { world.dispose(); }
});

test('the paired bootstrap and the preregistered stop rules', () => {
  const b = pairedBootstrap([1, 1, 1, 0, 1, 0, 1, 1, 1, 1]);
  assert.equal(b.point, 0.8);
  assert.ok(b.low > 0 && b.high <= 1);
  assert.equal(decide({point: 0.3, low: 0.1, high: 0.5}, 2, 2), 'decisive');
  assert.equal(decide({point: 0.3, low: 0.1, high: 0.5}, 5, 2), 'undecided', 'more wrong answers block a decisive stop');
  assert.equal(decide({point: 0, low: -0.1, high: 0.04}, 0, 0), 'futility');
  assert.equal(decide({point: 0.3, low: 0.1, high: 0.5}, 0, 0, {failedShare: 0.3}), 'broken');
});
