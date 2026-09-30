/**
 * Context-free propositions of the model language (DS021). `stated`
 * and `assumed` wires, and query `match` blocks, carry strings as the model
 * understood them: a relation phrase, closed-inventory roles with values as
 * written in the message, polarity and optional temporal expressions. The host
 * links them to lexicon predicates and positional atoms (sop/linking.mjs);
 * nothing here executes, stores or trusts a proposition.
 */
import {one,parseProposition,propositionPairs,unquote} from './parser.mjs';
import {normalize} from './lexicon.mjs';
import {formatTime} from '../lib/time.mjs';
import {stable} from '../lib/util.mjs';
import {linkRelation,linkValidity} from './linking.mjs';

export const PROPOSITION_TYPES = new Set(['stated', 'assumed']);
const fold = s => normalize(s).normalize('NFD').replace(/\p{M}/gu, '');

/** The authored proposition of a stated/assumed wire (strings, not yet linked). */
export function propositionOf(w) {
  const p = parseProposition(propositionPairs(w), {where: '@' + w.id + ' ' + w.type});
  return {
    id: w.id, type: w.type, ...p,
    ...(w.type === 'stated' ? {certainty: one(w, 'certainty'), speaker: w.fields.speaker && one(w, 'speaker') !== 'user' ? unquote(one(w, 'speaker')) : 'user'} : {}),
    ...(w.type === 'assumed' ? {basis: one(w, 'basis', 'unspecified')} : {}),
  };
}

/** A user supposition, a hedge or reported speech is used only conditionally. */
export const conditionalStatement = p => p.certainty !== 'asserted' || p.speaker !== 'user';

const termToken = value => typeof value === 'number' || /^\?/.test(value) ? String(value) : JSON.stringify(value);
/**
 * Link a proposition (stated, assumed or a query match) to a positional atom
 * text whose string values are still quoted for host entity resolution.
 * Returns {atomText, predicate, span?} or {issue} for a host clarification. Query
 * matches may leave declared roles unbound; `fresh()` names those variables.
 * `span` is a time variable bound to the matched fact's validity interval.
 */
export function linkProposition(p, lexicon, {exact = true, fresh = null} = {}) {
  let roles = p.roles, span = null;
  let link = linkRelation(p.relation, roles.map(role => role.name), lexicon, {exact});
  // A query's `role time ?t` on a relation that declares no time role asks for the validity interval of
  // the matched fact (a "when" question): the role is dropped from the atom and ?t becomes the host span.
  const timeVariable = !exact && p.roles.find(role => role.name === 'time' && typeof role.value === 'string' && role.value.startsWith('?'));
  if (link.status !== 'bound' && timeVariable) {
    const without = p.roles.filter(role => role !== timeVariable);
    const retry = linkRelation(p.relation, without.map(role => role.name), lexicon, {exact});
    if (retry.status === 'bound') { link = retry; roles = without; span = timeVariable.value; }
  }
  if (link.status !== 'bound') return {issue: {kind: 'relation', ...link}};
  const byName = new Map(roles.map(role => [role.name, role.value]));
  const terms = link.roles.map((name, index) => {
    if (!byName.has(name)) return fresh();
    const value = byName.get(name), type = link.types?.[index];
    // A numeral written as a string fills an integer argument as a number.
    if (type === 'integer' && typeof value === 'string' && /^-?\d+$/.test(value.trim())) return String(Number(value.trim()));
    return termToken(value);
  });
  return {predicate: link.id, atomText: (p.polarity === 'negated' ? 'not ' : '') + link.id + ' ' + terms.join(' '), ...(span ? {span} : {})};
}

/** Validity of a stated/assumed proposition, normalized by the host clock. */
export const propositionValidity = (p, now) => linkValidity(p.valid ?? {}, now);

/**
 * Lexicon-free identity of an authored proposition for duplicate checks and
 * metrics: folded relation phrase, sorted folded role values, polarity and
 * the validity strings. `basis` and `certainty` are not part of it.
 */
export function propositionKey(p) {
  const value = v => typeof v === 'string' && !v.startsWith('?') ? fold(v) : v && typeof v === 'object' && v.ref ? '$' + v.ref : v;
  return stable({relation: fold(p.relation), roles: p.roles.map(r => [r.name, value(r.value)]).sort((a, b) => a[0].localeCompare(b[0])), polarity: p.polarity, valid: Object.entries(p.valid ?? {}).map(([k, v]) => [k, fold(v)]).sort()});
}

