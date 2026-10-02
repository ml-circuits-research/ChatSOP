// The proxy: routing, forwarding (JSON and SSE), 429 retry, usage extraction and logging.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { Limiter } from './limiter.mjs';
import { Monitor, pickRateHeaders, redact, RATE_HEADER } from './monitor.mjs';
import { DASHBOARD_HTML } from './dashboard.mjs';
import { resolveUpstream } from './settings.mjs';

const FORWARD_REQ = ['content-type', 'accept', 'anthropic-version', 'anthropic-beta'];
const MAX_BODY = 512 * 1024 * 1024;

export function extractUsage(fmt, obj) {
  // Returns {in, out, cached} from an OpenAI or Anthropic usage object (or a stream event), or null.
  const u = obj?.usage || obj?.message?.usage;
  if (!u) return null;
  const cached = u.prompt_tokens_details?.cached_tokens ?? u.cache_read_input_tokens ?? 0;
  const inT = u.prompt_tokens ?? u.input_tokens;
  const out = u.completion_tokens ?? u.output_tokens;
  return { in: inT, out, cached, creation: u.cache_creation_input_tokens };
}

function mergeUsage(acc, u) {
  if (!u) return acc;
  const r = acc || {};
  if (u.in != null) r.in = u.in;
  if (u.out != null) r.out = u.out;
  if (u.cached) r.cached = u.cached;
  return r;
}

