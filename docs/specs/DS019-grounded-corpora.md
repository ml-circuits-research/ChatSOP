---
title: DS019-grounded-corpora
summary: Source-grounded counterpart corpora (proof, proposition, paraphrase, ambiguity) composed per analysed source case, with their shared method, rights boundary, artifacts and measured builds.
---

# DS019 — Grounded corpora

> **Status (2026-09-28): historical.** The corpora, suites and builders this specification describes were deleted with the regeneration of the model-language corpora ([DS022](specsLoader.html?spec=DS022-diversity-generator.md): `formalizer-v1` and `formalizer-ood-v1`). The text below is kept as the record of their design and of the phenomena DS022 re-expresses; it does not describe files that exist.

This specification owns the four source-grounded counterpart corpora `datasets/grounded-proof`, `datasets/grounded-proposition`, `datasets/grounded-paraphrase` and `datasets/grounded-ambiguity`. The small hand-designed research corpora they grew from are specified in [DS018](specsLoader.html?spec=DS018-research-corpora.md).

## Shared method

The user's rule for this stage: a generator must read the ACTUAL cached source datasets and author a separate counterpart per analysed source case, preserving that case's theme and shape with our own entities, facts, wording and target. Nothing is copied, and composition from an authored skeleton library is acceptable as long as it is not mechanical duplication. Each row records its lineage `{source, source_row_id, shape, theme}` in `generation_trace`, marked `source_rows_copied: false` and `not_reviewed`.

Every builder follows the same method:

1. **Analyse the source case.** The builder reads the cached source rows under `datasets_sources/` without network access or model inference and measures only structure: status, depth, question type, lexical change cues, ambiguity type, rewrite count, a topical cue. Source text stays in memory for this analysis and is never written.
2. **Compose an original counterpart.** An independently authored theme card and request skeleton library supply the entities, facts, wording and target. Themes are keyword or rewrite **proxies**, not reviewed topic labels; an unmatched cue is reported as `unclassified` or `general`, never a guessed topic.
3. **Execute every gold.** Each emitted target is executed by the real runtime during the build; a mismatched status or depth aborts generation. The build report records a SHA-256 execution fingerprint.
4. **Keep splits closed.** Each source case (or source pair) owns one `split_group_id`; no group crosses train/dev/sealed test. Development golds live at `datasets/<corpus>/{train,dev}.jsonl`, the sealed test only at `eval/suites/<corpus>/test.jsonl`; there is no combined `pairs.jsonl` copy. About 20% of requests are Romanian, spread across themes.
5. **Emit an NL-only index.** Each corpus also emits `surfaces.jsonl` (the NL request plus its inline vocabulary, no target) beside the canonical golds. The NL-only file is the asset the user cares most about: the base is the natural-language example, and an imperfect first-pass SOP target is a review matter. The targets that do exist were executed against the runtime at build time and are marked `target_review_status: pending_review`.

**Rights.** By the owner's decision of 2026-09-28 these inspired-by corpora are released (`inspired-by-released`, [DS014](specsLoader.html?spec=DS014-source-rights.md)); the grant covers the derived corpus, not the source text. The cached source rows keep their recorded status and stay a local cache under `datasets_sources/`: no source sentence, question, passage, answer, rule, entity or predicate name enters a corpus, and lineage exports source collection, row ID, shape, change kind and theme only. Each corpus must pass `node tools/datasets/no-copy.mjs`. Attribution is kept in `datasets/SOURCES.md` as a courtesy (for PAWS, acknowledgement of Google LLC and the underlying Wikipedia terms).

**Target format.** The golds of these four corpora are **legacy-format**: atom queries over canonical identifiers with a per-row ontology and context block, and most `grounded-paraphrase` targets also use the removed conditional-context `premise` wire. They are not written in the current model language ([DS021](specsLoader.html?spec=DS021-model-surface.md)) and await regeneration by the diversity generator ([DS022](specsLoader.html?spec=DS022-diversity-generator.md); tracked in `TODO.md`). Under the current contract the model sees only the user's message; the inline vocabulary is evaluation metadata.

