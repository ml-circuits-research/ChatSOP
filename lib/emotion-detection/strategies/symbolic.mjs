/** Symbolic strategy (id `symbolic`, basis `lexicon` or `pattern`): deterministic lexicons and patterns in English and
 * Romanian, plus emoji, punctuation intensity and all-caps words (DS023). It runs on the whole message and on every
 * leftover span, costs well under a millisecond per message and needs no model.
 */
import {RULES, EMOJI, ACRONYMS} from '../lexicon.mjs';

const LETTER = '[\\p{L}\\p{N}]';
/** Folds to lower case without diacritics, one UTF-16 unit per unit, so offsets map back to the original text. */
export function fold(text) {
  let out = '';
  for (const unit of text) {
    const base = unit.normalize('NFD')[0];
    out += unit === 'ß' ? 's' : base.toLowerCase().length === 1 ? base.toLowerCase() : unit;
  }
  return out;
}

const compiled = RULES.map(r => ({...r, re: new RegExp(`${r.pattern.startsWith(',') ? '' : `(?<!${LETTER})`}(?:${r.pattern})(?!${LETTER})`, 'giu')}));
const emoji = EMOJI.map(e => ({...e, re: new RegExp(e.pattern, 'gu')}));

/** A match opens a sentence, or follows a short opening clause ("thanks, hello"). */
const isSentenceStart = (folded, index) => { const before = folded.slice(0, index); return before.trim() === '' || /[.!?\n]\s*$/.test(before) || /^[^.!?]{0,30},\s*$/.test(before); };
const isEnd = (folded, end) => /^[\s.!?,;:)\]"'\p{Extended_Pictographic}]*$/u.test(folded.slice(end));

function ruleHits(text, folded) {
  const hits = [];
  for (const r of compiled) {
    r.re.lastIndex = 0;
    for (const m of folded.matchAll(r.re)) {
      if (!m[0]) continue;
      if (r.position === 'start' && !isSentenceStart(folded, m.index)) continue;
      if (r.position === 'end' && !isEnd(folded, m.index + m[0].length)) continue;
      hits.push({kind: r.kind, label: r.label, score: r.score, span: text.slice(m.index, m.index + m[0].length), start: m.index, basis: r.kind === 'confirmation_request' ? 'pattern' : 'lexicon'});
    }
  }
  return hits;
}

function emojiHits(text) {
  const hits = [];
  for (const e of emoji) for (const m of text.matchAll(e.re)) hits.push({kind: e.kind, label: e.label, score: e.score, span: m[0], start: m.index, basis: 'pattern'});
  return hits;
}

/** Punctuation intensity and all-caps words. */
function surfaceHits(text) {
  const hits = [];
  for (const m of text.matchAll(/[!?]*(?:\?!|!\?)[!?]*|!{2,}/g)) hits.push({kind: 'emphasis', label: m[0].includes('?') ? 'interrobang' : 'exclamations', score: m[0].includes('?') ? 0.7 : 0.75, span: m[0], start: m.index, basis: 'pattern'});
  for (const m of text.matchAll(/\b(\p{L})\1{2,}\p{L}*\b/gu)) if (/[\p{L}]{4,}/u.test(m[0])) hits.push({kind: 'emphasis', label: 'stretched_word', score: 0.7, span: m[0], start: m.index, basis: 'pattern'});
  const letters = text.match(/\p{L}/gu) ?? [], upper = text.match(/\p{Lu}/gu) ?? [];
  const caps = [...text.matchAll(/(?<![\p{L}'])\p{Lu}{3,}(?![\p{L}'])/gu)].filter(m => !ACRONYMS.has(m[0]));
  const shouted = caps.length > 1 ? caps : caps.filter(m => m[0].length >= 4);
  if (letters.length >= 10 && upper.length / letters.length >= 0.7) hits.push({kind: 'emphasis', label: 'all_caps', score: 0.8, span: text.trim(), start: text.indexOf(text.trim()), basis: 'pattern'});
  else for (const m of shouted) hits.push({kind: 'emphasis', label: 'caps_word', score: caps.length > 1 ? 0.7 : 0.55, span: m[0], start: m.index, basis: 'pattern'});
  return hits;
}

/** Signals of one text: [{kind, label, score, span, start, source, basis}]; overlapping hits of one kind keep the highest score. */
export function scan(text) {
  const folded = fold(text), all = [...ruleHits(text, folded), ...emojiHits(text), ...surfaceHits(text)];
  const kept = [];
  for (const h of all.sort((a, b) => b.score - a.score || a.start - b.start)) {
    const end = h.start + h.span.length;
    if (!kept.some(k => k.kind === h.kind && h.start < k.start + k.span.length && k.start < end)) kept.push(h);
  }
  return kept.sort((a, b) => a.start - b.start).map(h => {
    const lead = h.span.match(/^,\s*/)?.[0].length ?? 0;
    return {...h, span: h.span.slice(lead), start: h.start + lead, source: 'symbolic'};
  });
}

/** The strategy object registered with the EmotionDetectionSystem. */
export function createSymbolicStrategy() {
  return {
    id: 'symbolic',
    kinds: [...new Set(RULES.map(r => r.kind).concat(EMOJI.map(e => e.kind), ['emphasis']))],
    /** @returns signals found in the message and in each leftover span (those carry `leftover: true`). */
    detect(message, {leftoverSpans = []} = {}) {
      const out = scan(message).map(({start, ...s}) => ({...s, leftover: leftoverSpans.some(l => fold(l.span ?? l).includes(fold(s.span)))}));
      const seen = new Set(out.map(s => s.kind + '|' + fold(s.span)));
      for (const l of leftoverSpans) {
        const text = l.span ?? l;
        for (const {start, ...s} of scan(text)) if (!seen.has(s.kind + '|' + fold(s.span))) { seen.add(s.kind + '|' + fold(s.span)); out.push({...s, leftover: true}); }
      }
      return out;
    },
  };
}
