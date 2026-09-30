/** The message-only request of a fine-tuned formalizer served by llama.cpp `llama-server` (DS021, DS012).
 *
 * One function shared by the evaluation harness (`tools/research/predict-endpoint.mjs`) and the chat server
 * (`server/formalizers.mjs`), so a chat answer is produced exactly as the evaluated predictions were: the user's
 * message as the only user content, the checkpoint's own chat template (`llama-server --jinja`), greedy decoding
 * (temperature 0, top_k 1), the model's own end-of-turn tokens as the only stop condition (no extra `stop`
 * strings) and no system prompt or context block. An optional llama.cpp GBNF `grammar` (tools/sop-gbnf.mjs, the
 * SOP model surface) constrains decoding; it adds no model input. Without it the request is unchanged. `cachePrompt:
 * false` turns off llama-server's prompt cache, so a greedy output does not depend on the previous requests of a slot.
 */

/** Greedy chat-completion request body for one message. */
export const messageRequest = (message, maxTokens, grammar = null, cachePrompt = undefined) => ({messages: [{role: 'user', content: message}], temperature: 0, top_k: 1, max_tokens: maxTokens, stream: false, ...(grammar ? {grammar} : {}), ...(cachePrompt === false ? {cache_prompt: false} : {})});

/**
 * Sends `message` to the endpoint whose base URL is `url` and returns
 * `{text, finish, ms, usage, timings, raw?}`. `finish` is `length` for a truncated generation.
 */
export async function predictMessage(url, message, {maxTokens = 1024, timeoutMs = 300000, grammar = null, cachePrompt = undefined} = {}) {
  return complete(url, messageRequest(message, maxTokens, grammar, cachePrompt), timeoutMs);
}

/**
 * A plain chat completion for the chat page's Chat and Translate modes (DS012 "Chat modes"), served by an
 * unmodified base instruct model: `messages` as given (system, user and assistant turns), the model's own chat
 * template, `temperature` 0 means greedy (top_k 1). Never used for formalization, whose request is `predictMessage`.
 * Returns `{text, finish, ms, usage, timings, raw?}`.
 */
export async function chatMessages(url, messages, {temperature = 0.7, topP = 0.9, maxTokens = 512, timeoutMs = 300000, extra = {}} = {}) {
  const sampling = temperature > 0 ? {temperature, top_p: topP} : {temperature: 0, top_k: 1};
  // `extra`: further request fields such as llama-server's `chat_template_kwargs` (a reasoning model's `enable_thinking: false`).
  return complete(url, {messages, ...sampling, max_tokens: maxTokens, stream: false, ...extra}, timeoutMs);
}

async function complete(url, request, timeoutMs) {
  const started = performance.now();
  const response = await fetch(new URL('/v1/chat/completions', url), {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const body = await response.text();
    // llama-server can reject a finished generation while parsing it as chat syntax ("Failed to parse input");
    // the same request then goes through the raw endpoint with the model's own chat template.
    if (response.status === 500 && body.includes('Failed to parse input')) return completeRaw(url, request, started, timeoutMs);
    throw Error(`Endpoint returned ${response.status}: ${body.slice(0, 300)}`);
  }
  const data = await response.json();
  const choice = data.choices?.[0];
  if (typeof choice?.message?.content !== 'string') throw Error('Missing generated text');
  return {text: choice.message.content, finish: choice.finish_reason, ms: performance.now() - started, usage: data.usage ?? null, timings: data.timings ?? null};
}

async function completeRaw(url, {messages, max_tokens: maxTokens, stream, ...sampling}, started, timeoutMs) {
  const post = async (route, body) => {
    const response = await fetch(new URL(route, url), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs)});
    if (!response.ok) throw Error(`Endpoint ${route} returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
    return response.json();
  };
  const {prompt} = await post('/apply-template', {messages});
  const data = await post('/completion', {prompt, ...sampling, n_predict: maxTokens, stream: false});
  return {text: data.content, finish: data.stop_type === 'limit' ? 'length' : 'stop', ms: performance.now() - started, raw: true,
    usage: {prompt_tokens: data.tokens_evaluated, completion_tokens: data.tokens_predicted}, timings: data.timings ?? null};
}
