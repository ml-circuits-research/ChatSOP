import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProxy } from './proxy.mjs';

const KEY = 'sk-test-SECRET-KEY-123456';
const MODELS = { object: 'list', data: [{ id: 'm1', pricing: { prompt: '0.000001', completion: '0.000002', cache_read: '0.0000001' }, quota_multiplier: 2, context_length: 1000 }] };

function listen(server) {
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res(server.address().port)));
}
const body = (req) => new Promise((res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => res(Buffer.concat(c).toString())); });

async function setup({ stub, limits = { maxConcurrent: 2, maxPerSecond: 50 }, token = null, plan = null, compare = undefined, dataDir: reuseDir = null, up: reuseUp = null } = {}) {
  const seen = [];
  const up = http.createServer(async (req, res) => {
    const b = await body(req);
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: b });
    if (req.url === '/v1/models') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(MODELS)); }
    stub(req, res, b, seen);
  });
  const uport = await listen(up);
  const dataDir = reuseDir || mkdtempSync(join(tmpdir(), 'llmapi-'));
  const config = { defaultUpstream: 'stub', modelsCacheSeconds: 600, compare, upstreams: { stub: { plan, baseUrl: `http://127.0.0.1:${uport}`, keyVar: 'STUB_KEY', limits, retry: { max: 3, baseMs: 20, maxWaitMs: 2000 }, formats: { openai: '/v1/chat/completions', anthropic: '/v1/messages' } } } };
  const p = createProxy({ config, env: { STUB_KEY: KEY }, dataDir, proxyToken: token });
  const port = await listen(p.server);
  const base = `http://127.0.0.1:${port}`;
  const close = async () => { p.server.close(); up.close(); up.closeAllConnections?.(); p.server.closeAllConnections?.(); if (!reuseDir) rmSync(dataDir, { recursive: true, force: true }); };
  return { base, seen, dataDir, close, p };
}
const logText = (dir) => readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('');
const json = (res, status, obj, h = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...h }); res.end(JSON.stringify(obj)); };

test('openai passthrough, upstream auth, usage logging, key never leaks', async () => {
  const t = await setup({ stub: (req, res) => json(res, 200, { id: 'x', choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 40 } } }, { 'x-ratelimit-remaining': '9' }) });
  try {
    const r = await fetch(t.base + '/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer client-token' }, body: JSON.stringify({ model: 'm1', messages: [{ role: 'user', content: 'hi' }] }) });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-ratelimit-remaining'), '9');
    assert.equal((await r.json()).usage.prompt_tokens, 100);
    const call = t.seen.find((s) => s.url === '/v1/chat/completions');
    assert.equal(call.auth, 'Bearer ' + KEY);
    const rec = JSON.parse(logText(t.dataDir).trim().split('\n')[0]);
    assert.equal(rec.model, 'm1'); assert.equal(rec.in_tokens, 100); assert.equal(rec.out_tokens, 20); assert.equal(rec.cached_tokens, 40);
    assert.equal(rec.rate_headers['x-ratelimit-remaining'], '9');
    assert.ok(!logText(t.dataDir).includes(KEY));
    const stats = await (await fetch(t.base + '/stats')).json();
    assert.equal(stats.windows.minute.calls, 1);
    assert.equal(stats.windows.minute.plan_requests, 2);
    assert.ok(Math.abs(stats.windows.minute.cost_usd - (60 * 1e-6 + 40 * 1e-7 + 20 * 2e-6)) < 1e-12);
    assert.ok(!JSON.stringify(stats).includes(KEY));
    const dash = await (await fetch(t.base + '/')).text();
    assert.ok(dash.includes('<title>') && !dash.includes(KEY));
  } finally { await t.close(); }
});

test('models list is passed through and cached; health hides the key', async () => {
  const t = await setup({ stub: (q, res) => json(res, 200, {}) });
  try {
    const a = await (await fetch(t.base + '/v1/models')).json();
    await fetch(t.base + '/v1/models');
    assert.equal(a.data[0].quota_multiplier, 2);
    assert.equal(t.seen.filter((s) => s.url === '/v1/models').length, 1);
    assert.equal(t.seen[0].auth, undefined);
    const h = await (await fetch(t.base + '/health')).text();
    assert.ok(h.includes('"key_configured":true') && !h.includes(KEY));
  } finally { await t.close(); }
});

