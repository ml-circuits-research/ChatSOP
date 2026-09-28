---
title: DS027-legacy-architecture-language
summary: Audited disposition of eight historical architecture and language chapters against the current checked SOP implementation.
---

> ARCHIVED 2026-09-28 — superseded by the current specifications in docs/specs/ (see docs/specs/aliases.json). Legacy consolidation register, kept as historical evidence. Ids and paths inside this file use the numbering of the time.

# DS027 — Legacy architecture and language audit

This is an audit of the **historical** chapters named below, not a second wire catalog. `CURRENT` means the stated bounded contract is carried by the cited current code/specification; `PARTIAL` names the implemented subset; `MISSING` names historical intent not delivered; `SUPERSEDED` identifies a current-session decision that overrides the historical wording. A reference to a legacy chapter identifies the claim audited, not evidence that it is implemented. References to current DS sections and code lines identify the replacement or bounded implementation. **Current-session decisions override the legacy chapters**, including their claims to describe the current profile. No training, fine-tuning, optimizer run, or neural inference is authorized by this document; no historical symbolic test is evidence of model-language coverage (`docs/specs/DS018-source-rights.md:33-38`; `docs/specs/DS002-architecture.md:16-24`).

## Chapter verdicts

### `00-arhitectura.md`

| Historical claim group | Verdict | Verified disposition |
| --- | --- | --- |
| Typed language separates formalization, approved knowledge, memory retrieval, reasoning and deterministic presentation | CURRENT | `docs/specs/DS002-architecture.md:12-24`; `sop/runtime.mjs:63-80,90-115`. |
| Model learns world knowledge by immediately writing facts/events or authoring execution circuits | SUPERSEDED | **Session replacement:** model authors only `premise`, `query`, `constraint`; host compiles trusted operations; contextual premises are not repository writes (`sop/declarative.mjs:8-23,74-99`; `docs/specs/DS004-sop.md:16-22`). |
| Fine-tuning learns Romanian-to-SOP and demonstrates language competence | SUPERSEDED | **Session replacement:** training is unauthorized; symbolic execution is not evidence of NL competence (`docs/specs/DS018-source-rights.md:33-38`; `docs/specs/DS002-architecture.md:16-18`). |
| Generational memory, bounded/archive and pinned retention with fork-aware roots | PARTIAL | Sharded generation and GC roots exist, but retention/completeness are profile-specific, not a guarantee that all past evidence survives (`docs/specs/DS005-memory.md:12-32`). |
| Model emits `solve`, `cnl`, `expand`, explicit lower-level `link`/`reason`, or requests clarification | SUPERSEDED | **Session replacement:** these are host-approved operations; clarification is host-generated with `pendingSop`/`required`/`next` (`sop/declarative.mjs:8-23,123-144`; `docs/specs/DS004-sop.md:16-22`). |
| One checked SOP program; AST and backend code are internal representations | CURRENT | `docs/specs/DS004-sop.md:8-18`; `sop/parser.mjs:68-96`; `reasoning/solvers.mjs:30-34`. |
| Exact approved rules/templates, not probabilistically reconstructed executable definitions | CURRENT | `sop/runtime.mjs:20-32`; `sop/ingest.mjs:7-13`. |
| Host owns permissions, identity, budgets, review, commit and publication | CURRENT | `docs/specs/DS004-sop.md:73-85`; `sop/runtime.mjs:17-19,168-175`. |
| Result statuses distinguish explicit refutation/conflict/unknown/incompleteness and possible/entailed | CURRENT | `docs/specs/DS010-common-contracts.md:26-40`; `sop/outputs.mjs:25-50`. |
| Linker expands relevant rule premises; `solve` exports checked unique values for downstream work | CURRENT | `docs/specs/DS006-reasoning.md:6-22`; `sop/runtime.mjs:92-111`; `sop/outputs.mjs:25-50`. |

### `01-sop.md`

