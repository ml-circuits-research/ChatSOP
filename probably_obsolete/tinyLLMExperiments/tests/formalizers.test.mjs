// Model registry, the on-demand llama-server manager and the chat API's `model` and `language` fields (DS012 "Formalizer models").
// A fake llama-server script stands in for llama.cpp and a stub service for SymbolicLM: no model is loaded.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Repository} from '../memory/repository.mjs';
import {demoLexicon} from '../lib/knowledge-seeds.mjs';
import {createServer} from '../server/http.mjs';
import {loadRegistry, findLlamaServer, ModelManager} from '../server/formalizers.mjs';
import {messageRequest, predictMessage} from '../lib/llama-chat.mjs';
import {answerLanguage} from '../server/language.mjs';
import {close, listen, repoPath, repoUrl, tempDir} from './helpers.mjs';

const token = 'alice-secret-token-123456';
const query = '@q query\n  where match\n    relation "likes"\n    role subject "Ana"\n    role object "Alpha Lab"\n    polarity affirmed\n  end';

// The stub records its arguments, environment and every request body, then answers like llama-server (a proofreading echo).
const STUB = `#!/usr/bin/env node
const http = require('node:http'), fs = require('node:fs');
const args = process.argv.slice(2), arg = name => args[args.indexOf(name) + 1];
const log = process.env.STUB_LOG, note = entry => fs.appendFileSync(log, JSON.stringify(entry) + '\\n');
note({start: args, cuda: process.env.CUDA_VISIBLE_DEVICES});
http.createServer((req, res) => {
  if (req.url === '/health') { res.end('{"status":"ok"}'); return; }
  let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
    const body = JSON.parse(raw); note({alias: arg('--alias'), body});
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({choices: [{message: {content: 'OK: ' + body.messages.at(-1).content}, finish_reason: 'stop'}]}));
  });
}).listen(Number(arg('--port')), arg('--host'));
`;
const SYMBOLIC_STUB = repoPath('tests/fixtures/capability-api/stub-symbolic-service.mjs');

function setup(t, {models = ['m-a', 'm-b', 'm-c'], ...options} = {}) {
  const dir = tempDir(t, 'chatsop-formalizers-');
  const bin = path.join(dir, 'llama-server');
  fs.writeFileSync(bin, STUB, {mode: 0o755});
  const log = path.join(dir, 'stub.jsonl');
  process.env.STUB_LOG = log;
  for (const id of models) fs.writeFileSync(path.join(dir, id + '.gguf'), 'fake');
  const file = path.join(dir, 'formalizers.json');
  // The SymbolicLM stub service is the formalizer; the GGUF models are proofreading models (a gguf cannot formalize).
  fs.writeFileSync(file, JSON.stringify({default: 'symbolic-lm', models: [
    {id: 'symbolic-lm', label: 'SymbolicLM (stub)', service: SYMBOLIC_STUB, capabilities: ['formalize']},
    ...models.map(id => ({id, label: id.toUpperCase(), gguf: id + '.gguf', capabilities: ['proofread'], note: 'test'})),
    {id: 'missing', label: 'Missing', gguf: 'nothing.gguf', capabilities: ['proofread']},
    {id: 'gone', label: 'Gone', service: 'nothing.mjs', capabilities: ['formalize']}]}));
  const registry = loadRegistry(file, {root: dir});
  const manager = new ModelManager({registry, bin, startTimeoutMs: 10000, ...options});
  t.after(() => manager.stopAll());
  const entries = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  return {dir, registry, manager, entries, bin};
}

const proofread = (manager, id, message, maxTokens = 1024) => manager.use(id, 'proofread', url => predictMessage(url, message, {maxTokens}));

