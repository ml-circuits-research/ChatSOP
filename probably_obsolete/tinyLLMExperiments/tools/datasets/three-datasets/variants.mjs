/** Pure parts of the form variants (DS008 "Form variants"): delexicalized templates and their lexicalization by slot substitution.
 *
 * `skeletonOf(row)` (used by tools/eval/form-templates.mjs, on the auditor side) turns a gold-verified analysed sentence into a template in which
 * its proper names, its common nouns that appear in a SOP value and its main verb are slots (`⟦NAME1⟧`, `⟦NOUN1⟧`, `⟦VERB⟧`, relation `⟦REL⟧`) and
 * everything else (function words, lead-ins, numbers, dates) stays: that is the form, not the case. `lexicalize(template, lex, rng)` (used by the
 * generator tools/datasets/form-variants.mjs) fills the slots with words of the train/dev side. Neither function touches a file.
 */
import {createHash} from 'node:crypto';
import {nameEntities} from './forms.mjs';

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const wholeWord = word => new RegExp(`(?<![\\p{L}\\p{N}])${esc(word)}(?![\\p{L}\\p{N}])`, 'gu');
const quotedStrings = sop => [...sop.matchAll(/"(?:\\.|[^"\\])*"/g)].map(m => m[0]);
export const formType = (form, lemma) => { const f = form.toLowerCase(), l = lemma.toLowerCase(); return f === l ? 'base' : f === `${l}s` || f === `${l}es` || f === l.replace(/y$/, 'ies') ? 's' : /ed$/.test(f) ? 'ed' : /ing$/.test(f) ? 'ing' : 'other'; };
const TIME_NAMES = new Set('monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december'.split(' '));
export const sha16 = text => createHash('sha1').update(text).digest('hex').slice(0, 16);
/** Normalized text (same function as inputs.mjs `normalText`, repeated so this module stays light): case, diacritics, punctuation and spacing folded. */
const normalText = text => String(text).normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** Hash of the normalized text of a message (the same key as eval/reports/current/three-datasets/sealed-text-hashes.json). */
export const textHash = message => sha16(normalText(message));
/** Hash of a lexical signature: the content words and the form (identical words and identical form is a lexical duplicate). */
export const lexicalHash = signature => sha16(`${signature.full}#${signature.words.join(' ')}`);

/** Replace `from` by `to` inside the quoted strings of a SOP, whole words only. */
export function replaceInSop(sop, from, to) {
  return sop.replace(/"(?:\\.|[^"\\])*"/g, literal => { try { return JSON.stringify(JSON.parse(literal).replace(wholeWord(from), to)); } catch { return literal; } });
}

/** Lexicons of the train/dev side: verbs by relation shape, nouns by number, proper-name chains by token count. */
export function lexiconsOf(rows) {
  const verbs = new Map(), nouns = new Map(), proper = new Map();
  for (const row of rows) {
    const relations = [...row.sop.matchAll(/relation "((?:\\.|[^"\\])*)"/g)].map(m => m[1]);
    for (const s of row.analysis?.sentences ?? []) {
      for (const [, form, lemma, upos] of s.tokens) {
        if (upos === 'VERB') for (const rel of relations) for (const [word, kind] of [[lemma, 'L'], [form, 'F']]) if (wholeWord(word).test(rel)) {
          const shape = rel.replace(wholeWord(word), `§${kind}`);
          const entry = verbs.get(shape) ?? verbs.set(shape, new Map()).get(shape), forms = entry.get(lemma) ?? entry.set(lemma, new Map()).get(lemma);
          forms.set(formType(form, lemma), form);
        }
        if (upos === 'NOUN' && /^[a-z]{3,}$/.test(form)) { const type = form === lemma ? 'sg' : 'pl'; (nouns.get(type) ?? nouns.set(type, new Map()).get(type)).set(lemma, form); }
      }
      for (const e of nameEntities(s)) if (!e.person && !/\d/.test(e.text)) { const n = e.text.split(' ').length; (proper.get(n) ?? proper.set(n, new Set()).get(n)).add(e.text); }
    }
  }
  return {verbs, nouns, proper};
}

