/**
 * textToCleanEnglish backend `translator-llm` (owner decision 2026-10-01, journaled): Qwen3-4B-Instruct-2507 Q4_K_M, the base instruct model
 * (never trained here), translating ONE Romanian or mixed sentence into English per request. It replaces LanguageProofingLLM (prod1) for
 * non-English sentences: on the owner's 425 natural sentences it keeps the meaning on 64.9% against 10.6% for prod1
 * (`eval/reports/current/translate-compare/summary.md`, arm `qwen3-4b-q4`, judged by Grok and GLM, worse of the two).
 *
 * The request is the prompt of that winning arm (`tools/eval/translate-compare/llm-translate.mjs`, plain variant: the jargon-quoting variant gave no
 * gain): a system instruction and the sentence as the user message, greedy decoding, thinking switched off, at most 3 tokens per word plus 60.
 * The reply is the whole answer; a think block is dropped. The user still validates the result in the chat before anything is formalized.
 */
import {chatMessages} from '../../llama-chat.mjs';
import {stripThinking} from './llm.mjs';

/** The system prompt of the translate-compare arm `qwen3-4b-q4` (verbatim). */
export const TRANSLATE_SYSTEM_PROMPT = 'Translate the user message into English. The message is Romanian (often without diacritics, with typos, run-on sentences and English or project words mixed in), written by a software developer to an AI assistant. Keep the meaning exactly; do not answer it, do not add or drop anything, do not explain. Keep file names, code, identifiers and English words as written. Output only the English translation.';

const wordCount = text => (String(text).match(/\S+/g) ?? []).length;
/** The digit runs of a text, which a translation must keep. */
const digits = text => [...String(text).matchAll(/\d+(?:[.,]\d+)*/g)].map(match => match[0]);

export function createTranslatorBackend({url, systemPrompt = TRANSLATE_SYSTEM_PROMPT, timeoutMs = 120000, maxTokens = null} = {}) {
  if (!url) throw Error('textToCleanEnglish translator-llm backend needs options.url (a chat-completion endpoint)');
  return {
    name: 'translator-llm',
    async clean(message) {
      const text = String(message);
      const reply = await chatMessages(url, [{role: 'system', content: systemPrompt}, {role: 'user', content: text}],
        {temperature: 0, topP: 1, maxTokens: maxTokens ?? Math.min(700, wordCount(text) * 3 + 60), timeoutMs, extra: {chat_template_kwargs: {enable_thinking: false}}});
      const out = stripThinking(reply.text);
      const kept = digits(text).every(number => out.includes(number));
      return {text: out, confidence: kept ? 0.8 : 0.5, translated: true, placeholders_preserved: kept, ms: Math.round(reply.ms), tokens: reply.usage?.completion_tokens ?? null};
    },
  };
}
