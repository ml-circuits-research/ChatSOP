/** Stanza parses of the rewrite candidates, recorded once per package (GPU, one worker) so that the rules can be replayed
 * without the parser (the method of tools/symbolic-regression.mjs `record-parses`). The record key is the SymbolicLM
 * prefetch key: `<language>|<masked text>` (`maskMessage`), the same key the replay worker answers from.
 */
import {createSymbolicLM} from '../../../lib/symbolic-lm/index.mjs';
import {maskMessage} from '../../../lib/ud-to-sop/index.mjs';
import {ParseStore} from './common.mjs';

/** The default package is only compared by tree (`treeAgreement`), so its record keeps the compact words. */
const slim = parse => ({sentences: (parse.sentences ?? []).map(s => ({text: s.text, words: s.words.map(({id, text, lemma, upos, head, deprel}) => ({id, text, lemma, upos, head, deprel}))}))});

/** Parses the texts not yet recorded for `pkg` (`default` or `accurate`); returns {recorded, todo}. */
export async function recordParses(texts, pkg, {device = process.env.CHATSOP_UD_DEVICE ?? 'cuda', batch = 64, onProgress = null} = {}) {
  const store = new ParseStore(pkg);
  store.load();
  const todo = [...new Set(texts)].filter(t => !store.map.has(`en|${maskMessage(t)}`) && !store.map.has(`auto|${maskMessage(t)}`));
  if (!todo.length) return {recorded: 0, todo: 0};
  const lm = await createSymbolicLM({device, package: pkg});
  let recorded = 0;
  try {
    for (let i = 0; i < todo.length; i += batch) {
      lm.prefetched.clear();
      await lm.prefetch(todo.slice(i, i + batch), {language: 'auto', route: 'direct'});
      const entries = [...lm.prefetched].filter(([key]) => !store.map.has(key)).map(([key, value]) => [key, pkg === 'default' ? slim(value.parse) : value.parse]);
      if (entries.length) store.append(entries);
      recorded += entries.length;
      onProgress?.(Math.min(i + batch, todo.length), todo.length);
    }
  } finally { await lm.stop(); }
  return {recorded, todo: todo.length};
}
