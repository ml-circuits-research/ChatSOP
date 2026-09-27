# eval/ — bounded evaluation artifacts and suites

This directory owns evaluation code, sealed suites, and fresh reports. Nothing here trains a model, selects a checkpoint, or certifies model identity; a passing comparison on finite worlds is never universal semantic equivalence.

## Evaluation tracks

The `formalization` track measures model-authored `premise`, `query`, and `constraint` declarations: syntax/schema validity, semantic fidelity, conditional premises, reference/entity selection, omissions, inventions and certainty. `premise` is an attributed, temporary interpretation of user input, not an observed fact or session write. The host compiles declarations into inspectable retrieval/solve circuitry and generates `clarify` only for unresolved identity or required scalar inputs. Do not ask the small model to choose `remember`, `pack`, `resolve`, `solve`, or `cnl` steps. Exclude `jsEval`, complex code and coding-agent programs from model targets. Use independently reviewed held-out language and gold meaning; executing a symbolic gold circuit tests the host/runtime, not the model.

The separate `system` track measures complete trusted circuits: memory acquisition/retrieval and isolation, reasoning and proofs, approved procedures (including `jsEval` where a coding agent supplies the JavaScript), actual backend/fallback, temporal behavior, provenance, and end-to-end outcomes and latency. New system-only examples and their `system/*.jsonl` exports cannot be passed to the model endpoint. A correct system answer does not by itself demonstrate model formalization fidelity, and a correct gold-program execution demonstrates neither.

**Legacy status:** Previously generated suites/reports contain mixed executable-circuit targets and measurements; do not relabel historical scores as declarative-model scores. Atom grammar is now whitespace-only and the explicit session recording wire is `remember`. Rebuild active derived suites from their authorship sources before treating them as executable, while retaining historical measured artifacts under their original provenance. Dataset migration alone does not authorize model training.

Future reports must identify track, syntax/capability version, suite/provenance and model or system configuration; state the number of eligible cases, attempted cases, missing/invalid outputs, abstentions, operational exclusions, and every metric's numerator and denominator. Small-model reports should separate all-eligible syntax/schema and semantic/effects/error rates from conditional rates on valid predictions, with language/family/source slices and representative failures. Whole-system reports should separately count end-to-end task successes/failures, memory and temporal/provenance errors, actual backend/fallback/skips, unauthorized effects, and stage/end-to-end latency; report per-slice denominators and controlled component comparisons. Never pool the two tracks into one accuracy figure or count a skipped backend as a pass.

## Layout

- `run.mjs` — track-aware evaluator. Takes `--file <suite.jsonl>` plus either `--predictions <predictions.jsonl>` (one explicit `{id, sop}` row per eligible formalization case) or `--config <runtime.json>` (a configured formalizer endpoint). Model output is declarative and compiled by the host; system cases use trusted circuits and are ineligible for a model endpoint. Reports parsing/runtime validity, canonical and execution agreement, UNKNOWN handling, paraphrase and hard-negative slices, and stage timings. Operational errors invalidate the report (`evaluation_valid: false`); a broken gold oracle is a reference failure, not a model error.
- `contracts.mjs` — machine-readable capability contracts used by the evaluator and `tools/capabilities.mjs`.
- `suites/core.mjs` — authored EN/RO suite: six case families, twelve rows, independent of generated templates. Not human-validated, not statistically sufficient. `node eval/suites/core.mjs --out <new-file.jsonl>` refuses to overwrite.
- `suites/core-v2.jsonl` — the current revision-2 export of that authored suite in whitespace-atom syntax, executed by `tools/verify.mjs`. `suites/core-v1.jsonl` is the superseded pre-cutover export and is retained as historical evidence only.
- `suites/query-v1/` — the sealed test split of the query curriculum (15 semantic cases / 49 rows), written by `tools/datasets/build-curriculum.mjs` and disjoint from `datasets/query-v1/`. Its manifest and `datasets/query-v1/manifest.json` must agree on version, template hash, and matrix; `tools/datasets/validate.mjs` enforces this.
- `suites/pilot-v1/` — the sealed test export of the historical pilot (105 rows), disjoint from `datasets/pilot-v1/`.
- `suites/source-reference-v2.jsonl` (+ `.provenance.json`) — sealed historical SQuAD v2 dev reference: 16 source-backed cases, 49 surfaces, CC-BY-SA-4.0 attribution, excluded from training/checkpoint selection. Its old SOP syntax and hash records are historical, not an active post-cutover suite; regenerate a fresh suite and independently computed provenance from `suites/source-reference.mjs` into a new path before executing it.
- `suites/source-reference-v2-cutover.jsonl` (+ `.provenance.json`) — the current declarative-only derivative with whitespace atoms and newly computed provenance; exercised by `tools/verify.mjs`, still test-only and excluded from training/checkpoint selection.
- `verbalizer.mjs` — a limited verbalizer numeric guard; it does not certify paraphrase fidelity.
- `reports/current/` — fresh observed results (verification fingerprints, evaluator self-checks, review bundles, audit JSON). `reports/history/` — earlier-generation results; historical numbers are never presented as new runs.
- `registry/manifest.json` — declared dev/selection and sealed-test cells, with explicit prediction artifact paths; it does not assert that predictions or a model run exist. `tools/eval/registry.mjs` audits the boundary before evaluation, then executes all dev cells before sealed test cells and refuses to index an incomplete matrix. It reuses `run.mjs` metrics and `contracts.mjs` fractions/distributions; the registry defines no metrics.

## Registry and leakage boundary

Run `node tools/eval/registry.mjs audit` before `node tools/eval/registry.mjs run`; the audit writes `reports/current/registry/leakage.json` even when blocked, and a blocked audit exits nonzero. Supply one `{id,sop}` prediction per suite row under the paths declared in `registry/manifest.json`, then rerun the audit. The registry never fills in predictions with gold answers. `node tools/eval/registry.mjs index` checks every declared cell and its input/report fingerprints before writing `reports/current/registry/index.json`; absent predictions, invalid reports, or missing cells stop final indexing. Use separate report directories for independent experiments.

The authoritative **sealed evaluation** exports live under `eval/suites/`. Dataset-local `test.jsonl` files in `datasets/seed/` and `datasets/generated/` are local execution corpora used for validation/verifier checks, not selection or training inputs; `datasets/splits/` may contain only manifests/checksums. The executable source guard inspects generator reads/imports and training/selection code: `training/cli.mjs` uses `['train','dev']` for train, preflight and token audit; Python training/audit use train/dev and semantic checkpoint selection evaluates `formalizer/dev.jsonl`. The audit records the observed split lists and local corpus paths; static source inspection does not prove semantic non-overlap or guard against arbitrary computed/external IO.


## Rules

1. Sealed suite exports are read-only evaluation inputs. Generators and checkpoint selection must not read their answers; dataset-local execution test corpora are not the sealed evaluation authority.
2. Predictions are explicit artifacts. The evaluator never calls a generator to fill gaps, and a configured endpoint does not certify which model answered.
3. Reported metrics carry numerator/denominator, family/language/source slices, and exclusions; fallback routes are labeled as fallback, never as an executed external solver.
4. Reproduce checks with the private native solvers selected explicitly:
   `Z3_BIN="$PWD/tools/.solvers/z3/bin/z3" SWIPL_BIN="$PWD/tools/.solvers/swi/swipl" node tools/verify.mjs`.
