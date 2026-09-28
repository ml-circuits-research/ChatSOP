---
title: DS022-diversity-generator
summary: The model-language corpora and their generator - mined source inventory, IR-based generation, question-form and interpretation families, pluggable printers, shared verification worlds, the typing-noise and code-switching model, quotas and mix rules, split grouping, the corpus split (formalizer-v1 plus the out-of-distribution suite) and the checks.
---

# DS022 — Diversity generator and the model-language corpora

## Scope and status

This specification defines how the formalizer corpora are generated for the model language (DS021) with diversity that is real rather than templated. It covers the mined diversity inventory, the generator (`tools/datasets/diversity/`), its intermediate representations, the pluggable target printers, the evaluation-only verification worlds, the typing-noise and code-switching model, the quotas and mix rules, split grouping against template leakage, the corpus split and the checks every build passes. The corpora are `formalizer-v1` (train and dev under `datasets/formalizer-v1/`, the sealed test under `eval/suites/formalizer-v1/`) and the out-of-distribution suite `eval/suites/formalizer-ood-v1/`. The earlier corpora (query-v1/v2, pilot-v1, the pilot of this generator, grounded-*, the research `*-v1` corpora, generated/, seed/, normalized/, templates/, research-train-v1, the independent-v1 suite and their builders) were deleted with the regeneration of 2026-09-28. The corpora are synthetic and unreviewed, and nothing here authorizes training (AGENTS.md rule 3).

Rights: the corpora are inspired by QQP, PAWS, ProofWriter, AmbigNQ, QA2D and SQuAD under the owner's decision of 2026-09-28 (DS014). They take structure, label types, phenomena and statistics, never text; `datasets/SOURCES.md` lists what was taken and what was not, and `tools/datasets/no-copy.mjs` proves it. Each row carries the compact stamp `rights {license, rights_decision, inspired_by, text_copied: false}` (`rowRights` in `tools/datasets/rights.mjs`); each manifest carries the full block (`manifestRights`).

## Model input and target

1. **The model input is the user's message only.** A row's `question` is the whole message: assertions, question, greetings, remarks, noise. The model sees no context, shortlist, identifiers, background, rules or clock. Every other row field is evaluation-only scaffolding or metadata and never enters a prompt (see "Row fields" below); the scaffolding that used to be called `context` is named `verification_context` so that nobody mistakes it for model input. The training projection (`tools/research/prepare-experiment.mjs`) writes `prompt = question` and fails closed on anything else.
2. **Targets use strings, not ids.** The printer follows `sop/parser.mjs`; the grammar and every convention (values as written, relations as meant, the question forms, the interpretation assumptions, the "because" convention) are owned by DS021, and rows carry no profile field. The corpora apply DS021's "relations as meant" with the stricter relation-phrase convention below.
3. **Stated versus assumed.** `stated` carries only what the message surely asserts: user assertions, hedges, suppositions and reported speech. A declarative the user asks to have checked is a query. Remarks about the user's own situation or purpose are not formalized. Everything the model adds is `assumed`: closure negatives, the asymmetry of relations that are asymmetric by meaning (`basis world`: management, parenthood), defaults, presuppositions without an invented time, and chosen readings (`relation "mean"`, `relation "refer to"`, `basis disambiguation`). An assumption reuses a relation phrase of the message: a world assumption reverses the *statement* with the statement's own phrase ("Ana manages Irina" → `assumed` "Irina" does not "manage" "Ana"), never the question's phrase, because restating the question through another relation ("raise" for "be a parent of") would be reasoning; a closure or default assumption uses the question's phrase. A presupposition assumption exists only when its trigger ("still", "again", "încă", "mai", "iar", "din nou") is in the message.
4. **The model never refuses.** The formerly blocked families (abduction, default with exception, counterfactual, planning, causal, intention, general quantification) are formalized like any other message; general quantification is the universal question (`mode every`).

## Relation phrases

The relation phrase of a `stated` wire and of a query `match` block is **the message's own predicate words with the role fillers removed, lemmatized**. The generator and every reviewer apply one convention:

1. Only inflection, tense, person, agreement (including Romanian gender and article endings) and spelling are normalized: an English verb takes its base form ("coached" → `"coach"`, "flew" → `"fly"`), a copula becomes `be` ("is married to" → `"be married to"`), a Romanian verb its short infinitive ("lucrează" → `"lucra la"`, "e înscrisă la" → `"fi înscris la"`, "joacă la" → `"juca la"`), reflexive and particle words stay ("se baza pe", "check out"), typos in the message are not copied into the phrase.
2. A content word is never replaced by a synonym and never added: "handed in her notice" is `"hand in notice"`, never `"resign"`; "și-a dat demisia" is `"da demisia"`, never `"demisiona"`; "vaccinated employees" is `"be vaccinated"`, never `"be vaccinated against the flu"`; "a căzut din cauza problemelor cu X" keeps `"cădea din cauza problemelor cu"`. A word the message composes ("grandparents") is not decomposed into other relations; such wordings are not generated.
3. Function words may be restored or dropped: a preposition absorbed by a wh-word ("where did Ana fly" → `"fly to"`, "cu ce merge X la serviciu" → `"merge la serviciu cu"`, "what does Ana pay with" → `"pay with"`; a bare "how" restores none: "how does Ana pay" → `"pay"`), articles, auxiliaries, a light "have"/"avea" ("o companie cu sediul în" → `"avea sediul în"`) and a classifier noun before a name ("autorul cărții X" → `"fi autorul"`).
4. The pronoun-referent convention of DS021 ("the subject of the preceding asymmetric sentence") is generated only after asymmetric relations; after a symmetric one ("is married to") the pronoun has no preferable reading. Different words in the message give different relation phrases: "works at" and "is employed by" in one message are two phrases; the host links both to one predicate (DS021 host linking).

The convention is executable: `tools/datasets/diversity/relation-words.mjs` (`relationWordProblems`) checks that every content word of each stated or asked relation phrase has an inflected form in the message. The generator rejects a realization that fails it before noise is added, and `tests/data/label-conventions.test.mjs` re-checks every clean row of the built corpora and every construction form of the lexicon. Assumed propositions are exempt: what the model adds is `assumed` by definition, although it reuses the message's phrases (above).

## Row fields

Only `question` is model input. Everything else is evaluation-only scaffolding, provenance or review metadata; no field other than `question` may enter a prompt, a training projection or a model-facing page.

| Field | Purpose | Seen by model? |
| --- | --- | --- |
| `question` | The whole user message (assertions, question, remarks, noise and code-switching): the only model input. | **yes** |
| `sop_target` | The gold model output: the DS021 program printed from `surface_ir` by the `strings` printer. | no (training target) |
| `target_format`, `provisional_constructs` | Printer name and constructs the printer marked provisional (empty). | no |
| `id`, `split`, `split_group_id`, `semantic_case_id`, `surface_group_id`, `negative_of` | Identity, split and grouping: paraphrases and contrast partners share a split group; `negative_of` names the contrast partner. | no |
| `language`, `code_switch` | Matrix language (`en`, `ro`) and the labelled code-switch (`kind`, `matrix`, `embedded`, inserted chunks) or null. | no |
| `noise`, `noise_level` | The typing-noise operations applied, one record each, and the level (`light`, `medium`, `heavy`) or null. | no |
| `family`, `variant`, `structure_id`, `question_type`, `input_mode`, `depth` | Generator family and variant, structure label, DS021 question type, whether the message has assertions, proof depth. | no |
| `surface_design` | Question frame, discourse frame, shape, form and masked template of the realization (diversity accounting). | no |
| `ir_skeleton`, `surface_ir` | The target as an intermediate representation (strings as written) and its masked skeleton. | no |
| `verification_context` | Evaluation-only verification context: the runtime clock `now`, the row language, `model_visible: false`, and the entities and predicates of the verification world with their surfaces. Formerly named `context`. | no |
| `ontology_sop` | Entity declarations of the verification world (labels and every surface used as an alias). | no |
| `world` | References to the shared predicate declarations and converse rules (`{dir, predicates, rules}`, assembled by `lib/row-world.mjs`). | no |
| `setup_sop`, `late_setup_sop` | Facts and family rules of the verification world; facts known only later (for `asof`). | no |
| `verification` | Canonical IR with ids, relation links, the intended ambiguous mention, answers, link problems (must be empty) and the time normalization. | no |
| `expected`, `expected_by_query` | The observed result of executing `sop_target` (status, answers, count; `unclear_kind` for unclear rows) and, for two questions, each query's result. | no |
| `execution` | How `expected` was obtained: executed or not, intended status and whether it agrees. | no |
| `evaluation_track`, `semantic_status` | Evaluation track (`formalization`) and semantic validity marker. | no |
| `review_status`, `target_review_status`, `quality_flags` | Review state (unreviewed, pending) and flags (synthetic, no copied source rows, not human-reviewed, not training-approved). | no |
| `lineage`, `source`, `rights` | Inspiration sources and family, generator revision, and the per-row rights stamp. | no |

