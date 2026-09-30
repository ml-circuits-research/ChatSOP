---
title: DS022-diversity-generator
summary: The model-language corpora and their generator - mined source inventory, IR-based generation, question-form and interpretation families, pluggable printers, shared verification worlds, the typing-noise and code-switching model, quotas and mix rules, split grouping, the corpus split (formalizer-v1 plus the out-of-distribution suite), the verified LLM diversification layer and the checks.
---

# DS022 — Diversity generator and the model-language corpora

## Scope and status

This specification defines how the formalizer corpora are generated for the model language (DS021) with diversity that is real rather than templated. It covers the mined diversity inventory, the generator (`tools/datasets/diversity/`), its intermediate representations, the pluggable target printers, the evaluation-only verification worlds, the typing-noise and code-switching model, the quotas and mix rules, split grouping against template leakage, the corpus split and the checks every build passes. The corpora are `formalizer-v1` (train and dev under `datasets_archive/formalizer-v1/`, the sealed test under `eval/suites/formalizer-v1/`) and the out-of-distribution suite `eval/suites/formalizer-ood-v1/`. The earlier corpora (query-v1/v2, pilot-v1, the pilot of this generator, grounded-*, the research `*-v1` corpora, generated/, seed/, normalized/, templates/, research-train-v1, the independent-v1 suite and their builders) were deleted with the regeneration of 2026-09-28. The corpora are synthetic and unreviewed, and nothing here authorizes training (AGENTS.md rule 3).

Rights: the corpora are inspired by QQP, PAWS, ProofWriter, AmbigNQ, QA2D and SQuAD under the owner's decision of 2026-09-28 (DS014). They take structure, label types, phenomena and statistics, never text; `datasets/SOURCES.md` lists what was taken and what was not, and `tools/datasets/no-copy.mjs` proves it. Each row carries the compact stamp `rights {license, rights_decision, inspired_by, text_copied: false}` (`rowRights` in `tools/datasets/rights.mjs`); each manifest carries the full block (`manifestRights`).

## Model input and target

1. **The model input is the user's message only.** A row's `question` is the whole message: assertions, question, greetings, remarks, noise. The model sees no context, shortlist, identifiers, background, rules or clock. Every other row field is evaluation-only scaffolding or metadata and never enters a prompt (see "Row fields" below); the scaffolding that used to be called `context` is named `verification_context` so that nobody mistakes it for model input. The training projection (`tools/research/prepare-experiment.mjs`) writes `prompt = question` and fails closed on anything else.
2. **Targets use strings, not ids.** The printer follows `sop/parser.mjs`; the grammar and every convention (values as written, relations as meant, the question forms, the interpretation assumptions, the "because" convention) are owned by DS021, and rows carry no profile field. The corpora apply DS021's "relations as meant" with the stricter relation-phrase convention below.
3. **Targets keep the message's language, normalized** (owner decision D1 of 2026-09-29, DS021 "Input languages and content words"). Content words are written in the language of the message's own words: an English message gets English relation phrases and common nouns; a Romanian message gets the Romanian lemma of its predicate words (`"lucra la"`, `"fi înscris la"`, `"avea sediul în"`) and its common nouns in the nominative with their determiners (`"sala de sport"`, `"fratele meu"`); a mixed message keeps each word in its own language. Dates are copied as written, `unclear` readings are paraphrases in the message's language, proper names stay exactly as written, and the structural keywords are English. There is one convention for training targets; the host and the evaluation also accept the English rendering and listed synonyms through the host dictionary (DS021, DS016). The generator's constructions are the dictionary's `generator.tsv` source (`node tools/dictionary.mjs seed-generator`), so every Romanian and English surface it can print links; a stated common noun is anchored in the message by the ordinary inflection tolerance, or through the dictionary (host: `mentionedThroughDictionary`; audit: `tools/datasets/audit/translation.mjs`).
4. **Ambiguity tolerance** (owner decision Q-DATA-5). A genuinely ambiguous phrasing is neither dropped nor refused: the primary `sop_target` formalizes one plausible reading and `sop_targets_accepted` lists the others; evaluation accepts any of them (DS016 "Equivalence tolerance"). The explicit table `AMBIGUOUS_PHRASINGS` in `generate.mjs` lists the phrasings; the first is Romanian "pentru ce" with a closed venue ("Pentru ce e închisă sala?": what is it closed for, `select ?x … role topic ?x`, or why is it closed, `mode explain`). `unclear kind ambiguous` remains for the visible ambiguities the model does not resolve.
5. **One clause, one wire** (owner decisions L1–L4, DS021 "Clauses and links"). The generator composes compound messages from clause templates: each finite clause is printed as its own wire, a subordinate, conditional, concessive, purpose, temporal or result clause is linked with the keyword of its conjunction (`because`, `so`, `if`, `unless`, `although`, `so_that`, `before`, `after`, `when`, `while` and `$id`; placement and target certainty as in DS021), a clause used as an argument is a `$id` role value, and a follow-up question about an earlier answer is a `$q` chain. A whole clause is never printed as a string value. Negative rows carry a connective that is not a link ("I ask because …", "sorry if this is long", "since Monday" as a date) so the model does not link every connective. Links are verified by execution where the host acts on them (a condition scoped to one of several queries, a timed before/after bound, a `$q` join) and structurally elsewhere (the packet lists the link as `not_checked`).
6. **Honest partial formalization** (DS021 "Honest partial formalization", conventions C14). Rows with deliberately unformalizable spans — jargon, idioms, garbled fragments, references to earlier turns ("aia", "el", "de mai devreme", "that one") — print the understood parts normally, the span verbatim in an `unparsed` wire with `near` and `hint`, and a placeholder variable in the role the span would fill. The expected packet records the host repair (`repairs`) or the one question per unresolved span (`unresolved_spans`).
7. **Stated versus assumed.** `stated` carries only what the message surely asserts: user assertions, hedges, suppositions and reported speech. A declarative the user asks to have checked is a query. Remarks about the user's own situation or purpose are not formalized. Everything the model adds is `assumed`: closure negatives, the asymmetry of relations that are asymmetric by meaning (`basis world`: management, parenthood), defaults, presuppositions without an invented time, and chosen readings (`relation "mean"`, `relation "refer to"`, `basis disambiguation`). An assumption reuses a relation phrase of the message: a world assumption reverses the *statement* with the statement's own phrase ("Ana manages Irina" → `assumed` "Irina" does not "manage" "Ana"), never the question's phrase, because restating the question through another relation ("raise" for "be a parent of") would be reasoning; a closure or default assumption uses the question's phrase. A presupposition assumption exists only when its trigger ("still", "again", "încă", "mai", "iar", "din nou") is in the message.
8. **The model never refuses.** The formerly blocked families (abduction, default with exception, counterfactual, planning, causal, intention, general quantification) are formalized like any other message; general quantification is the universal question (`mode every`).

