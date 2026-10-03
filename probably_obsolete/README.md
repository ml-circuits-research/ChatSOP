# Preserved historical sources

This folder retains source documents after their operative direction has been reconciled into the current specifications. Preservation is not publication, peer review, training authorization, or proof that any source claim remains true. Current decisions and the current evidence take precedence over archived prose; where an archived document disagrees with a session decision or a DS, the DS wins.

The `docs/legacy/references/*.txt` extraction of the two reference documents stays in `docs/legacy/references/`; only the original `.docx` containers were moved here. Binary digests were verified unchanged at move time.

| Original source | Archived location | Moved | Current specification carrying its content |
| --- | --- | --- | --- |
| `vision/SOP_dataset.docx` | `probably_obsolete/vision/SOP_dataset.docx` | 2026-09-27 | DS008, DS009, DS010 — semantic-case unit, canonical record model, pipeline, multilingual anchor strategy (register archived at `specs/vision/`) |
| `vision/SOP_CommonSense_v2.docx` | `probably_obsolete/vision/SOP_CommonSense_v2.docx` | 2026-09-27 | DS010, DS011, DS017 — the source-material-to-knowledge loop and its declared boundaries |
| `docs/legacy/references/H7.docx` | `probably_obsolete/references/H7.docx` | 2026-09-27 | `docs/specs/DS024-holo-memory.md` — HoloMemory contract, kernel, adapters, planned two-plane design, related work and required experiments |
| `docs/legacy/references/RecallSOP-proposal.docx` | `probably_obsolete/references/RecallSOP-proposal.docx` | 2026-09-27 | `docs/specs/DS023-recall-memory.md`, `DS025-sqlite-memory.md`, `DS027-hybrid-memory.md`, DS006 — memory roles, planned SQL schema and ranking, three-level architecture, trace experiments |
| `article/direction/Articol.docx` | `probably_obsolete/article-direction/Articol.docx` | 2026-09-27 | DS000, DS010 — research question, experiment structure, naming and citation decisions of 2026-09-28 |
| `article/direction/Publicare.docx` | `probably_obsolete/article-direction/Publicare.docx` | 2026-09-27 | DS010 — publication route and evidence obligations |

## Archived legacy documentation tree

The whole former `docs/legacy/` tree moved here on 2026-09-27 after consolidation. Contents:

| Archived item | What it was | Current specification carrying its valid content |
| --- | --- | --- |
| `legacy/requirements/00`–`30` (31 chapters + `README.md`) | The original Romanian requirement chapters, preserved verbatim | DS002, DS004, DS005, DS006, DS007, DS008, DS010, DS016; memory chapters 03, 13 and 16–22 in `docs/specs/DS023-recall-memory.md` to `DS028-memory-retention-and-generations.md` |
| `legacy/EXAMPLES.md` | Prose example catalog (no one-to-one current equivalent) | Executable current examples live under `examples/` and `tests/fixtures/` |
| `legacy/SOURCES.md` | Consolidated technical bibliography | DS004 (`node:vm`), DS006 (SWI, Z3, planning), DS007 (model cards, PEFT, llama.cpp), DS023 (Thousand Brains), DS024 (related work), DS025 (SQLite) |
| `legacy/contracts/wire-fields.md`, `legacy/contracts/wires.json` | Stale snapshots of the generated wire contract (pre-cutover `assert`, old `premise` fields) | Current generated files `sop/contracts/wire-fields.md` and `sop/contracts/wires.json`, produced by `node tools/capabilities.mjs --write` |
| `legacy/tools/symbolic-gate/` (`symbolic-gate.mjs`, `symbolic-gate-report.mjs`, `gate.mjs`) | The Haiku gate of the SOP-proxy era for `symbolic_english` membership (experiment `eval-symbolic-gate-v1`), retired 2026-10-01 | `tools/datasets/three-datasets/analysis-gate.mjs` (DS008 "Three datasets"); the forms inventory is `symbolic-forms-inventory.md` |
| `legacy/references/H7.txt`, `legacy/references/RecallSOP-proposal.txt` | Extracted text of the two archived reference documents | `docs/specs/DS023-recall-memory.md` to `DS028-memory-retention-and-generations.md`, DS006 |

Path citations inside archived files still read as they did historically; live documents were rewritten to this archive location. Open owner decisions are in the root `questions.md`.

As of 2026-09-28 everything still valid in this folder has a current specification; the folder holds raw historical evidence only.

## Retired skills

`skills/data-quality/` and `skills/wire-discovery/` moved to `probably_obsolete/skills/` on 2026-09-28. Both were imported from a sibling project and scan `training-data/**/solution.sop` circuits, `teacher/` generators and `wires/` sources that ChatSOP does not have; their `last-report.md` files describe that external corpus, not ChatSOP data.

