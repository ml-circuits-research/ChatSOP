/** TranslatorService `gloss` mode (lib/translator-service/backends/gloss.mjs): the English verb group realizer, the
 * romglish suffix rules with a stub lexicon, and (when the Stanza models are installed) the end-to-end gloss of
 * Romanian, mixed and romglish sentences. The Romanian word order is kept; unknown lemmas are copied in brackets. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {verbGroup, Glosser, glossStats, sentenceSpans} from '../lib/translator-service/backends/gloss.mjs';
import {loadBackend} from '../lib/translator-service/index.mjs';
import {defaultDictionary} from '../sop/dictionary.mjs';
import {workerMissing} from '../lib/ud-to-sop/stanza.mjs';

test('the gloss mode is registered and leaves the symbolic backend untouched', async () => {
  const gloss = await loadBackend('gloss');
  assert.equal(typeof gloss.glossMessage, 'function');
  const symbolic = await loadBackend('symbolic');
  assert.equal(typeof symbolic.translateParse, 'function');
  assert.ok(symbolic.GLOSS_TABLES.PREPOSITIONS.la === 'at');
});

test('verb group: tense, person, negation with do-support, auxiliaries, passive', () => {
  assert.equal(verbGroup({verb: 'work', form: 'pres', person: 3, number: 'Sing'}), 'works');
  assert.equal(verbGroup({verb: 'work', form: 'pres', person: 3, number: 'Sing', neg: true}), 'does not work');
  assert.equal(verbGroup({verb: 'work', form: 'pres', person: 1, number: 'Sing', neg: true}), 'do not work');
  assert.equal(verbGroup({verb: 'say', form: 'past'}), 'said');
  assert.equal(verbGroup({verb: 'say', form: 'past', neg: true}), 'did not say');
  assert.equal(verbGroup({verb: 'work', form: 'fut', neg: true}), 'will not work');
  assert.equal(verbGroup({verb: 'want', form: 'cnd'}), 'would want');
  assert.equal(verbGroup({verb: 'work', form: 'cndperf'}), 'would have worked');
  assert.equal(verbGroup({verb: 'be', form: 'pres', person: 3, number: 'Plur'}), 'are');
  assert.equal(verbGroup({verb: 'be', form: 'past', person: 3, number: 'Sing', neg: true}), 'was not');
  assert.equal(verbGroup({verb: 'enrol', form: 'pres', person: 3, number: 'Sing', passive: true}), 'is enrolled');
  assert.equal(verbGroup({verb: 'work', form: 'base', neg: true}), 'not work');
});

test('romglish: English stem with a Romanian enclitic, English verb with Romanian inflection (stub lexicon)', () => {
  const english = new Set(['deadline', 'update', 'share', 'forward', 'check', 'task']);
  const g = new Glosser({dictionary: defaultDictionary(), isEnglish: w => english.has(w), isRomanian: () => false});
  assert.deepEqual(g.stemSplit('deadline-ul'), ['deadline', 1, 0, 0]);
  assert.deepEqual(g.stemSplit('updateurile'), ['update', 1, 1, 0]);
  assert.equal(g.stemSplit('copilul'), null, 'a Romanian word of the dictionary is never split');
  assert.deepEqual(g.verbSplit('share-uiesc'), {stem: 'share', form: 'pres', person: 1, number: 'Sing'});
  assert.equal(g.verbSplit('forwardat')?.stem, 'forward');
  assert.equal(g.verbSplit('forwardat')?.form, 'part');
  assert.equal(g.verbSplit('checkuiesc')?.stem, 'check');
  assert.equal(g.verbSplit('lucrat'), null, 'a Romanian verb form is not an English verb');
});

test('sentence spans and statistics', () => {
  const text = 'Prima propoziție. A doua?\nLinia nouă';
  assert.deepEqual(sentenceSpans(text).map(s => text.slice(s.start, s.end)), ['Prima propoziție.', 'A doua?', 'Linia nouă']);
  assert.deepEqual(glossStats([{kind: 'tr'}, {kind: 'unk'}, {kind: 'en'}, {kind: 'fn'}]), {content: 2, translated: 1, unknown: 1, english: 1, names: 0, function: 1});
});

const missing = workerMissing();
test('end to end with Stanza: Romanian word order kept, forms generated, romglish handled', {skip: missing ?? false}, async () => {
  const {createSymbolicLM} = await import('../lib/symbolic-lm/index.mjs');
  const {glossMessage} = await import('../lib/translator-service/index.mjs');
  const lm = await createSymbolicLM({});
  try {
    const gloss = async (text, options = {}) => (await glossMessage(lm, text, {spell: false, ...options})).text;
    assert.equal(await gloss('Nu va lucra la fermă.'), 'Will not work at farm.');
    assert.equal(await gloss('Aș vrea să aflu ce a spus.'), 'Would want to find out what said.');
    assert.match(await gloss('Casa este înscrisă la deadline-ul din update-urile noastre.'), /^The house is enrolled at the deadline from the updates our\.$/);
    assert.match(await gloss('Am forwardat mailul și am dat check la booking-ul.'), /^I forwarded .* and checked at the booking\.$/);
    assert.equal(await gloss('Checkuiesc acum statusul comenzii.'), 'I check now the state of the order.');
    assert.match(await gloss('Deadline-ul pentru raport este vineri.'), /^The deadline for report is Friday\.$/);
    assert.equal(await gloss('Eu share-uiesc fișierul și checkuiesc update-urile.'), 'I share the file and check the updates.');
    assert.equal(await gloss('Can you check the factura from yesterday?'), 'Can you check the invoice from yesterday?');
    assert.match(await gloss('Mă întreb if Mykola is the doctor of Carmen.'), /^I wonder if Mykola is the doctor of Carmen\.$/);
    // Unknown lemma: copied in brackets, reported; names and numbers unchanged.
    const unknown = await glossMessage(lm, 'Ion zbrâncăie 3 pisici.', {spell: false});
    assert.match(unknown.text, /^Ion \[zbrâncăie\] 3 cats\.$/);
    assert.equal(unknown.stats.unknown, 1);
    // English stays English.
    assert.equal((await glossMessage(lm, 'Who is the boss of Ana?', {spell: false})).text, 'Who is the boss of Ana?');
  } finally { await lm.stop?.(); }
});
