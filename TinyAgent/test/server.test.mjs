// The TinyAgent server and its library: client calls by tier, the agent endpoints (skills, jobs, run, write-plugin), configuration
// layers and the user's home, old header names, the port guard. Providers are stub servers: no network, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTinyServer } from '../lib/server.mjs';
import { createTinyAgent, TinyAgentUnavailable } from '../lib/client.mjs';
import { mergeLayers, absolutize, ensureUserHome, loadLayers } from '../lib/config.mjs';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `tinyagent-${p}-`));
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));
const reply = (res, content, extra = {}) => { res.writeHead(200, { 'content-type': 'application/json', 'x-quota-cost': '0.1' }); res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3 }, ...extra })); };

const PLUGIN_CODE = "async function run(api, input) { const files = await api.listInputs(); const t = await api.readInput(files[0].name); const a = await api.chat({tier: 'tiny', prompt: 'COUNT ' + t}); await api.writeOutput('count.txt', a.text); return {summary: 'counted: ' + a.text, outputs: ['count.txt']}; }";

/** A stub provider: `tiny-m` answers questions, `good-m` plans and writes plugins. */
async function stubProvider() {
  const seen = [];
  const s = http.createServer(async (req, res) => {
    const c = []; for await (const x of req) c.push(x);
    if (req.url === '/v1/models') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"data":[]}'); }
    const b = JSON.parse(Buffer.concat(c).toString());
    seen.push(b);
    const last = String(b.messages.at(-1).content);
    if (b.model === 'good-m' && b.messages[0].content.includes('You plan how to do')) return reply(res, last.includes('count') ? '{"steps":[{"skill":"write-plugin","inputs":{"goal":"count the words","tier":"good"}}],"reason":"no skill counts"}' : '{"steps":[{"skill":"echo","inputs":{"text":"hi"}}],"reason":"echo fits"}');
    if (b.model === 'good-m' && b.messages[0].content.includes('SkillPlugin')) return reply(res, '```js\n' + PLUGIN_CODE + '\n```');
    if (last.startsWith('COUNT ')) return reply(res, String(last.slice(6).trim().split(/\s+/).length));
    if (b.model === 'cut-m') return reply(res, 'partial', { choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] });
    return reply(res, `answer to ${last}`);
  });
  const port = await listen(s);
  return { url: `http://127.0.0.1:${port}`, seen, close: () => { s.close(); s.closeAllConnections?.(); } };
}

