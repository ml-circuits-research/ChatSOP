/** Assembly of the three datasets from classified records, the analysis cache and the target sources.
 * See docs/specs/DS008-data-evaluation.md "Three datasets" for the classification rules. */
import {textKey} from './analysis.mjs';
import {strictScores, failureOf, RULES_VERSION} from './score.mjs';
import {repairTargets, noisyEnglishTargets, translatedTargets} from './targets.mjs';
import {loadLlmTargets, applyLlmTargets} from './llm-targets.mjs';
import {noiseCategories} from './noise.mjs';
import {classifyMessage} from './sources.mjs';
import {normalText} from './inputs.mjs';
import {rowRights, AUTHORED_LICENCE, SOURCES} from '../rights.mjs';
import {GATE_NAME, verdictRecord, judgeSummary} from './analysis-gate.mjs';

export {RULES_VERSION};

/** Outcomes that mean SymbolicLM did not formalize the message even though the SOP text is valid. */
const NOT_HANDLED = new Set(['crash', 'nothing_formalized', 'fallback', 'gibberish']);
/** SymbolicLM handled a message without failing: a valid SOP, a real outcome and no unparsed span. */
export const passes = record => Boolean(record) && record.valid && !NOT_HANDLED.has(record.outcome) && !record.unparsed.length;

/** Rewrite targets of the new cases whose message fails: their first clean reference (phase 2 of the analysis). */
export function targetTexts(records, cache) {
  const out = [];
  for (const r of records) {
    if (r.noisy || r.partition !== 'clean_en') continue;
    const record = cache.get(textKey(r.message));
    if (!record || passes(record)) continue;
    const target = r.row.clean?.[0];
    if (target && target !== r.message) out.push(target);
  }
  return out;
}

const keyOf = r => `${r.corpus}::${r.sourceId}`;

/** Rewrite candidates of a gold-verified miss: the proofing repairs whose input is the message and the regularization attempts. */
export function goldMissCandidates(proofing, regularization, r) {
  const out = [...repairTargets(proofing, r)];
  const reg = regularization.get(r.message) ?? null;
  for (const text of reg?.targets ?? []) if (!out.some(t => t.text === text)) out.push({text, source: 'regularization', check: {parse_ok: true, meaning_preserved: true, judge: 'symbolic-layers stronger judge', note: 'eval-symbolic-layers-en-v1'}});
  return out;
}

/** Texts of the rewrite candidates of the gold-verified clean-English misses (phase 2 of the analysis, with `targetTexts`). */
export async function goldMissTargetTexts(records, cache, {proofing, regularization = new Map(), wildScore = null}) {
  const clean = records.filter(r => r.kind === 'formalizer' && r.partition === 'clean_en' && cache.get(textKey(r.message)));
  const scores = await strictScores(clean, r => cache.get(textKey(r.message)).sop, {wildScore});
  const out = [];
  for (const r of clean) if (!scores.get(keyOf(r)).ok) for (const t of goldMissCandidates(proofing, regularization, r)) out.push(t.text);
  return out;
}

function rightsOf(r) {
  if (r.kind === 'new_case') return {license: AUTHORED_LICENCE, rights_decision: 'owner-authored-llm-drafts', inspired_by: [], text_copied: false, source: r.row.source ?? null, note: 'datasets_sources/new_cases (README.md): original writing by the ChatSOP agents, no copied text; human review pending'};
  const ids = (r.row.rights?.inspired_by ?? []).map(x => (typeof x === 'string' ? x : x?.id)).filter(id => SOURCES[id]);
  return {...rowRights(ids), inherited_from: r.corpus, spec: 'docs/specs/DS014-source-rights.md'};
}

