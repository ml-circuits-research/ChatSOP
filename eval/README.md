# eval/ — bounded evaluation artifacts and suites

This directory owns evaluation code, sealed suites, and fresh reports. Nothing here trains a model, selects a checkpoint, or certifies model identity; a passing comparison on finite worlds is never universal semantic equivalence.

## Evaluation tracks (planned separation, not current suite labels)

The first priority is to establish whether a small NL-to-SOP formalizer reliably produces **simple** SOP from user language. Its track measures the model's own syntax and schema validity, semantic fidelity to the utterance, reference/entity selection, intended reads/writes and other effects, and errors including omissions, inventions, unjustified certainty, and appropriate abstention. Exclude `jsEval`, complex code, and coding-agent-authored programs from this model track. Use independently reviewed, held-out language and gold meaning; executing a symbolic gold SOP checks the reference/runtime, **not** the model. Finite-world agreement alone cannot certify that a prediction preserved meaning.

The separate full ChatSOP system track measures complete interactions: memory acquisition/retrieval and isolation, reasoning and proofs, approved procedures (including `jsEval` where a coding agent supplies the JavaScript), actual backend/fallback, temporal behavior, provenance, and end-to-end outcomes and latency. Future abstract wire types and approved algorithms, graph search, and collection/graph construction belong to reviewed knowledge/task instructions as needed; their presence in the system must not silently expand the small model's target language. A correct system answer does not by itself demonstrate model formalization fidelity, and a correct gold-program execution demonstrates neither.

**Current status:** `run.mjs` and the existing suites/report artifacts mix concerns; no separate track runner, suite partition, or two-track score is implemented. Do not relabel or reinterpret existing results as either track. After the simple SOP syntax and scope have been agreed, review and assign eligible cases to disjoint, independently qualified track suites, migrate evaluation/reporting, and retain old mixed reports under their original descriptions. Do not regenerate data or change parser/contracts to anticipate that agreement.

Future reports must identify track, syntax/capability version, suite/provenance and model or system configuration; state the number of eligible cases, attempted cases, missing/invalid outputs, abstentions, operational exclusions, and every metric's numerator and denominator. Small-model reports should separate all-eligible syntax/schema and semantic/effects/error rates from conditional rates on valid predictions, with language/family/source slices and representative failures. Whole-system reports should separately count end-to-end task successes/failures, memory and temporal/provenance errors, actual backend/fallback/skips, unauthorized effects, and stage/end-to-end latency; report per-slice denominators and controlled component comparisons. Never pool the two tracks into one accuracy figure or count a skipped backend as a pass.

## Layout

- `run.mjs` — the evaluator. Takes `--file <suite.jsonl>` plus either `--predictions <predictions.jsonl>` (one explicit `{id, sop}` row per suite row) or `--config <runtime.json>` (a configured formalizer endpoint). Reports parsing/runtime validity, canonical and execution agreement, UNKNOWN handling, paraphrase and hard-negative slices, and stage timings. Operational errors invalidate the report (`evaluation_valid: false`); a broken gold oracle is a reference failure, not a model error.
- `contracts.mjs` — machine-readable capability contracts used by the evaluator and `tools/capabilities.mjs`.
- `suites/core.mjs` — authored EN/RO suite: six case families, twelve rows, independent of generated templates. Not human-validated, not statistically sufficient. `node eval/suites/core.mjs --out <new-file.jsonl>` refuses to overwrite.
- `suites/query-v1/` — the sealed test split of the query curriculum (15 semantic cases / 49 rows), written by `tools/datasets/build-curriculum.mjs` and disjoint from `datasets/query-v1/`. Its manifest and `datasets/query-v1/manifest.json` must agree on version, template hash, and matrix; `tools/datasets/validate.mjs` enforces this.
- `suites/pilot-v1/` — the sealed test export of the historical pilot (105 rows), disjoint from `datasets/pilot-v1/`.
- `suites/source-reference-v2.jsonl` (+ `.provenance.json`) — sealed SQuAD v2 dev reference: 16 source-backed cases, 49 surfaces, CC-BY-SA-4.0 attribution, excluded from training and checkpoint selection. Validate with `node tools/datasets/validate.mjs --file eval/suites/source-reference-v2.jsonl --execute`.
- `verbalizer.mjs` — a limited verbalizer numeric guard; it does not certify paraphrase fidelity.
- `reports/current/` — fresh observed results (verification fingerprints, evaluator self-checks, review bundles, audit JSON). `reports/history/` — earlier-generation results; historical numbers are never presented as new runs.

## Rules

1. Sealed suites are read-only inputs for evaluation. Generators and checkpoint selection must not read their answers; the build pipeline writes them once and refuses overwrite.
2. Predictions are explicit artifacts. The evaluator never calls a generator to fill gaps, and a configured endpoint does not certify which model answered.
3. Reported metrics carry numerator/denominator, family/language/source slices, and exclusions; fallback routes are labeled as fallback, never as an executed external solver.
4. Reproduce checks with the private native solvers selected explicitly:
   `Z3_BIN="$PWD/tools/.solvers/z3/bin/z3" SWIPL_BIN="$PWD/tools/.solvers/swi/swipl" node tools/verify.mjs`.
