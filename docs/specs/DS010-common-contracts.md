---
title: DS010-common-contracts
summary: Executable SOP, semantic-case, epistemic, capability, and experiment identity boundaries.
---

## Introduction

This specification records contracts of the current symbolic system, not permissions for a model to author trusted operations or a promise of a general default reasoner. The runnable boundary examples are `tests/contracts-boundary.test.mjs`; the dataset's own execution check is `node tools/datasets/validate.mjs --manifest datasets/query-v1/manifest.json --execute`. Each positive/negative pair below names its executable test. A field absent from the named source is not introduced here as a new wire or packet field.

## Common boundaries

| Boundary and source of field names | Positive, executed example | Negative, executed example |
| --- | --- | --- |
| **SOP profile:** `sop/parser.mjs` exports `PROFILE='sop-agent-3'` and `SPEC`; a wire is `@id type` followed by two-space-indented declared fields. `premise` requires `holds`; `query` requires `where`. | `parse('@p premise\n  holds parent mara sorin').profile === PROFILE`. `tests/contracts-boundary.test.mjs` checks the profile and `SPEC.premise.required`. | `parent(?x, ?y)` is rejected as an atom; a model-origin `fact` is rejected by `Runtime.run(...,{origin:'model'})`. Parseability is not authoring permission: only `premise`, `query`, `constraint` are model-origin declarations. Test: “SOP profile admits whitespace atoms…”. |
| **Semantic case:** `tools/datasets/schema.mjs:validateRecord/validateCorpus`. Row keys include `id`, `semantic_case_id`, `split_group_id`, `structure_id`, `surface_group_id`, `split`, `question`, `sop_target`, `setup_sop`, `evaluation_track`, `language`, `semantic_status`, `negative_of`, `context_assertions`, `source`, `generation_trace`, `quality_flags`, `context`, `expected`; optional `input_mode` is normally explicit. `source` requires `id`, `kind`, `uri`, `revision`, `sha256`, `license` (and validates `content` checksum when present); `expected.status` is an oracle, not a prediction. | `validateRecord` accepts the real `datasets/query-v1/dev.jsonl` first row, including its `source` and `evaluation_track`. Test: “semantic case requires provenance…”. | Replacing its `source.sha256` with `undefined` fails source provenance; changing `evaluation_track` to `other` fails. The dataset validator additionally checks split/case integrity; those checks are not claimed to have been exercised by this pair. |
| **Result and epistemic packet:** `sop/runtime.mjs` produces a result packet; `eval/run.mjs` reads `result.packet ?? result`; `eval/contracts.mjs:epistemicResult` projects `status` into vision vocabulary while retaining `runtime_status`, `complete`, `hypothetical`, `epistemic`. | Two explicit opposite `fact` wires produce runtime `both` and projected `CONFLICT`; `complete:false`, `hypothetical:true`, `epistemic:'hypothetical'` survive a conflicting packet. Test: “result projection retains contradiction…”. | Missing runtime `status` throws; an unrecognized runtime status projects to `UNSUPPORTED`, never an invented hard entailment. Test: “executable decision rows…”. `complete:null` means the packet did not report completeness, **not** that a search is complete. |
| **Reasoning and memory capabilities:** `reasoning/registry.mjs:CAPABILITIES`, `ReasoningRegistry.run`, `memory/repository.mjs:Repository.apply/commit`, `tools/capabilities.mjs` (exports `memoryEngines`, `reasoning`, `wires`). `reference.deduce` declares `finite-function-free-Horn`; available memory engines are `weaver`, `holo`, `sqlite`, `scan`, `hybrid`. `remember` is the recording wire. | A trusted `fact` plus `remember input $f` returns `stored`, increments the session revision, and a subsequent `solve` reads the claim. Test: “memory and reasoning capabilities…”. | `remember input $h` cannot store an unreviewed `hypothesis` and does not advance the revision. An uncompiled `theory dialect arbitrary` returns `unsupported` with `code:'unsupported_theory'`; neither memory selection nor a theory body silently makes it executable. Same test. |
| **Experiment/model identity:** `eval/run.mjs:evaluate` produces `format`, `source`, `profile`, `suite_sha256`, `config_sha256`, `runtime`, `model_manifest`, `model_identity_verified`, `requests_succeeded`, `evaluation_valid`, `records`. A manifest is supplied provenance, **not** an attestation of endpoint weights. | Evaluating a fixed real row with an explicit predictor yields SHA-256 suite/config identities; changing only `config.memory.engine` changes `config_sha256` but not `suite_sha256`. Test: “experiment hash identifies fixed suite/config…”. | Duplicate row `id` rejects the run. Supplying `modelManifest` leaves `model_identity_verified:false`; an opaque supplied manifest is not proof of weights or neural inference. Same test. |

`context` fields are validated in `schema.mjs` (`now`, `language`, `entities`, `predicates`, `approvedTemplates`, `procedures_sop`); the positive semantic-case row uses those actual fields. `context_assertions` and `generation_trace` preserve the difference between authored input, source provenance and oracle. `Repository.commit` is separate from session `remember`; neither a conditional model `premise` nor a proposed `pattern`/`hypothesis` becomes a published fact. The executable cases check the concrete admission and effect boundaries, not external-source truth or review quality.