function sourceOf(r) {
  return {corpus: r.corpus, id: r.sourceId, suite: r.suite, split: r.split, ...(r.originSplit ? {origin_split: r.originSplit, sealed_by: 'eval/suites/proofing'} : {}), semantic_case_id: r.semanticCaseId, family: r.family, question_type: r.questionType, ...(r.kind === 'new_case' ? {author: r.row.author, domain: r.row.domain ?? null, categories: r.row.categories, source: r.row.source} : {})};
}

function commonOf(dataset, r) {
  return {
    id: keyOf(r), dataset, split: r.split, split_group_id: r.kind === 'new_case' ? `new_cases:${r.splitGroupId}` : r.splitGroupId, message: r.message, source: sourceOf(r), rights: rightsOf(r),
    quality_flags: {synthetic: true, human_reviewed: false, training_approved: false, llm_authored: r.kind === 'new_case' || r.corpus === 'proofing-diverse-dev'},
    review_status: r.kind === 'new_case' ? 'reviewed-by:pending' : 'not_reviewed',
  };
}

const SYMBOLIC_LM = {version: 'symbolic-lm-v2.0', rules: RULES_VERSION};
const analysisFields = (record, parser) => ({analysis: record.analysis, sop: record.sop, sop_valid: record.valid, outcome: record.outcome, unparsed: record.unparsed, uncertain: record.uncertain, symbolic_lm: {...SYMBOLIC_LM, stanza: parser}});

/** Spelled-out language kind of a bad_english row. */
const kindOf = r => (r.partition === 'clean_en' ? 'noisy_en' : r.partition);

function badRow(r, {targets: candidates}) {
  // A message that is its own rewrite (for example an emoji, or text the same in both languages) has no target.
  const targets = candidates.filter(t => t.text.trim() !== r.message.trim());
  const noiseTags = r.kind === 'new_case' ? r.noiseTags : [];
  const categories = r.kind === 'new_case' ? [...noiseTags, ...(r.partition === 'noisy_en' && !noiseTags.length ? ['gate_' + (r.reasons[0] ?? 'noise').split(' ')[0]] : [])] : noiseCategories(r.noise);
  if (r.language === 'ro' && r.kind !== 'new_case' && !categories.includes('romanian')) categories.unshift('romanian');
  if (r.partition === 'mixed') categories.unshift('code_switching');
  return {
    ...commonOf('bad_english', r), language: r.language, language_kind: kindOf(r), noise_categories: [...new Set(categories)],
    noise: {level: r.noiseLevel, ops: r.noise.map(op => op.op + (op.kind ? ':' + op.kind : '')), code_switch: r.codeSwitch?.kind ?? null},
    gate_reasons: r.reasons, target: targets[0]?.text ?? null, target_source: targets[0]?.source ?? null, targets, ...(targets.length ? {} : {flags: ['no_target']}),
  };
}

/** Policy for a message with an `unparsed` span (SymbolicLM could not formalize a span; the analysed sentences exist): `sop_rules` (the default, the owner's brief: such rows follow the README SOP rules, a strict gold
 * match or a handled message) or `gate` (the analysis gate decides like for every other row). Either way the gate result is recorded on the row (`analysis_verdict`). Open owner question Q-DATA-3. */
export const UNPARSED_POLICY = 'sop_rules';

/** A message the gate cannot judge (no analysed sentence: a greeting answered before parsing, gibberish, a crash) or that follows the SOP rules by policy (an unparsed span; `unparsedPolicy`). DS008 "Three datasets". */
export const specialKind = record => (!record.analysis?.sentences?.length ? 'no_analysis' : record.unparsed.length ? 'unparsed_span' : null);

/** SOP-layer record of a row (the later layer): match / mismatch / no_gold, whether SymbolicLM handled the message, and the SOP failure kind and evidence. */
function sopLayerOf(record, score, sopFailure) {
  const status = score ? (score.ok ? 'match' : 'mismatch') : 'no_gold';
  const handled = passes(record);
  if (status === 'mismatch') return {status, handled, failure_kind: sopFailure.failure_kind, failure: sopFailure.failure};
  if (status === 'no_gold' && !handled) return {status, handled, failure_kind: 'unknown', failure: {reason: NOT_HANDLED.has(record.outcome) ? record.outcome : record.unparsed.length ? 'unparsed_span' : 'invalid_sop', unparsed: record.unparsed}};
  return {status, handled, failure_kind: null, failure: null};
}