`tests/data/label-conventions.test.mjs` fails when a built row carries a field that this table does not list, or a field named `context`, `prompt` or `model_input`. The audit browser (`/audit`) and the evaluation browser (`/eval`) show `question` as the model's input and every other field under verification-only headings.

## Diversity inventory

`node tools/datasets/diversity/mine-sources.mjs` streams the cached sources in `datasets_sources/` (sharded files are read through `lib/jsonl-shards.mjs`) and writes `datasets/diversity/inventory.json`. Every category is a documented lexical heuristic with real counts; examples are masked structural skeletons (closed-class words kept, every content word replaced by `X`), never source text.

| Inventory section | Source | Content |
| --- | --- | --- |
| `question_types`, `question_skeletons` | QQP, QA2D, AmbigNQ | wh-type, yes/no subtype, how-many/much/long, imperative, declarative questions, top masked skeletons per type |
| `paraphrase_operations` | QQP, PAWS | per label: reordering, clause movement, two-word swap, lexical substitution, question-frame change, person switch, contraction, addition/deletion, spelling variant, heavy rewrite; token-Jaccard bands |
| `ambiguity_types` | AmbigNQ | single versus multiple interpretations, interpretations per question, disambiguation operations (time dependency, entity reference, answer type, property/role, location or named qualifier, event) |
| `reasoning_depth_and_negation` | ProofWriter | status balance, status by depth, fact and question polarity, rule body sizes, negated bodies/heads, masked rule forms |
| `declarative_rewrites` | QA2D | wh-fronting undone, auxiliary inversion undone, do-support removed, answer position, length ratios |
| `discourse_forms`, `noise_rates`, `typo_model_measured` | all | multi-sentence, context-then-question, question-then-elaboration, embedded questions, conditionals, parentheticals; noise feature rates; typo operations measured on QQP hapaxes |
| `authored` | generator modules | names pool, construction lexicon, frames, noise and code-switching models, unclear generators, family examples, quotas |

## Generation pipeline

