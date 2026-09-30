/**
 * Evaluation-only relation synonyms (DS016 "Equivalence tolerance").
 *
 * The strict evaluator links a predicted relation phrase exactly as production does: against the phrases the
 * row's verification world declares for each predicate, which the generator derived from its own constructions.
 * A reasonable phrase the generator never used ("be on the staff of" for works_at) then fails to link. For the
 * TOLERANT comparison only, the world's predicate declarations gain the aliases listed here and in a row's
 * optional `verification.relation_synonyms` ({predicate id: [English phrases]}); nothing else changes. Production
 * linking (config/ontology.sop, server/, sop/) never reads this module or `eval/relation-synonyms.json`.
 *
 * A synonym that the row world already declares for ANOTHER predicate (it would make linking ambiguous or
 * redirect it) is dropped for that row and reported in `conflicts`.
 */
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {normalize} from '../sop/lexicon.mjs';

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
/** Phrases (label/alias lines) each predicate block of an ontology text declares. */
function declaredPhrases(ontology) {
  const phrases = new Map();
  let current = null;
  for (const line of String(ontology).split('\n')) {
    const header = /^@([A-Za-z][A-Za-z0-9_]*)\s+(\w+)/.exec(line);
    if (header) { current = header[2] === 'predicate' ? header[1] : null; continue; }
    const phrase = /^\s+(?:label|alias)\s+[a-z]{2,3}\s+("(?:\\.|[^"\\])*")/.exec(line);
    if (current && phrase) phrases.set(fold(JSON.parse(phrase[1])), current);
  }
  return phrases;
}

/**
 * The ontology text with every applicable evaluation synonym added as an English alias of its predicate block.
 * Returns {ontology, added: [{predicate, phrase}], conflicts: [{predicate, phrase, declaredFor}]}.
 */
export function tolerantOntology(ontology, rowSynonyms = {}) {
  const declared = declaredPhrases(ontology);
  const merged = {};
  for (const source of [relationSynonyms(), rowSynonyms ?? {}]) for (const [id, list] of Object.entries(source)) merged[id] = [...(merged[id] ?? []), ...list];
  const added = [], conflicts = [];
  const text = String(ontology).split('\n');
  const out = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    for (const phrase of merged[current] ?? []) {
      const owner = declared.get(fold(phrase));
      if (owner && owner !== current) { conflicts.push({predicate: current, phrase, declaredFor: owner}); continue; }
      if (owner === current) continue;
      out.push(`  alias en ${JSON.stringify(phrase)}`);
      declared.set(fold(phrase), current);
      added.push({predicate: current, phrase});
    }
    current = null;
  };
  for (const line of text) {
    const header = /^@([A-Za-z][A-Za-z0-9_]*)\s+(\w+)/.exec(line);
    if (header || !line.trim()) flush();
    if (header && header[2] === 'predicate') current = header[1];
    out.push(line);
  }
  flush();
  return {ontology: out.join('\n'), added, conflicts};
}
