/**
 * Synonym oracle for the analysis comparison (DS016 "Analysis comparison"): two English lemmas are synonyms when they
 * share a WordNet 3.0 synset among the first senses of either word (cache `datasets_sources/wordnet-3.0/dict`, git-ignored, never exported),
 * or when the reviewed dictionary (`sop/dictionary.mjs`, the synonym lists behind `sop/frames.mjs`) lists them as
 * surfaces of one entry. Every source is optional: a missing source contributes nothing. Deterministic, no network.
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../dataset-paths.mjs';

/** Converse or opposite relation pairs that WordNet or a dictionary may list as near-synonyms but that swap the roles: never synonyms. */
export const CONVERSES = Object.freeze([['borrow', 'lend'], ['buy', 'sell'], ['give', 'receive'], ['give', 'take'], ['teach', 'learn'], ['teach', 'study'], ['employ', 'work'], ['win', 'lose'], ['beat', 'lose'], ['send', 'receive'], ['follow', 'lead'], ['precede', 'follow'], ['own', 'belong'], ['rent', 'lease'], ['hire', 'fire'], ['accept', 'refuse'], ['accept', 'reject'], ['open', 'close'], ['start', 'stop'], ['begin', 'end'], ['arrive', 'leave'], ['enter', 'leave'], ['increase', 'decrease'], ['allow', 'forbid'], ['allow', 'prohibit'], ['include', 'exclude'], ['like', 'dislike'], ['agree', 'disagree'], ['approve', 'reject']].map(p => p.join('|')));
const CONVERSE_SET = new Set(CONVERSES.flatMap(p => { const [a, b] = p.split('|'); return [`${a}|${b}`, `${b}|${a}`]; }));

export const WORDNET_DIR = path.join(ROOT, 'datasets_sources/wordnet-3.0/dict');
const POS_FILES = Object.freeze(['verb', 'noun', 'adj', 'adv']);

/** lemma -> Set of synset ids (`<pos><offset>`) of its first `senses` senses, from index.<pos>; synset id -> member lemmas from data.<pos>. */
export function loadWordNet(dir = WORDNET_DIR, {senses = 3} = {}) {
  if (!POS_FILES.every(p => fs.existsSync(path.join(dir, `index.${p}`)) && fs.existsSync(path.join(dir, `data.${p}`)))) return null;
  const index = new Map();
  for (const pos of POS_FILES) {
    for (const line of fs.readFileSync(path.join(dir, `index.${pos}`), 'utf8').split('\n')) {
      if (!line || line.startsWith(' ')) continue;
      const f = line.trim().split(' ');
      const count = Number(f[2]), pointers = Number(f[3]);
      const ids = f.slice(6 + pointers, 6 + pointers + count).slice(0, senses).map(o => pos + o);
      const lemma = f[0].replace(/_/g, ' ');
      index.set(lemma, new Set([...(index.get(lemma) ?? []), ...ids]));
    }
  }
  const members = new Map();
  for (const pos of POS_FILES) {
    for (const line of fs.readFileSync(path.join(dir, `data.${pos}`), 'utf8').split('\n')) {
      if (!line || line.startsWith(' ')) continue;
      const f = line.split(' ');
      const n = parseInt(f[3], 16);
      members.set(pos + f[0], Array.from({length: n}, (_, i) => f[4 + 2 * i].replace(/\(.*\)$/, '').replace(/_/g, ' ').toLowerCase()));
    }
  }
  return {index, members};
}

/**
 * `areSynonyms(a, b)` for lowercase lemmas (equal lemmas are not synonyms of each other: callers test equality first).
 * Options: `wordnet` (loaded WordNet, default: load from the cache), `dictionary` (a sop/dictionary.mjs Dictionary or null),
 * `senses` (first WordNet senses considered per word, default 3).
 */
export function createSynonymOracle({wordnet, dictionary = null, senses = 3} = {}) {
  const wn = wordnet === undefined ? loadWordNet(WORDNET_DIR, {senses}) : wordnet;
  const cache = new Map();
  const syns = lemma => {
    if (cache.has(lemma)) return cache.get(lemma);
    const out = new Set();
    for (const id of wn?.index.get(lemma) ?? []) for (const m of wn.members.get(id) ?? []) out.add(m);
    if (dictionary) { try { for (const s of dictionary.synonyms(lemma, 'relation')) out.add(String(s).toLowerCase()); } catch { /* dictionary lookup is optional */ } }
    out.delete(lemma);
    cache.set(lemma, out);
    return out;
  };
  const areSynonyms = (a, b) => a !== b && !CONVERSE_SET.has(`${a}|${b}`) && (syns(a).has(b) || syns(b).has(a));
  areSynonyms.available = Boolean(wn || dictionary);
  return areSynonyms;
}
