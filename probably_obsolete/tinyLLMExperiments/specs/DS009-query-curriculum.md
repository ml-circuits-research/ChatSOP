---
title: DS009-query-curriculum
summary: Question-to-wire coverage, the question curriculum generator, the query corpus v2 inventory, semantic adjudication, and the no-training gate.
---

> **Status (2026-09-28): historical.** The corpora, suites and builders this specification describes were deleted with the regeneration of the model-language corpora ([DS022](specsLoader.html?spec=DS022-diversity-generator.md): `formalizer-v1` and `formalizer-ood-v1`). The text below is kept as the record of their design and of the phenomena DS022 re-expresses; it does not describe files that exist.

## Introduction

The query curriculum must teach a small formalizer to state a declarative SOP problem and genuine user claims, not to imitate an answer string or choose session, retrieval and rendering operations. A separate host-expanded circuit executes that declaration. Earlier executable corpus targets remain evidence about the low-level runtime, not proof that a declarative-target curriculum is already qualified. The semantic case, not each paraphrase, is the unit of knowledge, and missing source knowledge, missing semantic structures and missing reasoning capability are distinct gaps. No curriculum document authorizes a training run or makes an unsupported operator executable.

The machine-readable coverage contract is `datasets/query-profile.json`. The authoritative wire fields are generated from the parser into `sop/contracts/wires.json` by `node tools/capabilities.mjs --write`. These are a coverage requirement, not a claim that every wire is represented by qualified training examples.

Material-source extraction, source-specific rights/budgets and exact passage provenance are specified in [DS011-material-sources.md](specsLoader.html?spec=DS011-material-sources.md); source drafts do not become model targets or accepted runtime knowledge.

## Core Content

### Case and input-mode decisions

- One canonical target per semantic case; translations, paraphrases and hard negatives are grouped before splitting, and Romanian coverage is counted by cases as well as rows.
- The input modes are `query_only`, `assertions_query` and the historically named `clarification`. The model represents claims from the message as `stated` (asserted, hedged, supposed or reported) and its own additions as `assumed`, as context-free strings that the host links ([DS021](specsLoader.html?spec=DS021-model-surface.md)); never sourced `fact` or `remember`. The host retains the original input text without publishing any statement or assumption, and generates `clarify` only from a valid declarative problem whose identity or required scalar is missing or nonunique; old standalone model-authored `clarify` targets belong in the system track unless genuinely reauthored. Source setup remains a separate host operation.
- A preferred source is not a validated SOP mapping: external corpora contribute only structure, label types, phenomena and statistics under the inspired-by release and the no-copy check ([DS014](specsLoader.html?spec=DS014-source-rights.md)); source scaffolds never become invented gold.
- An executable bounded operation, an approved theory and a missing capability are different states. Defaults, causal guesses, intentions or counterfactuals are never turned into hard Horn facts.
- The current parser is authoritative. Foreign dialects require an explicit compiler and reviewed semantics; they are not silently accepted aliases.
- Safe local alpha-renaming and parser normalization are automatic. Different structures with only finite agreement require LLM review and a separate principal decision.
- The small model does not maintain a synonym dictionary: host linking resolves language, symbolic kind, entity type and optional domain after the model, and the `resolve` wire exposes the same exact lookup boundary.

### Wire inventory and trust boundary

The trusted full-circuit inventory contains the following wire types; model-origin SOP admits only `stated`, `assumed`, `unclear`, `query` and `constraint`:

- Values and linkage: `value`, `resolve`, `pack`, `link`, `binding`.
- Claims and approved declarations: `stated`, `assumed` (model propositions), `fact`, `rule`, `event`, `pattern`, `hypothesis`, `action`, `goal`, `trace`, `policy`, `theory`, `procedure`, `template`.
- Goals and execution: `query`, `constraint`, `remember`, `recall`, `solve`, `reason`, `cnl`, `jsEval`, `expand`, `clarify`, `abduce`, `diagnose`, `associate`, `induce`, `analogize`, `plan`, `simulate`, `temporal`.

`entity`, `predicate` and `concept` belong to the **host ontology control plane**, not the model-origin wire count. `binding` is runtime-generated. In trusted full circuits, `template` and `procedure` use the same approved parameterized-circuit mechanism; `policy` defines host execution limits. `theory` holds a foreign-dialect body, but the current registry has no compiler for required theories and rejects them instead of silently executing them. These are not extra small-model lessons. A declaration being parseable does not grant it execution authority.

