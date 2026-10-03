/**
 * One chat request to a local llama-server slot, or to the proxy tier of the step-by-step strategies (DS022 "Formalization strategies: the local runtime"). Every request keeps the prompt
 * cache on (`cache_prompt`), is pinned to its role's slot (`id_slot`), asks for the server timings and is greedy. The result carries
 * the reuse counters the server reports: `cached` (prompt tokens taken from the slot's cache) and `evaluated` (new prompt tokens).
 */
export async function localChat({endpoint, model = 'local', messages, slot = null, maxTokens = 256, temperature = 0, timeoutMs = 120_000, extraBody = {}, headers = {}, fetchImpl = globalThis.fetch}) {
  const base = endpoint.replace(/\/+$/, '');
  const url = /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
  const started = Date.now();
  let response;
  try {
    response = await fetchImpl(url, {method: 'POST', headers: {'content-type': 'application/json', ...headers}, signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({model, messages, max_tokens: maxTokens, temperature, stream: false, cache_prompt: true, timings_per_token: false,
        ...(Number.isInteger(slot) ? {id_slot: slot} : {}), ...extraBody})});
  } catch (error) {
    return {ok: false, text: '', ms: Date.now() - started, reason: error.name === 'TimeoutError' ? `the local model exceeded the ${Math.round(timeoutMs / 1000)} s limit` : `the local model could not be reached: ${error.message}`};
  }
  const raw = await response.text();
  let body = null;
  try { body = JSON.parse(raw); } catch { /* reported below */ }
  if (!response.ok || !body) return {ok: false, text: '', ms: Date.now() - started, reason: `the local model answered ${response.status}: ${raw.slice(0, 200)}`};
  const timings = body.timings ?? {};
  const text = String(body.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const finish = body.choices?.[0]?.finish_reason ?? null;
  // A reply cut by the token limit before any answer (a reasoning model that spent the budget thinking) is a budget failure, never
  // an empty answer to read (owner, 2026-10-02).
  if (finish === 'length' && !text) return {ok: false, text: '', ms: Date.now() - started, finish, reason: `budget_exhausted: the reply reached max_tokens ${maxTokens} before an answer`, usage: {input_tokens: body.usage?.prompt_tokens ?? 0, output_tokens: body.usage?.completion_tokens ?? 0, reasoning_tokens: body.usage?.completion_tokens_details?.reasoning_tokens ?? 0}};
  return {ok: true, text, ms: Date.now() - started, finish,
    usage: {input_tokens: body.usage?.prompt_tokens ?? 0, output_tokens: body.usage?.completion_tokens ?? 0, reasoning_tokens: body.usage?.completion_tokens_details?.reasoning_tokens ?? 0, cache_read_tokens: timings.cache_n ?? body.usage?.prompt_tokens_details?.cached_tokens ?? 0},
    cached: timings.cache_n ?? null, evaluated: timings.prompt_n ?? null, prompt_ms: timings.prompt_ms ?? null, predicted_ms: timings.predicted_ms ?? null, predicted_per_second: timings.predicted_per_second ?? null};
}
