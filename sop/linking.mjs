/**
 * Host linking of context-free model-language propositions (DS021). The small
 * model writes strings: a relation phrase, role values as written in the
 * message and temporal expressions. After the model, the host links them to the
 * reviewed lexicon deterministically. It never guesses: an unknown or ambiguous
 * relation, a role set no predicate declares, or an unreadable time expression
 * becomes a host clarification. Entity strings are resolved by the generated
 * `resolve` wires of the declarative compiler (exact and accent-folded aliases).
 */
import {ROLE_NAMES} from './enums.mjs';
import {normalize} from './lexicon.mjs';
import {formatTime} from '../lib/time.mjs';

const DAY = 86400000;
const fold = s => normalize(s).normalize('NFD').replace(/\p{M}/gu, '');
const STOPWORDS = new Set(['is', 'are', 'was', 'were', 'be', 'been', 'being', 'a', 'an', 'the', 'does', 'do', 'did', 'has', 'have', 'had', 'este', 'e', 'sunt', 'era', 'fost', 'un', 'o', 'al', 'ale']);
// Light, deterministic token normalization: plural/third-person -s and a final -e.
const stem = token => token.length > 3 ? token.replace(/([^s])s$/, '$1').replace(/e$/, '') : token;
/** Comparison key of a relation phrase: folded tokens, auxiliaries and articles dropped, light stemming. */
export function phraseKey(text) {
  const tokens = fold(String(text).replaceAll('_', ' ')).match(/[\p{L}\p{N}]+/gu) ?? [];
  const content = tokens.filter(token => !STOPWORDS.has(token));
  return (content.length ? content : tokens).map(stem).join(' ');
}

/**
 * Role names of a lexicon predicate in argument order: its `role NAME TYPE`
 * lines, or `subject`/`object` by position for an unnamed predicate of arity
 * one or two. An unnamed predicate of higher arity cannot be linked.
 */
export function predicateRoleNames(predicate) {
  if (!predicate) return null;
  if (predicate.namedRoles) return predicate.roles.map(role => role.name);
  return predicate.arity <= 2 ? ['subject', 'object'].slice(0, predicate.arity) : null;
}

/**
 * Link a relation phrase and the role names used with it to one lexicon
 * predicate. `exact` (statements, assumptions) requires the declared role set
 * to equal the used set; otherwise (query match blocks) the used roles must be
 * declared and missing ones become fresh variables.
 */
export function linkRelation(text, used, lexicon, {exact = true} = {}) {
  const key = phraseKey(text);
  const named = Object.values(lexicon?.predicates ?? {}).filter(predicate => {
    const forms = [predicate.id, ...(predicate.aliases ?? []).map(alias => alias.surface), ...(predicate.description ? [predicate.description] : [])];
    return forms.some(form => phraseKey(form) === key);
  });
  if (!named.length) return {status: 'unknown', text};
  const fits = named.filter(predicate => {
    const names = predicateRoleNames(predicate);
    return names && (exact ? names.length === used.length && used.every(name => names.includes(name)) : used.every(name => names.includes(name)));
  });
  const candidates = (list => list.map(predicate => ({id: predicate.id, roles: predicateRoleNames(predicate)})).sort((a, b) => a.id.localeCompare(b.id)));
  if (fits.length === 1) return {status: 'bound', text, id: fits[0].id, roles: predicateRoleNames(fits[0]), types: fits[0].args};
  if (fits.length > 1) return {status: 'ambiguous', text, candidates: candidates(fits)};
  return {status: 'role_mismatch', text, used, candidates: candidates(named)};
}

const MONTHS = {january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  ianuarie: 1, februarie: 2, martie: 3, aprilie: 4, mai: 5, iunie: 6, iulie: 7, septembrie: 9, octombrie: 10, noiembrie: 11, decembrie: 12,
  // Abbreviations (EN and RO), written with or without a final dot.
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12, ian: 1, iun: 6, iul: 7, noi: 11};
const RELATIVE = {today: 0, azi: 0, astazi: 0, yesterday: -1, ieri: -1, tomorrow: 1, maine: 1};
const utc = (y, m = 1, d = 1) => Date.UTC(y, m - 1, d);
/**
 * Normalize a temporal expression to a period {from, until} (until exclusive),
 * relative to the host clock `now`. Accepted: ISO dates and UTC timestamps,
 * `YYYY`, `YYYY-MM`, a month name or abbreviation with a year (EN/RO), a day,
 * month and year ("3 March 2025", "March 3, 2025", "the 3rd of March 2025",
 * "3 martie 2025", "03.03.2025"), a range "A – B", `now`/`acum`,
 * today/yesterday/tomorrow (EN/RO) and last/this/next year, with an optional leading in/on/at/during,
 * în/pe/la/din. Anything else returns null and the host asks.
 */
