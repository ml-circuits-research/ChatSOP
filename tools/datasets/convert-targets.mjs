#!/usr/bin/env node
/**
 * Converter of formalizer targets written in the earlier target forms to the current SOP Lang model surface (DS021).
 * There is one current language (owner decision of 2026-09-29): corpora and sealed suites are converted where the
 * mapping is mechanical and regenerated otherwise. This tool performs the mechanical part and reports the rest; it
 * never guesses a reading.
 *
 * Mechanical conversions:
 *   - condition links: a target with queries and exactly one `stated … certainty supposed` wire, whose message has a
 *     conditional connective ("if", "dacă", "let's say", …), gets `if $<supposition>` on each query, when every query
 *     is obviously in the supposition's scope (one query, or a message whose only non-question sentence is the
 *     supposition leading its questions); otherwise the row is flagged for regeneration;
 *   - content words of Romanian and mixed rows: a relation phrase or value that the message does not mention is
 *     replaced by its unique Romanian source in the message: the generator's `source_relation` (surface_ir), the row
 *     lexicon (`ontology_sop` labels and aliases, which give the nominative surface), or the host dictionary
 *     (sop/dictionary.mjs) filtered to surfaces mentioned in the message (sop/linking.mjs `mentionedIn`). Without a
 *     unique source the English string is kept and the row carries the soft flag `content_not_normalized` (the host
 *     accepts English anyway). English rows keep their content.
 *
 * Rows flagged for regeneration (never converted, never written):
 *   - clause_in_value: a quoted value that holds a clause (a finite verb, a relative pronoun inside a noun phrase,
 *     or a subordinator introducing a finite clause: "before the cleaners arrive", "that was signed …");
 *   - connective_without_link: a causal, temporal, concessive or purpose connective joins two propositions of the
 *     target inside one sentence of the message and the target has no link;
 *   - supposition_partial_scope: a supposition whose scope over several queries the message does not make obvious.
 * Every converted target (and accepted alternative) must parse and pass `checkModelProgram`; a failure is reported
 * (`conversion_invalid`), and the row is not written. The heuristics are lexical and deliberately conservative; the
 * report lists the ids behind every count so a reviewer can check them.
 *
 *   node tools/datasets/convert-targets.mjs --in <file.jsonl> [--out <file.jsonl>] [--report <file.json>] [--dry-run]
 *
 * `--in` is a logical JSONL path (sharded files are read through lib/jsonl-shards.mjs). `--dry-run` writes only the
 * report. Rows need `question` (or `prompt`), `language` (en|ro|mixed) and `sop_target` (or `target`); an optional
 * `sop_targets_accepted` list is converted the same way.
 */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parse} from '../../sop/parser.mjs';
import {checkModelProgram} from '../../sop/declarative.mjs';
import {mentionedIn, normalizeTime} from '../../sop/linking.mjs';
import {defaultDictionary, fold} from '../../sop/dictionary.mjs';
import {readJsonlShardedSync, writeJsonlShardedSync} from '../../lib/jsonl-shards.mjs';

export const REGENERATION_REASONS = Object.freeze(['clause_in_value', 'connective_without_link', 'supposition_partial_scope']);
export const SOFT_FLAGS = Object.freeze(['content_not_normalized']);

// ---------------------------------------------------------------------------------------------------------------
// Lexical resources (folded: lower case, no diacritics). Lists, not a grammar: the report names every hit.

/** Conditional connectives that introduce a supposition. */
const CONDITIONAL = ['if', 'suppose', 'supposing', 'assuming', "let's say", 'lets say', 'say that', 'hypothetically', 'imagine', 'in case',
  'daca', 'in caz ca', 'presupunand ca', 'presupunem ca', 'sa presupunem', 'sa zicem', 'ipotetic'];
/** Causal, temporal, concessive and purpose connectives between two propositions. */
const CONNECTIVES = ['because', 'since', 'so', 'although', 'though', 'after', 'before', 'when', 'while', 'so that',
  'pentru ca', 'fiindca', 'deoarece', 'desi', 'dupa ce', 'inainte sa', 'inainte ca', 'cand', 'in timp ce', 'ca sa', 'asa ca'];
