# Review round 1, addendum (reviewer: Fable, 2026-10-01)

A second full pass by the same reviewer. It repeats the MUST/SHOULD items of `review-fable-r1.md` with small differences, listed under the first heading below, and adds the owner-requested section "Modes of work and operating procedures". Verbatim in substance; line numbers refer to the round-1 proposal.

## Items added or sharpened compared with `review-fable-r1.md`

- **M5 (extended):** besides recursive `complete_for_view` for derived predicates, add the validator checks `aggregate_needs_closed`, `count_needs_closed` and `every_needs_closed_scope`, or let an open-predicate aggregate return a bounded result (`at_least`) with `complete: false`.
- **M6 (promoted to MUST):** `why_not` = minimal sets of EDB atoms (in the slice vocabulary, respecting `predicate` types) whose addition makes the goal derivable, plus the blocking atoms for NAF or exceptions. That is abduction with a restricted hypothesis space:
  - in Z3, MaxSAT/optimisation over fresh EDB literals;
  - in Prolog, an abductive meta-interpreter (it does not compose naively with tabling);
  - in E10, the unsatisfied demand predicates.
- **M7 (extended):** for non-`explain` strategies, the host computes `used` by a two-run method. It is exact only for monotone programs; otherwise mark the answer `conditional_unknown`.
- **Strict contraries (S2):** blocking by an explicit contrary atom whose derivation does not depend on any default is stratifiable (validator-checkable). Today's rule, where an observed `not flies tweety` gives `both`, will surprise every author.
- **`js-reference` as oracle (S7):** stage 1 makes js-reference a complete, deliberately naive implementation of every core feature. That is the entry condition for every other strategy.
- **Prolog budgets and tabling (S14):** `call_with_depth_limit` is meaningless on tabled predicates, and a time-limit exception leaves incomplete tables, which must be abolished before the next query. Put this in the adapter contract.
- **LLM authoring risks (S16), to state in 11.1:**
  - `not` written where `absent` is meant (lint: `not p` in a body when no negative fact or rule for `p` exists anywhere);
  - arity and argument-order drift;
  - floats and units;
  - priorities;
  - forgetting `closed`;
  - conflating rule and default ("usually");
  - reification of n-ary events.
  Add a lint pass and the differential-compilation probe to stage 1. Writability is the central product hypothesis and should shape the grammar before engines are built.
- **Namespace collision (S17):** predicate names are wire ids, so a fact cannot be named `@flies`, and generated ids (`d_x_blocked`) may collide with author ids. Reserve a prefix.
- **Housekeeping (S18):**
  - `key` on `predicate` is never said to be enforced or advisory;
  - `divided_by` has no rounding or division-by-zero rule;
  - `compare above` on entities is undefined.
- **Evaluation plan additions:**
  - an authoring-fidelity probe in stage 1;
  - `conditional` correctness;
  - the `clarify` rate on real memories;
  - latency targets for chat;
  - metamorphic tests of host linking (not only of engines);
  - the smoke suite as a `tests/` gate.
- **Retrieval additions:** a hub-constant truncation policy, and the expected `clarify` rate on real memories.
- **Open questions, changed answers:**
  - Q5: alias `advanced` → `auto` with a deprecation note in `route` (round 1 said deprecate without redefining; the owner decides).
  - Q6: a negated question on a closed predicate gives `refuted` when the atom is not derivable over a complete view, otherwise `unknown`.
  - Q7: `valid` defaults to `timeless`.
  - Q9: after `prolog-tabling`, the next strategy is `htn-strips-planner` extended per section 10 below, then clingo.
  - Q14: clingo is a single small MIT binary; Soufflé is optional and harder to build, so defer it.

## 10. Modes of work and operating procedures

**Judgement: not enough.** The five wires cover:
- classical planning (`action`, `goal`);
- one linear HTN method (`method`);
- numeric constraints (`constraint`);
- compute budgets (`policy`).

