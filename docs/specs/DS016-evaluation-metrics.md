---
title: DS016-evaluation-metrics
summary: One definition per formalizer, epistemic, reasoning and memory metric over the existing evaluator.
---

# Evaluation metrics

## Reproduce

```sh
node --test tests/eval-metrics.test.mjs tests/eval-validity.test.mjs tests/eval-language.test.mjs
node tools/metrics/run.mjs --file eval/suites/formalizer-v1/test.jsonl --gold-as-prediction --out eval/reports/current/metrics
```

The second command uses **explicit gold SOP as prediction**, solely as a **gold-as-prediction sanity check**. It writes `evaluation.json` (the unmodified evaluator outcomes plus a run label) and `metrics.json` in the chosen output directory. **No neural model was evaluated in this run.** To score externally supplied SOP predictions instead, use `--predictions predictions.jsonl` in place of `--gold-as-prediction`. Every prediction row must have a unique suite `id` and a `sop` or `prediction` string; coverage must exactly match the suite. An optional `--config runtime.json` selects evaluator runtime policy. Neither a predictions file nor a model manifest establishes that neural inference actually occurred.

`computeMetrics(rows, report)` in `eval/metrics.mjs` is the metric definition; `tools/metrics/run.mjs` only supplies predictions and writes reports. Ground truth comes from **executing the gold circuit** via `evaluate` in `eval/run.mjs`, including the evaluator's independent reference checks. The `epistemicResult`, `fraction`, and `distribution` primitives come from `eval/contracts.mjs`. The suite's `expected` fields check the gold execution; they are not prediction scores. A failed reference is excluded from gold-dependent denominators and listed under `failure_ids_by_stage.reference`. Other stages are `generation` (predictor failed), `parse`, `prediction` (execution/guard failed), and `semantic` (executed but not equivalent). `semantic` is an outcome category rather than an exception. A correct UNKNOWN/clarification is **not** a failure. `fraction.value` is `null` if its denominator is zero; `distribution` reports `count: 0` and null quantiles when no samples exist. A zero denominator is never interpreted as success.

## Definitions

| Field | Numerator / denominator or reported quantity |
| --- | --- |
| `formalizer.parse_rate` | Syntactically parsed formalization predictions / formalization rows with valid gold. |
| `formalizer.canonical_ast_match` | Canonical parser outputs match / formalization rows with valid gold. |
| `propositions.proposition_recall`, `.proposition_precision` | Evaluator report (`eval/propositions.mjs`), model-language rows: gold `stated`/`assumed` propositions matched by identity (folded relation phrase, sorted folded role values, polarity, validity text) / gold propositions, respectively / predicted propositions. `basis` and `certainty` are not part of the identity. |
| `propositions.proposition_recall_tolerant`, `.proposition_precision_tolerant` | The same pairing, then, among the propositions left unpaired, a gold and a predicted proposition also pair when their skeletons are equal (role names, polarity, variables, `$id` targets) and every relation phrase and quoted value is the same by `Dictionary.sameMeaning(a, b, 'relation'\|'value')` (`sop/dictionary.mjs`); matched / gold, respectively / predicted. A normalized Romanian content word, its English equivalent and a dictionary synonym therefore match. `gold_unparsed` and `predicted_unparsed` count `unparsed` wires, which are never propositions. |
| `propositions.separation_accuracy` | Matched propositions whose wire type (`stated` or `assumed`) agrees / matched propositions; `stated_as_assumed` and `assumed_as_stated` count the two confusions ([DS021](specsLoader.html?spec=DS021-model-surface.md)). |
| `propositions.basis.coverage`, `.accuracy`, `.confusion` | Among labelled gold `assumed` wires matched by a predicted `assumed`: those whose prediction carries any `basis` / labelled (an omitted basis is uncovered, not wrong); exact agreement / covered; a gold × predicted count table. Reported separately; canonical match (`formalizer.canonical_ast_match`) compares programs with `basis` removed, and `basis` never changes execution. |
| `formalizer.execution_equivalence` | Equal evaluator execution signatures / formalization rows with valid gold; finite-case equivalence, not universal equivalence. |
| `formalizer.answer_correctness` | Equal answer tuples and equal projected epistemic decisions / formalization rows with valid gold. Outputs and memory state are instead covered by execution equivalence. |
| `formalizer.symbol_choice` | Equal executed query mode, predicate/argument patterns, and selected variables / formalization rows with a gold query. Not applicable to statement-only rows. |
| `formalizer.paraphrase_invariance` | Every member executes equivalently and yields an identical predicted signature / semantic cases with more than one valid-gold formalization row. Invalid predictions remain in these denominators. |
| `formalizer.hard_negative_discrimination` | Both sides individually execution-equivalent to distinct gold signatures / unique `negative_of` semantic-case pairs. |
| `formalizer.abstention` | Matching executed UNKNOWN or AMBIGUOUS decision **and** equivalent signature / gold UNKNOWN or AMBIGUOUS formalization rows. |
| `formalizer.en_to_ro_transfer` | Both English and Romanian members execution-equivalent / valid-gold formalization cases containing both languages. This is paired cross-language fixture success, not a trained-model transfer estimate. |
| `epistemic.unknown_calibration.recall` | Predicted UNKNOWN / valid-gold UNKNOWN rows; `false_unknown_rate` is predicted UNKNOWN / other valid-gold rows. These are discrete calibration diagnostics, **not** probability calibration (no confidence scores are supplied). |
| `epistemic.contradictions_preserved` | Predicted `CONFLICT` and equal conflicted answers / valid-gold conflict rows. The `both` runtime status maps to `CONFLICT`, never to supported or UNKNOWN. |
| `epistemic.over_inference` | Predicted decision other than UNKNOWN or CONFLICT / valid-gold UNKNOWN or CONFLICT rows. This counts unsupported certainty, not correct abstention. |
| `epistemic.provenance_presence` | Answer evidence points to proof entries, observed entries have source and quote, derived entries have a rule and present `from` IDs / executed rows with proof or answers. `provenance_recall` checks all gold observed proof IDs are cited by the prediction, over executed rows with gold proof. |
| `epistemic.retractions_preserved` | Equal `defeatedAssumptions` and equal session event signatures / valid-gold rows exposing nonempty defeated assumptions **or** a session retract event. This checks observed retraction signals, not undocumented deletion of historical repository data. |
| `epistemic.unauthorized_writes` | Successful predictions with claims/events beyond the allowed session state / executed rows. Formalization allows no session claim or event; system rows are compared against executed gold claims/events. Rejected write attempts are prediction-stage failures, not successful unauthorized writes. |
| `reasoning_memory.answer_soundness`, `.answer_coverage` | Intersection of predicted and gold answer tuples / predicted tuples (precision), respectively / gold tuples (recall). Empty evidence yields `null` rather than an invented success. |
| `reasoning_memory.proof_retrieval_precision`, `.proof_retrieval_recall` | Intersection of cited **observed claim IDs** in predicted and gold proof / predicted observed IDs, respectively / gold observed IDs. This is proof-evidence retrieval against the gold execution, not recall against all potentially relevant repository claims. |
| `reasoning_memory.retrieval_complete`, `.execution_complete` | All link-plan retrievals complete / executed rows with retrievals; complete packets / executed rows with boolean completion. Incompleteness is not silently promoted to success. |
| `reasoning_memory.budget_diagnostics` | Distributions of actual packet diagnostic memory probes, retrieved count, closure facts and rounds; no budget threshold is inferred where no configured threshold is reported. |
| `reasoning_memory.effective_routes`, `.retrieval_routes` | Executed packet operation/backend/fallback counts and requested → selected retrieval counts. A route is reported as observed, not inferred from requested configuration. |
| `reasoning_memory.latency_ms` | Evaluator-recorded model, setup, gold, prediction and total stage distributions, with samples and p50/p95/max. `sampled_peak_rss_bytes` is the evaluator's inter-case RSS sample maximum. `cuda_peak_bytes` is `not measured`; neither metric is a continuous process/GPU peak. |