test('openai streaming: SSE passthrough, include_usage injected, TTFT and usage logged', async () => {
  const t = await setup({ stub: async (req, res, b) => {
    assert.equal(JSON.parse(b).stream_options.include_usage, true);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"he"}}]}\n\n');
    await new Promise((r) => setTimeout(r, 30));
    res.write('data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":3}}\n\n');
    res.end('data: [DONE]\n\n');
  } });
  try {
    const r = await fetch(t.base + '/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'm1', stream: true, messages: [] }) });
    const text = await r.text();
    assert.ok(text.includes('"content":"he"') && text.includes('[DONE]'));
    const rec = JSON.parse(logText(t.dataDir).trim().split('\n')[0]);
    assert.equal(rec.stream, true); assert.equal(rec.in_tokens, 7); assert.equal(rec.out_tokens, 3);
    assert.ok(rec.ttft_ms >= 0 && rec.ttft_ms < rec.latency_ms);
  } finally { await t.close(); }
});

test('anthropic passthrough, non-stream and stream', async () => {
  const t = await setup({ stub: (req, res, b) => {
    if (JSON.parse(b).stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":11,"cache_read_input_tokens":5,"output_tokens":1}}}\n\n');
      res.end('event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":9}}\n\n');
    } else json(res, 200, { type: 'message', usage: { input_tokens: 4, output_tokens: 2 } });
  } });
  try {
    const h = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': 'client' };
    const a = await (await fetch(t.base + '/v1/messages', { method: 'POST', headers: h, body: JSON.stringify({ model: 'm1', messages: [] }) })).json();
    assert.equal(a.type, 'message');
    const s = await (await fetch(t.base + '/v1/messages', { method: 'POST', headers: h, body: JSON.stringify({ model: 'm1', stream: true, messages: [] }) })).text();
    assert.ok(s.includes('message_delta'));
    const recs = logText(t.dataDir).trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(recs[0].format, 'anthropic'); assert.equal(recs[0].in_tokens, 4);
    assert.equal(recs[1].in_tokens, 11); assert.equal(recs[1].out_tokens, 9); assert.equal(recs[1].cached_tokens, 5);
    assert.equal(t.seen.find((x) => x.url === '/v1/messages').auth, 'Bearer ' + KEY);
  } finally { await t.close(); }
});

test('429 is retried honouring retry-after, then succeeds; attempts are logged and inferred', async () => {
  let n = 0;
  const t = await setup({ stub: (req, res) => {
    if (++n <= 2) return json(res, 429, { error: 'slow down ' + KEY }, { 'retry-after': '0.05', 'x-ratelimit-limit-hour': '100' });
    json(res, 200, { usage: { prompt_tokens: 1, completion_tokens: 1 } });
  } });
  try {
    const t0 = Date.now();
    const r = await fetch(t.base + '/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'm1', messages: [] }) });
    assert.equal(r.status, 200);
    assert.equal(n, 3);
    assert.ok(Date.now() - t0 >= 80);
    const recs = logText(t.dataDir).trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(recs.map((x) => x.status), [429, 429, 200]);
    assert.deepEqual(recs.map((x) => x.attempt), [1, 2, 3]);
    assert.ok(!logText(t.dataDir).includes(KEY));
    const s = await (await fetch(t.base + '/stats')).json();
    assert.equal(s.inferred_limits.r429_count, 2);
    assert.equal(s.inferred_limits.headers_seen['x-ratelimit-limit-hour'].count, 2);
  } finally { await t.close(); }
});

test('persistent 429 is returned to the client, not swallowed', async () => {
  const t = await setup({ stub: (req, res) => json(res, 429, { error: 'no' }, { 'retry-after': '0.01' }) });
  try {
    const r = await fetch(t.base + '/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'm1', messages: [] }) });
    assert.equal(r.status, 429);
    assert.equal(logText(t.dataDir).trim().split('\n').length, 4);
  } finally { await t.close(); }
});

test('limiter bounds concurrency and exposes queue depth', async () => {
  let active = 0, maxActive = 0;
  const t = await setup({ limits: { maxConcurrent: 1, maxPerSecond: 100 }, stub: async (req, res) => {
    active++; maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 40));
    active--; json(res, 200, { usage: {} });
  } });
  try {
    const go = () => fetch(t.base + '/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'm1', messages: [] }) });
    const all = [go(), go(), go()];
    await new Promise((r) => setTimeout(r, 15));
    const s = await (await fetch(t.base + '/stats')).json();
    assert.ok(s.upstreams.stub.depth >= 1);
    assert.deepEqual((await Promise.all(all)).map((r) => r.status), [200, 200, 200]);
    assert.equal(maxActive, 1);
  } finally { await t.close(); }
});

test('client token is enforced when configured; health stays open', async () => {
  const t = await setup({ token: 'local-tok', stub: (q, res) => json(res, 200, {}) });
  try {
    assert.equal((await fetch(t.base + '/stats')).status, 401);
    assert.equal((await fetch(t.base + '/health')).status, 200);
    assert.equal((await fetch(t.base + '/stats', { headers: { authorization: 'Bearer local-tok' } })).status, 200);
  } finally { await t.close(); }
});

test('unreachable upstream gives a 502 and a log record', async () => {
  const t = await setup({ stub: (q, res) => json(res, 200, {}) });
  try {
    t.p.upstreams.stub.baseUrl = 'http://127.0.0.1:1';
    const r = await fetch(t.base + '/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"model":"m1"}' });
    assert.equal(r.status, 502);
    assert.equal(JSON.parse(logText(t.dataDir).trim().split('\n')[0]).status, 502);
  } finally { await t.close(); }
});