1. **Families** produce a canonical IR (predicate ids, domain roles, entity ids, ISO times) and a message plan. `families.mjs`: lookup, wh selection, count, filter, joins, temporal (at, during, inclusive start, exclusive end, stated intervals), attached statements, negation, closure and world/implicature assumptions, proof depth, ambiguity (entity reference, time dependency, location and event qualifiers, with resolved counterparts), claim check, statements only, numeric constraints (every bound stated in the message), six formerly blocked families, PAWS-style contrast pairs and two-question messages. `families-questions.mjs`: time questions (when, since when, until when, how long, how many times), where, how (means), why (`mode explain` over derivations, recorded facts and unexplained cases), universal questions (`general_quantification`: every, none, group and the existential "anyone … not"), conjunctions, interpretation assumptions (word sense, pronoun referent, "again"), visible ambiguity (`ambiguity_visible`: a resolved pronoun, and the unresolved cases — parallel-clause pronouns, bare homonyms, "all … not" scope, PP-attachment — as `unclear kind ambiguous`), and the `query-v2` phenomena re-expressed through the IR (`anchor`: knowledge cutoff `asof`, conflicting reports, a stated conflict, a defeated supposition, two selected variables; each row records `lineage.anchor`).
2. **Realization** (`realize.mjs`) turns each proposition into text through one *construction* of the lexicon (`domains.mjs`: 55 predicates (50 in-distribution, 5 held out for the OOD suite), 223 EN/RO constructions including converse verbs, voice alternation, light-verb forms and where-forms for location and destination roles), outer question frames (yes/no, wh, embedded, tag, declarative, particle), question-word frames (`TIME_FRAMES`, `WHY_FRAMES`, with Romanian verb-before-subject order in direct wh-questions), claim-check frames and discourse frames. The discourse frame is chosen first so that pronouns never precede their antecedent. Realization returns the text and the surface proposition together, so every quoted value is taken from the message itself.
3. **Names and entities** (`names.mjs`, `entities.mjs`) are natural and culturally mixed; ids are readable slugs used only in the verification world; two organizations never share a label; no counters or hashes reach text. A role may narrow a pooled type to plausible fillers (`ROLE_POOLS`: what a passport or permit *requires* is a supporting paper), and a construction whose meaning fits only part of a pool is not authored ("stă cu chirie în" would pair with vineyards and vans). One predicate keeps one role set for all its constructions and similar predicates use the same role for the same kind of argument (an event attended or planned is `object`; a by-agent of a passive is `object`).
4. **Noise and code-switching** (`noise.mjs`, see below) are deliberate and labelled (`row.noise`, `row.noise_level`, `row.code_switch`); quoted values are re-aligned to the final text.
5. **Printers** (`printers.mjs`) are pluggable (`registerPrinter`); `strings` prints the model target from the surface IR.
6. **Verification world.** A row carries its own entities (`ontology_sop`, every surface used as an alias), facts and family rules (`setup_sop`; `late_setup_sop` holds facts known later, for `asof`). The predicate declarations (closed-role lines, every relation phrase as label or alias) and the converse-equivalence rules are the same for every row, so they are stored once per corpus in `<corpus>/world/predicates.sop` and `rules.sop`; the row names the blocks it uses in `world {dir, predicates, rules}`, and `lib/row-world.mjs` assembles the full world for every consumer (the generator, `eval/run.mjs`, the audit tools and the `/audit` browser). The generator links every quoted value and relation phrase with the host's own `Lexicon` and `linkRelation` (`verification.link_problems` must be empty) and executes the target **exactly as printed** with model origin against the world: the host normalizes the time expressions and resolves quoted filter literals (DS021), so nothing is substituted. A row whose strings do not link, or whose observed status disagrees with the family's intended status, is excluded by the builder and counted in the report; a two-question row stores the whole target's result in `expected` and each question's in `expected_by_query`.
7. **Guards before writing**: quotas, mix rules, banned patterns, global message uniqueness and the in-memory no-copy check.

## Typing noise and code-switching (owner decision Q-ARCH-4)

A noisy row (about 30% of rows) draws a level and a number of operations: `light` (1 operation, 55% of noisy rows), `medium` (2–3, 33%), `heavy` (4–6, 12%) (`NOISE_LEVELS`). The operations follow the published taxonomy of typing errors (Damerau 1964; Kukich 1992) and are recorded one by one:

| Class | Operations |
| --- | --- |
| Character errors | adjacent-key substitution and insertion on the US QWERTY layout, the Romanian standard layout (SR 13392:2004, ă î â right of P, ș ț right of L) and the Romanian programmer layout (AltGr diacritics: a missed AltGr gives the base letter, a wrong one the neighbouring diacritic); omission; transposition; doubling. Weights follow the typo operations measured on QQP. |
| Space errors | a word split in two; two words merged |
| Diacritics | a dropped diacritic, a whole message without diacritics, cedilla variants (ş ţ for ș ț), a wrong diacritic (ă↔â, î↔â) |
| Phonetic misspellings | EN (their/there, than/then, definately, recieve, tomorow, …); RO (sînt, î for â, hyphen loss "sa"/"ia", "vreu", "nici un", …) |
| Autocorrect | a dictionary word for another (work→word, live→love, from→form; Romanian words corrected into English ones: unde→under, doar→door, …) |
| Formatting | lower-case start, dropped or repeated question mark, spaces around punctuation, missing apostrophes, chat spellings |