## Equivalence tolerance

A message often has more than one reasonable formalization, and one gold per row would count the others as errors. The evaluator therefore reports these comparisons separately (`eval/run.mjs` `evaluate`, `eval/metrics.mjs` `formalizer.*`):

| Field | Definition |
| --- | --- |
| `formalizer.canonical_ast_match` (`metrics.canonical_match`) | The canonical parse of the prediction, with `basis` removed, equals the canonical parse of ANY accepted gold / formalization rows with valid gold. |
| `formalizer.canonical_ast_match_tolerant` (`metrics.canonical_match_tolerant`) | Canonically equal to an accepted gold, or: for some accepted gold, every wire of the prediction pairs with a gold wire and back under the id-free wire items of "Wire F1" with relation phrases and quoted values compared by `Dictionary.sameMeaning`, `unparsed` wires pair by their strict keys, and no predicted wire is unparsable / formalization rows with valid gold. Wire ids and wire order do not matter here. |
| `formalizer.execution_equivalence` (`metrics.execution_equivalence`, strict) | The prediction's execution signature (`eval/signature.mjs`) equals the signature of ANY accepted gold, with the host dictionary disabled (runtime policy `dictionary: false`) for every gold and for the prediction, so relation phrases link only as the row world declares them / formalization rows with valid gold. |
| `formalizer.execution_equivalence_tolerant` | Strictly equivalent, or: the prediction executed again with the host dictionary enabled (runtime policy `dictionary: true`, as production links: a relation phrase or value that does not link is retried with its dictionary translations and synonyms) against the row world whose predicate declarations are extended with the evaluation-only relation synonyms has the strict signature of an accepted gold / formalization rows with valid gold. A prediction whose content words are normalized Romanian, English, mixed, or a listed synonym is tolerant-correct when it otherwise matches. |
| `formalizer.canonical_ast_match_primary`, `.execution_equivalence_primary` | The same comparisons against `sop_target` alone, for continuity with single-gold reports. |

**Accepted golds.** A row may carry `sop_targets_accepted: [SOP, …]` next to its primary `sop_target` (owner decision Q-DATA-5): a genuinely ambiguous phrasing is formalized with every plausible reading ([DS021](specsLoader.html?spec=DS021-model-surface.md), [DS022](specsLoader.html?spec=DS022-diversity-generator.md)). Every accepted gold is parsed, admitted and executed in its own session of the same world; the primary gold alone is checked against the row's stored `expected` result. A failing accepted gold is a reference failure.

**The dictionary.** `sop/dictionary.mjs` (sources under `config/dictionary/`) maps Romanian lemmas and forms, English phrases and their synonyms to one entry; it is loaded once per process (`defaultDictionary()`). The strict score turns it off, the tolerant score turns it on, and the tolerant proposition, wire and canonical comparisons use its `sameMeaning(a, b, kind)` with `kind` `relation` or `value`. The same dictionary serves production linking and evaluation, so the tolerant score measures what the host would accept, and a Romanian word the dictionary does not know stays a miss.

**Relation synonyms.** The strict comparison links relation phrases against the phrases the verification world declares, which the generator derived from its own constructions. For the tolerant comparison only, `eval/synonyms.mjs` adds, as English aliases of the row world's predicate blocks, the phrases listed in `eval/relation-synonyms.json` ({predicate id: {en: [phrases]}}; a converse orientation is `<id>__converse`) and in a row's optional `verification.relation_synonyms`. What the synonym list adds is exactly this: the same program with a relation phrase that the list declares for the same predicate orientation (the dictionary adds its own translations and synonyms, as in production). Role names, polarity, values, entity resolution, time normalization, query shape and every other linking step are unchanged, and golds are never re-linked. A synonym that the row world already declares for a different predicate is dropped for that row (`synonym_conflicts` on the record), so a synonym can never redirect or make ambiguous a phrase the world already knows. Production linking (`config/ontology.sop`, `server/`, `sop/`) never reads the synonym list.

**`assumed` wires do not change execution equivalence.** Under the default host policy (`modelAssumptions: report`) an `assumed` wire is linked only for the report: it never enters the executed circuit, never blocks the turn, and the execution signature contains no model-assumption report, so a prediction that adds or omits an `assumed` wire keeps the gold's signature (`tests/eval-validity.test.mjs`). `basis` is removed before canonical comparison. Two admission limits still make assumptions matter: more than `maxModelAssumptions` (8) assumptions, or an assumption that repeats a statement of the same message, makes the program invalid (a prediction-stage failure), not merely different.

**Host-normalized score (owner answers to Q-SYM-1 and Q-SYM-2 of 2026-09-29).** Beside the strict score, and never instead of it, an evaluation may report the same scorer applied after the host frame normalization of `sop/frames.mjs` (DS021 "Host frame normalization": relation synonyms, single-oblique role relabeling, relation/object boundary shift, quoted times) has rewritten the prediction; on the wild suite, which has no world, the accepted golds are normalized too. It is always labelled `host-normalized`, reports its frame-list digest, and states the normalization gain (normalized minus strict, paired). The strict score keeps every boundary and role-name miss visible (Q-SYM-1). First use: `eval-ud-rules-v14-v1` (`tools/research/ud-rules-v14.mjs`, `eval/reports/history/ud-rules-v14/results.json`).

