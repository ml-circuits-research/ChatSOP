// Formalizer model registry, the on-demand llama-server manager and the chat API's `model` and `language`
// fields (DS012 "Formalizer models"). A fake llama-server script stands in for llama.cpp: no model is loaded.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Repository} from '../memory/repository.mjs';
import {Lexicon} from '../sop/lexicon.mjs';
import {createServer} from '../server/http.mjs';
import {loadRegistry, findLlamaServer, FormalizerManager} from '../server/formalizers.mjs';
import {messageRequest} from '../lib/llama-chat.mjs';
import {TRANSLATE_PROMPT, ChatHistory} from '../server/chat-modes.mjs';
import {answerLanguage} from '../server/language.mjs';
import {close, listen, repoPath, repoUrl, tempDir} from './helpers.mjs';

const token = 'alice-secret-token-123456';
const query = '@q query\n  where match\n    relation "likes"\n    role subject "Ana"\n    role object "Alpha Lab"\n    polarity affirmed\n  end';

// The stub records its arguments, environment and every request body, then answers like llama-server.
const STUB = `#!/usr/bin/env node
const http = require('node:http'), fs = require('node:fs');
const args = process.argv.slice(2), arg = name => args[args.indexOf(name) + 1];
const log = process.env.STUB_LOG, note = entry => fs.appendFileSync(log, JSON.stringify(entry) + '\\n');
note({start: args, cuda: process.env.CUDA_VISIBLE_DEVICES});
http.createServer((req, res) => {
  if (req.url === '/health') { res.end('{"status":"ok"}'); return; }
  let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
    const body = JSON.parse(raw); note({alias: arg('--alias'), body});
    const message = body.messages.at(-1).content, system = body.messages[0].role === 'system' ? body.messages[0].content : null;
    const content = arg('--alias').startsWith('b-')
      ? (system && system.startsWith('Translate') ? 'EN: ' + message : 'CHAT[' + (system ?? 'no system') + '|' + body.messages.length + ']: ' + message)
      : message === 'bad' ? '@x stated\\n  relation "likes"\\n  role subject "Nobody"\\n  role object "Alpha Lab"\\n  polarity affirmed\\n  certainty asserted' : ${JSON.stringify(query)};
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({choices: [{message: {content}, finish_reason: 'stop'}]}));
  });
}).listen(Number(arg('--port')), arg('--host'));
`;

function setup(t, {models = ['m-a', 'm-b', 'm-c'], bases = [], ...options} = {}) {
  const dir = tempDir(t, 'chatsop-formalizers-');
  const bin = path.join(dir, 'llama-server');
  fs.writeFileSync(bin, STUB, {mode: 0o755});
  const log = path.join(dir, 'stub.jsonl');
  process.env.STUB_LOG = log;
  for (const id of [...models, ...bases]) fs.writeFileSync(path.join(dir, id + '.gguf'), 'fake');
  const file = path.join(dir, 'formalizers.json');
  fs.writeFileSync(file, JSON.stringify({default: models[0], models: [...models.map(id => ({id, label: id.toUpperCase(), gguf: id + '.gguf', note: 'test'})),
    ...bases.map(id => ({id, label: id.toUpperCase(), gguf: id + '.gguf', capabilities: ['chat', 'translate']})), {id: 'missing', label: 'Missing', gguf: 'nothing.gguf'}]}));
  const registry = loadRegistry(file, {root: dir});
  const manager = new FormalizerManager({registry, bin, startTimeoutMs: 10000, ...options});
  t.after(() => manager.stopAll());
  const entries = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  return {dir, registry, manager, entries, bin};
}

