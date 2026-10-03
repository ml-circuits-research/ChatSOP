/**
 * Remote LLM providers (owner decisions 2026-10-02: the openference plan's `Qwen3.8 27b` through the local proxy LLMAPIProvider is
 * the default model; every formalization calls the model directly through that proxy, never through omp). One configured endpoint per
 * provider (`llmProviders` of config/runtime.json) is used by every component that needs a remote model through the OpenAI-compatible
 * `completion` backend: the answer-language step, knowledge authoring and the evaluation tools (the step-by-step formalizer names proxy tiers).
 *
 *   openference  the proxy's default upstream (`/v1`), Qwen3.8 27b on the plan
 *   openrouter   the proxy's OpenRouter upstream (`/u/openrouter/v1`), DeepSeek flash, paid per token
 *   local        the proxy's local upstream (`/u/local/v1`), the always-on local model of tier `tiny` (Qwen3.6-35B-A3B since 2026-10-03); reported unreachable until the proxy serves it
 *
 * A chain entry is a model tier of the proxy (`tiny`, `small`, `medium`, `good`, `best`: owner 2026-10-02, tiny = local 4B, small =
 * openference Qwen3.8 27b, medium = DeepSeek v4 flash, good = DeepSeek v4.1 flash; the proxy serves the tier and falls back down the
 * tier's own chain, reporting the model it used in `x-llmapiprovider-model`), a string `<provider>/<model>` (the provider a configured
 * name, the model the rest: `openrouter/deepseek/deepseek-v4-flash`), a bare provider name (its configured model), or an object
 * `{provider?, model?, endpoint?}`; `chainEntry` resolves it to `{id, kind: 'completion', provider, model, endpoint, headers, extraBody,
 * tier?}`. For a concrete model the proxy's own fallback is switched off per request (`proxyFallback: false`, header
 * `x-llmapiprovider-no-fallback`): the chain is explicit and every switch is recorded by the caller.
 * An unreachable provider is reported by `providerReadiness` with the reason; callers skip the entry and record why (never a silent substitution).
 */
export const DEFAULT_PROVIDERS = Object.freeze({
  openference: Object.freeze({baseUrl: 'http://127.0.0.1:18080/v1', model: 'Qwen3.8 27b', requestsPerMinute: 15, timeoutSeconds: 120, maxTokens: 4000, thinking: false, proxyFallback: false}),
  openrouter: Object.freeze({baseUrl: 'http://127.0.0.1:18080/u/openrouter/v1', model: 'deepseek/deepseek-v4-flash', timeoutSeconds: 120, maxTokens: 4000, thinking: false, proxyFallback: false}),
  local: Object.freeze({baseUrl: 'http://127.0.0.1:18080/u/local/v1', model: 'Qwen3.6-35B-A3B', timeoutSeconds: 120, maxTokens: 1500, thinking: false, proxyFallback: false}),
});
/** Earlier names of the proxy provider in model chains (the omp overlay called it `llmapiprovider`). */
export const PROVIDER_ALIASES = Object.freeze({llmapiprovider: 'openference'});
/** The model tiers the proxy serves on its default path (`model: "<tier>"`). */
export const TIERS = Object.freeze(['supertiny', 'tiny', 'small', 'medium', 'good', 'best']);

/** The providers: the defaults merged with `config.llmProviders`. */
export function providerSettings(config = {}) {
  const out = {};
  for (const name of new Set([...Object.keys(DEFAULT_PROVIDERS), ...Object.keys(config.llmProviders ?? {})])) out[name] = {...DEFAULT_PROVIDERS[name], ...(config.llmProviders?.[name] ?? {})};
  return out;
}

const noThinking = provider => provider.thinking === false ? {chat_template_kwargs: {enable_thinking: false}} : {};

/** The object form of a string chain entry: `<provider>/<model>` or a bare provider name; an unknown provider is the default provider's model id. */
export function parseEntry(text, providers = providerSettings()) {
  if (TIERS.includes(text)) return {provider: 'openference', model: text, tier: text};
  const slash = text.indexOf('/');
  const head = slash < 0 ? text : text.slice(0, slash);
  const name = PROVIDER_ALIASES[head] ?? head;
  if (providers[name]) return {provider: name, ...(slash < 0 ? {} : {model: text.slice(slash + 1)})};
  return {provider: 'openference', model: text};
}

/** Resolves one chain entry to a completion endpoint (every model is called directly; there is no agentic backend). */
export function chainEntry(entry, {providers = providerSettings()} = {}) {
  if (typeof entry === 'string') entry = parseEntry(entry, providers);
  if (entry.kind && entry.kind !== 'completion') throw new Error(`the chain entry kind ${JSON.stringify(entry.kind)} is not supported; models are called directly (completion)`);
  const name = PROVIDER_ALIASES[entry.provider] ?? entry.provider ?? 'openference';
  const provider = providers[name];
  if (!provider && !entry.endpoint) throw new Error(`the chain entry names the unknown provider ${JSON.stringify(name)}; configure it under llmProviders`);
  const model = entry.model ?? provider.model;
  const endpoint = entry.endpoint ?? provider.baseUrl;
  const tier = entry.tier ?? null;
  return {id: tier ?? `${name}/${model}`, kind: 'completion', provider: name, model, endpoint, timeoutMs: (entry.timeoutSeconds ?? provider?.timeoutSeconds ?? 120) * 1000, maxTokens: entry.maxTokens ?? provider?.maxTokens ?? 4000,
    apiKeyEnv: provider?.apiKeyEnv ?? null, extraBody: {...(provider ? noThinking(provider) : {}), ...(entry.extraBody ?? {})}, headers: {...(!tier && provider?.proxyFallback === false ? {'x-llmapiprovider-no-fallback': '1'} : {}), ...(entry.headers ?? {})}, ...(tier ? {tier} : {})};
}

