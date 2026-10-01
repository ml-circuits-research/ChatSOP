/** The SymbolicLM chat service (DS021 "SymbolicLM", DS012 "Formalizer models"): the llama.cpp-compatible chat-completion
 * endpoint the server's model registry starts (`node lib/symbolic-lm/serve.mjs serve --host H --port P`). The only input is the
 * message; requests are serialized through the one Stanza worker. `GET /health`, `GET /v1/models` and
 * `POST /v1/chat/completions` with the message as the last user turn; the reply content is the SOP text, and `symbolic_lm`
 * in the response carries route, language, uncertainty, analysis and, on request, interpretation and emotion signals.
 * A request may carry `symbolic_lm: {rewrite_url, rewrite_version, rewrite_when, rewrite_accept, interpret, emotion}`:
 * host options of the chat for that message only (DS012 "Understanding in the chat"), never model input.
 */
import http from 'node:http';
import {createSymbolicLM, SymbolicLM, SYMBOLIC_LM_VERSION} from './index.mjs';
import {REWRITE_GATES, REWRITE_ACCEPTANCE} from './rewrite-gate.mjs';
import {interpretResult} from './interpretation.mjs';
import {createCache, cacheKey} from '../cache/lru.mjs';
import {createDefaultEmotionDetectionSystem, loadConfig as loadEmotionConfig, signalsToSop} from '../emotion-detection/index.mjs';

export const MODEL_ID = 'symbolic-lm';

/** The llama.cpp-compatible chat service. Requests are serialized through the one Stanza worker. */
/** Optional rewrite hook (off unless `url` is given): a message-only chat-completion call to a running
 * llama.cpp-compatible endpoint (e.g. llama-server serving a fine-tuned proofreader's GGUF export), greedy
 * (temperature 0), matching the exact call shape verified in experiment eval-proofreader-e2e-v1. */
function rewriteBackend(url, {cache = null, version = null} = {}) {
  if (!url) return null;
  const call = async englishText => {
    const res = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({messages: [{role: 'user', content: englishText}], temperature: 0, top_k: 1, max_tokens: 384, seed: 0})});
    if (!res.ok) throw Error(`rewrite backend ${url}: HTTP ${res.status}`);
    const data = await res.json();
    return String(data.choices?.[0]?.message?.content ?? '').trim();
  };
  // A small cache in front of the model, per sentence (DS030): the key carries the host's `rewrite_version` (model run and file stamp), so a model switch never serves a stale rewrite.
  if (!cache) return call;
  return async englishText => (await cache.getOrCompute(cacheKey('symbolic-proofing-llm', version ?? url, englishText), () => call(englishText), {cacheable: text => Boolean(text)})).value;
}

