/** SymbolicProofingLLM pairs from the verified candidates: selection, identity pairs, audit records.
 *
 * A repair pair is {message -> best verified candidate}; an identity pair is {message -> itself} for a symbolic_english
 * row ("do not touch"). The flat file format is the one of the `proofreader` role (training/python/common.py chat_ids():
 * user turn = prompt, assistant turn = target); the audit side-file carries everything else.
 */
import crypto from 'node:crypto';
import {mainForm} from '../three-datasets/forms.mjs';
import {classifyRow} from '../three-datasets/decomposition.mjs';
import {normalText} from '../three-datasets/inputs.mjs';
import {hasGoldMatch} from '../three-datasets/rows.mjs';

const LEVEL_RANK = {VERIFIED_GOLD: 0, VERIFIED_GOLD_NORMALIZED: 0.5, VERIFIED_FORM: 1, VERIFIED_FORM_UNTRUSTED: 1.5};
const sha = text => crypto.createHash('sha1').update(text).digest('hex');

/**
 * The best verified candidate of every row: gold first, then fewest sentences, then shortest text, then candidate order.
 * `allowExtra` names optional tiers (VERIFIED_FORM_UNTRUSTED) that are not part of the owner's levels;
 * a candidate of an allowed tier is treated as that level.
 */
export function selectBest(verdicts, textOf, {allowExtra = new Set(), skipRow = () => false} = {}) {
  const best = new Map();
  for (const w of verdicts) {
    const tier = w.level in LEVEL_RANK ? w.level : allowExtra.has(w.extra) ? w.extra : null;
    if (!tier || (tier !== w.level && skipRow(w))) continue;
    const v = {...w, level: tier};
    const text = textOf.get(v.cid), key = [LEVEL_RANK[v.level], v.sentences, text.length, String(v.n)];
    const cur = best.get(v.id);
    if (!cur || compare(key, cur.key) < 0) best.set(v.id, {v, text, key});
  }
  return best;
}
function compare(a, b) { for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return 0; }

/** Identity rows, stratified by form: round-robin over forms (rarest first, so every form is covered), hash-ranked inside a form. */
export function stratifiedIdentity(rows, quota, exclude = new Set(), seed = 'neuro-proofing-identity-v1') {
  const byForm = new Map();
  for (const r of rows) {
    if (exclude.has(normalText(r.message))) continue;
    const form = mainForm(r.analysis) ?? 'no analysis';
    (byForm.get(form) ?? byForm.set(form, []).get(form)).push(r);
  }
  const forms = [...byForm.entries()].sort((a, b) => a[1].length - b[1].length || a[0].localeCompare(b[0]));
  for (const [, list] of forms) list.sort((a, b) => sha(`${seed}|${a.id}`).localeCompare(sha(`${seed}|${b.id}`)));
  const out = [];
  for (let round = 0; out.length < quota; round++) {
    let any = false;
    for (const [, list] of forms) { if (round < list.length && out.length < quota) { out.push(list[round]); any = true; } }
    if (!any) break;
  }
  return out;
}

/** Flat training row of a pair. */
export const flat = (id, prompt, target, kind, targetSource) => ({id, prompt, target, kind, language: 'en', source_language: 'en', pipeline: 'direct', target_source: targetSource});

/** Audit record of a repair pair: verification level, form, decomposition type, sentence counts, failure kind of the row. */
export function repairAudit(row, best, split) {
  const {v, text} = best;
  const shape = classifyRow({message: row.message, analysis: row.analysis, target: text});
  return {
    id: row.id, pair_split: split, kind: 'repair', source: v.src === 'deepseek' ? 'deepseek-flash' : v.src, candidate_id: v.cid, verification: v.level, meaning_judge: v.meaning ?? null,
    has_gold: v.has_gold, failure_kind: row.failure_kind ?? null, form: mainForm(row.analysis), corpus: row.source?.corpus ?? null,
    message_sentences: shape.message_sentences, target_sentences: shape.target_sentences, decomposition: shape.decomposition, decomposition_type: shape.type, candidate_shape: shape.candidate,
  };
}

export function identityAudit(row, split) {
  return {id: row.id, pair_split: split, kind: 'identity', source: 'symbolic_english', verification: row.analysis_verified ?? 'symbolic_english', has_gold: hasGoldMatch(row), failure_kind: null, form: mainForm(row.analysis), corpus: row.source?.corpus ?? null,
    message_sentences: row.analysis?.sentences?.length ?? null, target_sentences: row.analysis?.sentences?.length ?? null, decomposition: false, decomposition_type: null};
}
