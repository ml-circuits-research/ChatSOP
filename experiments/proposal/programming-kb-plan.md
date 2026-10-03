# A programming base memory for ChatSOP: a gradual roadmap

Status: plan, revision 2 (2026-10-01). Nothing here has been implemented or run. The plan uses the wire types, strategies and evaluation discipline of `reasoning-wires-proposal.md` (sections 4, 5.6, 7, 8, 13), the authoring skill `skills/sop-wire-authoring/` and its guide, the strategy contract of DS006 (including `dreaming-session`, `llm-agent`, `htn-strips-planner` and the modes of work), the sessions and base memories of DS022 (the omp coding agent and the drafts path) and the inventory `zip-strategy-inventory.md` (the E10 Dreamer entries Z05 to Z08, Z12, Z18 and VRC's learned registry V07). Every example wire is a draft in the proposal's syntax, to be validated with `node eval/smoke-reasoning/validator.mjs --authoring` in the first milestone.

## Revision 2: what changed and why

The owner read revision 1 and answered (2026-10-01, Romanian): *"ești prea pesimist, avem chestii noi cum e dreamingul, hai să le probăm un pic, plus că nu facem chiar totul simbolic, înțelegerea o facem cu modele LLM care știu să programeze, întrebarea reală e cum facem să avem sistematic în base knowledge tot ce e nevoie, hai să o luăm încet, nu trebuie din prima să batem LLM-urile, dar să înțeleagă indicații și să scrie cod, și când învățăm principiile facem mai sistematic analiza, punem să viseze și să scoată reguli și scurtături, strategiile care contează, refă-ți strategia mai graduală dar optimistă, pari cu frâna trasă fără motiv."*

In English: we are too pessimistic; there are new mechanisms such as dreaming, and they should be tried; understanding is not done symbolically but by LLMs that know how to program; the real question is how to get everything needed into the base knowledge systematically; go slowly; the system does not have to beat the LLMs from the start, but it must understand instructions and write code; once the principles are learned, the analysis becomes more systematic and the system dreams rules, shortcuts and the strategies that matter; the plan should be gradual and optimistic.

What changed:

1. **Division of labour.** Revision 1 made the natural-language front end (SymbolicLM on docstrings) the binding constraint and estimated the "symbolic" coverage from it. That worry is removed: **LLMs that program do the understanding** of instructions and propose code and knowledge; ChatSOP holds the systematic base knowledge, verifies, composes and learns. SymbolicLM keeps its current role (the chat framing) and gains nothing new here.
2. **The central question** is no longer "which benchmark bar" but **how to fill the base knowledge systematically**: a curriculum, an ingestion loop with the coding agent, validation, coverage maps, gap detection from failures and owner review (section 2).
3. **Dreaming is a core mechanism**, not an optional wrapper: offline passes over solved tasks and traces extract methods, lemmas, reusable components and router rules, under the acceptance rule that already exists (re-certify, replay, shadow, revoke; section 3).
4. **Milestones go from easy to harder**, each small with a clear success signal, each building on the previous one (section 6). The first is "follow a written instruction, produce a small function, verify it".
5. **The GPT-3.5-level benchmarks are a later checkpoint**, not a gate. The published numbers stay as a reference line in the report; nothing in the roadmap waits for them.
6. **The pure-symbolic DSL synthesiser** (revision 1's "floor", stage M0) is demoted to an optional side experiment: useful for exact answers inside a DSL, not the way the system is meant to program.

What stayed: the `test` and `code` wires (host and turn wires, never on the model surface), the `code-sandbox` strategy, the sealed test suites with the leakage and no-copy guards, honest statuses (`verified` is `guarantee bounded`, never `exact`), the staged evaluation with early stopping, and cost caps with subscription models first. The measurement stays honest; the tone does not need to be defensive for that.

## 0. Summary

- **What the system does.** A user writes an instruction ("write a function that returns the most frequent element of a list; it must handle an empty list"). A coding agent (omp with the authoring skill, or `llm-agent` with a code presentation) **understands** it and writes two things into a temporary folder: a task circuit (facts about the task in the programming vocabulary, the examples as `test` wires) and, when it can, a candidate `code` wire. ChatSOP **checks** the task circuit against its vocabulary, **plans** the program from its base knowledge (methods, components, API facts, norms), **renders** it when it has the knowledge, **verifies** every candidate in the sandbox against the tests and the norms, and answers with a packet that says what was used and how sure it is. Every solved task is an episode; the **dreaming** pass turns recurring episodes into new methods, shortcuts, components and router rules, which are re-certified and replayed before they are used.
- **What accumulates.** A base memory `programming` (DS022: circuits with provenance, forkable) with principles, patterns, procedures as `method` wires, API facts, coding norms, verified components and their tests, and router rules. It grows by two paths: the curriculum (sources compiled by the coding agent, reviewed by the owner) and use (gaps recorded from failures, artefacts dreamed from successes).
- **How progress is shown.** A coverage map of what the base knowledge holds and what it is missing, the reuse rate of dreamed artefacts, the number of LLM calls per solved task, speed, and the pass rate on sealed project suites, all on the `/experiments` pages and in `eval/reports/current/programming-kb/`.
- **Where this leads.** First a system that reliably turns an instruction into a verified small function; then one that solves the catalogued task families from its own knowledge without a model call; then one that learns new families from use; later, a checkpoint against the published GPT-3.5 numbers, with the gain attributed to each part.

## 1. Division of labour

| who | does | never does |
| --- | --- | --- |
| **LLMs that program** (the omp coding agent of DS022 with an authoring skill; `llm-agent` with a `code` presentation; subscription models first, per `config/llm-agent.json`) | understand the instruction and attached files; write the task circuit (task facts, tests); propose candidate code; propose knowledge (patterns, API facts, methods, norms) from sources, under the authoring loop | decide that a program is correct; write into memory; see sealed tests |
| **ChatSOP: base knowledge** (base memory `programming`) | holds principles, patterns, procedures as `method` + `action` wires, API facts, coding norms, verified components with their tests, router rules, each with source and provenance | hold unreviewed drafts; hold benchmark text |
| **ChatSOP: engines** (`htn-strips-planner`, `conform`, the Datalog and tabling strategies, the new `code-sandbox`) | plan a program from the knowledge; render it; run every candidate on the tests; check norms on the emit trace; report `verified`, `failed`, `blocked` with the missing requirement, or `not_computable` with the hole named | invent an algorithm it does not hold; call a test-passing program `exact` |
| **ChatSOP: learning** (`dreaming-session` records and `dream`; the gap records) | extract methods, lemmas, components and router rules from episodes; certify, replay, shadow, revoke; rank gaps for the next authoring batch | promote anything without replay; decide an answer with a learned part |
| **Owner** | reviews the drafts, accepts knowledge into the base memory, approves dreamed components into the library, decides the curriculum order | — |

Two consequences. First, the **understanding problem is a proposal problem**: the coding agent's task circuit is a turn-local proposal checked by the knowledge validator (declared predicates, arities, executable tests), never knowledge, exactly as a draft of DS022 is a proposal until accepted. Second, the **model boundary of AGENTS.md is untouched**: SymbolicLM still sees only the user's message; the coding agent is a trusted-host tool that writes knowledge-side and host wires, started only by the user's attachment, a yes to a scope note or the "Always use the coding agent" setting.

### 1.1 The request path

1. **Framing** (SymbolicLM, unchanged): the chat message gives `stated` wires for the framing ("in JavaScript", "no recursion", "handle the empty list"), which the host turns into `policy` and `norm` wires for the turn.
2. **Understanding** (coding agent): `TASK.md` from the programming authoring skill (section 2.4) asks it to write `task.sop`: `fact` wires in the programming vocabulary (`task_kind t1 most_frequent_element`, `input_of t1 xs`, `language t1 javascript`, `returns t1 scalar`), one `test` wire per example it finds or writes, and optionally `candidate.sop` with a `code` wire. The host validates both against the vocabulary of the base memory; an undeclared predicate is a gap record (section 2.6), not an error that stops the turn.
3. **Planning** (`htn-strips-planner`, `mode plan` for `program_for t1` under the coding-standard policy): a plan is a sequence of emit actions with bindings; `blocked` names the unmet requirement; `mode procedure` shows the method before code is written.
4. **Rendering** (host, deterministic templates per action per language) when a plan exists; otherwise the candidate code is used.
5. **Verification** (`code-sandbox`, then `conform` on the emit trace): every candidate, rendered or proposed, runs on the tests and on generated inputs; norms are checked; a failing candidate goes back to the proposer with the failing test and the violated norm for a bounded number of rounds.
6. **Answer**: the packet with `status` (`verified`, `failed`, `blocked`, `not_computable`), `guarantee bounded`, `used` (methods, components, norms with versions), the route (`knowledge`, `proposer`, `sketch_and_fill`), cost and the episode id.

The route is recorded on every turn, so "how much did ChatSOP program by itself" is a by-product of use, not a separate experiment.

## 2. The central question: filling the base knowledge systematically

### 2.1 What the base knowledge holds

| layer | wire types | example | how it is checked |
| --- | --- | --- | --- |
| **principles** | `norm` (hard and soft), `integrity` | "never evaluate user input as code"; "a function over a sequence handles the empty case" | `conform` on the emit trace of every program; the norm is named in the packet |
| **patterns** (task families) | `predicate`, `rule`, `hypothesis` | `task_kind ?t most_frequent_element` needs `count_occurrences`; the ambiguous readings of a request | the planner's `when` guards; `mode abduce` for clarification |
| **procedures** (algorithm schemas) | `method` + `action` with abstract effects | counter, then max by count, then return | `mode plan` solves the family's test tasks; a rendered program passes the tests of the family |
| **API facts** | `fact` (`api_fn`, `api_import`, `api_signature`, `api_pitfall`, `api_complexity`) | `Map`, `Array.prototype.toSorted`, `collections.Counter` | source quote; the renderer's import block; a probe program per fact that runs in the sandbox |
| **coding norms and defaults** | `norm`, `default ... except` | prefer `sorted` over `list.sort` unless in place is required | `conform`; the default's exception is exercised by a test query |
| **verified components** | `code` wires with governance, plus their `test` wires | a reviewed `topologicalSort(edges)` with its tests | the tests pass on load; the contract (signature, language, template version) is hashed |
| **tests** | `test` wires (`kind example|property|generated`) | the examples of a family; properties ("output is a subset of input") | they run |
| **router rules** | `rule` over episode facts, advisory | `solves_family knowledge most_frequent_element` with its success rate and cost | dreamed (section 3) and checked by replay |

The base memory lives as DS022 describes: `chat_data/base_memories/programming/` with `circuits/NNNN-<name>.sop` as the source of truth and `provenance.jsonl` per addition. The reviewed seed is kept in the repository at `config/knowledge/programming/*.sop` (knowledge, not a dataset: `datasets/` keeps exactly its three datasets) and is imported into the base memory through `addKnowledge` with the approving administrator recorded. Sessions clone the base memory; what a conversation learns stays in the session layer until the user commits it.

### 2.2 Sources and rights

Per asset, as DS011 requires. "Taken" is what the authoring agents may read and what may appear in wires.

| source | licence | taken | not taken |
| --- | --- | --- | --- |
| MDN Web Docs | prose CC-BY-SA 2.5, code samples CC0 | JavaScript API facts: names, signatures, documented behaviour, short attributed quotes | long prose (share-alike) |
| Node.js documentation | MIT | JavaScript API facts | — |
| Python library reference | PSF licence (permissive, attribution) | Python API facts, quoted sentences with source | — |
| The Algorithms (github.com/TheAlgorithms) | MIT | algorithm schemas, formulae, reference implementations for bounded-domain comparison, with attribution | verbatim bodies into templates without attribution |
| Wikipedia algorithm articles | CC-BY-SA 4.0 | the structure of the catalogue (which algorithms exist, complexity) | text |
| project-written material | ours | task families, instruction tasks, norms, tests | — |
| HumanEval (MIT), HumanEval+ and MBPP+ (Apache-2.0), MBPP (CC-BY 4.0) | permissive | **sealed test suites only** (section 7); MBPP's train split as a coverage probe (pattern counts, never text) | anything into wires or templates; no author sees them |
| APPS, Rosetta Code (GFDL) | per-asset unclear or restrictive | nothing until the terms are recorded; stays in `datasets_sources/` | — |

Each row enters `docs/specs/DS011-source-rights.md` and `datasets/SOURCES.md` before its first ingestion. `tools/datasets/no-copy.mjs` runs over the knowledge wires with the benchmark texts as the source set, plus an identifier check (no benchmark function name appears in any wire).

### 2.3 The curriculum

The curriculum orders the knowledge by what the system needs first to solve the tasks people actually write. Each topic has a target (the number of families and facts that make it "covered"), its sources, and the tasks that show it works. Later topics reuse the earlier ones.

| topic | content | target at first pass | shown by |
| --- | --- | --- | --- |
| T0 language basics and idioms | functions, parameters, return, guards, iteration, destructuring; the norms that apply everywhere | 15 emit actions with templates, 10 norms | the P0 instruction tasks |
| T1 collections and strings | arrays, maps, sets, strings and their common operations; "most frequent", "deduplicate", "group by", "sort by key", "split and join" | 20 families, 60 API facts | lexically disjoint variants of each family |
| T2 numbers and formulae | arithmetic, integer sequences, named formulae with a declared variable, bounds checks | 15 families, 30 formulae | bounded-domain checks against a reference |
| T3 the algorithm catalogue | search, sorting, two pointers, prefix sums, BFS/DFS, dynamic programming schemas | 20 methods with abstract effects | the method's tasks solved by plan, no model call |
| T4 errors, inputs and contracts | validation, exceptions, option handling, the empty and the null case as norms | 10 norms, 5 methods | `conform` catches the violations in a seeded set |
| T5 testing patterns | how a test is written for each family; property tests the sandbox can generate inputs for | 10 property schemas | the generated tests find seeded bugs |
| T6 modules and small programs | several functions, a CLI, a file; composition of components | 5 composition methods | a small program assembled from library components passes its tests |

The order is adjustable by use: the gap records (2.6) move a topic forward when its families are asked for.

### 2.4 The ingestion loop

One batch of the loop takes a source passage (or a set of recorded gaps) and ends with knowledge in the base memory or a recorded reason why not.

1. **Select** the next item: a curriculum topic or the top-ranked gap families.
2. **Author** with the coding agent. `POST /v1/author` (DS022) with `TASK.md` from `skills/sop-wire-authoring/` plus a **programming addendum** (new, `skills/sop-wire-authoring/programming.md`, listed in `skills/README.md`): the programming vocabulary already declared, the emit-action convention (abstract effects such as `have_counts ?t ?xs`), the template convention, the rule "every method ships with the test tasks that show it", and the rule that a component's body is a `code` wire with its `test` wires. The agent writes `knowledge.sop`, `queries.sop`, `tests.sop` and `report.md` in the request folder.
3. **Validate**: the knowledge validator in authoring mode together with the circuits of the base memory (duplicate ids, arity, closedness, governance never written by the author); the fix rounds continue the same omp session (`omp.maxFixRounds`).
4. **Execute**: the test queries run on the oracle; every method is planned on its test tasks and the rendered program runs in the sandbox; every API fact with a probe program is executed; every component's tests pass. A method whose rendered program fails its own tests is returned to the author with the trace.
5. **Differential compilation** (proposal 13.1): for a new topic, two independent compilations of the same source must agree on the probe queries; disagreements localise ambiguity and go to the report.
6. **Coverage and gaps**: the coverage map is regenerated (2.5); the gap records closed by this batch are marked.
7. **Owner review**: the drafts appear with their source quotes, tests and validation on the review page; the owner accepts into the base memory (`addKnowledge`, provenance with `approved_by`) or rejects with a reason; the journal records the batch.

Every batch is journaled with its size (wires authored, accepted, rejected), its cost (omp usage, subscription or paid) and the coverage it added; the ratio "wires per covered family" is the loop's efficiency number, reported, not gated.

### 2.5 Coverage maps

A regenerable report, `eval/reports/current/programming-kb/coverage.json`, rendered on an `/experiments` page: for each topic × language × layer, what is held (families with a working method, API facts with a probe, norms, components with tests) against the curriculum target and the list of families the gap records ask for. Three views: **known** (held and shown by a passing test), **declared but unshown** (a method without a passing task, a fact without a probe: to fix before the next batch), **missing** (in the curriculum or in the gaps, not held). The coverage map is also the honest statement of scope: the system claims to program the families in the "known" view and nothing else (AGENTS.md rule 9 applied to code: the only generalisation claimed is the same family with different content).

### 2.6 Gap detection from failures

Every turn whose outcome is not a verified program from knowledge produces a **gap record** in the session (`gaps.jsonl`, aggregated into the report): the failure point (`blocked` with its unmet requirement atom; a renderer hole; an undeclared predicate in the task circuit; a norm violation the knowledge did not name; a candidate that passed the visible tests and failed a generated one), the task family as the coding agent named it, the language, and a hash of the instruction (never the instruction text of a user, unless the user shares it). Gaps are ranked by frequency and by the families they would unlock; the top ones are the next authoring batch's input (2.4 step 1). A gap closed by a batch is linked to the batch in the journal, so the curriculum visibly adjusts to use.

### 2.7 Owner review

The review surface reuses the DS022 drafts path: a list of proposed circuits per batch with the source quotes, the test results, the validation, the differential-compilation disagreements and the coverage delta; accept and reject per circuit; every verdict journaled. Dreamed artefacts (section 3) come through the same page with their certificates and replay results; a dreamed component enters the library only after the owner accepts it.

## 3. Dreaming as a core mechanism

Dreaming is the offline pass that makes the system more systematic as it learns: it looks at what was solved and how, and extracts what matters. The records and the lifecycle exist (`reasoning/strategies/dreaming-session/records.mjs`: episodes, skills with status `candidate promoted rejected quarantined revoked advisory`, certificates, one frozen deployment plan per family, advisory hints, negative cache); the current `dream` proposes join-order skills. This plan adds four programming inventors behind the same gate.

### 3.1 What is recorded

- **Episodes** (every turn): task family, language, route (`knowledge`, `proposer`, `sketch_and_fill`), the methods and components used with versions, the number of model calls and repair rounds, sandbox cost, status, wall time. Never the user's instruction text or code without opt-in.
- **Traces** (opt-in, and always for the project's own task suites): the plan (emit actions with bindings), the candidate code's normalised AST, the sandbox trace (inputs, outputs, test results) and the norm check.

### 3.2 What gets dreamed

| inventor | from | produces | certificate |
| --- | --- | --- | --- |
| **method inventor** | recurring episodes of one family solved by the proposer, whose normalised ASTs share a structure | a `method` with emit `action`s (constants become parameters; the shared structure becomes steps; the varying part becomes a choice point or a typed hole) and the family's tests | the rendered program passes every test of the episodes it came from, and the held-out variants |
| **lemma inventor** | planning traces where the same chain of requirements recurs (`task_kind` → `needs` → `use_api`) | a shortcut `rule` that compresses the chain, or a `default` for the recurring API choice | the plans with and without the lemma agree on every replayed task (the existing `propose` gate); promoted only on cost gain |
| **component inventor** | verified `code` wires that recur across families (a helper the proposer writes again and again) | a library component: the `code` wire with a contract (signature, language), its `test` wires, governance | tests pass on load; the contract hash is checked on every use; the owner accepts it into the library |
| **router inventor** | episodes per family and route | advisory `rule`s: which route solves which family at what cost and success rate; the order in which routes are tried | replay: the router rule is applied in shadow on held-out episodes and must not lower the verified rate |

The method inventor is the one that makes the base knowledge grow from use rather than from authoring: a family the proposer solved ten times becomes a family the knowledge solves without a model call. It is also the one with the richest signal: in programming, every candidate comes with executable tests, so the certificate is a replay, not an argument.

### 3.3 The acceptance rule

The rule of proposal 5.6 and DS006, applied as it stands:

1. **Re-certify on load.** A dreamed artefact carries the contract hash of what it was learned on (the schema cone of predicates and rules, the template versions, the language). On every load the hash is recomputed; a mismatch retires the deployment plan and quarantines its skills.
2. **Replay.** The positive witnesses (the tasks the artefact came from) are re-run through the sandbox on their tests with the artefact in place; the status, rows and test verdicts must be identical.
3. **Shadow.** For its first N uses (configurable, default 20) the artefact runs beside the route it replaces; a disagreement in the sandbox verdict revokes it and the packet carries the reference answer.
4. **Revoke.** A revoked artefact is never promoted again except by explicit operator approval; the negative cache remembers what was tried and failed at which learner version and budget.
5. **A learned part never decides.** A dreamed method produces a candidate program; the sandbox and the tests decide; a dreamed router rule chooses among legal routes; a dreamed lemma must preserve the plan.

### 3.4 How it is measured

Per dream pass and cumulatively, in `eval/reports/current/programming-kb/dreaming.json` and on the experiment page:

- **reuse rate**: the share of tasks answered with at least one promoted artefact in `used`;
- **model calls per solved task** before and after (the proposer is called less when the knowledge plans the program);
- **speed**: wall time per solved task, split into understand, plan, render, sandbox, model;
- **correctness held**: the verified rate on the sealed project suites with the artefacts in place is not lower than without them (paired bootstrap interval on the difference; a drop beyond the interval revokes the pass);
- **lifecycle counts**: candidates, promoted, rejected, quarantined, revoked, and the payback point (tasks until the pass paid for itself).

The evidence that this pays is real but domain-specific, so it is measured here rather than assumed: VRC's registry gave a median 14.2× warm speedup on 12 held-out tasks of one law (2.62× over the whole series including the dream pass), E10's frozen plans ran 2 to 9× faster on a 106,800-fact world, E04 rediscovered finite-memory dynamic programming and sound pruning from traces, and E06 synthesised a dominance rule with a certificate and repaired it from a counterexample. The same lifecycle also rejected all four Horn-lemma bundles of E10 on cost, which is the gate working, and is why the cost objective of every inventor is an explicit parameter.

## 4. The wires

### 4.1 The two new wire types

Both are **host or turn wires, never knowledge approved from a source and never on the model surface** (the same ruling as `jsEval`, proposal 4.6; AGENTS.md direction 5). Both need a parser rule, validator rules, a help page under `docs/wire_typs/` and an entry in `docs/wire_types.html` with executed examples (`tests/docs/wire-help.test.mjs`).

```
@t1 test
  of t1
  call "mostFrequent([1, 2, 2, 3])"
  expect "2"
  kind example
  source "the user's example 1"
@c1 code
  of t1
  language javascript
  entry mostFrequent
  body "export function mostFrequent(xs) {\n  if (xs.length === 0) return null;\n  const counts = new Map();\n  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);\n  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];\n}\n"
  produced_by renderer
  version 1
```

- **`test`**: `of`, `call`, `expect`, optional `kind example|property|generated|sealed`, `timeout`, `source`. A test is executable text with several fields and a kind; it stays outside the four-valued evidence system (it is not a claim about the world). A `kind sealed` test never leaves `eval/suites/**`; the parser refuses it inside a knowledge file and `eval/leakage.mjs` extends to it.
- **`code`**: `of`, `language`, `entry`, `body`, `produced_by renderer|llm-agent|user|dream`, `version`, and the governance fields when it is a library component. A program is opaque to every engine and runs only in the `code-sandbox`; the packet carries it with provenance and the verification it passed; the owner may accept a verified `code` wire into the library (a host write with provenance).

### 4.2 Knowledge wires of the programming base memory (examples)

Vocabulary first, as the authoring guide requires:

```
@task_kind predicate
  args subject:entity object:entity
  description "a task instance and the family it is an instance of"
@api_fn predicate
  args subject:entity topic:entity object:text
  description "an API symbol, the language, and its qualified name"
@have_counts predicate
  args subject:entity object:entity
  description "the emitted code so far holds the element counts of ?object for task ?subject"
@out_elem predicate
  args subject:entity object:integer
  closed true
  description "sandbox trace: an element of the output of run ?subject; closed by construction"
```

Facts, rules, defaults:

```
@a1 fact
  holds api_fn map_counter javascript "Map"
  source "MDN, Map"
@r_frequency_needs_counts rule
  when task_kind ?t most_frequent_element
  then needs ?t count_occurrences
@prefer_to_sorted default
  when needs ?t sort_sequence
  then use_api ?t to_sorted
  except needs_in_place ?t
```

Emit actions and a method (an algorithm schema; the engine chooses only at choice points):

```
@emit_counter action
  params ?t ?xs
  requires have_sequence ?t ?xs
  adds have_counts ?t ?xs
  cost 1
  source "The Algorithms (MIT), frequency counting"
@emit_max_by_count action
  params ?t ?xs
  requires have_counts ?t ?xs
  adds have_result ?t
  cost 1
@most_frequent_schema method
  achieves program_for ?t
  when task_kind ?t most_frequent_element
  when input_of ?t ?xs
  binding advisory
  step optional ~emit_empty_guard ?t ?xs
  step ~emit_counter ?t ?xs
  step ~emit_max_by_count ?t ?xs
  step ~emit_return ?t
  source "The Algorithms (MIT), most_frequent"
```

Norms and the postcondition over the sandbox trace:

```
@no_eval norm
  forbid ~emit_eval ?t
  severity hard
  message "evaluating user input as code is forbidden by the coding standard"
  source "Coding standard 2.1"
@guard_empty_input norm
  oblige ~emit_empty_guard ?t ?xs
  when takes_sequence ?t
  when input_of ?t ?xs
  severity soft
  cost 5
  source "Coding standard 3.4: functions over sequences handle the empty case"
@out_subset_in integrity
  never all
    run ?r
    out_elem ?r ?v
    absent in_elem ?r ?v
  end
  witness ?r
  message "the output holds an element that is not in the input"
```

The query of a turn:

```
@coding_standard policy
  objective cost
  procedures $javascript_schemas
@q query
  mode plan
  where program_for t1
  policy $coding_standard
```

A dreamed router rule (advisory; `solves_family` and `episode_*` are closed host facts written from the episodes):

```
@route_most_frequent rule
  when task_kind ?t most_frequent_element
  then try_route ?t knowledge
  source "dreamed 2026-10-xx from 14 episodes, verified 14 of 14, median 120 ms"
```

Not proposed: a general `program` or `lambda` term in the core (it would break the finite, function-free semantics), and a `call` leaf for arbitrary code (the sandbox is a strategy, not a leaf).

## 5. Code production and verification

- **Renderer** (host, deterministic): one template per emit action per language, stored as text facts and reviewed like any knowledge (`template emit_counter javascript "const counts = new Map(); for (const x of {xs}) counts.set(x, (counts.get(x) ?? 0) + 1);"`). Bindings come from the plan; an unfilled hole is `not_computable` with the hole named, or, in sketch-and-fill, a typed hole for the proposer. **JavaScript first** (in-process `worker_threads` sandbox with wall and heap limits, no `require`, no network, the isolation the strategies already use); **Python second** (a `python3` subprocess, standard library only, no packages; an exception to "Python only under `training/python/`" that needs the owner's OK, question Q2).
- **`code-sandbox` strategy** (new, `reasoning/strategies/code-sandbox/`): `ask({code, tests, inputs})` runs the code on every `test` wire and on generated inputs and returns `verified` (`guarantee bounded`), `failed` (failing test ids, actual output, exception) or `budget_exhausted` (`reason wall|memory`), plus an execution trace as closed facts (`run r1`, `in_elem r1 3`, `out_elem r1 2`, `test_result r1 t1 passed`) that `conform` and the Datalog strategies read for the `integrity` postconditions and `aggregate`s. It declares `provides: ['trace']`, `isolation: yes`, and never writes knowledge.
- **Norm conformance**: the renderer's plan is an emit trace, so `mode conform` is the existing lowering. For proposed code the host extracts a coarse emit trace by a deterministic AST walk (calls to `eval`, presence of an empty-input guard, recursion, mutation of parameters); finer norms wait for a reviewed analyser.
- **Repair loop** (host): the failing test, the violated norm and the sandbox error go back to the proposer, at most `maxRounds` (3) and within `maxPaidUsd`.
- **Candidate selection**: when several candidates exist and none passes everything, agreement on generated inputs (CodeT-style dual execution) picks one, and the packet says so.
- **Sealed tests** are never visible to the proposer, the renderer or the authors: the harness runs them after the arm has committed its answer and its own `verified` flag, so the false-verified rate is measurable.

## 6. Milestones

Each milestone is small, has a clear success signal, and builds on the previous one. Effort is in agent-days of coding-agent work with owner review; paid model cost is capped per run by `maxPaidUsd`, subscription models first. No GPU, no training.

| milestone | what is built | success signal | size |
| --- | --- | --- | --- |
| **P0 follow an instruction** | the `test` and `code` wires with help pages; the `code-sandbox` strategy (JavaScript worker); a `code` presentation for `llm-agent` and a `TASK.md` for the coding agent that writes `task.sop` + `candidate.sop` from an instruction; the packet with `verified|failed`; episodes recorded; 20 project-written instruction tasks (JavaScript, with examples and 3 hidden tests each) under `eval/suites/code-instructions-v1/`; the journal and the topic note | at least 15 of 20 instructions end as `verified`; no `verified` program fails a hidden test (false-verified = 0 on this set); every run leaves an episode; the wire help examples execute | 3 to 4 days |
| **P1 the first pattern library** | the T0 and part of T1 knowledge, hand-authored with the coding agent under the programming addendum: 15 emit actions with templates, 10 norms, 12 families with methods, 40 API facts; the renderer; `mode plan` → render → sandbox on the request path; the coverage map v0 and the gap records | the 12 families' tasks and their lexically disjoint variants (different names, nouns, element types) are `verified` from knowledge with **zero model calls**; the coverage page shows known, unshown and missing; a task outside the 12 families yields `blocked` with the requirement named and a gap record | 4 to 5 days |
| **P2 the ingestion loop end to end** | one curriculum batch from a real source (MDN and Node docs for `Array`, `Map`, `Set`, `String`) through `POST /v1/author`, validation, execution of probes and test tasks, differential compilation, the review page, acceptance into the base memory `programming` with provenance; rights rows recorded | at least 100 API facts with executed probes and 10 methods with passing test tasks accepted; the wires-per-family cost and the omp cost reported; a second independent compilation agrees on the probe queries or the disagreements are explained in the report | 4 to 5 days |
| **P3 dreaming shows reuse** | the four inventors (method, lemma, component, router) behind the existing gate; traces for the project suites; a dream pass over the P0 to P2 episodes plus 100 new instruction tasks in 10 families the knowledge does not yet hold, solved by the proposer | after the pass, on a replay of 100 held-out variants: reuse rate at least 30 percent, model calls per solved task down at least 25 percent, correctness held (verified rate within the bootstrap interval of the pre-pass rate); at least one family moved from `proposer` to `knowledge` by a dreamed method; the lifecycle counts and the payback point are on the page | 5 to 6 days |
| **P4 grow coverage by curriculum and use** | topics T1 to T3 in weekly batches driven by the coverage map and the gap records; a dream pass after each batch; Python sandbox if approved; the project-written control suite `code-fresh-v1` (lexically disjoint variants of catalogued families, AGENTS.md rule 9); sketch-and-fill (the planner's skeleton with typed holes, the proposer fills the holes) | the knowledge route alone solves at least 40 percent of `code-fresh-v1` with precision above 90 percent when attempted; the full path (knowledge, then proposer, verified) above 90 percent; the coverage map shows each batch's delta and the gap list shrinks | 8 to 10 days, in batches |
| **P5 checkpoint against the published benchmarks** | the sealed suites `code-humaneval-v1` (164, with HumanEval+ tests) and `code-mbpp-v1` (sanitized 427, with MBPP+ tests), JavaScript translations where available; arms A0 (model alone), A1 (model plus sandbox, repair and selection), A2 (knowledge alone), A3 (hybrid: knowledge first, sketch-and-fill, proposer); staged evaluation with early stopping; the published GPT-3.5 numbers as the reference line (48.1 percent HumanEval pass@1 for the March 2023 model; 70.7 percent HumanEval+ and 69.7 percent MBPP+ for `gpt-3.5-turbo`, EvalPlus) | the attribution table: pass@1 per arm with paired bootstrap intervals, false-verified rate, coverage and precision of the knowledge route, cost and latency; the hypotheses below preregistered and decided | 6 to 8 days |
| **P6 the article** | the evidence-backed write-up: what ChatSOP programs from its own knowledge, what it verifies, what it learned by dreaming, the cost per solved task, the honest limits | owner review | 5 days |

**Optional side experiment E-DSL** (any time after P0, 3 to 5 days): the pure-symbolic list-function DSL synthesiser of revision 1 (components `map filter fold sort reverse take drop zip sum count head last`, 200 generated tasks of size 1 to 5, strategies `asp-clingo`, a bottom-up enumerator with observational equivalence, `prolog-tabling`, oracle replay on hidden examples). It gives exact answers inside a DSL and a comparison point for the model on a domain where exact answers exist. It is not on the critical path.

**Hypotheses for P5** (preregistered in `status/experiments.json` before any run; stages of 30, 100, full with paired bootstrap intervals; stop when decisive by 5 points, when futile, or when over 20 percent of the first 30 outputs are malformed): (HP1) A1 beats A0 by at least 5 points pass@1 on HumanEval+ and MBPP+ with the same model; (HP2) A1's false-verified rate is at most half of A0's; (HP3) A2 attempts at least 15 percent of MBPP sanitized with precision at least 80 percent on attempted problems; (HP4) A3 is at least as good as A1 with fewer model calls per solved problem. The published GPT-3.5 numbers are a line in the table, labelled published and contaminated (the models saw these benchmarks), never re-run as ours; no milestone waits for them.

## 7. Evaluation discipline

- **Suites** under `eval/suites/<name>/test.jsonl` with manifests: `code-instructions-v1` (P0), `code-fresh-v1` (P4), `code-humaneval-v1` and `code-mbpp-v1` (P5). Training and knowledge code never read them (`eval/leakage.mjs`, `tests/eval-registry.test.mjs`); `tools/datasets/no-copy.mjs` and the identifier check run over every knowledge circuit.
- **Metrics**, logged in every packet: `verified` rate and pass@1 on sealed tests; false-verified and honest-abstain rates; coverage (share attempted by the knowledge route) and precision when attempted, per route; reuse rate and model calls per solved task (section 3.4); cost in USD from the omp and `llm-agent` usage events and tokens; latency per phase; wires per covered family.
- **Stopping**: staged samples with interim intervals, stopping rules in the preregistration, every stop recorded with stage, numbers and reason in the journal, the topic notes and the experiment record.
- **Cost**: subscription models first (`xai-oauth/grok-4.20-0309-non-reasoning`, then `zai/glm-5.3-flash`, per `config/llm-agent.json` and the routing memory); paid models count against `maxPaidUsd` (proposed 20 USD per stage-1 run, 100 USD per full run, question Q4).
- **Reporting**: `eval/reports/current/programming-kb/` for the regenerable observations (coverage, dreaming, suites), `eval/reports/history/` for archived numbers; the `/experiments` pages are the living index; no historical number is presented as a current run.

## 8. Risks and open questions

Risks, with what the plan does about each:

1. **Knowledge cost.** Authoring is the largest line of effort. The loop reports wires per covered family from P2 on, dreaming grows families from use (P3), and the curriculum is reordered by the gap records, so effort follows demand.
2. **Tests are not proofs.** A verified program can still be wrong; the plan reports false-verified rates on sealed hidden tests from P0 and never calls a test-passing program `exact`.
3. **Template and method bugs become systematic.** Every method ships with its test tasks and every template is exercised by the sandbox before acceptance; the shadow phase of dreaming catches regressions.
4. **Running generated code.** The sandbox has no network and no filesystem, wall and heap limits, a worker or subprocess; Python needs the owner's decision.
5. **Dreamed artefacts that pass the gate but are unsound on unexercised inputs.** The gate is as strong as its replay tasks; generated inputs (property tests, T5) widen it, and the shadow phase runs the reference beside every new artefact.
6. **Contamination of the model arms at P5.** The models saw HumanEval and MBPP; the control suite `code-fresh-v1` is the clean comparison and the report says so.

Open questions for the owner (to be copied into `questions.md` by the agent that owns it):

- **Q1. Division of labour as stated** (LLMs understand and propose; ChatSOP holds, verifies, composes, learns; the coding agent writes the task circuit as a turn-local proposal). Agree? Recommendation: yes.
- **Q2. Python sandbox.** May the harness run `python3` as a subprocess (standard library only, no packages) for the Python suites, confined to `code-sandbox`? Recommendation: yes, from P4; JavaScript first.
- **Q3. Placement.** The reviewed seed at `config/knowledge/programming/*.sop`, imported into the base memory `programming` (DS022) with provenance; suites under `eval/suites/`; no new first-level dataset. Agree?
- **Q4. Spend.** 20 USD per stage-1 run, 100 USD per full run of paid models; subscription models first. Agree?
- **Q5. Who accepts dreamed artefacts.** Methods, lemmas and router rules: promoted by the gate and listed for review (revocable by the owner). Components into the library: the owner accepts explicitly. Agree?
- **Q6. The two new wires** `test` and `code` as host and turn wires (never source-approved knowledge, never on the model surface), with help pages and validator rules. Agree?

## References

Project: `reasoning-wires-proposal.md` (5.6 dreaming records and acceptance rule; 8 modes of work; 13 authoring); `zip-strategy-inventory.md` (Z05 E04 verified reasoning skills, Z06 E05 algorithm composition, Z07 E06 dominance invention, Z08 E07 feature invention, Z12 E09 Horn lemma dreaming, Z18 E10 Dreamer lifecycle, V07 VRC learned registry); DS006 "Strategies" (`dreaming-session`, `llm-agent`, `htn-strips-planner`, `conform`); DS022 (base memories, drafts, the omp coding agent); `skills/sop-wire-authoring/`. Literature: Chen et al. 2021 (Codex, HumanEval); Austin et al. 2021 (MBPP); Liu et al. 2023 (EvalPlus); OpenAI 2023 (GPT-4 technical report, 48.1 percent for GPT-3.5); Chen et al. 2022 (CodeT: test-driven selection lifted `code-davinci-002` from 47.0 to 65.8 percent pass@1); Li et al. 2022 (AlphaCode filtering); Chen et al. 2023 (Self-Debugging); Shinn et al. 2023 (Reflexion); Solar-Lezama 2008 (sketching); Ellis et al. 2021 (DreamCoder: library learning from solved tasks); Rich and Waters 1990 (the Programmer's Apprentice: cliché libraries); Smith 1990 (KIDS).
