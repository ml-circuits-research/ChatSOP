# eval/ — bounded evaluation artifacts and suites

This directory owns evaluation code, sealed suites, and fresh reports. Nothing here trains a model, selects a checkpoint, or certifies model identity; a passing comparison on finite worlds is never universal semantic equivalence.

## Layout

- `run.mjs` — track-aware evaluator. Takes `--file <suite.jsonl>` plus either `--predictions <predictions.jsonl>` (one explicit `{id, sop}` row per eligible formalization case) or `--config <runtime.json>` (a configured formalizer endpoint). Model output is declarative and compiled by the host; system cases use trusted circuits and are ineligible for a model endpoint. Reports parsing/runtime validity, canonical and execution agreement, UNKNOWN handling, paraphrase and hard-negative slices, and stage timings. Operational errors invalidate the report (`evaluation_valid: false`); a broken gold oracle is a reference failure, not a model error.
- `contracts.mjs` — machine-readable capability contracts used by the evaluator and `tools/capabilities.mjs`.
- `suites/formalizer-v1/` — the sealed test split of the model-language corpus (DS022), disjoint from `datasets_archive/formalizer-v1/`; its `manifest.json` is the checksum authority read by `tools/eval/registry.mjs`, and `world/` holds the shared verification world.
- `suites/formalizer-ood-v1/` — the out-of-distribution sealed suite over held-out domains, with its own manifest and world.
- The earlier suites (core-v1/v2, query-v1/v2, independent-v1, pilot-v1, the grounded and research suites, source-reference) were deleted with the regeneration of 2026-09-28; `reports/history/` keeps their archived numbers, and `reports/history/legacy-corpora-2026-09-28/` their last build and validation logs.
- `verbalizer.mjs` — a limited verbalizer numeric guard; it does not certify paraphrase fidelity.
- `reports/current/` — fresh observed results (verification fingerprints, evaluator self-checks, review bundles, audit JSON). `reports/history/` — earlier-generation results; historical numbers are never presented as new runs.
- `registry/manifest.json` — the real-model dev/selection and sealed-test matrix (blocked until model predictions are supplied); `registry/baseline.json` — the non-model gold-copy sanity matrix. Both are run by `tools/eval/registry.mjs`.
- Reproduce checks with the private native solvers selected explicitly: `Z3_BIN="$PWD/tools/.solvers/z3/bin/z3" SWIPL_BIN="$PWD/tools/.solvers/swi/swipl" node tools/verify.mjs`.

## Owning specifications

- [DS008 data and evaluation](../docs/specs/DS008-data-evaluation.md) — evaluation tracks, report obligations, the sealed-test boundary, sealed auditors, the evaluation registry and the non-model baseline.
- [DS016 evaluation metrics](../docs/specs/DS016-evaluation-metrics.md) — one definition per metric.
- [DS010 experiment preregistration](../docs/specs/DS010-experiment-preregistration.md) — what is frozen before a holdout is used, and the promotion gates.
- [DS013 engine and solver comparison](../docs/specs/DS013-engine-and-solver-comparison.md) — memory-engine, reasoning-strategy and solver comparison reports.
- [DS022 diversity generator](../docs/specs/DS022-diversity-generator.md) — the sealed suites exported here (`formalizer-v1`, `formalizer-ood-v1`); [DS021 model surface](../docs/specs/DS021-model-surface.md) — the language the predictions are written in. DS015 and DS018 describe the deleted earlier suites and are historical.