| Historical claim group | Verdict | Verified disposition |
| --- | --- | --- |
| `@id type`, indented fields, unique IDs and `$` dependencies versus `~` handles and local `?` variables | CURRENT | `sop/parser.mjs:68-96`; `docs/specs/DS004-sop.md:12-14`. |
| Parenthesized/comma-separated executable atoms in examples | SUPERSEDED | **Session replacement:** whitespace-separated predicate plus 1–4 terms; `p(a, b)` is rejected (`sop/parser.mjs:48-63`; `docs/specs/DS004-sop.md:39-43`). |
| Quotes always prevent `$`/`?` interpretation, including variable-shaped atom terms | SUPERSEDED | **Session replacement:** quoting does not turn variable-shaped text into a safe atom constant; use canonical IDs that are not variable-shaped and respect each consumer's grammar (`docs/specs/DS004-sop.md:35-47`; `sop/parser.mjs:47-67,95-96`). |
| Model creates sourced `fact` with `source` and `quote`; declaring it alone does not write | SUPERSEDED | **Session replacement:** model creates conditional `premise` with `holds`/optional `valid`, no model-authored documentary provenance or implicit write; trusted `fact` is separate (`sop/parser.mjs:10-11`; `sop/lower.mjs:9-11`; `docs/specs/DS004-sop.md:16-20,73-75`). |
| `assert` records a fact/event into session | SUPERSEDED | **Session replacement:** only trusted `remember` records authorized facts/events; no `assert` alias (`sop/parser.mjs:7-27`; `sop/runtime.mjs:168-175`). |
| Model emits procedures (`expand`), `solve`, `cnl` or `clarify` | SUPERSEDED | **Session replacement:** host compiles them; `clarify` is generated for unresolved identity/required inputs, not for unknown evidence alone (`sop/declarative.mjs:8-23,123-144`; `docs/specs/DS004-sop.md:20-22`). |
| Safe Horn rule, explicit `not`, query conjunction/time/filter and no negation from absence | CURRENT | For trusted circuits and host-approved rules, with current `all`/`any` condition blocks (`sop/parser.mjs:98-113`; `sop/lower.mjs:12-21`; `docs/specs/DS004-sop.md:24-28`). |
| Constraint integer domains, `possible` versus `prove`, and checked scalar projection | CURRENT | `sop/lower.mjs:23-37`; `reasoning/backends/constraints.mjs:5-12,15-33`; `sop/outputs.mjs:25-50`. |
| `constraint.select` is incidental answer formatting | SUPERSEDED | **Session replacement:** selecting a variable requests a checked scalar from the host's `one` output; ambiguous projections require clarification even when claim status is `entailed` (`sop/declarative.mjs:45-49,123-137`; `reasoning/backends/constraints.mjs:5-12,20-33`). |
| Output ports create unique single-assignment graph values, not first-row guesses | CURRENT | `sop/outputs.mjs:14-50`; `sop/runtime.mjs:92-111,177-179`. |
| Approved template expansion and restricted `jsEval` exist in trusted programs | PARTIAL | Trusted `expand` and expression evaluation exist, but they are not model-authored actions or general arbitrary JS (`sop/parser.mjs:23-27,106-113`; `sop/runtime.mjs:22-26,63-79`; `docs/specs/DS004-sop.md:69-75`). |

### `02-runtime.md`

| Historical claim group | Verdict | Verified disposition |
| --- | --- | --- |
| Parser/graph validation checks fields, IDs, dependencies, cycles, reserved outputs | CURRENT | `sop/parser.mjs:68-96,97-113`; `sop/outputs.mjs:14-23`; `sop/runtime.mjs:24-34`. |
| Scheduler batches independently ready work; effect batch applied after a wave | CURRENT | `sop/runtime.mjs:50-60,168-177`; `memory/repository.mjs:97-105`. |
| A write precedes a read only with declared dependency; textual order alone does not impose it | CURRENT | `sop/parser.mjs:95-96`; `sop/runtime.mjs:50-60,168-175`. |
| `assert` side effects and sample `@save assert` | SUPERSEDED | **Session replacement:** trusted `remember input ...` is the recording wire, with no `assert` alias (`sop/parser.mjs:16-20`; `sop/runtime.mjs:168-175`). |
| Wave-atomic writes but no turn-wide transaction after earlier successful waves | CURRENT | `memory/repository.mjs:97-105`; `sop/runtime.mjs:50-60,168-177`; this is not an all-turn rollback guarantee. |
| Approved handles, hygienic append-only expansion and bounded epochs | CURRENT | `sop/runtime.mjs:27-32,177-179`; `docs/specs/DS004-sop.md:12-18`. |
| General reactive redefinition/invalidation or worker-thread parallel scheduler | MISSING | The chapter expressly excluded both (`probably_obsolete/legacy/requirements/02-runtime.md:7,28-30`); current execution is a ready-wire wave with append-only generated definitions (`sop/runtime.mjs:50-60,177-179`). |
| Restricted expression interpreter and host-registered handlers, not arbitrary executable document code | CURRENT | `sop/parser.mjs:106-109`; `sop/runtime.mjs:18-19,63-64,160-160`; `docs/specs/DS004-sop.md:69-75`. |
| Failed/nonunique `one` blocks dependent work; budget exhaustion is not falsehood | CURRENT | `sop/runtime.mjs:50-58,107-111`; `sop/outputs.mjs:25-50`. |