## Relation phrases

The relation phrase of a `stated` wire and of a query `match` block is **the message's own predicate words with the role fillers removed, lemmatized**, in the language of those words: `"work at"` for "works at", `"lucra la"` for "lucrează la", `"avea sediul în"` for "o firmă cu sediul în", never a translation and never a paraphrase. The generator and every reviewer apply one convention:

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
| `sop_targets_accepted` | Other accepted readings of a genuinely ambiguous phrasing (Q-DATA-5), each a complete DS021 program; absent on most rows. | no (evaluation) |
| `ood_axis` | On `formalizer-ood-v1` rows only: `domain` (held-out predicates) or `construction` (held-out constructions of in-distribution predicates). | no |
| `target_format`, `provisional_constructs` | Printer name and constructs the printer marked provisional (empty). | no |
| `id`, `split`, `split_group_id`, `semantic_case_id`, `surface_group_id`, `negative_of` | Identity, split and grouping: paraphrases and contrast partners share a split group; `negative_of` names the contrast partner. | no |
| `language`, `code_switch` | Matrix language (`en`, `ro`) and the labelled code-switch (`kind`, `matrix`, `embedded`, inserted chunks) or null. | no |
| `noise`, `noise_level` | The typing-noise operations applied, one record each, and the level (`light`, `medium`, `heavy`) or null. | no |
| `family`, `variant`, `structure_id`, `question_type`, `input_mode`, `depth` | Generator family and variant, structure label, DS021 question type, whether the message has assertions, proof depth. | no |
| `surface_design` | Question frame, discourse frame, shape, form, masked template and every resource id the realization chose (`resources`: constructions, templates, frames, joiners), plus the composed parts of a long message (diversity accounting and the held-out overlap metric). | no |
| `ir_skeleton`, `surface_ir` | The target as an intermediate representation (target strings; a translated relation keeps its message phrase as `source_relation`) and its masked skeleton. | no |
| `verification_context` | Evaluation-only verification context: the runtime clock `now`, the row language, `model_visible: false`, and the entities and predicates of the verification world with their surfaces. Formerly named `context`. | no |
| `ontology_sop` | Entity declarations of the verification world (labels and every surface used as an alias). | no |
| `world` | References to the shared predicate declarations and converse rules (`{dir, predicates, rules}`, assembled by `lib/row-world.mjs`). | no |
| `setup_sop`, `late_setup_sop` | Facts and family rules of the verification world; facts known only later (for `asof`). | no |
| `verification` | Canonical IR with ids, relation links, the intended ambiguous mention, answers, link problems (must be empty) and the time normalization. | no |
| `expected`, `expected_by_query` | The observed result of executing `sop_target` (status, answers, count; `unclear_kind` for unclear rows) and, for two or more questions, each query's result. | no |
| `execution` | How `expected` was obtained: executed or not, intended status and whether it agrees. | no |
| `evaluation_track`, `semantic_status` | Evaluation track (`formalization`) and semantic validity marker. | no |
| `review_status`, `target_review_status`, `quality_flags` | Review state (unreviewed, pending) and flags (synthetic, no copied source rows, not human-reviewed, not training-approved). | no |
| `lineage`, `source`, `rights` | Inspiration sources and family, generator revision, and the per-row rights stamp. | no |
| `generation_trace` | On LLM-authored rows only (section "LLM diversification"): `method` (`llm-paraphrase`), `source_row_id`, the model id, the prompt versions and sha256 hashes, the judge verdict and reason, every filter result and the cache keys. | no |

