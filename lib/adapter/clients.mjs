/**
 * The model clients of ChatSOPAdapter (owner decision 2026-10-03): every call names a proxy tier of LLMAPIProvider, never a model.
 *
 *   tierChat(tier, options)      a chat client of a tier for the closed questions (path B, jsEval, engineCode, the direct answer): greedy,
 *                                thinking off, tagged with a purpose and a run, counting cache hits and token usage. A reply cut by its
 *                                budget is asked again with four times the budget (at most 32000 tokens), else reported, never used.
 *   structureClient / folClient  the JSON tiers `structure` (POST /v1/structure) and `formalizer` (POST /v1/fol), through
 *                                lib/formalize/small-models.mjs.
 *
 * The request bodies are exactly those of the evaluation harnesses of 2026-10-03, so the proxy's response cache (keyed by the body)
 * replays their answers. `fetchImpl` is injectable (tests use fake tiers). `thinking`: 'think' (a local thinking model with its
 * recommended sampling), 'reason' (a cloud tier's reasoning, effort medium), or null.
 */
import {extractStructure, formalizeFol} from '../formalize/small-models.mjs';

export const DEFAULT_PROXY = 'http://127.0.0.1:18080/v1';
const proxyUrl = base => String(base ?? process.env.LLMAPIPROVIDER_URL ?? DEFAULT_PROXY).replace(/\/+$/, '');

/** Request headers of a call: purpose and run tags, the cache mode, and no fallback unless allowed. */
export function callHeaders({purpose = 'formalize', run = null, cache = null, noFallback = true} = {}) {
  return {'x-llmapiprovider-purpose': purpose, ...(run ? {'x-llmapiprovider-run': run} : {}), ...(noFallback ? {'x-llmapiprovider-no-fallback': '1'} : {}), ...(cache ? {'x-llmapiprovider-cache': cache} : {})};
}

/** A chat client of a proxy tier: `await chat(messages, maxTokens)` → {ok, text, finish} or {ok: false, reason}. */
export function tierChat(tier, {purpose = 'formalize', run = null, cache = null, timeoutMs = 300_000, thinking = null, noFallback = true, baseUrl = null, fetchImpl = globalThis.fetch} = {}) {
  const PROXY = proxyUrl(baseUrl);
  const sampling = thinking === 'think' ? {temperature: 0.6, top_p: 0.95, top_k: 20, chat_template_kwargs: {enable_thinking: true}}
    : thinking === 'reason' ? {temperature: 0, reasoning: {effort: 'medium'}} : {temperature: 0, chat_template_kwargs: {enable_thinking: false}};
  const once = async (messages, maxTokens) => {
    chat.calls++;
    try {
      const r = await fetchImpl(`${PROXY}/chat/completions`, {method: 'POST', signal: AbortSignal.timeout(timeoutMs),
        headers: {'content-type': 'application/json', ...callHeaders({purpose, run, cache, noFallback})},
        body: JSON.stringify({model: tier, messages, max_tokens: maxTokens, stream: false, ...sampling})});
      if (r.headers?.get?.('x-llmapiprovider-cache') === 'hit') chat.hits++;
      const body = await r.json().catch(() => null);
      if (!r.ok || !body) return {ok: false, reason: `${r.status} ${JSON.stringify(body?.error ?? '').slice(0, 200)}`};
      const m = body.choices?.[0]?.message ?? {};
      chat.usage.output_tokens += body.usage?.completion_tokens ?? 0; chat.usage.reasoning_tokens += body.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
      chat.usage.reasoning_chars += (m.reasoning_content ?? '').length; chat.usage.content_chars += String(m.content ?? '').length;
      return {ok: true, finish: body.choices?.[0]?.finish_reason ?? null, text: String(m.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim()};
    } catch (error) { return {ok: false, reason: String(error.message ?? error)}; }
  };
  const chat = async (messages, maxTokens) => {
    let budget = thinking === 'reason' ? 32000 : thinking ? Math.max(maxTokens, 8000) : maxTokens;
    for (;;) {
      const r = await once(messages, budget);
      if (!r.ok || r.finish !== 'length') return r;
      if (budget >= 32000) { chat.usage.cut++; return {ok: false, reason: `budget_exhausted: cut at ${budget} tokens`}; }
      budget = Math.min(32000, budget * 4); chat.usage.budget_retries++;
    }
  };
  chat.tier = tier; chat.calls = 0; chat.hits = 0;
  chat.usage = {output_tokens: 0, reasoning_tokens: 0, reasoning_chars: 0, content_chars: 0, budget_retries: 0, cut: 0};
  return chat;
}

/** Whether every call of a client was served from the proxy cache. */
export const allCached = chat => chat.calls > 0 && chat.hits === chat.calls;

/** The structure tier: `await structure(request)` with {text, entities, relations?, threshold?} → {ok, body, ms, cached} | {ok: false, reason}. */
export const structureClient = (tier, {purpose = 'formalize', run = null, cache = null, timeoutMs = 300_000, fetchImpl = globalThis.fetch} = {}) =>
  request => extractStructure({...request, model: tier}, {purpose, run, cache, timeoutMs, fetchImpl});

/** The formalizer (FOL) tier: `await fol(request)` with {inputs, candidates?, context?} → {ok, body: {results}, ms, cached} | {ok: false, reason}. */
export const folClient = (tier, {purpose = 'formalize', run = null, cache = null, timeoutMs = 300_000, fetchImpl = globalThis.fetch} = {}) =>
  request => formalizeFol({model: tier, ...request}, {purpose, run, cache, timeoutMs, fetchImpl});
