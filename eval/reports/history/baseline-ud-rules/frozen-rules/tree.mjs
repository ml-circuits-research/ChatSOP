/**
 * UD tree helpers for the UD → SOP converter: a sentence from the Stanza worker becomes an indexed tree whose words
 * know their children, and value spans are cut from the ORIGINAL message by character offsets, so a value is
 * always a verbatim piece of the message (names keep their spelling, case endings and diacritics).
 */
import {fold} from './lexicon.mjs';

/** Base relation of a UD label (`nsubj:pass` → `nsubj`). */
export const base = deprel => String(deprel ?? '').split(':')[0];

/** Index one worker sentence: words get `kids`, `sentence` and `folded`; returns `{...sentence, byId, root}`. */
export function indexSentence(sentence, index) {
  const byId = new Map();
  const words = sentence.words.map(word => ({...word, kids: [], sentence: index, folded: fold(word.text), lemmaFolded: fold(word.lemma ?? word.text)}));
  for (const word of words) byId.set(word.id, word);
  for (const word of words) if (word.head && byId.has(word.head)) byId.get(word.head).kids.push(word);
  const root = words.find(word => word.head === 0) ?? words[0];
  return {...sentence, index, words, byId, root};
}

/** Children of `word` whose deprel matches one of `labels` (a base label matches all its subtypes). */
export const kids = (word, ...labels) => word.kids.filter(kid => labels.includes(kid.deprel) || labels.includes(base(kid.deprel)));

/** All words of the subtree of `word`, skipping any child subtree for which `skip(child)` is true. */
export function subtree(word, skip = () => false) {
  const out = [word];
  for (const kid of word.kids) if (!skip(kid)) out.push(...subtree(kid, skip));
  return out;
}

const PUNCT = /^[\s.,;:!?¿¡"'“”„«»()\[\]{}…–—-]+$/u;

/**
 * The verbatim message text of a set of words: contiguous runs are sliced from the message by offsets and joined
 * by one space; leading and trailing punctuation words are dropped. Returns '' for no words.
 */
export function spanText(message, words) {
  const sorted = [...new Map(words.map(word => [word.id, word])).values()].sort((a, b) => a.id - b.id);
  while (sorted.length && (sorted[0].upos === 'PUNCT' || PUNCT.test(sorted[0].text))) sorted.shift();
  while (sorted.length && (sorted.at(-1).upos === 'PUNCT' || PUNCT.test(sorted.at(-1).text))) sorted.pop();
  if (!sorted.length) return '';
  const runs = [];
  let run = [sorted[0]];
  for (const word of sorted.slice(1)) {
    if (word.id === run.at(-1).id + 1) run.push(word);
    else { runs.push(run); run = [word]; }
  }
  runs.push(run);
  return runs.map(r => message.slice(r[0].start, r.at(-1).end)).join(' ').replace(/\s+/g, ' ').replace(/^[\s,;:]+|[\s,;:]+$/g, '').trim();
}

/** Character range `[start, end)` of a set of words (for `unparsed` spans and for coverage accounting). */
export const rangeOf = words => words.length ? [Math.min(...words.map(w => w.start)), Math.max(...words.map(w => w.end))] : null;

/** The folded text of the case/mark words of `word` with their fixed continuations ("because of", "de la"). */
export function markerOf(word, ...labels) {
  const markers = kids(word, ...labels).sort((a, b) => a.id - b.id);
  return markers.map(m => [m, ...kids(m, 'fixed', 'flat', 'goeswith')].sort((a, b) => a.id - b.id).map(w => w.folded).join(' ')).join(' ').trim();
}

/** Is the clause headed by `word` a finite or verbal clause (a verb, or a predicate with a copula or subject)? */
export const isClausal = word => ['VERB', 'AUX'].includes(word.upos) || kids(word, 'cop', 'nsubj', 'aux').length > 0;
