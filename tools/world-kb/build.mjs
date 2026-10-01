/**
 * Builds the world-v1 knowledge circuits from the cached Wikidata responses (datasets_sources/world-kb/raw/), mechanically:
 * every mapping row (mapping.mjs) becomes a predicate and one fact per value, with `source "Wikidata <item> <property>"`.
 * Output: datasets_sources/world-kb/circuits/NNNN-<name>.sop (each below the parser's 2,048-wire limit) and build-stats.json.
 *   node tools/world-kb/build.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {RAW, qid} from './wdqs.mjs';
import {MAPPING, DERIVED, CLASSES} from './mapping.mjs';
import {loadSelection, referencedIds, SELECT} from './fetch.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'datasets_sources', 'world-kb', 'circuits');
const MAX_WIRES = 1900;
const readRows = name => JSON.parse(fs.readFileSync(path.join(RAW, name), 'utf8')).rows;
const files = prefix => fs.readdirSync(RAW).filter(f => f.startsWith(prefix) && f.endsWith('.json')).sort();

const selection = loadSelection();
const classOf = new Map(); // item -> selection class keys
for (const [k, ids] of Object.entries(selection)) for (const id of ids) (classOf.get(id) ?? classOf.set(id, new Set()).get(id)).add(k);

// ---- labels and symbols -------------------------------------------------------------------------------------------
const info = new Map(); // qid -> {en, ro, desc, sitelinks}
for (const f of files('label-')) for (const r of readRows(f)) {
  const id = qid(r.i);
  const cur = info.get(id) ?? {en: null, ro: null, desc: null, sitelinks: 0};
  cur.en ??= r.en ?? null; cur.ro ??= r.ro ?? null; cur.desc ??= r.d ?? null; cur.sitelinks = Math.max(cur.sitelinks, Number(r.s) || 0);
  info.set(id, cur);
}
const slug = text => text.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[øØ]/g, 'o').replace(/[æÆ]/g, 'ae').replace(/ł|Ł/g, 'l').replace(/đ|Đ/g, 'd')
  .toLowerCase().replace(/&/g, ' and ').replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const predicateNames = new Set([...MAPPING.map(m => m.pred), ...DERIVED.map(d => d.pred), 'lived_years', 'likely_speaks', 'does_not_speak']);
const reserved = id => predicateNames.has(id) || /^(x_|wd\d|r_|d_)/.test(id) || /^wd/.test(id);
const symbolOf = new Map();
const byslug = new Map();
for (const [id, i] of info) {
  if (!i.en) continue;
  let s = slug(i.en);
  if (!s || !/^[a-z]/.test(s)) s = s ? `n_${s}` : '';
  if (!s) continue;
  (byslug.get(s) ?? byslug.set(s, []).get(s)).push(id);
}
for (const [s, ids] of byslug) {
  ids.sort((a, b) => info.get(b).sitelinks - info.get(a).sitelinks || Number(a.slice(1)) - Number(b.slice(1)));
  ids.forEach((id, k) => symbolOf.set(id, k === 0 && !reserved(s) ? s : `${s}_${id.toLowerCase()}`));
}
const sym = id => symbolOf.get(id) ?? null;

// ---- facts ---------------------------------------------------------------------------------------------------------
const quote = s => JSON.stringify(String(s).replace(/\s+/g, ' ').trim());
const facts = new Map(); // dedupe key -> {pred, args, source}
const stats = {skipped_unlabelled: 0, skipped_range: 0, dedup: 0, by_predicate: {}};
function add(pred, args, source) {
  const key = pred + ' ' + args.join(' ');
  if (facts.has(key)) { stats.dedup++; return; }
  facts.set(key, {pred, args, source});
  stats.by_predicate[pred] = (stats.by_predicate[pred] ?? 0) + 1;
}
const order = (m, subject, value) => (m.flip ? [value, subject] : [subject, value]);
const inScope = (m, id) => m.scope.some(c => classOf.get(id)?.has(c));

// property rows grouped by pid
const rowsByPid = new Map();
for (const f of files('prop-P')) {
  const pid = f.match(/^prop-(P\d+)-/)[1];
  if (pid === 'P31') continue;
  (rowsByPid.get(pid) ?? rowsByPid.set(pid, []).get(pid)).push(...readRows(f));
}
const isoYear = v => { const m = String(v).match(/^(-?\d{1,6})-(\d\d)-(\d\d)T/); return m ? {year: Number(m[1]), month: m[2], day: m[3]} : null; };
for (const m of MAPPING) {
  for (const r of rowsByPid.get(m.pid) ?? []) {
    const id = qid(r.s);
    if (!inScope(m, id) || !sym(id)) continue;
    const source = quote(`Wikidata ${id} ${m.pid}`);
    if (m.kind === 'entity') {
      const o = qid(r.v);
      if (!r.v.startsWith('http://www.wikidata.org/entity/Q')) continue;
      if (m.only && !m.only.includes(o)) continue;
      if (!sym(o)) { stats.skipped_unlabelled++; continue; }
      add(m.pred, order(m, sym(id), sym(o)), source);
    } else if (m.kind === 'integer') {
      const n = Math.round(Number(r.v));
      if (!Number.isSafeInteger(n) || (m.pred === 'atomic_number' && (n < 1 || n > 118)) || (m.pred === 'population' && n < 0)) { stats.skipped_range++; continue; }
      add(m.pred, order(m, sym(id), String(n)), source);
    } else if (m.kind === 'text') {
      add(m.pred, order(m, sym(id), quote(r.v)), source);
    } else if (m.kind === 'year' || m.kind === 'date') {
      const t = isoYear(r.v);
      const pr = Number(r.pr);
      if (!t || pr < 9) { stats.skipped_range++; continue; }
      if (m.kind === 'year') { add(m.pred, [sym(id), String(t.year)], source); continue; }
      if (pr < 11 || t.year < 1 || t.year > 9999) continue;
      add(m.pred, [sym(id), `${String(t.year).padStart(4, '0')}-${t.month}-${t.day}`], source);
    }
  }
}
// is_a (curated classes), labels, descriptions, sitelinks
for (const f of files('prop-P31-')) for (const r of readRows(f)) {
  const id = qid(r.s), c = qid(r.v);
  if (sym(id) && sym(c)) add('is_a', [sym(id), sym(c)], quote(`Wikidata ${id} P31`));
}
const selected = new Set(classOf.keys());
for (const id of selected) {
  const i = info.get(id);
  if (!i || !sym(id)) continue;
  add('label_en', [sym(id), quote(i.en)], quote(`Wikidata ${id} label`));
  if (i.ro) add('label_ro', [sym(id), quote(i.ro)], quote(`Wikidata ${id} label`));
  if (i.desc) add('description_en', [sym(id), quote(i.desc)], quote(`Wikidata ${id} description`));
  add('sitelinks', [sym(id), String(i.sitelinks)], quote(`Wikidata ${id} sitelinks`));
}
// referenced items (birthplaces, occupations, ...) get their labels too, so that a question can name them
for (const id of referencedIds(selection)) {
  if (selected.has(id)) continue;
  const i = info.get(id);
  if (!i || !sym(id) || !facts.size) continue;
  const used = true;
  if (!used) continue;
  add('label_en', [sym(id), quote(i.en)], quote(`Wikidata ${id} label`));
  if (i.ro) add('label_ro', [sym(id), quote(i.ro)], quote(`Wikidata ${id} label`));
}

// ---- circuits ------------------------------------------------------------------------------------------------------
fs.rmSync(OUT, {recursive: true, force: true});
fs.mkdirSync(OUT, {recursive: true});
const roleText = r => r.map(([a, b]) => `${a}:${b}`).join(' ');
const allPreds = new Map();
for (const m of MAPPING) if (!allPreds.has(m.pred)) allPreds.set(m.pred, {roles: m.roles, notes: [], pids: []});
for (const m of MAPPING) { const p = allPreds.get(m.pred); p.pids.push(m.pid); if (m.note) p.notes.push(m.note); }
for (const d of DERIVED) allPreds.set(d.pred, {roles: d.roles, notes: [d.note], pids: [d.source]});
const extra = [
  ['lived_years', [['subject', 'entity'], ['object', 'integer']], 'derived by rule r_lived_years: death year minus birth year (approximate: whole years from the two years)'],
  ['likely_speaks', [['subject', 'entity'], ['object', 'entity']], 'defeasible: a citizen usually speaks an official language of the country (hand-written default d_citizen_speaks, not a Wikidata statement)'],
  ['does_not_speak', [['subject', 'entity'], ['object', 'entity']], 'strict exception to d_citizen_speaks; no fact in world-v1 states it'],
];
for (const [p, roles, d] of extra) allPreds.set(p, {roles, notes: [d], pids: []});
let vocab = '# world-v1 vocabulary: one predicate per mapped Wikidata property, then a few hand-written rules. Nothing is closed (Wikidata is open-world).\n\n';
for (const [name, p] of allPreds) {
  const pid = [...new Set(p.pids)].join(', ');
  const desc = [pid ? `Wikidata ${pid}` : 'derived', ...new Set(p.notes)].join('; ').replace(/"/g, "'");
  vocab += `@${name} predicate\n  args ${roleText(p.roles)}\n${name === 'located_in' ? '  transitive true\n' : ''}  description ${quote(desc)}\n\n`;
}
vocab += `# Hand-written rules (source "world-v1 hand-written"): what Wikidata statements imply, no more.
@r_capital_located rule
  when capital_of ?city ?country
  then located_in ?city ?country
  source "world-v1 hand-written: the capital of a country is located in it"

@r_located_trans rule
  when located_in ?a ?b
  when located_in ?b ?c
  then located_in ?a ?c
  source "world-v1 hand-written: located in is transitive"

@r_born_in_container rule
  when born_in ?p ?place
  when located_in ?place ?country
  then born_in ?p ?country
  source "world-v1 hand-written: born in a place located in a country is born in that country"

@r_died_in_container rule
  when died_in ?p ?place
  when located_in ?place ?country
  then died_in ?p ?country
  source "world-v1 hand-written: died in a place located in a country died in that country"

@r_lived_years rule
  when birth_year ?p ?b
  when death_year ?p ?d
  compute ?years ?d minus ?b
  then lived_years ?p ?years
  source "world-v1 hand-written: years lived from birth year and death year"

@d_citizen_speaks default
  when citizen_of ?p ?country
  when official_language_of ?lang ?country
  then likely_speaks ?p ?lang
  except does_not_speak ?p ?lang
  source "world-v1 hand-written: a citizen usually speaks an official language of the country"
`;
const written = [];
const write = (name, text) => { const n = String(written.length + 1).padStart(4, '0'); fs.writeFileSync(path.join(OUT, `${n}-${name}.sop`), text); written.push(`${n}-${name}.sop`); };
write('vocabulary-and-rules', vocab);

// facts grouped by predicate, in vocabulary order, chunked
let counter = 0;
const byPred = new Map();
for (const f of facts.values()) (byPred.get(f.pred) ?? byPred.set(f.pred, []).get(f.pred)).push(f);
const order = [...allPreds.keys()].filter(p => byPred.has(p));
for (const p of order) {
  const list = byPred.get(p);
  for (let i = 0, part = 1; i < list.length; i += MAX_WIRES, part++) {
    let text = '';
    for (const f of list.slice(i, i + MAX_WIRES)) text += `@wd${++counter} fact\n  holds ${f.pred} ${f.args.join(' ')}\n  source ${f.source}\n\n`;
    write(`facts-${p}-${String(part).padStart(2, '0')}`, text);
  }
}
const bytes = written.reduce((a, f) => a + fs.statSync(path.join(OUT, f)).size, 0);
Object.assign(stats, {facts: facts.size, circuits: written.length, bytes, entities_selected: selected.size, symbols: symbolOf.size,
  per_class: Object.fromEntries(Object.entries(selection).map(([k, v]) => [k, v.length])), predicates: allPreds.size});
fs.writeFileSync(path.join(ROOT, 'datasets_sources', 'world-kb', 'build-stats.json'), JSON.stringify(stats, null, 2));
console.log(JSON.stringify({facts: stats.facts, circuits: stats.circuits, MB: (bytes / 1e6).toFixed(1), selected: stats.entities_selected, skipped_unlabelled: stats.skipped_unlabelled}));

// Entity table for the host ontology (ontology.mjs): only items that appear in a fact or are selected.
const used = new Set();
for (const f of facts.values()) for (const a of f.args) if (/^[a-z]/.test(a)) used.add(a);
const table = {};
for (const [id, s] of symbolOf) if (used.has(s)) { const i = info.get(id); table[s] = {qid: id, en: i.en, ro: i.ro, desc: i.desc, sitelinks: i.sitelinks, plain: s === slug(i.en), classes: [...(classOf.get(id) ?? [])]}; }
fs.writeFileSync(path.join(ROOT, 'datasets_sources', 'world-kb', 'entities.json'), JSON.stringify(table));