The model's declarative problem ends in a model declaration. A statement is linked by the host and used as turn-local evidence (asserted) or conditionally (hedged, supposed, reported); a model assumption is reported, or branched under host policy; none is stored. A host-generated `clarify` is an inspectable operation used when identity is missing/ambiguous or a required downstream scalar is unavailable/nonunique; the host suspends dependent work until clarified. The trusted full circuit may end in `cnl`, `clarify`, or `remember`; only trusted code can author its operation wires. A `cnl` input must be the actual object produced by a runtime operation, not a literal imitation of `{status, answers, proof}` or a computed copy.

### Declarative model targets and separate trusted circuit contracts

The training target emits only `stated`, `assumed`, `unclear`, `query` and `constraint`. The query-v1 and query-v2 curricula below are legacy-format data (atom queries, canonical identifiers and a retired conditional-context wire) that await regeneration by the diversity generator ([DS022](specsLoader.html?spec=DS022-diversity-generator.md)); they are runtime evidence, not model-language targets. Runtime field definitions for full circuits remain in `sop/contracts/wires.json`, generated by `node tools/capabilities.mjs --write`. The table contrasts model declarations with the trusted host/system operations used to evaluate them; trusted rows are not a model-target inventory.

The host compiles declarative proposals into inspectable trusted circuits. It may perform identity lookup, build assumption values, group data, solve, render CNL and generate a specific `clarify` question for unresolved/ambiguous identity or a missing/nonunique required scalar, but cannot guess identity, convert model statements or assumptions to stored facts, or infer a write permission. Query `select ?x` variables consumed by subsequent constraints as `$x` require a justified generated `one` output; an ordinary final query returns correlated rows. A model constraint may request scalar outputs through `select ?var ...`. Unknown evidence alone is not missing user information. Legacy executable circuits with `fact`, `remember`, `solve`, `clarify`, and `cnl` belong to a separately named system-evaluation track, never the formalizer training target.

| Wire | Required fields | Model or trusted-system boundary |
| --- | --- | --- |
| `stated` / `assumed` | quoted `relation`, closed-inventory `role` lines, `polarity`, optional quoted `valid`; `certainty`/`speaker` or `basis` | Model propositions as strings; the host links them. Asserted statements are turn-local evidence; suppositions, reported speech and branched assumptions are conditional; nothing is recorded. |
| `query` | varies by `mode`: `where` always | `mode exists` with one or two ground/signed atoms; `mode select` with `select ?x`; `mode count`; optional `at`, `during`, `asof` literals. Filters are expressions, never new syntax. |
| `solve` | `query $w` or `constraint $c` | Binds one problem wire; `output ?x one` only when the evidence forces a unique value; `rows` preserves correlated tuples. A `backend` field names an explicit engine and never changes semantics. |
| `cnl` | `result`, `language` | `result` must reference a runtime-produced result wire. `language` defaults to `en`, the canonical CNL for both EN and RO surfaces; `ro` renders Romanian only when the user requests it (API `language` field or an explicit request in the message). |
| `constraint` | `var`, `require`, `claim`, `task`; optional `select ?var ...` | Model may request supported scalar projections; host performs solving. Finite integer domains only; `task possible|prove`; `optimize` needs `objective` and `direction` in trusted circuits. |
| `value` | `data` | Literal seeded constants (`"route_demo"`, `770`, `840`). |
| `jsEval` | `expr` | Restricted expression interpreter over existing `$wire` values; no host functions, no code from text. |
| `resolve` | `text`, `language`, `kind` | Entity lookup with optional `type`/`domain`; a unique canonical ID fills atom arguments only. |
| `expand` | `using ~approved`, `with` | Host-approved procedure handles only; parameters bind by name; the packet is forwarded, not re-created. |
| `fact` | `holds`, `valid`, `source`, `quote` | Trusted sourced value, not model-authored. A stored user claim requires an independent authorized source/quote and explicit recording. |
| `remember` | `input` | `scope session`; explicitly records authorized facts/events in the session, checked against `expected.session_claims`, including quotes and retention. It neither proves truth nor commits the session or publishes globally. |
| `clarify` | `text` | Host-generated when identity is unresolved/ambiguous or a required scalar is missing/nonunique; lack of evidence alone is not a clarification request. |

