#!/usr/bin/env node
/**
 * Maintenance CLI of the host bilingual (Romanian-English) and synonym dictionary (sop/dictionary.mjs, DS021
 * "Content words: host normalization and translation"). Sources live in config/dictionary/ (manifest.json).
 *
 *   node tools/dictionary.mjs seed-generator                 write generator.tsv from the DS022 generator lexicon
 *   node tools/dictionary.mjs import-wiktionary [--source <kaikki jsonl>] [--limit-forms <n>]
 *                                                            write wiktionary.tsv and the cache's provenance.json
 *   node tools/dictionary.mjs add --pos P --en "a|b" --ro "c|d" [--id ID] [--forms "x|def:y"] [--note text]
 *                                                            append a reviewed entry to manual.tsv
 *   node tools/dictionary.mjs propose --pos P --en "..." --ro "..." [--id ID] [--forms ...] --note "found in eval row X"
 *                                                            append a pending proposal to review.tsv (not loaded)
 *   node tools/dictionary.mjs review                         list pending proposals
 *   node tools/dictionary.mjs approve <id>                   move a proposal from review.tsv to manual.tsv
 *   node tools/dictionary.mjs reject <id>                    remove a proposal from review.tsv
 *   node tools/dictionary.mjs compile                        compile and cache; print counts and the digest
 *   node tools/dictionary.mjs check                          parse every source; report duplicate ids and conflicts
 *   node tools/dictionary.mjs lookup <text> [--kind relation|value]
 *
 * Every command accepts `--dir <dir>` to operate on another dictionary directory (tests, scratch copies).
 * `--limit-forms <n>` caps the Romanian forms kept per Wiktionary entry (default: every selected form).
 * Exit code 1 on a usage error, a parse error (`check`) or a refused edit.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import {fileURLToPath} from 'node:url';
import {parseTsv, formatTsv, readManifest, sourceFiles, compileDictionary, Dictionary, DICTIONARY_DIR, POS, fold} from '../sop/dictionary.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIKTIONARY_DIR = path.join(ROOT, 'datasets_sources', 'wiktionary-ro');
const WIKTIONARY_FILE = 'kaikki.org-dictionary-Romanian.jsonl';
const WIKTIONARY_URL = 'https://kaikki.org/dictionary/Romanian/kaikki.org-dictionary-Romanian.jsonl';

const USAGE = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, '').trim();

/** Parse argv into positionals and `--flag value` options. */
function parseArgs(argv) {
  const out = {_: []};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { out._.push(arg); continue; }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw Error(`missing value for ${arg}`);
    out[arg.slice(2)] = value; i++;
  }
  return out;
}

/** An ASCII slug for ids: folded, non-id characters replaced by `_`. */
export const slug = text => fold(text).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'x';
const uniq = list => { const seen = new Set(); return list.filter(item => { const key = fold(item); if (!item || seen.has(key)) return false; seen.add(key); return true; }); };
const entry = (id, pos, en, ro, forms = [], note = '') => ({id, pos, en: uniq(en), ro: uniq(ro), forms: uniq(forms), note});

// ---------------------------------------------------------------------------------------------- generator seed

