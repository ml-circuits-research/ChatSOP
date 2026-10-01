#!/usr/bin/env node
/** Vocabulary coverage of the LanguageProofingLLM iteration-2 data: counts of the datasets_sources/language_backgen/TASK.md vocabulary list in the targets of
 * train (by source), dev, the held-out vocabulary dev, and of the Romanian sources of child/son/daughter and whether their targets carry the right relation.
 *
 *   node tools/datasets/language-proofing-v2-coverage.mjs      # writes eval/reports/current/language-proofing-it2/vocab-coverage.json
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT} from '../../lib/dataset-paths.mjs';
import {HELD_OUT} from './build-language-proofing-v2.mjs';

const DATA = path.resolve(ROOT, process.env.LP_DATA ?? 'datasets/bad_english/proofing-v2');
const OUT = path.resolve(ROOT, process.env.LP_EVIDENCE ?? 'eval/reports/current/language-proofing-it2', 'vocab-coverage.json');
const readJsonl = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const fold = t => String(t).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export const VOCAB = {
  family: 'parent child son daughter mother father sister brother grandparent grandchild cousin aunt uncle niece nephew spouse husband wife fiance in-law stepchild twin',
  work: 'boss manager employee colleague intern supervisor assistant contractor client supplier owner founder director coach player teacher student tutor doctor patient nurse lawyer landlord tenant neighbour member volunteer guest host',
  verbs: 'hire fire promote lend borrow rent own sell buy pay owe send receive deliver sign approve reject cancel postpone book visit attend organize lead join leave replace repair install check audit treat teach train sponsor publish translate review invite meet marry divorce adopt',
  places: 'boatyard shipyard warehouse clinic pharmacy bakery library museum stadium harbor airport courthouse garage greenhouse vineyard farm factory laboratory gym theater invoice contract permit certificate license receipt parcel laptop van tractor piano',
};
const re = w => new RegExp(`\\b${w === 'fiance' ? 'fianc[eé]e?' : w === 'in-law' ? 'in-laws?' : w}(s|es|ed|d|ing)?\\b`, 'i');
const RO = {child: /\b(copil|copilul|copilului|copii|copiii|copiilor|copila|copilei)\b/, son: /\b(fiul|fiului|fiu)\b/, daughter: /\b(fiica|fiicei|fiice)\b/};
const EN = {child: /\b(child|children|kid|kids)\b/i, son: /\bsons?\b/i, daughter: /\bdaughters?\b/i};

function main() {
  const audit = new Map(readJsonl(path.join(DATA, 'audit.jsonl')).map(a => [a.id, a]));
  const sets = {train: readJsonl(path.join(DATA, 'train.jsonl')), dev: readJsonl(path.join(DATA, 'dev.jsonl')), heldout: readJsonl(path.join(DATA, 'dev-heldout.jsonl')), reserve: readJsonl(path.join(DATA, 'reserve-heldout.jsonl'))};
  const groupOf = p => { const a = audit.get(p.id) ?? {}; return a.source === 'backgen' ? `backgen-${a.src}` : a.source === 'oversample' ? 'oversample' : a.source ?? 'it1'; };
  const table = {};
  for (const [cat, list] of Object.entries(VOCAB)) for (const w of list.split(' ')) {
    const r = re(w), row = {category: cat, held_out: HELD_OUT.some(h => w === h)};
    for (const [name, rows] of Object.entries(sets)) { row[name] = rows.filter(p => p.kind === 'repair' && r.test(p.target)).length; }
    row.train_by_source = {};
    for (const p of sets.train) if (p.kind === 'repair' && r.test(p.target)) { const g = groupOf(p); row.train_by_source[g] = (row.train_by_source[g] ?? 0) + 1; }
    row.train_identity = sets.train.filter(p => p.kind === 'identity' && r.test(p.target)).length;
    table[w] = row;
  }
  const relations = {};
  for (const [key, ro] of Object.entries(RO)) for (const name of ['train', 'dev', 'heldout']) {
    const rows = sets[name].filter(p => p.kind === 'repair' && p.language_kind !== 'noisy_en' && ro.test(fold(p.prompt)));
    const ok = rows.filter(p => EN[key].test(p.target)).length;
    (relations[key] ??= {})[name] = {romanian_source_pairs: rows.length, target_has_relation_word: ok, misaligned: rows.length - ok};
  }
  const en = {};
  for (const key of ['child', 'son', 'daughter']) en[key] = {train_targets: sets.train.filter(p => p.kind === 'repair' && EN[key].test(p.target)).length, train_distinct_targets: new Set(sets.train.filter(p => p.kind === 'repair' && EN[key].test(p.target)).map(p => p.target)).size, parent_targets: sets.train.filter(p => p.kind === 'repair' && /\bparents?\b/i.test(p.target)).length};
  const out = {generated_at: new Date().toISOString(), held_out_vocabulary: HELD_OUT, train_rows_counting_oversampled_copies: sets.train.length, words: table, romanian_sources_of_child_son_daughter: relations, english_targets: en,
    words_with_no_train_target: Object.entries(table).filter(([, r]) => !r.train && !r.train_identity).map(([w, r]) => `${w}${r.held_out ? ' (held out)' : ''}`)};
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log(JSON.stringify({family_child_son_daughter: ['child', 'son', 'daughter', 'parent'].map(w => [w, table[w].train, table[w].train_by_source]), relations, english_targets: en, words_with_no_train_target: out.words_with_no_train_target}, null, 1));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