**Honest limits.** Rows are generator-composed from authored skeletons anchored to an analysed source case — not individually hand-written and not human-reviewed; theme and shape extraction uses lexical proxies, so the reported source-theme counts are proxies, not human topical labels. Every gold has `review_status: not_reviewed` (or `pending_review` for targets) and `training_approved: false`; training is not authorized. Execution and test success do not substitute for human review of semantic and linguistic fidelity.

### First grounded build (dated snapshot)

Snapshot of the first grounded build on 2026-09-28; the corpora have since been regenerated at larger scale, so read current counts from `datasets/<corpus>/report.json` or the audit, not from this table.

| Corpus | Source read (cached) | Cases analysed | Authored rows (train/dev/test) | RO | Themes | Distinct skeletons | Unique-request rate |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: |
| `datasets/grounded-proof` | ProofWriter structured OWA validation | 1,200 theories | 1,200 (840/240/120) | 240 | 16 | 240 | 100% |
| `datasets/grounded-proposition` | QA2D dev (10,344 scanned) | 1,200 | 1,200 (960/120/120) | 246 | 14 | 233 of 240 | 100% |
| `datasets/grounded-paraphrase` | QQP + PAWS validation | 600 + 600 pairs | 2,400 (1,946/232/222) | 480 | 30 profiles | 566 | 100% |
| `datasets/grounded-ambiguity` | AmbigNQ light dev | 600 cases | 2,508 (1,989/276/243) | 490 | 27 | 200 | 100% |
| **Total** | | **4,800 source cases** | **7,308** | **1,456** | 87 labels | — | — |

Shape fidelity is preserved and reported per corpus: ProofWriter statuses True/False/Unknown → `supported`/`refuted`/`unknown` (392/418/390) with derivation depth 0–5 (913/150/73/34/14/16); QA2D question types and change cues; QQP equivalence versus PAWS contrast with the change-class mix (equivalence 845, contrast 355; argument order 61, negation 71, quantifier 131, temporal 41, comparison 51); AmbigNQ ambiguity types (shared name 347, missing time 189, pronoun 37, predicate sense 27).

## Proof (`grounded-proof`)

Run `node tools/datasets/build-grounded-proof.mjs [source-case-count] [seed]` (defaults: 15,000 and seed 17). The builder reads the cached ProofWriter OWA validation (6,128 theories) and train (42,365 theories) JSONL files. It processes all validation theories, then samples the requested number of train theories evenly across the train source order. Each theory selects one True/False question or an Unknown question with `qdep=0`; a source Unknown with `qdep>0` records an unsuccessful search depth, whereas the SOP runtime assigns depth zero to absent proofs. An optional count must be between 6,128 and 48,493 inclusive.

Each inspected source contributes its status, depth, polarity, arity, family, fact polarities and rule-body sizes. The independently composed local world uses an authored theme and request skeleton. It retains **only the seed observation, an optional second observation for conjunctive facts, and the rule chain actually needed to answer that question**; it does not pretend to reconstruct unused branches of the upstream theory. The predicate vocabulary is limited to those observations, chain rules and query. The context gives human-readable observations and rules once, while `setup_sop` gives their formal representation without repeating the quotations; `source.sha256` authenticates the authored observations without embedding another copy of them. Metadata records source structure, not original sentences or predicates. These examples are generated from authored topical and question libraries, **not** individually written or human-reviewed examples.

Only structural observations, counterpart theme and source theory/question IDs appear in `generation_trace.lineage`. The upstream sample has no real-world topic, so the source theme is `synthetic_theory_world`. Our 16 themes include orchard, harbor, archive, clinic, museum, school, market, forest, theater, rail, bakery, weather, library, sports, civic and laboratory work. The themes are ours, not claims about upstream domains.

**Artifacts and contract.**

- `datasets/grounded-proof/surfaces.jsonl`: requests, inline entity and used-predicate glosses, local observations and rule descriptions, `setup_sop` and `ontology_sop`, with `target_status: pending_review` and no gold.
- `datasets/grounded-proof/train.jsonl` (10,500 rows) and `datasets/grounded-proof/dev.jsonl` (3,000 rows): development golds. The sealed 1,500-row test gold exists **only** at `eval/suites/grounded-proof/test.jsonl`. Each gold adds a declarative `query` in `sop_target` and an executed `expected` status/depth. `evaluation_track: formalization`, `input_mode: query_only`, `target_review_status: pending_review`, `generation_trace.review_status: not_reviewed`, `quality_flags.source_rows_copied: false` and `quality_flags.training_approved: false` preserve the review and rights boundary. The synthetic checksum-bearing `source` is for our own observations, not the upstream theory.
- `datasets/grounded-proof/report.json`: source versus counterpart distributions, source coverage, per-split counts, byte count of the four JSONL artifacts, bytes/row, diversity, elapsed build time, full execution counts and gold fingerprint. SHA-256 hashes each split name plus a NUL byte followed by the exact gold JSONL bytes in train/dev/test order.

