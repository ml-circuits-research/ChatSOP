// LanguagesUtil jargon detector and protector (lib/languages-util/jargon.mjs, proposal of the translate-compare study 2026-10-01).
// Uses a tiny stub of the spellfix word lists, so the test does not load the 1 GB dictionaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import {detectJargon, protectJargon, restoreJargon, discoverJargon, hasSpan} from '../lib/languages-util/jargon.mjs';

const en = new Set(['review', 'gate', 'tests', 'the', 'and', 'wires', 'model', 'train']);
const ro = new Set(['fa', 'un', 'si', 'pune', 'inainte', 'de', 'antrenare', 'nu', 'trece', 'pe', 'fire', 'teste', 'complet', 'calitatea', 'cind', 'ai']);
const ranks = {en: new Map(), ro: new Map()};
const spellfix = {dict: {en, ro}, ranks, known: w => en.has(w) || ro.has(w), freq: new Map(), perMillion: {en: 1, ro: 1}};

test('detectJargon flags code-like tokens, English words in Romanian text and capitalised project terms', () => {
  const found = detectJargon('fa un review complet si pune @docs/wire_types.html pe SymbolicLM inainte de antrenare', {spellfix});
  const by = Object.fromEntries(found.map(s => [s.text, s.reason]));
  assert.equal(by['@docs/wire_types.html'], 'code');
  assert.equal(by.review, 'english');
  assert.equal(by.SymbolicLM, 'capitalised');
  assert.equal(by.pune, undefined);
});

test('an ordinary Romanian word is flagged only through the reviewed list', () => {
  assert.equal(detectJargon('pune fire noi', {spellfix}).length, 0);
  const found = detectJargon('pune fire noi', {spellfix, listed: new Set(['fire'])});
  assert.deepEqual(found.map(s => [s.text, s.reason]), [['fire', 'listed']]);
});

test('a probable typo of a known word is not quoted, a word with no known neighbour is', () => {
  assert.equal(detectJargon('calitatea inainte de antrenare, nu trece cidn ai', {spellfix, reasons: ['unknown']}).length, 0);
  assert.deepEqual(detectJargon('fa un qxzvwkb nu trece', {spellfix, reasons: ['unknown']}).map(s => s.text), ['qxzvwkb']);
});

test('protectJargon quotes the spans and restoreJargon puts the originals back inside the quotes a translator kept', () => {
  const text = 'pune "gate" nu trece pe @docs/a_b.md inainte';
  const p = protectJargon(text, {spellfix, listed: new Set(['gate'])});
  assert.equal(p.text, text.replace('@docs/a_b.md', '"@docs/a_b.md"'));
  const restored = restoreJargon('put the "Gate" does not pass on "@docs/a_b.md" before', p.spans);
  assert.equal(restored.restored, true);
  assert.equal(restored.text, 'put the gate does not pass on @docs/a_b.md before');
  const lost = restoreJargon('put the gate does not pass', [{text: 'gate'}]);
  assert.equal(lost.restored, false);
  assert.equal(lost.kept, 1);
});

test('hasSpan matches whole tokens only', () => {
  assert.equal(hasSpan('a "wire_types.html" b', 'wire_types.html'), true);
  assert.equal(hasSpan('review', 'view'), false);
});

test('discoverJargon proposes words far more frequent in the user text than in general text', () => {
  const freq = new Map([['the', {en: 1000, ro: 0}], ['sigilat', {en: 0, ro: 1}]]);
  const sf = {freq, perMillion: {en: 1, ro: 1}};
  const out = discoverJargon(['sigilat sigilat sigilat the', 'sigilat the gate gate gate'], {spellfix: sf, minCount: 3, ratio: 40});
  assert.deepEqual(out.map(x => x.word).sort(), ['gate', 'sigilat']);
});