A model-authored declaration using any trusted-operation type (`fact`, `remember`, `recall`, `link`, `reason`, `solve`, `cnl`, `clarify`, `resolve`, `pack`, `value`, `jsEval`, `expand`, and the other full-circuit operations) is rejected at the model-origin boundary; implementation coverage for such operations belongs to the trusted system track.

### Authoring and compilation pipeline

The baseline generated source is `tools/datasets/curriculum/cases.mjs`; `node tools/datasets/build-curriculum.mjs` compiles it into the JSONL splits `datasets/query-v1/{train,dev}.jsonl` with their manifest and the disjoint sealed export `eval/suites/query-v1/test.jsonl`. Each row carries the exact EN/RO surface, attached assertions with quotations, an independent expected oracle, the canonical SOP target, and host world background marked as oracle basis rather than model input. The JSONL splits are the dataset; there is no Markdown audit tree or per-case Markdown compiler (retired on 2026-09-28, see [DS020](specsLoader.html?spec=DS020-corpus-audit-tool.md)).

Schema minimality, split policy and provenance are recorded in [DS008-data-evaluation.md](specsLoader.html?spec=DS008-data-evaluation.md). A human reviews cases through the visual corpus audit (DS020), which re-executes a case's gold on demand and records verdicts; `node tools/datasets/audit-corpus.mjs --corpus query-v1` checks the fail-closed corpus invariants plus faithfulness, triviality, diversity and template-leakage checks and writes `eval/reports/current/corpus-audit/query-v1.json`. Changing a case means changing the generator source and rebuilding the splits, which the manifest integrity check then reflects; an audit verdict is not a semantic review of the whole corpus or a training qualification.

The machine-learning input is the one defined in [DS008-data-evaluation.md](specsLoader.html?spec=DS008-data-evaluation.md): the prompt is exactly the user's message, without instructions or context, and any fine-tuned model must be served with the same input. The legacy-format rows of these curricula still carry a context block; it is verification scaffolding for their legacy targets and is not model input for the current language.

### Declarative question-to-host-circuit matrix

| Question family | Model declarations → host operations | Required oracle and discriminant |
| --- | --- | --- |
| Relation roles, inverse questions and joins | `query` → host `solve`/`cnl` | Explicit answer tuples; reversed roles, changed projections and disconnected bindings |
| Positive, negative, absent or conflicting evidence | Signed `query` → host solving | Separate supported/refuted/both/unknown; absence never substitutes for negation |
| Supplied context plus a question | `stated` + `query` → host evidence- or assumption-backed solve | Asserted statements give a non-hypothetical result; suppositions a conditional one; original input preserved separately, **no session claim**; dropping a statement may change the result |
| Time and knowledge cutoff | Model query `at`, `during`, `asof`; host claim history | Inclusive start, exclusive end and transaction-time cutoff; interval overlap is not universal validity throughout the interval |
| Finite numeric constraints | `constraint` → host solve/render | Independently enumerated finite solutions, comparison direction, feasibility versus entailment and cardinality |
| Logical result feeding arithmetic | `query select ?x` → host-justified unique `$x` → model `constraint` with optional `select ?var` | Independently calculated typed values; missing or nonunique bindings cannot be guessed |
| Approved reusable procedure | Trusted system-evaluation track only: host `expand` | Checked host definition and independent expected result; unapproved handles remain rejected and are not model targets |
| Aliases and ambiguous mentions | Model `query` → host lexical resolution or generated `clarify` | Unique/scoped, absent and ambiguous lookup; unknown evidence alone does not force clarification |
| Defeasible context against an explicit record | Model `stated` supposition → host assumption-backed solve | A kept assumption supports a claim only with `hypothetical: true`; an admitted contrary record defeats it without recording it |
| Explanations, plans, causal interventions and defaults | Trusted bounded reviewed backend in system track; model may only state supported problem/intent | Assumptions, alternatives, epistemic status and reviewed action/theory model; do not promote candidates to facts or turn unsupported work automatically into clarification |