Each source theory owns one counterpart and split-group. Precisely 3,000 requests are Romanian (20%), across the 16 themes. Romanian framing quotes English vocabulary glosses as referential terms, without claiming those glosses were translated. With unchanged source bytes and seed, the gold and surface files reproduce byte-for-byte; `build_time_ms` naturally varies.

**Measured default build (seed 17).**

| Observation | Source slice | Executed counterparts |
| --- | ---: | ---: |
| Available / processed / emitted theories | 48,493 / 15,000 / — | — / — / 15,000 |
| True / supported; False / refuted; Unknown | 5,136; 4,935; 4,929 | 5,136; 4,935; 4,929 |
| Depth 0 / 1 / 2 / 3 / 4 / 5 | 11,352 / 1,967 / 950 / 452 / 150 / 129 | 11,352 / 1,967 / 950 / 452 / 150 / 129 |
| Depth cells, False 0–5 | 3,143 / 978 / 459 / 215 / 71 / 69 | same |
| Depth cells, True 0–5 | 3,280 / 989 / 491 / 237 / 79 / 60 | same |
| Depth cell, Unknown 0 | 4,929 | 4,929 |
| Theme | synthetic_theory_world: 15,000 | 16 authored themes, 937–938 each |
| Family AttNeg / AttNoneg / RelNeg / RelNoneg | 3,931 / 4,081 / 3,460 / 3,528 | same source shapes |

The authored English opening (60 choices) × closing (32 choices) library provides **1,920 observed skeleton IDs**; Romanian has separately authored clauses. The largest skeleton occurs eight times (0.0533%), below 0.3%, and all 15,000 normalized requests are unique. Five surface forms and four registers add framing diversity. The four JSONL artifacts total **80,567,572 bytes, or 5,371 bytes/row**, substantially below the ~250 MB corpus budget and the ~15 KB/row target. Smaller rows are possible because unneeded rules/facts and duplicated quotations were removed, rather than because source structures were hidden. Full generation and 15,000 gold executions took **36,741 ms** on this run; the gold fingerprint is **`3e6b1e3c35202ad35fc89e1f1b3ee76f3040d73a0525528868e8767e5ea4c475`**. The 33,493 unprocessed train theories remain available in the local cache.

Validation: `node tools/datasets/validate.mjs --file datasets/grounded-proof/train.jsonl`, the analogous dev invocation, and `node tools/datasets/validate.mjs --file eval/suites/grounded-proof/test.jsonl --execute` check all three splits (including execution of all 1,500 sealed golds). `node --test tests/grounded-proof.test.mjs` checks provenance and non-copying, status/depth/source-shape relationships, inline vocabulary, split closure, and a deterministic stratified execution sample of 400 golds across splits, languages, structures and themes. These checks do not establish human semantic review.

## Proposition (`grounded-proposition`)

`node tools/datasets/build-grounded-proposition.mjs` reads all **10,344** records in the cached `datasets_sources/qa2d/dev.jsonl`. Each question, human declarative answer, lexical contrast, and source question length are analysed before an independently composed counterpart is emitted. **No source text is reproduced or transformed into corpus text.** The generated examples use fictional scene cards and explicit original request skeletons, not 10,344 individually hand-written or human-reviewed cases. The enlarged wording library is AI-assisted authoring, not upstream paraphrasing, neural inference in the builder, or approval for training.

