// The independent capability APIs and their caches (DS030, docs/api.html): every endpoint, validation and auth, the never-total-failure
// principle (`status`, `errors`, `clarify`), cache hits and misses counted at the real model processes (stubs), in-flight de-duplication
// under 50 concurrent requests, a model switch invalidating the key, and the chat's formalize request reusing the earlier calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Repository} from '../memory/repository.mjs';
import {Lexicon} from '../sop/lexicon.mjs';
import {createServer} from '../server/http.mjs';
import {loadRegistry, FormalizerManager} from '../server/formalizers.mjs';
import {listen, repoPath, repoUrl, tempDir} from './helpers.mjs';

const token = 'alice-secret-token-123456';

async function setup(t, {rewriteMode = 'off', withProofing = true, withRewrite = true, withTranslator = true} = {}) {
  const dir = tempDir(t, 'chatsop-capability-api-');
  const log = path.join(dir, 'stub.jsonl');
  process.env.STUB_LOG = log;
  t.after(() => { delete process.env.STUB_LOG; });
  const bin = path.join(dir, 'llama-server');
  fs.copyFileSync(repoPath('tests/fixtures/capability-api/stub-llama-server.cjs'), bin);
  fs.chmodSync(bin, 0o755);
  for (const name of ['language-proofing', 'symbolic-proofing', 'translator']) fs.writeFileSync(path.join(dir, name + '.gguf'), 'fake');
  const file = path.join(dir, 'formalizers.json');
  fs.writeFileSync(file, JSON.stringify({default: 'symbolic-lm', models: [
    {id: 'symbolic-lm', label: 'SymbolicLM', service: repoPath('tests/fixtures/capability-api/stub-symbolic-service.mjs'), rewrite: {mode: rewriteMode}},
    ...(withProofing ? [{id: 'language-proofing-llm', label: 'LanguageProofingLLM', gguf: 'language-proofing.gguf', capabilities: ['proofread']}] : []),
    ...(withTranslator ? [{id: 'translator-llm', label: 'TranslatorLLM', gguf: 'translator.gguf', capabilities: ['translate-clean']}] : []),
    ...(withRewrite ? [{id: 'symbolic-proofing-llm', label: 'SymbolicProofingLLM', gguf: 'symbolic-proofing.gguf', capabilities: ['proofread-symbolic']}] : [])]}));
  const registry = loadRegistry(file, {root: dir});
  const manager = new FormalizerManager({registry, bin, startTimeoutMs: 15000, logDir: null});
  t.after(() => manager.stopAll());
  const repo = new Repository(path.join(dir, 'state'));
  repo.init('base');
  const server = createServer({repo, lexicon: Lexicon.load(repoUrl('config/ontology.sop')), base: 'base', authTokens: {alice: token}, config: {promptProfile: 'formal', policy: {allowWrite: true}}, formalizers: {registry, manager}, limits: {maxConcurrentApi: 80}});
  const url = await listen(t, server);
  const request = async (method, route, body, headers = {Authorization: 'Bearer ' + token}) => {
    const response = await fetch(url + route, {method, headers: {...headers, ...(body ? {'Content-Type': 'application/json'} : {})}, body: body ? JSON.stringify(body) : undefined});
    const raw = await response.text();
    return {status: response.status, body: response.headers.get('content-type')?.includes('json') ? JSON.parse(raw) : raw};
  };
  const entries = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  const serviceCalls = () => entries().filter(e => e.service).length;
  const llmCalls = alias => entries().filter(e => e.alias === alias).length;
  return {request, entries, serviceCalls, llmCalls, dir, registry, server};
}

const shape = body => {
  assert.equal(typeof body.timings.total_ms, 'number', 'timings.total_ms');
  assert.ok(['hit', 'miss'].includes(body.cache), 'cache is hit or miss');
  assert.ok(body.versions && body.versions.api === 'capability-api-v1', 'versions');
};

