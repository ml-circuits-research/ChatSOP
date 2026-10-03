# Formalization experiments of 2026-10-02/03 (archived 2026-10-03)

**Date:** 2026-10-03. **Decision:** the owner. **Status:** history only; nothing here runs in the product, in `npm test` or in an evaluation.

## Why it was archived

The owner decided on 2026-10-03 to rebuild the formalization infrastructure on a new architecture:

- the proxy tier `tiny` at the edges (normalize, plan, verbalize);
- a structure model (PSM, GLiNER-like) that outputs schema JSON;
- a logic formalizer model (LFM, T5 NL→FOL) that outputs FOL;
- deterministic converters from PSM JSON and FOL to SOP-IR and then SOP Lang;
- the existing engines.

The research harnesses of the two nights before that decision tried other routes to the same goal: a 4B model formalizing book problems. They are no longer on the path. The product's current step-by-step formalizer stays in place until the new pipeline is at least as good (see "What stayed").

## The documents

These documents stay in `experiments/proposal/`, because preregistrations and experiment records cite them. Each one now opens with an archived note.

| Document | What it records |
| --- | --- |
| `experiments/proposal/six-paths-results.md` | the six-paths experiment: design, per-path numbers, run lengths, symbolic answer equivalence, error correlation, what worked, what did not |
| `experiments/proposal/formalization-machine-phase1.md` | the method library (phase 1 on `good`), phase 2 (`tiny` as the frame-filler), the method tree as an N-way candidate |
| `experiments/proposal/semantic-decomposition-protocol.md` | the stage-A semantic decomposition design (registry N0, goals N1, type N2, slots N3, assembly N4) |
| `experiments/proposal/formalization-research-directions.md` | the ranked variants (dual formalization, N-way B, F1 exemplars, obligations C, cross-family verification) and the failure thresholds |

The experiment records are `status/experiments.json` (`eval-semantic-decomposition-v1`, `eval-formalization-machine-v1`, `dual-formalization-v1`). The preregistrations are `status/preregistrations/eval-six-paths-v1.json`, `eval-formalization-machine-v1.json` and `eval-semantic-decomposition-v1.json`. Run folders were under `state/` (gitignored and regenerable).

## What each part was, and its final numbers

### Six paths (`tools/eval/six-paths/`, `config/knowledge/formalizer-six-paths-v1/`)

An offline harness. It formalized the same book problems along six independent routes, plus a direct-answer route:

- A, method templates;
- B, a `name = expression` program;
- C, equations solved by deterministic algebra;
- D, backward goal regression;
- E, controlled English;
- F, analogy to verified programs;
- Z, the model answers directly.

An answer was accepted when two routes agreed on the executed result and on 3 perturbations of the problem's numbers. The question texts were data in the research layer `formalizer-six-paths-v1` (`chat: false`). The experiment was stopped on 2026-10-03 after four rounds.

- **Batches on `tiny`** (199 scorable problems), correct alone: B 41%, C 18%, A 9%, D 7%, E 3%, F 1%. At least one path was correct on about 57% of problems.
- **Verification on `tiny`:** 2-of-N verified only 14 of 199 problems, at about 88% precision in batch 1.
- **On `small`** (dev1, 15 scorable problems): 9 of 15 verified, precision 8 of 9.
- **Rounds on `tiny`:** stop-at-5-failures run lengths were 5, 8, 5, 5. The generic fixes between rounds did not lengthen the runs. Cumulatively, `tiny` alone solved 5 of 39.
- **Z (direct answer) on `tiny`:** 46% on the round problems.

The symbolic answer-equivalence catalog decided 17 of the 38 calibration pairs, all correctly. The model tier for free text produced false positives, so it was never used. The run state was `state/six-paths/`.

### Method library (`tools/eval/method-library/`, `config/knowledge/formalizer-methods-v1/`)

The formalization machine. A library of 40 domain-independent METHODs, 17 goal types and 7 primitive interpreters, kept as `fp_` facts. A model filled a goal tree, and the machine executed it node by node.

- **Phase 1** (frame-filler `good`, 300 book problems):
  - dev: SOLVED 101 of 153 (66.0%);
  - held-out: SOLVED 83 of 147 (56.5%, Wilson 48.4 to 64.2), WRONG 24 (16.3%). Rescored with clock rendering: 84 SOLVED, 23 WRONG;
  - MISSING_METHOD made up 12.5% of failures;
  - fully executed formalizations were correct in 83 of 115 cases.

  Verdict: inconclusive (not invalidated, not supported). Cost about 5.2 USD.
