/** LLM strategy slot (id `llm`, basis `llm`, DS029): off by default. Plug a function `classify(text, context)` that
 * returns signals ({kind, label, score, span?}); the system stamps `source` and `basis`. No model is bundled and none
 * is called unless `strategies.llm.enabled` is set and a classifier is supplied.
 */
export function createLlmStrategy({classify} = {}) {
  return {
    id: 'llm',
    kinds: [],
    async detect(message, context = {}) {
      if (typeof classify !== 'function') throw new Error('llm strategy has no classifier plugged in');
      return (await classify(context.englishText ?? message, context)).map(s => ({...s, source: 'llm', basis: 'llm'}));
    },
  };
}