`tests/data/label-conventions.test.mjs` fails when a built row carries a field that this table does not list, or a field named `context`, `prompt` or `model_input`. The audit browser (`/audit`) and the evaluation browser (`/eval`) show `question` as the model's input and every other field under verification-only headings.

## Diversity inventory

`node tools/datasets/diversity/mine-sources.mjs` streams the cached sources in `datasets_sources/` (sharded files are read through `lib/jsonl-shards.mjs`) and writes `datasets_archive/diversity/inventory.json`. Every category is a documented lexical heuristic with real counts; examples are masked structural skeletons (closed-class words kept, every content word replaced by `X`), never source text.

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
2. **Realization** (`realize.mjs`) turns each proposition into text through one *construction* of the lexicon (`domains.mjs`: 55 predicates (50 in-distribution, 5 held out for the OOD suite), 241 EN/RO constructions (18 of them held out for the OOD suite, `HELDOUT_CONSTRUCTIONS`) including converse verbs, voice alternation, light-verb forms and where-forms for location and destination roles), outer question frames (yes/no, wh, embedded, tag, declarative, particle), question-word frames (`TIME_FRAMES`, `WHY_FRAMES`, with Romanian verb-before-subject order in direct wh-questions), claim-check frames and discourse frames. The discourse frame is chosen first so that pronouns never precede their antecedent. Realization returns the text and the surface proposition together, so every proper name is quoted from the message itself and every common noun and date is the message's own words, normalized (DS021 "Input languages and content words").
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
| Speech-to-text | dictation homophones (by/buy, to/too, write/right, whether/weather, for/four, …; RO "să"/"sa", "că"/"ca"); none creates or removes a negation cue |
| SMS and regional forms | EN texting abbreviations (tmrw, ppl, bc, tho, plz); RO colloquial and regional variants (amu, aci, mâni, oleacă, numa, tare) |
| Formatting | lower-case start, dropped or repeated question mark, spaces around punctuation, missing apostrophes, chat spellings; their weights are proportional to the rates measured on real user text (inventory `noise_rates.qqp`, statistics only), rescaled to the authored total with a floor (`formattingWeights`) |

