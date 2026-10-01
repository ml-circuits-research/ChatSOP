/** Clean-English targets written by DeepSeek flash (omp task folder datasets_sources/bad_english_targets/) for bad_english
 * rows that had no target. Merged here, through the dataset builder (assemble.mjs calls `applyLlmTargets`), so that a rebuild
 * keeps them; `tools/datasets/merge-llm-targets.mjs` (train, dev) and `tools/eval/three-datasets-suites.mjs merge-llm-targets`
 * (sealed test) apply them to the written files without a full re-analysis.
 *
 * A row that has a target already keeps it. Every merged target is `target_source: "llm:deepseek-flash"` with review status
 * `pending` (the targets are validated mechanically by tools/eval/bad-english-targets.mjs, never by a human). A `mixed` row
 * that DeepSeek marked unfixable only because it is already clean English (or differs from clean English only by casing) gets
 * the message itself as its target (owner direction 2026-09-30). Any other unfixable row stays without a target and is
 * flagged `llm_unfixable` with the reason. A target must pass the clean-English gate (README of bad_english, verify-three-datasets):
 * one that does not (most often a Romanian proper name kept in the text, which the language test cannot tell from Romanian
 * words) is held in `unverified_references` like the unverified references of the new cases, the row stays without a target
 * and is flagged `llm_target_failed_clean_gate`. The merge is idempotent: a row whose target came from this source is reset first.
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../../../lib/dataset-paths.mjs';
import {classifyMessage} from './sources.mjs';

export const LLM_TARGET_SOURCE = 'llm:deepseek-flash';
export const LLM_TARGETS_DIR = path.join(ROOT, 'datasets_sources/bad_english_targets');
const ALREADY_CLEAN = /already clean|differs from clean English only by casing/i;

/** Map(id -> {kind, message, target?, unfixable?, reason?}) of the folder's output; an empty map when the folder is absent. */
export function loadLlmTargets(dir = LLM_TARGETS_DIR) {
  const map = new Map();
  if (!fs.existsSync(path.join(dir, 'output'))) return map;
  const kinds = new Map();
  for (const name of fs.readdirSync(path.join(dir, 'input')).filter(n => /^part-\d+\.jsonl$/.test(n)).sort())
    for (const line of fs.readFileSync(path.join(dir, 'input', name), 'utf8').split('\n')) if (line) { const r = JSON.parse(line); kinds.set(r.id, r); }
  for (const name of fs.readdirSync(path.join(dir, 'output')).filter(n => /^part-\d+\.jsonl$/.test(n)).sort())
    for (const line of fs.readFileSync(path.join(dir, 'output', name), 'utf8').split('\n')) {
      if (!line) continue;
      let r; try { r = JSON.parse(line); } catch { continue; }
      const input = kinds.get(r.id);
      if (input) map.set(r.id, {kind: input.kind, message: input.message, target: r.target ?? null, unfixable: Boolean(r.unfixable), reason: r.reason ?? null});
    }
  return map;
}

/** Puts a row that an earlier merge touched back into its no-target state (idempotent merges). */
export function resetLlm(row) {
  const touched = row.target_source === LLM_TARGET_SOURCE || row.flags?.some(f => f.startsWith('llm_')) || row.llm_unfixable_reason || row.unverified_references?.some(t => t.source === LLM_TARGET_SOURCE);
  if (!touched) return;
  if (row.target_source === LLM_TARGET_SOURCE) { row.target = null; row.target_source = null; row.targets = []; row.review_status = 'not_reviewed'; }
  row.flags = (row.flags ?? []).filter(f => !f.startsWith('llm_'));
  if (!row.target && !row.flags.includes('no_target')) row.flags.push('no_target');
  if (!row.flags.length) delete row.flags;
  delete row.llm_unfixable_reason;
  if (row.unverified_references) { row.unverified_references = row.unverified_references.filter(t => t.source !== LLM_TARGET_SOURCE); if (!row.unverified_references.length) delete row.unverified_references; }
}

/** The target record a merged row gets, or null; `{reference}` when the text is not clean English (held back). `row` is a bad_english row. */
export function llmTargetOf(row, llm) {
  const out = llm.get(row.id);
  if (!out || out.message !== row.message) return null; // the message changed since the export: never guess
  const base = {validator: 'tools/eval/bad-english-targets.mjs validate', review: 'pending', llm_kind: out.kind};
  if (!out.unfixable && out.target) {
    const gate = classifyMessage(out.target);
    const t = {text: out.target, source: LLM_TARGET_SOURCE, check: {...base, clean_english_gate: gate.partition === 'clean_en'}};
    return gate.partition === 'clean_en' ? t : {reference: {...t, check: {...t.check, gate_partition: gate.partition, gate_reasons: gate.reasons}}};
  }
  if (out.unfixable && row.language_kind === 'mixed' && ALREADY_CLEAN.test(out.reason ?? '')) return {text: row.message, source: LLM_TARGET_SOURCE, check: {...base, message_is_target: true, llm_reason: out.reason}};
  return null;
}

/** Applies the targets to `rows` in place (rows without a target only). Returns counts. */
export function applyLlmTargets(rows, llm) {
  const counts = {rows: 0, merged: 0, message_is_target: 0, unfixable: 0, failed_clean_gate: 0, had_target: 0, not_in_output: 0};
  for (const row of rows) {
    resetLlm(row);
    counts.rows++;
    if (row.target) { counts.had_target++; continue; }
    const out = llm.get(row.id);
    if (!out) { counts.not_in_output++; continue; }
    const t = llmTargetOf(row, llm);
    if (t?.reference) {
      row.unverified_references = [...(row.unverified_references ?? []), t.reference];
      row.flags = [...new Set([...(row.flags ?? []), 'llm_target_failed_clean_gate'])];
      counts.failed_clean_gate++;
    } else if (t) {
      row.target = t.text; row.target_source = t.source; row.targets = [t]; row.review_status = 'pending';
      row.flags = (row.flags ?? []).filter(f => f !== 'no_target'); if (!row.flags.length) delete row.flags;
      counts.merged++; if (t.check.message_is_target) counts.message_is_target++;
    } else if (out.unfixable) {
      row.flags = [...new Set([...(row.flags ?? []), 'llm_unfixable'])]; row.llm_unfixable_reason = out.reason;
      counts.unfixable++;
    }
  }
  return counts;
}
