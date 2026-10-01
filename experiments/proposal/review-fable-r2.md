# Review round 2 of `reasoning-wires-proposal.md` (reviewer: Fable, 2026-10-01)

Transcription of the reviewer's report, substance verbatim.

**VERDICT: ready after minor fixes.** The architecture, the core semantics (paraconsistent `both`, two negations, recursive closedness, snapshot time, bounded Z3) and the lowering table are consistent. The modes-of-work section is a coherent design. Four text-level semantic gaps would be implemented wrongly from the text as written (MUST-FIX). No new experiment is needed, and the owner can read the document now.

## Round-1 items

- **Resolved:**
  - MUST 1 (Belnap reading; R-P1 follows, with a hole about default conclusions, see the new MUST 1), 3, 4 and 5.
  - MUST 6 and 8.
  - SHOULD 1 (correct; the Datalog `why_not` returns unsatisfied demand predicates, a weaker answer, so mark it in `provides`).
  - SHOULD 2–6 and 8–17.
  - The addendum items.
  - Modes of work, as a design.
- **MUST 4:** add the rule that when no argument flows into `q`, whole-predicate completeness is required.
- **MUST 2:** resolved, but the ASP `integrity` row reintroduces a hard constraint (see the new MUST 4).
- **MUST 7 and SHOULD 7:** only partially resolved (see the new MUST 2 and 3).

## MUST-FIX (new)

1. **Default conclusions are completeness-sensitive (4.3 default rule 1, 11.6 R-P1, 4.2 item 4).** A newly retrieved strict contrary retracts a default conclusion. Under the letter of item 4, no default can yield an accepted answer unless its head predicate is closed. Fix:
   - (a) Judge R-P1's "without negation as failure" on the desugared program, so default conclusions fall under R-P2.
   - (b) For the generated `x_strict_*` and `x_*_blocked` predicates and for exception bodies, completeness is *retrieval* completeness for the keys (`lookup(not p, keys).complete`, `rulesFor(contrary).complete`, a keyed lookup of each `except` predicate), not world closedness.
   - (c) Before accepting a default-derived row, widening does keyed lookups of `not p a` and the exception atoms for each candidate `a`.
   - State that "does not depend on any default conclusion" is tested on predicate names.
2. **`conditional` is per packet but the rendering is per row, and leave-one-out is not exact (4.2 item 6, 4.4, 5.3).**
   - Counterexample (monotone): facts a, b, c, and the row is derivable iff c and (a or b). Leave-one-out gives [c], yet "if c" is wrong when neither a nor b holds.
   - Fix: after computing S, run once more with observed + S only. If the answer equals the full answer, S is exact. Otherwise report all assumptions with `conditional_unknown: true`, or grow S greedily and say that the minimal set is not unique.
   - Remove or qualify "exact for monotone programs".
   - Make `conditional` per row; the packet list is the union.
3. **`used` by deletion has the same flaw, and the shadow comparator is inconsistent with it (5.3, 5.4).**
   - With two facts that are each sufficient, deletion-based `used` is empty, while a strategy that provides `used` returns one proof's leaves.
   - Fix: `used` = one sufficient support set. For the host's deletion method, that is the leave-one-out set verified by a replay run; otherwise `used_incomplete: true`, a flag distinct from `conditional_unknown`.
   - The comparator checks that each strategy's `used`, replayed alone in the oracle, re-derives the answer, and compares node statuses, never leaf-set equality.
   - Under-reporting `used` only loses promotions (AGENTS rule 7).
4. **The ASP `integrity` row contradicts 4.3 (7.1).** `severity error` is undefined, "norm mode" does not exist (binding is per wire), and integrity is never a hard assertion. Delete the exception, or express it as a `norm` (`forbid STATE always`).

## SHOULD-FIX (new)

1. **Obligation trigger and scoping.** `oblige … when router ?r within 10` obliges notifying every router in memory. Define:
   - an obligation instance is triggered at the first step where `when` holds for a binding bound by the goal's arguments or by an executed action;
   - standing obligations over a whole predicate get `obligation_unscoped`;
   - every qualifier, formally, in one table:
     - `forbid before`, `forbid after`, `at_most_once`;
     - `oblige sometime`, `always` (maintain), `within N`.
   - `within N` counts steps in a plan and time units in a timestamped trace.
