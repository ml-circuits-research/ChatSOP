/**
 * The chat client of ingestion v2: one non-streamed chat completion through LLMAPIProvider by tier name (owner, 2026-10-02: clients
 * name a tier, never a concrete model), tagged with the purpose and the run id, with the plan credits of the call read from the
 * proxy's `x-quota-cost` header (0 for a local or a cached answer) and the model that served it (`x-llmapiprovider-model`, a fallback
 * marked). Never throws on a provider failure; a 429 or 5xx is retried twice with a pause. `fetchImpl` is injectable (LLMJobs passes
 * a fetch that tags the task's run; tests pass a fake).
 */
export const PURPOSE = 'job:ingest-document';
/** Extra request fields per tier: Qwen3.8 27b (small) and the local MoE (tiny) answer without a thinking block. */
const TIER_BODY = {tiny: {chat_template_kwargs: {enable_thinking: false}}, small: {chat_template_kwargs: {enable_thinking: false}}};

const strip = text => String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*$/g, '').trim();

export function tierChat({endpoint = 'http://127.0.0.1:18080', fetchImpl = globalThis.fetch, purpose = PURPOSE, run = null, timeoutMs = 300_000, pauseMs = 5000} = {}) {
  const url = `${String(endpoint).replace(/\/+$/, '').replace(/\/v1$/, '')}/v1/chat/completions`;
  const ledger = {calls: 0, failed: 0, credits: 0, input_tokens: 0, output_tokens: 0, by_tier: {}, fallbacks: 0, cached: 0};
  const chat = async ({tier, messages, maxTokens = 4000, temperature = 0, extraBody = {}}) => {
    const started = Date.now();
    let last = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetchImpl(url, {method: 'POST', headers: {'content-type': 'application/json', ...(purpose ? {'x-llmapiprovider-purpose': purpose} : {}), ...(run ? {'x-llmapiprovider-run': run} : {})},
          body: JSON.stringify({model: tier, messages, max_tokens: maxTokens, temperature, ...(TIER_BODY[tier] ?? {}), ...extraBody}), signal: AbortSignal.timeout(timeoutMs)});
        const raw = await response.text();
        if (!response.ok) {
          last = `the proxy answered ${response.status}: ${raw.slice(0, 200)}`;
          if (response.status === 429 || response.status >= 500) { await new Promise(r => setTimeout(r, pauseMs * (attempt + 1))); continue; }
          break;
        }
        let body = null;
        try { body = JSON.parse(raw); } catch { last = `not JSON: ${raw.slice(0, 120)}`; continue; }
        const choice = body?.choices?.[0];
        if (!choice) { last = `no choice: ${raw.slice(0, 120)}`; continue; }
        const credits = Number(response.headers?.get?.('x-quota-cost') ?? 0) || 0;
        const fallback = response.headers?.get?.('x-llmapiprovider-fallback') ?? null;
        const cached = response.headers?.get?.('x-llmapiprovider-cache') === 'hit';
        const t = (ledger.by_tier[tier] ??= {calls: 0, credits: 0, output_tokens: 0, ms: 0});
        ledger.calls++; t.calls++; ledger.credits += credits; t.credits += credits;
        ledger.input_tokens += body.usage?.prompt_tokens ?? 0; ledger.output_tokens += body.usage?.completion_tokens ?? 0; t.output_tokens += body.usage?.completion_tokens ?? 0; t.ms += Date.now() - started;
        if (fallback) ledger.fallbacks++;
        if (cached) ledger.cached++;
        return {ok: true, text: strip(choice.message?.content), finish: choice.finish_reason ?? null, credits, model: response.headers?.get?.('x-llmapiprovider-model') ?? tier, fallback, ms: Date.now() - started};
      } catch (error) {
        last = error.name === 'TimeoutError' ? `no answer within ${Math.round(timeoutMs / 1000)} s` : error.message;
        await new Promise(r => setTimeout(r, pauseMs));
      }
    }
    ledger.failed++;
    return {ok: false, text: '', reason: last ?? 'the call failed', ms: Date.now() - started};
  };
  return Object.assign(chat, {ledger});
}

/** The JSON object of a reply (fences stripped), or null. */
export function jsonOf(text) {
  const s = strip(text).replace(/```(?:json)?/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}