test('the shipped registry lists the proofing and translator models and the SymbolicLM service as the only formalizer (the base-model Chat and Translate entries, the FormalizerLLM entries and the configured endpoint were removed)', () => {
  const registry = loadRegistry(repoPath('config/formalizers.json'));
  assert.deepEqual(registry.models.map(m => [m.id, m.kind, m.capabilities.join('+')]), [
    ['language-proofing-llm', 'gguf', 'proofread'], ['symbolic-proofing-llm', 'gguf', 'proofread-symbolic'], ['translator-llm', 'gguf', 'translate-clean'], ['symbolic-lm', 'service', 'formalize']]);
  assert.equal(registry.default, 'symbolic-lm');
  assert.deepEqual(registry.defaults, {formalize: 'symbolic-lm', proofread: 'language-proofing-llm', 'proofread-symbolic': 'symbolic-proofing-llm', 'translate-clean': 'translator-llm'});
  assert.equal(registry.models.find(m => m.id === 'symbolic-lm').rewriteMode, 'gated', 'the chat default of the SymbolicProofingLLM rewrite follows the registry (gated since Q-PROOF-1)');
  assert.deepEqual(registry.models.filter(m => m.capabilities.includes('formalize')).map(m => m.id), ['symbolic-lm']);
  assert.equal(registry.models.some(m => m.capabilities.some(c => ['chat', 'translate'].includes(c))), false, 'no Chat or Translate base model');
});

test('registry loading refuses duplicates, an unknown default, missing capabilities and entries with both or neither source', t => {
  const dir = tempDir(t);
  const load = data => { const file = path.join(dir, 'r.json'); fs.writeFileSync(file, JSON.stringify(data)); return loadRegistry(file, {root: dir}); };
  const proof = (id, extra = {}) => ({id, label: id.toUpperCase(), gguf: id + '.gguf', capabilities: ['proofread'], ...extra});
  assert.throws(() => load({models: []}), /non-empty/);
  assert.throws(() => load({models: [proof('a'), proof('a')]}), /duplicate/);
  assert.throws(() => load({default: 'z', models: [proof('a')]}), /default z/);
  assert.throws(() => load({models: [proof('a', {endpoint: 'runtime'})]}), /exactly one/);
  assert.throws(() => load({models: [{id: 'a', label: 'A', capabilities: ['proofread']}]}), /exactly one/);
  assert.throws(() => load({models: [proof('Bad Id')]}), /id must be/);
  assert.equal(load({models: [proof('a', {gguf: 'x.gguf'})]}).models[0].gguf, path.join(dir, 'x.gguf'));
  // No implicit capability: a model without a capabilities list is refused, and a gguf is never a formalizer.
  assert.throws(() => load({models: [{id: 'a', label: 'A', gguf: 'a.gguf'}]}), /capabilities is required/);
  assert.throws(() => load({models: [proof('a', {capabilities: ['formalize']})]}), /only a service \(SymbolicLM\) is a formalizer/);
  assert.throws(() => load({models: [proof('a', {capabilities: ['chat']})]}), /capabilities/);
  assert.throws(() => load({models: [proof('a', {capabilities: ['sing']})]}), /capabilities/);
  assert.throws(() => load({models: [proof('a', {capabilities: []})]}), /capabilities/);
  assert.throws(() => load({models: [{id: 'a', label: 'A', endpoint: 'runtime', capabilities: ['formalize']}]}), /runtime endpoint entry was removed/);
  // A local service script (SymbolicLM) is the managed formalizer.
  const service = load({models: [{id: 's', label: 'S', service: 'tools/serve.mjs', capabilities: ['formalize']}]}).models[0];
  assert.deepEqual([service.kind, service.service], ['service', path.join(dir, 'tools/serve.mjs')]);
  assert.throws(() => load({models: [{id: 's', label: 'S', service: 'x.mjs', gguf: 'a', capabilities: ['formalize']}]}), /exactly one/);
  assert.throws(() => load({models: [{id: 's', label: 'S', service: 'x.mjs', capabilities: ['proofread']}]}), /only capability is formalize/);
  assert.throws(() => load({default: 'b', models: [{id: 's', label: 'S', service: 'x.mjs', capabilities: ['formalize']}, proof('b')]}), /not a formalize model/);
  assert.throws(() => load({defaults: {'translate-clean': 'a'}, models: [proof('a')]}), /defaults\.translate-clean a is not a listed translate-clean model/);
  const mixed = load({models: [proof('a'), proof('b', {capabilities: ['proofread', 'translate-clean']})]});
  assert.deepEqual(mixed.defaults, {proofread: 'a', 'translate-clean': 'b'});
  assert.deepEqual(mixed.models[1].capabilities, ['proofread', 'translate-clean']);
});