test('proofread: the sentence model is called once per distinct sentence and option set', async t => {
  const {request, llmCalls} = await setup(t);
  const first = await request('POST', '/v1/language/proofread', {message: 'Who manages the team.', sendAll: true});
  assert.equal(first.status, 200);
  assert.equal(first.body.object, 'language.proofread');
  assert.equal(first.body.clean, 'Who manages the team (cleaned).');
  assert.equal(first.body.status, 'ok');
  shape(first.body);
  assert.equal(first.body.cache, 'miss');
  assert.equal(first.body.versions.language_proofing_llm.id, 'language-proofing-llm');
  assert.equal(llmCalls('language-proofing-llm'), 1);
  const again = await request('POST', '/v1/language/proofread', {message: 'Who manages the team.', sendAll: true});
  assert.equal(again.body.cache, 'hit');
  assert.equal(again.body.clean, first.body.clean);
  assert.equal(llmCalls('language-proofing-llm'), 1, 'the second request made no model call');
  const other = await request('POST', '/v1/language/proofread', {message: 'Who manages the team.', sendAll: false});
  assert.equal(other.body.cache, 'miss', 'different options are a different key');
  assert.equal(other.body.changed, false);
  // Another message sharing a sentence reuses that sentence's model call.
  const mixed = await request('POST', '/v1/language/proofread', {message: 'Who manages the team. Where is Ana.', sendAll: true});
  assert.equal(mixed.body.cache, 'miss');
  assert.equal(mixed.body.sentence_cache.hit, 1);
  assert.equal(llmCalls('language-proofing-llm'), 2, 'only the new sentence reached the model');
});

test('proofread: Romanian goes to the translator, English to LanguageProofingLLM, each cached per sentence; the trace names both', async t => {
  const {request, llmCalls} = await setup(t);
  const message = 'Cine lucreaza la echipa de proiect? Who manages the team.';
  const first = await request('POST', '/v1/language/proofread', {message, sendAll: true});
  assert.equal(first.status, 200);
  shape(first.body);
  assert.equal(first.body.fallback, null);
  assert.deepEqual(first.body.routes.map(r => r.backend), ['translator-llm', 'llm']);
  assert.equal(first.body.backend, 'translator-llm+llm');
  assert.match(first.body.clean, /^EN: Cine lucreaza la echipa de proiect\? Who manages the team \(cleaned\)\.$/);
  assert.equal(first.body.versions.translator_llm.id, 'translator-llm');
  assert.equal(llmCalls('translator-llm'), 1);
  assert.equal(llmCalls('language-proofing-llm'), 1);
  const again = await request('POST', '/v1/language/proofread', {message, sendAll: true});
  assert.equal(again.body.cache, 'hit');
  assert.equal(llmCalls('translator-llm'), 1);
  const caps = await request('GET', '/v1/capabilities');
  assert.equal(caps.body.versions.translator_llm.id, 'translator-llm');
});

test('proofread: with no translator in the registry the sentence falls back to LanguageProofingLLM, visibly, and the fallback is not cached', async t => {
  const {request, llmCalls} = await setup(t, {withTranslator: false});
  const message = 'Cine lucreaza la echipa de proiect?';
  const first = await request('POST', '/v1/language/proofread', {message});
  assert.equal(first.status, 200);
  assert.equal(first.body.fallback.from, 'translator-llm');
  assert.equal(first.body.fallback.to, 'llm');
  assert.equal(first.body.backend, 'llm');
  assert.equal(first.body.status, 'ok');
  assert.equal(first.body.warnings[0].code, 'fallback');
  assert.match(first.body.clean, /\(cleaned\)/);
  assert.equal(first.body.versions.translator_llm, null);
  const again = await request('POST', '/v1/language/proofread', {message});
  assert.equal(again.body.cache, 'miss', 'a fallback answer is never served from the cache');
  assert.equal(again.body.fallback.to, 'llm');
  assert.equal(llmCalls('language-proofing-llm'), 2);
});

test('the old endpoint is an alias of proofread', async t => {
  const {request} = await setup(t);
  const a = await request('POST', '/v1/text-to-clean-english', {message: 'Who manages the team.', sendAll: true});
  assert.equal(a.status, 200);
  assert.equal(a.body.clean, 'Who manages the team (cleaned).');
  assert.equal((await request('POST', '/v1/language/proofread', {message: 'Who manages the team.', sendAll: true})).body.cache, 'hit');
});

