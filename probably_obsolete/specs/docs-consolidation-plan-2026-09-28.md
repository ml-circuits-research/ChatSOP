> ARCHIVED 2026-09-28 — the documentation consolidation plan, executed on 2026-09-28 with the owner overrides recorded in CHANGES.md and status/journal.jsonl. The resulting id map is docs/specs/aliases.json. Ids inside this file use the numbering of the time.

# Documentation consolidation plan (read-only survey, 2026-09-28)

Working report, not product documentation. Nothing in this plan has been applied: no file was moved, edited or deleted while it was written. Other agents were editing docs and specs during the survey, so re-run the reference counts (Appendix A script) immediately before execution. The counts in Appendix B were re-grepped at the end of this survey.

## 0. Yardstick: the current principles

Every kept document must agree with these principles. The "conflicts" notes in the table below cite them as P1–P10.

| # | Principle |
| --- | --- |
| P1 | There is one small-model language, with no versions or profiles. Wording such as `sop-agent-3`, `sop-agent-4`, "model profile", "transition window" or "legacy evaluation" is obsolete. |
| P2 | The model sees only the user message. |
| P3 | The model emits quoted strings and roles from a closed set, using `stated`/`assumed`/`unclear`/`query`/`constraint` (DS041). |
| P4 | The host links the strings to knowledge. |
| P5 | The model never refuses. |
| P6 | `unclear` has only two kinds: `gibberish` and `no_request`. |
| P7 | `premise` and the shortlist are removed. They are not "retired but kept for trusted circuits". |
| P8 | `allowJsEval` is removed. |
| P9 | Sources are de-quarantined as inspiration: inspired-by corpora are released, and the no-copy check applies. |
| P10 | The project journal lives in `status/` (`journal.jsonl`, `experiments.json`), and the server has `/audit`, `/eval` and `/project`. |

Survey facts behind the table:
- A term scan per file (profile or `sop-agent-N` / `premise` / `shortlist` / `allowJsEval` / `quarantin`) found P1 or P7 conflicts in 38 of the 43 spec files.
- No spec documents `/eval` or `/project`. DS016 lists only `/`, `/chat`, `/audit`, `/admin` and `/login`, although `server/eval-guide.mjs` and `docs/partials/header.html` already exist.
- `allowJsEval` still appears in `docs/wire_typs/jsEval.html`, `docs/wire_typs/value.html` and the wire-redesign proposal.

## 1. Decision table

Decisions: **KEEP** (current and normative, but every "conflicts" note still needs a rewrite), **MERGE**, **ARCHIVE** and **DELETE**. In the reference column, "refs" is the number of *other* files that cite the id or path as of the final re-grep. Appendix B has the per-file list.

### 1.1 Specifications (`docs/specs/`)