test('quota headers, per-minute limit, credit-billed model marking and quota window inference', async () => {
  let n = 0;
  const t = await setup({ limits: { maxConcurrent: 1, maxPerMinute: 15 }, stub: (req, res, b) => {
    if (JSON.parse(b).model === 'paid') return json(res, 402, { error: 'This model is billed from your credit balance. Maintain a balance of at least $1.00' });
    const rem = [10, 9.9, 9.8, 10][n++ % 4];
    json(res, 200, { usage: { prompt_tokens: 1, completion_tokens: 1 } }, { 'x-quota-remaining': String(rem), 'x-quota-cost': '0.1', 'x-ratelimit-limit': '15' });
  } });
  try {
    assert.equal(t.p.limiters.stub.maxPerMinute, 15);
    const go = (model) => fetch(t.base + '/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, messages: [] }) });
    for (let i = 0; i < 4; i++) await go('m1');
    assert.equal((await go('paid')).status, 402);
    const s = await (await fetch(t.base + '/stats')).json();
    assert.equal(s.by_model.paid.billing, 'credit');
    assert.equal(s.by_model.m1.billing, 'plan');
    assert.deepEqual(s.by_model.m1.quota_cost_seen, [0.1]);
    assert.ok(Math.abs(s.by_model.m1.plan_requests - 0.4) < 1e-9);
    assert.equal(s.quota.remaining_now, 10);
    assert.equal(s.quota.resets.length, 1);
    const models = await (await fetch(t.base + '/v1/models')).json();
    assert.equal(models.data[0].x_billing, 'plan_or_unknown');
  } finally { await t.close(); }
});

test('limiter enforces max starts per minute by waiting, never dropping', async () => {
  const { Limiter } = await import('./limiter.mjs');
  const l = new Limiter({ maxConcurrent: 5, maxPerMinute: 2 });
  await l.schedule(() => 1); await l.schedule(() => 2);
  let third = false; l.schedule(() => { third = true; });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(third, false); assert.equal(l.depth, 1);
});

const post = (base, model = 'm1', extra = {}) => fetch(base + '/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, messages: [], ...extra }) });
const okStub = (usage = { prompt_tokens: 1000, completion_tokens: 500, prompt_tokens_details: { cached_tokens: 200 } }) => {
  let rem = 100;
  return (req, res) => { rem -= 2; json(res, 200, { usage }, { 'x-quota-remaining': String(rem), 'x-quota-cost': '2' }); };
};

test('plan limits: calls, credits and tokens in rolling windows, provider quota next to ours, 80% warning', async () => {
  const plan = { priceUsdPerMonth: 15, limits: [
    { name: 'per_minute', unit: 'calls', window: '60s', max: 15 },
    { name: 'per_5h', unit: 'credits', window: '5h', max: 5, provider: { remainingHeader: 'x-quota-remaining', costHeader: 'x-quota-cost' } },
    { name: 'per_week', unit: 'tokens', window: '7d', max: 100000 },
  ] };
  const t = await setup({ plan, stub: okStub() });
  try {
    await post(t.base); await post(t.base);
    const s = await (await fetch(t.base + '/stats')).json();
    const [m, c, w] = s.plan.stub.limits;
    assert.equal(s.plan.stub.price_usd_per_month, 15);
    assert.equal(m.used, 2); assert.equal(m.remaining, 13);
    assert.equal(c.used, 4); assert.equal(c.remaining, 1); assert.equal(c.warn, true); assert.equal(c.exceeded, false);
    assert.equal(w.used, 3000); assert.equal(w.warn, false);
    assert.ok(c.next_relief_ms > 4 * 3600_000);
    assert.equal(c.provider.remaining, 96);
    assert.equal(c.provider.agreement.provider_used, 4); assert.equal(c.provider.agreement.our_used, 4); assert.equal(c.provider.agreement.diff, 0);
    assert.equal(s.plan.stub.warnings.length, 1);
    assert.ok(s.plan.stub.warnings[0].startsWith('per_5h'));
  } finally { await t.close(); }
});

test('queue pauses before exceeding a credits limit and never drops', async () => {
  const plan = { priceUsdPerMonth: 15, limits: [{ name: 'tiny', unit: 'credits', window: '400ms', max: 4 }] };
  const starts = [];
  const t = await setup({ plan, limits: { maxConcurrent: 1, maxPerSecond: 100 }, stub: (req, res) => { starts.push(Date.now()); json(res, 200, { usage: {} }, { 'x-quota-cost': '2' }); } });
  try {
    await fetch(t.base + '/v1/models'); // warm the model list (m1 costs 2)
    const t0 = Date.now();
    const rs = await Promise.all([post(t.base), post(t.base), post(t.base)]);
    assert.deepEqual(rs.map((r) => r.status), [200, 200, 200]);
    assert.ok(starts[2] - starts[0] >= 380, 'third call waits for the window: ' + (starts[2] - starts[0]));
    assert.ok(starts[1] - starts[0] < 300);
    assert.ok(Date.now() - t0 < 5000);
  } finally { await t.close(); }
});

test('value comparison against DeepSeek and list prices, with a verdict', async () => {
  const compare = { cheap: { inputUsdPerM: 1, outputUsdPerM: 2, cachedInputUsdPerM: 0.1 }, _note: 'ignored' };
  const plan = { priceUsdPerMonth: 15, limits: [] };
  const t = await setup({ plan, compare, stub: okStub() });
  try {
    await fetch(t.base + '/v1/models');
    await post(t.base); await post(t.base);
    const v = (await (await fetch(t.base + '/stats')).json()).value.stub;
    // per call: 800 fresh + 200 cached input, 500 output
    assert.equal(v.periods.day.tokens.in, 1600); assert.equal(v.periods.day.tokens.cached, 400); assert.equal(v.periods.day.tokens.out, 1000);
    assert.ok(Math.abs(v.periods.day.compare_usd.cheap - (1600 * 1 + 400 * 0.1 + 1000 * 2) / 1e6) < 1e-9);
    assert.ok(Math.abs(v.periods.day.openference_list_usd - (1600 * 1e-6 + 400 * 1e-7 + 1000 * 2e-6)) < 1e-9);
    assert.ok(Math.abs(v.periods.month.subscription_prorated_usd - 15) < 1e-9);
    assert.ok(Math.abs(v.periods.day.subscription_prorated_usd - 0.5) < 1e-9);
    assert.equal(v.projection.span_days, 1);
    assert.ok(v.verdict.includes('subscription costs') && v.verdict.includes('more'));
    // a heavy month flips the verdict
    const heavy = { priceUsdPerMonth: 0.0001, limits: [] };
    t.p.upstreams.stub.plan = heavy;
    const v2 = (await (await fetch(t.base + '/stats')).json()).value.stub;
    assert.ok(v2.verdict.includes('subscription saves'));
  } finally { await t.close(); }
});

test('rolling windows, queue starts and value are rebuilt from the logs after a restart', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'llmapi-restart-'));
  const plan = { priceUsdPerMonth: 15, limits: [{ name: 'per_5h', unit: 'credits', window: '5h', max: 100 }] };
  try {
    const a = await setup({ plan, dataDir, stub: okStub() });
    await fetch(a.base + '/v1/models');
    await post(a.base); await post(a.base);
    await a.close();
    const b = await setup({ plan, dataDir, stub: okStub() });
    try {
      const s = await (await fetch(b.base + '/stats')).json();
      assert.equal(s.plan.stub.limits[0].used, 4);
      assert.equal(s.value.stub.periods.day.tokens.calls, 2);
      assert.equal(b.p.limiters.stub.starts.length, 2);
    } finally { await b.close(); }
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
});