/** English connectives that are also prepositions ("after lunch"): they join clauses only before a finite verb. */
const PREPOSITION_TOO = new Set(['after', 'before', 'since', 'until']);
/** A connective followed by one of these is a preposition ("because of", "din cauza"), not a clause link. */
const PREPOSITIONAL_NEXT = new Set(['of', 'then', 'that']);
/** Words before a connective that make it a remark about asking ("I ask because …"), which is not a link. */
const REMARK_BEFORE = new Set(['ask', 'asking', 'asked', 'intreb', 'intrebam', 'question', 'intrebare']);
/** Question lead-ins: a connective after only these is an interrogative ("do you know when …"). */
const LEAD_IN = new Set(['do', 'you', 'know', 'can', 'could', 'tell', 'me', 'i', 'wonder', 'check', 'whether', 'please', 'ask', 'any', 'idea', 'and', 'but', 'so', 'hey', 'hi',
  'okay', 'ok', 'well', 'remind', 'here', 'is', 'what', 'would', 'like', 'want', 'to', 'actually', 'my', 'question', 'questions', 'honestly', 'quick', 'also', 'then',
  'stii', 'poti', 'sa', 'mi', 'spui', 'ma', 'intreb', 'verifica', 'te', 'rog', 'daca', 'ai', 'idee', 'si', 'dar', 'deci', 'spune', 'zi', 'salut', 'buna',
  'aminteste', 'uite', 'vreau', 'aflu', 'ce', 'as', 'vrea', 'verific', 'intrebarea', 'mea', 'acum', 'sincer', 'pana', 'de', 'din']);
/** Interrogative uses: in a question, "when"/"când" asks for a time rather than joining two clauses. */
const INTERROGATIVE = new Set(['when', 'cand']);
/** Result connectives count only after a comma (", so …"); sentence-initial "So …" is a discourse marker. */
const AFTER_COMMA = new Set(['so', 'asa ca']);
/** Subordinators that introduce a clause inside a value. */
const SUBORDINATORS = ['because', 'since', 'although', 'though', 'when', 'whenever', 'while', 'if', 'unless', 'until', 'before', 'after', 'so that',
  'pentru ca', 'fiindca', 'deoarece', 'desi', 'dupa ce', 'inainte sa', 'inainte ca', 'cand', 'in timp ce', 'ca sa', 'pana cand', 'daca'];
/** Relative pronouns: inside a noun phrase (not first, not last) they open a relative clause. */
const RELATIVES = new Set(['that', 'which', 'who', 'whom', 'whose', 'whoever', 'whatever', 'care', 'whereby']);
/** Finite verb markers: auxiliaries, copulas, subject pronouns, the Romanian subjunctive, and common finite verbs. */
const FINITE = new Set(['is', 'are', 'was', 'were', 'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could', 'shall', 'should', 'must',
  "isn't", "aren't", "wasn't", "weren't", "doesn't", "don't", "didn't", "won't", "hasn't", "haven't",
  'este', 'sunt', 'era', 'erau', 'fost', 'va', 'vor', 'sa', 'ar']);
/** Subject pronouns: after a subordinator, or inside a noun phrase before another word ("the bucket we use"), a clause. */
const SUBJECT_PRONOUNS = new Set(['i', 'he', 'she', 'we', 'they', 'you', 'eu', 'el', 'ea', 'noi', 'voi', 'ei', 'ele']);
/** English subject pronouns of a contact relative clause ("the bucket we use"); Romanian ones collide with names and codes. */
const CONTACT_PRONOUNS = new Set(['i', 'he', 'she', 'we', 'they', 'you']);
/** Values that anchor nothing: pronouns and the user. */
const WEAK_VALUES = new Set(['i', 'me', 'we', 'us', 'you', 'he', 'him', 'she', 'her', 'it', 'they', 'them', 'the user', 'eu', 'noi', 'tu', 'el', 'ea', 'ei', 'ele']);
const VERB_STEMS = ['arrive', 'leave', 'left', 'come', 'came', 'go', 'goes', 'went', 'start', 'end', 'finish', 'close', 'open', 'die', 'pay', 'paid', 'get', 'got',
  'sign', 'ring', 'rang', 'call', 'return', 'expire', 'wake', 'woke', 'happen', 'begin', 'began', 'belong', 'collect', 'approve', 'handle', 'handled',
  'said', 'say', 'told', 'tell', 'made', 'make', 'took', 'take', 'gave', 'give', 'move', 'reply', 'replied', 'route', 'kick', 'sent', 'send', 'need', 'want'];
const isFiniteVerb = token => FINITE.has(token) || SUBJECT_PRONOUNS.has(token) || VERB_STEMS.some(stem => token === stem || token === stem + 's' || token === stem + 'es' || token === stem + 'd' || token === stem + 'ed');

