/** "How evaluation works": the explainer behind `/eval/guide`.
 *
 * Every claim carries citations to the code or specification that makes it
 * true. A citation is an anchor string, resolved to `file:line` when the page
 * is rendered, so the line numbers follow the files as other agents edit them;
 * an anchor that no longer occurs is shown as "moved" instead of a stale line.
 * Numbers quoted from specifications are labelled historical: current values
 * are read live from `eval/reports/current/`.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Resolves `[file, anchor, ...alternatives]` to the first line containing one of the anchors. */
export function cite(root, file, ...anchors) {
  let lines;
  try {
    lines = fs.readFileSync(path.join(root, file), 'utf8').split('\n');
  } catch {
    return {file, line: null, anchor: anchors[0], found: false};
  }
  for (const anchor of anchors) {
    const index = lines.findIndex(line => line.includes(anchor));
    if (index >= 0) return {file, line: index + 1, anchor, found: true};
  }
  return {file, line: null, anchor: anchors[0], found: false};
}

const RUN = 'eval/run.mjs';
const METRICS = 'eval/metrics.mjs';
const PROPS = 'eval/propositions.mjs';
const BROWSER = 'server/eval-browser.mjs';
const FREE = 'eval/reference-free.mjs';
const SYN = 'eval/synonyms.mjs';
const SLICES = 'eval/slices.mjs';