/**
 * Whether the provider's endpoint answers (the proxy has `GET /health` beside `/v1`; other endpoints are asked for `/models`). A proxy
 * upstream route (`<proxy>/u/<upstream>/v1`) is ready when the proxy's `/health` lists that upstream with a configured key; a `tier` is
 * ready when the proxy's `/health` lists it under `tiers` (names, or model objects `{id, x_tier}` without an `error`, or an object
 * keyed by name whose value is not `{usable: false}`). A proxy that does not list tiers yet makes a tier entry unavailable, so the concrete entries after it run.
 */
export async function providerReadiness(endpoint, {fetchImpl = globalThis.fetch, timeoutMs = 2000, tier = null} = {}) {
  const base = String(endpoint).replace(/\/+$/, '');
  if (tier) {
    const origin = base.replace(/\/v1$/, '');
    // Two attempts: a probe can time out while the caller's own event loop is busy (a base memory loading synchronously), not the proxy.
    for (const wait of [timeoutMs, timeoutMs * 3]) {
      try {
        const response = await fetchImpl(`${origin}/health`, {signal: AbortSignal.timeout(wait)});
        const body = response.ok ? await response.json().catch(() => null) : null;
        const tiers = body?.tiers;
        // `tiers`: names, or model objects `{id, x_tier: {serves, fallback} | {error}}` (the proxy's listing), or an object keyed by name.
        const item = Array.isArray(tiers) ? tiers.find(t => t === tier || t?.id === tier) : tiers?.[tier];
        const listed = Boolean(item) && !(item.x_tier?.error || item.error || item.usable === false);
        if (listed) return {available: true};
        if (body) return {available: false, reason: tiers ? `the proxy has no usable tier ${tier}` : `the proxy at ${origin} does not serve model tiers yet`};
      } catch { /* retried, then reported below */ }
    }
    return {available: false, reason: `the LLM proxy ${origin} is not reachable (start it with: node LLMAPIProvider/server.mjs)`};
  }
  const route = /^(.*)\/u\/([A-Za-z0-9_-]+)\/v1$/.exec(base);
  if (route) {
    try {
      const response = await fetchImpl(`${route[1]}/health`, {signal: AbortSignal.timeout(timeoutMs)});
      const body = response.ok ? await response.json().catch(() => null) : null;
      const upstream = body?.upstreams?.[route[2]];
      if (upstream?.key_configured) return {available: true};
      if (body) return {available: false, reason: upstream ? `the proxy upstream ${route[2]} has no key configured` : `the proxy at ${route[1]} has no upstream ${route[2]}`};
    } catch { /* reported below */ }
    return {available: false, reason: `the LLM proxy ${route[1]} is not reachable (start it with: node LLMAPIProvider/server.mjs)`};
  }
  const origin = base.replace(/\/v1$/, '');
  for (const url of [`${origin}/health`, `${base}/models`]) {
    try { if ((await fetchImpl(url, {signal: AbortSignal.timeout(timeoutMs)})).ok) return {available: true}; } catch { /* next probe */ }
  }
  return {available: false, reason: `the LLM endpoint ${base} is not reachable (for the openference proxy start it with: node LLMAPIProvider/server.mjs)`};
}

/**
 * One single-turn chat call through a provider entry, for components that need plain text (answer phrasing, judges, labellers).
 * Returns `{ok, text, usage, ms, model, reason?}`; never throws on a provider failure. `purpose` tags the call for the proxy's accounting
 * (header `x-llmapiprovider-purpose`).
 */
export async function providerChat({system, prompt, provider = 'openference', config = {}, model = null, timeoutMs = null, maxTokens = null, purpose = null, fetchImpl = globalThis.fetch} = {}) {
  const providers = providerSettings(config);
  // `provider` may be a model tier of the proxy (`small`, `medium`, ...): the proxy serves it with the tier's own fallback chain.
  const entry = chainEntry(TIERS.includes(provider) && !model ? provider : {provider, ...(model ? {model} : {})}, {providers});
  const base = entry.endpoint.replace(/\/+$/, '');
  const started = Date.now();
  const key = entry.apiKeyEnv ? process.env[entry.apiKeyEnv] : null;
  try {
    const response = await fetchImpl(`${base}/chat/completions`, {method: 'POST', headers: {'content-type': 'application/json', ...entry.headers, ...(purpose ? {'x-llmapiprovider-purpose': purpose} : {}), ...(key ? {authorization: `Bearer ${key}`} : {})},
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