- **Phase 2 stage 1** (30 held-out problems), SOLVED: `good` 18, `tiny` writing the whole tree 4, `tiny` filling `good`'s skeleton 6. Stage 2 was not run, because the gap was decisive.
- **Node-by-node filling** (`nodewise.mjs`; closed questions one node at a time, escalating `tiny` → `small` → `good`), SOLVED of 30: free 1, with `good`'s goals 2, with `good`'s skeleton 4. Slot values found: 13 to 45 of `good`'s 128. Closed questions node by node gave no gain.
- **`candidate.mjs`** exposed a method tree as a third candidate in N-way agreement (see dual formalization).

### Stage-A semantic decomposition (`lib/query-author/step-by-step/decompose.mjs`, `config/knowledge/formalizer-protocol-v1/0070-decomposition.sop`)

A branch of problem mode with five steps:

1. a registry of the numbers;
2. goals with a closed kind;
3. a type per goal (chain, check, batch, choose, breakeven);
4. the type's slot questions, answered by registry index;
5. assembly with the problem-mode writer.

No problem kind was routed to it by default (`fp_decompose_kind` had no facts). Only `CHATSOP_PROBLEM_PROTOCOL=decompose` forced it, for the evaluation `eval-semantic-decomposition-v1`.

- **Stage 1** (50 fresh book problems), on `tiny`: 17 correct, 14 wrong, 19 unknown. The classic questions on `tiny` (control) gave 12, 12, 26.
- **After two validator fixes,** replayed with no model call: tree on `tiny` 19 of 50, classic on `tiny` 17 of 50, tree on `good` 19 of 50. The paired difference between tree and classic was +0.04 (95% interval −0.10 to 0.18).
- **Thresholds:** two failure thresholds of the research-directions document were hit (type agreement 52%; clarify plus unclear 38%).

The branch was not admitted. With it, the product loses the `CHATSOP_PROBLEM_PROTOCOL` switch; `problemCircuit` always asks the classic value and formula questions, which is what it did by default before.

### Dual formalization and its verifiers (`tools/eval/formalization-regression/expression.mjs`, `lib/formalize/verifier.mjs`, `lib/formalize/obligations.mjs`)

The expression path was compared with the step-by-step question tree and cross-checked by perturbation agreement. The tool's commands were `sample`, `run`, `nway`, `f1`, `index`, `obligations`, `verify`, `verify-tiny` and `replay`.

- **`obligations.mjs`:** the semantic obligations of variant C (asked parts, kinds, signs, coverage, one targeted question).
- **`verifier.mjs`:** the cross-family verifier and the tiny-only verifier.

Final numbers (experiment `dual-formalization-v1`):

- **Dual, 99 problems:** expression 54, tree 57. They agreed on 36, of which 35 were correct (97%). Disagreement flagged 30 of the 31 wrong tree answers.
- **N-way B, 60 problems:** selected 33 at 70% precision, no gain over the best single path.
- **F1 exemplars, 60 problems:** `tiny` went from 26 to 32 (paired +0.10, interval 0.03 to 0.18, 0 lost); adopted with leave-one-out.
- **Obligations C, 100 problems:** 10 wrong, abstention precision 92%, clarification recovered 3 of 37.
- **N-way B2** (`tiny`+F1, tree, `medium`): selected 31 of 60 at 82% precision.
- **Cross-family verifier, 100 fresh problems:** verified 42 at precision 40 of 42 (95%). Re-asking on the next tier recovered 7 of 32. Total cost 1.08 USD.
- **With the method tree as a third candidate:** verified 50 at 92% precision.

### Tests moved with the code (`tests/`)

| Archived test | What it covered |
| --- | --- |
| `tests/six-paths.test.mjs` | the six-paths readers, C's algebra, E's parser, F's templates, A's logic reader, the decision and acceptance rules, the scorer |
| `tests/method-library.test.mjs` | the library check, the machine, the composed calculation, the primitives, the scorer |
| `tests/expression-dual-tooling.test.mjs` | split from `tests/expression-program.test.mjs`: strict scoring, recording replay, obligations, the cross-family and tiny-only verifiers |
| `tests/formalization-offline-decomposition.test.mjs`, `tests/fixtures/formalization-offline/decomposition-cases.json` | split from `tests/formalization-offline.test.mjs` and its fixture: the stage-A replay cases and the filtered type menu |

## What stayed in the product, and why

