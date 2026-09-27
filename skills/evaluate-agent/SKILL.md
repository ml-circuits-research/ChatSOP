---
name: evaluate-agent
description: Audit the complete agent experiment
---

# Audit the complete agent experiment

Read `eval/README.md`, `docs/legacy/requirements/09-evaluare.md`, and `docs/legacy/requirements/12-stadiu.md`. Keep the `formalization` and `system` evaluation tracks distinct; historical mixed suites and reports retain their original provenance and scores:

1. **Small NL-to-SOP model:** evaluate only model-authored `premise`, `query`, and `constraint` targets on independent, reviewed holdouts: syntax/schema, references and entity identity, conditional interpretation versus session recording, question meaning, negation, time, omissions, inventions, uncertainty and justified information requests. A host-generated `clarify` is not a model-authored wire. Exclude `jsEval`, complex code, and coding-agent programs from model targets. Executing the compiled symbolic gold SOP validates the reference or runtime, not neural capability; agreement in a finite world does not replace semantic review.
2. **Complete ChatSOP system:** use independent Romanian-language dialogues with new information, questions, explanations, corrections, past events, missing data, and ambiguity; check user isolation too. Evaluate memory, reasoning and probes separately, along with approved procedures (including coding-agent-supplied `jsEval`), the observed backend/fallback, time, provenance, and end-to-end result/latency. Compare the SOP form with the message's meaning and CNL with the reformulated text. Correct execution of the gold program does not demonstrate small-model quality.

For future reports, identify the track, syntax/capability version, suite source and separation, model/system configuration, and actually observed backend. Report each metric's numerator and denominator: total eligible, attempted, missing/invalid, abstentions, and operational exclusions; separate rates over all eligible cases from rates conditioned on valid predictions. Break results down by language, family, and source; for the system, include memory/time/provenance errors, unauthorized effects, total memory cost, and per-stage and end-to-end latency. A missing backend means a skipped test, not a passed one. Preserve raw output; for superiority claims, compare large models with equivalent tool and memory access and do not generalize from a seed with repeated templates.

**Status/migration:** New suites carry an explicit `evaluation_track` and the evaluator checks model declarations separately from trusted system circuits. Do not relabel historical results as declarative-model scores. Keep system-only examples and future approved programs (algorithms, graph search, collection/graph construction) in the system track; their existence cannot expand model vocabulary or authorize training. Parser/data/contract updates require their own reviewed approval, and no training is authorized by evaluation alone.
