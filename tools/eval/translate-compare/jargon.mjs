/**
 * LanguagesUtil jargon detector and protector (PROPOSAL of the translate-compare study, 2026-10-01; DS021 "LanguagesUtil", "Jargon protection").
 * Not wired into the product path. Owner decision of 2026-10-01: never fine-tune on project jargon; jargon is handled by putting its words in
 * quotes before translation and restoring them afterwards, and by a component that discovers jargon.
 *
 * `detectJargon(text, resources)` flags spans a translator should keep verbatim, each with a reason:
 *   - `code`        file names and paths, snake_case, camelCase, CLI flags, @mentions, dotted or colon-separated identifiers, ids with digits;
 *   - `english`     an English word (known to the English word list, not to the Romanian one) inside a Romanian sentence;
 *   - `capitalised` a capitalised or ALL-CAPS word that is not at a sentence start (project terms, product names);
 *   - `unknown`     a word of both word lists' blind spot: in neither the English nor the Romanian list (diacritics folded), not the host
 *                   dictionary, and not a probable typo of a known word (no one-edit neighbour);
 *   - `listed`      a word of a reviewed or discovered jargon list (`resources.listed`: a Set of folded words), which may be an ordinary
 *                   Romanian word with a project sense, for example "fire" (wires), "teste" (sealed tests), "sigilat".
 * `protectJargon` wraps each span in double quotes, `restoreJargon` puts the original spans back inside the quotes the translator kept.
 * `discoverJargon(texts, resources)` proposes `listed` candidates: words far more frequent in the user's own text than in general Romanian.
 *
 * Resources: `{spellfix, dictionary?, listed?}`; `spellfix` is a loaded lib/languages-util/spellfix.mjs instance. Deterministic, no model, CPU only.
 */
import {tokenize} from '../../../lib/languages-util/langid.mjs';
import {fold} from '../../../sop/dictionary.mjs';

export const JARGON_VERSION = 'jargon-proposal-v1';

const CODE_TOKEN = /^(?:@?[\w.-]*[\\/][\w.\\/-]*|@[\w.-]+|--?[a-z][\w-]*|[\w-]*_[\w-]*|[a-z]+[A-Z][\w]*|[\w-]+\.[a-z]{2,5}|[\w]+(?:::|->)[\w:>-]+|\w*\d\w*[a-zA-Z]\w*|[a-zA-Z]\w*\d\w*|`[^`]+`)$/;
const ROMANIAN_ENDING = /-(?:ul|ului|urile|urilor|uri|le|lor|ii|ilor|a|ul-)$/;
// Ordinary English words that a Romanian writer uses unmarked and that every MT system handles; quoting them gains nothing.
const IGNORE_EN = new Set(['ok', 'okay', 'si', 'a', 'o', 'i', 'in', 'an', 'as', 'is', 'on', 'or', 'no', 'to', 'do', 'be', 'by', 'it', 'at', 'we', 'he', 'me', 'my', 'us', 'up', 'so']);

const roFold = new WeakMap();
function foldedRomanian(spellfix) {
  let set = roFold.get(spellfix);
  if (!set) { set = new Set(); for (const w of spellfix.dict.ro) set.add(fold(w)); roFold.set(spellfix, set); }
  return set;
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
/** All strings one edit (deletion, transposition, substitution, insertion) away from `word`. */
function edits1(word) {
  const out = new Set(), n = word.length;
  for (let i = 0; i < n; i++) {
    out.add(word.slice(0, i) + word.slice(i + 1));
    if (i + 1 < n) out.add(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2));
    for (const c of ALPHABET) out.add(word.slice(0, i) + c + word.slice(i + 1));
  }
  for (let i = 0; i <= n; i++) for (const c of ALPHABET) out.add(word.slice(0, i) + c + word.slice(i));
  return out;
}

/** Does `text` occur in `out` as a whole token (case-insensitive; letters and digits do not continue it)? */
export const hasSpan = (out, text) => new RegExp(`(?<![\\p{L}\\p{N}_])${String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'iu').test(out);

