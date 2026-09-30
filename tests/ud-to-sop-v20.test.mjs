// Rules v2.0 (experiment eval-symbolic-accurate-adopt-v1): the UD-to-SOP rules and tree repairs written for the Stanza
// `accurate` package, run on recorded accurate parses (tests/fixtures/ud-to-sop/accurate-parses.json, no Python), and the
// SymbolicLM Stanza-package configuration (config/symbolic-lm.json, `parsers_disagree`, batched parsing).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {convertParse} from '../lib/ud-to-sop/index.mjs';
import {repairSentence} from '../lib/ud-to-sop/repair.mjs';
import {symbolicLmConfig, stanzaSetup} from '../lib/ud-to-sop/stanza.mjs';
import {SymbolicLM, uncertaintyOf, stanzaModelId} from '../lib/symbolic-lm/index.mjs';
import {compareSentence, parsersDisagreement} from '../lib/symbolic-lm/uncertainty.mjs';
import {repoPath} from './helpers.mjs';

const fixture = JSON.parse(fs.readFileSync(repoPath('tests/fixtures/ud-to-sop/accurate-parses.json'), 'utf8'));

test('recorded accurate parses convert to the SOP of their gold-matching rows', () => {
  assert.ok(fixture.cases.length >= 25);
  for (const c of fixture.cases) {
    const out = convertParse(c.parse, c.message);
    assert.equal(out.valid, true, `${c.label}: ${c.message}`);
    assert.equal(out.sop, c.sop, `${c.label}: ${c.message}`);
  }
});

test('each v2.0 tree repair is exercised by its recorded parse', () => {
  const labels = fixture.cases.filter(c => c.label.startsWith('repair:')).map(c => c.label.slice(7));
  assert.ok(labels.length >= 15);
  for (const c of fixture.cases.filter(x => x.label.startsWith('repair:'))) {
    const name = c.label.slice(7);
    const total = c.parse.sentences.reduce((n, s) => n + (repairSentence({...s, language: 'en'}).repairs?.[name] ?? 0), 0);
    assert.ok(total > 0, `${name} does not fire on "${c.message}"`);
  }
});

test('a repair returns a copy: the recorded parse is never mutated', () => {
  const c = fixture.cases.find(x => x.label === 'repair:whHigh');
  const before = JSON.stringify(c.parse);
  repairSentence({...c.parse.sentences[0], language: 'en'});
  assert.equal(JSON.stringify(c.parse), before);
});

test('the Stanza package is a configuration with an environment override', () => {
  const config = symbolicLmConfig({});
  assert.ok(['default', 'accurate'].includes(config.stanza.package));
  assert.equal(symbolicLmConfig({CHATSOP_STANZA_PACKAGE: 'accurate'}).stanza.package, 'accurate');
  assert.equal(symbolicLmConfig({CHATSOP_STANZA_PACKAGE: 'default'}).stanza.package, 'default');
  assert.throws(() => symbolicLmConfig({CHATSOP_STANZA_PACKAGE: 'huge'}), /unknown Stanza package/);
  const accurate = stanzaSetup('accurate', {CHATSOP_STANZA_ACCURATE_DIR: '/x/res', CHATSOP_STANZA_HF_HOME: '/x/hf'});
  assert.deepEqual([accurate.stanzaPackage, accurate.resourcesDir, accurate.hfHome], ['default_accurate', '/x/res', '/x/hf']);
  const standard = stanzaSetup('default', {CHATSOP_STANZA_DIR: '/x/std'});
  assert.deepEqual([standard.stanzaPackage, standard.resourcesDir, standard.hfHome], ['default', '/x/std', null]);
});

test('the model id names the package (skipped when the models are not installed)', t => {
  if (SymbolicLM.missing(process.env, 'accurate') || SymbolicLM.missing(process.env, 'default')) return t.skip('Stanza models not installed');
  assert.match(stanzaModelId(process.env, 'accurate'), /pos=combined_electra-large.*depparse=combined_electra-large/);
  assert.match(stanzaModelId(process.env, 'default'), /pos=combined_charlm.*depparse=combined_charlm/);
});

