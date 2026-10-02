// Remote LLM providers (lib/llm-providers.mjs, owner decision 2026-10-02): the proxy entry, the omp overlay for the proxy provider, the remote
// LocalLLMDirect, the answer-language step and the books judge, all against stubs. No test calls a model.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {providerSettings, chainEntry, providerChat, providerReadiness} from '../lib/llm-providers.mjs';
import {providerYaml, mergeModelsYaml, ensureAgentDir} from '../lib/omp/agent-dir.mjs';
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

test('the omp overlay registers the proxy provider next to the existing providers and replaces its own block', t => {
  const block = providerYaml('llmapiprovider', {baseUrl: 'http://127.0.0.1:18080/v1', models: [{id: 'Qwen3.8 27b'}]});
  const merged = mergeModelsYaml('providers:\n  other:\n    baseUrl: "x"\n    api: openai-completions\n', 'llmapiprovider', block);
  assert.match(merged, /providers:\n  llmapiprovider:[\s\S]*"Qwen3\.8 27b"[\s\S]*\n  other:\n    baseUrl: "x"/);
  assert.equal(mergeModelsYaml(merged, 'llmapiprovider', block), merged, 'idempotent');
  assert.match(mergeModelsYaml('', 'llmapiprovider', block), /^providers:\n  llmapiprovider:/);
  const home = tempDir(t, 'omp-home-');
  fs.mkdirSync(path.join(home, '.omp/agent'), {recursive: true});
  fs.writeFileSync(path.join(home, '.omp/agent/agent.db'), 'creds');
  fs.writeFileSync(path.join(home, '.omp/agent/models.yml'), 'providers:\n  other:\n    baseUrl: "x"\n');
  const dir = ensureAgentDir({home, provider: {baseUrl: 'http://127.0.0.1:18080/v1', models: [{id: 'Qwen3.8 27b'}]}});
  assert.equal(fs.readFileSync(path.join(dir, 'agent.db'), 'utf8'), 'creds', 'credentials are linked, not copied');
  assert.equal(fs.lstatSync(path.join(dir, 'agent.db')).isSymbolicLink(), true);
  assert.match(fs.readFileSync(path.join(dir, 'models.yml'), 'utf8'), /llmapiprovider:[\s\S]*other:/);
  assert.match(fs.readFileSync(path.join(home, '.omp/agent/models.yml'), 'utf8'), /^providers:\n  other:/, 'the global file is untouched');
});

test('LocalLLMDirect runs on the remote model when no local model is configured or direct.source is remote; local keeps the GGUF', async () => {
  assert.equal(remoteDirectEntry(queryParserSettings({queryParser: {direct: {source: 'remote'}}})).id, 'openference/Qwen3.8 27b');
  assert.equal(remoteDirectEntry(queryParserSettings({queryParser: {direct: {source: 'local'}}})), null);
  assert.equal(remoteDirectEntry(queryParserSettings({queryParser: {local: {gguf: '/m.gguf'}}})), null, 'auto with a local model keeps it');
  assert.ok(remoteDirectEntry(queryParserSettings({queryParser: {local: {gguf: null, endpoint: null}}})), 'auto without a local model is remote');
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push(url); return url.endsWith('/health') ? {ok: true} : reply('```sop\n' + Q + '```')(url, init); };
  const qp = createQueryParser({settings: queryParserSettings({queryParser: {direct: {source: 'remote'}, strategy: 'LocalLLMDirect', maxFixRounds: 0}}), fetchImpl});
  const r = await qp.parse({message: 'Does Ana work at Lab Alpha?', lexicon: lex});
  assert.equal(r.parse.strategy, 'LocalLLMDirect');
  assert.equal(r.parse.model, 'Qwen3.8 27b');
  assert.equal(r.parse.backend, 'completion');
  assert.ok(calls.some(u => u.endsWith('/chat/completions')));
  const down = createQueryParser({settings: queryParserSettings({queryParser: {direct: {source: 'remote'}, strategy: 'LocalLLMDirect'}}), fetchImpl: async () => { throw new Error('ECONNREFUSED'); }});
  await assert.rejects(down.parse({message: 'm', lexicon: lex}), e => e.code === 'parse_unavailable' && /not reachable/.test(e.message));
});

test('the answer-language step uses the remote model first and falls back to the omp chain with the reason recorded', async () => {
  const settings = {mode: 'always', models: ['bad/model'], provider: 'openference', timeoutSeconds: 5, thinking: 'off'};
  const good = createAnswerFormulator({settings, chat: async () => ({ok: true, text: 'Da, 42.', model: 'openference/Qwen3.8 27b'})});
  const a = await good.formulate({message: 'Este?', english: 'Yes, 42.', packet: {}});
  assert.equal(a.applied, true);
  assert.equal(a.model, 'openference/Qwen3.8 27b');
  const down = createAnswerFormulator({settings, ompConfig: {enabled: false}, chat: async () => ({ok: false, text: '', reason: 'the endpoint could not be reached'})});
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