/** Template of a gold-verified single-sentence row: `{template_text, template_sop, slots}` or null when it has no slot. */
export function skeletonOf(row) {
  const sentence = row.analysis?.sentences?.[0];
  if (!sentence || row.analysis.sentences.length !== 1 || !row.gold_sop || /^@\S+ (unclear|unparsed|constraint)\b/m.test(row.gold_sop)) return null;
  let text = row.message, sop = row.gold_sop;
  const slots = [];
  const slotted = (from, slot) => { if (!wholeWord(from).test(text)) return false; text = text.replace(wholeWord(from), `⟦${slot.id}⟧`); sop = sop.replace(/"(?:\\.|[^"\\])*"/g, lit => { try { return JSON.stringify(JSON.parse(lit).replace(wholeWord(from), `⟦${slot.id}⟧`)); } catch { return lit; } }); slots.push(slot); return true; };
  const seen = new Set();
  let n = 0;
  // A name is a slot whether or not the SOP repeats it (a place in an adjunct is a name too); weekday and month names are part of the form.
  for (const e of nameEntities(sentence)) { if (seen.has(e.text) || TIME_NAMES.has(e.text.toLowerCase())) continue; seen.add(e.text); slotted(e.text, {id: `NAME${++n}`, kind: 'name', person: e.person, tokens: e.text.split(' ').length}); }
  let k = 0;
  for (const [, form, lemma, upos] of sentence.tokens) {
    if (k >= 2) break;
    if (upos !== 'NOUN' || !/^[a-z]{3,}$/.test(form) || !quotedStrings(sop).some(q => wholeWord(form).test(q))) continue;
    if (slotted(form, {id: `NOUN${k + 1}`, kind: 'noun', number: form === lemma ? 'sg' : 'pl'})) k++;
  }
  const root = sentence.tokens.find(t => t[5] === 'root' && t[3] === 'VERB') ?? sentence.tokens.find(t => t[3] === 'VERB');
  if (root) {
    const [, form, lemma] = root;
    const relation = [...sop.matchAll(/relation "((?:\\.|[^"\\])*)"/g)].map(m => m[1]).find(r => wholeWord(lemma).test(r) || wholeWord(form).test(r));
    if (relation && wholeWord(form).test(text)) {
      const kind = wholeWord(lemma).test(relation) ? 'L' : 'F';
      const shape = relation.replace(wholeWord(kind === 'L' ? lemma : form), `§${kind}`);
      text = text.replace(wholeWord(form), '⟦VERB⟧');
      sop = sop.split(`relation ${JSON.stringify(relation)}`).join('relation "⟦REL⟧"');
      slots.push({id: 'VERB', kind: 'verb', shape, type: formType(form, lemma)});
    }
  }
  return slots.length ? {template_text: text, template_sop: sop, slots} : null;
}

/**
 * Fill a template: names from the diversity name lists (`names`: {given, surnames, places}) and the train/dev proper names, nouns and verbs of `lex`.
 * Returns `{text, sop, changes}` or null when a slot has no candidate.
 */
export function lexicalize(template, lex, names, rng) {
  let text = template.template_text, sop = template.template_sop;
  const put = (id, value) => { text = text.split(`⟦${id}⟧`).join(value); sop = sop.split(`⟦${id}⟧`).join(value); };
  let changes = 0;
  const usedNames = new Set();
  for (const slot of template.slots) {
    if (slot.kind === 'name') {
      let value = null;
      if (slot.person) value = slot.tokens >= 2 ? `${rng.shuffle(names.given)[0]} ${rng.shuffle(names.surnames)[0]}` : rng.shuffle(names.given)[0];
      else if (lex.proper.get(slot.tokens)?.size) value = rng.shuffle([...lex.proper.get(slot.tokens)])[0];
      else if (slot.tokens === 1) value = rng.shuffle(names.places)[0];
      if (!value || usedNames.has(value)) return null;
      usedNames.add(value); put(slot.id, value); changes++;
    } else if (slot.kind === 'noun') {
      const pool = lex.nouns.get(slot.number);
      if (!pool?.size) return null;
      const [, form] = rng.shuffle([...pool.entries()])[0];
      put(slot.id, form); changes++;
    } else if (slot.kind === 'verb') {
      const pool = lex.verbs.get(slot.shape);
      const options = pool ? [...pool.entries()].filter(([, forms]) => forms.has(slot.type)) : [];
      if (!options.length) return null;
      const [lemma, forms] = rng.shuffle(options)[0], form = forms.get(slot.type);
      text = text.split('⟦VERB⟧').join(form);
      sop = sop.split('⟦REL⟧').join(slot.shape.replace('§L', lemma).replace('§F', form));
      changes++;
    }
  }
  // a / an agrees with the word that follows
  text = text.replace(/\b(a|an) (\p{L})/giu, (m, article, letter) => { const want = /[aeiou]/i.test(letter) ? 'an' : 'a'; return `${article[0] === 'A' ? want[0].toUpperCase() + want.slice(1) : want} ${letter}`; });
  if (/⟦/.test(text) || /⟦/.test(sop)) return null;
  return {text, sop, changes};
}
