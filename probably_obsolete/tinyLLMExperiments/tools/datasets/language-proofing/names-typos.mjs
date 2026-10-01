/** Deterministic data helpers of LanguageProofingLLM production build 1 (experiment train-language-proofing-gemma270m-prod1, role `proofreader`).
 *
 * 1. Institution and place names that must stay as written (owner request 2026-10-01: "Filarmonica din Lisbon" is a name, not a phrase to translate): `instNames` finds them
 *    (a Romanian institutional head word followed by capitalized words, optionally joined with din, de la, de), `repairNameTarget` restores a name whose only change in the
 *    target is the connector (din to in, from or of), `swapName` and `NAME_GROUPS` replace the place of a kept name in both sides of a pair (a grounded augmentation).
 * 2. Typos of child words (copil, copilul, copilului, copii, child, children, ...): `typoChild` applies one recorded, seeded keyboard-style operation to one occurrence of a
 *    child word in the prompt; the target is the unchanged clean sentence.
 * Pure functions, no clock and no randomness outside the seed.
 */
import crypto from 'node:crypto';

import {INSTITUTION_HEADS as HEADS, INST_SOURCE, instNames} from '../../../lib/text-to-clean-english/protected-names.mjs';
export {INST_SOURCE, instNames};
export const fold = text => String(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Splits a name into {head, connector, place}: "Șoimii din Vaslui" gives ("Șoimii", " din ", "Vaslui"), "Arena Szeged" gives ("Arena", " ", "Szeged"). */
export function splitName(name) {
  const heads = [...HEADS].sort((a, b) => b.length - a.length);
  const head = heads.find(h => name.startsWith(`${h} `));
  if (!head) return null;
  const rest = name.slice(head.length), m = rest.match(/^( din | de la | de | )(.+)$/u);
  return m ? {head, connector: m[1], place: m[2]} : null;
}

/** Category of a head word: names are swapped within a category so a swapped phrase stays plausible. */
export const NAME_GROUPS = {
  team: ['Șoimii', 'Lupii'], venue: ['Filarmonica', 'Teatrul', 'Arena', 'Sala', 'Opera'], school: ['Liceul', 'Colegiul Tehnic', 'Școala Primară', 'Școala', 'Liceul de Arte'],
  office: ['Primăria', 'Oficiul', 'Serviciul'], garden: ['Grădina Botanică'], clinic: ['Cabinetul Stomatologic', 'Clinica'], shop: ['Piața', 'Sistemele', 'Atelierul', 'Tipografia', 'Pensiunea'], library: ['Biblioteca'],
};
export const groupOf = head => Object.keys(NAME_GROUPS).find(g => NAME_GROUPS[g].includes(head)) ?? null;

/** The connector variants that a rewriter produces for "din", "de la" and "de": the name with them replaced. */
function variants(name) {
  const out = new Set();
  for (const [from, tos] of [[' din ', [' in ', ' from ', ' of ']], [' de la ', [' at ', ' from ']], [' de ', [' of ', ' in ']]]) if (name.includes(from)) for (const to of tos) out.add(name.replace(from, to));
  return [...out];
}

/** The target with every institution name of the prompt restored where only the connector was translated; null when a name is still missing (head or place translated, name dropped). */
export function repairNameTarget(prompt, target) {
  let out = target;
  for (const name of instNames(prompt)) {
    if (fold(out).includes(fold(name))) continue;
    let fixed = false;
    for (const v of variants(name)) {
      const re = new RegExp(`(?<![\\p{L}])${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'iu');
      if (re.test(out)) { out = out.replace(re, name); fixed = true; break; }
    }
    if (!fixed) return null;
  }
  return out;
}

/** Replaces `from` by `to` (each exactly once, as written) in the prompt and the target of a pair; null when either side does not contain `from` exactly once. */
export function swapName(prompt, target, from, to) {
  const once = text => text.split(from).length === 2;
  if (!once(prompt) || !once(target)) return null;
  return {prompt: prompt.replace(from, () => to), target: target.replace(from, () => to)};
}

// ---- typos of child words -----------------------------------------------------------------------------------------------------------------------------
export const CHILD_WORD = /(?<![\p{L}])(copil\p{L}*|copii\p{L}*|child|children|childs|kid|kids)(?![\p{L}])/giu;
export const TYPO_OPS = ['drop', 'dup', 'swap', 'sub', 'insert'];
const NEAR = {a: 'sqwz', b: 'vghn', c: 'xdfv', d: 'serfcx', e: 'wsdr', f: 'drtgvc', g: 'ftyhbv', h: 'gyujnb', i: 'ujko', j: 'huikmn', k: 'jiolm', l: 'kop', m: 'njk', n: 'bhjm', o: 'iklp', p: 'ol', q: 'wa', r: 'edft', s: 'awedxz', t: 'rfgy', u: 'yhji', v: 'cfgb', w: 'qase', x: 'zsdc', y: 'tghu', z: 'asx'};
const seeded = (text, salt) => parseInt(crypto.createHash('sha256').update(`${salt}\u0000${text}`).digest('hex').slice(0, 8), 16);

/** One keyboard-style typo of one word, never touching the first letter; null when it does not apply or changes nothing. */
export function typoWord(word, op, seed = 0) {
  const chars = [...word], n = chars.length;
  if (n < 4) return null;
  const at = (lo, hi, salt) => lo + (seeded(word, `${seed}:${op}:${salt}`) % (hi - lo + 1));
  let out;
  switch (op) {
    case 'drop': { const i = at(1, n - 1, 'i'); out = [...chars.slice(0, i), ...chars.slice(i + 1)]; break; }
    case 'dup': { const i = at(1, n - 1, 'i'); out = [...chars.slice(0, i + 1), chars[i], ...chars.slice(i + 1)]; break; }
    case 'swap': { const i = at(1, n - 2, 'i'); out = chars.slice(); [out[i], out[i + 1]] = [out[i + 1], out[i]]; break; }
    case 'sub': { const i = at(1, n - 1, 'i'), near = NEAR[chars[i].toLowerCase()]; if (!near) return null; out = chars.slice(); out[i] = near[at(0, near.length - 1, 'k')]; break; }
    case 'insert': { const i = at(1, n - 1, 'i'), letters = 'abcdefghijklmnopqrstuvwxyz'; out = [...chars.slice(0, i), letters[at(0, 25, 'l')], ...chars.slice(i)]; break; }
    default: throw Error(`unknown typo op ${op}`);
  }
  const result = out.join('');
  return result !== word && fold(result) !== fold(word) ? result : null;
}

/** Child-word occurrences of a prompt: [{index, word}]. */
export const childWords = prompt => [...String(prompt).matchAll(CHILD_WORD)].map(m => ({index: m.index, word: m[0]}));

/** Applies a typo to one occurrence of a child word ({occ, op, seed}); returns the new prompt or null. */
export function typoChild(prompt, {occ = 0, op, seed = 0}) {
  const found = childWords(prompt)[occ];
  if (!found) return null;
  const typo = typoWord(found.word, op, seed);
  return typo === null ? null : prompt.slice(0, found.index) + typo + prompt.slice(found.index + found.word.length);
}