test('the shipped registry lists the base models, the proofing and translator models and the SymbolicLM service as the only formalizer (FormalizerLLM entries and the configured endpoint were removed)', () => {
  const registry = loadRegistry(repoPath('config/formalizers.json'));
  assert.deepEqual(registry.models.map(m => [m.id, m.kind, m.capabilities.join('+')]), [
    ['smollm2-135m-base', 'gguf', 'chat+translate'], ['smollm2-360m-base', 'gguf', 'chat+translate'], ['language-proofing-llm', 'gguf', 'proofread'], ['symbolic-proofing-llm', 'gguf', 'proofread-symbolic'], ['translator-llm', 'gguf', 'translate-clean'], ['gemma-3-270m-base', 'gguf', 'chat+translate'],
    ['symbolic-lm', 'service', 'formalize']]);
  assert.equal(registry.default, 'symbolic-lm');
  assert.deepEqual(registry.defaults, {chat: 'smollm2-360m-base', formalize: 'symbolic-lm', translate: 'gemma-3-270m-base', proofread: 'language-proofing-llm', 'proofread-symbolic': 'symbolic-proofing-llm', 'translate-clean': 'translator-llm'});
  assert.equal(registry.models.find(m => m.id === 'symbolic-lm').rewriteMode, 'gated', 'the chat default of the SymbolicProofingLLM rewrite follows the registry (gated since Q-PROOF-1)');
  // SymbolicLM is the only formalizer; the base models never formalize and no runtime-endpoint entry exists.
  assert.deepEqual(registry.models.filter(m => m.capabilities.includes('formalize')).map(m => m.id), ['symbolic-lm']);
  assert.equal(registry.models.some(m => m.kind === 'runtime-endpoint'), false);
  for (const m of registry.models.filter(m => m.capabilities.includes('chat'))) assert.match(m.gguf, /models\/.+\/chat-base\/q8_0\.gguf$/);
});

test('registry loading refuses duplicates, an unknown default and entries with both or neither source', t => {
  const dir = tempDir(t);
  const load = data => { const file = path.join(dir, 'r.json'); fs.writeFileSync(file, JSON.stringify(data)); return loadRegistry(file, {root: dir}); };
  assert.throws(() => load({models: []}), /non-empty/);
  assert.throws(() => load({models: [{id: 'a', label: 'A', gguf: 'a'}, {id: 'a', label: 'A', gguf: 'a'}]}), /duplicate/);
  assert.throws(() => load({default: 'z', models: [{id: 'a', label: 'A', gguf: 'a'}]}), /default z/);
  assert.throws(() => load({models: [{id: 'a', label: 'A', gguf: 'a', endpoint: 'runtime'}]}), /exactly one/);
  assert.throws(() => load({models: [{id: 'a', label: 'A'}]}), /exactly one/);
  assert.throws(() => load({models: [{id: 'Bad Id', label: 'A', gguf: 'a'}]}), /id must be/);
  assert.equal(load({models: [{id: 'a', label: 'A', gguf: 'x.gguf'}]}).models[0].gguf, path.join(dir, 'x.gguf'));
  assert.deepEqual(load({models: [{id: 'a', label: 'A', gguf: 'x.gguf'}]}).models[0].capabilities, ['formalize'], 'formalize is the default capability');
  assert.throws(() => load({models: [{id: 'a', label: 'A', gguf: 'a', capabilities: ['sing']}]}), /capabilities/);
  assert.throws(() => load({models: [{id: 'a', label: 'A', gguf: 'a', capabilities: []}]}), /capabilities/);
  assert.throws(() => load({models: [{id: 'a', label: 'A', endpoint: 'runtime'}]}), /runtime endpoint entry was removed/);
  // A local service script (the symbolic baseline) is a managed formalizer like a GGUF model.
  const service = load({models: [{id: 's', label: 'S', service: 'tools/serve.mjs'}]}).models[0];
  assert.deepEqual([service.kind, service.service], ['service', path.join(dir, 'tools/serve.mjs')]);
  assert.throws(() => load({models: [{id: 's', label: 'S', service: 'x.mjs', gguf: 'a'}]}), /exactly one/);
  assert.throws(() => load({models: [{id: 's', label: 'S', service: 'x.mjs', capabilities: ['chat']}]}), /only capability is formalize/);
  assert.throws(() => load({default: 'b', models: [{id: 'a', label: 'A', gguf: 'a'}, {id: 'b', label: 'B', gguf: 'b', capabilities: ['chat']}]}), /not a formalize model/);
  assert.throws(() => load({defaults: {chat: 'a'}, models: [{id: 'a', label: 'A', gguf: 'a'}]}), /defaults\.chat a is not a listed chat model/);
  const mixed = load({models: [{id: 'a', label: 'A', gguf: 'a'}, {id: 'b', label: 'B', gguf: 'b', capabilities: ['translate', 'chat']}]});
  assert.deepEqual(mixed.defaults, {chat: 'b', formalize: 'a', translate: 'b'});
  assert.deepEqual(mixed.models[1].capabilities, ['chat', 'translate']);
});