QA2D's code licence does not establish rights for its mixed-source data, so the cached QA2D text keeps its recorded status in the local cache; the derived corpus is released as inspired-by under [DS014](specsLoader.html?spec=DS014-source-rights.md). Every row records `{source:'qa2d',source_row_id,shape,theme,change_kind}` for audit, and `quality_flags.source_rows_copied:false`. Original cases are fictional and use unrelated names and situations; QA2D supplies observable **shape and lexical thematic cues**, not NL wording. An absent thematic cue stays `unclassified`, never a guessed topic. All targets remain `pending_review`: executing a target proves only its expected result follows from its original setup, not that a human accepted its NL-to-SOP interpretation or every nuance of the source case.

**Selection and correspondence.** The generator scans all source records. Tokenized questions and human declaratives are compared with lexical cue multisets for negation, quantifier, temporal, and comparison; question type is lexically classified (`what`, `which`, `who`, `how_many`, yes/no auxiliary, other question, or source statement). Source themes are **proxies**, not hand-labelled subjects: 14 fixed vocabularies match distinct topic cues across both texts, with deterministic highest-score/tie-order selection. The remainder retain `theme:'unclassified'` and receive neutral fictional scenes, without pretending their unknown source topics were identified. Every source row gets one separate counterpart preserving the measured question-shape and lexical-change labels; the source question length band is also recorded. Source statements become yes/no questions, as explicitly labelled. For multi-cue rows, `change_kind` preserves the full set and the authored fact prioritizes the first cue. Four original scene cards per classified theme and 40 separately authored neutral scene cards for unclassified cases provide names and event context; a source-case lexical signature chooses a card without exporting source words.

For source questions with introductory clauses, an embedded `who`, `which`, `what`, or `how many` chooses the matching authored interrogative/count formulation; the initial-token `other_question` shape label remains visible in lineage. This avoids treating a source's embedded person/count request as a generic item request.

The library has explicit independently drafted formulations for English what/other/who/which/count/yes-no requests and Romanian question framings. Additional AI-assisted phrasings are stored as complete strings, not created by enumerating interchangeable fragments. Allocation rotates per question type and language; each row records `surface_skeleton`, `register`, and `form`. Reuse is measurable in the report, but no row is human approved: all are `pending_review`, and near-synonym or pragmatic wording needs further editorial scrutiny. The original cards provide per-theme entity/predicate vocabularies; unclassified source topics receive neutral original vocabularies rather than a fabricated topical match.

Each development `surfaces.jsonl` row is NL-facing, with an original question and proposition, textual attached assertions, inline entity/predicate vocabulary, lineage, and `target_status:'pending_review'`; it contains **no SOP target, setup SOP, or expected gold**.

Gold rows add `ontology_sop`, setup facts, declarative `sop_target`, runtime-verified `expected` and observed `executed` results, and `target_review_status:'pending_review'`. Targets are legacy-format atom queries (see "Target format" above). The setup is an authored knowledge proposition, not an upstream question repeated as a source row.

IDs and group IDs are unique, and connected groups never cross splits: **8,276 train, 1,034 dev, 1,034 sealed test**. Romanian is assigned per theme, not by a contiguous row block. `--seed N` changes deterministic card/name choices; optional `--count N` intentionally selects a smaller research slice, while the default processes all available source rows. The build report records measured duration and a SHA-256 fingerprint over all `[id, executed]` results; unlike corpus bytes, elapsed time varies across runs.

**Observed default build (seed 37).** The full source/assigned-counterpart theme and shape histograms are in [`build-report.json`](../../datasets/grounded-proposition/build-report.json). Theme counts agree by construction; **unclassified means no lexical source theme was inferred**, not that the source case was omitted:

| Source theme / assigned original-scene category | Source | Ours |
| --- | ---: | ---: |
| Unclassified / neutral scenario | 6,544 | 6,544 |
| Geography / places | 625 | 625 |
| Life sciences / health | 552 | 552 |
| History / society | 551 | 551 |
| Education / research | 423 | 423 |
| Arts / books / language | 373 | 373 |
| Law / administration | 309 | 309 |
| Everyday household | 208 | 208 |
| Commerce / services | 184 | 184 |
| Travel / transport | 141 | 141 |
| Sports / leisure | 123 | 123 |
| Physical / earth sciences | 120 | 120 |
| Technology / infrastructure | 74 | 74 |
| Weather / climate | 59 | 59 |
| Agriculture / food | 58 | 58 |