test('llama-server is found through LLAMA_SERVER_BIN first', t => {
  const {bin} = setup(t);
  assert.equal(findLlamaServer({LLAMA_SERVER_BIN: bin}), bin);
  assert.equal(findLlamaServer({LLAMA_SERVER: bin}), bin);
});

test('the manager starts a CPU server on demand, reuses it and sends the harness request', async t => {
  const {manager, entries} = setup(t);
  assert.equal(manager.status('m-a').state, 'stopped');
  assert.deepEqual(manager.status('missing'), {state: 'error', mode: 'on_demand', error: 'GGUF file not found: ' + path.relative(repoPath(), manager.registry.models.find(m => m.id === 'missing').gguf)});
  const first = await proofread(manager, 'm-a', 'Does Ana like Alpha Lab?');
  assert.equal(first.text, 'OK: Does Ana like Alpha Lab?');
  assert.equal(manager.status('m-a').state, 'ready');
  const port = manager.status('m-a').port;
  await proofread(manager, 'm-a', 'again');
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
  assert.deepEqual(request, messageRequest('Does Ana like Alpha Lab?', 1024), 'message only, greedy, no extra stop strings');
  await assert.rejects(proofread(manager, 'missing', 'x'), /GGUF file not found/);
  assert.equal(manager.status('missing').state, 'error');
  await assert.rejects(manager.formalize('m-a', 'x'), /does not offer formalize/, 'a proofreading model never formalizes');
  await assert.rejects(manager.use('m-a', 'chat', async () => 1), /does not offer chat/, 'there is no Chat mode');
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

test('the chat API selects the SymbolicLM service, validates model, mode and language, and reports model states', async t => {
  const {registry, manager} = setup(t);
  const root = tempDir(t, 'chatsop-http-');
  const repo = new Repository(root);
  repo.init('base');
  const server = createServer({repo, lexicon: demoLexicon(), base: 'base', authTokens: {alice: token}, config: {policy: {allowWrite: true}}, formalizers: {registry, manager}});
  const url = await listen(t, server);
  const call = async (method, route, body) => {
    const response = await fetch(url + route, {method, headers: {Authorization: 'Bearer ' + token, ...(body ? {'Content-Type': 'application/json'} : {})}, body: body ? JSON.stringify(body) : undefined});
    return {status: response.status, body: await response.json()};
  };
  const chat = (extra, content = 'Does Ana like Alpha Lab?') => call('POST', '/v1/chat/completions', {messages: [{role: 'user', content}], conversation_id: 'c1', ...extra});

  const listed = await call('GET', '/v1/models');
  assert.deepEqual(listed.body.data.map(d => [d.id, d.chatsop.state]), [['symbolic-lm', 'stopped'], ['m-a', 'stopped'], ['m-b', 'stopped'], ['m-c', 'stopped'], ['missing', 'error'], ['gone', 'error']]);
  assert.equal(listed.body.default, 'symbolic-lm');
  assert.deepEqual(listed.body.defaults, {formalize: 'symbolic-lm', proofread: 'm-a'});

  const unknown = await chat({model: 'nope'});
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error.code, 'unknown_model');
  assert.match(unknown.body.error.message, /Unknown model "nope"; GET \/v1\/models lists the available models: chatsop-local, symbolic-lm, m-a/);
  const badLanguage = await chat({model: 'symbolic-lm', language: 'de'});
  assert.equal(badLanguage.status, 400);
  assert.match(badLanguage.body.error.message, /language must be en, ro or auto/);
  // Only a formalizer answers a chat turn: a proofreading model is refused, and the removed modes are a clear error.
  const notFormalizer = await chat({model: 'm-b'});
  assert.equal(notFormalizer.status, 400);
  assert.equal(notFormalizer.body.error.code, 'unsupported_mode');
  assert.match(notFormalizer.body.error.message, /"m-b" is not a formalizer; formalizers: symbolic-lm, gone/);
  for (const mode of ['chat', 'translate', 'sing']) {
    const removed = await chat({model: 'symbolic-lm', mode}, 'hi');
    assert.equal(removed.status, 400, mode);
    assert.equal(removed.body.error.code, 'unsupported_mode');
    assert.match(removed.body.error.message, /the only mode is formalize/);
  }
  assert.equal((await chat({model: 'gone'})).status, 503);

  const started = await call('POST', '/v1/models/symbolic-lm/start');
  assert.equal(started.status, 202);
  assert.ok(['starting', 'ready'].includes(started.body.state));
  assert.equal((await call('POST', '/v1/models/nope/start')).status, 404);

  const reply = await chat({model: 'symbolic-lm', mode: 'formalize', language: 'auto'});
  assert.equal(reply.status, 200);
  assert.equal(reply.body.model, 'symbolic-lm');
  assert.equal(reply.body.chatSop.mode, 'formalize');
  assert.equal(reply.body.chatSop.formalizer_model, 'symbolic-lm');
  assert.equal(reply.body.chatSop.formalizer_label, 'SymbolicLM (stub)');
  assert.equal(reply.body.chatSop.prompt_profile, undefined, 'there are no prompt profiles any more');
  assert.equal(typeof reply.body.chatSop.formalization_ms, 'number');
  assert.equal(reply.body.chatSop.model_sop, query);
  assert.deepEqual([reply.body.chatSop.answer_language, reply.body.chatSop.language_source], ['en', 'default']);

  const forced = await chat({model: 'symbolic-lm', language: 'en'}, 'Please answer in Romanian: Ana likes Alpha Lab?');
  assert.deepEqual([forced.body.chatSop.answer_language, forced.body.chatSop.language_source], ['en', 'request'], 'no detection when English is picked');
  const inferred = await chat({model: 'symbolic-lm', language: 'auto'}, 'Please answer in Romanian: Ana likes Alpha Lab?');
  assert.deepEqual([inferred.body.chatSop.answer_language, inferred.body.chatSop.language_source], ['ro', 'prompt']);

  const facade = await chat({model: 'chatsop-local'});
  assert.equal(facade.body.chatSop.formalizer_model, 'symbolic-lm', 'the façade id selects the registry default');

  const rejected = await chat({model: 'symbolic-lm'}, 'BADSOP');
  assert.equal(rejected.status, 422);
  assert.equal(rejected.body.error.code, 'model_output_rejected');
  assert.match(rejected.body.chatSop.rejection, /stated_value_not_in_message/);
  assert.match(rejected.body.chatSop.model_sop, /Nobody/);

  const ready = await call('GET', '/readyz');
  assert.equal(ready.status, 200);
  assert.deepEqual(ready.body.formalizers.map(m => [m.id, m.state]), [['symbolic-lm', 'ready'], ['m-a', 'stopped'], ['m-b', 'stopped'], ['m-c', 'stopped'], ['missing', 'error'], ['gone', 'error']]);
  await close(server);
});

test('without a model registry no formalizer exists: the chat answers 503 and the server reports not ready', async t => {
  const root = tempDir(t, 'chatsop-http-noreg-');
  const repo = new Repository(root);
  repo.init('base');
  const server = createServer({repo, lexicon: demoLexicon(), base: 'base', authTokens: {alice: token}, config: {policy: {allowWrite: true}}});
  const url = await listen(t, server);
  const headers = {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'};
  const reply = await fetch(url + '/v1/chat/completions', {method: 'POST', headers, body: JSON.stringify({model: 'chatsop-local', messages: [{role: 'user', content: 'Does Ana like Alpha Lab?'}]})});
  assert.equal(reply.status, 503);
  assert.equal((await reply.json()).error.code, 'model_unavailable');
  assert.equal((await fetch(url + '/readyz', {headers})).status, 503);
  await close(server);
});