| Kept path | Why |
| --- | --- |
| `lib/query-author/step-by-step/` (without `decompose.mjs`), `lib/formalize/internal-reasoning/`, `lib/formalize/strategies.mjs`, `lib/formalize/protocol-data.mjs`, `config/knowledge/formalizer-protocol-v1/` (without `0070-decomposition.sop`), `config/knowledge/formalizer-learned-v1/` | the product's step-by-step formalizer (LocalLLMStepByStep, InternalReasoningStepByStep) and the protocol layers they read; the chat depends on them until the new pipeline is at least as good |
| `lib/formalize/registry.mjs` | the number and thing registry (v1..vn, e1..ek), used by the expression path and reusable by the converters |
| `lib/formalize/equivalence.mjs` (with `tests/answer-equivalence.test.mjs`) | the symbolic answer-equivalence catalog |
| `lib/formalize/dual-check.mjs` | perturbation agreement (`crossCheck`, `selectByAgreement`) |
| `lib/formalize/expression-program.mjs` | the expression path: reader, static analysis, and the AST lowering to SOP `compute`, reusable by the compiler; problem mode uses it behind `queryParser.local.expression` (default off) |
| `lib/formalize/exemplars.mjs` | **kept because `expression-program.mjs` imports it** (F1 exemplar retrieval by registry shape); the index file is local (`datasets_sources/formalization-regression/exemplars/index.jsonl`) and is read only if present. Its builder (`expression.mjs index`) is archived here |
| `lib/formalize/replay-cache.mjs` | the record/replay cache of the regression and the strategies |
| `tools/eval/formalization-regression/` (without `expression.mjs`) | the offline per-step regression (`offline.mjs`) and its runner (`run.mjs`, `cases.mjs`, `gate.mjs`, `compare.mjs`, `build.mjs`, `wake.mjs`); `sample-stage.mjs` now imports `extractNumbers` from `lib/formalize/registry.mjs` |
| `tests/expression-program.test.mjs` | the tests of the kept expression path, dual-check and exemplars; the small engine executor they need is now inline in the test, no longer imported from the archived `expression.mjs` |
| `tools/capabilities/`, `LLMAPIProvider/`, `LLMJobs/`, `reasoning/` | the capability battery, the proxy, the job runner and the engines |

Two parts named in section 12 of `six-paths-results.md` as reusable are archived with the harness. They are C's algebra (`tools/eval/six-paths/path-c.mjs` `solve`) and the per-strategy vote, constant yes/no and tie rules with acceptance (`run.mjs` `decide`, `accept.mjs`). A reuse would copy them from here into a product module, with tests.

The archived modules import their old siblings by relative path, so they do not run from this folder as they are. To consult a working copy, check out commit `c3da94f` (the last commit before the move).

## Path map (repository-relative paths kept below this folder)

- `tools/eval/six-paths/` (17 files, including `equivalence-calibration.jsonl`)
- `config/knowledge/formalizer-six-paths-v1/`
- `tools/eval/method-library/` (`candidate`, `library`, `machine`, `nodewise`, `phase2`, `primitives`, `run`, `score`)
- `config/knowledge/formalizer-methods-v1/`
- `lib/query-author/step-by-step/decompose.mjs`
- `config/knowledge/formalizer-protocol-v1/0070-decomposition.sop`
- `tools/eval/formalization-regression/expression.mjs`
- `lib/formalize/verifier.mjs`, `lib/formalize/obligations.mjs`
- `tests/six-paths.test.mjs`, `tests/method-library.test.mjs`, `tests/expression-dual-tooling.test.mjs`, `tests/formalization-offline-decomposition.test.mjs`, `tests/fixtures/formalization-offline/decomposition-cases.json`

## D1 teacher data of train-psm-lfm-v1 (archived 2026-10-03 by the tests inventory)

`tools/eval/structure-formalizer/d1.mjs` and the job `jobs/train-data-d1/` generated and verified teacher data (structure and FOL from tiers `small` and `medium`) for fine-tuning the structure and logic models. D1 was stopped after its pilot of 50 problems (7 kept, 18%) and the owner withdrew the fine-tuning on 2026-10-03 (Q-TRAIN-1 removed: role-prompted `tiny` beats the off-the-shelf models, so training them makes no sense). The pilot runs stay under `state/llm-jobs/train-data-d1/` and `state/structure-formalizer/d1/` (local). The strict held-out split it froze is still used by the A/B samplers through `tools/eval/structure-formalizer/heldout.mjs`, which stays in the product tree.

- `tools/eval/structure-formalizer/d1.mjs`
- `jobs/train-data-d1/` (`checks.mjs`, `inputs.mjs`, `prompt.md`, `small/job.json`, `medium/job.json`)

