---
title: DS018-research-corpora
summary: The four inspired-by research corpora (QA proposition, proof structure, paraphrase contrast, ambiguity resolve) with their measured inventories, domain fidelity, prepared experiment inputs, usage examples and evaluation recipe.
---

# DS018 — Research corpora

> **Status (2026-09-28): historical.** The corpora, suites and builders this specification describes were deleted with the regeneration of the model-language corpora ([DS022](specsLoader.html?spec=DS022-diversity-generator.md): `formalizer-v1` and `formalizer-ood-v1`). The text below is kept as the record of their design and of the phenomena DS022 re-expresses; it does not describe files that exist.

This specification owns the four small, hand-designed research corpora `qa-proposition-v1`, `proof-structure-v1`, `paraphrase-contrast-v1` and `ambiguity-resolve-v1`, the preparation of their experiment inputs, and the evaluation recipe. The larger source-grounded counterparts built from the cached source datasets are specified in [DS019](specsLoader.html?spec=DS019-grounded-corpora.md).

## Rights and provenance (all four corpora)

Each corpus adapts the **design manner** of one or two public datasets (QA2D, ProofWriter, QQP with PAWS, AmbigQA) and copies nothing: every world, entity, statement, rule, question surface and answer was authored for this repository. No source row, passage, question or answer was copied or consulted while authoring them, and every row records `quality_flags.inspired_by` with the design attribution and `copied_source_rows: false`. By the owner's decision of 2026-09-28 these inspired-by corpora are released (`inspired-by-released`); the rights record, the status vocabulary and the no-copy check (`node tools/datasets/no-copy.mjs`) are owned by [DS014](specsLoader.html?spec=DS014-source-rights.md), and `datasets/SOURCES.md` lists each source with its URL and licence as known. A source's own text keeps its recorded status in the local cache under `datasets_sources/` and never enters a corpus. PAWS attribution to Google LLC (and the underlying Wikipedia terms for its material) is kept as a courtesy even though only aggregate PAWS statistics were used.

All rows carry `review_status: not_reviewed`, `human_reviewed: false` and `training_approved: false`. Runtime execution checks internal consistency of each gold against its authored setup; it is not human semantic review and not training approval. No model inference, optimization or training takes place in building or validating these corpora.

Two rules govern the adaptation and both come from the user:

1. **Domain fidelity.** Adapt the *manner and structure* of the source design, keep the **domain of the source case**, and vary only the subject, entities and wording. Domains carry their own terminology, relations, inference patterns and characteristic ambiguity, so relocating a case into another (especially a narrower) domain destroys the subtleties we want to teach.
2. **Breadth.** No corpus may collapse into one topic. The spread must mirror the source's topical distribution; for PAWS the measured distribution below was used as the target shape.

### Target format: legacy, pending regeneration

Every row is `evaluation_track: 'formalization'`. The model-facing golds of these four corpora are **legacy-format**: they are atom `query` and `constraint` wires over canonical identifiers with a per-row ontology and context block, and `qa-proposition-v1` additionally contains the removed conditional-context `premise` wire for attached reports. They are not written in the current model language (`stated`, `assumed`, `unclear`, `query`, `constraint` with quoted strings and the closed role set, specified in [DS021](specsLoader.html?spec=DS021-model-surface.md)), and they await regeneration by the diversity generator ([DS022](specsLoader.html?spec=DS022-diversity-generator.md); tracked in `TODO.md`). Approved rules, sourced facts and any execution step live in the reviewed `setup_sop`, never in a model target.

## Corpora at a glance

Counts below are a dated snapshot from the 2026-09-28 build, not a current measurement; each builder's `datasets/<corpus>/manifest.json` and the machine audit in `eval/reports/current/corpus-audit/` hold the counts for the files on disk.