2. **The `severity` × `binding` matrix.**
   - `severity` says what a violation does: hard makes the plan invalid; soft adds a cost.
   - `binding` says whether the engine may relax the norm when otherwise blocked: strict never relaxes it (`blocked_by`); advisory may relax it (listed in `relaxed`).
   - advisory + hard is a relaxable hard constraint; `binding` on a soft norm is vacuous (warn).
   - A `both` between norms of equal strength: under strict, the result is `blocked` with both ids; under advisory, it is a reported violation.
3. **`policy procedures` and `scope` have no matching rule.**
   - All approved norms whose `scope` matches bind regardless of procedure. `procedures` selects the methods and the rendering set.
   - Define `scope` matching or drop the field.
   - `procedure.version` without `supersedes` is unusable: add `supersedes` or remove `version`.
4. **`contested` and the approval default.**
   - `contested` is a host write. Recommendation: a contested wire binds, flagged, until the host decides.
   - "No field = approved" is right in memory (ingestion is the approval) but wrong on the authoring surface (omitted = submitted). Say that ingestion writes the field.
   - Require `approved_at` for norms and strict methods, falling back to `known_at`.
   - Unify the amendment's `proposed|accepted|rejected` with the wires' vocabulary, or justify the difference.
5. **`conform` needs time and a method-deviation rule.**
   - Judge a past trace against the versions in force at the time: `trace.step` may carry `at`, and `conform` takes `asof` (default now).
   - Deviating from a strict method is non-compliance; under advisory, report `deviations`.
   - Conformance is purely relational, so lower it to core rules (step-indexed facts, norms as rules deriving `violated`). It then runs on every Datalog strategy, the cheapest way to make audit live.
6. **Naming `blocked_by` in ASP and Z3.** Unsat cannot name the blocker. Encode hard norms as violation atoms plus a "no violation" requirement. On unsat, lift that requirement and `#minimize`/MaxSAT the violations (the `waive` abduction). Unsat within the horizon is `budget_exhausted reason horizon`, not `no_plan`.
7. **Interval combination for non-boolean answers.**

   | answer | under `during` (throughout) | under `overlaps` |
   |---|---|---|
   | `select` | rows present in every part | union, with validity |
   | `count` | rows present throughout | not specified |
   | `every` | holds in every part | not specified |

   Define the sentinel order `beginning` < instants < `open`.
8. **Governance on `action`.** Preconditions and effects come from the manual and are amended like methods. Add governance fields and include actions in `used`, or say why not.
9. **Housekeeping.**
   - `sopr-lift-worlds` vs `worlds-sopr`.
   - State that 12b was rewritten to `overlaps`, and how the adapter maps it.
   - `permit` without `overrides` is a no-op; warn.
   - Label the declared-coverage table as a declaration, not a prediction.
   - The native closure template produces answers, so it must pass the 5.4 shadow gate like a strategy.
   - `dreaming-session` with its own declared coverage is confusing for a wrapper.
   - V01 (a facade) graded "strong" is odd.

## Section 8, inventory, audiences

- **Section 8 coherence:** sound. Two sentences to add:
  - the host composes the `amendment` wire from the user's language; it is a host-generated knowledge wire, not model output;
  - before approval, the host may replay the procedure's own smoke cases under the amendment.
- **Inventory (2.7):** the evidence claims are now honest and specific.
- **Usability:**
  - The implementer is well served.
  - The authoring LLM is not: its material is spread across ~80k tokens. Extract a 3–4 page **authoring guide** generated from the validator.
  - Move the 2.7 inventory table and the two 9.2 tables to appendices.
  - The prose is clear; length is the problem.

## Remarks for the owner (the reviewer's recommendations)

1. **14.2 `both`:** accept the paraconsistent reading. It is the only choice that makes answering from a partial slice safe.
2. **14.10 + 14.16:**
   - Order after the `js-reference` oracle: `htn-strips-planner` first, then `sql-sqlite`.
   - Lower `conform` to core rules first; it is cheap and gives an immediately useful audit.
   - Accept the 8.8 naming set.
3. **14.23 who approves:**
   - The owner approves norms and strict methods.
   - A named role approves advisory methods and defaults.
   - Users only propose.
   - A contested wire keeps binding until the host rules.
4. **14.6 `advanced`:** keep its current meaning, deprecated with a warning, and add `auto`.
5. **14.3 closedness:** declared by host review only, over archived or pinned retention. The SQLite bank is the substrate for completeness-sensitive retrieval.
