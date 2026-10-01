// Rules v2.6: file names and paths are one name word (lib/ud-to-sop/filenames.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileNameSpans, mergeFileNames} from '../lib/ud-to-sop/filenames.mjs';

const w = (id, text, start, head, deprel, upos = 'NOUN') => ({id, text, lemma: text, upos, head, deprel, start, end: start + text.length, feats: {}});

test('file names, @files and paths are found; "and/or" and decimals are not', () => {
  const text = 'Update @questions.md and docs/wire_types.html, then run a.js and/or he/she at 3.5.';
  assert.deepEqual(fileNameSpans(text).map(s => text.slice(s.start, s.end)), ['@questions.md', 'docs/wire_types.html', 'a.js']);
});

test('the pieces Stanza split become one PROPN word with the outer dependency', () => {
  const text = 'Update @questions.md.';
  const parse = {text, language: 'en', sentences: [{text, start: 0, end: text.length, words: [
    w(1, 'Update', 0, 0, 'root', 'VERB'), w(2, '@', 7, 3, 'punct', 'SYM'), w(3, 'questions', 8, 1, 'obj'), w(4, '.', 17, 3, 'punct', 'PUNCT'), w(5, 'md', 18, 3, 'compound'), w(6, '.', 20, 1, 'punct', 'PUNCT')]}]};
  const merged = mergeFileNames(parse).sentences[0].words;
  assert.deepEqual(merged.map(x => [x.id, x.text, x.head, x.deprel]), [[1, 'Update', 0, 'root'], [2, '@questions.md', 1, 'obj'], [3, '.', 1, 'punct']]);
  assert.equal(merged[1].upos, 'PROPN');
  assert.equal(parse.sentences[0].words.length, 6, 'the input is not modified');
});