`datasets/query-v1/manifest.json` contains the actual family matrix and `measured_structure`: target-wire cases/rows, host-setup wires, expected statuses, oracle classes, structural fingerprints and audited holdouts. A new world or a renamed constant is **not** a new composition. A fingerprint checks wire/field/argument structure; it is not a theorem of semantic novelty. Lexical and Romanian reservations explicitly state whether they concern an identifier, a relation or an entire question surface.

### Current data and evidence boundaries

- The historical `pilot-v1` manifest records 700 generated diagnostic family-fixture rows; the checked files hold 510 train/dev rows (`datasets/pilot-v1/{train,dev}.jsonl`) and 90 sealed test rows (`eval/suites/pilot-v1/test.jsonl`). Its narrow `query`/`solve`/`clarify` targets do not qualify it for broad formalizer training.
- The previously audited synthetic **full-circuit** curriculum had **62 semantic cases and 198 rows**: 186 English surfaces, twelve Romanian case anchors, and 105/44/49 train/dev/test rows. Romanian anchors were distributed 6/2/4. It exercised relations, joins, signed evidence, temporal cutoffs, finite constraints, binding uniqueness, expressions, approved expansion, resolution, defeasible assumptions and session writes. A harness LLM reviewed initial cases; the principal corrected quote loss, a count paraphrase, holdout labels and anchor distribution. Those circuit-target numbers are historical evidence, not coverage or tokenizer measurements of declarative-only model targets, human review, source-backed training coverage or model accuracy.
- `eval/suites/source-reference-v2.jsonl` is a separately authored, sealed **SQuAD v2 dev** reference: sixteen source-derived cases and 49 surfaces, including role/polarity/absence contrasts. It is excluded from training and checkpoint selection. Its provenance records source bytes, CC-BY-SA-4.0 attribution, derivative annotation and rejected scaffold mappings. Version 2 corrects the intentional-self-naming paraphrase and distinguishes agreement to swear fealty from a completed oath; superseded v1 and its LLM review are retained only under `eval/reports/history/data-review/`. Independence is from the synthetic generator, not a guarantee that a pretrained model never saw SQuAD.
- The current whitespace-atom, declarative-only derivative is `eval/suites/source-reference-v2-cutover.jsonl`, with independently computed `.provenance.json`. The sealed original above remains unchanged as historical evidence. The derivative is also test-only and excluded from training and checkpoint selection.
- QA2D and ProofWriter are used only as inspiration under the owner's 2026-09-28 inspired-by release ([DS014](specsLoader.html?spec=DS014-source-rights.md)): derived corpora take structure, label types, phenomena and statistics, never text, and pass the no-copy check. A software MIT license or an unverified mirror label is not an upstream dataset grant, so their source text is not redistributed. The ProofWriter probe distinguishes OWA hard negation from CWA negation-as-failure; probing does not authorize redistribution or gold export.
- The corpus is deliberately **not training-qualified**. Positive advanced-reasoning coverage, source-backed training scale, broader independent references and qualified generalization evidence remain gaps. Do not count a clarification as a positive example of an unsupported engine. The bounded `assumption_boundary` family covers defeasible assumptions with an explicit contrary record; open-ended default reasoning with unordered competing defaults remains outside the corpus and stays declared as an unsupported family.

Reproduce the symbolic data checks without model training:

```sh
node tools/datasets/validate.mjs --manifest datasets/query-v1/manifest.json --execute
node tools/datasets/validate.mjs --file eval/suites/source-reference-v2-cutover.jsonl --execute
node tools/verify.mjs
```

### Frozen query-v1 family/operator inventory

This is the inventory in `tools/datasets/curriculum/cases.mjs` as it was frozen for query-v1. Family names and operator labels identify coverage, not authority to add new SOP wires. Model-origin targets contain only `stated`, `assumed`, `unclear`, `query`, `constraint` ([DS021](specsLoader.html?spec=DS021-model-surface.md); the legacy-format corpora are pending regeneration by [DS022](specsLoader.html?spec=DS022-diversity-generator.md)); `remember`, `clarify`, approved expansion and other execution operations stay on the system track.