test('llama-server is found through LLAMA_SERVER_BIN first', t => {
  const {bin} = setup(t);
  assert.equal(findLlamaServer({LLAMA_SERVER_BIN: bin}), bin);
  assert.equal(findLlamaServer({LLAMA_SERVER: bin}), bin);
});

test('the manager starts a CPU server on demand, reuses it and sends the harness request', async t => {
  const {manager, entries} = setup(t);
  assert.equal(manager.status('m-a').state, 'stopped');
  assert.deepEqual(manager.status('missing'), {state: 'error', mode: 'on_demand', error: 'GGUF file not found: ' + path.relative(repoPath(), path.join(manager.registry.models.at(-1).gguf))});
  const first = await manager.formalize('m-a', 'Does Ana like Alpha Lab?');
  assert.equal(first.sop, query);
  assert.equal(manager.status('m-a').state, 'ready');
  const port = manager.status('m-a').port;
  await manager.formalize('m-a', 'again');
  assert.equal(manager.status('m-a').port, port, 'a running server is reused');
  const log = entries();
  const starts = log.filter(e => e.start);
  assert.equal(starts.length, 1);
  const args = starts[0].start, flag = name => args[args.indexOf(name) + 1];
  assert.equal(flag('-ngl'), '0');
  assert.ok(args.includes('--jinja'));
  assert.ok(Number(flag('-t')) >= 1 && Number(flag('-t')) <= 8);
  assert.equal(flag('--host'), '127.0.0.1');
  assert.equal(starts[0].cuda, '', 'the GPU is hidden');
  const request = log.find(e => e.body).body;
  assert.deepEqual(request, messageRequest('Does Ana like Alpha Lab?', 6144), 'message only, greedy, no extra stop strings');
  await assert.rejects(manager.formalize('missing', 'x'), /GGUF file not found/);
  assert.equal(manager.status('missing').state, 'error');
});

test('at most maxRunning models run; the least recently used idle one is stopped, idle servers stop and stopAll ends all', async t => {
  assert.equal(setup(t).manager.maxRunning, 5, 'the default fits the four models of a chat turn plus one (tests/model-lifecycle.test.mjs covers the rest)');
  const {manager} = setup(t, {idleMs: 60000, maxRunning: 3, turnWindowMs: 0, models: ['m-a', 'm-b', 'm-c', 'm-d']});
  assert.equal(manager.maxRunning, 3);
  await manager.ensure('m-a');
  await manager.ensure('m-b');
  await manager.ensure('m-c');
  await manager.ensure('m-a');
  await manager.ensure('m-d');
  assert.deepEqual(['m-a', 'm-b', 'm-c', 'm-d'].map(id => manager.status(id).state), ['ready', 'stopped', 'ready', 'ready']);
  await manager.sweep(Date.now() + 120000);
  assert.deepEqual(['m-a', 'm-c', 'm-d'].map(id => manager.status(id).state), ['stopped', 'stopped', 'stopped']);
  await manager.ensure('m-b');
  const child = manager.entries.get('m-b').child;
  await manager.stopAll();
  assert.equal(manager.status('m-b').state, 'stopped');
  assert.ok(child.exitCode !== null || child.signalCode !== null, 'the child process ended');
});

