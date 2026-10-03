/**
 * Checks of train-data-d1 (pure, synchronous; LLMJobs plugin). A teacher's reply passes when it is the JSON of prompt.md and our
 * deterministic converters accept it: every span verbatim with a known label, relations between span texts, every formula parsed
 * (lib/formalize/fol/parse.mjs) and converted to SOP-IR (lib/formalize/fol/to-ir.mjs) with no rejection, at least one query, and every
 * query compiled to a circuit (lib/formalize/fol/to-sop.mjs). The problems named in a repair are format problems only: the gold answer
 * is never read here (execution against the book answer and the two-teacher perturbation check run afterwards in
 * tools/eval/structure-formalizer/d1.mjs).
 */
import {parseFol} from '../../lib/formalize/fol/parse.mjs';
import {folToIr} from '../../lib/formalize/fol/to-ir.mjs';
import {compileIr, slug} from '../../lib/formalize/fol/to-sop.mjs';
import {sentencesOf} from '../../lib/formalize/fol/input.mjs';
import {registryOf} from '../../lib/formalize/expression-program.mjs';
import {loadSchema} from '../../lib/formalize/structure/schema.mjs';

const SCHEMA = loadSchema();
const LABELS = new Set(Object.keys(SCHEMA.entities));
const RELATIONS = new Set(Object.keys(SCHEMA.relations));

export function parse(text) {
  const s = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return {json: null, parseError: 'no JSON object in the reply'};
  try { return {json: JSON.parse(s.slice(a, b + 1))}; } catch (error) { return {json: null, parseError: `the JSON does not parse (${error.message.slice(0, 80)})`}; }
}

/** The formulas of a reply as converter units: [{ast, question, source, s}] plus the problems found. */
export function unitsOf(fol, nSentences) {
  const units = [], problems = [];
  for (const e of Array.isArray(fol) ? fol : []) {
    if (!Number.isInteger(e?.s) || e.s < 1 || e.s > nSentences) { problems.push(`a "fol" entry has no valid sentence number "s" (1..${nSentences})`); continue; }
    for (const f of Array.isArray(e.fol) ? e.fol : []) {
      const question = /^\s*\?/.test(String(f));
      const text = String(f).replace(/^\s*\?\s*/, '');
      const p = parseFol(text);
      if (!p.ok) { problems.push(`s${e.s}: "${text.slice(0, 80)}" does not parse: ${p.why}`); continue; }
      const one = folToIr([{ast: p.ast, question, source: text}]);
      if (one.rejected.length) { problems.push(`s${e.s}: "${text.slice(0, 80)}" cannot be used: ${one.rejected[0].why}`); continue; }
      units.push({ast: p.ast, question, source: text, s: e.s});
    }
  }
  return {units, problems};
}

/** Spans located in the problem: [{label, text, start, end}] (the first unused occurrence per label). */
export function locateSpans(spans, question) {
  const used = new Set(), out = [];
  for (const sp of spans) {
    let at = question.indexOf(sp.text);
    while (at >= 0 && used.has(`${sp.label}@${at}`)) at = question.indexOf(sp.text, at + 1);
    if (at < 0) at = question.indexOf(sp.text);
    used.add(`${sp.label}@${at}`);
    out.push({label: sp.label, text: sp.text, start: at, end: at + sp.text.length});
  }
  return out;
}

export function check(item, output) {
  if (!output.json) return {ok: false, problems: [output.parseError ?? 'no JSON'], hint: 'Reply with one JSON object: {"psm": {"spans": [...], "relations": [...]}, "fol": [...]}.'};
  const {psm, fol} = output.json, problems = [];
  const question = String(item.question), n = sentencesOf(question).length;
  const spans = Array.isArray(psm?.spans) ? psm.spans : null;
  if (!spans) problems.push('"psm.spans" is missing');
  for (const sp of spans ?? []) {
    if (!LABELS.has(sp?.label)) problems.push(`span label "${sp?.label}" is not one of ${[...LABELS].join(', ')}`);
    else if (typeof sp.text !== 'string' || !sp.text.trim() || !question.includes(sp.text)) problems.push(`span "${String(sp?.text).slice(0, 60)}" is not copied exactly from the problem`);
  }
  const texts = new Set((spans ?? []).map(sp => sp?.text));
  for (const r of Array.isArray(psm?.relations) ? psm.relations : []) {
    if (!RELATIONS.has(r?.type)) problems.push(`relation type "${r?.type}" is not one of ${[...RELATIONS].join(', ')}`);
    else if (!texts.has(r.head) || !texts.has(r.tail)) problems.push(`relation ${r.type}: head and tail must be span texts`);
  }
  if (!(spans ?? []).some(sp => sp?.label === 'goal')) problems.push('no goal span');
  const {units, problems: fp} = unitsOf(fol, n);
  problems.push(...fp);
  const queries = units.filter(u => u.question);
  if (!queries.length) problems.push('no query: write what the question asks as a formula starting with "? "');
  if (!problems.length) {
    const ir = folToIr(units);
    const names = new Map((spans ?? []).filter(sp => sp.label === 'entity').map(sp => [slug(sp.text), sp.text]));
    const {circuits, rejected} = compileIr(ir, {registry: registryOf(question), names});
    for (const r of [...ir.rejected, ...rejected]) problems.push(`"${String(r.source ?? '').slice(0, 60)}": ${r.why}`);
    if (!rejected.length && circuits.length !== queries.length) problems.push(`${queries.length - circuits.length} queries did not compile`);
  }
  if (problems.length) return {ok: false, problems: problems.slice(0, 8), hint: 'Keep the JSON shape; copy spans exactly; use only the syntax and reserved names of the instructions; define every quantity with Value before it is asked.'};
  return {ok: true, value: {psm: {spans: locateSpans(spans, question), relations: psm.relations ?? []}, fol}};
}

export function repairHint(item, output, problems) {
  return problems.some(p => /never given a Value/.test(p)) ? 'Every quantity used in a term or asked by Ask must have its own Value line built from the problem\'s numbers.' : null;
}