test('proofread never fails totally: a model that cannot start leaves the text as written and says so, and is not cached', async t => {
  const {request, registry} = await setup(t);
  const missing = path.join(path.dirname(registry.models.find(m => m.id === 'language-proofing-llm').gguf), 'gone.gguf');
  registry.models.find(m => m.id === 'language-proofing-llm').gguf = missing;
  // The manager reads the registry entry it was built with: point its entry at the missing file too.
  const res = await request('POST', '/v1/language/proofread', {message: 'Who manages the team.', sendAll: true});
  assert.equal(res.status, 200);
  assert.equal(res.body.changed, false);
  assert.equal(res.body.clean, 'Who manages the team.');
  assert.equal(res.body.status, 'partial');
  assert.equal(res.body.errors[0].component, 'language-proofing-llm');
  assert.equal(res.body.errors[0].span, 'Who manages the team.');
  const again = await request('POST', '/v1/language/proofread', {message: 'Who manages the team.', sendAll: true});
  assert.equal(again.body.cache, 'miss', 'a degraded answer is never cached');
});

test('understand: CNL per sentence, certification, pragmatic signals; the second call is a cache hit with no service call', async t => {
  const {request, serviceCalls} = await setup(t);
  const first = await request('POST', '/v1/understand', {message: 'Thanks a lot! Does Ana like Alpha Lab?'});
  assert.equal(first.status, 200);
  assert.equal(first.body.object, 'symbolic.understanding');
  assert.equal(first.body.status, 'ok');
  assert.equal(first.body.interpretation.available, true);
  assert.equal(first.body.interpretation.sentences[0].status, 'verified');
  assert.equal(first.body.certified, true);
  assert.equal(first.body.clarify, null);
  assert.ok(first.body.emotion.signals.some(s => s.kind === 'thanks'), 'tone detection ran in the host');
  assert.ok(first.body.emotion.emoji.some(e => e.kind === 'thanks' && e.emoji));
  shape(first.body);
  assert.equal(first.body.cache, 'miss');
  assert.equal(first.body.versions.symbolic_lm.version.startsWith('symbolic-lm'), true);
  assert.equal(serviceCalls(), 1);
  const again = await request('POST', '/v1/understand', {message: 'Thanks a lot! Does Ana like Alpha Lab?'});
  assert.equal(again.body.cache, 'hit');
  assert.deepEqual(again.body.cache_detail, {symbolic_lm: 'hit', emotion: 'hit'});
  assert.equal(serviceCalls(), 1);
  const noEmotion = await request('POST', '/v1/understand', {message: 'Thanks a lot! Does Ana like Alpha Lab?', emotion: false});
  assert.equal(noEmotion.body.emotion, null);
  assert.equal(noEmotion.body.cache, 'hit', 'the analysis is shared whatever the tone setting');
});

test('understand: a not-represented span gives a clarification; a classified one does not', async t => {
  const {request} = await setup(t);
  const res = await request('POST', '/v1/understand', {message: 'Does Ana like NOREP Alpha Lab?'});
  assert.equal(res.body.status, 'ok');
  assert.deepEqual(res.body.leftovers.remaining, [{span: 'xyz'}]);
  assert.equal(res.body.clarify, 'I did not understand: “xyz”. Could you rephrase it?');
  assert.deepEqual(res.body.clarify_items, [{kind: 'not_represented', text: 'xyz'}]);
  const unsure = await request('POST', '/v1/understand', {message: 'Does Ana like UNSURE Alpha Lab?'});
  assert.match(unsure.body.clarify, /not sure I understood/);
});

test('understand never fails totally: one broken sentence is marked, the others are still understood', async t => {
  const {request, serviceCalls} = await setup(t);
  const res = await request('POST', '/v1/understand', {message: 'Does Ana like Alpha Lab? BOOM goes the parser. Where is Bob?'});
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'partial');
  const sentences = res.body.interpretation.sentences;
  assert.deepEqual(sentences.map(s => s.status), ['verified', 'failed', 'verified']);
  assert.equal(sentences[1].text, 'BOOM goes the parser.');
  assert.equal(sentences[2].start, 'Does Ana like Alpha Lab? BOOM goes the parser. '.length);
  assert.equal(res.body.errors[0].component, 'symbolic-lm');
  assert.match(res.body.clarify, /I did not understand: “BOOM goes the parser\.”/);
  assert.ok(serviceCalls() >= 4, 'whole message, then each sentence');
  // The healthy sentences are cached; the failure is not.
  const before = serviceCalls();
  await request('POST', '/v1/understand', {message: 'Does Ana like Alpha Lab? BOOM goes the parser. Where is Bob?'});
  assert.equal(serviceCalls() - before, 2, 'the whole message and the failing sentence run again, the healthy sentences do not');
});

