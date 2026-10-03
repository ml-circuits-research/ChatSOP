/**
 * Small-model service: a local JSON HTTP API for the two small non-chat models of the formalization architecture (owner decision
 * 2026-10-03). A local service of LLMAPIProvider: the proxy forwards the tiers `structure` and `formalizer`
 * here (upstream `smallmodels`), so clients never call this port directly; the proxy logs, caches and tags as for chat models.
 *
 *   POST /v1/structure  {model?, text, entities?: [label] | {label: description}, relations?: {type: {head?: [label], tail?: [label]}},
 *                        structures?: {parent: ["field::str", ...]}, records?: bool, threshold?}
 *                       → {object: "structure", model, entities: {label: [{text, start, end, confidence}]}, relations: [...],
 *                          structures: {...}, ms}
 *   POST /v1/fol        {model? (a formalizer id; default the first), inputs: [sentence] | text, candidates?: 1..8, temperature?, top_k?, max_new_tokens?, prefix?}
 *                       → {object: "fol", model, results: [{input, candidates: [fol], tokens}], ms}
 *   GET  /health, GET /v1/models
 *
 * A 400 names the wrong field; a backend failure is a 500 with its message. The proxy starts this file (`start.script` of the upstream
 * `smallmodels`, `startAtBoot`) with `--port`; it is not started by hand.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const loadConfig = (file = path.join(HERE, 'config.json')) => JSON.parse(fs.readFileSync(file, 'utf8'));

const MAX_BODY = 4 * 1024 * 1024;
const send = (res, status, obj) => { const b = JSON.stringify(obj); res.writeHead(status, {'content-type': 'application/json', 'content-length': Buffer.byteLength(b)}); res.end(b); };
const bad = msg => Object.assign(new Error(msg), {status: 400});
const isStrList = x => Array.isArray(x) && x.every(s => typeof s === 'string' && s.trim());

/** Checks a /v1/structure body; returns the backend request. */
export function structureRequest(b) {
  if (typeof b?.text !== 'string' || !b.text.trim()) throw bad('text must be a non-empty string');
  const e = b.entities ?? [];
  if (!(isStrList(e) || (e && typeof e === 'object' && !Array.isArray(e) && Object.values(e).every(v => typeof v === 'string')))) throw bad('entities must be a list of labels or an object label → description');
  if (b.relations != null && (typeof b.relations !== 'object' || Array.isArray(b.relations))) throw bad('relations must be an object type → {head, tail}');
  if (b.structures != null && (typeof b.structures !== 'object' || !Object.values(b.structures).every(isStrList))) throw bad('structures must be an object parent → [field specs]');
  if (b.threshold != null && !(b.threshold > 0 && b.threshold < 1)) throw bad('threshold must be between 0 and 1');
  if (!(Array.isArray(e) ? e.length : Object.keys(e).length) && !b.relations && !b.structures) throw bad('nothing to extract: give entities, relations or structures');
  return {text: b.text, entities: e, relations: b.relations ?? null, structures: b.structures ?? null, records: Boolean(b.records), threshold: b.threshold ?? null};
}

/** Checks a /v1/fol body; returns the backend request. */
export function folRequest(b, cfg = {}) {
  const inputs = b?.inputs ?? (typeof b?.text === 'string' ? [b.text] : null);
  if (!isStrList(inputs) || !inputs.length) throw bad('inputs must be a non-empty list of sentences (or give text)');
  if (inputs.length > (cfg.maxInputs ?? 64)) throw bad(`at most ${cfg.maxInputs ?? 64} inputs per request`);
  const n = b.candidates ?? 1;
  if (!Number.isInteger(n) || n < 1 || n > (cfg.maxCandidates ?? 8)) throw bad(`candidates must be an integer 1..${cfg.maxCandidates ?? 8}`);
  if (b.temperature != null && !(b.temperature > 0 && b.temperature <= 2)) throw bad('temperature must be in (0, 2]');
  return {inputs, candidates: n, temperature: b.temperature ?? null, top_k: b.top_k ?? null, max_new_tokens: b.max_new_tokens ?? null, prefix: b.prefix ?? null};
}

/**
 * A role's backend for the requested model id: a role holds one backend or a list (config `extraFormalizers`, e.g. T5-3B next to
 * T5-base); the proxy sends the tier entry's model id, an unknown id gets the role's first backend.
 */
const pick = (role, id) => (Array.isArray(role) ? role.find(b => b.id === id) ?? role[0] : role);
const listOf = role => (Array.isArray(role) ? role : [role]);

/** The HTTP server over injected backends {structure, formalizer} (each {id, status(), run(req)}); tests pass fakes. */
export function createServer({backends, config = {}}) {
  const handle = async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, {ok: true, models: Object.fromEntries(Object.entries(backends).map(([k, v]) => [k, Array.isArray(v) ? v.map(b => b.status()) : v.status()]))});
      if (req.method === 'GET' && url.pathname === '/v1/models') return send(res, 200, {object: 'list', data: Object.entries(backends).flatMap(([k, v]) => listOf(v).map(b => ({id: b.id, object: 'model', role: k})))});
      if (req.method !== 'POST' || !['/v1/structure', '/v1/fol'].includes(url.pathname)) return send(res, 404, {error: {type: 'not_found', message: `${req.method} ${url.pathname}`}});
      const chunks = []; let n = 0;
      for await (const c of req) { n += c.length; if (n > MAX_BODY) throw bad('body too large'); chunks.push(c); }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw bad('body must be JSON'); }
      const t0 = Date.now();
      if (url.pathname === '/v1/structure') {
        const b = pick(backends.structure, body.model);
        const r = await b.run(structureRequest(body));
        return send(res, 200, {object: 'structure', model: b.id, ...r, ms: Date.now() - t0});
      }
      const b = pick(backends.formalizer, body.model);
      const r = await b.run(folRequest(body, config.formalizer));
      return send(res, 200, {object: 'fol', model: b.id, ...r, ms: Date.now() - t0});
    } catch (error) {
      if (!res.headersSent) send(res, error.status ?? 500, {error: {type: error.status === 400 ? 'invalid_request' : 'backend_error', message: String(error.message ?? error)}});
    }
  };
  return http.createServer(handle);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  const k = process.argv.indexOf('--port');
  const port = k > 0 ? Number(process.argv[k + 1]) : config.port;
  const {structureBackend, formalizerBackend} = await import('./backends.mjs');
  const backends = {structure: structureBackend(config.structure, config),
    formalizer: [formalizerBackend(config.formalizer, config), ...(config.extraFormalizers ?? []).map(c => formalizerBackend({...config.formalizer, ...c}, config))]};
  createServer({backends, config}).listen(port, config.host ?? '127.0.0.1', () => console.log(`small-model server on ${config.host ?? '127.0.0.1'}:${port}`));
}
