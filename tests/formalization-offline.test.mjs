// The offline per-step formalization regression (tools/eval/formalization-regression/offline.mjs): recorded answers are replayed through
// the current protocol and code with no model; every step is checked and a failure names its first diverging step. The fixture is
// invented text; the books' recordings (local, gitignored) run as a fast tier when present.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {replayCase, runOffline, explain, loadRecordings} from '../tools/eval/formalization-regression/offline.mjs';

// The classic value and formula questions for the fixtures recorded with them (compute and choose go to the decomposition by default).
const decompose = async fn => { const before = process.env.CHATSOP_PROBLEM_PROTOCOL; process.env.CHATSOP_PROBLEM_PROTOCOL = 'decompose'; try { return await fn(); } finally { if (before === undefined) delete process.env.CHATSOP_PROBLEM_PROTOCOL; else process.env.CHATSOP_PROBLEM_PROTOCOL = before; } };
const classic = async fn => { const before = process.env.CHATSOP_PROBLEM_PROTOCOL; process.env.CHATSOP_PROBLEM_PROTOCOL = 'classic'; try { return await fn(); } finally { if (before === undefined) delete process.env.CHATSOP_PROBLEM_PROTOCOL; else process.env.CHATSOP_PROBLEM_PROTOCOL = before; } };
const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/formalization-offline/cases.json', import.meta.url), 'utf8'));
const byId = id => cases.find(c => c.id === id);

test('replayed answers solve compute, choose and deduce problems with no model', () => classic(async () => {
  for (const id of ['fixture/pens', 'fixture/plans', 'fixture/glorp']) {
    const r = await replayCase(byId(id), byId(id).steps);
    assert.equal(r.outcome, 'correct', explain(r));
    assert.ok(r.trace.every(t => t.ok), explain(r));
  }
}));

test('relations between things: who (select), how many (count), a rule over relations, and the closed world of a problem (not shown = no)', async () => {
  for (const id of ['fixture/works', 'fixture/count', 'fixture/grandparent', 'fixture/forced']) {
    const r = await replayCase(byId(id), byId(id).steps);
    assert.ok(['correct', 'undecided'].includes(r.outcome) && r.trace.every(t => t.ok), explain(r));
    if (id === 'fixture/works') assert.match(r.answer + (r.response ?? ''), /Mara|Lena/);
  }
  assert.equal((await replayCase(byId('fixture/grandparent'), byId('fixture/grandparent').steps)).outcome, 'correct');
  assert.equal((await replayCase(byId('fixture/count'), byId('fixture/count').steps)).outcome, 'correct');
  assert.equal((await replayCase(byId('fixture/forced'), byId('fixture/forced').steps)).outcome, 'correct');
});

test('semantic decomposition (stage A): a check with an intermediate value, a choice with a limit, a batch: by registry index only', () => decompose(async () => {
  for (const id of ['fixture/dc-check', 'fixture/dc-choose', 'fixture/dc-batch']) {
    const r = await replayCase(byId(id), byId(id).steps);
    assert.equal(r.outcome, 'correct', explain(r));
  }
}));

test('a failure names its first diverging step: an unreadable answer (reader), a wrong formula (answer at execution)', () => classic(async () => {
  const unread = await replayCase(byId('fixture/unreadable'), byId('fixture/unreadable').steps);
  assert.deepEqual([unread.first.step, unread.first.kind], ['problem_values', 'reader']);
  const wrong = await replayCase(byId('fixture/wrong-formula'), byId('fixture/wrong-formula').steps);
  assert.equal(wrong.outcome, 'wrong');
  assert.deepEqual([wrong.first.step, wrong.first.kind], ['execute', 'answer']);
  assert.match(explain(wrong), /first divergence at execute/);
  // A question the recording does not hold (a protocol change) is a protocol divergence, not a model call.
  const short = await replayCase(byId('fixture/plans'), byId('fixture/plans').steps.slice(0, 3));
  assert.deepEqual([short.first.step, short.first.kind], ['problem_options', 'protocol']);
}));

test('the books recordings replay offline in seconds (fast tier; skipped without the local recordings)', {skip: loadRecordings('tiny').size === 0}, async () => {
  const out = await runOffline({tier: 'tiny', fast: 40});
  assert.ok(out.results.length > 0);
  assert.ok(out.ms < 30_000, `took ${out.ms} ms`);
});

test('the type question of a goal shows the menu filtered by the goal kind (a number goal: chain, batch, breakeven)', () => decompose(async () => {
  const {problemCircuit} = await import('../lib/query-author/step-by-step/problem.mjs');
  const {seedLexicon} = await import('../lib/knowledge-seeds.mjs');
  const asked = [];
  const answers = {problem_kind: '1', dc_registry: 'v1: eggs per box\nv2: eggs', dc_goals: 'g1: boxes | 1', dc_type: '2', dc_batch: 'amount = v2, capacity = v1'};
  const oracle = {async read(name, text, reader) { asked.push({name, text}); const r = reader(answers[name] ?? ''); if (r === null) throw new Error('unreadable'); return r; }};
  const r = await problemCircuit(oracle, {message: 'Boxes hold 12 eggs. A farm collects 150 eggs. How many boxes are needed?', lexicon: seedLexicon('core-min')});
  const type = asked.find(a => a.name === 'dc_type').text;
  assert.match(type, /\n1\. a number computed[^\n]*\n2\. how many whole units[^\n]*\n3\. the amount at which two costs/);
  assert.deepEqual(r.report.types, ['batch']);
}));