### `04-lexicon.md`

| Historical claim group | Verdict | Verified disposition |
| --- | --- | --- |
| Canonical ID independent of surface language; entity/predicate/concept declarations are non-executable ontology | CURRENT | `sop/lexicon.mjs:9-16`; `docs/specs/DS004-sop.md:51-67`. |
| Scoping by requested kind, explicit language, entity type and optional exact ontology domain | CURRENT | `sop/lexicon.mjs:17-26`; `sop/parser.mjs:111-111`; `docs/specs/DS004-sop.md:65-67`. |
| Synonym is the same reviewed identity, not implication, subsumption or an inferred rule | CURRENT | Lookup only returns canonical candidates; concept parents are metadata and predicate argument types are explicit (`sop/lexicon.mjs:11-26`; `sop/runtime.mjs:42-48,64-69`). |
| NFC/case/cedilla normalization, bounded accent fallback, indexed tokens and mention ranking | CURRENT | `sop/lexicon.mjs:5-8,17-39`; scores rank lexical matches, not truth. |
| Ambiguity stays ambiguous, without automatic fuzzy name merge; alias promotion needs reviewer and evidence | CURRENT | `sop/lexicon.mjs:21-26,34-39`; `tools/review-alias.mjs:2-4`. |
| Three recent fragments and shortlist in bounded micro-context; current message is not silently truncated | PARTIAL | Implemented byte-bounded shortlist and `recent.slice(-3)`; historical promise of a validated token budget, previous SOP query/premises, and universal pronoun interpretation does not follow (`sop/lexicon.mjs:41-47`). |
| Model can select and emit `expand` using shortlisted approved procedures | SUPERSEDED | **Session replacement:** host owns procedure lookup/compilation, model authors only declarative problem types (`sop/declarative.mjs:8-23`; `docs/specs/DS004-sop.md:16-22`). |
| Multilingual aliases establish multilingual model understanding or require fine-tuning | SUPERSEDED | **Session replacement:** aliases are lexical lookup only; no training/neural coverage claim is authorized (`sop/lexicon.mjs:11-26`; `docs/specs/DS018-source-rights.md:33-38`). |

### `05-timp.md`

| Historical claim group | Verdict | Verified disposition |
| --- | --- | --- |
| Validity time (`valid`, `at`, `during`) differs from known-at (`knownAt`, `asof`) | CURRENT | `sop/lower.mjs:9-21`; `memory/temporal.mjs:89-107`; `docs/specs/DS005-memory.md:12-14`. |
| Half-open `[start, end)` intervals, UTC dates/timestamps, explicit no guessed time of day | CURRENT | `lib/time.mjs:2-13`; `sop/lower.mjs:18-21`. |
| End of claim updates its interval, without making a negative claim or ending other jobs | CURRENT | `memory/temporal.mjs:78-78,89-107`; `docs/specs/DS005-memory.md:12-14`. |
| Correction targets a claim ID and atomically retracts that claim plus adds replacement in a write batch | CURRENT | `sop/runtime.mjs:41-41,168-175`; `memory/repository.mjs:97-105`. |
| Rule-derived intervals intersect premise and rule validity; historical knowledge is selected as-of | CURRENT | `lib/time.mjs:9-11`; `reasoning/common.mjs:17-28`; `docs/specs/DS006-reasoning.md:6-22`. |
| Explicit opposite evidence can yield `both` on overlap, `mixed_temporal` when disjoint; no closed-world negation | CURRENT | `reasoning/reasoner.mjs:72-75`; `docs/specs/DS010-common-contracts.md:28-31`. |
| Complex variable-query results constitute exhaustive global consistency audit | MISSING | Chapter itself limits this (`probably_obsolete/legacy/requirements/05-timp.md:27-31`); `reasoning/reasoner.mjs:72-75` handles bounded returned matches, not arbitrary global audit. |
| General Event Calculus, uncertain intervals, persistent worlds, or guaranteed archive despite decay | MISSING | Excluded by original chapter (`probably_obsolete/legacy/requirements/05-timp.md:33-37`); current scalar interval/retention boundary is `lib/time.mjs:9-13` and `docs/specs/DS005-memory.md:21-32`. |