| Family | Operators |
| --- | --- |
| approved_procedure | expand, finite_constraint, host_approved_library |
| assumption_boundary | assume, defeasible_rule, explicit_negation, ground |
| attached_assertions | argument_reversal, at, conditional, conflict, exclusive_end, explicit_negation, ground, no_query, remember, session (and the legacy conditional-context operator) |
| causal_boundary | no_causal_inference, open_world |
| clarification | ambiguous_reference, ambiguous_sense, lexical_holdout |
| conjunction_join | and, ground, heterogeneous_predicates, select, select_multiple, shared_variable |
| expression_composition | arithmetic, finite_constraint, query, unique_output |
| finite_constraints | comparison, direction, finite_domain, possible, prove, strict_comparison |
| finite_outputs | comparison, count, finite_domain, nonunique_output, select, unique_output |
| multi_hop | approved_rule, argument_reversal, role_inversion, select, two_hop |
| negation_openworld | conflict, explicit_negation, ground, negative_query, open_world, predicate_distinction |
| relation_role | argument_reversal, binary, employed_by, ground, no_unapproved_rule, open_world, predicate_distinction, role_inversion, select |
| scoped_synonyms | entity, resolve, romanian, type_organization |
| temporal | asof, at, before_exclusive_end, before_start, bounded_interval, during, exclusive_end, explicit_negation, inclusive_start, knowledge_cutoff, open_world |
| unsupported_boundary | abduction, causal_boundary, counterfactual, default_exception, missing_action_model, missing_causal_model, planning |

Reserved `composition` cases and ordered structures (from the current rows): `join_pairs` (dev) and `test_join_pairs` (test): `and__shared_variable__select_multiple`; `test_join_work_project` (test): `and__heterogeneous_predicates__select`; `incident_conflict` (test): `explicit_negation__conflict`; `route_expression` (dev): `query__unique_output__arithmetic__finite_constraint`; `route_approved_procedure` (dev, system): `expand__host_approved_library__finite_constraint`; `assert_conflict` (test) and `assert_temporal` (dev): legacy conditional-context structures (`conditional__conflict`, `conditional__at__exclusive_end`); `finite_many` (test, system): `finite_domain__nonunique_output__comparison`. These are declarations of reserved examples, not proof that each component is unique to a split.

### Question curriculum generator

`tools/datasets/question-curriculum.mjs` projects the **synthetic, unreviewed** source scenarios from `tools/datasets/curriculum/cases.mjs` through the existing independent oracles in `build-curriculum.mjs`. It does not invent a world, a family, a target, or a new oracle. It does not generate training-approved examples or run a model. `skills/question-curriculum/SKILL.md` describes the workflow.

```sh
node tools/datasets/question-curriculum.mjs --family temporal --world temporal_train --seed 7 --limit 3
node tools/datasets/question-curriculum.mjs --seed 7 --limit 1000 | jq '{verification, inventory_families:(.inventory|length), gaps:[.rows[] | select(.status=="unsupported") | {case_id,reason}] | unique}'
node --test tests/question-curriculum.test.mjs
```

The CLI prints JSON with `inventory`, `verification`, and bounded `rows`. The default limit is 30; accepted limits are 1–1000, and `seed` is a safe integer. A fixed seed and source snapshot produce the same ordered rows. The sort is a SHA-256 ranking of `(seed, surface id)`; selection never moves a surface to a different split. `--family` and `--world` must name an actual listed family/world combination; omit either to include all matching source cases. The no-world blocked families emit one explicit gap record with a null question and null world, not a fabricated question.

Each executable row has `question`, `language`, `family`, `world`, `operators`, `split`, `split_group_id`, `target`, `host_setup`, optional `host_ontology`, `host_context`, `oracle`, and `expected`. The target is legacy-format (atom `query`, `constraint` and the retired conditional-context wire); the generator's output is a legacy-format corpus pending regeneration by the diversity generator ([DS022](specsLoader.html?spec=DS022-diversity-generator.md)). `host_setup` contains independently supplied facts/rules/templates; it is not model output. `oracle.kind` identifies the independent graph/temporal, arithmetic-enumeration, assumption, or route source oracle, and `oracle.status` is its expectation, not a value calculated from runtime execution. Unsupported rows have `status: "unsupported"`, a nonempty `reason`, `expected.status: "unsupported"`, and `target: null`. They are not answerable golds. All rows carry `synthetic_unreviewed_not_training_approved` review status.

