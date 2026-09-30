/** Cross-lingual anchoring for the corpus audit (DS021 "Input languages and content words", owner decision D1 of
 * 2026-09-29). Content words may be written in the message's language, normalized, or in English ("chemistry" for
 * "chimie"). An English value is anchored when the generator's EN↔RO lexicon (tools/datasets/diversity/english.mjs
 * `translationPairs`), the row's verification entities or the host dictionary (sop/dictionary.mjs) pair it with a
 * surface the message mentions. Proper names are never translated and keep the ordinary typo-tolerant check
 * (sop/linking.mjs `mentionedIn`).
 */
import {mentionedIn, mentionedThroughDictionary} from '../../../sop/linking.mjs';
import {defaultDictionary} from '../../../sop/dictionary.mjs';
import {translationPairs} from '../diversity/english.mjs';
import {ontologySurfaces} from './rows.mjs';

const fold = text => String(text).normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/^the\s+/, '').trim();
const PAIRS = new Map();
for (const [en, ro] of translationPairs()) {
  const key = fold(en);
  if (!PAIRS.has(key)) PAIRS.set(key, new Set());
  PAIRS.get(key).add(ro);
}

/** The source-language surfaces the lexicon pairs with an English value (empty when it is not a known translation). */
export const sourcesOf = value => [...(PAIRS.get(fold(value)) ?? [])];

/** Surfaces of the row's verification entities (label and aliases, every language) that share an entity with `value`. */
function entitySurfaces(value, row) {
  const key = fold(value);
  const out = [];
  const groups = [...(row?.verification_context?.entities ?? []).map(entity => [entity.label, ...(entity.aliases ?? [])]),
    ...[...ontologySurfaces(row?.ontology_sop ?? '').values()].map(list => list.map(item => item.text))];
  for (const group of groups) {
    const surfaces = group.filter(Boolean);
    if (surfaces.some(surface => fold(surface) === key)) out.push(...surfaces);
  }
  return out;
}

/**
 * Is the value written in the message, or the English translation of a surface the message mentions? Translations
 * are read from the generator's EN↔RO lexicon and, when a row is given, from the labels and aliases of the row's
 * verification entities (evaluation-only scaffolding: an entity whose English label is the value and whose other
 * surface is in the message).
 */
const FIRST_PERSON = /(?<![\p{L}])(?:i|i'm|i've|i'd|me|my|mine|myself|eu|mie|mi|m-|meu|mea|mei|mele|mă|ma)(?![\p{L}])/iu;
const compact = text => fold(text).replace(/[^\p{L}\p{N}]+/gu, '');
/**
 * First person (DS021 Q-LANG-5): "the user" is anchored by a first-person word of the message ("I", "my", "eu",
 * "meu"); "the user's X" also needs X in the message, or its source-language surface (typo-tolerant, and tolerant
 * to a merged "mybrother").
 */
function firstPersonAnchored(value, message, row) {
  const m = /^the user(?:'s\s+(.+))?$/i.exec(String(value).trim());
  if (!m) return null;
  if (!FIRST_PERSON.test(String(message)) && !/(?<![\p{L}])(?:my|meu|mea)\p{L}/iu.test(String(message))) return false;
  if (!m[1]) return true;
  const owned = m[1];
  return mentionedIn(owned, message) || compact(message).includes(compact(owned))
    || [...sourcesOf(owned), ...entitySurfaces(owned, row), ...entitySurfaces(value, row)].some(source => mentionedIn(source, message) || compact(message).includes(compact(source)));
}

export function anchoredValue(value, message, row = null) {
  if (mentionedIn(value, message)) return true;
  const person = firstPersonAnchored(value, message, row);
  if (person !== null) return person;
  if ([...sourcesOf(value), ...entitySurfaces(value, row)].some(source => mentionedIn(source, message))) return true;
  // Either language is accepted (DS021 "Input languages and content words"): the host dictionary anchors a value whose
  // Romanian or English surface, lemma or inflected form, the message mentions.
  return mentionedThroughDictionary(value, message, defaultDictionary());
}
