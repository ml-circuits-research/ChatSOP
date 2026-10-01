/**
 * HTTP routes of the independent capability APIs (DS030 "Capability APIs and caching", docs/api.html).
 *
 *   POST /v1/language/proofread   LanguageProofingLLM (textToCleanEnglish)     alias: POST /v1/text-to-clean-english
 *   POST /v1/understand           SymbolicLM analysis + interpretation CNL + certification (+ optional rewrite, tone)
 *   POST /v1/symbolic/rewrite     SymbolicProofingLLM alone, with the trace
 *   POST /v1/symbolic/analyze     the raw SymbolicLM analysis
 *   POST /v1/emotion/detect       EmotionDetectionSystem signals and emoticon suggestions
 *   GET  /v1/capabilities         the endpoint list and the component versions
 *   GET  /v1/cache/stats          (admin) per-cache statistics; POST /v1/cache/clear (admin) empties the caches
 *
 * Authentication is the server's own (bearer token or administrator session), checked before a route is reached. A request is a
 * JSON object with a non-empty `message`; the routes answer 200 with `status` ok, partial or unavailable (see capabilities.mjs):
 * a component that cannot run never turns the answer into an error when something was understood. 4xx/5xx carry the standard
 * `{error: {message, type, code}}` and are only for an invalid request, a limit or authentication.
 */
import {REWRITE_MODES, REWRITE_ACCEPT} from './capabilities.mjs';

export const API_ENDPOINTS = Object.freeze([
  {method: 'POST', path: '/v1/language/proofread', capability: 'language.proofread', body: ['message', 'sendAll']},
  {method: 'POST', path: '/v1/text-to-clean-english', capability: 'language.proofread', body: ['message', 'sendAll'], alias: '/v1/language/proofread'},
  {method: 'POST', path: '/v1/understand', capability: 'symbolic.understanding', body: ['message', 'rewrite', 'accept', 'emotion', 'interpret']},
  {method: 'POST', path: '/v1/symbolic/rewrite', capability: 'symbolic.rewrite', body: ['message', 'mode', 'accept']},
  {method: 'POST', path: '/v1/symbolic/analyze', capability: 'symbolic.analysis', body: ['message', 'rewrite', 'accept']},
  {method: 'POST', path: '/v1/emotion/detect', capability: 'emotion.detection', body: ['message', 'hasContent']},
  {method: 'GET', path: '/v1/capabilities', capability: 'capabilities'},
  {method: 'GET', path: '/v1/cache/stats', capability: 'cache.stats', admin: true},
  {method: 'POST', path: '/v1/cache/clear', capability: 'cache.clear', admin: true, body: []},
]);

const bad = (message, code = 'invalid_request', status = 400) => Object.assign(new Error(message), {status, code});
const oneOf = (value, list, name) => { if (value !== undefined && !list.includes(value)) throw bad(`${name} must be one of ${list.join(', ')}`, 'invalid_parameter'); return value; };
const bool = (value, name) => { if (value !== undefined && typeof value !== 'boolean') throw bad(`${name} must be a boolean`, 'invalid_parameter'); return value; };

export function createApiRouter({capabilities, json, error, readBody, limits}) {
  const {maxRequestBytes, maxContextBytes, maxConcurrent} = limits;
  let active = 0;
  const known = new Map(API_ENDPOINTS.map(e => [e.method + ' ' + e.path, e]));

  function checked(endpoint, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('Expected a JSON object');
    const extra = Object.keys(body).filter(k => !endpoint.body.includes(k));
    if (extra.length) throw bad(`Unsupported parameter ${JSON.stringify(extra[0])}; ${endpoint.path} accepts ${endpoint.body.join(', ')}`, 'unsupported_parameter');
    if (typeof body.message !== 'string' || !body.message.trim()) throw bad('Provide a non-empty message string', 'invalid_message');
    if (Buffer.byteLength(body.message) > maxContextBytes) throw bad('Message exceeds the context limit of ' + maxContextBytes + ' bytes', 'request_limit', 413);
    return body;
  }

  const handlers = {
    '/v1/language/proofread': async body => capabilities.proofread(body.message, {sendAll: bool(body.sendAll, 'sendAll')}),
    '/v1/understand': async body => capabilities.understand(body.message, {rewrite: oneOf(body.rewrite, REWRITE_MODES, 'rewrite'), accept: oneOf(body.accept, REWRITE_ACCEPT, 'accept'), emotion: bool(body.emotion, 'emotion'), interpret: bool(body.interpret, 'interpret')}),
    '/v1/symbolic/rewrite': async body => capabilities.rewrite(body.message, {mode: oneOf(body.mode, ['gated', 'always'], 'mode'), accept: oneOf(body.accept, REWRITE_ACCEPT, 'accept')}),
    '/v1/symbolic/analyze': async body => capabilities.analyze(body.message, {rewrite: oneOf(body.rewrite, REWRITE_MODES, 'rewrite'), accept: oneOf(body.accept, REWRITE_ACCEPT, 'accept')}),
    '/v1/emotion/detect': async body => capabilities.detectEmotion(body.message, {hasContent: bool(body.hasContent, 'hasContent')}),
  };
  handlers['/v1/text-to-clean-english'] = handlers['/v1/language/proofread'];

  /** Returns true when the request was a capability route (handled, answer sent). `admin`: the caller may read and clear the caches. */
  async function handle(req, res, url, {admin = false, cacheServices = null} = {}) {
    const endpoint = known.get(req.method + ' ' + url);
    if (!endpoint) return false;
    try {
      if (endpoint.admin && !admin) throw bad('This endpoint needs the administrator session (sign in on /login)', 'forbidden', 403);
      if (url === '/v1/capabilities') return json(res, 200, {object: 'capabilities', endpoints: API_ENDPOINTS.map(({admin: a, ...e}) => ({...e, ...(a ? {admin: true} : {})})), versions: capabilities.versions(), limits: {max_message_bytes: maxContextBytes, max_request_bytes: maxRequestBytes, max_concurrent: maxConcurrent}}), true;
      if (url === '/v1/cache/stats') return json(res, 200, {object: 'cache.stats', caches: capabilities.cacheStats(), services: cacheServices ? await cacheServices() : {}}), true;
      if (url === '/v1/cache/clear') { req.resume(); capabilities.clearCaches(); return json(res, 200, {object: 'cache.clear', cleared: true, caches: capabilities.cacheStats()}), true; }
      if (active >= maxConcurrent) throw bad('Server concurrency limit reached', 'concurrency_limit', 429);
      active++;
      try {
        const body = checked(endpoint, await readBody(req, maxRequestBytes));
        const result = await handlers[url](body);
        if (!res.destroyed) json(res, 200, result);
      } finally { active--; }
    } catch (e) {
      if (!res.destroyed) error(res, e.status ?? 400, e.code ?? 'invalid_request', e.message);
    }
    return true;
  }

  return {handle, endpoints: API_ENDPOINTS};
}