The verifier publishes host setup into a fresh isolated repository at the source's known-at date, initializes a fresh session and `new Runtime(...)` with the row's host ontology/schema, context, fixed time, `origin: 'model'`, and `allowWrite: false`, then **executes every executable surface**. A forbidden model wire, execution error, or disagreement between runtime status and independently calculated oracle fails the command; it does not overwrite the oracle or relabel a mismatch as success. There is no implicit inference of a causal explanation from a coincident observation. A successful generation is runtime agreement, **not** human review, dataset qualification, or semantic completeness beyond the source scenarios.

#### Source-family/operator inventory

This list reflects the source `cases`, `assumptions`, `attached`, `numeric`, `extra`, and `blockedFamilies` arrays. The executable `questionInventory()` derives the inventory from these arrays; the table records the current source snapshot. Operators are source labels, not blanket claims of interpreter capability. A family can mix supported and unsupported constructs.

| Family | Source operators | Coverage/gap |
| --- | --- | --- |
| `abduction` | none in a question case | Blocked: explanations are hypotheses requiring separately judged abductive targets. |
| `agentive_intention` | none in a question case | Blocked: cannot infer knowing/intending/wanting from actions. |
| `approved_procedure` | `expand`, `finite_constraint`, `host_approved_library` | Host-only template expansion/presentation; not a declarative model target. |
| `assumption_boundary` | `assume`, `defeasible_rule`, `explicit_negation`, `ground` | Conditional assumption and query; source assumption oracle. |
| `attached_assertions` | `argument_reversal`, `at`, `conditional`, `conflict`, `exclusive_end`, `explicit_negation`, `ground`, `no_query`, `remember`, `session` (plus the retired conditional-context operator) | Conditional context/query supported; `assert_only` is an explicit trusted `remember` gap, never model-authored recording. |
| `causal` | none in a question case | Blocked: temporal order/coincidence does not establish causal rules. |
| `causal_boundary` | `no_causal_inference`, `open_world` | Check the documented fact only; do not invent a causal link. |
| `clarification` | `ambiguous_reference`, `ambiguous_sense`, `lexical_holdout` | Unresolved reference/sense: explicit gap, host clarification cannot be authored as a model target. |
| `conjunction_join` | `and`, `ground`, `heterogeneous_predicates`, `select`, `select_multiple`, `shared_variable` | Source graph oracle; declarative query. |
| `counterfactual` | none in a question case | Blocked: intervention requires a separately judged simulation world. |
| `default_exception` | none in a question case | Blocked: no reviewed defeasible microtheory. |
| `expression_composition` | `arithmetic`, `finite_constraint`, `query`, `unique_output` | Declarative route query and finite constraint. |
| `finite_constraints` | `comparison`, `direction`, `finite_domain`, `possible`, `prove`, `strict_comparison` | Independent exhaustive finite enumeration. |
| `finite_outputs` | `comparison`, `count`, `finite_domain`, `nonunique_output`, `select`, `unique_output` | Query count/unique output supported; nonunique `finite_many` source presentation requires `solve`/`cnl`, so emits a gap. |
| `general_quantification` | none in a question case | Blocked: finite open-world facts do not imply closed-world universals. |
| `multi_hop` | `approved_rule`, `argument_reversal`, `role_inversion`, `select`, `two_hop` | Host rule plus declarative query. |
| `negation_openworld` | `conflict`, `explicit_negation`, `ground`, `negative_query`, `open_world`, `predicate_distinction` | Independent signed-fact oracle; unknown is not false. |
| `planning` | none in a question case | Blocked: no approved action model or goal criterion. |
| `relation_role` | `argument_reversal`, `binary`, `employed_by`, `ground`, `no_unapproved_rule`, `open_world`, `predicate_distinction`, `role_inversion`, `select` | Independent graph oracle. |
| `scoped_synonyms` | `entity`, `resolve`, `romanian`, `type_organization` | Named entity resolved by host lexicon; target remains declarative. |
| `temporal` | `asof`, `at`, `before_exclusive_end`, `before_start`, `bounded_interval`, `during`, `exclusive_end`, `explicit_negation`, `inclusive_start`, `knowledge_cutoff`, `open_world` | Dated source facts and independent temporal oracle. |
| `unsupported_boundary` | `abduction`, `causal_boundary`, `counterfactual`, `default_exception`, `missing_action_model`, `missing_causal_model`, `planning` | Explicit source questions with blocked-family reasons; never manufacture an answer. |

#### Observed local run

