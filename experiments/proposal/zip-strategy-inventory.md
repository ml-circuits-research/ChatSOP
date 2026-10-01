# Zip strategy inventory: every strategy and mechanism in the four experiment zips

Companion to `reasoning-wires-proposal.md`. The proposal (section 2) describes each zip at a high level. This file goes one level down: one entry per algorithm or mechanism found in the unpacked copies under `datasets_sources/experiments_unpacked/` (`soplab-v0.4.0/`, `sop-r/`, `sop_reasoner_e10/`, `vrc03r/`), with the evidence checked against results files and logs, not against README claims.

Date of the check: 2026-10-01. Read-only: nothing in the zips or the repository was changed.

## How to read this file

**Evidence grades.** `strong`: the numbers were reproduced here or are exact-correctness claims backed by an independent comparator. `moderate`: reproducible internal evidence with the authors' own baseline. `weak`: synthetic or designed setup, hidden structure in the supplied language, ties or losses against the simple comparator, or one run. `none`: design text only, no experiment.

**What was re-run here (plain Node, read-only, scratch temp dir, nothing written in the zips except one 0-disagreement file that was deleted at once):**

| Check | Result |
| --- | --- |
| soplab `node --test test/*.test.mjs` | 23 of 23 pass |
| E10 `node --test tests/*.test.mjs` | 202 of 202 pass |
| VRC `node bin/check.mjs` (test + vendor tests) | 113 of 113 pass |
| sop-r `node test/incremental.mjs` | 150 worlds, 1,200 answers, 1,200 identical, 125 incremental continuations |
| sop-r `node test/difftest.mjs 20 7` | 20 scenarios, 340 probe agreements, 0 disagreements (the published figure is 300 scenarios, 5,100) |
| VRC's nine exported `.pl` files under ChatSOP's private SWI-Prolog 9.0.4 (aarch64) | all 9 run; row counts 149, 299, 100, 151, 9, 100, 74, 2,491, 2,500 equal VRC's `answers` in `results/published/benchmarks.json` for all 9 cases. This closes part of the "SWI comparison never run" gap (answers only; the timings come from different machines and are not comparable) |
| Python history experiments E00 to E07 | not re-run (PyTorch and SymPy needed, no installs allowed). Numbers below come from their saved `REPORT.md`, `RESULTS.md` and `results.json`; four were spot-checked against the JSON (E03, E04, E05) |

**Entry fields.** source, essence, kind, evidence, wires needed (with what the proposal lacks), role for ChatSOP, smoke. "Proposal core" means the wires of section 4 (`predicate fact rule aggregate constraint action goal hypothesis policy method` plus the query surface) and the interface of section 5 (`prepare ask update dream`). "Smoke" ids refer to `eval/smoke-reasoning/cases/`; new proposed cases are named `N01` to `N20` and listed at the end.

Entry ids: `Z` = E10 zip (including its history), `S` = soplab, `V` = VRC, `R` = sop-r.

---

# Part 1. E10 zip (`sop_reasoner_e10.zip`)

## Z01. E00 world algebra (selectable semiring worlds, exact contraction)

- **source:** `sop_reasoner_e10/history/records/experiments/E00_world_algebra/` (`REPORT.md`, `RESULTS.md`, `RUNG_0..3.md`, `VALIDATION.md`, `ASSUMPTIONS.md`); original Python/PyTorch in `history/E00-E07-original-master.zip`.
- **essence:** Tasks T1 to T8 are graph and matrix computations (walk counting, shortest path, parity, determinant, Ising-style energy at finite temperature, a linear operator, composition, weighted transfer). A "world" is a semiring (Count, Tropical, LogBeta, ParitySign, Det) over one shared contraction structure. Model M1 is given the contraction and learns only the local factor tables; selection picks one world out of a finite, human-supplied library; projection rounds learned tables to a lattice; L-BFGS refinement repairs optimiser failures.
- **kind:** representation learning with structure (neural weights inside an exact algebraic skeleton). Not an inference engine.
- **evidence:** `REPORT.md`: T1 to T4 at n=32 with 1,000 training examples: M1 100.00% on all four, M0 (structure-free baseline) 0.20, 4.53, 52.53, 0.00%. But `VALIDATION.md` shows M0 is already poor in-domain (0.67% on T1 validation), so the table is not an isolated extrapolation test. H3a partial (cold joint mixture 0 of 3 on T3; two-stage gate 3 of 3). H3c partial (T8 zero-shot 0%). The original finite beta=64 rule fails; the repaired beta=24,645 gives max error 2.9e-4. Not validated: any link to relational reasoning, wires, text, or a selection among algorithms the authors did not supply. Not re-run here.
- **wires needed:** none in the core. Lacks: a closure under a chosen semiring. Shortest path and path counting on cyclic graphs are not expressible, because the proposal forbids `compute` inside a recursive cycle and aggregates inside a cycle (section 4.2).
- **role for ChatSOP:** not relevant as a strategy (neural, no truth decisions). Relevant as a gap: "closure under a semiring" would be one wire (`closure ... semiring count|min_plus|bool`) for the graph questions people actually ask (cheapest route, number of routes). Related idea in the literature: provenance semirings (Green, Karvounarakis, Tannen, PODS 2007; cited from memory, verify before use).
- **smoke:** none exists. New `N16 shortest-path-cyclic-cost` (planner and a semiring closure answer; Datalog must say not expressible).

## Z02. E01 latent algebra (hidden finite algebra identified from final answers)

- **source:** `.../experiments/E01_latent_algebra/` (`REPORT.md`, `RESULTS.md`, `PROTOCOL.md`).
- **essence:** The operation tables of Z3, Z4, GF(4) are hidden (symbols even renamed). Training sees only final answers of expression trees of 4 to 8 symbols. Candidates: a soft neural model, independent rounding, projection onto the axioms of the chosen class, projection plus consistency with the data, and plain symbolic enumeration of every algebra in the class.
- **kind:** representation learning, with a symbolic control that wins.
- **evidence:** `REPORT.md` at 512 examples (mean of 3 algebras x 3 seeds): soft model 50.50% on 512-symbol sums, axiom projection 100% on sums but 85.44% on mixed trees, projection plus data consistency 100% on both. Decisive control: symbolic search reaches 100% on both distributions already at 32 examples in all nine runs, because exactly one algebra is consistent with the labels, so the network adds nothing to identification. Jointly learned symbols and tables from random initialisation: 1 of 9 runs. A non-associative task with wrongly imposed axioms falls to 23.63% and 25.98%. Not validated: any non-finite class, any real task.
- **wires needed:** none.
- **role for ChatSOP:** not relevant. Its lesson is already in the proposal (learned parts never decide truth; enumerate the finite candidate class and check consistency).
- **smoke:** none.

## Z03. E02 exact quotient (L*-style active automata learning for model counting)

- **source:** `.../experiments/E02_exact_quotient/` (`REPORT.md`, `results.json`, `cnf_results.json`, `scaling_results.json`).
- **essence:** A counting problem over bit strings is a finite automaton whose raw state is the last K-1 bits. An exact learner (membership queries plus counterexamples from an exact equivalence checker) discovers the minimal quotient of prefix states; counting then is integer dynamic programming over the quotient.
- **kind:** representation compression with an exact checker (active automata learning). Offline consolidation if run as a skill.
- **evidence:** `REPORT.md`: six hidden targets recovered with learned states equal to the minimal ones (4, 7, 8, 16, 24, 177) at 19 to 2,729 membership queries. CNF families "forbid local patterns": counts equal independent brute force at n = 8, 12, 16, 20 (forbid `111`, n=20: 223,317, which equals the tribonacci recurrence value computed independently here); n=10,000 counted in 0.021 to 0.071 s. Negative control with a pseudo-random acceptance function over the last k bits: exact quotient grows from 10 states (k=4) to 332 (k=9), membership queries 54 to 6,281, so nothing compresses when the structure is absent. Not validated: generic CNF, because the equivalence oracle is the hidden target itself; BDD, SDD or component-caching baselines were not run (the report says so).
- **wires needed:** a `constraint` over a bit or symbol sequence plus a counting task. Lacks: `constraint task count` (model counting); the proposal's `count` counts query rows, not models.
- **role for ChatSOP:** not relevant for now; a possible component for "how many assignments satisfy ..." questions. Low priority.
- **smoke:** new `N15 count-models-local-pattern` (forbid `111`, length 12, expected 1,705; length 20 expected 223,317).

## Z04. E03 neural proposal plus CEGIS (negative result)

- **source:** `.../experiments/E03_neural_cegis/` (`REPORT.md`, `small|medium|large|xlarge_full.json`).
- **essence:** An MLP or decision tree proposes the quotient class of each raw state from exact behavioural signatures; an exact product verifier returns the shortest counterexample; counterexample states are labelled and the proposer is retrained, up to 30 rounds. The proposer is given a favourable interface (it knows the probe set and the class count).
- **kind:** neural proposer with verification.
- **evidence:** `REPORT.md` and `xlarge_full.json` (checked): raw states 7,602, exact quotient by L* 34 states with 949 binary membership answers and 5 equivalence queries; the MLP reaches 97.5% mapping accuracy (`mapping_acc` 0.975 in the JSON), uses about 7,900 equivalent membership answers and 30 equivalence rounds and is never exact (0 of 3); the decision tree is also 0 of 3. On the three smaller families both are exact 3 of 3 but cost 2 to 6 times more oracle bits than L*. Not validated: other tasks; the xlarge MLP uses a reduced 150 steps per round.
- **wires needed:** none.
- **role for ChatSOP:** not a strategy. It is the evidence behind the proposal rule that a learned component may order candidates but never accept one; 98% accuracy was not exact.
- **smoke:** none (the guard is the shadow check of proposal 5.4).

## Z05. E04 verified reasoning skills (state-signature discovery)

- **source:** `.../experiments/E04_verified_reasoning_skills/` (`REPORT.md`, `results.json`).
- **essence:** From small exact traces, a refinement loop searches a supplied meta-language of candidate state signatures, equality quotients, memo keys and pruning predicates, keeps the smallest signature with zero violations on exact continuation values, and compiles it into a skill `(applicability, abstraction or bound, certificate, cost model)`. It rediscovered finite-memory DP, a symmetry quotient for cycle colouring, memoisation with sound pruning for subset sum, and the Bellman state with a certified bound for knapsack.
- **kind:** offline consolidation ("dreaming") of verified shortcuts.
- **evidence:** `REPORT.md`: forbidden patterns n=1000 in 0.003 to 0.029 s; cycle colouring n=10,000 with 19,998 abstract states; subset sum n=64 with 10,944 DP states instead of 2^65-1 nodes; knapsack n=70 with 12,702 DP states against 7,851,190 branch-and-bound calls. A learned proposal guide needed a mean of 1.00 verifier calls, the cheap heuristic 1.33, random 6.83 (`results.json` `proposal_guide`; the learned pick was a "noise" hypothesis in the first rows, and the report itself says it is not better than the heuristic). Not validated: anything outside the supplied signature language; no comparison with a general solver.
- **wires needed:** `action`/`goal` problems and `constraint optimize`. Lacks: a hook where a skill declares a state abstraction for an `action` system, and a skill record with certificate (see additions).
- **role for ChatSOP:** a component inside a dreaming wrapper around exact engines; supplies the skill record shape.
- **smoke:** `06b-constraint-optimize` exercises the optimum; a new case would need a larger knapsack (not proposed; the E10 Pareto case `N02` covers the lifecycle).

