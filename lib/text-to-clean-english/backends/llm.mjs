/**
 * textToCleanEnglish backend `llm` (the model is LanguageProofingLLM; currently Qwen3-1.7B): a chat-completion endpoint (a local llama-server GGUF model such as
 * Qwen3-1.7B, `models/proofing/gguf/qwen3-1.7b-q8_0.gguf`, or any OpenAI-compatible server), one fixed system
 * instruction, greedy decoding, no history — the same request shape `lib/formalizer-endpoint.mjs` `chatMessages`
 * uses for the chat page's own Chat and Translate modes (DS012). This is the only backend that proofreads,
 * translates and simplifies in one pass, so it is the recommended choice for Romanian and mixed text; it is also
 * the only backend of this service with a nonzero hallucination risk (survey `clean-english-candidates-v1`), so
 * names, quoted spans and numbers are masked first with `lib/ud-to-sop/protect.mjs` and restored afterward, the
 * same protection `languagetool.mjs` and the research translator backends use.
 */
import {chatMessages} from '../../formalizer-endpoint.mjs';
import {protect, restore} from '../../ud-to-sop/protect.mjs';
import {resources} from '../gate.mjs';

export const DEFAULT_SYSTEM_PROMPT = 'Rewrite the user message in clean, simple, grammatical English. '
  + 'If the message is Romanian or mixes Romanian and English, translate all of it into English. Fix spelling and grammar mistakes. '
  + 'Keep every placeholder of the form Ent1, Num1, Quote1 (with its number) exactly as written, in the same positions; never translate or alter a placeholder. '
  + 'Keep the meaning exactly the same: do not add, remove or guess any fact, name, number or question, and do not answer the message. '
  + 'Output only the rewritten message, nothing else. '
  + 'Examples: "Ent1 e șeful lui Ent2, nu?" becomes "Is Ent1 the boss of Ent2?"; "unde lucreaza Ent1 si cand incepe Ent2" becomes "Where does Ent1 work, and when does Ent2 start?"; "who is teh boss of Ent1" becomes "Who is the boss of Ent1?".';

/** A reasoning model may prefix its answer with an (empty) think block; only the answer is the rewrite. */
export const stripThinking = text => String(text).replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\/?think>/g, '').trim();

export function createLlmBackend({url, maxTokens = 256, timeoutMs = 20000, systemPrompt = DEFAULT_SYSTEM_PROMPT} = {}) {
  if (!url) throw Error('textToCleanEnglish llm backend needs options.url (a chat-completion endpoint)');
  return {
    name: 'llm',
    async clean(message, {language = 'en'} = {}) {
      // In Romanian or mixed text a capitalized sentence opener such as "Verifică" or "Spune-mi" is an ordinary word, not
      // a name: without this the mask would hide it from the model and it would stay untranslated.
      const roWord = language === 'en' ? null : (({lexicons}) => word => word.split('-').every(part => part.length <= 2 || lexicons.has('ro', part)))(resources());
      const {text: masked, slots} = protect(String(message), {isCommon: roWord});
      const reply = await chatMessages(url, [{role: 'system', content: systemPrompt}, {role: 'user', content: masked}], {temperature: 0, topP: 1, maxTokens, timeoutMs, extra: {chat_template_kwargs: {enable_thinking: false}}});
      const restored = restore(stripThinking(reply.text), slots);
      return {text: restored.text, confidence: restored.preserved ? 0.8 : 0.5, translated: true, placeholders_preserved: restored.preserved};
    },
  };
}
