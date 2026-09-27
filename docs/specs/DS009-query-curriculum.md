---
title: DS009-query-curriculum
summary: Question-to-wire coverage, source reconciliation, semantic adjudication, and the no-training gate.
---

## Introduction

The query curriculum must teach a small formalizer to state a declarative SOP problem and genuine user claims, not to imitate an answer string or choose session, retrieval and rendering operations. A separate host-expanded circuit executes that declaration. Earlier executable corpus targets remain evidence about the low-level runtime, not proof that a declarative-target curriculum is already qualified. `vision/SOP_dataset.docx` makes the semantic case—not each paraphrase—the unit of knowledge. `vision/SOP_CommonSense_v2.docx` separates missing source knowledge, missing semantic structures and missing reasoning capability. Neither document authorizes a training run or makes an unsupported operator executable.

The machine-readable contract is `datasets/query-profile.json`. The authoritative wire fields are generated from the parser into `sop/contracts/wires.json` by `node tools/capabilities.mjs --write`. These are a profile and a coverage requirement, not a claim that every wire is represented by qualified training examples.

Material-source extraction, source-specific rights/budgets, exact passage provenance and quarantine are specified in [DS014-material-sources.md](specsLoader.html?spec=DS014-material-sources.md); source drafts do not become model targets or accepted runtime knowledge.

## Core Content

### Reconciliation decisions

| Source requirement or apparent conflict | Decision in the current profile |
| --- | --- |
| Semantic cases with several EN surfaces and selected RO anchors | One canonical target per case; group translations, paraphrases and hard negatives before splitting. Count Romanian coverage by cases as well as rows. |
| Questions may include contextual claims or ambiguity | Distinguish `query_only`, `assertions_query` and historically named `clarification` input modes. The model represents contextual claims as conditional `premise` declarations, never sourced `fact` or `remember`. The host retains original input text and model-interpretation origin without publishing any premise. It generates `clarify` only from a valid declarative problem whose identity or required scalar is missing/nonunique; old standalone model-authored `clarify` targets belong in the system track unless genuinely reauthored. Source setup remains a separate host operation. |
| QA2D and ProofWriter are preferred starting sources | A preference is not a license or a validated SOP mapping. Quarantine unresolved sources; preserve source scaffolds without inventing gold. |
| Many reasoning families appear in the vision | An executable bounded operation, an approved theory and a missing capability are different states. Do not turn defaults, causal guesses, intentions or counterfactuals into hard Horn facts. |
| Historical documents mention other containers, graph paths or operators | The current parser is authoritative. Foreign dialects require an explicit compiler and reviewed semantics; they are not silently accepted aliases. |
| Equivalent programs can differ syntactically | Safe local alpha-renaming and parser normalization are automatic. Different structures with only finite agreement require LLM review and a separate principal decision. |
| The small model should not maintain a synonym dictionary | The host-approved lexicon resolves language, symbolic kind, entity type and optional domain. The `resolve` wire exposes the same exact lookup boundary. |

### Wire inventory and trust boundary

The trusted full-circuit inventory contains the following wire types; model-origin SOP admits only `premise`, `query`, and `constraint`:

- Values and linkage: `value`, `resolve`, `pack`, `link`, `binding`.
- Claims and approved declarations: `premise` (declarative model context), `fact`, `rule`, `event`, `pattern`, `hypothesis`, `action`, `goal`, `trace`, `policy`, `theory`, `procedure`, `template`.
- Goals and execution: `query`, `constraint`, `remember`, `recall`, `solve`, `reason`, `cnl`, `jsEval`, `expand`, `clarify`, `abduce`, `diagnose`, `associate`, `induce`, `analogize`, `plan`, `simulate`, `temporal`.

`entity`, `predicate` and `concept` belong to the **host ontology control plane**, not the model-origin wire count. `binding` is runtime-generated. In trusted full circuits, `template` and `procedure` use the same approved parameterized-circuit mechanism; `policy` defines host execution limits. `theory` holds a foreign-dialect body, but the current registry has no compiler for required theories and rejects them instead of silently executing them. These are not extra small-model lessons. A declaration being parseable does not grant it execution authority.

The model's declarative problem ends in `query`, `constraint`, or premises alone. Its `premise` is conditional: required `holds`, optional `valid` defaulting to `timeless`, no source/quote/write fields and no implicit session persistence. A host-generated `clarify` is an inspectable operation used when identity is missing/ambiguous or a required downstream scalar is unavailable/nonunique; the host suspends dependent work until clarified. The trusted full circuit may end in `cnl`, `clarify`, or `remember`; only trusted code can author its operation wires. A `cnl` input must be the actual object produced by a runtime operation, not a literal imitation of `{status, answers, proof}` or a computed copy.