test('understand with a single broken message still answers 200 with what is known (language, tone) and no error status', async t => {
  const {request} = await setup(t);
  const res = await request('POST', '/v1/understand', {message: 'Thanks, BOOM'});
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'partial');
  assert.equal(res.body.interpretation.available, false);
  assert.ok(res.body.emotion.signals.length >= 1);
  assert.equal(res.body.errors[0].code, 'component_failed');
});

test('analyze returns the raw analysis and shares the cache with itself only (interpretation off is a different key)', async t => {
  const {request, serviceCalls} = await setup(t);
  const a = await request('POST', '/v1/symbolic/analyze', {message: 'Does Ana like Alpha Lab?'});
  assert.equal(a.status, 200);
  assert.equal(a.body.object, 'symbolic.analysis');
  assert.match(a.body.sop, /^@q query/);
  assert.ok(a.body.analysis);
  shape(a.body);
  assert.equal((await request('POST', '/v1/symbolic/analyze', {message: 'Does Ana like Alpha Lab?'})).body.cache, 'hit');
  assert.equal(serviceCalls(), 1);
  await request('POST', '/v1/understand', {message: 'Does Ana like Alpha Lab?'});
  assert.equal(serviceCalls(), 2);
});

test('analyze of an unavailable SymbolicLM reports status unavailable with the error, not an HTTP error', async t => {
  const {request, registry, manager} = await setup(t).then(x => ({...x, manager: null}));
  void manager;
  registry.models.find(m => m.id === 'symbolic-lm').service = '/nonexistent/service.mjs';
  const res = await request('POST', '/v1/symbolic/analyze', {message: 'Does Ana like Alpha Lab?'});
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'unavailable');
  assert.equal(res.body.analysis, null);
  assert.equal(res.body.errors[0].component, 'symbolic-lm');
});

test('rewrite: always calls SymbolicProofingLLM alone per sentence (cached); gated goes through SymbolicLM', async t => {
  const {request, llmCalls, serviceCalls} = await setup(t);
  const always = await request('POST', '/v1/symbolic/rewrite', {message: 'Whom does Ana like? Whom does Bob like?', mode: 'always'});
  assert.equal(always.status, 200);
  assert.equal(always.body.object, 'symbolic.rewrite');
  assert.equal(always.body.output, 'Who does Ana like? Who does Bob like?');
  assert.equal(always.body.applied, true);
  assert.equal(always.body.units.length, 2);
  assert.equal(llmCalls('symbolic-proofing-llm'), 2);
  assert.equal(serviceCalls(), 0, 'no Stanza analysis for an unconditional rewrite');
  const again = await request('POST', '/v1/symbolic/rewrite', {message: 'Whom does Ana like?', mode: 'always'});
  assert.equal(again.body.cache, 'hit');
  assert.equal(llmCalls('symbolic-proofing-llm'), 2);
  const gated = await request('POST', '/v1/symbolic/rewrite', {message: 'Does Ana like Alpha Lab?', mode: 'gated'});
  assert.equal(gated.body.status, 'ok');
  assert.equal(gated.body.gate, 'trees');
  assert.equal(gated.body.acceptance, 'certified');
  assert.equal(serviceCalls(), 1);
});

test('emotion detect: signals, emoticon suggestions, the pragmatic circuit and the advice; the second call is a hit', async t => {
  const {request} = await setup(t);
  const res = await request('POST', '/v1/emotion/detect', {message: 'Thank you so much!'});
  assert.equal(res.status, 200);
  assert.equal(res.body.object, 'emotion.detection');
  assert.ok(res.body.signals.some(s => s.kind === 'thanks'));
  const thanks = res.body.emoji.find(e => e.kind === 'thanks');
  assert.ok(thanks.emoji && thanks.span && typeof thanks.score === 'number');
  assert.match(res.body.sop, /pragmatic/);
  assert.ok(res.body.advice);
  shape(res.body);
  assert.equal((await request('POST', '/v1/emotion/detect', {message: 'Thank you so much!'})).body.cache, 'hit');
});