| file | decision | target | reason | references to update (count) |
| --- | --- | --- | --- | --- |
| DS000-vision.md | KEEP | DS000 | This is the vision and trust boundary. Conflicts: it says the formalizer proposes `premise/query/constraint` (P3, P7). It gains the research question from DS025 §"Research question and intended contribution" (lines 10–25). | 11 files (id unchanged; content only) |
| DS001-coding-style.md | KEEP | DS001 | This is the authoritative style contract. The only change is to remove the "SOP profile" wording (P1). | 5 (unchanged) |
| DS002-architecture.md | KEEP | DS002 | Conflicts: P7 (premise). Add `status/` (P10). `docs/index.html` "Where work belongs" duplicates §"Directory responsibilities" and should link here instead. | 6 (unchanged) |
| DS003-main-behavior.md | KEEP | DS003 | Conflicts: P7. Add a row for "project journal and evaluation pages" (P10). | 5 (unchanged) |
| DS004-sop.md | KEEP | DS004 | This is the grammar and execution contract. Conflicts: Introduction ¶2 ("parser profile `sop-agent-4` … `sop-agent-3` remains … transition window") breaks P1/P7, and there are shortlist mentions (P7). It gains the "SOP profile" row of DS010 "Common boundaries", rewritten to the single language. | 32 (unchanged) |
| DS005-memory.md | KEEP | DS005 | §"Legacy H7 and RecallSOP reference audit (2026-09)" (line 24 to end) is a historical register. **Archive that section** to `probably_obsolete/references/reference-audit.md`, together with `doubts/docx-references.md`. | 16 (unchanged) |
| DS006-reasoning.md | KEEP | DS006 | Same as DS005: archive §"Legacy RecallSOP and H7 reasoning boundary (2026-09)" (line 34 to end). It absorbs DS012 in full and the DS010 "Executable decision table" + "DEFAULT with an exception and no-support control" (DS010 lines 22–59). Conflicts: 9 `premise` mentions (P7). | 21 (unchanged) |
| DS007-training.md | KEEP | DS007 | Conflicts: "`sop-agent-4`", "(the legacy `sop-agent-3` target used `premise` …)" (P1, P7). | 14 (unchanged) |
| DS008-data-evaluation.md | KEEP | DS008 | It absorbs DS013 §"Authoring contract" and §"Split policy and observed overlap", the DS010 "Semantic case" row, and the `eval/README.md` §"Evaluation tracks". Conflicts: ¶"Data rights and provenance" says the sources are "acquisition candidates … keep uncertain extractions quarantined", which contradicts P9. That paragraph must point to DS014-new (old DS018). | 21 (unchanged) |
| DS009-query-curriculum.md | KEEP | DS009 | It absorbs DS022 (the generator) and DS026 (the v2 inventory) as sections. The Introduction ¶1 docx reconciliation and §"Reconciliation decisions" are historical and move to the archived DS023. Conflicts: 9 profile and 10 premise mentions (P1, P7). The whole spec must be rewritten when the DS042 regeneration lands. | 14 (unchanged) |
| DS010-common-contracts.md | MERGE | Rows go to DS004 (SOP profile), DS008 (semantic case), DS010-new (experiment identity) and DS006 (decision table) | Every row is phrased against `PROFILE='sop-agent-3'` and `premise`, so it describes a superseded design as current (P1, P7). Its content already belongs to the owning specs. | 8 |
| DS011-experiment-preregistration.md | KEEP | **DS010** | It absorbs DS025 §"Controlled experiments to preregister" (26–37) and §"Publication route and evidence obligations" (38–47). `status/experiments.json` and `lib/journal.mjs` cite it (P10). | 12 |
| DS012-strategy-backend-matrix.md | MERGE | DS006 (new §"Strategy × backend matrix") | Its introduction repeats DS006 §"Strategy contract" and AGENTS rule 8. The table, `hybrid` settings and reinforcement boundary move as three subsections. | 9 |
| DS013-case-authoring.md | MERGE | DS008 (authoring contract, split policy), DS009 (the §"Frozen current family/operator inventory", lines 16–39), DS020-new (the "Status: Markdown authoring retired" paragraph, which duplicates DS040 §Decision, so drop it) | The spec has already shrunk to a residue after the Markdown retirement. | 7 |
| DS014-material-sources.md | KEEP | **DS011** | This is the ingestion contract, and it has no principle conflicts. | 9 |
| DS015-solver-qualification.md | MERGE | DS013-new (old DS017), new §"Solver qualification" | Both are "fresh local run" comparison reports with the same evidence rules (skipped ≠ inferred; `advanced` is not a solver). | 5 |
| DS016-local-server.md | KEEP | **DS012** | Conflicts: "model (profile `sop-agent-4`)" (P1). Missing `/eval`, `/project` and the `status/` journal (P10). Its "Serving profile" `promptProfile formal/bare` is a prompt choice, not a language profile. Rename it to avoid clashing with P1. It has no YAML front matter, so normalize it. | 10 |
| DS017-engine-comparison.md | KEEP | **DS013** (rename `engine-and-solver-comparison`) | It absorbs DS015. | 7 |
| DS018-source-rights.md | KEEP | **DS014** | This is the rights authority (AGENTS rule 10). The dated sections "Research-mode acquisition…" (74–101), "Expanded research-only source acquisition…" (102–126) and "Larger source-only splits" (127–) are journal-style history. Move them to `probably_obsolete/specs-history/DS018-dated-sections.md` and keep the decision, status vocabulary, verified rows, rules and no-copy check (P9). `datasets/SOURCES.md` §Decision duplicates the owner-decision section and should link here. | 38 (the most-cited renumbered id) |
| DS019-independent-corpus.md | KEEP | **DS015** | This is a corpus card. It has no front matter, so normalize it. The P7 conflict follows from its corpus (premise-era gold), and the spec needs a rewrite at regeneration. | 6 |
| DS020-evaluation-metrics.md | KEEP | **DS016** | Metric definitions. Conflicts: 2 premise mentions (P7). No front matter, so normalize it. | 8 |
| DS021-skill-systems.md | KEEP | **DS017** | Conflicts: 5 premise mentions (P7). The "P2.5–P2.7" labels are TODO-phase ids, so drop them from the heading. | 4 |
| DS022-question-curriculum-generator.md | MERGE | DS009 (new §"Question curriculum generator") | This is a projection tool over the DS009 source cases. It has no front matter. | 6 |
| DS023-nl-sop-dataset.md | ARCHIVE | `probably_obsolete/vision/DS023-nl-sop-dataset.md` | It is a passage-by-passage coverage register of two archived `.docx` files, the same kind of document as DS027–DS030. It has 4 quarantine and 4 premise mentions (P7, P9). The open item is already in doubts.md, which moves to questions.md. | 10 |
| DS024-small-language-scope.md | MERGE | DS021-new (old DS041) | §"What the small model may author today" (12–25) duplicates the DS041 Scope. §"Explicit non-goals", §"Is the current construct set sufficient?", §"Conservative checklist for a future construct" and §"Host-rendered explanation" move to DS041 as "Scope, non-goals and extension checklist". §"Proposals considered" and §"Rejected in this session" go to the archive with the wire proposal. Conflicts: P1 and P7 (shortlist). | 10 |
| DS025-research-direction-and-publication.md | MERGE + ARCHIVE | Research question → DS000. Experiments and publication obligations → DS010-new. §"Legacy statement verdict register" (48–end) → `probably_obsolete/article-direction/DS025-verdict-register.md` | It mixes forward direction with a historical manuscript audit. | 9 |
| DS026-query-corpus-v2.md | MERGE | DS009 (new §"Query corpus v2") | This is an inventory of one corpus in the DS009 curriculum. §"Legacy identifiers kept for provenance" stays verbatim. | 7 |
| DS027-legacy-architecture-language.md | ARCHIVE | `probably_obsolete/legacy/registers/DS027-legacy-architecture-language.md` | This is a legacy consolidation register (owner decision). | 10 |
| DS028-legacy-reasoning-and-operations.md | ARCHIVE | `probably_obsolete/legacy/registers/…` | Same as DS027. | 5 |
| DS029-legacy-data-memory-and-release.md | ARCHIVE | `probably_obsolete/legacy/registers/…` | Same as DS027. | 2 |
| DS030-legacy-index-and-contracts.md | ARCHIVE | `probably_obsolete/legacy/registers/…` | Same as DS027. It also indexes `probably_obsolete/legacy/*`, so `probably_obsolete/README.md` must link the new location. | 9 |
| DS031-qa-proposition-corpus.md | MERGE | DS018-new (old DS035), §"QA proposition corpus" | DS035 already summarises all four inspired-by corpora. The four cards overlap on the provenance and rights paragraphs, which repeat DS018/P9 four times. Keep only the measured tables. | 5 |
| DS032-proof-structure-corpus.md | MERGE | DS018-new, § "Proof-structure corpus" | Same as DS031. | 4 |
| DS033-paraphrase-contrast-corpus.md | MERGE | DS018-new, § "Paraphrase-contrast corpus" | Same as DS031. Its "QQP data remain quarantined" wording must become the inspired-by wording (P9). | 2 |
| DS034-ambiguity-resolve-corpus.md | MERGE | DS018-new, § "Ambiguity-resolve corpus" | Same as DS031. | 4 |
| DS035-research-experiment-corpus.md | KEEP | **DS018** (rename `research-corpora`) | It is the target of DS031–DS034. Its §"Source-grounded counterparts (2026-09-28)" (70–89) moves to DS019-new. Conflicts: "target contains only `premise`, `query` and `constraint`" (P3, P7). | 6 |
| DS036-grounded-proof.md | KEEP | **DS019** (rename `grounded-corpora`) | It is the target of DS037–DS039 and DS035 §70–89. The four grounded builders share one method (analyse source shape, compose original text). | 5 |
| DS037-grounded-proposition.md | MERGE | DS019-new, § "Proposition" | Same method as DS036. Its line "the cache stays research-only" must be checked against P9. | 3 |
| DS038-grounded-paraphrase.md | MERGE | DS019-new, § "Paraphrase" | Same as DS037. | 3 |
| DS039-grounded-ambiguity.md | MERGE | DS019-new, § "Ambiguity" | Same as DS037. It has no front matter. | 4 |
| DS040-corpus-audit-tool.md | KEEP | **DS020** | This is the audit contract (AGENTS rule 11). Conflicts: 4 shortlist mentions (P7) and 3 premise mentions. | 19 |
| DS041-stated-assumed-unclear.md | KEEP | **DS021** (rename `model-surface`) | This is the core normative spec. Conflicts: the title "(model profile `sop-agent-4`)", the Scope ¶3 transition window, and the §"`query` in `sop-agent-4`" / "`constraint` in `sop-agent-4`" headings (P1). "`premise` is retired…kept for trusted circuits" must become "removed" (P7). `MODEL_PROFILES` in the implementation list is a code-level P1 conflict. It absorbs DS024. | 56 (the most-cited file) |
| DS042-diversity-generator.md | KEEP | **DS022** | This is the regeneration design. Conflicts: 5 profile mentions (P1). | 4 |
| matrix.md | KEEP (regenerate) | — | Rebuild it from the new file set, and add a "formerly" column so historical citations resolve (see §3). Its DS018 row says "quarantine rule" (P9). | loaded by `docs/specsLoader.html`; tested by `tests/server-http.test.mjs:274` |
| proposals/wire-redesign-2026-09-28.md | ARCHIVE | `probably_obsolete/proposals/wire-redesign-2026-09-28.md` | Its own banner says the implemented parts live in DS041 and §3 is SUPERSEDED (shortlist, identifiers, lexicon roles). It has 25 premise, 8 shortlist and 4 `allowJsEval` mentions, and it describes superseded designs. Before archiving, copy the still-open items into `questions.md`/`TODO.md`: §2.1 `source` overload, §2.7 naming collisions, §6 Phase 3–4 host renames and §7 open questions. `tools/verify-vocabulary.mjs:16` special-cases `docs/specs/proposals/`, so update or remove that exemption. | 3 |