## Clean-English formalization score (primary, owner decision 2026-09-30)

By owner decision of 2026-09-30 (journaled), the primary formalization score is `execution_equivalent` (strict) and its host-normalized companion, measured on the **clean-English partition** only (`tools/datasets/clean-english.mjs`, [DS008](specsLoader.html?spec=DS008-data-evaluation.md) "Clean-English partition"): `eval/suites/clean-english/test.jsonl` for the sealed number, `datasets_archive/clean-english/dev.jsonl` for development. Romanian, mixed-language and noisy/garbled-English rows are excluded from this primary number, not because they are unimportant, but because they measure a different, separately owned problem (the `textToCleanEnglish` chat-UI service, experiment `text-to-clean-english-v1`) that the formalizer's parser and rules cannot fix by construction. The full-English number (clean_en + noisy_en of the same suites) is always reported beside the clean-English number, so a reader sees how much of the full-suite gap is input noise rather than a parser/rules defect on valid English (experiment `eval-clean-english-v1`, `eval/reports/current/clean-english/`). This does not replace `formalizer.execution_equivalence` reported on `formalizer-v1`/`formalizer-ood-v1`/`formalizer-wild-v1` (still the full, mixed-language reference for those suites); it is the number to read when triaging "justified problems" in the parser or the UD-to-SOP rules, per the same `execution_equivalent`/`execution_equivalent_tolerant`/host-normalized definitions above, with `formalizer-wild-v1` rows (no verification world) scored by `tools/eval/wild-suite.mjs` `scoreAgainstAccepted` exactly as they already are outside this partition.

The clean-English strict score pools two scorers: `formalizer-v1` and `formalizer-ood-v1` rows by `evaluate()` execution equivalence, and `formalizer-wild-v1` rows (no verification world) by `scoreAgainstAccepted` acceptance against every accepted gold. It is reported overall, per suite and per question type, always with the suite split beside it, because the wild suite scores far lower than the other two. The reports of `ud-rules-v14` used a different mixture (test, OOD and wild sampled 240/180/180, wild scored by D1-tolerant all-proposition F1 = 1), so an overall number is comparable across reports only after reweighting to the same suite mix.

## Wire F1

`formalizer.wire_match` (`eval/metrics.mjs` `wireMetrics`, `compareWires`) gives partial credit where execution equivalence gives none. Execution equivalence compares one signature for the whole program, so a long message whose gold has dozens of wires fails on any single wrong wire; wire F1 shows how much of such a program is right. It is an additional diagnostic reported beside the execution metrics, never a replacement for them, and never a selection or promotion criterion on its own.

1. **Keys.** Every wire becomes an order- and id-free item (`eval/propositions.mjs` `wireItems`): a skeleton, the quoted strings it holds (slots, each a relation phrase or a value) and a strict key (the skeleton with each slot folded: case, diacritics, whitespace).
   - A `stated` or `assumed` wire is its kind, relation phrase, role names (sorted) with their values, polarity, validity and link lines; `certainty`, `speaker` and `basis` are ignored.
   - Any other wire (`query`, `constraint`, `unclear`, `unparsed`) is its kind plus its fields in written order, `basis` dropped; the quoted string after `relation` is a relation slot, every other quoted string a value slot.
   - `?variables` are renamed by first appearance inside each wire, including a placeholder in a `stated` wire.
   - Wire ids never matter. A `$id` role value (a proposition argument, or `$q` query chaining) is keyed as the referenced wire's own item, recursively; a link line (`because $s2`, `if $s3`, …) is the pair (keyword, the target's item), and a wire's links are sorted by keyword and target skeleton; `near $s1` is keyed the same way. An unknown target or a reference cycle falls back to the wire ids renamed by first appearance in the program. So `@s1`/`@a`/`@q2` names do not matter, while a link to a different clause, or another keyword, is a different key.
2. **Matching.** Gold and prediction items are matched as multisets, strictly by equal keys. The tolerant variant then pairs, among the items left over (greedily, in gold order), a gold and a predicted item with equal skeletons whose slots are pairwise the same by `Dictionary.sameMeaning`; a tolerant count is never below the strict one. `unparsed` wires take no part in the matching: they are counted apart (`unparsed_wires` predicted, `gold_unparsed_wires`). The gold is the primary `sop_target` or any accepted gold, whichever gives the highest strict F1. The prediction is parsed wire by wire, so a truncated or partly malformed output still earns credit for its well-formed wires; an unparsable wire (or non-SOP text) counts as one predicted, unmatched wire. A missing prediction has no wires.
3. **Reported values.** Micro `precision`, `recall` and `f1` over all non-`unparsed` wires; `mean_row_f1`; `rows_f1_at_least_0_9` (rows whose wire F1 is at least 0.9 / formalization rows); the same micro values for `statements` (stated/assumed) and `problems` (query/constraint); `problems_correct` (rows whose query/constraint wires match the gold exactly, with no extra ones / rows whose gold has at least one); `unparsable_wires`; `tolerant` (micro precision, recall and F1 of the tolerant matching) and `mean_row_f1_tolerant`; `understood` and `understood_tolerant` (below); `unparsed_wires`, `gold_unparsed_wires` and `gold_wires_excluded_by_unparsed`. The block is reported by `computeMetrics` (`formalizer.wire_match`) and by `evaluate` (`wire_match`); slices report it per group like every other formalizer metric.

## Honest partial formalization

A prediction may mark a part of the message it could not formalize as an `unparsed` wire with a verbatim `span` ([DS021](specsLoader.html?spec=DS021-model-surface.md)); the host repairs or asks about the span instead of acting on a guess. These metrics reward that honesty and make invention visible.

