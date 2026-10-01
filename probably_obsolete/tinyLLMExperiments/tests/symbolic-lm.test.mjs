/** SymbolicLM (lib/symbolic-lm/): per-token language identification, the uncertainty signal, value mapping, and
 * analysis replayed from recorded Stanza parses (tests/fixtures/symbolic-lm/), so no Python is needed. Translation
 * itself is TranslatorService's concern (tests/translator-service.test.mjs, DS021 "TranslatorService"); SymbolicLM
 * only calls it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {identify} from '../lib/languages-util/index.mjs';
import {treeShape, uncertaintyOf} from '../lib/symbolic-lm/uncertainty.mjs';
import {SymbolicLM, mapValues} from '../lib/symbolic-lm/index.mjs';
import {joinPieces} from '../lib/translator-service/index.mjs';

const FIXTURE = new URL('./fixtures/symbolic-lm/parses.json', import.meta.url);

/** Small word lists standing in for the Hunspell sets (the real ones are git-ignored vendor data). */
function stubLexicons() {
  const en = new Set('works work at lives in who does the team and is a an are care take of garden report activity i also need'.split(' '));
  const ro = new Set('lucrează lucra la locuiește în cine antrenează echipa și care este e raport de activitate mă întreb dacă participă atelierul fotografie'.split(' '));
  return {has: (lang, w) => (lang === 'en' ? en : ro).has(w), perMillion: () => 0};
}

test('language identification labels every token and keeps names', () => {
  const lexicons = stubLexicons();
  const mono = identify('Cine antrenează echipa la care joacă Haruka Suzuki?', {lexicons});
  const labels = Object.fromEntries(mono.tokens.filter(t => t.kind === 'word').map(t => [t.text, t.label]));
  assert.equal(labels.antrenează, 'ro');
  assert.equal(labels.care, 'ro', 'a shared spelling takes the language of its context');
  assert.equal(labels.Haruka, 'name');
  assert.equal(mono.language, 'ro');
  const mixed = identify('I also need the raport de activitate.', {lexicons});
  assert.equal(mixed.language, 'mixed');
  assert.deepEqual(mixed.tokens.filter(t => t.label === 'ro').map(t => t.text), ['raport', 'de', 'activitate']);
  assert.equal(identify('Who takes care of the garden?', {lexicons}).language, 'en');
  // Every decision carries its evidence.
  assert.ok(mono.tokens.find(t => t.text === 'antrenează').reasons.includes('ro-diacritic'));
});

test('uncertainty: tree shape, parser disagreement and the collected reasons', () => {
  const sentence = {start: 0, words: [
    {id: 1, text: 'How', upos: 'ADV', head: 3, deprel: 'advmod', start: 0},
    {id: 2, text: 'many', upos: 'ADJ', head: 3, deprel: 'amod', start: 4},
    {id: 3, text: 'people', upos: 'NOUN', head: 7, deprel: 'nsubj', start: 9},
    {id: 4, text: 'is', upos: 'AUX', head: 7, deprel: 'cop', start: 16},
    {id: 5, text: 'Iancu', upos: 'PROPN', head: 7, deprel: 'nsubj', start: 19},
    {id: 6, text: 'a', upos: 'DET', head: 7, deprel: 'det', start: 25},
    {id: 7, text: 'child', upos: 'NOUN', head: 0, deprel: 'root', start: 27},
  ]};
  assert.deepEqual(treeShape(sentence), ['two subjects of "child"']);
  const signal = uncertaintyOf({translation: {untranslated: [{word: 'deocamdată'}]}, unparsed: [{span: 'curând'}], rules: {repaired: [], notes: ['dropped @s2: x'], outcome: 'converted'}}, {englishSentences: [sentence]});
  assert.equal(signal.uncertain, true);
  assert.deepEqual(signal.kinds.sort(), ['rule_fallback', 'tree_shape', 'unparsed', 'untranslated']);
  assert.equal(uncertaintyOf({rules: {outcome: 'converted', notes: [], repaired: []}}).uncertain, false);
});