const tokens = rows => rows.map(([id, form, lemma, upos, head, deprel]) => ({id, text: form, lemma, upos, head, deprel}));
const S1 = [[1, 'Ana', 'Ana', 'PROPN', 2, 'nsubj'], [2, 'works', 'work', 'VERB', 0, 'root'], [3, 'at', 'at', 'ADP', 4, 'case'], [4, 'Acme', 'Acme', 'PROPN', 2, 'obl']];
const S2 = [[1, 'Ana', 'Ana', 'PROPN', 2, 'nsubj'], [2, 'works', 'work', 'VERB', 0, 'root'], [3, 'at', 'at', 'ADP', 4, 'case'], [4, 'Acme', 'Acme', 'PROPN', 2, 'nmod']];
const S3 = [[1, 'Ana', 'Ana', 'PROPN', 4, 'obl'], [2, 'works', 'work', 'VERB', 0, 'root'], [3, 'at', 'at', 'ADP', 4, 'case'], [4, 'Acme', 'Acme', 'PROPN', 2, 'nsubj']];

test('tree comparison of two Stanza packages: identical, non-core and core differences', () => {
  assert.equal(compareSentence(S1, S1), 'identical');
  assert.equal(compareSentence(S1, S2), 'core_diff'); // obl to nmod on a case-marked noun changes a core arc
  assert.equal(compareSentence(S1, S3), 'core_diff');
  assert.equal(parsersDisagreement({words: tokens(S1)}, {words: tokens(S1)}), null);
  assert.match(parsersDisagreement({words: tokens(S1)}, {words: tokens(S3)}), /differ/);
});

test('parsers_disagree is an uncertainty reason only when the other package disagrees', () => {
  const sentence = {text: 'Ana works at Acme', start: 0, words: tokens(S1)};
  const agree = uncertaintyOf({}, {englishSentences: [sentence], otherStanza: [{words: tokens(S1)}]});
  assert.equal(agree.reasons.some(r => r.kind === 'parsers_disagree'), false);
  const disagree = uncertaintyOf({}, {englishSentences: [sentence], otherStanza: [{words: tokens(S3)}]});
  assert.deepEqual(disagree.kinds, ['parsers_disagree']);
  const split = uncertaintyOf({}, {englishSentences: [sentence], otherStanza: []});
  assert.match(split.reasons[0].detail, /split the text differently/);
  const off = uncertaintyOf({}, {englishSentences: [sentence]});
  assert.equal(off.uncertain, false);
});

test('a batch of messages is parsed once and answers exactly like single calls', async () => {
  const calls = [];
  const words = tokens(S1);
  const parse = text => ({text, language: 'en', sentences: [{language: 'en', text, start: 0, end: text.length, oov_rate: 0, words: words.map((w, i) => ({...w, feats: {}, start: i, end: i + 1, xpos: '', ner: 'O', oov: false}))}]});
  const worker = {package: 'accurate', start: async () => ({ready: true}), stop: async () => {},
    request: async ({text}) => { calls.push(['one', text]); return {parse: parse(text), ms: 0}; },
    parseMany: async (texts, languages) => { calls.push(['many', texts.length, languages]); return {parses: texts.map(parse), ms: 0}; }};
  const lm = new SymbolicLM({worker, lexicons: {has: () => false, perMillion: () => 0}});
  const messages = ['Ana works at Acme.', 'Bob works at Acme.'];
  const batch = await lm.analyzeMany(messages, {route: 'direct', language: 'en'});
  assert.deepEqual(calls.map(c => c[0]), ['many']);
  assert.deepEqual(calls[0][2], ['en', 'en']);
  const single = [];
  for (const m of messages) single.push(await lm.analyze(m, {route: 'direct', language: 'en'}));
  assert.deepEqual(batch.map(r => r.sop), single.map(r => r.sop));
  assert.equal(lm.package, 'accurate');
});
