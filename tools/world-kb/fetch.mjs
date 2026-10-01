/**
 * Fetches the world-v1 subset from the Wikidata Query Service (CC0) into datasets_sources/world-kb/raw/ (gitignored).
 * Stages (all cached, so a rerun resumes): 1 selection of entities per class, 2 property values per mapping row,
 * 3 labels/descriptions/sitelinks of every selected or referenced item. CPU only, one request at a time, no LLM.
 *   node tools/world-kb/fetch.mjs [--stage select|props|labels|all] [--only <key>]
 */
import fs from 'node:fs';
import path from 'node:path';
import {sparql, qid, RAW} from './wdqs.mjs';
import {MAPPING, PEOPLE_OCCUPATIONS} from './mapping.mjs';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const stage = arg('--stage', 'all');
const only = arg('--only', null);
const v = list => list.map(q => `wd:${q}`).join(' ');

/** Item classes whose direct instances are selected (P31), with the notability floor (Wikipedia editions). */
export const SELECT = {
  country: {classes: ['Q3624078'], where: 'FILTER NOT EXISTS {?e wdt:P576 []}', min: 0},
  continent: {classes: ['Q5107'], min: 0},
  city: {classes: ['Q515', 'Q1549591', 'Q174844', 'Q1637706'], where: '?e wdt:P1082 ?pop. FILTER(?pop >= 300000)', min: 0},
  language: {classes: ['Q34770'], where: '?e wdt:P218 [].', min: 0},
  currency: {classes: ['Q8142'], where: '?e wdt:P498 []. FILTER NOT EXISTS {?e wdt:P582 []} FILTER NOT EXISTS {?e wdt:P576 []}', min: 0},
  element: {classes: ['Q11344'], where: '?e wdt:P1086 [].', min: 0},
  planet: {classes: ['Q634'], where: '?e wdt:P361 wd:Q544.', min: 0},
  company: {classes: ['Q4830453', 'Q891723', 'Q6881511', 'Q783794'], min: 55},
  university: {classes: ['Q3918', 'Q875538', 'Q902104'], min: 50},
  organization: {classes: ['Q484652', 'Q245065'], min: 60},
  literary_work: {classes: ['Q7725634', 'Q8261', 'Q25379', 'Q49084', 'Q1318295'], min: 55},
  film: {classes: ['Q11424'], min: 90},
  painting: {classes: ['Q3305213'], min: 60},
};
const PEOPLE_MIN = {physicist: 45, chemist: 45, mathematician: 45, biologist: 45, astronomer: 45, philosopher: 55, economist: 50, engineer: 60, inventor: 55,
  physician: 60, computer_scientist: 40, writer: 70, poet: 70, novelist: 60, playwright: 60, painter: 70, sculptor: 60, architect: 60, composer: 65,
  explorer: 40, politician: 90, monarch: 80, military_leader: 80, film_director: 70, actor: 110, singer: 110, theologian: 60, historian: 55};

const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);
const readRows = name => JSON.parse(fs.readFileSync(path.join(RAW, `${name}.json`), 'utf8')).rows;

async function selectEntities() {
  const out = {};
  for (const [key, c] of Object.entries(SELECT)) {
    if (only && only !== key) continue;
    const rows = await sparql(`select-${key}`, `SELECT ?e ?s WHERE { VALUES ?cls { ${v(c.classes)} } ?e wdt:P31 ?cls. ${c.where ?? ''} ?e wikibase:sitelinks ?s. FILTER(?s >= ${c.min}) }`);
    out[key] = [...new Map(rows.map(r => [qid(r.e), Number(r.s)])).keys()];
    log('select', key, out[key].length);
  }
  const people = new Map();
  for (const [name, q] of Object.entries(PEOPLE_OCCUPATIONS)) {
    if (only && only !== 'person' && only !== name) continue;
    const rows = await sparql(`select-person-${name}`, `SELECT ?e ?s WHERE { ?e wdt:P31 wd:Q5; wdt:P106 wd:${q}; wikibase:sitelinks ?s. FILTER(?s >= ${PEOPLE_MIN[name]}) }`, {timeoutMs: 120000});
    for (const r of rows) people.set(qid(r.e), Number(r.s));
    log('select person', name, rows.length, 'total', people.size);
  }
  out.person = [...people.keys()];
  return out;
}

