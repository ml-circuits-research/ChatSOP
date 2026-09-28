---
title: DS006-reasoning
summary: Linked facts, independently selected reasoning strategies, the strategy × backend matrix, explicit solver routing, proof-use reinforcement, and the executable result-status projection.
---

## Introduction

A user submits a checked [SOP](wiki.html#definition-sop) query to receive a supported result with its facts, route, and completeness information. The [linker](wiki.html#definition-linker) selects applicable approved definitions and retrieves relevant facts before a reasoner solves a typed problem; external solvers do not discover missing rules in associative storage.

## Core Content

### Strategy contract

`policy.reasoningStrategy` selects `reference` or `advanced`, independently of `memory.engine`. `reference` uses bounded JavaScript methods for supported Horn deduction and finite integer constraints. `advanced` may route suitable Horn work to SWI-Prolog and suitable numeric constraints or optimization to Z3 when available; remaining methods use audited JavaScript controllers. A route must expose the backend actually used and any fallback. An `advanced` request handled by JavaScript does not count as an independent SWI or Z3 experiment. Unavailable optional solvers do not justify reporting their execution.

### Evidence, alternatives, and unsupported cases

Only admitted facts/observations and applicable reviewed rules support ordinary deduction. A hypothesis, pattern, trace, plan, analogy, or satisfiable constraint is not automatically an observed fact or proven conclusion. Abduction proposes explanations; diagnosis proposes discriminating tests; bounded induction and analogy retain candidate status; planning and what-if simulation do not mutate historical facts. Unsupported dialects and mixed constraints needing an explicit stage are reported rather than silently dropping requirements. Retrieval cutoff or incomplete search must remain visible in the result, especially before uniqueness, negation, or count claims. A solver route proves only a consequence of its admitted facts and declared search domain, not the ground truth of those facts.

### Evidence for comparison

Run fixed SOP and fixed approved facts when comparing reasoners; change only the selected reasoning route and record actual execution, answer, proof, cutoff, latency, and unavailable routes. Compare Horn-common semantics with SWI and supported constraint semantics with Z3 separately. This requirement does not assert the external binaries are installed or that every reasoning operation is supported by both.

### Assumption defeat across routes

Assumption handling is part of the shared Horn profile, not a route-specific extra: the reference JS reasoner and the SWI adapter both admit a declared assumption only while no admitted fact or rule-derived conclusion supports the explicit contrary atom, and both keep the same answer, proof and `hypothetical` marker for the same inputs. The adapter therefore filters defeated assumptions with the same rule before compiling SWI input, and its closure-agreement check still guards backend divergence. A result that touches a kept assumption stays conditional; the reasoner never promotes it to an unconditioned support, and no fallback route may restore a defeated assumption. Defeat is atom-level and evidence-scoped: an assumption about one atom does not suppress derivations of unrelated atoms, and the reasoner reports the defeated assumption identifiers for audit instead of silently discarding them.

Historical setup record (2026-09, not a current run): on the prepared ARM64 host, private Z3 4.15.8 and SWI-Prolog 9.0.4 executables were acquired with pinned package/release hashes and licenses under ignored `tools/.solvers/`; no system package installation or global PATH change was made. Select them explicitly with `Z3_BIN` and `SWIPL_BIN`. `tools/check-solvers.mjs` and optional conformance checks honor those same variables. SWI's private extraction additionally requires the distribution's autoload-index bootstrap, recorded in its manifest.

Historical observation (2026-09; current solver results belong in `eval/reports/current/`): bounded probes observed JS and Z3 both derive the unique numeric output 840 with no fallback, and JS and SWI both retain conditional support under an explicit hypothesis. The latter reproduced and fixed an adapter bug: merging assumptions into SWI's input facts had erased the returned `hypothetical` marker. SWI computes its closure, while the adapter checks closure agreement and reconstructs proof with JS; report that composed cost and do not claim an independent SWI proof. These probes are not a broad solver benchmark or model evaluation.

Every rational packet reports `depth`: the number of rule applications in the minimal justification of the facts the answer actually used. A directly supplied or observed fact counts as `0`, one chained rule as `1`, and so on; when nothing is used the value is `0`. It is computed over the proof dependency graph (derived entries list their supporting ids in `from`) in `reasoning/reasoner.mjs`, so Prolog-backed results inherit the same value, and it lets a caller state an expected derivation depth independently of the answer text.

## Strategy × backend matrix

A reasoning **strategy** chooses how an admitted problem is solved; a **backend** is the engine actually executed; `memory.engine` stores evidence and `policy.retrievalStrategy` searches it. These are separate selections. The actual route (`operation`, `backend`, `fallback`) and `reasoningStrategy` accompany ordinary results. On a trusted SOP `reason`/`solve` wire, an explicit non-JS `backend` selects `advanced` when the wire has no explicit `reasoning` override; the returned `reasoningStrategy` exposes that selection. Explicit `reasoning reference` still rejects an external backend, and an explicit external backend is never silently replaced with JS. The matrix records only the supported capabilities in `reasoning/registry.mjs`, `reasoning/backends/horn.mjs` and `reasoning/backends/constraints.mjs`; it does not claim universal logical coverage or installed optional binaries.

### Strategy × backend × problem domain

| Operation/domain | `reference` / JS | `advanced` / JS | `advanced` / SWI-Prolog | `advanced` / Z3 |
| --- | --- | --- | --- | --- |
| `deduce`, `temporal`, `classify`: finite function-free Horn over admitted facts, observations and rules | Supported by bounded JS Horn, including interval queries in its temporal profile. | Supported; on `auto`, selected if SWI is unavailable or a point-in-time query is absent, with a reported fallback. Explicit `js` stays JS. | Point-in-time (`query.at`) Horn only. `auto` selects it only when available and the query has `at`; explicit `prolog` uses `advanced` unless the wire explicitly chooses another strategy. Closure is computed in SWI, checked against JS, and proof is reconstructed by JS. Unavailable explicit SWI reports `unsupported/backend_unavailable`; an explicit interval-only SWI request fails with a clear adapter error, not a JS reroute. | Not a Horn backend; the adapter rejects a Z3 Horn request with a clear error. |
| `constraint`: declared integer variables/constraints; `possible` or proof | Finite safe-integer domains only, bounded enumeration; an unbounded JS domain returns `unsupported/finite_domain_required`. | Same finite JS profile; `auto` selects JS and reports fallback if Z3 is unavailable. | Unsupported backend profile; numeric constraints require JS or Z3. | SMT constraint decision on the declared integer problem; explicit `z3` requires `advanced`, and missing Z3 reports `unsupported/backend_unavailable` rather than executing JS. A satisfiable claim is not automatically entailed; projections are checked for uniqueness before binding. |
| `constraint` with `task: optimize` | Finite bounded JS optimizer; partial work is not reported as a proven optimum. | Same JS finite optimizer and fallback reporting on `auto` if Z3 is unavailable. | Unsupported backend profile. | Z3 objective search with a separate check that no better feasible objective exists; an unproven bound is not an optimum. Optional binary availability is required. |
| `abduce`, `diagnose`, `associate`, `induce`, `analogize`, `plan`, `simulate` | Shared bounded JS controllers, each with its own admitted input kinds and epistemic outputs. | Same JS controllers; `advanced` with `auto` reports the shared JS route because these operations are not compiled to SWI/Z3. | No external adapter; an explicit `prolog` request returns `unsupported/explicit_backend_not_available_for_mode`. | No external adapter; an explicit `z3` request returns `unsupported/explicit_backend_not_available_for_mode`. |

`reference` accepts `backend: auto|js` only; an external request returns `unsupported/reference_backend_mismatch`. `advanced` with `backend: auto` probes available binaries for the applicable Horn or numeric profile. In a supported external domain an explicit solver request never downgrades on failure: an unavailable binary returns `unsupported/backend_unavailable`, with the requested engine in `route.backend` and `route.fallback: null`. An explicit external backend for a JS-only controller returns `unsupported/explicit_backend_not_available_for_mode` rather than executing JS. Every profile or structural rejection retains a `reasoningStrategy` and an explicit `route` with `fallback: null`; the route names the requested backend, or `none` for a required mixed constraint stage or uncompiled theory, without claiming execution. A backend result may be incomplete, unknown or unsupported independently of the selected route. Explicit external solver test runs use `Z3_BIN` and `SWIPL_BIN` when provided; unavailable optional tools are reported as skipped rather than passed or run on JS under an external label. Numeric and Horn tests do not establish coverage for unadmitted extensions.

### The distinct `hybrid` settings

`memory.engine: hybrid` creates one physical fact bank: exact SQLite evidence plus RecallMemory or HoloMemory associative hints (`memory.hybrid.associative`; [DS027](specsLoader.html?spec=DS027-hybrid-memory.md)). Its exact answers cannot be erased by a failed hint. `policy.retrievalStrategy: hybrid` is a **search policy** over the available repository view: it first seeks exact coverage when an exact representation exists, and may consult the remaining approximate route after an incomplete exact search; without an exact representation it requests the automatic route. Neither setting chooses a reasoning solver. Other retrieval choices (`auto`, `exact`, `recall-memory`, `holo-memory`, `sqlite`, `scan`) are independent of `reference`/`advanced`; a storage-specific route requires a compatible stored representation rather than renaming the policy. This distinction does not imply that every memory engine can satisfy every retrieval profile.

### Read effects and reinforcement boundary

Calling `ReasoningRegistry.run` is a pure calculation over supplied facts and never reinforces observed facts. A host `link`/`recall` read or a candidate retrieval hit alone does not promote evidence. The trusted runtime's `reason` execution **may** reinforce a previously admitted, metadata-verified **observed** fact only when it occurs in a real, non-hypothetical proof/refutation, is nonlocal, `policy.reinforce !== false`, and the memory retention configuration permits promotion on use (`retention.reinforceOnUse`). The repository validates provenance and tuple identity before recording it. When promotion occurs the returned result includes `reinforcement: {facts, strength}`; no result with that effect may be described as an entirely side-effect-free read. Set `policy.reinforce: false` for read-only comparisons, alongside a fixed memory snapshot; hypothetical proofs, mere retrieval, local facts, candidate patterns and unsupported outcomes do not themselves reinforce. The capability declaration for the trusted `reason` wire is `may-reinforce-nonhypothetical-observed-proof` in `tools/capabilities.mjs`. Explicit `remember`, not `reason` or model-authored SOP, records new user facts. `solve` of a query expands to `link` and `reason` and therefore follows the same proof-use boundary; numeric `solve` does not use the observed-proof branch.

## Result projection

### Result packet and capability boundaries

`sop/runtime.mjs` produces a result packet; `eval/run.mjs` reads `result.packet ?? result`; `eval/contracts.mjs:epistemicResult` projects `status` into the result vocabulary while retaining `runtime_status`, `complete`, `hypothetical` and `epistemic`. Two explicit opposite `fact` wires produce runtime `both` and projected `CONFLICT`, and `complete:false`, `hypothetical:true`, `epistemic:'hypothetical'` survive a conflicting packet (test “result projection retains contradiction…”). A missing runtime `status` throws; an unrecognized runtime status projects to `UNSUPPORTED`, never an invented hard entailment (test “executable decision rows…”). `complete:null` means the packet did not report completeness, **not** that a search is complete.

Reasoning and memory capabilities are declared in `reasoning/registry.mjs:CAPABILITIES`, `ReasoningRegistry.run`, `memory/repository.mjs:Repository.apply/commit` and `tools/capabilities.mjs` (exports `memoryEngines`, `reasoning`, `wires`). `reference.deduce` declares `finite-function-free-Horn`; the available memory engines are `recall-memory`, `holo-memory`, `sqlite`, `scan` and `hybrid` ([DS005](specsLoader.html?spec=DS005-memory.md)); `remember` is the recording wire. A trusted `fact` plus `remember input $f` returns `stored`, increments the session revision, and a subsequent `solve` reads the claim. `remember input $h` cannot store an unreviewed `hypothesis` and does not advance the revision. An uncompiled `theory dialect arbitrary` returns `unsupported` with `code:'unsupported_theory'`; neither memory selection nor a theory body silently makes it executable (test “memory and reasoning capabilities…”). `Repository.commit` is separate from session `remember`; neither a model `stated`/`assumed` proposition nor a proposed `pattern`/`hypothesis` becomes a published fact. These executable cases check the concrete admission and effect boundaries, not external-source truth or review quality.

### Executable decision table

`eval/contracts.mjs:STATUS_DECISIONS` is the executable table below. Every literal row is exercised by the table-driven assertion in “executable decision rows…”; the rows marked **runtime** additionally come from actual `Runtime.run` executions there or in the cited boundary test. The projection is not a new proof engine. The archived vision documents under `probably_obsolete/vision/` named `ENTAILED`, `CONTRADICTED`, `UNKNOWN`, `PLAUSIBLE`; `CONFLICT`, `POSSIBLE`, `UNSUPPORTED`, `AMBIGUOUS`, `BLOCKED` and operation receipts preserve distinctions the runtime already exposes.

| Runtime `status` | Vision/result projection | Decision and executed evidence |
| --- | --- | --- |
| `supported` | `ENTAILED` | Positive admitted proof (**runtime**); if `hypothetical:true`, use `PLAUSIBLE`, retaining `runtime_status:'supported'` (**runtime** conditional statement or assumption). |
| `refuted` | `CONTRADICTED` | Explicit contrary evidence (**runtime**); also the DEFAULT exception test below. |
| `both` | `CONFLICT` | Positive and negative evidence, neither discarded (**runtime** result-boundary test). A nonempty `conflictedAnswers` takes the same precedence even if another status is reported (result-boundary test). |
| `unknown` | `UNKNOWN` | No supporting/contrary evidence (**runtime**); not falsehood and not automatically `clarify`. |
| `possible` | `POSSIBLE` | A feasible finite assignment exists, not an entailment (**runtime** numeric `task possible`). |
| `entailed` | `ENTAILED` | Finite constraint claim holds across admitted models (**runtime** numeric `task prove`). Hypothetical entailment projects to `PLAUSIBLE`. |
| `impossible` | `CONTRADICTED` | Finite-domain possibility refuted relative to supplied constraints (table projection; not a global closed-world assertion). |
| `hypotheses` | `PLAUSIBLE` | Abduction returns proposed assumptions, not facts (**runtime**). |
| `candidates`, `patterns` | `PLAUSIBLE` | Exploratory suggestions are not approved rules (table projection). |
| `clarify` | `AMBIGUOUS` | Host request for required information (table projection); lack of evidence alone is `unknown`. |
| `unsupported` | `UNSUPPORTED` | Uncompiled theory/required capability (**runtime**), no fabricated `entailed` result. |
| `blocked` | `BLOCKED` | Dependency unavailable; not a negative proof (table projection). |
| `inconsistent` | `CONFLICT` | Contradictory intervention or no consistent model; never explosion to arbitrary entailment (table projection). |
| `optimal` | `ENTAILED` | Proven finite optimum relative to the specified model (table projection; not an open-world global optimum). |
| `feasible_bound` | `POSSIBLE` | Incomplete optimization bound, not a proven optimum (table projection). |
| `plan_found` | `POSSIBLE` | A bounded plan candidate exists; it was not executed (table projection). |
| `no_plan` | `UNKNOWN` | No plan found in the supplied bounded action model, not a universal impossibility (table projection). |
| `stored`, `context_updated` | `STORED`, `CONTEXT_UPDATED` | Operational receipts, not truth claims (`stored` **runtime**; `context_updated` table projection). |
| Any other runtime string | `UNSUPPORTED` | Fail-closed projection; raw `runtime_status` remains available (explicit regression case). |

**Precedence and qualification:** An explicit `both`, `inconsistent` or nonempty `conflictedAnswers` projects to `CONFLICT` before conditionality. Otherwise a `supported` or `entailed` packet with `hypothetical:true` projects to `PLAUSIBLE`; only then does the literal table apply. `complete:false` and `epistemic` remain separate fields and cannot be erased by a positive status. The result-boundary test executes the combined contradiction/hypothesis/incompleteness packet. `complete:null` is an unreported field, not a success. `runtime_status` always carries the original runtime status, including unsupported extensions.

#### DEFAULT with an exception and no-support control

There is **no general DEFAULT wire or default-rule compiler** in `SPEC`/`ReasoningRegistry`. The exercised limited case is a model `stated` proposition with `certainty hedged` ("Normally Ana likes this book"), lowered to a `fact … source assumption` consumed through `assume`: while uncontested, `Runtime` reports `supported`, `hypothetical:true`, projected `PLAUSIBLE`. If an explicit, session-recorded `not likes ana book` is visible at the same knowledge cutoff, the assumption is listed under `defeatedAssumptions`, and the result is `refuted`/`CONTRADICTED`; the assumption is not a second stored claim. With neither assumption nor supporting record, the same query is `unknown`/`UNKNOWN`. These three executions are in “DEFAULT proposal with explicit exception…”. A requested `theory dialect defeasible-default` returns `unsupported`/`UNSUPPORTED` rather than pretending that this narrow assumption rule implements arbitrary unordered defaults. No candidate rule is silently promoted to HARD.

The boundary cases run without any model training or endpoint call:

```sh
node --test tests/contracts-boundary.test.mjs
```

## Reference-engine algorithm contracts

These bounded JavaScript controllers (`reasoning/abduction.mjs`, `reasoning/learning.mjs`, `reasoning/worlds.mjs`, `reasoning/optimization.mjs`) share the budget keys `maxNodes`, `maxDepth`, `maxHypotheses`, `maxCandidates`, `maxPlans`, `maxRounds`, `maxFacts`, `maxJoins`, `maxAssignments` and `timeoutMs` (`reasoning/common.mjs:LIMITS`). The budgets are cooperative checks, not preemption; an endpoint that accepts untrusted input must run the engine in a worker or process with its own time and memory limits.

- **Abduction** removes the observed target from the premises before searching, so "true because observed" is never an explanation. Hypotheses are explicit ground candidates built from constants already present; no new entity or cause is invented. Cost-ordered subsets are validated by Horn closure and only inclusion-minimal consistent explanations are kept. Cost is a search preference, not a probability, and depth or candidate limits propagate to `complete`. Nothing is asserted.
- **Diagnosis** ranks supplied ground test queries by how many explanation pairs each separates, a deterministic heuristic rather than Bayesian information gain. A simulated `unknown` outcome is not a measurement, and the runtime never executes a test.
- **Induction** reports opportunities, support, counterexamples, unknowns and conflicts separately over supplied traces; a missing consequent counts as a counterexample only in a trace marked `closed`. A pattern with high support is never a universal rule and is never published automatically ([DS017](specsLoader.html?spec=DS017-skill-systems.md)).
- **Association** ranks supplied traces lexically, relationally or by RecallMemory projection ([DS023](specsLoader.html?spec=DS023-recall-memory.md)); every score is a retrieval hint.
- **Analogy** uses injective constant mappings; transferred properties stay hypotheses.
- **Planning** is uniform-cost search over finite, polarity-explicit states; derived consequences are recomputed rather than copied, reaching the declared goal is reported separately from exhausting the search, and a plan is never executed.
- **Simulation** changes an isolated copy of the state (`sourceMemoryModified: false`). Counterfactual mode requires a rule module in which every rule is marked causal; otherwise it returns `unsupported/causal_model_required`, because correlations are not interventions.
- **Optimization** reports `optimal` only for a completed search; an interrupted search gives `feasible_bound`, and several distinct optima leave an output port ambiguous.

### Extension and omission contract

`ReasoningRegistry.register(name, handler)` accepts trusted host code, never a sandbox for model-emitted code. A handler returns at least `kind`, `status` and `complete`, and also states its epistemic nature, proof or evidence, the actual route and the reason for any unsupported or incomplete result; semantic correctness is established by differential tests against the reference route. An interpreter may list exploration objects it did not use (a pattern, hypothesis or recomputed derived fact) under `ignored`, but never uses them as premises, and it never drops a negation, interval, source, output cardinality, hypothetical status or required theory in order to produce an answer: a required but unknown theory yields `unsupported`.

### Technical references

SWI-Prolog tabling: <https://www.swi-prolog.org/pldoc/man?section=tabling> (the adapter uses Horn profiles and claims none of SWI's well-founded semantics). Z3 guide: basic commands <https://microsoft.github.io/z3guide/docs/logic/basiccommands/>, satisfiability versus validity <https://microsoft.github.io/z3guide/docs/logic/propositional-logic/>, optimization <https://microsoft.github.io/z3guide/docs/optimization/intro/> and <https://microsoft.github.io/z3guide/docs/optimization/arithmeticaloptimization/>; the adapter checks optimality and projections separately. Forward state-space planning follows Poole and Mackworth, *Artificial Intelligence: Foundations of Computational Agents*, 3rd edition, chapter 6 (<https://artint.info/3e/html/ArtInt3e.Ch6.S2.html>); the code is this project's own. These sources describe external techniques, not results of ChatSOP.
