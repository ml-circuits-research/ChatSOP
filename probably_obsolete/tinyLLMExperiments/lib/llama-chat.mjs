/** The llama.cpp chat-completion client of the product's served models (DS012, DS021).
 *
 * `predictMessage` is the message-only request of every served model (LanguageProofingLLM, SymbolicProofingLLM, SymbolicLM
 * and the translator): the user's message as the only user content, the checkpoint's own chat template
 * (`llama-server --jinja`), greedy decoding (temperature 0, top_k 1), the model's own end-of-turn tokens as the only stop
 * condition and no system prompt or context block. `cachePrompt: false` turns off llama-server's prompt cache, so a greedy
 * output does not depend on the previous requests of a slot. `chatMessages` is the general messages call (a system
 * instruction, as the translator prompt needs). Evaluation tools that constrain decoding pass their own request fields
 * through `extra`; the product client has no grammar code.
 */

/** Greedy chat-completion request body for one message. */
export const messageRequest = (message, maxTokens, cachePrompt = undefined) => ({messages: [{role: 'user', content: message}], temperature: 0, top_k: 1, max_tokens: maxTokens, stream: false, ...(cachePrompt === false ? {cache_prompt: false} : {})});

/**
 * Sends `message` to the endpoint whose base URL is `url` and returns
 * `{text, finish, ms, usage, timings, raw?}`. `finish` is `length` for a truncated generation.
 */
export async function predictMessage(url, message, {maxTokens = 1024, timeoutMs = 300000, cachePrompt = undefined, extra = null} = {}) {
  // `extra`: host options for a local service such as SymbolicLM (`symbolic_lm`, DS012 "Understanding in the chat") or an
  // evaluation tool's decoding constraint; they are request fields beside `messages`, never part of the message.
  return complete(url, {...messageRequest(message, maxTokens, cachePrompt), ...(extra ?? {})}, timeoutMs);
}

/**
 * A chat completion with the messages as given (system, user and assistant turns), the model's own chat template;
 * `temperature` 0 means greedy (top_k 1). Returns `{text, finish, ms, usage, timings, raw?}`.
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
  return {text: choice.message.content, finish: choice.finish_reason, ms: performance.now() - started, usage: data.usage ?? null, timings: data.timings ?? null, ...(data.symbolic_lm ? {symbolic_lm: data.symbolic_lm} : {})};
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
