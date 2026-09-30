/** Assembly of the three datasets from classified records, the analysis cache and the target sources.
 * See docs/specs/DS008-data-evaluation.md "Three datasets" for the classification rules. */
import {textKey} from './analysis.mjs';
import {strictScores, failureOf, RULES_VERSION} from './score.mjs';
import {repairTargets, noisyEnglishTargets, translatedTargets} from './targets.mjs';
import {noiseCategories} from './noise.mjs';
import {classifyMessage} from './sources.mjs';
import {normalText} from './inputs.mjs';
import {rowRights, AUTHORED_LICENCE, SOURCES} from '../rights.mjs';
import {compareAnalyses} from './accurate.mjs';
import {decideNoGold} from './gate.mjs';

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

/**
 * Build the rows of the three datasets for `records` (one side of the split boundary).
 * `context`: {cache, parser, proofing (index), regularization (Map), gold scoring is done here}. Returns
 * {bad, symbolic, neuro, skipped: {reason: count}}.
 */
export async function assemble(records, {cache, parser, proofing, regularization = new Map(), agreement = new Map(), wildScore = null, gate = null}) {
  // gate: {defaults: Map (analyses of the default package, the cache before the adoption), stores: {old, acc} (judge verdicts), mode}.
  // The analysis of a row is the current (accurate-package) one; `cmpOf` compares its trees with the default package's.
  // The work list holds the sentence judgements that still have to run (written by the callers).
  const gateWork = {nogold: {}, gold: {}, held_out: []};
  const cmpOf = (r, record) => (gate ? compareAnalyses(gate.defaults.get(textKey(r.message))?.analysis, record.analysis) : null);
  const differing = (cmp, all = false) => (cmp?.sentences ?? []).map((c, i) => (all || c !== 'identical' ? i : -1)).filter(i => i >= 0);
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
  // Re-verification of the rewrite candidates of every gold-verified miss under the current engine (one batch).
  const targetOk = new Map();
  {
    const pairs = [];
    for (const r of cleanFormalizer) if (!scores.get(keyOf(r)).ok) goldMissCandidates(proofing, regularization, r).forEach((t, i) => { if (cache.get(textKey(t.text))) pairs.push({...r, corpus: 'target', sourceId: `${keyOf(r)}#${i}`, message: t.text}); });
    if (pairs.length) for (const [k, v] of await strictScores(pairs, rec => cache.get(textKey(rec.message)).sop, {wildScore})) targetOk.set(k, v.ok);
  }

  const bad = [], symbolic = [], neuro = [];
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
    if (r.kind === 'new_case') {
      const base = {...commonOf('symbolic_english', r), ...analysisFields(record, record.parser)};
      const cmp = cmpOf(r, record);
      const verification = extra => ({sop_gold_match: null, judge: null, stanza_spacy_agree: agreeOf(r), stanza_default_accurate: cmp?.row ?? null, ...extra});
      const decision = passes(record) ? (gate ? decideNoGold({k: textKey(r.message), sentences: record.analysis?.sentences?.length ?? 0, cmp, stores: gate.stores}) : {state: 'pending', judge: [], missing: []}) : {state: 'failed'};
      if (decision.state === 'accept') {
        symbolic.push({...base, gold_sop: null, analysis_verified: decision.route, verification: verification({judge: decision.judge?.length ? {mode: gate?.mode ?? null, sentences: decision.judge} : null}), reference_clean: r.row.clean ?? []});
      } else {
        // A row still without a verdict (the judge budget ended) is not in symbolic_english: it goes to neuro_english flagged `pending_judge`.
        const pending = decision.state === 'pending';
        if (pending) gateWork.nogold[textKey(r.message)] = decision.missing;
        const targets = [];
        for (const text of r.row.clean ?? []) {
          if (text === r.message) continue;
          const target = cache.get(textKey(text));
          targets.push({text, source: 'new_cases.clean', check: {symbolic_ok: passes(target), sop_valid: target?.valid ?? null, unparsed: target?.unparsed?.length ?? null, reviewed: 'pending'}});
        }
        const verified = targets.filter(t => t.check.symbolic_ok);
        const rejected = decision.state === 'reject';
        const flags = [...(verified.length ? [] : ['no_target']), ...(rejected && decision.failure_kind === 'unknown' ? ['analysis_unconfirmed'] : []), ...(pending ? ['pending_judge'] : [])];
        const judged = rejected || pending ? {mode: gate.mode, sentences: decision.judge} : null;
        neuro.push({...commonOf('neuro_english', r), ...analysisFields(record, record.parser), gold_sop: null, failure_kind: rejected ? decision.failure_kind : 'unknown',
          failure: rejected ? {reason: 'analysis_rejected_by_gate', gate_mode: gate.mode, judge: decision.judge, unparsed: record.unparsed} : pending ? {reason: 'analysis_pending_judge', gate_mode: gate.mode, judge: decision.judge, unparsed: record.unparsed} : {reason: NOT_HANDLED.has(record.outcome) ? record.outcome : record.unparsed.length ? 'unparsed_span' : 'invalid_sop', unparsed: record.unparsed},
          analysis_verified: rejected ? 'analysis_rejected_by_gate' : pending ? 'analysis_pending_judge' : 'analysis_failed_no_gold', rewrite_target: true, target: verified[0]?.text ?? null, target_source: verified[0]?.source ?? null, targets: verified, unverified_references: targets.filter(t => !t.check.symbolic_ok), ...(flags.length ? {flags} : {}),
          verification: verification({judge: judged})});
      }
      continue;
    }
    const score = scores.get(keyOf(r));
    const gold = r.wild ? (r.row.sop_targets_accepted ?? [r.row.sop_target]) : [r.row.sop_target];
    const common = {...commonOf('symbolic_english', r), ...analysisFields(record, record.parser), gold_sop: r.row.sop_target, ...(r.wild ? {gold_sop_accepted: gold} : {})};
    const cmp = cmpOf(r, record);
    const stanzaClass = cmp?.row ?? null;
    if (score.ok) {
      // A gold-matching row is never removed. Its analysis is the current (accurate-package) tree; the class of the
      // comparison with the default package's tree is recorded (`stanza_default_accurate`).
      const flags = {};
      const verification = {sop_gold_match: true, judge: null, stanza_spacy_agree: agreeOf(r), stanza_default_accurate: stanzaClass};
      symbolic.push({...common, ...flags, analysis_verified: 'gold_sop_match', verification});
    } else {
      const reg = regularization.get(r.message) ?? null;
      // A rewrite target is verified when the CURRENT engine analyses it to the row's gold SOP (strict): recorded oracle
      // checks of older rules do not count. The recorded proofing layer of a still-verified repair tells where it acts.
      const candidates = goldMissCandidates(proofing, regularization, r);
      const checked = candidates.map((t, i) => ({t, ok: targetOk.get(`target::${keyOf(r)}#${i}`) === true}));
      const targets = checked.filter(c => c.ok).map(c => { const {layer: _layer, ...rest} = c.t; return {...rest, check: {...c.t.check, oracle: `${RULES_VERSION} strict gold match (Stanza accurate package)`}}; });
      const layer = checked.filter(c => c.ok).map(c => c.t.layer).find(l => l && l !== 'input') ?? null;
      let {failure_kind, failure} = failureOf(r, score, layer);
      if (reg) failure.regularization = {verdict: reg.verdict, error_type: reg.error_type};
      failure.unparsed = record.unparsed;
      failure.unverified_targets = candidates.length - targets.length;
      const rewriteTarget = failure_kind !== 'gold_convention';
      neuro.push({...common, dataset: 'neuro_english', failure_kind, failure, rewrite_target: rewriteTarget, target: targets[0]?.text ?? null, target_source: targets[0]?.source ?? null, targets,
        ...(targets.length ? {} : {flags: [rewriteTarget ? 'no_target' : 'gold_convention_not_a_rewrite_target']}), analysis_verified: 'gold_sop_mismatch', verification: {sop_gold_match: false, judge: null, stanza_spacy_agree: agreeOf(r), stanza_default_accurate: stanzaClass}});
    }
  }
  // A target that differs from the message only in casing, punctuation or spacing: a formatting fix that a rule can make.
  for (const row of neuro) {
    const formatting = Boolean(row.target) && normalText(row.target) === normalText(row.message);
    row.failure.formatting_only = formatting;
    if (formatting) row.flags = [...(row.flags ?? []), 'formatting_only'];
  }
  return {bad, symbolic, neuro, skipped, gateWork};
}