Words in both languages can be misspelled. Never touched: entity surfaces (a misspelled name would not resolve: the host never matches identities by similarity), and the cue words a label depends on — negations (with and without apostrophes), quantifiers ("all", "every", "no", "none", "toți", "niciun"), presupposition triggers ("still", "again", "încă", "mai", "iar", "din nou") and omission verbs. Cue words are matched with Unicode letter boundaries (JavaScript's `\b` does not see a boundary next to "î" or "ă"), so a Romanian cue such as "încă" is protected like an English one. A question mark is dropped only when the last sentence keeps another interrogative cue (a wh-word, an inverted auxiliary, "whether/dacă", a particle or a request verb), so no question becomes a statement. **Target policy:** role values are quoted as written, typos included (the anchoring guard and the host tolerate typos and diacritics); relation phrases follow the relation-phrase convention above and are written without the typos.

Code-switching (15% of rows) has five kinds: a clause switch (assertions in one language, the question in the other), intra-sentential insertions (English chunks in Romanian and the reverse, including morphologically integrated forms such as "să check-uiești"), carrier sentences with an embedded word ("Am un deadline vineri."), discourse markers ("Deci", "Adică", "Anyway", "Basically") and edge tags ("…, nu?", "…, right?", only after a yes/no question).

## Quotas and mix rules

`QUOTAS` in `tools/datasets/diversity/quotas.mjs` is the single source; a build fails on any violation.

| Quota | Value |
| --- | --- |
| Largest masked message template | ≤ 2% of rows |
| Ten largest masked templates together | ≤ 12% |
| Largest outer question frame | ≤ 8% |
| Largest family | ≤ 15% |
| Distinct target skeletons | ≥ 40 overall; ≥ 2 per family with at least 10 rows |
| Languages | EN 40–60%, RO 25–45%, mixed EN/RO 8–22% |
| Rows with labelled noise | 12–35% |
| `unclear` rows | 5–12% |
| Near-duplicates across groups | ≤ 5% (MinHash word 3-shingles, Jaccard ≥ 0.8, found with locality-sensitive hashing) |
| Any single inspiration source (the first of `lineage.inspired_by`) | ≤ 25% |
| Operator families (joins, temporal, filters, count, constraints, conjunctions, anchors, time questions, universal questions) | ≥ 25% together |
| Each formerly blocked family | ≥ 1.5% |
| Interpretation assumptions (`basis disambiguation` or `implicature`) | ≥ 1.5% |
| Question types (`row.question_type`) | universal ≥ 3%; yes/no ≥ 20%; wh ≥ 4%; count ≥ 2%; when ≥ 1.5%; since when, until when, how long, how many times ≥ 1% each; where ≥ 1.5%; why ≥ 1.5%; how ≥ 1%; claim check ≥ 1%; numeric ≥ 1.5%; two questions ≥ 1%; no question ≥ 1%; unclear ≥ 5% |
| Paraphrase groups | 1–3 independent realizations; each paraphrase differs in construction and/or frame |
| Banned patterns | none: knowledge-base or vocabulary references, «…» quoted conditions, pipeline stages, record/registry/archive framing (EN and RO), case ids, hash-like names |

Resource choice is balanced by usage (`Chooser`). Assumptions that restate the queried proposition (closure, defaults, presuppositions) are kept few by the family weights (`DEFAULT_FAMILY_WEIGHTS`).

## Split grouping and leakage

The split unit is the connected group (`split_group_id`): all paraphrases of a case and its linked contrast stay in one split. Split assignment is a seeded hash of the group (70/15/15). To keep the sealed test from measuring template recall, every realization resource list with at least three alternatives (question frames, discourse frames, joiners, constructions, form variants, authored texts) reserves exactly a quarter of its options (at least one) for the test split, the ones with the lowest stable hash, so train and dev always keep three quarters; one quarter of the names, places and pooled entities are reserved the same way. Messages are unique across the build after case, accent and punctuation folding. The audit's `leakage.template_overlap`, `leakage.near_duplicate` and `leakage.entity_overlap` measure the result.

## Corpora

| Corpus | Files | Content |
| --- | --- | --- |
| `formalizer-v1` | `datasets/formalizer-v1/train.jsonl` and `dev.jsonl` (stored as `.part-NNN.jsonl` shards of at most 45 MB when larger, `lib/jsonl-shards.mjs`), `eval/suites/formalizer-v1/test.jsonl` (sealed), `world/`, `manifest.json`, `report.json` | every family and question type in every split, EN/RO/mixed |
| `formalizer-ood-v1` | `eval/suites/formalizer-ood-v1/test.jsonl`, `world/`, `manifest.json` | out-of-distribution sealed suite: the generic families over held-out domains (cooking, repairs, gardening, choirs, lettings) whose predicates, relation phrases and vehicle/plant/choir entities never occur in `formalizer-v1` |

The main corpus manifest (`chatsop-corpus-manifest-v2`) records the split files, the sha256 of each logical file (the concatenated shards), the shared-world checksums, a summary by split, family, question type, language, status, noise level and code-switch kind, the noise levels and the rights block; `eval/suites/formalizer-v1/manifest.json` is the sealed suite's checksum authority for `tools/eval/registry.mjs`. The message-only training projection is `datasets/formalizer-v1/formalizer/{train,dev}.jsonl` with its manifest (`prompt_profile: message-only`). Scale is limited by diversity, not by row count: the build of about 34,000 rows (train about 24,000) keeps a masked-template ratio near 0.8 and near-duplicates under 2%; a larger build is made only while those metrics hold. The former `independent-v1` suite was not converted: its questions presuppose records visible to the model ("Is it documented that …", "Do the records establish …") and one of its ten structures is a host `clarify` target, so no faithful message-only form exists; the OOD suite replaces it.

## Checks

Every build passes, and `node check-datasets.mjs` and `npm run test:data` re-run: the structural invariants and the corpus audit with zero error-severity findings (`tools/datasets/audit-corpus.mjs`, procedure `skills/corpus-audit/SKILL.md`); `tools/datasets/no-copy.mjs`; `node tools/verify-vocabulary.mjs --scope all`; and execution against the verification worlds (`tools/datasets/verify-corpus.mjs`, a stratified sample by default and every row with `--all`, on any memory engine with `--engine`). An independent adversarial review of a stratified sample of about 400 rows (label faithfulness, real diversity, naturalness, coverage) precedes any proposal to qualify a corpus.

## Commands

```sh
node tools/datasets/diversity/mine-sources.mjs                    # inventory -> datasets/diversity/inventory.json
node tools/datasets/build-corpora.mjs --rows 34000 --ood-rows 1600 # formalizer-v1 + formalizer-ood-v1, manifests, report
node tools/datasets/audit-corpus.mjs --corpus formalizer-v1        # eval/reports/current/corpus-audit/formalizer-v1.json
node tools/datasets/audit-corpus.mjs --corpus formalizer-ood-v1
node tools/datasets/no-copy.mjs --corpus formalizer-v1
node tools/datasets/verify-corpus.mjs --corpus formalizer-v1 --all
node tools/datasets/verify-corpus.mjs --suite formalizer-ood-v1 --all
node tools/verify-vocabulary.mjs --scope all
node tools/research/prepare-experiment.mjs                         # message-only projection -> datasets/formalizer-v1/formalizer/
```

Measured values live in `datasets/formalizer-v1/report.json` and `eval/reports/current/corpus-audit/`; they are observations, not properties recorded here.

## Open items

1. AmbigNQ answer-type ambiguity is not generated yet (entity reference, time dependency, location and event qualifiers, word sense, pronoun referent, homonyms, scope and PP-attachment are).
2. The out-of-distribution suite is new in vocabulary, not in structure: it reuses the generic families and has no why, how, where, universal or ambiguous rows, because those families are written over the in-distribution predicates.
3. Naturalness items found by the independent reviews of 2026-09-28 and not yet fixed (labels are correct): the `anchor/stated_conflict` variant writes a self-contradiction in one message (about 185 rows); code-switch insertions mostly land in the opening remark rather than in the formalized proposition; about 50 rows ask whether an organization whose name contains a town ("the Passport Office in Tulcea") is located in another town; the OOD suite's `unclear` rows reuse messages of the main suite (14 identical messages); weather small talk is labelled `no_request`. Owner questions Q-DATA-5 ("pentru ce") and Q-DATA-6 ("din" → `"fi în"`) are open in `questions.md`.
4. Proportional quantifiers ("most", "half") have no model-language form yet (DS021).
