/** Final verdict of each candidate on the ANALYSIS layer (owner direction 2026-09-30 night): stage A (trees of the two packages, the gold comparison as a
 * meaning signal) + the DeepSeek parse gate on every sentence of the candidate + the meaning.
 *
 *   VERIFIED_GOLD  the candidate passes the analysis gate and, for a row with a gold SOP, its SOP matches the gold strictly (the meaning signal)
 *   VERIFIED_GOLD_NORMALIZED  the gate passes and the SOP matches the gold only under the host's frame and synonym normalization (sop/frames.mjs: relation
 *                  and object boundary, role names), and the DeepSeek meaning check says yes when that check is trusted (it is applied
 *                  only at its preregistered precision; otherwise the normalized gold match alone decides and the judge's answer is reported)
 *   VERIFIED_FORM  the gate passes (default and accurate trees identical, DeepSeek conditions a and c good on every sentence) and the DeepSeek meaning
 *                  check says yes; only when that judge is trusted (recalibration at 97% or more)
 *   REJECTED       anything else, with `reason`; `extra: VERIFIED_FORM_UNTRUSTED` marks a gate pass whose meaning is not verified by a trusted signal
 *   PENDING        a judge verdict is still missing
 * The SOP built from a candidate is not a condition (it is the later layer); `sop_stage` of the stage record keeps it.
 */
import fs from 'node:fs';
import path from 'node:path';
import {gateOf, parseVerdicts, meaningVotes} from './judge.mjs';
import {ROOT} from './common.mjs';

/**
 * The meaning rule in force, from the experiment record: the DeepSeek meaning judge is used (two votes, m1 AND m2) only when `eval-meaning-judge-calibration-v1` is done and the raw
 * precision of the two-vote "yes" on the confirmatory set reaches the threshold (97%, owner brief 2026-09-30 night). Otherwise no meaning judge is trusted and the pairs are
 * marked by level (VERIFIED_FORM_UNTRUSTED stays in `extra`).
 */
export function meaningRule(file = path.join(ROOT, 'status/experiments.json'), threshold = 0.97) {
  try {
    const all = JSON.parse(fs.readFileSync(file, 'utf8'));
    const e = (Array.isArray(all) ? all : all.experiments ?? []).find(x => x.id === 'eval-meaning-judge-calibration-v1');
    const raw = e?.results?.v2_confirmatory?.two_vote?.raw;
    const adjudicated = e?.results?.v2_confirmatory?.two_vote?.adjudicated;
    return {trusted: Boolean(e?.status === 'done' && raw && raw.rate >= threshold), rule: 'two_vote_m1_and_m2', experiment: 'eval-meaning-judge-calibration-v1', status: e?.status ?? null, threshold, precision_raw: raw?.rate ?? null, precision_raw_wilson: raw?.wilson ?? null, precision_adjudicated: adjudicated?.rate ?? null, recall: e?.results?.v2_confirmatory?.two_vote?.recall?.rate ?? null};
  } catch { return {trusted: false, rule: 'two_vote_m1_and_m2', experiment: 'eval-meaning-judge-calibration-v1', status: null, threshold}; }
}

export function finalVerdicts(stageRows, {index, meaningTrusted, parse = parseVerdicts(), votes = meaningVotes(), meaningId = r => r.cid}) {
  return stageRows.map(r => {
    const out = {...r, level: 'REJECTED', reason: r.stage, gate: null, meaning: null, extra: null};
    if (!['gold_match', 'gold_mismatch', 'to_judge'].includes(r.stage) || (r.stage === 'gold_mismatch' && !r.frame_ok)) return out;
    // A candidate without sentence keys was never prepared for the judge (`judge-prepare`): pending, never a vacuous pass.
    if (!index[r.cid]?.length) { out.gate = 'pending'; out.level = 'PENDING'; out.reason = 'gate_not_prepared'; return out; }
    const gate = gateOf(index[r.cid], parse);
    out.gate = gate.state;
    if (gate.state === 'fail') { out.reason = 'gate_failed'; out.gate_failed = gate.failed; return out; }
    if (gate.state === 'pending') { out.level = 'PENDING'; out.reason = 'gate_pending'; return out; }
    if (r.stage === 'gold_match') { out.level = 'VERIFIED_GOLD'; out.reason = null; return out; }
    if (r.stage === 'gold_mismatch') {
      const m = votes.get(meaningId(r)) ?? null;
      out.meaning = m;
      if (!meaningTrusted || m === 'yes') { out.level = 'VERIFIED_GOLD_NORMALIZED'; out.reason = null; }
      else if (m === 'no') out.reason = 'normalized_meaning_changed';
      else { out.level = 'PENDING'; out.reason = 'meaning_pending'; }
      return out;
    }
    const m = votes.get(meaningId(r)) ?? null;
    out.meaning = m;
    if (!meaningTrusted) { out.reason = 'form_gate_passed_meaning_not_trusted'; if (m === 'yes') out.extra = 'VERIFIED_FORM_UNTRUSTED'; return out; }
    if (m === 'yes') { out.level = 'VERIFIED_FORM'; out.reason = null; } else if (m === 'no') out.reason = 'meaning_changed'; else { out.level = 'PENDING'; out.reason = 'meaning_pending'; }
    return out;
  });
}

/** Stage rows whose candidates need a meaning answer: the ones that passed the parse gate and the normalized gold matches. */
export function needsMeaning(stageRows, index, parse = parseVerdicts()) {
  return stageRows.filter(r => (r.stage === 'gold_mismatch' && r.frame_ok || r.stage === 'to_judge') && index[r.cid]?.length && gateOf(index[r.cid], parse).state === 'pass');
}

/** Counts by level and reason, and a tally helper. */
export function tally(rows, keyOf) { const out = {}; for (const r of rows) { const k = keyOf(r); out[k] = (out[k] ?? 0) + 1; } return out; }
