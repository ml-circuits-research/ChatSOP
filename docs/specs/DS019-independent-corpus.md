# DS019 — Independently authored bilingual evaluation corpus

## Status and provenance

Author: **LLM coding assistant** (`openai-codex/gpt-6-sol` workstation identifier). No human reviewed or adjudicated these cases. They are **not human gold**, not training-approved, and have `generation_trace.review_status: "not_reviewed"`, `quality_flags.human_reviewed: false`, and `qualification: "not_reviewed"` on execution. “Integrator-authored” describes the source of these scenario cards, not a human reviewer or independent semantic annotation.

The source of truth is `tools/datasets/build-independent.mjs`: twenty manually written evidence cards with four named entities, three domain-specific bilingual relations, and separately selected positive, explicitly negative, conflicting, and temporally bounded edges per card. The builder provides authored bilingual interrogative surfaces over those cards, produces the associated SOP gold circuits, and executes **each gold circuit using the runtime** to obtain `expected.status` and `expected.answers`. The same case has one English and one Romanian surface. Source content, URI, revision hash, content SHA-256, quote-linked facts, method/model/review fields, and fixed context metadata accompany every row. Regenerate with `node tools/datasets/build-independent.mjs`; the two manifest files record the test checksum and provenance, not a claim of human review.

The runtime import interface requires a `reviewed: true` **execution-permission flag** when publishing source facts for the gold run; the evaluator also sets it when loading any suite. That internal flag is not a record of a human having reviewed this corpus or its natural-language interpretations. Dataset review metadata remains `not_reviewed`.

## Independence and limits

The cards and bilingual question constructions in this builder do **not** import or use `datasets/templates/pilot.json`, the curriculum case registry, or either synthetic corpus generator. Their domains (archives, clinics, harbors, observatories, farms, theaters, weather bulletins, and others), names, relations, and fact edges were written for this collection. Shared SOP parser/schema/runtime interfaces are necessary for compatible evaluation, not a source of generated questions. Recurrence of the ten reasoning families across the twenty cards is deliberate, so this is **not** an unseen-operator or unseen-family holdout; some surface constructions recur with different authored evidence, and the pairs are not a claim of independently translated human questions. The expected labels are runtime-derived reference results, not an independent human truth oracle. No neural inference, model training, or reviewer approval is performed by the builder.

The collection contains only a sealed test split; no training or development rows are emitted. Twenty connected `split_group_id` groups, including every EN/RO semantic pair and its `negative_of` contrasts, are wholly in `test`. `validateCorpus`/`tools/datasets/validate.mjs` enforce the group-boundary invariant; a single-split corpus does not establish cross-split generalization. The two explicit-negative contrasts in each card compare affirmative versus denied evidence and a positive claim versus its negated claim. Each language includes conflicts (`both`), unsupported-by-evidence (`unknown`), and missing-referent clarification (`clarify`).

## Observed validation

`node tools/datasets/build-independent.mjs` emitted **200 semantic cases and 400 rows**: 200 English and 200 Romanian, all test. `node tools/datasets/validate.mjs --file eval/suites/independent-v1/test.jsonl --execute` executed all 400 rows with `status: "verified_against_runtime"`, `qualification: "not_reviewed"`; the corpus leakage check passed (`20` connected groups, `0` crossing splits). The per-family breakdown below is 20 semantic cases, 20 English rows, and 20 Romanian rows per family:

| Family | Cases | English | Romanian | Runtime status |
| --- | ---: | ---: | ---: | --- |
| affirmed | 20 | 20 | 20 | supported |
| explicit_denial | 20 | 20 | 20 | refuted |
| conflicting_reports | 20 | 20 | 20 | both |
| unreported_pair | 20 | 20 | 20 | unknown |
| identify_actor | 20 | 20 | 20 | supported |
| dated_during | 20 | 20 | 20 | supported |
| dated_after | 20 | 20 | 20 | unknown |
| two_observations | 20 | 20 | 20 | supported |
| explicit_negative_claim | 20 | 20 | 20 | supported |
| missing_referent | 20 | 20 | 20 | clarify |

This verifies the gold SOP against the executing system and provenance/group invariants; it does not constitute human review of natural-language interpretation.
