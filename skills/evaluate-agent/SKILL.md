---
name: evaluate-agent
description: Audit the complete agent experiment
---

# Audit the complete agent experiment

Read `eval/README.md`, [DS008](../../docs/specs/DS008-data-evaluation.md) (tracks, sealed-test boundary, registry), [DS016](../../docs/specs/DS016-evaluation-metrics.md) (one definition per metric), [DS010](../../docs/specs/DS010-experiment-preregistration.md) (what is frozen before a holdout is used) and [DS021](../../docs/specs/DS021-model-surface.md) (the model surface). The server's `/eval` page and its guide at `/eval/guide` show the suites and reports this skill produces. Keep the two evaluation tracks distinct.

## 1. The small formalizer (track `formalization`)

- **Input:** the user's message only. The evaluator sends nothing else to the model: no context, identifiers, lexicon, background knowledge, clock, earlier turns or pending clarification.
- **Eligible output:** `stated`, `assumed`, `unclear`, `query` and `constraint` written with quoted strings. A host `clarify` is not a model wire; `jsEval`, trusted-circuit wires and coding-agent programs are never model targets.
- **Suites:** the sealed `eval/suites/formalizer-v1/test.jsonl` (in distribution) and `eval/suites/formalizer-ood-v1/test.jsonl` (held-out domains). Selection uses only `datasets_archive/formalizer-v1/dev.jsonl`; a sealed test is scored once per selected model.
- **What to measure:** syntax and field whitelist; execution agreement after host linking against the row's verification world; faithful strings (every `stated` value occurs in the message); stated/assumed separation; certainty and speaker; negation; time; question form (every, measure, count, explain, location/instrument); `unclear` kind and readings; omissions and inventions. `basis` accuracy and coverage are reported separately and never affect the main score (DS021 preregistered criterion).
- Executing a gold program validates the reference and the runtime, not the model; `tools/eval/baseline.mjs` (registry `eval/registry/baseline.json`) is that non-model sanity check. Real-model runs go through `node tools/eval/registry.mjs` with `eval/registry/manifest.json` and stay blocked until real predictions are supplied.

## 2. The complete ChatSOP system (track `system`)

Use independent dialogues in English and Romanian with new information, questions, explanations, corrections, past events, missing data and ambiguity; check user isolation too. Evaluate host linking and clarification, memory, reasoning, approved procedures (including coding-agent-supplied `jsEval` in trusted circuits), the observed route and backend, time, provenance and the end-to-end result and latency. A formalized problem without an engine is answered `not_computable` with the formalization shown; count it separately from wrong answers. `unsupported` is only an explicitly requested, unavailable backend (AGENTS.md rule 8): a missing backend is a skipped test, never a passed one.

## 3. Reporting

For every report name the track, the language version (the one model language of DS021), the suite and its checksum, the model or system configuration and the backend actually observed. Give each metric's numerator and denominator: eligible, attempted, missing or invalid, `unclear`, `not_computable` and operational exclusions; separate rates over all eligible cases from rates over valid predictions. Break results down by language, family, question type, noise level and source. Preserve raw outputs. Fresh results go to `eval/reports/current/`; archived numbers stay in `eval/reports/history/` and are never presented as a current run (AGENTS.md rule 9). For a superiority claim, compare large models with equivalent tool and memory access.

Log each evaluation with `node tools/journal.mjs add --area eval …` and record the arm in `status/experiments.json`. Evaluation alone never authorizes training.

Also record each evaluation's numbers, slices and validity findings as a topic note: `node tools/notes.mjs add --topic evaluation --kind <result|observation|analysis> --title "…" --body "…" --link <report>` (reference baselines under `baselines`). Notes are append-only; a corrected or invalidated number gets a new note with `--supersedes <note id>`, never an edit. The `/experiments` pages are the living index of the evaluations and their experiments.
