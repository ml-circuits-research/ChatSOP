# Six formalization paths: results (experiment stopped 2026-10-03)

Status: evaluation harness, never the product path. The owner stopped the experiment on 2026-10-03 after four sequential rounds; the code is kept because the next architecture reuses its compiler and verifier parts. Preregistration `status/preregistrations/eval-six-paths-v1.json` (with every deviation recorded); harness `tools/eval/six-paths/`; questions as data in the research layer `config/knowledge/formalizer-six-paths-v1` (`chat: false`); symbolic answer equivalence `lib/formalize/equivalence.mjs`. Judge: the book answers (`datasets_sources/books/eval/items.jsonl`, local; no book text is in this document or in git); no other model judges. Every number comes from the regenerable, gitignored `state/six-paths/` folders named with it.

## 1. Verdict in one paragraph

On `tiny` (the product tier), one path is strong: **B, compute** (a program of `name = expression` lines lowered to SOP), correct alone on 82 of 199 scorable batch problems (41%) with 52 unique correct answers. The other symbolic paths are weak on `tiny` (C 18%, A 9%, D 7%, E 3%, F 1%), so a second, independent confirmation is rare: "2 of N agree on the executed result and on 3 perturbations" verified only 14 of 199 batch problems on `tiny`, while at least one path was right on about 57%. The **verification itself works** (precision 88% in batch1, 6/6 accepted on `small` in round 2, 89% on dev1/small), and every precision loss was traced to a nameable cause (a yes/no no perturbation moves, a copied number, gold defects). Sequential rounds with stop-at-5-failures gave a tiny-only run length of 5, 8, 5, 5: the generic fixes between rounds did **not** lengthen the runs, which is the signal the owner asked for to stop. The bottleneck is not the compiler or the verifier but `tiny`'s answers to the formalization questions.

## 2. The six paths (and Z)

| path | strategy | questions (a routed tree) | heuristics into SOP |
|---|---|---|---|
| A method | top-down templates | asked parts → goal type (closed menu, filtered by structure) → method by NAME (library `formalizer-methods-v1`) → slots by registry index or `sub` → sub-goals (depth ≤ 4); logic goals: facts, rules and question in atom notation | the method template run node by node by the method-library machine (calculate, rank, deduce) |
| B compute | bottom-up program | asked parts → `name = expression` lines over v1..vn with 2 F1 exemplars → one re-ask only on a static-analysis violation | the AST lowered to session rules (`lib/formalize/expression-program.mjs`, wrapped, never edited) |
| C equations | declarative (Pólya) | unknowns (with whole-count marks) → data roles → conditions → what is asked (value, largest, smallest, check, possible) → one question for corrected conditions | deterministic algebra: propagation by inversion, elimination of linear systems (a linear equation in one unknown solved as -f(0)/(f(1)-f(0)) written over the data), bounds for largest/smallest and inequality-only unknowns, whole counts rounded where solved; small residual integer systems by the `constraint` wire |
| D backward | goal regression | goals with kind → per quantity the combination (closed menu, filtered by kind) → its inputs in the combination's shape → recursion | the dependency tree as a rule graph |
| E controlled English | normalization into a fixed language | each sentence rewritten on its own into fixed patterns (or none) → question sentences | a deterministic parser (arithmetic to session rules, unary and binary logic to the deduce primitive) |
| F analogy | retrieval | choose one of 3 verified computations of other problems (strict leave-one-out) → map inputs by index → confirm | the computation with substituted values |
| Z direct (added) | the model solves | one question, ending with `FINAL ANSWER: ...` | none: a vote, never a proof |

Shared parts: the registry v1..vn (`lib/formalize/registry.mjs`); robust readers (`v3`, `3`, `the third value`, a copied number read as its registry index); one re-ask that names the problem (`ReadError`), then an honest stop; refused everywhere: an answer that computes nothing from the problem's numbers, and one that only copies one of them.

## 3. Run-length curve (tiny only, corrected) and the earlier curve

FAILURE = no accepted correct answer from `tiny` (Z included); a round stops at its 5th failure. The earlier rule also counted `small` on the residue; the owner corrected it (product goal: `tiny`).

| round | run length, tiny only | solved / attempted, tiny only | cumulative, tiny only | run length, small counted (earlier rule) | solved, small counted |
|---|---|---|---|---|---|
| 1 | 5 | 0/9 | 0/9 (0%) | 6 | 2/9 |
| 2 | 8 | 4/13 | 4/22 (18%) | 11 | 6/13 |
| 3 | 5 | 0/8 | 4/30 (13%) | 6 | 1/8 |
| 4 | 5 | 1/9 | 5/39 (13%) | 6 | 3/9 |

```
run length, tiny only
 1 | #####     5
 2 | ########  8
 3 | #####     5
 4 | #####     5
```