const stripEnd = text => text.replace(/[.,;:!?)]+$/, '');

/** Tokens of one text with offsets, joined where a code-like token spans punctuation ("@docs/wire_types.html"). */
function spans(text) {
  const out = [];
  for (const m of String(text).matchAll(/`[^`\n]+`|\S+/g)) {
    const raw = m[0];
    const lead = /^[("'“„\[]+/.exec(raw)?.[0].length ?? 0;
    const trimmed = stripEnd(raw.slice(lead)).replace(/["'”\]]+$/, '');
    if (!trimmed) continue;
    out.push({text: trimmed, start: m.index + lead, end: m.index + lead + trimmed.length, raw});
  }
  return out;
}

/** Spans to keep verbatim: [{start, end, text, reason}] in text order, non-overlapping. */
export function detectJargon(text, {spellfix, dictionary = null, listed = null, reasons = null} = {}) {
  const want = r => !reasons || reasons.includes(r);
  const ro = foldedRomanian(spellfix);
  const inEn = w => spellfix.dict.en.has(w), inRo = w => spellfix.dict.ro.has(w) || ro.has(fold(w)) || Boolean(dictionary?.roTokens?.has(fold(w)));
  const tokens = tokenize(text).filter(t => t.kind === 'word');
  const roMarkers = tokens.filter(t => { const k = fold(t.text); return inRo(t.text.toLowerCase()) && !inEn(t.text.toLowerCase()) && t.text.length > 1; }).length;
  const enMarkers = tokens.filter(t => inEn(t.text.toLowerCase()) && !inRo(t.text.toLowerCase()) && t.text.length > 1).length;
  const romanianSentence = roMarkers >= Math.max(2, enMarkers); // English words inside a mostly Romanian sentence
  const found = [];
  const pieces = spans(text);
  pieces.forEach((p, i) => {
    const raw = p.text;
    if (want('code') && (CODE_TOKEN.test(raw) || /^[A-Za-z]+(?:-[A-Za-z]+)*\.[a-z]{2,5}$/.test(raw)) && !/^\d+([.,:/-]\d+)*$/.test(raw) && !/^\d+[a-z%]{0,3}$/i.test(raw) && !/^[a-zA-ZăâîșțĂÂÎȘȚ]+-[a-zA-ZăâîșțĂÂÎȘȚ]{1,4}$/.test(raw)) { found.push({...p, reason: 'code'}); return; }
    if (!/^[\p{L}\p{M}'’-]+$/u.test(raw)) return;
    const base = raw.replace(ROMANIAN_ENDING, '');
    const lower = base.toLowerCase();
    const previous = pieces[i - 1]?.raw ?? '';
    const sentenceStart = i === 0 || /[.!?:]["')]?$/.test(previous) || /\n/.test(text.slice(pieces[i - 1].end, p.start));
    const ordinary = (spellfix.ranks.en.get(lower) ?? Infinity) <= 5000 || (spellfix.ranks.ro.get(lower) ?? Infinity) <= 5000 || (spellfix.ranks.ro.get(fold(lower)) ?? Infinity) <= 5000;
    if (want('capitalised') && /^\p{Lu}/u.test(base) && base !== 'I' && base.length > 1 && (base === base.toUpperCase() || /\p{Ll}\p{Lu}/u.test(base) || (!sentenceStart && !ordinary))) { found.push({...p, reason: 'capitalised'}); return; }
    if (want('listed') && listed && (listed.has(fold(lower)) || listed.has(fold(raw)))) { found.push({...p, reason: 'listed'}); return; }
    if (IGNORE_EN.has(lower) || lower.length < 3) return;
    if (want('english') && romanianSentence && lower.length >= 4 && inEn(lower) && !inRo(lower) && !inRo(fold(lower)) && (spellfix.ranks.ro.get(lower) ?? Infinity) > 30000 && !/^\p{Lu}/u.test(base)) { found.push({...p, reason: 'english'}); return; }
    if (want('unknown') && lower.length >= 5 && !inEn(lower) && !inRo(lower) && !spellfix.known(lower) && !/^\p{Lu}/u.test(base)) {
      // A probable typo (a known word within two edits, diacritics folded) is left for spelling correction and translation; only a word with no known neighbour is jargon.
      const f = fold(lower), known = w => inEn(w) || inRo(w) || spellfix.known(w);
      let near = false;
      for (const a of edits1(f)) { if (known(a)) { near = true; break; } }
      if (!near) outer: for (const a of edits1(f)) { for (const b of edits1(a)) if (known(b)) { near = true; break outer; } }
      if (!near) found.push({...p, reason: 'unknown'});
    }
  });
  return found;
}

/** Wrap every span in double quotes: {text, spans}; a span already inside quotes is not wrapped twice. */
export function protectJargon(text, resources) {
  const spansFound = detectJargon(text, resources);
  let out = '', at = 0;
  for (const s of spansFound) {
    const quoted = /["“„]$/.test(text.slice(0, s.start)) && /^["”]/.test(text.slice(s.end));
    out += text.slice(at, s.start) + (quoted ? s.text : `"${s.text}"`);
    at = s.end;
  }
  return {text: out + text.slice(at), spans: spansFound};
}

/**
 * Restore after translation. A quoted span the translator kept as `"x"` is checked against the original in order: when the number of
 * quoted spans in the output equals the number protected, each content is replaced by the original span (the quotes are removed);
 * otherwise nothing is replaced. Returns {text, kept, quotes, restored}: `kept` counts spans whose original text survived verbatim
 * (case-insensitive) anywhere in the output, `quotes` the quoted groups found.
 */
export function restoreJargon(translated, spansProtected, {dropQuotes = true} = {}) {
  const out = String(translated);
  const groups = [...out.matchAll(/["“„]([^"”“„]{1,200})["”]/g)];
  const kept = spansProtected.filter(s => hasSpan(out, s.text)).length;
  if (!spansProtected.length || groups.length !== spansProtected.length) return {text: out, kept, quotes: groups.length, restored: false, spans: spansProtected.length};
  let i = 0;
  const text = out.replace(/["“„]([^"”“„]{1,200})["”]/g, () => { const s = spansProtected[i++]; return dropQuotes ? s.text : `"${s.text}"`; });
  return {text, kept, quotes: groups.length, restored: true, spans: spansProtected.length};
}

/**
 * Discovery: candidate jargon words of a user's own messages. A folded word qualifies when it occurs at least `minCount` times in `texts` and its
 * per-million rate there is at least `ratio` times its rate in general Romanian and general English text (or it is absent from both lists).
 * Returns [{word, count, perMillion, general, ratio}] by decreasing ratio; the owner reviews the list before it becomes `listed`.
 */
export function discoverJargon(texts, {spellfix, minCount = 3, ratio = 40} = {}) {
  const counts = new Map();
  let total = 0;
  for (const text of texts) for (const t of tokenize(text)) {
    if (t.kind !== 'word') continue;
    const w = fold(t.text.toLowerCase());
    if (w.length < 3) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
    total++;
  }
  const out = [];
  for (const [word, count] of counts) {
    if (count < minCount) continue;
    const mine = (count * 1e6) / total;
    const entry = spellfix.freq.get(word);
    const general = entry ? Math.max(entry.ro * spellfix.perMillion.ro, entry.en * spellfix.perMillion.en) : 0;
    const r = mine / Math.max(general, 0.02);
    if (r >= ratio) out.push({word, count, perMillion: Number(mine.toFixed(1)), general: Number(general.toFixed(2)), ratio: Number(r.toFixed(0))});
  }
  return out.sort((a, b) => b.ratio - a.ratio || b.count - a.count);
}