test('requests are validated: parameters, message, size, authentication', async t => {
  const {request} = await setup(t);
  assert.equal((await request('POST', '/v1/understand', {})).body.error.code, 'invalid_message');
  assert.equal((await request('POST', '/v1/understand', {message: '  '})).status, 400);
  assert.equal((await request('POST', '/v1/understand', {message: 'hi', extra: 1})).body.error.code, 'unsupported_parameter');
  assert.equal((await request('POST', '/v1/understand', {message: 'hi', rewrite: 'sometimes'})).body.error.code, 'invalid_parameter');
  assert.equal((await request('POST', '/v1/emotion/detect', {message: 'hi', hasContent: 'no'})).status, 400);
  assert.equal((await request('POST', '/v1/symbolic/rewrite', {message: 'hi', mode: 'off'})).status, 400);
  assert.equal((await request('POST', '/v1/language/proofread', {message: 'x'.repeat(6000)})).status, 413);
  assert.equal((await request('POST', '/v1/understand', null, {Authorization: 'Bearer wrong-token-wrong-token'})).status, 401);
  assert.equal((await request('POST', '/v1/understand', {message: 'hi'}, {})).status, 401);
  assert.equal((await request('GET', '/v1/understand')).status, 404);
});

test('50 concurrent identical understand requests make exactly one service call; mixed users and messages stay separate', async t => {
  const {request, serviceCalls} = await setup(t);
  const same = await Promise.all(Array.from({length: 50}, () => request('POST', '/v1/understand', {message: 'SLOW Does Ana like Alpha Lab?'})));
  assert.ok(same.every(r => r.status === 200 && r.body.interpretation.sentences[0].text === 'SLOW Does Ana like Alpha Lab?'));
  assert.equal(serviceCalls(), 1);
  assert.equal(same.filter(r => r.body.cache === 'miss').length, 1);
  const messages = ['SLOW one?', 'SLOW two?', 'SLOW three?', 'SLOW four?'];
  const mixed = await Promise.all(Array.from({length: 40}, (_, i) => request('POST', '/v1/understand', {message: messages[i % 4]})));
  mixed.forEach((r, i) => assert.equal(r.body.interpretation.sentences[0].text, messages[i % 4], 'no cross-talk between keys'));
  assert.equal(serviceCalls(), 5);
});

test('a model switch invalidates the key: a changed model file is a miss', async t => {
  const {request, llmCalls, dir} = await setup(t);
  const body = {message: 'Who manages the team.', sendAll: true};
  await request('POST', '/v1/language/proofread', body);
  assert.equal((await request('POST', '/v1/language/proofread', body)).body.cache, 'hit');
  fs.writeFileSync(path.join(dir, 'language-proofing.gguf'), 'a different, larger fake model file');
  const after = await request('POST', '/v1/language/proofread', body);
  assert.equal(after.body.cache, 'miss');
  assert.equal(llmCalls('language-proofing-llm'), 2);
});

test('cache stats need no administrator; capabilities lists the endpoints; clear empties the caches', async t => {
  const {request} = await setup(t);
  await request('POST', '/v1/emotion/detect', {message: 'Thanks!'});
  await request('POST', '/v1/emotion/detect', {message: 'Thanks!'});
  const stats = await request('GET', '/v1/cache/stats');
  assert.equal(stats.status, 200);
  assert.deepEqual(Object.keys(stats.body.caches).sort(), ['emotion', 'proofread', 'proofread-llm', 'symbolic-lm', 'symbolic-proofing-llm']);
  const e = stats.body.caches.emotion;
  assert.deepEqual([e.hits, e.misses, e.entries], [1, 1, 1]);
  assert.ok(e.maxEntries > 0 && e.maxBytes > 0 && e.ttlMs > 0);
  const caps = await request('GET', '/v1/capabilities');
  assert.ok(caps.body.endpoints.some(x => x.path === '/v1/understand'));
  assert.equal(caps.body.limits.max_message_bytes, 4800);
  const cleared = await request('POST', '/v1/cache/clear');
  assert.equal(cleared.body.caches.emotion.entries, 0);
});

