// "Understanding in the chat" (DS012, DS021 "Interpretation CNL"): the chat API fields `understanding` and `sendAll`, the SymbolicLM
// service options they produce, the SymbolicProofingLLM registry entry started on demand, the chat page settings, and the
// per-sentence interpretation (lib/symbolic-lm/interpretation.mjs) with fake parses. Stub processes stand in for the models.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Repository} from '../memory/repository.mjs';
import {Lexicon} from '../sop/lexicon.mjs';
import {createServer} from '../server/http.mjs';
import {loadRegistry, FormalizerManager} from '../server/formalizers.mjs';
import {interpretResult, analysisSummary} from '../lib/symbolic-lm/interpretation.mjs';
import {listen, repoPath, repoUrl, tempDir} from './helpers.mjs';

const token = 'alice-secret-token-123456';

async function setup(t, {rewriteMode = 'off'} = {}) {
  const dir = tempDir(t, 'chatsop-understanding-');
  const log = path.join(dir, 'stub.jsonl');
  process.env.STUB_LOG = log;
  t.after(() => { delete process.env.STUB_LOG; });
  const bin = path.join(dir, 'llama-server');
  fs.copyFileSync(repoPath('tests/fixtures/chat-understanding/stub-llama-server.cjs'), bin);
  fs.chmodSync(bin, 0o755);
  for (const name of ['language-proofing', 'symbolic-proofing']) fs.writeFileSync(path.join(dir, name + '.gguf'), 'fake');
  const file = path.join(dir, 'formalizers.json');
  fs.writeFileSync(file, JSON.stringify({default: 'symbolic-lm', models: [
    {id: 'symbolic-lm', label: 'SymbolicLM', service: repoPath('tests/fixtures/chat-understanding/stub-symbolic-service.mjs'), rewrite: {mode: rewriteMode}},
    {id: 'language-proofing-llm', label: 'LanguageProofingLLM', gguf: 'language-proofing.gguf', capabilities: ['proofread']},
    {id: 'symbolic-proofing-llm', label: 'SymbolicProofingLLM', gguf: 'symbolic-proofing.gguf', capabilities: ['proofread-symbolic']}]}));
  const registry = loadRegistry(file, {root: dir});
  const manager = new FormalizerManager({registry, bin, startTimeoutMs: 15000, logDir: null});
  t.after(() => manager.stopAll());
  const repo = new Repository(path.join(dir, 'state'));
  repo.init('base');
  const server = createServer({repo, lexicon: Lexicon.load(repoUrl('config/ontology.sop')), base: 'base', authTokens: {alice: token}, config: {promptProfile: 'formal', policy: {allowWrite: true}}, formalizers: {registry, manager}});
  const url = await listen(t, server);
  const request = async (method, route, body) => {
    const response = await fetch(url + route, {method, headers: {Authorization: 'Bearer ' + token, ...(body ? {'Content-Type': 'application/json'} : {})}, body: body ? JSON.stringify(body) : undefined});
    const raw = await response.text();
    return {status: response.status, body: response.headers.get('content-type')?.includes('json') ? JSON.parse(raw) : raw};
  };
  const chat = (content, extra = {}) => request('POST', '/v1/chat/completions', {model: 'symbolic-lm', mode: 'formalize', messages: [{role: 'user', content}], conversation_id: 'u' + Math.random().toString(36).slice(2, 8), ...extra});
  const entries = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  return {chat, request, entries, manager, registry};
}