| Corpus | Design adapted (manner only) | Cases | Rows (train/dev/test) | EN / RO | Families | Domains |
| --- | --- | ---: | --- | --- | --- | ---: |
| `qa-proposition-v1` | QA2D: a question plus its answer implies a declarative proposition | 90 | 288 (96/96/96) | 270 / 18 | 5 | 12 |
| `proof-structure-v1` | ProofWriter: facts, approved rules, status and derivation depth | 75 | 240 (144/48/48) | 225 / 15 | 5 | 15 |
| `paraphrase-contrast-v1` | QQP equivalence + PAWS high-overlap structural contrast | 60 | 240 (128/56/56) | 180 / 60 | 7 | 14 |
| `ambiguity-resolve-v1` | AmbigQA: ambiguous question, disambiguated rewrites, answers per rewrite | 60 | 60 (36/12/12) | 48 / 12 | 4 | 12 |
| **Total** | | **285** | **828 (404/212/212)** | **723 / 105** | 21 | 53 distinct domain labels |

Observed coverage by construction: a question answered from a documented proposition; a one-hop and a two-hop rule chain with reported derivation `depth` 0/1/2; explicit denial and absent-rule `unknown` without closed-world assumption; a counted question; identity, role, quantifier, comparison-direction, temporal-order, modifier-scope and argument-order contrasts; four ambiguity types (shared name, missing time, predicate sense, unresolved pronoun) each with two disambiguated rewrites.

### Domain fidelity, measured

The PAWS Wikipedia-only validation sample (8000 pairs, fetched with its LICENSE, no row exported) was analysed with coarse keyword proxies. Primary-pair buckets: geography/places 995, arts/books/language 581, sports/leisure 260, education/research 229, everyday/household 200, life sciences/health 192, travel/transport 184, history/society 170, commerce/services 161, law/administration 148, technology/infrastructure 101, physical/earth sciences 44, agriculture/food 19, weather/climate 13 (4703 unclassified). The authored corpora follow that shape: encyclopedic and humanities topics dominate, technology is a minor slice, and every corpus spans at least twelve distinct domains. When these four corpora were authored, the QA2D, ProofWriter, QQP and AmbigQA rows had not been read, so their exact topical frequencies were not measured and are not claimed; the per-corpus domain tables below are achieved distributions of the authored rows only.

## QA proposition corpus (`qa-proposition-v1`)

