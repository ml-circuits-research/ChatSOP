# eval/ — bounded evaluation artifacts and suites

This directory owns evaluation code, sealed suites and fresh reports for the symbolic-reasoning product. Nothing here trains a model. A passing comparison on finite worlds is never universal semantic equivalence. The validation procedure is the benchmark of symbolic reasoning against small LLMs, `experiments/proposal/symbolic-vs-llm-benchmark.md` (to be built).

## Layout

- `suites/kbqa-mintaka/`, `suites/kbqa-lcquad2/`, `suites/kbqa-simplequestions/`, `suites/kbqa-qald10/` — sealed natural-language KBQA suites run by the harness `tools/eval/kbqa.mjs` over Wikidata slices as base memories (preregistered `eval-kbqa-v1`; staged 100, 300, all).
- `suites/linking-v1/` — the sealed linking suite for the KnowledgeLinker (`eval-linking-v1`, `eval-linking-v2`).
- `smoke-reasoning/` — the smoke reasoning cases and the runner `node eval/smoke-reasoning/run.mjs`, which executes every reasoning strategy; `validator.mjs` checks knowledge and query circuits.
- `reference-engines/` — vendored reference engines for differential tests.
- `world-kb/` — checks of the world-v1 base memory.
- `contracts.mjs` — machine-readable capability contracts used by `tools/capabilities.mjs`.
- `leakage.mjs` — the mechanical guard: generators and tuning code never read the test files of `eval/suites/**`.
- `reports/current/` — fresh observed results (regenerable, gitignored). `reports/history/` — archived results; historical numbers are never presented as new runs.

The step-by-step formalizer is measured by `tools/eval/query-forms` (dev set) and `tools/eval/query-parsers.mjs`, one tier at a time (`--tier tiny|small|medium|good`; the one-shot calibration runner is archived in `probably_obsolete/one-shot-formalization/tools/eval/query-model-calibration/`); wrong circuits are counted apart from honest unknowns (`tools/eval/severity`). The frozen small-model suites (`formalizer-v1`, `formalizer-ood-v1` and the dataset suites) are archived in `probably_obsolete/tinyLLMExperiments/eval/`.

## Rules

- A test is a lexically disjoint variant of the forms the system was built on (`tools/datasets/audit/content-word-overlap.mjs`, `tools/eval/query-forms/overlap.mjs`); no claim covers other forms.
- Stage evaluations (100, 300, then the full set) with a paired bootstrap interval, write the stopping rules into the preregistration (`status/preregistrations/`, [DS007](../docs/specs/DS007-experiment-preregistration.md)) and record every stop.
- Reproduce checks with the private native solvers selected explicitly: `Z3_BIN="$PWD/tools/.solvers/z3/bin/z3" SWIPL_BIN="$PWD/tools/.solvers/swi/swipl" node tools/verify.mjs`.

## Owning specifications

- [DS012 evaluation metrics](../docs/specs/DS012-evaluation-metrics.md) — one definition per metric.
- [DS007 experiment preregistration](../docs/specs/DS007-experiment-preregistration.md) — what is frozen before a holdout is used, and the promotion gates.
- [DS010 engine and solver comparison](../docs/specs/DS010-engine-and-solver-comparison.md) — memory-engine, reasoning-strategy and solver comparison reports.
- [DS014 model surface](../docs/specs/DS014-model-surface.md) — the circuit language the coding agent writes.
- [DS015 diversity generator](../docs/specs/DS015-diversity-generator.md) — the generator behind synthetic forms.
