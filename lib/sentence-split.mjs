/** Host-side sentence segmentation of a user message and merging of per-sentence model outputs
 * (experiment eval-sentence-split-v1, DS021 host work after the model).
 *
 * `splitSentences(text)` cuts an English or Romanian message into sentence units deterministically. Each unit is
 * an exact substring of the message (`start`, `end` offsets), so the formalizer still receives message text only.
 * Rules, in order:
 *  - a newline ends a unit when the line ends in terminal punctuation or a colon, when the next line is empty,
 *    or when either line is a list item (`-`, `*`, `•`, `1.`, `1)`, `a)`); a wrapped line that continues in lower
 *    case is joined;
 *  - inside a line a unit ends after `.`, `!`, `?`, `…` (and runs such as `?!`, `...`), plus any closing quotes or
 *    brackets, when whitespace follows; the punctuation stays with its sentence;
 *  - no cut inside balanced quotes (`"…"`, `„…”`, `“…”`, `«…»`) or parentheses, after a known EN/RO abbreviation
 *    (Dr., dl., nr., str., etc. before a lower-case word, e.g., i.e.), after an initial (`J.`), after an ordinal or
 *    date number followed by a lower-case word (`3. martie`), or after an ellipsis followed by a lower-case word.
 *    Decimals, times and dates (`3.5`, `10.30`, `12.03.2024`) never cut because no whitespace follows the dot.
 *
 * `mergePrograms(outputs)` joins the SOP outputs of the units into one model-surface program (see its comment).
 */
import {parse, canonical} from '../sop/parser.mjs';
import {propositionOf, propositionKey} from '../sop/propositions.mjs';
import {stable} from './util.mjs';
import {wireKey} from '../eval/metrics.mjs';

// Lower-case abbreviations (without the final dot) after which a dot never ends a sentence: titles, addresses,
// numbering and Latin forms that are always followed by more of the same sentence.
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'jr', 'sr', 'vs', 'no', 'nos', 'approx', 'dept', 'ave', 'blvd', 'rd', 'mt', 'e.g', 'i.e',
  'cf', 'fig', 'vol', 'p', 'pp', 'dl', 'dna', 'd-na', 'd-l', 'dnul', 'dra', 'd-ra', 'nr', 'str', 'bd', 'bdul', 'b-dul', 'sos', 'șos',
  'sf', 'ing', 'conf', 'lect', 'asist', 'av', 'jud', 'mun', 'ap', 'bl', 'tel', 'pag', 'alin', 'lit', 'pct', 'aprox', 'dvs', 'dv',
  'd.hr', 'î.hr', 'î.e.n',
]);
// Abbreviations that are also ordinary sentence-final words ("etc.", months, "sat", "mai", "lei"): they end a
// sentence only before an upper-case letter (never before a digit, so a date such as "17 iul. 2021" stays whole).
const SOFT_ABBREVIATIONS = new Set([
  'etc', 'ș.a', 's.a', 'ș.a.m.d', 'inc', 'ltd', 'co', 'corp', 'al', 'ch', 'sec', 'min', 'max', 'est', 'ed', 'et', 'ex', 'resp',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun',
  'ian', 'febr', 'mai', 'iun', 'iul', 'noi', 'lei', 'mil', 'mld', 'loc', 'com', 'cap', 'art', 'sc', 'adică',
]);
const QUOTE_PAIRS = [['"', '"'], ['„', '”'], ['“', '”'], ['«', '»'], ['‘', '’']];
const LIST_ITEM = /^\s*(?:[-*•–·]\s+|\d{1,2}[.)]\s+|[a-zA-Z][)]\s+)/;
const TERMINAL = /[.!?…:;]["'”»’)\]]*\s*$/;
const CLOSERS = new Set(['"', '”', '»', '’', "'", ')', ']']);

/** The message cut into lines that each hold one or more whole sentences (offsets into `text`). */
function lineUnits(text) {
  const lines = [];
  let start = 0;
  for (const piece of text.split('\n')) {
    lines.push({start, end: start + piece.length, text: piece});
    start += piece.length + 1;
  }
  const units = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.text.trim()) { current = null; continue; }
    const list = LIST_ITEM.test(line.text);
    const joinable = current && !list && !current.list && !TERMINAL.test(current.text) && /^\s*[a-zăâîșşțţ]/.test(line.text);
    if (joinable) { current.end = line.end; current.text = text.slice(current.start, current.end); continue; }
    current = {start: line.start, end: line.end, text: line.text, list};
    units.push(current);
  }
  return units;
}