test('value mapping restores message spans and leaves pro-drop subjects open', () => {
  const message = 'Chloé participă la atelierul de fotografie.';
  const words = new Map([[`0:5`, {start: 0, end: 5, upos: 'PROPN', text: 'Chloé'}], ['6:15', {start: 6, end: 15, upos: 'VERB'}], ['16:18', {start: 16, end: 18, upos: 'ADP'}],
    ['19:28', {start: 19, end: 28, upos: 'NOUN', text: 'atelierul'}], ['29:31', {start: 29, end: 31, upos: 'ADP'}], ['32:42', {start: 32, end: 42, upos: 'NOUN', text: 'fotografie'}]]);
  const english = joinPieces([{text: 'He', src: [], kind: 'pro-drop'}, {text: 'says', src: []}, {text: 'Chloé', src: ['0:5:0:1'], kind: 'name'}, {text: 'attends', src: ['6:15:0:2']},
    {text: 'the', src: [], kind: 'article'}, {text: 'photography', src: ['32:42:0:6']}, {text: 'workshop', src: ['19:28:0:4']}, {text: '.', src: [], kind: 'punct'}]);
  const sop = '@q query\n  where match\n    relation "attend"\n    role subject "Chloé"\n    role object "the photography workshop"\n    role recipient "He"\n    polarity affirmed\n  end\n';
  const mapped = mapValues(sop, english, words, message);
  assert.match(mapped.sop, /role object "atelierul de fotografie"/);
  assert.match(mapped.sop, /relation "attend"/, 'relations stay English');
  assert.doesNotMatch(mapped.sop, /"He"/, 'a pronoun inserted for a pro-drop subject is left open');
});

// Recorded parses: {"ro|<masked message>": parse, "en|<text>": parse}. Regenerate with
// `node tools/symbolic-lm.mjs record-fixture` after a translator change.
const fixture = fs.existsSync(FIXTURE) ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) : null;
const replayWorker = {start: async () => ({ready: true}), stop: async () => {},
  request: async ({text, language}) => { const parse = fixture.parses[`${language}|${text}`]; if (!parse) throw Error('no recorded parse for ' + language + '|' + text); return {parse, ms: 0}; }};

test('translation and analysis replayed from recorded parses', {skip: !fixture && 'no fixture'}, async () => {
  const lm = new SymbolicLM({worker: replayWorker, lexicons: fixture.lexicons ? {has: (l, w) => fixture.lexicons[l].includes(w), perMillion: () => 0} : stubLexicons()});
  for (const item of fixture.cases) {
    const english = await lm.toEnglish(item.message);
    assert.equal(english.text, item.english, item.message);
    const result = await lm.analyze(item.message);
    assert.equal(result.route, item.route, item.message);
    assert.equal(result.sop, item.sop, item.message);
    assert.equal(result.valid, true);
    assert.ok(Array.isArray(result.uncertainty.reasons));
  }
});

test('analyze() exposes the grammatical analysis: the UD parse per sentence, backward compatible', {skip: !fixture && 'no fixture'}, async () => {
  const lm = new SymbolicLM({worker: replayWorker, lexicons: fixture.lexicons ? {has: (l, w) => fixture.lexicons[l].includes(w), perMillion: () => 0} : stubLexicons()});
  const item = fixture.cases.find(c => c.route === 'direct') ?? fixture.cases[0];
  const result = await lm.analyze(item.message);
  assert.equal(result.sop, item.sop, 'the SOP is unchanged by the new field');
  const {analysis} = result;
  assert.deepEqual(analysis.columns, ['id', 'form', 'lemma', 'upos', 'head', 'deprel']);
  assert.ok(analysis.sentences.length >= 1);
  for (const sentence of analysis.sentences) {
    assert.equal(typeof sentence.text, 'string');
    assert.ok(sentence.tokens.length > 0);
    for (const token of sentence.tokens) assert.equal(token.length, 6, 'id, form, lemma, upos, head, deprel');
    assert.equal(sentence.tokens.filter(t => t[4] === 0).length, 1, 'exactly one root per sentence');
  }
  assert.match(analysis.parser, /^stanza-/);
});
