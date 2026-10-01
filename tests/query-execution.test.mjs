// End-to-end execution of the query forms (tools/eval/query-surface/execute.mjs): a message goes through SymbolicLM
// (recorded parses, tests/fixtures/query-forms/execution-parses.json), a hand-made lexicon links the model program to
// atoms, and js-reference answers it on a small knowledge base. The grouping `select` of `mode every` ("Which teams have
// only certified players?") is decided per group by the oracle (it ignored the grouping until 2026-10-01).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {executeAll, CASES, FIXTURE} from '../tools/eval/query-surface/execute.mjs';

const skip = !fs.existsSync(FIXTURE) && 'no fixture';

test('every query form answers end to end on the oracle', {skip}, async () => {
  const results = await executeAll();
  assert.equal(results.length, CASES.length);
  for (const r of results) {
    if (r.knownGap) { assert.match(r.circuit, /mode every[\s\S]*select \?g/, r.id); continue; }
    assert.equal(r.ok, true, `${r.id}: ${r.detail}`);
  }
  const forms = new Set(results.filter(r => r.ok).map(r => r.form));
  for (const form of ['count', 'quantified', 'why', 'why_not', 'abduce', 'plan', 'what_if', 'temporal', 'comparative', 'negated', 'conform', 'procedure']) assert.ok(forms.has(form), `form ${form} executed`);
});

test('the modes of work are declined by the oracle, never answered', {skip}, async () => {
  const results = await executeAll();
  for (const id of ['conform', 'procedure']) assert.match(results.find(r => r.id === id).detail, /declines honestly/);
});