const isUpperStart = s => /^["'„“«(\[]?\s*[\p{Lu}\d]/u.test(s);
const isUpperLetterStart = s => /^["'„“«(\[]?\s*\p{Lu}/u.test(s);
const isLowerStart = s => /^["'„“«(\[]?\s*\p{Ll}/u.test(s);

/** Whether the dot at `index` of `line` (followed by whitespace, then `rest`) ends a sentence. */
function dotEnds(line, index, rest) {
  const before = line.slice(0, index);
  const token = (before.match(/(\S+)$/)?.[1] ?? '').replace(/^["'„“«(\[]+/, '');
  const word = token.toLowerCase().replace(/\.$/, '');
  if (SOFT_ABBREVIATIONS.has(word)) return isUpperLetterStart(rest); // "17 iul. 2021" stays whole
  if (ABBREVIATIONS.has(word)) return false;
  if (/^\p{Lu}$/u.test(token)) return false; // an initial such as "J."
  if (/^(?:\p{L}\.)+\p{L}$/u.test(token)) return isUpperStart(rest); // "a.m", "U.S": cut only before an upper-case start
  if (/^\d{1,4}$/.test(token) && isLowerStart(rest)) return false; // an ordinal or a date: "3. martie"
  return true;
}

/** Sentence units of one line (offsets relative to the line). */
function lineSentences(line) {
  const cuts = [];
  const open = [];
  let parens = 0;
  // Quote tracking is used only when the line's quotes are balanced; otherwise a stray quote would block every cut.
  const straight = (line.match(/"/g) ?? []).length;
  const trackQuotes = straight % 2 === 0 && QUOTE_PAIRS.slice(1).every(([a, b]) => a === b || (line.split(a).length - 1) === (line.split(b).length - 1) || a === '‘');
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (trackQuotes) {
      // A quotation that ends in terminal punctuation ends the sentence when an upper-case start follows it.
      const closeQuote = () => {
        open.pop();
        if (!open.length && !parens && /[.!?…]/.test(line[i - 1] ?? '') && /\s/.test(line[i + 1] ?? '') && isUpperStart(line.slice(i + 1).trimStart())) cuts.push(i + 1);
      };
      if (c === '"') { if (open.at(-1) === '"') closeQuote(); else open.push('"'); continue; }
      const pair = QUOTE_PAIRS.find(([a]) => a === c && a !== '"' && a !== '‘');
      if (pair) { open.push(pair[1]); continue; }
      if (open.length && c === open.at(-1)) { closeQuote(); continue; }
    }
    if (c === '(') parens++;
    else if (c === ')' && parens > 0) parens--;
    if (!/[.!?…]/.test(c) || open.length || parens) continue;
    let j = i;
    while (j + 1 < line.length && /[.!?…]/.test(line[j + 1])) j++;
    while (j + 1 < line.length && CLOSERS.has(line[j + 1])) j++;
    if (j + 1 >= line.length || !/\s/.test(line[j + 1])) { i = j; continue; }
    const rest = line.slice(j + 1).trimStart();
    if (!rest) { i = j; continue; }
    const run = line.slice(i, j + 1);
    const ends = /[!?]/.test(run) ? true : /\.\.|…/.test(run) ? !isLowerStart(rest) : dotEnds(line, i, rest);
    if (ends) cuts.push(j + 1);
    i = j;
  }
  const out = [];
  let from = 0;
  for (const cut of [...cuts, line.length]) {
    const piece = line.slice(from, cut);
    const lead = piece.length - piece.trimStart().length, trail = piece.length - piece.trimEnd().length;
    if (piece.trim()) out.push({start: from + lead, end: cut - trail});
    from = cut;
  }
  return out;
}

/**
 * Sentence units of a message: `[{text, start, end, list}]`, in message order, each an exact substring of
 * `text` with surrounding whitespace removed. A message without any cut yields one unit.
 */
export function splitSentences(text) {
  const message = String(text ?? '');
  const units = [];
  for (const line of lineUnits(message)) {
    if (line.list) { units.push({start: line.start, end: line.end, list: true}); continue; }
    for (const s of lineSentences(line.text)) units.push({start: line.start + s.start, end: line.start + s.end, list: false});
  }
  let out = units.map(u => {
    const raw = message.slice(u.start, u.end), lead = raw.length - raw.trimStart().length, trail = raw.length - raw.trimEnd().length;
    return {text: raw.trim(), start: u.start + lead, end: u.end - trail, list: u.list};
  }).filter(u => u.text);
  // A lead-in that ends in a colon ("What I want to know:", "Întrebările mele:") says nothing alone: it is joined
  // with the unit after it (the dev pilot showed the model inventing a query for a bare lead-in).
  for (let i = out.length - 2; i >= 0; i--) {
    if (!/:\s*$/.test(out[i].text)) continue;
    const merged = {start: out[i].start, end: out[i + 1].end, list: out[i + 1].list};
    out.splice(i, 2, {...merged, text: message.slice(merged.start, merged.end)});
  }
  // A unit without a letter or digit (emoji, "!!!") belongs to the sentence before it (or after it, when first).
  for (let i = out.length - 1; i >= 0 && out.length > 1; i--) {
    if (/[\p{L}\p{N}]/u.test(out[i].text)) continue;
    const into = i > 0 ? i - 1 : i + 1, a = Math.min(i, into), b = Math.max(i, into);
    const merged = {start: out[a].start, end: out[b].end, list: out[a].list && out[b].list};
    out.splice(a, 2, {...merged, text: message.slice(merged.start, merged.end)});
  }
  return out.length ? out : [{text: message.trim(), start: 0, end: message.length, list: false}];
}

/** The well-formed wires of one model output: the whole output when it parses, else each `@` block alone. */
export function outputWires(text) {
  const source = String(text ?? '');
  try { return {wires: parse(source).wires, dropped: 0}; } catch { /* parse block by block */ }
  const blocks = source.split(/\n(?=@)/).map(b => b.trim()).filter(b => b.startsWith('@'));
  const wires = [];
  let dropped = source.trim() && !blocks.length ? 1 : 0;
  for (const block of blocks) { try { wires.push(...parse(block).wires); } catch { dropped++; } }
  return {wires, dropped};
}

const unclearKind = wire => wire.fields.kind?.[0] ?? null;
const statementKey = wire => {
  try {
    const p = propositionOf(wire);
    return {proposition: propositionKey(p), full: stable([wire.type, propositionKey(p), p.certainty ?? null, p.speaker ?? null])};
  } catch { return null; }
};

/**
 * Merge the SOP outputs of a message's sentence units (in message order) into one program.
 * `outputs` is `[{text, exclude?}]`, where `exclude` is a list of SOP texts whose wires (as a multiset of wire
 * keys) are removed from this unit first (the S2 "difference" merge: a pair output minus the previous sentence's
 * own output). Steps:
 *  1. each output is parsed (block by block when the whole output does not parse; unparsable blocks are dropped
 *     and counted);
 *  2. `unclear`: when any unit yields content (a statement, query or constraint), every `unclear` wire is
 *     dropped (chit-chat `no_request`, `gibberish`, `ambiguous`); when no unit does, the result is one `unclear`:
 *     the first `ambiguous` if any, else `no_request` if any unit said so, else `gibberish` (kept only when every
 *     unit is gibberish);
 *  3. duplicates are dropped: an identical wire (DS016 wire key), an identical statement (proposition, certainty,
 *     speaker), and an `assumed` whose proposition equals a `stated` one;
 *  4. wires are ordered stated, assumed, then query/constraint, each in message order, and renumbered
 *     `s1…`, `a1…`, `q, q2…`, `c, c2…` (as the corpus golds are), so ids never collide.
 * Returns `{sop, stats}`.
 */
export function mergePrograms(outputs) {
  const stats = {units: outputs.length, dropped_unparsable_blocks: 0, dropped_unclear: 0, dropped_duplicates: 0, dropped_assumed_duplicating_stated: 0, excluded_by_difference: 0, unclear_units: {}};
  const perUnit = outputs.map(({text, exclude = []}) => {
    const {wires, dropped} = outputWires(text);
    stats.dropped_unparsable_blocks += dropped;
    if (!exclude.length) return wires;
    const pool = new Map();
    for (const other of exclude) for (const w of outputWires(other).wires) { const k = wireKey(w); pool.set(k, (pool.get(k) ?? 0) + 1); }
    return wires.filter(w => {
      const k = wireKey(w);
      if (pool.get(k) > 0) { pool.set(k, pool.get(k) - 1); stats.excluded_by_difference++; return false; }
      return true;
    });
  });
  for (const wires of perUnit) for (const w of wires) if (w.type === 'unclear') stats.unclear_units[unclearKind(w)] = (stats.unclear_units[unclearKind(w)] ?? 0) + 1;
  const content = perUnit.flat().filter(w => w.type !== 'unclear');
  if (!content.length) {
    const unclear = perUnit.flat().filter(w => w.type === 'unclear');
    if (!unclear.length) return {sop: '', stats};
    const pick = unclear.find(w => unclearKind(w) === 'ambiguous') ?? unclear.find(w => unclearKind(w) === 'no_request') ?? unclear[0];
    stats.dropped_unclear = unclear.length - 1;
    return {sop: canonical({wires: [{...pick, id: 'u'}]}), stats};
  }
  stats.dropped_unclear = perUnit.flat().length - content.length;
  const seen = new Set(), seenStatements = new Set(), statedPropositions = new Set();
  const kept = [];
  for (const w of content) {
    const key = wireKey(w);
    const s = w.type === 'stated' || w.type === 'assumed' ? statementKey(w) : null;
    if (seen.has(key) || (s && seenStatements.has(s.full))) { stats.dropped_duplicates++; continue; }
    seen.add(key);
    if (s) { seenStatements.add(s.full); if (w.type === 'stated') statedPropositions.add(s.proposition); }
    kept.push({w, s});
  }
  const withoutRedundant = kept.filter(({w, s}) => {
    if (w.type === 'assumed' && s && statedPropositions.has(s.proposition)) { stats.dropped_assumed_duplicating_stated++; return false; }
    return true;
  }).map(({w}) => w);
  const order = ['stated', 'assumed', 'query', 'constraint'];
  const counters = {};
  const prefix = {stated: 's', assumed: 'a', query: 'q', constraint: 'c'};
  const renumbered = order.flatMap(type => withoutRedundant.filter(w => w.type === type)).map(w => {
    const p = prefix[w.type] ?? 'w';
    counters[p] = (counters[p] ?? 0) + 1;
    const id = (p === 'q' || p === 'c') && counters[p] === 1 ? p : p + counters[p];
    return {...w, id};
  });
  return {sop: canonical({wires: renumbered}), stats};
}