export async function serve({host = '127.0.0.1', port = 18961, threads, rewriteUrl = null, rewriteWhen = 'uncertain', rewriteAccept = 'off'} = {}) {
  const missing = SymbolicLM.missing();
  if (missing) { console.error(missing); process.exit(1); }
  const rewriteCache = createCache({name: 'symbolic-proofing-llm', maxEntries: 600, maxBytes: 2_000_000, ttlMs: 30 * 60_000});
  const rewrite = rewriteBackend(rewriteUrl, {cache: rewriteCache});
  // EmotionDetectionSystem (DS029): on by default from config/emotion-detection.json; a request's `emotion` flag overrides it.
  const emotionConfig = loadEmotionConfig();
  const emotion = createDefaultEmotionDetectionSystem(emotionConfig, {enabled: true});
  if (rewrite) console.error(`SymbolicLM rewrite hook: ${rewriteUrl} (rewriteWhen ${rewriteWhen}, rewriteAccept ${rewriteAccept})`);
  const ready = createSymbolicLM({threads});
  ready.catch(error => { console.error('SymbolicLM failed to start: ' + error.message); process.exit(1); });
  let lm = null;
  ready.then(value => { lm = value; });
  let queue = Promise.resolve();
  const reply = (res, status, body) => { res.writeHead(status, {'Content-Type': 'application/json'}); res.end(JSON.stringify(body)); };
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') return reply(res, lm ? 200 : 503, {status: lm ? 'ok' : 'loading', model: MODEL_ID, version: SYMBOLIC_LM_VERSION, rewrite: rewrite ? {rewriteWhen, rewriteAccept} : null,
        caches: lm ? {stanza_parse: lm.parseCache.stats(), stanza_unit: lm.unitCache.stats(), symbolic_proofing_llm: rewriteCache.stats()} : null});
      if (req.method === 'GET' && req.url === '/v1/models') return reply(res, 200, {object: 'list', data: [{id: MODEL_ID, object: 'model', owned_by: 'chatsop'}]});
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        const message = [...(body.messages ?? [])].reverse().find(m => m.role === 'user')?.content;
        if (typeof message !== 'string') return reply(res, 400, {error: {message: 'expected messages with a user turn'}});
        const model = await ready;
        // Per-request options of the host (the chat's "understanding" settings; host-side, never model input): `rewrite_url` (a
        // SymbolicProofingLLM chat-completion endpoint) with `rewrite_when` and `rewrite_accept` replace the serve flags for this
        // message, and `interpret: true` adds the per-sentence interpretation CNL of the analysis finally used.
        const asked = body.symbolic_lm ?? {};
        // The product service takes English only (DS021 "English-only core"); a non-English message is a 422, not an analysis.
        let options = {englishOnly: true, ...(rewrite ? {rewrite, rewriteWhen, rewriteAccept} : {})};
        if (asked.rewrite_url) {
          const when = asked.rewrite_when ?? 'trees', accept = asked.rewrite_accept ?? 'certified';
          if (!REWRITE_GATES.includes(when) || !REWRITE_ACCEPTANCE.includes(accept)) return reply(res, 400, {error: {message: 'unknown rewrite_when or rewrite_accept'}});
          options = {englishOnly: true, rewrite: rewriteBackend(asked.rewrite_url, {cache: rewriteCache, version: asked.rewrite_version ?? null}), rewriteWhen: when, rewriteAccept: accept};
        }
        const job = queue.then(async () => {
          const analysed = await model.analyze(message, options);
          const interpretation = asked.interpret ? await interpretResult(model, analysed) : null;
          // Pragmatic signals of the message and of the spans the analysis does not represent: host-side, advisory (DS029).
          const detected = (asked.emotion ?? emotionConfig.enabled) !== false
            ? await emotion.detect(message, {analysis: analysed.analysis, englishText: analysed.english ?? message, leftoverSpans: (interpretation?.not_represented ?? []).map(span => ({span}))}) : null;
          return {analysed, interpretation, detected};
        });
        queue = job.catch(() => {});
        const {analysed: result, interpretation, detected} = await job;
        return reply(res, 200, {id: 'symbolic-lm-' + Date.now(), object: 'chat.completion', model: MODEL_ID,
          choices: [{index: 0, message: {role: 'assistant', content: result.sop}, finish_reason: 'stop'}],
          usage: {prompt_tokens: 0, completion_tokens: 0},
          symbolic_lm: {route: result.route, language: result.language, uncertainty: result.uncertainty, english: result.trace.translation?.text ?? null,
            analysed_text: result.english ?? result.message, analysis: result.analysis, rewrite: result.trace.rewrite ?? null, ...(interpretation ? {interpretation} : {}),
            ...(detected ? {emotion: {signals: detected.signals, leftovers: detected.leftovers, sop: signalsToSop(detected.signals.filter(x => !x.experimental)), trace: detected.trace}} : {})},
          timings: {total_ms: result.trace.ms}});
      }
      reply(res, 404, {error: {message: 'not found'}});
    } catch (error) {
      if (error.code === 'non_english_input') return reply(res, 422, {error: {message: error.message, code: 'non_english_input', language: error.language}});
      reply(res, 500, {error: {message: error.message}});
    }
  });
  await new Promise(resolve => server.listen(Number(port), host, resolve));
  const stop = async () => { server.close(); emotion.close(); if (lm) await lm.stop(); process.exit(0); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  console.error(`SymbolicLM listening on http://${host}:${port}`);
  return server;
}

