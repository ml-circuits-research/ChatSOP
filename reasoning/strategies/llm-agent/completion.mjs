/** One bounded OpenAI-compatible chat completion. No retries or alternate-provider substitution. */
export async function runCompletion({model, prompt, system, timeoutMs = 120000, maxTokens = 1024, endpoint, apiKey, signal} = {}) {
  const started = performance.now();
  const result = extra => ({ok: false, text: null, cost: 0, usage: null, ms: Math.round(performance.now() - started), timedOut: false, error: null, ...extra});
  if (typeof model !== 'string' || !model || typeof prompt !== 'string' || typeof endpoint !== 'string' || !endpoint)
    return result({error: 'model, prompt and endpoint are required'});
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(maxTokens) || maxTokens <= 0)
    return result({error: 'timeoutMs and maxTokens must be positive safe integers'});
  let url;
  try {
    const target = new URL(endpoint);
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.search || target.hash)
      throw new Error('endpoint must be an HTTP(S) URL without credentials, query or fragment');
    const root = target.pathname.replace(/\/+$/, '');
    if (!root.endsWith('/chat/completions')) target.pathname = `${root}${root.endsWith('/v1') ? '' : '/v1'}/chat/completions`;
    url = target.toString();
  } catch (e) { return result({error: `invalid completion endpoint: ${e.message}`}); }
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, {once: true});
  if (signal?.aborted) controller.abort();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {'content-type': 'application/json', ...(apiKey ? {authorization: `Bearer ${apiKey}`} : {})},
      body: JSON.stringify({model, messages: [...(system ? [{role: 'system', content: system}] : []), {role: 'user', content: prompt}], max_tokens: maxTokens, temperature: 0, chat_template_kwargs: {enable_thinking: false}}),
      signal: controller.signal,
    });
    if (!response.ok) return result({error: `completion HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`});
    let data;
    try { data = await response.json(); }
    catch (e) {
      if (timedOut) return result({timedOut: true, error: 'wall timeout'});
      return result({error: `malformed completion JSON: ${e.message}`});
    }
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) return result({error: 'malformed completion response: missing assistant text'});
    const u = data.usage;
    const usage = u && typeof u === 'object' ? {input: u.prompt_tokens ?? null, output: u.completion_tokens ?? null, cacheRead: u.prompt_tokens_details?.cached_tokens ?? null, ...u} : null;
    return result({ok: true, text, usage});
  } catch (e) {
    return result({timedOut, error: timedOut ? 'wall timeout' : `completion request failed: ${e.message}`});
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