### Declarative model targets and separate trusted circuit contracts

The training target emits only the three model-origin types `premise`, `query`, and `constraint`. Runtime field definitions for full circuits remain in `sop/contracts/wires.json`, generated by `node tools/capabilities.mjs --write`. The table contrasts model declarations with the trusted host/system operations used to evaluate them; trusted rows are not a model-target inventory.

The host compiles declarative proposals into inspectable trusted circuits. It may perform identity lookup, build assumption values, group data, solve, render CNL and generate a specific `clarify` question for unresolved/ambiguous identity or a missing/nonunique required scalar, but cannot guess identity, convert model premises to stored facts, or infer a write permission. Query `select ?x` variables consumed by subsequent constraints as `$x` require a justified generated `one` output; an ordinary final query returns correlated rows. A model constraint may request scalar outputs through `select ?var ...`. Unknown evidence alone is not missing user information. Legacy executable circuits with `fact`, `remember`, `solve`, `clarify`, and `cnl` belong to a separately named system-evaluation track, never the formalizer training target.

| Wire | Required fields | Model or trusted-system boundary |
| --- | --- | --- |
| `premise` | `holds`; optional `valid` defaults to `timeless` | Model-origin conditional context, neither sourced `fact` nor session recording; host gives it assumption semantics. |
| `query` | varies by `mode`: `where` always | `mode exists` with one or two ground/signed atoms; `mode select` with `select ?x`; `mode count`; optional `at`, `during`, `asof` literals. Filters are expressions, never new syntax. |
| `solve` | `query $w` or `constraint $c` | Binds one problem wire; `output ?x one` only when premises force a unique value; `rows` preserves correlated tuples. A `backend` field names an explicit engine and never changes semantics. |
| `cnl` | `result`, `language` | `result` must reference a runtime-produced result wire. `language` is the canonical English internal CNL for both EN and RO surfaces. |
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

The baseline generated source is `tools/datasets/curriculum/cases.mjs`; `node tools/datasets/build-curriculum.mjs` compiles it into `datasets/query-v1/`, the disjoint sealed export `eval/suites/query-v1/`, and the per-case audit tree `datasets/cases/<family>/<case>.md`. The audit tree contains exact EN/RO surfaces, attached assertions with quotations, an independent expected oracle, the canonical SOP target, and host world background marked as oracle basis rather than model input. `datasets/cases/README.md` is excluded from the integrity hash.

For editable Markdown case authoring, independent oracle revalidation, per-example hashes and split policy, see [DS013-case-authoring.md](specsLoader.html?spec=DS013-case-authoring.md). A Markdown edit compiles into a separate case-specific JSONL via `tools/datasets/authoring/compile-case.mjs`; it does not silently replace the baseline or sealed exports. The existing baseline manifest integrity check still reports an edited tree as stale until baseline regeneration; do not mistake a successful case compilation for a refreshed export manifest or a semantic review.

The machine-learning input profile is the one defined in [DS008-data-evaluation.md](specsLoader.html?spec=DS008-data-evaluation.md): `row.prompt` is `CONTEXT` + `MESSAGE` only, without instructions, and any fine-tuned model must be served with the same profile.

### Declarative question-to-host-circuit matrix

| Question family | Model declarations → host operations | Required oracle and discriminant |
| --- | --- | --- |
| Relation roles, inverse questions and joins | `query` → host `solve`/`cnl` | Explicit answer tuples; reversed roles, changed projections and disconnected bindings |
| Positive, negative, absent or conflicting evidence | Signed `query` → host solving | Separate supported/refuted/both/unknown; absence never substitutes for negation |
| Supplied context plus a question | `premise` + `query` → host assumption-backed solve | Conditional/hypothetical result, original input preserved separately, **no session claim**; dropping a premise may change the result |
| Time and knowledge cutoff | Model query `at`, `during`, `asof`; host claim history | Inclusive start, exclusive end and transaction-time cutoff; interval overlap is not universal validity throughout the interval |
| Finite numeric constraints | `constraint` → host solve/render | Independently enumerated finite solutions, comparison direction, feasibility versus entailment and cardinality |
| Logical result feeding arithmetic | `query select ?x` → host-justified unique `$x` → model `constraint` with optional `select ?var` | Independently calculated typed values; missing or nonunique bindings cannot be guessed |
| Approved reusable procedure | Trusted system-evaluation track only: host `expand` | Checked host definition and independent expected result; unapproved handles remain rejected and are not model targets |
| Aliases and ambiguous mentions | Model `query` → host lexical resolution or generated `clarify` | Unique/scoped, absent and ambiguous lookup; unknown evidence alone does not force clarification |
| Defeasible context against an explicit record | Model `premise` → host assumption-backed solve | A kept assumption supports a claim only with `hypothetical: true`; an admitted contrary record defeats it without recording the premise |
| Explanations, plans, causal interventions and defaults | Trusted bounded reviewed backend in system track; model may only state supported problem/intent | Assumptions, alternatives, epistemic status and reviewed action/theory model; do not promote candidates to facts or turn unsupported work automatically into clarification |

