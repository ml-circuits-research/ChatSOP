/** The chat page's Chat and Translate modes (DS012 "Chat modes"). Both use an unmodified base instruct model
 * through its own chat template; neither writes SOP, runs a host circuit or reads the repository. The small
 * formalizer's message-only boundary (DS021) is untouched: Formalize mode keeps `predictMessage`.
 */

/** The fixed instruction of Translate mode (greedy decoding, no history). */
export const TRANSLATE_PROMPT = "Translate the user's message into English. Keep names, numbers and quoted text exactly. Output only the translation.";

const CHAT_LANGUAGE = Object.freeze({en: 'Answer in English.', ro: 'Answer in Romanian.'});

/** Chat mode's system instruction for the page's language selector: `en`/`ro` set it, `auto` (Any) adds none. */
export const chatSystemPrompt = language => CHAT_LANGUAGE[language] ?? null;

/**
 * Multi-turn Chat history per `user\0conversation` key, kept in server memory only (it is lost on restart).
 * Bounded: at most `maxTurns` user/assistant pairs and `maxBytes` of text per conversation, oldest turns first
 * out, and at most `maxConversations` conversations (least recently used first out).
 */
export class ChatHistory {
  constructor({maxTurns = 8, maxBytes = 12000, maxConversations = 200} = {}) {
    Object.assign(this, {maxTurns, maxBytes, maxConversations, conversations: new Map()});
  }

  /** The stored turns as chat messages, oldest first. */
  get(key) {
    const turns = this.conversations.get(key) ?? [];
    return turns.flatMap(([user, assistant]) => [{role: 'user', content: user}, {role: 'assistant', content: assistant}]);
  }

  add(key, user, assistant) {
    const turns = this.conversations.get(key) ?? [];
    this.conversations.delete(key);
    turns.push([user, assistant]);
    const size = () => turns.reduce((sum, [u, a]) => sum + Buffer.byteLength(u) + Buffer.byteLength(a), 0);
    while (turns.length > this.maxTurns || (turns.length > 1 && size() > this.maxBytes)) turns.shift();
    this.conversations.set(key, turns);
    while (this.conversations.size > this.maxConversations) this.conversations.delete(this.conversations.keys().next().value);
  }

  clear(key) { this.conversations.delete(key); }
}