## Z06. E05 algorithm composition (a #SAT solver assembled from primitives)

- **source:** `.../experiments/E05_algorithm_composition/` (`REPORT.md`, `results.json`).
- **essence:** 144 exact solver programs are built from primitives (unit propagation, component decomposition, subsumption, canonical memoisation of renamed subproblems, branching rule). The program with the best score on 12 training instances is chosen and frozen, then evaluated on held-out CNFs; a small learned cost model orders which program to evaluate first.
- **kind:** search over algorithm compositions (algorithm selection at the primitive level), with a neural orderer.
- **evidence:** `results.json` (checked): selected `unit>decompose>subsume|memo=canonical|branch=maxocc`, 576 exhaustive soundness checks, 0 errors; held-out work 9 to 31 per instance; scaling rep50 and bridge50 solved with 57 and 111 calls (answers of 48 and 43 digits). The report's own table shows the selection overfits slightly: the held-out best program is `unit>decompose|memo=canonical|branch=maxocc` (no subsumption) with score 2.877 against 2.950 for the selected one, and removing subsumption has "0.9x" work. The ML orderer finds a program within 10% of the optimum in 1 evaluation against 52 for lexical order, but the rank it gives the exact optimum is 3 to 97. Not validated: any real #SAT solver (sharpSAT, d4) as a comparator; the primitive set is supplied.
- **wires needed:** the `constraint` wire in clause form; `count models` (see Z03).
- **role for ChatSOP:** a design pattern for the router (choose a composition by training-set work, freeze it, check held-out) rather than a strategy. Same family as SATzilla-style selection in proposal section 9.
- **smoke:** `N15` (as Z03).

## Z07. E06 dominance invention, transfer and counterexample-driven specialisation

- **source:** `.../experiments/E06_dominance_invention/` (`REPORT.md`, `results.json`).
- **essence:** From pairwise comparisons and conjunction only, the engine synthesises a pruning relation (`iA == iB AND weightA <= weightB AND valueA >= valueB`), obtains an inductive-simulation certificate, compiles it to Pareto-frontier pruning, transfers its relational shape to resource-constrained shortest path, and when a terminal bonus makes the rule unsound it specialises the rule with a counterexample-driven extra literal.
- **kind:** offline consolidation (invention of a pruning skill with exact certificate and CEGIS repair).
- **evidence:** `REPORT.md`: knapsack n=100: raw enumeration 2.5e30 sequences against a final frontier of 624 states (69,501 labels generated); 35,000 training examples, 561 candidates scored, 1 verifier call. Transfer searched 196 mappings and used 1 verifier call (from scratch: 1,940 candidates). Adversarial bonus domain: the base rule is wrong on a concrete pair (completions 5 against 104); CEGIS specialisation took 18 verifier calls and was exact on 20 of 20 fresh instances. Not validated: the predicate language is designer-supplied and the verifier knows the transition semantics, so "certificate" means a hand-built inductive-simulation argument for one domain; in E10 only the fully guarded two-objective anti-join template is recognised (`src/dominance.mjs`), not general synthesis.
- **wires needed:** `action` with numeric state and `constraint optimize` over a plan. Lacks: numeric state in `action` (proposal `action` is STRIPS add/remove only).
- **role for ChatSOP:** a component of dreaming for planning and optimisation; the verifier-gate-plus-CEGIS pattern is the main reusable idea.
- **smoke:** new `N02 dream-gate-rejects-unsound` (Pareto with terminal bonus; an unsound shortcut must be rejected and the sound one accepted).

## Z08. E07 derived-feature invention and failure-driven language growth

- **source:** `.../experiments/E07_feature_invention/` (`REPORT.md`, `results.json`).
- **essence:** To make dominance sound in phase-bonus domains, the learner searches sparse arithmetic expressions over raw state variables as a guard (`-T + 3*i + 2*w >= 0`); when the linear language fails after 300 verifier calls it adds pairwise products and squares and tries again; a hash-like control must be refused.
- **kind:** offline consolidation (representation invention).
- **evidence:** `REPORT.md`: linear feature after 4,432 candidates, 176 verifier calls, 8 counterexamples; quadratic feature after 17,826 expressions and 2,031 verifier calls; the hash-like control is refused after 300 calls (correct). Without the feature, dominance is wrong (19 against exact 154, and 6 against 191). The label-reduction table is weak: 21.6x at n=14 but 1.3x at n=18 and 1.1x at n=22. Not validated: the grammar and the policy "degree 1 then 2" are designer-supplied; not integrated into E10 (`docs/CAPABILITIES.md`: "generic feature invention not yet integrated").
- **wires needed:** same as Z07.
- **role for ChatSOP:** not now (research). Keep only as a source of negative controls.
- **smoke:** none.

## Z09. E08 benchmark comparators and SQLite as an independent engine