## Frozen and paused work (2026-10-01)

- `tinyLLMExperiments/` holds the frozen small-model research branch (Stanza, SymbolicLM, rules, the proofing and formalizer models, datasets, suites, training, audit); see its `README.md` for the path map, best results and how to resume.
- `paused/` holds paused work (EmotionDetectionSystem, programming P0, unified-ft tooling); see its `README.md`.

Both keep original repository-relative paths below their folder; the state before the move is commit `97188d6`.

## One-shot circuit formalization (2026-10-02)

`one-shot-formalization/` holds the one-shot strategy LLMDirect (the author loop, its prompt and guide, its backends, structured-output ablations, their tests and the one-shot calibration runner), archived when the owner made formalization step by step only; see its `README.md` for the reason, the last measured numbers and the path map.

## Formalization experiments (2026-10-03)

`formalization-experiments-2026-10/` holds the research harnesses of 2026-10-02/03, archived when the owner decided to rebuild the formalization infrastructure (structure model, logic formalizer model, deterministic converters to SOP). They are the six-paths harness and its layer, the method library and its node-by-node runs, the stage-A semantic decomposition, and the dual-formalization tooling with its cross-family and tiny-only verifiers. Their tests moved with them. See its `README.md` for what each part was, its final numbers, what stayed in the product and why, and the path map. The state before the move is commit `c3da94f`.

## TinyAgent migration (2026-10-03)

| Archived item | What it was | Current place |
|---|---|---|
| `llmapiprovider/local-services/small-models/` | The earlier proxy's local service for GLiNER2.5 and T5 NL-to-FOL (tiers `structure-gliner`, `formalizer-t5`); the models lost the A/B of 2026-10-03 and were deleted | the prompted roles of TinyAgent (`structure`, `formalizer` tiers, `config/prompts/`) |
| `tinyagent-migration/lib/local-llm/` | The managed llama-server registry of the step-by-step strategies (dedicated slots, prewarmed prefixes, GPU locks) and its chat client `localChat` | TinyAgent's local model providers (`TinyAgent/README.md` "Local models"; tiers `micro`, `tiny` in `config/tinyagent.json`), reached through `lib/tinyagent.mjs` |
| `tinyagent-migration/tools/local-llm/serve.mjs` | Started one managed llama-server and kept it running for the chat server or an evaluation | `node TinyAgent/bin/tinyagent.mjs models start <provider>` |
| `tinyagent-migration/tests/local-llm-runtime.test.mjs` | The tests of `lib/local-llm` | TinyAgent's own tests (`TinyAgent/test/`) |
| `tinyagent-migration/tools/eval/query-model-calibration/` | `servers.mjs` (one private GPU llama-server of an evaluation) and `models.mjs` (its GGUF list), last used by the symbolic-vs-llm harness | the harnesses name a TinyAgent tier (`--local-tier`, default `micro`) |
| `tinyagent-migration/LLMAPIProvider/` | The earlier local proxy (its README, its last configuration with tiers and upstreams, and the phase-1 shims `server.mjs` and `prompted.mjs` that ran the TinyAgent core under the old paths); retired when port 18080 switched to `tinyagent serve` | `TinyAgent/` (server, library, CLI), `config/tinyagent.json`, `config/prompts/` |
| `tinyagent-migration/LLMJobs/` | The earlier job runner's README, example configuration and phase-1 shims (`run.mjs`, `lib/`) | `TinyAgent/lib/jobs/`, `tinyagent job | task | check | list | show | prune` |
| `tinyagent-migration/llmjobs.config.json` | ChatSOP's configuration of the earlier job runner (endpoint, roles, concrete fallback chains, task limits) | the `runner` section of `config/tinyagent.json` |

## Evaluation clean-up (2026-10-03)

`eval-cleanup-2026-10-03/` holds the harness files the inventory of tests and evaluations (`docs/tests-inventory.html`, recommendations R3 to R5) found tied to archived components, at their original paths: the SymbolicLM-era severity graders (`tools/eval/severity/sop-compare.mjs`, `analysis-map.mjs`, `simplify.mjs`, with `program-shape.mjs` and the rewrite judge prompt `judge-prompt.mjs`), the linker differential over SymbolicLM rows (`tools/linking/differential.mjs`) and the zero-shot structure probe (`tools/eval/structure-formalizer/probe.mjs`, superseded by `ab.mjs`). DS012 keeps the severity scale, the mechanical checks and the metrics. The duplicate query-forms runner `tools/eval/query-forms/run.mjs` (R2) was deleted; `tools/eval/query-parsers.mjs --suite forms` runs the same rows.