With the source snapshot recorded when the generator was specified, `node tools/datasets/question-curriculum.mjs --seed 7 --limit 1000` reported **22 inventoried families, 205 surfaces, 170 executed gold surfaces, 35 unsupported surfaces**. The unsupported IDs (deduplicated by case) were `ambiguous_bank`, `ambiguous_pronoun`, `assert_only`, `finite_many`, `route_approved_procedure`, `unsupported_cause`, `unsupported_counterfactual`, `unsupported_default`, `unsupported_plan`, plus seven no-world blocked-family gap rows. Counts are observations of this snapshot, not guaranteed quotas or review results.

### Query corpus v2

`tools/datasets/curriculum/cases-v2.mjs` extends the immutable v1 inventory with authored semantic contrasts. The v1 cases file, corpus and sealed evaluation are not rewritten. Build with `node tools/datasets/build-curriculum.mjs --out datasets/query-v2 --eval-out eval/suites/query-v2` (equivalently pass `--cases tools/datasets/curriculum/cases-v2.mjs`). This invocation selects the v2 source only when `--out` names `query-v2`; the ordinary builder default remains v1. Like every corpus, v2 is JSONL-first and is reviewed through the visual corpus audit and `tools/datasets/audit-corpus.mjs` ([DS020](specsLoader.html?spec=DS020-corpus-audit-tool.md)); there is no Markdown audit tree. The manifest identifies the v2 source hash and its sealed, disjoint test export.

These are synthetic, unreviewed examples, **not** qualified training data or independently sourced human annotation. The handwritten graph/temporal and finite-enumeration oracles do not compute their decisions from SOP target execution. Runtime comparison is a separate check, not semantic review. Three distinct English surfaces are supplied for every case; 23 cases have Romanian anchors (25.8% of 89) spread across train/dev/test. Semantic case, not paraphrase, is the split unit; the connected `split_group_id` and `negative_of` pairs stay in one split. Recurring family and target structure across splits are intentional; do not treat those as independent structural holdouts.

#### Measured inventory

After building and executing all gold targets against the runtime: **89 semantic cases, 290 rows**. Split cases: train 51, dev 19, test 19; split rows: train 167, dev 61, test 62. Language rows: English 267, Romanian 23. Evaluation-track cases: formalization 78, trusted system 11; rows: formalization 255, system 35. Input-mode cases: `query_only` 73, `assertions_query` 8, `clarification` 8; rows: 238, 26, 26 respectively. There are 33 paired-negative cases (including inherited v1 pairs); an `expected.status` difference is checked for the focused logical contrasts, while a negative assertion in conflicting evidence may share `both` with its positive partner and still ask a different proposition. Clarification contrasts can both have status `clarify` yet ask for different missing referents or evidence.

| Family | Cases | Rows | Actual operators / boundary |
| --- | ---: | ---: | --- |
| relation_role | 15 | 49 | ground binary roles, reversed roles, entity binding, selected role |
| negation_openworld | 11 | 37 | signed atoms, explicit denial, absence, both, no explosion |
| multi_hop | 4 | 13 | approved two-hop rule, inverse projection |
| conjunction_join | 8 | 26 | joined parent chain, heterogeneous conjuncts, changed participant |
| temporal | 11 | 35 | `at`, `during`, `asof`, inclusive start, exclusive end, signed timed assertion |
| finite_constraints | 12 | 40 | bounded integer `require`/`claim`, `possible` versus `prove`, greater/less direction, antecedent/consequent reversal |
| finite_outputs | 3 | 9 | `count`, uniquely forced `select`, nonunique system output |
| attached_assertions | 8 | 26 | conditional context, polarity, role reversal, conflict; separate trusted `remember` |
| clarification | 3 | 11 | missing referents and ambiguous organization |
| unsupported_boundary | 5 | 15 | unapproved defaults, cause, plan, counterfactual, intention; system clarification only |
| causal_boundary | 3 | 10 | disk/network/outage predicate distinction, **not** causal inference |
| scoped_synonyms | 2 | 7 | host-approved canonical entity mentions and Romanian anchor |
| assumption_boundary | 2 | 6 | bounded defeasible assumption defeated by explicit denial |
| expression_composition | 1 | 3 | unique route-duration output feeds finite arrival constraint |
| approved_procedure | 1 | 3 | host-approved `check_arrival` expansion; system track only |