The source and assigned shape totals by leading question type agree: `what 4,835`, `other_question 3,351`, `who 1,148`, `which 533`, `how_many 447`, `is_it_true 4`, and `statement 26` (source statements receive questions). Source and assigned contrast-cue totals are `none 8,830`, `quantifier 738`, `temporal 542`, `negation 160`, and `comparison 153` (multilabel cues overlap); the full 52 joint shape categories appear in the report. These are source lexical measurements versus preserved **design labels**, not independent proof of semantic equivalence. Source question-length bands are `short 2,920`, `medium 6,608`, and `long 816`, recorded on their counterparts without reproducing source questions.

Build observation recorded on 2026-09-28 (a dated record; `datasets/grounded-proposition/build-report.json` and the machine audit in `eval/reports/current/corpus-audit/` hold the counts for the files on disk): the builder analysed and processed **all 10,344 of 10,344** QA2D rows; 3,800 had recognizable thematic cues and 6,544 retained the explicit `unclassified` label, with **zero cases left unauthored**. It emitted 10,344 NL surfaces and 10,344 gold pairs: 8,276 train, 1,034 dev, and 1,034 sealed test. There are **2,074 Romanian** rows (20.05%), distributed across all 15 categories including unclassified.

The library contains **917 distinct explicit skeletons, all 917 used** (more than 10,344/12), with a largest skeleton share of **0.4157%** and a **100% unique normalized-question rate**. The report records **10,344 reference-valid, runtime-valid, execution-equivalent full-build executions**, fingerprint `177da311f1f54ce1d2e14b70e3cc0968bbabc41464f1f19c331e084ae758b1c9`. The observed build took **45,936 ms**; duration varies by machine.

Verification commands (re-run them for a current result): `node tools/datasets/validate.mjs --file datasets/grounded-proposition/train.jsonl`, the same command for `dev.jsonl`, and `node tools/datasets/validate.mjs --file eval/suites/grounded-proposition/test.jsonl --execute`; on 2026-09-28 all validated their 8,276 / 1,034 / 1,034 rows. `node --test tests/grounded-proposition.test.mjs` passed three tests. The tests check file hashes, lineage, source/noncopy policy, full-execution counts and fingerprint, split closure, vocabulary and declarative wires, plus a deterministic **400-row stratified runtime re-execution** spanning splits, languages, themes and shapes. The complete runtime pass belongs to the builder, not the shared verifier.

## Paraphrase (`grounded-paraphrase`)

Run `node tools/datasets/build-grounded-paraphrase.mjs [seed]` from the repository root. The builder selects seeded SHA-256 samples of **29,000 QQP train** pairs from 363,846 and **10,000 PAWS-Wiki train** pairs from 49,401; the cached validation splits (40,430 QQP and 8,000 PAWS) remain available but unprocessed in this build. Source labels determine equivalence versus contrast; changes are measured from both members using token order and lexical cues (negation, quantifier, temporal, comparison, substitution). These are lexical structural proxies, **not** a semantic adjudication of the sources. No training, fine-tuning or neural inference occurs.

The cached sentences **never** become project questions, passages, answers, entities, predicates or rules. Independently authored thematic scenario cards and individually written English and Romanian speech-act openings and archival closures supply the content. A keyword match assigns the closest broad topic; an unmatched topic is explicitly classified `general` and counted in `report.json` as `unmatched_theme_cues`. **This generic fallback does not preserve the fine-grained source theme** and needs human review. Contrast substitutions are modeled as an exchange of fictional keepers, whereas argument-order cases exchange their roles. Thus source label and structural class are preserved as analyzed, but no claim is made that our fiction expresses an exact source proposition.

Composition is deterministic; the scenarios are **not** individually handwritten or human reviewed. Every gold row has `review_status: 'not_reviewed'`, `quality_flags.source_rows_copied: false` and `target_status: 'pending_review'`. `datasets/grounded-paraphrase/surfaces.jsonl` is a lean NL-only index with no target or duplicated lexicon/context. Each gold row adds an executed canonical `sop_target`, `target_review_status: 'pending_review'`, expected status/answers, and a self-contained `ontology_sop` defining only the entities and predicates used by that case (constraint cases use an artifact entity but no predicates). Context entities have labels/kinds; predicates have glosses/argument kinds. Targets are legacy-format (see "Target format" above).

