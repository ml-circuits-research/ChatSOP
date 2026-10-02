/**
 * Remote LLM providers (owner decision 2026-10-02: the openference plan's `Qwen3.8 27b` through the local proxy LLMAPIProvider is
 * the default model). One configured endpoint per provider (`llmProviders` of config/runtime.json) is used by every component that
 * needs a remote model through the OpenAI-compatible `completion` backend: the CodingAgent chain, LocalLLMDirect's remote option, the
 * answer-language step and the evaluation tools.
 *
 * A chain entry is a string (an omp model id, or a model of the configured backend kind) or an object
 * `{kind: 'completion'|'omp', provider?, model?, endpoint?}`; `chainEntry` resolves it to `{id, kind, model, endpoint?, provider?, extraBody}`.
 * The entry id is `<provider>/<model>` for a completion entry, so it reads like an omp id. An unreachable provider is reported by
 * `providerReadiness` with the reason; callers skip the entry and record why (never a silent substitution).
 */
export const DEFAULT_PROVIDERS = Object.freeze({
  openference: Object.freeze({baseUrl: 'http://127.0.0.1:18080/v1', model: 'Qwen3.8 27b', requestsPerMinute: 15, timeoutSeconds: 120, maxTokens: 4000, thinking: false}),
});

/** The providers: the defaults merged with `config.llmProviders`. */
export function providerSettings(config = {}) {
  const out = {};
  for (const name of new Set([...Object.keys(DEFAULT_PROVIDERS), ...Object.keys(config.llmProviders ?? {})])) out[name] = {...DEFAULT_PROVIDERS[name], ...(config.llmProviders?.[name] ?? {})};
  return out;
}

const noThinking = provider => provider.thinking === false ? {chat_template_kwargs: {enable_thinking: false}} : {};

/** Resolves one chain entry; `defaultKind` is the kind of a plain string entry (the configured backend's kind). */
export function chainEntry(entry, {providers = providerSettings(), defaultKind = 'omp', defaultEndpoint = null} = {}) {
  if (typeof entry === 'string') return {id: entry, kind: defaultKind, model: entry, ...(defaultKind === 'completion' && defaultEndpoint ? {endpoint: defaultEndpoint} : {})};
  const kind = entry.kind ?? (entry.provider || entry.endpoint ? 'completion' : defaultKind);
  if (kind === 'omp') return {id: entry.model, kind, model: entry.model};
  const name = entry.provider ?? 'openference';
  const provider = providers[name];
  if (!provider && !entry.endpoint) throw new Error(`the chain entry names the unknown provider ${JSON.stringify(name)}; configure it under llmProviders`);
  const model = entry.model ?? provider.model;
  const endpoint = entry.endpoint ?? provider.baseUrl;
  return {id: `${name}/${model}`, kind: 'completion', provider: name, model, endpoint, timeoutMs: (provider?.timeoutSeconds ?? 120) * 1000, maxTokens: provider?.maxTokens ?? 4000,
    apiKeyEnv: provider?.apiKeyEnv ?? null, extraBody: provider ? noThinking(provider) : {}};
}

/** Whether the provider's endpoint answers (the proxy has `GET /health` beside `/v1`; other endpoints are asked for `/models`). */
export async function providerReadiness(endpoint, {fetchImpl = globalThis.fetch, timeoutMs = 2000} = {}) {
  const base = String(endpoint).replace(/\/+$/, '');
  const origin = base.replace(/\/v1$/, '');
  for (const url of [`${origin}/health`, `${base}/models`]) {
    try { if ((await fetchImpl(url, {signal: AbortSignal.timeout(timeoutMs)})).ok) return {available: true}; } catch { /* next probe */ }
  }
  return {available: false, reason: `the LLM endpoint ${base} is not reachable (for the openference proxy start it with: node LLMAPIProvider/server.mjs)`};
}

/**
 * One single-turn chat call through a provider entry, for components that need plain text (answer phrasing, judges, labellers).
 * Returns `{ok, text, usage, ms, model, reason?}`; never throws on a provider failure.
 */
export async function providerChat({system, prompt, provider = 'openference', config = {}, model = null, timeoutMs = null, maxTokens = null, fetchImpl = globalThis.fetch} = {}) {
  const providers = providerSettings(config);
  const entry = chainEntry({provider, ...(model ? {model} : {})}, {providers});
  const base = entry.endpoint.replace(/\/+$/, '');
  const started = Date.now();
  const key = entry.apiKeyEnv ? process.env[entry.apiKeyEnv] : null;
  try {
    const response = await fetchImpl(`${base}/chat/completions`, {method: 'POST', headers: {'content-type': 'application/json', ...(key ? {authorization: `Bearer ${key}`} : {})},
      body: JSON.stringify({model: entry.model, messages: [...(system ? [{role: 'system', content: system}] : []), {role: 'user', content: prompt}], temperature: 0, max_tokens: maxTokens ?? entry.maxTokens, stream: false, ...entry.extraBody}),
      signal: AbortSignal.timeout(timeoutMs ?? entry.timeoutMs)});
    const raw = await response.text();
    let body = null;
    try { body = JSON.parse(raw); } catch { /* reported below */ }
    if (!response.ok || !body) return {ok: false, text: '', ms: Date.now() - started, model: entry.id, reason: `the endpoint answered ${response.status}: ${raw.slice(0, 200)}`};
    const text = String(body.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    return {ok: Boolean(text), text, ms: Date.now() - started, model: entry.id, usage: body.usage ?? {}, ...(text ? {} : {reason: 'the reply is empty'})};
  } catch (error) {
    return {ok: false, text: '', ms: Date.now() - started, model: entry.id, reason: error.name === 'TimeoutError' ? 'the endpoint timed out' : `the endpoint could not be reached: ${error.message}`};
  }
}