## Executable decision table

`eval/contracts.mjs:STATUS_DECISIONS` is the executable table below. Every literal row is exercised by the table-driven assertion in “executable decision rows…”; the rows marked **runtime** additionally come from actual `Runtime.run` executions there or in the cited boundary test. The projection is not a new proof engine. The source vocabulary in `vision/SOP_CommonSense_v2.docx` identifies `ENTAILED`, `CONTRADICTED`, `UNKNOWN`, `PLAUSIBLE`; `CONFLICT`, `POSSIBLE`, `UNSUPPORTED`, `AMBIGUOUS`, `BLOCKED` and operation receipts preserve distinctions the runtime already exposes.

| Runtime `status` | Vision/result projection | Decision and executed evidence |
| --- | --- | --- |
| `supported` | `ENTAILED` | Positive admitted proof (**runtime**); if `hypothetical:true`, use `PLAUSIBLE`, retaining `runtime_status:'supported'` (**runtime** model premise). |
| `refuted` | `CONTRADICTED` | Explicit contrary evidence (**runtime**); also the DEFAULT exception test below. |
| `both` | `CONFLICT` | Positive and negative evidence, neither discarded (**runtime** result-boundary test). A nonempty `conflictedAnswers` takes the same precedence even if another status is reported (result-boundary test). |
| `unknown` | `UNKNOWN` | No supporting/contrary evidence (**runtime**); not falsehood and not automatically `clarify`. |
| `possible` | `POSSIBLE` | A feasible finite assignment exists, not an entailment (**runtime** numeric `task possible`). |
| `entailed` | `ENTAILED` | Finite constraint claim holds across admitted models (**runtime** numeric `task prove`). Hypothetical entailment projects to `PLAUSIBLE`. |
| `impossible` | `CONTRADICTED` | Finite-domain possibility refuted relative to supplied constraints (table projection; not a global closed-world assertion). |
| `hypotheses` | `PLAUSIBLE` | Abduction returns proposed assumptions, not facts (**runtime**). |
| `candidates`, `patterns` | `PLAUSIBLE` | Exploratory suggestions are not approved rules (table projection). |
| `clarify` | `AMBIGUOUS` | Host request for required information (table projection); lack of evidence alone is `unknown`. |
| `unsupported` | `UNSUPPORTED` | Uncompiled theory/required capability (**runtime**), no fabricated `entailed` result. |
| `blocked` | `BLOCKED` | Dependency unavailable; not a negative proof (table projection). |
| `inconsistent` | `CONFLICT` | Contradictory intervention or no consistent model; never explosion to arbitrary entailment (table projection). |
| `optimal` | `ENTAILED` | Proven finite optimum relative to the specified model (table projection; not an open-world global optimum). |
| `feasible_bound` | `POSSIBLE` | Incomplete optimization bound, not a proven optimum (table projection). |
| `plan_found` | `POSSIBLE` | A bounded plan candidate exists; it was not executed (table projection). |
| `no_plan` | `UNKNOWN` | No plan found in the supplied bounded action/model profile, not a universal impossibility (table projection). |
| `stored`, `context_updated` | `STORED`, `CONTEXT_UPDATED` | Operational receipts, not truth claims (`stored` **runtime**; `context_updated` table projection). |
| Any other runtime string | `UNSUPPORTED` | Fail-closed projection; raw `runtime_status` remains available (explicit regression case). |

**Precedence and qualification:** An explicit `both`, `inconsistent` or nonempty `conflictedAnswers` projects to `CONFLICT` before conditionality. Otherwise a `supported` or `entailed` packet with `hypothetical:true` projects to `PLAUSIBLE`; only then does the literal table apply. `complete:false` and `epistemic` remain separate fields and cannot be erased by a positive status. The result-boundary test executes the combined contradiction/hypothesis/incompleteness packet. `complete:null` is an unreported field, not a success. `runtime_status` always carries the original runtime status, including unsupported extensions.

### DEFAULT with an exception and no-support control

There is **no general DEFAULT wire or default-rule compiler** in `SPEC`/`ReasoningRegistry`. The exercised limited case is a model `premise holds likes ana book` retained as a conditional assumption: while uncontested, `Runtime` reports `supported`, `hypothetical:true`, projected `PLAUSIBLE`. If an explicit, session-recorded `not likes ana book` is visible at the same knowledge cutoff, the assumption is listed under `defeatedAssumptions`, and the result is `refuted`/`CONTRADICTED`; the premise is not a second stored claim. With neither assumption nor supporting record, the same query is `unknown`/`UNKNOWN`. These three executions are in “DEFAULT proposal with explicit exception…”. A requested `theory dialect defeasible-default` returns `unsupported`/`UNSUPPORTED` rather than pretending that this narrow assumption rule implements arbitrary unordered defaults. No candidate rule is silently promoted to HARD.

To execute the cases without any model training or endpoint call:

```sh
node --test tests/contracts-boundary.test.mjs
node tools/datasets/validate.mjs --manifest datasets/query-v1/manifest.json --execute
```