**Design.** A natural question and a proposed answer are rendered as an explicit declarative proposition, then tested by a declarative `query` against a small authored evidence card. Design attribution: **QA2D design (Demszky et al., [arXiv:1809.02922](https://arxiv.org/abs/1809.02922))**. The generator constructs every source sentence, question surface, entity and expected answer locally; there is no downloaded source dataset. The rows are LLM-assisted original examples. Their synthetic source URI is provenance for the local evidence card, not an attribution to a real historical or scientific claim.

The design source is the question-to-declarative-proposition pattern in general encyclopedic passages, *not source examples or a measured QA2D topic histogram*. The broad adapted-domain plan preserves history, geography, sciences, arts, sports, health, public administration and daily topics instead of forcing every sentence into one industry. Each authored card keeps its own subject-domain vocabulary in all three proposition contrasts. Domain labels describe the synthetic example, not external-source provenance.

**Layout and behavior.**

- `tools/datasets/build-qa-proposition.mjs` deterministically writes authored train/dev rows to `datasets/qa-proposition-v1/` and test rows to `eval/suites/qa-proposition-v1/test.jsonl`.
- Five reasoning families: staffing/role direction, procurement/existence versus distinct count, maintenance/half-open temporal bounds, licensing/explicit negative evidence, and cargo inspection/attached conditional assumption. Their examples range across the topical domains in the table below; family names describe **logical structure**, not a universal subject area.
- Each case has three distinct English questions; 18 of 90 cases also have a Romanian anchor. The `proposition` field states the declarative claim implied by the question. Every row has an explicit `context_assertions` array: for attached cargo reports it contains an assumed statement corroborated by a separately approved source fact and, in the legacy gold, modeled with the removed nonpersistent conditional-context wire; otherwise it is empty and evidence enters through approved `setup_sop` source facts.
- Contrasts use `negative_of` links within one world and split. Role reversal and denial change `supported` to `refuted`; existence versus count changes a boolean proposition into a two-vendor count; a half-open interval changes in-range support to unknown at its exclusive end; reversed polarity distinguishes a recorded denial from the positive claim. Each family also includes an unsupported open-world query (no closed-world false inference). The conditional cargo report and approved ledger agree on one proposition but neither supports its negation or an unrelated shipment.
- Counts and gold answers are author-decided from the local cards; runtime execution checks them but is **not** semantic human review.

| Reasoning family | Semantic cases | Rows |
|---|---:|---:|
| staffing (role direction) | 18 | 60 |
| procurement (existence/count) | 18 | 57 |
| maintenance (temporal bound) | 18 | 57 |
| licensing (explicit negation) | 18 | 57 |
| cargo inspection (attached assertion) | 18 | 57 |
| **Total** | **90** | **288** |

| Language | Cases with a surface | Rows |
|---|---:|---:|
| English | 90 | 270 |
| Romanian | 18 | 18 |

| Split | Semantic cases | Rows | Romanian anchors |
|---|---:|---:|---:|
| train | 30 | 96 | 6 |
| dev | 30 | 96 | 6 |
| test | 30 | 96 | 6 |

The adaptation-domain inventory below is the **intended general-encyclopedic domain spread** from the design manner, *not observed counts from QA2D*. The achieved column is calculated from these rows; each world has three cases and three English surfaces, with an additional Romanian anchor on selected cases. No domain exceeds 12/90 cases.

| Adapted-from topical domain (general encyclopedic source manner, not sampled QA2D rows) | Achieved cases | Achieved rows |
|---|---:|---:|
| agriculture and food | 12 | 39 |
| arts and literature | 9 | 28 |
| education and research | 3 | 9 |
| everyday household life | 9 | 28 |
| geography and places | 9 | 30 |
| history and museums | 6 | 19 |
| law and administration | 3 | 10 |
| life sciences and health | 12 | 38 |
| physical sciences | 9 | 30 |
| sports and leisure | 9 | 29 |
| technology and infrastructure | 3 | 9 |
| travel and transport | 6 | 19 |
| **Total achieved** | **90** | **288** |

```sh
node tools/datasets/build-qa-proposition.mjs
node tools/datasets/validate.mjs --file eval/suites/qa-proposition-v1/test.jsonl --execute
node --test tests/qa-proposition.test.mjs
```

The sealed test command executes every test-row gold (`qualification: not_reviewed`), while the scoped test executes all 288 train/dev/test golds and probes a deliberately incorrect count oracle. This demonstrates consistency with the runtime, **not** verified encyclopedic truth, human semantic adjudication, or permission to train. The hand-authored microcards intentionally give no external factual coverage guarantee; open-world unknown means missing supported evidence, not factual falsity.

## Proof-structure corpus (`proof-structure-v1`)

**Design.** Adapts the **design manner** of ProofWriter (Tafjord et al., *Findings of ACL 2021*): a small world has observed facts, approved inference rules, a question, an answer status, and a minimal derivation depth. Every row records `quality_flags.inspired_by: 'ProofWriter design (Tafjord et al., Findings of ACL 2021)'`. Provenance records source-card content and its SHA-256 checksum, not external material.

The source **manner** spans ordinary-world categories such as animals, objects and properties, people and roles, places, weather, food, and vehicles. The table is the *actual achieved* domain distribution, not a claim about ProofWriter frequencies. The world order deliberately alternates topics rather than concentrating related examples together.

| Authored topic (source-manner category retained) | World | Split | Semantic cases | Rows |
| --- | --- | --- | ---: | ---: |
| Animals | Marsh heron | train | 5 | 16 |
| Objects, colours and materials | Ceramic vase | train | 5 | 16 |
| People and roles | Museum curator | train | 5 | 16 |
| Places and geography | River gorge | dev | 5 | 16 |
| Weather | Coastal front | test | 5 | 16 |
| Food | Bakery loaf | train | 5 | 16 |
| Vehicles and transport | Tram car | train | 5 | 16 |
| Earth sciences | Basalt sample | train | 5 | 16 |
| Health | Clinic specimen vial | dev | 5 | 16 |
| Sports | Tennis court | test | 5 | 16 |
| Arts and books | Poetry volume | train | 5 | 16 |
| Agriculture | Orchard plot | train | 5 | 16 |
| Household life | Laundry machine | train | 5 | 16 |
| Education | School science room | dev | 5 | 16 |
| Commerce | Market stall | test | 5 | 16 |
| **Total** | **15 original worlds** | **train/dev/test** | **75** | **240** |

Each domain accounts for 6.67% of semantic cases. Facts and domain-specific predicates are declared in each row's `setup_sop`, `ontology_sop` and `context.predicates`; no kinship fixture or imported rows are used. Each world has three observed facts (including **one explicit negative fact**) and four host-approved rules. The first rule derives a property from a fact; the second requires **two body atoms**, one of them derived, to give a depth-two chain; the final two derive opposing conclusions about an additional property. A dedicated runtime test queries that conflicting property and observes `both`. No exported gold asks for the conflicting property, since this suite's answer statuses are intentionally restricted to `supported`, `refuted`, `unknown`. An unrelated unobserved property remains `unknown` without closed-world inference.

**Split, surfaces and oracle.** The collection contains **train: 9 worlds / 45 cases / 144 rows**, **dev: 3 / 15 / 48**, and **sealed test: 3 / 15 / 48**. Development examples are in `datasets/proof-structure-v1/{train,dev}.jsonl`; test examples are only in `eval/suites/proof-structure-v1/test.jsonl`. Every world's five semantic cases and four surfaces per anchored case remain in its one split, preserving all 15 disjoint `split_group_id` components. Overall there are 225 English and 15 Romanian rows (train 135/9, dev 45/3, test 45/3). Each case has **three distinct English question surfaces** with an identical canonical target. One case per world (20% of semantic cases) also has a Romanian anchor question.

**Track per family:** `direct`, `one_hop`, `two_hop_join`, `explicit_denial`, and `absent_rule` are **formalization** in every split (15 cases per family). A model needs to author only one declarative `query` wire. Its trusted `setup_sop` supplies the facts and approved rules; in the legacy rows their readable descriptions are exposed as `context.background_assertions` and `context.background_rules`. Those rules are not model-generated and never appear in the `sop_target`. A question that needs a model-authored execution wire (`solve`, `reason`, `rule`, etc.) would instead require the **system** track; there are no such targets in this corpus. The training/dev `formalizer/*.jsonl` exports use `barePrompt`, with `id`, `input_mode`, `prompt`, `target`, `context`, `group`; they contain no instruction to generate a `solve` or rule.

`expected.packet.depth` is the number of rule applications in the *minimal justification* for the facts used by an answer: a directly observed fact has depth 0, one implication depth 1, and the authorized conjunctive chain depth 2. Unknown questions have no proof and report runtime depth 0. These values are checked against the real runtime rather than inferred from surface phrasing.

| Gold status / minimal depth | Semantic cases | Rows |
| --- | ---: | ---: |
| supported / 0 (direct) | 15 | 45 |
| supported / 1 (one hop) | 15 | 45 |
| supported / 2 (two-hop conjunctive rule) | 15 | 60 |
| refuted / 0 (explicit negative fact) | 15 | 45 |
| unknown / 0 (absent evidence or rule) | 15 | 45 |
| **Total** | **75** | **240** |

Status totals: supported 45 cases / 150 rows; refuted 15 / 45; unknown 15 / 45. Depth totals: 0 = 45 cases / 135 rows, 1 = 15 / 45, 2 = 15 / 60. The five structure families have 15 cases each. `negative_of` is null for all rows: the semantic contrasts come from independent questions against the same approved world, not relabelled negative pairs.

```sh
node tools/datasets/build-proof-structure.mjs
node tools/datasets/validate.mjs --file eval/suites/proof-structure-v1/test.jsonl --execute
node --test tests/proof-structure.test.mjs
```

Observed after the split: builder reported **240 rows / 75 semantic cases (train 144, dev 48, test 48)**; the sealed-test validator executed **48/48 gold rows** with `status: verified_against_runtime`, `qualification: not_reviewed`. Additionally, `executeCorpus` verified **train 144/144 and dev 48/48**; scoped tests **4/4 passed**, including proof depth, conjunction, explicit negation, open-world unknown and contradictory conclusions. The worlds are intentionally small.

## Paraphrase-contrast corpus (`paraphrase-contrast-v1`)

**Design.** An original, integrator-authored set of small worlds and questions borrowing **only the manner** of QQP-style equivalent questions and PAWS-style high-token-overlap contrasts: three English paraphrases of each proposition share a canonical declarative target; a reciprocal `negative_of` case changes one structural feature and has a different target and gold outcome. The per-row flag is `inspired_by: 'QQP equivalence + PAWS contrast designs'`. QQP contributes only the equivalence-design idea and PAWS only aggregate pattern/domain statistics; there is no sampled external case-to-case adaptation, and the QQP topical distribution was not measured.

**Measured inventory.** Generated by `node tools/datasets/build-paraphrase-contrast.mjs`. The manifest records JSONL checksums and category counts. There are **240 rows**, **60 distinct semantic cases**, **30 connected contrast pairs**, **180 English surfaces**, and **60 Romanian anchors** (25% of rows). Every case has three English paraphrases with the same canonical target and one Romanian anchor. All 60 cases meet the paraphrase-invariance criterion (100%, exceeding 20%). Whole contrast pairs are assigned to **train 32 cases/128 rows**, **dev 14/56**, and disjoint sealed **test 14/56**; each split contains all seven structural families. No paraphrase group or reciprocal `negative_of` pair crosses splits. Only train/dev live in `datasets/paraphrase-contrast-v1/{train,dev}.jsonl`; the test rows live only in `eval/suites/paraphrase-contrast-v1/test.jsonl`. Instruction-free formalizer projections for train/dev live in `datasets/paraphrase-contrast-v1/formalizer/`.

| Single structural change within each pair | Pairs | Semantic cases | Rows |
| --- | ---: | ---: | ---: |
| Directed argument order: agent ↔ patient | 5 | 10 | 40 |
| Polarity: positive ↔ explicit negation | 5 | 10 | 40 |
| Quantifier: some ↔ every on the same finite domain | 4 | 8 | 32 |
| Comparison direction: greater-than ↔ less-than | 4 | 8 | 32 |
| Temporal order: event A before B ↔ B before A | 4 | 8 | 32 |
| Modifier scope: color of carrier ↔ color of object | 4 | 8 | 32 |
| Entity role: one person and object, different role | 4 | 8 | 32 |

| Structural family | Train cases/rows | Dev cases/rows | Test cases/rows |
| --- | ---: | ---: | ---: |
| Argument order | 6 / 24 | 2 / 8 | 2 / 8 |
| Negation | 6 / 24 | 2 / 8 | 2 / 8 |
| Some/every quantifier | 4 / 16 | 2 / 8 | 2 / 8 |
| Comparison direction | 4 / 16 | 2 / 8 | 2 / 8 |
| Temporal order | 4 / 16 | 2 / 8 | 2 / 8 |
| Modifier scope | 4 / 16 | 2 / 8 | 2 / 8 |
| Entity role | 4 / 16 | 2 / 8 | 2 / 8 |
| **Total** | **32 / 128** | **14 / 56** | **14 / 56** |

Each row records `structural_change`, `structural_change_detail`, `topical_domain`, its original scenario provenance and explicit reciprocal `negative_of` link. The status contrast is `supported/refuted` for evidence queries, `possible/unknown` for existential/universal finite-domain questions, and `possible/impossible` for reversed numeric comparisons. The row ontology declares the local entities and predicates; the numerical constraints need no undeclared symbolic predicate. All model-facing targets consist only of declarative `query` or `constraint` wires; documentary `fact` wires remain in `setup_sop`.

**Source-design domains and achieved coverage.** QQP-style equivalence and PAWS-style rearrangements concern general-topic text rather than a single specialized topic. The PAWS source-side counts below are the **exclusive primary keyword-proxy buckets** measured over 8,000 PAWS-Wiki validation pairs in `eval/reports/current/rights/paws-structure.json`, not human labels. They are aggregate measurements only: no source row was read or reused while authoring the examples. Our original cases preserve each selected topic **within its pair**, while reproducing the broad source-domain shape rather than claiming to match raw source frequencies. In particular geography dominates the classified topical buckets, arts/books remain prominent, and technology is minor. No output domain exceeds 23.3% of semantic cases.

| Source-design domain (PAWS proxy) | PAWS source pairs | Original contrast designs | Achieved cases/rows | Train cases/rows | Dev cases/rows | Test cases/rows |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Agriculture and food | 19 | 1 | 2 / 8 | 2 / 8 | 0 / 0 | 0 / 0 |
| Arts, books and language | 581 | 3 | 6 / 24 | 2 / 8 | 4 / 16 | 0 / 0 |
| Commerce and services | 161 | 2 | 4 / 16 | 4 / 16 | 0 / 0 | 0 / 0 |
| Education and research | 229 | 2 | 4 / 16 | 4 / 16 | 0 / 0 | 0 / 0 |
| Everyday household life | 200 | 2 | 4 / 16 | 2 / 8 | 0 / 0 | 2 / 8 |
| Geography and places | 995 | 7 | 14 / 56 | 8 / 32 | 4 / 16 | 2 / 8 |
| History and society | 170 | 2 | 4 / 16 | 2 / 8 | 0 / 0 | 2 / 8 |
| Law and administration/public records | 148 | 2 | 4 / 16 | 4 / 16 | 0 / 0 | 0 / 0 |
| Life sciences and health | 192 | 2 | 4 / 16 | 0 / 0 | 2 / 8 | 2 / 8 |
| Physical and earth sciences | 44 | 1 | 2 / 8 | 0 / 0 | 2 / 8 | 0 / 0 |
| Sports and leisure | 260 | 2 | 4 / 16 | 0 / 0 | 2 / 8 | 2 / 8 |
| Technology and infrastructure | 101 | 1 | 2 / 8 | 0 / 0 | 0 / 0 | 2 / 8 |
| Travel and transport | 184 | 2 | 4 / 16 | 4 / 16 | 0 / 0 | 0 / 0 |
| Weather and climate | 13 | 1 | 2 / 8 | 0 / 0 | 0 / 0 | 2 / 8 |
| Unclassified by the PAWS keyword proxy | 4703 | 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| **Total** | **8000** | **30** | **60 / 240** | **32 / 128** | **14 / 56** | **14 / 56** |

The output column names differ slightly from the proxy labels (for example `arts and language`, `law and public records`); their topical correspondence is explicit in the table. The large unclassified bucket means the proxy cannot certify a true source-domain distribution. Output proportions deliberately retain rare domains for breadth, not because the proxy classified that many source examples there.

```sh
node tools/datasets/build-paraphrase-contrast.mjs
node --test tests/paraphrase-contrast.test.mjs
node tools/datasets/validate.mjs --file eval/suites/paraphrase-contrast-v1/test.jsonl --execute
```

The runtime validation checks reference setup and expected status, and reports `qualification: not_reviewed`. It is **not** a human semantic assessment or a model-accuracy claim. Some status differences concern possibility versus provability on finite integer intervals; these are intentionally different tasks applied to one stated domain. No QQP/PAWS benchmark rows are redistributed or derived from here.

## Ambiguity-resolve corpus (`ambiguity-resolve-v1`)

**Design.** Inspired by **AmbigQA design (Min et al., EMNLP 2020)** ([paper](https://aclanthology.org/2020.emnlp-main.466/)): an ambiguous question, distinct disambiguated rewrites, and the answer implied by each rewrite. This corpus adapts **the open-domain ambiguity/rewrite/answer manner**, not any AmbigQA question, passage, answer, or row. The paper's source-domain distribution was not measured, so no per-domain equivalence to its dataset is claimed. Every evidence card and surface was authored independently for this suite, and its quoted facts are included in its own checksum-bound source content.

The generator is `tools/datasets/build-ambiguity-resolve.mjs`; it publishes development rows to `datasets/ambiguity-resolve-v1/{train,dev}.jsonl`, instruction-free `barePrompt` projections to `datasets/ambiguity-resolve-v1/formalizer/{train,dev}.jsonl`, and the **only sealed test copy** to `eval/suites/ambiguity-resolve-v1/test.jsonl`. `datasets/ambiguity-resolve-v1/manifest.json` records checksums for all five exports. Development projections contain `id`, `input_mode`, `prompt`, `target`, `context`, and `group`; the prompt uses `barePrompt` and contains no instruction preamble.

**Cases and gold behavior.** There are **20 independent ambiguity scenarios, 60 distinct semantic cases and rows**: 12 scenarios / 36 rows in train, four / 12 in dev, and four / 12 in sealed test. Each scenario contributes one ambiguous question and two disambiguated rewrites; each rewrite has a different declarative `query` and exactly one distinct answer. Scenario `split_group_id` keeps its three semantic cases and all their surfaces in a single split. The scoped host ontology supplies two entities sharing the ambiguous alias; the setup supplies two independently quoted evidence facts, and `context.entities`/`context.predicates` enumerate the identities and declared relation. Ambiguous targets use the alias as an entity argument, so host identity resolution, rather than a model-authored wire, generates `clarify`; the model never refuses and never writes `clarify`. The gold packet checks `pendingSop`, the ambiguous `required` resolution and two candidate identities, and `next:answer_clarification`. Rewrites use explicit entity identities and yield `supported` with separate answer tuples. All 60 targets contain only `query`, within the `formalization` track. The `predicate_sense` family represents two plausible meanings of a polysemous verb (such as *date* meaning estimating age versus stamping a calendar date) as scoped sense entities; this exercises host clarification about **which predicate meaning** was intended, not direct host predicate-ID resolution.

| Ambiguity family (`structure_id`) | Track | Scenarios | Train cases / rows | Dev cases / rows | Test cases / rows | English rows | Romanian rows |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Shared personal name (`shared_name`) | formalization | 5 | 9 | 3 | 3 | 12 | 3 |
| Missing time reference (`missing_time`) | formalization | 5 | 9 | 3 | 3 | 12 | 3 |
| Unclear predicate/verb sense (`predicate_sense`) | formalization | 5 | 9 | 3 | 3 | 12 | 3 |
| Pronoun without unique referent (`pronoun_referent`) | formalization | 5 | 9 | 3 | 3 | 12 | 3 |
| **Total** | **formalization** | **20** | **36** | **12** | **12** | **48** | **12** |

Four scenarios have Romanian surfaces/rewrites, one per ambiguity family; their evidence source and entity labels remain the independently authored named referents. The other 16 scenarios have English surfaces/rewrites. Language by split (EN / RO cases and rows): train **30 / 6**, dev **9 / 3**, test **9 / 3**. Gold outcomes by split (clarify / supported): train **12 / 24**, dev **4 / 8**, test **4 / 8**.

**Source manner versus achieved topical coverage.** The adapted-from source manner is open-domain QA ambiguity across person names, time/event references, vocabulary senses, and discourse referents. The source's per-domain distribution was not measured and is not mapped onto our cards. Achieved coverage, counted from all 20 authored cards (each card = 3 distinct semantic cases/rows):

| Achieved domain | Scenarios | Train cases / rows | Dev cases / rows | Test cases / rows | Total semantic cases / rows |
| --- | ---: | ---: | ---: | ---: | ---: |
| Arts, books and language | 1 | 3 | 0 | 0 | 3 |
| Commerce | 1 | 0 | 3 | 0 | 3 |
| Education and research | 2 | 3 | 3 | 0 | 6 |
| Everyday household life | 2 | 6 | 0 | 0 | 6 |
| Geography | 2 | 3 | 0 | 3 | 6 |
| History and society | 2 | 6 | 0 | 0 | 6 |
| Law and public records | 1 | 3 | 0 | 0 | 3 |
| Life sciences and health | 2 | 3 | 3 | 0 | 6 |
| Physical science | 2 | 6 | 0 | 0 | 6 |
| Sports and leisure | 1 | 0 | 0 | 3 | 3 |
| Travel and transport | 2 | 3 | 0 | 3 | 6 |
| Weather and climate | 2 | 0 | 3 | 3 | 6 |
| **Total** | **20** | **36** | **12** | **12** | **60** |

No domain exceeds 10% of the complete corpus's semantic cases. Each card keeps its own topical vocabulary (e.g., a theatrical performance remains an arts question, and a relay heat remains a sports result); the ambiguity categories rotate through domains rather than collapsing into a single industrial topic. These are examples of the open-domain design, **not** a sampled domain inventory of AmbigQA.

```sh
node tools/datasets/build-ambiguity-resolve.mjs
node tools/datasets/validate.mjs --file eval/suites/ambiguity-resolve-v1/test.jsonl --execute
node --test tests/ambiguity-resolve.test.mjs
```

The executable **sealed-test** validation reports 12/12 gold rows verified against the runtime with qualification `not_reviewed`; the focused test exercises all 60 published rows, checking every ambiguous host clarification against its packet and that its two rewrites return distinct answers. The manifest binds each exported JSONL by SHA-256. The suite does not claim that a natural-language model can discover the gold targets or that the synthetic examples have been independently reviewed.

## Prepared experiment inputs

`node tools/research/prepare-experiment.mjs [--corpora a,b,c]` discovers the corpora under `eval/suites/*-v1`, then, for each one:

1. checks that no connected group (case, its surfaces and its `negative_of` partners) crosses train/dev/test;
2. checks that every formalization target contains only declarative wires;
3. projects the formalization train and dev rows into legacy-format inputs with a context block under `datasets/research-train-v1/<corpus>/formalizer/{train,dev}.jsonl` (pending regeneration; under the current model contract the prompt is the user's message alone, with no context block);
4. records per-corpus counts, per-track/per-language/per-split/per-structure tallies, connected-group count, an input file list with SHA-256, and an `id + target` fingerprint in `datasets/research-train-v1/manifest.json`;
5. **references** the sealed test suites by path and hash instead of copying them, so the authoritative test stays under `eval/suites/<corpus>/`.

The tool refuses to write when a check fails, never fills in missing answers, and states `training_authorized: false`. The run recorded on 2026-09-28 (historical; re-run the tool for current numbers) covered five discovered corpora (`qa-proposition-v1`, `proof-structure-v1`, `paraphrase-contrast-v1`, `ambiguity-resolve-v1`, and the test-only `independent-v1`): 1228 rows in total, 616 instruction-free projections written (404 train, 212 dev), and 572 formalization rows remaining sealed under `eval/suites/<corpus>/` — `independent-v1` contributes 400 rows, all sealed test, so it produces no train/dev projection.

## Usage examples

`node examples/research/demo.mjs` executes six authored examples of the declarative surface (employment/roles, IT incident, project staffing, maintenance sites, geography/travel, agriculture) against the real host path and asserts each outcome: the proposition answer, the polarity `supported`/`refuted` pair, the temporal `supported`/`unknown` pair, the host clarification with `pendingSop`/`required`/`next`, the spatial containment answer, and the counted answer. `examples/research/README.md` indexes them. They are syntax demonstrations, not adaptations; the corpora above are the adaptation work.

## Evaluation recipe (no training)

```sh
# 1. execute every sealed gold against the runtime
node tools/datasets/validate.mjs --file eval/suites/qa-proposition-v1/test.jsonl --execute
node tools/datasets/validate.mjs --file eval/suites/proof-structure-v1/test.jsonl --execute
node tools/datasets/validate.mjs --file eval/suites/paraphrase-contrast-v1/test.jsonl --execute
node tools/datasets/validate.mjs --file eval/suites/ambiguity-resolve-v1/test.jsonl --execute

# 2. prepare/project the experiment inputs and record fingerprints
node tools/research/prepare-experiment.mjs

# 3. the labeled non-model sanity check over the same suites
node tools/metrics/run.mjs --file eval/suites/qa-proposition-v1/test.jsonl --gold-as-prediction --out eval/reports/current/metrics

# 4. only when an authorized model exists: explicit {id,sop} predictions through the registry
node tools/eval/registry.mjs audit && node tools/eval/registry.mjs run && node tools/eval/registry.mjs index
```

## Limits

- No human or independent semantic review has occurred; `qualification` stays `not_reviewed` and the corpora are not training-qualified. Training remains unauthorized until a new explicit approval.
- The golds are legacy-format and do not yet follow the current model language; see "Target format" above.
- Keeping connected groups inside one split means some domains appear in only one or two splits (for example sports only in test for the ambiguity corpus); the per-domain split tallies are recorded in the sections above and in the prepared manifest so a training run can be balanced deliberately.
- `proof-structure-v1` exports only `supported`/`refuted`/`unknown`; the contradictory `both` outcome is exercised by a scoped test rather than exported as gold.
- No neural model was trained, served or evaluated; every number above is a symbolic execution result.
