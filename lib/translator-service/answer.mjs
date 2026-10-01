/**
 * TranslatorService, output edge (owner decision 2026-10-01, DS021 "English-only core"): the core reasons and renders in English
 * only; when the caller asks for another answer language (the API `language` or an explicit request in the message) the FINAL
 * rendered English answer is translated here, once, from English. Nothing before this step knows the language.
 *
 * The translation backend is the translator model of textToCleanEnglish (registry id `translator-llm`, a chat-completion endpoint),
 * asked for English to the target language. Names, numbers with their units, quoted values and SOP identifiers are masked by
 * placeholders before the call and restored after it (`lib/ud-to-sop/protect.mjs`), so the model cannot translate, misspell or
 * invent them; a reply that loses or duplicates a placeholder is retried once and then reported, never passed on as a translation.
 * `translateAnswer` returns `{text, original, language, backend, placeholders, ms}` or throws an Error with
 * `.code = 'backend_unavailable'`. The caller records the step (backend, the original English text) in the packet.
 *
 * The answer is translated per line and per sentence (each segment masked on its own), with a bounded number of parallel calls and a total
 * time budget (`budgetMs`, default 20 s, under the server's 30 s request limit): a text that does not finish in the budget is not partly
 * translated; the call fails with `.code = 'budget_exhausted'` and the caller keeps the English answer with the failure flagged.
 */
import {chatMessages} from '../llama-chat.mjs';
import {protect, restore} from '../ud-to-sop/protect.mjs';

/** Answer languages other than English the product can translate into, with the name used in the instruction. */
export const TARGET_LANGUAGES = Object.freeze({ro: 'Romanian'});

const SYSTEM = language => `Translate the user message from English into ${language}. Keep every placeholder token such as Ent1, Num2, Quote1 or Id1 exactly as written, once each, in the place the translation needs. Do not translate, explain or add anything. Reply with the translation only.`;

/** SOP identifiers in a rendered answer (snake_case symbols, `$id`, `?variable` and `@id` references) become `Id<n>` placeholders. */
function maskIdentifiers(text, slots) {
  return text.replace(/(?<![\p{L}\p{N}_])(?:[$?@][A-Za-z_]\w*|[a-z][a-z0-9]*(?:_[a-z0-9]+)+|[QPL]\d+)(?![\p{L}\p{N}_])/gu, match => {
    const key = 'Id' + (slots.filter(s => s.kind === 'Id').length + 1);
    slots.push({kind: 'Id', key, value: match});
    return key;
  });
}

const stripThinking = text => String(text).replace(/<think>[\s\S]*?<\/think>/g, '').trim();
const backendUnavailable = message => Object.assign(new Error(message), {code: 'backend_unavailable'});

const SEGMENT_LIMIT = 280;

/** Split an English answer into the segments translated one by one: its lines, and the sentences of a long line. Returns [{text, join}] where `join` follows the segment. */
export function segmentsOf(text) {
  const out = [];
  const lines = String(text).split('\n');
  lines.forEach((line, index) => {
    const tail = index < lines.length - 1 ? '\n' : '';
    const parts = line.length > SEGMENT_LIMIT ? line.split(/(?<=[.!?])\s+(?=[\p{Lu}"(])/u) : [line];
    parts.forEach((part, i) => out.push({text: part, join: i < parts.length - 1 ? ' ' : tail}));
  });
  return out;
}

/** One segment through the model: masked, translated, restored; one retry when a protected value is lost. */
async function translateSegment(segment, name, endpoint, chat, deadline, timeoutMs) {
  const masked = protect(segment);
  const slots = masked.slots;
  const maskedText = maskIdentifiers(masked.text, slots);
  const words = (maskedText.match(/\S+/g) ?? []).length;
  let lastLoss = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw Object.assign(new Error('TranslatorService: the time budget for the translation is used up'), {code: 'budget_exhausted'});
    let reply;
    try {
      reply = await chat(endpoint, [{role: 'system', content: SYSTEM(name)}, {role: 'user', content: maskedText}],
        {temperature: 0, topP: 1, maxTokens: Math.min(900, words * 4 + 80), timeoutMs: Math.min(timeoutMs, remaining), extra: {chat_template_kwargs: {enable_thinking: false}}});
    } catch (error) {
      if (Date.now() >= deadline) throw Object.assign(new Error('TranslatorService: the time budget for the translation is used up'), {code: 'budget_exhausted'});
      throw backendUnavailable(`TranslatorService: the translator model failed: ${error.message}`);
    }
    const out = stripThinking(reply.text);
    if (!out) throw backendUnavailable('TranslatorService: the translator model returned no text');
    const restored = restore(out, slots);
    if (restored.preserved) return {text: restored.text, placeholders: slots.length, ms: Math.round(reply.ms ?? 0)};
    lastLoss = {dropped: restored.dropped ?? [], duplicated: restored.duplicated ?? []};
  }
  throw backendUnavailable(`TranslatorService: the translation lost or duplicated protected values (${JSON.stringify(lastLoss)})`);
}

/**
 * Translate the English `text` into `language` (a key of `TARGET_LANGUAGES`). `options`: `url` (the chat-completion endpoint, or a
 * function returning it, sync or async), `chat` (a test seam, default `chatMessages`), `budgetMs` (total time, default 20000),
 * `concurrency` (parallel segment calls, default 2).
 */
export async function translateAnswer(text, language, {url, chat = chatMessages, timeoutMs = 120000, budgetMs = 20000, concurrency = 2} = {}) {
  const name = TARGET_LANGUAGES[language];
  if (!name) throw Object.assign(new Error(`TranslatorService: no translation into "${language}" (known: ${Object.keys(TARGET_LANGUAGES).join(', ')})`), {code: 'unsupported_language'});
  const original = String(text ?? '');
  if (!original.trim()) return {text: original, original, language, backend: 'none', placeholders: 0, ms: 0};
  const deadline = Date.now() + budgetMs;
  let endpoint;
  try { endpoint = typeof url === 'function' ? await url() : url; } catch (error) { throw backendUnavailable(`TranslatorService: the translator model cannot start: ${error.message}`); }
  if (!endpoint) throw backendUnavailable('TranslatorService: no translator model endpoint is available');
  const segments = segmentsOf(original);
  const results = new Array(segments.length);
  let next = 0, failure = null;
  const worker = async () => {
    while (!failure && next < segments.length) {
      const index = next++;
      const segment = segments[index];
      if (!segment.text.trim()) { results[index] = {text: segment.text, placeholders: 0, ms: 0}; continue; }
      try { results[index] = await translateSegment(segment.text, name, endpoint, chat, deadline, timeoutMs); } catch (error) { failure ??= error; }
    }
  };
  await Promise.all(Array.from({length: Math.max(1, Math.min(concurrency, segments.length))}, worker));
  if (failure) throw failure;
  return {text: segments.map((s, i) => results[i].text + s.join).join(''), original, language, backend: 'translator-llm', placeholders: results.reduce((n, r) => n + r.placeholders, 0),
    segments: segments.length, ms: results.reduce((n, r) => n + r.ms, 0)};
}
