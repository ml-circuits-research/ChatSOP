# Formalization machine, phase 1: does a small method library cover the book problems by composition?

**Archived 2026-10-03.** The code and data this document describes moved to `probably_obsolete/formalization-experiments-2026-10/` (its README gives the final numbers and the path map) when the owner decided to rebuild the formalization infrastructure. Paths below read as they did at the time.

Status: phase 1 run and measured (2026-10-02/03, implementation agent `formalization-machine`). Preregistration `status/preregistrations/eval-formalization-machine-v1.json` (criteria written before any model call; deviations recorded there). Owner's idea: "Analysis 3" in `experiments/proposal/owner-notes-2026-10-02-formalization.md`; the owner's research proposal `experiments/proposal/formalization-calculus.md` is answered in section 6. Phase 2 stage 1 was run on the coordinator's go (section 8). Nothing on the product path changed. Nothing here is committed.

## 1. Verdict

**Inconclusive, leaning to "the idea works for the computable part and fails where formalization needs knowledge or judgement".** H1 is not invalidated on any preregistered criterion, and not supported on three of four:

| criterion (preregistered) | threshold | measured | result |
|---|---|---|---|
| held-out SOLVED | supported ≥ 60%, invalidated < 35% | **56.5%** (83/147, Wilson 95% 48.4..64.2) | in between |
| saturation: the last 10 methods add | < 5% of dev coverage | 9.2% (14/153) | not saturated by the criterion |
| median method use (SOLVED, dev-final + held, unused = 0) | ≥ 5 | **6** | supported |
| held-out WRONG | ≤ 10% | **16.3%** (24/147) | fails |
| linear growth (new methods per dev problem, dev3 vs dev1) | invalidated if ≥ 0.75× | 0.10 → 0.10 → 0.016 (ratio 0.16) | not invalidated |
| MISSING_METHOD share of held-out failures | invalidated if > 50% | **12.5%** (8/64) | not invalidated |