| Field | Definition |
| --- | --- |
| `reference_free.invented_values` | Per row and summed: role values and reported speakers of `stated` wires that are NOT anchored in the message, by exactly the anchoring test of `stated_value_anchoring` (placeholders `?x` and `$id` values are not values). Reference-free. |
| `reference_free.marked_unparsed` | Per row and summed: `unparsed` spans found verbatim in the message, up to case, diacritics and whitespace (`verbatimIn`). `unparsed_spans` counts all spans; a span not in the message is a defect. Reference-free. |
| `reference_free.honesty_ratio` | marked / (marked + invented). Per row: `null` when both are 0. Aggregated: summed marked / (summed marked + summed invented), a `fraction` whose value is `null` on a zero denominator. Reference-free. |
| `reference_free.invented_value_rate` | Invented values / all stated values (the complement of `stated_value_anchoring`); per row `null` without stated values. `rows_with_unparsed` is parsed predictions with at least one `unparsed` wire / parsed predictions. Reference-free. |
| `wire_match.understood.precision` | Matched predicted wires / predicted non-`unparsed` wires (unparsable ones included), micro over rows. |
| `wire_match.understood.recall` | Matched gold wires that are not excluded / gold wires that are not excluded, micro over rows. A gold wire is excluded when one of its quoted values (value slots, including those of referenced wires) folded is contained in the folded span of a predicted `unparsed` wire. |
| `wire_match.understood.f1` | Harmonic mean of the two ("understood F1"): credit for the parts the prediction claims to have understood, with no penalty for a gold wire the prediction honestly marked as not understood, and full penalty for a guessed one. Per row (`compareWires(...).understood`), a row with no gold and no predicted wire scores 1. `understood_tolerant` is the same over the tolerant matching. |

`tools/research/long-message-diagnosis.mjs` applies the same comparison to the `long_message` family and writes `eval/reports/current/long-messages/diagnosis.json`.

## Reference-free metrics

`eval/reference-free.mjs` checks a PREDICTED program against the message alone, so the checks apply to any message, labelled or not. They reuse the corpus-audit logic that the audit applies to gold targets ([DS020](specsLoader.html?spec=DS020-corpus-audit-tool.md)) and the host's own admission. Each evaluator record carries `reference_free` (per-row flags and defect messages); `reference_free` in the evaluator report and in `computeMetrics` aggregates them. These are plausibility checks: passing them does not make a prediction correct, failing them marks a defect.

| Field | Definition (source) |
| --- | --- |
| `parse_validity` | Predictions that parse (`sop/parser.mjs` `parse`) / rows. |
| `compile_validity` | Predictions admitted by `checkModelProgram` and compiled by `compileDeclarative` without a lexicon (structure, not linking) / rows. |
| `contract_vocabulary` | Parsed predictions with no failing contract finding of `checkProgram` (wire types, fields, enumerated values, model-authorable types, cardinality; `tools/datasets/audit/vocabulary.mjs`) / rows. |
| `stated_value_anchoring` | `stated` role values and reported speakers found in the message / all such values. Found means `mentionedIn` (typo- and inflection-tolerant), or, for a canonical-English translation of a common noun, a surface of the same entity in the host lexicon (`mentionedThroughLexicon`) or the generator's EN↔RO lexicon (`tools/datasets/audit/translation.mjs`). `rows_fully_anchored` counts rows whose stated values are all found. |
| `polarity_agreement` | Rows where the message has an EN/RO negation or omission cue (`hasNegationCue`, `hasOmissionCue`, `tools/datasets/audit/text.mjs`) exactly when a `stated` or query proposition is negated or lexically negative / parsed non-`unclear` predictions. `unsupported_negation` (negation without a cue) and `missed_negation` (a cue without negation; also produced by hedges such as "I'm not sure" and positive-bias particles such as "nu cumva") split the disagreements. `assumed` wires are excluded: closure negatives are model additions by definition. |
| `question_form_agreement` | Rows where the message asks (a question mark, an interrogative sentence start, or a request such as "tell me", "check", "whether", "dacă", matched with one typo from five letters; `messageAsks`) exactly when the prediction has a `query` or `constraint` / parsed non-`unclear` predictions. `missing_query` and `spurious_query` split the disagreements; heavy typing noise on the cue words produces some `spurious_query`. |
| `unclear_gibberish_agreement` | Rows where the prediction is `unclear kind gibberish` exactly when the gibberish detector says `gibberish` / rows the detector decides (`gibberishVerdict`: frequent EN/RO words, name evidence, non-word tokens such as keyboard runs, repeated letters and vowel-less tokens; `uncertain` rows are excluded). `gibberish_missed` and `gibberish_on_intelligible` split the disagreements. |
| `id_like_tokens` | Parsed predictions with a quoted value that looks like an identifier or counter, or a retired construct (`modelTargetIdFindings`) / parsed predictions. |
| `invented_values`, `marked_unparsed`, `honesty_ratio`, `invented_value_rate`, `rows_with_unparsed` | See "Honest partial formalization" above. |
| `assumed_wire_share`, `rows_with_assumed` | `assumed` wires / `stated` + `assumed` wires; parsed predictions with at least one `assumed` wire / parsed predictions. Descriptive: model additions are allowed, a high share is a signal to inspect. |

Detector calibration (observation, 2026-09-28): on the gold targets of `formalizer-v1` dev, the gibberish detector agrees with the gold `unclear` labels on 99.96% of decided rows, question-form agreement is about 98% and polarity agreement about 97%; the remaining gold disagreements are the heuristic limits listed above. Current values belong in `eval/reports/current/`, not here.

## Unlabeled mode

`node eval/run.mjs --messages messages.jsonl --predictions predictions.jsonl --out report.json` (or `--config runtime.json` for an endpoint) evaluates a message file with no gold: each row is `{id, message}` (or `question`), optionally with `language`, `code_switch` and `noise_level` for slicing. Only the reference-free metrics and their slices are computed (`evaluateUnlabeled`, report format `chatsop-unlabeled-evaluation-v1`); nothing is executed, because there is no verification world, and stated-value anchoring uses the host ontology (`config/ontology.sop`, or `config.ontology`) plus the generator's EN↔RO lexicon. Correctness is not measured in this mode.

## Slices

Every report groups its metrics by slice (`eval/slices.mjs`): `evaluate` reports `slices` with the evaluator metrics and the reference-free block per group, `computeMetrics` reports `slices` with the `formalizer`, `epistemic` and `reference_free` blocks per group, and the unlabeled mode reports the reference-free block per group. The slices are `by_question_type`, `by_language_slice` (`en`, `ro`, `mixed` for a labelled code switch; each further input language becomes its own slice, so a new language is evaluated separately from the languages already covered, [DS021](specsLoader.html?spec=DS021-model-surface.md) "Input languages and content words"), `by_noise_slice` (`clean`, `light`, `medium`, `heavy`), `by_family`, `by_hard_slice` and `by_hard_reason`. A row is hard when it is long (at least 20 whitespace-separated words, about the longest tenth of formalizer-v1 test), multi-statement (at least two `stated` wires in the gold; an unlabeled message: at least three sentences), code-switched, or heavily noisy (`heavy`). A group of zero rows is reported as `{rows: 0}`.

## Independent wild suite