async function setup() {
  const root = tmp('srv');
  const up = await stubProvider();
  // A project SkillPlugin and a job folder registered by configuration.
  fs.mkdirSync(path.join(root, 'plugins'));
  fs.writeFileSync(path.join(root, 'plugins', 'echo.mjs'), `export default {name: 'echo', description: 'Echo a text through the tiny tier.', inputs: {text: {type: 'string'}},
    async run(ctx) { const r = await ctx.ta.chat({tier: 'tiny', prompt: ctx.inputs.text}); return {status: 'finished', summary: r.text, purpose: ctx.ta.purpose}; }};`);
  const job = path.join(root, 'jobs', 'upper');
  fs.mkdirSync(job, { recursive: true });
  fs.writeFileSync(path.join(job, 'job.json'), JSON.stringify({ name: 'upper', inputs: { items: [{ id: 'a', q: 'x' }, { id: 'b', q: 'y' }], promptFields: ['q'] }, models: 'tier:tiny', output: { format: 'text' }, repairRounds: 0, decider: null, budget: { calls: 20 }, stages: [{ name: 'all', items: null }] }));
  fs.writeFileSync(path.join(job, 'prompt.md'), '<<<system>>>\nAnswer.\n<<<item>>>\n{{q}}\n');
  const config = {
    dataDir: path.join(root, 'data'), cacheDir: path.join(root, 'cache'), auditDir: path.join(root, 'audit'), logDir: path.join(root, 'logs'),
    defaultUpstream: 'stub',
    providers: { stub: { baseUrl: up.url, noKey: true, limits: { maxConcurrent: 4 }, retry: { max: 0, baseMs: 10, maxWaitMs: 100 }, formats: { openai: '/v1/chat/completions' } } },
    tiers: { tiny: [{ upstream: 'stub', model: 'tiny-m' }], good: [{ upstream: 'stub', model: 'good-m' }], cutty: [{ upstream: 'stub', model: 'cut-m' }] },
    policy: { allowedPurposes: ['job:*', 'skill:*', 'run:*', 'test:*'], untaggedDailyMax: 1000 },
    cache: { defaultMode: 'use' },
    runner: { dataDir: path.join(root, 'runs'), roles: { planner: 'good', decider: 'good', auditor: 'good', worker: 'tiny' }, limits: {}, tasks: { keepDays: 7 } },
    skills: { plugins: [path.join(root, 'plugins')], jobs: { upper: job } },
    run: { budget: { calls: 50 }, maxSteps: 3 },
    sandbox: { timeMs: 20000, heapMb: 64, maxCalls: 5, tiers: ['tiny'] },
  };
  const s = await createTinyServer({ config, env: {} });
  const port = await listen(s.server);
  const url = `http://127.0.0.1:${port}`;
  const ta = createTinyAgent({ url, purpose: 'test:server', autostart: false, env: {} });
  return { root, up, s, url, ta, job, close: async () => { await s.close(); up.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}

test('library: chat and json by tier, tags, cache hit, cut marked and re-asked, purpose required, unavailable server', async () => {
  const t = await setup();
  try {
    const r = await t.ta.chat({ tier: 'tiny', prompt: 'hello', maxTokens: 50 });
    assert.equal(r.ok, true); assert.equal(r.text, 'answer to hello'); assert.equal(r.tier, 'tiny'); assert.equal(r.served, 'stub/tiny-m'); assert.equal(r.credits, 0.1);
    const again = await t.ta.chat({ tier: 'tiny', prompt: 'hello', maxTokens: 50 });
    assert.equal(again.cached, true);
    const j = await t.ta.json({ tier: 'tiny', prompt: 'COUNT a b c' });
    assert.equal(j.ok, false); assert.match(j.reason, /no JSON/);
    const cut = await t.ta.chat({ tier: 'cutty', prompt: 'long', maxTokens: 100 });
    assert.equal(cut.ok, true); assert.equal(cut.cut, true);
    const retried = await t.ta.chat({ tier: 'cutty', prompt: 'long', maxTokens: 100, retryCut: true, cutCap: 1600 });
    assert.equal(retried.ok, false); assert.match(retried.reason, /budget_exhausted/); assert.equal(retried.budget_retries, 2);
    const recs = fs.readdirSync(path.join(t.root, 'data')).filter((f) => f.startsWith('requests-')).flatMap((f) => fs.readFileSync(path.join(t.root, 'data', f), 'utf8').trim().split('\n').map((l) => JSON.parse(l)));
    assert.ok(recs.every((x) => x.purpose === 'test:server'));
    assert.throws(() => createTinyAgent({}), /purpose tag is required/);
    const off = createTinyAgent({ url: 'http://127.0.0.1:1', purpose: 'test:x', autostart: false, env: {} });
    await assert.rejects(off.health(), (e) => e instanceof TinyAgentUnavailable && /start it with/.test(e.message));
    assert.match((await off.chat({ tier: 'tiny', prompt: 'x' })).reason, /not reachable/);
  } finally { await t.close(); }
});

test('old header names are accepted on input', async () => {
  const t = await setup();
  try {
    const r = await fetch(`${t.url}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', ['x-llm' + 'apiprovider-purpose']: 'test:old' }, body: JSON.stringify({ model: 'tiny', messages: [{ role: 'user', content: 'old' }] }) });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-tinyagent-tier'), 'tiny');
    const st = await t.ta.stats();
    assert.ok(st.last24h.by_purpose['test:old']);
  } finally { await t.close(); }
});

test('skills: built-ins, a project plugin, a configured job and a skill run in a worker with the in-server library', async () => {
  const t = await setup();
  try {
    const list = await t.ta.skills();
    const names = list.skills.map((s) => s.name);
    for (const n of ['chat', 'json', 'job', 'task', 'write-plugin', 'echo', 'upper']) assert.ok(names.includes(n), n);
    const op = await t.ta.skill('echo', { text: 'ping' });
    assert.equal(op.status, 'finished', op.error);
    assert.equal(op.result.summary, 'answer to ping'); assert.equal(op.result.purpose, 'skill:echo');
    const bad = await t.ta.skill('echo', { nope: 1 });
    assert.equal(bad.status, 'failed'); assert.match(bad.result.summary, /invalid inputs/);
    const job = await t.ta.runJob(t.job);
    assert.equal(job.status, 'finished', job.error);
    assert.match(job.result.summary, /accepted 2/);
    const viaSkill = await t.ta.skill('upper', {});
    assert.equal(viaSkill.status, 'finished', viaSkill.error);
  } finally { await t.close(); }
});

test('run: the planner tier chooses a skill and the executor runs it; write-plugin writes a sandboxed plugin when no skill fits', async () => {
  const t = await setup();
  try {
    let op = await t.ta.run('say hi');
    assert.equal(op.status, 'finished', op.error);
    assert.match(op.result.summary, /echo/);
    const f = path.join(t.root, 'words.txt');
    fs.writeFileSync(f, 'one two three four');
    op = await t.ta.run('count the words of the attached file', { attach: [f] });
    assert.equal(op.status, 'finished', JSON.stringify(op.result ?? op.error));
    const step = op.result.results[0];
    assert.equal(step.skill, 'write-plugin'); assert.match(step.summary, /counted: 4/);
    const stepDir = fs.readdirSync(op.dir).find((d) => d.startsWith('step-1'));
    assert.ok(fs.readFileSync(path.join(op.dir, stepDir, 'plugin.js'), 'utf8').includes('async function run'));
    assert.equal(fs.readFileSync(path.join(op.dir, stepDir, 'outputs', 'count.txt'), 'utf8'), '4');
    const planOnly = await t.ta.run('say hi', { planOnly: true });
    assert.equal(planOnly.result.status, 'planned');
  } finally { await t.close(); }
});

test('configuration layers, paths per layer, user home template without keys; port guard', async () => {
  assert.deepEqual(mergeLayers({ a: { b: 1, c: 2 }, tiers: { x: [1, 2] } }, { a: { c: 3, d: null }, tiers: { x: [9] } }), { a: { b: 1, c: 3 }, tiers: { x: [9] } });
  const abs = absolutize({ dataDir: 'd', providers: { l: { start: { gguf: 'm.gguf', bin: 'llama-server', locks: ['x.lock'] } } }, runner: { templatesDir: 't' } }, '/base');
  assert.equal(abs.dataDir, '/base/d'); assert.equal(abs.providers.l.start.gguf, '/base/m.gguf'); assert.equal(abs.providers.l.start.bin, 'llama-server'); assert.equal(abs.runner.templatesDir, '/base/t');
  const home = tmp('home');
  const env = { TINYAGENT_HOME: home };
  const w = ensureUserHome(env);
  assert.ok(w.written.some((f) => f.endsWith('config.json')));
  assert.ok(fs.readFileSync(path.join(home, 'keys', 'openference.env'), 'utf8').includes('# OPENFERENCE_API_KEY='));
  assert.equal(ensureUserHome(env).written.length, 0, 'never overwrites');
  const { config } = loadLayers({ project: false, env, from: home });
  assert.equal(config.tiers.supertiny, 'micro');
  assert.equal(config.tiers.best[0].upstream, 'local');
  assert.ok(config.providers.localnano.start.gguf.endsWith('Qwen3-0.6B-Q8_0.gguf'));
  fs.rmSync(home, { recursive: true, force: true });
  const t = await setup();
  try {
    const second = await createTinyServer({ config: { dataDir: path.join(t.root, 'd2'), providers: {}, tiers: {} }, env: {} });
    await assert.rejects(second.listen(Number(new URL(t.url).port)), /EADDRINUSE/);
  } finally { await t.close(); }
});
