/** Rewrite targets for the two "needs work" datasets, from the sources that already carry a checked rewrite.
 *
 *   noise-inverse        the clean text reconstructed from the generator's recorded noise operations (bad_english)
 *   clean-sibling        a clean-English row of the same semantic case with the same gold SOP (bad_english)
 *   proofing.repair      datasets_archive/proofing repair pair whose input is the message and whose target passes the
 *                        strict oracle of ud-rules-v1.4 (neuro_english, bad_english)
 *   proofing.translate   the SymbolicLM English translation (identity or repaired) of a Romanian/mixed message of the
 *                        same semantic case, oracle-checked (bad_english)
 *   regularization       an attempt of the symbolic-layers study that preserved the meaning and parsed correctly
 *   new_cases.clean      the LLM-written clean reference of a new case (pending human review)
 * Every target keeps its source and what was checked; none is human-reviewed.
 */
import {undoNoise} from './noise.mjs';
import {classifyMessage} from './sources.mjs';

const same = (a, b) => String(a).trim() === String(b).trim();

/** Index proofing rows by the id of the formalizer row (or semantic case for the translate arm) they come from. */
export function proofingIndex(rows) {
  const direct = new Map(), translate = new Map(), hard = new Map();
  const add = (map, row) => { if (!map.has(row.source_id)) map.set(row.source_id, []); map.get(row.source_id).push(row); };
  for (const row of rows) {
    if (row.kind === 'hard' && row.pipeline !== 'translate') add(hard, row);
    else if (row.target !== null && row.target !== undefined && ['repair', 'identity'].includes(row.kind)) add(row.pipeline === 'translate' ? translate : direct, row);
  }
  return {direct, translate, hard};
}

/** Verified rewrites of a clean-English message (neuro_english): proofing repairs whose input is exactly the message. */
export function repairTargets(index, record) {
  const out = [];
  for (const row of index.direct.get(record.sourceId) ?? []) {
    if (row.kind !== 'repair' || !same(row.input, record.message) || same(row.target, record.message)) continue;
    if (row.target_oracle?.strict !== true || row.meaning_checks?.ok === false) continue;
    out.push({text: row.target, source: 'proofing.repair', check: {oracle: 'ud-rules-v1.4 strict gold match', strict: true, meaning_checks: row.meaning_checks?.ok ?? null, teacher: row.target_source ?? null}, layer: row.layer ?? null});
  }
  return out;
}

/** Targets of a noisy English message (bad_english). */
export function noisyEnglishTargets(index, record, siblings) {
  const out = [];
  for (const row of index.direct.get(record.sourceId) ?? []) {
    if (row.kind !== 'repair' || !same(row.input, record.message) || row.target_oracle?.strict !== true) continue;
    const gate = classifyMessage(row.target).partition === 'clean_en';
    if (gate) out.push({text: row.target, source: 'proofing.repair', check: {clean_english_gate: true, oracle: 'ud-rules-v1.4 strict gold match', teacher: row.target_source ?? null}});
  }
  const undone = undoNoise(record.message, record.noise);
  if (undone && classifyMessage(undone).partition === 'clean_en') out.push({text: undone, source: 'noise-inverse', check: {clean_english_gate: true, method: 'recorded noise operations undone'}});
  if (!out.length) {
    for (const sibling of siblings ?? []) out.push({text: sibling.message, source: 'clean-sibling', check: {clean_english_gate: true, same_gold_sop: true, note: 'different wording of the same semantic case'}});
  }
  return dedupe(out);
}

/** Targets of a Romanian or mixed message (bad_english): the oracle-checked English translation of its semantic case. */
export function translatedTargets(index, record) {
  const out = [];
  // Rows of the translate arm are keyed by the surface row (an exact translation of this message) or by the semantic case.
  const exact = index.translate.get(record.sourceId);
  for (const row of exact ?? index.translate.get(record.semanticCaseId) ?? []) {
    if (row.target_oracle?.strict !== true || row.meaning_checks?.ok === false) continue;
    if (classifyMessage(row.target).partition !== 'clean_en') continue;
    out.push({text: row.target, source: 'proofing.translate', check: {clean_english_gate: true, oracle: 'ud-rules-v1.4 strict gold match', teacher: row.target_source ?? null, note: exact ? 'SymbolicLM English translation of this message (repaired when needed)' : 'English rendering of the same semantic case (SymbolicLM translation, repaired when needed)'}});
  }
  return dedupe(out);
}

function dedupe(targets) {
  const seen = new Set();
  return targets.filter(t => { if (seen.has(t.text)) return false; seen.add(t.text); return true; });
}

/** Regularization attempts (symbolic-layers study) that kept the meaning and parse correctly, by original text. */
export function regularizationIndex(candidates) {
  const map = new Map();
  for (const c of candidates) {
    const good = (c.attempts ?? []).filter(a => a.preserved && a.parse_ok && a.text && !same(a.text, c.original));
    if (good.length) map.set(c.original, {verdict: c.verdict, error_type: c.error_type, targets: good.map(a => a.text)});
  }
  return map;
}