Words in both languages can be misspelled. A word takes at most one character or space error: stacking several typos on one word ("fact-check" → "fadzxt-check") produces garbage no user types, so a word changed by one error is protected from the next. Chat spellings ("pt" for "pentru") are applied outside entity surfaces, like every other word error. Never touched: entity surfaces (a misspelled name would not resolve: the host never matches identities by similarity), and the cue words a label depends on — negations (with and without apostrophes), quantifiers ("all", "every", "no", "none", "toți", "niciun"), presupposition triggers ("still", "again", "încă", "mai", "iar", "din nou") and omission verbs. Cue words are matched with Unicode letter boundaries (JavaScript's `\b` does not see a boundary next to "î" or "ă"), so a Romanian cue such as "încă" is protected like an English one. A question mark is dropped only when the last sentence keeps another interrogative cue (a wh-word, an inverted auxiliary, "whether/dacă", a particle or a request verb), so no question becomes a statement. **Target policy:** role values are quoted as written, typos included (the anchoring guard and the host tolerate typos and diacritics); relation phrases follow the relation-phrase convention above and are written without the typos.

Code-switching (15% of rows) has seven kinds. Two switch inside the formalized proposition: a pooled common noun named in the other language inside the clause ("Ion predă chemistry", "Ana sells ardei"; `ro_matrix_en_value`, `en_matrix_ro_value`), with the English label as the target value. The other five are a clause switch (assertions in one language, the question in the other), intra-sentential insertions (English chunks in Romanian and the reverse, including morphologically integrated forms such as "să check-uiești"), carrier sentences with an embedded word ("Am un deadline vineri."), discourse markers ("Deci", "Adică", "Anyway", "Basically") and edge tags ("…, nu?", "…, right?", only after a yes/no question).

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

The split unit is the connected group (`split_group_id`): all paraphrases of a case and its linked contrast stay in one split. Split assignment is a seeded hash of the group (70/15/15). To keep the sealed test from measuring template recall, every realization resource list with at least three alternatives (question frames, discourse frames, joiners, constructions, form variants, authored texts) reserves exactly a quarter of its options (at least one) for the test split, the ones with the lowest stable hash, so train and dev always keep three quarters; one quarter of the names, places and pooled entities are reserved the same way. The frame tables of `frames.mjs` and the construction lists of `domains.mjs` are partitioned once, over their full lists, by id (`tools/datasets/diversity/heldout.mjs` `RESOURCE_ROLES`): a call site that passes a filtered sub-list (only plain frames, no tag after a negation) gets the same roles, so a frame reserved for the sealed suites never reaches train or dev through another sub-list. OOD-only resources (below) are excluded from every formalizer-v1 split. Messages are unique across the build after case, accent and punctuation folding. The audit's `leakage.template_overlap`, `leakage.near_duplicate` and `leakage.entity_overlap` measure the result.

## Corpora

| Corpus | Files | Content |
| --- | --- | --- |
| `formalizer-v1` | `datasets_archive/formalizer-v1/train.jsonl` and `dev.jsonl` (stored as `.part-NNN.jsonl` shards of at most 45 MB when larger, `lib/jsonl-shards.mjs`), `eval/suites/formalizer-v1/test.jsonl` (sealed), `world/`, `manifest.json`, `VERSION`, `report.json` | every family and question type in every split, EN/RO/mixed |
| `formalizer-ood-v1` | `eval/suites/formalizer-ood-v1/test.jsonl`, `world/`, `manifest.json` | out-of-distribution sealed suite with two axes (`row.ood_axis`): `domain`, the generic families over held-out domains (cooking, repairs, gardening, choirs, lettings) whose predicates, relation phrases and vehicle/plant/choir entities never occur in `formalizer-v1`; `construction`, in-distribution predicates realized only through held-out constructions and frames |
| `formalizer-wild-v1` (not generated) | `eval/suites/formalizer-wild-v1/test.jsonl`, `manifest.json` | eval-only suite of 796 independently written, double-annotated and adjudicated messages ([DS016](specsLoader.html?spec=DS016-evaluation-metrics.md) "Independent wild suite"); this generator never produces or reads it (`eval/leakage.mjs` `INDEPENDENT_SUITES`), and no family may be designed from its rows |

`datasets_archive/formalizer-v1/VERSION` (`chatsop-dataset-version-v1`, read by `training/cli.mjs`) is written by the build: a counter that advances whenever the manifest changes, a label, the seed and the manifest sha256. The main corpus manifest (`chatsop-corpus-manifest-v2`) records the split files, the sha256 of each logical file (the concatenated shards), the shared-world checksums, a summary by split, family, question type, language, status, noise level and code-switch kind, the noise levels and the rights block; `eval/suites/formalizer-v1/manifest.json` is the sealed suite's checksum authority for `tools/eval/registry.mjs`. The message-only training projection is `datasets_archive/formalizer-v1/formalizer/{train,dev}.jsonl` with its manifest (`prompt_profile: message-only`). Scale is limited by diversity, not by row count: the build of about 34,000 rows (train about 24,000) keeps a masked-template ratio near 0.8 and near-duplicates under 2%; a larger build is made only while those metrics hold. The former `independent-v1` suite was not converted: its questions presuppose records visible to the model ("Is it documented that …", "Do the records establish …") and one of its ten structures is a host `clarify` target, so no faithful message-only form exists; the OOD suite replaces it.

## Out-of-distribution suite

The OOD suite holds out domains, constructions and lead-in frames, so it measures more than recall of the training lexicon. Its rows use the `ood` resource partition (`heldout.mjs`): the OOD-only resources and the test-reserved ones, none of which occurs in formalizer-v1 train or dev.

1. **Held-out constructions** (`domains.mjs` `HELDOUT_CONSTRUCTIONS`), one per language for nine in-distribution predicates, never used by formalizer-v1: English "be on the payroll of", "reside in", "stock", "show up at", "lecture in", "be the trainer of", "take care of", "attend classes at", "go on a trip to"; Romanian "avea un post la", "trăi în", "comercializa", "fi prezent la", "da lecții de", "pregăti", "avea grijă de", "frecventa", "pleca la" (with English targets, `english.mjs`).
2. **Held-out frames** (`heldout.mjs` `OOD_ONLY_FRAMES`), per language: yes/no, wh, claim-check, time-question, why, discourse, conjunction and multi-question frames. Whole question forms are held out where every frame of the form is OOD-only (`OOD_ONLY_FORMS`): English tail questions ("…, do you know?", "…, if you know?"), the opinion frame ("Would you say that …?") and alternative questions ("… or not?"); Romanian alternative ("… sau nu?") and tail questions ("…, te rog?"). The discourse shapes `parenthetical` (EN) and `question_then_elaboration` (EN, RO) are held out with their frames (`OOD_ONLY_SHAPES`).
3. **Two axes.** About 60% of the suite is the `domain` axis and 40% the `construction` axis (the predicates with held-out constructions, `usePredicatePool('ood_construction')`); both use the generic families plus long messages.
4. **Overlap guarantee.** After generation the builder drops, with its whole split group, every OOD row that uses a lead-in frame (question frame, discourse frame or any registered frame among its resources) or a construction that occurs in a formalizer-v1 train or dev row, or that repeats a formalizer-v1 message; a formalizer-v1 row that used an OOD-only resource fails the build. `report.json` (`resource_overlap`) and the OOD manifest (`overlap_with_formalizer_v1_train_dev`) record the frame and construction overlap with train/dev (zero by construction for the OOD suite; also reported for the formalizer-v1 test split, whose partition is per list and weaker), the share of rows using an OOD-only resource and the share with a held-out form or shape; `tests/data/ood-holdout.test.mjs` re-checks the built files.

## Expansion families

`families-expansion.mjs` authors whole EN and RO messages with their targets through the custom path (data-expansion proposal, owner decisions Q-LANG-1 to Q-LANG-7): a variant returns stated propositions, one or more queries, or a constraint, using the words-only fields of DS021 (`compare`, `rank`, `quantifier`, `order`, `fragment`, `except`). Romanian variants write the English phrase and record `source_relation`. Nine authored-only predicates are appended to `domains.mjs` (flag `authored`, no generated forms, never drawn by the generic families): `costs` (integer price), `aged` (integer age), `opens_at` (a clock time value), `sent_to` (sender, amount value, recipient), `moved` (source, destination), `bought_together` (a conjoined group), `means` (term, meaning), `may_sign`, and `should_accept` (advice); a `term` pool is added. Families and weights (about 14% of a build):

| Family | Weight | Expected status |
| --- | --- | --- |
| coordination (C5: distributive split, collective conjoined value) | 0.4 | supported or unknown |
| transfer (several participants: recipient, source, destination; amounts as written) | 0.4 | supported or unknown |
| existence ("is there", `mode exists`) | 0.3 | supported or unknown |
| conditional ("if … then": `stated certainty supposed` + query) | 0.3 | observed (hypothetical) |
| attribute_value: value, `compare`, `rank` (Q-LANG-1) | 0.75 | observed |
| definition ("what does X mean") | 0.25 | supported or unknown |
| filtered_count (`mode count` + `compare` or `except`) | 0.35 | observed |
| quantified (`quantifier` on `mode every`, Q-LANG-2) | 0.45 | observed |
| ordering (`order ?t1 before ?t2`, Q-LANG-3) | 0.35 | observed |
| fragment (`fragment follow_up`, Q-LANG-4) | 0.3 | clarify (no conversation context) |
| first_person ("the user", "the user's brother", Q-LANG-5) | 0.35 | supported or unknown |
| modality (modal inside the relation; advice, Q-LANG-6) | 0.35 | allowed: supported or unknown; advice: not_computable |
| alternatives (one yes/no query per option) and arithmetic (integer-scaled constraint, Q-LANG-7) | 0.4 | per option supported or unknown; percentage: possible; division: not_computable |
| offered_answer (C6) and relative_clause (C9) | 0.35 | offered answer: yes/no plus an accepted wh reading; relative clause: supported |

Model targets never contain operator symbols: filters print as `except ?x "X"`, comparisons as `compare`, and constraints in words. Quantified statements are not generated (a value such as "most of the players" names no entity the host could link). The `unclear` and `time_question` weights were raised (2.1, 2.8) so that their quotas hold next to the new families.

## Long messages

Real users write multi-sentence and multi-paragraph messages. The `long_message` family (about 7% of the rows of every split and of the OOD suite) composes one message of 500 to about 6,000 characters (mostly 500–1,500, some up to 3,000, a few longer; `long.mjs` `lengthTarget`) from independently realized parts: statement cases (plain, negated, hedged, reported) first, then two to six question cases, each drawn from the generic families with its own construction, frame and noise, grouped into paragraphs with chit-chat about the user's own situation, an occasional list of the user's errands, a lead-in before the questions and a sign-off. Chit-chat and lists never assert a relation between named entities, so they produce nothing. The target concatenates the parts' `stated` and `assumed` wires and prints one query per question (`@q`, `@q2`, …), one keyword per line. Parts whose predicates share a relation phrase ("go to": studies_at and attended) or whose entities share a surface with an earlier part are not composed, so linking stays unambiguous; each question is executed alone with every statement of the message and must agree with its part's intended status. `report.json` records the length distributions of messages and targets in approximate tokens (characters / 4) per split (`summary.lengths`), since output length drives CPU latency.

## Adding an input language

The small model normalizes the new language; the host dictionary translates it (DS021). A new input language changes the corpora, the fine-tuning and the dictionary data, never the knowledge or the reasoner. Adding one means:

1. **Constructions**: for every predicate of `domains.mjs`, constructions in the new language (verb forms, agreement, question forms) with their lemma phrases, and labels in the language for every common-noun entity pool; the dictionary gets the language's entries (`generator.tsv` from the constructions, an open bilingual source recorded in DS014, reviewed hand entries).
2. **Frames**: question, claim-check, time, why and discourse frames, joiners and chit-chat in the language, partitioned like the existing tables (`heldout.mjs`), with OOD-only frames of their own.
3. **Noise**: a typo and keyboard model for the language (layouts, diacritics, phonetic and autocorrect errors, chat spellings) and the protected cue words (negations, quantifiers, presupposition triggers).
4. **Code-switching with English**: clause switches, insertions, carriers and edge tags between the language and English.
5. **The same target convention**: content words normalized in the message's language; proper names as written; the relation-phrase convention checked on the message's words.
6. **Quotas per language**: `QUOTAS.language_shares` gains the language, and every question type, family and noise level is covered in it; evaluation reports it as its own language slice (DS016 "Slices").

## LLM diversification

Owner decision D2 (2026-09-29): "OK. Can you do this with a Haiku agent? It's fine to diversify as much as we need. Can it be done systematically?" The answer is `tools/datasets/llm-diversify/`, a layer over the generator that adds messages written by Claude Haiku (`claude-haiku-4-5-20251001`, Claude Code headless, no thinking, no tools, empty settings) while every label stays executable and inherited. Rights: DS014 "LLM-authored text".

**Paraphrase layer** (`pipeline.mjs paraphrase`). Input: generator rows (train or dev only) with their gold targets. A seeded, stratified sample (family × language slice; `sample.mjs`; `unclear` and `long_message` excluded because their label is a property of the wording) is sent to the writer, which returns N paraphrases of the MESSAGE in the row's language (English, Romanian, or mixed with both languages kept), varying register, word order, sentence structure, politeness, length, lower-case starts and a few typos. The writer sees the message, the message spans that must survive verbatim (names and literal values as written) and the message's predicate words (inflection allowed, synonyms and translation forbidden); it never sees the target. A paraphrase is kept only when every filter passes:

| Filter | Check |
| --- | --- |
| (a) anchors | every target value the message writes appears exactly as in the message; every content word of each stated or asked relation phrase keeps an inflected form (`relationWordProblems`, so the target's relation phrase stays the message's own words); no number is dropped or added; an English by-agent passive stays passive and an active relation does not become a by-passive, because the roles follow the voice (`anchors.mjs`) |
| (b) cues | question versus statement, the number of questions, the wh answer type (until when, since when, how long, how many times, how many, why, where, when, who), the negation count (tag questions excluded), hedge, supposition, clause-initial conditional and reported-speech cues, universal/only/most quantifiers, numeric bounds (exactly, at least, half, …) and presupposition triggers agree |
| (c) judge | a second, independent Haiku call with a different prompt, seeing only the two messages, answers `same` with a reason; stage-1 controls check it: identical pairs must be judged the same, pairs with a swapped or replaced name must not |
| (d) no-copy | `no-copy.mjs` against the cached source datasets (8-gram, identifiers), and the sealed-suite guard (`sealed-guard.mjs`, a sealed auditor run as a separate process that returns only pass/fail): no exact duplicate or shared word 8-gram with formalizer-v1 test, OOD or wild messages, no distinctive 4-gram (absent from train/dev and from the source message) shared with OOD or wild messages, and no OOD or wild name the source message does not write; the paraphrase also duplicates no train/dev message |
| (e) execution | the unchanged gold, executed with the paraphrase as the input text against the row's verification world, reproduces the stored `expected` |

An accepted paraphrase becomes a row of the source's split and split group (`rows.mjs`): the target, accepted readings, world and expected result are reused unchanged, so correctness is inherited, not re-labelled; frame resources are dropped and construction resources kept; noise labels are cleared; provenance is `generation_trace` (above), `source.authored_by` and `rights.authored_by` = `llm-paraphrase`, `quality_flags.llm_authored: true`.

**Mechanics.** Calls are cached by the sha256 of (model, system prompt, user turn, sample index) under `eval/reports/current/llm-diversify/cache/`, run with a shared concurrency pool (8 by default) and exponential backoff that pauses every worker on a rate limit, and are logged with latency, tokens and cost (`calls.jsonl`). `applyQuota` (`pipeline.mjs mix`) keeps LLM-authored rows at most 40% of a build, chosen by a seeded hash, and refuses them outside train and dev. A run is staged: the first 50 sampled rows form stage 1, and the run stops (exit 3) if stage-1 acceptance is below 20% or a judge-control accuracy is below 85%, so the prompt is fixed and the reason recorded before more calls are spent. Prompts never contain a sealed-suite row, a wild writer persona or an annotation example; `tests/data/llm-diversify.test.mjs` checks the prompts and the pipeline sources. The pilot report (`eval/reports/current/llm-diversify/pilot/summary.json`, `pilot-summary.md`) gives the acceptance per filter, language and family, the diversity gain against the train/dev messages (`diversity.mjs`: new masked templates, new structural skeletons and lead-ins, novel 3/4-gram occurrences, new word types, with dev-versus-train as the generator baseline) and the cost per accepted row.

**Distillation layer** (`distill.mjs`, interfaces only). Haiku writes new messages from phenomenon briefs (a family or gap name, language, register, length band; never a wild or OOD row or persona), two independent formalizations are produced, and a row is kept only when both agree exactly after canonicalization and pass the parser, vocabulary, anchoring and execution checks, then the same no-copy checks. The target format is pluggable (`registerTargetFormat`) because it is changing (clause chaining, Romanian normalization: D1, L1–L6); until a format is registered, `distill` refuses to run.

## Simple-text rendering

Owner idea (2026-09-29, the "neural simplifier + symbolic NLP" study): a small dedicated model that only rewrites a message into short simple sentences, placed in front of the symbolic UD → SOP path (`lib/ud-to-sop/`, `baseline-ud-rules-v1`), so that as much as possible stays symbolic and the neural layer learns only the nuances. `tools/datasets/diversity/simple-text.mjs` (`renderSimpleText(surfaceIr, {language, message, entities})`) renders the oracle simple text of a row deterministically from its surface IR. The simple text is verification scaffolding and a candidate simplifier target; it is never formalizer input. Conventions:

| Convention | Rule |
| --- | --- |
| Clauses | One short grammatical clause per line, explicit subject–verb–object, present tense; past forms only when the proposition carries a time. Built from the proposition's generator construction forms (`s`, `n`, `q`, `nq`, `wh*`, `cnt*`, `where*`, past variants); a proposition without a usable construction goes through a small generic conjugator and is counted in `fallbacks` |
| Language | Per proposition, the message language: Romanian when the proposition has a Romanian source phrase (`source_relation`), otherwise English. Content words normalized (lemma-based construction forms, diacritics restored); owner decision D1 |
| Names and values | Exactly as in the message; a Romanian row's English common-noun label (Q-DATA-6) is mapped back to the alias the message writes; Romanian dates are written in Romanian from the ISO date |
| Questions | One question per line: English do/be inversion, Romanian declarative order with a question mark (verb-first after a wh-word). Time questions use "when / since when / until when / how long" ("când / de când / până când / cât timp"); further conjuncts of a query are `And: …` (`Și: …`) lines; a count without a count form is `Count: …` (`Numără: …`) |
| Status and subordination | A connective label opens the line: `Maybe:`, `Suppose:`, `<speaker> says:` / `<speaker> thinks:`, `Assumption:` (model-added reading) and, for query modifiers, `Except:`, `Condition:`, `Options:`, `Rank:`, `Order:`, `As of:`, `Group:` + `Check <quantifier>:` (universal questions). Romanian: `Poate:`, `Să presupunem:`, `<speaker> spune:` / `crede:`, `Presupunere:`, `Excepție:`, `Condiție:`, `Variante:`, `Clasament:`, `Ordine:`, `Conform datelor din:`, `Grup:`, `Verifică <cuantificator>:`. Labels were chosen over subordinate clauses because a UD converter reads a sentence-initial label without attachment ambiguity |
| Constraints | `Number x is between LO and HI.`, `Condition: <words>.`, then `Is it possible that <claim>?` or `Prove that <claim>.` |
| Chit-chat and unclear | `no_request` renders as an empty text (chit-chat dropped); `gibberish` keeps the message verbatim; `ambiguous` renders `Ambiguous.` and one `Reading: …` line per reading |

`tools/research/simplifier-oracle.mjs` (evaluation side: it reads the sealed suites, so it lives outside the generator area and no generator or training module imports it; the renderer itself reads no suite) writes stratified samples (language × family, deterministic hash order) of the sealed test (500) and OOD (500) suites and the whole wild suite to `eval/reports/current/simplifier/oracle/`. The wild suite has no IR: its gold SOP target is parsed back into a surface IR (`sopToSurface`) and rendered in English, because wild golds are English (Q-DATA-6); this is an oracle for an upper bound, not a realistic simplifier output. `tests/data/simple-text.test.mjs` checks the conventions.

## Checks

Every build passes, and `node check-datasets.mjs` and `npm run test:data` re-run: the structural invariants and the corpus audit with zero error-severity findings (`tools/datasets/audit-corpus.mjs`, procedure `skills/corpus-audit/SKILL.md`); `tools/datasets/no-copy.mjs`; `node tools/verify-vocabulary.mjs --scope all`; and execution against the verification worlds (`tools/datasets/verify-corpus.mjs`, a stratified sample by default and every row with `--all`, on any memory engine with `--engine`). An independent adversarial review of a stratified sample of about 400 rows (label faithfulness, real diversity, naturalness, coverage) precedes any proposal to qualify a corpus.

## Commands

```sh
node tools/datasets/diversity/mine-sources.mjs                    # inventory -> datasets_archive/diversity/inventory.json
node tools/datasets/build-corpora.mjs --rows 34000 --ood-rows 1600 # formalizer-v1 + formalizer-ood-v1, manifests, report (--dry-run: measure only)
node tools/datasets/audit-corpus.mjs --corpus formalizer-v1        # eval/reports/current/corpus-audit/formalizer-v1.json
node tools/datasets/audit-corpus.mjs --corpus formalizer-ood-v1
node tools/datasets/no-copy.mjs --corpus formalizer-v1
node tools/datasets/verify-corpus.mjs --corpus formalizer-v1 --all
node tools/datasets/verify-corpus.mjs --suite formalizer-ood-v1 --all
node tools/verify-vocabulary.mjs --scope all
node tools/research/prepare-experiment.mjs                         # message-only projection -> datasets_archive/formalizer-v1/formalizer/
node tools/datasets/llm-diversify/pipeline.mjs paraphrase --rows 300 --n 3   # LLM paraphrase pilot -> eval/reports/current/llm-diversify/
node tools/datasets/llm-diversify/pipeline.mjs mix --base <rows> --llm <rows> --out <rows>  # at most 40% LLM-authored
node tools/research/simplifier-oracle.mjs --test 500 --ood 500      # oracle simple text -> eval/reports/current/simplifier/oracle/
```

Measured values live in `datasets_archive/formalizer-v1/report.json` and `eval/reports/current/corpus-audit/`; they are observations, not properties recorded here.

## Open items

1. AmbigNQ answer-type ambiguity is not generated yet (entity reference, time dependency, location and event qualifiers, word sense, pronoun referent, homonyms, scope and PP-attachment are).
2. The out-of-distribution suite holds out domains, constructions and frames, but it has no why, how, where, universal or ambiguous rows, because those families are written over in-distribution predicates without held-out constructions.
3. Naturalness items found by the independent reviews of 2026-09-28 and not yet fixed (labels are correct): the `anchor/stated_conflict` variant writes a self-contradiction in one message (about 185 rows); code-switch insertions mostly land in the opening remark rather than in the formalized proposition; about 50 rows ask whether an organization whose name contains a town ("the Passport Office in Tulcea") is located in another town; weather small talk is labelled `no_request`. (OOD messages identical to a formalizer-v1 message are now dropped by the builder. Owner decisions Q-DATA-5 and Q-DATA-6 of 2026-09-28 are implemented: accepted alternative golds and canonical English targets.)
4. Proportional quantifiers ("most", "half") have no model-language form yet (DS021).