`eval/suites/formalizer-wild-v1/` is an eval-only sealed suite. It measures whether a formalizer handles text that no generator wrote. The generated corpora (DS022) measure whether it learned the generator's constructions; this suite asks the different question.

### How it was produced

1. **Messages.** Eight independent writer agents wrote 796 messages: 341 EN, 293 RO and 162 EN-RO code-switched. Each writer had a distinct persona:
   - EN consumers;
   - EN professionals using medical, legal and finance jargon;
   - EN tech teams;
   - RO regional and older speakers, often dictating;
   - young urban RO speakers using slang and SMS forms;
   - formal and administrative RO;
   - Romglish and the diaspora;
   - structurally hard cases (non-native English, dictation, context-dependent follow-ups, quantifiers, comparatives, ordering, arithmetic).

   The writers saw only a list of 34 message phenomena (`gaps` on each row). They never saw the generator, the corpora or the repository.
2. **Annotation.** Two independent annotators formalized every message under DS021 and a fixed annotation guide. The guide adds conventions C1–C12, derived from a 150-message pilot (`eval/reports/current/data-expansion-proposal.md`), for choices DS021 leaves open. Output was canonical English, per the DS021 of that date (superseded by owner decision D1 of 2026-09-29; the suite's targets are converted or regenerated to the current language, and the tolerant scores accept either language).
3. **Adjudication.** An adjudicator chose or merged the final gold and recorded:
   - every defensible reading in `sop_targets_accepted` (1,885 targets; 615 rows accept more than one);
   - the decision (agreed, annotator 1, annotator 2, merged or new);
   - the disagreement categories;
   - the rule at issue;
   - a `language_gap` when the gold only approximates a construct DS021 lacks (503 rows).
4. **Validation.** Every gold and accepted target passes:
   - the parser;
   - model-wire admission and a compile without a lexicon;
   - the vocabulary check;
   - the English anchoring guard. For Romanian and mixed rows, a translated value cannot anchor literally, so it is reported and not failed.

   The suite also passes `tools/datasets/no-copy.mjs`: 0 shared distinctive 4-grams, 0 shared 8-grams, and one identifier finding, the product name "Log4j", reviewed and kept.
5. **Assembly and checks.** `node tools/eval/wild-suite.mjs --assemble <work-dir>` builds the suite and `--check` re-validates it in place. Each row keeps both annotations, the adjudication and the agreement flags as evaluation-only fields. `question` is the only model input.

### Independence from training

- **Superseded on 2026-09-30 (owner decision, AGENTS.md rule 9).** The only generalization tested is the same sentence form with different words, and the forms of this suite are learning material: its rows are re-split by split group across train, dev and test of the three datasets (`tools/eval/legacy-resplit.mjs`, 70/15/15, fixed seed), `INDEPENDENT_SUITES` in `eval/leakage.mjs` is empty, and `eval/suites/formalizer-wild-v1/` stays as archive and provenance and is no longer reported as a suite. The boundary audit still fails if a generator or training source reads an `eval/suites/**` test file. The description of the suite below is historical.
- Earlier rule (historical): the boundary audit failed if any generator or training source named the suite, and no generator family could be designed from its rows.

### Scoring

The rows have no verification world, so they are not executed. `scoring.mode` records this for every row. Predictions (`{id, sop}`) are scored in two ways:

1. **Against every accepted target:** `node tools/eval/wild-suite.mjs --score predictions.jsonl --out report.json`. The best match counts. The report gives:
   - `accepted_match`: same program after folding case and accents, renaming variables and ignoring `basis`;
   - `accepted_match_tolerant`: `accepted_match`, or the same wire types and `unclear` kind with every wire paired both ways under the id-free wire items of "Wire F1" (certainty and speaker included) when relation phrases and quoted values are compared by `Dictionary.sameMeaning`; `unparsed` wires take no part;
   - `accepted_match_without_assumed`;
   - `shape_match`: same wire types, roles, polarity and query modes, with relation words and values ignored;
   - `decision_match`: query, constraint, statements only, or the `unclear` kind;
   - proposition F1 and query-block F1.

   Scores are sliced by language, by gap, and by whether the gold approximates a missing construct.
2. **Reference-free:** `node eval/run.mjs --messages … --predictions …` (unlabeled mode). The suite's open vocabulary is not in the generator's EN↔RO lexicon, so `stated_value_anchoring` under-credits translated Romanian values there. The gold itself anchors at 0.64.

### Inter-annotator agreement

These figures were observed on 2026-09-28, annotator 1 against annotator 2 over 796 rows. They are the ceiling to read model scores against. They measure how well-defined the language is on real text, not model quality.

| Measure | Value |
| --- | --- |
| Same program, either annotator's alternative readings accepted | 0.575 |
| Same preferred program | 0.461 |
| Same shape | 0.681 |
| Same multiset of wire types | 0.863 |
| Same top-level decision | 0.987 |
| `unclear` kind identical | 0.927 (123 rows) |
| `stated` proposition F1 (shape F1) | 0.57 (0.79) |
| Query-block F1 (shape F1) | 0.54 (0.80) |

The 150-message pilot, annotated without conventions C1–C12, agreed on the same program at 0.43.

**Where annotators agree most and least** (same program, accepted readings):

| Phenomenon | Agreement |
| --- | --- |
| Context-dependent ellipsis | 1.00 |
| Non-requests | 0.94 |
| Definitions | 0.85 |
| Controls | 0.76 |
| Attribute values | 0.70 |
| Many statements | 0.31 |
| Advice | 0.22 |
| Modality | 0.20 |
| Long messages | 0.02 |

**By language:** EN 0.67, RO 0.53, mixed 0.45.

Scoring each annotator against the adjudicated accepted set gives 0.96 and 0.88 on `accepted_match`. That number is optimistic, because the accepted set includes the annotators' own alternatives. The inter-annotator figure is the honest ceiling.

The suite is model-written and not human-reviewed. Its figures are observations and belong in `eval/reports/current/` when recomputed.

## Composed metrics

The composed suites ([DS008](specsLoader.html?spec=DS008-data-evaluation.md) "Length and composed evaluation suites") are scored by `tools/eval/composed-score.mjs`. Every rate is reported with its numerator, denominator and a Wilson 95% interval, by number of sentences (or mix), in nested stratified stages (100, 300, full) that can be stopped by the preregistered rules. There is no claim about forms the system was not built on; the metrics check that known forms still pass when there are many and when they are mixed with forms that need a rewrite.

**SymbolicLM alone (K1, K3, K5).** The paragraph is analysed as one message; every component is analysed alone (cached by text).

* `sop_exact`: the paragraph SOP equals the concatenation of the components' stored SOPs. Blocks are compared after the same canonicalization on both sides: ids renamed by position, `$id` references following their block, and the statements-before-queries order SymbolicLM emits (`tools/eval/composed/sop-canon.mjs`).
* `sop_vs_alone`: the paragraph SOP equals the concatenation of what SymbolicLM gives each component alone now.
* `components_ok`: the share of components whose blocks are right in the paragraph.
* `analysis_equal` and `sentence_split_ok`: every sentence gets the same tokens, heads and labels as when analysed alone, and no sentence is cut or merged.
* `components_alone_ok`: every component alone still equals its stored SOP. The **composition effect** is `sop_exact` over the cases whose components all pass alone: a loss there is a cross-sentence effect, not a component regression. Losses are classified (`tools/eval/composed/diagnose.mjs`): `sentence_boundary`, `unparsed_in_context`, `temporal_leak` (a time frame spread to another sentence), `link_changed`, `block_count`, `content_changed`.
* K5 alone component for the reference sentence is its named twin; `named_paragraph_exact` separates a substitution problem from a reference-resolution problem.

**A rewriter (K2, K3, K4, K5).** The rewriter's output is aligned with the expected components in order (`tools/eval/composed/align.mjs`): a component is `preserved` (untouched as required), `repaired` (rewritten to its verified target), `broken` (a sentence that had to stay untouched changed), `not_repaired` (came back unchanged), `wrong_rewrite` (changed to something else) or `dropped`; text between components is `added`. Reported: clean sentences changed (denominator: clean components), bad sentences fixed, untouched and wrongly rewritten (denominator: components that must change), dropped components, cases with added text, cases with the order preserved, exact cases, and the end-to-end SOP equality after SymbolicLM on the output against the concatenated expected SOPs (stored, else SymbolicLM on the expected text). In per-sentence mode also: the gate recall (sentences that need a rewrite and were sent), the clean sentences wrongly sent, the number of rewriter calls, and **splitter agreement**: the host splitter's units equal the units of the components alone (reported apart for cases whose components all end in punctuation and for cases with an unpunctuated component). Token length strata come from the sidecar of `tools/eval/composed-tokens.mjs`. Rows scored by the identity rewriter ("no rewrite") show what SymbolicLM does on the original.

**Decomposition (K6).** Output sentence count equal to, or at least, the expected count; every output sentence within the contract of [DS021](specsLoader.html?spec=DS021-model-surface.md) "Limited English for SymbolicLM" (at most one finite clause apart from connective-linked and complement clauses, no coordinated or relative clause, no elided subject; from the SymbolicLM analysis of the sentence); SymbolicLM handles every output sentence alone; names, numbers, negations and connectives of the message are preserved (only those the verified target keeps); the SOP equals the gold where one exists.

## Analysis comparison (validated 2026-10-01, not adopted as a judge)

`lib/languages-util/analysis-compare.mjs` (features in `analysis-features.mjs`, synonyms in `synonyms.mjs`) compares two English texts by their SymbolicLM grammatical analyses (`compareAnalyses(a, b, {textA, textB})`; the CLI `tools/eval/analysis-compare.mjs` takes a `{id, a, b}` pairs file, parses every distinct text once with the configured Stanza package, CPU by default, and writes one verdict per pair). No LLM, about 0.1 ms per pair after the parse. The verdict is `equivalent`, `different` or `uncertain` with reasons.

- **Core checks** (any failure gives `different`): the set of proper names (a name the other text only has in lower case is the same name); the numbers and date words, also from the raw text because SymbolicLM masks lead-ins such as "As of 3 October 2025," before parsing; negation per shared predicate and overall; the quantifier classes (all, every, most, some/any, no/none, at least, not all, only, ...); the question type (wh-word class with `what reason` as why and `which town` as where, yes/no, not a question; polite requests are not questions); the logical subject and object of shared predicates (a passive subject counts as object, the agent as subject, so voice is normalised and only reported in `voiceChange`); names attached elsewhere or swapped between clauses or sentences; the strong connectives (or, although, unless, before, after, until, if).
- **Soft checks** (a failure gives `uncertain`): a different sentence count, a different set of main predicate lemmas (equal under WordNet 3.0 or dictionary synonyms is reported; with `synonymPolicy: accept` it is equivalent), content words, prepositions, pronouns, tense and modality, focus words (also, only), because/but, answer words (`Yes,`), no predicate at all, and a dependency-triple F1 below 0.6 (head lemma, logical relation, dependent lemma; punctuation, determiners, auxiliaries and fillers ignored).
- **Validation** (preregistration `status/preregistrations/eval-analysis-compare-v1.json`; deviations D1 and D2 recorded; reports under `eval/reports/current/analysis-compare/`): on the meaning-judge calibration set v2 (clean view: positives without typos, mechanical negatives from their clean origin) `different` catches 98.7% [95.5, 99.7] of the mechanical changes (negation, name replacement, number, quantifier and question type 100% each; name swap 91%), but 11.6% [8.1, 16.5] of the positives are also called `different` (16.3% with typo-laden inputs) and 65% are `uncertain`; `equivalent` has 89.7% precision over all labelled items. Against the two-vote LLM judge on 1,120 decisive bad_english pairs: `equivalent` precision 98.6% [95.1, 99.6], 13% of all pairs (34% of the pairs the judge accepts) skippable, `different` recall of judge rejections 83%; on the 700 backgen pairs `equivalent` precision is only 48%, because the judges reject a dropped politeness tail ("do you know?") that the metric ignores by design. The decision rule (at least 90% of mechanical changes with at most 10% false alarms, or at least 50% of items skipped at 98% precision) is **not met**, so the metric is not part of the default proofing evaluation and does not replace the LLM meaning judge.
- **Small models** (inference only, CPU, 4 threads, batch 1, isolated `~/semsim-venv`; thresholds tuned on the tune half; `tools/eval/semsim-evaluate.mjs`): bidirectional NLI (`nli-moritz`: 8.7% error on the bad_english pairs, 13.5% on the calibration test half; 116 ms and 184 M parameters; `nli-small` 65 ms, `nli-base` 125 ms) is the best standalone choice but its error is too high to drop the judge; paraphrase and STS cross-encoders and the embedding cosines (MiniLM 8.5 ms, bge 17 ms) miss most mechanical changes (under 21% for the cosines). The best cascade, symbolic `equivalent`, else `nli-base` above the tuned threshold, reaches 98.1% [95.1, 99.2] precision on 18% of all bad_english pairs.
- **Optional cascade** (not a metric, a cost filter for a proofing evaluation): identical text and the cheap symbolic gates first, then `equivalent` of this comparison accepts the pair, and the LLM meaning judge reads only `different` and `uncertain` pairs (and, for policy, dropped politeness tails). On the 600-unit sealed sample of `language-proofing-gemma270m-it1` (output against reference target) 73% of the pairs are identical, 7% more are `equivalent`, and 20% still need the judge; the numbers are in `eval/reports/current/analysis-compare/proofing-it1/summary.md`. Nothing here removes the LLM judge: about 87% of the judged bad_english pairs still reach it (82% with the NLI stage).

## SymbolicProofingLLM evaluation: analysis layer, local first (2026-10-01)

The SymbolicProofingLLM is evaluated one layer at a time: the grammatical analysis and the meaning first, the SOP translation only as a secondary column. Inputs are cut by the host splitter and every sentence is sent to the model (the chat's `sendAll`); the outputs are joined (`tools/eval/symbolic-proofing-eval.mjs generate --units true`, composed suites with `--gate all`). Each analysis metric is reported two ways: **(a) local only**, a sentence is analysis-correct when the Stanza default and accurate trees are identical (`AnalysisLayer.localPass`, no LLM; a disagreement means "not certified", not "wrong"), and **(b) with judges**, the calibrated dataset gate on top (identical trees AND the DeepSeek parse judge conditions a and c good; the judge is applied only to identical-tree sentences, so it can only remove). **Meaning kept** means the output is unchanged, equals the verified target text, or passes the hard mechanical checks (names, numbers, negation, non-empty) AND either the local analysis comparison (this section's predecessor, "Analysis comparison") says `equivalent` or the two-vote DeepSeek judge says yes; only the residue is sent to DeepSeek (`meaning-prepare`, `composed-meaning-prepare`; `remeaning` re-applies the rule to stored scores). Identity metrics are local by nature: the analysis signature (non-punctuation tokens with part of speech, relation and head word per sentence) and the text of the output equal those of the input. Reported with Wilson intervals and paired bootstrap differences; the share of items that needed DeepSeek and its cost (`tools/eval/symbolic-proofing-cost.mjs`) are part of the report. A repair that only makes the two trees agree is not yet a correct analysis in about a quarter of the cases, so (a) is an upper bound of (b).

## Graded severity (S0–S4, NONE)

Pass/fail hides how wrong a wrong answer is. Since the owner direction of 2026-10-01 (good enough, not perfect: users rephrase, as with a person or a large LLM) every rewrite (input text to output text) and every interpretation (message to SymbolicLM SOP against gold) can be graded on a small scale. The two things that matter are no catastrophic interpretation (understanding the opposite, a swapped role, a wrong entity, a flipped negation) and never "no interpretation" when a clear one exists; a somewhat-off reading is acceptable.

| level | meaning |
| --- | --- |
| S0 | equivalent |
| S1 | nuance lost: a mild hedge, politeness or lead-in dropped, a small tense or aspect detail, a focus word (also, even) that does not change truth |
| S2 | partial: one of several requests or facts missing, one modifier or constraint dropped (also `only`); noticeable, not misleading |
| S3 | wrong but noticeable: wrong question type, a wrong but plausible relation, tense or modality changed, and/or changed, garbled wording, a question left unasked |
| S4 | CATASTROPHIC: negation or polarity flipped, subject/object or other role swapped, a wrong or invented entity, name, number or date, a quantifier flipped (all/some/none/not all), an opposite relation, a condition, supposition, reported claim or question turned into an asserted fact, a cause reversed or invented, invented content |
| NONE | no interpretation: empty, unparsed, failed |

Headline numbers: the share good enough (S0+S1+S2), the catastrophic rate S4 and the NONE rate, each with a Wilson 95% interval. They are reported next to, never instead of, the strict pass/fail metrics.

**Grader (a cascade, `lib/severity/`).** (1) Mechanical text checks (`mechanical.mjs`: names, numbers, negation, quantifiers, question word and kind, conditional and reported markers, invented cause, effect and cause exchanged around `because`, an invented sentence): a certain S4 flag decides. (2) The analysis comparison above (`analysis-map.mjs`): `equivalent` is S0; its S4 flags (polarity, role swap, name or number added) are hints, not decisions, because the parse of a text with typos produces false alarms (calibration: 21 false S4 of 72 decisions). (3) An LLM severity judge (`judge-prompt.mjs`, version `severity-judge-v1`, omp task folders under `datasets_sources/`: Grok `xai-oauth/grok-4.20-0309-non-reasoning` and GLM `zai/glm-5.3-flash`) on the residue only. Both judges are run; the **upper** estimate takes the worse verdict of the two (high S4 recall), the **lower** estimate the milder one (both must say S4); the true catastrophic rate lies between them. The same recipe applies when the reference is a verified English target (LanguageProofingLLM: the original is Romanian or mixed, so the English-only layers compare the output with the target).

**Interpretation severity** (`sop-compare.mjs`): the SOP is reduced to propositions and query shapes (`programShape`), aligned by shared literals and relation words, and every difference is graded: role order, wire ids and active/passive form are no difference; polarity, a swapped subject/object, a different entity or number, a supposition or question turned into a statement, a lost `if`/`unless` link and a quantifier change are S4; a wrong relation, query mode or select is S3; a dropped modifier, constraint or proposition S2; wording, preposition and certainty weakening S1. A strict gold match (execution equivalence) is S0 by the existing oracle; a program that does not parse or is empty is NONE. On strict-match rows the comparer itself calls S4 in 0.1% of the cases (convention noise: S2 or S3 in 8%).

**Calibration** (`tools/eval/severity-calibration.mjs`, report `eval/reports/current/severity/calibration.md`): the 702 items of the meaning-judge calibration v2 (`eval/reports/current/meaning-judge/v2/labels.jsonl`) with this mapping: positives S0; `flip_negation`, `swap_names`, `replace_name`, `change_number_date`, `change_quantifier` and `add_fact` S4; `change_question_type` S3; `drop_fact` S2 (S3 when the only question or the key constraint is dropped); `change_connective` S3 for and/or and S4 for if/because; `change_preposition` S4 for before/after and to/from reversals, S3 for garbled prepositions; `change_relation` S4 for reversed relations and S3 otherwise; the 105 hand-written hard negatives and every case-by-case item carry a hand-assigned severity (`eval/severity/calibration-hand.json`). Targets: S4 recall of at least 95%, a low false-S4 rate; a false S4 on a gold S3 item is a neighbouring-level disagreement, a false S4 on a gold S0–S2 item is a hard false alarm and is reported separately.

Preregistration `status/preregistrations/eval-graded-severity-v1.json`.

## Decomposition and detectability (owner direction 2026-10-01)

Tangled sentences (more than one finite clause, several questions, a run-on or a list) are the hardest input of SymbolicLM and the hardest job of SymbolicProofingLLM. The evaluation of that job follows two owner rules. **The analysis never fails completely**: it always returns what it understood. **The hunt is for catastrophic defects and meaning changes**, not for every lost nuance: losing some indications or even some facts is tolerable, as in a conversation with a person or a large LLM, provided the failure is detectable and intelligible, because the interface shows what was understood (the interpretation CNL) and can ask for clarification. The failures that count are the ones hard to overlook: a silent meaning change, a flipped role or negation, invented content, and a dropped question or request that the user would not notice in the "I understood" summary.

**Detectability is an explicit dimension.** Per case the grader looks at the interpretation the chat shows (`lib/symbolic-lm/interpretation.mjs`) for the text the analysis finally used. The interpretation **marks** a failure when it contains a not-represented span, a sentence shown as `uncertain` (or empty), or, for the partial-acceptance rule of [DS021](specsLoader.html?spec=DS021-model-surface.md) "Partial acceptance of a decomposition", a leftover unit. A certification that did not hold (the default and accurate trees differ) is not a marker by itself. The summary `S` is what the user is told: the CNL of every verified sentence and the original wording of a sentence shown as uncertain (`tools/eval/decomposition/metrics.mjs` `understoodText`). Its severity against the message the user wrote is graded with the cascade above (mechanical, analysis comparison, Grok and GLM; upper and lower estimates).

| quantity | definition |
| --- | --- |
| catastrophic rate | share of cases whose summary is S4 (upper and lower estimate); split into marked and silent S4 |
| failure | S3 or S4 (S3 includes a dropped or changed question) |
| detectable failure | a failure while the interpretation marks something |
| **silent meaning change** | a failure with no marker; the primary quantity, reported with the S4 share of it |
| acceptable | good enough (S0 to S2) or a detectable failure; its complement is the silent meaning change rate |
| certified per sentence | share of the sentences of the final text whose default and accurate Stanza trees are identical (and the share of cases with every sentence certified) |
| sentence counts | output sentences against the expected decomposition: mean, equals expected, at least the expected; share of cases decomposed |
| rewrite severity | severity of the rewritten text itself against the message (a diagnostic of the rewrite layer; the primary severity is that of the summary) |

The marker is deliberately coarse: it says that something is flagged, not that the flag covers the lost fact; a finer span-level detectability (the flagged span contains the dropped clause) is a planned refinement. The baselines are arms over one sealed set: no rewrite, SymbolicProofingLLM sent every unit, sent through the gate and the certified acceptance, and the partial-acceptance proposal.

**The decomposition set** (`eval/suites/decomposition/test.jsonl`, about 300 cases, experiment `eval-decomposition-v1`, preregistration `status/preregistrations/eval-decomposition-v1.json`, tool `tools/eval/decomposition-score.mjs`, report `eval/reports/current/decomposition/summary.md`) replaces K6 (16 cases, [DS008](specsLoader.html?spec=DS008-data-evaluation.md) "Length and composed evaluation suites") as the decomposition measure. Sources: tangled clean-English rows of the sealed `neuro_english` test (the analysis gate failed), typed from the stored analysis (`tools/eval/decomposition/tangle.mjs`: coordination, subordinate, relative, completive, multi_question, run_on, list), and, for the rare types, DeepSeek tangled paraphrases of groups of sealed `symbolic_english` TEST sentences. Every expected decomposition is short sentences with explicit subjects and connectives kept, **certified by SymbolicLM** (identical default and accurate trees on every sentence) and **meaning-checked** by the two-vote judge (Grok first, GLM second; both S0 or S1). The set is sealed: it is read by the leakage auditors, and no training or selection code reads it.

## Natural input and the stability check (owner request 2026-10-01)

**Natural input.** `datasets/natural` (DS008 "The natural collection") is the realism evaluation set: the owner's own messages. `tools/eval/natural-score.mjs` runs the chat pipeline on CPU (textToCleanEnglish with LanguageProofingLLM, SymbolicLM accurate analysis, the gated SymbolicProofingLLM rewrite, the interpretation) and reports per layer: mechanical retention of numbers, names and negation by the cleaning step; judged severity of the clean English and of "I understood" against the ORIGINAL message (the lib/severity judge prompts, Grok first and GLM second, no local layer because the originals are mostly Romanian); certified sentences and messages; not-represented spans; breakdown by message length (under 15, 15 to 40, over 40 words). Where the two judges disagree on S3 or S4 the case is reported as excusable ambiguity, apart from the firm failures. It is a realism check, not a gate. Report: `eval/reports/current/natural/summary.md`.

**Incremental stability.** `tools/eval/stability.mjs` appends one sentence at a time to a long message (owner messages after cleaning and long rows of the decomposition suite), analyses every prefix with SymbolicLM and records, for each earlier sentence, whether its UD tree or the SOP wires attributed to it changed; the instability rate is the share of earlier sentences that changed against the analysis of the sentence alone, with the cause (segmentation, Stanza context effects, rules, coreference). Report: `eval/reports/current/stability/summary.md`.

## Planned metrics (not computed by the evaluator)

These still-valid measurement requirements come from the archived evaluation chapters and are not implemented yet: a formalizer error taxonomy (omitted versus invented facts, wrong entity versus wrong query, wrong time versus wrong negation, justified clarification versus excess abstention); checking every intent on several worlds, including counterexample worlds; a tiny-budget run that must yield `incomplete`, where no timeout ever becomes a negative answer; a verbalizer review that checks entities, polarity, intervals, uncertainty and hypothetical status, never a regular-expression "truth" score; an energy measurement per answer; and the frozen engineering goals of zero unauthorized writes under adversarial tests and zero identities assumed from an ambiguous name. Adding one means implementing it in the evaluator and defining it in the table above.

## Scope of the current sanity check

HISTORICAL (the core-v2 suite was deleted with the regeneration of 2026-09-28, DS022): the observed core-v2 sanity run had 12 valid references and 12 executed predictions. Formalization parsing and execution equivalence were 12/12; UNKNOWN recall and abstention were 6/6; soundness and answer coverage were each 6/6. The suite did not exercise gold conflict or exposed retractions (each denominator 0); the separate conflict regression executes a `both` case from the existing query suite. The recorded effective route was `deduce/js/no-fallback` for 12 executions. These numbers are **not model quality scores**; predicting the gold target is expected to reproduce the gold execution.