const tokens = text => fold(text).match(/[\p{L}\p{N}][\p{L}\p{N}']*/gu) ?? [];
/** Positions where the folded multiword `phrase` occurs in the token list. */
function phraseAt(list, phrase) {
  const want = phrase.split(' '), out = [];
  for (let i = 0; i + want.length <= list.length; i++) if (want.every((w, j) => list[i + j] === w)) out.push(i);
  return out;
}
const containsPhrase = (text, phrases) => { const list = tokens(text); return phrases.some(p => phraseAt(list, p).length); };
/** Sentences of a message: split after . ? ! ; and at line breaks. */
export const sentencesOf = message => String(message).split(/(?<=[.?!;:])\s+|\n+/).map(s => s.trim()).filter(Boolean);

// ---------------------------------------------------------------------------------------------------------------
// Target text as wires and lines (the corpora write the canonical layout: one keyword per line).

const WIRE = /^@([A-Za-z][A-Za-z0-9_]*)\s+([A-Za-z][A-Za-z0-9_]*)\s*$/;
const QUOTED_LINE = /^(\s+)(relation|role (\w+)|at|during|asof|valid (?:on|from|until)|speaker) ("(?:\\.|[^"\\])*")\s*$/;

/** Wires of a target: [{id, type, start, end, lines: [{index, text}]}], `end` exclusive of trailing blank lines. */
export function wiresOf(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const wires = [];
  lines.forEach((line, index) => {
    const m = line.match(WIRE);
    if (m) wires.push({id: m[1], type: m[2], start: index, end: index + 1});
    else if (wires.length && line.trim()) wires.at(-1).end = index + 1;
  });
  return {lines, wires};
}
/** Quoted content of a wire: [{index, key, role, value}] for relation, role, time and speaker lines. */
function quotedOf(lines, wire) {
  const out = [];
  for (let index = wire.start + 1; index < wire.end; index++) {
    const m = lines[index].match(QUOTED_LINE);
    if (m) out.push({index, indent: m[1], key: m[2].startsWith('role') ? 'role' : m[2], field: m[2], role: m[3] ?? null, value: JSON.parse(m[4])});
  }
  return out;
}
const isTimeField = q => q.role === 'time' || ['at', 'during', 'asof'].includes(q.key) || q.key.startsWith('valid');

// ---------------------------------------------------------------------------------------------------------------
// Row lexicon: entity surfaces of `ontology_sop` (labels and aliases, any language).

/** {entities: [{id, surfaces: [{surface, kind: label|alias, language}]}]} */
export function rowLexicon(row) {
  const entities = [];
  let current = null;
  for (const line of String(row?.ontology_sop ?? '').split('\n')) {
    const head = line.match(/^@([A-Za-z0-9_:-]+)\s+(\w+)/);
    if (head) { current = head[2] === 'entity' ? {id: head[1], surfaces: []} : null; if (current) entities.push(current); continue; }
    const m = current && line.match(/^\s+(label|alias)\s+([a-z]{2,3})\s+("(?:\\.|[^"\\])*")\s*$/);
    if (m) current.surfaces.push({surface: JSON.parse(m[3]), kind: m[1], language: m[2]});
  }
  for (const entity of Array.isArray(row?.verification_context?.entities) ? row.verification_context.entities : []) {
    if (entities.some(e => e.id === entity.id)) continue;
    entities.push({id: entity.id, surfaces: [entity.label, ...(entity.aliases ?? [])].filter(s => typeof s === 'string').map(surface => ({surface, kind: 'alias', language: null}))});
  }
  return {entities};
}
const stripArticle = text => String(text).replace(/^(?:the|a|an)\s+/i, '');
const isRomanianSurface = s => /[ăâîșşțţ]/i.test(s);
/** Prefer a Romanian label, then any surface with diacritics, then the longest. */
const surfaceRank = s => (s.kind === 'label' && s.language === 'ro' ? 4 : 0) + (isRomanianSurface(s.surface) ? 2 : 0) + (s.kind === 'label' ? 1 : 0);

/** Distinct (folded) candidates, dropping one mentioned inside a longer mentioned candidate. */
function maximal(candidates, key = c => c) {
  const byFold = new Map();
  for (const c of candidates) { const k = fold(key(c)); if (!byFold.has(k)) byFold.set(k, c); }
  const list = [...byFold.values()];
  return list.filter(c => !list.some(o => o !== c && fold(key(o)).includes(fold(key(c))) && fold(key(o)).length > fold(key(c)).length));
}

// ---------------------------------------------------------------------------------------------------------------
// Romanian sources of relation phrases and values.

const RELATION_POS = new Set(['relation', 'verb', 'phrase']);
/**
 * A stricter mention for dictionary surfaces (which include rare senses): consecutive message tokens equal to the
 * surface's tokens after folding, or inflections of them (a shared prefix of all but the last three characters, at
 * least four), or one edit away for tokens longer than four. A short message word never matches a longer lemma.
 */
export function strictMentioned(surface, message) {
  const want = tokens(surface), text = tokens(message);
  if (!want.length) return false;
  const close = (w, t) => {
    if (w === t) return true;
    const stem = Math.max(4, w.length - 3);
    if (w.length >= 4 && t.length >= stem && t.slice(0, stem) === w.slice(0, stem) && t.length <= w.length + 4) return true;
    return w.length > 4 && Math.abs(w.length - t.length) <= 1 && editDistance(w, t) <= 1;
  };
  for (let i = 0; i + want.length <= text.length; i++) if (want.every((w, j) => close(w, text[i + j]))) return true;
  return false;
}
function editDistance(a, b) {
  const d = Array.from({length: a.length + 1}, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const VALUE_POS = new Set(['noun', 'phrase', 'adj']);
/** A relation lemma without the infinitive marker and copula ("a fi înscris la" → "înscris la"). */
const relationCore = lemma => String(lemma).replace(/^(?:a\s+)?(?:fi\s+)?/i, '').trim() || lemma;
/** Is an English relation phrase mentioned in the message? Every content token (auxiliaries and articles aside) must be. */
function relationMentioned(relation, message) {
  const content = tokens(relation).filter(t => !['be', 'the', 'a', 'an', 'to', 'fi'].includes(t));
  return content.length > 0 && content.every(t => mentionedIn(t, message));
}

/** The generator's Romanian source relation of an English relation (surface_ir), when unique. */
function generatorSources(row) {
  const map = new Map();
  const ir = row?.surface_ir;
  if (!ir || typeof ir !== 'object') return map;
  // Every proposition of the IR (stated, assumed, query, moreQueries, …) that records its Romanian source.
  const visit = node => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    if (typeof node.relation === 'string' && typeof node.source_relation === 'string') {
      if (!map.has(node.relation)) map.set(node.relation, new Set());
      map.get(node.relation).add(node.source_relation);
    }
    Object.values(node).forEach(visit);
  };
  visit(ir);
  return map;
}

/** Unique Romanian lemma of an English relation phrase whose lemma or a listed form is mentioned in the message. */
export function dictionaryRelation(relation, message, dictionary) {
  const lemmas = new Set();
  for (const hit of dictionary.lookup(relation, 'en')) {
    if (!RELATION_POS.has(hit.entry.pos)) continue;
    const direct = hit.entry.ro.filter(lemma => strictMentioned(relationCore(lemma), message));
    if (direct.length) { direct.forEach(l => lemmas.add(l)); continue; }
    const forms = hit.entry.forms.map(f => f.replace(/^def:/, '')).filter(form => strictMentioned(relationCore(form.replace(/^(?:e|este|sunt|a|au|am)\s+/, '')), message));
    if (!forms.length || !hit.entry.ro.length) continue;
    // The lemma of the entry that shares most tokens with the mentioned form.
    const score = lemma => tokens(relationCore(lemma)).filter(t => forms.some(f => tokens(f).some(u => u.slice(0, 4) === t.slice(0, 4)))).length;
    const best = Math.max(...hit.entry.ro.map(score));
    const top = hit.entry.ro.filter(l => score(l) === best);
    if (best > 0 && top.length === 1) lemmas.add(top[0]);
    else if (hit.entry.ro.length === 1) lemmas.add(hit.entry.ro[0]);
  }
  const list = maximal([...lemmas]);
  return list.length === 1 ? list[0] : null;
}

/** Romanian surface of a value through the row lexicon: the entity's surface mentioned in the message, when unique. */
export function lexiconValue(value, message, lexicon) {
  const key = fold(value), bare = fold(stripArticle(value));
  const found = [];
  for (const entity of lexicon.entities) {
    if (!entity.surfaces.some(s => fold(s.surface) === key || fold(stripArticle(s.surface)) === bare)) continue;
    for (const s of entity.surfaces) if (fold(s.surface) !== key && mentionedIn(s.surface, message)) found.push({...s, entity: entity.id});
  }
  const entities = new Set(found.map(s => s.entity));
  if (entities.size !== 1) return null;
  const best = maximal(found.sort((a, b) => surfaceRank(b) - surfaceRank(a)), s => s.surface);
  return best.length === 1 ? best[0].surface : null;
}

/** Romanian surface of a common-noun value through the dictionary: lemma, or the definite nominative for "the …". */
export function dictionaryValue(value, message, dictionary) {
  const definite = /^the\s/i.test(value);
  const out = new Set();
  for (const hit of dictionary.lookup(stripArticle(value), 'en')) {
    if (!VALUE_POS.has(hit.entry.pos) || !hit.entry.ro.length) continue;
    const defs = hit.entry.forms.filter(f => f.startsWith('def:')).map(f => f.slice(4));
    const mentioned = [...hit.entry.ro, ...hit.entry.forms.map(f => f.replace(/^def:/, ''))].some(s => strictMentioned(s, message));
    if (!mentioned) continue;
    const def = defs.find(d => strictMentioned(d, message)) ?? (definite ? defs[0] : undefined);
    out.add(def ?? hit.entry.ro.find(l => strictMentioned(l, message)) ?? hit.entry.ro[0]);
  }
  const list = maximal([...out]);
  return list.length === 1 ? list[0] : null;
}

/** Fixed clock for relative times when a row has none (conversion must be deterministic). */
const DEFAULT_NOW = Date.parse('2026-09-28T12:00:00Z');
/**
 * The message's own writing of a time value: the unique span of 1..5 message words that the host normalizes to the
 * same period as the value ("8 October 2019" → "8 octombrie 2019", "01.10.2023").
 */
export function messageTime(value, message, now = DEFAULT_NOW) {
  const target = normalizeTime(value, now);
  if (!target) return null;
  const words = String(message).split(/\s+/).map(w => w.replace(/^[("„“«]+/, '').replace(/[)"”»,;:?!]+$/, '')).filter(Boolean);
  const found = [];
  for (let i = 0; i < words.length; i++) for (let n = 1; n <= 5 && i + n <= words.length; n++) {
    const raw = words.slice(i, i + n).join(' ');
    for (const span of new Set([raw, raw.replace(/\.$/, '')])) {
      const t = normalizeTime(span, now);
      if (t && t.from === target.from && t.until === target.until) found.push(span);
    }
  }
  // The date itself, without a leading preposition ("de la 22 noiembrie 2025" → "22 noiembrie 2025").
  const distinct = [...new Map(found.map(f => [fold(f), f])).values()];
  const list = distinct.filter(f => !distinct.some(o => o !== f && fold(f).includes(fold(o))));
  return list.length === 1 ? list[0] : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Regeneration checks.

/** Does a quoted value hold a clause? Returns the reason text or null. */
export function clauseInValue(value, {field = 'role'} = {}) {
  const list = tokens(value);
  if (list.length < 2) return null;
  // A title written as a name ("Before Sunrise", "What Is Love") is a proper name, not a clause.
  const words = String(value).match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? [];
  if (words.length && words.every(w => /^[\p{Lu}\p{N}]/u.test(w))) return null;
  for (let i = 1; i < list.length - 1; i++) if (RELATIVES.has(list[i])) return `relative "${list[i]}"`;
  for (const sub of SUBORDINATORS) for (const at of phraseAt(list, sub)) {
    const rest = list.slice(at + sub.split(' ').length);
    if (rest.some(isFiniteVerb)) return `subordinator "${sub}" with a finite verb`;
  }
  const verb = list.find(t => FINITE.has(t));
  if (verb && field !== 'speaker') return `finite verb "${verb}"`;
  const raw = String(value).toLowerCase().split(/\s+/);
  for (let i = 1; i < raw.length - 1; i++) if (CONTACT_PRONOUNS.has(raw[i]) && /^\p{Ll}+$/u.test(raw[i + 1])) return `clause "${raw.slice(i, i + 2).join(' ')}"`;
  return null;
}

/** Does the message join two propositions with a connective the old target does not link? */
export function unlinkedConnective(message, anchorsOf, wireIds, relations = []) {
  const particles = new Set(relations.flatMap(r => tokens(r)));
  if (wireIds.length < 2) return null;
  const unknown = wireIds.filter(id => !anchorsOf(id, message));
  for (const sentence of sentencesOf(message)) {
    const list = tokens(sentence);
    for (const connective of CONNECTIVES) for (const at of phraseAt(list, connective)) {
      const n = connective.split(' ').length, next = list[at + n];
      if (!at || next === undefined || PREPOSITIONAL_NEXT.has(next) || /^\d/.test(next)) continue;
      if (list.slice(Math.max(0, at - 2), at).some(t => REMARK_BEFORE.has(t))) continue;
      if (particles.has(connective)) continue; // part of a relation phrase ("look after")
      if (PREPOSITION_TOO.has(connective) && !list.slice(at + n).some(isFiniteVerb)) continue;
      const before = list.slice(0, at).join(' '), after = list.slice(at + n).join(' ');
      if (list.slice(0, at).every(t => LEAD_IN.has(t))) continue;
      if (INTERROGATIVE.has(connective) && sentence.trim().endsWith('?')) continue;
      if (AFTER_COMMA.has(connective) && !new RegExp(',\\s*' + connective.replace('asa ca', 'a[sș]a c[aă]') + '(?![\\p{L}])', 'iu').test(sentence)) continue;
      const pre = wireIds.filter(id => anchorsOf(id, before)), post = wireIds.filter(id => anchorsOf(id, after));
      if (pre.some(a => post.some(b => a !== b))) return {connective, sentence, via: 'anchored'};
      if (unknown.length && (pre.length || post.length || unknown.length >= 2) && list.slice(0, at).filter(t => !LEAD_IN.has(t)).length >= 2) return {connective, sentence, via: 'unanchored'};
    }
  }
  return null;
}

/** Is every query obviously in the scope of the (single) supposition? */
export function suppositionScopesAll(message, queryCount) {
  if (queryCount <= 1) return true;
  const sentences = sentencesOf(message);
  if (sentences.length <= 1) return true;
  const [first, ...rest] = sentences;
  return containsPhrase(first, CONDITIONAL) && !first.endsWith('?') && rest.every(s => s.includes('?')) && !rest.some(s => containsPhrase(s, CONDITIONAL));
}

// ---------------------------------------------------------------------------------------------------------------
// Conversion of one target.

/**
 * Convert one target text. `context` = {message, language, generator, lexicon, dictionary, regenerate}.
 * Returns {text, changes: [{kind, wire, from, to, method}], flags: [{flag, detail}], regenerate: [{reason, detail}]}.
 */
export function convertTarget(text, context) {
  const {message, language, generator = new Map(), lexicon = {entities: []}, dictionary, regenerate = true, now = DEFAULT_NOW} = context;
  const {lines, wires} = wiresOf(text);
  const changes = [], flags = [], regen = [];
  const byId = new Map(wires.map(w => [w.id, w]));
  const quoted = new Map(wires.map(w => [w.id, quotedOf(lines, w)]));
  const certainty = w => lines.slice(w.start + 1, w.end).map(l => l.trim()).find(l => l.startsWith('certainty '))?.slice(10);
  const relationOf = w => quoted.get(w.id).find(q => q.key === 'relation')?.value;

  // Regeneration checks run on the source target.
  if (regenerate) {
    for (const w of wires) {
      if (!['stated', 'assumed', 'query'].includes(w.type)) continue;
      if (w.type === 'assumed' && relationOf(w) === 'mean') continue; // a word-meaning assumption holds words, not clauses
      for (const q of quoted.get(w.id)) {
        if (q.key === 'relation') continue;
        const why = clauseInValue(q.value, {field: q.key});
        if (why) regen.push({reason: 'clause_in_value', detail: `@${w.id} ${q.field} ${JSON.stringify(q.value)}: ${why}`});
      }
    }
    const propositions = wires.filter(w => ['stated', 'assumed', 'query'].includes(w.type)).map(w => w.id);
    const anchorsOf = (id, span) => quoted.get(id).some(q => q.key !== 'relation' && !isTimeField(q) && !WEAK_VALUES.has(fold(q.value)) && (mentionedIn(q.value, span) || (lexiconValue(q.value, span, lexicon) !== null)));
    const hasLinks = wires.some(w => lines.slice(w.start + 1, w.end).some(l => /^\s{2}(because|so|if|unless|although|so_that|before|after|when|while) \$/.test(l)));
    const relations = wires.map(relationOf).filter(r => typeof r === 'string');
    const joined = hasLinks ? null : unlinkedConnective(message, anchorsOf, propositions, relations);
    if (joined) regen.push({reason: 'connective_without_link', detail: `"${joined.connective}" (${joined.via}) in ${JSON.stringify(joined.sentence.slice(0, 160))}`});
  }

  // Condition links.
  const queries = wires.filter(w => w.type === 'query');
  const supposed = wires.filter(w => w.type === 'stated' && certainty(w) === 'supposed');
  const inserts = new Map();
  if (queries.length && supposed.length === 1 && containsPhrase(message, CONDITIONAL)) {
    if (suppositionScopesAll(message, queries.length)) {
      for (const q of queries) inserts.set(q.id, `  if $${supposed[0].id}`);
      changes.push({kind: 'condition_link', wire: queries.map(q => q.id).join(','), to: '$' + supposed[0].id, method: queries.length === 1 ? 'single_query' : 'leading_supposition'});
    } else if (regenerate) regen.push({reason: 'supposition_partial_scope', detail: `$${supposed[0].id} with ${queries.length} queries`});
  } else if (supposed.length && queries.length) flags.push({flag: 'supposition_unlinked', detail: supposed.length > 1 ? 'several suppositions' : 'no conditional connective'});

  // Content words of Romanian and mixed rows.
  const out = [...lines];
  if (language === 'ro' || language === 'mixed') {
    for (const w of wires) for (const q of quoted.get(w.id)) {
      if (q.key === 'speaker' || typeof q.value !== 'string') continue;
      let to = null, method = null;
      // A string already in Romanian (a word the dictionary or the letters mark as Romanian) is in the message's language.
      if (!isTimeField(q) && dictionary?.isRomanian(q.value)) continue;
      if (isTimeField(q)) {
        if (mentionedIn(q.value, message)) continue;
        to = messageTime(q.value, message, now); method = 'message_time';
      } else if (q.key === 'relation') {
        if (relationMentioned(q.value, message)) continue;
        const sources = generator.get(q.value);
        if (sources?.size === 1) { to = [...sources][0]; method = 'generator_source'; }
        else if (dictionary) { to = dictionaryRelation(q.value, message, dictionary); method = 'dictionary'; }
      } else {
        if (mentionedIn(q.value, message)) continue;
        to = lexiconValue(q.value, message, lexicon); method = 'lexicon';
        if (to === null && dictionary) { to = dictionaryValue(q.value, message, dictionary); method = 'dictionary'; }
        // A common noun is written in lower case; a name keeps the lexicon's spelling.
        if (to !== null && /^(?:the\s+)?\p{Ll}/u.test(q.value) && /^\p{Lu}\p{Ll}/u.test(to)) to = to.charAt(0).toLocaleLowerCase('ro') + to.slice(1);
      }
      if (to === null || to === q.value) { flags.push({flag: 'content_not_normalized', detail: `@${w.id} ${q.field} ${JSON.stringify(q.value)}`}); continue; }
      out[q.index] = `${q.indent}${q.field} ${JSON.stringify(to)}`;
      changes.push({kind: q.key === 'relation' ? 'relation' : 'value', wire: w.id, from: q.value, to, method});
    }
  }
  // Link lines go after the other fields of the query wire.
  const result = [];
  out.forEach((line, index) => {
    result.push(line);
    for (const [id, link] of inserts) if (byId.get(id).end - 1 === index) result.push(link);
  });
  return {text: result.join('\n'), changes, flags, regenerate: regen};
}

const validate = text => { checkModelProgram(parse(text)); };

/**
 * Convert one row. Returns {status: converted|unchanged|regenerate|invalid, row?, changes, flags, reasons}.
 * `regenerate` rows and `invalid` conversions carry no row.
 */
export function convertRow(row, {dictionary = null} = {}) {
  const message = row.question ?? row.prompt ?? '';
  const language = row.language ?? 'en';
  const field = row.sop_target !== undefined ? 'sop_target' : 'target';
  const source = row[field];
  const clock = Date.parse(row.verification_context?.now ?? '');
  const context = {message, language, generator: generatorSources(row), lexicon: rowLexicon(row), dictionary, now: Number.isFinite(clock) ? clock : DEFAULT_NOW};
  if (typeof source !== 'string' || !source.trim()) return {status: 'invalid', reasons: [{reason: 'no_target', detail: field}], changes: [], flags: []};
  try { validate(source); } catch (error) { return {status: 'invalid', reasons: [{reason: 'source_invalid', detail: error.message}], changes: [], flags: []}; }
  const main = convertTarget(source, context);
  if (main.regenerate.length) return {status: 'regenerate', reasons: main.regenerate, changes: main.changes, flags: main.flags};
  try { validate(main.text); } catch (error) { return {status: 'invalid', reasons: [{reason: 'conversion_invalid', detail: error.message}], changes: main.changes, flags: main.flags}; }
  const next = {...row, [field]: main.text};
  const changes = [...main.changes], flags = [...main.flags];
  if (Array.isArray(row.sop_targets_accepted)) {
    next.sop_targets_accepted = [];
    for (const [i, alt] of row.sop_targets_accepted.entries()) {
      if (alt === source) { next.sop_targets_accepted.push(main.text); continue; }
      try { validate(alt); } catch (error) { return {status: 'invalid', reasons: [{reason: 'source_invalid', detail: `sop_targets_accepted[${i}]: ${error.message}`}], changes, flags}; }
      const converted = convertTarget(alt, {...context, regenerate: false});
      try { validate(converted.text); } catch (error) { return {status: 'invalid', reasons: [{reason: 'conversion_invalid', detail: `sop_targets_accepted[${i}]: ${error.message}`}], changes, flags}; }
      next.sop_targets_accepted.push(converted.text);
      changes.push(...converted.changes.map(c => ({...c, accepted: i})));
      flags.push(...converted.flags.map(f => ({...f, accepted: i})));
    }
  }
  const changed = next[field] !== source || JSON.stringify(next.sop_targets_accepted) !== JSON.stringify(row.sop_targets_accepted);
  return {status: changed ? 'converted' : 'unchanged', row: next, changes, flags, reasons: []};
}

// ---------------------------------------------------------------------------------------------------------------
// Report and CLI.

const bump = (object, key, by = 1) => { object[key] = (object[key] ?? 0) + by; };

/** Convert rows and aggregate the report. Returns {rows (written), report}. */
export function convertRows(rows, {dictionary = null, input = null, examples = 15} = {}) {
  const report = {tool: 'tools/datasets/convert-targets.mjs', input, rows: rows.length, status: {}, regenerate: {}, invalid: {}, flags: {}, changes: {},
    language: {}, family: {}, ids: {regenerate: {}, invalid: {}, flags: {}}, examples: {regenerate: {}, invalid: {}, changes: {}, flags: {}}};
  const written = [];
  const keep = (bucket, key, item) => { (bucket[key] ??= []); if (bucket[key].length < examples) bucket[key].push(item); };
  for (const row of rows) {
    const result = convertRow(row, {dictionary});
    const language = row.language ?? 'unknown', family = row.family ?? 'unknown';
    bump(report.status, result.status);
    (report.language[language] ??= {}); bump(report.language[language], result.status);
    (report.family[family] ??= {}); bump(report.family[family], result.status);
    const reasons = [...new Set(result.reasons.map(r => r.reason))];
    for (const reason of reasons) {
      const bucket = result.status === 'regenerate' ? 'regenerate' : 'invalid';
      bump(report[bucket], reason);
      bump(report.language[language], `${bucket}:${reason}`);
      bump(report.family[family], `${bucket}:${reason}`);
      (report.ids[bucket][reason] ??= []).push(row.id);
      keep(report.examples[bucket], reason, {id: row.id, language, question: String(row.question ?? row.prompt ?? '').slice(0, 300), detail: result.reasons.filter(r => r.reason === reason).map(r => r.detail)});
    }
    if (result.row) {
      for (const flag of new Set(result.flags.map(f => f.flag))) {
        bump(report.flags, flag); bump(report.language[language], `flag:${flag}`);
        (report.ids.flags[flag] ??= []).push(row.id);
        keep(report.examples.flags, flag, {id: row.id, language, detail: result.flags.filter(f => f.flag === flag).map(f => f.detail).slice(0, 5)});
      }
      for (const change of result.changes) {
        const key = change.kind + (change.method ? ':' + change.method : '');
        bump(report.changes, key);
        keep(report.examples.changes, key, {id: row.id, language, ...change});
      }
      written.push(result.row);
    }
  }
  report.written = written.length;
  return {rows: written, report};
}

export async function main(argv = process.argv.slice(2)) {
  const at = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const input = at('--in'), out = at('--out'), reportPath = at('--report'), dryRun = argv.includes('--dry-run');
  if (!input) throw Error('usage: node tools/datasets/convert-targets.mjs --in <file.jsonl> [--out <file.jsonl>] [--report <file.json>] [--dry-run]');
  if (!dryRun && !out) throw Error('convert-targets: give --out, or --dry-run for a report only');
  if (out && path.resolve(out) === path.resolve(input)) throw Error('convert-targets: --out must differ from --in');
  let dictionary = null;
  try { dictionary = defaultDictionary(); } catch (error) { console.error(`convert-targets: dictionary unavailable (${error.message}); relation and value conversion uses the generator source and the row lexicon only`); }
  const rows = readJsonlShardedSync(input);
  const {rows: written, report} = convertRows(rows, {dictionary, input});
  report.dictionary = dictionary ? {entries: dictionary.entries.length, digest: dictionary.digest} : null;
  if (!dryRun) { writeJsonlShardedSync(out, written); report.out = out; }
  if (reportPath) { fs.mkdirSync(path.dirname(path.resolve(reportPath)), {recursive: true}); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n'); }
  const summary = {input, rows: report.rows, status: report.status, regenerate: report.regenerate, invalid: report.invalid, flags: report.flags, changes: report.changes, written: dryRun ? 0 : report.written};
  console.log(JSON.stringify(summary));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
