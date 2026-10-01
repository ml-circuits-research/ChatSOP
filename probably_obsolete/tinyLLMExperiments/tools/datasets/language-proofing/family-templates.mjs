/** Rule-written pairs for the family relations that the iteration-1 data lacked ("child of" never appeared; "copilul lui" came out as "parent").
 * Romanian, mixed and badly written English sentences with a correct clean-English target by construction (no LLM). A small share of the training set
 * (about 1%), written so that child, son, daughter, mother and father occur with many names, places and verbs; the vocabulary of the held-out list is not used.
 */
import {GIVEN_NAMES} from '../diversity/names.mjs';

const NAMES = GIVEN_NAMES.filter(n => n.culture === 'romanian').map(n => n.name);
const PLACES = [['Cluj', 'Cluj'], ['Iași', 'Iași'], ['Brașov', 'Brașov'], ['Timișoara', 'Timișoara'], ['Sibiu', 'Sibiu'], ['Oradea', 'Oradea'], ['Viena', 'Vienna'], ['Berlin', 'Berlin'], ['Paris', 'Paris'], ['Lisabona', 'Lisbon']];
const ORGS = [['spital', 'the hospital', 'spitalul'], ['bancă', 'the bank', 'banca'], ['școală', 'the school', 'școala'], ['brutărie', 'the bakery', 'brutăria'], ['bibliotecă', 'the library', 'biblioteca'], ['muzeu', 'the museum', 'muzeul'], ['fabrică', 'the factory', 'fabrica'], ['farmacie', 'the pharmacy', 'farmacia']];
// relation: [romanian nominative-definite, english noun, plural flag]
const REL = {child: ['copilul', 'child'], son: ['fiul', 'son'], daughter: ['fiica', 'daughter'], mother: ['mama', 'mother'], father: ['tatăl', 'father']};
const AN = w => (/^[aeiou]/i.test(w) ? 'an' : 'a');
// templates: ro, mixed, en (clean), slots {R} relation (ro form / en noun), {A}, {B}, {C} place, {O} organization
const T = [
  ['{Ro} lui {A} lucrează la {Oro}.', '{Ro} lui {A} works at {Oen}.', "{A}'s {Ren} works at {Oen}."],
  ['Cine este {ro} lui {A}?', 'Who is {ro} lui {A}?', "Who is {A}'s {Ren}?"],
  ['Este {B} {ro} lui {A}?', 'Is {B} {ro} lui {A}?', 'Is {B} the {Ren} of {A}?'],
  ['{Ro} lui {A} nu locuiește în {Cro}.', '{Ro} lui {A} does not live in {Cen}.', "{A}'s {Ren} does not live in {Cen}."],
  ['{B} este {ro} lui {A}.', '{B} is {ro} lui {A}.', '{B} is the {Ren} of {A}.'],
  ['Știi unde lucrează {ro} lui {A}?', 'Do you know unde lucrează {ro} lui {A}?', "Do you know where {A}'s {Ren} works?"],
  ['{Ro} lui {A} a plecat la {Cro}.', '{Ro} lui {A} left for {Cen}.', "{A}'s {Ren} left for {Cen}."],
  ['Nu cunosc {ro} lui {A}.', 'I do not know {ro} lui {A}.', "I do not know {A}'s {Ren}."],
  ['{A} spune că {ro} lui {B} lucrează la {Oro}.', '{A} says că {ro} lui {B} works at {Oen}.', "{A} says that {B}'s {Ren} works at {Oen}."],
  ['Poți să verifici dacă {ro} lui {A} locuiește în {Cro}?', 'Can you verifica dacă {ro} lui {A} lives in {Cen}?', "Can you check if {A}'s {Ren} lives in {Cen}?"],
];
const noisy = en => {
  let t = en.toLowerCase().replace(/'s\b/g, 's').replace(/n't\b/g, 'nt');
  if (t.endsWith('.')) t = t.slice(0, -1);
  return t;
};
const cap = s => s[0].toUpperCase() + s.slice(1);
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** [{prompt, target, language_kind}] — `perRelation` clean sentences per relation, each with a Romanian, a mixed and a badly written English version. */
export function familyPairs({seed = 20261001, perRelation = {child: 70, son: 28, daughter: 28, mother: 20, father: 20}} = {}) {
  const random = rng(seed), pick = list => list[Math.floor(random() * list.length)], out = [], seen = new Set();
  for (const [key, count] of Object.entries(perRelation)) {
    const [roWord, enWord] = REL[key];
    for (let made = 0, tries = 0; made < count && tries < count * 20; tries++) {
      const t = pick(T), A = pick(NAMES);
      let B = pick(NAMES); if (B === A) continue;
      const [cRo, cEn] = pick(PLACES), [oRo, oEn, oDef] = pick(ORGS);
      const fill = (s, mode) => s.replaceAll('{Ro}', cap(roWord)).replaceAll('{ro}', roWord).replaceAll('{Ren}', enWord).replaceAll('{A}', A).replaceAll('{B}', B).replaceAll('{Cro}', cRo).replaceAll('{Cen}', cEn).replaceAll('{Oro}', mode === 'ro' ? oRo : oRo).replaceAll('{Oen}', oEn);
      const en = fill(t[2], 'en'), ro = fill(t[0], 'ro'), mixed = fill(t[1], 'mixed');
      if (seen.has(en)) continue;
      seen.add(en); made++;
      out.push({prompt: ro, target: en, language_kind: 'ro', relation: key}, {prompt: mixed, target: en, language_kind: 'mixed', relation: key}, {prompt: noisy(en), target: en, language_kind: 'noisy_en', relation: key});
    }
  }
  return out;
}