### `06-backenduri.md`

| Historical claim group | Verdict | Verified disposition |
| --- | --- | --- |
| Compiler accepts typed SOP rather than raw model-authored Prolog/SMT | CURRENT | `sop/declarative.mjs:8-23`; `sop/lower.mjs:23-37`; `reasoning/solvers.mjs:30-34`; `docs/specs/DS012-strategy-backend-matrix.md:6-21`. |
| Bounded JS Horn reference with optional SWI point-in-time Horn | CURRENT | `reasoning/registry.mjs:14-17,36-40`; `docs/specs/DS012-strategy-backend-matrix.md:14-21`. |
| Bounded JS integer constraint solver with optional Z3 for declared integer problem | CURRENT | `reasoning/registry.mjs:41-46`; `reasoning/backends/constraints.mjs:5-12,15-35`. |
| Historical `backend auto` always chooses JS for Horn and uses JS for finite constraint products before Z3 | PARTIAL | Current `reference` uses JS; `advanced` auto chooses SWI for point queries and Z3 for numeric problems when available, with reported fallback (`reasoning/registry.mjs:34-52`; `docs/specs/DS012-strategy-backend-matrix.md:14-21`). |
| Explicit absent/inapplicable backend returns unsupported, not silent substitution | CURRENT | `reasoning/registry.mjs:29-52`; `docs/specs/DS012-strategy-backend-matrix.md:19-21`. |
| Signed Horn negation is explicit and SWI closure proof is checked/reconstructed, not native proof object | CURRENT | `reasoning/solvers.mjs:30-34`; `docs/specs/DS006-reasoning.md:24-30`. |
| Finite linear integer profile: `possible` is not universal proof; Z3 scalar requires uniqueness check | CURRENT | `sop/lower.mjs:23-37`; `reasoning/backends/constraints.mjs:15-33`. |
| Mixed relational-to-numeric flow may consume scalar only after unique binding, never arbitrary first match | CURRENT | `sop/runtime.mjs:92-116`; `sop/outputs.mjs:25-50`; `reasoning/registry.mjs:29-46`. |
| Arbitrary Prolog/SMT syntax, exhaustive Z3 row enumeration and universal portability | MISSING | Explicitly excluded (`probably_obsolete/legacy/requirements/06-backenduri.md:5-16,38-56`); current Z3 projection marks modes other than `one` unsupported (`reasoning/backends/constraints.mjs:17-21`). |

### `10-cnl.md`

| Historical claim group | Verdict | Verified disposition |
| --- | --- | --- |
| Structured result to deterministic CNL including ANSWER/VALID/EVIDENCE and incompleteness | CURRENT | `sop/cnl.mjs:8-25`; `docs/specs/DS004-sop.md:69-73`. |
| CNL status must distinguish unknown/refuted, possible/entailed, temporal conflict and hypothetical evidence | CURRENT | `sop/cnl.mjs:5-16,24-25`; `docs/specs/DS010-common-contracts.md:26-40`. |
| CNL can be used without a second presentation model; only RO/EN templates supplied | CURRENT | `sop/cnl.mjs:4-10,25-25`. |
| Neural verbalizer receives only CNL and is semantically checked before delivery | MISSING | Described as a proposal without complete verifier (`probably_obsolete/legacy/requirements/10-cnl.md:5-11`); implemented deterministic renderer is `sop/cnl.mjs:4-25`; no neural inference is authorized. |
| Multilingual aliases do not automatically supply grammatical CNL in each alias language | CURRENT | The historical warning remains correct: alias lookup is language-qualified (`sop/lexicon.mjs:11-13`), but deterministic CNL message tables only cover `ro`/`en` (`sop/cnl.mjs:4-10`; `probably_obsolete/legacy/requirements/10-cnl.md:9-11`). |