A mode of work that helps *and restricts* an engine needs four things the proposal lacks:
- (a) procedures with choice points the engine optimises and fixed points it may not touch;
- (b) constraints on *trajectories*, not on states or numbers;
- (c) norms with bearers, deadlines, priorities and violation handling;
- (d) procedures as named, versioned, approved objects that the engine can be told are "in force", and that can be amended through the host.

Gaps against the owner's four requirements:
- **Act according to approved rules and plans:** `policy` carries only budgets. There is no way to pass the procedures and norms in force to `ask`, and no wire has `version`, `status`, `approved_by` or `supersedes`. The lifecycle in 11.1 is prose only.
- **Still optimise within them:** `method` is totally ordered, with no `choose`, `achieve` or `optional`, so there is nothing to optimise. Preferences and soft constraints with violation costs (PDDL3 `preference`, `is-violated`) do not exist, and `integrity` is static and hard.
- **Conceptually addressable:** wires have ids but no bundle, version or scope. A procedure spanning ten wires has no name.
- **Modifiable through negotiation:** there is no amendment object, no what-if evaluation of a proposed change, and no record of acceptance.

**Proposed additions.** All of them are knowledge-side, written by coding agents or the owner, never by SymbolicLM. Approval stays with the host.

1. **`method` extended** (Golog/ConGolog and SHOP2 shapes, words only).
   - `step` kinds:
     - `~action` (primitive);
     - a sub-task atom;
     - `achieve atom` (the planner fills the gap);
     - the `optional` prefix;
     - an `any_of … end` group (the engine chooses one branch and optimises; Golog's nondeterministic choice);
     - an `unordered … end` group (partial order);
     - `until cond … end` (bounded iteration with a step cap);
     - `if cond … else … end`.
   - Also `on_fail $method` (BDI failure handling, escalation), `by ?agent` on steps, and `cost`.
   - Semantics: a plan is a run of the program, and the engine chooses only at `any_of`, `achieve`, `optional` and `unordered` points.
   - HTN with recursive methods is undecidable in general (Erol, Hendler, Nau 1994), so require a depth cap and report `budget_exhausted`.
2. **`trajectory` wire** (TLPlan control rules, PDDL3 constraints).
   - Forms: `always cond`, `never cond`, `sometime cond`, `sometime_before A B`, `sometime_after A B`, `at_most_once cond` and `within N cond`.
   - Modifiers: `kind hard|soft`, and `cost N` for soft.
   - Hard constraints prune search; soft ones add to the objective.
   - Lowering:
     - hard constraints become state-trajectory checks in the planner (one automaton per constraint), and time-indexed integrity constraints in ASP and in the Z3 horizon encoding;
     - soft constraints become `#minimize` or objective terms.
3. **`norm` wire** (deontic).
   - Fields:
     - `kind obligation|prohibition|permission`;
     - `bearer` (an agent or role);
     - `content` (an action pattern or a state atom);
     - `when` (condition);
     - `deadline` (a time, or `before` a state);
     - `priority` or `overrides $norm`;
     - `violation_cost`, `source` and `quote`.
   - Desugaring:
     - a hard prohibition becomes `trajectory never`;
     - a soft prohibition becomes a soft trajectory;
     - an obligation becomes `achieve` with a deadline, deriving `violated $norm ?bearer` when unmet (contrary-to-duty norms are rules on `violated`);
     - a permission becomes an `except` of the governing prohibition, reusing the default machinery, so lex specialis is `priority`/`overrides`.
   - Conflicting norms of equal priority give `both` and are reported, never silently picked.
4. **`procedure` bundle wire.**
   - Fields:
     - `version N`;
     - `status proposed|approved|superseded|retired`;
     - `approved_by`, `approved_at`;
     - `supersedes $id`;
     - `scope` (tasks, agents, contexts);
     - `members $m1 $m2 …`;
     - `source`.
   - Only `approved` members of the version selected by `asof` enter the theory.
   - The host, not the agent, sets `status` and `approved_by`. The approval is a trusted-host write, recorded in the journal.
5. **`policy` additions.**
   - `procedures $p …`: the modes of work in force.
   - `norm_mode strict|advisory`: in strict mode a violation makes the plan invalid; in advisory mode violations are costed and reported.
   - `objective cost|violations|lexicographic`.
6. **Result packet additions.**
   - `applied: [{procedure, version}]`;
   - `choices: [{step, chosen, alternatives, reason}]`: what the engine optimised;
   - `violations: [{norm, step, cost}]`;
   - `blocked: {step, requirement}`: sop-r's BLOCKED with the failing requirement, which `no_plan` loses today;
   - `relaxed: [...]`: only in advisory mode, never silently.
7. **New query mode `conform`.** Given a performed trace (a sequence of `~action` steps), it reports compliance with the procedures and norms in force (conformance checking). The same wires then serve audit as well as planning.
8. **`amendment` wire and a host negotiation loop.**
   - Fields:
     - `of $procedure`;
     - `proposed_by user|agent`;
     - `adds`, `removes` or `replaces $wire`;
     - `reason`;
     - `status proposed|accepted|rejected`;
     - `evaluated` (a link to the comparison).
   - The loop:
     - The engine evaluates an amendment as a what-if (`if $amendment` on a `plan` or `conform` query), using the existing supposition mechanism.
     - The host presents the delta: plan cost, violations and blocked steps, before and after.
     - The user accepts or rejects. Acceptance writes a new `procedure` version with provenance.
   - Argumentation (support and attack between amendments and norms, Dung grounded semantics) can come later. Grounded semantics needs well-founded negation, so it is a `prolog-tabling` or ASP feature, not stratified Datalog.
9. **Capabilities.**
   - Flags: `htn_choice`, `trajectory_hard`, `trajectory_soft`, `norms`, `conform` and `procedures`.
   - A Golog interpreter in SWI (IndiGolog exists) is a natural strategy, `golog-swi`.
   - `asp-clingo` covers norms and preferences natively.
   - `htn-strips-planner` must implement the automaton check for `trajectory`.

## 10b. Modes of work: the reviewer's dedicated addendum (second, focused answer)

**Judgement.** `method`, `action`, `goal`, `constraint` and `policy` are enough to *describe* a fixed procedure and to *check* it, but not to make procedures **help and restrict** engines. There are four gaps:
- `method` is a total-order script with nothing to optimise inside it.
- Nothing restricts *behaviour*: `integrity` constrains states and `constraint` is numeric.
- Procedures are only tried first (line 337), so they are advisory.
- There is no version, approval state, approval provenance or supersession, and no path for amendment.

`policy` is budget, not knowledge; do not overload it.

**MUST**
- **M1. Choice inside `method` (Golog/SHOP2).** New step forms:
  - `step choose … end`: a nondeterministic alternative;
  - `step pick ?x where <cond>`: a binding chosen by the engine;
  - `step any_order … end`: a partial order;
  - `step optional ~a`;
  - `until <atom>` with an explicit `max`;
  - `prefer ~a over ~b`, or a `cost` per alternative.

  Legal executions are all ways of resolving the choice points; `mode plan` returns the cheapest legal execution that satisfies the norms.

  Lowerings:
  - HTN: alternatives;
  - Prolog: backtracking;
  - ASP: choice rules plus `#minimize`;
  - Z3 bounded: one Boolean per alternative per step.
- **M2. A `norm` wire (deontic, TLPlan, PDDL3).** Fields:
  - `forbid|oblige|permit <action pattern or state atom>`;
  - `when <condition group>`;
  - a temporal qualifier: `within N`, `before ~b`, `after ~b`, `always` or `sometime`;
  - `severity hard|soft` and `cost N`;
  - `priority` and `overrides $norm`. `permit` is an exception to a `forbid`, through the default desugaring.

  Semantics:
  - hard prohibitions prune actions;
  - hard obligations are goals with deadlines;
  - soft norms add cost when violated and are reported.

  `norm` is to actions what `integrity` is to states; keep both.
- **M3. `binding strict|advisory` on `method` and `norm`.**
  - Under `strict`, when an approved method exists the engine may not plan from primitives, and a strict `forbid` is never traded for cost. The result is `blocked_by $norm`, not `no_plan`.
  - Under `advisory`, methods guide the search and soft norms cost.
- **M4. Governance fields on `method`, `norm`, `default`, `rule` and `integrity`:** `version N`, `supersedes $id`, `status proposed|approved|contested|superseded|retired`, `approved_by`, `approved_at`, `source`, `quote`, `scope`.
  - Only `approved` wires bind.
  - `proposed` and `contested` wires are treated like `supposed` facts: used only conditionally, with answers carrying `conditional`. This gives "what would the plan be if this amendment were approved" for free.
  - Approval is a host write.
- **M5. Packet and interface additions.**
  - `used: [{id, version}]` for every method, norm and action.
  - `compliance: {hard: ok|blocked_by [$ids], soft_violations: [{id, cost}], total_cost}`.
  - A new call `check(plan, theory) -> compliance`, sop-r's `check`.
  - `mode why_not` on a planning goal, returning `blocked {step, requirement, norm}`.
  - Capabilities: `method_choice`, `norms_hard`, `norms_soft`, `temporal_norms`, `check_plan`.

**SHOULD**
- **S1. Amendment by versioning plus an `argument` wire** (`for|against $id`, `claim`, `source`, optional `cost_delta`).
  - `mode abduce` with `hypothesis waive $norm cost N` returns the minimal set of norms whose relaxation unblocks a plan. That set is the negotiable item the host puts to the user.
  - `check` evaluates the user's counter-proposal.
  - `mode plan` under the proposed version gives the conditional outcome.
  - Dung argumentation only if contested wires accumulate.
- **S2. BDI.**
  - `goal type achieve|maintain`, where maintain is an `always` norm.
  - `method on_failure $method|replan|abort`, plus an optional `triggered_by <event>`.
  - The plan library is the set of approved methods indexed by `achieves` and `triggered_by`.
- **S3. `mode procedure`:** renders the approved method (steps, versions, norms in force) without planning. Most SOP questions want the text.
- **S4. Validator checks:**
  - every `~action` has an `action` wire;
  - every sub-task has an approved method;
  - `overrides` targets a norm of opposite force on a unifiable pattern;
  - a strict `forbid` on an action required by a strict method is a `conflict` error at approval time;
  - `until` has a `max`.

**Example circuit**

```
@router_reset method
  achieves router_reset ?r
  when router ?r
  version 2
  supersedes $router_reset_v1
  status approved
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
  until link_up ?r
    max 3
  prefer ~soft_reset over ~hard_reset

@no_hard_reset_in_hours norm
  forbid ~hard_reset ?r
  when business_hours
  severity hard
  binding strict
  version 1
  status approved

@notify_promptly norm
  oblige ~notify_oncall ?r
  when router_reset ?r
  within 10
  severity soft
  cost 50
  status approved

@emergency_hard_reset norm
  permit ~hard_reset ?r
  when emergency ?r
  overrides $no_hard_reset_in_hours
  status approved

@relax_hours norm
  forbid ~hard_reset ?r
  when business_hours
  when absent ticket_open ?r
  version 2
  supersedes $no_hard_reset_in_hours
  status proposed

@a1 argument
  for $relax_hours
  claim "an open ticket already implies on-call awareness"
  source "incident review 2026-09"
```

Expected behaviour:
- **"how do I reset r7 now?"** (business hours, no emergency):
  - `plan_found`, with the plan notify_oncall, soft_reset, verify_link;
  - `used: [router_reset v2, no_hard_reset_in_hours v1, notify_promptly v1]`;
  - `compliance.hard ok`.
- **"why can't I hard-reset r7?"**: `blocked_by $no_hard_reset_in_hours`.
- **With `if $relax_hours` and `ticket_open r7`:** `plan_found` with `conditional: [$relax_hours]`, rendered "allowed only if amendment v2 is approved".

**Reconciling 10 and 10b:** the two answers agree on substance and differ in naming:

| 10 | 10b |
|---|---|
| `trajectory` | temporal qualifiers on `norm` |
| `procedure` bundle | governance fields on every wire |
| `any_of` | `choose` |
| `conform` | `check` |

The revision should pick one coherent set, state the choice, and list the alternative in the owner questions.