### 1.2 Root documents and `doubts/`

| file | decision | target | reason | references to update (count) |
| --- | --- | --- | --- | --- |
| README.md | KEEP | — | This is the entry point. Conflicts: 9 profile, 2 premise and 1 shortlist mentions (P1, P7). Add `/eval`, `/project` and `status/` (P10). | — |
| AGENTS.md | KEEP | — | Rewrite Scope ("model profile `sop-agent-4`; legacy `sop-agent-3` …") and rule 5 ("`premise` is the retired `sop-agent-3` form") for P1/P7. Rewrite reading-order item 2 to the new numbering and delete item 4 (legacy registers become archive-only). Add the `status/` journal to Scope (P10). The DS id list is the largest single rewrite (40 id occurrences). | self |
| TODO.md | KEEP | — | This is the working tracker, not product docs. Fix the `DS013–DS030` and `DS031–DS039` ranges at line 41 by hand. | 10 ids |
| CHANGES.md | KEEP | — | This is the user-facing change log. Rewrite its DS links to the new ids (ranges at lines 15/17/19 by hand), and append one entry for this consolidation. Line 1 describes `premise` "kept for trusted circuits" and "legacy `sop-agent-3` evaluation" (P1/P7); leave it historical but add the new entry above it. | 14 ids |
| PAS_TASK.md | ARCHIVE (owner confirm) | `probably_obsolete/journal/PAS_TASK-until-2026-09-28.md` | P10 makes `status/journal.jsonl` the project journal. PAS_TASK.md is a second, prose journal (239 lines) that repeats CHANGES/DS content. AGENTS Scope still names it, so this needs a `questions.md` decision and an AGENTS edit. If the owner keeps it, freeze its old entries and do not renumber them. | 27 ids; cited by AGENTS, TODO |
| doubts.md | MERGE → ARCHIVE | Open items → `questions.md` (with stable IDs, options, recommendation and an empty answer line, as AGENTS requires). The file then goes to `probably_obsolete/doubts/doubts.md`. | AGENTS now names `questions.md` as the only open-question file. Item 1 still cites the "model authors only `premise`" boundary (P7), so re-evaluate whether it still applies under DS041/host `clarify`. | cited by TODO.md, probably_obsolete/README.md |
| doubts/docx-direction.md | ARCHIVE (after moving the open questions to questions.md) | `probably_obsolete/article-direction/open-questions.md` | These are questions about the archived manuscripts, and they belong next to their sources. | 1 |
| doubts/docx-references.md | ARCHIVE | `probably_obsolete/references/reference-audit.md` (together with the DS005/DS006 legacy sections) | This is a legacy audit register, not an open question. It has 4 premise mentions. | 1 |
| doubts/docx-vision.md | DELETE | — | It is a verbatim restatement of doubts.md item 1 (same `.docx` passage, same question), and that item moves to questions.md. It adds no evidence beyond line citations that stay in the archived DS023. | 0 |
| questions.md | KEEP | — | AGENTS requires it. It is in Romanian while AGENTS requires English for persistent docs, so flag it for the owner. It must receive the doubts.md and wire-proposal open items. | — |
| dependencies.md | KEEP | — | This is the dependency record required by DS001/AGENTS. The one "profile" hit refers to runtime config profiles, which is not a P1 conflict. | 2 ids |

### 1.3 Other READMEs

| file | decision | target | reason | references to update (count) |
| --- | --- | --- | --- | --- |
| eval/README.md | KEEP (shrink) + MERGE | §"Evaluation tracks" (5–14) → DS008; §"Registry and leakage boundary" (31–49) → DS008 §"Target faithfulness … sealed-test boundary" (it duplicates it) | Keep only §Layout and a link list. Its tracks paragraph defines the model surface as "`premise`, `query`, and `constraint`" (P3/P7), which is superseded content presented as current. | ids present; rewrite |
| skills/README.md | KEEP | — | AGENTS requires the catalog, and it does not duplicate spec content. Check the one DS range in `skills/reasoning-review/SKILL.md` (`DS027–DS030`). | 13 skill files cite DS ids (Appendix B) |
| datasets/SOURCES.md | KEEP (shrink) | Replace §Decision with a link to DS014-new (old DS018) | AGENTS rule 10 names it as the per-source list (URL, licence, taken/not taken). The decision prose duplicates DS018 verbatim, and one copy should win. | 2 ids |
| probably_obsolete/README.md | KEEP (update) | — | This is the archive index. It is not frozen, and its links to DS023/DS025/DS027–DS030 must point to the new archive paths. | 11 ids |

### 1.4 HTML pages (`docs/*.html`, `docs/wire_typs/`)

