# Archived specifications and working documents

Archived on 2026-09-28 during the documentation consolidation, when the design specifications were merged and renumbered gap-free (DS000–DS022). Everything here is historical evidence, not a current contract. On 2026-09-28 every still-valid item was carried into the current specifications named in the table (memory strategies into DS023–DS028, which reuse former ids with a new meaning; see `reassigned` in `docs/specs/aliases.json`), so nothing here is needed to understand the current system; where it disagrees with `docs/specs/`, the current specification wins. Files keep the ids and paths of their time. `docs/specs/aliases.json` maps every former id to its current specification, the specification it was merged into, or its location below.

| Archived file | What it was | Current home of its still-valid content |
| --- | --- | --- |
| `legacy-registers/DS027-legacy-architecture-language.md` | Consolidation register of the archived architecture, SOP, runtime, lexicon, time, backend, CNL and ingestion chapters | DS002, DS004 (scheduling, output ports, reification), DS005 (temporal contract), DS011 |
| `legacy-registers/DS028-legacy-reasoning-and-operations.md` | Register of the archived memory, strategy, linker, wire-semantics and reference-engine chapters | DS005, DS006 (reference-engine algorithm and extension contracts), DS023-recall-memory.md, DS027-hybrid-memory.md |
| `legacy-registers/DS029-legacy-data-memory-and-release.md` | Register of the archived data, shard, memory-comparison, validation and release chapters | DS007, DS008, DS010 (release checks), DS013, DS023-recall-memory.md to DS028-memory-retention-and-generations.md |
| `legacy-registers/DS030-legacy-index-and-contracts.md` | Legacy artifact index, 00–30 chapter map and the archived-versus-current contract diff | `sop/contracts/` (generated), `../legacy/` |
| `vision/DS023-nl-sop-dataset.md` | Passage-by-passage coverage register of the archived vision documents (`../vision/*.docx`) | DS008, DS009, DS011 |
| `proposals/wire-redesign-2026-09-28.md` | Wire redesign proposal; its implemented parts became the model surface | DS021; open items in `TODO.md` and `questions.md` |
| `sections/DS005-reference-audit.md` | Reference audit of the two archived memory documents, extracted from the memory spec | DS024-holo-memory.md, DS025-sqlite-memory.md, DS027-hybrid-memory.md, DS028-memory-retention-and-generations.md |
| `sections/DS006-reference-audit.md` | Reasoning boundary of the two archived memory documents, extracted from the reasoning spec | DS006, DS023-recall-memory.md (trace and pattern experiments) |
| `sections/DS009-docx-reconciliation.md` | Docx reconciliation paragraph and decision table, extracted from the query-curriculum spec | DS009 |
| `sections/DS018-dated-sections.md` | Dated research-mode acquisition sections, extracted from the source-rights spec (now DS014) | DS014 (source-cache provenance rule) |
| `sections/DS024-proposals-considered.md` | Construct proposals considered and rejected, extracted from the small-language scope spec | DS021 |
| `sections/DS025-verdict-register.md` | Legacy statement verdict register of the archived manuscripts (`../article-direction/*.docx`) | DS000, DS010 |
| `doubts/doubts.md`, `doubts/docx-direction.md` | Former open-question files about the archived documents | Decisions of 2026-09-28 recorded in DS005, DS010 and DS027-hybrid-memory.md; the ambiguity question stays in `questions.md` until implemented |
| `doubts/docx-references.md` | Legacy reference audit register | DS024-holo-memory.md, DS023-recall-memory.md, DS006 |
| `docs-consolidation-plan-2026-09-28.md` | The survey and plan this consolidation executed | `docs/specs/aliases.json`, `CHANGES.md` |

The older archive index for the `.docx` originals and the former `docs/legacy/` tree is `../README.md`; its links name the specification ids of its time.

## Frozen and paused specifications (2026-10-01)

Specifications of the frozen small-model branch are in `../tinyLLMExperiments/specs/` (training, data and evaluation, query curriculum, independent corpus, research and grounded corpora, corpus audit tool, capability APIs; ids as before the 2026-10-01 renumbering), and the paused EmotionDetectionSystem spec is `../paused/specs/DS029-emotion-detection.md`. See `../tinyLLMExperiments/README.md` and `../paused/README.md`.

## Small-model training text removed on 2026-10-02

On the owner's request of 2026-10-02 the sections and sentences of the live specifications (DS007, DS011, DS012) and skills that only served model training were moved to `../tinyLLMExperiments/specs/removed-sections-2026-10-02.md`, each entry with the file and section it came from; `docs/specs/aliases.json` (`sections_removed_2026_10_02`) lists them. The specification ids did not change. No model is trained in this project.
