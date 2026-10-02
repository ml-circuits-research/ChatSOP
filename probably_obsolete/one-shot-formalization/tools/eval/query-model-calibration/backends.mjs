/**
 * Backends of the calibration around lib/query-author: the completion backend on a local llama-server (keeping its `timings`) and on a
 * remote model behind the proxy (`remoteBackend`). The omp backends are archived in probably_obsolete/omp/calibration-omp-backends.mjs.
 */
import {completionBackend} from '../../../lib/query-author/index.mjs';
import {chainEntry} from '../../../lib/llm-providers.mjs';

/** A model behind the proxy (`<provider>/<model>`, lib/llm-providers.mjs) through the completion backend; the wall time is the model time (no start-up). */
export function remoteBackend({model, timeoutMs = 180_000, maxTokens = 1500}) {
  const e = chainEntry(model);
  const inner = completionBackend({endpoint: e.endpoint, model: e.model, headers: e.headers, extraBody: e.extraBody, timeoutMs, maxTokens, cachePrompt: false});
  return {...inner, async generate(args) {
    const out = await inner.generate(args);
    out.timing = {wall_ms: out.duration_ms, model_ms: out.duration_ms, startup_ms: 0, model_turns: 1};
    return out;
  }};
}

/** The completion backend against a llama-server; `timings` of every reply are pushed on `sink` (prompt and generation ms and tokens). */
export function localBackend({endpoint, model, extraBody = {}, sink, timeoutMs = 600_000, maxTokens = 1500}) {
  const fetchImpl = async (url, init) => {
    const response = await fetch(url, init);
    const copy = response.clone();
    copy.json().then(b => sink.push({...(b.timings ?? {}), completion_tokens: b.usage?.completion_tokens, prompt_tokens: b.usage?.prompt_tokens, finish: b.choices?.[0]?.finish_reason})).catch(() => {});
    return response;
  };
  const inner = completionBackend({endpoint, model, extraBody: {cache_prompt: true, ...extraBody}, fetchImpl, timeoutMs, maxTokens});
  return {...inner, async generate(args) {
    const n = sink.length;
    const out = await inner.generate(args);
    await new Promise(r => setTimeout(r, 20));
    const t = sink.slice(n).at(-1) ?? {};
    out.timing = {wall_ms: out.duration_ms, prompt_ms: t.prompt_ms ?? null, gen_ms: t.predicted_ms ?? null, prompt_tokens: t.prompt_n ?? t.prompt_tokens ?? null, cached_tokens: t.cache_n ?? null, gen_tokens: t.predicted_n ?? t.completion_tokens ?? null, gen_tps: t.predicted_per_second ?? null, finish: t.finish ?? null};
    return out;
  }};
}