test('a server that dies while starting reports error with the reason', async t => {
  const {manager, dir} = setup(t);
  const broken = path.join(dir, 'broken');
  fs.writeFileSync(broken, '#!/bin/sh\nexit 3\n', {mode: 0o755});
  manager.bin = broken;
  await assert.rejects(manager.ensure('m-a'), /could not start: llama-server exited \(code 3\)/);
  assert.equal(manager.status('m-a').state, 'error');
});

test('answer language: en and ro are forced, auto infers from the message', () => {
  assert.deepEqual(answerLanguage('Răspunde în română: cine?', 'en'), {language: 'en', source: 'request'});
  assert.deepEqual(answerLanguage('Who?', 'ro'), {language: 'ro', source: 'request'});
  assert.deepEqual(answerLanguage('Răspunde în română: cine?', 'auto'), {language: 'ro', source: 'prompt'});
  assert.deepEqual(answerLanguage('Cine lucrează la Alpha Lab?', 'auto'), {language: 'en', source: 'default'});
  assert.throws(() => answerLanguage('x', 'de'), /en or ro/);
});

test('the chat API selects a registry model, validates model and language, and reports model states', async t => {
  const {registry, manager} = setup(t);
  const root = tempDir(t, 'chatsop-http-');
  const repo = new Repository(root);
  repo.init('base');
  const server = createServer({repo, lexicon: Lexicon.load(repoUrl('config/ontology.sop')), base: 'base', authTokens: {alice: token},
    config: {promptProfile: 'formal', formalizer: {url: 'http://127.0.0.1:9/v1/chat/completions', model: 'none'}, policy: {allowWrite: true}}, formalizers: {registry, manager}});
  const url = await listen(t, server);
  const call = async (method, route, body) => {
    const response = await fetch(url + route, {method, headers: {Authorization: 'Bearer ' + token, ...(body ? {'Content-Type': 'application/json'} : {})}, body: body ? JSON.stringify(body) : undefined});
    return {status: response.status, body: await response.json()};
  };
  const chat = (extra, content = 'Does Ana like Alpha Lab?') => call('POST', '/v1/chat/completions', {messages: [{role: 'user', content}], conversation_id: 'c1', ...extra});

  const listed = await call('GET', '/v1/models');
  assert.deepEqual(listed.body.data.map(d => [d.id, d.chatsop.state]), [['m-a', 'stopped'], ['m-b', 'stopped'], ['m-c', 'stopped'], ['missing', 'error']]);
  assert.equal(listed.body.default, 'm-a');

  const unknown = await chat({model: 'nope'});
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error.code, 'unknown_model');
  assert.match(unknown.body.error.message, /Unknown model "nope"; GET \/v1\/models lists the available models: chatsop-local, m-a/);
  const badLanguage = await chat({model: 'm-b', language: 'de'});
  assert.equal(badLanguage.status, 400);
  assert.match(badLanguage.body.error.message, /language must be en, ro or auto/);
  assert.equal((await chat({model: 'missing'})).status, 503);

  const started = await call('POST', '/v1/models/m-b/start');
  assert.equal(started.status, 202);
  assert.ok(['starting', 'ready'].includes(started.body.state));
  assert.equal((await call('POST', '/v1/models/nope/start')).status, 404);

  const reply = await chat({model: 'm-b', language: 'auto'});
  assert.equal(reply.status, 200);
  assert.equal(reply.body.model, 'm-b');
  assert.equal(reply.body.chatSop.formalizer_model, 'm-b');
  assert.equal(reply.body.chatSop.formalizer_label, 'M-B');
  assert.equal(reply.body.chatSop.prompt_profile, 'bare');
  assert.equal(typeof reply.body.chatSop.formalization_ms, 'number');
  assert.equal(reply.body.chatSop.model_sop, query);
  assert.deepEqual([reply.body.chatSop.answer_language, reply.body.chatSop.language_source], ['en', 'default']);

  const forced = await chat({model: 'm-b', language: 'en'}, 'Răspunde în română: Ana likes Alpha Lab?');
  assert.deepEqual([forced.body.chatSop.answer_language, forced.body.chatSop.language_source], ['en', 'request'], 'no detection when English is picked');
  const inferred = await chat({model: 'm-b', language: 'auto'}, 'Răspunde în română: Ana likes Alpha Lab?');
  assert.deepEqual([inferred.body.chatSop.answer_language, inferred.body.chatSop.language_source], ['ro', 'prompt']);

  const facade = await chat({model: 'chatsop-local'});
  assert.equal(facade.body.chatSop.formalizer_model, 'm-a', 'the façade id selects the registry default');

  const rejected = await chat({model: 'm-b'}, 'bad');
  assert.equal(rejected.status, 422);
  assert.equal(rejected.body.error.code, 'model_output_rejected');
  assert.match(rejected.body.chatSop.rejection, /stated_value_not_in_message/);
  assert.match(rejected.body.chatSop.model_sop, /Nobody/);

  const ready = await call('GET', '/readyz');
  assert.equal(ready.status, 200);
  assert.deepEqual(ready.body.formalizers.map(m => [m.id, m.state]), [['m-a', 'ready'], ['m-b', 'ready'], ['m-c', 'stopped'], ['missing', 'error']]);
  await close(server);
});