### `11-ingestie.md`

| Historical claim group | Verdict | Verified disposition |
| --- | --- | --- |
| UTF-8 extracted text workspace with source and manifest hash, not universal PDF/DOCX converter | CURRENT | `tools/prepare-document.mjs:2-3`; `tools/ingest-sop.mjs:4-6`. |
| `reviewed:true` and `--reviewed` are administrative assertions, not cryptographic proof of semantic truth | CURRENT | `sop/ingest.mjs:7-10`; `tools/ingest-sop.mjs:4-6`; `docs/specs/DS004-sop.md:81-85`. |
| Quoted source spans and hashes checked by importer when manifest is supplied; import accepts only declarative knowledge | CURRENT | `tools/ingest-sop.mjs:4-6`; `sop/ingest.mjs:7-13`. |
| Any coding-agent proposal, document instruction or generated SOP can directly publish executable methods | SUPERSEDED | **Session replacement:** source/model text has no publication authority; approved host review, authorization and relevant scoped probes govern publication (`docs/specs/DS004-sop.md:73-85`; `sop/ingest.mjs:7-15`). |
| A model-authored `source` on a conversational fact establishes documentary provenance | SUPERSEDED | **Session replacement:** model only emits provenance-free conditional `premise`; document provenance arises through a reviewed source workspace and importer (`sop/parser.mjs:10-11`; `sop/declarative.mjs:8-23`; `tools/ingest-sop.mjs:4-6`). |
| Reusable approved templates and rule libraries are exact hashed definitions | CURRENT | `sop/ingest.mjs:9-13`; `sop/runtime.mjs:20-32`. |
| Session/fork/commit controls are separate from in-session recording | CURRENT | `docs/specs/DS003-main-behavior.md:30-36`; `sop/runtime.mjs:168-175`. |
| Source-rights clearance is implied by a hash, review flag or software license | SUPERSEDED | **Session replacement:** only assets marked `cleared` or `permissive-attribution` by DS018 may be ingested/exported/published with duties; QA2D data, ProofWriter, QQP and AmbigQA are quarantined (`docs/specs/DS018-source-rights.md:21-38`). |
| General autonomous discovery of correct rules from arbitrary documents | MISSING | Historical chapter denies it (`probably_obsolete/legacy/requirements/11-ingestie.md:32-36`); implemented importer validates supplied reviewed declarations, not autonomous correctness (`sop/ingest.mjs:7-15`). |

## Current normative boundary (verified)

