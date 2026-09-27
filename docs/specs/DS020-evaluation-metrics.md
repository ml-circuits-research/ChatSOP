# DS020 — Evaluation metrics

## Reproduce

```sh
node --test tests/eval-metrics.test.mjs
node tools/metrics/run.mjs --file eval/suites/core-v2.jsonl --gold-as-prediction --out eval/reports/current/metrics
```

The second command uses **explicit gold SOP as prediction**, solely as a **gold-as-prediction sanity check**. It writes `evaluation.json` (the unmodified evaluator outcomes plus a run label) and `metrics.json` in the chosen output directory. **No neural model was evaluated in this run.** To score externally supplied SOP predictions instead, use `--predictions predictions.jsonl` in place of `--gold-as-prediction`. Every prediction row must have a unique suite `id` and a `sop` or `prediction` string; coverage must exactly match the suite. An optional `--config runtime.json` selects evaluator runtime policy. Neither a predictions file nor a model manifest establishes that neural inference actually occurred.

`computeMetrics(rows, report)` in `eval/metrics.mjs` is the metric definition; `tools/metrics/run.mjs` only supplies predictions and writes reports. Ground truth comes from **executing the gold circuit** via `evaluate` in `eval/run.mjs`, including the evaluator's independent reference checks. The `epistemicResult`, `fraction`, and `distribution` primitives come from `eval/contracts.mjs`. The suite's `expected` fields check the gold execution; they are not prediction scores. A failed reference is excluded from gold-dependent denominators and listed under `failure_ids_by_stage.reference`. Other stages are `generation` (predictor failed), `parse`, `prediction` (execution/guard failed), and `semantic` (executed but not equivalent). `semantic` is an outcome category rather than an exception. A correct UNKNOWN/clarification is **not** a failure. `fraction.value` is `null` if its denominator is zero; `distribution` reports `count: 0` and null quantiles when no samples exist. A zero denominator is never interpreted as success.

## Definitions

| Field | Numerator / denominator or reported quantity |
| --- | --- |
| `formalizer.parse_rate` | Syntactically parsed formalization predictions / formalization rows with valid gold. |
| `formalizer.canonical_ast_match` | Canonical parser outputs match / formalization rows with valid gold. |
| `formalizer.execution_equivalence` | Equal evaluator execution signatures / formalization rows with valid gold; finite-case equivalence, not universal equivalence. |
| `formalizer.answer_correctness` | Equal answer tuples and equal projected epistemic decisions / formalization rows with valid gold. Outputs and memory state are instead covered by execution equivalence. |
| `formalizer.symbol_choice` | Equal executed query mode, predicate/argument patterns, and selected variables / formalization rows with a gold query. Not applicable to premise-only rows. |
| `formalizer.paraphrase_invariance` | Every member executes equivalently and yields an identical predicted signature / semantic cases with more than one valid-gold formalization row. Invalid predictions remain in these denominators. |
| `formalizer.hard_negative_discrimination` | Both sides individually execution-equivalent to distinct gold signatures / unique `negative_of` semantic-case pairs. |
| `formalizer.abstention` | Matching executed UNKNOWN or AMBIGUOUS decision **and** equivalent signature / gold UNKNOWN or AMBIGUOUS formalization rows. |
| `formalizer.en_to_ro_transfer` | Both English and Romanian members execution-equivalent / valid-gold formalization cases containing both languages. This is paired cross-language fixture success, not a trained-model transfer estimate. |
| `epistemic.unknown_calibration.recall` | Predicted UNKNOWN / valid-gold UNKNOWN rows; `false_unknown_rate` is predicted UNKNOWN / other valid-gold rows. These are discrete calibration diagnostics, **not** probability calibration (no confidence scores are supplied). |
| `epistemic.contradictions_preserved` | Predicted `CONFLICT` and equal conflicted answers / valid-gold conflict rows. The `both` runtime status maps to `CONFLICT`, never to supported or UNKNOWN. |
| `epistemic.over_inference` | Predicted decision other than UNKNOWN or CONFLICT / valid-gold UNKNOWN or CONFLICT rows. This counts unsupported certainty, not correct abstention. |
| `epistemic.provenance_presence` | Answer evidence points to proof entries, observed entries have source and quote, derived entries have a rule and present premise IDs / executed rows with proof or answers. `provenance_recall` checks all gold observed proof IDs are cited by the prediction, over executed rows with gold proof. |
| `epistemic.retractions_preserved` | Equal `defeatedAssumptions` and equal session event signatures / valid-gold rows exposing nonempty defeated assumptions **or** a session retract event. This checks observed retraction signals, not undocumented deletion of historical repository data. |
| `epistemic.unauthorized_writes` | Successful predictions with claims/events beyond the allowed session state / executed rows. Formalization allows no session claim or event; system rows are compared against executed gold claims/events. Rejected write attempts are prediction-stage failures, not successful unauthorized writes. |
| `reasoning_memory.answer_soundness`, `.answer_coverage` | Intersection of predicted and gold answer tuples / predicted tuples (precision), respectively / gold tuples (recall). Empty evidence yields `null` rather than an invented success. |
| `reasoning_memory.proof_retrieval_precision`, `.proof_retrieval_recall` | Intersection of cited **observed claim IDs** in predicted and gold proof / predicted observed IDs, respectively / gold observed IDs. This is proof-evidence retrieval against the gold execution, not recall against all potentially relevant repository claims. |
| `reasoning_memory.retrieval_complete`, `.execution_complete` | All link-plan retrievals complete / executed rows with retrievals; complete packets / executed rows with boolean completion. Incompleteness is not silently promoted to success. |
| `reasoning_memory.budget_diagnostics` | Distributions of actual packet diagnostic memory probes, retrieved count, closure facts and rounds; no budget threshold is inferred where no configured threshold is reported. |
| `reasoning_memory.effective_routes`, `.retrieval_routes` | Executed packet operation/backend/fallback counts and requested → selected retrieval counts. A route is reported as observed, not inferred from requested configuration. |
| `reasoning_memory.latency_ms` | Evaluator-recorded model, setup, gold, prediction and total stage distributions, with samples and p50/p95/max. `sampled_peak_rss_bytes` is the evaluator's inter-case RSS sample maximum. `cuda_peak_bytes` is `not measured`; neither metric is a continuous process/GPU peak. |

## Scope of the current sanity check

The observed core-v2 sanity run had 12 valid references and 12 executed predictions. Formalization parsing and execution equivalence were 12/12; UNKNOWN recall and abstention were 6/6; soundness and answer coverage were each 6/6. The suite did not exercise gold conflict or exposed retractions (each denominator 0); the separate conflict regression executes a `both` case from the existing query suite. The recorded effective route was `deduce/js/no-fallback` for 12 executions. These numbers are **not model quality scores**; predicting the gold target is expected to reproduce the gold execution.