test('the manager sends Chat and Translate requests to base models only, with their decoding', async t => {
  const {manager, entries} = setup(t, {bases: ['b-x']});
  const reply = await manager.chat('b-x', 'chat', [{role: 'user', content: 'hi'}]);
  assert.equal(reply.text, 'CHAT[no system|1]: hi');
  assert.equal(typeof reply.ms, 'number');
  const translated = await manager.chat('b-x', 'translate', [{role: 'system', content: TRANSLATE_PROMPT}, {role: 'user', content: 'Bună ziua'}], {temperature: 0});
  assert.equal(translated.text, 'EN: Bună ziua');
  const [sampled, greedy] = entries().filter(e => e.body).map(e => e.body);
  assert.deepEqual([sampled.temperature, sampled.top_p, sampled.max_tokens, sampled.stream], [0.7, 0.9, 512, false]);
  assert.deepEqual([greedy.temperature, greedy.top_k, greedy.max_tokens], [0, 1, 512]);
  await assert.rejects(manager.formalize('b-x', 'Who?'), /does not offer formalize/);
  await assert.rejects(manager.chat('m-a', 'chat', [{role: 'user', content: 'hi'}]), /does not offer chat/);
  await assert.rejects(manager.chat('b-x', 'formalize', []), /mode must be chat or translate/);
});

test('chat history keeps the latest turns within its bounds', () => {
  const history = new ChatHistory({maxTurns: 2, maxBytes: 1000, maxConversations: 2});
  history.add('k', 'u1', 'a1');
  history.add('k', 'u2', 'a2');
  history.add('k', 'u3', 'a3');
  assert.deepEqual(history.get('k').map(m => m.content), ['u2', 'a2', 'u3', 'a3']);
  history.add('k2', 'x', 'y');
  history.add('k3', 'x', 'y');
  assert.deepEqual(history.get('k'), [], 'the least recently used conversation is dropped');
  const small = new ChatHistory({maxBytes: 10});
  small.add('k', 'aaaaaa', 'bbbbbb');
  small.add('k', 'cc', 'dd');
  assert.deepEqual(small.get('k').map(m => m.content), ['cc', 'dd']);
});