A `split_group_id` groups every member of a single source pair: **three separate surfaces** share one meaning for equivalence, **two** mutually linked `negative_of` surfaces have different meanings and executed answers for contrast. All members stay within the same train/dev/sealed-test split. Approximately 20% of surfaces are Romanian. Source themes, structural classes, shape, language, form and split counts are recorded in the report, alongside the source-versus-emitted group distributions.

**Observed build, default seed `grounded-paraphrase-2026`.** The checked-in [`report.json`](../../datasets/grounded-paraphrase/report.json) records available/processed source pairs by source and cached split, emitted row and train/dev/sealed-test counts, independently classified source-versus-authored change-class frequencies, authored and observed skeleton counts, largest observed share, normalized-request uniqueness, runtime build time, total corpus bytes and bytes per row, and remaining unprocessed source slices. Its `full_execution` records the exact number of gold rows executed by the real runtime during construction, their per-split counts and a SHA-256 fingerprint of ID, target, status and answers sorted by ID. Runtime status verification does not replace human assessment of theme fidelity, translation or other semantics.

This build processed **39,000 train-source pairs** (QQP 29,000; PAWS 10,000), yielding **93,064 distinct NL surfaces and 93,064 executed gold rows**: train **74,624**, dev **9,291**, sealed test **9,149**. The **15,064 equivalence** groups contributed three surfaces each; **23,936 contrast** groups contributed two each. The expanded authored library has **7,392 English and 2,970 Romanian** opening/closure combinations; **10,325** skeletons were observed, the largest appearing **26/93,064 ≈ 0.028%** (below 0.2%), and normalized-request uniqueness is **100%**. Romanian accounts for **18,548/93,064 ≈ 19.9%**. Four corpus files total **288,292,939 bytes**, or **3,097.8 bytes per row**, below the 400 MB budget. Full execution covered all **93,064** golds (fingerprint `b12cbe949e8e6cfe4abf10f1ca8600ffb771de0f969858811ce8d3c772716ca4`); build time was **21,874 ms**. Independently measured source and authored contrast change distributions agree on this processed slice: argument order **9,408**, comparison **1,453**, lexical substitution **7,783**, negation **1,565**, quantifier **2,838**, temporal **889**; this proxy agreement does not establish semantic identity. Unprocessed cached pairs: QQP train **334,846**, QQP validation **40,430**, PAWS train **39,401**, PAWS validation **8,000**.

The source-text status in [DS014](specsLoader.html?spec=DS014-source-rights.md) still applies to the cache: QQP text is research/non-commercial and PAWS text carries its Google LLC acknowledgement and the underlying Wikipedia terms. Those texts are studied structurally only and **nothing from either source dataset is redistributed**; the derived corpus is released as inspired-by. Human review is outstanding and training is not authorized.

Verify with `node --test tests/grounded-paraphrase.test.mjs`: it checks actual source lineage, diversity and unique NL requests, split-group closure, equivalence/contrast semantics, row-local ontologies, a deterministic ~400-row sample spanning splits/languages/shapes/themes against the real runtime, and that the report's **full-execution** counts and fingerprint still match current files. Validate splits with `node tools/datasets/validate.mjs --file datasets/grounded-paraphrase/train.jsonl`, `node tools/datasets/validate.mjs --file datasets/grounded-paraphrase/dev.jsonl`, and `node tools/datasets/validate.mjs --file eval/suites/grounded-paraphrase/test.jsonl --execute`.

## Ambiguity (`grounded-ambiguity`)

**Provenance and selection.** `node tools/datasets/build-grounded-ambiguity.mjs` reads cached AmbigNQ `train.json` and `dev.json`. The 10,036 train and 2,002 dev cases contain 4,749 and 1,172 eligible cases respectively: eligibility requires a `multipleQAs` annotation with at least two actual question/answer rewrites. Of 12,038 available cases, 5,921 are eligible. All 1,172 eligible dev cases and 2,532 train cases are processed (3,704 total). The other 8,334 cases are accounted for: 6,117 have no qualifying `multipleQAs` annotation (5,287 train, 830 dev), and 2,217 eligible train cases exceed the whole-group 15,000-row cap. No eligible dev case is omitted. Seed 39 orders classified train topics ahead of generic fallback topics, then hash-ranks cases within that priority; selection is therefore *not* an unbiased sample of the source train distribution. The row cap is enforced without breaking source-case groups.