`datasets/query-v1/manifest.json` contains the actual family matrix and `measured_structure`: target-wire cases/rows, host-setup wires, expected statuses, oracle classes, structural fingerprints and audited holdouts. A new world or a renamed constant is **not** a new composition. A fingerprint checks wire/field/argument structure; it is not a theorem of semantic novelty. Lexical and Romanian reservations explicitly state whether they concern an identifier, a relation or an entire question surface.

### Current data and evidence boundaries

- The historical `pilot-v1` contains 700 diagnostic family-fixture rows. Its narrow `query`/`solve`/`clarify` targets do not qualify it for broad formalizer training.
- The previously audited synthetic **full-circuit** curriculum had **62 semantic cases and 198 rows**: 186 English surfaces, twelve Romanian case anchors, and 105/44/49 train/dev/test rows. Romanian anchors were distributed 6/2/4. It exercised relations, joins, signed evidence, temporal cutoffs, finite constraints, binding uniqueness, expressions, approved expansion, resolution, defeasible assumptions and session writes. A harness LLM reviewed initial cases; the principal corrected quote loss, a count paraphrase, holdout labels and anchor distribution. Those circuit-target numbers are historical evidence, not coverage or tokenizer measurements of declarative-only model targets, human review, source-backed training coverage or model accuracy.
- `eval/suites/source-reference-v2.jsonl` is a separately authored, sealed **SQuAD v2 dev** reference: sixteen source-derived cases and 49 surfaces, including role/polarity/absence contrasts. It is excluded from training and checkpoint selection. Its provenance records source bytes, CC-BY-SA-4.0 attribution, derivative annotation and rejected scaffold mappings. Version 2 corrects the intentional-self-naming paraphrase and distinguishes agreement to swear fealty from a completed oath; superseded v1 and its LLM review are retained only under `eval/reports/history/data-review/`. Independence is from the synthetic generator, not a guarantee that a pretrained model never saw SQuAD.
- The current whitespace-atom, declarative-only derivative is `eval/suites/source-reference-v2-cutover.jsonl`, with independently computed `.provenance.json`. The sealed original above remains unchanged as historical evidence. The derivative is also test-only and excluded from training and checkpoint selection.
- QA2D and ProofWriter remain quarantined for unresolved dataset-rights evidence. A software MIT license or an unverified mirror label is not an upstream dataset grant. The ProofWriter probe distinguishes OWA hard negation from CWA negation-as-failure; probing does not authorize redistribution or gold export.
- The corpus is deliberately **not training-qualified**. Positive advanced-reasoning coverage, source-backed training scale, broader independent references and qualified generalization evidence remain gaps. Do not count a clarification as a positive example of an unsupported engine. The bounded `assumption_boundary` family covers defeasible assumptions with an explicit contrary record; open-ended default reasoning with unordered competing defaults remains outside the corpus and stays declared as an unsupported family.

Reproduce the symbolic data checks without model training:

```sh
node tools/datasets/validate.mjs --manifest datasets/query-v1/manifest.json --execute
node tools/datasets/validate.mjs --file eval/suites/source-reference-v2-cutover.jsonl --execute
node tools/verify.mjs
```

### Adjudication and authorization

`skills/semantic-sop-review/SKILL.md` requires an immutable bundle, actual independent LLM review with truthful runtime provenance, and a different principal-integrator identity for final acceptance. A same-status wrong answer is a counterexample. Failed permission/type/reference checks cannot be overruled by a favorable review. Finite agreement without structural identity remains pending until adjudicated.

Generator models such as Luna, or a qualified smaller model, may supply controlled candidate paraphrases and scenario drafts only after a representative pilot qualifies them per accepted example; they cannot approve semantic correctness, authorize publication, or arbitrate final analysis. Every generated row records the actual provider, model, revision, and reviewer; an unexposed backend identity is recorded as unknown rather than relabeled. The principal integrator owns difficult semantic and architecture decisions; a harness review is evidence with recorded limitations, never a sign-off.

Training requires two independent gates: a hashed dataset qualification covering syntax/execution, semantic review, leakage, coverage, rights and an independent reference suite; and a **new explicit user authorization** bound to the exact dataset, recipe, model and run. No optimizer step, fine-tuning or training smoke is authorized during this preparation. An image build, CUDA infrastructure preflight, symbolic evaluation or principal review never substitutes for that user instruction.
