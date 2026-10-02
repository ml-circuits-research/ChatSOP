/**
 * The completion backend: any OpenAI-compatible chat endpoint (llama-server, OpenRouter, a vendor API) used as a plain text
 * completion. The model has no tools and no folder; it receives the same context (system message with the rules, the guide and the
 * vocabulary; the request as data) and answers with the content of `query.sop`. A repair round appends the previous answer and the
 * validator's output to the conversation. Greedy by default (temperature 0). `cache_prompt` is sent by default (llama-server reuses the
 * shared prompt prefix; other OpenAI-compatible endpoints ignore it); `cachePrompt: false` gives cold-cache timing measurements.
 */
const strip = text => String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*$/g, '').trim();

/** The query.sop text of a model reply: the first code block that holds a wire, else everything from the first wire line. */
export function extractSop(reply) {
  const text = strip(reply);
  for (const m of text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)) if (/^\s*@\w+\s+\w+/m.test(m[1])) return m[1].trim();
  const start = text.search(/^@\w+\s+\w+/m);
  return start >= 0 ? text.slice(start).replace(/```[\s\S]*$/, '').trim() : '';
}

export function completionBackend({endpoint, model, apiKey = null, apiKeyEnv = null, timeoutMs = 120_000, maxTokens = 1500, temperature = 0, cachePrompt = true, extraBody = {}, headers = {}, request = null, fetchImpl = globalThis.fetch, env = process.env} = {}) {
  if (!endpoint || !model) throw new Error('the completion backend needs an endpoint and a model');
  const base = endpoint.replace(/\/+$/, '');
  const url = /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';
  const replies = new WeakMap();
  return {
    id: 'completion', kind: 'completion', model, endpoint: base,
    async generate({context, history = []}) {
      const adapted = request ? request({context, history}) : null;
      const messages = [{role: 'system', content: adapted?.system ?? context.system}, {role: 'user', content: adapted?.user ?? context.user}];
      const previous = replies.get(context) ?? new Map();
      for (const turn of history) messages.push({role: 'assistant', content: previous.get(turn.sop) ?? turn.sop}, {role: 'user', content: context.repair(turn.problems) + (adapted ? '\nUse the constrained output format of this request.' : '')});
      const started = Date.now();
      const key = apiKey ?? (apiKeyEnv ? env[apiKeyEnv] : null);
      let response;
      try {
        response = await fetchImpl(url, {method: 'POST', headers: {'content-type': 'application/json', ...(key ? {authorization: `Bearer ${key}`} : {}), ...headers},
          body: JSON.stringify({model, messages, temperature, max_tokens: maxTokens, stream: false, ...(cachePrompt ? {cache_prompt: true} : {}), ...extraBody, ...adapted?.extraBody}), signal: AbortSignal.timeout(timeoutMs)});
      } catch (error) {
        return {ok: false, sop: '', usage: {}, duration_ms: Date.now() - started, reason: error.name === 'TimeoutError' ? `the endpoint exceeded the ${Math.round(timeoutMs / 1000)} s limit` : `the endpoint could not be reached: ${error.message}`};
      }
      const raw = await response.text();
      let body = null;
      try { body = JSON.parse(raw); } catch { /* reported below */ }
      if (!response.ok || !body) return {ok: false, sop: '', usage: {}, duration_ms: Date.now() - started, reason: `the endpoint answered ${response.status}: ${raw.slice(0, 200)}`};
      const usage = {turns: 1, input_tokens: body.usage?.prompt_tokens ?? 0, output_tokens: body.usage?.completion_tokens ?? 0, cache_read_tokens: body.usage?.prompt_tokens_details?.cached_tokens ?? 0, cost_usd: Number(body.usage?.cost ?? 0) || 0};
      const reply = body.choices?.[0]?.message?.content ?? '';
      const report = adapted ? JSON.stringify({format: 'constrained-author-output-v1', raw: reply}) : undefined;
      let sop;
      try { sop = adapted ? adapted.decode(reply) : extractSop(reply); }
      catch (error) {
        return {ok: false, sop: '', raw: reply, report, usage, duration_ms: Date.now() - started, reason: `constrained circuit rejected: ${error.message}`};
      }
      previous.set(sop, reply);
      replies.set(context, previous);
      return {ok: true, sop, raw: reply, ...(report ? {report} : {}), usage, duration_ms: Date.now() - started, ...(sop ? {} : {reason: 'the reply holds no wire'})};
    },
  };
}
