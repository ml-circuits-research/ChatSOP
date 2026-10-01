import test from 'node:test';
import assert from 'node:assert/strict';
import {translateAnswer, segmentsOf} from '../lib/translator-service/answer.mjs';
import {protect, restore} from '../lib/ud-to-sop/protect.mjs';

const LONG = ['Answers: person, engineer and mathematician.',
  'Ada Lovelace is a person (memory: Wikidata Q7259 P31).',
  'Ada Lovelace is a mathematician (memory: Wikidata Q7259 P106).',
  'The search was not exhaustive, so more answers may exist.'].join('\n');

test('a long answer is translated per line, each line on its own, and joined in order', async () => {
  const seen = [];
  const out = await translateAnswer(LONG, 'ro', {url: 'stub://t', chat: async (u, messages) => { seen.push(messages.at(-1).content); return {text: 'RO ' + messages.at(-1).content, ms: 1}; }});
  assert.equal(seen.length, 4);
  assert.equal(out.segments, 4);
  assert.equal(out.text.split('\n').length, 4);
  assert.match(out.text, /^RO Answers: person/);
  assert.match(out.text, /Wikidata Q7259 P31/, 'source identifiers are restored');
  assert.doesNotMatch(seen.join(' '), /Q7259|P106/, 'Q and P identifiers reach the model only as placeholders');
});

test('segments: long lines split at sentence ends, short ones stay whole', () => {
  const long = Array.from({length: 12}, (_, i) => `Sentence number ${i} says something quite long here.`).join(' ');
  const parts = segmentsOf('One.\n' + long);
  assert.ok(parts.length > 2);
  assert.equal(parts.map(p => p.text + p.join).join(''), 'One.\n' + long);
});

test('the time budget bounds the translation: past it the call fails with budget_exhausted and never hangs', async () => {
  const started = Date.now();
  await assert.rejects(translateAnswer(LONG, 'ro', {url: 'stub://t', budgetMs: 60, concurrency: 1,
    chat: async (u, m, {timeoutMs}) => { await new Promise(r => setTimeout(r, 40)); if (timeoutMs <= 0) throw new Error('timeout'); return {text: m.at(-1).content, ms: 40}; }}), {code: 'budget_exhausted'});
  assert.ok(Date.now() - started < 1000);
});

test('input masking with names: false lets the translator see inflected names and protects the rest', () => {
  for (const text of ['Care este capitala Franței?', 'Unde s-a născut Albert Einstein?', 'Cine este Parisului?', 'Care e capitala Braziliei?', 'A scris lui Einstein o scrisoare.']) {
    assert.deepEqual(protect(text, {names: false}).slots, [], text);
  }
  const masked = protect('Spune "Ana" la https://x.org/a și 3 km, vezi works_at.', {names: false});
  assert.deepEqual(masked.slots.map(s => s.value).sort(), ['"Ana"', '3 km', 'https://x.org/a', 'works_at'].sort());
  assert.equal(restore(masked.text, masked.slots).preserved, true);
  assert.equal(protect('Care este capitala Franței?').slots.length > 0, true, 'the default still masks capitalized runs (English path)');
});