What limits it, in order:
0. **Rendering fix (2026-10-03).** `clock_after` results are now shown to the judge as clock times (a rendering annotation `fp_method_fixed clock_after unit minutes_of_day`; the filler's prompt is unchanged). The phase-1 held-out answers were replayed from the gateway's response cache and rescored (`held-r`): SOLVED 84 (57.1%), WRONG 23 (15.6%); only world:529 changed (WRONG to SOLVED). The verdict is unchanged; the table keeps the preregistered first scoring.
1. **WRONG, not missing methods.** The library is big enough far more often than the frame-filler is right: 24 held-out WRONG against 8 failures caused by a missing method. 10 of the 24 are deduction frames (facts and rules misread, closed-world readings that empty the answer), 4 constraint frames, 3 abduction tables, 7 arithmetic or choice trees (2 of them a rendering artefact: 600 minutes judged against "10:00").
2. **Missing knowledge, not missing methods.** MISSING_CONCEPT blocks 12 held-out problems (definitions of "prolonged", causal certainty, "sunk cost", mean vs median robustness), more than MISSING_METHOD (8). The machine needs a concept/definition source (a base memory), not more decomposition operators.
3. **The model still reasons inside frames.** A one-pass audit (tier medium) of the 50 SOLVED held-out trees that carry facts, rules, tables, conditions or constants: 18 faithful, 17 "background", 9 "answer_encoded", 6 unreadable. My spot check of the 26 flagged: about half of the "background" flags are false (registry references, the standard transitivity rule, 1-based positions), but the abduction tables (which observation supports or contradicts which hypothesis) and some 0/1 encodings of constraints do contain the decisive judgement. Strict SOLVED (SOLVED minus answer_encoded) is 74/147 = 50.3%. "The model only chooses methods and fills frames" holds for arithmetic and choice; for abduction and for modelling a constraint problem the frame *is* the reasoning.
4. **One measurement is noisy.** The same held-out problems with the worked solution shown (held-sol) give 79/147 SOLVED; 36 problems flip between the two runs (20 lost, 16 gained; paired difference −2.7 points, 95% −10.9..+5.4). Seeing the solution does not help the frame-filler: the library plus the filler's reading, not missing information, is the ceiling.

What the experiment establishes: a library of **40 domain-independent methods, 17 goal types and 7 primitives** (all within the owner's 30/50/10 bounds) reaches 66% of development problems and 56.5% of problems from sections never seen, across all seven books including the qualitative ones; the seed of 30 methods written before reading any problem already covers 87/153 dev problems; growth fell from 0.10 to 0.016 new methods per problem; the median method is reused by 6 solved problems. Composition depth is small (median 3 nodes per solved tree). The open question is not "are there enough methods" but "who fills the frames faithfully", which is phase 2 and the CNL question.

## 2. What was built (offline research harness)

- **Library as data**: `config/knowledge/formalizer-methods-v1/` (`seed.json` with `chat: false`, imports core-min; compiles as a lexicon). `0001-vocabulary.sop` declares the `fp_` predicates and one planner rule (`fp_method_applicable ?m ?g` from `fp_goal_has_type` and `fp_method_achieves`: the hook for InternalReasoningStepByStep, whose oracle already plans over `fp_` wires). `0010-primitives.sop` (7 primitives, each with the SOP construct it writes), `0020-goal-types.sop` (14 seed goal types, by formal operation, not domain), `0030-methods-seed.sop` (30 seed methods), `0040-methods-grown.sop` (10 adopted methods, 3 goal types, 3 merges, in order, with their stage). A method is HTN-style: `fp_method_achieves` (goal type), `fp_method_text` (match condition for the filler), `fp_method_slot` + `fp_slot_*` (requires), `fp_method_decompose` (slot normally filled by a sub-goal of a type), `fp_method_solver` (primitive); a calculate method carries its formula as data (`fp_method_formula`), a clue-based constraint method its clue templates (`fp_method_clue`). The model never writes a formula.
- **Primitives** (`tools/eval/method-library/primitives.mjs`), each writing one SOP circuit executed through an Agent turn on the product's engines: `calculate` (session rules with compute/compare, via `lib/formalize/expression-program.mjs` lowering), `rank` (stated options, feasibility rule, `rank` query), `deduce` (closed-world session predicates, rules with `not`/`absent`, forced/truth/who/count queries), `constraints` (constraint wire: unique / undetermined / contradiction; counting by exclusion), `schedule` (compute rules with maximum_with over the precedence order), `abduce` (supports/contradicts, closed-world rule, aggregate count, rank; and discriminating observations), `justify` (the derivation or the decomposition structure of a node, from the executed nodes).
- **Machine** (`machine.mjs`): checks the tree against the library, resolves slots (`vK` registry numbers from `lib/formalize/registry.mjs`, `nK` node outputs, `{"const", "why"}` counted), executes nodes in dependency order, and gives every goal a known state. **Score** (`score.mjs`): deterministic gold comparison where shapes allow (32% of problems), else a judge on tier medium that sees question, reference and executed answers only; the outcome taxonomy (exactly one per problem). **Run** (`run.mjs`): split, run, proposals, adopt, audit, report. Test: `tests/method-library.test.mjs` (no model; 4 tests).
- Book text stays in `state/method-library/` and `datasets_sources/` (gitignored); the repository holds ids in the preregistration, generic methods and counts.

## 3. Corpus and procedure

300 problems of `datasets_sources/books/eval/items.jsonl`, 43 per book (42 for world), split by section family (the coarser of first tag and section per book: the decompose book's ten problem shapes, the logic book's 100 sections, ...), families alternating between dev and held-out by a seeded hash: **dev 153, held-out 147**; excluded: regression cases, seen items, the 16 problems I read while designing. Growth: dev1 (30), dev2 (60), dev3 (63) on tier good with problem, registry and worked solution; proposals executed as candidates, then reviewed by me: generalized, merged, rejected when they carried knowledge (a menu encoding "rigid motions preserve shape", "larger samples do not remove selection bias") or an answer (a justify method with a fixed verdict text). Then frozen; dev-final (153, solution shown, proposals off), held (147, no solution, primary), held-sol (147, solution shown, proposals off).

Review decisions per stage: dev1 adopted `discriminating_observation`, `count_integer_solutions`, `decomposition_structure` (+3 goal types), merged a duplicate integer method, rejected a hypothesis-verdict method (a tie is already a set). dev2 adopted `sequence_values`, `necessary_premise`, `negation`, `same_truth`, `conditional_truth`, `clock_after`, merged a duplicate optimum method, rejected a geometry-fact menu and a list-collector; deferred a minimum-cost path (needs a graph-search interpreter: recorded as an unsupported primitive). dev3 adopted `grid_distance`, merged a duplicate choice-by-explanation, rejected four (knowledge in a menu, an unexecutable analogy pair, a causal-depth variant of deduction). Interpreter modes added during review (code, not methods): abduce discriminate, constraints count, justify structure, calculate series.

## 4. Results

**Outcomes (terminal-status shares, the form `formalization-calculus.md` asks for).**

| outcome | dev-final (153) | held-out (147) | held-out with solution (147) |
|---|---|---|---|
| SOLVED | 101 (66.0%) | **83 (56.5%)** | 79 (53.7%) |
| PARTIALLY_FORMALIZED | 18 (11.8%), median k = 71% | 26 (17.7%), median k = 56% | 27 (18.4%) |
| WRONG | 25 (16.3%) | **24 (16.3%)** | 28 (19.0%) |
| MISSING_CONCEPT | 6 (3.9%) | 8 (5.4%) | 6 (4.1%) |
| MISSING_METHOD | 3 (2.0%) | 5 (3.4%) | 5 (3.4%) |
| MISSING_INFORMATION | 0 | 0 | 1 |
| AMBIGUOUS | 0 | 0 | 1 |
| CONTRADICTORY | 0 | 1 (0.7%) | 0 |
| UNSUPPORTED_PRIMITIVE | 0 | 0 | 0 |

k = executed goals / goals of a partially formalized problem. Partial blocks (held-out): incomplete answer 11, fill error 7, missing concept 4, missing method 3, engine error 1. Failure causes (held-out, 64 non-SOLVED): WRONG 24, MISSING_CONCEPT 12, incomplete answer 11, MISSING_METHOD 8, fill error 7, contradictory 1, engine error 1.

**Precision of "formalized" claims**: of the problems where every goal executed, the answer matched the gold in 101/132 (76.5%, dev-final) and 83/115 (72.2%, held-out). A fully executed formalization is right about three times in four; the machine's "I could not formalize this" states (MISSING_*, partial) cost nothing in wrong answers.

**Held-out by book** (SOLVED/21): decompose 15, math 15, world 13, adult 12, science 12, logic 8, commonsense 8 (commonsense: 10 partial, mostly multi-part questions with a "why" part).

**Held-out by primitive used** (problems using it / of those SOLVED): calculate 85/60, deduce 41/24, justify 43/26, constraints 19/9, rank 17/10, abduce 13/5, schedule 6/4. Calculate and rank are reliable; deduce, constraints and abduce are where the filler's reading fails.

**Coverage curve on dev** (dev-final SOLVED problems whose executed methods are all among the first k; seed methods in order of first use in dev order, then adopted methods in adoption order):

| k | 1 | 3 | 5 | 7 | 10 | 13 | 16 | 19 | 22 | 25 | 30 (seed) | 33 (+dev1) | 39 (+dev2) | 40 (+dev3) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| covered | 9 | 10 | 13 | 21 | 24 | 41 | 51 | 70 | 74 | 85 | 87 | 94 | 101 | 101 |
| % of 153 | 6 | 7 | 8 | 14 | 16 | 27 | 33 | 46 | 48 | 56 | 57 | 61 | 66 | 66 |

The seed curve rises steeply to k ≈ 25 and is flat from 25 to 30 (5 seed methods never used: `sequence_term`, `whole_groups`, `remainder`, plus `sequence_values` and `grid_distance` from growth); the adopted methods add 14 problems (9.2%), which fails the < 5% saturation threshold. Read with care: the last ten methods are exactly the ten adopted ones, each written for a problem the seed missed, so the criterion measures the value of growth more than saturation; the per-problem growth rate (0.10, 0.10, 0.016) does decline.

**Reuse** (SOLVED problems of dev-final and held using each method): compare_values 76, add_up 57, multiply 46, difference 38, choose_best_option 37, justify_answer 36, divide 30, derive_who 27, all_conditions 22, derive_forced 20, units_needed 16, extreme 14, percent_change 13, best_supported_hypothesis 10, ... ; 5 methods unused; median 6.

**Constants**: 1.2 per dev problem, 1.4 per held-out problem; mostly yes/no encodings (1/0), 60 minutes per hour, stated word-numbers; a few are modelling choices ("tie score; feasibility decides"), counted in the audit.

**Cost** (OpenRouter `usage.cost`, frame-filler on good with reasoning effort medium plus judge on medium): dev1 0.33 USD (incl. a 3-problem smoke run), dev2 0.67, dev3 0.55, dev-final 0.99, held 1.11, held-sol 1.45 (5.10 USD, 1,122 live calls, 94 cache hits, 4.5 M input and 4.1 M output tokens, most of the output reasoning), plus the two audits (121 calls on medium, about 0.1 USD): **about 5.2 USD in total**, far under the 40 USD ceiling. Wall time: about 65 minutes of runs at 8 parallel requests.

## 5. Would a semantic CNL step help?

Judged from the failure taxonomy: **yes for about half of the WRONG answers, no for the knowledge gap.** The WRONG answers concentrate in frames written as atoms and tables (deduce 10, abduce 3, constraints 4 of 24): relation names that differ between a fact and a rule, a stated negative written as absence, a rule that the problem does not state (the audit's "background"), an evidence table filled with the filler's own judgement. An intermediate controlled-English restatement (one sentence per fact, rule and question, each anchored to a span of the problem, then mechanically atomized) attacks exactly these: it makes every rule traceable to a sentence (the audit becomes a span check instead of a judge), it fixes the vocabulary once, and it separates reading (CNL) from modelling (frames). It would not help MISSING_CONCEPT (12 held-out blocks: the definitions are absent from the problem) or the arithmetic misreadings (calculate trees are already references only), and it would add a step for every problem. Recommendation: test CNL only for deduce/abduce/constraints frames (about 45% of held-out problems use one), measured as WRONG on those frames and faithful-audit share, before considering it for arithmetic.

## 6. Mapping onto the formalization calculus (`formalization-calculus.md`)

**Operators the library actually uses** (by the methods and the tree structure of the 184 SOLVED dev-final + held problems):

| operator | where it appears | use |
|---|---|---|
| DECOMPOSE-GOAL | every tree with a node feeding another (median 3 nodes); several goals per question | constant |
| DECOMPOSE-PART-WHOLE | add_up, multiply (equal groups), average, all/any_condition, choose_best_option (option by option), decomposition_structure | very high |
| DECOMPOSE-TEMPORAL | earliest_completion, sequence_values, sequence_term, clock_after, chained percent_change, order_by_clues on time orders | moderate |
| DECOMPOSE-CAUSAL | best_supported_hypothesis (effect → candidate causes), discriminating_observation, causal rules in deduce frames | low, error-prone (abduce 5/13 held-out SOLVED) |
| GENERALIZE | not used (no method induces a rule from cases; science:130 "cautious inductive conclusion" ended MISSING_METHOD) | none |
| SPECIALIZE | derive_who / derive_count / derive_forced: a stated general rule instantiated on things | high |
| INTRODUCE-VARIABLE | the registry (v1..vn), node outputs (nK), integer variables, positions in order/match | constant |
| INTRODUCE-CONSTRAINT | compare_values, feasibility in choose_best_option, integer conditions, clue templates | very high (compare_values is the most used method) |
| ABDUCT | best_supported_hypothesis, discriminating_observation | low |
| CHECK-CONSISTENCY | constraints (unique / undetermined / contradiction), derive_truth, necessary_premise; the validator on every circuit | moderate |
| FIND-COUNTEREXAMPLE | only implicitly (necessary_premise removes a premise; counting enumerates); no method refutes a universal claim by a case (logic:232, math:39.20 failed) | missing as a method |

**Methods that are combinations of operators**: linear_cost = PART-WHOLE + INTRODUCE-VARIABLE; units_needed / whole_groups / remainder = PART-WHOLE with an integrality constraint; breakeven_point = INTRODUCE-VARIABLE + INTRODUCE-CONSTRAINT (equality) solved in closed form; choose_best_option = DECOMPOSE-GOAL per option + INTRODUCE-CONSTRAINT (feasibility) + optimization; order_by_clues / match_by_clues / integer_solutions = INTRODUCE-VARIABLE + INTRODUCE-CONSTRAINT + CHECK-CONSISTENCY (unique, several, none); necessary_premise = CHECK-CONSISTENCY twice under removal of a premise (a counterfactual); discriminating_observation = ABDUCT + a search for a case that separates hypotheses (a FIND-COUNTEREXAMPLE over hypotheses); decomposition_structure = DECOMPOSE-GOAL reported as the answer.

**Operators the data shows are missing from the list**:
1. EVALUATE/COMPUTE (apply a known operation: arithmetic, aggregation, rounding). Half of all method uses are calculate; the calculus has decomposition and introduction but no operator that *closes* a leaf.
2. OPTIMIZE/SELECT (choose the best of alternatives under criteria): choose_best_option (37 solved uses), integer_optimum. Not a decomposition and not a verification.
3. COUNT/ENUMERATE (how many things or arrangements): derive_count, count_integer_solutions.
4. ORDER/RANK (relational ordering from clues).
5. GROUND/DEFINE (import a definition or a concept from knowledge): the largest non-wrong gap (MISSING_CONCEPT, 12 held-out blocks). The calculus's gap detection marks the gap but has no operator to fill it from a base memory.
6. RESOLVE-REFERENCE (what "this", "he", "the 90%" refer to): adult problems ended MISSING_METHOD on scope of a percentage and pronoun referents.
7. MAP-STRUCTURE (analogy: align two systems role by role): logic:373, science:941.
8. JUSTIFY (report the derivation as the answer to "why"): 36 solved uses; the calculus counts verification but not explanation as output.
9. GENERALIZE needs an executable primitive (induction from a table) before it can be counted as used.

## 7. Relation to the work of the other agents (coordinated through files; their code was not edited)

- **Stage-A typed tree** (`semantic-decomposition-protocol.md`, `0070-decomposition.sop`): its types (chain, check, batch, choose, breakeven) are a subset of this library's goal types and methods (find_value, check_condition, units_needed, choose_best_option, breakeven_point), its slot scripts are method slots, its assemblers are primitives. This experiment is the planner-level generalization of stage A over all books, with methods as data instead of per-type question scripts. Stage A's finding that `good` does not beat `tiny` on the same tree (15 vs 17 of 50) is consistent with what is seen here: the limit is the tree's reading of the problem (WRONG and fill errors), not the model tier. The method library could replace stage A's fixed type menu: the goal type and the method are the type, and `fp_method_applicable` gives the menu per goal.
- **N-way formalization** (variant B, `dual-check.mjs`): a method tree is an independent candidate formalization by construction (different decomposition, different engines), so its executed values can join the agreement clusters. The run-to-run discordance measured here (36/147 problems flip between two runs of the same filler) is the case for agreement-based selection: two method trees that agree, or a method tree that agrees with the expression path, should carry B's 92-97% agreement precision, against 72% precision for a single fully executed tree.
- **InternalReasoningStepByStep**: the layer's `fp_method_applicable` rule is the hook; a goal of a type asserted by the type question yields the applicable methods as plannable actions (`ask_method`, `ask_slot`), with the primitives as the assemblers.

## 8. Phase 2: `tiny` as the frame-filler (stage 1 run, 2026-10-03)

**Design.** The frozen library; the local `tiny` (Qwen3-4B, no thinking, 3000 output tokens, no fallback); 30 held-out problems (the split's order, round robin over books); two arms against `good`'s phase-1 trees of the same problems (`held-r`): **T**, tiny writes the whole tree with the phase-1 prompt; **S**, tiny gets good's skeleton (goals, goal types, methods, node wiring; every other slot value `"?"`) and fills the slots. Method-choice accuracy: on good's SOLVED problems, tiny's executed method set equals good's (and the mean Jaccard). Frame-filling accuracy: S, good's executed nodes whose value tiny reproduces at the same node; T, good's node values found among tiny's node values. Harness: `tools/eval/method-library/phase2.mjs` (results `state/method-library/p2s1/`).

**Result on the 30 problems.**

| | good (phase 1) | tiny T (whole tree) | tiny S (good's skeleton) |
|---|---|---|---|
| SOLVED | **18** | **4** | **6** |
| WRONG | 3 | 7 | 9 |
| PARTIALLY_FORMALIZED | 7 | 9 | 8 |
| MISSING_METHOD | 1 | 10 | 5 |
| CONTRADICTORY | 1 | 0 | 0 |
| unreadable answers | 0 | 0 | 0 |

- Method choice (T, on good's 18 SOLVED): the same executed method set in 5/18, mean Jaccard 0.39; the same goal types in 11/18. Typical failures: the primitive name used as a method (`calculate`), invented method names, a status declared after its own fill error.
- Frame filling: S reproduces 35 of good's 128 node values at the same node (27%); T's trees contain 16 of them (13%).
- Paired: T vs good, both solved 3, good only 15, T only 1; S vs good, both 6, good only 12, S only 0.
- Stopping: readable answers are 100%, so the preregistered switch condition (> 20% unreadable) did not fire, but the gap is decisive (12 to 15 of 18 lost on 30 problems; the skeleton recovers only 2 of them): stage 2 is not run (early stopping, AGENTS.md).

**Reading.** With the library fixed, `tiny` neither chooses the methods nor fills the frames: even given the exact decomposition, it reproduces about a quarter of the node values and solves a third of what `good` solves. The library is usable by a 4B only through a step-by-step protocol (one closed question per node: the method from the applicable list, then each slot from the registry), which is what InternalReasoningStepByStep already does for its own questions; frame filling of deduce/constraint/abduce frames (atoms, rules, tables) is the hardest part and the CNL question of section 5 applies there first. Cost: local only, plus the judge on medium (cents).

**The method tree as an N-way candidate.** `tools/eval/method-library/candidate.mjs` exports `methodTreeCandidate(problem, {tier})` → `{name, kind: 'tree', sop, answers, status, goals, tree, composed}`, the shape `candidateProfile` and `selectByAgreement` of `lib/formalize/dual-check.mjs` already accept (that file was not edited). For an arithmetic tree, `sop` is one composed expression program over the problem's registry (`machine.mjs` `composeCalculation`), so its numbers can be perturbed; on the 147 phase-1 held-out trees 30 compose, and all 30 give the node-by-node answers on the engines and answer under a perturbation. A single-goal tree whose node reads only the problem gives that node's circuit; other trees give answers without a profile.

## 9. Threats to validity

- The judge decides 68-73% of verdicts (one pass, tier medium); 2 of 24 held-out WRONG are rendering artefacts (minutes since midnight against a clock time), so WRONG is slightly overstated, and partial vs match on multi-part questions is a judgement.
- The seed library was written from the semantic-decomposition inventory, which was built from tag and section names of all books (including held-out families). The names are generic; held-out problems were never read.
- The audit of faithfulness is one cheap pass with false positives (about half of "background" flags on spot check); strict SOLVED (50.3%) and faithful SOLVED are bounds, not measurements.
- 153/147 instead of 150/150 (equal per-book quotas by section family); dev-final reuses dev problems (its curve is a development measure).

## 10. Reproduce

```
node tools/eval/method-library/run.mjs split
node tools/eval/method-library/run.mjs run --set dev --from 0 --to 30 --run-id dev1 --solution        # dev2 30..90, dev3 90..153
node tools/eval/method-library/run.mjs proposals --run-id dev1
node tools/eval/method-library/run.mjs adopt --file state/method-library/adopt-dev1.json --stage dev1
node tools/eval/method-library/run.mjs run --set dev --run-id dev-final --solution --no-propose
node tools/eval/method-library/run.mjs run --set held --run-id held
node tools/eval/method-library/run.mjs run --set held --run-id held-sol --solution --no-propose
node tools/eval/method-library/run.mjs audit --run-id held
node tools/eval/method-library/run.mjs report --dev dev-final --held held --held-sol held-sol
```
All model calls go through TinyAgent with purpose `job:method-library` and the response cache on, so a rerun of the same library replays from the cache.