test('the chat API mode field: chat keeps history, translate is fixed and greedy, formalize refuses base models', async t => {
  const {registry, manager, entries} = setup(t, {bases: ['b-x', 'b-y']});
  const root = tempDir(t, 'chatsop-http-modes-');
  const repo = new Repository(root);
  repo.init('base');
  const server = createServer({repo, lexicon: Lexicon.load(repoUrl('config/ontology.sop')), base: 'base', authTokens: {alice: token},
    config: {promptProfile: 'formal', formalizer: {url: 'http://127.0.0.1:9/v1/chat/completions', model: 'none'}, policy: {allowWrite: true}}, formalizers: {registry, manager}});
  const url = await listen(t, server);
  const call = async (method, route, body) => {
    const response = await fetch(url + route, {method, headers: {Authorization: 'Bearer ' + token, ...(body ? {'Content-Type': 'application/json'} : {})}, body: body ? JSON.stringify(body) : undefined});
    return {status: response.status, body: await response.json()};
  };
  const chat = (extra, content) => call('POST', '/v1/chat/completions', {messages: [{role: 'user', content}], conversation_id: 'm1', ...extra});

  const listed = await call('GET', '/v1/models');
  assert.deepEqual(listed.body.defaults, {chat: 'b-x', formalize: 'm-a', translate: 'b-x'});
  assert.deepEqual(listed.body.data.find(d => d.id === 'b-y').chatsop.capabilities, ['chat', 'translate']);
  assert.equal(listed.body.data.find(d => d.id === 'b-y').chatsop.prompt_profile, null);

  const first = await chat({model: 'b-y', mode: 'chat'}, 'Hello');
  assert.equal(first.status, 200);
  assert.equal(first.body.choices[0].message.content, 'CHAT[no system|1]: Hello', 'Any adds no system instruction');
  assert.deepEqual([first.body.chatSop.mode, first.body.chatSop.formalizer_model, first.body.chatSop.history_turns], ['chat', 'b-y', 0]);
  assert.equal(typeof first.body.chatSop.latency_ms, 'number');
  const second = await chat({model: 'b-y', mode: 'chat', language: 'ro'}, 'And then?');
  assert.equal(second.body.choices[0].message.content, 'CHAT[Answer in Romanian.|4]: And then?', 'system instruction, one earlier turn, the new message');
  assert.equal(second.body.chatSop.history_turns, 1);
  const sent = entries().filter(e => e.body).at(-1).body.messages;
  assert.deepEqual(sent.map(m => m.role), ['system', 'user', 'assistant', 'user']);
  assert.deepEqual(sent.slice(1, 3).map(m => m.content), ['Hello', 'CHAT[no system|1]: Hello']);

  const translated = await chat({model: 'chatsop-local', mode: 'translate', language: 'ro'}, 'Unde lucrează Maria?');
  assert.equal(translated.status, 200);
  assert.equal(translated.body.choices[0].message.content, 'EN: Unde lucrează Maria?');
  assert.deepEqual([translated.body.chatSop.mode, translated.body.chatSop.formalizer_model, translated.body.chatSop.answer_language, translated.body.chatSop.sampling], ['translate', 'b-x', null, 'greedy']);
  const translateRequest = entries().filter(e => e.body).at(-1).body;
  assert.deepEqual(translateRequest.messages, [{role: 'system', content: TRANSLATE_PROMPT}, {role: 'user', content: 'Unde lucrează Maria?'}], 'no history, the fixed prompt');
  assert.equal(translateRequest.temperature, 0);

  const refused = await chat({model: 'b-x', mode: 'formalize'}, 'Does Ana like Alpha Lab?');
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error.code, 'unsupported_mode');
  assert.match(refused.body.error.message, /does not offer mode formalize; models for formalize: m-a, m-b, m-c, missing/);
  assert.equal((await chat({model: 'm-a', mode: 'chat'}, 'hi')).body.error.code, 'unsupported_mode');
  assert.match((await chat({model: 'm-a', mode: 'sing'}, 'hi')).body.error.message, /mode must be chat, formalize or translate/);
  assert.equal((await chat({model: 'b-x', mode: 'chat', chatSop: {trustedSop: '@r remember'}}, 'hi')).status, 400);

  const formalized = await chat({model: 'm-a', mode: 'formalize'}, 'Does Ana like Alpha Lab?');
  assert.equal(formalized.status, 200);
  assert.deepEqual([formalized.body.chatSop.mode, formalized.body.chatSop.model_sop], ['formalize', query]);
  assert.equal(typeof formalized.body.chatSop.latency_ms, 'number');
  const formalizeRequest = entries().filter(e => e.body).at(-1).body;
  assert.deepEqual(formalizeRequest, messageRequest('Does Ana like Alpha Lab?', 6144), 'Formalize stays message-only, whatever the chat history');
  await close(server);
});