| page | decision | what moves or links |
| --- | --- | --- |
| index.html | KEEP | Keep the documentation map and the flow diagram. Replace "Where work belongs" (directory prose) with one sentence linking DS002 §"Directory responsibilities" and DS001. |
| runtime.html | KEEP (rewrite) | ¶"Execution and publication" still says "The model-origin surface admits only `premise`, `query`, and `constraint`" and explains `premise`/`valid timeless`. That is a superseded design presented as current (P3, P7). Reduce it to a narrative walkthrough that links DS004 (grammar), DS006 (routing, with the DS012 content), DS012-new (the server: pages and `/eval`/`/project`, P10) and DS021-new (model surface). The CLI command list stays here only if DS003 drops its copy. Choose one owner (recommended: DS003) and link the other. |
| training.html | KEEP (rewrite) | It duplicates DS007 roles and DS008 split rules nearly sentence for sentence. It still describes "legacy `sop-agent-3` targets" and "shortlist" (P1, P7) and says unverified assets "stay quarantined" without the inspired-by release (P9). Keep a short overview and link DS007/DS008/DS014-new/DS021-new/DS022-new. |
| wiki.html | KEEP | It is the canonical terminology source (AGENTS). Remove 13 premise and 9 profile mentions. §"Where these responsibilities live in the current code" duplicates DS002, so link it instead. |
| wire_types.html, wire_typs/*.html | KEEP | These are the per-wire reference. `premise.html` should be ARCHIVED (`probably_obsolete/docs/wire_typs/premise.html`) once P7 is enacted in code. Otherwise it describes a "legacy transition window" (P1). `jsEval.html` and `value.html` must drop `allowJsEval` (P8). `small-model.html` (3 hits) and 17 host-wire pages carry a one-line "not model-authored in `sop-agent-3`" style mention (P1). |
| specsLoader.html, partials/* | KEEP | These are infrastructure. `specsLoader` fetches `specs/<file>`, so it needs no change beyond the renamed filenames it receives from matrix.md. Consider teaching it the alias map (§3) so old `?spec=DS041-…` links redirect. |

Stray `.md` under `docs/`: the only non-spec Markdown is `docs/specs/proposals/wire-redesign-2026-09-28.md` (ARCHIVE above). `docs/partials/*.html` and `docs/assets/*` are not docs.

### 1.5 Decision counts (Markdown files only)

| decision | count | files |
| --- | ---: | --- |
| KEEP | 34 | 23 surviving specs (DS000–DS009, DS011, DS014, DS016–DS021, DS035, DS036, DS040–DS042), matrix.md, README, AGENTS, TODO, CHANGES, questions, dependencies, eval/README, skills/README, datasets/SOURCES, probably_obsolete/README |
| MERGE | 17 | DS010, DS012, DS013, DS015, DS022, DS024, DS025 (merge + archive), DS026, DS031–DS034, DS037–DS039, doubts.md (merge → archive) |
| ARCHIVE | 9 | DS023, DS027–DS030, proposals/wire-redesign, PAS_TASK.md (owner confirm), doubts/docx-direction.md, doubts/docx-references.md; plus the section-level archives in DS005, DS006, DS018 and DS025 |
| DELETE | 1 | doubts/docx-vision.md |

DS025 and doubts.md are counted once, under MERGE. After consolidation, 23 specs remain (DS000–DS022), down from 43.

## 2. Renumbering map

The map keeps the existing relative order and closes every gap. **Every** id from old DS011 upward changes, and several new ids reuse old numbers with a different meaning. For example, new DS010 is old DS011, and new DS014 is old DS018. A naive sequential `sed` would therefore chain-rewrite. The replacement must be a **single-pass lookup** (§4).

| old id (file) | new id / status | new file |
| --- | --- | --- |
| DS000 vision | DS000 | DS000-vision.md |
| DS001 coding-style | DS001 | DS001-coding-style.md |
| DS002 architecture | DS002 | DS002-architecture.md |
| DS003 main-behavior | DS003 | DS003-main-behavior.md |
| DS004 sop | DS004 | DS004-sop.md |
| DS005 memory | DS005 | DS005-memory.md |
| DS006 reasoning | DS006 | DS006-reasoning.md |
| DS007 training | DS007 | DS007-training.md |
| DS008 data-evaluation | DS008 | DS008-data-evaluation.md |
| DS009 query-curriculum | DS009 | DS009-query-curriculum.md |
| DS010 common-contracts | MERGED → DS004/DS006/DS008/DS010 | — |
| DS011 experiment-preregistration | **DS010** | DS010-experiment-preregistration.md |
| DS012 strategy-backend-matrix | MERGED → DS006 | — |
| DS013 case-authoring | MERGED → DS008 (+DS009, DS020) | — |
| DS014 material-sources | **DS011** | DS011-material-sources.md |
| DS015 solver-qualification | MERGED → DS013 | — |
| DS016 local-server | **DS012** | DS012-local-server.md |
| DS017 engine-comparison | **DS013** | DS013-engine-and-solver-comparison.md |
| DS018 source-rights | **DS014** | DS014-source-rights.md |
| DS019 independent-corpus | **DS015** | DS015-independent-corpus.md |
| DS020 evaluation-metrics | **DS016** | DS016-evaluation-metrics.md |
| DS021 skill-systems | **DS017** | DS017-skill-systems.md |
| DS022 question-curriculum-generator | MERGED → DS009 | — |
| DS023 nl-sop-dataset | ARCHIVED | probably_obsolete/vision/DS023-nl-sop-dataset.md |
| DS024 small-language-scope | MERGED → DS021 | — |
| DS025 research-direction | MERGED → DS000 + DS010; register ARCHIVED | probably_obsolete/article-direction/DS025-verdict-register.md |
| DS026 query-corpus-v2 | MERGED → DS009 | — |
| DS027–DS030 legacy registers | ARCHIVED | probably_obsolete/legacy/registers/DS027…DS030 (filenames unchanged) |
| DS031–DS034 corpus cards | MERGED → DS018 | — |
| DS035 research-experiment-corpus | **DS018** | DS018-research-corpora.md |
| DS036 grounded-proof | **DS019** | DS019-grounded-corpora.md |
| DS037–DS039 grounded cards | MERGED → DS019 | — |
| DS040 corpus-audit-tool | **DS020** | DS020-corpus-audit-tool.md |
| DS041 stated-assumed-unclear | **DS021** | DS021-model-surface.md |
| DS042 diversity-generator | **DS022** | DS022-diversity-generator.md |

The map is stored as `docs/specs/aliases.json`: `{ "DS041": {"to":"DS021","file":"DS021-model-surface.md"}, "DS024": {"merged":"DS021","section":"scope-non-goals-and-extension-checklist"}, "DS027": {"archived":"probably_obsolete/legacy/registers/DS027-legacy-architecture-language.md"}, … }`. The map is the input of the rewrite script and the dangling-reference check. It also lets `specsLoader.html` and the `/project` page resolve the old ids in `status/journal.jsonl`.

**Alternative (lower churn).** Stop at the archives and merges and accept gaps. This violates AGENTS "gap-free". A middle path is to renumber only the tail: move DS035/DS036/DS040/DS041/DS042 into the freed slots and leave DS011–DS021 alone. That still renumbers the two most-cited late ids and leaves gaps, so it is not recommended.

## 3. Frozen versus live files

- **Frozen (never rewritten).** These are checked against `aliases.json` instead:
  - `probably_obsolete/**`, except `probably_obsolete/README.md`
  - `status/journal.jsonl` (append-only)
  - `eval/reports/history/**`
  - the archived spec files themselves
  - `PAS_TASK.md`, if it is archived
- **Regenerated, not hand-edited:**
  - `sop/contracts/wires.json` and `sop/contracts/wire-fields.md`, via `node tools/capabilities.mjs --write`. Update the comments in `sop/parser.mjs`/`sop/declarative.mjs` first.
  - `eval/reports/current/**`
  - the dataset `manifest.json`/`report.json`/`build-report.json` and `datasets/query-profile.json`. Their DS strings originate in `tools/datasets/*.mjs`. Rewrite the builder source, then either rebuild (symbolic execution only, no training) or apply the same rewrite and rerun the validators to confirm that no checksum covers the changed text.
- **Live (rewritten):** everything else that the Appendix B lists (docs, AGENTS, README, TODO, CHANGES, skills, code comments, tests, config/ontology.sop, lib/journal.mjs, status/experiments.json, server/eval-guide.mjs).

## 4. Ordered execution steps

1. **Freeze window.** Wait until the concurrent doc and spec agents finish, then work on a branch. Re-run `appendix-a.sh` (below) and diff it against Appendix B. Every new citation (for example `server/eval-guide.mjs` and `eval/reports/current/no-context-sweep.json` appeared during this survey) must be in scope.
2. **Owner decisions** in `questions.md`, each with a recommendation:
   - (a) archive PAS_TASK.md in favour of `status/journal.jsonl`
   - (b) accept the merged corpus-card specs DS018/DS019
   - (c) choose the canonical owner of the CLI list (DS003 vs runtime.html)
   - (d) remove `premise` from the runtime entirely (P7), versus only from docs
3. **Harvest open items** before anything moves: move doubts.md, doubts/docx-direction.md and wire-proposal §2/§6-Phase 3–4/§7 into `questions.md`/`TODO.md`.
4. **Content merges, under old numbers.** For each MERGE row, paste the named sections into the target and adapt the wording to P1–P10. Leave a one-line tombstone at the top of each source ("merged into DSxxx §…") until step 7. Do this before renumbering so that section anchors are known.
5. **Principle rewrite of KEEP docs**, grep-driven. The residual count of `sop-agent-[34]|model profile|transition window|premise|shortlist|allowJsEval` must end at 0 outside frozen files, except where a sentence explicitly says "removed". Apply the same rewrite to `docs/*.html` and `docs/wire_typs/*.html`, including the P10 additions to DS012-new/README/runtime.html.
6. **Archive moves** (`git mv`, preserving history): DS023, DS027–DS030, the proposal, the doubts files, PAS_TASK (if approved), the extracted legacy sections of DS005/DS006/DS018/DS025, and `wire_typs/premise.html` (if (d) is approved). Add a banner "ARCHIVED 2026-09-28 — superseded by …" at the top of each moved file (the only edit allowed on archived files), and add a row per file to `probably_obsolete/README.md`. `git rm` `doubts/docx-vision.md` and the merged sources.
7. **Renames.** `git mv` the surviving specs to their new filenames from `aliases.json`. Normalize the front matter (`title` equals the new basename) of DS016/DS019/DS020/DS022-old/DS039-old successors.
8. **Reference rewrite script.** This is a one-off `tools/docs/renumber-specs.mjs` in scratch or under `tools/`:
   - It enumerates `git ls-files -co --exclude-standard` and filters out binaries, frozen paths, `datasets_sources/`, `models/` and this plan file.
   - It uses a single regex, `/\bDS0(\d{2})(-[a-z0-9-]+\.md)?/g`, with a replacement callback that looks up `aliases.json`:
     - A renamed id or filename gets its new id or filename.
     - A MERGED id becomes `DSnnn` of the target, rewritten to `…/DSnnn-file.md#section` when it was a link, and logged for manual review.
     - An ARCHIVED filename link becomes its `probably_obsolete/…` relative path, adjusted for the citing file's directory. A bare ARCHIVED id is logged and left alone for a human to rephrase.
   - It handles `specsLoader.html?spec=`, relative `(DS018-source-rights.md)` links and `docs/specs/…` paths.
   - It detects ranges (`DS0xx–DS0yy`) and does not rewrite them automatically. There are 9 known ranges: CHANGES.md:15,17,19; PAS_TASK.md:21,97,165; TODO.md:41 (×2); skills/reasoning-review/SKILL.md:8.
   - `--dry-run` prints per-file replacement counts, which must equal Appendix B for the renumbered ids. `--apply` writes the changes.
9. **Regenerate:** `matrix.md` (from the front matter, with a "formerly" column), `node tools/capabilities.mjs --write`, the dataset reports and manifests (or validator-confirmed rewrite), and `eval/reports/current/**` where it is cited.
10. **Dangling check.** This is a new `tools/check-spec-refs.mjs`, added to `tools/verify.mjs`. It asserts:
    - (i) `docs/specs/DS*.md` ids are unique and contiguous from DS000, and each title matches its filename.
    - (ii) matrix.md rows equal the file set, in the same order.
    - (iii) every `DS0nn` token and every `DS0nn-slug.md` path in live files resolves to an existing spec.
    - (iv) every `probably_obsolete/…` path cited in a live file exists.
    - (v) frozen files cite only ids present in `aliases.json`.
    - (vi) no archived filename is still linked with a `docs/specs/` path.
    - It exits non-zero on any violation. Then run `node tools/verify.mjs`, `node --test`, `node tools/verify-vocabulary.mjs` and `node check-datasets.mjs`. Load `/docs/specsLoader.html?spec=matrix.md` and a sample of renamed specs through the server.
11. **Record** the consolidation in `status/journal.jsonl` (one append-only entry linking `aliases.json`), in CHANGES.md and in the AGENTS reading order.

## 5. Risks

1. **Concurrent edits.** Other agents are changing docs now, and two new citing files appeared during the survey. Execution without a freeze will miss references or clobber their work.
2. **Chain collisions.** Old DS011→DS010, DS014→DS011, DS016→DS012, DS017→DS013, DS018→DS014 and DS035→DS018 reuse numbers. Sequential `sed` would corrupt references, so use only the single-pass lookup.
3. **Silent meaning change for human readers and history.** "DS018" meant source rights for days and will mean research corpora. Old ids stay in `status/journal.jsonl`, `eval/reports/history`, archived registers, git history and external notes. Mitigate this with `aliases.json`, a "formerly" column in matrix.md, and alias resolution in `specsLoader`/`/project`.
4. **Generated artifacts with embedded ids.** These include dataset manifests and reports, `sop/contracts/wires.json` and `datasets/query-profile.json`. Hand edits may break fingerprints or `capabilities --check`, while regeneration may change observed counts. Rebuild symbolically and re-validate, and never train (AGENTS rule 3).
5. **Merges lose normative sentences.** The DS010 boundary tests (`tests/contracts-boundary.test.mjs`) and the DS013 split-safety rules are cited by tests. Losing them silently weakens contracts. Keep a per-paragraph checklist for each merge.
6. **Code still embodies superseded designs.** Examples are `MODEL_PROFILES`, `PROFILE='sop-agent-3'`, the `premise` wire, "transition window" comments in `server/audit.mjs`/tests, and `allowJsEval` in current reasoning example reports. Docs rewritten to P1/P7/P8 before the code changes would describe behavior that does not exist yet (a "read hides a write" style doc/behavior gap). Sequence doc wording with the code change, or state "removed from the model surface; runtime removal pending in TODO".
7. **Owner-dependent moves.** Archiving PAS_TASK.md contradicts the current AGENTS Scope, and questions.md being Romanian contradicts the AGENTS English rule. Neither should be done without an answered question.
8. **Large merged specs.** DS018-new (about 430 lines) and DS019-new (about 150 lines) may exceed DS001 size guidance. The DS001 limits must be checked, or the corpus cards kept as appendices.
9. **Tests that fetch spec paths** (`tests/server-http.test.mjs:274`) and `tools/verify-vocabulary.mjs`'s proposals exemption will fail or go stale after the moves. Update them in the same commit.

## Appendix A. Reference-count script (re-run before execution)

```sh
cd /home/salboaie/work/ChatSOP
grep -rIoE 'DS0[0-9]{2}' --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=datasets_sources --exclude-dir=models \
  --exclude=docs-consolidation-plan.md . \
  | sed 's|^\./||' | awk -F: '{print $2"\t"$1}' | sort | uniq -c | awk '{print $2"\t"$3"\t"$1}'
```

## Appendix B. Files referencing each moved or renumbered DS (occurrences per file, re-grepped at the end of the survey)

DS000–DS009 keep their ids and are listed in the totals only. The counts include self-references inside each spec, and they exclude this plan file.

Totals (files / occurrences) per id:

| DS | files | occurrences |
| --- | ---: | ---: |
| DS000 | 12 | 27 |
| DS001 | 6 | 10 |
| DS002 | 7 | 16 |
| DS003 | 6 | 9 |
| DS004 | 33 | 137 |
| DS005 | 17 | 63 |
| DS006 | 22 | 62 |
| DS007 | 15 | 37 |
| DS008 | 22 | 76 |
| DS009 | 15 | 62 |
| DS010 | 9 | 39 |
| DS011 | 13 | 39 |
| DS012 | 10 | 20 |
| DS013 | 8 | 11 |
| DS014 | 10 | 31 |
| DS015 | 6 | 14 |
| DS016 | 11 | 18 |
| DS017 | 8 | 28 |
| DS018 | 39 | 90 |
| DS019 | 7 | 12 |
| DS020 | 9 | 20 |
| DS021 | 5 | 8 |
| DS022 | 7 | 11 |
| DS023 | 11 | 17 |
| DS024 | 11 | 30 |
| DS025 | 10 | 17 |
| DS026 | 8 | 10 |
| DS027 | 11 | 17 |
| DS028 | 6 | 9 |
| DS029 | 3 | 6 |
| DS030 | 10 | 20 |
| DS031 | 6 | 7 |
| DS032 | 5 | 7 |
| DS033 | 3 | 4 |
| DS034 | 5 | 6 |
| DS035 | 7 | 10 |
| DS036 | 6 | 8 |
| DS037 | 4 | 6 |
| DS038 | 4 | 6 |
| DS039 | 5 | 6 |
| DS040 | 20 | 37 |
| DS041 | 57 | 126 |
| DS042 | 5 | 11 |

#### DS010

AGENTS.md (1); docs/specs/DS010-common-contracts.md (1); docs/specs/DS023-nl-sop-dataset.md (12); docs/specs/DS027-legacy-architecture-language.md (4); docs/specs/DS028-legacy-reasoning-and-operations.md (15); docs/specs/DS030-legacy-index-and-contracts.md (1); docs/specs/matrix.md (2); docs/wiki.html (2); eval/reports/current/no-context-sweep.json (1)

#### DS011

AGENTS.md (1); docs/specs/DS011-experiment-preregistration.md (1); docs/specs/DS023-nl-sop-dataset.md (9); docs/specs/DS025-research-direction-and-publication.md (7); docs/specs/DS030-legacy-index-and-contracts.md (4); docs/specs/DS041-stated-assumed-unclear.md (1); docs/specs/matrix.md (2); docs/specs/proposals/wire-redesign-2026-09-28.md (3); doubts.md (1); lib/journal.mjs (1); server/eval-guide.mjs (5); status/experiments.json (2); TODO.md (2)

#### DS012

AGENTS.md (1); docs/specs/DS012-strategy-backend-matrix.md (1); docs/specs/DS027-legacy-architecture-language.md (5); docs/specs/DS030-legacy-index-and-contracts.md (4); docs/specs/matrix.md (2); docs/wiki.html (2); PAS_TASK.md (2); skills/extend-reasoning/SKILL.md (1); skills/link-circuit/SKILL.md (1); tests/agent.test.mjs (1)

#### DS013

AGENTS.md (1); docs/specs/DS009-query-curriculum.md (2); docs/specs/DS013-case-authoring.md (1); docs/specs/matrix.md (2); docs/training.html (2); eval/reports/current/no-context-sweep.json (1); PAS_TASK.md (1); TODO.md (1)

#### DS014

AGENTS.md (1); docs/specs/DS009-query-curriculum.md (2); docs/specs/DS014-material-sources.md (1); docs/specs/DS023-nl-sop-dataset.md (13); docs/specs/DS030-legacy-index-and-contracts.md (1); docs/specs/matrix.md (2); docs/specs/proposals/wire-redesign-2026-09-28.md (1); docs/wiki.html (2); PAS_TASK.md (2); skills/material-to-sop/SKILL.md (6)

#### DS015

AGENTS.md (1); docs/specs/DS015-solver-qualification.md (1); docs/specs/DS029-legacy-data-memory-and-release.md (6); docs/specs/DS030-legacy-index-and-contracts.md (2); docs/specs/matrix.md (2); PAS_TASK.md (2)

#### DS016

AGENTS.md (1); CHANGES.md (1); docs/runtime.html (2); docs/specs/DS016-local-server.md (1); docs/specs/matrix.md (2); eval/reports/current/no-context-sweep.json (2); eval/reports/current/no-context-sweep.md (2); PAS_TASK.md (3); README.md (2); server/language.mjs (1); TODO.md (1)

#### DS017

AGENTS.md (1); docs/specs/DS017-engine-comparison.md (1); docs/specs/DS025-research-direction-and-publication.md (2); docs/specs/DS029-legacy-data-memory-and-release.md (9); docs/specs/DS030-legacy-index-and-contracts.md (9); docs/specs/matrix.md (2); docs/training.html (2); PAS_TASK.md (2)

#### DS018

AGENTS.md (2); datasets/ambiguity-resolve-v1/manifest.json (1); datasets/diversity/inventory.json (1); datasets/diversity/pilot/report.json (1); datasets/grounded-ambiguity/report.json (1); datasets/grounded-paraphrase/report.json (1); datasets/grounded-proof/report.json (1); datasets/grounded-proposition/build-report.json (1); datasets/independent-v1/manifest.json (1); datasets/paraphrase-contrast-v1/manifest.json (1); datasets/pilot-v1/manifest.json (1); datasets/proof-structure-v1/manifest.json (1); datasets/qa-proposition-v1/manifest.json (1); datasets/query-v1/manifest.json (1); datasets/query-v2/manifest.json (1); datasets/SOURCES.md (2); docs/specs/DS018-source-rights.md (2); docs/specs/DS023-nl-sop-dataset.md (19); docs/specs/DS025-research-direction-and-publication.md (2); docs/specs/DS027-legacy-architecture-language.md (7); docs/specs/DS028-legacy-reasoning-and-operations.md (3); docs/specs/DS029-legacy-data-memory-and-release.md (4); docs/specs/DS030-legacy-index-and-contracts.md (6); docs/specs/DS035-research-experiment-corpus.md (2); docs/specs/DS036-grounded-proof.md (2); docs/specs/DS037-grounded-proposition.md (2); docs/specs/DS038-grounded-paraphrase.md (2); docs/specs/DS042-diversity-generator.md (1); docs/specs/matrix.md (2); docs/training.html (2); doubts/docx-direction.md (1); doubts.md (3); PAS_TASK.md (3); probably_obsolete/README.md (1); status/journal.jsonl (2); TODO.md (2); tools/datasets/diversity/mine-sources.mjs (1); tools/datasets/no-copy.mjs (1); tools/datasets/rights.mjs (2)

#### DS019

AGENTS.md (1); docs/specs/DS019-independent-corpus.md (1); docs/specs/matrix.md (2); docs/training.html (2); eval/README.md (1); PAS_TASK.md (2); server/eval-guide.mjs (3)

#### DS020

AGENTS.md (1); docs/specs/DS020-evaluation-metrics.md (1); docs/specs/DS030-legacy-index-and-contracts.md (1); docs/specs/matrix.md (2); docs/specs/proposals/wire-redesign-2026-09-28.md (3); docs/training.html (4); eval/propositions.mjs (1); PAS_TASK.md (3); server/eval-guide.mjs (4)

#### DS021

AGENTS.md (1); docs/specs/DS021-skill-systems.md (1); docs/specs/matrix.md (2); PAS_TASK.md (2); skills/README.md (2)

#### DS022

AGENTS.md (1); docs/specs/DS022-question-curriculum-generator.md (1); docs/specs/matrix.md (2); docs/specs/proposals/wire-redesign-2026-09-28.md (2); eval/reports/current/no-context-sweep.json (1); PAS_TASK.md (2); skills/question-curriculum/SKILL.md (2)

#### DS023

AGENTS.md (2); CHANGES.md (1); datasets/query-profile.json (1); docs/specs/DS000-vision.md (1); docs/specs/DS009-query-curriculum.md (1); docs/specs/DS010-common-contracts.md (1); docs/specs/DS023-nl-sop-dataset.md (1); docs/specs/matrix.md (2); doubts.md (1); PAS_TASK.md (2); probably_obsolete/README.md (4)

#### DS024

AGENTS.md (1); docs/runtime.html (2); docs/specs/DS024-small-language-scope.md (2); docs/specs/DS030-legacy-index-and-contracts.md (1); docs/specs/DS041-stated-assumed-unclear.md (2); docs/specs/matrix.md (2); docs/specs/proposals/wire-redesign-2026-09-28.md (10); eval/reports/current/no-context-sweep.json (2); eval/reports/current/no-context-sweep.md (3); PAS_TASK.md (3); sop/declarative.mjs (2)

#### DS025

AGENTS.md (2); CHANGES.md (1); docs/specs/DS000-vision.md (1); docs/specs/DS025-research-direction-and-publication.md (1); docs/specs/DS030-legacy-index-and-contracts.md (1); docs/specs/matrix.md (2); doubts.md (1); PAS_TASK.md (2); probably_obsolete/README.md (4); TODO.md (2)

#### DS026

AGENTS.md (1); docs/specs/DS013-case-authoring.md (1); docs/specs/DS026-query-corpus-v2.md (1); docs/specs/matrix.md (2); docs/specs/proposals/wire-redesign-2026-09-28.md (1); eval/README.md (1); eval/reports/current/no-context-sweep.json (1); PAS_TASK.md (2)

#### DS027

AGENTS.md (2); CHANGES.md (1); docs/specs/DS027-legacy-architecture-language.md (2); docs/specs/matrix.md (2); eval/reports/current/no-context-sweep.json (1); eval/reports/current/no-context-sweep.md (2); PAS_TASK.md (2); probably_obsolete/README.md (2); skills/procedure-library/SKILL.md (1); skills/reasoning-review/SKILL.md (1); status/journal.jsonl (1)

#### DS028

docs/specs/DS028-legacy-reasoning-and-operations.md (2); docs/specs/matrix.md (2); eval/reports/current/no-context-sweep.json (1); probably_obsolete/README.md (2); skills/extend-reasoning/SKILL.md (1); skills/link-circuit/SKILL.md (1)

#### DS029

docs/specs/DS029-legacy-data-memory-and-release.md (2); docs/specs/matrix.md (2); probably_obsolete/README.md (2)

#### DS030

AGENTS.md (3); CHANGES.md (1); docs/specs/DS030-legacy-index-and-contracts.md (2); docs/specs/matrix.md (2); eval/reports/current/no-context-sweep.md (1); PAS_TASK.md (3); probably_obsolete/README.md (5); skills/reasoning-review/SKILL.md (1); status/journal.jsonl (1); TODO.md (1)

#### DS031

AGENTS.md (1); CHANGES.md (1); docs/specs/DS031-qa-proposition-corpus.md (1); docs/specs/matrix.md (2); PAS_TASK.md (1); TODO.md (1)

#### DS032

AGENTS.md (1); docs/specs/DS032-proof-structure-corpus.md (1); docs/specs/matrix.md (2); eval/reports/current/no-context-sweep.json (1); eval/reports/current/no-context-sweep.md (2)

#### DS033

AGENTS.md (1); docs/specs/DS033-paraphrase-contrast-corpus.md (1); docs/specs/matrix.md (2)

#### DS034

AGENTS.md (1); docs/specs/DS034-ambiguity-resolve-corpus.md (1); docs/specs/matrix.md (2); eval/reports/current/no-context-sweep.json (1); eval/reports/current/no-context-sweep.md (1)

#### DS035

AGENTS.md (1); CHANGES.md (1); docs/specs/DS035-research-experiment-corpus.md (2); docs/specs/matrix.md (2); eval/reports/current/no-context-sweep.json (1); eval/reports/current/no-context-sweep.md (2); PAS_TASK.md (1)

#### DS036

AGENTS.md (1); CHANGES.md (1); docs/specs/DS036-grounded-proof.md (2); docs/specs/matrix.md (2); eval/reports/current/no-context-sweep.json (1); eval/reports/current/no-context-sweep.md (1)

#### DS037

AGENTS.md (1); docs/specs/DS037-grounded-proposition.md (2); docs/specs/matrix.md (2); eval/reports/current/no-context-sweep.json (1)

#### DS038

AGENTS.md (1); docs/specs/DS038-grounded-paraphrase.md (2); docs/specs/matrix.md (2); eval/reports/current/no-context-sweep.json (1)

#### DS039

AGENTS.md (1); CHANGES.md (1); docs/specs/DS039-grounded-ambiguity.md (1); docs/specs/matrix.md (2); TODO.md (1)

#### DS040

AGENTS.md (2); CHANGES.md (1); docs/specs/DS008-data-evaluation.md (2); docs/specs/DS009-query-curriculum.md (3); docs/specs/DS013-case-authoring.md (4); docs/specs/DS016-local-server.md (2); docs/specs/DS026-query-corpus-v2.md (2); docs/specs/DS040-corpus-audit-tool.md (2); docs/specs/DS042-diversity-generator.md (1); docs/specs/matrix.md (2); docs/specs/proposals/wire-redesign-2026-09-28.md (1); docs/training.html (2); eval/reports/current/no-context-sweep.json (1); eval/reports/current/no-context-sweep.md (2); PAS_TASK.md (2); README.md (2); skills/corpus-audit/SKILL.md (1); status/journal.jsonl (2); TODO.md (2); tools/datasets/audit/engine.mjs (1)

#### DS041

AGENTS.md (3); CHANGES.md (1); config/ontology.sop (1); docs/runtime.html (2); docs/specs/DS004-sop.md (4); docs/specs/DS007-training.md (2); docs/specs/DS008-data-evaluation.md (4); docs/specs/DS009-query-curriculum.md (2); docs/specs/DS016-local-server.md (2); docs/specs/DS020-evaluation-metrics.md (2); docs/specs/DS024-small-language-scope.md (6); docs/specs/DS041-stated-assumed-unclear.md (2); docs/specs/DS042-diversity-generator.md (3); docs/specs/matrix.md (2); docs/specs/proposals/wire-redesign-2026-09-28.md (7); docs/training.html (2); docs/wiki.html (2); docs/wire_typs/assumed.html (5); docs/wire_typs/cnl.html (2); docs/wire_typs/small-model.html (2); docs/wire_typs/stated.html (4); docs/wire_typs/unclear.html (4); eval/propositions.mjs (1); eval/reports/current/no-context-sweep.json (6); eval/reports/current/no-context-sweep.md (5); eval/run.mjs (2); PAS_TASK.md (1); README.md (2); server/agent.mjs (2); server/audit.mjs (1); server/language.mjs (1); server/llm.mjs (1); sop/contracts/wire-fields.md (4); sop/contracts/wires.json (3); sop/declarative.mjs (3); sop/enums.mjs (1); sop/grammars/sop-agent.ebnf (1); sop/lexicon.mjs (1); sop/linking.mjs (1); sop/parser.mjs (1); sop/propositions.mjs (1); sop/runtime.mjs (1); sop/unclear.mjs (2); status/journal.jsonl (5); tests/data/grounded-paraphrase.test.mjs (1); tests/declarative-runtime.test.mjs (1); tests/server-http.test.mjs (1); tests/stated-assumed.test.mjs (1); TODO.md (1); tools/capabilities.mjs (4); tools/datasets/audit/vocabulary.mjs (1); tools/datasets/diversity/families.mjs (1); tools/datasets/diversity/ir.mjs (1); tools/datasets/diversity/printers.mjs (1); tools/datasets/diversity/unclear.mjs (1); tools/datasets/schema.mjs (1); tools/datasets/validate.mjs (1)

#### DS042

docs/specs/DS018-source-rights.md (1); docs/specs/DS042-diversity-generator.md (2); docs/specs/matrix.md (2); status/journal.jsonl (5); tools/datasets/diversity/generate.mjs (1)
