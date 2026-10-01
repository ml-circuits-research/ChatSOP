/**
 * Evaluation-only relation synonyms (DS016 "Equivalence tolerance").
 *
 * The strict evaluator links a predicted relation phrase exactly as production does: against the phrases the
 * row's verification world declares for each predicate, which the generator derived from its own constructions.
 * A reasonable phrase the generator never used ("be on the staff of" for works_at) then fails to link. For the
 * TOLERANT comparison only, the world's predicates gain English lexemes with the phrases listed here and in a row's
 * optional `verification.relation_synonyms` ({predicate id: [English phrases]}); nothing else changes. Production
 * linking (the lexicon of the base memory, server/, sop/) never reads this module or `eval/relation-synonyms.json`.
 *
 * A synonym that the row world already declares for ANOTHER predicate (it would make linking ambiguous or
 * redirect it) is dropped for that row and reported in `conflicts`.
 */
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {normalize} from '../sop/text-keys.mjs';
import {parse, tokens} from '../sop/knowledge/lexical.mjs';

const FILE = fileURLToPath(new URL('./relation-synonyms.json', import.meta.url));
let cached = null;
/** The curated evaluation synonyms: {predicate id: {en: [phrases]}} (comment keys start with `_`). */
export function relationSynonyms() {
  if (!cached) {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    cached = Object.fromEntries(Object.entries(data).filter(([key]) => !key.startsWith('_')).map(([id, byLanguage]) => [id, byLanguage.en ?? []]));
  }
  return cached;
}

const fold = text => normalize(text).normalize('NFD').replace(/\p{M}/gu, '');
const wiresOf = ontology => { const {wires, errors} = parse(String(ontology)); if (errors.length) throw Error(`ontology text: ${errors[0].message}`); return wires; };
const valuesOf = (w, key) => w.fields.filter(f => f.key === key).map(f => f.value.trim());
const quoted = value => { const text = tokens(value).at(-1); return text?.startsWith('"') ? JSON.parse(text) : null; };
/** Role names of a predicate wire in position order (role lines, named args, or subject/object by position). */
const frameOf = w => {
  const roles = valuesOf(w, 'role').map(line => tokens(line)[0]);
  if (roles.length) return roles;
  const args = tokens(valuesOf(w, 'args')[0] ?? '');
  return args.every(t => t.includes(':')) ? args.map(t => t.split(':')[0]) : ['subject', 'object'].slice(0, args.length);
};
/** Phrases (labels and lexeme forms) each predicate of an ontology text declares: folded phrase -> predicate id. */
function declaredPhrases(ontology) {
  const phrases = new Map();
  for (const w of wiresOf(ontology)) {
    const owner = w.type === 'predicate' ? w.id : w.type === 'lexeme' ? valuesOf(w, 'of')[0] : null;
    if (!owner) continue;
    for (const value of [...valuesOf(w, 'label'), ...valuesOf(w, 'form')]) { const phrase = quoted(value); if (phrase) phrases.set(fold(phrase), owner); }
  }
  return phrases;
}

/**
 * The ontology text with every applicable evaluation synonym added as one English lexeme per predicate.
 * Returns {ontology, added: [{predicate, phrase}], conflicts: [{predicate, phrase, declaredFor}]}.
 */
export function tolerantOntology(ontology, rowSynonyms = {}) {
  const declared = declaredPhrases(ontology);
  const frames = new Map(wiresOf(ontology).filter(w => w.type === 'predicate').map(w => [w.id, frameOf(w)]));
  const merged = {};
  for (const source of [relationSynonyms(), rowSynonyms ?? {}]) for (const [id, list] of Object.entries(source)) merged[id] = [...(merged[id] ?? []), ...list];
  const added = [], conflicts = [];
  let extra = '';
  for (const [id, frame] of frames) {
    const forms = [];
    for (const phrase of merged[id] ?? []) {
      const owner = declared.get(fold(phrase));
      if (owner && owner !== id) { conflicts.push({predicate: id, phrase, declaredFor: owner}); continue; }
      if (owner === id) continue;
      forms.push(phrase);
      declared.set(fold(phrase), id);
      added.push({predicate: id, phrase});
    }
    if (forms.length && frame.length) extra += `\n@lx_${id}_tolerant lexeme\n  of ${id}\n  language en\n  pos verb\n${forms.map(f => `  form ${JSON.stringify(f)}\n`).join('')}  frame ${frame.join(' ')}\n`;
  }
  return {ontology: String(ontology).replace(/\s*$/, '\n') + extra, added, conflicts};
}
