/** Diversity gain of LLM-authored messages over the generator corpus (DS022 "LLM diversification").
 *
 * Every measure compares a set of messages with the formalizer-v1 train+dev messages (the reference):
 *   - masked templates (`maskedTemplate`, entity surfaces masked as E, numbers as N): share of new templates;
 *   - structural frames (`maskStructure`, closed-class words kept, content words X): share of new full skeletons
 *     and of new lead-ins (the first five skeleton tokens), a proxy for the question/discourse frame;
 *   - n-gram novelty: share of word 3-gram and 4-gram occurrences absent from every reference message;
 *   - new word types and distinct-n inside the set.
 * The same measures on dev messages against train only give the generator's own novelty as a baseline.
 */
import {maskedTemplate} from '../diversity/quotas.mjs';
import {maskStructure} from '../diversity/text.mjs';
import {tokens} from '../no-copy.mjs';
import {entitySurfaces} from './rows.mjs';

const grams = (words, n) => { const out = []; for (let i = 0; i + n <= words.length; i++) out.push(words.slice(i, i + n).join(' ')); return out; };
const leadIn = skeleton => skeleton.split(' ').slice(0, 5).join(' ');
const round = x => Number.isFinite(x) ? +x.toFixed(4) : null;
const quantile = (values, p) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };

/** Reference sets of a corpus (array of rows). */
export function referenceOf(rows) {
  const ref = {templates: new Set(), skeletons: new Set(), leadIns: new Set(), g3: new Set(), g4: new Set(), types: new Set()};
  for (const row of rows) {
    const skeleton = maskStructure(row.question);
    ref.templates.add(maskedTemplate(row.question, entitySurfaces(row)));
    ref.skeletons.add(skeleton);
    ref.leadIns.add(leadIn(skeleton));
    const words = tokens(row.question);
    for (const g of grams(words, 3)) ref.g3.add(g);
    for (const g of grams(words, 4)) ref.g4.add(g);
    for (const w of words) ref.types.add(w);
  }
  return ref;
}

/** Diversity of `rows` (each with `question` and its entity surfaces) against a reference. */
export function diversityAgainst(rows, ref) {
  const templates = rows.map(row => maskedTemplate(row.question, entitySurfaces(row)));
  const skeletons = rows.map(row => maskStructure(row.question));
  let g3 = 0, g3new = 0, g4 = 0, g4new = 0;
  const own2 = new Set(); let all2 = 0;
  const newTypes = new Set(), types = new Set();
  const lengths = [];
  for (const row of rows) {
    const words = tokens(row.question);
    lengths.push(words.length);
    for (const g of grams(words, 3)) { g3++; if (!ref.g3.has(g)) g3new++; }
    for (const g of grams(words, 4)) { g4++; if (!ref.g4.has(g)) g4new++; }
    for (const g of grams(words, 2)) { own2.add(g); all2++; }
    for (const w of words) { types.add(w); if (!ref.types.has(w)) newTypes.add(w); }
  }
  const n = rows.length || 1;
  return {
    rows: rows.length,
    new_masked_templates: round(templates.filter(t => !ref.templates.has(t)).length / n),
    distinct_masked_templates: new Set(templates).size,
    new_structural_skeletons: round(skeletons.filter(s => !ref.skeletons.has(s)).length / n),
    new_lead_ins: round(skeletons.filter(s => !ref.leadIns.has(leadIn(s))).length / n),
    distinct_lead_ins: new Set(skeletons.map(leadIn)).size,
    novel_3gram_occurrences: round(g3new / (g3 || 1)),
    novel_4gram_occurrences: round(g4new / (g4 || 1)),
    distinct_2: round(own2.size / (all2 || 1)),
    word_types: types.size, new_word_types: newTypes.size,
    words: {p50: quantile(lengths, 0.5), p90: quantile(lengths, 0.9), max: Math.max(0, ...lengths)},
    lower_case_start: round(rows.filter(row => /^\p{Ll}/u.test(row.question.trim())).length / n),
  };
}