No growth after round 2: the fixes made between rounds (section 8) did not move the tiny-only run length. Round 4's math:2.6 (all five paths said 7, in two clusters that generalize differently) is accepted by the tie rule added after the round; the table counts the rounds as run.

## 4. Per-path numbers

**Batches on `tiny`** (batch1 + batch2, 199 scorable problems; correct includes format-only matches):

| path | correct alone | wrong | no result | unique correct | mean questions |
|---|---|---|---|---|---|
| A method | 18 (9%) | 82 | 99 | 9 | 5.3 |
| B compute | 82 (41%) | 40 | 77 | 52 | 2.0 |
| C equations | 35 (18%) | 54 | 110 | 12 | 4.0 |
| D backward | 13 (7%) | 75 | 111 | 4 | 3.5 |
| E controlled English | 5 (3%) | 3 | 191 | 2 | 4.0 |
| F analogy | 2 (1%) | 4 | 193 | 0 | 1.8 |

At least one path correct: 56/100 (batch1), 57/99 (batch2). Verified on `tiny`: batch1 8 (7 correct, 88%), batch2 6 (3 correct) before the yes/no rule; seconds per problem are model-bound (100 problems in 8.5 min at 32 in flight; the harness itself spends 0.3 CPU s per problem for all six paths, measured from the cache).

**Rounds on `tiny`** (39 scorable problems): B 14, C 14, A 7, D 6, E 0 correct; mean questions A 6.4 (max 22 over three asked parts), B 2.2, C 4.1, D 4.9, E 6.7.

**`small`** (dev1, 15 scorable): B 9, C 7, D 5, E 5, A 1, F 0; verified 9/15 at precision 8/9. On the tiny residue (diagnostic): B 16/30, C 10/30, A 7/30 in the rounds; B 33/59, C 24/59, A 8/59 in batch2. The questions where `small` succeeds and `tiny` fails were mostly reading questions: A_slots (tiny writes computed numbers instead of indices), A_logic (multi-term atoms), C_unknowns/C_conditions (tiny answers "none" or prose), D_node (arity), the whole-problem rewrite of E.

## 5. Z, the direct answer

- First prompt (short answer only): 3/13 correct in round 2; `tiny` wrote derivations instead of a final answer.
- `FINAL ANSWER:` line, one re-ask on a derivation: 18/39 on the round problems (46%); with thinking on: 19/39 (no gain, so thinking stays off). The earlier 69% of the bare 4B was on another sample and prompt; it was not reproduced here.
- Acceptance on `tiny` in rounds 2 to 4: (a) Z plus one symbolic path 3/5 correct; (b) two symbolic paths 2/2; both 0/0; all 5/7. Z and a symbolic path are the same model and their errors correlate: (a) was 0/2 in round 3. On `small` residue acceptance (round 2) (a) 2/2, (b) 3/3.

## 6. Symbolic answer equivalence (`lib/formalize/equivalence.mjs`)

A catalog of small checks, each returning `equivalent`, `different` or `unknown`, tried in order; the deciding check is recorded. Tested in `tests/answer-equivalence.test.mjs`.

| check | decides |
|---|---|
| yes_no | yes/no and true/false; "Yes, 28" against "yes"; "yes, 28" against "yes, 30" is different |
| time | times of day in any clock format (08:40 = 8:40 am = 520 minutes since midnight) |
| units | quantities through the memory's unit facts (`unit_amount`, `unit_dimension`): 120 minutes = 2 hours, 150 minutes ≠ 2 hours, different dimensions are different |
| number | the precision the answer states (58.89 against 58.8888; whole numbers are exact), a percentage against its fraction |
| labels | option and plan labels as exact identifiers (Plan A ≠ Plan B, window 2 ≠ window 3) |
| lists | sets, or sequences when the order matters, item by item |
| entities | both answers link through the memory's lexicon to the same entity id (aliases are memory data) |
| entailment | "X is [not] P" claims: A ⊨ B and B ⊨ A under the problem's rules, by the deduce engine |
| tier | the `equivalence` model tier, last resort, only for free text without numbers or labels, only after a calibration without false positives |

Calibration (38 labelled invented pairs, `tools/eval/six-paths/equivalence-calibration.jsonl`): the symbolic checks decide 17, all correct. Both tier prompts produced a false positive on the pairs left (e.g. "the habit / the rule" → same), so **the tier is not used**; `unknown` means not equivalent. In the rounds the catalog decided number 54, yes_no 38, unknown 92 comparisons (Z against symbolic values).

## 7. Error correlation (tiny, batches, 199 problems)

Wrong together (both wrong on the same problem; diagonal: wrong alone), and in brackets the count expected if the two were independent:

| | A | B | C | D |
|---|---|---|---|---|
| A | 82 | 17 (16.5) | 26 (22.3) | 32 (30.9) |
| B | | 40 | 17 (10.9) | 18 (15.1) |
| C | | | 54 | 18 (20.4) |
| D | | | | 75 |