Holdout labels count *cases*: none 66; composition 9; world 6; capability_boundary 3; lexical 2; operator 1; reasoning_world 1; romanian 1. These labels are declarations audited by measured structure, not claims that all similar operators are absent from training. The test split is exported exclusively to `eval/suites/query-v2/`; training and dev formalizer projections are legacy-format (atom queries, canonical identifiers, a context block): a legacy-format corpus pending regeneration by the diversity generator ([DS022](specsLoader.html?spec=DS022-diversity-generator.md)). `fact`, `remember`, `solve`, `expand`, `cnl`, and `clarify` belong solely to trusted system targets or host setup.

#### Hard negatives and honest gaps

The added differences concern genuinely different propositions: `some_above_three` versus `all_above_three` changes existential feasibility to universal entailment; `reverse_condition_above_three` reverses `x >= 1 ⇒ x > 3` to `x > 3 ⇒ x >= 1`; `parent_reversed` versus `parent_bogdan_carina` changes the bound child; signed parent and timed-work pairs distinguish negative evidence from its positive proposition and from a neighboring date. Multi-person joins change which person owns which predicate, without asserting that two separately true links constitute a shared-variable path. Ambiguity and unsupported intent are system-track clarification boundaries, **not** positive examples of an intent-reasoning engine. A cross-boundary time window intersects positive and negative periods and produces a runtime `mixed_temporal` status outside the row schema; no such case was exported as incorrectly labeled `both`.

The blocked family inventory remains: **abduction** (hypotheses need separately judged targets); **default_exception** (no reviewed defeasible microtheory); **counterfactual** (no separately judged intervention worlds); **planning** (no approved action model/goal); **causal** (temporal coincidence is not cause); **agentive_intention** (actions do not establish knowledge or wants); **general_quantification** (open-world facts cannot prove unrestricted universals). Finite-domain `prove`/`possible` contrasts do *not* remove the general-quantification block. Also not honestly expanded: expression composition and approved procedure have only one pinned route/template case each; scoped synonyms have two cases and still need additional scoped ontology evidence; assumption boundary has two bounded cases, not an arbitrary default logic. Source-backed cases, human-reviewed cases and training-approved cases are all zero.

Checks: `node tools/datasets/validate.mjs --manifest datasets/query-v1/manifest.json --execute`; `node tools/datasets/validate.mjs --manifest datasets/query-v2/manifest.json --execute`; `node --test tests/query-v2.test.mjs`. A successful execution reports `qualification: not_reviewed`.

#### Legacy identifiers kept for provenance

Two case IDs and the generator branch keyed on them still carry the pre-rename name `assert_only` / `assert_conflict` (`tools/datasets/curriculum/cases.mjs`, `tools/datasets/build-curriculum.mjs`, `tools/datasets/question-curriculum.mjs`). They refer to the session-recording family whose trusted target now uses the `remember` wire; the wire itself has no `assert` alias anywhere. The IDs are frozen because they are recorded in the query-v1 manifest, exports and provenance hashes; renaming them would invalidate that recorded provenance for a purely cosmetic gain. New v2 cases use current naming.

### Adjudication and authorization

`skills/semantic-sop-review/SKILL.md` requires an immutable bundle, actual independent LLM review with truthful runtime provenance, and a different principal-integrator identity for final acceptance. A same-status wrong answer is a counterexample. Failed permission/type/reference checks cannot be overruled by a favorable review. Finite agreement without structural identity remains pending until adjudicated.

Generator models such as Luna, or a qualified smaller model, may supply controlled candidate paraphrases and scenario drafts only after a representative pilot qualifies them per accepted example; they cannot approve semantic correctness, authorize publication, or arbitrate final analysis. Every generated row records the actual provider, model, revision, and reviewer; an unexposed backend identity is recorded as unknown rather than relabeled. The principal integrator owns difficult semantic and architecture decisions; a harness review is evidence with recorded limitations, never a sign-off.

Training requires two independent gates: a hashed dataset qualification covering syntax/execution, semantic review, leakage, coverage, rights and an independent reference suite; and a **new explicit user authorization** bound to the exact dataset, recipe, model and run. No optimizer step, fine-tuning or training smoke is authorized during this preparation. An image build, CUDA infrastructure preflight, symbolic evaluation or principal review never substitutes for that user instruction.
