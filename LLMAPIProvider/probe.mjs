#!/usr/bin/env node
// Careful limit probe. Sends tiny requests (max_tokens 1) directly to the upstream at slowly rising rates
// and stops at the first 429 (or other error). It spends real quota, so it does nothing without --yes.
// Usage: node LLMAPIProvider/probe.mjs --yes --model GLM-5.2 [--upstream openference] [--rates 0.5,1,2,3,5,8] [--step-seconds 20] [--max-calls 200]
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, resolveUpstream, expandHome } from './settings.mjs';
import { pickRateHeaders, redact } from './monitor.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
if (!args.includes('--yes')) {
  console.log('Dry run. This tool sends real (tiny) requests and spends quota. Re-run with --yes and --model <id>.');
  process.exit(0);
}
const config = loadConfig();
const up = resolveUpstream(opt('--upstream', config.defaultUpstream), config.upstreams[opt('--upstream', config.defaultUpstream)]);
const model = opt('--model');
if (!model || !up.key) { console.error('need --model and a configured key'); process.exit(1); }
const rates = opt('--rates', '0.5,1,2,3,5,8').split(',').map(Number);
const stepMs = Number(opt('--step-seconds', 20)) * 1000;
const maxCalls = Number(opt('--max-calls', 200));
const dir = expandHome(process.env.LLMAPIPROVIDER_DATA || config.dataDir);
mkdirSync(dir, { recursive: true });
const out = join(dir, `probe-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let calls = 0, stopped = null;
const sent = [];
async function one(rate) {
  const t0 = Date.now();
  const r = await fetch(up.baseUrl + (up.formats.openai || '/v1/chat/completions'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + up.key },
    body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ok' }] }),
  }).catch((e) => ({ status: 0, headers: new Headers(), text: async () => e.message }));
  const text = await r.text().catch(() => '');
  const rec = { ts: new Date(t0).toISOString(), rate, status: r.status, ms: Date.now() - t0, headers: pickRateHeaders(r.headers), body: redact(text, [up.key]).slice(0, 300), calls_total: ++calls };
  sent.push(t0);
  appendFileSync(out, JSON.stringify(rec) + '\n');
  if (r.status === 429 || r.status === 0 || r.status >= 500 || r.status === 401) stopped ||= rec;
}

for (const rate of rates) {
  console.log(`step: ${rate} calls/s for ${stepMs / 1000} s`);
  const end = Date.now() + stepMs;
  while (Date.now() < end && !stopped && calls < maxCalls) {
    one(rate);
    await sleep(1000 / rate);
  }
  if (stopped || calls >= maxCalls) break;
}
await sleep(3000);
const at = stopped ? new Date(stopped.ts).getTime() : Date.now();
const within = (ms) => sent.filter((t) => t <= at && at - t < ms).length;
console.log(JSON.stringify({ total_calls: calls, stopped_at: stopped && { status: stopped.status, rate: stopped.rate, headers: stopped.headers, body: stopped.body }, calls_in_prev_1s: within(1000), calls_in_prev_10s: within(10000), calls_in_prev_60s: within(60000), log: out }, null, 2));