test('the chat formalize request reuses the proofread-time understand and emotion calls', async t => {
  const {request, serviceCalls} = await setup(t);
  const text = 'Thanks! Does Ana like NOREP Alpha Lab?';
  const understood = await request('POST', '/v1/understand', {message: text, emotion: true});
  assert.equal(understood.body.cache, 'miss');
  const emotionStats = (await request('GET', '/v1/cache/stats')).body.caches.emotion;
  const chat = await request('POST', '/v1/chat/completions', {model: 'symbolic-lm', mode: 'formalize', messages: [{role: 'user', content: text}], conversation_id: 'reuse1', understanding: {interpret: true, rewrite: 'off', emotion: true}});
  assert.equal(chat.status, 200);
  assert.equal(serviceCalls(), 1, 'the formalize request made no second service call');
  assert.equal(chat.body.chatSop.understanding.cache, 'hit');
  const after = (await request('GET', '/v1/cache/stats')).body.caches.emotion;
  assert.equal(after.misses, emotionStats.misses, 'the tone detection of the formalize request was a cache hit');
  assert.equal(after.hits, emotionStats.hits + 1);
  assert.ok(chat.body.chatSop.understanding.emotion.signals.some(s => s.kind === 'thanks'));
});

test('the chat formalize request and a concurrent understand request share one in-flight call', async t => {
  const {request, serviceCalls} = await setup(t);
  const text = 'SLOW Does Ana like Alpha Lab?';
  const [a, b] = await Promise.all([
    request('POST', '/v1/understand', {message: text}),
    request('POST', '/v1/chat/completions', {model: 'symbolic-lm', mode: 'formalize', messages: [{role: 'user', content: text}], conversation_id: 'reuse2', understanding: {interpret: true, rewrite: 'off', emotion: false}})]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(serviceCalls(), 1);
});

test('the capability API examples of docs/api.html match the live handlers', async t => {
  const html = fs.readFileSync(repoPath('docs/api.html'), 'utf8');
  const examples = [...html.matchAll(/<pre class="api-example" data-endpoint="(\S+) (\S+)" data-request="([^"]*)" data-response-keys="([^"]*)">/g)];
  assert.ok(examples.length >= 6, 'the page documents every endpoint with an executable example');
  const {request} = await setup(t);
  const documented = new Set();
  for (const [, method, route, encoded, keys] of examples) {
    documented.add(route);
    const body = method === 'GET' ? undefined : JSON.parse(encoded.replaceAll('&quot;', '"'));
    const res = await request(method, route, body);
    assert.equal(res.status, 200, `${method} ${route}`);
    assert.ok(res.body.object, `${route} answers with an object type`);
    for (const key of keys.split(',')) assert.ok(key in res.body, `${route}: the documented response key ${key} is present`);
  }
  for (const route of ['/v1/language/proofread', '/v1/understand', '/v1/symbolic/rewrite', '/v1/symbolic/analyze', '/v1/emotion/detect', '/v1/capabilities', '/v1/cache/stats']) assert.ok(documented.has(route), route + ' has an example');
});

test('SymbolicLM caches the Stanza parse of a text: concurrent and repeated calls reach the worker once', async () => {
  const {SymbolicLM} = await import('../lib/symbolic-lm/index.mjs');
  let calls = 0;
  const worker = {package: 'default', start: async () => ({}), stop: async () => {}, request: async ({text}) => { calls++; await new Promise(r => setTimeout(r, 15)); return {parse: {sentences: [{text, words: []}]}, ms: 15}; }};
  const lm = new SymbolicLM({worker, lexicons: {has: () => false, perMillion: () => 0}});
  const results = await Promise.all(Array.from({length: 10}, () => lm.parse('Ana works at Lidl.', 'en')));
  await lm.parse('Ana works at Lidl.', 'en');
  await lm.parse('Bob sings.', 'en');
  assert.equal(calls, 2);
  results[0].parse.sentences[0].text = 'mutated';
  assert.equal((await lm.parse('Ana works at Lidl.', 'en')).parse.sentences[0].text, 'Ana works at Lidl.', 'a caller cannot corrupt the cached parse');
  assert.equal(lm.parseCache.stats().entries, 2);
});
