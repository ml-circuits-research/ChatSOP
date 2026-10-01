# One set of reasoning wires for many reasoning strategies

Proposal, round 3 (2026-10-01). Round 1 by reasoning-proposal-agent; round 2 by proposal-revision-agent after the review of round 1 (reviewer Fable: needs major revision of sections 4.2 and 7.1, plus the new section on modes of work) and after an inventory of every strategy in the four experiment zips; round 3 by proposal-r3-agent after the reviewer's round-2 report (verdict: ready after minor fixes; four must-fix items and nine should-fix items, all applied, see 0.2). Status: for owner review; nothing here is implemented in the product runtime (`sop/`, `reasoning/`, `lib/` and `datasets/` are untouched). The smoke suite, validator and harness that back it live in `eval/smoke-reasoning/` and were run for this document.

The document is self-contained, and the **authoring material is extracted into one separate, self-contained page: [`wire-authoring-guide.md`](wire-authoring-guide.md)** (3 to 4 pages, grammar generated from the validator, worked examples drawn from the smoke cases), the only thing an LLM that writes wires from a source needs to read (section 13.1). To keep the main body short, three large tables moved to appendices: the inventory of the zips (Appendix E), the smoke results (Appendix F) and the declared coverage of the planned strategies (Appendix G). Where it reports evidence from the four experiment zips it explains the essence and quotes the exact numbers with the file they come from, so a reader does not have to open them.

---

## 0. Summary, response to review round 1, and what the reviewer is asked to decide

**The problem.** ChatSOP has two reasoning strategies, `reference` (bounded JavaScript) and `advanced` (the same JavaScript plus optional SWI-Prolog and Z3 adapters). The JavaScript strategy is a sound but small Horn reasoner. Prolog and Z3 are thin adapters. The contract is spread over DS006, DS010, the wire help pages and comments in `reasoning/registry.mjs`, which is why it feels weak and confusing. Meanwhile four experiments (soplab, sop-r, E10, VRC) each propose a different surface syntax and a different engine.

**The proposal in one paragraph.** ChatSOP is meant to be a symbolic LLM: a capable LLM writes SOP wires from sources (books, manuals) into memory, SymbolicLM turns the user's prompt into a query circuit, and strategies reason over the memory. Keep the SOP Lang conventions ChatSOP already has and define one **core wire set** that every strategy can consume (`predicate`, `fact`, `rule`, `aggregate`, `constraint`, `action`, `goal`, `hypothesis`, `policy`), plus **sugar** that desugars mechanically into the core (`default`, `integrity`), plus **modes of work** (`method`, `norm`, `procedure`, `amendment`, `argument`, `trace`, with governance fields: versions, approval, supersession) that help and restrict the engines, plus a small **query surface** (`query` with five new modes, `stated`, `constraint`) that SymbolicLM emits. A strategy publishes a **capability declaration**; a circuit that needs a feature the strategy lacks is answered `not_expressible`, never weakened. Strategies are **separate** (JavaScript reference, SWI-Prolog, Z3, Datalog, SQL, planners, Golog, ASP, and so on), each with its own algorithm, strengths and capability set. A **router** (rule-based first, portfolio next, learned later) picks a strategy only when the caller asks for automatic routing; an explicit request is never substituted (AGENTS.md rule 8). Budgets are honest (`budget_exhausted`, never a negative answer), the user's prompt may influence effort, and emotion enters only through policy. Memory may hold billions of wires, so the engine receives a retrieved, guarded slice (section 11).

**What was actually run for this document.** 79 smoke cases (30 new in round 2, 10 new in round 3) and a standalone validator with 58 invalid fixtures (round 3 renamed one and added two for the standing marker); six live strategies on the cases they can express (`js-reference` 35 of 35, `js-oracle` 59 of 59, `prolog-swi` 28 of 28, `z3-lia` 3 of 3, `datalog-e10` 37 of 37, `datalog-soplab` 43 of 44; `datalog-e10` and `datalog-soplab` are wired read-only from the zips; the single failure of `datalog-soplab` is a real finding, section 9.2). **`js-oracle` is the stage-1 complete oracle, in progress** (another agent, oracle-agent, is still finishing it: the strategy folder `reasoning/strategies/js-reference/` and the adapter `eval/smoke-reasoning/adapters/js-oracle.mjs` exist, it passes every case it declares, the optional procedure rendering and the `conform` lowering are not built, and its default for an absent `binding` is still to be aligned with section 8.2). The **existing `js-reference` stays as the current bounded product strategy** until the owner's review decides what the oracle becomes (a replacement, a second strategy beside it, or a test-only artefact). **Cases no live strategy passes** (current run): `11c` and the modes-of-work family `30a` to `39b` (20 cases; they need the planner with methods and norms, and `37a` to `37d` could be made live early by the lowering of `conform`, 8.4). **Cases only `js-oracle` passes**: `01b` (zero arity), `06d` (arithmetic in rules), `12c` to `12g` (throughout and the temporal family) and `13b` (why-not). The round-3 cases that engines can express pass on the live strategies: `10f` (the a/b/c counterexample of the conditional list), `13c` and `13d` (`used`), and `24` (a default over a retrieved slice, which exercises the completeness rule for defaults and shows the unsafe answer when the guard is off). Two more exact engines are available as private binaries and are not yet wired: Soufflé 2.5 (`datalog-souffle`) and clingo 5.8.2 (`asp-clingo`), both under `tools/.solvers/`; their adapters are still planned. See sections 9 and 11.

### 0.1 Response to review round 1 (done in round 2)

Every MUST-FIX is applied. Every SHOULD-FIX is applied; where a fix was narrowed, the table says how. The reviewer's two documents (the first report with its addendum, and the dedicated answer on modes of work, "10b") differ in naming on modes of work; the choices are in section 8.8 and listed for the owner in section 14.

| Item | What changed | Section |
| --- | --- | --- |
| MUST 1: `both` non-monotone | Chose the paraconsistent option (a): positive and negative evidence propagate independently, `both` is only a reported status; R-P1 now holds; the rejected option is stated | 4.2, 11.6 |
| MUST 2: Z3 and ASP negation explodes | Explicit negation is a separate relation in Z3 and ASP (`p_pos`, `p_neg`, as Prolog already did); `both` is computed at query time; `integrity` becomes a violation relation, never a hard assertion | 7.1, 4.3 |
| MUST 3: Clark completion unsound for recursion | `z3-smt-bounded` declares `recursion` unsupported; completion only for non-recursive predicates; the circular-support counterexample is smoke case `04b`; loop formulas named as the way out; 09a is stated to be non-recursive | 7, 7.1, 7.2, 9.2 |
| MUST 4: closedness of derived predicates | `complete_for_view` defined recursively for derived predicates (demand propagation); validator flags `absent` over an incomplete rule set (`absent_over_incomplete_rules`, fed by the retrieval manifest); case `23` | 4.2, 11.6 |
| MUST 5: time has no semantics | Snapshot semantics for derived atoms; `during` = throughout, `overlaps` = some instant, `at`, `asof` = known at; `start_of` / `end_of` bind time variables; lowering row; cases `12b` to `12f` | 4.2, 4.4, 7.1 |
| MUST 6: zero arity | Arity 0 to 6 allowed (`args none`), no dummy constant; case `01b` | 4.1, 4.3 |
| MUST 7: `conditional` is a boolean | `conditional` is the list of assumption ids; universal two-run lowering; `nonmonotone` and `conditional_unknown` flags; cases `10c`, `10d`, `10e` | 4.2, 5.3 |
| MUST 8: role-to-position bridge | `predicate` declares `args subject:entity object:entity` (closed role inventory, types after the colon); the validator checks facts against it; the lexicon stores only word to predicate | 4.3, 4.4 |
| SHOULD 1: `why_not` via unsat core | Redefined as minimal sets of EDB atoms (slice vocabulary, respecting types) whose addition makes the goal derivable, plus the blocking atoms; per-strategy lowering corrected | 4.4, 7.1 |
| SHOULD 2: priority blocking by `applies` | Blocking is by FIRE; `overrides $default` added beside `priority` (priority compiles to it); case `09e` | 4.3 |
| SHOULD 3: aggregate, count, every need closed predicates | Warnings `aggregate_needs_closed`, `count_needs_closed`, `every_needs_closed_scope`; the host returns a count as a lower bound (`bound at_least`) and an `every` over an open domain as `unknown`; cases `07d`, `08d` | 4.2 |
| SHOULD 4: planning uses closed world silently | The planner state is polarity-explicit unless the fluent is closed; `blocked {step, requirement, norm}` returned instead of a bare `no_plan` | 4.3, 5.3 |
| SHOULD 5: bounded negatives | `no_plan` from a horizon, depth or domain limit is `budget_exhausted` with `reason`; enforced in `lib/compare.mjs` | 6 |
| SHOULD 6: `ignored` undefined | Defined as wires outside the query's dependency slice only | 5.3 |
| SHOULD 7: packet lacks claim ids | `used: [{id, version}]` mandatory for complete `supported` / `refuted`; minimal proof-DAG schema | 5.3 |
| SHOULD 8: capability dimensions | `delivery`, `max_wires`, `max_arity`, integer range, exact or bounded, provides, determinism | 5.1 |
| SHOULD 9: incremental maintenance | Invalidation rules for prepared handles and plans; DRed for retraction under NAF; integrity checked at ingestion | 5.5 |
| SHOULD 10: dreaming at scale | A handle is prepared over a per-domain subgraph or per-query-family slice, scope recorded in the skill | 5.5, 7 |
| SHOULD 11: simulated store | Stated to measure lookup counts, not I/O; a real 10^7 SQLite run added to the plan | 11.8, 12 |
| SHOULD 12: slices as text | Structured delivery; the 2,048-wire limit is an author-surface limit | 11.3 |
| SHOULD 13: method cannot branch or loop | `choose`, `any_order`, `if/else`, `until ... max N`, `pick`, `optional`, `achieve`; unbounded loops stated as not expressible (Erol, Hendler, Nau) | 8.2, 8.9 |
| SHOULD 14: recursive aggregation | Documented as a known limit; point to planning and closure | 4.3 |
| SHOULD 15: evidence framing | The four experiments are one project lineage: agreement is consistency, not independent validation; headline made consistent with 9.3; "Nixon diamond with priority" renamed | 2.6, 9.1, 4.3 |
| SHOULD 16: structure | Numbering made gap-free (sections 1 to 14), one list of open questions, `pack` explained as host plumbing | 14, App. A |
| SHOULD 17: literature | Clark 1978, Lin and Zhao 2004, Przymusinski 1988, Belnap 1977, Nute 1994, Gupta, Mumick and Subrahmanian 1993, Ross and Sagiv 1992, Erol, Hendler and Nau 1994 added, with what each is used for | App. C |
| Addendum: closed checks | The three validator warnings and the bounded result | 4.2 |
| Addendum: `used` by two runs, `conditional_unknown` | Specified | 5.3 |
| Addendum: strict contraries | A strict contrary blocks a default automatically (stratifiable); only default-derived contraries go through overrides; the Nixon diamond stays `both`; case `09d` | 4.3 |
| Addendum: `js-reference` as oracle | Stage 1 makes it a complete, deliberately naive implementation of every core feature; entry condition for every other strategy | 5.4, 12 |
| Addendum: Prolog budgets and tabling | In the adapter contract | 5.5 |
| Addendum: LLM authoring risks, lint, differential probe | Seven risks named; lint pass and differential-compilation probe in stage 1; writability is a central hypothesis | 13.1, 12 |
| Addendum: namespace, `key`, `divided_by`, `compare` | `x_` prefix reserved; `key` is a lint (warning); integer division truncates toward zero, zero divisor makes the body false; ordering comparisons on entities are rejected | 4.2, 4.3 |
| Addendum: evaluation additions | Authoring-fidelity probe, `conditional` correctness, `clarify` rate, latency targets, metamorphic tests of host linking, smoke suite as a `tests/` gate, hub-constant truncation policy | 11.5, 12 |
| Open questions, changed answers | Applied (Q5 `advanced` alias with a deprecation note, Q6, Q7 `valid` defaults to `timeless`, Q9, Q14); the first answer and the second differ on `advanced`: choice stated and listed | 14 |
| Modes of work (review sections 10 and 10b) | New section: governance fields on every binding wire, extended `method`, `norm`, `procedure` (named bundle), `amendment` and `argument`, `trace`, `conform` and `procedure` modes, `waive` hypotheses, policy and packet additions, capabilities, router-reset worked example, cases `30a` to `37b`; where the two review texts differ one coherent set is chosen | 8 |
| Inventory of the zips | Corrections to the evidence numbers; strategies `sql-sqlite`, `golog-swi`; the closure template as a router rule; the `call` provider leaf, the concrete dreaming records and the numeric-planning extension; backlog of smoke cases | 2.7, 5, 7, 10, 12, App. D |

### 0.2 Response to review round 2

The reviewer's verdict was "ready after minor fixes". Every MUST-FIX and SHOULD-FIX item is applied; the reviewer's remarks for the owner are placed next to the open questions (section 14).

| Item | What changed | Section |
| --- | --- | --- |
| MUST 1: default conclusions are completeness-sensitive | "Without negation as failure" in R-P1 is judged on the desugared program, so default conclusions fall under R-P2. For the generated `x_strict_*` and `x_*_blocked` predicates and for exception bodies, completeness is *retrieval* completeness for the keys (`lookup(not p, keys).complete`, `rulesFor(contrary).complete`, a keyed lookup of each `except` predicate), not world closedness. Before accepting a default-derived row, widening does keyed lookups of `not p a` and of the exception atoms for each candidate `a`. "Does not depend on any default conclusion" is tested on predicate names. Case `24` (the widening loop in `lib/widen.mjs` now treats defaults so) | 4.2 item 4, 4.3, 11.5, 11.6 |
| MUST 2: `conditional` per row, verified | `conditional` is per row (the packet list is the union). After the leave-one-out set S, one more run with observed facts plus S only: if it equals the full answer, S is exact; otherwise all assumptions with `conditional_unknown`. "Exact for monotone programs" removed. The counterexample (facts a, b, c; row iff c and (a or b)) is case `10f` | 4.2 item 6, 4.4, 5.3 |
| MUST 3: `used` is one sufficient support set | `used` is one sufficient support set. For the host's deletion method, the leave-one-out set verified by a replay run; otherwise `used_incomplete: true` (distinct from `conditional_unknown`). The comparator replays each strategy's `used` alone in the oracle and compares statuses, never leaf-set equality. Under-reporting only loses promotions (AGENTS.md rule 7). Cases `13c` (two facts each sufficient), `13d` (verified deletion) | 5.3, 5.4 |
| MUST 4: ASP `integrity` row | The exception (a hard constraint for `severity error` under a "norm mode") is deleted; integrity is never a hard assertion in any strategy; a hard prohibition of what may be done is a `norm` (`forbid STATE always`) | 7.1, 5.5 |
| SHOULD 1: obligation trigger and scoping | An obligation instance is triggered at the first step where `when` holds for a binding bound by the goal's arguments or by an executed action; standing obligations over a whole predicate get `obligation_unscoped`; one formal table of every qualifier (`within N` counts steps in a plan, time units in a timestamped trace). Case `38`; validator warning `obligation_unscoped` | 8.2 |
| SHOULD 2: `severity` x `binding` | A matrix: severity says what a violation does, binding says whether the engine may relax the norm when otherwise blocked; advisory + hard is a relaxable hard constraint; `binding` on a soft norm is vacuous (warning `binding_on_soft_norm`); equal-strength conflict is `blocked` with both ids under strict and a reported violation under advisory. Cases `39a`, `39b` | 8.2, 8.3 |
| SHOULD 3: `scope` and `procedures` | All approved norms whose `scope` matches bind regardless of procedure; `procedures` selects the methods and the rendering set; `scope` matching is defined; `procedure.version` is removed (the members carry versions) | 8.2 |
| SHOULD 4: `contested` and approval | `contested` is a host write and a contested wire binds, flagged, until the host decides; ingestion writes the `approval` field (omitted = approved in memory, omitted = submitted on the authoring surface); `approved_at` required for norms and strict methods (fallback `known_at`); the amendment vocabulary is unified (`proposed approved rejected`; `rejected` joins the wires' vocabulary) | 8.2, 8.3 |
| SHOULD 5: `conform` with time and lowering | `trace.step` may carry `at`, `conform` takes `asof` (default now), each step is judged against the versions in force at its time; deviating from a strict method is non-compliance (advisory: `deviations` reported); conformance lowers to core rules, so it runs on every Datalog strategy. Cases `37c`, `37d` | 8.4 |
| SHOULD 6: `blocked_by` in ASP and Z3 | Hard norms are violation atoms plus a "no violation" requirement; on unsat the requirement is lifted and the violations are minimised (the `waive` abduction); unsat within the horizon is `budget_exhausted` with `reason horizon`, never `no_plan` | 7.1, 8.7 |
| SHOULD 7: interval combination | A table for `select`, `count`, `every` under `during` and `overlaps`; the sentinel order `beginning` < instants < `open`. Case `12g` | 4.2 item 7, 7.1 |
| SHOULD 8: governance on `action` | `action` carries the governance fields, is amended like a method and appears in `used` | 4.3, 8.2 |
| SHOULD 9: housekeeping | `sopr-lift-worlds` and `worlds-sopr` unified (`worlds-sopr`); 12b stated as rewritten to `overlaps` and how the adapter maps it; `permit` without `overrides` is the warning `permit_without_target`; the declared-coverage table is labelled a declaration; the native closure template passes the 5.4 shadow gate like a strategy; `dreaming-session` is a wrapper with no coverage column; V01 (a facade) regraded from strong to moderate | 4.2, 5.4, 7, 9.2, 10.2, App. E, F, G |
| Section 8, two sentences | The host composes the `amendment` wire from the user's language (a host-generated knowledge wire, not model output); before approval it may replay the procedure's own smoke cases under the amendment | 8.5 |
| Usability | The authoring guide is extracted (`wire-authoring-guide.md`) and referenced; the 2.7 inventory table and the two 9.2 tables moved to appendices | 13.1, App. E to G |

### 0.3 Response to review round 3

The reviewer's verdict was "ready for owner review"; six text-level defects and the authoring-guide items are applied in the same pass.

| Item | What changed | Section |
| --- | --- | --- |
| Small gap, MUST 1 | The body predicates of a strict contrary *rule* (`penguin` in `when penguin ?x then not flies ?x`) need keyed lookup completeness for each candidate; the recursion of item 4 applies to those bodies, with retrieval completeness at the leaves | 4.2 item 4, 11.6 |
| Small gap, MUST 2 | "Exact" defined: for a monotone dependence a passing verification proves S is the unique minimal set; under NAF it proves sufficiency only and `nonmonotone` is set | 4.2 item 6 |
| Small gap, SHOULD 3 | `scope_unknown` added to the packet schema as a field | 5.3, 8.2 |
| New 1 | `js-oracle` described as the stage-1 complete oracle, in progress; the "no engine passes" lists rewritten from the current run; `js-reference` stays the bounded product strategy until the owner decides; `datalog-souffle` and `asp-clingo` stated (private binaries present, adapters planned); Appendix F is the current run | 0, 5.4, 7, 9.2, 12, 14.15, App. F |
| New 2 | Case `30a` `used` lists the three actions | 8.6 |
| New 3 | Standing obligations get one marker, the line `standing` on an `oblige`; `obligation_unscoped` is the warning for that marker; an unbound variable is the error `unsafe_variable` (validator: fixtures `obligation-unbound-variable`, `obligation-standing`) | 8.2, 14.26 |
| New 4 | Validator authoring mode (`--authoring`): the host-written governance fields are ignored with the warning `governance_ignored`; `approval_incomplete` and `approved_at` are ingestion checks only | 8.2, 13.1 |
| New 5 | `binding` defaults to `strict` for norms and methods (fail-safe, consistent with "a policy may only tighten"); the validator and the guide follow | 8.2, 8.3 |
| New 6 | The 4.3 `action` wording: `no_plan` only when nothing can be named, otherwise `blocked` or `budget_exhausted` | 4.3, 8.4 |
| Authoring guide | One reification pattern (3.10) and a short `integrity` example (3.11); one `fact` with `status reported`, `speaker`, `quote`; `closed` dropped on `penguin` and justified on `salary`; symbols versus strings and the symbol rule for multi-word names; the wording fixes of 3.5 and 3.8; the standing marker, the default `binding`, the authoring mode. Every example is checked by the validator | guide |
| 14.26 | The five defaults (a) to (e) are agreed by the reviewer; (b) adds `scope_unknown` to the packet and (c) names the marker syntax | 14.26 |

### 0.4 Decisions requested

Collected in section 14. The most important: accept the core, sugar and modes-of-work split (14.1), the paraconsistent reading of `both` (14.2), the two negations and `closed` (14.3), the new query modes (14.4), strategy ids and the fate of `advanced` (14.6), the naming choices of section 8.8 (14.16), which strategy to build first (14.10) and who approves norms (14.23). The reviewer's recommendation is printed beside each.

---

## 1. Where we are

### 1.1 The two strategies today

`policy.reasoningStrategy` is `reference` or `advanced`, independent of the memory engine.

- `reference`: bounded JavaScript. Function-free Horn deduction over admitted facts, observations and rules; explicit negation is independent evidence (`not p a` is a fact of its own, no explosion, a positive and a negative together give status `both`); finite-domain integer constraints by enumeration; JS controllers for abduction, diagnosis, induction, analogy, planning (uniform-cost search over polarity-explicit states) and what-if simulation. Budgets are cooperative counters (`maxNodes`, `maxDepth`, `maxRounds`, `maxFacts`, `maxJoins`, `maxAssignments`, `timeoutMs`, ...).
- `advanced`: the same controllers, plus, when available, SWI-Prolog for point-in-time Horn queries and Z3 for integer constraints and optimisation. The Prolog adapter only recomputes the closure in SWI, then JavaScript rebuilds the proof and checks that both closures agree; Z3 is not a Horn backend at all.

What is missing (and is added by this proposal): negation as failure, closed predicates, aggregates other than the query-level `count`, defaults and exceptions, integrity constraints, procedures from manuals, "why not" explanations, tabling, magic sets, incremental indexing, an offline "dreaming" period, and an honest partial-answer status. Today an exhausted budget comes back as `status: unknown, complete: false` (or, for a select, `supported` with `complete: false`); the harness had to translate that into `budget_exhausted`. A strategy registry that treats `reference|advanced` as the only choices cannot express "this problem needs negation as failure, so use a strategy that has it".

### 1.2 The confusion, in three sentences

The names `reference` and `advanced` describe a level of effort, not a strategy. The real strategies (JS, SWI, Z3) hide inside `advanced` with different capabilities and silent fallbacks reported only in `route`. The wire vocabulary was designed for the small model and for Horn plus numeric constraints, so every new reasoning idea needed a one-off wire (`pattern`, `trace`, `theory`, `simulate`, ...).

---

## 2. The evidence base: four experiments and one catalogue

All four zips run as plain Node with no installs; they were unpacked outside the tracked tree (`datasets_sources/experiments_unpacked/`) and their test suites and demos were re-run for this document where stated.

### 2.1 soplab (`soplab-v0.4.0.zip`, sop-reasoning-lab 0.4.0)

**Essence.** A dependency-free research harness whose hypothesis is that many reasoning families share one intermediate representation: a relation of variable bindings with evidence. Eight block types: `claim` (ground fact, positive or `NOT`), `all` (conjunction, named relation with a `GIVES` interface), `any` (union), `reduce` (group-by with COUNT, SUM, MIN, MAX, COLLECT, SET, FIRST), `rule` (one head), `goal` (query), `transition` (planning operator with REMOVE, ADD, COST) and `assumption` (abducible with a cost).

**Semantics.** Four-valued signed evidence per proposition: unknown, supported, refuted, conflicting, positive and negative stored independently, no explosion. `NOT p` is explicit negative evidence; `NONE p` is absence in the evaluated scope (negation as failure), stratified; a negative cycle is rejected. Proof DAGs record source claim, rule and bindings.

**Algorithms.** A generator-based nested-loop evaluator; `naive` and semi-naive `delta` materialisation; backward predicate slicing from the goal (not tabling, not magic sets); best-first transition planner; subset-enumerating min-cost abduction (`maxAssumptions` 4); a toy rule-induction learner over path-shaped rules.

**Evidence** (all from bundled synthetic workloads, `results/`): delta evaluates 9,365 candidate rows against 21,217 for naive with identical answers (`results/baseline.json`); on a 45-node graph 18,885 against 45,222 (`results/benchmark-current.txt`); a specialised graph-closure wire visits 87 edges in 1 call where recursive rules need 18,885 candidate rows and 2,104 firings, same 44 answers (`results/graph-wire-vs-rules.txt`); the recursive rule works to depth 20 while a path form bounded at length 3 fails from depth 4 (`results/recursion-depth.txt`); the hidden path rule is ranked first in 12 of 12 trials in every noise cell except 11 of 12 at noise 0.3 with one or two worlds (`results/noise-microworlds.txt`). 23 of 23 tests pass.

**Does not show:** epistemic status, roles, time, budgets, natural language, SMT, scale beyond ~10^3 derived facts, the adaptive abstraction-learning loop its docs describe (design text only).

### 2.2 sop-r (`sop-r.zip`)

**Essence.** The experiment closest to the intended product loop. A coding LLM reads a handbook and compiles it into SOP wires; a Node engine answers queries that are themselves circuits. Knowledge wire types: `fact` (frame form `about X` plus `relation value` lines, or `say S R O`), `rule` (`when`, `unless`, `let`, `test`, `from $view`, `then`, `overrides $rule`, `supersedes $wire`), `constraint` (a pattern that must never hold, reported by `check` with a message) and `method` (procedures: `task`, applicability conditions, `require`/`forbid`/`require-test` with reason strings, ordered `step`, `do` sub-tasks, `add`/`remove`/`set` effects). Query wire types: `find`, `group` (count, sum, min, max, avg), `assume` (hypothetical world, nestable), `plan` (expands methods, returns steps or `BLOCKED` with the failing requirement), `check`, `answer`. Statements are exactly three terms.

**Engine.** Dictionary-encoded triples with per-relation indexes and copy-on-write forks; a dependency cone so only needed relations are saturated; trigger-indexed semi-naive evaluation; greedy join ordering; stratification of negation, aggregation and `overrides` on relation names; `lift` rewrites families of ground rules that differ only in constants into one template plus a parameter table.

**LLM experiment** (`experiment/`, a fictional 980-word aquaculture handbook; isolation protocol: the compiler never saw the questions, the updater never saw the old text, the querier never saw the manual). Three independent Sonnet compilations produced 52 to 59 wires and 22 to 25 rules. 12 compound what-if scenarios times 6 questions = 72 answers per run: symbolic r1 72/72, r2 71/72, r3 72/72 (215 of 216); Sonnet reading the text directly 72/72 twice (144 of 144) (`node test/grade-compound.mjs`, re-run). The single symbolic miss (r2, scenario S04.e) was a query-writing error: `set ilse responsible-for t3` on a relation oriented person-to-tank deleted Ilse's other tanks. A differential test of the three independent compilations against a reference KB over 300 random scenarios gave 5,100 of 5,100 probe agreements for each (`node test/difftest.mjs 300 7`). Update was non-monotone and handled correctly (`supersedes`, `overrides`).

**Scale** (`bench/results/results.jsonl`): at 100,000 entities and 10,508 rules adding a fact in a hypothetical world costs 30.9 ms in the full configuration against 29,424.5 ms for the naive algorithm; but a `set` (retraction and re-derivation) costs 870.5 ms and a point query 1,079 ms against 10 ms for the naive algorithm, because the dependency cone selects relations, not entities (magic sets are the missing piece). Incremental continuation is evidenced for additions only: 150 worlds, 1,200 answers identical, 125 incremental continuations (re-run here).

**Caveats the authors state:** the pilot shows the chain works end to end, not that it beats a long-context LLM (at 980 words the LLM was perfect); only three runs; clean text written by the language's author; the compiler LLM saw the vocabulary (ChatSOP's small formalizer must not); three-term statements only, no time, no uncertainty, no explicit negation. Follow-up experiments E1 to E6 (real text of 20 to 60 thousand words, RAG comparison, accumulation of amendments) were not run.

### 2.3 E10 (`sop_reasoner_e10.zip`, sop-verified-reasoner 0.3.0, experiments E00 to E10)

**Essence.** An exact reasoner that accumulates verified "skills" offline and applies them online, never letting a learned component decide truth. The engine is **bottom-up, set-valued, function-free Datalog with stratified negation** (SCC scheduling, semi-naive deltas, hash indexes, greedy join ordering, magic-set demand rewriting). It is not Prolog-like and has no tabling; the closest relative of SLG is its demand rewriting. Dialect: `@name facts|rule|all|any|query`, uppercase keywords (`FACT`, `FACT NOT`, `WHEN`, `AND`, `NONE`, `TEST`, `OR`, `THEN`, `GIVES`), no parentheses, no commas.

**Algorithm essence.** Slice the program from the goal; optionally inline; apply magic-set demand (adornments b/f, falls back when negation is in the slice or past 512 adorned variants); schedule SCCs; per recursive SCC run semi-naive. Budgets (`maxWork` candidate visits, `maxDerived`, `maxMs`) produce `INCOMPLETE`, never an empty "no". Transformations carry certificates (`positive-demand-transform-v1`, `horn-resolution-lemma-v1`, `unique-definition-inline-v1`, `pareto-2d-antijoin-v1`, `existential-variable-quotient-v1`). The "mathematics" is constructive preservation arguments plus an independent nested-loop reference evaluator and hand-written SQLite SQL; no proof assistant and, importantly, **no comparison with SWI-Prolog or any real Datalog engine**.

**Dreaming.** `EpisodeJournal` records episodes; `Dreamer.consolidate` replays them offline, asks inventors for candidate transformations, verifies each against the reference on held-out programs and promotes or rejects; `SkillComposer` picks the best subset into a frozen deployment plan; online `reason()` only loads promoted plans. Empirical invariants (functional dependencies) stay advisory and never prune.