export function createProxy({ config, env = process.env, dataDir, proxyToken = null, fetchImpl = fetch }) {
  const upstreams = {};
  const limiters = {};
  for (const [name, up] of Object.entries(config.upstreams)) {
    upstreams[name] = resolveUpstream(name, up, env);
    limiters[name] = new Limiter(up.limits);
  }
  const secrets = [...Object.values(upstreams).map((u) => u.key), proxyToken].filter(Boolean);
  const monitor = new Monitor({ dataDir, secrets });
  const modelCache = {}; // upstream -> {at, list, byId}

  async function getModels(up) {
    const c = modelCache[up.name];
    const ttl = (config.modelsCacheSeconds ?? 600) * 1000;
    if (c && Date.now() - c.at < ttl) return c;
    try {
      const r = await fetchImpl(up.baseUrl + (up.modelsPath || '/v1/models'), { headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error('models status ' + r.status);
      const list = await r.json();
      const byId = Object.fromEntries((list.data || []).map((m) => [m.id, m]));
      return (modelCache[up.name] = { at: Date.now(), list, byId });
    } catch (e) {
      if (c) return c; // stale beats nothing
      throw e;
    }
  }
  const allModels = () => Object.assign({}, ...Object.values(modelCache).map((c) => c.byId));

  function pickUpstream(url) {
    const m = /^\/u\/([^/]+)(\/.*)$/.exec(url.pathname);
    if (m && upstreams[m[1]]) return { up: upstreams[m[1]], path: m[2] };
    return { up: upstreams[config.defaultUpstream], path: url.pathname };
  }

  function authorized(req, url) {
    if (!proxyToken) return true;
    const h = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.headers['x-api-key'] || url.searchParams.get('token');
    return h === proxyToken;
  }

  const sendJson = (res, status, obj, headers = {}) => {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), ...headers });
    res.end(body);
  };

  async function readBody(req) {
    const chunks = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > MAX_BODY) throw new Error('body too large'); chunks.push(c); }
    return Buffer.concat(chunks);
  }

  async function forward(req, res, up, path, body) {
    const limiter = limiters[up.name];
    const retry = up.retry || { max: 3, baseMs: 1000, maxWaitMs: 60000 };
    const format = path === (up.formats?.anthropic || '/v1/messages') ? 'anthropic' : 'openai';
    const client = (req.headers['x-client-name'] || (req.headers['user-agent'] || 'unknown').split(/[\s/]/)[0]).toString().slice(0, 40);

    let parsed = null;
    try { parsed = JSON.parse(body.toString('utf8')); } catch { /* not JSON: forwarded as is */ }
    const stream = !!parsed?.stream;
    const model = parsed?.model ?? null;
    let outBody = body;
    if (parsed && stream && format === 'openai' && config.injectStreamUsage !== false && !parsed.stream_options?.include_usage) {
      parsed.stream_options = { ...(parsed.stream_options || {}), include_usage: true };
      outBody = Buffer.from(JSON.stringify(parsed));
    }
    const est = parsed ? Math.round(JSON.stringify(parsed.messages ?? '').length / 4) : null;
    const abort = new AbortController();
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });

    for (let attempt = 1; ; attempt++) {
      const outcome = await limiter.schedule(async ({ queueWaitMs }) => {
        const t0 = Date.now();
        const rec = { id: randomUUID().slice(0, 8), upstream: up.name, client, endpoint: path, format, model, stream, attempt, queue_wait_ms: queueWaitMs, req_bytes: body.length, est_in_tokens: est };
        const headers = {};
        for (const h of FORWARD_REQ) if (req.headers[h]) headers[h] = req.headers[h];
        headers['content-type'] ||= 'application/json';
        const auth = up.key || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        if (auth) headers.authorization = 'Bearer ' + auth;
        let r;
        try {
          r = await fetchImpl(up.baseUrl + path, { method: 'POST', headers, body: outBody, signal: abort.signal });
        } catch (e) {
          Object.assign(rec, { status: 502, latency_ms: Date.now() - t0, error: 'upstream unreachable: ' + (e.cause?.code || e.message) });
          monitor.log(rec);
          if (!res.headersSent) sendJson(res, 502, { error: { type: 'proxy_error', message: rec.error } });
          return { done: true };
        }
        rec.rate_headers = pickRateHeaders(r.headers);
        rec.status = r.status;
        const ctype = r.headers.get('content-type') || '';

        if (r.status === 429 && attempt <= retry.max) {
          const text = await r.text().catch(() => '');
          Object.assign(rec, { latency_ms: Date.now() - t0, res_bytes: text.length, error: text, will_retry: true });
          monitor.log(rec);
          const ra = Number(r.headers.get('retry-after'));
          const wait = Math.min(retry.maxWaitMs, Number.isFinite(ra) && ra > 0 ? ra * 1000 : retry.baseMs * 2 ** (attempt - 1));
          limiter.pause(wait);
          return { retry: true };
        }

        const out = { 'content-type': ctype || 'application/json', 'cache-control': 'no-store' };
        for (const [k, v] of r.headers) if (RATE_HEADER.test(k)) out[k] = v;
        res.writeHead(r.status, out);
        let usage = null, bytes = 0, ttft = null, errText = '', buf = '', tail = '';
        const isSse = ctype.includes('text/event-stream');
        const onLine = (line) => {
          if (!line.startsWith('data:')) return;
          const d = line.slice(5).trim();
          if (!d || d === '[DONE]') return;
          try { usage = mergeUsage(usage, extractUsage(format, JSON.parse(d))); } catch { /* ignore */ }
        };
        try {
          for await (const chunk of r.body ?? []) {
            if (ttft == null) ttft = Date.now() - t0;
            bytes += chunk.length;
            res.write(chunk);
            const s = Buffer.from(chunk).toString('utf8');
            if (isSse) {
              buf += s; let i;
              while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); }
            } else if (bytes <= 16 * 1024 * 1024) tail += s;
          }
          if (isSse && buf) onLine(buf);
        } catch (e) {
          rec.error = 'stream interrupted: ' + (e.message || e);
        }
        res.end();
        if (!isSse) {
          try { usage = extractUsage(format, JSON.parse(tail)); } catch { /* not JSON */ }
          if (r.status >= 400) errText = tail;
        } else if (r.status >= 400) errText = buf;
        Object.assign(rec, {
          latency_ms: Date.now() - t0, ttft_ms: stream ? ttft : null, res_bytes: bytes,
          in_tokens: usage?.in ?? null, out_tokens: usage?.out ?? null, cached_tokens: usage?.cached ?? 0,
        });
        if (r.status >= 400) rec.error = errText || rec.error;
        const num = (h) => { const v = Number(r.headers.get(h)); return r.headers.get(h) != null && Number.isFinite(v) ? v : null; };
        rec.quota_remaining = num('x-quota-remaining'); rec.quota_cost = num('x-quota-cost'); rec.credit_cost = num('x-credit-cost');
        if (r.status >= 400 && /billed from your credit balance|credit balance/i.test(errText)) rec.credit_billed = true;
        monitor.log(rec);
        return { done: true };
      });
      if (!outcome.retry) return;
    }
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        return sendJson(res, 200, { ok: true, uptime_s: Math.round(process.uptime()), upstreams: Object.fromEntries(Object.values(upstreams).map((u) => [u.name, { base_url: u.baseUrl, key_configured: !!u.key, queue_depth: limiters[u.name].depth }])) });
      }
      if (!authorized(req, url)) return sendJson(res, 401, { error: { type: 'authentication_error', message: 'invalid proxy token' } });
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(DASHBOARD_HTML);
      }
      if (req.method === 'GET' && url.pathname === '/stats') {
        const info = Object.fromEntries(Object.entries(limiters).map(([n, l]) => [n, { depth: l.depth, active: l.active, pausedUntil: l.pausedUntil, limits: { maxConcurrent: l.maxConcurrent, maxPerSecond: l.maxPerSecond, maxPerMinute: l.maxPerMinute, maxPerHour: l.maxPerHour } }]));
        for (const u of Object.values(upstreams)) await getModels(u).catch(() => {});
        return sendJson(res, 200, monitor.stats(info, allModels()));
      }
      const { up, path } = pickUpstream(url);
      if (req.method === 'GET' && path === '/v1/models') {
        try {
          const list = (await getModels(up)).list;
          const credit = monitor.creditModels();
          return sendJson(res, 200, { ...list, data: (list.data || []).map((m) => ({ ...m, x_billing: credit.has(m.id) ? 'credit' : 'plan_or_unknown' })) });
        }
        catch (e) { return sendJson(res, 502, { error: { type: 'proxy_error', message: 'model list unavailable: ' + redact(e.message, secrets) } }); }
      }
      if (req.method === 'POST' && path.startsWith('/v1/')) {
        if (!modelCache[up.name]) getModels(up).catch(() => {}); // warm pricing for stats
        return await forward(req, res, up, path, await readBody(req));
      }
      return sendJson(res, 404, { error: { type: 'not_found', message: `${req.method} ${url.pathname}` } });
    } catch (e) {
      if (!res.headersSent) sendJson(res, 500, { error: { type: 'proxy_error', message: redact(e.message, secrets) } });
      else res.end();
    }
  }

  const server = http.createServer(handle);
  server.requestTimeout = 0; server.headersTimeout = 30_000; server.keepAliveTimeout = 5_000;
  return { server, monitor, limiters, upstreams };
}