/** The saved selection (rebuilt from the cached stage-1 files). */
export function loadSelection() {
  const out = {};
  for (const key of Object.keys(SELECT)) out[key] = [...new Set(readRows(`select-${key}`).map(r => qid(r.e)))];
  const people = new Set();
  for (const name of Object.keys(PEOPLE_OCCUPATIONS)) for (const r of readRows(`select-person-${name}`)) people.add(qid(r.e));
  out.person = [...people];
  return out;
}

const TIME_PIDS = new Set(MAPPING.filter(m => m.kind === 'year' || m.kind === 'date').map(m => m.pid));
const BATCH = 250;
function propQuery(pid, ids, only) {
  const sub = `VALUES ?s { ${v(ids)} }`;
  if (TIME_PIDS.has(pid)) return `SELECT ?s ?v ?pr WHERE { ${sub} ?s wdt:${pid} ?v. ?s p:${pid} ?st. ?st ps:${pid} ?v; psv:${pid}/wikibase:timePrecision ?pr. }`;
  const restrict = only ? `VALUES ?v { ${v(only)} }` : '';
  return `SELECT ?s ?v WHERE { ${sub} ${restrict} ?s wdt:${pid} ?v. }`;
}

async function fetchProps(selection) {
  const byPid = new Map();
  for (const m of MAPPING) {
    const g = byPid.get(m.pid) ?? {ids: new Set(), only: null};
    for (const c of m.scope) for (const id of selection[c] ?? []) g.ids.add(id);
    if (m.only) g.only = m.only;
    byPid.set(m.pid, g);
  }
  for (const [pid, g] of byPid) {
    if (only && only !== pid) continue;
    const ids = [...g.ids];
    for (let i = 0, n = 0; i < ids.length; i += BATCH, n++) {
      await sparql(`prop-${pid}-${String(n).padStart(3, '0')}`, propQuery(pid, ids.slice(i, i + BATCH), g.only));
    }
    log('props', pid, 'ids', ids.length);
  }
  // P31 restricted to the selection classes (is_a)
  const classes = [...new Set([...Object.values(SELECT).flatMap(c => c.classes), 'Q5'])];
  const all = [...new Set(Object.values(selection).flat())];
  for (let i = 0, n = 0; i < all.length; i += BATCH * 2, n++) {
    await sparql(`prop-P31-${String(n).padStart(3, '0')}`, `SELECT ?s ?v WHERE { VALUES ?s { ${v(all.slice(i, i + BATCH * 2))} } VALUES ?v { ${v(classes)} } ?s wdt:P31 ?v. }`);
  }
  log('props P31 ids', all.length);
}

/** Every item that is selected or used as a value. */
export function referencedIds(selection) {
  const ids = new Set(Object.values(selection).flat());
  for (const f of fs.readdirSync(RAW)) {
    if (!/^prop-P\d+-\d+\.json$/.test(f)) continue;
    for (const r of readRows(f.replace('.json', ''))) if (r.v?.startsWith('http://www.wikidata.org/entity/Q')) ids.add(qid(r.v));
  }
  for (const m of MAPPING) for (const q of m.only ?? []) ids.add(q);
  return [...ids];
}

async function fetchLabels(selection) {
  const ids = referencedIds(selection);
  for (let i = 0, n = 0; i < ids.length; i += 300, n++) {
    const batch = ids.slice(i, i + 300);
    await sparql(`label-${String(n).padStart(4, '0')}`, `SELECT ?i ?en ?ro ?d ?s WHERE { VALUES ?i { ${v(batch)} } ?i wikibase:sitelinks ?s. OPTIONAL { ?i rdfs:label ?en FILTER(lang(?en)="en") } OPTIONAL { ?i rdfs:label ?ro FILTER(lang(?ro)="ro") } OPTIONAL { ?i schema:description ?d FILTER(lang(?d)="en") } }`);
    if (n % 10 === 0) log('labels', i, '/', ids.length);
  }
  log('labels done', ids.length);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (stage === 'select' || stage === 'all') await selectEntities();
  const selection = loadSelection();
  if (stage === 'props' || stage === 'all') await fetchProps(selection);
  if (stage === 'labels' || stage === 'all') await fetchLabels(selection);
  log('done');
}
