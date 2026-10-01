// The English-only core (owner decision of 2026-10-01, DS021 "Input languages and content words"): language is handled at two edges only.
// The input edge translates a Romanian or mixed message into English before SymbolicLM, in the chat and in the capability APIs, or fails with
// backend_unavailable; the output edge translates the finished English answer, with names preserved; the knowledge holds English only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Repository} from '../memory/repository.mjs';
import {demoLexicon, SEEDS_DIR, seedIds} from '../lib/knowledge-seeds.mjs';
import {createServer} from '../server/http.mjs';
import {loadRegistry, ModelManager} from '../server/formalizers.mjs';
import {validateProgram} from '../sop/knowledge/index.mjs';
import {translateAnswer} from '../lib/translator-service/answer.mjs';
import {Dictionary, englishDictionary} from '../sop/dictionary.mjs';
import {listen, repoPath, tempDir} from './helpers.mjs';

const token = 'alice-secret-token-123456';

/** A server with stub model processes (tests/fixtures/capability-api): the translator answers "EN: " + the sentence it is given. */
async function setup(t, {withProofing = true, withTranslator = true} = {}) {
  const dir = tempDir(t, 'chatsop-english-core-');
  const log = path.join(dir, 'stub.jsonl');
  process.env.STUB_LOG = log;
  t.after(() => { delete process.env.STUB_LOG; });
  const bin = path.join(dir, 'llama-server');
  fs.copyFileSync(repoPath('tests/fixtures/capability-api/stub-llama-server.cjs'), bin);
  fs.chmodSync(bin, 0o755);
  for (const name of ['language-proofing', 'translator']) fs.writeFileSync(path.join(dir, name + '.gguf'), 'fake');
  const file = path.join(dir, 'formalizers.json');
  fs.writeFileSync(file, JSON.stringify({default: 'symbolic-lm', models: [
    {id: 'symbolic-lm', label: 'SymbolicLM', service: repoPath('tests/fixtures/capability-api/stub-symbolic-service.mjs'), capabilities: ['formalize'], rewrite: {mode: 'off'}},
    ...(withProofing ? [{id: 'language-proofing-llm', label: 'LanguageProofingLLM', gguf: 'language-proofing.gguf', capabilities: ['proofread']}] : []),
    ...(withTranslator ? [{id: 'translator-llm', label: 'TranslatorLLM', gguf: 'translator.gguf', capabilities: ['translate-clean']}] : [])]}));
  const registry = loadRegistry(file, {root: dir});
  const manager = new ModelManager({registry, bin, startTimeoutMs: 15000, logDir: null});
  t.after(() => manager.stopAll());
  const repo = new Repository(path.join(dir, 'state'));
  repo.init('base');
  const server = createServer({repo, lexicon: demoLexicon(), base: 'base', authTokens: {alice: token}, config: {policy: {allowWrite: true}}, formalizers: {registry, manager}});
  const url = await listen(t, server);
  const request = async (method, route, body) => {
    const response = await fetch(url + route, {method, headers: {Authorization: 'Bearer ' + token, ...(body ? {'Content-Type': 'application/json'} : {})}, body: body ? JSON.stringify(body) : undefined});
    return {status: response.status, body: await response.json()};
  };
  const entries = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  /** The messages SymbolicLM actually received. */
  const symbolicInputs = () => entries().filter(e => e.service).map(e => e.body.messages.at(-1).content);
  return {request, entries, symbolicInputs};
}

test('input edge: a Romanian message reaches SymbolicLM only as English, names kept, and the response records the translation', async t => {
  const {request, symbolicInputs} = await setup(t);
  const analyzed = await request('POST', '/v1/symbolic/analyze', {message: 'Maria lucrează la Alfa.'});
  assert.equal(analyzed.status, 200);
  assert.equal(analyzed.body.status, 'ok');
  assert.deepEqual(symbolicInputs(), ['EN: Maria lucrează la Alfa.'], 'the Romanian original never reaches the service; the stub translator prefixes the sentence and the names are restored');
  assert.deepEqual(
    [analyzed.body.input_translation.original, analyzed.body.input_translation.english, analyzed.body.input_translation.backend, analyzed.body.input_translation.masked],
    ['Maria lucrează la Alfa.', 'EN: Maria lucrează la Alfa.', 'translator-llm', true]);
  const understood = await request('POST', '/v1/understand', {message: 'Cine lucreaza la echipa Delta?'});
  assert.equal(understood.body.input_translation.language !== 'en', true);
  assert.ok(symbolicInputs().every(message => message.startsWith('EN: ')), symbolicInputs().join(' | '));
});

