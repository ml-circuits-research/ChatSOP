import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalLLMServer, serverArgs, slotFile} from '../lib/local-llm/server.mjs';
import {localChat} from '../lib/local-llm/client.mjs';

test('the managed llama-server runs with dedicated slots, flash attention, full offload, cache reuse and a slot save path', () => {
  const args = serverArgs({gguf: '/m/model.gguf', port: 19601, alias: 'm', slots: ['direct', 'steps'], ctxPerSlot: 16384, slotSavePath: '/tmp/slots'});
  const value = flag => args[args.indexOf(flag) + 1];
  assert.equal(value('--parallel'), '2');
  assert.equal(value('-c'), String(2 * 16384));
  assert.equal(value('-ngl'), '99');
  assert.equal(value('-fa'), 'on');
  assert.equal(value('--cache-reuse'), '256');
  assert.equal(value('--slot-save-path'), '/tmp/slots');
  assert.ok(args.includes('--no-kv-unified'));
  assert.throws(() => serverArgs({gguf: 'x', port: 1, slots: ['a', 'a']}), /distinct/);
});

test('a slot file is named by model, role and the digest of the exact prefix', () => {
  const a = slotFile({alias: 'qwen', role: 'steps', prefix: 'P1'}), b = slotFile({alias: 'qwen', role: 'steps', prefix: 'P2'});
  assert.match(a, /^qwen-steps-[0-9a-f]{16}\.bin$/);
  assert.notEqual(a, b);
});

/** A stub llama-server: apply-template, completion, slot save/restore and chat, recording every call. */
function stubServer() {
  const calls = [], saved = new Set();
  const fetchImpl = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({url: String(url), body});
    const json = data => new Response(JSON.stringify(data), {status: 200, headers: {'content-type': 'application/json'}});
    if (url.endsWith('/health')) return json({status: 'ok'});
    if (url.endsWith('/apply-template')) return json({prompt: `<sys>${body.messages[0].content}</sys><user>${body.messages.at(-1).content}</user><assistant>`});
    if (url.endsWith('/completion')) return json({timings: {prompt_n: 42}});
    if (url.includes('action=save')) { saved.add(body.filename); return json({n_saved: 42}); }
    if (url.includes('action=restore')) return saved.has(body.filename) ? json({n_restored: 42}) : new Response('{}', {status: 404});
    if (url.endsWith('/chat/completions')) return json({choices: [{message: {content: '<think></think>3'}, finish_reason: 'stop'}], usage: {prompt_tokens: 50, completion_tokens: 1}, timings: {cache_n: 42, prompt_n: 8}});
    return new Response('{}', {status: 404});
  };
  return {calls, fetchImpl};
}

test('prewarm evaluates exactly the stable prefix once, saves it, and every request restores it on its dedicated slot', async () => {
  const {calls, fetchImpl} = stubServer();
  const server = new LocalLLMServer({endpoint: 'http://127.0.0.1:1/v1', alias: 'm', slots: ['direct', 'steps'], fetchImpl});
  const warm = await server.prewarm('steps', [{role: 'system', content: 'RULES'}, {role: 'user', content: 'KINDS:'}]);
  assert.equal(warm.slot, 1);
  const completion = calls.find(c => c.url.endsWith('/completion'));
  assert.equal(completion.body.prompt, '<sys>RULES</sys><user>KINDS:', 'the prefix is cut where the variable part of the first turn begins');
  assert.equal(completion.body.n_predict, 0);
  assert.equal(completion.body.id_slot, 1);
  assert.ok(calls.some(c => c.url.includes('/slots/1?action=save')));
  const turn = await server.begin('steps');
  assert.equal(turn.restored, true);
  assert.ok(calls.at(-1).url.includes('/slots/1?action=restore'));
  // A second request of the same role waits until the first one is released.
  let second = false;
  const next = server.begin('steps').then(t => { second = true; return t; });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(second, false);
  turn.release();
  (await next).release();
  assert.equal(second, true);
  assert.throws(() => server.slotOf('judge'), /no slot/);
});

test('a local chat keeps the prompt cache on, pins its slot and reports reused and evaluated prompt tokens', async () => {
  const {calls, fetchImpl} = stubServer();
  const reply = await localChat({endpoint: 'http://127.0.0.1:1/v1', messages: [{role: 'user', content: 'q'}], slot: 1, fetchImpl});
  assert.equal(reply.text, '3');
  assert.equal(reply.cached, 42);
  assert.equal(reply.evaluated, 8);
  const body = calls.at(-1).body;
  assert.equal(body.cache_prompt, true);
  assert.equal(body.id_slot, 1);
  assert.equal(body.temperature, 0);
});