test('the interpretation is on by default, the rewrite follows the registry default and is off', async t => {
  const {chat, entries, manager} = await setup(t);
  const answer = await chat('Does Ana like Alpha Lab?');
  assert.equal(answer.status, 200);
  const u = answer.body.chatSop.understanding;
  assert.deepEqual(u.requested, {interpret: true, rewrite: 'off', emotion: true});
  assert.equal(u.interpretation.available, true);
  assert.equal(u.interpretation.sentences[0].cnl, 'Does Ana like Alpha Lab?');
  assert.equal(u.analysed_text, 'Does Ana like Alpha Lab?');
  assert.deepEqual(u.received, undefined, 'the host report keeps only what the page shows');
  const sent = entries().find(e => e.service).body;
  assert.deepEqual(sent.symbolic_lm, {interpret: true, emotion: false}, 'no rewrite endpoint without the setting; the tone detection runs in the host (cached, DS030), never in the service call');
  assert.deepEqual(sent.messages, [{role: 'user', content: 'Does Ana like Alpha Lab?'}], 'the model input is still the message alone');
  assert.equal(manager.status('symbolic-proofing-llm').state, 'stopped', 'SymbolicProofingLLM is not started while the rewrite is off');
});

test('the tone-detection toggle (EmotionDetectionSystem) is sent to the service and reported', async t => {
  const {chat, entries} = await setup(t);
  const off = await chat('Does Ana like Alpha Lab?', {understanding: {emotion: false}});
  assert.equal(off.status, 200);
  assert.equal(off.body.chatSop.understanding.requested.emotion, false);
  assert.deepEqual(entries().filter(e => e.service).at(-1).body.symbolic_lm, {interpret: true, emotion: false}, 'the service never detects tone itself');
});

test('gated starts SymbolicProofingLLM on demand and sends trees + certified; always keeps every rewrite', async t => {
  const {chat, entries, manager} = await setup(t);
  const gated = await chat('Does Ana like Alpha Lab?', {understanding: {rewrite: 'gated'}});
  assert.equal(gated.status, 200);
  assert.deepEqual([gated.body.chatSop.understanding.requested.rewrite, gated.body.chatSop.understanding.requested.rewrite_model], ['gated', 'symbolic-proofing-llm']);
  assert.equal(manager.status('symbolic-proofing-llm').state, 'ready');
  assert.ok(entries().some(e => e.start === 'symbolic-proofing-llm'));
  const first = entries().filter(e => e.service).at(-1).body.symbolic_lm;
  assert.equal(first.rewrite_when, 'trees');
  assert.equal(first.rewrite_accept, 'certified');
  assert.match(first.rewrite_url, /^http:\/\/127\.0\.0\.1:\d+\/v1\/chat\/completions$/);
  assert.equal(gated.body.chatSop.understanding.rewrite.gate, 'trees');
  const always = await chat('Does Ana like Alpha Lab?', {understanding: {rewrite: 'always', interpret: false}});
  const second = entries().filter(e => e.service).at(-1).body.symbolic_lm;
  assert.deepEqual([second.rewrite_when, second.rewrite_accept, second.interpret], ['always', 'off', false]);
  assert.equal(always.body.chatSop.understanding.interpretation, null);
  assert.equal(entries().filter(e => e.start === 'symbolic-proofing-llm').length, 1, 'the model is started once and reused');
});

test('the registry default of the rewrite is read from the SymbolicLM entry', async t => {
  const {chat, request} = await setup(t, {rewriteMode: 'gated'});
  assert.equal((await chat('Does Ana like Alpha Lab?')).body.chatSop.understanding.requested.rewrite, 'gated');
  assert.equal((await chat('Does Ana like Alpha Lab?', {understanding: {rewrite: 'off'}})).body.chatSop.understanding.requested.rewrite, 'off');
  const page = await request('GET', '/chat');
  assert.match(page.body, /id="rewrite-select"/);
  assert.match(page.body, /data-settings="[^"]*&quot;rewrite&quot;:&quot;gated&quot;/);
});

test('invalid understanding settings are refused and need Formalize mode', async t => {
  const {chat} = await setup(t);
  for (const bad of [{rewrite: 'sometimes'}, {interpret: 'yes'}, {extra: 1}, 'on', []]) assert.equal((await chat('hi', {understanding: bad})).status, 400, JSON.stringify(bad));
});