- **source:** `sop_reasoner_e10/RESULTS.md`, `results/benchmark.json`, `docs/BENCHMARK_PROTOCOL.md`, `bench/`, `tests/sqlite.test.mjs`.
- **essence:** 14 generator families, 6 modes (`scan_naive`, `indexed_semi`, `greedy_semi`, `verified`, `learned`, hand-written SQLite SQL), 3 held-out seeds, exact comparison with a procedural oracle, budget 500k probes for the scan baseline and 5M for the rest. SQLite uses per-family recursive-CTE SQL written by hand; no compiler exists.
- **kind:** other (comparison method and an extra engine; the engine is a candidate separate strategy: relational lowering to SQL).
- **evidence:** wall times from `RESULTS.md` (recomputed here): on the 12 families where SQLite runs, SQLite beats the best E10 mode on 9 (for example nonlinear recursion 0.55 against 8.71 ms, temporal 1.03 against 5.87, deep recursion 1.41 against 3.25) and loses on 3 (selective join 51.28 against 4.51, existential 2.26 against 1.42, or-evidence 13.96 against 11.61). SQLite is not applicable to mutual recursion and rule-heavy families. The `verified` mode is worse than `greedy_semi` in probes on dense cycles (14,612 against 6,964), mutual recursion (3,593 against 963) and nonlinear recursion (16,785 against 14,355); the `learned` mode has the same probes as `indexed_semi` on 10 of the 13 families where it runs (it improves on deep recursion, selective join and existential; it is not applicable to rule-heavy). Not validated: SQL generated from a SOP program.
- **wires needed:** P0 to P2 core (`fact rule absent count`); stratified negation and recursion lower to `WITH RECURSIVE` with the usual limits (linear recursion only; mutual recursion needs a different encoding). Lacks nothing at wire level.
- **role for ChatSOP:** a possible separate strategy `sql-sqlite` (built-in `node:sqlite`, Node 22.13+ is ChatSOP's floor, and DS018 already uses SQLite for memory). Also the strongest cheap independent control for the Datalog strategies. Needs the generic Datalog-to-SQL compiler to exist first.
- **smoke:** `03`, `04`, `05b`, `07a`, `07b`, `08a-c` would run unchanged; mutual-recursion case needed (new `N05` covers dense recursion).

## Z10. E08 adaptive policy selection (per-family choice of optimisations)

- **source:** `src/learn.mjs`, `src/skills.mjs`, `results/adaptive.json`, `results/adaptive-policies.json`, `RESULTS.md` "Adaptive policy retained", `docs/BENCHMARK_PROTOCOL.md`.
- **essence:** Sixteen combinations of demand specialisation, existential factoring, inlining and Pareto compilation are replayed on small training instances (size 24); the combination with least work is stored as a `verified-policy-selection-v1` record per schema and applied to larger instances.
- **kind:** router feature inside one strategy (trained policy), plus verified plan records.
- **evidence:** `RESULTS.md`: probes against `greedy_semi` improve 9,091 to 60 (reachability), 102,718 to 1,283 (deep recursion), 360,600 to 601 (existential), 1,218,800 to 6,600 (Pareto); selective join unchanged (179 to 179). The dense-cycle policy correctly selects no demand (`adaptive-policies.json`: `demand: false`). Not validated: choice across families; probes are not wall time (see Z13).
- **wires needed:** none; features of the query (recursion, bound arguments, negation) are read from the circuit.
- **role for ChatSOP:** router feature (stage 1 of proposal section 9 applied inside a strategy); the policy record is a skill record of Z18.
- **smoke:** `04`; new `N05 reach-dense-cycle-no-regression` (an optimisation must not be chosen where it loses).

## Z11. E08 learned join plans and the neural join-order ranker

- **source:** `src/learn.mjs` (`learnPlans`, `Ranker`), `results/neural.json`, `results/neural-rankers.json`, `tests/ml.test.mjs`.
- **essence:** `learnPlans` tries up to 96 literal permutations per rule on training programs and keeps the cheapest in probes (`literal-permutation-v1` certificate, trivially checkable). `Ranker` is a 9-input, 12-tanh MLP that scores six legal permutations; it affects order only.
- **kind:** neural proposer with verification (and brute-force plan search).
- **evidence:** `neural.json` (recomputed): 36 evaluations (task seeds times 3 model seeds); mean rank of the true optimum: neural 1.0, analytical cardinality heuristic 1.0, lexical 5.5, random 3.5; all 36 "correct", but it is a tie, and model seeds give identical results. Training 180 samples, 247 ms. Not validated: joins of more than three literals, real schemas.
- **wires needed:** none.
- **role for ChatSOP:** not relevant (a heuristic ties it). Keep as the standing example for "neural-assist" in proposal table 7: it tied.
- **smoke:** none.

## Z12. E09 verified Horn lemma synthesis ("dreaming" of shortcut rules)

- **source:** `src/lemmas.mjs`, `src/dream.mjs`, `docs/DREAMING_AND_CONSOLIDATION.md`, `results/dream.json`, `results/e10-skills.json`, `regression/cases/R09_dreamed_recursive_lemma.sop`.
- **essence:** Resolve one producer rule into one consumer rule to obtain a redundant derived rule (certificate `horn-resolution-lemma-v1`, constructive and hash-bound to both source rules). Replay the program with the lemma on training and hold-out programs against the independent reference evaluator; promote only if the objective `candidateVisits + 32 * rounds` improves.
- **kind:** offline consolidation ("dreaming"); the only skill family in the zip that synthesises a new object rather than recognising a known transformation.
- **evidence:** `results/dream.json`: rounds 96 to 3, but candidate visits 9,310 to 14,057 (1.51 times MORE probe work); the lemma was promoted only because rounds are weighted by 32. Of 4 candidates 1 promoted, 3 rejected. In the large transfer (`e10.json`, `e10-skills.json`) all 4 lemma bundles for `reach` were rejected (gains -0.0006 to -0.128), and the demand-specialisation skill (gain 0.61) was promoted instead. Not validated: any case where lemma synthesis gives a net gain on a real schema.
- **wires needed:** `rule`; nothing else.
- **role for ChatSOP:** a component inside a dreaming wrapper; low expected value (4 of 4 rejected in the transfer test). The objective function (a weighted cost, not a theorem of usefulness) must be an explicit parameter.
- **smoke:** new `N01 dream-equivalence-lemma` (answers identical with and without the prepared lemma; the report must show rounds and probes separately).

## Z13. E10 existential quotient and independent-component factoring (execution skills)

- **source:** `src/join.mjs` (`quotientOpportunities`, `factorOpportunities`), `src/inventors.mjs`, `docs/E10_UNIFIED_DREAMER.md`, `regression/cases/R15`, `R16`, `R17`.
- **essence:** (1) A body variable that occurs in exactly one positive literal and never in the head, a test or a negation can be existentially projected under set semantics (one representative witness row suffices); certificate `existential-variable-quotient-v1`. (2) A body component sharing no variable with the head or the live components is solved as an existence condition instead of a product (independent-component factoring).
- **kind:** inference-engine optimisation, discovered and gated by the offline Dreamer.
- **evidence:** `results/e10.json` (the E10 transfer; trained on worlds of 327, 397, 467 facts and deployed frozen on 106,800 facts). Probes: `visible` 25,002 to 3, `eligible` 251,000 to 1,001. Wall time in the same file is much smaller: `visible` 204.4 to 101.4 ms (2.0 times), `eligible` 198.1 to 103.1 ms (1.9 times), because load and indexing of the 106,800 facts dominate. Four query families only, one schema. The report words (`RESULTS.md`) keep parsing and indexing apart from probes, so the probe ratios in the proposal text (section 2.3) should not be read as latency ratios.
- **wires needed:** `rule`. Nothing lacking.
- **role for ChatSOP:** component of `datalog-e10`; could also be done by any engine as a rewrite. A `dream`-optional rewrite pass.
- **smoke:** new `N03 existential-quotient-large` (an entity with a hundred detail rows, same answers, work reduced).

## Z14. E10 guarded Pareto (two-objective dominance) compilation

- **source:** `src/dominance.mjs`, `regression/cases/R07`, `R08`, `R18`, `results/e10.json`.
- **essence:** Recognises exactly one template: an anti-join `NONE dominated ?x ?a ?b` over a source relation with two mutually-dominating rules over two metrics in a fixed group, and compiles it to a sorted frontier sweep. Anything else (extra literals, unsound variants) is refused.
- **kind:** inference-engine optimisation (certified template), the only residue of E06 integrated into the kernel.
- **evidence:** `e10.json`: `pareto` 1,623,600 to 2,700 probes; wall 878.2 to 101.5 ms (8.7 times). R08 tests that an unsound variant is rejected. Not validated: more than two metrics, other templates; "arbitrary dominance synthesis" is not ported.
- **wires needed:** `rule` with `absent` (closed predicate). Nothing lacking.
- **role for ChatSOP:** component (a recognised template inside `datalog-e10`); a good negative-control source (unsound variants).
- **smoke:** new `N02` (above).

## Z15. E10 demand specialisation (magic sets), inlining (`fuse`)

- **source:** `src/magic.mjs`, `src/skills.mjs` (`fuseRules`), `results/e10.json`.
- **essence:** Standard positive magic-set demand rewriting (binding patterns b/f, fallback when negation is in the slice or after 512 adorned variants) and inlining of a unique non-recursive pure-positive definition (`unique-definition-inline-v1`).
- **kind:** inference-engine optimisation. Already described in proposal sections 2.3 and 7.2; listed here only for completeness.
- **evidence:** `reach` 300,001 probes INCOMPLETE (608.5 ms) to 167 probes COMPLETE (113.6 ms); gain in training 0.61. Dense recursion regresses (see Z09/Z10). No comparison with a real magic-set engine or tabling.
- **wires needed / role / smoke:** as in the proposal; smoke `04`, new `N04 reach-large-bound-source`, `N05`.

## Z16. E10 SkillComposer (replay-composed deployment plan)

- **source:** `src/skills.mjs`, `docs/SKILL_COMPOSITION.md`, `regression/cases/R20`, `results/e10.json` (`compositions`).
- **essence:** Enumerates subsets of already promoted exact skills (the empty subset always included), replays each on the training tasks, rejects any with a different answer or an incomplete run, scores `candidateVisits + roundWeight * rounds`, and promotes only the best subset as a `deployment-plan` bound to schema, query and objective.
- **kind:** offline consolidation.
- **evidence:** `e10.json`: for `reach` the empty subset scores 4,976 and the demand skill 2,037, so the demand skill is deployed; for `visible`, `eligible`, `pareto` one skill each. With at most four skills the subset search is trivial. Not validated: interaction effects among more than one skill (the point of the composer) were not exercised.
- **wires needed:** none. The skill and plan records are host-side.
- **role for ChatSOP:** the rule "a skill that passed alone is not deployed everywhere" belongs in the dreaming wrapper.
- **smoke:** `N01`.

## Z17. E10 InvariantInventor (empirical functional dependencies, advisory only)

- **source:** `src/inventors.mjs`, `regression/cases/R19`, `results/e10-skills.json`.
- **essence:** Finds unary functional dependencies that hold in every replay dataset and stores them as `advisory-only` records; the store never turns them into pruning or filters.
- **kind:** offline consolidation (hypothesis generation, unverified by design).
- **evidence:** `e10-skills.json` (counted here): 18 records: 6 observed invariants, 4 execution fragments, 4 deployment plans, 4 lemma bundles. The report's "14 of 18 promoted" therefore includes the 6 advisory invariants, which are never deployed, and the 4 plans, which repeat the 4 fragments; the distinct deployed skills are 4 (demand, quotient, factor, dominance), all known transformations, and the 4 lemma bundles were rejected. No experiment uses an invariant.
- **wires needed:** `predicate key`. A discovered functional dependency is exactly a candidate `key` declaration.
- **role for ChatSOP:** a router and linting feature: propose `key` and `closed` declarations from data, marked advisory until a coding agent or the owner confirms. Not a reasoning strategy.
- **smoke:** none.

## Z18. E10 EpisodeJournal, Dreamer and VerifiedSkillStore (the lifecycle)

- **source:** `src/dream.mjs`, `src/session.mjs`, `docs/DREAMING_AND_CONSOLIDATION.md`, `docs/E10_UNIFIED_DREAMER.md`.
- **essence:** Online `AdaptiveReasoner` answers with promoted skills only and writes episodes (cost, status). Offline `Dreamer.consolidate` replays journal episodes, asks inventors for candidates, verifies each (constructive certificate, exact replay on held-out programs, cumulative regression), and writes records with status candidate, promoted or rejected into the store, separated by trust class (certified execution skill, advisory, deployment plan). A counterexample against a promoted structural skill quarantines it for its scope.
- **kind:** offline consolidation (the wrapper that turns Z12 to Z17 into a lifecycle).
- **evidence:** 202 of 202 tests (re-run); R15 to R20 regressions; transfer in `e10.json` (Z13 to Z15). Not validated: long-running use, concurrent journals, quarantine under a real counterexample (tested in unit tests only).
- **wires needed:** none in the wire set; needs the host-side records listed in the additions (journal, skill record with scope, certificate kind, status).
- **role for ChatSOP:** the `dreaming-session` wrapper of proposal table 7; this entry gives its concrete record shapes.
- **smoke:** `N01`, `N02`.

---

# Part 2. soplab (`soplab-v0.4.0.zip`, sop-reasoning-lab)

## S01. Rule scoring and ranking (`src/learning/learner.mjs`)

- **source:** `sop-reasoning-lab/src/learning/learner.mjs`, `test/learning.test.mjs`, `experiments/noise-microworlds.mjs`, `results/noise-microworlds-v0.4.0.txt`.
- **essence:** `scoreRule` saturates one candidate rule over each micro-world with the delta evaluator, counts supported positives and unsupported negatives, and scores `accuracy - complexityPenalty * bodyLength`; `rankRules` sorts. It is a scoring loop over a supplied candidate list, not a rule synthesiser.
- **kind:** other (induction by enumeration and scoring; a poor man's ILP).
- **evidence:** `results/noise-microworlds-v0.4.0.txt` (experiment re-read): hidden rule `path:a/b` among 72 candidates (4 relations, bodies up to 2, with inverses), 12 trials per cell; first place in 12 of 12 in every cell except 11 of 12 at noise 0.3 with 1 or 2 worlds (mean rank 1.17). The worlds are generated from the hidden rule (6 positives, 18 random distractor facts, random negatives, not hard negatives); no ILP or rule-mining comparator (FOIL, AMIE) was run. Not validated: bodies of 3 or more, recall under open-world incompleteness, real data.
- **wires needed:** an examples wire (labelled positive and negative tuples) and a candidate generator. The proposal lists `induce` as an out-of-scope research wire.
- **role for ChatSOP:** not a comparison strategy now. A component for later: LLM-proposed rules could be ranked on micro-worlds (see S02) before a human review.
- **smoke:** new `N12 induce-path-rule`.

## S02. Micro-world generator with label noise (`src/learning/microworld.mjs`)

- **source:** `src/learning/microworld.mjs`, `experiments/noise-microworlds.mjs`.
- **essence:** Seeded generator of independent worlds that share a hidden path rule, with distractor facts and a label-flip probability; several worlds are scored together.
- **kind:** other (validation curriculum).
- **evidence:** the same table as S01: at noise 0.3 one or two worlds give 11 of 12, three or five worlds give 12 of 12 (small effect, 12 trials).
- **wires needed:** none (generator is host code).
- **role for ChatSOP:** a validation method: the same idea as sop-r's differential scenarios (R05) and soplab's own `KNOWLEDGE_INGESTION.md`: accept LLM-proposed rules only if they survive independent micro-worlds. Fits the material ingestion flow (AGENTS.md "two learning flows").
- **smoke:** `N12`.

## S03. Path-rule candidate generator (`src/learning/path-rules.mjs`)

- **source:** `src/learning/path-rules.mjs`.
- **essence:** Enumerates chain rules `target(X,Y) :- r1(X,Z1), r2(Z1,Z2), ..., rk(Z,Y)` with optional inverse of each relation, up to `maxBody`; the complexity is the body length.
- **kind:** search (candidate enumeration; space grows as (2R)^k).
- **evidence:** only the micro-world experiment above (R=4, k up to 2). No scaling data.
- **wires needed:** none.
- **role for ChatSOP:** not relevant beyond S01.
- **smoke:** `N12`.

## S04. Best-first search (`src/search/best-first.mjs`, `heap.mjs`)

- **source:** `src/search/best-first.mjs`.
- **essence:** Generic uniform-cost or A* search with a min-heap, state keys, duplicate pruning by best known cost, a heuristic that defaults to 0 (so uniform cost) and a `maxExpansions` ceiling. The heuristic admissibility is never checked.
- **kind:** search or planning.
- **evidence:** unit tests only (`test/strategy.test.mjs`, `core.test.mjs`); no scaling experiment.
- **wires needed:** `action`, `goal` (through S05).
- **role for ChatSOP:** the base of a planner strategy; ChatSOP's JS reference planner is also uniform-cost, so no new capability.
- **smoke:** `11a-plan-strips`, `11b-plan-none`.

## S05. State-space planner with derived preconditions (`src/search/planner.mjs`)

- **source:** `src/search/planner.mjs`, `examples/planning.sop`, `src/workflows.mjs`.
- **essence:** A state is a set of ground facts. At every state a fresh `Reasoner` is built, all rules are saturated, the transition `when` conditions are solved against that saturated state, and `remove`/`add` produce successors. A goal is any query over the saturated state. Consequence: preconditions and goals may use derived relations, `NONE` and aggregates, which plain STRIPS cannot.
- **kind:** search or planning.
- **evidence:** unit and example runs; the proposal's harness runs it through the `datalog-soplab` adapter (`plan` is in its declared features). No benchmark; re-saturating per state is expensive, so scale is unknown. Not validated: any heuristic, any state space beyond toy size.
- **wires needed:** `action`, `goal`, `rule`. The proposal `action` takes `requires` atoms; to use derived preconditions the lowering must allow rule-derived atoms there (it can).
- **role for ChatSOP:** a component or a separate strategy variant `planner-derived`. The capability worth testing is planning with derived and closed-world preconditions.
- **smoke:** `11a`, `11b`; new `N17 plan-blocked-reason` (derived precondition fails; reason returned).

## S06. Minimum-cost abduction by subset enumeration (`src/search/abduction.mjs`)

- **source:** `src/search/abduction.mjs`, `examples/abduction.sop`.
- **essence:** Best-first over subsets of candidate assumptions (cost-ordered, at most 4 by default, subsets built in index order so each set is visited once, `seen` set); each node clones the reasoner, adds the assumptions as `assumption` facts with cost, evaluates the goal on the sliced program, and returns the FIRST (cheapest) explanation.
- **kind:** search (abduction).
- **evidence:** unit tests and `examples/abduction.sop` only. It returns one explanation, not all inclusion-minimal ones, so "minimal" is only "cheapest". Smoke `14a` passes through the adapter.
- **wires needed:** `hypothesis` (exists), `goal`.
- **role for ChatSOP:** a strategy variant for `abduce`; the missing capability (all minimal explanations) would be the useful extension.
- **smoke:** `14a-abduction`; new `N13 abduce-all-minimal`.

## S07. Workflow glue (`src/workflows.mjs`)

- **source:** `src/workflows.mjs` (29 lines).
- **essence:** `planParsed` and `abductParsed` map parsed `transition`, `goal` and `assumption` wires to the planner and abduction controllers.
- **kind:** other (reference lowering of wires to controllers).
- **evidence:** none beyond tests.
- **wires needed:** `action`, `goal`, `hypothesis`.
- **role for ChatSOP:** reference for the adapter in `eval/smoke-reasoning/adapters/zip-soplab.mjs`, which already does this mapping. Nothing new.
- **smoke:** as S05, S06.

## S08. Binding providers (`src/providers.mjs`, `CALL`)

- **source:** `src/providers.mjs`, `examples/custom-provider.mjs`, `test/provider.test.mjs`, `docs/REASONING_MAP.md` ("external symbolic solving = CALL provider").
- **essence:** A provider is a function (or generator) registered by name; `CALL provider args` in a rule or goal body receives the bound arguments and yields extended bindings with evidence. Built-ins: `range` and `member`. It is soplab's mechanism for plugging external solvers, databases and numeric routines into rules as relations.
- **kind:** other (interface for external engines inside a rule).
- **evidence:** provider unit tests (23 of 23 suite pass, re-run); no solver was ever plugged in. Not validated: provider cost accounting beyond a `providerCalls` counter, determinism, error handling under budget.
- **wires needed:** a leaf `call provider args` with a declared mode (which arguments must be bound), determinism and a budget share. **The proposal has no such leaf**: Z3 and SWI are whole-problem strategies there, so a rule that needs one arithmetic or solver sub-question cannot ask for it.
- **role for ChatSOP:** an interface feature (external relation leaf) that would let `z3-lia` and `prolog-swi` serve inside a Horn rule, which is the "two-stage circuit via `$q`" of section 4.3 made one stage.
- **smoke:** new `N11 provider-external-relation`.

## S09. Variant comparison harness (`src/comparison.mjs`)

- **source:** `src/comparison.mjs`, `docs/COMPARISON_PROTOCOL.md`, `docs/WIRE_IDEAS.md` ("A, B, C comparison").
- **essence:** `compareVariants({build, variants, expectedRows})` runs the same workload under several evaluator variants, compares sorted JSON binding rows against a reference, and returns metrics per variant. The protocol document asks for three arms per candidate wire: ordinary rules, a specialised wire, an external provider, with answer equivalence, proof quality, representation size and cost recorded.
- **kind:** other (validation method).
- **evidence:** used by `test/strategy.test.mjs` and `experiments/evaluation-strategies.mjs`. Equality is set equality of rows only (no proof or status comparison).
- **wires needed:** none.
- **role for ChatSOP:** the shadow check of proposal 5.4 already exists in `eval/smoke-reasoning/run.mjs`; adopt the A/B/C arm structure for deciding whether a new wire or specialised template earns a place.
- **smoke:** none (harness feature).

## S10. Relevance slicing in front of naive or delta evaluation (`scope: sliced|global`)

- **source:** `src/dependency.mjs`, `src/engine/materialize.mjs`, `results/benchmark-current.txt`, `docs/SCALING_STRATEGY.md`.
- **essence:** Backward dependency slice of the rules reachable from the goal, then naive (all rules every round) or semi-naive delta materialisation of that slice. Not tabling, not magic sets (the document says so).
- **kind:** inference engine.
- **evidence:** `benchmark-current.txt` (60-node graph, 40 irrelevant rules, mean ms): delta+sliced 96.0, delta+global 85.0, naive+sliced 242.4, naive+global 249.8. So delta halves the candidate rows (18,885 against 45,222) and runs about 2.6 times faster than naive, but slicing did not help here (candidate rows 18,885 sliced against 18,910 global; slicing is slower in mean time). The proposal quotes the delta numbers correctly; the reader should not conclude that slicing helps. Not validated: any workload where irrelevant rules fire.
- **wires needed:** none.
- **role for ChatSOP:** already covered as `datalog-soplab`. Note: slicing is useful only when irrelevant rules would otherwise fire.
- **smoke:** `04`, `03`.

## S11. Specialised graph-closure wire against recursive rules

- **source:** `experiments/graph-wire-vs-rules.mjs`, `results/graph-wire-vs-rules.txt`, `examples/custom-wire.mjs`, `src/wire-types.mjs`.
- **essence:** A custom wire type `graph` answers reachability with one breadth-first search instead of recursive rule firings. It is the worked example of the A/B/C protocol (S09).
- **kind:** inference engine (native closure operator for a recognised pattern).
- **evidence:** `graph-wire-vs-rules.txt`: same 44 answers; rules 18,885 candidate rows, 2,104 firings, 22 rounds, 151.9 ms; wire 87 edge visits, 1 call, 0.91 ms (one run on a 45-node graph, the comparator is soplab's own generic evaluator, not a plain BFS). Similar to VRC's reach template (V03).
- **wires needed:** a closure pattern recognised from `rule`s, or a `closure` wire. The proposal has neither; E10's magic sets and VRC's reach template do the equivalent without a wire.
- **role for ChatSOP:** router feature: detect the transitive-closure template and dispatch to a native search, as V03 does. Together with `predicate transitive true` (additions).
- **smoke:** `04`; new `N18 closure-template-vs-rules`.

## S12. Abstraction learning (design only: levels A to D)

- **source:** `docs/ABSTRACTION_LEARNING.md`, `docs/EXPERIMENT_ROADMAP.md`.
- **essence:** Intended loop: collect proof and search traces, canonicalise, find repeated or expensive subgraphs, anti-unify into a candidate abstraction, validate on independent tasks, install as a rule, named circuit, scheduling macro or specialised wire. Rule: do not report an execution macro as a newly learned semantic concept.
- **kind:** offline consolidation (design).
- **evidence:** none. Only level A (rule ranking, S01) has code. The roadmap's own status is "should not be lost".
- **wires needed:** proof DAG with stable rule ids (exists in the proposal's `explain`).
- **role for ChatSOP:** design note: the semantic abstraction against execution macro distinction belongs in the dream skill record (Z18).
- **smoke:** none.

## S13. Knowledge ingestion with a teacher LLM (design only)

- **source:** `docs/KNOWLEDGE_INGESTION.md`.
- **essence:** A large LLM proposes facts, rules, procedures, definitions and a validation curriculum; symbolic checks and micro-worlds accept or reject before the knowledge becomes persistent.
- **kind:** other (process; same as sop-r's compile loop and ChatSOP's `material-to-sop`).
- **evidence:** none in soplab.
- **wires needed:** the knowledge wires of the proposal; nothing new.
- **role for ChatSOP:** not relevant as a strategy; consistent with AGENTS.md ("independent host approval before knowledge accumulates").
- **smoke:** none.

---

# Part 3. VRC (`vrc03r.zip`, sop-vrc-reasoner 0.3.0)

## V01. `VRCStrategy` host facade (`src/strategy.mjs`)

- **source:** `vrc03/src/strategy.mjs`, `docs/PLANNING_VRC.md`, `REPORT.md`, `results/v03/handover-experiment.json`, `test/handover-core.test.mjs`.
- **essence:** `solve({sop, kind: auto|plan|query, learning: off|reuse|on-demand, shadow, arithmetic: exact|float64})` returns one packet. Exact first: a stored artifact is imported only after re-certification against the current contract; otherwise full exact search runs. Every positive plan is replayed in the original rules; with `shadow` the result is compared with full exact search and a disagreement revokes the artifact. Failures are statuses, never silence: `COMPLETE`, `APPROXIMATE`, `BUDGET`, `UNKNOWN`, `INVALID`, `ERROR`, and `NO_MODEL` (bounded search found no representation: "not a theorem of irreducibility"). Timings are reported per phase (parse, lookup, compile, prepare, search, replay).
- **kind:** neural-free orchestration around an exact engine with offline consolidation (a model for the strategy interface itself).
- **evidence:** 113 of 113 tests re-run here. The authors' own audit of v0.2 found five real defects (epsilon rounding of keys made 0 and 1e-13 the same state; a supplied artifact could run for other laws; replay chose an arbitrary mode branch; exhaustive mode stopped at the start state; `COST` clauses were silently ignored), fixed in v0.3 (`results/v03/audit-before.json`). Differential: 4,764 relational worlds with 14,288 comparative runs and 169 proof checks, 0 differences (`results/v03/legacy-validation.json`); 160 planning worlds, 141 plans replayed exactly, 0 differences. These are the authors' own engines as comparators.
- **wires needed:** result packet extras that the proposal lacks: `guarantee exact|approximate`, `bound`, `completeWithinBound`, `objective`, phase timings, `witness verified`, a hash of the contract and of the task. See additions.
- **role for ChatSOP:** the most useful design reference in the zips for the strategy interface and the shadow gate; the strategy itself is V09.
- **smoke:** all cases through the shadow check; new `N09`.

## V02. Isolated execution (`src/strategy-worker.mjs`, `src/isolated.mjs`)

- **source:** `vrc03/src/isolated.mjs` (20 lines), `strategy-worker.mjs` (10 lines), `test/handover-core.test.mjs` lines 158 to 164.
- **essence:** `runIsolated(request, {timeoutMs, memoryMb, signal})` runs `solve` or `dream` inside a `worker_threads` Worker with `resourceLimits.maxOldGenerationSizeMb`, a wall-clock timer and an abort signal; timeout, heap exhaustion and cancel all return `BUDGET`, a crash returns `ERROR`; results are JSON-copied so no live objects leak. The document says it is not an OS sandbox.
- **kind:** other (budget enforcement and containment).
- **evidence:** tests cover result, cancel and a 1 ms timeout; no memory-limit test. A cooperative `maxMs` inside engines cannot stop a stuck native loop; this can.
- **wires needed:** none. Lacks: an interface capability `isolation` saying a strategy may be run in a worker and must be stoppable at a wall limit.
- **role for ChatSOP:** a router and harness feature: run any strategy (especially planned heavy ones, SWI, a future clingo) under wall and heap limits and map the stop to `budget_exhausted`. ChatSOP's SWI and Z3 adapters use child processes with time limits already; this adds the same for in-process JS strategies.
- **smoke:** new `N14 wall-timeout-isolated`.

## V03. Reachability template and demand-directed graph search (`src/reach.mjs`)

- **source:** `vrc03/src/reach.mjs`, `src/engine.mjs`, `docs/MECHANISMS.md` section 3, `results/published/benchmarks.json`, `exports/*.pl`.
- **essence:** `discoverReach` recognises, after expanding acyclic condition wires, a predicate defined by exactly one base rule `p(X,Y) :- edge(X,Y)` and one linear recursive rule with an extensional edge relation (a "transitive-closure-template"). `ReachProvider` then answers a pattern with a breadth-first search from the bound argument, caches per start node and keeps parent pointers so a witness path can be reconstructed (`reachWitness`). Near-matches fall back to the generic evaluator.
- **kind:** inference-engine optimisation (template recognition plus native search).
- **evidence:** `benchmarks.json` (warm medians, ms, indexed against optimised): chain 75.9 to 0.41 (184x), tree 9.7 to 0.54 (18x), cycle 60.9 to 0.23 (264x), layered 132.9 to 0.34 (395x), disconnected 42.5 to 0.031 (1,382x), stand-alone BFS with prebuilt adjacency 0.002 to 0.13 ms (faster still). On the other eight cases (selective join, skewed join, policy with negation, points-to, grouped aggregate, numeric cases) the optimised mode is within +-27%: no gain. Correctness: all nine exported `.pl` programs under SWI-Prolog 9.0.4 return the same row counts here (149, 299, 100, 151, 9, 100, 74, 2,491, 2,500). The authors' own text says the large ratios compare query-directed execution with broad bottom-up materialisation; it is not a new graph algorithm.
- **wires needed:** `rule` pairs of the template shape. Lacks only `predicate transitive`/`closure` as an optional hint.
- **role for ChatSOP:** a component inside Datalog and js strategies; also the evidence for a router rule "closure with bound argument: use native search".
- **smoke:** `04`; new `N04`, `N18`.

## V04. Numeric fragment discovery and forecast leaf (`src/numeric.mjs`)

- **source:** `vrc03/src/numeric.mjs`, `docs/MECHANISMS.md` sections 4 and 7, `vendor/vrc/REPORT.md`, `results/published/benchmarks.json` (numeric cases), `history/reports/next.md`.
- **essence:** A rule body may `CALL` a forecast `(entity, horizon)` over a polynomial transition law (`INTERPRETER vrc.polynomial.v1`, `STATE`, `NEXT`, `GUARD`). `discoverNumericFragments` follows `NEXT` and guard dependencies backward from the observed coordinates, unions overlapping closures, renames coordinates canonically and caches by the canonical text. `NumericManager` has policies `vrc` (use a learned reduced model), `sliced` (structural slice only) and `full`, uses exact BigInt rationals or marked float64, returns `BLOCKED` when state facts are missing or contradictory, and records receipts that can be replayed (`replayNumericEvidence`) without relearning. Fragments are limited to 32 coordinates, a whole program to 10,000.
- **kind:** representation compression with exact certificate, used as a leaf inside logical inference.
- **evidence:** `vendor/vrc/REPORT.md`: 1,000,000 numeric SOP facts (63.67 MB, 2,000,000 lines, load 3.5 s), five local templates over 200,000 entities: reduced against fastest reference 1.48x (1 step) to 4.92x (16 steps), 4.62x (64 steps) in batch mode, 1.96x to 3.53x in ring mode (same Horner and common-subexpression emitter on both sides); amortised after about 11 complete simulations (`next.md`). In the published relational benchmark the numeric cases gain 1.0x to 1.26x (`numeric-256-steps` 76.5 to 60.7 ms). Not validated: nonlinear real data, noise, any comparator other than the authors' own emitter.
- **wires needed:** numeric `action` or `forecast` leaf with `state`, `next` equations over rationals, `guard`, `observe`, `horizon`. The proposal has none (`simulate` is an out-of-scope research wire; `compute` takes integers only).
- **role for ChatSOP:** not relevant to current ChatSOP questions (no polynomial dynamics in the corpora); keep as a niche component behind a numeric leaf if scenario simulation ever becomes a use case.
- **smoke:** new `N09 numeric-symmetric-plan` (as V09).

## V05. Exact rational arithmetic DAG (`src/exact-runtime.mjs`)

- **source:** `vrc03/src/exact-runtime.mjs`, `vendor/vrc/src/rational.mjs`, `docs/MECHANISMS.md` section 6, `test/handover-core.test.mjs`.
- **essence:** Compiles polynomial updates to a shared Horner-style DAG with common-subexpression sharing over BigInt numerators and denominators; values canonical, memo keys exact, no epsilon equivalence.
- **kind:** other (exact evaluation component).
- **evidence:** unit tests (values beyond 2^53, rationals as small as 1/10^13 distinguished from 0; the defect found in v0.2 was exactly this). No isolated exact-against-float benchmark; all handover timings are exact-arithmetic ones.
- **wires needed:** the term type `rational` (the proposal has only safe integers: money in cents, time in minutes) and `divided_by` that is exact. The proposal's `compute` says integers only; this would be a deliberate extension.
- **role for ChatSOP:** a component for exact `compute`; today a thresholds-on-fractions problem is not expressible.
- **smoke:** `06d-rule-arithmetic`; new `N10 exact-rational-threshold`.

## V06. Streaming claim loader (`src/stream.mjs`)

- **source:** `vrc03/src/stream.mjs`, `results/published/large.json`, `docs/LIMITS.md`.
- **essence:** Reads claim-only SOP files (optionally gzip) line by line into the fact store with interned terms, retaining source file, line and the sha256, byte and line counts of every input, with a fact ceiling (2,000,000) and a line ceiling; the combined program hash includes the input hashes. Snapshots cannot be forked (rebuild instead).
- **kind:** other (fact-source ingestion).
- **evidence:** `large.json`: 1,000,000 facts loaded in 9.8 s in the published run (3.5 s in the v0.3 report), generation 24.0 s; "the million-rule case is one million background facts and about 1,003 rules, 4,200 active facts", so the large speed-ups measure query localisation. Memory resident, hundreds of MB.
- **wires needed:** none. `fact` with `source`; the input digest belongs in the result packet.
- **role for ChatSOP:** a hint for the memory side (section 10): record the digest of the fact source in the answer so a reasoning result is reproducible. No new strategy.
- **smoke:** none.

## V07. Persistent learned registry, trace store and `dream()` (`src/learning.mjs`)

- **source:** `vrc03/src/learning.mjs`, `docs/LEARNING_AND_DREAMING.md`, `results/published/dreaming.json`, `learned/` (2 stored artifacts and one trace file), `test/handover-core.test.mjs`.
- **essence:** `LearnedRegistry` stores law-specific artifacts under a contract hash (ordered variables, action ids, equations, guards, observables; initial facts and goal thresholds are excluded). Lookup re-certifies; corrupt, hash-mismatched or unsafe-file entries are `QUARANTINED`; `revoke` persists and cannot be undone by dreaming; a failed search is cached by learner version and budget (negative cache); writes use a file lock and atomic rename. `ReasoningTraceStore` records opt-in traces with SOP snapshots. `dream()` groups traces by contract, prioritises recurrent high-work groups, runs the same learner under an explicit budget, recomputes certification and promotes.
- **kind:** offline consolidation ("dreaming") around an exact planner.
- **evidence:** `dreaming.json` (recomputed): three training tasks, one promotion (dimension 5, 1,215 ms compile), 12 held-out tasks all hit; `summary`: median warm speedup 14.2x, median unique-state reduction 7.75x, all-12-task series 15,038 ms against 5,746 ms including the three training tasks and the dream pass (2.62x). My recomputation of per-task ratios without lookup gives 4.1x to 29.8x. Held-out tasks have the same contract hash as the training tasks (same laws, different initial facts), so this is reuse of one law, not transfer across families.
- **wires needed:** none in the wire set; needs the host-side records (journal, artifact with scope and contract hash, status including quarantine, revoke, negative cache) listed in the additions.
- **role for ChatSOP:** a component: the `dream` call of the interface (section 5.2), with the lifecycle semantics already worked out here (the better-specified half of Z18).
- **smoke:** `N01`, `N09`.

## V08. SWI-Prolog exporter (`src/swi.mjs`) and the nine exported programs

- **source:** `vrc03/src/swi.mjs`, `vrc03/exports/*.pl`, `results/published/external.json`, `experiments/external.mjs`.
- **essence:** Exports the pure relational subset (no aggregates, no `CALL`; `NONE` only on covered predicates) to a tabled Prolog program with a `run/2` that times cold and five warm runs after `abolish_all_tables`.
- **kind:** other (comparison adapter).
- **evidence:** `external.json`: all 9 cases SKIPPED (no `swipl`). Re-run here with the private SWI 9.0.4: 9 of 9 produce the VRC answer counts (see the table at the top). Times from this host (aarch64) were 0.26 ms to 220 ms warm and are not comparable with the VRC times (EPYC x86).
- **wires needed:** none.
- **role for ChatSOP:** already covered by the existing `prolog-swi` adapter; the nine files are ready-made independent cross-check cases for the Datalog strategies and for a future `prolog-tabling` strategy.
- **smoke:** none exist; the nine programs can be added as a `bench` set (not as smoke).

## V09. Compressed-state planning (`src/planner.mjs`, profile `vrc.search.v1`)

- **source:** `vrc03/src/planner.mjs`, `docs/PLANNING_VRC.md`, `docs/MECHANISMS.md` section 5, `results/v03/handover-experiment.json`, `results/published/planning.json`.
- **essence:** Existential unit-cost reachability over numeric states and finite logical modes. Breadth-first search with one visited table per task; states with equal certified encodings E(x) and equal mode are merged (sound because E(T(x)) = G(E(x)) and guards and observations factor through E). Goals `OBSERVE h >= v`, `MAX-DEPTH`. Status FOUND, NOT_FOUND, BUDGET (stored-state ceiling, wall time, rational size). The returned plan is replayed in the original rules. Non-unit `COST` clauses are rejected, not ignored.
- **kind:** search or planning with representation compression.
- **evidence:** `handover-experiment.json` and `REPORT.md`: energy world 25 to 5 coordinates, 68,726 to 6,313 distinct states, 1,933 ms to 49 ms (39.5x warm; 1.92x including discovery); product world 144,799 to 264 states, 2,511 ms to 1.46 ms (1,719.7x warm; 6.50x cold); guard-rich control 111 to 111 states, 0.96x warm and 0.17x cold, a loss. The energy encoder is `?q` plus four sums of squares of three coordinate pairs each: the world was generated with that symmetry. Not validated: any externally defined planning benchmark, weighted cost, probabilistic or adversarial planning.
- **wires needed:** `action` with numeric `state`, `next`, `guard`; `goal` over an observation threshold; `mode` as logical state. The proposal's `action` has none of the numeric part.
- **role for ChatSOP:** the `vrc-compressed-planning` strategy of proposal table 7, limited to numeric planning with symmetry; the proposal row is correct, but the missing wire (numeric `action`) should be listed.
- **smoke:** `11a`, `11b` run on the planner part; new `N09`.

## V10. Representation discovery by closure search (`vendor/vrc/src/learner.mjs`, rule-oracle mode)

- **source:** `vendor/vrc/src/learner.mjs`, `poly.mjs`, `certificate.mjs`, `docs/TECHNIQUE.md`, `vendor/vrc/results/summary.json`, `history/reports/next.md`, `uni.md`, `ml.md`, `vrc.md`.
- **essence:** Given polynomial dynamics T and a requested observable, search an encoding E (polynomials of degree up to 4, at most 4 latent coordinates) and reduced dynamics G of degree up to 2 with E(T(x)) = G(E(x)) and observable decoded from E. Exact sparse linear elimination tests whether every pullback lies in the span of the current latent library; a residual drives proposals (direct residual, multiplicative factorisation, additive decomposition); candidates are searched in order of dimension and cost under time and state budgets. `certify` recomputes all identities exactly.
- **kind:** representation learning or compression with an exact certificate (algebraic lumping of dynamical systems; related in spirit to Koopman and Krylov reductions).
- **evidence:** `vendor/vrc/REPORT.md`: 96 of 96 models from earlier Python work re-verified with the Node kernel; rediscovery from known rules 96 of 96 with 6 of 6 irreducible controls rejected. Earlier reports: on 16 families times 6 configurations, current search 96 of 96, previous version 72 of 96, EDMD with Krylov reduction 64 of 96 (union 88 of 96), full-state polynomial regression predicts all 96 but keeps 5 coordinates (`next.md`); an adversarial test found 4 failures on admissible representations (96 of 100, `uni.md`); in the strict-noise tests no model is accepted (`ml.md`, 48 runs). Not validated: any non-designed system; the proposal families are authors' synthetic families.
- **wires needed:** same numeric `action` as V09.
- **role for ChatSOP:** a dreaming component for numeric planning only; no use outside it.
- **smoke:** `N09`.

## V11. Data-only (sample oracle) mode (`vendor/vrc/src/oracle.mjs`, `samples.mjs`)

- **source:** `vendor/vrc/src/oracle.mjs` (`SampleOracle`), `samples.mjs`, `vendor/vrc/results/data-only.json`, `history/reports/ml.md`.
- **essence:** The same closure search where pullbacks are fitted by least squares from state pairs (`train.N.before/after` SOP claims), rationalised, and kept as a candidate until an exact formal model certifies them.
- **kind:** neural-free learning of exact structure from data (candidate then certified).
- **evidence:** `data-only.json`: 8 mechanism smoke cases, all `CANDIDATE` with certificate true after the fact (1,024 train, 256 validation); the certificate uses the simulator's equations, which a real data-only setting would lack. Strict-noise tests: no model accepted (relative noise 1e-6 to 1e-2, 48 runs).
- **wires needed:** none.
- **role for ChatSOP:** not relevant.
- **smoke:** none.

## V12. Power-sum decomposition proposal (`vendor/vrc/src/proposals.mjs`)

- **source:** `vendor/vrc/src/proposals.mjs` (`powerSum`), `history/reports/next.md`.
- **essence:** For a homogeneous polynomial F = sum_j w_j (a_j . x)^d, take two Hessians at generic points, restrict to the active subspace, and read the directions a_j from the eigenvectors of H1 H0^-1; rationalise and accept only on exact polynomial equality (up to 8 attempts).
- **kind:** representation learning (a specialised proposer inside V10).
- **evidence:** adding it moved the batch from 72 of 96 to 96 of 96 (`next.md`); fails on dependent forms, high rank or poor conditioning.
- **wires needed:** none.
- **role for ChatSOP:** not relevant.
- **smoke:** none.

## V13. Ring coupling certificate (`vendor/vrc/src/composition.mjs`)

- **source:** `composition.mjs` (`certifyRing`), `vendor/vrc/REPORT.md`.
- **essence:** Certifies, by exact polynomial identity, that a reduced model composes with a given neighbour-coupling topology through one preserved coordinate; the topology and coupling form are supplied.
- **kind:** other (certified composition for a ring).
- **evidence:** ring-mode speedups 1.96x to 3.53x (V04); only one topology.
- **wires needed:** none.
- **role for ChatSOP:** not relevant.
- **smoke:** none.

## V14. Column-class suffix compression for injective assignment counting (exp2 and audit)

- **source:** `vrc03/history/reports/exp2.md`, `audit.md`, `history/archives/exp2.zip`.
- **essence:** To count injective assignments of tasks to resources (the permanent or matching count of a 0-1 matrix), resources with the same eligibility signature over the remaining tasks are merged into classes; the state is the vector of used counts per class, and a transition multiplies by the free count of the class; merged classes add counters. Exactness has a short proof and a counterexample for over-aggressive compression is stored.
- **kind:** representation compression for counting.
- **evidence:** `exp2.md`: mixed 14 tasks by 20 resources: maximum states 176,478 to 122, 1.33 ms against 10.8 ms for the best of three baselines (subsets of tasks); dense random incidence 112.5 ms against 4.8 ms (loses); 6,098 instances agree with brute force and three DP references. `audit.md`: not a new discovery (Kiah, Vardy, Yao trellis; weighted-automaton minimisation by Lombardy and Sakarovitch; cited by the audit).
- **wires needed:** a counting constraint on assignments (`constraint` plus count).
- **role for ChatSOP:** not relevant.
- **smoke:** none.

## V15. Evaluation protocol templates (`research/`)

- **source:** `vrc03/research/protocol-template.json`, `result-template.json`, `check-roadmap.mjs`, `catalog.json`, `coverage.json`, `docs/RESEARCH_PROTOCOL_RO.md`.
- **essence:** A frozen-protocol JSON template (hypothesis, information access of learner, baseline and checker, held-out unit, seeds, budgets, acceptance and falsification criteria, negative controls, required gates S1 to S6, timing: 5 independent processes, 2 warm-ups, 10 paired repetitions, with a list of phases that must be in the total: load, index, lookup, discovery, certify, prepare, search, replay, output, failed discovery, dreaming, selector, maintenance), plus the 48 research cards (covered in proposal 2.5).
- **kind:** other (evaluation method).
- **evidence:** the template status is `PLANNED`; `check-roadmap.mjs` is a consistency check of the cards. No executed experiment.
- **wires needed:** none.
- **role for ChatSOP:** adopt as the preregistration skeleton for the comparison of section 11 (matches DS007).
- **smoke:** none.

---

# Part 4. sop-r (`sop-r.zip`)

## R01. Rule lifting: rule families into one template plus a parameter table (`src/lift.mjs`)

- **source:** `sop-r/src/lift.mjs`, `docs/SCALARE.md` section 4.3, `bench/results/results.jsonl`.
- **essence:** Rules that have the same shape after renaming variables and abstracting constants (grouped by a canonical signature; at least 3 members; rules referenced by `overrides` or `supersedes` are left alone) are replaced by one template rule that reads `?inst lift-N-pK ?value` parameter facts, plus those facts. "Which rule applies to X" becomes an indexed lookup. The rewrite keeps instance k equal to rule k.
- **kind:** other (compilation of knowledge; a representation change before inference).
- **evidence:** `results.jsonl` (checked): answers equal across all five configurations at the three sizes. At 100,000 entities with 10,000 class rules (rules drop to 10) lift gives no gain: first query 1,580 against 1,454 ms, what-if add 30.9 against 32.1 ms, memory 867 to 854 MB. Its effect shows at 200,000 rules: what-if add 223 to 41 ms, memory 1,381 to 1,043 MB (SCALARE). The answers compared are single counts or values per query, a weak equivalence check. Not validated: lifting with `overrides`, rules whose constants occur in several positions, real LLM output.
- **wires needed:** `rule` only. Lacks nothing; the best advice of the document is that the coding agent should write the general form in the first place (sop-r spec section 4).
- **role for ChatSOP:** a component in the knowledge compiler or in `worlds-sopr`; irrelevant until a source yields thousands of same-shape rules.
- **smoke:** new `N08 rule-family-lift`.

## R02. Hypothetical worlds: copy-on-write forks with incremental continuation (`World`, `_newSat`)

- **source:** `sop-r/src/engine.mjs` (lines about 77 to 110 and 823 to 1030), `docs/IMPLEMENTARE.md` section 3.3, `docs/SCALARE.md` section 7, `test/incremental.mjs`, `bench/results/results.jsonl`.
- **essence:** A world forks the fact store by relation (cost proportional to the number of relations; first write to a shared relation makes a delta layer). On the first query after a change it computes the forward cone of changed relations; pure additions on monotone paths are propagated semi-naively through the trigger index; relations reached through negation, aggregation, exceptions, or after any deletion are recomputed lazily; finished relations outside that set are shared with the parent. Sibling worlds saturate their common parent once. `assume` nests.
- **kind:** inference engine (incremental maintenance for what-if).
- **evidence:** `incremental.mjs` re-run here: 150 worlds (96 pure addition, 54 mixed), 1,200 answers, all identical to recomputation. Timings (`results.jsonl`, 100,000 entities, 10,508 rules): what-if add 30.9 ms against 29,424.5 ms for the authors' naive algorithm and 12,675 ms for semi-naive with join order. But what-if `set` (a modification, hence a deletion) costs 870.5 ms, 28 times more than an add; deletions are not incremental. The naive comparator is the Python prototype's algorithm (whole recompute per world), not an independent engine. The proposal quotes 30.9 ms; the set case belongs next to it.
- **wires needed:** `ask(problem, assumptions)` and `update(handle, delta)` exist in the proposal. Lacks: `fork(handle)` (several worlds over one base), a delta that distinguishes add, remove and `set` (a `set` on a relation not declared with `key` deleted a person's other tanks in the pilot's one miss), and a result flag saying whether the world was incremental or recomputed.
- **role for ChatSOP:** the `worlds-sopr` strategy of proposal table 7. As a component it can sit inside any saturating engine.
- **smoke:** `14b-whatif-supposition`; new `N06 whatif-many-worlds` and `N07 whatif-nonmonotone-cone`.

## R03. Dependency cone, lazy saturation, trigger index, greedy join order (engine core)

- **source:** `sop-r/src/engine.mjs`, `docs/IMPLEMENTARE.md` sections 3.1 and 3.2, `docs/SCALARE.md` sections 4 to 6, `bench/results/results.jsonl`.
- **essence:** Dictionary-encoded triples with per-relation subject and object indexes; a query saturates only the relations in its backward dependency cone, by strata; a trigger index `(relation, position, constant)` finds the rule atoms a new fact can feed; semi-naive rounds start from the delta atom; joins are ordered greedily by estimated cardinality.
- **kind:** inference engine.
- **evidence:** `results.jsonl` at 100,000 entities: first query 28,611 ms (naive), 11,036 ms (semi-naive plus join order), 1,580 ms (full). The cone has a cost: a point query (`e17 limit ?`) costs 1,079 ms in `full` against 10 ms naive, because the cone selects relations, not entities (magic sets are named as the missing piece, which E10 provides). The claim that semi-naive without join ordering can be slower than naive (10.8 s against 3.2 s at 20,000 entities, SCALARE section 6) has no results row in the zip. Not validated: mutual recursion at scale, memory per fact (about 365 bytes without and 680 with derivations).
- **wires needed:** none.
- **role for ChatSOP:** already represented by the `worlds-sopr` and Datalog strategies; the point-query penalty is the reason for a router rule: bound-argument point queries on big knowledge go to demand-driven engines.
- **smoke:** `20`, `21`, `22` (retrieval); new `N19 point-query-large-kb`.

## R04. `method` and `plan` with `BLOCKED` and reason strings

- **source:** `sop-r/src/engine.mjs` (plan expansion), `docs/PROPUNERE.md` section 2, `docs/SPEC.md`, `experiment/` pilot scenarios.
- **essence:** A `method` wire has `task`, applicability conditions, `require`, `forbid`, `require-test` lines with reason strings, ordered `step`, nested `do` sub-tasks and effects `add`, `remove`, `set`. `plan` expands methods in the current world and returns the steps, or `BLOCKED` with the failing requirement and its reason, so the answer reads "cannot, because ...".
- **kind:** search or planning (HTN decomposition with explained failure).
- **evidence:** within the pilot (72 answers per run; symbolic r1 72, r2 71, r3 72 of 72; the single miss was a query error); no HTN benchmark and no comparison with a standard HTN planner.
- **wires needed:** the proposal `method` has `achieves`, `when`, `step`, `cost`. Lacks: `require`/`forbid` with a reason string and a `plan` status that carries the failing requirement (`blocked_by`). The proposal's `no_plan` loses the reason.
- **role for ChatSOP:** the `htn-strips-planner` strategy of table 7; the reasoned failure is the part to keep.
- **smoke:** `11c-procedure-method`; new `N17 plan-blocked-reason`.

## R05. Differential testing of independent compilations (`test/difftest.mjs`)

- **source:** `sop-r/test/difftest.mjs`, `test/cases/pilot.json`, `docs/IMPLEMENTARE.md` section 4.
- **essence:** Several independently compiled knowledge bases for the same handbook (here three Sonnet compilations and one reference) are queried over hundreds of random scenarios (`assume` additions); every probe must agree. A disagreement points at an ambiguity in the text or a compilation error, without answer keys.
- **kind:** other (validation method for LLM-compiled knowledge).
- **evidence:** published: 300 scenarios, 5,100 of 5,100 probe agreements per compilation. Re-run here with 20 scenarios: 340 of 340. Caveat: the three compilations come from the same model family on a clean, short, fictional text.
- **wires needed:** none.
- **role for ChatSOP:** a validation method for the coding-agent route (proposal section 12): require agreement of two independent compilations on generated scenarios before a rule set is accepted. Pairs with S02.
- **smoke:** none (harness protocol).

## R06. Contexts (microtheories): `in-context`, `context ... imports`, `in $context` (design only)

- **source:** `docs/SCALARE.md` section 4.4.
- **essence:** Each knowledge wire belongs to a context (document, jurisdiction, version, validity interval); contexts import others like Cyc microtheories; a query names its context so only visible rules count. Contradictions between sources become normal, and the context is the unit of partitioning.
- **kind:** other (representation, design only).
- **evidence:** none (documented as "to build").
- **wires needed:** a `context` wire and an `in` field on knowledge wires and queries. The proposal has `source` and `speaker` on facts but no context scoping.
- **role for ChatSOP:** a router and memory feature (relevant cut before retrieval); would formalise `10a-contradicting-sources` as two answers under two contexts instead of `both`.
- **smoke:** new `N20 context-two-manuals`.

## R07. Truth maintenance with assumptions (ATMS labels) for many hypotheses (design only)

- **source:** `docs/SCALARE.md` section 7.
- **essence:** Instead of 2^n worlds, each derived fact carries the minimal sets of hypotheses that entail it (de Kleer labels); a world is evaluated by filtering labels.
- **kind:** inference engine (design only).
- **evidence:** none.
- **wires needed:** `hypothesis` (exists).
- **role for ChatSOP:** not relevant now; the proposal's `abduce` with many candidates would be the user.
- **smoke:** none.

## R08. Delete and re-derive (DRed) or derivation counting (design only)

- **source:** `docs/SCALARE.md` section 7.
- **essence:** Incremental deletion: over-delete consequences then re-derive what still holds, or count derivations. Today a deletion recomputes the affected cone (870 ms at 100,000 entities).
- **kind:** inference engine (design only).
- **evidence:** none; the cost it would remove is measured (R02).
- **wires needed:** none.
- **role for ChatSOP:** a future improvement behind `update(handle, delta)` for retraction.
- **smoke:** `N06`.

## R09. `term` wire, vocabulary index and entity resolution (design only)

- **source:** `docs/SCALARE.md` section 8, `docs/IMPLEMENTARE.md` section 6.
- **essence:** Declare each relation with description, domain, codomain, unit, cardinality, inverse and transitivity; refuse undeclared relations; give coding agents the 50 nearest existing terms by embedding; canonical identifiers with verified `same-as` and a dedup pass after each batch; use differential testing as a monitor. SCALARE names vocabulary drift ("temp", "temp-c", "temperature-c") as the main risk at scale: a join that fails to match returns zero rows, not an error.
- **kind:** other (knowledge hygiene).
- **evidence:** none (the pilot's linter catches an undeclared relation at small scale).
- **wires needed:** the proposal `predicate` has `args`, `closed`, `key`, `unit`; lacks `description`, `inverse`, `transitive`, and no `same-as` convention.
- **role for ChatSOP:** partly done by the reviewed lexicon and dictionary (AGENTS.md "Model boundary"); the extra `predicate` fields are cheap and also serve V03/S11 template hints.
- **smoke:** none.

## R10. Hierarchy labelling (pre/post-order and 2-hop) and worst-case optimal joins (design only)

- **source:** `docs/SCALARE.md` sections 5 and 6.
- **essence:** Answer `is-a` and `subclass-of` closure over a tree in O(1) with pre/post-order intervals (2-hop labels for DAGs) instead of materialising n times depth facts; use leapfrog triejoin for cyclic joins such as triangles.
- **kind:** inference engine (design only).
- **evidence:** none. E10's triangles family (probes 2,244 greedy against 2,246 verified) shows nothing to gain at its size.
- **wires needed:** `predicate transitive`.
- **role for ChatSOP:** not relevant now.
- **smoke:** none.

## R11. Fan-out budget per rule and compact CSR store (design only)

- **source:** `docs/SCALARE.md` sections 3, 4 and 9.
- **essence:** A per-rule fan-out limit reports a rule that produces 1,000 times more than its input; relations stored as sorted CSR permutations in `Int32Array` (about 8 bytes per fact for both directions) with a delta layer, instead of JS maps; derivations are rebuilt on demand rather than stored (measured 867 to 467 MB).
- **kind:** other (budget and storage design).
- **evidence:** the memory halving is measured (`full` against `full-noprov`, 11,006 ms and 8,505 ms wall in `results.jsonl`); the rest is design.
- **wires needed:** a budget key `maxFanout` per rule (the proposal has `maxJoins`, `maxFacts`).
- **role for ChatSOP:** a budget key worth adding; storage is the memory side's concern.
- **smoke:** `15c-budget-probe-limit` could cover `maxFanout`.

---

# Summary table

| Id | Entry | Kind | Role for ChatSOP | Evidence |
| --- | --- | --- | --- | --- |
| Z01 | E00 semiring worlds | representation learning | not relevant (gap: semiring closure) | weak |
| Z02 | E01 hidden algebra | representation learning | not relevant | moderate |
| Z03 | E02 exact quotient (L*) for counting | representation compression | component (low priority) | moderate |
| Z04 | E03 neural CEGIS | neural proposer with verification | negative evidence; not a strategy | moderate |
| Z05 | E04 verified skills | offline consolidation | component of dreaming | weak |
| Z06 | E05 #SAT composition | search (algorithm selection) | router design pattern | weak |
| Z07 | E06 dominance invention | offline consolidation | component of dreaming | weak |
| Z08 | E07 feature invention | offline consolidation | not now | weak |
| Z09 | E08 comparators and SQLite | other / inference engine | separate strategy `sql-sqlite`; control | moderate |
| Z10 | E08 adaptive policy selection | router feature | router feature | moderate |
| Z11 | E08 learned join plans, neural ranker | neural proposer with verification | not relevant (tie) | weak |
| Z12 | E09 Horn lemma dreaming | offline consolidation | component (low value) | weak |
| Z13 | E10 quotient and factoring | inference optimisation | component of Datalog | moderate |
| Z14 | E10 guarded Pareto compile | inference optimisation | component, negative controls | moderate |
| Z15 | E10 demand and inlining | inference optimisation | covered in proposal | moderate |
| Z16 | E10 SkillComposer | offline consolidation | dreaming wrapper rule | weak |
| Z17 | E10 InvariantInventor | offline consolidation | router/lint feature (`key` hints) | none |
| Z18 | E10 Dreamer lifecycle and store | offline consolidation | `dreaming-session` records | moderate |
| S01 | soplab rule scoring | other (induction) | component, later | weak |
| S02 | micro-world generator | other (validation) | validation method | weak |
| S03 | path-rule generator | search | not relevant | none |
| S04 | best-first search | search or planning | base of planner | none |
| S05 | planner with derived preconditions | search or planning | planner variant | weak |
| S06 | min-cost abduction | search | strategy variant (`abduce`) | weak |
| S07 | workflow glue | other | reference only | none |
| S08 | binding providers (`CALL`) | other (interface) | interface feature | weak |
| S09 | variant comparison harness | other (validation) | harness; A/B/C protocol | moderate |
| S10 | slicing plus delta | inference engine | covered (note: slicing no gain) | moderate |
| S11 | graph wire against rules | inference engine | router feature | moderate |
| S12 | abstraction learning | offline consolidation (design) | design note | none |
| S13 | teacher-LLM ingestion | other (process) | not relevant | none |
| V01 | VRCStrategy facade | orchestration | interface reference | strong |
| V02 | isolated worker | other (containment) | router/harness feature | weak |
| V03 | reach template | inference optimisation | component, router rule | strong (correctness), moderate (speed) |
| V04 | numeric fragments, forecast leaf | representation compression | niche component | moderate |
| V05 | exact rational DAG | other (exact evaluation) | component for `compute` | weak |
| V06 | streaming claim loader | other (ingestion) | memory-side hint | weak |
| V07 | registry, traces, `dream()` | offline consolidation | component (`dream` call) | moderate |
| V08 | SWI exporter, nine `.pl` | other (comparison) | bench set for Datalog strategies | strong (row counts) |
| V09 | compressed-state planning | search or planning | separate strategy (numeric) | moderate |
| V10 | closure-search representation discovery | representation compression | dreaming component (numeric) | moderate |
| V11 | data-only mode | representation learning | not relevant | weak |
| V12 | power-sum proposer | representation learning | not relevant | weak |
| V13 | ring certificate | other | not relevant | weak |
| V14 | column-class counting compression | representation compression | not relevant | weak |
| V15 | protocol templates | other (evaluation method) | preregistration skeleton | none |
| R01 | rule lifting | other (knowledge compilation) | component | weak |
| R02 | hypothetical worlds, incremental | inference engine | separate strategy `worlds-sopr` | moderate |
| R03 | cone, trigger index, join order | inference engine | covered; router rule for point queries | moderate |
| R04 | `method`/`plan` with BLOCKED | search or planning | planner; keep the reason | moderate |
| R05 | differential compilations test | other (validation) | validation method | moderate |
| R06 | contexts (microtheories) | other (design) | router and memory feature | none |
| R07 | ATMS labels | inference engine (design) | not now | none |
| R08 | DRed | inference engine (design) | later for `update` | none |
| R09 | `term` wire, vocabulary, same-as | other (design) | partly done by lexicon | none |
| R10 | hierarchy labelling, WCOJ | inference engine (design) | not now | none |
| R11 | fan-out budget, CSR store | other (design) | add budget key `maxFanout` | none |

**Entries by primary kind (57 entries: 18 Z, 13 S, 15 V, 11 R):** inference engine or optimisation 11 (Z13, Z14, Z15, S10, S11, V03, R02, R03, R07, R08, R10); search or planning 7 (Z06, S03, S04, S05, S06, V09, R04); representation learning or compression 8 (Z01, Z02, Z03, V04, V10, V11, V12, V14); offline consolidation ("dreaming") 9 (Z05, Z07, Z08, Z12, Z16, Z17, Z18, V07, S12); neural proposer with verification 2 (Z04, Z11); other (interfaces, router features, validation methods, containment, design and process notes) 20 (Z09, Z10, S01, S02, S07, S08, S09, S13, V01, V02, V05, V06, V08, V13, V15, R01, R05, R06, R09, R11). Evidence: strong 3 (V01, V03, V08), moderate 20, weak 21, none 13 (by the table above).

---

# What the proposal needs to add

## A. Corrections and caveats for the existing text

1. Section 2.2 and 7: quote the cost of a hypothetical world with its limit: add 30.9 ms but `set` 870.5 ms at 100,000 entities (deletions are recomputed, R02), and the point-query penalty of the dependency cone (1,079 ms against 10 ms naive, R03).
2. Section 2.3: "14 of 18 skills promoted" counts 6 advisory invariants and 4 deployment plans; the deployed distinct skills are 4 known transformations and all 4 lemma bundles were rejected (Z12, Z17). Also give wall-clock next to probes: `visible` 204 to 101 ms, `eligible` 198 to 103 ms, `pareto` 878 to 101.5 ms, `reach` 608 (INCOMPLETE) to 114 ms (Z13).
3. Section 2.4: the SWI gap is partly closed: the nine VRC `.pl` exports give the same row counts under ChatSOP's SWI 9.0.4 (V08). The speed-ups of 17x to 1,382x belong to the reach template (V03) and hold on 5 of 13 cases; the other cases show 1.0x to 1.26x.
4. Section 7 table: soplab slicing did not help in the only benchmark (S10); the `learned` mode of E10 has the same probes as `indexed_semi` on 10 of 13 families and `verified` loses to greedy on dense, nonlinear and mutual recursion (Z09).

## B. Strategies list (section 7)

1. `sql-sqlite`: Datalog P0 to P2 lowered to recursive CTEs with built-in `node:sqlite`; wins on 9 of 12 E10 families (Z09). Needs the compiler; the hand-written SQL is not evidence for it.
2. A `closure-native` component (transitive-closure template recognition with BFS and a witness path), used by the router when an argument is bound (V03, S11). It is not a separate strategy but a rule of the router.
3. `worlds-sopr` is evidenced for monotone additions only; the entry gate should be the 1,200-answer incremental test (R02) and a nonmonotone case.
4. `dreaming-session`: define it concretely as Z18 plus V07, with four records (journal episode, skill, deployment plan, advisory hint).
5. Low-priority additions with evidence: `induction-ranker` (S01), `model-counting` (Z03, Z06), `exact-rational-eval` (V05).

## C. Interface and result packet (section 5)

1. A `dream` report and the host-side records: journal episode (task hash, status, cost counters), skill record (kind, scope = schema-local, contract hash, certificate kind, semantic contract, evidence, objective, status candidate, promoted, rejected, quarantined, revoked, advisory), deployment plan (member skills plus settings), negative cache keyed by learner version and budget (V07, Z18).
2. Result packet fields: `guarantee exact|approximate`, `bound`, `complete_within_bound`, `objective`, phase timings (load, index, lookup, discover, certify, prepare, search, replay, output), `witness: {replayed, verified}`, `contract_hash`, `task_hash`, input digests (V01, V06). Statuses `approximate` and the prepare outcomes `stale`, `no_model` (not a negative answer).
3. `blocked_by` on `plan_found`/`no_plan` results (R04).
4. `fork(handle)` and a three-operation delta (`add`, `remove`, `set` with a declared `key`), plus a flag `incremental: true|false` per world (R02).
5. An `isolation` capability: a strategy may be run in a worker with wall and heap limits and its stop maps to `budget_exhausted` (V02).
6. `prepare` options: `learning off|reuse|on-demand`, `arithmetic exact|float64`, `shadow` (V01).
7. Acceptance rule for learned artifacts: re-certify on load, replay positive witnesses in the original rules, shadow on small tasks, revoke on disagreement (V01, V07).
8. Budget key `maxFanout` (R11).
9. A variant harness with the A/B/C arm structure (rules, specialised wire or template, provider), and VRC's protocol template (frozen thresholds, negative controls, phases in the total) as the preregistration skeleton (S09, V15).

## D. Wires and leaves

1. `call provider args` leaf with declared mode, determinism and a budget share (S08). Lets Z3 or SWI answer a sub-question inside a rule.
2. Numeric `action` extension: `state`, `next` equations over rationals, `guard`, `observe`, `horizon`, plus a `rational` term type (V04, V05, V09). Without it VRC cannot be wired.
3. `examples` wire (labelled positive and negative tuples) for `induce` (S01, S02).
4. `constraint task count` (model counting) and a sequence or pattern domain (Z03, Z06).
5. `method`: `require` and `forbid` lines with reason strings (R04).
6. `hypothesis`: an `all_minimal` enumeration option on `abduce` (S06).
7. `context` wire and `in` field (R06), optional.
8. `predicate`: optional hints `transitive true`, `inverse p`, `description` (S11, V03, R09, R10); `key` suggestions produced from observed functional dependencies and kept advisory (Z17).
9. A semiring `closure` wire or an `aggregate` allowed over a closure (Z01, N16), optional.

## E. Smoke cases to add (proposed ids; numbering to be settled with the proposal)

| Id | Case | Exercises | Source entry |
| --- | --- | --- | --- |
| N01 | `dream-equivalence-lemma` | answers identical with and without a prepared lemma; rounds and probes reported separately | Z12, Z16 |
| N02 | `dream-gate-rejects-unsound` | Pareto anti-join; terminal bonus makes dominance unsound; the gate must reject it and accept the sound shortcut | Z07, Z14 |
| N03 | `existential-quotient-large` | an entity with about 100 detail rows; same rows, less work | Z13 |
| N04 | `reach-large-bound-source` | 10^5 edges in small components, bound start, tight budget | V03, Z15 |
| N05 | `reach-dense-cycle-no-regression` | dense cycle and mutual recursion; the router must not pick demand | Z09, Z10 |
| N06 | `whatif-many-worlds` | 50 hypotheses on one base, including `set` on a keyed predicate and a retraction | R02, R08 |
| N07 | `whatif-nonmonotone-cone` | an addition that flips a negation-as-failure or aggregate downstream | R02 |
| N08 | `rule-family-lift` | 500 rules differing only in constants; answers identical lifted and not; explain names the source rule | R01 |
| N09 | `numeric-symmetric-plan` | a 12-coordinate symmetric state, a threshold goal, a guard-rich control | V04, V09, V10 |
| N10 | `exact-rational-threshold` | 1/10^13 distinct from 0; value above 2^53 | V05 |
| N11 | `provider-external-relation` | `call range`, `call member`, a Z3 check as a leaf | S08 |
| N12 | `induce-path-rule` | hidden path rule among candidates with 20% label noise; a hash-like control must be refused | S01, S02 |
| N13 | `abduce-all-minimal` | all inclusion-minimal explanations, not only the cheapest | S06 |
| N14 | `wall-timeout-isolated` | a strategy that never returns; stop at the wall limit; status `budget_exhausted`, no claim | V02 |
| N15 | `count-models-local-pattern` | forbid `111`: length 12 expects 1,705, length 20 expects 223,317 | Z03, Z06 |
| N16 | `shortest-path-cyclic-cost` | cheapest route on a cyclic graph; Datalog must answer not expressible; planner or semiring closure answers | Z01 |
| N17 | `plan-blocked-reason` | plan with a derived or required precondition that fails; the reason is returned | R04, S05 |
| N18 | `closure-template-vs-rules` | same answers by recursive rules and by the native closure; the router picks native | S11, V03 |
| N19 | `point-query-large-kb` | 10^5 entities, one entity asked; lazy cone against demand | R03 |
| N20 | `context-two-manuals` | two manuals with different limits answered under their contexts | R06 |

Existing cases the zips already map onto: `03`, `04`, `05b`, `07a-c`, `08a-c` (engines Z09, S10, R03), `06d` (V05), `11a`, `11b`, `11c` (S04, S05, V09, R04), `14a` (S06), `14b` (R02), `15a-c` (V02, R11), `20` to `22` (R03).

Harness features to add beside the cases: a cross-engine bench set from the nine VRC `.pl` files with row-count agreement (V08), a differential test of two independent knowledge compilations on generated scenarios (R05), and an SQLite control for P0 to P2 (Z09).
