/** TranslatorService (lib/translator-service/): the `symbolic` backend's English morphology helper and its
 * "never guesses an unknown word" guarantee. Moved out of tests/symbolic-lm.test.mjs with the translator itself
 * (owner decision 2026-09-29, DS021 "TranslatorService"): SymbolicLM's own tests stay in tests/symbolic-lm.test.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {inflectVerb, pluralize, indefinite} from '../lib/translator-service/backends/english.mjs';
import {translateParse} from '../lib/translator-service/index.mjs';
import {defaultDictionary} from '../sop/dictionary.mjs';

test('English morphology: tense, person, plural, article', () => {
  assert.equal(inflectVerb('work at', 'present', {person: 3, number: 'Sing'}), 'works at');
  assert.equal(inflectVerb('be enrolled at', 'past', {person: 3, number: 'Plur'}), 'were enrolled at');
  assert.equal(inflectVerb('teach', 'past'), 'taught');
  assert.equal(inflectVerb('enrol', 'part'), 'enrolled');
  assert.equal(inflectVerb('study', 's'), 'studies');
  assert.equal(inflectVerb('have', 'present', {person: 3, number: 'Sing'}), 'has');
  assert.equal(pluralize('person'), 'people');
  assert.equal(pluralize('city'), 'cities');
  assert.equal(indefinite('hour'), 'an');
  assert.equal(indefinite('university'), 'a');
});

test('the symbolic backend never guesses an unknown Romanian word', () => {
  const word = (id, text, lemma, upos, head, deprel, start, feats = {}) => ({id, text, lemma, upos, head, deprel, start, end: start + text.length, feats});
  const parse = {sentences: [{words: [word(1, 'Ion', 'Ion', 'PROPN', 2, 'nsubj', 0), word(2, 'zbrâncăie', 'zbrâncăi', 'VERB', 0, 'root', 4, {Mood: 'Ind', Person: '3', Tense: 'Pres', VerbForm: 'Fin'}), word(3, '.', '.', 'PUNCT', 2, 'punct', 13)]}]};
  const out = translateParse(parse, 'Ion zbrâncăie.', {dictionary: defaultDictionary()});
  assert.deepEqual(out.untranslated.map(u => u.word), ['zbrâncăie']);
  assert.match(out.text, /^Ion zbrâncăie/);
});