test('a SymbolicProofingLLM that cannot start leaves the rewrite off and says why', async t => {
  const {chat, manager} = await setup(t);
  manager.entries.get('symbolic-proofing-llm').model.gguf = '/nonexistent/model.gguf';
  const answer = await chat('Does Ana like Alpha Lab?', {understanding: {rewrite: 'gated'}});
  assert.equal(answer.status, 200);
  const {requested} = answer.body.chatSop.understanding;
  assert.equal(requested.rewrite, 'off');
  assert.match(requested.rewrite_error, /cannot start|GGUF/);
});

test('the cleaning endpoint takes sendAll per request', async t => {
  const {request, entries} = await setup(t);
  const off = await request('POST', '/v1/text-to-clean-english', {message: 'Who manages the team.', sendAll: false});
  assert.equal(off.status, 200);
  assert.equal(off.body.changed, false);
  assert.equal(entries().filter(e => e.message).length, 0, 'a clean sentence is not sent when sendAll is off');
  const on = await request('POST', '/v1/text-to-clean-english', {message: 'Who manages the team.', sendAll: true});
  assert.equal(on.body.changed, true);
  assert.equal(on.body.clean, 'Who manages the team (cleaned).');
  assert.ok(entries().some(e => e.alias === 'language-proofing-llm'));
});

test('the chat page has the settings, persisted per browser, and the understanding panel script', async t => {
  const {request} = await setup(t);
  const page = (await request('GET', '/chat')).body;
  for (const id of ['clean-toggle', 'send-all-toggle', 'rewrite-select', 'understood-toggle']) assert.match(page, new RegExp(`id="${id}"`), id);
  for (const key of ['chatsop.cleanBeforeFormalize', 'chatsop.cleanSendAll', 'chatsop.rewrite', 'chatsop.showUnderstood']) assert.ok(page.includes(key), key);
  assert.match(page, /uncertain interpretation/);
  assert.match(page, /not represented/);
  assert.match(page, /rewrite accepted \(certified\)/);
  assert.match(page, /<mark|createElement\('mark'\)/);
});

// ---- the per-sentence interpretation with fake parses ----

const rows = text => text.split(';').map(r => { const [id, form, lemma, upos, head, deprel] = r.trim().split(/\s+/); return [Number(id), form, lemma, upos, Number(head), deprel]; });
const sentence = (text, start, tokens) => ({text, start, end: start + text.length, tokens: rows(tokens)});
const analysis = (...sentences) => ({columns: ['id', 'form', 'lemma', 'upos', 'head', 'deprel'], language: 'en', sentences});
const toParse = a => ({sentences: a.sentences.map(s => ({text: s.text, start: s.start, end: s.end, words: s.tokens.map(([id, text, lemma, upos, head, deprel]) => ({id, text, lemma, upos, head, deprel}))}))});
const ANA = '1 Ana Ana PROPN 2 nsubj;2 works work VERB 0 root;3 at at ADP 4 case;4 Lidl Lidl PROPN 2 obl;5 . . PUNCT 2 punct';
const fakeLm = ({back, certified = () => true}) => ({parse: async text => ({parse: toParse(back(text))}), inspectUnit: async unit => ({certified: certified(unit)})});

test('a verified sentence shows its CNL, certification and no spans', async () => {
  const a = analysis(sentence('Ana works at Lidl.', 0, ANA));
  const lm = fakeLm({back: () => a});
  const i = await interpretResult(lm, {analysis: a, message: 'Ana works at Lidl.'});
  assert.equal(i.available, true);
  assert.deepEqual([i.sentences[0].status, i.sentences[0].cnl, i.sentences[0].certified, i.sentences[0].round_trip.pass], ['verified', 'Ana works at Lidl.', true, true]);
  assert.deepEqual(i.not_represented, []);
  assert.equal(i.certified, true);
});

