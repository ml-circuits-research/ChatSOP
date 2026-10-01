/**
 * Multi-word proper names that LanguageProofingLLM must not translate (owner request 2026-10-01; the iteration-3 failure was
 * "Filarmonica din Lisbon" coming back as "Lisbon Philharmonic"). `guardedNames(sentence)` finds them in the INPUT sentence:
 *   - institution and place names: a Romanian institutional head word (Filarmonica, Primăria, Colegiul Tehnic, Șoimii, ...) followed by
 *     capitalized words, optionally joined with din, de la or de;
 *   - other multi-word capitalized runs (lib/ud-to-sop/protect.mjs name slots with a space, "Orion Robotics") that do not open the sentence.
 * `maskNames(sentence, names)` replaces each by a placeholder (`Ent1`, ...) and `restoreNames(text, slots)` puts them back (protect.mjs `restore`).
 * The llm backend uses them only as a guard AFTER the first, bare call: it never changes what the model sees unless the reply lost a name.
 * Pure functions; shared with the training-data helpers tools/datasets/language-proofing/names-typos.mjs.
 */
import {protect, restore} from '../ud-to-sop/protect.mjs';

export const INSTITUTION_HEADS = ['Șoimii', 'Soimii', 'Lupii', 'Filarmonica', 'Colegiul Tehnic', 'Colegiul', 'Grădina Botanică', 'Gradina Botanică', 'Grădina Botanica', 'Cabinetul Stomatologic', 'Oficiul', 'Serviciul', 'Liceul de Arte', 'Liceul', 'Școala Primară', 'Școala', 'Scoala', 'Primăria', 'Primaria', 'Teatrul', 'Arena', 'Biblioteca', 'Sala', 'Opera', 'Piața', 'Piata', 'Sistemele', 'Atelierul', 'Tipografia', 'Pensiunea', 'Universitatea', 'Spitalul', 'Muzeul', 'Clubul', 'Stadionul', 'Centrul', 'Institutul', 'Asociația', 'Clinica'];
const CAP = "\\p{Lu}[\\p{L}\\p{M}\\d'’-]+";
const headRe = [...INSTITUTION_HEADS].sort((a, b) => b.length - a.length).map(h => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
export const INST_SOURCE = `(?<![\\p{L}])((?:${headRe})(?:\\s(?:din|de la|de)\\s${CAP}(?:\\s${CAP})?|\\s${CAP}(?:\\s${CAP})?))`;

/** Every institution or place name of a text, as written. */
export const instNames = text => [...String(text).matchAll(new RegExp(INST_SOURCE, 'gu'))].map(m => m[1]);

/** The names a rewrite must keep verbatim, longest first, without duplicates and without a name contained in a longer one. */
export function guardedNames(sentence) {
  const text = String(sentence), found = new Set(instNames(text));
  for (const slot of protect(text).slots) {
    if (slot.kind !== 'Ent' || !/\s/.test(slot.value)) continue;
    const at = text.indexOf(slot.value);
    if (at <= 0 || /[.!?:;]\s*$/.test(text.slice(0, at))) continue; // a run that opens the sentence is usually a Romanian function word plus a name
    found.add(slot.value);
  }
  const all = [...found].sort((a, b) => b.length - a.length);
  return all.filter((name, i) => !all.slice(0, i).some(longer => longer.includes(name)));
}

/** The sentence with every name replaced by a placeholder: {text, slots}; the slots are the input of `restoreNames`. */
export function maskNames(sentence, names) {
  const slots = [];
  let text = String(sentence);
  for (const name of names) {
    if (!text.includes(name)) continue;
    const key = `Ent${slots.length + 1}`;
    slots.push({kind: 'Ent', key, value: name});
    text = text.split(name).join(key);
  }
  return {text, slots};
}

/** {text, preserved, dropped}: the placeholders of a reply replaced by their names. */
export const restoreNames = (text, slots) => restore(text, slots);