Agreeing on the SAME wrong executed result (what verification must avoid): A+D 8, A+C 3, B+C 1, A+B 1, B+D 0, C+D 1, A+E 1. Being wrong together is about as frequent as chance, but agreeing wrongly is concentrated in A+D: both are decomposition by a closed operation menu and make the same "obvious" step (math:7.5: both took the difference 34−22 for "how many to move to equalize"). B+C agree wrongly once in 199.

## 8. What worked

- **The registry** (`lib/formalize/registry.mjs`): every path names numbers by index; a copied number maps back to its index; perturbing the registry moves every path's circuit consistently. This made cross-path comparison by executed result possible at all.
- **The compute path B** on `tiny`: 41% correct alone, 2 questions on average, 52 unique answers; its static analysis and lowering never produced a lowering mismatch.
- **The perturbation check**: agreement on the original numbers plus 3 perturbations separated coincidences from shared formalizations; the residual precision losses had specific causes, each turned into a generic rule: a yes/no that no perturbation moves needs three votes; an answer copied from the problem is refused; two clusters that tie but agree on the problem's own numbers are accepted; votes count per strategy, never per tier.
- **Symbolic equivalence** (section 6): decides numbers, units, times, labels and lists without a model, with no false positive on the calibration set; the model tier was correctly kept out.
- **Format-aware scoring**: tolerance, the gold's rounding, percent/fraction, units, clock, multi-part golds; structural gold defects (a numeric gold incidental to a text answer: 519 of the books' numeric or list items) and 7 reviewed defects were excluded instead of being counted as errors.
- **C's algebra**: elimination by substitution and the f(0)/f(1) linear solve turned conditions into executable rules (the chickens-and-rabbits system and its perturbations, `tests/six-paths.test.mjs`).

## 9. What did not work

- **Verification coverage on `tiny`**: with only one strong path, 2-of-N rarely triggers (14/199 in batches, 5/39 in rounds), although some path was right on ~57%.
- **E (controlled English)** on `tiny`: 1% with a whole-problem rewrite, 4% sentence by sentence; `tiny` keeps writing free sentences.
- **F (analogy)**: parked (2 correct, 0 unique): too few verified analogues; it returns only with an index of several hundred entries (the pool now admits gold-verified programs: 129 entries).
- **A and D** on `tiny`: reading failures (computed numbers instead of indices, multi-term atoms, wrong arity) and correlated decomposition errors (A+D agree wrongly 8 times).
- **Z**: 46% on the round problems, below the earlier 69%; as a voter it correlates with the symbolic paths of the same model.
- **Rounds**: the run length did not grow (5, 8, 5, 5) despite the fixes listed below.
- **Budget**: the `small` residue pass is capped by the 15 requests/minute plan (about 13 calls per residue problem with three paths); batch2's residue pass was stopped at 59/93.

## 10. Changes made, by iteration (generic only)

- dev1: harness defect fixed (String.prototype.sub made every slot a sub-goal); C whole-count marks; D goal kind; E fractions, relations, properties; readRef (copied numbers → indices); constant answers refused; format-normalizing scorer and structural gold defects.
- batch1 → batch2: D asks the combination first, then inputs in its shape; E sentence by sentence; C takes the bound of an inequality-only unknown; A validates atoms and names bad slot values in the re-ask; A chooses methods by name (a numbered menu drew position-1 answers).
- batch2 → rounds: a constant yes/no needs three votes; C solves linear systems by elimination; F pool of gold-verified programs.
- rounds: Z and acceptance (a)/(b); answers copying a registry number refused; every prompt states that a percentage already means its fraction; cross-tier votes counted per strategy; tie rule; Z with a `FINAL ANSWER:` line; symbolic equivalence catalog; A depth 4 and identity constants 0/1.
- Regression of every solved round problem after each change: 0 losses (`tools/eval/six-paths/rounds.mjs regress`). The product's offline regression (`tools/eval/formalization-regression/offline.mjs run`): 104 correct of 360, the recorded floor; this experiment did not touch the product path.

## 11. Pruning decisions (preregistered rule, applied with the coordinator)

F parked after batch1/batch2 (no correct answer on `tiny`, no unique answer). E and D redesigned once each (batch2) and kept on probation in the rounds; neither reached 15% on `tiny` (rounds: E 0/39, D 6/39). Kept: B (core), C and A (second and third voters).

## 12. What the next architecture can reuse

The registry; the expression analysis and lowering; C's algebra (`tools/eval/six-paths/path-c.mjs` `solve`); the perturbation agreement with the per-strategy vote, the constant yes/no rule and the tie rule (`run.mjs` `decide`, `need`, `sameAnswers`); the acceptance with a direct answer (`accept.mjs`); the symbolic equivalence catalog (`lib/formalize/equivalence.mjs`); the format-aware scorer and gold-defect detection (`score.mjs`); the robust readers and the named re-ask (`common.mjs`).