/** Metric definitions in the order of `computeMetrics` (eval/metrics.mjs) and the evaluator report (eval/run.mjs). */
export const METRIC_DEFINITIONS = [
  // eval/run.mjs report.metrics — every evaluator report carries these.
  {key: 'metrics.syntax', source: RUN, anchor: 'syntax: fraction(', definition: 'Rows whose prediction parsed / all rows of the suite (missing or malformed predictions count as failures).'},
  {key: 'metrics.runtime', source: RUN, anchor: 'runtime: fraction(', definition: 'Rows whose prediction executed through the guarded runtime / all rows.'},
  {key: 'metrics.canonical_match', source: RUN, anchor: 'canonical_match: fraction(', definition: 'Predictions whose canonical parse equals the canonical gold (with `basis` removed) / rows with a valid reference.'},
  {key: 'metrics.execution_equivalence', source: RUN, anchor: 'execution_equivalence: fraction(', definition: 'Predictions whose execution signature equals the gold signature / rows with a valid reference.'},
  {key: 'metrics.execution_equivalence_tolerant', source: RUN, anchor: 'execution_equivalence_tolerant: fraction(', definition: 'Strictly equivalent (strict runs link without the host dictionary, policy.dictionary false), or equivalent when the prediction alone is re-linked with the host dictionary enabled (config/dictionary: Romanian lemmas, English phrases and synonyms) plus the evaluation-only relation synonyms (eval/synonyms.mjs, eval/relation-synonyms.json) / rows with a valid reference.'},
  {key: 'metrics.canonical_match_tolerant', source: RUN, anchor: 'canonical_match_tolerant: fraction(', definition: 'Canonically equal to an accepted gold, or every wire pairs both ways with an accepted gold under id- and order-free wire items, relation phrases and quoted values compared by Dictionary.sameMeaning / rows with a valid reference.'},
  {key: 'metrics.canonical_match_primary', source: RUN, anchor: 'canonical_match_primary: fraction(', definition: 'Canonical match against sop_target alone (the strict canonical_match accepts any gold of sop_targets_accepted) / rows with a valid reference.'},
  {key: 'metrics.execution_equivalence_primary', source: RUN, anchor: 'execution_equivalence_primary: fraction(', definition: 'Execution equivalence against sop_target alone / rows with a valid reference.'},
  {key: 'metrics.unknown', source: RUN, anchor: "unknown: fraction(records.filter(record => record.gold_status === 'unknown'", definition: 'Gold `unknown` rows predicted `unknown` and execution-equivalent / gold `unknown` rows.'},
  {key: 'metrics.paraphrase_invariance', source: RUN, anchor: 'paraphrase_invariance: fraction(invariant', definition: 'Semantic cases with more than one row where every row executed and all prediction signatures are identical / such cases.'},
  {key: 'metrics.hard_negative_pair_correctness', source: RUN, anchor: 'hard_negative_pair_correctness: fraction(', definition: 'Linked `negative_of` pairs whose rows are all execution-equivalent / linked pairs.'},
  // eval/metrics.mjs computeMetrics — the DS016 metric set.
  {key: 'formalizer.parse_rate', source: METRICS, anchor: 'parse_rate: rate(formal', definition: 'Parsed formalization predictions / formalization rows with a valid reference.'},
  {key: 'formalizer.canonical_ast_match', source: METRICS, anchor: 'canonical_ast_match: rate(', definition: 'Canonical parse equal to gold / formalization rows with a valid reference.'},
  {key: 'formalizer.execution_equivalence', source: METRICS, anchor: 'execution_equivalence: rate(formal', definition: 'Equal execution signatures / formalization rows with a valid reference. Finite-world equivalence, not universal equivalence.'},
  {key: 'formalizer.execution_equivalence_tolerant', source: METRICS, anchor: 'execution_equivalence_tolerant: rate(', definition: 'Tolerant execution equivalence (host dictionary enabled, strict runs with policy.dictionary false, plus evaluation-only relation synonyms; any accepted gold) / formalization rows with a valid reference.'},
  {key: 'formalizer.canonical_ast_match_tolerant', source: METRICS, anchor: 'canonical_ast_match_tolerant: rate(', definition: 'Canonically equal to an accepted gold, or every wire pairs both ways with an accepted gold under id- and order-free wire items, relation phrases and quoted values compared by Dictionary.sameMeaning / formalization rows with a valid reference.'},
  {key: 'formalizer.canonical_ast_match_primary', source: METRICS, anchor: 'canonical_ast_match_primary: rate(', definition: 'Canonical match with sop_target alone / formalization rows with a valid reference.'},
  {key: 'formalizer.execution_equivalence_primary', source: METRICS, anchor: 'execution_equivalence_primary: rate(', definition: 'Execution equivalence with sop_target alone / formalization rows with a valid reference.'},
  {key: 'formalizer.answer_correctness', source: METRICS, anchor: 'answer_correctness: rate(', definition: 'Equal answer tuples and equal projected epistemic decision (`epistemicResult`) / formalization rows with a valid reference.'},
  {key: 'formalizer.symbol_choice', source: METRICS, anchor: 'symbol_choice: rate(', definition: 'Executed query `mode`, `where` and `select` equal to gold / formalization rows whose gold has a query.'},
  {key: 'formalizer.paraphrase_invariance', source: METRICS, anchor: 'paraphrase_invariance: rate(invariance', definition: 'Every member execution-equivalent with one identical prediction signature / semantic cases with more than one formalization row.'},
  {key: 'formalizer.hard_negative_discrimination', source: METRICS, anchor: 'hard_negative_discrimination: rate(', definition: 'Both sides of a `negative_of` pair execution-equivalent to two distinct gold signatures / unique pairs.'},
  {key: 'formalizer.abstention', source: METRICS, anchor: 'abstention: rate(', definition: 'Matching executed UNKNOWN or AMBIGUOUS decision and equivalent signature / gold UNKNOWN or AMBIGUOUS formalization rows.'},
  {key: 'formalizer.en_to_ro_transfer', source: METRICS, anchor: 'en_to_ro_transfer: rate(', definition: 'Cases whose English and Romanian rows are all execution-equivalent / cases having both languages. Paired fixture success, not a trained-model transfer estimate.'},
  {key: 'formalizer.wire_match', source: METRICS, anchor: 'wire_match: wireMetrics(', definition: 'Partial credit (additional diagnostic, not a replacement for execution equivalence): gold and prediction wires matched as order- and id-free multisets (stated/assumed by folded relation phrase, roles and values, polarity and validity; queries, constraints and unclear by their folded fields with renamed variables), best over the accepted golds. Reports micro precision, recall and F1, mean row F1, rows with wire F1 >= 0.9, statement and query F1 separately, and `problems_correct` (the query/constraint part exactly right / rows whose gold has one). Lexical: a relation synonym the tolerant comparison accepts is a miss here.'},
  {key: 'epistemic.unknown_calibration.recall', source: METRICS, anchor: 'recall: rate(unknownGold', definition: 'Predicted UNKNOWN / gold UNKNOWN rows (discrete, not probability calibration).'},
  {key: 'epistemic.unknown_calibration.false_unknown_rate', source: METRICS, anchor: 'false_unknown_rate: rate(', definition: 'Predicted UNKNOWN / gold rows that are not UNKNOWN.'},
  {key: 'epistemic.contradictions_preserved', source: METRICS, anchor: 'contradictions_preserved: rate(', definition: 'Predicted CONFLICT with equal conflicted answers / gold CONFLICT rows.'},
  {key: 'epistemic.over_inference', source: METRICS, anchor: 'over_inference: rate(', definition: 'Predicted decision other than UNKNOWN or CONFLICT / gold UNKNOWN or CONFLICT rows (unsupported certainty; lower is better).'},
  {key: 'epistemic.provenance_presence', source: METRICS, anchor: 'provenance_presence: rate(', definition: 'Answer evidence points at proof entries; observed entries have source and quote; derived entries have a rule and present premises / executed rows with proof or answers.'},
  {key: 'epistemic.provenance_recall', source: METRICS, anchor: 'provenance_recall: rate(', definition: 'All gold observed proof ids cited by the prediction / executed rows with gold proof.'},
  {key: 'epistemic.retractions_preserved', source: METRICS, anchor: 'retractions_preserved: rate(', definition: 'Equal `defeatedAssumptions` and equal session event signature / rows whose gold exposes defeated assumptions or a retract event.'},
  {key: 'epistemic.unauthorized_writes', source: METRICS, anchor: 'unauthorized_writes: rate(', definition: 'Successful predictions that wrote claims or events (formalization: any write; system: writes different from gold) / executed rows. Lower is better.'},
  {key: 'reasoning_memory.answer_soundness', source: METRICS, anchor: 'answer_soundness: fraction(', definition: 'Predicted answer tuples also in gold / predicted tuples (precision).'},
  {key: 'reasoning_memory.answer_coverage', source: METRICS, anchor: 'answer_coverage: fraction(', definition: 'Gold answer tuples also predicted / gold tuples (recall).'},
  {key: 'reasoning_memory.proof_retrieval_precision', source: METRICS, anchor: 'proof_retrieval_precision: fraction(', definition: 'Cited observed claim ids shared with gold / predicted observed ids.'},
  {key: 'reasoning_memory.proof_retrieval_recall', source: METRICS, anchor: 'proof_retrieval_recall: fraction(', definition: 'Cited observed claim ids shared with gold / gold observed ids.'},
  {key: 'reasoning_memory.retrieval_complete', source: METRICS, anchor: 'retrieval_complete: rate(', definition: 'Packets whose link-plan retrievals are all complete / executed rows with retrievals.'},
  {key: 'reasoning_memory.execution_complete', source: METRICS, anchor: 'execution_complete: rate(', definition: 'Packets reporting `complete: true` / executed rows reporting a boolean completion.'},
  {key: 'reasoning_memory.budget_diagnostics', source: METRICS, anchor: 'budget_diagnostics:', definition: 'Distributions (count, p50, p95, max) of memory probes, retrieved count, closure facts and rounds; no threshold is inferred.'},
  {key: 'reasoning_memory.effective_routes', source: METRICS, anchor: 'effective_routes:', definition: 'Counts of observed operation/backend/fallback per executed row; routes are observed, never inferred from the request.'},
  {key: 'reasoning_memory.retrieval_routes', source: METRICS, anchor: 'retrieval_routes:', definition: 'Counts of requested strategy → selected retrieval route.'},
  {key: 'reasoning_memory.latency_ms', source: METRICS, anchor: 'latency_ms: Object.fromEntries(timed', definition: 'Distributions of evaluator stage timings: model, setup, gold, prediction, total.'},
  {key: 'reasoning_memory.sampled_peak_rss_bytes', source: METRICS, anchor: 'sampled_peak_rss_bytes:', definition: 'Maximum RSS sampled between cases; not a continuous peak. CUDA memory is not measured.'},
  // eval/reference-free.mjs — reference-free metrics of predictions (message + prediction only; no gold).
  {key: 'reference_free.parse_validity', source: FREE, anchor: 'parse_validity: rate(', definition: 'Predictions that parse / rows.'},
  {key: 'reference_free.compile_validity', source: FREE, anchor: 'compile_validity: rate(', definition: 'Predictions admitted by checkModelProgram and compiled by compileDeclarative without a lexicon / rows.'},
  {key: 'reference_free.contract_vocabulary', source: FREE, anchor: 'contract_vocabulary: rate(', definition: 'Parsed predictions with no failing contract finding (wire types, fields, enum values, model-authorable types, cardinality; the corpus-audit checkProgram) / rows.'},
  {key: 'reference_free.stated_value_anchoring', source: FREE, anchor: 'stated_value_anchoring: fraction(', definition: 'Stated role values and reported speakers found in the message (typo-tolerant; a canonical-English translation of a common noun through the host lexicon or the generator EN-RO lexicon) / all such values.'},
  {key: 'reference_free.polarity_agreement', source: FREE, anchor: 'polarity_agreement: rate(', definition: 'Negation or omission cue in the message exactly when a stated or query proposition is negated or lexically negative / parsed non-unclear predictions; unsupported_negation and missed_negation split the disagreements.'},
  {key: 'reference_free.question_form_agreement', source: FREE, anchor: 'question_form_agreement: rate(', definition: 'The message asks (question mark, interrogative start, request cue) exactly when the prediction has a query or constraint / parsed non-unclear predictions; missing_query and spurious_query split the disagreements.'},
  {key: 'reference_free.unclear_gibberish_agreement', source: FREE, anchor: 'unclear_gibberish_agreement: rate(', definition: 'Prediction is unclear kind gibberish exactly when the gibberish detector says gibberish / rows the detector decides (uncertain rows excluded).'},
  {key: 'reference_free.id_like_tokens', source: FREE, anchor: 'id_like_tokens: rate(', definition: 'Parsed predictions with an identifier-like quoted value or a retired construct (modelTargetIdFindings) / parsed predictions. Lower is better.'},
  {key: 'reference_free.assumed_wire_share', source: FREE, anchor: 'assumed_wire_share: fraction(', definition: 'assumed wires / stated plus assumed wires (rows_with_assumed: rows with at least one assumed wire). Descriptive.'},
  {key: 'propositions.proposition_recall', source: PROPS, anchor: "proposition_recall: fraction(", definition: 'Gold stated/assumed propositions matched by identity (relation, roles, polarity, validity) / gold propositions.'},
  {key: 'propositions.proposition_precision', source: PROPS, anchor: "proposition_precision: fraction(", definition: 'Matched propositions / predicted propositions.'},
  {key: 'propositions.separation_accuracy', source: PROPS, anchor: "separation_accuracy: fraction(", definition: 'Matched propositions whose wire type (stated vs assumed) agrees / matched propositions.'},
  {key: 'propositions.basis', source: PROPS, anchor: "basis: {labelled:", definition: 'Coverage (a basis was emitted / labelled gold assumptions) and accuracy (exact agreement / covered); reported separately and never part of canonical match.'},
];