export function normalizeTime(text, now = Date.now()) {
  let t = fold(text).replace(/^(?:in|on|at|during|since|pe|la|din|de la)\s+/, '').replace(/^the\s+/, '').trim();
  // A range "A – B" (en dash, or a spaced hyphen) is the period from the start of A to the start of B.
  const range = t.match(/^(.+?)\s+[–—-]\s+(.+)$/) ?? t.match(/^(.+?)[–—](.+)$/);
  if (range) { const a = normalizeTime(range[1], now), b = normalizeTime(range[2], now); return a && b && a.from < b.from ? {from: a.from, until: b.from} : null; }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(t.toUpperCase())) { const at = Date.parse(t.toUpperCase()); return Number.isFinite(at) ? {from: at, until: at + 1} : null; }
  let m;
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/))) { const from = utc(+m[1], +m[2], +m[3]); return new Date(from).getUTCDate() === +m[3] ? {from, until: from + DAY} : null; }
  if ((m = t.match(/^(\d{4})-(\d{2})$/)) && +m[2] >= 1 && +m[2] <= 12) return {from: utc(+m[1], +m[2]), until: utc(+m[1], +m[2] + 1)};
  if ((m = t.match(/^(\d{4})$/))) return {from: utc(+m[1]), until: utc(+m[1] + 1)};
  if ((m = t.match(/^([a-z]+)\.?\s+(\d{4})$/)) && MONTHS[m[1]]) return {from: utc(+m[2], MONTHS[m[1]]), until: utc(+m[2], MONTHS[m[1]] + 1)};
  // Day, month and year: "3 March 2025", "the 3rd of March 2025", "March 3, 2025", "3 martie 2025", "3 mar. 2025", "03.03.2025".
  const day = (y, mo, d) => { const from = utc(y, mo, d); return mo >= 1 && mo <= 12 && new Date(from).getUTCDate() === d ? {from, until: from + DAY} : null; };
  if ((m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]+)\.?,?\s+(\d{4})$/)) && MONTHS[m[2]]) return day(+m[3], MONTHS[m[2]], +m[1]);
  if ((m = t.match(/^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/)) && MONTHS[m[1]]) return day(+m[3], MONTHS[m[1]], +m[2]);
  if ((m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/))) return day(+m[3], +m[2], +m[1]);
  if (t === 'now' || t === 'acum') return {from: now, until: now + 1};
  // Relative years ("last year" for a follow-up such as "dar anul trecut?"): the calendar year of the host clock, shifted.
  const YEARS = {'last year': -1, 'this year': 0, 'next year': 1};
  if (Object.hasOwn(YEARS, t)) { const y = new Date(now).getUTCFullYear() + YEARS[t]; return {from: utc(y), until: utc(y + 1)}; }
  if (Object.hasOwn(RELATIVE, t)) { const d = new Date(now); const from = utc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate() + RELATIVE[t]); return {from, until: from + DAY}; }
  return null;
}

/** Validity of a proposition from its `valid on|from|until` strings; absent means timeless. */
export function linkValidity(valid, now) {
  const issues = [];
  const period = form => { const p = normalizeTime(valid[form], now); if (!p) issues.push({kind: 'time', text: valid[form], status: 'unknown'}); return p; };
  let interval = {from: -Infinity, until: Infinity};
  if (valid.on) { const p = period('on'); if (p) interval = p; }
  else {
    const from = valid.from ? period('from') : null, until = valid.until ? period('until') : null;
    interval = {from: from ? from.from : -Infinity, until: until ? until.from : Infinity};
    if (from && until && !(interval.from < interval.until)) issues.push({kind: 'time', text: valid.from + ' … ' + valid.until, status: 'empty_interval'});
  }
  return {interval, issues, text: interval.from === -Infinity && interval.until === Infinity ? 'timeless' : formatTime(interval.from) + ' ' + formatTime(interval.until)};
}

/** The host clarification question for unlinked strings. */
export function linkQuestion(issues, language = 'en') {
  const ro = language === 'ro';
  return issues.map(issue => {
    if (issue.kind === 'entity') return ro ? `La cine sau la ce vă referiți prin ${JSON.stringify(issue.text)}?` : `Which entity do you mean by ${JSON.stringify(issue.text)}?`;
    if (issue.kind === 'time' && issue.status === 'not_an_interval') return ro ? `Variabila ${issue.text} este un argument al relației, nu o perioadă; ce măsură de timp doriți?` : `The variable ${issue.text} is an argument of the relation, not a period; which time measure do you want?`;
    if (issue.kind === 'time') return ro ? `La ce dată sau perioadă vă referiți prin ${JSON.stringify(issue.text)}?` : `Which date or period do you mean by ${JSON.stringify(issue.text)}?`;
    const choices = (issue.candidates ?? []).map(c => c.id + ' (' + c.roles.join(', ') + ')').join(ro ? ' sau ' : ' or ');
    if (issue.status === 'ambiguous') return ro ? `La ce relație vă referiți prin ${JSON.stringify(issue.text)}: ${choices}?` : `Which relation do you mean by ${JSON.stringify(issue.text)}: ${choices}?`;
    if (issue.status === 'role_mismatch') return ro ? `Relația ${JSON.stringify(issue.text)} are rolurile ${choices}; ce rol lipsește sau este în plus?` : `The relation ${JSON.stringify(issue.text)} takes the roles ${choices}; which role is missing or extra?`;
    return ro ? `Nu cunosc relația ${JSON.stringify(issue.text)}. Cum ați formula-o altfel?` : `I do not know the relation ${JSON.stringify(issue.text)}. How else would you phrase it?`;
  }).join(' ');
}