/** Romanian surfaces of a construction's statement forms (`s`, `sp`) without slots: "lucrează la", "a lucrat la". */
function constructionForms(construction) {
  // Gender slots of one role agree with each other ("l-a coordonat pe" / "a coordonat-o pe"), so they expand together.
  const expand = template => {
    const role = template.match(/\{g:([SO]):/)?.[1];
    if (!role) return [template];
    const slot = new RegExp(`\\{g:${role}:([^:}]*):([^}]*)\\}`, 'g');
    return [...expand(template.replace(slot, (_, m) => m)), ...expand(template.replace(slot, (_, m, f) => f))];
  };
  const out = [];
  for (const key of ['s', 'sp']) for (const template of construction.forms?.[key] ?? []) for (const text of expand(template)) {
    const surface = text.replace(/\{[SO]\}/g, ' ').replace(/\s+/g, ' ').trim();
    if (surface && fold(surface) !== fold(construction.rel)) out.push(surface);
  }
  return out;
}

const DEFINITE_HEAD = /(-ul|[a-zăâîșț]ul|le|a)$/;
/** Is a Romanian common-noun surface definite (its head word ends in a definite article)? */
export function isDefinite(text) {
  const head = String(text).split(' ')[0];
  if (/^\p{Lu}/u.test(head) && !/-ul$/.test(head)) return false;
  if (/^(un|o|niște)$/i.test(head)) return false;
  return DEFINITE_HEAD.test(head) && !/(ia|ua)-/.test(head) && !head.includes('-de-');
}
/** The indefinite lemma of a definite Romanian noun phrase, only where the ending rule is unambiguous; else null. */
export function lemmaOfDefinite(text) {
  const [head, ...rest] = String(text).split(' ');
  // A genitive modifier ("autobuzul școlii") needs "al/a" in the indefinite form: not derived.
  if (rest.length && /(ii|ei|ului|lor)$/.test(rest[0])) return null;
  let base = null;
  if (/-ul$/.test(head)) base = head.slice(0, -3);
  else if (/[bcdfgptv][lr]ul$/.test(head)) base = head.slice(0, -1);
  else if (/eul$/.test(head)) base = head.slice(0, -1);
  else if (/[bcdfghjklmnprstvxzșț]ul$/.test(head)) base = head.slice(0, -2);
  else if (/ia$/.test(head)) base = head.slice(0, -1) + 'e';
  else if (/ea$/.test(head)) base = head.slice(0, -1);
  else if (/[bcdfghjklmnprstvxzșț]a$/.test(head)) base = head.slice(0, -1) + 'ă';
  return base ? [base, ...rest].join(' ') : null;
}
const stripEnArticle = text => text.replace(/^(?:the|a|an) /, '');
const stripRoArticle = text => text.replace(/^(?:un|o) /, '');

/** Entries of the generator lexicon: relation synsets, pooled common nouns, kinship nouns and months. */
export async function generatorEntries() {
  const {PREDICATES, ENTITY_POOLS} = await import('./datasets/diversity/domains.mjs');
  const {RO_RELATION_EN, RO_CONSTRUCTION_EN, translationPairs} = await import('./datasets/diversity/english.mjs');
  const {MONTHS} = await import('./datasets/diversity/frames.mjs');
  const relations = [];
  for (const [id, spec] of Object.entries(PREDICATES)) {
    for (const converse of [false, true]) {
      const en = spec.en.filter(c => !c.oodOnly && c.converse === converse).map(c => c.rel);
      const roCons = spec.ro.filter(c => !c.oodOnly && c.converse === converse);
      const ro = roCons.map(c => c.rel);
      const forms = roCons.flatMap(constructionForms);
      en.push(...roCons.map(c => RO_CONSTRUCTION_EN[`${id}.${c.id}`]).filter(Boolean));
      if (!converse) { en.push(...(spec.senseAliases?.en ?? [])); ro.push(...(spec.senseAliases?.ro ?? [])); }
      if (!en.length && !ro.length) continue;
      relations.push(entry(`rel:${id}${converse ? '__converse' : ''}`, 'relation', en, ro, forms, `generator predicate ${id}${converse ? ' (converse orientation)' : ''}`));
    }
  }
  // RO_RELATION_EN: a Romanian phrase already in a synset adds its English; otherwise it joins every synset holding
  // its English phrase, or becomes its own entry grouped by the English phrase.
  const own = new Map();
  for (const [roPhrase, enPhrase] of Object.entries(RO_RELATION_EN)) {
    const holders = relations.filter(e => e.ro.some(s => fold(s) === fold(roPhrase)));
    if (holders.length) { for (const e of holders) if (!e.en.some(s => fold(s) === fold(enPhrase))) e.en.push(enPhrase); continue; }
    const byEnglish = relations.filter(e => e.en.some(s => fold(s) === fold(enPhrase)));
    if (byEnglish.length) { for (const e of byEnglish) e.ro.push(roPhrase); continue; }
    if (!own.has(enPhrase)) own.set(enPhrase, []);
    own.get(enPhrase).push(roPhrase);
  }
  const ids = new Set(relations.map(e => e.id));
  for (const [enPhrase, roPhrases] of own) {
    let id = `rel:${slug(enPhrase)}`;
    for (let n = 2; ids.has(id); n++) id = `rel:${slug(enPhrase)}:${n}`;
    ids.add(id);
    relations.push(entry(id, 'relation', [enPhrase], roPhrases, [], 'generator RO_RELATION_EN phrase outside the predicate synsets'));
  }
  // Pooled common nouns (merged by English label across pools).
  const nouns = new Map();
  for (const [type, pool] of Object.entries(ENTITY_POOLS)) for (const [enLabel, roLabel] of pool) {
    const english = /^\p{Lu}/u.test(enLabel) ? enLabel : stripEnArticle(enLabel);
    const romanian = stripRoArticle(roLabel);
    if (fold(romanian) === fold(english)) continue;
    const key = fold(english);
    if (!nouns.has(key)) nouns.set(key, {english, ro: [], forms: [], types: new Set(), derived: false});
    const item = nouns.get(key);
    item.types.add(type);
    if (type !== 'work' && isDefinite(romanian)) {
      item.forms.push('def:' + romanian);
      const lemma = lemmaOfDefinite(romanian);
      if (lemma) { item.ro.push(lemma); item.derived = true; }
    } else item.ro.push(romanian);
  }
  const nounEntries = [...nouns.values()].map(item => {
    const pos = item.english.includes(' ') || item.types.has('work') ? 'phrase' : 'noun';
    const note = `generator ENTITY_POOLS ${[...item.types].join(',')}${item.derived ? '; lemma derived from the definite form' : ''}`;
    return entry(`gen:${pos}:${slug(item.english)}`, pos, [item.english], item.ro, item.forms, note);
  });
  // Kinship nouns and months: the tail of translationPairs() after the pools and the twelve months.
  const pairs = translationPairs();
  const poolCount = Object.values(ENTITY_POOLS).reduce((n, pool) => n + pool.length, 0);
  const kin = new Map();
  for (const [enWord, form] of pairs.slice(poolCount + 12)) { if (!kin.has(enWord)) kin.set(enWord, []); kin.get(enWord).push(form); }
  const kinship = [...kin].map(([enWord, [lemma, ...definite]]) => {
    const feminine = definite.map(lemmaOfDefinite).filter(l => l && fold(l) !== fold(lemma) && /ă$/.test(l));
    const en = enWord === 'neighbour' ? ['neighbour', 'neighbor'] : [enWord];
    return entry(`gen:kin:${slug(enWord)}`, 'noun', en, [lemma, ...feminine], definite.map(f => 'def:' + f), 'generator KINSHIP (first-person values)');
  });
  const months = MONTHS.en.map((month, i) => entry(`gen:month:${slug(month)}`, 'noun', [month], [MONTHS.ro[i]], [], 'generator MONTHS'));
  return [...relations, ...nounEntries, ...kinship, ...months];
}

// ------------------------------------------------------------------------------------------ wiktionary import

const KEEP_POS = new Set(['verb', 'noun', 'adj', 'adv', 'prep', 'conj', 'pron', 'det', 'num']);
const DROP_SENSE_TAGS = new Set(['obsolete', 'archaic', 'rare', 'dated', 'slang', 'vulgar', 'regional', 'Cyrillic', 'abbreviation', 'derogatory', 'offensive']);
const FORM_OF_GLOSS = /^(alternative|obsolete|archaic|dated|nonstandard|misspelling|eye dialect|pronunciation|superseded|rare|informal)?\s*(form|spelling|inflection|plural|singular|feminine|masculine|definite|indefinite|genitive|dative|vocative|accusative|nominative|participle|gerund|diminutive|augmentative|abbreviation|contraction|initialism|synonym)[^,;]* of\b/i;
const LATIN = /^[\p{Script=Latin}'’ -]+$/u;
const CANDIDATE = /^[a-z][a-z' -]*$/;

/** English candidates of a gloss: parentheses removed, split on `,`/`;`, 1-3 plain lower-case words. */
export function glossCandidates(gloss, pos) {
  let text = String(gloss).replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ').replace(/[“”"]/g, '');
  const out = [];
  for (let part of text.split(/[;,]/)) {
    part = part.replace(/\s+/g, ' ').trim().replace(/[.:!?]+$/, '').trim();
    if (pos === 'verb') part = part.replace(/^to /, '');
    if (pos === 'noun') part = part.replace(/^(?:a|an|the) /, '');
    if (!CANDIDATE.test(part)) continue;
    const words = part.split(' ');
    if (words.length < 1 || words.length > 3 || words.some(w => !w || /^[-']|[-']$/.test(w))) continue;
    out.push(part);
  }
  return out;
}

const has = (tags, ...wanted) => wanted.every(tag => tags.includes(tag));
const hasAny = (tags, ...wanted) => wanted.some(tag => tags.includes(tag));
/** Form slots per part of speech: [name, predicate(tags), definite]. The first form matching a slot wins. */
const FORM_SLOTS = {
  noun: [
    ['sg', t => has(t, 'singular', 'indefinite') && !hasAny(t, 'genitive', 'dative', 'vocative'), false],
    ['sgd', t => has(t, 'singular', 'definite') && !hasAny(t, 'genitive', 'dative', 'vocative'), true],
    ['pl', t => has(t, 'plural') && !hasAny(t, 'definite', 'genitive', 'dative', 'vocative'), false],
    ['pld', t => has(t, 'plural', 'definite') && !hasAny(t, 'genitive', 'dative', 'vocative'), true],
  ],
  verb: [
    ['inf', t => has(t, 'infinitive'), false],
    ['p1', t => has(t, 'present', 'first-person', 'singular') && !hasAny(t, 'subjunctive', 'imperative', 'colloquial'), false],
    ['p3', t => has(t, 'present', 'third-person', 'singular') && !hasAny(t, 'subjunctive', 'imperative', 'colloquial'), false],
    ['p3pl', t => has(t, 'present', 'third-person', 'plural') && !hasAny(t, 'subjunctive', 'imperative', 'colloquial'), false],
    ['pp', t => has(t, 'participle', 'past'), false],
    ['ger', t => has(t, 'gerund'), false],
  ],
  adj: [
    ['msg', t => has(t, 'masculine', 'singular') && !hasAny(t, 'definite', 'genitive', 'dative', 'vocative'), false],
    ['fsg', t => has(t, 'feminine', 'singular') && !hasAny(t, 'definite', 'genitive', 'dative', 'vocative'), false],
    ['mpl', t => has(t, 'masculine', 'plural') && !hasAny(t, 'definite', 'genitive', 'dative', 'vocative'), false],
    ['fpl', t => has(t, 'feminine', 'plural') && !hasAny(t, 'definite', 'genitive', 'dative', 'vocative'), false],
  ],
};

/** Selected Romanian forms of a kaikki entry (definite ones prefixed `def:`). */
function selectForms(record, pos) {
  const slots = FORM_SLOTS[pos];
  if (!slots) return [];
  const multi = record.word.includes(' ');
  const out = [], filled = new Set();
  for (const {form, tags = []} of record.forms ?? []) {
    if (!form || hasAny(tags, 'table-tags', 'inflection-template', 'canonical', 'obsolete', 'archaic', 'rare', 'Cyrillic', 'alternative')) continue;
    let surface = form.trim();
    if (pos === 'verb') surface = surface.replace(/^a /, '');
    if (!surface || !LATIN.test(surface) || surface === '-' || (!multi && surface.includes(' '))) continue;
    for (const [name, test, definite] of slots) {
      if (filled.has(name) || !test(tags)) continue;
      filled.add(name);
      if (surface.normalize('NFC') !== record.word.normalize('NFC')) out.push(definite ? 'def:' + surface : surface);
      break;
    }
  }
  return out;
}

/** Is a sense a form-of / alternative-form sense? Returns the lemma it points to (or '' when unknown), else null. */
function formOfTarget(sense) {
  const target = sense.form_of?.[0]?.word ?? sense.alt_of?.[0]?.word;
  if (target !== undefined) return target;
  const gloss = sense.glosses?.at(-1) ?? '';
  return FORM_OF_GLOSS.test(gloss) || hasAny(sense.tags ?? [], 'form-of', 'alt-of') ? '' : null;
}

/** Does a form-of sense name an inflection of the kept set (nominative-accusative; indicative present/participle)? */
function keptInflection(pos, tags) {
  if (hasAny(tags, 'genitive', 'dative', 'vocative') && !tags.includes('nominative')) return false;
  if (pos === 'verb' && hasAny(tags, 'pluperfect', 'perfect', 'imperfect', 'subjunctive', 'imperative', 'second-person', 'future', 'conditional')) return false;
  return true;
}

/** Stream the kaikki JSONL and build wiktionary entries. */
export async function wiktionaryEntries(source, {limitForms = Infinity} = {}) {
  const lemmas = [], formOf = [];
  const rl = readline.createInterface({input: fs.createReadStream(source), crlfDelay: Infinity});
  for await (const line of rl) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    if (record.lang_code !== 'ro' || !KEEP_POS.has(record.pos) || !record.word || !LATIN.test(record.word)) continue;
    if (/^\p{Lu}/u.test(record.word) || /^-|-$/.test(record.word)) continue;
    const en = [];
    let lemmaSenses = 0;
    for (const sense of record.senses ?? []) {
      const tags = sense.tags ?? [];
      const target = formOfTarget(sense);
      if (target !== null) {
        if (target && !hasAny(tags, 'obsolete', 'archaic', 'dated', 'Cyrillic', 'abbreviation', 'diminutive', 'augmentative', 'misspelling') && keptInflection(record.pos, tags))
          formOf.push({word: record.word, pos: record.pos, lemma: target, definite: tags.includes('definite')});
        continue;
      }
      if (hasAny(tags, ...DROP_SENSE_TAGS) || tags.includes('no-gloss')) continue;
      const gloss = sense.glosses?.at(-1);
      if (!gloss) continue;
      lemmaSenses++;
      for (const candidate of glossCandidates(gloss, record.pos)) if (!en.includes(candidate)) en.push(candidate);
    }
    if (!lemmaSenses || !en.length) continue;
    lemmas.push({word: record.word, pos: record.pos, en: en.slice(0, 4), forms: selectForms(record, record.pos)});
  }
  // Form-of words become forms of their lemma entries (same part of speech) when the lemma is known.
  const byLemma = new Map();
  for (const item of lemmas) { const key = item.pos + '\t' + item.word; if (!byLemma.has(key)) byLemma.set(key, []); byLemma.get(key).push(item); }
  let attached = 0;
  for (const {word, pos, lemma, definite} of formOf) {
    const targets = byLemma.get(pos + '\t' + lemma);
    if (!targets || word === lemma || (!lemma.includes(' ') && word.includes(' '))) continue;
    for (const item of targets) {
      if (item.forms.some(f => f.replace(/^def:/, '') === word)) continue;
      item.forms.push(definite ? 'def:' + word : word); attached++;
    }
  }
  const ids = new Map();
  const entries = lemmas.map(item => {
    const base = `wkt:${item.pos}:${slug(item.word).replace(/_/g, '-')}`;
    const n = (ids.get(base) ?? 0) + 1; ids.set(base, n);
    return entry(n === 1 ? base : `${base}:${n}`, item.pos, item.en, [item.word], item.forms.slice(0, limitForms), '');
  });
  return {entries, attached, formOf: formOf.length};
}

const WIKTIONARY_HEADER = [
  'ChatSOP host dictionary: Romanian-English entries extracted from English Wiktionary.',
  'Source: the Romanian section of English Wiktionary (https://en.wiktionary.org/), via kaikki.org / wiktextract',
  `(${WIKTIONARY_URL}).`,
  'Licence: CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/) and GFDL; attribution: English Wiktionary contributors.',
  'Modified: filtered (parts of speech, sense tags, form-of senses) and reformatted into ChatSOP TSV by',
  '`node tools/dictionary.mjs import-wiktionary`. This file keeps the ShareAlike licence; see docs/specs/DS014-source-rights.md.',
].join('\n');

const sha256File = file => new Promise((resolve, reject) => {
  const hash = crypto.createHash('sha256');
  fs.createReadStream(file).on('data', chunk => hash.update(chunk)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
});

async function importWiktionary(dir, options) {
  const source = path.resolve(options.source ?? path.join(WIKTIONARY_DIR, WIKTIONARY_FILE));
  if (!fs.existsSync(source)) throw Error(`missing ${source}; download ${WIKTIONARY_URL} into datasets_sources/wiktionary-ro/`);
  const limitForms = options['limit-forms'] ? Number(options['limit-forms']) : Infinity;
  const {entries, attached, formOf} = await wiktionaryEntries(source, {limitForms});
  const out = path.join(dir, 'wiktionary.tsv');
  const text = formatTsv(entries, WIKTIONARY_HEADER);
  parseTsv(text, out);
  fs.writeFileSync(out, text);
  const bytes = fs.statSync(out).size;
  console.log(`wrote ${path.relative(ROOT, out)}: ${entries.length} entries, ${bytes} bytes (${formOf} form-of senses, ${attached} attached as forms)`);
  if (path.dirname(source) === WIKTIONARY_DIR) {
    const stat = fs.statSync(source);
    const provenance = {
      retrieved_on: '2026-09-29',
      dataset: 'Romanian section of English Wiktionary, machine-readable extraction by wiktextract (kaikki.org)',
      license_notice: 'Wiktionary text is available under the Creative Commons Attribution-ShareAlike 4.0 licence (and the GFDL) per the Wikimedia Terms of Use; kaikki.org states that its extracted data is available under the same terms as Wiktionary.',
      attribution: 'English Wiktionary contributors; extraction by Tatu Ylonen, wiktextract (kaikki.org).',
      exported_derivative: 'config/dictionary/wiktionary.tsv only: filtered and reformatted lemma entries (English gloss candidates and selected Romanian forms), keeping CC BY-SA 4.0 with attribution and a modification notice. The raw dump stays in this local cache and is never exported.',
      files: [{
        path: WIKTIONARY_FILE, url: WIKTIONARY_URL, retrieved_on: '2026-09-29', bytes: stat.size, sha256: await sha256File(source),
        extraction: `node tools/dictionary.mjs import-wiktionary${Number.isFinite(limitForms) ? ` --limit-forms ${limitForms}` : ''}: lang_code ro; pos ${[...KEEP_POS].join(', ')}; senses tagged ${[...DROP_SENSE_TAGS].join('/')} dropped; form-of and alternative-form senses attached as forms of their lemma; English candidates of 1-3 plain lower-case words split from the last gloss, at most 4 per lemma; forms: noun nominative-accusative singular/plural indefinite and definite, verb infinitive, present 1sg/3sg/3pl, past participle, gerund, adjective masculine/feminine singular/plural`,
        output: {path: 'config/dictionary/wiktionary.tsv', entries: entries.length, bytes, sha256: await sha256File(out)},
      }],
    };
    fs.writeFileSync(path.join(WIKTIONARY_DIR, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
    console.log(`wrote ${path.relative(ROOT, path.join(WIKTIONARY_DIR, 'provenance.json'))}`);
  }
}

// ------------------------------------------------------------------------------------------ review workflow

const readSource = (file) => fs.existsSync(file) ? parseTsv(fs.readFileSync(file, 'utf8'), file) : [];
/** Leading `#` comment lines of a TSV file (kept on rewrite). */
const headerComment = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter((l, i, all) => l.startsWith('#') && all.slice(0, i).every(x => x.startsWith('#'))).map(l => l.replace(/^# ?/, '')).join('\n') : '';
const writeSource = (file, entries) => {
  const text = formatTsv(entries, headerComment(file));
  parseTsv(text, file);
  fs.writeFileSync(file, text);
};
const splitList = value => String(value ?? '').split('|').map(s => s.trim()).filter(Boolean);

function entryFromOptions(options, prefix) {
  if (!POS.includes(options.pos)) throw Error(`--pos must be one of ${POS.join(', ')}`);
  const en = splitList(options.en), ro = splitList(options.ro);
  if (!en.length && !ro.length) throw Error('an entry needs --en or --ro');
  const id = options.id ?? `${prefix}:${options.pos}:${slug(ro[0] ?? en[0]).replace(/_/g, '-')}`;
  const made = {id, pos: options.pos, en, ro, forms: splitList(options.forms), note: String(options.note ?? '').replace(/[\t\n]/g, ' ')};
  parseTsv(formatTsv([made]), 'entry');
  return made;
}
function allIds(dir) {
  const ids = new Set();
  for (const item of sourceFiles(dir)) for (const e of readSource(item.file)) ids.add(e.id);
  return ids;
}
function appendEntry(dir, fileName, made) {
  const file = path.join(dir, fileName);
  const existing = readSource(file);
  if (existing.some(e => e.id === made.id) || allIds(dir).has(made.id)) throw Error(`duplicate id ${made.id}`);
  writeSource(file, [...existing.map(strip), made]);
  console.log(`${fileName}: added ${made.id}`);
}
const strip = ({file, line, priority, source, ...rest}) => rest;
const reviewFile = dir => path.join(dir, readManifest(dir).review ?? 'review.tsv');

function moveProposal(dir, id, approve) {
  const file = reviewFile(dir);
  const pending = readSource(file);
  const found = pending.find(e => e.id === id);
  if (!found) throw Error(`no pending proposal ${id}`);
  if (approve) {
    const manual = sourceFiles(dir).find(item => item.source === 'manual')?.file ?? path.join(dir, 'manual.tsv');
    appendEntry(dir, path.relative(dir, manual), {...strip(found), id: found.id.replace(/^prop:/, 'man:')});
  }
  writeSource(file, pending.filter(e => e.id !== id).map(strip));
  console.log(`review.tsv: ${approve ? 'approved' : 'rejected'} ${id}`);
}

// ---------------------------------------------------------------------------------------------- check, compile

function check(dir) {
  let errors = 0;
  const all = [];
  for (const item of [...sourceFiles(dir), {file: reviewFile(dir), source: 'review', priority: Infinity}]) {
    if (!fs.existsSync(item.file)) { console.log(`${path.basename(item.file)}: missing`); continue; }
    try {
      const entries = readSource(item.file);
      console.log(`${path.basename(item.file)}: ${entries.length} entries`);
      if (item.source !== 'review') all.push(...entries.map(e => ({...e, source: item.source})));
    } catch (error) { errors++; console.log(`PARSE ERROR ${error.message}`); }
  }
  const byId = new Map();
  for (const e of all) { if (!byId.has(e.id)) byId.set(e.id, []); byId.get(e.id).push(e); }
  const duplicates = [...byId].filter(([, list]) => list.length > 1);
  console.log(`duplicate ids: ${duplicates.length}`);
  for (const [id, list] of duplicates.slice(0, 50)) console.log(`  ${id}: ${list.map(e => `${e.file}:${e.line}`).join(', ')}`);
  const roRelations = new Map();
  for (const e of all.filter(e => e.pos === 'relation')) for (const s of e.ro) { const key = fold(s); if (!roRelations.has(key)) roRelations.set(key, new Set()); roRelations.get(key).add(e.id); }
  const conflicts = [...roRelations].filter(([, ids]) => ids.size > 1);
  console.log(`conflicts (a Romanian surface in several relation entries): ${conflicts.length}`);
  for (const [surface, ids] of conflicts) console.log(`  "${surface}": ${[...ids].join(', ')}`);
  return errors;
}

function compile(dir) {
  const compiled = compileDictionary(dir, {cache: true});
  const bySource = {};
  for (const e of compiled.entries) bySource[e.source] = (bySource[e.source] ?? 0) + 1;
  console.log(`entries: ${compiled.entries.length} ${JSON.stringify(bySource)}`);
  console.log(`surfaces: ro ${Object.keys(compiled.ro).length}, en ${Object.keys(compiled.en).length}`);
  console.log(`digest: ${compiled.digest}`);
}

function lookup(dir, text, kind) {
  const dictionary = Dictionary.load(dir);
  const hits = dictionary.lookup(text);
  console.log(`lookup "${text}": ${hits.length ? '' : 'no entry'}`);
  for (const hit of hits) console.log(`  [${hit.entry.source}] ${hit.entry.id} ${hit.entry.pos} ${hit.language}/${hit.flag} en=${hit.entry.en.join('|')} ro=${hit.entry.ro.join('|')}`);
  for (const k of kind ? [kind] : ['relation', 'value']) console.log(`  candidates(${k}): ${JSON.stringify(dictionary.candidates(text, k))}`);
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const [command, ...rest] = options._;
  const dir = path.resolve(options.dir ?? DICTIONARY_DIR);
  switch (command) {
    case 'seed-generator': {
      const entries = await generatorEntries();
      const file = path.join(dir, 'generator.tsv');
      const text = formatTsv(entries, 'ChatSOP host dictionary: entries seeded from the DS022 generator lexicon (tools/datasets/diversity/).\nGenerated by `node tools/dictionary.mjs seed-generator`; do not edit by hand (add reviewed entries to manual.tsv).\nLicence: MIT (repository LICENSE); original ChatSOP authored text.');
      parseTsv(text, file);
      fs.writeFileSync(file, text);
      console.log(`wrote ${path.relative(ROOT, file) || file}: ${entries.length} entries (${entries.filter(e => e.pos === 'relation').length} relations)`);
      return 0;
    }
    case 'import-wiktionary': await importWiktionary(dir, options); return 0;
    case 'add': appendEntry(dir, 'manual.tsv', entryFromOptions(options, 'man')); return 0;
    case 'propose': {
      if (!options.note) throw Error('propose needs --note (where the gap was found)');
      appendEntry(dir, path.relative(dir, reviewFile(dir)), entryFromOptions(options, 'prop'));
      return 0;
    }
    case 'review': {
      const pending = readSource(reviewFile(dir));
      console.log(`${pending.length} pending proposal(s)`);
      for (const e of pending) console.log(`  ${e.id}\t${e.pos}\ten=${e.en.join('|')}\tro=${e.ro.join('|')}\tforms=${e.forms.join('|')}\t${e.note}`);
      return 0;
    }
    case 'approve': case 'reject':
      if (!rest[0]) throw Error(`${command} needs an id`);
      moveProposal(dir, rest[0], command === 'approve'); return 0;
    case 'compile': compile(dir); return 0;
    case 'check': return check(dir) ? 1 : 0;
    case 'lookup':
      if (!rest.length) throw Error('lookup needs a text');
      lookup(dir, rest.join(' '), options.kind); return 0;
    default:
      console.log(USAGE); return command ? 1 : 0;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }, error => { console.error(`error: ${error.message}`); process.exitCode = 1; });
}
