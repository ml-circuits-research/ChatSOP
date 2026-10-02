// Remote LLM providers (lib/llm-providers.mjs, owner decisions 2026-10-02): the proxy entries and tiers, LLMDirect through the proxy,
// the answer-language step and the books judge, all against stubs. No test calls a model.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {providerSettings, chainEntry, providerChat, providerReadiness} from '../lib/llm-providers.mjs';
import {createQueryParser, queryParserSettings, remoteDirectEntry} from '../server/query-parser.mjs';
import {createAnswerFormulator} from '../server/answer-language.mjs';
import {judgeBatches} from '../tools/eval/books/score.mjs';
import {lex, tempDir} from './helpers.mjs';

const Q = '@q query\n  where match\n    relation "works_at"\n    role subject "Ana"\n    role object "Lab Alpha"\n    polarity affirmed\n  end\n';
const reply = content => async (url, init) => ({ok: true, status: 200, text: async () => JSON.stringify({choices: [{message: {content}}], usage: {prompt_tokens: 3}}), _url: url, _body: init?.body});

test('the default provider is the openference proxy with Qwen3.8 27b; config overrides it', () => {
  const p = providerSettings({});
  assert.equal(p.openference.baseUrl, 'http://127.0.0.1:18080/v1');
  assert.equal(p.openference.model, 'Qwen3.8 27b');
  assert.equal(providerSettings({llmProviders: {openference: {model: 'GLM-5.3-Flash'}}}).openference.model, 'GLM-5.3-Flash');
  const e = chainEntry({kind: 'completion', provider: 'openference'}, {providers: p});
  assert.equal(e.id, 'openference/Qwen3.8 27b');
  assert.deepEqual(e.extraBody, {chat_template_kwargs: {enable_thinking: false}});
  assert.throws(() => chainEntry({provider: 'nope'}, {providers: p}), /unknown provider/);
});

test('providerChat answers plain text, strips thinking, and reports an unreachable endpoint without throwing', async () => {
  let seen = null;
  const ok = await providerChat({system: 's', prompt: 'p', fetchImpl: async (url, init) => { seen = {url, body: JSON.parse(init.body)}; return reply('<think>x</think>hello')(url, init); }});
  assert.equal(ok.text, 'hello');
  assert.equal(seen.url, 'http://127.0.0.1:18080/v1/chat/completions');
  assert.equal(seen.body.model, 'Qwen3.8 27b');
  const down = await providerChat({prompt: 'p', fetchImpl: async () => { throw new Error('ECONNREFUSED'); }});
  assert.equal(down.ok, false);
  assert.match(down.reason, /could not be reached/);
  const state = await providerReadiness('http://127.0.0.1:18080/v1', {fetchImpl: async () => { throw new Error('no'); }});
  assert.equal(state.available, false);
  assert.match(state.reason, /not reachable/);
});

test('LLMDirect calls the chain model through the proxy: the tier by default, concrete entries by provider; an unreachable proxy is parse_unavailable', async () => {
  assert.equal(remoteDirectEntry(queryParserSettings()).id, 'small');
  assert.equal(chainEntry('openrouter/deepseek/deepseek-v4-flash').endpoint, 'http://127.0.0.1:18080/u/openrouter/v1');
  assert.equal(chainEntry('llmapiprovider/Qwen3.8 27b').id, 'openference/Qwen3.8 27b', 'the old omp overlay prefix names the proxy');
  assert.equal(chainEntry('Qwen3.8 27b').id, 'openference/Qwen3.8 27b', 'a bare model id goes to the default provider');
  assert.throws(() => chainEntry({kind: 'omp', model: 'x'}), /not supported/);
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({url, body: init?.body ? JSON.parse(init.body) : null}); return url.endsWith('/health') ? {ok: true, json: async () => ({ok: true, tiers: [{id: 'small', x_tier: {serves: 'openference/Qwen3.8 27b'}}]})} : reply('```sop\n' + Q + '```')(url, init); };
  const qp = createQueryParser({settings: queryParserSettings({queryParser: {strategy: 'LocalLLMDirect', maxFixRounds: 0}}), fetchImpl});
  const r = await qp.parse({message: 'Does Ana work at Lab Alpha?', lexicon: lex});
  assert.equal(r.parse.strategy, 'LLMDirect');
  assert.equal(r.parse.model, 'small');
  assert.equal(r.parse.backend, 'completion');
  const sent = calls.find(c => c.url.endsWith('/chat/completions'));
  assert.equal(sent.body.model, 'small', 'the tier name goes to the proxy');
  const down = createQueryParser({settings: queryParserSettings({queryParser: {}}), fetchImpl: async () => { throw new Error('ECONNREFUSED'); }});
  await assert.rejects(down.parse({message: 'm', lexicon: lex}), e => e.code === 'parse_unavailable' && /not reachable/.test(e.message));
});

test('the answer-language step calls the proxy providers in order (no omp) and keeps the English draft when none is faithful', async () => {
  const settings = {mode: 'always', providers: ['openference', 'openrouter'], timeoutSeconds: 5};
  const good = createAnswerFormulator({settings, chat: async ({provider}) => provider === 'openference' ? {ok: false, text: '', reason: 'rate limited', model: 'openference/Qwen3.8 27b'} : {ok: true, text: 'Da, 42.', model: 'openrouter/deepseek/deepseek-v4-flash'}});
  const a = await good.formulate({message: 'Este?', english: 'Yes, 42.', packet: {}});
  assert.equal(a.applied, true);
  assert.equal(a.model, 'openrouter/deepseek/deepseek-v4-flash');
  assert.match(a.tried[0].reason, /rate limited/);
  const down = createAnswerFormulator({settings, chat: async () => ({ok: false, text: '', reason: 'the endpoint could not be reached'})});
  const b = await down.formulate({message: 'Este?', english: 'Yes.', packet: {}});
  assert.equal(b.applied, false);
  assert.match(b.reason, /could not be reached/);
});

test('the books judge writes blind verdicts per batch through the remote model and leaves unparsable items pending', async t => {
  const dir = tempDir(t, 'judge-');
  fs.writeFileSync(path.join(dir, 'judge-input-1.json'), JSON.stringify([{j: 'j001', problem: 'p', gold_answer: '4', candidate_answer: '4'}, {j: 'j002', problem: 'p', gold_answer: '4', candidate_answer: '5'}]));
  const r = await judgeBatches(dir, {chat: async () => ({ok: true, model: 'openference/Qwen3.8 27b', text: 'Verdicts: [{"j":"j001","verdict":"correct","reason":"same"},{"j":"j002","verdict":"maybe","reason":"x"}]'})});
  assert.deepEqual(r, {calls: 1, judged: 1, failed: 0});
  const out = JSON.parse(fs.readFileSync(path.join(dir, 'judge-output-1.json'), 'utf8'));
  assert.deepEqual(out.map(v => [v.j, v.verdict]), [['j001', 'correct']]);
});
