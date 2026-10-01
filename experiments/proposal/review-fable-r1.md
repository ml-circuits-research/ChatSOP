# Review round 1 of `reasoning-wires-proposal.md` (reviewer: Fable, 2026-10-01)

Verbatim transcription of the reviewer's report; line numbers refer to the proposal as of round 1.

**VERDICT: needs major revision** — of sections 4.2 (shared semantics) and 7.1 (lowering table), not of the architecture. The core/sugar split, the capability interface, the budget rule and the retrieval guard are the right design and are well argued. But the semantics text leaves the two most important things underspecified (what `both` does downstream, and what a derived closed predicate means under partial retrieval), and the lowering table contains three lowerings that are unsound as written. These are text fixes, not new experiments, but they change the contract an engine author would implement.

## MUST-FIX

1. **`both` is non-monotone and contradicts R-P1 (lines 127, 648).** Line 127 says a `both` atom has the property "neither wins, nothing else follows". If a `both` atom does not satisfy a positive body literal, then retrieving one more `not p a` fact retracts every conclusion derived from `p a`, so R-P1 is false, and widening step 3 accepts answers that can be retracted. Fix: choose and state one of (a) paraconsistent/Belnap: positive and negative evidence propagate independently (soplab's actual semantics), `both` is only a reported status of a ground atom, rules see `p a` as true and `not p a` as true; R-P1 holds; or (b) conflict blocks propagation, in which case `both` must be listed in R-P2 as completeness-sensitive and the widening loop must treat any answer whose derivation touches a predicate that has negative facts as non-monotone. Recommend (a).
2. **Z3 and ASP lowering of explicit negation explodes (line 350).** `fact holds not p a` → Z3 `(assert (not (p a)))` and ASP `-p(a).` are both wrong for a theory that also contains `p a`: Z3 becomes unsat and entails everything; clingo returns no stable model. Neither can produce `both`. Fix: lower explicit negation to a separate relation (`p_neg`) in both, as the Prolog column already does, and compute `both` as `p_pos ∧ p_neg` at query time; or declare `classical_negation`/`conflict` unsupported for those strategies. Same for the `integrity` row (line 358): a hard Z3 assertion makes the theory inconsistent.
3. **Clark completion in Z3 is unsound for recursive rules (lines 351, 353, strategy `z3-smt-bounded`).** Completion over a finite domain characterises supported models, not the least model: with a cycle `edge(a,b), edge(b,a)`, `reach(a,c)` is consistent with the completion although not derivable, so the "refuted by completion" check (line 409) can fail, and `absent` derived via completion is wrong. Fix: loop formulas (Lin and Zhao 2004), a level-mapping/rank encoding, or explicit bounded unrolling; or declare `recursion` unsupported for `z3-smt-bounded`. State that case 09a passed only because it is non-recursive.
4. **Closedness of derived predicates is undefined under partial retrieval (lines 136, 172, 649).** `absent` on a derived predicate needs all rules with that head in the slice (`rulesFor.complete`) and, recursively, every body predicate complete for the keys that flow into it; for recursive predicates this is magic-set demand propagation. Fix: define `complete_for_view(derived p, keys)` recursively in 10.6, make the validator flag `absent` on a derived predicate whose rule set is not entirely in the slice, and add a smoke case (absent over a recursive derived predicate with the slice missing one rule).
5. **Time has no semantics for derived atoms and no lowering row (lines 130, 347–367).** Validity of a derived atom whose body facts have different intervals; whether `during` means "throughout" or "overlaps"; how a time variable is bound for `order ?t1 before ?t2`; what `asof` reads when known-at lives in memory metadata. Table 7.1 has no row for `valid`/`at`/`during`. Fix: snapshot semantics (a derived atom holds at t iff its body holds at t; interval answers by endpoint partitioning), `during` = "for every t in the interval" (`overlaps` as a separate word), and a lowering row (point-in-time: filter facts then run any engine; intervals: partition then run; engines without time are n/e for 12b).
6. **Zero-arity atoms are not expressible (line 122).** A default or rule whose head has no variables (`then alarm_on`) desugars to a zero-term atom the grammar forbids. Fix: allow arity 0, or document the dummy-constant workaround and make the desugarer apply it.
7. **`conditional: true` is a boolean but rendering needs the assumption set (lines 129, 246, 298).** Fix: `conditional` becomes a list of claim ids per row (or per packet); specify the universal two-run lowering (observed-only facts vs all facts; rows only in the second are conditional). Under NAF the difference is non-monotone (a supposed fact can remove a row); a conditional answer under NAF must say so.
8. **The role-to-position bridge between the two surfaces is missing (lines 136, 237–247).** SymbolicLM emits roles; knowledge atoms are positional; the `predicate` wire has only types. The sop-r pilot's single error was an argument-orientation mistake. Fix: `predicate` declares `args subject:entity object:entity` (closed role inventory, types after the colon); the validator checks facts against it; the lexicon stores only word→predicate. This is also the most effective robustness measure for LLM authoring.

## SHOULD-FIX

1. **`why_not` via Z3 unsat core is wrong (line 366).** If the claim does not hold, theory ∧ ¬claim is satisfiable; unsat cores explain entailed claims. Define `why_not` as minimal sets of EDB atoms over the slice vocabulary whose addition makes the goal derivable, plus the blocking NAF literals. A vanilla Prolog meta-interpreter over tabled predicates loses termination unless itself tabled.
2. **Priority blocking uses `applies`, not `fire` (lines 172, 179–180).** A higher-priority default blocked by its own exception still blocks the lower one. Choose deliberately; replace or complement global integer `priority` with `overrides $default_id` (sop-r's form), since global integers do not compose across chapters compiled by different agents.
3. **`aggregate`, `count`, `every` do not require closed predicates at the wire level.** Add `aggregate_needs_closed`/`every_needs_closed` warnings, or define the result over an open predicate as a lower bound with `bound at_least`.
4. **Planning silently uses closed world on fluents (lines 214, 349, 353).** State that fluent predicates must be `closed`, or that the planner uses polarity-explicit three-valued states. Return sop-r's `BLOCKED` information: `blocked {step, requirement}` rather than bare `no_plan`.
5. **Bounded-engine negatives need their own status (lines 335, 338, 360).** `no_plan` from a horizon/depth/coordinate limit is `budget_exhausted` with reason `horizon`. Add to section 6 and `lib/compare.mjs`.
6. **`ignored: [...]` in the packet (line 298) is undefined.** Define it as "wires outside the query's dependency slice" only, never unsupported features.
7. **Packet lacks the claim ids used in the proof.** AGENTS rule 7 needs them. Add `used: [claim ids]`, mandatory for `supported`/`refuted` with `complete: true`, and a minimal proof-DAG schema so shadow comparison can compare explanations.
8. **Capability declaration misses routing dimensions:** `delivery`, `max_wires`, `max_arity`, integer range, `exact | bounded`, `provides explain | used | conditional`, determinism.
9. **Incremental maintenance and non-monotone updates (lines 287, 722).** Retractions with NAF need DRed-style maintenance (Gupta, Mumick, Subrahmanian 1993) or invalidation; say when a prepared handle or dreamed plan is invalidated. Integrity over the whole memory cannot be checked per query slice: check at ingestion time (trigger index) or offline.
10. **Dreaming at scale.** Say what a handle is prepared over at 10^6–10^9 wires: a per-domain subgraph or per-query-family slice.
11. **Simulated 10^7–10^9 store measures lookup counts, not I/O (line 679).** Say so; add a real 10^7 SQLite run.
12. **Deliver slices as structured objects, not re-parsed `.sop` text (lines 592, 664, 757).** The 2,048-wire limit is an author-surface limit.
13. **`method` cannot express branching or loops.** Branching = several methods with guards (say so); loops not expressible; name the limit in 11.3.
14. **Recursive aggregation is excluded.** Document as a known limit, point to planning.
15. **Evidence framing.** soplab/E10/sop-r/VRC are the same project lineage; their agreement is consistency, not independent validation; make the headline consistent with 8.3. The "Nixon diamond with priority" is not a Nixon diamond; rename.
16. **Structure.** Section 12 has subsections numbered 11.1–11.3; the open-question list is split by `---`; Appendix A lists `pack`, unexplained in the body.
17. **Literature to add:** Clark 1978, Lin and Zhao 2004, Przymusinski 1988, Belnap 1977, Nute 1994, Gupta/Mumick/Subrahmanian 1993, Ross and Sagiv 1992, Erol/Hendler/Nau (HTN undecidability with recursive methods).

## Answers to the open questions (section 13)

1. Core/sugar: accept; the desugared program is the normative semantics of `default`; a native ASP implementation is accepted only if it agrees in shadow on stratified programs. Fix `applies`/`fire` first.
2. Two negations and `closed`: accept per-predicate `closed`; a per-theory flag may exist as sugar. A `select`/`exists` on a closed, non-derivable predicate over a complete view returns `refuted`, not `unknown`.
3. New query modes: accept `why_not`, `plan`, `abduce` as declarative modes.
4. Strict contrary: blocks automatically (strict knowledge sits below all defaults); only default-derived contraries go through priority; the Nixon diamond stays `both`.
5. Strategy ids: yes; keep `reference` as an alias of `js-reference`; deprecate `advanced` with a warning rather than redefining it as `auto`.
6. Closed-world questions from the model: host rule; `polarity negated` on a closed predicate → explicit `not` first, then `absent` over a complete view; render "no record of" with the source of closedness.
7. `valid` optional, `status`/`speaker` first-class: accept.
8. `budget_exhausted`: accept; add `reason horizon|domain|depth`, and `at_least` bounds for partial counts.
9. First strategy: `prolog-tabling`, with the precondition that `js-reference` first implements the full core (NAF, aggregate, compute, default via desugaring) naively as the shadow oracle. Then `htn-strips-planner`. Acquire clingo before Soufflé.
10. Arity: keep 4 on the model surface; raise to 6 for knowledge wires.
11. Sets vs bags: sets of bindings of all `over` variables; say that two people with the same salary count twice.
12. Effort: three levels; host owns floors and ceilings; effort scales retrieval and strategy budgets together.
13. Routing default: stay on `js-reference`; route automatically only when it declares a needed feature unsupported and exactly one capable strategy exists.
14. Solvers: private clingo and Soufflé under `tools/.solvers/`, owner permitting; clingo first.
15. Grammar location: move to `sop/` as the single source; regenerate DS004/DS006/DS010/DS014 and wire help from it.
16. FactSource: accept; `closed` and `count` implemented by the SQLite bank, scan and exact sidecar; RecallMemory/HoloMemory return `declared: false` and estimates only.
17. Embedding index: FTS5 + dictionary now; an embedding proposer later, lexicon side only, behind a flag.
18. Closed and retention: closedness declared by a host review step; the coding agent may propose it with the source sentence asserting exhaustiveness. Never automatic.
19. Slice size: structured delivery bypassing the parser; `maxWires` for authored circuits; stream for pull engines.
20. Who widens: the host; pull-capable strategies report `complete_for_view` via FactSource flags; the host applies R-P2.
21. Premise selection: exact radius + constant hops + SInE-style frequency tolerance first; learned selectors only after logs exist, only to reorder or widen.

## Strengths

- The core/sugar split with a validated desugarer, and a validator that checks the desugared program.
- Two negations kept apart, `absent` tied to `closed`, closedness tied to retention (R-P4).
- The budget rule (an incomplete result never reads as `unknown`, `refuted`, `no_plan` or `optimal`), enforced by the comparator, tested by 15a–c.
- Section 10's retrieval guard and the `--unsafe-naf` ablation.
- Correctly staged routing, honest about E10's tied neural ranker.
- The evidence section states its own limits well; the main overclaim is the word "independent" and the headline counts.
