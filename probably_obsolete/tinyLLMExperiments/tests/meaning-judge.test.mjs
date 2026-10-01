import test from 'node:test';
import assert from 'node:assert/strict';
import {TYPES, makePick, names} from '../tools/datasets/meaning-judge/perturb.mjs';
import {wilson} from '../tools/datasets/meaning-judge/score-calibration.mjs';
import {applyLlmTargets, resetLlm, LLM_TARGET_SOURCE} from '../tools/datasets/three-datasets/llm-targets.mjs';

test('perturbations are deterministic and change the text', () => {
  const text = 'Does Ana work at Lidl before 2019? Mihai manages the Cluj office.';
  for (const [type, fn] of Object.entries(TYPES)) {
    const a = fn(text, makePick('seed')), b = fn(text, makePick('seed'));
    assert.equal(a, b, type);
    if (a !== null) assert.notEqual(a, text, type);
  }
  assert.ok(TYPES.change_number_date(text, makePick('x')));
  assert.match(TYPES.flip_negation('Tisa is not in Cluj.', makePick('y')), /Tisa is in Cluj/);
  assert.deepEqual(names('Does Ana know Mihai Pop?').map(n => n.text), ['Ana', 'Mihai Pop']);
});

test('wilson interval', () => {
  const [lo, hi] = wilson(97, 100);
  assert.ok(lo > 0.91 && lo < 0.93 && hi > 0.98 && hi < 0.995);
  assert.deepEqual(wilson(0, 0), [null, null]);
});

test('llm target merge is idempotent and keeps existing targets', () => {
  const rows = () => [
    {id: 'a', message: 'Ana lucreaza la spital?', language_kind: 'ro', target: null, targets: [], flags: ['no_target'], review_status: 'not_reviewed'},
    {id: 'b', message: 'hello there', language_kind: 'mixed', target: null, targets: [], flags: ['no_target'], review_status: 'not_reviewed'},
    {id: 'c', message: 'xx', language_kind: 'ro', target: 'Existing.', target_source: 'noise-inverse', targets: [{text: 'Existing.', source: 'noise-inverse'}], review_status: 'not_reviewed'},
    {id: 'd', message: 'asdf', language_kind: 'ro', target: null, targets: [], flags: ['no_target'], review_status: 'not_reviewed'},
  ];
  const llm = new Map([
    ['a', {kind: 'ro', message: 'Ana lucreaza la spital?', target: 'Does Ana work at the hospital?', unfixable: false}],
    ['b', {kind: 'mixed', message: 'hello there', target: null, unfixable: true, reason: 'message is already clean plain English'}],
    ['c', {kind: 'ro', message: 'xx', target: 'Other.', unfixable: false}],
    ['d', {kind: 'ro', message: 'asdf', target: null, unfixable: true, reason: 'keyboard mash, no recoverable words'}],
  ]);
  const r = rows();
  const counts = applyLlmTargets(r, llm);
  assert.equal(counts.merged, 2);
  assert.equal(counts.message_is_target, 1);
  assert.equal(counts.unfixable, 1);
  assert.equal(r[0].target_source, LLM_TARGET_SOURCE);
  assert.equal(r[0].review_status, 'pending');
  assert.equal(r[1].target, 'hello there');
  assert.equal(r[2].target, 'Existing.');
  assert.ok(r[3].flags.includes('llm_unfixable') && r[3].flags.includes('no_target'));
  const once = JSON.stringify(r);
  applyLlmTargets(r, llm);
  assert.equal(JSON.stringify(r), once);
  resetLlm(r[0]);
  assert.equal(r[0].target, null);
});