Each source case supplies a rewrite count and shape, an inferred answer kind, and a topical cue, **not** published question, answer, or evidence text. The four operational ambiguity types are derived from the original question and rewrite contrasts, not AmbigNQ ground-truth type labels. Across source and authored cases alike: shared name 2,139; missing time 1,163; pronoun reference 238; predicate sense 164. The 28 topical categories, including agriculture, biology, film, geography, music, sports and television, are individually counted in `report.json`; all 28 appear in the output. Previously inspected opaque dev cases have source-ID-pinned authored theme assignments. The remaining selected train cases have recognisable keyword/rewrite topic cues; generic community-archive fallback cases are left unprocessed under the cap. Themes are proxies, not reviewed topic labels.

The upstream dataset text is CC BY-SA 3.0 (underlying Natural Questions) and stays in the local cache; source rows are **not redistributed**. Every output records a source row ID, operational ambiguity shape and theme, with `quality_flags.source_rows_copied:false`; invented names, answers, local facts, and questions remain independently authored. The labels and gold have `pending_review` status and are not training-approved.

**Layout and execution.**

- `datasets/grounded-ambiguity/surfaces.jsonl`: 14,998 NL-only rows with questions, assertions and row-specific vocabulary; no SOP gold or expected result.
- `datasets/grounded-ambiguity/train.jsonl` (11,956) and `dev.jsonl` (1,869), plus sealed `eval/suites/grounded-ambiguity/test.jsonl` (1,173): canonical gold in disjoint case-group splits, with 3,704 ambiguous requests and 11,294 explicit rewrites. Each row contains its own evidence, ontology, target, expected result, and build-executed result. Explicit rewrites carry **only their own** subject/answer vocabulary and source fact; ambiguous requests carry all competing referents and facts. Duplicated assertions are omitted from gold where source content and fact quotes already contain them.
- `datasets/grounded-ambiguity/report.json`: exact available/eligible/processed/skipped counts per source split, output counts per gold split, distributions for source and authored shapes/themes, question diversity, file hashes, build time, bytes, execution statuses and fingerprint.

The inventory composes 50 English and 25 Romanian authored clauses with 12 English and 8 Romanian discourse frames, yielding 800 skeletons; all 800 occur. The largest skeleton contributes 20/14,998 requests (**0.133%**, below 0.3%). All 14,998 normalized questions are unique. Language counts are 11,984 English and 3,014 Romanian (**20.10% Romanian**). No claim is made that every case or question has been individually handwritten or human-reviewed. Each ambiguous request requires runtime clarification by the host with competing identity candidates (the model never refuses and never writes `clarify`); each explicit rewrite returns its own asserted answer. Predicate sense is approximated by competing referents for senses, not linguistic adjudication.

The four corpus files total **73,869,696 bytes** (surface plus three gold files; report excluded), **4,925.30 bytes/row**, under the 250 MB limit. This produces 14,998 rows within the 15,000-row cap without inflating the data directory with a combined gold export. Build time was **63,372 ms** on the generating host. The build executed **all 14,998 gold targets**: 3,704 `clarify`, 11,294 `supported`. Its SHA-256 execution fingerprint over JSON-encoded `[id, executed]` pairs in train/dev/test file order is `c30ee8acf4d8bc2168ea9aa45424744280bcdd5f1a99d2e531de836e7c9338f7`. These are executable synthetic references, not expert semantic annotations.

```sh
node tools/datasets/build-grounded-ambiguity.mjs
node tools/datasets/validate.mjs --file datasets/grounded-ambiguity/train.jsonl
node tools/datasets/validate.mjs --file datasets/grounded-ambiguity/dev.jsonl
node tools/datasets/validate.mjs --file eval/suites/grounded-ambiguity/test.jsonl --execute
node --test tests/grounded-ambiguity.test.mjs
```

The focused test verifies source lineage and eligibility, source-text non-copying, disjoint group closure, bytes/hashes, full build-execution fingerprint and status totals, and re-executes a deterministic **400-row stratified sample** covering every populated split/language/request-shape/theme stratum. It does not re-execute the entire corpus.
