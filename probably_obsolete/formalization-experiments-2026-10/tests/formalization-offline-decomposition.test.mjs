// ARCHIVED 2026-10-03 (probably_obsolete/formalization-experiments-2026-10/README.md): the stage-A semantic decomposition tests split out
// of tests/formalization-offline.test.mjs; their fixtures are fixtures/formalization-offline/decomposition-cases.json. History only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {replayCase, explain} from '../tools/eval/formalization-regression/offline.mjs';

const decompose = async fn => { const before = process.env.CHATSOP_PROBLEM_PROTOCOL; process.env.CHATSOP_PROBLEM_PROTOCOL = 'decompose'; try { return await fn(); } finally { if (before === undefined) delete process.env.CHATSOP_PROBLEM_PROTOCOL; else process.env.CHATSOP_PROBLEM_PROTOCOL = before; } };
const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/formalization-offline/decomposition-cases.json', import.meta.url), 'utf8'));
const byId = id => cases.find(c => c.id === id);

test('semantic decomposition (stage A): a check with an intermediate value, a choice with a limit, a batch: by registry index only', () => decompose(async () => {
  for (const id of ['fixture/dc-check', 'fixture/dc-choose', 'fixture/dc-batch']) {
    const r = await replayCase(byId(id), byId(id).steps);
    assert.equal(r.outcome, 'correct', explain(r));
  }
}));

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
