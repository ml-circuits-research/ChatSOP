/** Calibration of the DeepSeek meaning check (experiment eval-neuro-meaning-judge-v1, status/preregistrations/).
 *
 * Positives: candidates that are VERIFIED_GOLD (their SOP matches the gold SOP strictly, so their meaning equals the
 * original's as far as the gold is concerned). Negatives: candidates of gold rows whose SOP does not match the gold
 * (the preregistered definition; some of them preserve the meaning and differ only by a gold convention, so the measured
 * precision is a lower bound), plus a floor check of candidates paired with the message of another row (meaning certainly
 * different). Samples are seeded by sha1 ranking, stable across runs.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import {writeJsonl, writeJson, readJson, WORK} from './common.mjs';
import {MEANING_DIR, meaningUser, meaningOf, readVerdicts} from './judge.mjs';

const SEED = 'neuro-meaning-calibration-v1';
const rank = key => crypto.createHash('sha1').update(`${SEED}|${key}`).digest('hex');
const pick = (list, n, key) => list.slice().sort((a, b) => rank(key(a)).localeCompare(rank(key(b)))).slice(0, n);

/** Writes the calibration items (input of the meaning-judge folder) and the frozen sample file. */
export function writeCalibration(stageRows, candidates, messages, {positives = 100, negatives = 100, shuffled = 50} = {}) {
  const textOf = new Map(candidates.map(c => [c.cid, c.text]));
  const base = stageRows.filter(r => r.has_gold && r.src === 'deepseek');
  const pos = pick(base.filter(r => r.stage === 'gold_match'), positives, r => r.cid);
  const neg = pick(base.filter(r => r.stage === 'gold_mismatch'), negatives, r => r.cid);
  const posIds = new Set(pos.map(r => r.cid));
  const shufflePool = pick(base.filter(r => r.stage === 'gold_match' && !posIds.has(r.cid)), shuffled, r => 'shuffle|' + r.cid);
  // each shuffled candidate is paired with the message of another sampled row (the next one in the ranking)
  const swap = shufflePool.map((r, i) => ({r, other: shufflePool[(i + 1) % shufflePool.length]}));
  const sample = [
    ...pos.map(r => ({id: `cal-pos-${r.cid}`, label: 'positive', cid: r.cid, message_of: r.id})),
    ...neg.map(r => ({id: `cal-neg-${r.cid}`, label: 'negative_gold_mismatch', cid: r.cid, message_of: r.id, frame_only: Boolean(r.frame_ok)})),
    ...swap.map(({r, other}) => ({id: `cal-swap-${r.cid}`, label: 'negative_other_row', cid: r.cid, message_of: other.id})),
  ];
  writeJsonl(path.join(MEANING_DIR, 'input/items.jsonl'), sample.map(s => ({id: s.id, condition: 'm', user: meaningUser(messages.get(s.message_of), textOf.get(s.cid))})));
  writeJson(path.join(WORK, 'meaning-calibration-sample.json'), {seed: SEED, generated_at: new Date().toISOString(), sample});
  return {positives: pos.length, negatives: neg.length, shuffled: swap.length};
}

const wilsonLow = (k, n, z = 1.96) => { if (!n) return null; const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return (c - m) / d; };

/** Precision of "preserves: yes" from the calibration verdicts: {main: vs gold-mismatch negatives, floor: vs swapped negatives}. */
export function scoreCalibration() {
  const {sample} = readJson(path.join(WORK, 'meaning-calibration-sample.json'));
  const verdicts = readVerdicts(MEANING_DIR);
  const tally = {};
  for (const s of sample) {
    const v = meaningOf(verdicts.get(`${s.id}|m`));
    const t = (tally[s.label] ??= {n: 0, yes: 0, no: 0, unusable: 0});
    t.n++; if (v === 'yes') t.yes++; else if (v === 'no') t.no++; else t.unusable++;
    if (s.label === 'negative_gold_mismatch' && s.frame_only) { const f = (tally.negative_gold_mismatch_frame_only ??= {n: 0, yes: 0, no: 0, unusable: 0}); f.n++; if (v === 'yes') f.yes++; else if (v === 'no') f.no++; else f.unusable++; }
  }
  const t = tally, tp = t.positive?.yes ?? 0;
  const precision = fp => (tp + fp ? tp / (tp + fp) : null);
  const fpMain = t.negative_gold_mismatch?.yes ?? 0, fpSwap = t.negative_other_row?.yes ?? 0;
  return {
    tally,
    recall_yes_on_positives: t.positive?.n ? tp / t.positive.n : null,
    precision_main: precision(fpMain), precision_main_wilson_low: wilsonLow(tp, tp + fpMain),
    precision_floor_swapped: precision(fpSwap),
    precision_both: precision(fpMain + fpSwap),
    threshold: 0.95, trusted: precision(fpMain) !== null && precision(fpMain) >= 0.95,
  };
}
