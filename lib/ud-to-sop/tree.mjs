/**
 * UD tree helpers for the UD → SOP converter: a sentence from the Stanza worker becomes an indexed tree whose words
 * know their children, and value spans are cut from the ORIGINAL message by character offsets, so a value is
 * always a verbatim piece of the message (names keep their spelling, case endings and diacritics).
 */
import {fold} from './lexicon.mjs';

/** Base relation of a UD label (`nsubj:pass` → `nsubj`). */
export const base = deprel => String(deprel ?? '').split(':')[0];

/**
 * The words that sit on a head cycle (a word that is its own ancestor). A well-formed tree has none; every walk up
 * or down the tree in the rules relies on that (termination proof: each walk follows a chain of strictly fewer than
 * `words.length` distinct heads). Linear in the sentence length.
 */
export function cycleWords(words) {
  const byId = new Map(words.map(w => [w.id, w]));
  const state = new Map(); // id → 1 on the current walk, 2 finished
  const cyclic = new Set();
  for (const start of words) {
    const walk = [];
    let w = start;
    while (w && !state.has(w.id)) { state.set(w.id, 1); walk.push(w); w = byId.get(w.head); }
    if (w && state.get(w.id) === 1) for (let i = walk.indexOf(w); i < walk.length; i++) cyclic.add(walk[i]);
    for (const x of walk) state.set(x.id, 2);
  }
  return [...cyclic];
}

/** Cuts every head cycle of `words` (mutating them) at its first word, which becomes a dependent of the root; returns the number of cuts. */
export function breakCycles(words) {
  const cyclic = cycleWords(words);
  if (!cyclic.length) return 0;
  const root = words.find(w => w.head === 0 && !cyclic.includes(w));
  let cuts = 0;
  for (let w of cyclic.sort((a, b) => a.id - b.id)) {
    if (!cycleWords(words).includes(w)) continue; // an earlier cut already opened this cycle
    if (root) Object.assign(w, {head: root.id, deprel: 'dep'}); else Object.assign(w, {head: 0, deprel: 'root'});
    cuts++;
  }
  return cuts;
}

/** Index one worker sentence: words get `kids`, `sentence` and `folded`; returns `{...sentence, byId, root, cycleCuts}`. */
export function indexSentence(sentence, index) {
  const byId = new Map();
  const words = sentence.words.map(word => ({...word, kids: [], sentence: index, folded: fold(word.text), lemmaFolded: fold(word.lemma ?? word.text)}));
  const cycleCuts = breakCycles(words);
  for (const word of words) byId.set(word.id, word);
  for (const word of words) if (word.head && byId.has(word.head)) byId.get(word.head).kids.push(word);
  const root = words.find(word => word.head === 0) ?? words[0];
  return {...sentence, index, words, byId, root, cycleCuts};
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
    // v2.0: words that are only separated by punctuation tokens ("2020-03-01" split at the hyphens by the accurate
    // tokenizer, "August 1, 2024") stay one verbatim run.
    const gap = message.slice(run.at(-1).end, word.start);
    if (word.id === run.at(-1).id + 1 || (word.id > run.at(-1).id && gap.length <= 3 && /[-–\/.,]/.test(gap) && !/[\p{L}\p{N}]/u.test(gap))) run.push(word);
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