**Evidence.** Main benchmark (14 families times 3 held-out seeds): 220 runs complete and exactly correct, 23 explicit INCOMPLETE, 9 not applicable, zero wrong answers among complete runs (`results/benchmark.json`). Transfer (`results/e10.json`): skills learned on worlds of 327, 397 and 467 facts, frozen, then deployed on a 106,800-fact world: `reach` INCOMPLETE at 300,001 probes becomes COMPLETE at 167; `visible` 25,002 to 3 probes; `eligible` 251,000 to 1,001; `pareto` 1,623,600 to 2,700. In wall clock the gains are 2x to 9x, not the 100x to 8,000x of the probe counts: `visible` 204 to 101 ms, `eligible` 198 to 103 ms, `pareto` 878 to 101.5 ms, `reach` 608 ms (INCOMPLETE) to 114 ms. Of the 18 promoted records, 6 are advisory invariants and 4 are deployment plans; the distinct skills actually deployed are 4 known transformations, and all 4 Horn-lemma bundles were rejected. Not helpful: dense cycles, nonlinear and mutual recursion (the `verified` configuration loses to greedy there), triangles, genuinely large outputs (everything-on is slower there). The `learned` configuration has the same probes as `indexed_semi` on 10 of 13 families. SQLite, used as an independent engine, is faster than E10 on 9 of 12 families. A neural join-order ranker (9 inputs, 12 tanh units) ties the analytical heuristic (mean rank 1.0 against 1.0; lexical order 5.5; random 3.5) (`results/neural-rankers.json`), matching earlier negative results for neural quotients (0/3 exact despite ~98% accuracy, E03). 202 of 202 tests and 20 of 20 SOP regressions pass.

### 2.4 VRC (`vrc03r.zip`, sop-vrc-reasoner 0.3.0)

**Essence.** "Verified representation compilation": an experimental strategy with four parts: a finite relational reasoner (fixpoint, relevance slicing, one narrow reachability template), an exact-rational compiler that compresses numeric planning states into a certified smaller encoding, a bounded BFS planner over compressed states, and a registry of certified artefacts with offline dreaming. Dialect: `claim`, `all`/`any`, `rule`, `goal`, `reduce`, `coverage` (explicit closed-world scope; absence without coverage yields UNKNOWN), `transition` (`STATE`, `NEXT` polynomials, `GUARD`), `plan` (`MODE-GOAL`, `START-MODE`, `GOAL`, `MAX-DEPTH`).

**Evidence and honesty points.** Exact planning (`results/v03/handover-experiment.json`): energy world 25 to 5 coordinates, 68,726 to 6,313 distinct states, 1,933 ms to 49 ms (39.5x); product world 144,799 to 264 states (1,719.7x); a guard-rich negative control 111 to 111 states (0.96x, a loss). Cold ratios including preparation are 1.92x, 6.50x and 0.17x. Dreaming (`results/dreaming.json`): 14.2x per task on 12 held-out tasks, 2.62x over the whole series including accumulation and the dream pass. Validation is its own differential testing: 4,764 worlds and 14,288 runs with 0 differences, 160 planning worlds identical, 141 plans replayed exactly. **VRC itself never compared against SWI-Prolog** (`results/external.json`: all 9 cases SKIPPED, swipl missing). The gap is partly closed here: its nine `.pl` exports run under ChatSOP's private SWI-Prolog 9.0.4 (aarch64) and the row counts (149, 299, 100, 151, 9, 100, 74, 2,491, 2,500) equal VRC's own `answers` in `results/published/benchmarks.json` for all nine cases; the timings come from different machines and are not comparable. The "million-rule" case is one million background facts and about 1,003 rules; the large graph speed-ups (17x to 1,382x) come from a demand-directed reachability template (a native closure with a witness path, section 7), not from VRC's compression, and hold on 5 of 13 cases; the other cases show 1.0x to 1.26x. Budget overruns are a distinct status `BUDGET`, "never a negative answer"; `UNKNOWN`, `NO_MODEL` and `APPROXIMATE` are likewise distinct. 113 of 113 tests pass.

### 2.5 `advanced_research.md` (48 research cards R01 to R48)

Written in Romanian; it is the roadmap of VRC itself, not a catalogue of alternative reasoning strategies. All 48 cards are PLANNED research and verification directions for extending or validating VRC (groups A to H, stages 0 to 4, priorities P0 to P3). Tabling, Soufflé, CSP/SMT, external planners and abductive solvers appear only as comparators inside cards (mainly R02, R27, R38, R42); there is no card for top-down tabling, bottom-up Datalog, SAT/SMT/CP, ASP or argumentation as strategies. This proposal therefore reuses the cards that are strategy-neutral and adds a strategy-family comparison plan of its own (section 12). Its own rules are worth adopting verbatim: an exhausted budget, a missing comparator or a missing certificate gives INCONCLUSIVE, never "impossible"; thresholds are frozen before measurement; failed attempts and preparation costs stay in the totals; cold and warm costs are reported separately.

### 2.6 What the evidence jointly says

0. **The four experiments are one project lineage** (the same authors, the same family of dialects and ideas, the same style of synthetic workloads). That they converge is consistency of one design, not independent confirmation of it; the proposal treats them as sources of ideas and of reusable code, and every claim that matters is re-checked by the smoke suite or listed as not validated (section 9.3).
1. Everyone converged on the same shape: facts, rules, queries as named wires, `?variables`, `$references`, no parentheses or commas, explicit negation separate from absence, stratification, proof DAGs, explicit budgets with a non-negative incomplete status. That is the core.
2. Nobody validated against a mature engine on timings. E10 used its own reference evaluator and SQLite; VRC skipped SWI (its exports agree on row counts only). The only external controls in the whole set are that ChatSOP has private SWI 9.0.4 and Z3 4.15.8 binaries. A fair comparison is therefore new work (section 12).
3. The LLM-compiles-source loop was demonstrated only on a tiny clean fictional text, where the LLM alone was also perfect. The value claim (auditable answers, knowledge larger than context, many hypothetical worlds, cheap updates) is untested at scale.
4. Learned components (neural join order, neural quotients, learned guides) tied or barely beat simple heuristics wherever they were tested. The robust learned artefacts are symbolic: verified plans, lemmas, compressed encodings, promoted offline and checked.
5. Strategies differ enormously by problem class: demand rewriting helped `reach` by thousands of probes and hurt dense recursion; VRC compression helped two planning worlds by 39x to 1,720x and lost on a guard-rich control; SQLite beat E10 on 9 of 12 families. That is the case for routing (section 10).


### 2.7 The inventory of the zips: what lies below the high-level description

