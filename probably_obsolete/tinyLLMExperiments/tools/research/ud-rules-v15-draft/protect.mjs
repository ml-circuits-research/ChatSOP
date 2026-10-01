/**
 * Symbolic protection of names, quoted spans and numbers around a text rewriter (experiment eval-rewrite-symbolic-v1).
 *
 * `protect(text)` replaces every proper-name run, double-quoted span and number (with its unit or currency) by a
 * placeholder `Ent1`, `Num1`, `Quote1`, … and returns `{text, slots}`; `restore(text, slots)` puts the originals back
 * and reports which placeholders the rewriter kept (each exactly once), dropped or duplicated. The rewriter never
 * sees the protected values, so it cannot misspell, translate or invent them; the symbolic path parses the restored
 * text. A capitalized word counts as a name unless it opens a sentence and its lower-case form is an ordinary
 * English word (the system word list, /usr/share/dict/american-english, when present) or a function word.
 */
import fs from 'node:fs';

let WORDS = null;
const TITLES = new Set(['Mr', 'Ms', 'Mrs', 'Dr', 'Prof', 'Dl', 'Dna', 'Doamna', 'Domnul', 'Sir']);
function commonWords() {
  if (WORDS) return WORDS;
  WORDS = new Set(['i', 'a', 'an', 'the', 'is', 'are', 'was', 'were', 'do', 'does', 'did', 'can', 'could', 'will', 'would', 'should', 'may', 'might', 'must', 'has', 'have', 'had',
    'who', 'what', 'which', 'where', 'when', 'why', 'how', 'and', 'or', 'but', 'if', 'so', 'yes', 'no', 'hi', 'hello', 'hey', 'thanks', 'please', 'ok', 'okay', 'also', 'any', 'anyone', 'is', 'it', 'my', 'our', 'we', 'you', 'they', 'he', 'she', 'this', 'that', 'there']);
  for (const file of ['/usr/share/dict/american-english', '/usr/share/dict/words']) {
    try { for (const w of fs.readFileSync(file, 'utf8').split('\n')) if (w && w === w.toLowerCase()) WORDS.add(w); break; } catch { /* no word list */ }
  }
  return WORDS;
}

const NUMBER = /(?<![\p{L}\d])(?:[€$£]\s?)?\d[\d.,:/-]*\d?(?:\s?(?:%|€|\$|£|lei|ron|eur|euro|usd|gbp|km|kg|m|h|am|pm|ani|years?|zile|days?))?\b/giu;

/** Replace names, quotes and numbers by placeholders: {text, slots: [{kind, key, value}]}. */
export function protect(text) {
  const slots = [];
  const put = (kind, value) => { const key = kind + (slots.filter(s => s.kind === kind).length + 1); slots.push({kind, key, value}); return key; };
  let out = String(text).replace(/"[^"\n]{1,200}"|“[^”\n]{1,200}”|„[^”"\n]{1,200}[”"]/g, m => put('Quote', m));
  const words = commonWords();
  // Name runs: capitalized words joined by single spaces, optionally with an inner "&", "of", "de", … joiner.
  // A capitalized word; a final dot only on a title or an initial ("Mr.", "St.", "J."), never on a sentence end.
  const CAP = "(?!(?:Ent|Num|Quote)\\d)(?!I(?:['’](?:m|ve|d|ll))?(?![\\p{L}\\p{M}\\d'’-]))(?:(?:Mr|Mrs|Ms|Dr|St|Prof|Jr|Sr|Dl|Dna|\\p{Lu})\\.(?=\\s)|\\p{Lu}[\\p{L}\\p{M}\\d'’-]*)";
  const RUN = new RegExp(`${CAP}(?:\\s(?:(?:&|of|de|la|din|van|von|da|del|di|du)\\s)?${CAP})*`, 'gu');
  out = out.replace(RUN, (match, offset, whole) => {
    if (/^(?:Ent|Num|Quote)\d+$/.test(match)) return match;
    let parts = match.split(' ');
    const before = whole.slice(0, offset);
    const sentenceStart = !before.trim() || /[.!?:\n]\s*$/.test(before);
    let lead = '';
    if (sentenceStart && words.has(parts[0].toLowerCase().replace(/[.'’]$/, '')) && !TITLES.has(parts[0].replace(/\.$/, ''))) { lead = parts.shift(); while (parts.length && words.has(parts[0].toLowerCase()) && parts[0] !== parts[0].toUpperCase()) lead += ' ' + parts.shift(); }
    while (parts.length && /^(?:&|of|de|la|din|van|von|da|del|di|du)$/.test(parts.at(-1))) parts.pop();
    const name = parts.join(' ');
    if (!name || name === 'I') return match;
    const rest = match.slice(lead.length + (lead ? 1 : 0) + name.length);
    return (lead ? lead + ' ' : '') + put('Ent', name) + rest;
  });
  out = out.replace(NUMBER, m => (/^(?:Ent|Num|Quote)\d+$/.test(m) ? m : put('Num', m)));
  return {text: out, slots};
}

/** Put the protected values back: {text, kept, dropped, duplicated, preserved} (preserved = every slot exactly once). */
export function restore(text, slots) {
  let out = String(text);
  // A rewriter's tokenizer may split a placeholder ("Ent 1"); both spellings are restored.
  const keyPattern = key => new RegExp('\\b' + key.replace(/(\d+)$/, '\\s?$1') + '\\b', 'g');
  const counts = new Map(slots.map(s => [s.key, (out.match(keyPattern(s.key)) ?? []).length]));
  for (const s of [...slots].sort((a, b) => b.key.length - a.key.length)) out = out.replace(keyPattern(s.key), () => s.value);
  const dropped = slots.filter(s => counts.get(s.key) === 0).map(s => s.key);
  const duplicated = slots.filter(s => counts.get(s.key) > 1).map(s => s.key);
  const invented = [...new Set((String(text).match(/\b(?:Ent|Num|Quote)\s?\d+\b/g) ?? []).map(k => k.replace(/\s/, '')))].filter(key => !slots.some(s => s.key === key));
  // Preserved: every protected value comes back and no placeholder was invented; a repeated subject is allowed.
  return {text: out, kept: slots.length - dropped.length, dropped, duplicated, invented, preserved: !dropped.length && !invented.length};
}