const tokensOf = s => fold(String(s)).match(/[\p{L}\p{N}]+/gu) ?? [];
/** Optimal string alignment distance: insertions, deletions, substitutions and adjacent transpositions. */
function distance(a, b) {
  const d = Array.from({length: a.length + 1}, (_, i) => Array.from({length: b.length + 1}, (_, j) => i ? (j ? 0 : i) : j));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
// Tokens match after folding when equal, within a small edit distance (0 up to 3
// characters, 1 up to 7, else 2), or as an inflection sharing all but the last
// character of a token of at least four characters.
function near(a, b) {
  if (a === b) return true;
  const allowed = a.length <= 3 ? 0 : a.length <= 7 ? 1 : 2;
  if (allowed && Math.abs(a.length - b.length) <= allowed && distance(a, b) <= allowed) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.startsWith(short.slice(0, -1)) && long.length <= short.length + 3;
}
/**
 * Is a value (a quoted string or a number from a model proposition) mentioned
 * in the message? Consecutive message tokens must match every value token
 * after case, whitespace and accent folding, tolerating small typos and
 * inflections. Deterministic; no lexicon is involved.
 */
export function mentionedIn(value, message) {
  const wanted = tokensOf(value), text = tokensOf(message);
  if (!wanted.length) return false;
  for (let i = 0; i + wanted.length <= text.length; i++) if (wanted.every((token, j) => near(token, text[i + j]))) return true;
  return false;
}

/**
 * Cross-lingual anchoring (DS021 "Input languages and content words"): a `stated` value written in
 * English for a common noun of a non-English message ("the gym" for "sala de sport") is anchored when the host
 * lexicon knows an entity with that surface and another surface of the same entity (any language) is mentioned
 * in the message. The host's own reviewed labels decide; no dictionary or model is involved.
 */
export function mentionedThroughLexicon(value, message, lexicon) {
  if (!lexicon?.folded) return false;
  const entries = (lexicon.folded.get(fold(String(value))) ?? []).map(index => lexicon.entries[index]).filter(entry => entry.kind === 'entity');
  for (const id of new Set(entries.map(entry => entry.id))) {
    for (const alias of lexicon.entities[id]?.aliases ?? []) if (mentionedIn(alias.surface, message)) return true;
  }
  return false;
}

const FIRST_PERSON = /(?<![\p{L}])(?:i|i'm|i've|i'd|me|my|mine|myself|eu|mie|mi|meu|mea|mei|mele|mă|ma|îmi|imi|noi|nostru|noastră|we|our|us)(?![\p{L}])/iu;
const FUNCTION_TOKENS = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'from', 'by', 'with', 's']);
/**
 * Anchoring through the host dictionary (DS021 "Content words"): the model may write a content word in the message's
 * language (normalized) or in English. A value is anchored when a surface of a dictionary entry it belongs to — in
 * either language, as a lemma or an inflected form — is mentioned in the message; a multiword value is anchored
 * when each of its content words is (directly or through the dictionary). "the user" is anchored by a first-person
 * word (Q-LANG-5).
 */
export function mentionedThroughDictionary(value, message, dictionary) {
  if (!dictionary || typeof value !== 'string') return false;
  const surfacesOf = text => dictionary.lookup(text).flatMap(hit => [...hit.entry.ro, ...hit.entry.forms.map(form => form.replace(/^def:/, '')), ...hit.entry.en]);
  const anchored = text => mentionedIn(text, message) || surfacesOf(text).some(surface => mentionedIn(surface, message)) || surfacesOf(text.replace(/^(?:the|a|an)\s+/i, '')).some(surface => mentionedIn(surface, message));
  if (anchored(value)) return true;
  const tokens = tokensOf(value).filter(token => !FUNCTION_TOKENS.has(token));
  if (!tokens.length) return false;
  return tokens.every(token => (token === 'user' || token === "user's") ? FIRST_PERSON.test(String(message)) : anchored(token));
}

export {ROLE_NAMES};
