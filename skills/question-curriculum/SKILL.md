---
name: question-curriculum
description: Enumerate executable source question families with declarative model targets and explicit reasoning gaps
---

# Question curriculum

Read [DS022](../../docs/specs/DS022-question-curriculum-generator.md) and the actual `tools/datasets/curriculum/cases.mjs` arrays before changing a question family. The executable inventory comes from those arrays, including blocked families. Never infer approval, coverage of an unlisted vision family, or a new independent oracle from a runtime status. These are synthetic, unreviewed examples, not qualified training data.

Generate a bounded sample with `node tools/datasets/question-curriculum.mjs --family temporal --world temporal_train --seed 7 --limit 3`; omit selectors for a cross-family sample. The output contains source operators, split group, question, declarative target, host setup, independent oracle, expected status, and explicit unsupported gaps. All model targets are restricted to `premise`, `query`, `constraint`; `remember`, procedure expansion, `solve`, `cnl`, and clarification are host/system responsibilities. Atom syntax is whitespace-separated (`parent ana bogdan`), not predicate parentheses. Do not transform a missing causal/action/defeasible theory into a guessed hard rule or treat an unknown answer as a negative fact.

The CLI verifies **each** executable gold by running `new Runtime(...)` with an isolated trusted host setup, fixed time and scoped ontology, and fails on mismatch with the independent source oracle. Use `node --test tests/question-curriculum.test.mjs` for scoped behavior tests. Keep connected paraphrases and semantic groups in their source split; do not reassign train/dev/test by sampled surface. A selected unsupported row is a reasoned gap, not a gold and not a target for training.