test('input edge: an English message is not translated and no translation model is started', async t => {
  const {request, symbolicInputs, entries} = await setup(t);
  const analyzed = await request('POST', '/v1/symbolic/analyze', {message: 'Does Ana like Alpha Lab?'});
  assert.equal(analyzed.body.input_translation, null);
  assert.deepEqual(symbolicInputs(), ['Does Ana like Alpha Lab?']);
  assert.equal(entries().filter(e => e.alias === 'translator-llm').length, 0);
});

test('input edge: with no translation available the call fails with backend_unavailable and nothing reaches SymbolicLM', async t => {
  const {request, symbolicInputs} = await setup(t, {withProofing: false, withTranslator: false});
  const analyzed = await request('POST', '/v1/symbolic/analyze', {message: 'Maria lucrează la Alfa.'});
  assert.equal(analyzed.body.status, 'unavailable');
  assert.equal(analyzed.body.errors[0].code, 'backend_unavailable');
  assert.match(analyzed.body.errors[0].message, /not sent to SymbolicLM/);
  const understood = await request('POST', '/v1/understand', {message: 'Cine lucrează la Alfa?'});
  assert.equal(understood.body.status, 'unavailable');
  assert.equal(understood.body.errors[0].code, 'backend_unavailable');
  const chat = await request('POST', '/v1/chat/completions', {model: 'symbolic-lm', messages: [{role: 'user', content: 'Maria lucrează la Alfa?'}], conversation_id: 'ro'});
  assert.equal(chat.status, 503);
  assert.equal(chat.body.error.code, 'backend_unavailable');
  assert.deepEqual(symbolicInputs(), []);
});

test('input edge in the chat: Romanian is translated first, the turn runs on the English text and the trace records it', async t => {
  const {request, symbolicInputs} = await setup(t);
  const chat = await request('POST', '/v1/chat/completions', {model: 'symbolic-lm', messages: [{role: 'user', content: 'Ana iubește Alpha Lab?'}], conversation_id: 'ro1'});
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  assert.deepEqual(symbolicInputs(), ['EN: Ana iubește Alpha Lab?']);
  assert.equal(chat.body.chatSop.input_translation.original, 'Ana iubește Alpha Lab?');
  assert.equal(chat.body.chatSop.input_translation.backend, 'translator-llm');
  assert.equal(chat.body.chatSop.answer_translation, null, 'the answer language is English: the Romanian input does not select Romanian');
});

test('output edge in the chat: language ro translates the final English answer; the trace keeps the English text and the step', async t => {
  const {request, entries} = await setup(t);
  const chat = await request('POST', '/v1/chat/completions', {model: 'symbolic-lm', messages: [{role: 'user', content: 'Does Ana like Alpha Lab?'}], conversation_id: 'en1', language: 'ro'});
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  const trace = chat.body.chatSop;
  assert.equal(trace.answer_translation.status, 'ok');
  assert.equal(trace.answer_translation.backend, 'translator-llm');
  assert.equal(trace.answer_translation.language, 'ro');
  assert.equal(trace.answer_translation.original, trace.english_text);
  assert.ok(trace.english_text.length > 0);
  assert.equal(chat.body.choices[0].message.content.startsWith('EN: '), true, 'the stub translator answered');
  const asked = entries().filter(e => e.alias === 'translator-llm').at(-1).message;
  assert.doesNotMatch(asked, /\bAna\b|Alpha Lab/, 'names reach the translator only as placeholders');
});