test('a failed round trip is marked uncertain: no CNL, a raw analysis summary, the unverified CNL kept apart', async () => {
  const a = analysis(sentence('Ana works at Lidl.', 0, ANA));
  const other = analysis(sentence('Bob sings.', 0, '1 Bob Bob PROPN 2 nsubj;2 sings sing VERB 0 root;3 . . PUNCT 2 punct'));
  const i = await interpretResult(fakeLm({back: () => other, certified: () => false}), {analysis: a, message: 'Ana works at Lidl.'});
  const s = i.sentences[0];
  assert.deepEqual([s.status, s.cnl, s.unverified_cnl, s.certified], ['uncertain', null, 'Ana works at Lidl.', false]);
  assert.equal(s.summary, 'root: works; nsubj: Ana; obl: Lidl');
  assert.equal(i.certified, false);
});

test('words the CNL does not use are listed as not represented, in their sentence', async () => {
  const a = analysis(sentence('Ana works banana.', 0, '1 Ana Ana PROPN 2 nsubj;2 works work VERB 0 root;3 banana banana NOUN 2 dep;4 . . PUNCT 2 punct'));
  const lm = fakeLm({back: () => analysis(sentence('Ana works.', 0, '1 Ana Ana PROPN 2 nsubj;2 works work VERB 0 root;3 . . PUNCT 2 punct'))});
  const i = await interpretResult(lm, {analysis: a, message: 'Ana works banana.'});
  assert.deepEqual(i.sentences[0].not_represented, ['banana']);
  assert.deepEqual(i.not_represented, ['banana']);
});

test('a rewrite trace is attached to the sentence it produced, with its acceptance', async () => {
  const a = analysis(sentence('Ana works at Lidl.', 0, ANA));
  const rewrite = {gate: 'trees', acceptance: 'certified', applied: true, input: 'At Lidl is worked by Ana.', output: 'Ana works at Lidl.',
    units: [{text: 'At Lidl is worked by Ana.', sent: true, accepted: true, reasons: [], output: 'Ana works at Lidl.', certified: false, uncertain: false}]};
  const i = await interpretResult(fakeLm({back: () => a}), {analysis: a, message: 'At Lidl is worked by Ana.', english: 'Ana works at Lidl.', trace: {rewrite}});
  assert.deepEqual(i.sentences[0].rewrite, {original: 'At Lidl is worked by Ana.', rewrite: 'Ana works at Lidl.', accepted: true, reasons: [], original_certified: false});
  const refused = {...rewrite, applied: false, units: [{...rewrite.units[0], text: 'Ana works at Lidl.', accepted: false, reasons: ['not_certified'], output: 'Ana worked at Lidl.', certified: false}]};
  const j = await interpretResult(fakeLm({back: () => a}), {analysis: a, message: 'Ana works at Lidl.', trace: {rewrite: refused}});
  assert.deepEqual([j.sentences[0].rewrite.accepted, j.sentences[0].rewrite.reasons, j.sentences[0].certified], [false, ['not_certified'], false]);
});

test('a lead-in the parser masked is attached to the next sentence and shown in it', async () => {
  const a = analysis(sentence('Ana works at Lidl.', 11, ANA));
  const i = await interpretResult(fakeLm({back: () => a}), {analysis: a, message: 'Remind me, Ana works at Lidl.'});
  assert.deepEqual(i.sentences[0].not_represented, ['Remind me,']);
  assert.equal(i.sentences[0].display_text, 'Remind me, Ana works at Lidl.');
});

test('an analysis in another language has no English interpretation', async () => {
  const a = {...analysis(sentence('Ana lucrează.', 0, '1 Ana Ana PROPN 2 nsubj;2 lucrează lucra VERB 0 root')), language: 'ro'};
  const i = await interpretResult(fakeLm({back: () => a}), {analysis: a, message: 'Ana lucrează.'});
  assert.equal(i.available, false);
  assert.match(i.reason, /ro/);
  assert.equal((await interpretResult(fakeLm({back: () => a}), {analysis: null})).available, false);
  assert.equal(analysisSummary(rows('1 x x X 0 root')), 'root: x');
});