const PHRASES = {
  en: {asserted: 'You stated', hedged: 'You stated tentatively', supposed: 'You supposed', speaker: 'According to', assumed: 'The model assumed', not: 'not', basis: 'basis'},
  ro: {asserted: 'Ați afirmat', hedged: 'Ați afirmat cu rezerve', supposed: 'Ați presupus', speaker: 'Conform', assumed: 'Modelul a presupus', not: 'nu', basis: 'temei'},
};
/**
 * Host-rendered sentence for an authored proposition. It repeats the model's
 * own strings; the model never writes this prose, so the sentence cannot claim
 * a reading that was not declared.
 */
/** A role value as shown to the user: a `$id` reference in brackets, other values as written. */
const shownValue = value => (value && typeof value === 'object' && value.ref ? '[$' + value.ref + ']' : String(value));
/** The body of a host-rendered sentence: relation, roles and validity as the model wrote them. */
export function propositionBody(p, language = 'en') {
  const m = PHRASES[language] ?? PHRASES.en;
  const roles = p.roles.map(({name, value}) => name + ': ' + shownValue(value)).join('; ');
  const time = Object.entries(p.valid ?? {}).map(([form, text]) => form + ' ' + text).join(', ');
  return (p.polarity === 'negated' ? m.not + ' ' : '') + p.relation + ' (' + roles + ')' + (time ? ' [' + time + ']' : '');
}
/** Conjunction words of the link keywords in the answer language (the keywords themselves are English). */
export const LINK_PHRASES = {
  en: {because: 'because', so: 'so', if: 'if', unless: 'unless', although: 'although', so_that: 'so that', before: 'before', after: 'after', when: 'when', while: 'while'},
  ro: {because: 'pentru că', so: 'așa că', if: 'dacă', unless: 'dacă nu', although: 'deși', so_that: 'ca să', before: 'înainte de', after: 'după', when: 'când', while: 'în timp ce'},
};
export function explainProposition(p, language = 'en') {
  const m = PHRASES[language] ?? PHRASES.en;
  const body = propositionBody(p, language);
  if (p.type === 'assumed') return m.assumed + ': ' + body + (p.basis && p.basis !== 'unspecified' ? ' (' + m.basis + ': ' + p.basis + ')' : '') + '.';
  const lead = p.speaker && p.speaker !== 'user' ? m.speaker + ' ' + p.speaker : m[p.certainty] ?? m.asserted;
  return lead + ': ' + body + '.';
}
/**
 * The host sentence of a proposition with its clause links (DS021 "Clauses and links"): "You stated: fail (…), because:
 * be idempotent (…) [not checked]." `links` are [{keyword, status, target}] with the target proposition.
 */
export function explainWithLinks(p, links = [], language = 'en') {
  const base = explainProposition(p, language);
  if (!links.length) return base;
  const words = LINK_PHRASES[language] ?? LINK_PHRASES.en, note = language === 'ro' ? 'neverificat' : 'not checked';
  const parts = links.map(link => words[link.keyword] + ': ' + (link.target ? propositionBody(link.target, language) : '$' + link.to) + (link.status === 'not_checked' ? ' [' + note + ']' : ''));
  return base.slice(0, -1) + ', ' + parts.join(', ') + '.';
}

/** Report entry shared by the packet and the HTTP trace. */
export function reportProposition(p, {atom = null, predicate = null, validity = null, language = 'en', extra = {}, links = null} = {}) {
  return {
    id: p.id, relation: p.relation, roles: p.roles, polarity: p.polarity, valid_text: p.valid ?? {},
    valid: validity ? {from: formatTime(validity.from), until: formatTime(validity.until)} : null,
    predicate, atom,
    ...(p.type === 'stated' ? {certainty: p.certainty, speaker: p.speaker} : {basis: p.basis}),
    statement: links?.length ? explainWithLinks(p, links, language) : explainProposition(p, language),
    ...(links?.length ? {links: links.map(({target, ...link}) => link)} : {}), ...extra,
  };
}
