/**
 * A chat client of a proxy tier for the closed-question paths of the structure/formalizer evaluations (path B of ./ab.mjs, the jsEval
 * route of ./js-route.mjs): greedy, no thinking, no fallback, tagged with the purpose and run, counting cache hits and token usage.
 * Evaluation harness only.
 */
/** A chat client of a proxy tier for the expression path: greedy, no thinking, no fallback, tagged; counts the cache hits. */
export function tierChat(tier, {purpose, run: runId, cache, timeoutMs, thinking = null}) {
  const PROXY = (process.env.LLMAPIPROVIDER_URL ?? 'http://127.0.0.1:18080/v1').replace(/\/+$/, '');
  // think: a local thinking model with its recommended sampling; reason: a cloud tier's reasoning (OpenRouter effort medium).
  const sampling = thinking === 'think' ? {temperature: 0.6, top_p: 0.95, top_k: 20, chat_template_kwargs: {enable_thinking: true}}
    : thinking === 'reason' ? {temperature: 0, reasoning: {effort: 'medium'}} : {temperature: 0, chat_template_kwargs: {enable_thinking: false}};
  const once = async (messages, maxTokens) => {
    chat.calls++;
    try {
      const r = await fetch(`${PROXY}/chat/completions`, {method: 'POST', signal: AbortSignal.timeout(timeoutMs),
        headers: {'content-type': 'application/json', 'x-llmapiprovider-purpose': purpose, 'x-llmapiprovider-run': runId, 'x-llmapiprovider-no-fallback': '1', ...(cache ? {'x-llmapiprovider-cache': cache} : {})},
        body: JSON.stringify({model: tier, messages, max_tokens: maxTokens, stream: false, ...sampling})});
      if (r.headers.get('x-llmapiprovider-cache') === 'hit') chat.hits++;
      const body = await r.json().catch(() => null);
      if (!r.ok || !body) return {ok: false, reason: `${r.status} ${JSON.stringify(body?.error ?? '').slice(0, 200)}`};
      const m = body.choices?.[0]?.message ?? {};
      chat.usage.output_tokens += body.usage?.completion_tokens ?? 0; chat.usage.reasoning_tokens += body.usage?.completion_tokens_details?.reasoning_tokens ?? 0; chat.usage.reasoning_chars += (m.reasoning_content ?? '').length; chat.usage.content_chars += String(m.content ?? '').length;
      return {ok: true, finish: body.choices?.[0]?.finish_reason ?? null, text: String(m.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim()};
    } catch (error) { return {ok: false, reason: String(error.message ?? error)}; }
  };
  // A reply cut by its budget is never used silently: asked again with four times the budget (at most 32000 tokens), else reported.
  const chat = async (messages, maxTokens) => {
    let budget = thinking === 'reason' ? 32000 : thinking ? Math.max(maxTokens, 8000) : maxTokens;
    for (;;) {
      const r = await once(messages, budget);
      if (!r.ok || r.finish !== 'length') return r;
      if (budget >= 32000) { chat.usage.cut++; return {ok: false, reason: `budget_exhausted: cut at ${budget} tokens`}; }
      budget = Math.min(32000, budget * 4); chat.usage.budget_retries++;
    }
  };
  chat.calls = 0; chat.hits = 0; chat.usage = {output_tokens: 0, reasoning_tokens: 0, reasoning_chars: 0, content_chars: 0, budget_retries: 0, cut: 0};
  return chat;
}