test('output edge: TranslatorService masks names, numbers, quotations and identifiers and restores them; a reply that loses one is refused', async () => {
  const english = 'Ana works at "Alpha Lab" since 2021 (works_at ana lab_alpha) with 3 projects.';
  const seen = [];
  const good = await translateAnswer(english, 'ro', {url: 'stub://translator', chat: async (url, messages) => { seen.push(messages.at(-1).content); return {text: 'Tradus: ' + messages.at(-1).content, ms: 2}; }});
  assert.match(good.text, /^Tradus: Ana works at "Alpha Lab" since 2021 \(works_at ana lab_alpha\) with 3 projects\.$/);
  assert.equal(good.original, english);
  assert.equal(good.backend, 'translator-llm');
  assert.ok(good.placeholders >= 5);
  assert.doesNotMatch(seen[0], /Alpha Lab|2021|works_at|lab_alpha|\b3 projects/);
  await assert.rejects(translateAnswer(english, 'ro', {url: 'stub://translator', chat: async () => ({text: 'Tradus fără nimic.', ms: 1})}), {code: 'backend_unavailable'});
  await assert.rejects(translateAnswer(english, 'ro', {url: null}), {code: 'backend_unavailable'});
  await assert.rejects(translateAnswer(english, 'de', {url: 'stub://translator'}), {code: 'unsupported_language'});
  assert.equal((await translateAnswer('', 'ro', {url: null})).backend, 'none');
});

test('knowledge: the validator rejects any language but English in lexemes, labels and aliases', () => {
  const ok = '@person entity\n  kind class\n  label en "person"\n@works_at predicate\n  args subject:entity object:entity\n  role subject person\n  role object person\n  label en "works at"\n@lx_en lexeme\n  of works_at\n  language en\n  form "work at"\n  frame subject object\n';
  assert.deepEqual(validateProgram([{name: 'ok.sop', text: ok}]).problems.filter(p => p.severity !== 'warning').map(p => p.code), []);
  for (const [name, text] of [
    ['lexeme', ok + '@lx_ro lexeme\n  of works_at\n  language ro\n  form "lucra la"\n  frame subject object\n'],
    ['label', ok.replace('label en "person"', 'label en "person"\n  label ro "persoană"')],
    ['alias', ok.replace('label en "person"', 'label en "person"\n  alias ro "om"')],
  ]) assert.ok(validateProgram([{name: 'bad.sop', text}]).problems.some(p => p.code === 'non_english_knowledge'), name);
});

test('knowledge: the shipped seed memories and the world builders hold no Romanian label, alias or lexeme', () => {
  for (const id of seedIds()) for (const file of fs.readdirSync(path.join(SEEDS_DIR, id)).filter(n => n.endsWith('.sop'))) {
    const bad = fs.readFileSync(path.join(SEEDS_DIR, id, file), 'utf8').split('\n').filter(line => /^\s+(language|label|alias) (?!en\b)[a-z]{2,3}\b/.test(line));
    assert.deepEqual(bad, [], `${id}/${file}`);
  }
  for (const builder of ['tools/linking/core-en/build.mjs', 'tools/world-kb/build.mjs', 'tools/world-kb/mapping.mjs']) {
    assert.doesNotMatch(fs.readFileSync(repoPath(builder), 'utf8'), /label ro |alias ro |language ro|ro: \[|\bro: '/, builder);
  }
});

test('linker: the product dictionary view carries English synonyms only and never translates', () => {
  const view = englishDictionary();
  assert.deepEqual(view.candidates('lucra la', 'relation'), {status: 'unchanged', candidates: ['lucra la'], untranslated: [], sources: []});
  assert.ok(view.synonyms('work at', 'relation').includes('be employed by'));
  assert.ok(view.entries.every(entry => entry.ro.length === 0 && entry.forms.length === 0));
  const full = Dictionary.fromEntries([{id: 'rel:x', pos: 'relation', en: ['work at'], ro: ['lucra la'], forms: []}]);
  assert.equal(full.candidates('lucra la', 'relation').status, 'translated', 'the full dictionary stays for the edges and the evaluation');
});
