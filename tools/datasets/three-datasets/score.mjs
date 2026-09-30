/** Gold-SOP scoring of SymbolicLM output for formalizer-family records, and the failure blame of a miss.
 *
 * "Strict" is the measure of eval-clean-english-v1: rows with a verification world are scored by `eval/run.mjs`
 * `evaluate()` (strict execution equivalence with the gold SOP), rows without a world by the `wildScore` function the
 * caller supplies (`scoreAgainstAccepted` against every accepted gold). Rules version: ud-rules-v2.5 (Stanza accurate package).
 */
import {evaluate} from '../../../eval/run.mjs';
import {loadFrames, normalizeProgram} from '../../../sop/frames.mjs';
import {diffCategories, classesOf} from '../../research/symbolic-layers-diff.mjs';

export const RULES_VERSION = 'ud-rules-v2.5';
const keyOf = r => `${r.corpus}::${r.sourceId}`;
const rowOf = r => ({...r.row, id: keyOf(r)});

/** Strict verdict per record key: Map(key -> {ok, syntax, prediction, frame_ok}). `predictionOf(record)` gives the SOP text. */
export async function strictScores(records, predictionOf, {wildScore = null} = {}) {
  const frames = loadFrames();
  const out = new Map();
  const normalized = sop => { try { return normalizeProgram(sop, frames).sop; } catch { return sop; } };
  const executed = records.filter(r => !r.wild);
  if (executed.length) {
    const rows = executed.map(rowOf);
    const predictions = new Map(executed.map(r => [keyOf(r), predictionOf(r)]));
    const strict = await evaluate(rows, {predictor: ({id}) => predictions.get(id), config: {}, source: 'predictions'});
    for (const rec of strict.records) out.set(rec.id, {ok: Boolean(rec.execution_equivalent), syntax: Boolean(rec.syntax_valid), prediction: rec.prediction, frame_ok: false});
    const misses = rows.filter(row => !out.get(row.id).ok);
    if (misses.length) {
      const framed = await evaluate(misses, {predictor: ({id}) => normalized(predictions.get(id)), config: {}, source: 'predictions'});
      for (const rec of framed.records) out.get(rec.id).frame_ok = Boolean(rec.execution_equivalent);
    }
  }
  for (const r of records.filter(x => x.wild)) {
    if (!wildScore) throw Error('rows without a verification world need a wildScore function');
    const scoreAgainstAccepted = wildScore;
    const sop = predictionOf(r), accepted = r.row.sop_targets_accepted ?? [r.row.sop_target];
    const s = scoreAgainstAccepted(sop, accepted);
    out.set(keyOf(r), {ok: Boolean(s.accepted_match), syntax: Boolean(s.parsed), prediction: sop, frame_ok: !s.accepted_match && Boolean(scoreAgainstAccepted(normalized(sop), accepted).accepted_match)});
  }
  return out;
}

/** proofing-corpus layer -> failure kind (DS008 "Three datasets"). */
const LAYER_KIND = {parser: 'parser', rules: 'rules', 'rules+convention': 'rules', convention: 'gold_convention', wording: 'gold_convention'};

/**
 * failure_kind of a strict miss: parser | rules | gold_convention | unknown. A recorded proofing layer decides when
 * there is one; otherwise the structural diff classes do (P parser/lemma, R rules, C gold convention), and a miss
 * that host frame normalization repairs is a gold convention (relation wording or role name).
 */
export function failureOf(record, score, proofingLayer = null) {
  const message = record.message;
  const unparsed = [];
  let categories = [], classes = [];
  if (!score.syntax) { categories = [{cat: 'invalid_syntax'}]; }
  else { categories = diffCategories(score.prediction, record.row.sop_target, {executed: !record.wild, message}); classes = classesOf(categories); }
  let kind = 'unknown';
  if (proofingLayer && LAYER_KIND[proofingLayer]) kind = LAYER_KIND[proofingLayer];
  else if (score.frame_ok) kind = 'gold_convention';
  else if (classes.includes('R')) kind = 'rules';
  else if (classes.includes('P')) kind = 'parser';
  else if (classes.includes('C')) kind = 'gold_convention';
  return {
    failure_kind: kind,
    failure: {classes, categories: [...new Set(categories.map(c => c.cat))], frame_recoverable: Boolean(score.frame_ok), proofing_layer: proofingLayer, also_gold_convention: kind === 'rules' && classes.includes('C'), unparsed},
  };
}
