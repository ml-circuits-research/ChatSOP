/**
 * Client of the two small non-chat tiers of LLMAPIProvider (owner decision 2026-10-03): `structure` (the PSM, GLiNER2.5,
 * POST /v1/structure) and `formalizer` (the LFM, T5 NL-to-FOL, POST /v1/fol), served by LLMAPIProvider's managed local service (LLMAPIProvider/local-services/small-models). Requests are tagged with
 * a purpose (and a run) like every proxy call; the proxy caches the answers, so the same request gives the same extraction or the same
 * FOL candidates (the sampled ones included). Returns {ok, body, ms, cached} or {ok: false, reason}; never throws on a model failure.
 */
const PROXY = () => (process.env.LLMAPIPROVIDER_URL ?? 'http://127.0.0.1:18080/v1').replace(/\/v1\/?$/, '');

async function call(path, body, {purpose = 'formalize', run = null, cache = null, timeoutMs = 300_000, fetchImpl = fetch} = {}) {
  const t0 = Date.now();
  try {
    const r = await fetchImpl(`${PROXY()}${path}`, {method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: {'content-type': 'application/json', 'x-llmapiprovider-purpose': purpose, ...(run ? {'x-llmapiprovider-run': run} : {}), ...(cache ? {'x-llmapiprovider-cache': cache} : {})},
      body: JSON.stringify(body)});
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* reported below */ }
    if (!r.ok || !json || json.error) return {ok: false, reason: `${r.status} ${json?.error?.message ?? text.slice(0, 200)}`, ms: Date.now() - t0};
    return {ok: true, body: json, ms: Date.now() - t0, cached: r.headers.get('x-llmapiprovider-cache') === 'hit'};
  } catch (error) { return {ok: false, reason: String(error.message ?? error), ms: Date.now() - t0}; }
}

/** The PSM: {text, entities, relations?, threshold?} → extraction JSON (entities by label with spans, relations). */
export const extractStructure = (request, options) => call('/v1/structure', {model: 'structure', ...request}, options);

/** The LFM: {inputs: [sentence], candidates?} → {results: [{input, candidates: [fol]}]}. */
export const formalizeFol = (request, options) => call('/v1/fol', {model: 'formalizer', ...request}, options);