A separate inventory went one level down: one entry for every algorithm or mechanism found in the unpacked zips (57 entries: 18 from E10 including its Python history E00 to E07, 13 from soplab, 15 from VRC, 11 from sop-r), each with evidence checked against the saved results files and logs rather than the READMEs, and graded `strong` (reproduced here or exact-correctness against an independent comparator; a facade over other components is never graded strong), `moderate` (reproducible internal evidence with the authors' own baseline), `weak` (synthetic setup, hidden structure in the supplied language, ties or losses against the simple comparator, one run) or `none` (design text only). What was re-run here: soplab 23 of 23 tests, E10 202 of 202, VRC 113 of 113, sop-r incremental test 1,200 of 1,200 answers identical and difftest 20 scenarios with 340 probe agreements and 0 disagreements (the published figure is 300 scenarios and 5,100 probes), and VRC's nine exported `.pl` programs under the private SWI-Prolog 9.0.4 (row counts equal VRC's own answers). The Python history experiments E00 to E07 were not re-run (they need PyTorch and SymPy and nothing may be installed); their numbers are quoted from their saved reports. Counts by kind: inference engine or optimisation 11, search or planning 7, representation learning or compression 8, offline consolidation ("dreaming") 9, neural proposer with mandatory verification 2, other (interfaces, router features, validation methods, containment, design notes) 20. Evidence: strong 2, moderate 21, weak 21, none 13 (V01 regraded in round 3).

The 57-entry table (id, entry, kind, role for ChatSOP, evidence grade) is **Appendix E**.

What the inventory changed in this proposal, by priority for the owner's goal (wires usable by every strategy; a symbolic LLM over a large memory):

- **Core and interface, applied:** the corrections to the evidence numbers above (2.2 to 2.4); the packet fields `guarantee`, `bound`, `witness {replayed, verified}`, phase timings, `blocked_by` (5.3); the statuses `approximate`, `stale` and `no_model` as non-negative outcomes (5.3); `fork(handle)` with a three-operation delta (`add`, `remove`, `set` with a declared `key`) and a flag whether a world continues incrementally (5.2); the `isolation` capability (5.1); the `prepare` options `learning off|reuse|on-demand`, `arithmetic exact|float64`, `shadow` (5.2); the acceptance rule for learned artefacts, re-certify on load, replay positive witnesses in the original rules, shadow on small tasks, revoke on disagreement (5.6); the budget key `maxFanout` (6); advisory `predicate` hints `transitive` and `inverse` (4.3); a `message` reason string on a norm, the returned reason of sop-r's `BLOCKED` (8.2); `abduce` returns all inclusion-minimal explanations (4.4).
- **Strategies and router, applied:** `sql-sqlite` and `golog-swi` added to section 7; `dreaming-session` defined concretely with four records (5.6); the native closure template as a router rule, not a strategy (10.2); `worlds-sopr` gated by the 1,200-answer incremental test plus a nonmonotone case (7).
- **Wires, offered as extensions rather than core:** the `call provider args` leaf with a declared mode, determinism and a budget share (E1, 4.3); the numeric `action` extension (`state`, `next` over rationals, `guard`, `observe`, `horizon`) with a `rational` term type, needed before VRC can be wired (E2, 4.3); optional `context` wire; `examples` wire for induction; `constraint task count`; a semiring `closure` wire. These are listed in the plan (12) and the backlog (Appendix D), not in the core, because no experiment shows them paying for themselves on the product's questions.
- **Smoke cases:** twenty proposed cases N01 to N20 are in the backlog (Appendix D); the ones that coincide with cases written in round 2 are mapped there (N07 with `10d`, N13 with `14a`, N17 with `30b`).

## 3. Design principles

1. **Core plus sugar.** The core is the smallest set every serious strategy can consume. Convenient notions (defaults, integrity constraints) are defined as mechanical rewrites into the core, and that desugared program is the normative semantics of the sugar, so that no strategy has to implement them natively and every strategy gets them for free if it has negation as failure. A native implementation (for example ASP defaults) is accepted only if it agrees in shadow with the desugared one on stratified programs.
2. **Capabilities, not levels.** A strategy declares which features it supports. The harness and the router read the declaration; a circuit that needs more is `not_expressible`. Nothing is weakened or dropped (this already is ChatSOP's rule: "a required but unknown theory yields unsupported").
3. **Two negations, never confused.** `not p` is explicit negative evidence. `absent p` is failure to derive `p`, allowed only for a predicate declared closed. Absence of evidence is `unknown`, not false.
4. **Answers carry their epistemic status.** `supported`, `refuted`, `both`, `unknown`, plus `conditional` (per row: the assumptions, suppositions, reported claims and proposed wires that row rests on, verified by a run), plus `complete` and the claims used (one sufficient support set). Budget exhaustion is its own status.
5. **Fit the existing conventions.** `@id type`, exactly two spaces before a field keyword, one keyword per line, whitespace-separated terms, JSON-quoted text, `all`/`any`/`end` groups, closed role inventory on the model surface. Words, not operators, on every surface an LLM writes (`above`, `at_least`, `plus`, `times`).
6. **Two surfaces that meet at the host.** The small model (SymbolicLM) writes only `stated`, `assumed`, `unclear`, `query`, `constraint`, `unparsed` as strings with no context. Coding agents write the richer knowledge wires from sources. The host links strings to knowledge, picks a strategy, runs it and renders the answer.
7. **Reads do not hide writes; requested backends are not substituted** (AGENTS.md rules 7 and 8, unchanged).
8. **A partial view never proves absence.** Negation as failure, aggregates, counts and universal answers are valid only over predicates that are declared closed and fully retrieved for the relevant keys (for a derived predicate: every rule of it, recursively); a default conclusion is valid only when the strict contrary and the exception atoms were looked up for its keys (retrieval completeness, not closedness); otherwise the answer is withheld, widened or reported incomplete (section 11.6).
9. **Modes of work help and restrict.** Approved procedures and norms are knowledge the engine acts by: it optimises inside them and may not leave them. They are named, versioned, addressable objects with an approval state, and a change to them is an amendment negotiated with the user and approved by the host, never an engine decision (section 8).


---

## 4. The wire types

### 4.1 Lexical conventions (inherited, extended)

```
@name type            # header at column one; name = letter, then letters, digits, underscore
  keyword value...    # exactly two leading spaces; one keyword per line
  where all           # a group opens with all or any and closes with end at the field indentation
    p ?x
    q ?x
  end
```

Terms in an atom: a lowercase symbol (`paris`), a safe integer (`120`; money is in cents, time in minutes, no floats), a JSON-quoted string (`"Alpha Lab"`), a `?variable`, or a `$ref` to another wire's value. An atom is `[not |absent ]predicate term...` with **zero to six terms** (round 1 allowed one to four; arity 0 lets `then alarm_on` and a state flag such as `business_hours` be written without a dummy constant; the model surface keeps its closed role inventory and is unchanged). Predicates are lowercase symbols; **the id of a `predicate` wire is the relation name** (the one convention added). Comments start with `#` at the beginning of a line.

**Namespace.** Wire ids and relation names share one namespace, so a fact cannot be given the id of a predicate (the validator rejects the duplicate); by convention facts are `f...`, rules `r_...`, norms and methods carry verbs. Ids and predicates starting with `x_` are reserved for wires generated by desugaring (`x_<id>_blocked`); an author id with that prefix is an error (`reserved_prefix`).

### 4.2 Semantics shared by all wires

1. **Finite, function-free, set semantics.** Terms are constants; rules do not construct new terms; duplicate derivations collapse. `compute` produces integers only from bound integers and is forbidden inside a recursive cycle (so evaluation terminates); `divided_by` is integer division truncating toward zero, a zero divisor makes the body false for that binding (the packet notes `arithmetic_undefined`), and a constant zero divisor is a validator error. Ordering comparisons (`above below at_least at_most`) need integer or time operands; applying them to a variable declared `entity` or `text` is rejected (`compare_on_entity`); `equal` and `not_equal` work on any type. A count counts distinct bindings of all variables of the counted group (two people with the same salary count twice because the person is in the group).
2. **Truth of a ground atom: two independent evidence derivations.** For a ground atom `p a` the engine derives *positive evidence* P (`p a` is derivable) and *negative evidence* N (`not p a` is derivable) independently, as in Belnap's four-valued logic (Belnap 1977) and in extended logic programs with a second negation (Przymusinski 1988). Status: `supported` (P only), `refuted` (N only), `both` (P and N), `unknown` (neither). **`both` is a reported status, not a state that stops propagation.** A rule body `p a` is satisfied by P regardless of N, and a body `not p a` is satisfied by N regardless of P. Two consequences: (i) evidence is monotone, so adding a fact never retracts a derived atom and the partial-retrieval rule R-P1 (section 11.6) holds, which is what makes it safe to answer from a partial slice; (ii) a conflict stays local and visible: atoms derived from a contradictory atom are themselves reported with their own P and N, nothing unrelated becomes derivable (no explosion). The rejected alternative, "a conflict blocks propagation", is non-monotone (retrieving one more `not p a` would retract every conclusion derived from `p a`) and would have forced every widening step to treat negative facts as completeness-sensitive. `absent p a` over a closed predicate is true when P is not derivable (N is irrelevant).
3. **Stratification.** Negation as failure, exceptions and aggregates may not occur in a cycle of the predicate dependency graph (the validator reports `not_stratifiable`). The check is conservative: it works on relation names and ignores polarity. This is the semantic common denominator of Datalog, tabled Prolog and ASP: on stratified programs all agree (Apt, Blair, Walker 1988; Van Gelder, Ross, Schlipf 1991; Gelfond and Lifschitz 1988). Recursive aggregation is excluded (a known limit; the monotone-aggregate extensions of Ross and Sagiv 1992 are not adopted); shortest-path and path-counting questions on cyclic graphs are planning or closure questions (7, Appendix D).
4. **`closed` for base and for derived predicates.** `closed true` on a base predicate says the retained view holds every fact of it. Closedness is declared by a host review step, never inferred (14.3). For a **derived** predicate `p`, `absent p` is valid only if the view is complete for it: `complete_for_view(p, keys)` is true when (a) `rulesFor(p).complete` (every rule with head `p` is in the slice) and (b) for every such rule and every body predicate `q`, `complete_for_view(q, keys')` where `keys'` are the argument values that flow into `q` (the demand adornment of magic sets); for a base predicate it is `closed` plus `lookup(...).complete` for those keys; for a recursive predicate the demand set is computed as a fixpoint over the finitely many (predicate, bound-argument pattern) pairs. If no argument flows into `q` (the demand adornment of `q` has no bound position, for example `absent reach ?x ?y` with both unbound), whole-predicate completeness is required for `q`, not completeness for keys. The validator, given the retrieval manifest, flags `absent` over a derived predicate whose rule set is not entirely in the slice (`absent_over_incomplete_rules`); smoke case `23` is a recursive closed predicate whose first slice holds one of its two rules.

   **Default conclusions are completeness-sensitive too.** A newly retrieved strict contrary (`not flies a`) or exception atom retracts a default conclusion, so by the letter of this item no default could yield an accepted answer unless its head predicate were closed. The rule: (a) R-P1's "without negation as failure" is judged on the *desugared* program (4.3), so a default conclusion, which desugars into `absent x_*_blocked`, falls under R-P2, not R-P1; (b) for the generated `x_strict_<p>_neg` and `x_<d>_blocked` predicates and for the bodies of the exceptions, completeness is **retrieval completeness for the keys** (`lookup(not p, keys).complete`, `rulesFor(contrary).complete`, and a keyed lookup of each `except` predicate), not world closedness: the head predicate `p` need not be declared `closed` (the author of `flies` cannot say that all fliers are listed, only that the retrieval looked for the contrary of each candidate); (c) before accepting a default-derived row, widening performs the keyed lookups of `not p a` and of the exception atoms for each candidate `a`; (d) the same keyed completeness applies to the bodies of a strict contrary *rule* (`when penguin ?x then not flies ?x`): the body predicates (`penguin`) need a keyed lookup for each candidate, and item 4's recursion applies to those bodies, with retrieval completeness at the leaves; (e) "the contrary body does not depend on any default conclusion" (4.3, default rule 1) is tested on predicate names (a predicate depends on a default conclusion if any default heads it or any rule for it has a body predicate that does), conservatively. Smoke case `24` is the retrieval case: the strict `not flies pingu` is stored behind 300 look-alike negatives, the first slice's default concludes `flies pingu`, the host withholds it, the keyed lookup finds the contrary, and the answer is `tweety` only.
5. **Aggregates, counts and `every` need closed predicates.** The validator warns `aggregate_needs_closed`, `count_needs_closed`, `every_needs_closed_scope` (the quantification domain is the `where` part of `every`) when the predicates they range over are not declared closed. The host's rule for the result over an open predicate: a count is a **lower bound** (`bound at_least`, the retrieval view may be complete but the world is open); an `every` with no counterexample over an open domain is `unknown` (reason `open_domain`), a counterexample still refutes (monotone). Cases `07d`, `08d` (and `07a`, `08a` with the predicates closed).
6. **Epistemic status and conditional answers.** A fact's status is `observed` (default), `reported` (with `speaker`), `hedged`, `supposed`. Everything but `observed`, and every governed wire that is `proposed` or `rejected` and is supposed by an `if`, is an **assumption** (a `contested` wire binds, flagged: 8.3). Strategies need not know about assumptions; the host computes `conditional` **per row** (the renderer says "Ann, if she works there, and Bob"; the packet's list is the union of the rows' lists). For each row of the full answer (for an answer without rows, the answer itself):
   1. *leave-one-out*: S is the set of assumptions whose removal alone makes the row disappear (or the answer change);
   2. *verification*: run the strategy once more on the observed facts plus S only (every other assumption removed). If the row still holds, S is **exact** and the row is conditional on S (an empty S with a passing verification means unconditional). "Exact" means: for a program whose dependence on the assumptions is **monotone**, a passing verification proves that S is the *unique minimal* set (every assumption in S is needed, and S suffices); under negation as failure the verification establishes **sufficiency only** (a smaller or different set might also suffice, and an assumption outside S can remove the row), and the packet's `nonmonotone` flag must be set;
   3. if the verification fails, leave-one-out was not exact: the row is conditional on **all** assumptions and carries `conditional_unknown: true` (a sound, non-minimal list; the minimal sufficient set is not unique, and a greedy growth of S would pick one of them, which the host does not pretend is canonical).

   Leave-one-out alone is **not** exact even for monotone programs: with facts a, b, c supposed and a row derivable iff c and (a or b), removing a leaves the row, removing b leaves the row, removing c drops it, so the list would be [c], yet "if c" is wrong when neither a nor b holds (case `10f`; the verification run with c alone loses the row). Redundant assumptions (two suppositions of the same claim, case `10e`) are the same phenomenon. Under negation as failure the effect of an assumption can be to remove a row, so if a row of the observed-only run is absent from the full run the packet says `nonmonotone: true` (the renderer must not say "and also"; case `10d`). Conditional answers are never promoted to evidence or stored. Cases `10b` to `10f`, `14b`.
7. **Time (snapshot semantics).** A fact has `valid timeless` (default; the whole line) or `valid START END` (ISO date or timestamp, `beginning`, `open`; start inclusive, end exclusive). At an instant `t` a stored fact holds iff its interval contains `t`; **a derived atom holds at `t` iff some rule instance has its whole body holding at that same `t`**, so a derived atom's validity is the intersection of its body facts' intervals (computed by partitioning at the endpoints of the facts in the slice). Query time words: `at t` (one instant); `during S E` means **throughout**, for every instant of `[S, E)`; `overlaps S E` means at some instant of `[S, E)` (rows keep their own validity); `asof D` is the knowledge known at `D` (facts by their memory `known_at` metadata, governed wires by `approved_at`, section 8.3). Time variables: the leaves `start_of ?t ATOM` and `end_of ?t ATOM` bind the start or end instant of a stored fact's validity (base predicates only; `time_leaf_on_derived` otherwise) and `order ?t1 before ?t2` compares them. Cases `12a` to `12f`; the lowering is in 7.1.

   **Combination of interval answers.** The point query is run once per part of the partition of `[S, E)` at the endpoints of the slice's facts; the parts are combined as follows. The sentinels order as `beginning` < every instant < `open`, so a fact valid `beginning open` covers every part and an interval ending at `open` is never shorter than one ending at a date.

   | answer | under `during` (throughout) | under `overlaps` |
   | --- | --- | --- |
   | `select` | the rows present in every part | the union of the rows, each with its validity (the union of its parts) |
   | `count` | the number of rows present in every part (case `12g`) | not specified (counts of what: rows or row-instants); the host answers `not_expressible` |
   | `every` | holds when it holds in every part | not specified; `not_expressible` |

   Case `12b` was **rewritten in round 2** from `during` to `overlaps`: in round 1 `during` meant "some instant of the interval", which is the current runtime's meaning. The product adapter maps the proposal's `overlaps` to the current runtime's `during` and answers `not_expressible` for the proposal's `during` (throughout), so that the old word never silently changes meaning.

8. **Planning state.** A planner state is polarity-explicit unless the fluent predicate is declared closed: with no evidence a precondition is unsatisfied (unknown is not true); with a closed fluent the state is a set of atoms and `requires not p` means `p` is absent. This is stated, not left to each planner (round 1 lowered planning silently to a closed world).
9. **Defaults and norms rely on the core.** Their meaning is the desugared program (4.3, 8.3); `fire`, not `applies`, is what blocks.

### 4.3 Knowledge wire types (the surface coding agents write)

Each entry gives the essence, the fields, an example and the check the validator makes. Existing wires are marked (existing) when only a small extension is proposed. The full grammar, generated from the validator, is in Appendix A.

**`predicate`** (existing, extended). Declares a relation: `args` as `role:type` entries (types `entity integer text time value`, roles from the closed inventory `subject object recipient location source destination instrument time topic`, at most one argument per role; `args none` for arity 0), `closed true|false` (default false), optional `key` (an argument position; a **lint**: two facts with the same key and different remainders and no validity intervals give the warning `key_violation`, nothing is blocked), advisory routing hints `transitive true` (arity 2) and `inverse p`, and `unit`. The roles are the **role-to-position bridge between the two surfaces**: SymbolicLM emits `role subject "Ann"` and `role object "Alpha Lab"`; the host lexicon stores only word to predicate (`"work at"` to `works_at`), and the predicate's declaration says which position is the subject and which the object. The validator checks every fact and every constant of a rule against the declared types (`type_mismatch`), so an argument-orientation slip is caught when the knowledge is written; this answers the single error of the sop-r pilot (`set ilse responsible-for t3` on a relation oriented person to tank).

```
@blocked predicate
  args subject:entity
  closed true
@salary predicate
  args subject:entity topic:entity object:integer
```

**`fact`** (existing, extended). One ground claim: `holds [not ]predicate term...`, `valid` (optional, default `timeless`; today required), `status`, `speaker`, `source`, `quote`.

```
@f1 fact
  holds works_at ann alpha
  valid 2020-01-01 2023-01-01
  source "HR export p.3"
```

**`rule`** (existing, extended). Definite implication. `when` repeats (conjunction) or holds an `all`/`any` group; condition leaves are atoms, `not` atoms, `absent` atoms, `compare A WORD B` (`above below at_least at_most equal not_equal`), `compute ?v A WORD B` (`plus minus times divided_by`, integer result), `start_of ?t ATOM`, `end_of ?t ATOM` and `order ?t1 WORD ?t2` (`before after same_time`). `then` is one atom, possibly negative (`then not flies ?x`, possibly with no terms: `then alarm_on`). `mode causal` marks a rule usable by counterfactual simulation. Governed (8.2). Checks: head variables occur in a positive body atom (`unsafe_head`); variables under `absent`, `compare`, `compute` are bound (`unsafe_negation`, `unsafe_variable`); `absent` only on a closed predicate (`absent_needs_closed`); stratification.

```
@r_total rule
  when order_line ?o ?q ?p
  when compute ?t ?q times ?p
  then line_total ?o ?t
```

**`default`** (new, sugar). A defeasible rule: `when`, `then`, `except` (repeatable; each is a condition group; the default does not apply where any holds), `priority` (integer, default 0) and `overrides $default` (repeatable). Governed. Semantics, in order of strength:

1. **Strict knowledge sits below every default.** If the contrary of the head (the explicit negative fact `not flies tweety`, or a rule with the contrary head whose body does not depend on any default conclusion, tested on predicate names, 4.2 item 4) is derivable, the default is blocked: the answer is `refuted`, not `both` (case `09d`). Only contraries derived from defaults go through the next two rules. Because a newly retrieved strict contrary retracts the conclusion, the generated strict-contrary and blocked predicates need retrieval completeness for the keys before a default-derived row is accepted (4.2 item 4, case `24`).
2. **`overrides $other`** says that when this default FIRES for some arguments, the other default is blocked for the same arguments; the two heads must be contrary atoms of one predicate (`overrides_not_contrary`), and the override graph must be acyclic (`overrides_cycle`). `priority` is sugar for a set of `overrides`: a higher priority overrides every lower-priority default with a contrary head. Global integers do not compose across chapters compiled by different agents; `overrides` is the form to prefer.
3. **Blocking is by FIRE, not by `applies`.** A default that applies but is itself blocked by its own exception does not override anything (case `09e`: nixon is exempt from the republican default, so the quaker default still concludes pacifist).
4. Two defaults of equal strength with contrary conclusions both fire: the answer is `both` (the classical *Nixon diamond*, case `09b`), never a silent pick. Where one default overrides the other the conflict is resolved (case `09c`, a resolved conflict, which is not a Nixon diamond and is named accordingly).

```
@birds_fly default
  when bird ?x
  then flies ?x
  except penguin ?x
  priority 1
```

Desugaring (executed by `eval/smoke-reasoning/lib/desugar.mjs`, and the desugared program is itself validated for every case): an `applies` rule (the body); one `blocked` rule per exception; one `blocked` rule from the strict contrary (clones of the strict contrary facts and strict rules into `x_strict_<p>_neg`); one `blocked` rule per overriding default (`when x_o_fired ?v1 then x_d_blocked ?v1`); a `fired` rule (`when applies, when absent blocked, then x_d_fired`); and a conclusion rule (`when x_d_fired then head`). The generated `blocked` predicate is closed *within the desugared program*; whether the retrieval that fed it was complete for the keys is the host's guard (4.2 item 4, 11.6). Output for the resolved-conflict case `09c`:

```
@x_d_quaker_applies rule              @x_d_republican_applies rule
  when quaker ?x                        when republican ?x
  then x_d_quaker_applies ?x            then x_d_republican_applies ?x
@x_d_quaker_overridden_by_d_republican rule
  when x_d_republican_fired ?v1
  then x_d_quaker_blocked ?v1
@x_d_quaker_fire rule                 @x_d_republican_fire rule
  when x_d_quaker_applies ?x            when x_d_republican_applies ?x
  when absent x_d_quaker_blocked ?x     when absent x_d_republican_blocked ?x
  then x_d_quaker_fired ?x              then x_d_republican_fired ?x
@x_d_quaker_conclude rule             @x_d_republican_conclude rule
  when x_d_quaker_fired ?x              when x_d_republican_fired ?x
  then pacifist ?x                      then not pacifist ?x
```

This is the standard translation of prioritised defaults into stratified negation as failure (compare Reiter 1980 defaults and Nute's defeasible logic, Nute 1994; the priority-by-blocking scheme is the usual compilation). Limitation: priorities or overrides that depend on derived conclusions can create cycles through negation; the validator checks the desugared program, not the sugar, and reports `not_stratifiable`.

**`integrity`** (new, sugar). A pattern that must never hold **in a state**: `never` (group), `witness ?v`, `message`, `severity`. Each match derives `violation ID WITNESS` (arity 2) and nothing else: violations are data, the rest of the knowledge stays usable, nothing explodes. Desugars to one rule. It is deliberately never a hard assertion in any strategy (a hard Z3 assertion or an ASP integrity constraint would make a theory containing the violation inconsistent). Constraints on what may be *done* (actions, deadlines, trajectories) are norms (8.2). Integrity over the whole memory cannot be checked per query slice: it is checked at ingestion time (a trigger index by predicate, 5.5) or offline.

```
@no_double_booking integrity
  never all
    booked ?r ?s ?a
    booked ?r ?s ?b
    compare ?a not_equal ?b
  end
  witness ?r
  message "a room has two bookings in one slot"
```

**`aggregate`** (new, core). Defines a derived relation by grouping: `over` (a group), `group` (variables), exactly one of `count`, `sum`, `min`, `max`, `collect` in the form `?field as ?out` (`count as ?n` or `count ?e as ?n`), and `yields` (the derived atom over the group variables and `?out`). The rows of `over` are the distinct bindings of all variables occurring in it. An aggregate sits in a lower stratum than its consumers and may not occur in a cycle; the predicates in `over` should be closed (warning otherwise, 4.2 item 5). Example `07b`: `sum ?s as ?total` grouped by department yields `dept_payroll dev 310` and `ops 175`.

```
@payroll aggregate
  over salary ?p ?d ?s
  group ?d
  sum ?s as ?total
  yields dept_payroll ?d ?total
```

**`constraint`** (existing, words-only). Finite or numeric arithmetic: `var ?x int [MIN MAX]`, `require ?x plus ?y equal 10`, `claim`, `objective`, `direction min|max`, `task prove|possible|optimize`, `select`, `unit`. Results: `entailed`, `possible`, `impossible`, `inconsistent`, `optimal`, `feasible_bound`. Mixed relational-and-numeric problems stay a two-stage circuit (a query feeds a constraint through `$q`), as today, unless the provider leaf (E1 below) is adopted.

**`action`** (existing, governed in round 3). STRIPS transition: `params`, `requires` (atoms, may be negative), `adds`, `removes`, `cost`, and the governance fields of 8.2: an action's preconditions and effects come from the manual and are amended like methods (a new version `supersedes` the old; `asof` selects the version in force), and an action that took part in a plan or a conformance check appears in `used` with its version. **`goal`** (existing): `where` group. Planning is requested by `query mode plan`; state semantics are in 4.2 item 8. When no plan exists the answer says why whenever something can be named: `blocked` with `blocked_by` (the norm or the unmet requirement), or `budget_exhausted` with a `reason` when a bound was hit (6); `no_plan` is used only when nothing can be named, the search having completed over a closed, fully retrieved problem (R-P2, 11.6).

**`method`** (new, extended in round 2; see 8.2 for the full step grammar). Procedural knowledge from manuals: `achieves` (task atom), `when` (guard), `step` lines (a primitive `~action term...`, a sub-task atom, `achieve atom`, `optional ...`, and the blocks `choose`, `any_order`, `if ... else ... end`, `until ... max N`, `pick`), `prefer`, `on_failure`, `binding strict|advisory`, `cost` and the governance fields. A method keeps the author's structure and order (HTN-style decomposition); the actions give each step preconditions and effects so a state-space planner can reach the same plan without the method and can check it.

**`norm`, `procedure`, `amendment`, `argument`, `trace`** (new, round 2): section 8.2.

**`hypothesis`** (existing, extended). A candidate assumption (`holds` or `assume`, `cost`) for abduction; `waive $norm` offers the relaxation of a norm as a hypothesis (8.4). Never evidence. **`policy`** (existing, extended): budget limits only tighten the host's; `effort quick|normal|deep`, `partial allow|forbid` (section 6); the modes in force and the objective (8.2).

**Extension E1: the `call` provider leaf.** soplab's binding providers (`CALL provider args`, with built-ins `range` and `member`) plug an external relation into a rule body. The proposal offers the same as an optional condition leaf `call PROVIDER arg...` with a declared mode (which arguments must be bound), determinism and a share of the budget; it would let `z3-lia` or `prolog-swi` answer one arithmetic or logic sub-question inside a Horn rule, which is today a two-stage circuit through `$q`. Not in the core: no experiment plugged an actual solver in, and cost accounting and error handling under budget are untested (inventory S08). **Extension E2: numeric `action`** (`state`, `next` equations over rationals, `guard`, `observe`, `horizon`) with a `rational` term type, which VRC needs before it can be wired (inventory V04, V05, V09); a plan-stage item (12), not a core wire.

### 4.4 The query surface (what SymbolicLM emits) and how the two surfaces meet

The small model's six wires do not change. `query` keeps `where` (host positional atoms, or the model's `match … end` blocks of quoted strings), `select`, `mode select|exists|count|explain|every`, `scope`, `at`, `asof`, `compare`, `order`, `rank`, `filter`, `measure`, `quantifier`, `except`, link keywords (`if`, `unless`, `because`, ...), `$q` chaining. Round 2 changes the time words (`during` is throughout, new `overlaps`, 4.2 item 7). **Five modes are added**, all declarative question forms, not operations:

- `why_not`: **the minimal sets of base (EDB) atoms, in the slice vocabulary and respecting the `predicate` types, whose addition would make the claim derivable, plus the blocking atoms** (the atoms that satisfy a `not`, an `except` or a norm that blocks it). This is abduction with a restricted hypothesis space, not an unsat core: if the claim does not hold, `theory and not claim` is satisfiable and an unsat core explains only entailed claims (round 1 had this wrong). On a planning goal it returns the blocking norm or requirement (`status blocked`, 8.4).
- `plan`: a sequence of actions reaching the `where` goal; "how do I ...". With `via ~action term...` the plan must contain the given steps.
- `abduce`: **all inclusion-minimal** explanations of the `where` observation (hypotheses may be atoms or `waive $norm`); `limit` bounds the list.
- `conform`: compliance of a performed trace (`trace $t`) with the procedures and norms in force (8.4).
- `procedure`: render the approved procedure for a task without planning, as of `asof` (8.4).

What-if is already expressible: the user's "if ..." clause is a `stated` with `certainty supposed`, linked by an `if $id` keyword on the query; `if` may also name a proposed wire or an amendment (8.5).

How the surfaces meet (the host's job, unchanged in spirit):

```
user: "If Ann worked at Alpha Lab, who works at Alpha Lab?"
SymbolicLM  ->  @s1 stated   relation "work at"  role subject "Ann"  role object "Alpha Lab"
                             polarity affirmed  certainty supposed
                @q  query    where match relation "work at" role subject ?who role object "Alpha Lab" polarity affirmed end
                             select ?who   if $s1
host links  ->  predicate works_at (declared subject:entity object:entity), entities ann and alpha
                (reviewed lexicon + dictionary); the roles place Ann and Alpha Lab in their positions;
                @s1 fact  holds works_at ann alpha  status supposed
                @q  query where works_at ?who alpha  select ?who  if $s1
host routes ->  strategy (explicit or by the router), runs it under the budget,
                packet {status supported, rows [ann (conditional [s1]), bob], conditional [s1] (the union), used [...], strategy, route reason}
renders     ->  "Ann, if she works there, and Bob."
```

The knowledge written by a coding agent from a book and the query written by SymbolicLM share only predicates and entities, which the host links by the reviewed lexicon: the model never sees identifiers (AGENTS.md "Model boundary" unchanged). Case `14b` is exactly this, minus the linking. The model surface is unchanged except for the declared query modes above.

### 4.5 What cannot fit, and the proposed changes

| Item | Today | Proposal |
| --- | --- | --- |
| `fact.valid` | required | optional, default `timeless` (friendlier for an LLM) |
| `rule.when` | atoms only | any condition group with `absent`, `compare`, `compute`, `order`, `start_of`, `end_of` |
| negation as failure | none | `absent`, only on `closed` predicates |
| atom arity | 1 to 4 terms | 0 to 6 terms for knowledge wires; the model surface keeps its roles |
| `predicate` | schema-ish | adds `closed`, role:type arguments, `key` lint, hints; id is the relation name |
| fact `status`, `speaker` | `source assumption` hack | first-class; the hack is the lowering for strategies without it |
| `conditional` | boolean | per row: the list of assumption ids, verified by a run (the packet list is the union), plus `nonmonotone` and `conditional_unknown`; `used` is one sufficient support set, with `used_incomplete` |
| `default`, `integrity`, `aggregate` | absent (a `theory dialect defeasible-default` returns unsupported) | new wires as above |
| `method`, `norm`, `procedure`, `amendment`, `argument`, `trace` | absent | new wires (section 8) |
| query modes | five | plus `why_not`, `plan`, `abduce`, `conform`, `procedure` |
| `reasoningStrategy` | `reference`/`advanced` | strategy ids with capability declarations (section 5) |
| result status for exhausted budget | `unknown`/`complete:false` | `budget_exhausted` with a `reason` (section 6) |
| `pattern`, `trace` (research wire), `theory`, `simulate`, `associate`, `induce`, `analogize` | research wires | out of scope here; kept as they are (the proposal's `trace` is a different, smaller wire; the research one is renamed or namespaced if both survive) |

The one place where the proposal cannot keep the current model surface is that a small model cannot emit `absent`: closed-world questions ("which nodes are not blocked") are answered by a rule the knowledge author wrote, or by a host-generated `absent` condition when the model's `query` carries `polarity negated` on a closed predicate; when the atom is not derivable over a **complete view** the answer is `refuted`, otherwise `unknown` (14.7).

---

### 4.6 The `jsEval` wire and where it sits

`jsEval` exists today in the runtime (`sop/parser.mjs`: `jsEval {expr}`, evaluated by `sop/runtime.mjs` through the sandboxed expression evaluator of `sop/expression.mjs`, bounded by `maxExprOps` and `maxExprBytes`). It is available to **trusted and host circuits only**; the model surface cannot author it. The proposal positions it as follows; it adds no new wire type.

- **A trusted, host-only escape hatch.** `jsEval` stays the way a host circuit computes what the core `compute` leaf cannot express (string handling, calendar arithmetic, a lookup the host owns). It is not part of the core wire set, not a knowledge wire and not in the grammar of Appendix A.
- **Opaque to the logic engines.** Prolog, Z3, Datalog, ASP and SQL cannot see inside an expression. A rule or aggregate whose truth depends on a `jsEval` is therefore `not_expressible` for those strategies, unless the host exposes it as a **`call` provider leaf** (extension E1, 4.3): the host evaluates the expression, feeds the result back as facts of a declared relation, and the strategies consume the facts. The oracle (`js-oracle`) may evaluate it directly, since it runs in the same process as the expression evaluator.
- **No LLM-authored `jsEval` from sources by default.** A coding agent that ingests a manual writes the wires of 4.3 only. A `jsEval` that arrives from a source is not accepted into memory (security and auditability: an expression is code, its effects cannot be read off the wire, and no engine can check it); a **reviewed host step** may admit one (a named reviewer, the expression stored with its source sentence and version like any governed wire). The authoring guide tells the agent not to write it unless the host marks the source as trusted code.
- **`compute` covers the common arithmetic.** The core leaf `compute ?v A plus|minus|times|divided_by B` over integers (money in cents, time in minutes, no floats, division by zero a note `arithmetic_undefined`) together with `compare`, the aggregates `count sum min max collect` and the `constraint` wire for finite and linear numeric problems cover the arithmetic of manuals and regulations (totals, thresholds, tariffs, durations). `06d` is the smoke case. What they do not cover (rounding rules, percentages with fractions, date arithmetic, string operations) is reported by the author as "not expressed" and, if the owner wants it, becomes a host provider behind the `call` leaf rather than free code in a wire.

## 5. The strategy interface

### 5.1 Capability declaration

A strategy is `{id, features, delivery, limits, guarantee, provides, budget keys it honours, prepare?, ask, check?, update?, fork?, dream?}`. Features are the same words the smoke cases list in `requires`:

`facts select open_world classical_negation conflict rules recursion conjunction exists every count explain used why_not temporal interval throughout snapshot_derived time_vars whatif epistemic_status naf closed_world closed_derived compare_in_rules compute_in_rules aggregate default overrides strict_contrary versions integrity constraint optimize plan blocked_info method htn_choice on_failure norms_hard norms_soft temporal_norms procedures procedure_render amendment check_plan abduce abduce_waive zero_arity budget budget_probes retrieval`

Routing dimensions beyond features (a router that read features alone could not choose between two strategies that support the same features):

| dimension | values | why the router needs it |
| --- | --- | --- |
| `delivery` | `slice`, `source`, `both` | a slice engine needs the retrieved wires materialised; a source engine pulls from a `FactSource` (11.3) |
| `max_wires`, `max_arity`, `integer_range` | numbers | a slice larger than the engine's input limit is split or refused before the call; Z3 and VRC have integer ranges |
| `guarantee` | `exact`, `bounded` | a bounded engine (horizon, depth, domain limit) can only say `budget_exhausted`, never a negative answer (6) |
| `provides` | `explain`, `used`, `proof`, `why_not_predicates` | which parts of the packet the strategy fills itself; the host computes `used` and `conditional` for the rest (5.3). `why_not_predicates` marks the weaker `why_not` of a Datalog demand run, which returns the unsatisfied demand predicates and not the minimal EDB atom sets |
| `determinism` | `deterministic`, `seeded` | the shadow comparison needs a fixed seed for the latter |
| `isolation` | yes, no | the strategy can run in a worker with wall and heap limits; its stop maps to `budget_exhausted` (inventory V02) |

Profiles are only shorthand for feature sets: P0 Datalog core (facts, rules, recursion, select, exists, count), P1 adds classical negation, conflict, open world, every, explain, whatif, temporal, interval, P2 adds naf, closed_world, closed_derived, compare_in_rules, compute_in_rules, aggregate, default, overrides, strict_contrary, integrity, versions, P3 adds constraint, optimize, P4 adds plan, method, abduce, why_not, blocked_info, P5 adds the modes of work (htn_choice, on_failure, norms_hard, norms_soft, temporal_norms, procedures, procedure_render, amendment, check_plan, abduce_waive). A strategy may support any subset.

### 5.2 Calls

```
prepare(theory, options) -> handle        optional; may take a long time ("dreaming", indexing, compilation);
                                          may run offline; must not change answers; reports its own cost
                                          options: learning off|reuse|on-demand, arithmetic exact|float64, shadow
ask(problem, budget)     -> Result        problem = {theory | handle, query | constraint, assumptions, at}
check(plan, theory)      -> Compliance    optional; evaluate a given plan or trace against the procedures and norms in force
update(handle, delta)    -> handle        optional incremental maintenance (additions; retractions: 5.5)
fork(handle, delta)      -> handle        optional what-if world; delta = add | remove | set (with the declared predicate key);
                                          reports whether the world continues incrementally or was recomputed
dream(journal, budget)   -> report        optional offline consolidation (E10 Dreamer, VRC consolidate; 5.6)
```

The theory of `ask` is either a **materialised slice** (a structured object, not re-parsed text: 11.3) or a **fact source** the strategy pulls from on demand (11.3); each strategy declares which delivery it accepts. A simple engine implements only `ask`; a sophisticated one adds `prepare`, `check`, `update`, `fork` and `dream`. The caller passes the same theory either way. Preparation never writes knowledge, and reads never hide writes (a registry that records usage is a separate, reported write). `check` is sop-r's `check` and VRC's replay generalised: the same wires then serve audit as well as planning (8.4).

### 5.3 Result packet

```
{status, complete, bound?, conditional?: [ids] (union), nonmonotone?, conditional_unknown?,
 rows?: [{..., conditional?: [ids], conditional_unknown?}], count?, witness?, objective?, plan?, hypotheses?, explain?, missing?,
 used: [{id, version}], used_incomplete?, proof?: DAG,
 compliance?: {hard, violated?, soft_violations?, deviations?, total_cost}, blocked_by?, blocked?: {step, requirement, norm},
 choices?, procedure?, relaxed?, contested?: [ids], obligations_triggered?, obligation_unscoped?: [ids], scope_unknown?: bool,
 guarantee: exact|bounded|approximate,
 budget: {limit, used, exhausted, reason, partial},
 retrieval: {complete, truncated, keyed, steps, wires, probes},
 strategy, route: {requested, chosen, reason, fallback: null},
 timings: {load, index, prepare, ask, replay}, ignored: [...], notes: [...]}
```

Statuses: `supported refuted both unknown` (relational), `entailed possible impossible inconsistent optimal feasible_bound` (numeric), `plan_found no_plan blocked` (planning), `compliant non_compliant` (conformance), `procedure_found`, `hypotheses`, `budget_exhausted`, and the non-negative preparation outcomes `approximate` (a bounded or learned answer without a guarantee), `stale` (a prepared artefact no longer matches the theory) and `no_model` (VRC: no certified encoding; not a negative answer). `not_expressible` and `unavailable` are reported by the router or harness before a strategy runs; `unsupported` stays reserved for AGENTS rule 8.

Field definitions that round 1 left open:

- **`used`**: **one sufficient support set**: the ids and versions of claims (facts), rules, defaults, actions, methods and norms that together are enough to re-derive the answer. Mandatory for `supported` and `refuted` with `complete: true`, because AGENTS rule 7 needs the claim ids a use of memory relied on (proof-use promotion is per claim). It is **not** "the claims whose deletion changes the answer": with two facts that are each sufficient, deletion changes nothing and would give an empty set (case `13c`). A strategy that provides `used` returns the leaves of one proof. For the others the host runs the **deletion method** (remove each claim in turn, keep those whose removal changes the answer) and **verifies it by a replay run** on the claims of that set alone: if the replay re-derives the answer, the set is sufficient and is `used`; otherwise the packet says `used_incomplete: true` (a flag distinct from `conditional_unknown`, which concerns assumptions) and promotes nothing from that answer. Under-reporting `used` only loses proof-use promotions (AGENTS.md rule 7); it never invents a claim. Cases `13c` (two sufficient facts, `used_incomplete`), `13d` (a chain where deletion is sufficient and verified).
- **`proof`**: a minimal DAG for shadow comparison of explanations: nodes `{id, atom, kind: fact|rule|assumption|default, source: claim id or rule id and version, premises: [node ids], binding}`. The shadow check compares the status of every node, never the shape of the DAG and never leaf-set equality (strategies may prove an atom differently); a strategy's `used` is checked by replaying it alone in the oracle (5.4).
- **`ignored`**: only the wires outside the query's dependency slice (the host dropped them as irrelevant). It never lists unsupported features: a circuit with an unsupported feature is `not_expressible`, not partially answered.
- **`blocked`**: sop-r's `BLOCKED` kept: the failing step, the unmet requirement and the norm, so that "no plan" is never the only information.
- **`bound`**: `at_least` for a count over an open predicate (4.2 item 5); `at_most` is reserved for minima.
- **`guarantee`**: `exact` (the answer is the semantics of the theory), `bounded` (exact within a declared bound: horizon, depth, domain), `approximate` (VRC's approximate estimate; never used for a negative answer).
- **`budget.reason`**: `rounds`, `probes`, `horizon`, `depth`, `domain`, `wall`, `cancelled`, `numeric_range` (section 6).
- **`scope_unknown`**: `true` when the host could establish no context scope and scoped norms or methods were therefore bound anyway (8.2); a restriction is never dropped for lack of context.
- **`notes`**: `arithmetic_undefined` (a zero divisor made a body false), and the like.

### 5.4 Shadow check

Any new strategy is accepted by running it in shadow next to the reference strategy on the smoke and targeted suites and counting disagreements (VRC's "shadow mode"; E10's differential test against its reference evaluator). Zero disagreements on exactly decided cases is the entry condition. **The oracle is `js-oracle`, the stage-1 complete oracle, in progress**: a complete implementation of every core feature, deliberately naive (a nested-loop evaluator with stratified negation as failure, aggregates, `compute`, defaults by desugaring, planning by uniform cost), living in `reasoning/strategies/js-reference/` with the harness adapter `eval/smoke-reasoning/adapters/js-oracle.mjs`; it passes the 59 cases it declares and declares no `method`, norms or procedures. That is the entry condition for every other strategy. The existing `js-reference` (the bounded product strategy of `reasoning/`) stays what it is until the owner's review decides what the oracle becomes. **`used` is checked by replay, not by equality**: for every strategy's answer the comparator takes the returned `used` (unless `used_incomplete`), runs the oracle on those claims alone and requires the same status (and the same rows); two strategies that prove an answer through different sufficient sets both pass, and a `used` that does not re-derive the answer fails (`lib/used.mjs`, the self-test of `run.mjs`). **The native closure template** (10.2) produces answers, so it passes this shadow gate like a strategy before the router may use it. The shadow comparison is also run on metamorphic variants (renaming, permutation, irrelevant facts) and, separately, on the **host linking** (a paraphrase of the same question must link to the same circuit), not only on the engines.

### 5.5 The adapter contract: budgets, tabling, solvers and updates

- **Prolog.** `call_with_depth_limit` is meaningless on tabled predicates; use `call_with_time_limit` (and `call_with_inference_limit` for a probe counter). A time-limit exception leaves **incomplete tables**, which must be abolished (`abolish_all_tables`) before the next query, otherwise the next answer reads partial answers as complete. The meta-interpreter of `why_not` runs over a non-tabled copy (an abductive meta-interpreter does not compose naively with tabling and loses termination unless tabled itself).
- **Z3.** Two relations per predicate (`p_pos`, `p_neg`); completion only for non-recursive predicates; `recursion` declared unsupported; integrity as a violation relation; bounded encodings (planning horizon, aggregate domain) report `budget_exhausted` with `reason horizon` or `domain` when the bound is hit, never `no_plan` (an unsat within the horizon is `budget_exhausted`, `reason horizon`). An unsat answer cannot name the blocker, so hard norms are encoded as violation atoms plus a "no violation" requirement; on unsat the requirement is lifted and the violations are minimised (MaxSAT), which gives `blocked_by` (the `waive` abduction, 8.4).
- **ASP.** Strong negation `-p` would make a theory with a conflicting pair inconsistent (no stable model), so explicit negation is again a separate relation; defaults and norms may use native `not` where the program is stratified and must agree in shadow with the desugared form. Integrity constraints are never hard `:- body.` rules: `integrity` is a `violation` relation. Hard norms are violation atoms plus a "no violation" requirement, and `blocked_by` comes from lifting it and `#minimize`-ing the violations, as for Z3.
- **Incremental maintenance and invalidation.** Additions are monotone (positive facts and rules extend a prepared handle; a count, an aggregate, an `absent` and a plan depending on them are recomputed). A **retraction** under negation as failure needs DRed-style maintenance (delete and re-derive; Gupta, Mumick, Subrahmanian 1993; sop-r's `set` costs 870 ms against 31 ms for an addition because it recomputes) or invalidation. A prepared handle, a dreamed deployment plan or a cached plan is **invalidated** when (a) a fact is retracted from a predicate in its dependency cone, (b) a fact is added to a predicate that occurs under `absent`, an aggregate, a count or an `every` in its cone, or (c) a governed wire in its cone changes approval or version (8.3). `update` returns `stale` rather than a wrong handle.
- **Integrity at ingestion.** `integrity` over the whole memory cannot be checked per query slice (the slice may omit the second booking). It is checked when a claim is ingested, through a trigger index from predicate to the integrity wires that mention it, or offline over the whole memory; violations are data and appear in the next relevant answer.
- **Isolation.** A strategy may run in a worker with wall-clock and heap limits; its stop maps to `budget_exhausted` with `reason wall` (VRC `strategy-worker`).

### 5.6 Dreaming: records and the acceptance rule

`dream` is the offline consolidation of E10 (Dreamer, SkillComposer) and VRC (`consolidate`, registry). Concretely, four host-side records (inventory Z18, V07):

1. **journal episode**: task hash, status, cost counters (nothing about the answer's content);
2. **skill record**: kind, scope (a skill is schema-local: the predicate cone it was learned on, so at 10^6 to 10^9 wires it is prepared per query family, never over the whole memory), contract hash, certificate kind, semantic contract, evidence, objective, status `candidate | promoted | rejected | quarantined | revoked | advisory`;
3. **deployment plan**: the member skills plus settings, frozen for online use;
4. **advisory hint**: an empirical invariant (for example a functional dependency) that may suggest a `key` or reorder a join but never prunes, plus a **negative cache** keyed by learner version and budget (what was tried and failed).

**Acceptance rule for a learned artefact:** re-certify on load; replay positive witnesses in the original rules; run in shadow against the reference on small tasks; **revoke** on any disagreement. A learned part may only choose among legal plans, and never decides an answer (E10's rule). Evidence that the lifecycle pays: E10's frozen plans on a 106,800-fact world (2 to 9 times in wall clock) and VRC's 14.2 times per task on 12 held-out tasks (2.62 times over the whole series including accumulation and the dream pass); evidence that it does not: dense, nonlinear and mutual recursion, one-off queries, and all four Horn-lemma bundles rejected.

---

## 6. Budgets, partial answers, effort and emotion

**Rule.** A strategy may stop early; it may never answer as if it had finished. The result carries `complete` and a `budget` block. Claims that depend on completeness (`unknown`, `refuted` by failure, `no_plan`, counts, `every`, `absent`, optimum) are `budget_exhausted` when cut off. A positive existential answer found before the cut stays `supported` with `complete: false`, and rows are a subset of the true rows (soundness of partial answers). E10 returns INCOMPLETE with no partial rows; VRC returns BUDGET with a named reason (`time-limit`, `state-limit`, `numeric-range`, `rational-bit-limit`, `cancelled`); both are acceptable under the rule. Smoke cases `15a`, `15b`, `15c` test exactly this, and `lib/compare.mjs` fails an incomplete result that reads as `unknown`, `refuted`, `no_plan` or `optimal`. Its self-test shows the guard has teeth (23 checks, including `used` replay, `relaxed` and per-row `conditional`).

**Bounded-engine negatives have their own status.** A `no_plan`, `unknown` or `refuted` produced because a *bound of the engine* was hit (a planning horizon, a search depth, a finite domain of a bounded Z3 encoding, a coordinate limit) is not a negative answer about the theory: it is `budget_exhausted` with `reason horizon`, `depth` or `domain`. `lib/compare.mjs` rejects a result that carries one of those reasons and reports anything but `budget_exhausted` (a self-test check covers it). A partial count is a lower bound (`bound at_least`), and a partial list of rows stays a subset of the true rows.

**Budget keys.** The existing keys stay (`maxNodes maxDepth maxHypotheses maxCandidates maxPlans maxRounds maxFacts maxJoins maxAssignments timeoutMs`) and `maxFanout` (the fan-out of one rule per binding, sop-r's card R11) is added; each strategy declares which it honours. `maxRounds` is the fixpoint-round or call-depth ceiling, `maxJoins` the candidate-probe ceiling (E10 `maxWork`, VRC `maxCandidates`). Budgets only tighten the host's ceilings.

**The prompt may influence time.** The host maps the message to `effort quick|normal|deep` (for example "quickly" or an `urgency` pragmatic signal gives `quick`, "take your time" gives `deep`), which scales the budget between host-declared floors and ceilings. The model never sets a budget (it cannot emit `policy`). `partial forbid` means "no partial answer: give up cleanly".

**Emotion, only under policy.** The `pragmatic` wire is advisory (DSx029): urgency lowers effort and prefers a fast strategy; frustration or confusion triggers re-checking the previous interpretation or a clarification; a hedge makes a statement a supposition; irony forbids acting on the literal meaning without confirmation. Pragmatic signals are never evidence and never reach the engine except through `effort`, `partial` and the router's inputs. The engine interface needs no emotion concept.

**Sophisticated and simple engines.** `prepare`/`dream` take their own offline budget and report cost; the online `ask` is always bounded. E10's and VRC's reports insist on counting the preparation and failed attempts in the totals; the evaluation plan does the same.


---

## 7. What the strategies are: algorithm essence, strengths, weaknesses, capabilities

Strategies are separate entries, each with its own capability set. "Today" means it runs through `reasoning/`; "wired" means the harness runs it read-only from a zip; "planned" means a stub only (its declared coverage is printed by the harness, section 9.2).

> **Pruned on 2026-10-01 (owner decisions in chat; the table below is the historical state of the proposal).** The oracle `js-reference` is now also the `reference` route of the runtime, so the old `js-reference` entry (the retired JavaScript reasoner) is gone; `prolog-swi` is removed (superseded by `prolog-tabling`, 82 against 35 smoke passes) and so is `z3-lia` (superseded by `z3-smt-bounded`, whose typed-constraint module also covers unbounded integers); the `neural-assist` stub is removed (no evidence for it); `datalog-soplab` is demoted to a reference engine under `eval/reference-engines/` (differential tests only, no routing candidate); `golog-swi` is frozen (it overlaps the planner and conform); `conform-core` is merged into the oracle as its `conform` capability, so there is no separate column. `advanced` is deprecated: the oracle plus the optional external backends. See DS006 "Strategies".

| id | status | algorithm essence | strong at | weak at |
| --- | --- | --- | --- | --- |
| `js-oracle` | stage-1 oracle, in progress (`reasoning/strategies/js-reference/`, adapter `js-oracle`) | Complete, deliberately naive core: four-valued evidence, nested-loop joins with stratified NAF, aggregates, `compute`, defaults and integrity by desugaring, verified per-row `conditional`, `used`, proofs, intervals, uniform-cost plan, abduce, why-not, budgets | being the shadow oracle for every other strategy: 59 of the 59 cases it declares pass | no `method`, `norm` or `procedure` (20 modes-of-work cases are `not_expressible`); naive speed |
| `js-reference` | today (the current bounded product strategy; stays until the owner's review decides) | Bounded interpreter: nested-loop joins over facts, closure to a fixpoint with round, fact and probe ceilings; explicit negation as evidence; JS controllers for plan (uniform cost), abduce (cost-ordered subset search, inclusion-minimal), what-if. The oracle role is taken by `js-oracle` (5.4) | small problems, every status vocabulary, proofs, point-in-time and overlap intervals | no NAF, aggregates, defaults, arithmetic in rules today; no demand rewriting, so large selective queries are slow |
| `prolog-swi` | today (closure adapter) | SWI computes the closure with `:- table`; JS rebuilds the proof and checks agreement; point-in-time only | cross-checking the Horn closure with an independent engine | adds nothing semantically over the JS closure; no intervals, plan, abduce |
| `z3-lia` | today | Deterministic QF_LIA encoding from an allow-listed AST; claim checked by two `check-sat` calls (negated and plain); optimisation plus a separate optimality check | linear integer constraints, optimisation, unbounded domains | not a Horn engine; no rules |
| `datalog-e10` | wired | Bottom-up set semantics, SCC schedule, semi-naive, greedy joins, magic-set demand, INCOMPLETE on overrun | selective recursive queries on large fact sets, stratified NAF, certified transformations | no aggregates, no arithmetic, no time, no proofs through the adapter; dense, nonlinear and mutual recursion regress |
| `datalog-soplab` | wired | Generator-based evaluator, naive or delta materialisation, slicing, stratified `NONE`, `reduce` aggregates, transition planner, min-cost abduction | breadth of constructs on small inputs, aggregates, proofs | slow on large inputs; abduction returns one cheapest explanation; slicing gave no gain on its only benchmark |
| `prolog-tabling` | planned | SLG resolution (tabling) with well-founded negation; abductive meta-interpreter for `why_not` | left-recursive and cyclic rules, goal-directed (top-down) queries, `tnot` | speed on bulk joins; completeness under cuts of budget (abolish incomplete tables) |
| `sql-sqlite` | planned | Datalog P0 to P2 lowered to recursive CTEs and `NOT EXISTS` with the built-in `node:sqlite`; the memory's own SQLite bank can host it | bulk joins and aggregates; E10 found SQLite faster than its own engine on 9 of 12 families | nonlinear and mutual recursion are not lowered; the hand-written SQL in E10 is not evidence for a compiler |
| `z3-smt-bounded` | planned | Finite-domain encoding of NON-recursive programs: two relations per predicate, completion of non-recursive rules, bounded aggregates, bounded planning as satisfiability, MaxSAT for `why_not` | arithmetic mixed with logic, optimisation, bounded planning, norms over a horizon | **recursion is declared unsupported** (completion over a cycle admits non-least models), domain explosion |
| `asp-clingo` | planned (private clingo 5.8.2 is available under `tools/.solvers/clingo`; the adapter is not written) | Stable models by grounding and CDCL-style solving | defaults, integrity, abduction, planning, preferences, norms (native) | grounding blow-up on large domains |
| `datalog-souffle` | planned (private Souffle 2.5 is available under `tools/.solvers/souffle`, built from source for aarch64; the adapter is not written; the stub declares 29 of 79 cases) | Compiled or interpreted Datalog with stratified negation, arithmetic and aggregates (`sum`, `count`, `min`, `max`); relational joins with indexes | bulk joins, recursion with arithmetic, `06d`, aggregates, the open-predicate host rules | no defaults, intervals, plan or abduction natively; the bag-versus-set behaviour of its aggregates over equal values must be tested first |
| `htn-strips-planner` | planned (soplab and VRC planners are bases) | Forward state-space search with method decomposition, choice points the engine optimises, hard and soft norms, check of a given plan | `plan`, `method`, norms, procedures, `blocked` | large state spaces without compression |
| `golog-swi` | planned | A Golog or IndiGolog interpreter in SWI: methods as programs with nondeterministic choice, tests and bounded loops; norms as tests on primitive actions | strict procedures, conformance (`check`), rendering | no cost optimisation beyond search; needs the private swipl |
| `vrc-compressed-planning` | planned (VRC zip) | Exact-rational state compression plus BFS | numeric planning worlds with symmetry | only unit-cost existential reachability; at most 32 coordinates; needs the numeric action extension E2 |
| `dreaming-session` | planned **wrapper** (E10 Dreamer, VRC registry) | Not a strategy: offline consolidation of verified skills with the four records of 5.6, frozen online deployment plan around any exact engine; it has **no coverage of its own** (it inherits the wrapped engine's declared coverage, so it has no column in Appendix G) | repeated query families over a stable schema | needs a journal; no benefit on one-off queries or dense recursion |
| `worlds-sopr` | planned (sop-r) | Copy-on-write hypothetical worlds, cone-based lazy saturation, `lift` | many what-if worlds over a large base with additions | closed world only, three-term statements; deletion and `set` are recomputed (870 ms against 31 ms); entry gate: the 1,200-answer incremental test plus a non-monotone case |
| `neural-assist` | planned | Advisory proposers (join orders, hypotheses) verified by an exact checker | nothing yet (it tied the heuristic in E10) | cannot decide truth |

Not strategies but **router rules and components** from the inventory: the *native closure template* (recognise a transitive-closure rule pair, run a BFS with a witness path when an argument is bound), which accounts for the 17x to 1,382x speed-ups attributed to VRC and holds on 5 of 13 cases (10.2); advisory `key` hints from observed functional dependencies (5.6); rule lifting (sop-r R01); and the low-priority components model counting, exact rational evaluation and induction ranking (Appendix D).

### 7.1 How each strategy consumes the standardized circuits (lowering)

Core lowering, per wire type and strategy. "n/a" means the strategy declares the feature unsupported and answers `not_expressible`. The Z3 column is the bounded, non-recursive strategy.

| wire or leaf | js-reference | Prolog (tabling) | Datalog (E10/Soufflé style) | Z3 (bounded, non-recursive) | ASP (clingo) | planner |
| --- | --- | --- | --- | --- | --- | --- |
| `fact holds p a b` | evidence record | `p(a,b).` | EDB tuple | `p_pos(a,b)` | `p(a,b).` | initial-state atom |
| `fact holds not p a` | negative evidence | `neg_p(a).` (separate relation) | relation `negative:p` | `p_neg(a)` (a **separate relation**: both is `p_pos` and `p_neg`, computed at query time) | `neg_p(a).` (a separate relation; strong negation `-p` would make a conflict inconsistent) | negative state atom |
| `rule` | Horn rule | clause, head tabled | Horn rule | implication; **completion (iff) only for predicates not in a cycle** | normal rule | derived relations per state |
| recursion | fixpoint | tabling | semi-naive | **n/a** (completion over a cycle admits non-least models: case `04b`, `probes/z3-04b-completion-recursion.smt2`) | grounding | per-state saturation |
| `not p` in a body | lookup of the negative relation | call `neg_p` | `NOT p` literal | `p_neg` | `neg_p(X)` | polarity-explicit state |
| `absent p` (closed `p`) | n/a | `tnot(p(X))` or `\+` when stratified | `NONE p` (stratified) | `not p_pos` (non-recursive `p` only) | `not p(X)` | n/a |
| `compare A WORD B` | native | `A > B` | `TEST` | native | `A > B` | guard |
| `compute ?v A times B` | n/a today | `V is A*B` | needs arithmetic (E10 n/a; Soufflé yes) | native | `V = A*B` | effect |
| `aggregate sum` | n/a today | `aggregate_all(sum(S), distinct(P-S, salary(P,D,S)), T)` | stratified group-by (`sum` in Soufflé) | `(+ (ite ...))` over the finite set | `#sum { S,P : salary(P,D,S) }` | n/a |
| `default` | desugared, needs NAF | desugared | desugared | desugared (non-recursive bodies only) | `body, not ab` (native; must agree in shadow with the desugared form) | n/a |
| `integrity` | desugared, needs compare | desugared | desugared | a `violation` relation (never a hard assertion) | a `violation` relation (never a hard `:- body.`: a hard prohibition of what may be done is a `norm`, `forbid STATE always`) | n/a |
| `constraint` | enumeration | `clpfd` or delegate | n/a | native | `#minimize` or delegate | n/a |
| `action`, `goal` | uniform-cost search | `plan/3` over state | n/a | frame axioms to a horizon (a cut is `budget_exhausted`, reason `horizon`) | time-indexed rules | native |
| `method` (8.2) | n/a | decomposition predicate | n/a | n/a | choice rules plus `#minimize` for `choose` | tried before blind search; strict binding forbids falling back |
| `norm` (8.2) | n/a | test on every primitive action | n/a | one violation Boolean per norm per step; hard: a "no violation" requirement, lifted and MaxSAT-minimised on unsat to name `blocked_by`; soft: objective term | the same: violation atoms, a "no violation" requirement, `#minimize` over violations on unsat (names `blocked_by`); soft: `#minimize` term over the horizon | hard: prune; obligation: deadline goal; soft: cost; trajectory: one monitor automaton per norm |
| `trace` and `mode conform` (8.4) | step-indexed facts and norm rules deriving `violated` (core rules) | the same program, tabled | the same program (every Datalog strategy runs it) | the same program over the finite trace | the same program | native `check` |
| `hypothesis` | candidate subset search | `abducible/1` plus minimality filter | n/a | choice with minimise | choice rule plus `#minimize` | n/a |
| `valid`, `at`, `during`, `overlaps` | native for stored facts and Horn rules | filter facts at `t`, then run | filter, then run | filter, then run | filter, then run | n/a |
| intervals (`during`, `overlaps`) | native | partition at endpoints, run per part, combine (the table of 4.2 item 7: all parts for `during`, any for `overlaps`; `select`, `count`, `every` differ) | same | same | same | n/a (engines without time answer `not_expressible` for 12b to 12g) |
| `query mode count` | host counts distinct rows | `aggregate_all(count, ...)` | `count` rows | n/a | `#count` | n/a |
| `query mode every` | host loops over members | `forall/2` | host loop | universal quantifier | `not` + choice | n/a |
| `query mode explain` | proof DAG | a meta-interpreter that records the derivation | witness DAG (one per tuple) | model | `--` | plan trace |
| `query mode why_not` | n/a today | abductive meta-interpreter over a non-tabled copy: minimal sets of EDB atoms whose addition derives the goal, plus the blocking atoms | demand run listing the unsatisfied demand predicates (missing EDB premises): a **weaker** answer, declared as `provides why_not_predicates` | MaxSAT or optimisation over fresh EDB literals, minimising the added set | `#minimize` over a choice of EDB atoms | `blocked {step, requirement, norm}` |
| budget | counters | `call_with_time_limit`, inference limit; abolish incomplete tables | `maxWork` to INCOMPLETE | solver timeout | `--time-limit` | node ceiling |

**Time lowering, in one place.** Point in time: filter the stored facts to those valid at `t` (and, for `asof`, known by then; governed wires approved by then), then run any engine on the filtered theory; derived atoms follow by snapshot semantics for free. Interval: partition `[S, E)` at every start and end of a fact in the slice into finitely many parts, run the point query once per part (the answer for a part is the same for all instants in it), then combine as in the table of 4.2 item 7 (`during` is the conjunction over parts, `overlaps` the disjunction, and rows keep the union of their parts as validity; `count` and `every` under `during` follow the same per-part rule, and are not specified under `overlaps`). An engine without time declares `temporal` or `interval` unsupported, and cases `12b` to `12g` are `not_expressible` for it. Time variables bound by `start_of` and `end_of` are ordinary values after the filter.

**Worked example, the same default program in four engines.** Program `09a`: birds normally fly, penguins are exceptions; query `flies ?x`; expected answer `tweety`.

Core circuit (what the coding agent wrote):

```
@bird predicate
  args subject:entity
@penguin predicate
  args subject:entity
  closed true
@flies predicate
  args subject:entity
@f1 fact
  holds bird tweety
@f2 fact
  holds penguin pingu
@r_penguin_bird rule
  when penguin ?x
  then bird ?x
@birds_fly default
  when bird ?x
  then flies ?x
  except penguin ?x
  priority 1
```

SWI-Prolog with tabling (run under the private SWI 9.0.4 in round 1, output `flies=[tweety]`; the same file also computed the payroll aggregate of case `07b`, output `payroll=[dev-310,ops-175]`). Names are shown with the round-1 prefix `d_`; the generated prefix is now `x_`, which changes nothing semantically:

```prolog
:- table bird/1, penguin/1, flies/1, d_birds_fly_applies/1, d_birds_fly_blocked/1.
penguin(pingu).
bird(tweety).
bird(X) :- penguin(X).
d_birds_fly_applies(X) :- bird(X).
d_birds_fly_blocked(X) :- d_birds_fly_applies(X), penguin(X).
flies(X) :- d_birds_fly_applies(X), \+ d_birds_fly_blocked(X).
dept_payroll(D,T) :- setof(D, P^S^salary(P,D,S), Ds), member(D,Ds),
    findall(P-S, salary(P,D,S), L0), sort(L0,L), pairs_values(L,Vs), sum_list(Vs,T).
```

Z3 as a finite-domain completion with **two relations per predicate** (file `eval/smoke-reasoning/probes/z3-09a-two-relations.smt2`, run by `run.mjs` under the private Z3 4.15.8: the three `check-sat` calls return `unsat unsat unsat`, meaning `flies_pos tweety` is entailed, `flies_pos pingu` is not derivable, and `tweety` cannot be both `flies_pos` and `flies_neg`; the sum over the finite set returned 310 in round 1). The program is non-recursive, which is why completion is sound here:

```
(declare-datatypes ((E 0)) (((tweety) (pingu))))
(define-fun penguin_pos ((x E)) Bool (= x pingu))
(define-fun bird_pos ((x E)) Bool (or (= x tweety) (penguin_pos x)))
(define-fun applies ((x E)) Bool (bird_pos x))
(define-fun blocked ((x E)) Bool (and (applies x) (penguin_pos x)))
(define-fun flies_pos ((x E)) Bool (and (applies x) (not (blocked x))))
(define-fun flies_neg ((x E)) Bool false)
(push) (assert (not (flies_pos tweety))) (check-sat) (pop)
(push) (assert (flies_pos pingu)) (check-sat) (pop)
```

The same Z3 lowering is **not sound for case `04b`** (recursion plus negation as failure on a cyclic graph): with edges `a b` and `b a` and an isolated `c`, the completion `reach(x,y) iff edge(x,y) or exists m: edge(x,m) and reach(m,y)` has a model with `reach(a,c)` true (a and b support each other around the cycle), although `reach a c` is not derivable; the run `probes/z3-04b-completion-recursion.smt2` returns `sat` where soundness needs `unsat`. Round 1 declared the completion lowering for every predicate and said that `refuted by completion` can be checked; that was wrong for recursion, and case `09a` passed only because it is non-recursive. `z3-smt-bounded` therefore declares `recursion` unsupported until loop formulas (Lin and Zhao 2004) or a level-mapping (rank) encoding are added.

Datalog (E10 dialect, produced and executed by the `datalog-e10` adapter on the desugared program; case `09a` passes): `FACT bird tweety`, `FACT penguin pingu`, rules `x_birds_fly_applies`, `x_birds_fly_blocked`, and `WHEN x_birds_fly_applies ?x` / `NONE x_birds_fly_blocked ?x` / `THEN x_birds_fly_fired ?x` followed by the conclusion rule; query `GIVES ?x / MATCH flies ?x`. soplab's CNL is the same shape (`NONE`), also passing.

ASP (clingo 5.8.2, **private binary present, not run for this document, adapter planned**): `bird(tweety). penguin(pingu). bird(X) :- penguin(X). flies(X) :- bird(X), not penguin(X).` and `dept_payroll(D,T) :- dept(D), T = #sum { S,P : salary(P,D,S) }.`

Soufflé (2.5, **private binary present, not run for this document, adapter planned**): `dept_payroll(d, t) :- salary(_, d, _), t = sum s : { salary(_, d, s) }.` The set-versus-bag behaviour of Soufflé aggregates over equal values must be tested before relying on it.

Every claim of the form "this lowering is correct" in the table above is a plan to be checked by the shadow comparison of section 5.4, except where stated as run.


### 7.2 Essence of each algorithm (what a reviewer should know)

- **Semi-naive bottom-up evaluation** (Datalog, E10, soplab delta, VRC): compute all consequences by repeatedly applying rules, but each round joins only the facts that are new in the previous round with the full relations, so every derivation is made once. Terminates on finite function-free programs. Cost grows with the size of the whole closure unless the query binds arguments, which is why demand rewriting matters.
- **Magic sets / demand rewriting**: transform the program so bottom-up evaluation only derives facts relevant to a query's bound arguments (Bancilhon, Maier, Sagiv, Ullman 1986; Beeri and Ramakrishnan 1991). E10's `reach` went from incomplete at 300,001 probes to complete at 167. It composes poorly with negation (E10 falls back when `NONE` is in the slice) and can slow dense or mutually recursive programs.
- **SLG resolution / tabling** (SWI-Prolog): top-down evaluation that memoises subgoals and their answers, so left recursion and cycles terminate and each subgoal is solved once; with delaying it gives the well-founded semantics for negation (Chen and Warren 1996). It is goal-directed like magic sets but interpreted per call.
- **Stratified negation and stable models**: on a stratified program every semantics (perfect model, well-founded, stable model) agrees (Apt, Blair, Walker 1988; Van Gelder, Ross, Schlipf 1991; Gelfond and Lifschitz 1988). That agreement is what lets one `absent` wire be lowered to Datalog `NONE`, Prolog `tnot` and ASP `not`.
- **SMT (Z3)**: decide satisfiability of first-order formulas over theories (here linear integer arithmetic). Entailment of a claim is two checks (the claim with its negation); optimisation adds an objective plus a separate proof that no better value exists (de Moura and Bjørner 2008). Logic programs enter only through a finite-domain **completion** (Clark 1978: each predicate is equivalent to the disjunction of its rule bodies). Completion characterises the *supported* models, which are the least model only for programs without positive cycles; with recursion it admits extra models (case `04b`), and the repairs are loop formulas (Lin and Zhao 2004), a level-mapping (rank) encoding, or bounded unrolling. Explicit negation is a second relation, because a hard `not p a` beside `p a` makes the theory unsatisfiable and entails everything.
- **ASP**: ground the program, then search for stable models with conflict-driven solving (Gebser et al., clingo). Defaults, integrity constraints, abduction (choice plus `#minimize`), norms and bounded planning are native idioms. Strong negation `-p` plus `p` leaves no stable model, so a proposal that keeps contradictions as data uses a second relation.
- **State-space planning** (STRIPS, Fikes and Nilsson 1971; HTN, Erol, Hendler and Nau 1994): search over states produced by actions; HTN methods prune by decomposition. HTN planning with recursive methods is undecidable in general (Erol, Hendler and Nau), so loops are bounded (`until ... max N`) and a depth cap reports `budget_exhausted`. **Golog** (Levesque et al. 1997) offers the same expressiveness as programs with nondeterministic choice, tests and loops in the situation calculus; the interpreter chooses only at choice points. VRC adds exact state compression: states with equal certified encodings and mode have the same future, so BFS merges them.
- **Abduction**: search subsets of candidate hypotheses by cost and keep inclusion-minimal consistent explanations (Kakas, Kowalski, Toni 1992; Console, Dupré, Torasso 1991).
- **Dreaming** (E10, VRC): offline consolidation. Replay recorded episodes, propose a transformation, verify it exactly against a reference on held-out programs, promote it, deploy a frozen plan online. Learned parts only choose among legal plans; they never decide an answer.

- **Incremental maintenance** (Gupta, Mumick and Subrahmanian 1993): additions extend a materialised view; deletions need delete-and-re-derive (DRed) or derivation counts because a fact may have other derivations, and under negation as failure a deletion can *add* conclusions. sop-r's numbers show the asymmetry: 31 ms to add against 870 ms to `set`.
- **Paraconsistent evidence** (Belnap 1977; Przymusinski 1988): positive and negative evidence derived independently, four statuses, no explosion; the reading of `both` adopted in 4.2.
- **Recursive SQL**: a linear recursive common table expression with `UNION` (set semantics) computes a transitive closure; nonlinear and mutual recursion need a rewrite or a Datalog engine.

---

## 8. Modes of work and operating procedures

### 8.1 What is asked, and why round 1 did not meet it

The owner asked for modes of work, procedures and SOPs that **help and restrict** the engines: the system acts by approved rules and plans, optimises within them, keeps them named, versioned and addressable, and allows an amendment to be negotiated with the user. The reviewer judged round 1 insufficient on four counts, and the proposal now closes each:

| Requirement | Gap in round 1 | Closed by |
| --- | --- | --- |
| act according to approved rules and plans | `policy` carried only budgets; no wire had a version, approval state, approver or supersession; the lifecycle of 13.1 was prose; procedures were only *tried first*, hence advisory | governance fields on every binding wire (8.2, 8.3), `binding strict`, `policy procedures` |
| still optimise within them | `method` was a total-order script with nothing to choose; `integrity` is static and hard; no preferences or soft costs | the extended `method` (choice points the engine optimises, fixed points it may not touch), `norm` with soft costs, `objective` |
| conceptually addressable | wires have ids but no bundle, version or scope; a procedure of ten wires had no name | the `procedure` bundle wire (a named, scoped set of wires), version history by `supersedes`, `asof` |
| modifiable through negotiation | no amendment object, no what-if of a proposed change, no record of acceptance | `amendment` and `argument` wires, proposed versions used as conditional wires, the host negotiation loop (8.5) |

All additions are **knowledge-side**: written by coding agents or by the owner from a source, never by SymbolicLM. Approval stays with the host (a trusted-host write recorded in the project journal, like `remember`). The model surface is unchanged except for the declared query modes of 4.4.

### 8.2 The wires

**Governance fields** on `rule`, `default`, `integrity`, `action`, `method` and `norm`: `version N`; `supersedes $id` (same wire type, higher version); `approval proposed|approved|contested|rejected|superseded|retired`; `approved_by` and `approved_at` (set by the host); `retired_at`; `scope`; `source`, `quote`. The field is named `approval`, not `status`, because `fact.status` already means `observed|reported|hedged|supposed`. Validator checks: `supersedes_type_mismatch`, `version_not_increasing`, `approval_incomplete`, `superseded_not_marked` (an approved successor makes its predecessor `superseded`).

- **Who writes the field.** *Ingestion writes it.* In **memory**, every governed wire carries `approval approved`, `approved_by` and `approved_at`, written by the host when it accepts the wire (ingestion is the approval, and a wire loaded from a pre-governance store with no field is read as approved at its `known_at`). On the **authoring surface** an author never writes the field, and a wire an author submits without it is *submitted*, that is `proposed`, until the host approves it. (The smoke cases are stated as memory content, so a wire without `approval` there is approved.)
- **`approved_at` is required** for every `norm` and every strict `method` (an `asof` question about a prohibition or a mandatory procedure must always be answerable); the fallback for a wire older than the governance fields is its memory `known_at`. This is an **ingestion** requirement: the validator has an **authoring mode** (`node eval/smoke-reasoning/validator.mjs --authoring FILE...`) for the author, in which `approval`, `approved_by` and `approved_at` are *ignored with the warning* `governance_ignored` (the author must not write them) and `approval_incomplete` is not checked; without the flag the validator checks a wire as it stands in memory, where `approval_incomplete` and a missing `approved_at` are errors of the host's write, not of the author.
- **`contested` is a host write, and a contested wire binds, flagged.** When a user or an agent disputes a binding wire, the host marks it `contested`; it keeps binding (otherwise any user could switch a prohibition off by objecting) and the packet lists it in `contested` until the host rules on it (`approved` again, or `superseded` by an accepted amendment, or `rejected` for a proposed wire). A `proposed` or `rejected` wire never binds on its own.
- **One vocabulary.** The amendment's `approval` uses the same words: `proposed`, `approved`, `rejected` (the earlier `accepted` is renamed `approved`; `rejected` joins the wires' vocabulary, for a proposed wire the host refused).
- **`scope` and `procedures` (matching).** A wire's `scope` is a quoted list of tags (`scope "ops, business_hours"`). The host sets the *context scope* of a query (the tags of the user's team, role and the conversation, plus any `policy scope`); a scoped norm or method **binds when its tags intersect the context scope**, and an unscoped wire always binds. When the host cannot establish any context scope, scoped norms bind anyway and the packet sets the field `scope_unknown: true` (5.3) (a restriction is never dropped for lack of context). `policy procedures $p ...` does **not** switch norms on or off: **all approved norms whose scope matches bind regardless of procedure**; `procedures` selects the *methods* the planner tries and the *set rendered* by `mode procedure`. A `procedure` has no `version` of its own (its members carry versions and `supersedes`), so the question "which version applied on that date" is answered from the members.

**`method`** (extended). Fields: `achieves ATOM`, `when` guard, `step` (repeatable, in order), `prefer ~a over ~b` (repeatable), `on_failure $method|replan|abort`, `triggered_by ATOM` (an event; the plan library is the set of approved methods indexed by `achieves` and `triggered_by`), `binding strict|advisory`, `cost`, governance. Step forms, one keyword per line, blocks closed by `end`:

| step | meaning |
| --- | --- |
| `~action term...` | a primitive step (an `action` wire must exist; the term count must match its `params`) |
| `task_atom` | a sub-task; some approved method must achieve it (`subtask_without_method`) |
| `achieve atom` | the planner fills the gap between the state and the atom |
| `optional STEP` | the engine may skip it, and does when it costs more than it helps |
| `choose` ... `end` | a nondeterministic alternative: one line per branch (a branch with several steps is a sub-task with its own method); at least two branches |
| `any_order` ... `end` | the enclosed steps in any order (a partial order) |
| `if ATOM` ... `else` ... `end` | branch on the state reached before the step |
| `until ATOM max N` ... `end` | bounded iteration; `max` is mandatory (`until_needs_max`) |
| `pick ?x where ATOM` | the engine chooses a binding |

**Semantics of a method.** A plan is a run of the program; the legal executions are all the ways of resolving its choice points (`choose`, `pick`, `any_order`, `optional`, `achieve`, `if` outcomes fixed by the state); `mode plan` returns the **cheapest legal execution that satisfies the norms** in force, ties broken by `prefer`. The engine chooses **only** at those points. Under `binding strict` the engine may not plan from primitives when an approved method exists for the task, and may not leave the method except through its declared `on_failure`; under `binding advisory` methods guide the search and the engine may fall back. Branching beyond `choose` and `if` is several methods with guards; **unbounded loops are not expressible** (HTN planning with recursive methods is undecidable in general, Erol, Hendler and Nau 1994): every loop has a `max`, and a depth or iteration cap hit gives `budget_exhausted`, not a plan. `by ?agent` on steps and BDI goal types are not included (8.9).

```
@do_backup method
  achieves backup_done ?s
  when server ?s
  version 1
  binding strict
  step ~lock_db ?s
  step if big_db ?s
    ~snapshot ?s
  else
    ~dump ?s
  end
  step choose
    ~upload_s3 ?s
    ~upload_nas ?s
  end
  step optional ~verify_backup ?s
  step ~unlock_db ?s
  on_failure $manual_backup
```

**`norm`** (new; deontic, with the temporal part of TLPlan control rules and PDDL3 trajectory constraints). Exactly one of `forbid PATTERN`, `oblige PATTERN`, `permit PATTERN`, where a pattern is `~action term...` or a state atom; `when` (a condition group; the pattern's variables are universally quantified over the action parameters and count as bound); **at most one temporal qualifier** (table below); `severity hard|soft` (default hard) and `cost N` (soft only); `priority` and `overrides $norm`; `binding strict|advisory`; `message` (the reason string returned when the norm blocks a plan); governance. A **trajectory constraint** is a norm over a state atom with `always`: `forbid both_open` + `always` says the state `both_open` never holds at any step of the plan. `norm` is to actions and trajectories what `integrity` is to states; both are kept. A `permit` without `overrides` changes nothing and the validator warns (`permit_without_target`).

**Qualifiers, formally.** A *run* is a plan (steps counted from 1) or a timestamped trace; "the trigger" of an obligation is defined below.

| modality | qualifier | holds when | violated when |
| --- | --- | --- | --- |
| `forbid` | `always` (default) | the pattern does not hold at any step of the run | at the first step where it holds (and the `when` holds) |
| `forbid` | `before ~b` | the pattern does not occur while `b` has not yet occurred | the pattern occurs at a step with no earlier occurrence of `b` |
| `forbid` | `after ~b` | the pattern does not occur once `b` has occurred | the pattern occurs at a step after an occurrence of `b` |
| `forbid` | `at_most_once` | the pattern occurs at most once in the run | at its second occurrence |
| `oblige` | `sometime` | the pattern occurs at some step after the trigger, by the end of the run | the run ends with the trigger raised and no occurrence |
| `oblige` | `always` (maintain) | the pattern (a state atom) holds at every step from the trigger | at the first step from the trigger where it does not hold |
| `oblige` | `within N` | the pattern occurs within N steps of the trigger (N time units in a timestamped trace) | N steps (or units) pass after the trigger with no occurrence |
| `oblige` | `before ~b` | the pattern occurs before `b` occurs, if `b` occurs | `b` occurs with no earlier occurrence of the pattern |
| `oblige` | `after ~b` | the pattern occurs at some step after `b` has occurred (a required follow-up) | the run ends after an occurrence of `b` with no later occurrence of the pattern |
| `permit` | none | never violated; it blocks the `forbid` it names in `overrides` for the arguments where its `when` holds | not applicable |

`within N` and `sometime` count **steps in a plan** (one action is one step) and **time units in a trace whose steps carry `at`**; mixing the two in one norm is not allowed.

**Obligation triggers and scoping.** An obligation is not a fact about the whole memory; it has *instances*. An instance is triggered at the first step of the run at which the `when` holds for a binding that is **bound by the goal's arguments or by an executed action's parameters**; a binding that appears only because some row of memory satisfies the `when` creates no instance. So `oblige ~notify_oncall ?r when router ?r within 10` obliges notifying router r7 when the goal or a step concerns r7, not every router in memory (case `38` is exactly this, with incidents). **The marker for a standing obligation is the line `standing` on an `oblige` norm** (a flag, like `always`; allowed on `oblige` only, otherwise the error `standing_needs_oblige`). A standing obligation over a whole predicate (every binding of the `when`, whatever the goal) is allowed only when the author writes `standing`: the host then applies it to every binding and reports the note `obligation_unscoped` with the norm's id, and the validator warns `obligation_unscoped` on that marker once, so that the author confirms the intent. A variable of the `oblige` pattern that no `when` atom binds is a different defect, the error `unsafe_variable`, whether or not `standing` is written; a ground obligation needs neither. Only these two forms are expressible: a scoped obligation (the default) and an explicitly standing one. The packet lists the instances it applied in `obligations_triggered`.

**`severity` x `binding`.** The two fields answer different questions and are independent:

- `severity` says **what a violation does**: `hard` makes the plan (or the trace) invalid; `soft` adds the norm's `cost` to the objective and the plan is still returned with the violation reported.
- `binding` says **whether the engine may relax the norm when the goal is otherwise blocked**: `strict` never relaxes it (the answer is `blocked` with `blocked_by`); `advisory` may relax it, and then lists it in `relaxed` (never silently). **The default is `strict`**, for norms and for methods (a wire that states no `binding` is strict): it is fail-safe (an omitted field can never loosen a prohibition) and consistent with "a policy may only tighten" (`policy binding` can make an advisory wire strict, never the reverse). An author writes `advisory` only for a source that says "recommended" or "should"; the validator's check `strict_forbid_conflicts_method` treats an absent `binding` as `strict`.

| severity | binding | effect |
| --- | --- | --- |
| hard | strict | a violating plan is invalid; if nothing else is possible the answer is `blocked`, `blocked_by [norm]` (case `30b`) |
| hard | advisory | a **relaxable hard constraint**: used as a hard constraint while any plan satisfies it, relaxed when the goal is otherwise blocked, and listed in `relaxed`, `compliance.hard "relaxed"` (case `39a`) |
| soft | strict or advisory | the violation costs and is reported; `binding` is **vacuous** here (a soft norm never blocks), and the validator warns (`binding_on_soft_norm`) |

A `both` between two norms of **equal strength** (a `forbid` and an `oblige` of the same action for the same arguments, with no `overrides` and no priority between them): under `strict` the result is `blocked` with both ids in `blocked_by` (case `39b`); under `advisory` it is a reported violation of the one the engine relaxes, listed in `relaxed`. Never a silent pick.

```
@no_hard_reset_in_hours norm
  forbid ~hard_reset ?r
  when business_hours
  severity hard
  binding strict
  version 1
  approval approved
  approved_by "ops lead"
  approved_at 2026-01-15
@notify_promptly norm
  oblige ~notify_oncall ?r
  when router ?r
  within 10
  severity soft
  cost 50
@emergency_hard_reset norm
  permit ~hard_reset ?r
  when emergency ?r
  overrides $no_hard_reset_in_hours
```

**`procedure`** (new). A **named bundle**: `members $id $id ...`, `description`, `scope` (tasks, agents, contexts), `source`. It has no approval **and no version** of its own (round 3: a `version` without a `supersedes` is unusable, and the members already carry both): the members carry the approval and the versions, so the procedure is in force exactly when its members are, and the question "which version of the reset procedure applied on that date" is answered from its members' history. `policy procedures $p ...` names the methods and the rendered set for a query (it does not switch norms, 8.2); an amendment addresses a procedure by name.

**`amendment`** (new). A proposed change: `of $procedure_or_wire`, `proposed_by user|agent`, `members $wire ...` (the proposed wires: new versions that supersede, or additions, each with `approval proposed`; `amendment_member_not_proposed` otherwise), `removes $wire ...`, `reason`, `approval proposed|approved|rejected` (the wires' vocabulary, 8.2), `evaluated` (a link to the comparison). **`argument`** (new): `for $id` or `against $id` (exactly one), `claim`, `source`, optional `cost_delta`; evidence for the negotiation, never evidence of facts.

**`trace`** (new). A performed sequence of ground `step ~action term...` lines, each optionally ending `at DATE` (the date or timestamp at which it was performed); the input of `mode conform`.

**`hypothesis`**: `waive $norm` with a `cost` makes the relaxation of a norm a hypothesis; abduction over it returns the **minimal set of norms whose relaxation unblocks a plan**, which is the negotiable item the host puts to the user.

**`policy`** (additions, host-set): `scope` tags of the query context (8.2), `procedures $p ...` (the methods and the rendered set), `objective cost|violations|lexicographic` (what the engine minimises: plan cost plus soft-violation costs, the number of violations, or violations first), `binding strict|advisory` (applies to wires that state none; their own default is `strict`, so a policy can only tighten, never weaken a wire's `strict`).

### 8.3 Semantics

- **Only approved wires bind** (and contested ones, flagged, 8.2). `proposed` and `rejected` wires are treated like supposed facts: they enter a query only when it supposes them (`if $id`), the answer is then `conditional` on them, and a proposed successor displaces the version it supersedes for that query. This gives "what would the plan be if this amendment were approved" for free (`lib/governance.mjs`, case `30c`). `superseded` and `retired` wires bind only for an `asof` date inside their period.
- **`asof`** selects the version known at that date: a governed wire is in force from its `approved_at` (fallback `known_at`) until its successor's `approved_at` (or its `retired_at`); facts by their memory `known_at`. Case `35a` (an audit view) and `35c`, `35d` (rule versions, which E10 and soplab pass) test it. For `conform`, each trace step carries its own time (8.4).
- **Prohibition, permission, lex specialis.** A `permit` is an exception to the `forbid` it overrides, through the same machinery as defaults: the prohibition is blocked for the arguments where the permission applies (and fires); equal-strength conflicting norms without an override give `both` and are reported, never silently picked. `overrides` needs the same subject and opposite force (`overrides_target_mismatch`) and no cycles (`overrides_cycle`). A strict, hard `forbid` of an action that an approved strict method requires as a mandatory step is a `conflict` error at approval time (`strict_forbid_conflicts_method`).
- **Obligations as goals with deadlines.** A hard `oblige` is a goal the plan must reach by its deadline; an unmet one makes the problem `blocked`. A soft one derives `violated $norm` when unmet and adds its `cost` to the objective; the plan is still returned and the violation is reported (case `33`). Contrary-to-duty norms ("if the deadline is missed, then ...") are ordinary rules on `violated`.
- **`binding` and `severity`** are independent (the matrix of 8.2): a strict hard `forbid` is never traded for cost; the engine returns `blocked_by $norm`, not a cheaper violation; an advisory hard norm may be relaxed when the goal is otherwise blocked and is then listed in `relaxed`, never silently; a soft norm only costs.
- **`used`** lists the method, norm, rule **and action** versions that took part (their `when` held, or the step was executed), so the answer names the exact modes of work it acted by. For the sufficiency semantics of `used` as a whole see 5.3.

### 8.4 Query modes

- **`plan`** under the norms in force; the packet gives `plan`, `used: [{id, version}]` and `compliance: {hard: ok, soft_violations: [{id, cost}], total_cost}` where `total_cost` is the plan cost plus the soft-violation costs, and `choices: [{step, chosen, alternatives, reason}]` for what the engine optimised.
- **`why_not`** on a planning goal, with `via ~action term...` for the step asked about: `status blocked`, `blocked_by [norm ids]`, `blocked {step, requirement, norm}`. `blocked` means a plan would exist if the named norms (or unmet requirements) were waived; `no_plan` means none even then. Case `30b`.
- **`abduce`** with `waive` hypotheses: the minimal sets of norms whose relaxation unblocks the plan (case `30d`).
- **`conform`**: given a `trace`, `compliant` or `non_compliant` with the same `compliance` object (hard violations by id, soft violations with costs, `deviations`, total cost). The same wires then serve audit as well as planning (cases `37a` to `37d`). The interface call is `check(plan, theory)` (5.2). Three rules make an audit answer correct:
  1. **Time.** A past trace is judged against the versions in force **at the time**, not today's. A `trace` step may carry `at DATE`; `conform` takes `asof` (default now), used for the steps that carry no `at`; a step with `at` is judged at its own time. A hard reset performed in January is judged against the January prohibition (case `37c`: no prohibition was yet in force, so the same trace that is `non_compliant` today, case `37a`, is `compliant`).
  2. **Method deviation.** Leaving a **strict** method (a step the method does not allow, a step skipped, an order broken) is non-compliance, and the method is listed in `compliance.deviations`; under `binding advisory` the trace is compliant and the deviations are only reported (case `37d`).
  3. **Lowering.** Conformance is purely relational, because a trace is a closed, finite record, so it lowers to **core rules**: each step becomes a step-indexed fact (`did action args i`, plus `at`), each norm becomes a rule deriving `violated NORM i` (qualifiers as in 8.2: `forbid always` is `did(X, i), when holds at i`; `within N` is a trigger fact, `absent` of an occurrence in the closed trace window), a strict method is a sequence check deriving `deviation METHOD`, and `compliance` is read off the derived relations. The trace predicates are closed by construction, so negation as failure is sound. It therefore runs on **every** Datalog strategy (and on `js-reference` once it has NAF), the cheapest way to make audit live before any planner exists (14.10).
- **`procedure`**: render the approved method for a task as of `asof`, without planning (steps as written, the version, the norms in force): most SOP questions want the text (cases `35a`, `35b`).

### 8.5 Amendment and the negotiation loop (host)

1. A user (or an agent) objects: "why can't I hard-reset r7?" The answer is `blocked_by $no_hard_reset_in_hours`.
2. The host asks, through `abduce` with `waive` hypotheses, which norms would have to be relaxed, and offers them as the negotiable items; the user (or an agent on their behalf) writes or accepts an `amendment` whose members are proposed wires (here `relax_hours`, a norm version 2 that supersedes the prohibition when no ticket is open) with an `argument`.
3. The engine evaluates the amendment as a **what-if**: `mode plan` or `mode conform` with `if $amendment`, using the supposition mechanism. The answer is conditional on the amendment (cases `30c`, `36`). *The `amendment` wire is composed by the host from the user's language* (the user says "allow hard resets when a ticket is open"; the host writes the proposed norm version, the `amendment` and the `argument`): it is a host-generated knowledge wire, not model output, and SymbolicLM never emits it. *Before approval the host may replay the procedure's own smoke cases under the amendment* (the cases of its tests, run with `if $amendment`) and show which previously passing cases change, so a change that silently breaks another answer is visible before anyone approves it.
4. The host presents the delta: plan cost (5 to 3), violations and blocked steps, before and after.
5. The user accepts or rejects. Acceptance is a **host write** (who may accept: 14.23): the proposed wires become `approved` with `approved_by` and `approved_at`, the superseded versions become `superseded`, and the change is recorded in the project journal with provenance. Rejection records the amendment (and its proposed wires) as `rejected` with its arguments, so the same proposal is not re-litigated blindly.

Argumentation between amendments and norms (support and attack, Dung's grounded semantics) is deferred: grounded semantics needs well-founded negation, so it is a `prolog-tabling` or ASP feature rather than stratified Datalog, and it matters only when contested wires accumulate.

### 8.6 Worked example: the router-reset mode of work

The knowledge (cases `30a` to `30d`, `36`, `37a`, `37b`; the files are `eval/smoke-reasoning/cases/30a-router-reset-plan-under-norms/knowledge.sop` and neighbours). Predicates and actions: `router`, `router_reset`, `notified`, `reset_done`, `link_up`, `business_hours` (arity 0), `emergency`, `ticket_open` (closed); actions `notify_oncall` (cost 1), `soft_reset` (cost 3, needs `notified`), `hard_reset` (cost 1), `verify_link` (cost 1, adds `router_reset`). Facts: `router r7` and `business_hours`. Method version 1 is superseded; version 2 is approved and strict:

```
@reset_router method
  achieves router_reset ?r
  when router ?r
  version 2
  supersedes $reset_router_v1
  approval approved
  approved_by "ops lead"
  approved_at 2026-09-30
  source "Ops manual 4.2"
  binding strict
  step ~notify_oncall ?r
  step choose
    ~soft_reset ?r
    ~hard_reset ?r
  end
  step ~verify_link ?r
```

Norms: the three of 8.2 (the hard prohibition `no_hard_reset_in_hours`, the soft obligation `notify_promptly`, the permission `emergency_hard_reset`), a **proposed** version 2 of the prohibition, `relax_hours` (`supersedes $no_hard_reset_in_hours`, `approval proposed`, `when business_hours`, `when absent ticket_open ?r`), an `argument` for it (`claim "an open ticket already implies on-call awareness"`), a `procedure` bundle `reset_procedure` naming the method and the norms. Expected behaviour (each is a smoke case with the answer in its `expected.json`):

| user asks | query | answer |
| --- | --- | --- |
| "how do I reset r7 now?" (business hours, no emergency) `30a` | `mode plan`, `policy procedures $reset_procedure` | `plan_found`: `notify_oncall`, `soft_reset`, `verify_link`, cost 5; `used: [reset_router@2, no_hard_reset_in_hours@1, notify_promptly@1, notify_oncall@1, soft_reset@1, verify_link@1]` (the method, the two norms and the three actions of the plan, all at version 1 for the actions; `expected.json` of case `30a` lists the same six ids); `compliance.hard ok`, no soft violations, total cost 5. The cheaper hard reset is never considered: the strict prohibition prunes it; the obligation to notify is met |
| "why can't I hard-reset r7?" `30b` | `mode why_not`, `via ~hard_reset r7` | `blocked`, `blocked_by [no_hard_reset_in_hours]` |
| "what would have to change?" `30d` | `mode abduce`, `waive` hypothesis | `hypotheses [[waive no_hard_reset_in_hours]]` |
| "what if the relaxed norm were approved, and a ticket is open?" `30c` | `mode plan`, `if $relax_hours` | `plan_found`: `notify_oncall`, `hard_reset`, `verify_link`, cost 3; `conditional [relax_hours]`; rendered "allowed only if the amendment is approved" |
| "what if this amendment of the procedure were accepted?" `36` | `mode plan`, `if $am1` (an `amendment` whose member is `relax_hours`) | the same plan, `conditional [am1]` |
| "did we follow the procedure?" `37a` | `mode conform`, trace `notify_oncall, hard_reset, verify_link` | `non_compliant`, hard violation `no_hard_reset_in_hours`, total cost 3 |
| the same with a soft reset `37b` | trace `notify_oncall, soft_reset, verify_link` | `compliant`, total cost 5 |
| "was the January hard reset allowed?" `37c` | `mode conform`, trace steps `at 2026-01-10` | `compliant` (no prohibition was in force then), total cost 2 |
| "did we follow the manual?" with an extra step `37d` | `mode conform`, trace with `extra_check` | `non_compliant`, `deviations [reset_router]`, hard norms ok, total cost 6 |
| "show me the procedure as of January" `35a` | `mode procedure`, `asof 2026-01-01` | `procedure_found`: `reset_router_v1`, version 1 (version 2 was approved on 2026-09-30; version 3 is only proposed) |

Further cases: `31a` (the `if/else`, the choice and an optional step the engine skips: lock, snapshot, upload to S3, unlock, cost 7), `31b` (`on_failure`: the uploads need the closed `network_up`, so the strict method has no legal run and the declared fallback runs: `copy_tape`, cost 20), `32` (a hard trajectory norm `forbid both_open always`: the plan must close one valve before opening the other, cost 5 against 7 for the other order), `33` (an unmeetable soft obligation: the plan is returned with a violation of cost 10, total 14), `34` (a prohibition and the permission that overrides it), `38` (an obligation instantiated only for the incident the goal concerns), `39a` (a hard advisory norm relaxed and listed), `39b` (two strict norms of equal strength in conflict: `blocked`, both ids).

### 8.7 Lowering and capabilities

How each strategy consumes the modes-of-work wires is in the `method` and `norm` rows of 7.1: a **planner** (`htn-strips-planner`) prunes hard strict prohibitions (an advisory hard one is pruned first and relaxed only if the goal is otherwise blocked), turns obligations into deadline goals and soft norms into cost, checks a trajectory norm with one monitor automaton per norm, and tries methods before blind search; **ASP** uses choice rules plus `#minimize` for `choose` and integrity constraints or `#minimize` terms for norms over a horizon; **Prolog** backtracks over the alternatives with a test on every primitive action, and a **Golog** interpreter (`golog-swi`) is the natural reading of a strict method; **Z3 bounded** uses one Boolean per alternative per step and per norm, and names `blocked_by` by lifting the "no violation" requirement and minimising (7.1). `conform` needs none of these: it lowers to core rules (8.4). Capabilities: `htn_choice`, `on_failure`, `norms_hard`, `norms_soft`, `temporal_norms`, `procedures`, `procedure_render`, `amendment`, `check_plan`, `blocked_info`, `abduce_waive`, `overrides`, `versions`, `binding_advisory`, `norm_conflict`, `conform_asof`, `conform_deviation`. No live strategy has them yet (9.2): these cases are the acceptance tests of the planner, and their expected answers, derived by hand, are to be confirmed by its shadow run.

### 8.8 Where the two review texts differed, and the choices made

The reviewer answered the modes-of-work question twice (a first list of eight proposals, and a dedicated, more detailed answer). They agree on substance and differ in naming. One coherent set is adopted; the alternative is in the open questions (14.16).

| Topic | First answer | Dedicated answer | Chosen |
| --- | --- | --- | --- |
| trajectory constraints | a `trajectory` wire (`always`, `never`, `sometime`, ...) | temporal qualifiers on `norm` | **qualifiers on `norm`** (one wire for what must or must not happen along a plan; `always` over a state atom is the trajectory constraint) |
| governance | a `procedure` bundle carrying version, status, approver, supersession, scope | governance fields on every binding wire | **fields on every wire** (a single wire can be amended; one mechanism; since round 3 also on `action`), and **`procedure` kept as a thin named bundle** with no approval and no version of its own, so a mode of work is addressable by name |
| choice | `any_of` | `choose` (plus `pick`, `any_order`, `optional`) | **`choose`** and the other forms |
| failure | `on_fail $method` | `on_failure $method|replan|abort` | **`on_failure`** |
| conformance | query mode `conform` | call `check(plan, theory)` | **both, at two levels**: `mode conform` is the question, `check` is the strategy call that answers it |
| approval field | `status proposed|approved|superseded|retired` | `status proposed|approved|contested|superseded|retired` | **`approval`** with six values (`rejected` added in round 3; to avoid the clash with `fact.status`) |
| strictness | `norm_mode strict|advisory` in `policy` | `binding strict|advisory` on each wire | **`binding` per wire**; a policy default may only tighten |
| amendment | an `amendment` wire with `adds`, `removes`, `replaces` | versioning plus an `argument` wire | **`amendment` as an envelope of proposed versions, plus `argument`** |
| packet | `applied`, `choices`, `violations`, `blocked`, `relaxed` | `used`, `compliance`, `blocked_by` | **`used` (with versions), `compliance`, `blocked`/`blocked_by`, `choices`, `relaxed`** |

### 8.9 What is deferred

BDI goal types (`achieve` and `maintain`; `maintain` is already an `always` obligation) and `by ?agent` on steps; the bearer of a norm as a field (express it with `when`); unbounded loops (not expressible); argumentation semantics for contested wires; a hard `oblige` with `before` over several obligations at once (the planner handles one deadline per norm); `norm` desugaring into core rules for Datalog **for planning** (norms are plan-level wires: only planners, Golog, ASP and bounded Z3 declare them for `plan`, and the validator checks `overrides` directly on the sugar); the same norms over a *finished trace* do lower to core rules (8.4).

---

## 9. Validation: what exists, what was run here, what is missing

### 9.1 What the zips and literature establish

| Claim the proposal relies on | Evidence | Strength |
| --- | --- | --- |
| A shared bindings-with-evidence IR, named wires, explicit negation versus absence, stratification are workable | soplab (23/23 tests; baseline.json), E10 (202/202 tests, 20/20 regressions), VRC (113/113), sop-r (difftest 5,100/5,100) | four small implementations **of one project lineage** (the same authors and ideas); synthetic workloads. Agreement among them is consistency of one design, not independent validation |
| Demand rewriting and offline-learned plans can cut work by orders of magnitude on selective recursion | E10 `results/e10.json` (167 against 300,001 probes; 3 against 25,002; 1,001 against 251,000; 2,700 against 1,623,600) and VRC's reach template (17x to 1,382x on 5 of 13 cases) | one 106,800-fact world, four queries; **2x to 9x in wall clock** for E10; negative on dense, nonlinear and mutual recursion |
| Budget overrun must not read as "no" | E10 INCOMPLETE (23 of 252 runs), VRC BUDGET; the current runtime's `unknown`/`complete:false` | design consistent across zips |
| LLM can compile text into this kind of wire and answer what-if questions | sop-r pilot: 215/216 vs 144/144 for reading text directly | tiny clean fictional text; shows feasibility only |
| Compilation errors can be detected without gold answers by independent compilations | sop-r difftest (5,100/5,100; injected errors detected; 340/340 on the re-run of 20 scenarios) | strong method, small sample |
| Prioritised defaults, integrity constraints, aggregates compile to stratified NAF and group-by | classical results (Reiter 1980; Apt et al. 1988; Gelfond and Lifschitz 1988) and the harness runs of this document (defaults, strict contrary, `overrides`, integrity and aggregates pass in two engines after desugaring) | well-founded; our desugaring is validated on 5 default and 1 integrity cases |
| Completion is a sound Z3 lowering for logic programs | **refuted for recursion** by `probes/z3-04b-completion-recursion.smt2` (a model with an underivable `reach(a,c)`); sound for the non-recursive case `09a` | the lowering is restricted accordingly (7.1) |
| Algorithm selection helps when solvers have complementary strengths | SATzilla (Xu, Hutter, Hoos, Leyton-Brown, JAIR 32, 2008), MachSMT (Scott, Niemetz, Preiner, Nejati, Ganesh, TACAS 2021), AutoFolio (Lindauer, Hoos, Hutter, Schaub, JAIR 53, 2015), Delfi (Katz et al., ICAPS 2018) | see section 10 |

### 9.2 What this proposal ran

79 cases, all valid, and the **desugared** form of each also valid (the validator checks the desugared program, not the sugar); 58 deliberately invalid circuits all rejected with the expected error codes or warnings; a comparison self-test of 23 mutation checks; a governance self-test (approval, `asof`, contested and rejected wires, supposed proposed wires); the Z3 probes (the two files in `eval/smoke-reasoning/probes/`, run under the private Z3 4.15.8). Results (`node eval/smoke-reasoning/run.mjs --markdown`, re-run for round 3 on 2026-10-01; `pass`, `n/e` = not expressible, FAIL; report in `eval/reports/current/smoke-reasoning/report.json`) are in **Appendix F** (one row per case, the six live strategies). Cases that no live strategy supports yet (`11c` and `30a` to `39b`) show as `n/e` in every column; that is expected.

Totals (79 cases): `js-reference` 35 pass, 0 fail, 44 n/e; `js-oracle` 59 pass, 0 fail, 20 n/e (the stage-1 complete oracle, in progress; it declares no `method`, `norms_*` or `procedures`; the round-3 cases `10f`, `13c`, `13d` pass on it too); `prolog-swi` 28 pass, 0 fail, 51 n/e; `z3-lia` 3 pass, 0 fail, 76 n/e; `datalog-e10` 37 pass, 0 fail, 42 n/e; `datalog-soplab` 43 pass, 1 fail, 35 n/e. Ten planned strategies (`prolog-tabling`, `sql-sqlite`, `z3-smt-bounded`, `asp-clingo`, `datalog-souffle` (private Souffle 2.5 available; adapter planned; described in section 7), `htn-strips-planner`, `golog-swi`, `vrc-compressed-planning`, `worlds-sopr`, `neural-assist`) are stubs, and `dreaming-session` is a wrapper with no coverage of its own; the sop-r and VRC engines are also plain Node and can be wired next. For the planned strategies the harness prints the **declared** coverage (`exp` = every required feature is declared, `n/e` = a required feature is declared unsupported). **That table (Appendix G) is a declaration, not a prediction:** it says which cases a stub's author intends it to cover and which features it declares unsupported (how the `not_expressible` of Z3 on the recursion cases `04b` and `23` is shown before any adapter exists); no stub has run, and a declared `exp` is not evidence that the strategy will pass. Declared coverage: prolog-tabling 54/79, z3-smt-bounded 37/79, asp-clingo 59/79, datalog-souffle 29/79, htn-strips-planner 39/79, golog-swi 15/79, sql-sqlite 42/79, vrc-compressed-planning 4/79, worlds-sopr 31/79, neural-assist 0/79


What round 3 changed in the harness (all backward compatible; `eval/smoke-reasoning/README.md`): the conditional lowering is per row and verified (`lib/conditional.mjs`, cases `10c` to `10f`); `used` is one sufficient support set with the host's verified deletion method and a replay in the oracle (`lib/used.mjs`, cases `13c`, `13d`); defaults are retrieved like rules and their head and exception predicates are completeness-sensitive (`lib/memory.mjs`, `lib/widen.mjs`, case `24`, whose retrieval study row is in 11.7); governance covers `action`, `contested` binds flagged and `rejected` never binds (`lib/governance.mjs`); the validator gained the warnings `obligation_unscoped` and `binding_on_soft_norm`, the trace step `at DATE`, the amendment vocabulary and the removal of `procedure.version`; and ten cases were added (`10f`, `12g`, `13c`, `13d`, `24`, `37c`, `37d`, `38`, `39a`, `39b`).

How to read it honestly:

- Two Datalog engines and the JS reference agree on every case they all express (classical negation, conflicts, every, open world, what-if), and two engines (soplab, E10) agree on NAF, defaults (including the strict contrary and `overrides` by fire), integrity, rule versions, the open-predicate bounds, the conditional lists and recursion with negation after desugaring and the host rules. That supports the semantics and the desugaring; it is **not** validation against a mature engine, and the four experiments are one project lineage (2.6).
- `prolog-swi` passes because JS rebuilds the proof from the closure and checks agreement; it is a cross-check of Horn closure, not an independent proof. Its budget cases pass because the JS closure honours the counters, not SWI.
- The single FAIL is a real finding: soplab's `abduce` returns one cheapest explanation; the case (and the proposed `abduce` mode) requires **all** inclusion-minimal explanations, which the JS controller returns.
- **No live strategy passes** `11c` and the modes-of-work family `30a` to `39b` (20 cases; they need the planner with methods and norms; `37a` to `37d` could be made live early by the lowering of `conform` to core rules, 8.4). **Only `js-oracle` passes** `01b` (zero arity), `06d` (compute in rule bodies; the Prolog, Soufflé, ASP and SQL lowerings are still to be built), `12c` to `12g` (the interval cases; the current runtime's `during` is overlap) and `13b` (why-not; the abductive meta-interpreter is still to be built for the other engines). They are the reasons to build `prolog-tabling`, `htn-strips-planner` and a why-not procedure, and the comparison between those engines and the oracle is what the shadow check measures. The existing `js-reference` stays the bounded product strategy meanwhile.
- The cases added in round 2 that engines can express were written to the review's findings: `09d` strict contrary (a bare `not flies tweety` gives `refuted`, not `both`), `09e` blocking by fire, `10c` to `10e` the assumption list with its two flags, `07d` and `08d` the host rule for open predicates (it passes on every strategy that can count or quantify, which tests the host, not the strategy), `04b` the recursion-plus-negation case that Z3 must decline, `23` the cut rule set (E10 and soplab pass it; with the guard disabled the first answer is wrong), `35c` and `35d` rule versions. The round-3 cases that engines can express were written to the second review: `10f` (the a/b/c counterexample: leave-one-out gives [s_c], the verification run fails, the row is conditional on all three with `conditional_unknown`; with the old algorithm the case would fail), `13c` (two facts that are each sufficient: deletion gives the empty set and the host reports `used_incomplete`), `13d` (a chain where the verified deletion set is exactly the three claims and not the distractor) and `24` (a default over a retrieved slice; with the guard disabled the first answer, `tweety` and `pingu`, is accepted and wrong). Their expected answers were not tuned to an engine: the engines that pass them were run after the expected files were written.
- Today's product runtime cannot express NAF, aggregates, defaults, integrity, methods, norms or why-not at all; its answer to an exhausted budget needed a translation. These are gaps of the product, not of the wires.
- The budget mapping in the harness (`maxRounds`, `maxJoins`) is per strategy and documented in the adapters; `datalog-soplab` has no probe counter and `datalog-e10` has no round counter, so they are n/e on the other budget case.

### 9.3 Not validated

Comparison with a mature Prolog/Datalog/ASP engine on realistic sizes and timings; ASP and Soufflé lowerings (both private binaries are present, `tools/.solvers/clingo` 5.8.2 and `tools/.solvers/souffle` 2.5, but no adapter has run); NL-to-wire fidelity from real documents; routing; any speed claim at scale for the proposed wires; the claim that desugared defaults match ASP defaults on non-stratified programs; the expected answers of the modes-of-work family (hand-derived until the planner exists); the verified conditional lowering for **proposed wires** (the harness implements it for facts only; proposed wires are selected by `lib/governance.mjs` but no live strategy runs a case that supposes one); the replay of a strategy's own `used` in the oracle (the harness replays the host's deletion set on the cases that state `used_support`, and the check has a self-test, but no live strategy yet returns a `used` of its own); the semantics of `scope` matching, `contested` binding, obligation triggers and `conform` with time (hand-derived expected answers, no live strategy); the independence of the four experiments (they are one lineage); the Python history experiments E00 to E07 (not re-run).

---

## 10. Routing problems to strategies

The owner's point: each strategy has strengths and weaknesses, so the system's value is sending each problem to the right one and learning to do it better over time.

### 10.1 Rules of the game (AGENTS.md rule 8 unchanged)

An explicitly requested strategy or backend is **never** substituted: an unavailable one returns `unsupported` naming it with `fallback: null`. Routing runs only when the caller asks for it (`reasoning auto`, or a host default of `auto` for requests that name no strategy). The router's choice and reason are always reported in the result: `route: {requested: "auto", chosen: "datalog-e10", reason: "recursion + naf, 120k facts, bound first argument", alternatives: [...]}`. `policy.reasoningStrategy` takes strategy ids and `auto`; `reference` stays as an alias of `js-reference`; **`advanced` is not redefined**: it keeps its current meaning (the JavaScript strategy plus the optional external adapters, with the routing it has today) and is deprecated with a warning in `route`, to be removed after one release. The first review answer asked for exactly this; the addendum would alias `advanced` to `auto`, which silently changes what existing callers get. The choice is listed for the owner (14.6).

### 10.2 Stage 1: a rule-based router from circuit features

Features extracted by the validator, no model needed: uses recursion (and whether it is a transitive-closure pair), uses `absent`, uses `aggregate`, uses `compute`, uses `norm` or `method`, has intervals, has a `constraint` or `optimize` task, has `action`/`goal`/`method` (planning), has `hypothesis` (abduction), asks `why_not`/`explain`, has temporal intervals, number of facts and rules, whether the query binds arguments, budget and effort, whether the theory is repeated (prepared handle exists).

First rules (to be revised by the smoke and targeted evaluations). E10's per-family adaptive policy selection (inventory Z10) is the existing evidence that a per-family choice of optimisations pays; it is a router feature, not a strategy:

1. Filter by capability and limits: drop strategies whose declaration lacks a needed feature, whose `delivery` cannot take the slice, or whose `max_wires`, `max_arity` or integer range is exceeded. If none remain, answer `not_expressible` with the missing features.
2. Numeric task (`constraint`) goes to `z3-lia`/`z3-smt-bounded`; if the domain is finite and small the enumerating `js-reference` is the oracle.
3. Planning, `method` and `norm` go to `htn-strips-planner` (`golog-swi` for strict procedures and conformance, `asp-clingo` for norms over a horizon); numeric worlds with symmetry go to `vrc-compressed-planning` only after shadow agreement.
4. A recursive rule pair that is a **transitive closure** (a `transitive true` hint, or recognised by shape) with a bound argument goes to the **native closure template** (it produces answers, so it must pass the shadow gate of 5.4 like a strategy before this rule may fire; a BFS with a witness path; the inventory's V03 and S11 show it accounts for the 17x to 1,382x speed-ups, on 5 of 13 cases, and 1.0x to 1.26x on the rest). Other recursive or negation-heavy queries with a bound argument and many facts go to a demand-driven engine (`prolog-tabling`, `datalog-e10`); bulk joins and aggregates with free variables go to bottom-up Datalog or `sql-sqlite` (E10 found SQLite faster on 9 of 12 families). **Dense cycles, nonlinear and mutual recursion do not go to demand rewriting** (the `verified` configuration of E10 lost to greedy on them): plain semi-naive or tabling.
5. Small inputs, intervals, epistemic status and proofs stay on `js-reference`.
6. Defaults, integrity and abduction prefer `asp-clingo` when available, else the NAF strategies via desugaring. A theory that touches recursion with a non-recursive-only strategy (`z3-smt-bounded`) is filtered out by rule 1.
7. A repeated theory with a prepared handle goes to the strategy that holds the handle.

### 10.3 Stage 2: portfolio under a shared budget

Run two or more capable strategies in parallel or interleaved under one budget and take the first **certified** answer (an answer is certified when its strategy is exact for the feature set and complete). Disagreement between complete strategies is reported as a defect, not hidden. This is the SATzilla-style fallback when features do not decide, and it doubles as the shadow check. Because the machine has a single GPU worker and ordinary CPU strategies are cheap, a portfolio of CPU strategies is affordable; GPU work stays out of it.

### 10.4 Stage 3: a learned router

A selector trained from the logs of the comparison runs. **Label:** the strategy that is correct (agrees with the reference), complete, and cheapest in work counters (candidate probes and wall time, cold and warm separately), per problem; ties by simplicity. **Features:** the circuit features above plus cheap size statistics. **Model:** start with a gradient-boosted or random-forest pairwise ranker, the AutoFolio/MachSMT recipe; no neural network is needed. **Safety:** the router only orders strategies that already passed the capability filter and the shadow agreement; it can lose time but never change an answer, which is also E10's rule for learned components (a ranker may only reorder legal plans).

### 10.5 Is it plausible? The literature

- The framework is Rice's algorithm selection problem (J. R. Rice, "The algorithm selection problem", Advances in Computers 15, 1976; cited from memory).
- Per-instance portfolios work when solvers are complementary: SATzilla used empirical hardness models to choose among SAT solvers and won competition categories (Xu, Hutter, Hoos, Leyton-Brown, JAIR 32:565-606, 2008; verified). MachSMT applies empirical hardness models and pairwise ranking to SMT solvers, winning 54 divisions and improving PAR-2 by up to 198.4% (Scott, Niemetz, Preiner, Nejati, Ganesh, TACAS 2021; verified). AutoFolio automatically configures an algorithm selector and improved results on the Algorithm Selection Library (Lindauer, Hoos, Hutter, Schaub, JAIR 53:745-778, 2015; verified). In planning, Delfi selects a planner online with a learned model and won the optimal track of IPC 2018 (Katz, Sohrabi, Samulowitz, Sievers, ICAPS 2018; verified); sequential planning portfolios such as Fast Downward Stone Soup and Cedalion (Helmert, Röger, Karpas 2011; Seipp, Sievers, Helmert, Hutter 2015; cited from memory) did well at earlier IPCs. Kotthoff's survey covers the field ("Algorithm selection for combinatorial search problems: a survey", AI Magazine 2014; cited from memory).
- **Caveats.** These systems select among solvers for the **same** problem, where each solver solves the whole instance; our strategies also differ in what they can express, so capability filtering comes first. The gains reported come from large, diverse instance sets; our logs will start with a few hundred problems, so a learned router is a stage-3 goal, not a day-one component. And E10's neural join-order ranker only **tied** the analytical cardinality heuristic (36 of 36 rows, mean rank 1.0 against 1.0), a reminder that a simple rule can be as good as a learned selector until the instance space is rich; the rule-based router is the baseline the learned one must beat on the preregistered metric.

### 10.6 Where the data comes from

- The smoke harness already records, per strategy and case, pass/fail/not expressible and the route. Extend it with work counters and timings (cold and warm), strategy-specific counters (probes, rounds, states) and the circuit feature vector.
- The targeted evaluations of section 12 generate size and class sweeps; every run appends a row `{problem id, features, strategy, status, complete, work, ms, agree_with_reference}` to `eval/reports/current/`.
- The label is derived after the fact; the router is trained on dev classes and evaluated on held-out **classes** and held-out sizes (generalisation of the router across forms is an explicit hypothesis, tested, not assumed; the repo's evaluation policy covers lexically disjoint variants of known forms, so routing claims are limited to families included in training).
- Preregistration (DS007) fixes the metric: regret against the oracle choice, plus fraction of problems where the chosen strategy is correct and complete, at equal budget; stopping rules are those of AGENTS.md "Early stopping".


---

## 11. From memory to the engine: selecting relevant wires at scale

In real use memory holds millions, eventually billions, of wires. A strategy cannot be handed all of them, and a query almost never needs more than a few dozen. Two questions follow: (1) how are the relevant wires chosen and given to the chosen strategy; (2) when the strategy fails on the first set, how does the system search again and supply further wires, and when does it stop?

### 11.1 What already exists

- **ChatSOP's linker** (`reasoning/linker.mjs`) is already goal-directed: it expands the query's atoms (and their negations, for conflict checks) backwards through the heads of approved rules (`planGoals`, bounded by `maxGoals` 256 and `maxRules` 1,024), then retrieves candidate facts for each goal pattern through a retrieval strategy (`exact`, `hybrid`, `recall-memory`, `sqlite`, `scan`, bounded by `maxProbes` 50,000, `maxShards` 256, `maxFacts` 10,000) and returns `complete` plus a `linkPlan`. Its own note says it correctly: completeness refers to "this retrieval view and budgets, never to all facts in the world". Retrieval is bounded and its probe counts are engine-specific units that are never compared as equal work (DS005).
- **soplab** slices rules backwards from the goal (predicate dependency closure; `sliceRules`), keeping only rules whose head is needed: 17 rules reduced to 2 and 15 derived facts removed, but only about 15 candidate rows saved on its workload (`results/baseline.json`); slicing is predicate selection, not tabling or magic sets.
- **E10** slices from the goal including negative edges, optionally applies magic-set demand, and on a 1,000,000-fact ring-component graph verified a bound query with 41 probes where the budgeted indexed run was INCOMPLETE at 250,001 probes (`results/stress.json`); load and indexing still cost linearly (parse 1,457 ms, 890 MB).
- **VRC** selects by relevance too: with 1,000,000 background facts and about 1,003 rules, slicing kept 3 rules and a 2-coordinate model (`results/large.json`), but loading the whole file dominated (9.8 s load, 831 MB), which is what its card R19 (external memory, indexes, two-stage retrieval: candidate selection from an index, then exact access and verification; "similarity never equals proof; a missing top-k gives UNKNOWN, not negation") is meant to fix.
- **sop-r** computes a dependency cone of relations so only needed relations are saturated, with a trigger index (relation, position, constant) so a new fact finds its rules by three hash lookups; its point queries still cost about 1 s at 100,000 entities because the cone names relations, not entities; its authors name magic sets as the missing piece (`docs/SCALARE.md`).

The common finding: **predicate-level slicing is cheap and necessary, but it is not enough when one predicate holds millions of facts about everyone**; demand must reach the arguments (constants), as magic sets and tabling do.

### 11.2 Symbol-driven relevance: three layers

1. **Rule-dependency radius (predicate graph).** From the query's predicates, follow rule heads to their body predicates, level by level, to a radius. This yields the candidate rules and the predicates whose facts might matter. It needs an index of reviewed rules by head predicate (`rulesFor(head)`); rules live in the exact library (DS005, DS018 `library` table), not in associative banks.
2. **Constant expansion (entity neighbourhood).** Start from the constants of the query and of the retrieved rules; fetch, for each relevant predicate, the facts that mention those constants; add the constants of the fetched facts and repeat for a number of hops, until a fixpoint (no new constant) or the hop limit. This is the demand propagation of magic sets done at retrieval time, and it is what keeps 5,000 look-alike `parent` facts about strangers out of the slice (case `20`). It needs an index on predicate plus argument value.
   **Hub constants.** A constant with very many facts (a department with a million employees) cannot be expanded by constant alone. The policy: a constant whose fact count for a predicate exceeds the per-predicate cap is *not* expanded by itself; it is joined with the other bound arguments of the same atom (keyed lookup on predicate, position and constant pairs), and if the result still exceeds the cap the predicate is marked truncated for that key, which makes every completeness-sensitive answer over it `incomplete` and, after the stop rules, `clarify`. SInE's frequency tolerance (below) is the symbol-level form of the same idea.
3. **Vocabulary mapping.** Fuzzy words ("employer", "works at") are mapped to predicates by the host lexicon and dictionary (DS014); literal text search (SQLite FTS5, BM25) or an embedding index may propose predicate and entity candidates, but they only **propose**; a candidate is accepted by structural matching against the reviewed vocabulary. An embedding index is not specified in DS016 to DS021 (open question 14.19); it would sit on the lexicon side, never as a premise selector for negation or counting.

Literature supports the first two layers and the idea of learning a third. **SInE** (Hoder and Voronkov, "Sine Qua Non for Large Theory Reasoning", CADE 2011) selects axioms by symbol triggers: an axiom is pulled in when it contains a symbol that is rare enough relative to the symbols already relevant, expanded to a tolerance and depth; it is the symbol-driven radius above, with a frequency criterion we could add so that very common predicates (such as `is_a`) do not drag in everything. **MePo** (Meng and Paulson, "Lightweight relevance filtering for machine-generated resolution problems", J. Applied Logic 2009), the relevance filter of Isabelle's Sledgehammer, scores each fact by the share of its constants that already occur in the goal and iterates with a decaying pass mark. **MaSh** (Kühlwein, Blanchette, Kaliszyk, Urban, "MaSh: Machine Learning for Sledgehammer", ITP 2013) learns from past proofs which facts were used; combined with MePo it was stronger than either. **DeepMath** (Alemi, Chollet, Eén, Irving, Szegedy, Sutskever, NeurIPS 2016) learns premise selection with sequence models on Mizar. The magic-set and tabling line (section 7.2) does the same selection exactly, per call. All of these select **premises for a prover that tolerates missing ones**; ChatSOP also needs answers that are **valid under absence** (negation, counting), which is stricter (11.7).

### 11.3 Lazy demand-driven access versus preloading

Two delivery modes, declared by the strategy in its capabilities (`delivery: slice | source | both`):

- **Materialised slice** (bottom-up engines: Datalog, soplab, E10, ASP, Z3 completion, and the current JS reference). The host runs the retrieval of 11.2 and hands the strategy a **structured object** (the rules, facts and `predicate` declarations it found, with claim ids, validity, source and status), **not `.sop` text to be re-parsed**: the parser's limit of 2,048 wires (`maxWires`) is an *author-surface* limit for circuits a person or an agent writes, and the harness hit it when it re-serialised a 5,005-wire slice (section 11.7). A slice is bounded by the strategy's declared `max_wires`; engines that stream (`delivery source`) take it incrementally. Textual `.sop` remains the format for authored circuits and for debugging a slice.
- **Fact source callback** (top-down engines: SLG tabling in Prolog, a demand-driven JS controller). The strategy receives a `FactSource` and calls it on demand, so only the facts it actually probes are read; tabling makes repeated and recursive subgoals cheap.

The `FactSource` contract is the existing retrieval contract of DS005 plus two calls:

```
lookup(pattern, {at, during, asof, limit}) -> {rows, complete, probes, coverage}
    pattern = predicate, arity, polarity, and any bound arguments (constants); an unbound argument is a variable
    each row = full atom, claim id, validity, source, status, verification
    complete  = every retained matching fact within the view was returned (not "all facts in the world")
    coverage  = exact | exact-partial | associative-candidates (candidates are never evidence by themselves)
rulesFor(headPredicate, arity, polarity) -> {rules, complete}
count(pattern) -> {estimate | exact, exact: boolean}      # cardinality for join ordering and demand decisions
closed(predicate) -> {declared: boolean, complete_for_view: boolean}
```

Index contract the memory must honour for `lookup`: (predicate, arity, polarity) and (predicate, position, constant), both exact; a repeated variable is an equality; types stay distinct. A strategy that pulls must propagate `complete` and `coverage` into its own result; a slice has one `complete` for the whole slice. Today's linker already returns this shape per goal pattern; what is new is `rulesFor`, `count`, `closed` and the `pull` delivery.

### 11.4 The memory side: which index each step needs

| step | index it needs | best fit in DS016 to DS021 | notes |
| --- | --- | --- | --- |
| rules by head predicate | exact map head to rules | the reviewed rule library (SQLite `library` table; the repository's rule set); never an associative bank | rules are approved wires; a bank "is not a reasoner" (DS005) |
| facts by predicate and constant | exact B-tree (predicate, position, constant) | **SQLite** bank: four composite indexes `(predicate, arity, polarity, argument position)` make `works_at ana ?org` and `works_at ?p cern` indexed lookups; `scan` is the unindexed baseline (cost grows with the number of records) | a repeated variable becomes a SQL equality |
| facts of a whole closed predicate (for `absent`, aggregates, `every`) | complete exact enumeration | SQLite, scan, or the `exact` sidecar over the retained generations; **not** RecallMemory or HoloMemory alone | DS005: "exhaustive enumeration, counting, and absence claims require an appropriate complete exact retained view" |
| fuzzy or partial cues | associative recall or literal search | **RecallMemory** (multi-view hashed counters; recall binds variables from observed per-position domains, smallest first, and prunes on any dissenting view; a candidate counts only if its receipt exists; probe cap gives `complete: false`), **HoloMemory** (a known complete key recovers content; partial-cue discovery is not implemented), SQLite FTS5 for literal text | candidates are hints, never premises; they decide where to look, not what is true |
| exact first, hints second | exact index plus associative hints | **hybrid** (`exact` SQLite plus Recall/Holo hints) with the `hybrid` or `auto` retrieval policy: exact coverage first, approximate route only after an incomplete exact search | an exact answer cannot be erased by a failed hint |
| time and validity | validity intervals and known-at in the tuple's claim metadata | temporal layer claims; `at`, `during`, `asof` handled before the strategy sees the slice | |
| forgetting | generations, retention modes | DS021 **mode `none`** (archive, no decay) or **pinned** retention for closed predicates; adaptive cooling and bounded generations make closed-world claims unsound for forgotten facts | a predicate can only be `closed` relative to a complete retained view |

Consequences: the exact SQLite bank (or exact sidecar) is the retrieval substrate for anything completeness-sensitive; the associative banks are for fuzzy candidate discovery and for cheap hints; the rule-dependency graph is a small exact structure (rules are far fewer than facts) that should be cached per theory version; retention policy must be consulted before a predicate is declared closed.

### 11.5 Iterative widening on failure

Every step is traced; one budget covers retrieval and reasoning (`maxProbes` for retrieval is separate from the strategy's own budget but both count against the effort level of section 6). The loop (implemented in `eval/smoke-reasoning/lib/widen.mjs`, run by cases `20` to `22`):

1. **Start small.** Slice with rule radius 1, one hop of constants, a per-predicate cap.
2. **Run** the strategy on the slice.
3. **Accept or continue.** Accept when the slice is complete (the rule levels and the constant expansion reached a fixpoint and nothing was truncated), or when the answer is a monotone positive existential that no missing wire can retract (judged on the desugared program: an answer that rests on a default conclusion is not monotone, 11.6). Otherwise (`unknown`, `incomplete`, `budget_exhausted`, `no_plan`, or any answer that depends on absence over an incomplete slice) widen.
4. **Name what is missing (targeted).** From the failed attempt compute the predicates that appear in a body but have neither facts nor producing rules in the slice, and retrieve exactly their whole support (rules by head, facts by the known constants) at once; for a truncated predicate that matters for completeness, switch to **keyed retrieval** (one lookup per known key) instead of scanning more. A **default** in the slice makes its head predicate (where the strict contrary `not p a` lives) and its exception predicates matter for completeness: before a default-derived row is accepted, the keyed lookups of `not p a` and of each exception atom for every candidate `a` must have completed (case `24`). A `why_not` result on the original query is the strategy-side way to obtain the same list: it names the missing premises.
5. **Abduce the support to look for.** If premises are still missing and `hypothesis` wires exist, `mode abduce` proposes the sets of hypotheses that would make the query hold; their atoms are retrieval targets ("does memory hold `verified zoe`?") and, if memory has nothing, they become clarification candidates, never facts.
6. **Blind widening** (the fallback when nothing is nameable): radius plus one, hops times two, cap times four.
7. **Ask the user.** When widening stops, answer `clarify` with the missing premises (what the host turns into one targeted question), never a guess.
8. **Stop rules**, all explicit and traced: the slice did not change after a widening step; the retrieval probe budget is spent (then `budget_exhausted`, not `unknown`); `maxSteps` is reached. An answer of `unknown` is reported as a real unknown only when the final slice was complete.

Trace of case `22` as produced by the harness (strategy `datalog-e10`):

```
step 1  radius 1 hops 1 cap 8   wires 15  sliceComplete false  truncated [blocked]  status supported  -> WITHHELD (unsafe: depends on absence of blocked)
step 2  radius 2 hops 2 cap 8   keyed [blocked]  wires 9  sliceComplete true  status supported  -> accepted, rows n1 n3 n4 n6
```

### 11.6 Correctness under partial retrieval (a rule of the proposal)

A partial slice makes a missing fact look false. The rules, to be enforced by the host and checked by the validator and harness:

- **R-P1 (monotone answers).** A positive answer derived without negation as failure, aggregates, counts or universal quantifiers over a partial slice remains valid when more wires are retrieved. "Without negation as failure" is judged on the **desugared** program: a default conclusion desugars into `absent x_*_blocked` and so is *not* an R-P1 answer; it falls under R-P2. It may be reported early with `complete: false`; its rows are a subset of the true rows. This holds because evidence is monotone under the paraconsistent reading of `both` (4.2 item 2): a later negative fact adds a `not p a` derivation and a `both` status to the answer, it never retracts the positive derivation; under the rejected alternative (a conflict blocks propagation) R-P1 would be false.
- **R-P2 (completeness-sensitive answers).** `absent p`, an `aggregate` over `p`, `mode count`, `mode every`, `no_plan`, optimum and any `unknown`/`refuted` obtained by failure are valid **only if** the predicates they depend on are (a) declared `closed` and (b) fully retrieved for the relevant keys: the retrieval reports `complete_for_view` for them and the exact view is complete under the retention policy. **For a derived predicate this is recursive** (4.2 item 4): every rule with that head must be in the slice (`rulesFor.complete`) and every body predicate must itself be complete for the keys that flow into it, which for a recursive predicate is the magic-set demand fixpoint; the validator flags `absent` over a derived predicate whose rule set is not entirely in the slice (`absent_over_incomplete_rules`), and widening treats a truncated rule set like a truncated predicate. **Default conclusions** (4.2 item 4) are in this class with a weaker requirement: for the generated `x_strict_<p>_neg` and `x_<d>_blocked` predicates and for the exception bodies, what is needed is **retrieval completeness for the keys** (`lookup(not p, keys).complete`, `rulesFor(contrary).complete`, a keyed lookup of every `except` predicate for each candidate), not that the world be closed. If no argument flows into a predicate that needs completeness, whole-predicate completeness is required. Otherwise the answer is **not** produced as such: it is withheld, widened, or reported `incomplete` with reason `partial_retrieval`, and finally `clarify`.
- **R-P3 (associative candidates never close a predicate).** RecallMemory and HoloMemory results are candidates; completeness for R-P2 can only come from an exact complete view (SQLite, scan, exact sidecar).
- **R-P4 (retention).** A predicate is `closed` only relative to a complete retained view; adaptive forgetting or bounded generations invalidate closedness for forgotten facts unless the predicate is pinned or archived.
- **R-P5 (reporting).** Every packet carries `retrieval: {complete, truncated, keyed, steps, wires, probes}`; a `supported` answer that rests on an incomplete slice says so.

Why it matters, measured by switching the guard off (`--unsafe-naf` in the harness study; case `23`, added in round 2, is the derived-predicate form: with only the base rule of `reach` in the first slice the strategy answers a, c, d where a and d is right, and the validator flags the first slice): in case `22` a capped scan misses `blocked n2` and `blocked n5`, and the strategy answers that **all six nodes are open** (two wrong). In case `20` a strategy given the first slice returns only `bob` of three ancestors. In case `21` it answers `unknown` for a claim that is supported two rule levels deeper. The guard is cheap: it withheld the unsafe answer and the loop converged in two steps.

### 11.7 What the harness measured

Simulated store held in memory (9,305, 3,904, 2,009, 910 and 304 wires; needed wires 5, 4, 9, 10 and 4 (facts, rules and defaults, without predicate declarations); probes are this store's own unit). Strategy: first live adapter that can express the case (`js-reference`, `js-reference`, `datalog-e10`, `datalog-e10`, `datalog-e10`). `recall` is the share of the case's needed wires present in the final slice.

| case | policy | steps | wires retrieved / stored | probes | recall | answer |
| --- | --- | --- | --- | --- | --- | --- |
| 20 look-alike facts | targeted | 3 | 5 / 9,305 | 29 | 100% | correct |
| | blind | 3 | 5 / 9,305 | 29 | 100% | correct |
| | whole predicates | 1 | 5,005+ / 9,305 | | | engine refused the slice (product parser limit of 2,048 wires) |
| | guard disabled | 1 | 3 / 9,305 | 4 | 60% | WRONG (only `bob`) |
| 21 missing premise | targeted | 2 | 4 / 3,904 | 18 | 100% | correct |
| | blind | 3 | 4 / 3,904 | 16 | 100% | correct |
| | whole predicates | 1 | 504 / 3,904 | 509 | 100% | correct |
| | guard disabled | 1 | 1 / 3,904 | 3 | 25% | WRONG (`unknown`) |
| 22 NAF over truncated predicate | targeted (keyed) | 2 | 9 / 2,009 | 37 | 100% | correct |
| | blind | 5 | 2,009 / 2,009 | 2,740 | 100% | correct |
| | whole predicates | 1 | 2,009 / 2,009 | 2,014 | 100% | correct |
| | guard disabled | 1 | 15 / 2,009 | 18 | 78% | WRONG (n2, n5 reported open) |
| 23 derived closed predicate, rule set cut | targeted | 2 | 10 / 910 | 33 | 100% | correct (a, d) |
| | blind | 2 | 10 / 910 | 33 | 100% | correct |
| | whole predicates | 1 | 10 / 910 | 17 | 100% | correct |
| | guard disabled | 1 | 9 / 910 | 16 | 90% | WRONG (a, c, d: c reported unreached) |
| 24 default, strict contrary hidden (round 3) | targeted | 2 | 4 / 304 | 24 | 100% | correct (tweety only) |
| | blind | 4 | 304 / 304 | 499 | 100% | correct |
| | whole predicates | 1 | 304 / 304 | 309 | 100% | correct |
| | guard disabled | 1 | 11 / 304 | 14 | 75% | WRONG (tweety and pingu: the default's conclusion for pingu is not retracted) |

Reading: targeted retrieval touched 0.05%, 0.1%, 0.4% and (case 24) 1.3% of the store with full recall of the needed wires; whole-predicate fetching is correct but scales with the predicate; blind widening can degrade to a full scan (case 22: 2,740 probes against 37); and disabling the completeness guard gives wrong answers in every case (including the default of case `24`). Limits of this evidence: an in-memory simulation of a few thousand wires, five hand-made cases (`20` to `24`), one pull-free delivery mode, and **probe counts only**: the simulated store counts lookups, not I/O, cache behaviour or index sizes, so it supports the design rule, not a scale claim. The 10^8 to 10^9 stores in the plan below are likewise implicit generators measuring lookup counts; a **real 10^7-row SQLite bank** with its four composite indexes is added to the plan so that at least one scale point measures disk and index costs.

### 11.8 Evaluation plan for retrieval at scale

Preregistered (DS007), staged with early stopping (AGENTS.md). Memory sizes **10^3, 10^4, 10^5, 10^6 materialised** (real SQLite bank and scan baseline, E10's 1M-fact ring components, VRC's 1M background facts as sources of shape) and **10^7 materialised in a real SQLite bank** (disk and index costs) and **10^8 to 10^9 simulated**: an implicit store whose wires are generated deterministically per (predicate, constant) so lookups cost what an index lookup costs without storing 10^9 rows; only the indexes are measured, claims about 10^9 are made for retrieval cost and recall, never for reasoning time.

Hard-distractor design: look-alike facts over the needed predicates about other entities (as in case 20), high-degree hub constants, very common predicates (SInE's frequency problem), predicate names that collide across domains, near-duplicate vocabulary, facts that become relevant only at depth k of the rule graph, and `closed` predicates with a few relevant negatives hidden among millions of irrelevant ones (case 22).

Metrics, all logged per query and per strategy: **recall of needed wires** (needed set known by construction); **precision** (needed over retrieved); **answer correctness as memory grows** (agreement with the reference run on the full memory at small sizes, with the generator's oracle at large sizes); **share of answers wrongly negative or wrongly positive because of a missing fact** (the headline safety metric, expected zero with the guard and measured without it); **steps and probes to convergence**, the share of queries that end in `clarify` (the expected `clarify` rate on real memories is itself a result to report: a guard that clarifies too often is a usability defect), and latency targets for chat (a first answer or an honest `clarify` within seconds, with the effort budget of section 6 scaling the rest); **latency per step** (retrieval, strategy, total; cold and warm; preparation counted); **retrieval cost against the work saved**.

Baselines for premise selection: whole-predicate fetch, predicate radius only, constant hops only (case 20's `blind`), SInE-style symbol triggers with a frequency tolerance, MePo-style scoring with a decaying pass mark, and later a learned selector (MaSh/DeepMath style) trained from the logs, using the same discipline as the learned router (section 10.4: it may only reorder or widen, never accept an answer). Hypotheses: (H6) targeted widening reaches full recall of the needed wires touching under 1% of the store up to 10^6 wires; (H7) with the guard, wrongly negative answers are zero at every size; (H8) a SInE-style frequency tolerance beats plain radius on hub-heavy memories; (H9) widening plus why-not names the missing predicate in at least 90% of the failed first slices on the generated classes. Falsification and futility rules are written before the runs, as for the router.


---

## 12. Plan: evaluations on larger problems and problem classes

Stages with entry conditions; each stage ends with a report in `eval/reports/current/` and a journal entry. Card ids refer to `advanced_research.md`; N-ids to the backlog of Appendix D.

| stage | work | gate to continue |
| --- | --- | --- |
| 0 (done here) | smoke suite (79 cases), validator with desugared-program check, host rules (per-row verified `conditional`, verified `used` with oracle replay), adapters, planned stubs, Z3 probes | owner review of this proposal, after the reviewer is satisfied |
| 1 | implement the core in the product behind a flag: parser and lowering for `absent`, `compare`, `compute`, `aggregate`, `default`, `integrity`, `closed`, arity 0 to 6, roles on `predicate`, the new modes, governance filter, `conditional` list; capability declarations; `budget_exhausted` with reasons; keep the old wires working. **Complete the deliberately naive oracle of every core feature** (`js-oracle`, `reasoning/strategies/js-reference/`: in progress, 59 of the 59 cases it declares pass; entry condition for every other strategy; the existing `js-reference` stays the bounded product strategy until the owner decides). Add the **lint pass** (the authoring risks of 13.1) and the **differential-compilation probe** (independent compilations of one source must agree on probe queries). Adapters for the sop-r and VRC engines (plain Node). **The smoke suite becomes a `tests/` gate** | smoke passes on `js-oracle` for everything it declares (and on `js-reference` for everything that one declares); validator integrated; lint and probe run on the pilot source |
| 1a | **authoring-fidelity probe** (writability is the central product hypothesis and shapes the grammar before engines are built): coding agents write wires for three short sources (a manual, a regulation, an article) under the isolation protocol; measure validator errors per wire, role and orientation errors, `not` written for `absent`, forgotten `closed`, rule versus default, reification of n-ary events, and differential agreement; revise the grammar before stage 2 | validator-clean rate and differential agreement reported; grammar changes recorded |
| 1b | retrieval layer in the product: `rulesFor` (with `complete`), `count`, `closed`, `lookup` completeness per predicate over the exact banks (including keyed lookups of strict contraries and exception atoms for default conclusions); structured slice delivery and fact-source delivery; the R-P1 to R-P5 rules enforced by the host; the hub-constant policy | cases `20` to `24` pass on the real SQLite bank; zero wrongly negative answers |
| 1c | modes of work in the product: governance fields and the `wires in force` selection, `procedure`, `amendment`, `argument`, `trace`, the host negotiation loop with journal writes on approval; the conditional lowering for proposed wires | cases `35c`, `35d` pass on the product strategies that declare `compare_in_rules`; the host loop tested without a planner |
| 2 | the lowering of `conform` to core rules (8.4), first, because it is cheap and gives a live audit on every Datalog strategy (cases `37a` to `37d`); then `prolog-tabling` (private SWI exists) consuming the core; shadow against `js-reference` on the smoke and generated sets; cases `06d`, `13b` (abductive meta-interpreter); then `sql-sqlite` (a Datalog to SQL compiler, controlled against E10's hand-written SQL) | zero disagreements on decided cases (R05-style metamorphic tests: renaming, permutation, irrelevant facts; and paraphrase tests of the host linking) |
| 2a | `htn-strips-planner`: the acceptance tests are cases `11c`, `30a` to `39b`, with the automaton check for trajectory norms; then `golog-swi` for strict procedures and `check`; `asp-clingo` (private clingo 5.8.2 is available; adapter to write) | the hand-derived expected answers of the modes-of-work family are confirmed or corrected by the shadow run, with every correction recorded |
| 2b | retrieval at scale (section 11.8): 10^3 to 10^6 materialised, 10^7 in a real SQLite bank, 10^8 to 10^9 simulated; hard distractors; premise-selection baselines (SInE, MePo) | H6 and H7 hold, or the design is revised |
| 3 | Fair external comparison, card R02: Soufflé (private 2.5 is available; adapter to write), SWI tabling, E10, soplab, `sql-sqlite` on a fixed corpus of 12 families (recursion shapes, selective vs bulk joins, NAF layers, aggregates, defaults, transitive closure with the native template as a control) times at least 30 instances, sizes 10^3 to 10^6 facts; the nine VRC `.pl` exports with row-count agreement as one of the families; coverage-cost-guarantee matrix, not a single score; incompatible exports marked INCOMPATIBLE; skipped never enters medians | matrix published; interleaved cold/warm runs; preparation cost counted |
| 4 | Class sweeps: planning (`11` family scaled, VRC worlds, R20-R21 weights, R25 temporal monitors), numeric (Z3 vs enumeration, R33 exact arithmetic, R35 discovery limits, the numeric action extension E2 and `vrc-compressed-planning` with the guard-rich control), epistemic (R47), abduction and what-if (R27, N06, N07), many hypothetical worlds (sop-r `worlds` with its 1,200-answer incremental test plus a non-monotone case, R17 mutable worlds), the call provider leaf E1 (N11) | per class: best strategy, regret of the rule router |
| 5 | Real material: coding agents compile 3 sources of at least 20,000 words (a manual with procedures, an article, a regulation with exceptions) into wires under the isolation protocol (compiler never sees questions; updater never sees old text; querier never sees the source), with independent compilations and differential testing (sop-r) to localise errors without gold, plus a direct-LLM baseline and RAG baseline (sop-r E2). Metrics separate source fidelity from reasoner correctness (R46), and include the `conditional` correctness (does the list name exactly the assumptions needed) and the `clarify` rate on real memories | stop criterion from sop-r: under 70% of normative sentences compiled, or uncontrolled vocabulary drift, abandons this form |
| 6 | Router: log collection from stages 2 to 5, rule router baseline, portfolio, learned selector; preregistered regret metric | learned beats rule router at equal budget on held-out classes, else keep the rules |
| 7 | Dreaming: consolidation on repeated query families (E10 Dreamer; R28 budgeted dreaming with net cost counted); `prepare`/`dream` in the interface; the four records and the acceptance rule of 5.6; the native closure template as a measured router rule (N04, N05, N18) | net saving including failed attempts |

**Order of the strategy stages.** After the oracle (`js-oracle`) is complete, the reviewer's round-2 recommendation (14.10) is: `conform` lowered to core rules first (stage 2, first item), then `htn-strips-planner` (2a), then `sql-sqlite` (2), with `prolog-tabling` after them for `06d` and `13b`; the table lists the stages by theme, not by this order.

Hypotheses worth preregistering: (H1) strategies agree on all decided smoke and generated cases (zero disagreements); (H2) the best strategy differs by class (no single strategy is within 2x of the oracle on all classes); (H3) rule routing recovers at least 80% of the oracle's saving; (H4) a learned router adds a practically relevant margin over rules; (H5) knowledge compiled by independent LLM runs agrees (differential agreement above 95% of probes) on real text, and a coding agent can reach 70% normative coverage; (H10) coding agents write validator-clean wires at a rate that the lint raises to an acceptable level without grammar changes after stage 1a (writability); (H11) the host linking is metamorphically stable: paraphrases of one question link to the same circuit in at least 95% of cases. Each has a falsification and a futility rule written first.

Cards reused as they are: R01 pilot without cherry-picking, R02 fair comparisons and attribution, R03 automatic selector (precisely the router), R04 many active rules, R05 adversarial and metamorphic audit, R18 batching and demand, R21 weighted costs, R22 adversarial nondeterminism (later), R23 probabilities (later), R24 counting of proofs (later), R25 temporal monitors, R27 abduction and counterfactuals, R28 budgeted dreaming, R31 robust registry, R36 security of the learning path, R45 neural proposals with mandatory verification, R46 NL ingestion fidelity, R47 epistemic statuses, R48 role transfer (much later). Cards that only make sense for VRC internals (R06 to R16 and R37 to R44) stay with the VRC track.

---

## 13. The learning side: coding agents write wires, SymbolicLM queries them

### 13.1 Authoring from a source

**The material an authoring LLM needs is extracted into one self-contained page, [`wire-authoring-guide.md`](wire-authoring-guide.md)** (3 to 4 pages): the lexical rules, the grammar (the block between its markers is generated by `node eval/smoke-reasoning/validator.mjs --grammar-compact`, from the same data as Appendix A), worked examples drawn from the smoke cases for facts, rules, the two negations with `closed`, defaults, aggregates, time, methods, norms and governance (each example passes the validator), the seven mistakes below, and the mandatory loop. This section is the rationale; the guide is the prompt.

A coding agent (a capable LLM) reads a book, article or manual and writes knowledge circuits. The wires are chosen to be intelligible to it:

- English words for operators (`above`, `plus`), one keyword per line, no parentheses, no commas; the same shapes the agent already knows from Prolog, Datalog or JSON.
- One idea per wire, one relation vocabulary declared up front with `predicate` wires **with roles and types** (so arity, orientation and kinds are checked), general statements as rules rather than lists of facts, exceptions as `default ... except`, "must never hold" as `integrity`, "must never be done, must be done by" as `norm`, procedures as `method` plus `action` (versioned and, once reviewed, approved), totals as `aggregate`, quoted source text in `quote`/`source` for provenance.
- A prompt skeleton: the authoring guide (grammar generated from the validator, the modelling rules above, worked examples, and a mandatory loop): write, run the validator in its authoring mode (`--authoring`, 8.2), write at least one test query per rule and per procedure including a blocked case, fix every validator error and warning, report what could not be expressed. This is sop-r's compile-lint-selftest-repair loop, whose lint ("a relation is never asserted or derived") detected vocabulary drift.
- Isolation protocol and differential compilation (sop-r): independent compilations of the same source must agree on probe queries; disagreements localise ambiguity or error.
- Acceptance lifecycle (soplab's KNOWLEDGE_INGESTION): proposed, syntactically valid, locally validated, validated on independent probes, accepted by the host, contested, superseded. The lifecycle is now carried by the governance fields of 8.2 (`approval proposed|approved|contested|rejected|superseded|retired`, `approved_by`, `approved_at`, `supersedes`); an author never writes the approval fields (a submitted wire is `proposed`; ingestion writes `approved`); knowledge enters memory as `approved` only after host approval (AGENTS.md direction 4); a rule or wire set never writes itself. Updates use `supersedes`/`overrides` semantics (append-only).

**The seven authoring risks, and the lint that catches them.** Writability is the central product hypothesis, so the risks are stated and checked before engines are built (the lint and the differential probe belong to stage 1 of the plan, and the fidelity probe to stage 1a):

| risk | what goes wrong | check |
| --- | --- | --- |
| `not` written where `absent` is meant | explicit negative evidence is asserted for what is merely unrecorded; a conflict never appears | lint: `not p` in a body when no negative fact or rule for `p` exists anywhere in the knowledge |
| arity and argument-order drift | the same relation used as `works_at person firm` here and `works_at firm person` there; the sop-r pilot's one error | `predicate` with `role:type` arguments; validator `type_mismatch`, `arity_mismatch`; the differential probe compares role placement |
| floats and units | `0.5`, `3 hours` written where the language has integers in cents and minutes | validator `bad_term`; the prompt states the units |
| priorities | global integers chosen inconsistently across chapters | prefer `overrides`; lint on `priority` used without a contrary default |
| forgetting `closed` | an `absent` that is rejected, or an aggregate that comes back as a lower bound | validator `absent_needs_closed`, `count_needs_closed`, `aggregate_needs_closed`; the host review step declares closedness |
| conflating rule and default | "usually" written as a rule (a conflict becomes `both`) or an exceptionless law written as a default | lint: a `default` without any exception or contrary; wording check on "usually", "normally", "always" in `quote` |
| reification of n-ary events | events with more than six participants flattened ad hoc | the arity limit is 6 for knowledge wires; the prompt shows one reification pattern |

### 13.2 Memory and answering

Accepted wires go to memory (DS005, DS016 to DS021). A user request reaches SymbolicLM, which emits the query surface; the host links strings to the vocabulary, retrieves the relevant theory slice, picks a strategy (explicit or by the router), runs it under the effort-scaled budget and renders the packet in the answer language. The same pipeline is the API: a caller sends natural language or an explicit `.sop` query and receives the packet with `status`, `complete`, `conditional`, `used`, evidence and route. The system is a symbolic LLM in the sense the owner means: the formalization is neural or rule-based (SymbolicLM on the query side, coding agents on the learning side), the reasoning is exact and auditable, and unknown stays unknown.

### 13.3 Honest limits

sop-r's pilot compiled a clean fictional text of 980 words; its compiler saw the vocabulary. Real text brings ambiguity, implicit knowledge and vague predicates; the proposal does not claim coverage, only a method to measure it (stages 1a and 5). The three-term limit of sop-r is not inherited, and the knowledge arity is six; n-ary events beyond six arguments need reification (13.1). A procedure written from a manual is only as good as the manual: the governance fields make it traceable (`source`, `quote`, `approved_by`) and amendable, not correct.

---

## 14. Open questions for the owner

One list. For each question: the question, the reviewer's answer (round 1, with the addendum's changes), **the reviewer's round-2 recommendation where there is one (marked *Reviewer, round 2*)**, and the recommendation of this revision. Items marked **(round 2)** are new or changed by the review; items marked **(round 3)** are new in this revision.

1. **Core, sugar and modes of work.** Accept `default` and `integrity` as sugar that desugars into stratified NAF rules (so engines without them are `not_expressible`) with the desugared program as the normative semantics (a native ASP implementation accepted only if it agrees in shadow on stratified programs), and the modes-of-work wires as plan-level knowledge that only planners, Golog, ASP and bounded Z3 declare? *Reviewer: accept; fix `applies`/`fire` first (done: fire).* Recommendation: accept.
2. **(round 2) The meaning of `both`.** Positive and negative evidence propagate independently and `both` is only a reported status (Belnap-style, monotone, R-P1 holds), or a conflict blocks propagation (non-monotone; every negative fact becomes completeness-sensitive)? *Reviewer: recommends the first. Reviewer, round 2: accept the paraconsistent reading; it is the only choice that makes answering from a partial slice safe.* Recommendation: the first, as written in 4.2.
3. **Two negations and `closed`.** Accept `absent` only on predicates declared `closed true`, and `not` as explicit evidence only; a per-theory flag may exist as sugar; a `select`/`exists` on a closed, non-derivable predicate over a complete view returns `refuted`, not `unknown`; closedness is declared by a host review step (the coding agent may propose it with the source sentence that asserts exhaustiveness), never automatically, and only over an archive (`retention none`) or pinned view so that forgetting cannot turn a fact into a false `absent` (R-P4). *Reviewer: accept all. Reviewer, round 2: closedness is declared by host review only, over archived or pinned retention; the SQLite bank is the substrate for completeness-sensitive retrieval (and, with round 3, for the keyed lookups that default conclusions need, 4.2 item 4).* Recommendation: accept.
4. **New query modes.** Accept `why_not`, `plan`, `abduce`, and (round 2) `conform` and `procedure` as declarative modes SymbolicLM may emit (questions, not operations), rather than host-only wires? *Reviewer: accept.* Recommendation: accept.
5. **Defaults versus explicit contrary facts.** A strict contrary blocks the default automatically (strict knowledge sits below all defaults); only default-derived contraries go through `overrides` or priority; the Nixon diamond stays `both`. *Reviewer: accept (stratifiable, validator-checkable).* Recommendation: accept, as built in the desugaring (cases `09b`, `09d`, `09e`).
6. **Strategy ids and `advanced` (the two reviewer answers differ).** Replace `policy.reasoningStrategy` by strategy ids with capability declarations; keep `reference` as an alias of `js-reference`. For `advanced`: the first answer says *deprecate with a warning rather than redefine it as `auto`*; the addendum says *alias `advanced` to `auto` with a deprecation note in `route`; the owner decides*. **Chosen here: keep `advanced` with its current meaning, deprecated with a warning in `route`; add `auto` as a new name** (no silent change for existing callers). Alternative: alias `advanced` to `auto`. This changes DS006, DS010 and the wire help (`reason`, `solve`). *Reviewer, round 2: keep `advanced` with its current meaning, deprecated with a warning, and add `auto`* (the choice made here).
7. **Closed-world questions from the small model.** `polarity negated` on a closed predicate is linked by the host: first an explicit `not` fact, then `absent` over a complete view; `refuted` when the atom is not derivable over a complete view, otherwise `unknown`; render "no record of" with the source of the closedness. *Reviewer: accept (addendum: the refuted-or-unknown rule).* Recommendation: accept.
8. **`fact.valid` optional, `status` and `speaker` first-class.** *Reviewer: accept; (addendum) `valid` defaults to `timeless`.* Recommendation: accept.
9. **`budget_exhausted`** as a status with `reason` (`rounds probes horizon depth domain wall cancelled numeric_range`) and `at_least` bounds for partial counts; the rule that an incomplete result may never read as `unknown`, `refuted`, `no_plan` or `optimal`; budget keys honoured per strategy. *Reviewer: accept, add the reasons.* Recommendation: accept.
10. **Which strategy first. DECIDED by the owner (2026-10-01): conform lowered to core rules first, then the `htn-strips-planner` with procedures and norms, then `sql-sqlite`.** (The text below is the history of the question.) *Reviewer: `prolog-tabling`, on the precondition that `js-reference` first implements the full core naively as the shadow oracle; then `htn-strips-planner` (extended per section 8: the acceptance tests are `30a` to `37b`); then clingo, acquired before Soufflé.* *Reviewer, round 2: order after the `js-reference` oracle: `htn-strips-planner` first, then `sql-sqlite`; lower `conform` to core rules first (it is cheap and gives an immediately useful audit); accept the 8.8 naming set (14.16).* Recommendation of this revision: **follow the round-2 order** (conform lowering, then the planner, then `sql-sqlite`, with `prolog-tabling` after them for `06d` and `13b` and `golog-swi` after the planner), which supersedes the round-1 tabling-first order; wiring sop-r and VRC as adapters is cheap (plain Node).
11. **Arity.** Keep 4 on the model surface; 6 for knowledge wires, with 0 allowed. *Reviewer: accept.* Applied in 4.1.
12. **Sets versus bags in `aggregate`.** Sets of bindings of all `over` variables; two people with the same salary count twice because the person variable is in the group; a `bag` option can come later. *Reviewer: accept.* Recommendation: accept.
13. **Effort mapping.** Three levels; the host owns the floors and ceilings; effort scales retrieval and strategy budgets together; the model never sets a budget. *Reviewer: accept.* Recommendation: accept.
14. **Routing default.** A request that names no strategy stays on `js-reference` until the router has passed its preregistered test; route automatically only when `js-reference` declares a needed feature unsupported and exactly one capable strategy exists. *Reviewer: accept.* Recommendation: accept.
15. **Software for comparison.** Private clingo 5.8.2 and Soufflé 2.5 are now both present under `tools/.solvers/` (nothing installed system-wide); their adapters (`asp-clingo`, `datalog-souffle`) are still planned. *Reviewer (earlier): clingo first (a single small MIT binary); Soufflé is optional and harder to build, so defer it.* Recommendation: write the `asp-clingo` adapter first (defaults, integrity, abduction, norms are native), then `datalog-souffle` for `06d` and bulk joins; neither before the order of 14.10 reaches it.
16. **(round 2) Modes-of-work naming** (section 8.8). The two reviewer answers agree on substance and differ in naming; chosen: qualifiers on `norm` (not a `trajectory` wire); governance fields on every wire plus a thin `procedure` bundle (not a bundle that carries the approval); `choose` and `on_failure` (not `any_of` and `on_fail`); both `mode conform` and the call `check`; the field `approval` (not `status`); `binding` per wire; `amendment` as an envelope of proposed versions plus `argument`. Alternatives: a separate `trajectory` wire; approval on the `procedure` only. *Reviewer, round 2: accept the 8.8 naming set.* Accept the chosen set (round 3 adds `rejected` to the approval vocabulary and `action` to the governed wires)?
17. **Where the grammar lives.** The proposal's grammar is data in `eval/smoke-reasoning/validator.mjs`; when approved it moves to `sop/` as the single source (as `sop/enums.mjs` is for the model surface), and DS004, DS006, DS010, DS014 and the wire help pages are regenerated from it. *Reviewer: accept.* Recommendation: accept.
18. **`FactSource` contract.** Accept `lookup`, `rulesFor` (with `complete`), `count`, `closed` as the pull interface (the existing retrieval contract of DS005 plus three calls) and `delivery: slice | source | both` as a capability. `closed` and `count` are implemented by the SQLite bank, scan and the exact sidecar; RecallMemory and HoloMemory return `declared: false` and estimates only. *Reviewer: accept.* Recommendation: accept.
19. **Embedding index for vocabulary.** FTS5 plus the dictionary now; an embedding proposer later, lexicon side only (predicate and entity candidates, never premises for negation or counting), behind a flag. *Reviewer: accept.* Recommendation: accept.
20. **Slice size and the parser limit.** Deliver slices as structured objects that bypass the parser; `maxWires` is an author-surface limit; stream for pull engines. *Reviewer: accept.* Applied in 11.3.
21. **Who widens.** The host (outside every strategy, so that every strategy gets the same guard); pull-capable strategies report `complete_for_view` through the FactSource flags and the host applies R-P2. *Reviewer: accept.* Recommendation: accept.
22. **Premise-selection scope.** Exact rule radius, constant hops and a SInE-style frequency tolerance first; learned selectors only after logs exist, only to reorder or widen. *Reviewer: accept.* Recommendation: accept.
23. **(round 2) Who approves.** Approval of a wire (`approval approved`, `approved_by`, `approved_at`) is a host write recorded in the journal; who may approve a procedure or a norm (the owner only, a named role, any user for their own scope) is a policy the proposal does not decide. *Reviewer, round 2: the owner approves norms and strict methods; a named role approves advisory methods and defaults; users only propose; a contested wire keeps binding until the host rules.* Recommendation: the same, as written (8.2 gives the contested rule).
24. **(round 2) Extensions from the inventory.** Keep the `call` provider leaf (E1) and the numeric `action` with rational terms (E2) as extensions outside the core until an experiment shows them paying; the native closure template as a router rule, not a strategy; `sql-sqlite` and `golog-swi` as candidate strategies. Accept?
25. **(round 2) Name collision of `trace`.** The research wire `trace` of the current product and the proposal's `trace` (a performed action sequence) share a name. Recommendation: the proposal's wire is `trace` in the knowledge language and the research wire is renamed or namespaced if both survive.
26. **(round 3) Defaults chosen in round 3 that the owner may overrule.** (a) A `contested` wire keeps binding, flagged, until the host rules (the alternative: a contested wire stops binding, which lets any objection switch a prohibition off); (b) `scope` fails safe: a scoped norm with no established context scope binds and the packet sets `scope_unknown: true` (a field of 5.3); (c) an obligation instance exists only for bindings bound by the goal's arguments or by an executed action; a standing obligation over a whole predicate must be written with the marker line `standing` and is reported `obligation_unscoped`; (d) an advisory hard norm is a relaxable hard constraint (8.2 matrix); (e) when leave-one-out is not exact the conditional list is *all* assumptions with `conditional_unknown` (the alternative: grow the set greedily to one sufficient set and say the minimal set is not unique, which gives a shorter but arbitrary list). Recommendation: accept (a) to (e). Review round 3 agreed all five: (a) contested binds, flagged; (b) scope fails safe, with `scope_unknown` in the packet; (c) obligation instances come from goal or action bindings, with the marker syntax now defined; (d) an advisory hard norm is relaxable; (e) all assumptions with `conditional_unknown`. Added in round 3: `binding` defaults to `strict` (8.2).

---

## Appendix A. The grammar (generated by `node eval/smoke-reasoning/validator.mjs --grammar`; a compact form for authors: `--grammar-compact`, used by the authoring guide)

Governance fields (`version supersedes approval approved_by approved_at retired_at scope quote`) are listed once per wire type that carries them. `pack` is host plumbing: it bundles values for the runtime (the `world`, `actions` and `candidates` packs of the adapters), is not a knowledge wire, and is never written by a coding agent or by SymbolicLM; it stays in the grammar only so that circuits the runtime accepts today still validate.

| wire type | status | essence | fields (`*` required, `+` repeatable) |
| --- | --- | --- | --- |
| `predicate` | existing, extended | Declares a relation: arguments as role:type (closed role inventory, types entity integer text time value), closed-world flag, optional key position (lint), advisory routing hints (transitive, inverse) and unit. | args*, closed, key, transitive, inverse, unit, description |
| `fact` | existing, extended | One ground claim with validity, epistemic status, speaker, source and quote. | holds*, valid, status, speaker, source, quote |
| `rule` | existing, extended | Definite implication; the body is a condition group (atoms, not, absent, compare, compute, order, start_of, end_of, all/any). | when*+, then*, mode, valid, source, governance (version supersedes approval approved_by approved_at retired_at scope quote) |
| `default` | new | Defeasible rule: applies unless an exception holds, a strict contrary is derived, or an overriding default fires. | when*+, then*, except+, priority, overrides+, source, governance (version supersedes approval approved_by approved_at retired_at scope quote) |
| `integrity` | new | A pattern that must never hold in a state; each match derives violation ID WITNESS (arity 2), never an explosion. | never*+, witness*, message, severity, source, governance (version supersedes approval approved_by approved_at retired_at scope quote) |
| `aggregate` | new | Defines a derived relation by grouping a condition group and applying count, sum, min, max or collect. | over*+, group, count, sum, min, max, collect, yields* |
| `constraint` | existing (words-only form) | Finite or numeric arithmetic problem: variables, requirements, claim, objective. | var+, require+, claim, objective, direction, task, select, unit |
| `action` | existing | STRIPS-style state transition: preconditions, add and remove effects, cost. Governed like a method (round 3): preconditions and effects come from the manual and are amended the same way. | params, requires*+, adds+, removes+, cost, source, governance (version supersedes approval approved_by approved_at retired_at scope quote) |
| `method` | new, extended in round 2 | Procedure for a task: guard, then steps (primitive, sub-task, achieve, optional, choose, any_order, if/else, until with max, pick), preference, failure handling, binding and governance. | achieves*, when+, step*+, prefer+, on_failure, triggered_by, binding, cost, source, governance (version supersedes approval approved_by approved_at retired_at scope quote) |
| `norm` | new (round 2) | Deontic rule over actions or states: forbid, oblige or permit a pattern, with condition, one temporal qualifier, severity, overrides and governance. | forbid, oblige, permit, when+, within, before, after, always, sometime, at_most_once, severity, cost, priority, overrides+, binding, message, source, governance (version supersedes approval approved_by approved_at retired_at scope quote) |
| `procedure` | new (round 2) | A named bundle of wires (a mode of work): members, scope, description. It has no approval of its own; the members carry approval. | members*+, description, scope, source |
| `amendment` | new (round 2) | A proposed change to a procedure or wire: proposed member wires (approval proposed, usually superseding a version), removals, reason and review state. | of*, proposed_by*, members+, removes+, reason, approval, evaluated |
| `argument` | new (round 2) | A reason for or against a wire or amendment, with source and optional cost delta; evidence for the negotiation, never evidence of facts. | for, against, claim*, source, cost_delta |
| `trace` | new (round 2) | A performed sequence of ground action steps, the input of mode conform. A step may end with "at DATE" (round 3): it is then judged against the versions in force at that date. | step*+ |
| `goal` | existing | A desired conjunction for planning. | where*+ |
| `hypothesis` | existing, extended | A candidate assumption for abduction or what-if (an atom, or waive a norm at a cost); never evidence. | holds, assume+, waive+, cost, status, source |
| `policy` | existing, extended | Host budget and mode of work: resource limits only tighten; effort, partial answers, context scope tags, procedures in force (methods and rendered set), objective and default binding. | effort, partial, procedures+, scope+, objective, binding, maxNodes maxDepth maxHypotheses maxCandidates maxPlans maxRounds maxFacts maxJoins maxAssignments maxFanout timeoutMs |
| `stated` | existing (model surface) | Model-surface supposition used by if/unless links of a query (what-if). | relation*, role+, polarity, valid, certainty, speaker |
| `query` | existing, extended | The question. Modes select, exists, count, explain, every are existing; why_not, plan, abduce, conform and procedure are new; time is at (instant), during (throughout), overlaps (some instant), asof (known at). | where+, select, mode, scope+, at, during, overlaps, asof, trace, via+, compare+, order+, rank, filter+, measure, quantifier, except+, limit, policy, link keywords (because so if unless although so_that before after when while) |
| `pack` | existing | Bundles values (host plumbing; not a knowledge wire). | items*+ |

Condition leaves (inside `when`, `never`, `over`, `where`, `scope`, `except`): an atom, `not ATOM`, `absent ATOM` (closed predicates only), `compare A WORD B`, `compute ?v A WORD B`, `start_of ?t ATOM`, `end_of ?t ATOM`, `order ?t1 WORD ?t2`, and the groups `all` and `any` closed by `end`. Method step forms: 8.2. Lexical rules, namespace and the reserved `x_` prefix: 4.1.

## Appendix B. The smoke cases

79 cases. Each folder `eval/smoke-reasoning/cases/<id>/` holds `knowledge.sop`, `query.sop`, `expected.json`, `README.md`. Expected files are strategy-neutral: `status`, `complete`, `rows`/`rows_subset_of`, `count`, `bound`, `reason`, `conditional` (a list of assumption ids), `row_conditional` (per row), `nonmonotone`, `conditional_unknown`, `witness`, `objective`, `plan`, `hypotheses`, `explain`, `missing`, `used` (the governed wires that must be reported), `used_support` (the inclusion-minimal sufficient sets) and `used_incomplete`, `compliance` (with `deviations`), `blocked_by`, `relaxed`, `obligations_triggered`, `procedure`, `acceptable_if_incomplete`, `budget`, `warnings` (the validator warnings the case declares), plus `requires` (features). Covered: facts and lookup (`01`, `01b` zero arity, `02a`, `02b`), rules and chaining (`03`), recursion and transitive closure (`04`, `04b` the completion caveat), classical versus failure negation (`05a`, `05b`, `05c`), constraints and arithmetic (`06a` to `06d`), aggregation and counting (`07a` to `07d`, the last a lower bound over an open predicate), quantifiers (`08a` to `08d`, the last an open domain), defaults and exceptions (`09a` to `09e`: exception, unresolved conflict, priority, strict contrary, overrides by fire), contradictions, epistemic status and conditional lists (`10a` to `10f`, the last the a/b/c counterexample), procedures and plans (`11a` to `11c`), temporal facts (`12a` to `12g`: instant, overlaps, throughout, derived atoms, time variables, count throughout), explanation and proof (`13a`, `13b`) and the support set `used` (`13c`, `13d`), abduction and hypotheticals (`14a`, `14b`), budget exhaustion (`15a` to `15c`), integrity (`17`), retrieval from a distractor memory with widening and the partial-retrieval guard (`20` to `24`; these carry a `memory.json` that generates the distractor store; the harness reports wires retrieved against wires needed; `23` is the derived closed predicate with a cut rule set, `24` a default whose strict contrary is hidden), the router-reset mode of work (`30a` to `30d`, `36`, `37a` to `37d`), method control forms (`31a`, `31b`), norms (`32` trajectory, `33` soft obligation, `34` permission, `38` obligation scoping, `39a` advisory hard norm, `39b` equal-strength conflict), versioned procedures and rules (`35a` to `35d`).

## Appendix C. References

Cited with a source check (web search, 2026-10-01): Xu, Hutter, Hoos, Leyton-Brown, "SATzilla: Portfolio-based Algorithm Selection for SAT", JAIR 32, 565-606, 2008. Scott, Niemetz, Preiner, Nejati, Ganesh, "MachSMT: A Machine Learning-based Algorithm Selector for SMT Solvers", TACAS 2021. Lindauer, Hoos, Hutter, Schaub, "AutoFolio: An Automatically Configured Algorithm Selector", JAIR 53, 745-778, 2015. Katz, Sohrabi, Samulowitz, Sievers, "Delfi: Online Planner Selection for Cost-Optimal Planning", ICAPS 2018.

Cited from memory, to be verified before publication. Round 1: Rice, "The algorithm selection problem", Advances in Computers 15, 1976. Kotthoff, "Algorithm selection for combinatorial search problems: a survey", AI Magazine 35(3), 2014. Helmert, Röger, Karpas, "Fast Downward Stone Soup", IPC 2011; Seipp, Sievers, Helmert, Hutter, "Automatic configuration of sequential planning portfolios", AAAI 2015. Bancilhon, Maier, Sagiv, Ullman, "Magic sets and other strange ways to implement logic programs", PODS 1986; Beeri and Ramakrishnan, "On the power of magic", J. Logic Programming 10, 1991. Chen and Warren, "Tabled evaluation with delaying for general logic programs", JACM 43, 1996. Apt, Blair, Walker, "Towards a theory of declarative knowledge", 1988. Van Gelder, Ross, Schlipf, "The well-founded semantics for general logic programs", JACM 38, 1991. Gelfond and Lifschitz, "The stable model semantics for logic programming", ICLP 1988. Gebser et al., "Multi-shot ASP solving with clingo", TPLP 19, 2019. de Moura and Bjørner, "Z3: an efficient SMT solver", TACAS 2008. Fikes and Nilsson, "STRIPS", AI 2, 1971. Erol, Hendler, Nau, "HTN planning: complexity and expressivity", AAAI 1994. Kakas, Kowalski, Toni, "Abductive logic programming", J. Logic and Computation 2, 1992. Console, Dupré, Torasso, "On the relationship between abduction and deduction", J. Logic and Computation 1, 1991. Reiter, "A logic for default reasoning", AI 13, 1980. Allen, "Maintaining knowledge about temporal intervals", CACM 26, 1983. Hoder and Voronkov, "Sine Qua Non for Large Theory Reasoning", CADE 2011. Meng and Paulson, "Lightweight relevance filtering for machine-generated resolution problems", J. Applied Logic 2009. Kühlwein, Blanchette, Kaliszyk, Urban, "MaSh: Machine Learning for Sledgehammer", ITP 2013. Alemi et al., "DeepMath", NeurIPS 2016.

Added in round 2 (the reviewer's list), with what each is used for. Clark, "Negation as failure", in Logic and Data Bases, 1978: the completion of a program, the basis of the finite-domain Z3 lowering and of its recursion caveat. Lin and Zhao, "ASSAT: computing answer sets of a logic program by SAT solvers", Artificial Intelligence 157, 2004: loop formulas that repair completion for recursive programs. Przymusinski (1988; the exact paper named by the reviewer is to be verified; for classical negation beside negation as failure see also Gelfond and Lifschitz, "Classical negation in logic programs and disjunctive databases", New Generation Computing 9, 1991): a second, explicit negation in logic programs. Belnap, "A useful four-valued logic", in Dunn and Epstein (eds), Modern Uses of Multiple-Valued Logic, 1977: independent positive and negative evidence, the reading of `both`. Nute, "Defeasible logic", Handbook of Logic in Artificial Intelligence and Logic Programming 3, 1994: strict, defeasible and defeater rules, the priority-by-blocking compilation. Gupta, Mumick, Subrahmanian, "Maintaining views incrementally", SIGMOD 1993: delete and re-derive (DRed) for incremental maintenance. Ross and Sagiv, "Monotonic aggregation in deductive databases", PODS 1992: the limit of recursive aggregation. Erol, Hendler, Nau (1994, above): undecidability of HTN planning with recursive methods, hence bounded loops. For modes of work: Levesque, Reiter, Lespérance, Lin, Scherl, "GOLOG: a logic programming language for dynamic domains", J. Logic Programming 31, 1997 (and De Giacomo, Lespérance, Levesque, "ConGolog", AI 121, 2000) for strict procedures with choice; Nau et al., "SHOP2: an HTN planning system", JAIR 20, 2003, for methods with choice and ordering; Bacchus and Kabanza, "Using temporal logics to express search control knowledge for planning", AI 116, 2000 (TLPlan), and Gerevini and Long, "Plan constraints and preferences in PDDL3", 2005, for trajectory constraints and soft preferences; Dung, "On the acceptability of arguments and its fundamental role in nonmonotonic reasoning, logic programming and n-person games", AI 77, 1995, for the deferred argumentation. For the inventory: Green, Karvounarakis, Tannen, "Provenance semirings", PODS 2007 (the semiring closure gap, Z01).

Sources inside the repository: DS004, DS005, DS006, DS010, DS014, DSx029, `reasoning/registry.mjs`, `docs/wire_typs/`, the four zips and `experiments/advanced_research.md` as described in section 2, the reviewer's documents `review-fable-r1.md`, `review-fable-r1-addendum.md` and `review-fable-r2.md` (all in `experiments/proposal/`), the authoring guide `wire-authoring-guide.md` (same folder) and the inventory `zip-strategy-inventory.md` (same folder).

## Appendix D. Backlog from the inventory of the zips

The twenty smoke cases the inventory proposes (ids as in the inventory) with their status in this proposal. None is a core wire; each earns its place by an experiment in the plan (section 12).

| Id | Case | Exercises | Source entry | Status |
| --- | --- | --- | --- | --- |
| N01 | `dream-equivalence-lemma` | answers identical with and without a prepared lemma; rounds and probes reported separately | Z12, Z16 | backlog (stage 7) |
| N02 | `dream-gate-rejects-unsound` | Pareto anti-join; a terminal bonus makes dominance unsound; the gate must reject it and accept the sound shortcut | Z07, Z14 | backlog (stage 7) |
| N03 | `existential-quotient-large` | an entity with about 100 detail rows; same rows, less work | Z13 | backlog (stage 7) |
| N04 | `reach-large-bound-source` | 10^5 edges in small components, bound start, tight budget | V03, Z15 | backlog (stage 7, measures the closure rule) |
| N05 | `reach-dense-cycle-no-regression` | dense cycle and mutual recursion; the router must not pick demand | Z09, Z10 | backlog (stage 7) |
| N06 | `whatif-many-worlds` | 50 hypotheses on one base, including `set` on a keyed predicate and a retraction | R02, R08 | backlog (stage 4) |
| N07 | `whatif-nonmonotone-cone` | an addition that flips a negation-as-failure or aggregate downstream | R02 | covered at small scale by `10d` |
| N08 | `rule-family-lift` | 500 rules differing only in constants; answers identical lifted and not | R01 | backlog |
| N09 | `numeric-symmetric-plan` | a 12-coordinate symmetric state, a threshold goal, a guard-rich control | V04, V09, V10 | backlog (stage 4, needs E2) |
| N10 | `exact-rational-threshold` | 1/10^13 distinct from 0; a value above 2^53 | V05 | backlog (needs a `rational` term type) |
| N11 | `provider-external-relation` | `call range`, `call member`, a Z3 check as a leaf | S08 | backlog (stage 4, needs E1) |
| N12 | `induce-path-rule` | hidden path rule among candidates with 20% label noise; a hash-like control must be refused | S01, S02 | backlog (induction is out of scope) |
| N13 | `abduce-all-minimal` | all inclusion-minimal explanations, not only the cheapest | S06 | covered by `14a` (soplab fails it) |
| N14 | `wall-timeout-isolated` | a strategy that never returns; stop at the wall limit; `budget_exhausted`, no claim | V02 | backlog (stage 1) |
| N15 | `count-models-local-pattern` | forbid `111`: length 12 expects 1,705, length 20 expects 223,317 | Z03, Z06 | backlog (needs `constraint task count`) |
| N16 | `shortest-path-cyclic-cost` | cheapest route on a cyclic graph; Datalog must answer not expressible; a planner or semiring closure answers | Z01 | backlog (needs a closure wire) |
| N17 | `plan-blocked-reason` | a plan with a derived or required precondition that fails; the reason is returned | R04, S05 | covered by `30b` and `33` |
| N18 | `closure-template-vs-rules` | same answers by recursive rules and by the native closure; the router picks native | S11, V03 | backlog (stage 7) |
| N19 | `point-query-large-kb` | 10^5 entities, one entity asked; lazy cone against demand | R03 | backlog (stage 2b) |
| N20 | `context-two-manuals` | two manuals with different limits answered under their contexts | R06 | backlog (needs a `context` wire) |

Harness features to add beside the cases (stage 1 and 3): a cross-engine bench set from the nine VRC `.pl` files with row-count agreement (V08), a differential test of two independent knowledge compilations on generated scenarios (R05), an SQLite control for P0 to P2 (Z09), and the A/B/C arm structure (rules, a specialised wire or template, a provider) of soplab's comparison protocol (S09) with VRC's protocol template (frozen thresholds, negative controls, phases in the total; V15) as the preregistration skeleton.

Low-priority additions with some evidence (kept out of the core): `induction-ranker` (S01), `model-counting` (Z03, Z06), `exact-rational-eval` (V05); the optional `context` wire (R06), the `examples` wire for induction, `constraint task count` and a semiring `closure` wire (Z01).

## Appendix E. The inventory of the zips (57 entries)

Moved from section 2.7. Evidence grades: `strong` (reproduced here or exact correctness against an independent comparator), `moderate` (reproducible internal evidence with the authors' own baseline), `weak` (synthetic setup, hidden structure in the supplied language, ties or losses against the simple comparator, one run), `none` (design text only). A facade over other components is never graded strong.

| Id | Entry | Kind | Role for ChatSOP | Evidence |
| --- | --- | --- | --- | --- |
| Z01 | E00 semiring worlds | representation learning | not relevant; gap: closure under a semiring (cheapest route, number of routes) | weak |
| Z02 | E01 hidden finite algebra | representation learning | not relevant (symbolic enumeration beat the network at 32 examples) | moderate |
| Z03 | E02 exact quotient (L*) for model counting | compression | low-priority component; gap: `constraint task count` | moderate |
| Z04 | E03 neural proposal plus CEGIS | neural proposer | negative evidence (0 of 3 exact despite about 98% accuracy) | moderate |
| Z05 | E04 verified skills (state signatures) | dreaming | component of dreaming | weak |
| Z06 | E05 #SAT composed from primitives | search | design pattern for the router | weak |
| Z07 | E06 dominance invention, counterexample-driven specialisation | dreaming | component; negative controls matter | weak |
| Z08 | E07 derived-feature invention | dreaming | not now | weak |
| Z09 | E08 comparators and SQLite as an independent engine | other | candidate strategy `sql-sqlite`; control | moderate |
| Z10 | E08 adaptive per-family policy selection | router feature | router feature | moderate |
| Z11 | E08 learned join plans, neural ranker | neural proposer | not relevant (ties the heuristic) | weak |
| Z12 | E09 verified Horn lemma synthesis | dreaming | low value (all 4 lemma bundles rejected) | weak |
| Z13 | E10 existential quotient, component factoring | optimisation | component of Datalog | moderate |
| Z14 | E10 guarded Pareto compilation | optimisation | component; negative controls | moderate |
| Z15 | E10 demand specialisation (magic sets), inlining | optimisation | covered (section 7.2) | moderate |
| Z16 | E10 SkillComposer | dreaming | wrapper rule | weak |
| Z17 | E10 InvariantInventor (empirical functional dependencies) | dreaming | advisory `key` hints, never pruning | none |
| Z18 | E10 EpisodeJournal, Dreamer, VerifiedSkillStore | dreaming | the lifecycle and records of `dreaming-session` (5.6) | moderate |
| S01 | soplab rule scoring and ranking | induction | later component | weak |
| S02 | micro-world generator with label noise | validation | validation method for ingested rules | weak |
| S03 | path-rule candidate generator | search | not relevant | none |
| S04 | best-first search | search | base of the planner | none |
| S05 | planner with derived preconditions | planning | planner variant (preconditions over derived and closed relations) | weak |
| S06 | min-cost abduction by subset enumeration | search | `abduce` variant; extension: all inclusion-minimal explanations | weak |
| S07 | workflow glue | other | reference only | none |
| S08 | binding providers (`CALL`) | interface | the `call` provider leaf (4.3, extension E1) | weak |
| S09 | variant comparison harness (A, B, C arms) | validation | harness; arm structure for deciding whether a wire earns a place | moderate |
| S10 | slicing in front of naive or delta evaluation | engine | covered; note: slicing gave no gain on its only benchmark | moderate |
| S11 | specialised graph-closure wire against recursive rules | engine | router rule (10.2) | moderate |
| S12 | abstraction learning (design only) | dreaming | design note | none |
| S13 | teacher-LLM ingestion (design only) | process | not relevant | none |
| V01 | `VRCStrategy` host facade | orchestration | interface reference (guarantee, shadow, learning options) | moderate (its tests reproduce, but a facade is evidence of an interface, not of an algorithm; regraded from strong in round 3) |
| V02 | isolated worker with wall and heap limits | containment | `isolation` capability | weak |
| V03 | reachability template, demand-directed graph search | optimisation | router rule; accounts for the 17x to 1,382x speed-ups | strong (correctness), moderate (speed) |
| V04 | numeric fragment discovery, forecast leaf | compression | niche component (needs the numeric action extension) | moderate |
| V05 | exact rational arithmetic DAG | exact evaluation | component for `compute` (a `rational` term type) | weak |
| V06 | streaming claim loader | ingestion | memory-side hint | weak |
| V07 | persistent registry, trace store, `dream()` | dreaming | the `dream` call | moderate |
| V08 | SWI-Prolog exporter, nine `.pl` programs | comparison | bench set for Datalog strategies (row counts agree) | strong (row counts) |
| V09 | compressed-state planning | planning | separate strategy for numeric worlds | moderate |
| V10 | representation discovery by closure search | compression | dreaming component (numeric) | moderate |
| V11 | data-only (sample oracle) mode | representation learning | not relevant | weak |
| V12 | power-sum decomposition proposer | representation learning | not relevant | weak |
| V13 | ring coupling certificate | other | not relevant | weak |
| V14 | column-class suffix compression for counting | compression | not relevant | weak |
| V15 | evaluation protocol templates | evaluation method | preregistration skeleton | none |
| R01 | rule lifting (rule families to one template) | compilation | component | weak |
| R02 | hypothetical worlds, copy-on-write, incremental continuation | engine | strategy `worlds-sopr` (monotone additions only) | moderate |
| R03 | dependency cone, lazy saturation, trigger index | engine | covered; router rule for point queries | moderate |
| R04 | `method` and `plan` with `BLOCKED` and reason strings | planning | planner; keep the reason (norm `message`, `blocked`) | moderate |
| R05 | differential testing of independent compilations | validation | validation method (12) | moderate |
| R06 | contexts (microtheories) | design | optional `context` wire (backlog) | none |
| R07 | ATMS labels for many hypotheses | engine (design) | not now | none |
| R08 | delete and re-derive (DRed) | engine (design) | for `update` (5.5) | none |
| R09 | `term` wire, vocabulary index, same-as | design | partly done by the lexicon | none |
| R10 | hierarchy labelling, worst-case optimal joins | engine (design) | not now | none |
| R11 | fan-out budget per rule, compact CSR store | design | budget key `maxFanout` | none |

## Appendix F. Smoke results (79 cases, six live strategies)

`node eval/smoke-reasoning/run.mjs --markdown`, re-run on 2026-10-01 for round 3 (validation: 79 cases, 58 invalid fixtures, 0 problems; all self-tests ok); `pass`, `n/e` = not expressible, FAIL. Moved from section 9.2, where the totals and the reading are. `js-oracle` is the stage-1 complete oracle (in progress); `js-reference` is the existing bounded product strategy.

| case | js-reference | js-oracle | prolog-swi | z3-lia | datalog-e10 | datalog-soplab |
| --- | --- | --- | --- | --- | --- | --- |
| 01-facts-lookup | pass | pass | pass | n/e | pass | pass |
| 01b-zero-arity-atoms | n/e | pass | n/e | n/e | n/e | n/e |
| 02a-open-world-unknown | pass | pass | pass | n/e | pass | pass |
| 02b-explicit-negative-refuted | pass | pass | pass | n/e | pass | pass |
| 03-rules-chaining | pass | pass | pass | n/e | pass | pass |
| 04-recursion-transitive-closure | pass | pass | pass | n/e | pass | pass |
| 04b-recursion-cycle-completion-caveat | n/e | pass | n/e | n/e | pass | pass |
| 05a-classical-negation-conflict | pass | pass | pass | n/e | pass | pass |
| 05b-naf-closed-world | n/e | pass | n/e | n/e | pass | pass |
| 05c-explicit-negation-without-evidence | pass | pass | pass | n/e | pass | pass |
| 06a-constraint-prove | pass | pass | n/e | pass | n/e | n/e |
| 06b-constraint-optimize | pass | pass | n/e | pass | n/e | n/e |
| 06c-constraint-inconsistent | pass | pass | n/e | pass | n/e | n/e |
| 06d-rule-arithmetic | n/e | pass | n/e | n/e | n/e | n/e |
| 07a-count-query | pass | pass | pass | n/e | pass | pass |
| 07b-aggregate-group-sum | n/e | pass | n/e | n/e | n/e | pass |
| 07c-aggregate-then-rule | n/e | pass | n/e | n/e | n/e | pass |
| 07d-count-open-predicate-lower-bound | pass | pass | pass | n/e | pass | pass |
| 08a-every-true | pass | pass | pass | n/e | pass | pass |
| 08b-every-refuted | pass | pass | pass | n/e | pass | pass |
| 08c-some-exists | pass | pass | pass | n/e | pass | pass |
| 08d-every-open-domain-unknown | pass | pass | pass | n/e | pass | pass |
| 09a-default-exception | n/e | pass | n/e | n/e | pass | pass |
| 09b-default-conflict-unresolved | n/e | pass | n/e | n/e | pass | pass |
| 09c-default-priority | n/e | pass | n/e | n/e | pass | pass |
| 09d-strict-contrary-blocks-default | n/e | pass | n/e | n/e | pass | pass |
| 09e-overrides-fire-not-applies | n/e | pass | n/e | n/e | pass | pass |
| 10a-contradicting-sources | pass | pass | pass | n/e | pass | pass |
| 10b-reported-claim-conditional | pass | pass | pass | n/e | n/e | n/e |
| 10c-conditional-assumption-list | pass | pass | pass | n/e | pass | pass |
| 10d-conditional-nonmonotone-naf | n/e | pass | n/e | n/e | pass | pass |
| 10e-conditional-redundant-assumptions | pass | pass | pass | n/e | pass | pass |
| 10f-conditional-abc-counterexample | pass | pass | pass | n/e | pass | pass |
| 11a-plan-strips | pass | pass | n/e | n/e | n/e | pass |
| 11b-plan-none | pass | pass | n/e | n/e | n/e | pass |
| 11c-procedure-method | n/e | n/e | n/e | n/e | n/e | n/e |
| 12a-temporal-at | pass | pass | pass | n/e | n/e | n/e |
| 12b-temporal-interval | pass | pass | n/e | n/e | n/e | n/e |
| 12c-temporal-throughout | n/e | pass | n/e | n/e | n/e | n/e |
| 12d-temporal-derived-throughout | n/e | pass | n/e | n/e | n/e | n/e |
| 12e-temporal-derived-not-throughout | n/e | pass | n/e | n/e | n/e | n/e |
| 12f-temporal-time-variables | n/e | pass | n/e | n/e | n/e | n/e |
| 12g-temporal-count-throughout | n/e | pass | n/e | n/e | n/e | n/e |
| 13a-explain-proof | pass | pass | pass | n/e | n/e | pass |
| 13b-why-not | n/e | pass | n/e | n/e | n/e | n/e |
| 13c-used-two-sufficient-facts | pass | pass | pass | n/e | pass | pass |
| 13d-used-chain-verified | pass | pass | pass | n/e | pass | pass |
| 14a-abduction | pass | pass | n/e | n/e | n/e | FAIL |
| 14b-whatif-supposition | pass | pass | pass | n/e | pass | pass |
| 15a-budget-partial-answers | pass | pass | pass | n/e | n/e | pass |
| 15b-budget-never-a-no | pass | pass | pass | n/e | n/e | pass |
| 15c-budget-probe-limit | pass | pass | pass | n/e | pass | n/e |
| 17-integrity-violation | n/e | pass | n/e | n/e | pass | pass |
| 20-retrieval-distractor-memory | pass | pass | pass | n/e | pass | pass |
| 21-retrieval-missing-premise-widening | pass | pass | pass | n/e | pass | pass |
| 22-retrieval-naf-needs-complete-keys | n/e | pass | n/e | n/e | pass | pass |
| 23-retrieval-derived-closed-missing-rule | n/e | pass | n/e | n/e | pass | pass |
| 24-retrieval-default-strict-contrary-hidden | n/e | pass | n/e | n/e | pass | pass |
| 30a-router-reset-plan-under-norms | n/e | n/e | n/e | n/e | n/e | n/e |
| 30b-router-why-not-hard-reset | n/e | n/e | n/e | n/e | n/e | n/e |
| 30c-router-whatif-proposed-norm | n/e | n/e | n/e | n/e | n/e | n/e |
| 30d-router-abduce-waive-norm | n/e | n/e | n/e | n/e | n/e | n/e |
| 31a-method-choice-if-optional | n/e | n/e | n/e | n/e | n/e | n/e |
| 31b-method-on-failure | n/e | n/e | n/e | n/e | n/e | n/e |
| 32-norm-trajectory-hard | n/e | n/e | n/e | n/e | n/e | n/e |
| 33-norm-obligation-soft-unmet | n/e | n/e | n/e | n/e | n/e | n/e |
| 34-norm-permission-exception | n/e | n/e | n/e | n/e | n/e | n/e |
| 35a-procedure-version-asof-old | n/e | n/e | n/e | n/e | n/e | n/e |
| 35b-procedure-render-current | n/e | n/e | n/e | n/e | n/e | n/e |
| 35c-rule-version-current | n/e | pass | n/e | n/e | pass | pass |
| 35d-rule-version-asof-old | n/e | pass | n/e | n/e | pass | pass |
| 36-amendment-whatif | n/e | n/e | n/e | n/e | n/e | n/e |
| 37a-conform-trace-violation | n/e | n/e | n/e | n/e | n/e | n/e |
| 37b-conform-trace-compliant | n/e | n/e | n/e | n/e | n/e | n/e |
| 37c-conform-trace-asof-old | n/e | n/e | n/e | n/e | n/e | n/e |
| 37d-conform-method-deviation-strict | n/e | n/e | n/e | n/e | n/e | n/e |
| 38-norm-obligation-scoping | n/e | n/e | n/e | n/e | n/e | n/e |
| 39a-norm-advisory-hard-relaxed | n/e | n/e | n/e | n/e | n/e | n/e |
| 39b-norm-conflict-equal-strength | n/e | n/e | n/e | n/e | n/e | n/e |

## Appendix G. Declared coverage of the planned strategies

**A declaration, not a prediction.** `exp` means every feature the case requires is declared by the stub; `n/e` means a required feature is declared unsupported. No stub has run. `dreaming-session` is a wrapper that inherits the coverage of the engine it wraps and has no column. The strategy of the sop-r engine is `worlds-sopr` (it was `sopr-lift-worlds` in this table before round 3).

| case | prolog-tabling | z3-smt-bounded | asp-clingo | datalog-souffle | htn-strips-planner | golog-swi | sql-sqlite | vrc-compressed-planning | worlds-sopr | neural-assist |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01-facts-lookup | exp | exp | exp | exp | exp | exp | exp | n/e | exp | n/e |
| 01b-zero-arity-atoms | exp | exp | exp | exp | exp | exp | exp | n/e | n/e | n/e |
| 02a-open-world-unknown | exp | exp | exp | exp | n/e | n/e | exp | n/e | exp | n/e |
| 02b-explicit-negative-refuted | exp | exp | exp | exp | n/e | n/e | exp | n/e | n/e | n/e |
| 03-rules-chaining | exp | exp | exp | exp | exp | exp | exp | n/e | exp | n/e |
| 04-recursion-transitive-closure | exp | n/e | exp | exp | n/e | n/e | exp | n/e | exp | n/e |
| 04b-recursion-cycle-completion-caveat | exp | n/e | exp | exp | n/e | n/e | exp | n/e | n/e | n/e |
| 05a-classical-negation-conflict | exp | exp | exp | exp | n/e | n/e | exp | n/e | n/e | n/e |
| 05b-naf-closed-world | exp | exp | exp | exp | exp | n/e | exp | n/e | exp | n/e |
| 05c-explicit-negation-without-evidence | exp | exp | exp | exp | n/e | n/e | exp | n/e | n/e | n/e |
| 06a-constraint-prove | n/e | exp | n/e | n/e | n/e | n/e | n/e | exp | n/e | n/e |
| 06b-constraint-optimize | n/e | exp | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e |
| 06c-constraint-inconsistent | n/e | exp | n/e | n/e | n/e | n/e | n/e | exp | n/e | n/e |
| 06d-rule-arithmetic | exp | exp | exp | exp | n/e | n/e | exp | n/e | n/e | n/e |
| 07a-count-query | exp | exp | exp | exp | n/e | n/e | exp | n/e | exp | n/e |
| 07b-aggregate-group-sum | exp | exp | exp | exp | n/e | n/e | exp | n/e | exp | n/e |
| 07c-aggregate-then-rule | exp | exp | exp | exp | n/e | n/e | exp | n/e | n/e | n/e |
| 07d-count-open-predicate-lower-bound | exp | exp | exp | exp | n/e | n/e | exp | n/e | exp | n/e |
| 08a-every-true | exp | exp | exp | exp | n/e | n/e | exp | n/e | exp | n/e |
| 08b-every-refuted | exp | exp | exp | exp | n/e | n/e | exp | n/e | n/e | n/e |
| 08c-some-exists | exp | exp | exp | exp | n/e | n/e | exp | n/e | exp | n/e |
| 08d-every-open-domain-unknown | exp | exp | exp | exp | n/e | n/e | exp | n/e | exp | n/e |
| 09a-default-exception | exp | exp | exp | n/e | n/e | n/e | exp | n/e | exp | n/e |
| 09b-default-conflict-unresolved | exp | exp | exp | n/e | n/e | n/e | exp | n/e | n/e | n/e |
| 09c-default-priority | exp | exp | exp | n/e | n/e | n/e | exp | n/e | exp | n/e |
| 09d-strict-contrary-blocks-default | exp | exp | exp | n/e | n/e | n/e | exp | n/e | n/e | n/e |
| 09e-overrides-fire-not-applies | exp | exp | exp | n/e | n/e | n/e | exp | n/e | exp | n/e |
| 10a-contradicting-sources | exp | exp | exp | exp | n/e | n/e | exp | n/e | n/e | n/e |
| 10b-reported-claim-conditional | exp | n/e | exp | n/e | n/e | n/e | n/e | n/e | exp | n/e |
| 10c-conditional-assumption-list | exp | n/e | exp | n/e | exp | n/e | n/e | n/e | exp | n/e |
| 10d-conditional-nonmonotone-naf | exp | n/e | exp | n/e | exp | n/e | n/e | n/e | exp | n/e |
| 10e-conditional-redundant-assumptions | exp | n/e | exp | n/e | exp | n/e | n/e | n/e | exp | n/e |
| 10f-conditional-abc-counterexample | exp | n/e | exp | n/e | exp | n/e | n/e | n/e | exp | n/e |
| 11a-plan-strips | n/e | exp | exp | n/e | exp | exp | n/e | exp | exp | n/e |
| 11b-plan-none | n/e | exp | exp | n/e | exp | exp | n/e | exp | exp | n/e |
| 11c-procedure-method | n/e | n/e | n/e | n/e | exp | exp | n/e | n/e | exp | n/e |
| 12a-temporal-at | exp | n/e | exp | n/e | n/e | n/e | exp | n/e | n/e | n/e |
| 12b-temporal-interval | exp | n/e | exp | n/e | n/e | n/e | exp | n/e | n/e | n/e |
| 12c-temporal-throughout | exp | n/e | exp | n/e | n/e | n/e | exp | n/e | n/e | n/e |
| 12d-temporal-derived-throughout | exp | n/e | exp | n/e | n/e | n/e | n/e | n/e | n/e | n/e |
| 12e-temporal-derived-not-throughout | exp | n/e | exp | n/e | n/e | n/e | n/e | n/e | n/e | n/e |
| 12f-temporal-time-variables | exp | n/e | exp | n/e | n/e | n/e | exp | n/e | n/e | n/e |
| 12g-temporal-count-throughout | exp | n/e | exp | n/e | n/e | n/e | exp | n/e | n/e | n/e |
| 13a-explain-proof | exp | n/e | exp | n/e | n/e | n/e | n/e | n/e | exp | n/e |
| 13b-why-not | exp | n/e | exp | n/e | exp | exp | n/e | n/e | n/e | n/e |
| 13c-used-two-sufficient-facts | exp | exp | exp | exp | exp | exp | exp | n/e | exp | n/e |
| 13d-used-chain-verified | exp | exp | exp | exp | exp | exp | exp | n/e | exp | n/e |
| 14a-abduction | exp | exp | exp | n/e | exp | n/e | n/e | n/e | n/e | n/e |
| 14b-whatif-supposition | exp | n/e | exp | n/e | exp | n/e | n/e | n/e | exp | n/e |
| 15a-budget-partial-answers | exp | n/e | exp | n/e | n/e | n/e | exp | n/e | exp | n/e |
| 15b-budget-never-a-no | exp | n/e | exp | n/e | n/e | n/e | exp | n/e | exp | n/e |
| 15c-budget-probe-limit | exp | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e | n/e |
| 17-integrity-violation | exp | exp | exp | exp | n/e | n/e | exp | n/e | n/e | n/e |
| 20-retrieval-distractor-memory | exp | n/e | exp | exp | n/e | n/e | exp | n/e | exp | n/e |
| 21-retrieval-missing-premise-widening | exp | exp | exp | exp | exp | exp | exp | n/e | exp | n/e |
| 22-retrieval-naf-needs-complete-keys | exp | exp | exp | exp | exp | n/e | exp | n/e | exp | n/e |
| 23-retrieval-derived-closed-missing-rule | exp | n/e | exp | exp | n/e | n/e | exp | n/e | n/e | n/e |
| 24-retrieval-default-strict-contrary-hidden | exp | exp | exp | n/e | n/e | n/e | exp | n/e | n/e | n/e |
| 30a-router-reset-plan-under-norms | n/e | n/e | n/e | n/e | exp | n/e | n/e | n/e | n/e | n/e |
| 30b-router-why-not-hard-reset | n/e | n/e | n/e | n/e | exp | exp | n/e | n/e | n/e | n/e |
| 30c-router-whatif-proposed-norm | n/e | n/e | n/e | n/e | exp | n/e | n/e | n/e | n/e | n/e |
| 30d-router-abduce-waive-norm | n/e | n/e | n/e | n/e | exp | n/e | n/e | n/e | n/e | n/e |
| 31a-method-choice-if-optional | n/e | n/e | n/e | n/e | exp | exp | n/e | n/e | n/e | n/e |
| 31b-method-on-failure | n/e | n/e | n/e | n/e | exp | exp | n/e | n/e | n/e | n/e |
| 32-norm-trajectory-hard | n/e | n/e | exp | n/e | exp | n/e | n/e | n/e | n/e | n/e |
| 33-norm-obligation-soft-unmet | n/e | n/e | exp | n/e | exp | n/e | n/e | n/e | n/e | n/e |
| 34-norm-permission-exception | n/e | n/e | exp | n/e | exp | n/e | n/e | n/e | n/e | n/e |
| 35a-procedure-version-asof-old | n/e | n/e | n/e | n/e | exp | exp | n/e | n/e | n/e | n/e |
| 35b-procedure-render-current | n/e | n/e | n/e | n/e | exp | exp | n/e | n/e | n/e | n/e |
| 35c-rule-version-current | exp | exp | exp | exp | exp | n/e | exp | n/e | n/e | n/e |
| 35d-rule-version-asof-old | exp | exp | exp | exp | exp | n/e | exp | n/e | n/e | n/e |
| 36-amendment-whatif | n/e | n/e | n/e | n/e | exp | n/e | n/e | n/e | n/e | n/e |
| 37a-conform-trace-violation | n/e | n/e | n/e | n/e | exp | n/e | n/e | n/e | n/e | n/e |
| 37b-conform-trace-compliant | n/e | n/e | n/e | n/e | exp | n/e | n/e | n/e | n/e | n/e |
| 37c-conform-trace-asof-old | n/e | n/e | n/e | n/e | exp | n/e | n/e | n/e | n/e | n/e |
| 37d-conform-method-deviation-strict | n/e | n/e | n/e | n/e | exp | n/e | n/e | n/e | n/e | n/e |
| 38-norm-obligation-scoping | n/e | n/e | exp | n/e | exp | n/e | n/e | n/e | n/e | n/e |
| 39a-norm-advisory-hard-relaxed | n/e | n/e | n/e | n/e | exp | n/e | n/e | n/e | n/e | n/e |
| 39b-norm-conflict-equal-strength | n/e | n/e | n/e | n/e | exp | n/e | n/e | n/e | n/e | n/e |

declared coverage (cases expected to be covered): prolog-tabling 54/79, z3-smt-bounded 37/79, asp-clingo 59/79, datalog-souffle 29/79, htn-strips-planner 39/79, golog-swi 15/79, sql-sqlite 42/79, vrc-compressed-planning 4/79, worlds-sopr 31/79, neural-assist 0/79
