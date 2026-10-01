/**
 * textToCleanEnglish backend `llm`: LanguageProofingLLM, the fine-tuned Gemma 3 270M of run
 * language-proofing-gemma270m-prod1 (DS021 "Names, roles and datasets"; report
 * `eval/reports/current/language-proofing-prod1/summary.md`), reached through a chat-completion endpoint (the
 * on-demand CPU llama-server of `server/formalizers.mjs`, registry id `language-proofing-llm`).
 *
 * The request is exactly the training and evaluation request (`tools/eval/language-proofing-eval.mjs`): ONE
 * sentence as the only user message, no system prompt, greedy decoding, the checkpoint's own chat template. The
 * caller (`index.mjs`) splits the message and sends one sentence per call; the model was trained on sentences, not
 * on whole paragraphs. No masking: the model saw raw names, numbers and quotes in training; instead the reply is
 * checked for the digits, quoted spans and multi-word proper names of the input (`protected-names.mjs`): a reply that loses a name is asked once more with the
 * names masked, and a reply that still loses an anchor gets a lower confidence.
 *
 * Generic chat models (for example the research survey's Qwen3-1.7B, `tools/research/text-to-clean-english-backends.mjs`)
 * still work when the caller passes `systemPrompt`: the request then carries that system message, thinking is
 * switched off and names, quotes and numbers are masked with `lib/ud-to-sop/protect.mjs` and restored afterwards,
 * as before. The chat does not use that path.
 */
import {chatMessages} from '../../formalizer-endpoint.mjs';
import {protect, restore} from '../../ud-to-sop/protect.mjs';
import {resources} from '../gate.mjs';
import {guardedNames, maskNames, restoreNames} from '../protected-names.mjs';

/** A reasoning model may prefix its answer with an (empty) think block; only the answer is the rewrite. */
export const stripThinking = text => String(text).replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\/?think>/g, '').trim();

/** The digit runs and quoted spans of a text, which a rewrite must keep. */
const anchors = text => [...String(text).matchAll(/\d+(?:[.,]\d+)*|"[^"]+"|“[^”]+”|„[^”]+”/g)].map(match => match[0]);

export function createLlmBackend({url, maxTokens = 256, timeoutMs = 20000, systemPrompt = null} = {}) {
  if (!url) throw Error('textToCleanEnglish llm backend needs options.url (a chat-completion endpoint)');
  return {
    name: 'llm',
    async clean(message, {language = 'en'} = {}) {
      if (!systemPrompt) {
        const reply = await chatMessages(url, [{role: 'user', content: String(message)}], {temperature: 0, topP: 1, maxTokens, timeoutMs});
        let text = stripThinking(reply.text);
        let kept = anchors(message).every(anchor => text.includes(anchor));
        // Proper-name guard (owner request 2026-10-01): the first call is always the bare sentence. Only when the reply lost a multi-word name of the input
        // ("Filarmonica din Lisbon" to "Lisbon Philharmonic") is the sentence asked once more with the names masked as Ent1, Ent2, ...; the masked reply is
        // used only when every placeholder comes back, otherwise the first reply stays and its confidence drops.
        const names = guardedNames(message), lost = names.filter(name => !text.includes(name));
        let nameRetry = null;
        if (lost.length) {
          const {text: masked, slots} = maskNames(String(message), names);
          const retry = await chatMessages(url, [{role: 'user', content: masked}], {temperature: 0, topP: 1, maxTokens, timeoutMs});
          const restored = restoreNames(stripThinking(retry.text), slots);
          const ok = restored.preserved && String(restored.text).trim() && anchors(message).every(anchor => restored.text.includes(anchor));
          nameRetry = ok ? 'used' : 'rejected';
          if (ok) { text = restored.text.trim(); kept = true; }
        }
        const namesKept = names.every(name => text.includes(name));
        return {text, confidence: kept && namesKept ? 0.8 : 0.5, translated: language !== 'en', placeholders_preserved: kept, names_protected: names.length, names_kept: namesKept, ...(nameRetry ? {name_retry: nameRetry} : {})};
      }
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