/**
 * Build the rows of the three datasets for `records` (one side of the split boundary).
 * `context`: {cache, parser, proofing (index), regularization (Map), gate (an AnalysisGate), gold scoring is done here}. Returns
 * {bad, symbolic, neuro, skipped: {reason: count}, gateStats}.
 *
 * Membership of a clean-English row is decided on the ANALYSIS layer, gold or not: every sentence passes the gate of
 * analysis-gate.mjs (identical default/accurate trees and DeepSeek parse judge a and c good). A row without an analysed sentence or
 * with an unparsed span is decided by the SOP rules (gold match, or a handled message). The SOP-layer result of every row is kept
 * as `sop_layer`; it never decides the dataset (owner direction 2026-09-30 night).
 */
export async function assemble(records, {cache, parser, proofing, regularization = new Map(), agreement = new Map(), wildScore = null, gate, llmTargets = loadLlmTargets(), unparsedPolicy = UNPARSED_POLICY}) {
  if (!gate) throw Error('assemble needs an AnalysisGate (tools/datasets/three-datasets/analysis-gate.mjs)');
  const skipped = {};
  const skip = reason => { skipped[reason] = (skipped[reason] ?? 0) + 1; };
  const analysisOf = r => cache.get(textKey(r.message));
  const agreeOf = r => agreement.get(textKey(r.message))?.agree ?? null;
  // Siblings for bad_english targets: same semantic case, clean English, same gold SOP.
  const cleanByCase = new Map();
  for (const r of records) if (r.kind === 'formalizer' && r.partition === 'clean_en' && r.semanticCaseId && r.language === 'en') { if (!cleanByCase.has(r.semanticCaseId)) cleanByCase.set(r.semanticCaseId, []); cleanByCase.get(r.semanticCaseId).push(r); }
  const goldOf = r => JSON.stringify(r.row.sop_targets_accepted ?? r.row.sop_target);

  const cleanFormalizer = records.filter(r => r.kind === 'formalizer' && r.partition === 'clean_en' && analysisOf(r));
  for (const r of records) if (r.kind === 'formalizer' && r.partition === 'clean_en' && !analysisOf(r)) skip('missing_analysis');
  const scores = await strictScores(cleanFormalizer, r => analysisOf(r).sop, {wildScore});
  // Re-verification of the rewrite candidates of every gold-verified miss under the current engine (one batch): the SOP-layer evidence of a row's targets.
  const targetOk = new Map();
  {
    const pairs = [];
    for (const r of cleanFormalizer) if (!scores.get(keyOf(r)).ok) goldMissCandidates(proofing, regularization, r).forEach((t, i) => { if (cache.get(textKey(t.text))) pairs.push({...r, corpus: 'target', sourceId: `${keyOf(r)}#${i}`, message: t.text}); });
    if (pairs.length) for (const [k, v] of await strictScores(pairs, rec => cache.get(textKey(rec.message)).sop, {wildScore})) targetOk.set(k, v.ok);
  }

  const bad = [], symbolic = [], neuro = [];
  const gateStats = {decided: {}, pending_texts: [], failure_kinds: {}, sentence_verdicts_from: {}, sentence_trees: {}};
  for (const r of records) {
    if (r.kind === 'formalizer' && r.partition !== 'clean_en') {
      let targets = [];
      if (r.partition === 'noisy_en') {
        const siblings = (cleanByCase.get(r.semanticCaseId) ?? []).filter(s => s.splitGroupId === r.splitGroupId && goldOf(s) === goldOf(r));
        targets = noisyEnglishTargets(proofing, r, siblings);
      } else if (/^@u\d*\s+unclear/m.test(r.row.sop_target ?? '')) targets = []; // an oracle pass on an `unclear` gold cannot tell a good translation from a bad one
      else targets = translatedTargets(proofing, r);
      bad.push(badRow(r, {targets}));
      continue;
    }
    if (r.kind === 'new_case' && r.noisy) {
      const targets = (r.row.clean ?? []).filter(text => text !== r.message && classifyMessage(text).partition === 'clean_en')
        .map(text => ({text, source: 'new_cases.clean', check: {clean_english_gate: true, reviewed: 'pending'}}));
      bad.push(badRow(r, {targets}));
      continue;
    }
    const record = analysisOf(r);
    if (!record) { skip('missing_analysis'); continue; }
    const isNew = r.kind === 'new_case';
    const score = isNew ? null : scores.get(keyOf(r));
    const gold = isNew ? null : r.row.sop_target;
    const kind = specialKind(record);
    // The gate runs on every row that has an analysed sentence; it decides unless the row follows the SOP rules (no analysis, or an unparsed span under the `sop_rules` policy).
    const decision = kind === 'no_analysis' ? null : gate.decide(r.message, record.analysis);
    const special = kind === 'unparsed_span' && unparsedPolicy === 'gate' ? null : kind;
    const sopOk = score ? score.ok : passes(record);
    const toSymbolic = special ? sopOk : decision.state === 'pass';
    gateStats.decided[special ? special : decision.state] = (gateStats.decided[special ? special : decision.state] ?? 0) + 1;
    if (special === 'unparsed_span') gateStats.unparsed_gate_would_say = {...gateStats.unparsed_gate_would_say, [decision.state]: (gateStats.unparsed_gate_would_say?.[decision.state] ?? 0) + 1};
    if (decision?.state === 'pending' && !special) gateStats.pending_texts.push(r.message);
    for (const x of decision?.sentences ?? []) { gateStats.sentence_trees[x.tree ?? 'unknown'] = (gateStats.sentence_trees[x.tree ?? 'unknown'] ?? 0) + 1; if (x.from) gateStats.sentence_verdicts_from[x.from] = (gateStats.sentence_verdicts_from[x.from] ?? 0) + 1; }
    if (decision?.state === 'fail') gateStats.failure_kinds[decision.failure_kind] = (gateStats.failure_kinds[decision.failure_kind] ?? 0) + 1;

    // SOP layer: the failure kind of a gold miss as before (the recorded proofing layer of a still-verified rewrite, the structural diff, host frame normalization).
    const candidates = isNew ? [] : goldMissCandidates(proofing, regularization, r);
    const checked = candidates.map((t, i) => ({t, ok: targetOk.get(`target::${keyOf(r)}#${i}`) === true}));
    let sopFailure = null;
    if (score && !score.ok) {
      const layer = checked.filter(c => c.ok).map(c => c.t.layer).find(l => l && l !== 'input') ?? null;
      sopFailure = failureOf(r, score, layer);
      const reg = regularization.get(r.message) ?? null;
      if (reg) sopFailure.failure.regularization = {verdict: reg.verdict, error_type: reg.error_type};
      sopFailure.failure.unparsed = record.unparsed;
      sopFailure.failure.unverified_targets = candidates.length - checked.filter(c => c.ok).length;
    }
    const sop_layer = sopLayerOf(record, score, sopFailure);
    const cmpClass = decision?.worst_tree ?? 'not_measured';
    const verification = {sop_gold_match: score ? score.ok : null, judge: decision ? judgeSummary(decision) : null, stanza_spacy_agree: agreeOf(r), stanza_default_accurate: cmpClass};
    const analysis_verdict = decision ? {...verdictRecord(decision, {unparsed: record.unparsed}), placed_by: special ? 'sop_rule' : 'analysis_gate', ...(special ? {reason: special, sop_rule: sopOk ? 'passed' : 'failed'} : {})} : {state: 'not_applicable', gate: GATE_NAME, placed_by: 'sop_rule', reason: kind, sop_rule: sopOk ? 'passed' : 'failed', unparsed: record.unparsed};
    const goldFields = {gold_sop: gold, ...(r.wild ? {gold_sop_accepted: r.row.sop_targets_accepted ?? [r.row.sop_target]} : {})};

    if (toSymbolic) {
      symbolic.push({...commonOf('symbolic_english', r), ...analysisFields(record, record.parser), ...goldFields, analysis_verified: special ? 'sop_rule' : 'analysis_gate', analysis_verdict, sop_layer, verification, ...(isNew ? {reference_clean: r.row.clean ?? []} : {})});
      continue;
    }
    // neuro_english: the analysis layer failed (or the SOP rules failed a message the gate cannot judge). failure_kind describes that failure; the SOP failure stays in sop_layer.
    const pending = !special && decision.state === 'pending';
    const failure_kind = special ? special : pending ? 'pending_judge' : decision.failure_kind;
    let targets = [], unverifiedReferences = [];
    if (isNew) {
      const all = [];
      for (const text of r.row.clean ?? []) {
        if (text === r.message) continue;
        const target = cache.get(textKey(text));
        all.push({text, source: 'new_cases.clean', check: {symbolic_ok: passes(target), sop_valid: target?.valid ?? null, unparsed: target?.unparsed?.length ?? null, reviewed: 'pending'}});
      }
      targets = all.filter(t => t.check.symbolic_ok);
      unverifiedReferences = all.filter(t => !t.check.symbolic_ok);
    } else {
      targets = checked.filter(c => c.ok).map(c => { const {layer: _layer, ...rest} = c.t; return {...rest, check: {...c.t.check, oracle: `${RULES_VERSION} strict gold match (Stanza accurate package)`}}; });
    }
    const flags = [...(targets.length ? [] : ['no_target']), ...(pending ? ['pending_judge'] : [])];
    const failure = {layer: 'analysis', reasons: special ? [] : decision?.reasons ?? [], categories: special ? [special] : pending ? ['pending_judge'] : [...new Set(decision.reasons.map(x => x.kind))], classes: [], frame_recoverable: Boolean(sop_layer.failure?.frame_recoverable), proofing_layer: sop_layer.failure?.proofing_layer ?? null, also_gold_convention: Boolean(sop_layer.failure?.also_gold_convention), unparsed: record.unparsed, ...(sop_layer.failure?.regularization ? {regularization: sop_layer.failure.regularization} : {}), unverified_targets: sop_layer.failure?.unverified_targets ?? unverifiedReferences.length};
    neuro.push({...commonOf('neuro_english', r), ...analysisFields(record, record.parser), ...goldFields, failure_kind, failure, rewrite_target: true,
      target: targets[0]?.text ?? null, target_source: targets[0]?.source ?? null, targets, ...(unverifiedReferences.length ? {unverified_references: unverifiedReferences} : {}), ...(flags.length ? {flags} : {}),
      analysis_verified: special ? 'sop_rule_failed' : pending ? 'analysis_pending_judge' : 'analysis_gate_failed', analysis_verdict, sop_layer, verification});
  }
  // A target that differs from the message only in casing, punctuation or spacing: a formatting fix that a rule can make.
  for (const row of neuro) {
    const formatting = Boolean(row.target) && normalText(row.target) === normalText(row.message);
    row.failure.formatting_only = formatting;
    if (formatting) row.flags = [...(row.flags ?? []), 'formatting_only'];
  }
  // DeepSeek flash targets for the bad_english rows that had none (llm-targets.mjs); rows with a target keep it.
  applyLlmTargets(bad, llmTargets);
  return {bad, symbolic, neuro, skipped, gateStats};
}
