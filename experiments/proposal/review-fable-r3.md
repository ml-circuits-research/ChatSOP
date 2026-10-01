# Review round 3 of `reasoning-wires-proposal.md` (reviewer: Fable, 2026-10-01)

Summary of the reviewer's report, with its substance kept verbatim.

**VERDICT: ready for owner review.** All round-2 MUST-FIX (1–4) and SHOULD-FIX (1–9) items are resolved in substance, and round 3 introduced no semantic regression. Six text-level defects remain. Apply them in the same pass the owner reads, because two of them are factual statements.

## Small gaps in resolved items
- **MUST 1:** the body predicates of a strict contrary *rule* (for example `penguin` in `when penguin ?x then not flies ?x`) also need keyed lookup completeness for each candidate. Item 4's recursion applies to those bodies, with retrieval completeness at the leaves.
- **MUST 2:** say what "exact" means. For monotone dependence, a passing verification proves that S is the *unique* minimal set. Under NAF the verification establishes sufficiency only, and the `nonmonotone` flag must be set.
- **SHOULD 3:** `scope_unknown` is not in the 5.3 packet schema. Add it as a field or in `notes`.
- **SHOULD 8:** partially resolved (see new issue 2).

## New issues
1. **`js-oracle` contradicts the "no engine passes" statements.**
   - Appendix F shows `js-oracle` passing `01b`, `06d`, `12c`–`12g` and `13b`, yet sections 0 and 9.2 say no strategy passes them, and 5.4 and 7 still say `js-reference` is "to become" the oracle.
   - Fix: state that `js-oracle` is the stage-1 complete oracle. Rewrite the "no engine passes" lists so they name only the modes-of-work family and `11c`, and say whether `js-reference` stays as the bounded product strategy.
   - Mention `datalog-souffle` in section 7, or drop it from 9.2.
2. **Case 30a `used` omits actions.** Add `notify_oncall@1, soft_reset@1, verify_link@1`, or state that the table abbreviates.
3. **Standing obligations have no syntax.** Define one marker (for example `scope standing` or the qualifier `each`). Make `obligation_unscoped` the warning for that marker, and keep the unbound-variable case as `unsafe_variable`. Otherwise, state that only ground standing obligations are expressible.
4. **`approved_at` is required on every norm, but the author-run validator conflicts with that.** Define a validator authoring mode in which governance fields are forbidden or ignored. `approval_incomplete` and `approved_at` are then checked at ingestion only.
5. **The default `binding` is unspecified.** Default to `strict` for norms and methods: it is fail-safe and consistent with "a policy may only tighten". The guide should say so.
6. **The 4.3 `action` wording "not a bare `no_plan`" conflicts with 8.4.** Use `no_plan` only when nothing can be named.

## Authoring guide
- **Reification:** show one reification pattern: an `event1` fact plus one fact per participant, with roles.
- **`closed`:** drop `closed` on `penguin`, since exception predicates need retrieval completeness, not closedness. Keep it on `salary` and add the source sentence that justifies it.
- **Symbols versus strings:**
  - Entities are lowercase symbols. Strings are only for text values, `source` and `quote`.
  - State how a multi-word name becomes a symbol.
- **Missing examples:** add a six-line `integrity` example, and one `fact` with `status reported`, `speaker` and `quote`.
- **Wording:**
  - §3.5: say "because `?p` is a variable of `over`".
  - §3.8: say "under `binding strict`" (the advisory case is different).

## 14.26 defaults
All five are agreed: (a) contested binds, flagged; (b) scope fails safe, with `scope_unknown` added to the packet; (c) obligation instances come from goal or action bindings, once the marker syntax exists; (d) an advisory hard norm is relaxable; (e) all assumptions with `conditional_unknown`.
