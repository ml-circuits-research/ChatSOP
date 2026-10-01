/**
 * Routing gate and acceptance check of the optional SymbolicLM rewrite pipeline (DS021 "Optional rewrite pipeline").
 *
 * SymbolicLM decides locally and deterministically, with no model, (1) which sentence units go to the rewrite backend
 * (SymbolicProofingLLM) and (2) whether a rewritten unit replaces the original:
 *
 *   certified   every sentence of a text has identical Stanza default and accurate trees (same tokens, same head and relation
 *               on every token; `compareSentence` class `identical`, lib/symbolic-lm/uncertainty.mjs);
 *   gate        `trees` (send a unit that is not certified), `trees_or_uncertain` (also send a unit SymbolicLM does not handle
 *               alone: unparsed span, rule fallback or any other uncertainty reason), `always` (send every unit), `uncertain`
 *               (the earlier hook: only when the uncertainty signal fires);
 *   acceptance  `off` (keep every rewrite), `certified` (the rewritten text is certified AND the mechanical meaning checks hold:
 *               names, numbers, negation, quantifiers, question mark, non-empty), `certified_compare` (the same AND the analysis
 *               comparison `analysis-compare-v1` of the unit and its rewrite does not say `different`). A refused rewrite leaves
 *               the original unit in place.
 *
 * Pure functions: no I/O, no model call; the caller supplies the parses.
 */
import {compareSentence} from './uncertainty.mjs';

export const REWRITE_GATES = Object.freeze(['uncertain', 'trees', 'trees_or_uncertain', 'always']);
export const REWRITE_ACCEPTANCE = Object.freeze(['off', 'certified', 'certified_compare']);

const compact = sentence => sentence?.tokens ?? (sentence?.words ?? []).map(w => [w.id, w.text, w.lemma, w.upos, w.head, w.deprel]);

/** Whether the accurate and the default parses of one text (lists of sentences, worker `words` or compact `tokens`) are identical sentence by sentence. */
export function treesCertified(accurate, defaults) {
  if (!accurate?.length || !defaults || defaults.length !== accurate.length) return false;
  return accurate.every((s, i) => compareSentence(compact(defaults[i]), compact(s)) === 'identical');
}

/** Whether a unit goes to the rewrite backend: `facts` are `{certified, uncertain}` (uncertain: SymbolicLM does not handle the unit alone). */
export function shouldRewrite(gate, {certified, uncertain = false}) {
  if (!REWRITE_GATES.includes(gate)) throw Error(`unknown rewrite gate ${gate}`);
  if (gate === 'always') return true;
  if (gate === 'trees') return !certified;
  if (gate === 'trees_or_uncertain') return !certified || uncertain;
  return uncertain;
}

const NEG = /\b(not|never|no|nobody|nothing|none|neither|nor|without)\b|n['’]t\b/gi;
const QUANT = /\b(all|every|each|some|any|most|many|few|only|at least|at most|more than|less than|fewer than|both|either|none|exactly)\b/gi;
const fold = s => String(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const bag = (re, s) => (fold(s).match(new RegExp(re.source, 'gi')) ?? []).map(x => x.replace(/n['’]t/, 'not')).sort().join('|');
const names = text => new Set((String(text).match(/(?<=[\p{L}\p{N},;:] )\p{Lu}[\p{L}'’-]+/gu) ?? []).map(x => x.toLowerCase()));
const numbers = text => (String(text).match(/\d+(?:[.,]\d+)?/g) ?? []).sort().join('|');

/** Mechanical meaning checks of a rewrite: names (non-initial capitalized words of the input still occur), numbers (same multiset), negation, quantifiers, question mark, non-empty. */
export function mechanicalMeaning(input, output) {
  const low = String(output).toLowerCase();
  const lostNames = [...names(input)].filter(n => !low.includes(n));
  const m = {negation: bag(NEG, input) === bag(NEG, output), quantifiers: bag(QUANT, input) === bag(QUANT, output), question: /\?/.test(input) === /\?/.test(output), nonempty: Boolean(String(output).trim()), names: lostNames.length === 0, numbers: numbers(input) === numbers(output)};
  m.ok = Object.values(m).every(Boolean);
  m.lost_names = lostNames;
  return m;
}

/**
 * Whether the rewrite `output` of the unit `input` replaces it. `outputCertified`: the rewrite's trees are certified;
 * `compareVerdict`: the analysis comparison verdict of the pair (needed by `certified_compare`). Returns {accepted, reasons}.
 */
export function acceptRewrite(input, output, {acceptance = 'certified', outputCertified, compareVerdict = null}) {
  if (!REWRITE_ACCEPTANCE.includes(acceptance)) throw Error(`unknown rewrite acceptance ${acceptance}`);
  const same = s => String(s).replace(/\s+/g, ' ').trim();
  if (same(input) === same(output)) return {accepted: true, reasons: []};
  if (acceptance === 'off') return {accepted: Boolean(same(output)), reasons: same(output) ? [] : ['empty']};
  const reasons = [];
  if (!outputCertified) reasons.push('not_certified');
  const m = mechanicalMeaning(input, output);
  for (const key of ['nonempty', 'names', 'numbers', 'negation', 'quantifiers', 'question']) if (!m[key]) reasons.push(`meaning_${key}`);
  if (acceptance === 'certified_compare' && compareVerdict === 'different') reasons.push('analysis_different');
  return {accepted: reasons.length === 0, reasons};
}

/**
 * The rewrite pipeline over a text: the host splitter cuts it into sentence units, `inspect(unitText)` returns the local facts of a unit
 * `{certified, uncertain, compact}` (`compact`: its compact analysis, used by the comparison), the gate picks the units that go to
 * `rewrite(unitText)` and the acceptance check decides, per unit, whether the rewrite replaces the original. Returns
 * `{text, units: [{text, start, end, sent, accepted, reasons, output}], applied}`; `text` equals the input when nothing was accepted.
 * `inspect` is called for the unit and, when it was rewritten and the acceptance needs it, for the rewrite.
 */
export async function runRewritePipeline(text, {split, inspect, rewrite, gate = 'trees', acceptance = 'certified', compare = null}) {
  const units = [];
  for (const u of split(text)) {
    const facts = await inspect(u.text);
    const unit = {text: u.text, start: u.start, end: u.end, sent: false, accepted: false, reasons: [], output: null, certified: facts.certified, uncertain: Boolean(facts.uncertain)};
    if (shouldRewrite(gate, facts)) {
      unit.sent = true;
      unit.output = String(await rewrite(u.text) ?? '').trim();
      const needs = acceptance !== 'off' && unit.output && unit.output.replace(/\s+/g, ' ') !== u.text.replace(/\s+/g, ' ').trim();
      const after = needs ? await inspect(unit.output) : null;
      const compareVerdict = needs && acceptance === 'certified_compare' && compare ? compare(facts.compact, after.compact, u.text, unit.output) : null;
      const verdict = acceptRewrite(u.text, unit.output, {acceptance, outputCertified: Boolean(after?.certified), compareVerdict});
      unit.accepted = verdict.accepted && unit.output.replace(/\s+/g, ' ') !== u.text.replace(/\s+/g, ' ').trim();
      unit.reasons = verdict.reasons;
    }
    units.push(unit);
  }
  let out = text;
  for (const u of [...units].reverse()) if (u.accepted) out = out.slice(0, u.start) + u.output + out.slice(u.end);
  return {text: out, units, applied: units.some(u => u.accepted)};
}