/** The explainer: sections of claims, each with citations `[file, anchor, ...alternatives]`. */
const SECTIONS = [
  {id: 'splits', title: 'Splits, and why the sealed test is never read by training', claims: [
    {text: 'Every corpus has train and dev splits under datasets/<corpus>/ (legacy corpora: datasets_archive/<corpus>/) and a physically separate sealed test under eval/suites/<corpus>/test.jsonl. Training and checkpoint selection read only train/dev.', cites: [['AGENTS.md', '9. Test and data authority'], ['docs/specs/DS008-data-evaluation.md', 'Keep all paraphrases, translations, and linked contrasts']]},
    {text: 'All paraphrases, translations and linked contrasts of one semantic_case_id stay in the same split, so a test case is never a reworded training case.', cites: [['docs/specs/DS008-data-evaluation.md', 'Keep all paraphrases, translations, and linked contrasts'], ['docs/specs/DS010-experiment-preregistration.md', 'Assign the `semantic_case_id` group before rendering']]},
    {text: 'The guard is executable: auditTrainingSelection fails when any training source mentions test.jsonl or eval/suites, and checks that training/cli.mjs loads exactly the train,dev split list.', cites: [['eval/leakage.mjs', 'export function auditTrainingSelection'], ['eval/leakage.mjs', "sealed test path in training/selection code"], ['eval/leakage.mjs', "unsafe dataset() split list"], ['training/cli.mjs', "dataset(o,['train','dev'])"]]},
    {text: 'Generators are audited the same way: auditSourceBoundary rejects imports or reads of sealed test files in every data builder. The only readers allowed are the validator and the sealed auditors (leakage measurement); their outputs are reports and no generator may import them.', cites: [['eval/leakage.mjs', 'export function auditSourceBoundary'], ['eval/leakage.mjs', 'export const SEALED_AUDITORS'], ['docs/specs/DS008-data-evaluation.md', 'one bounded exception: **sealed auditors**']]},
    {text: 'Run it before any registry evaluation: node tools/eval/registry.mjs audit writes eval/reports/current/registry/leakage.json and exits nonzero when blocked.', cites: [['docs/specs/DS008-data-evaluation.md', 'Run `node tools/eval/registry.mjs audit`'], ['tools/eval/registry.mjs', 'export function audit(']]},
  ]},
  {id: 'model-input', title: 'What the model receives: the message only', claims: [
    {text: 'The small model has no context. Its input is exactly the user message; the world (setup_sop), vocabulary (ontology_sop), context and expected result on a row are verification scaffolding for the host and the evaluator, never model input.', cites: [['docs/specs/DS021-model-surface.md', '**The small model has no context.**'], ['docs/specs/DS008-data-evaluation.md', 'ML projections are **instruction-free**'], ['server/llm.mjs', 'export const barePrompt']]},
    {text: 'The model does not translate (owner decision D1 of 2026-09-29): content words stay in the message language, normalized (relation lemmas, common nouns in the nominative); proper names stay as written. English content words are accepted too. The host translates content strings with the reviewed dictionary before linking and reports an unknown word as untranslated; a stated value is anchored in the message directly, through the dictionary or through the host lexicon.', cites: [['docs/specs/DS021-model-surface.md', 'Input languages and content words'], ['sop/linking.mjs', 'export function mentionedThroughDictionary'], ['server/agent.mjs', 'mentionedThroughDictionary(value,text,dictionary)']]},
    {text: 'The predictor receives only {id, prompt}: never the gold target, the world or the expected answer. For an endpoint, the prompt is rebuilt from the message; a stored row.prompt is not trusted.', cites: [[RUN, 'The predictor receives only the model-facing prompt'], [RUN, 'const predicted = await predictor(']]},
    {text: 'There is one model language with no versions or profiles (owner decision of 2026-09-28). The corpora in it are formalizer-v1 and the out-of-distribution suite formalizer-ood-v1; the earlier corpora in the old form (identifiers, premise, a CONTEXT block) were deleted with that regeneration. A row still written in the old form would be labelled "legacy form" in this browser.', cites: [['docs/specs/DS021-model-surface.md', 'the earlier atom/identifier/context corpora were deleted'], [BROWSER, 'export function targetForm']]},
  ]},
  {id: 'admission', title: 'How a prediction is admitted, parsed, compiled and executed', claims: [
    {text: 'Predictions are explicit artifacts: one {id, sop} row per suite row, coverage exactly equal to the suite, no duplicates. The evaluator never fills a gap with gold.', cites: [[RUN, 'Prediction coverage must exactly match the suite'], [RUN, 'gold is never a fallback'], [RUN, 'Duplicate prediction IDs']]},
    {text: 'A formalizer endpoint may only be evaluated on formalization rows; trusted system circuits are never sent to a model.', cites: [[RUN, "assert(source !== 'endpoint'"]]},
    {text: 'Reference first: the gold target is parsed and admitted, the case world (setup_sop) is published into a fresh repository, and the gold runs in its own session. Its packet is checked against the independently stored expected status, answers, outputs and session effects. A failing reference is a reference failure, not a model error.', cites: [[RUN, 'const targetProgram = parse(target)'], [RUN, "publishKnowledge(repo, 'world'"], [RUN, "goldSession = repo.session("], [RUN, 'checkReference(row, gold'], [RUN, 'Gold status disagrees with independent reference']]},
    {text: 'Declarative model wires must not write: a formalization gold that creates repository claims or events fails the reference check.', cites: [[RUN, 'must not write repository claims']]},
    {text: 'Then the prediction: it must be SOP text; it is parsed (syntax_valid), compared canonically with basis removed (canonical_match), compared by propositions, admitted by the same model-wire check as the gold, and executed through the guarded runtime in a separate session (runtime_valid).', cites: [[RUN, "'Prediction must be SOP text'"], [RUN, 'const predictedProgram = parse(predicted)'], [RUN, 'record.canonical_match = '], [RUN, 'record.propositions = compareProgramPropositions('], [RUN, 'const actual = await predExecutor.runtime.run(']]},
    {text: 'Any exception records the failing stage (reference, generation, parse, prediction). A report is valid only when no reference failed and the predictor never failed; a parse or execution failure of the prediction counts against the model, not against validity.', cites: [[RUN, 'record.error = { stage'], [RUN, 'const operationalFailures ='], [RUN, 'evaluation_valid: operationalFailures === 0']]},
    {text: 'The report fingerprints the suite as sha256 of its stable serialization; this browser uses the same hash to attach reports to suites.', cites: [[RUN, 'suite_sha256: sha256(stable(rows))']]},
  ]},
  {id: 'comparison', title: 'Canonical comparison versus execution comparison', claims: [
    {text: 'Canonical comparison is syntactic: both programs are parsed, basis labels removed, and their canonical serializations compared. Different but equivalent spellings fail it.', cites: [[RUN, 'canonical(withoutBasis(targetProgram))'], [PROPS, 'export const withoutBasis']]},
    {text: 'Execution comparison is semantic on a finite world: both programs run on the same world and their observable signatures (status, answer tuples, count, epistemic packet fields, outputs, session claims and events, context premises) must be identical.', cites: [['eval/signature.mjs', 'export function executionSignature'], [RUN, 'record.execution_equivalent = ']]},
    {text: 'A row may accept several golds: sop_target is the primary and sop_targets_accepted lists other plausible readings of a genuinely ambiguous phrasing (owner decision Q-DATA-5). Canonical match and strict execution equivalence accept any of them; the _primary metrics compare with sop_target alone.', cites: [[RUN, 'sop_targets_accepted must be a list'], [RUN, 'record.canonical_match = acceptedCanonicals.has('], [RUN, 'record.execution_equivalent = acceptedSignatures.has('], ['docs/specs/DS016-evaluation-metrics.md', '**Accepted golds.**']]},
    {text: 'Tolerant execution equivalence re-links only the prediction with evaluation-only relation synonyms added to the row world\'s predicate declarations; golds keep their strict signatures, and a synonym that the world already declares for another predicate is dropped. Production linking never reads the synonym list.', cites: [[SYN, 'export function tolerantOntology'], ['eval/relation-synonyms.json', '"works_at"'], [RUN, 'Tolerant comparison: the prediction alone runs again'], ['docs/specs/DS016-evaluation-metrics.md', '**Relation synonyms.**']]},
    {text: 'Execution equivalence does not depend on assumed wires: under the report policy an assumed wire is linked only for the report and never enters the circuit, and the signature holds no assumption report. Only the admission limits (at most 8 assumptions, no assumption repeating a statement) can make an assumed wire invalidate a prediction.', cites: [['sop/declarative.mjs', 'In report mode an assumption is linked only for the report'], ['eval/signature.mjs', 'export function executionSignature'], ['tests/eval-validity.test.mjs', 'execution does not depend on assumed wires'], ['docs/specs/DS016-evaluation-metrics.md', 'do not change execution equivalence']]},
    {text: 'Execution agreement over the suite worlds is not universal program equivalence; a world that does not discriminate two readings cannot tell them apart.', cites: [['eval/signature.mjs', 'This is not a proof of program equivalence'], [METRICS, 'Executed gold is ground truth only on the finite suite']]},
  ]},
  {id: 'metrics', title: 'Every metric', claims: [
    {text: 'computeMetrics in eval/metrics.mjs is the metric definition; it only projects evaluator records, adds no model judgment and no new gold. Fractions carry numerator and denominator, and a zero denominator yields value null, never success.', cites: [[METRICS, 'Metrics are projections of evaluate() records'], ['eval/contracts.mjs', 'value: denominator ? numerator / denominator : null'], ['docs/specs/DS016-evaluation-metrics.md', 'is the metric definition']]},
    {text: 'Runtime statuses are projected to decisions (ENTAILED, CONTRADICTED, CONFLICT, UNKNOWN, AMBIGUOUS, …) by epistemicResult; a conflict is never reported as supported or unknown.', cites: [['eval/contracts.mjs', 'export function epistemicResult'], ['eval/contracts.mjs', 'export const STATUS_DECISIONS']]},
  ]},
  {id: 'reference-free', title: 'Reference-free metrics and the unlabeled mode', claims: [
    {text: 'Reference-free metrics read only the message and the predicted SOP, so they apply to any message: parse, compile and contract validity, stated-value anchoring, polarity and question-form agreement, unclear/gibberish consistency, identifier-like tokens and the share of assumed wires. They reuse the corpus-audit checks on the prediction instead of the gold. They are plausibility checks, not correctness.', cites: [[FREE, 'export function referenceFreeRecord'], [FREE, 'export function referenceFreeMetrics'], ['tools/datasets/audit/vocabulary.mjs', 'export function modelTargetIdFindings'], ['docs/specs/DS016-evaluation-metrics.md', '## Reference-free metrics']]},
    {text: 'Two small detectors are defined for them: whether a message asks something, and whether it is gibberish (frequent EN/RO words, name evidence, keyboard runs and other non-word tokens; undecided messages are excluded from the unclear denominator).', cites: [[FREE, 'export function messageAsks'], [FREE, 'export function gibberishVerdict']]},
    {text: 'The unlabeled mode evaluates a file of messages with predictions and no gold: node eval/run.mjs --messages messages.jsonl --predictions predictions.jsonl --out report.json. Only the reference-free metrics and their slices are reported; nothing is executed.', cites: [[RUN, 'export async function evaluateUnlabeled'], [RUN, "if (args.messages)"], ['docs/specs/DS016-evaluation-metrics.md', '## Unlabeled mode']]},
  ]},
  {id: 'slices', title: 'Slices: question type, language, noise, family and the hard slice', claims: [
    {text: 'Every report groups its metrics by question type, language (en, ro, mixed for a labelled code switch; each further input language becomes its own slice), noise level, family and the hard slice. A row is hard when it is long (at least 20 words), has at least two stated wires in the gold, is code-switched or carries heavy noise.', cites: [[SLICES, 'export function sliceFields'], [SLICES, 'export function slices'], [METRICS, 'slices: slices(records'], [RUN, 'slices: slices(records'], ['docs/specs/DS016-evaluation-metrics.md', '## Slices']]},
  ]},
  {id: 'leakage', title: 'Template-level leakage', claims: [
    {text: 'Exact-message overlap is not enough: the corpus audit measures, for each sealed-test row, whether its masked input template, a near-duplicate message, an entity label head or its target skeleton already occurs in train/dev. High template overlap means a score measures template recall rather than language understanding, so a sealed-test result is reported together with its leakage.', cites: [['docs/specs/DS008-data-evaluation.md', 'template-level leakage between train/dev and the sealed test is an evaluation-validity metric'], ['tools/datasets/audit/leakage.mjs', 'export class SplitLeakage'], ['tools/datasets/audit/options.mjs', "id: 'leakage.template_overlap'"]]},
    {text: 'Current values are observations in eval/reports/current/corpus-audit/<corpus>.json (test_vs_development); each suite summary in this browser shows them live.', cites: [['docs/specs/DS008-data-evaluation.md', 'Current values are observations in']]},
  ]},
  {id: 'independent', title: 'The formalizer-ood-v1 out-of-distribution suite', claims: [
    {text: 'formalizer-ood-v1 is a test-only suite with two axes: held-out domains (cooking, repairs, gardening, choirs, lettings) whose predicates and relation phrases never occur in formalizer-v1, and held-out constructions of in-distribution predicates ("be on the payroll of", "reside in", "avea un post la", …). Both use only OOD-only and test-reserved lead-in frames, and whole question forms (EN tail, opinion and alternative questions; RO alternative and tail questions) are held out. It is synthetic and not human-reviewed.', cites: [['docs/specs/DS022-diversity-generator.md', '## Out-of-distribution suite'], ['tools/datasets/diversity/heldout.mjs', 'export const OOD_ONLY_FRAMES'], ['tools/datasets/diversity/domains.mjs', 'export const HELDOUT_CONSTRUCTIONS']]},
    {text: 'The builder drops every OOD row whose lead-in frames or constructions occur in formalizer-v1 train/dev, so the recorded frame and construction overlap is zero; the same overlap is reported for the formalizer-v1 test split, where it is not zero.', cites: [['tools/datasets/build-corpora.mjs', 'function overlapMetrics'], ['tools/datasets/build-corpora.mjs', 'const overlapReason'], ['tests/data/ood-holdout.test.mjs', 'OOD rows share no lead-in frame or construction']]},
  ]},
  {id: 'wild', title: 'The formalizer-wild-v1 independent suite', claims: [
    {text: 'formalizer-wild-v1 is an eval-only sealed suite of 796 messages written by eight independent writer agents (EN, RO and EN-RO code-switched, with real-looking noise), never by the generator. Every message was annotated twice and adjudicated; every accepted reading is in sop_targets_accepted, and language_gap marks golds that only approximate a construct DS021 lacks.', cites: [['docs/specs/DS016-evaluation-metrics.md', '## Independent wild suite'], ['tools/eval/wild-suite.mjs', 'export const SUITE']]},
    {text: 'It never feeds training or the generator: the boundary audit fails when a generator or training source names it or when a datasets/ split exists for it.', cites: [['eval/leakage.mjs', 'export const INDEPENDENT_SUITES'], ['eval/leakage.mjs', 'an independent eval-only suite must have no training or dev split']]},
    {text: 'Its rows carry no verification world, so they are not executed: predictions are scored against every accepted target (accepted_match, shape_match, decision_match, proposition and query F1) and with the reference-free metrics. The inter-annotator agreement (0.575 on the same program) is the ceiling to read scores against.', cites: [['tools/eval/wild-suite.mjs', 'export function scoreAgainstAccepted'], ['docs/specs/DS016-evaluation-metrics.md', '### Inter-annotator agreement']]},
  ]},
  {id: 'qualified', title: 'What a "qualified run" means', claims: [
    {text: 'Training is prohibited until the owner gives a new explicit approval; no preflight, qualification report or dataset check can supply it.', cites: [['AGENTS.md', 'The current user explicitly prohibits training'], ['docs/specs/DS010-experiment-preregistration.md', 'remain unauthorized without a new explicit user approval']]},
    {text: 'A qualified run is one that satisfies all of: a preregistered hypothesis and frozen metrics, denominators and thresholds before touching the holdout (DS010); a frozen, audited, rights-cleared dataset; a passing infrastructure preflight with an exclusive GPU owner; an approved, bounded run with a recorded identity; best checkpoint selected only on dev predictions scored by eval/run.mjs (execution equivalence first, syntax as tie-break); and a single evaluation of the selected checkpoint on the sealed test, reported with slices and leakage.', cites: [['docs/specs/DS010-experiment-preregistration.md', 'For each proposed experiment, register an immutable ID'], ['docs/specs/DS007-training.md', 'For the formalizer, `best` is selected using generated full-development-set predictions'], ['skills/training-runbook/SKILL.md', '## 5. Evaluate independently']]},
    {text: 'The promotion gates to freeze (not observations): parse validity ≥99%, EN and RO semantic correctness ≥90% each, hard negatives ≥95%, unsupported assertions ≤2% on UNKNOWN, zero isolation violations. Insufficient support means "not qualified".', cites: [['docs/specs/DS010-experiment-preregistration.md', 'parse validity **≥99%**']]},
  ]},
  {id: 'numbers', title: 'Historical and current numbers', claims: [
    {text: 'HISTORICAL: DS016 records a core-v2 gold-as-prediction sanity run (12/12 parse and execution equivalence) on a suite deleted with the 2026-09-28 regeneration. Predicting the gold reproduces the gold; it is not a model score.', cites: [['docs/specs/DS016-evaluation-metrics.md', '## Scope of the current sanity check']]},
    {text: 'CURRENT OBSERVATION: the registry baseline under eval/reports/current/registry-baseline/ is a deterministic gold-copy evaluator sanity check on formalizer-v1, not model accuracy. No real model has supplied dev or sealed-test predictions; the model registry manifest stays blocked.', cites: [['docs/specs/DS008-data-evaluation.md', 'The **only observed registry evaluation is the explicitly labeled non-model baseline']]},
    {text: 'eval/reports/history/ holds archived numbers from earlier generations; they are never presented as a current run.', cites: [['AGENTS.md', 'never present a historical number as a current run']]},
  ]},
];

/** The guide with every citation resolved against the current files. */
export function evaluationGuide(root = projectRoot) {
  const resolve = ([file, ...anchors]) => cite(root, file, ...anchors);
  return {
    sections: SECTIONS.map(section => ({...section, claims: section.claims.map(claim => ({text: claim.text, cites: claim.cites.map(resolve)}))})),
    metrics: METRIC_DEFINITIONS.map(metric => ({...metric, cite: cite(root, metric.source, metric.anchor)})),
  };
}