1. **Layering and authority.** A conversational formalizer MUST author only `premise`, `query`, and `constraint`; the host MUST validate those declarations and compile approved `resolve`, `pack`, `solve`, `cnl`, `remember`, and when required `clarify`. A model `premise` is conditional interpreted context, not a sourced `fact` or a write; original text and interpretation origin belong to the host. `remember` is the sole trusted recording wire, and a session write is distinct from publication or commit. `sop/declarative.mjs:8-23,74-112,123-144`; `sop/runtime.mjs:168-175`; `docs/specs/DS004-sop.md:16-22,69-85`.
2. **SOP semantics.** Executable atoms MUST be whitespace-separated with 1–4 terms; parentheses are invalid. `$` consumes a wire value; `~` refers to an approved definition; `?` is local to a logical problem unless a trusted output port materializes it. Quoted atom strings MUST NOT be assumed to shield variable-shaped text. Explicit contrary evidence is not negation by absence. A selected constraint scalar MUST be verified unique across admitted solutions, even if a separate claim is entailed; unresolved required inputs cause host clarification with `pendingSop`, `required`, and `next`, whereas mere lack of answer remains `unknown`. `sop/parser.mjs:47-67,95-113`; `sop/outputs.mjs:25-50`; `reasoning/backends/constraints.mjs:5-12,17-33`; `sop/declarative.mjs:45-49,123-144`; `docs/specs/DS004-sop.md:35-45`.
3. **Runtime phases.** The parser MUST reject unsupported fields and malformed atoms; graph validation resolves dependencies/output reservations; the host scheduler executes ready wires by waves, then applies authorized effect batches and validates append-only generated wires with epoch bounds. A read that must observe a prior write needs a declared dependency: textual order is insufficient. Atomicity is per effect batch, not across the whole turn. A missing/nonunique scalar MUST block its dependents rather than choose the first row. `sop/parser.mjs:68-113`; `sop/runtime.mjs:24-34,50-60,92-111,168-179`; `memory/repository.mjs:97-105`.
4. **Lexicon and scoped synonyms.** Approved aliases are looked up by explicit language and symbolic kind, optionally exact entity type/domain. Exact normalized forms precede accent-folded fallback; ambiguity MUST remain explicit, and lexical scores are ranking hints, not truth. `is_a` metadata, similar names and implication between predicates MUST NOT silently merge identities or install inference rules. A reviewer and evidence are required for an alias change; collisions cannot silently merge IDs. `sop/lexicon.mjs:5-39`; `tools/review-alias.mjs:2-4`; `docs/specs/DS004-sop.md:51-67`.
5. **Time.** Validity and knowledge time MUST remain distinct: `valid` with `at`/`during` versus host-known `knownAt` with `asof`. Intervals are half-open `[from, until)`; plain dates and explicit timestamps use UTC, and a time of day without its date/time zone is not guessed. Ending one identified claim does not assert its negation or end other claims; corrections target claim IDs and retain a known-at history. `lib/time.mjs:2-13`; `sop/lower.mjs:13-21`; `memory/temporal.mjs:78-78,89-107`; `sop/runtime.mjs:41-41,168-175`.
6. **Backend routing and CNL.** Memory retrieval and reasoning route are independent; reference reasoning uses bounded JS, advanced reasoning MAY select SWI for suitable point-in-time Horn or Z3 for integer constraints when available, and the actual route/fallback MUST be reported. Unsupported explicit backends MUST NOT quietly switch engines. Numeric satisfiability MUST NOT be verbalized as necessary truth; CNL reports checked status, projected values, validity and evidence deterministically in RO/EN. `reasoning/registry.mjs:15-17,29-52`; `reasoning/backends/constraints.mjs:5-12,15-33`; `sop/cnl.mjs:4-25`; `docs/specs/DS012-strategy-backend-matrix.md:6-21`.
7. **Ingestion and publication.** Import MAY publish only reviewed declarative knowledge with required hashes and exact quotes verified against retained source material; source instructions have no administrative authority. A review flag or matching hash alone does not certify semantic correctness, permission or source rights. Only DS018 `cleared`/`permissive-attribution` assets MAY be ingested, exported or published with recorded attribution duties; QA2D data, ProofWriter, QQP and AmbigQA MUST stay quarantined. Formalizer evaluation rows and trusted system circuits MUST be kept in distinct `evaluation_track` categories. No training is authorized and the corpus is not training-qualified. `sop/ingest.mjs:7-15`; `tools/ingest-sop.mjs:4-6`; `docs/specs/DS018-source-rights.md:21-38`; `docs/specs/DS010-common-contracts.md:14-20`.

## Historical intent, not delivered current guarantees

General reactive wire redefinition, global turn rollback, arbitrary inferred identity merge, general morphology, exhaustive multilingual model understanding, an Event Calculus, uncertain temporal worlds, exhaustive Z3 enumeration and a checked neural verbalizer are **historical intent only**, not requirements or claimed implementation (`probably_obsolete/legacy/requirements/02-runtime.md:7,22,28-30`; `probably_obsolete/legacy/requirements/04-lexicon.md:29-39,53-59`; `probably_obsolete/legacy/requirements/05-timp.md:33-37`; `probably_obsolete/legacy/requirements/06-backenduri.md:52-58`; `probably_obsolete/legacy/requirements/10-cnl.md:5-11`). Historical model-authored executable examples and fine-tuning suggestions have instead been **superseded** by the current-session authority boundary above.
