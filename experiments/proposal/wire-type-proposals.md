# Wire-type proposals

Adding a wire type changes the SOP language (DS004, DS014) and is rare (AGENTS.md "New wire types are a serious event"). Agents append proposals here; an Opus agent assigned to the review decides. Everyday work adds facts, rules, defaults, constraints and protocol data with the existing types.

Each proposal: id and date, proposer, the failing cases (references), why the existing types cannot express them (what was tried), the proposed type with its fields and semantics, engines affected, cost, and the review decision (accepted, rejected with the workaround, or deferred).

## P-1 (2026-10-02): claims and their support, for qualitative reasoning and metacognition

- **Proposer:** orchestrator, from the books run (problem-agent: logic book 10 of 14 unknown). Reviewed by the wire-type reviewer (Opus, 2026-10-02) after the owner's answer to Q-LANG-9: metacognition, reasoning about the system's own rules, must be supported.
- **Cases:** critical-thinking items ("which option strengthens/weakens the argument", "what does the author assume", "which conclusion follows") and the general questions about rules: which rule supports X, which premise is missing, would adding F make X derivable or block it, which rules conflict, why X. In the logic book (`datasets_sources/books/eval/items.jsonl`, `book == "logic"`, 1000 items) the dominant form is "premises on a card, three speakers' claims: which is forced, which only possible, which contradicts, where does a speaker overreach (affirming the back, denying the front), which story fits the listed signs".

### What exists (executed 2026-10-02, scratch harness over `Agent.turn` with a fixed formalizer output, and the oracle `reasoning/strategies/js-reference` directly)

| Metacognitive question | Existing form | Product path (model surface) | Oracle |
| --- | --- | --- | --- |
| is the claim forced / only possible / contradicted | `query` (`mode exists`) per claim over session `rule`s and `stated` data: `supported` / `unknown` / `refuted` | works | works |
| which rule supports X, why X | the packet's `used` and `proof` (rule ids and versions), `mode explain` | works: `used` names the session rule (`r_card_mt`); the `explain` text lists only the facts, not the rule (renderer gap) | works (`proof`, `explain`) |
| would adding fact F make X derivable | `stated` with `certainty supposed` + `if $s` on the query | works (one query per F); a supposition that contradicts a stated fact is defeated (DS004 "Assumptions and defeat"), so "had it been otherwise" needs the contrary fact left out | works |
| would adding F block X | the same, over a `default` whose `except` F satisfies | works (`default` is model-authorable) | works: `supported` becomes `unknown` |
| which premise is missing | `mode why_not` (minimal base-atom additions plus blockers) | `not_computable` (`sop/declarative.mjs` marks every reasoning mode not computable) | works for facts; finds nothing when the missing premise is a rule |
| which explanation fits | `mode abduce` over `hypothesis` wires | `not_computable`; `hypothesis` is not model-authorable | works, but **accepts explanations that contradict an observed fact** (an explanation that derives `tool_marks` against `not tool_marks` is kept with status `both`) |
| would adding rule R make X follow (the converse, the inverse: the fallacies) | a governed rule with `approval proposed` named by `if $r` | not expressible: the author never writes governance fields and `if` names only a `stated` wire (`link_reference_unknown`) | works: `supported`, `conditional [r_converse]` |
| which of my rules conflict | status `both`, with `used` for each polarity | works per atom; no question form lists conflicting rule pairs | works per atom |

`argument` (`for`/`against` a wire, with a `claim`) is an author-surface negotiation record about governed wires, not a problem's claim, and no engine reasons over it.

### Existing types on 8 logic-book items

| Item | Form | Result with existing types |
| --- | --- | --- |
| logic:11 some/all/none | three claims, forced / possible / contradicts | solved: `unknown` (Sam), `supported` (Tess), `refuted` (Owen) |
| logic:121 if and only if | who gets the pass | solved: Owen; Sam `refuted` through the "only if" rules |
| logic:31 modus tollens | Tess forced, Owen overreaches | Tess solved (`supported` via the contrapositive rule, named in `used`); Owen's "a dry tap would prove a freeze" solved as `unknown` under `if $s`; naming the overreach (affirming the back) not expressible |
| logic:91 two rules | does darkness cancel Rule One | solved: `wears_shield` stays `supported` under `if $s_dark` (no effect) |
| logic:171 affirming the back | does wetness prove rain | verdict solved (`unknown`); the diagnosis "follows only with the converse rule" needs a candidate rule: oracle yes, model surface no |
| logic:181 denying the front | what follows from "no rain" | verdict solved (`unknown`, `why_not` finds nothing); diagnosis as for 171 |
| logic:541 closed incident note | which story fits | not solved: `abduce` is not routed and keeps "forced entry" although it predicts tool marks the note says are absent |
| logic:501 rival stories | which story first | not solved, as 541 ("whole grid failed" contradicts the lit neighbour lamp and is kept) |

4 of 8 are answered by the existing types on the product path; 2 more get the right verdict but cannot name the reasoning error; 2 need consistent abduction over candidates the formalizer writes.

### Decision

**No new wire type** (`claim`/`supports`/`undermines`/`assumes` rejected: they would let the formalizer record its own judgement of what supports what, which is answering, and no engine could check it). The gap is closed by:

1. **Implementation, no language change (decided by the reviewer):** route `why_not`, `abduce` and `explain` of a model `query` to the oracle (the router's R1 already sends modes of work there); `abduce` rejects an explanation whose closure contradicts an admitted fact (consistency is part of the definition of abduction) and reports it as `inconsistent`; the `explain` reply names the rules of `used` with their text.
2. **Language extension of `query`, proposed to the owner (questions.md Q-LANG-10):** a repeatable field `candidate $id` naming wires of the same output that are not in force (a `stated` with `certainty supposed`, or a session `rule`/`default`), a new mode `effect` that classifies each candidate against the claim (`establishes`, `blocks`, `contradicts`, `no_effect`, `inconsistent`), `mode abduce` over the candidates (minimal consistent sets, plus the candidates needed in every set: what the argument assumes), and `if $r` naming a session rule. Syntax, semantics, validator rules, engines, worked examples and cost are in Q-LANG-10.

- **Status:** accepted as a query-mode extension, pending the owner's approval of the syntax and semantics (Q-LANG-10). Point 1 is implemented (2026-10-02, CHANGES.md "Metacognition on the product path"): `why_not` and `abduce` routed to the oracle, consistent abduction (`inconsistent`), `rules_used` in the explain answer; logic:541 and logic:501 pass as SOP programs over memory hypotheses (`tests/reasoning-modes-product.test.mjs`).
- **Owner decision (2026-10-02 evening):** Q-LANG-10 is approved (syntax and semantics as proposed), on condition that regressions in the reasoning engines are guarded. The guard is the capability battery with its no-loss ledger (DS012 obligation 7, `tools/capabilities/check.mjs`), now done. **Implementation of Q-LANG-10 (`candidate $id`, `mode effect`, `abduce` over candidates, `if $r` on session rules) is postponed:** the owner set the focus on formalization only and paused reasoning work. It starts when the owner ends that focus, under the battery: new L1, L2 and L3 cases, including the P-1 logic-book items.

## P-2 (2026-10-02): conversational acts as memory data, a register choice and two more reply slots (no new wire type)

- **Proposer:** smalltalk-agent (small-talk collections, `config/knowledge/smalltalk-*-v1`, `tools/smalltalk/taxonomy.json`).
- **Cases:** eval/smalltalk-v1 (40 fresh chat messages). "how are you?" is formalized as `pragmatic kind greeting`; "tell me a joke", "write me a poem", "this sentence is false" as `unclear kind no_request`; "I don't see the point in living anymore" as `sadness`; "do you have feelings?" as a query that ends in a near-miss ("Did you mean Billings?"). The collections hold replies for all of them, but no turn fact reaches them. Judged 1-5 (blind, auditor tier): conversation-v1 alone 3.10, with the collections 3.38 (paired bootstrap of the difference [0.03, 0.53]), with the act given as a signal 3.80 ([0.40, 1.01]).
- **What the existing types already express (used):** every collection is `reply`, `rule`, `fact` and one `predicate` (`st_formal_variant`); a new situation is triggered by the layer's own data (`cv_courtesy_situation KIND SITUATION`, `cv_opening_situation`, `cv_situation_priority`); the formal register is a rule over `cv_applies`; topic variants are rules over `cv_turn_topics`.
- **What they cannot express:**
  1. **The act of a message.** `pragmatic kind` is a closed enum of 22 kinds (`sop/enums.mjs`). The collections need 41 more (listed under `proposed_kinds` in each `seed.json`: how_are_you, small_talk_weather, compliment, ask_joke, grief, crisis, ask_feelings, ask_internet, manipulation, paradox, false_premise, ...). Proposal: keep the `pragmatic` wire but let `kind` also take an act symbol declared as data in the conversation layer (e.g. facts `cv_act KIND "description"` that the author guide renders into the formalizer prompt, as `PRAGMATIC_DESCRIPTIONS` is rendered today), and have the validator accept a kind that is a `cv_act` of the reply memory. New acts then need no code change. Alternative: extend `PRAGMATIC_KINDS` with the 41 kinds.
  2. **A register choice per conversation.** Variants are picked at random; a register (neutral, warm, playful, formal) can only be imposed for a whole deployment by loading `smalltalk-professional-v1`. Proposal: an `instruction kind register` with `text formal|warm|playful` (one more `INSTRUCTION_KINDS` value), giving the turn fact `cv_instruction_active register_formal`, which the register collections' rules can test; and/or a `register` field on `reply`.
  3. **Slots for personalisation.** The owner asked for user name and time of day; the runtime fills only answer, mention, candidate, candidate_description, relations, topics, readings, aside_fact and the instruction slots, and a reply that names another slot fails the turn (`reply_slot_missing`). Proposal: `user_name` (from a stated name in the conversation context) and `time_of_day` (from the server clock) as packet slots, with turn facts `cv_turn_user_name` / `cv_turn_time_of_day ?part` so rules can require them.
  4. **Ties between priorities.** `cv_situation_priority` is an integer and the existing situations use consecutive values (56 to 68), so a variant one above its base can tie with another situation; the choice between tied situations is then arbitrary. Proposal: a tie-break fact (`cv_situation_order A B`) or a numeric priority.
- **Decision:** pending.

## P-3 (2026-10-02): methodological principles found missing by knowledge mining (probably no new wire type)

- **Proposer:** knowledge-mining-agent (`tools/knowledge-mining`, run `eval/reports/current/knowledge-mining/run-100`).
- **Case:** book problem science:291 asks about the design of a fair test. The miner (tier `small`) reported that the needed general principle (vary one factor and hold every other condition constant; a second change at the same time makes the effect unattributable) is "a methodological norm" it could not write as a checkable fact, rule, default or unit. It wrote nothing, as its instructions require. This was the only such report among 109 mined failures (stage 1: 22, stage 2: 87).
- **What the existing types may already express:** a `rule` over predicates of the experiment (`changes_factor ?exp ?f`, `measures_effect_of ?exp ?f`). Two changed factors make the attribution unsupported. In the form `when changes_factor ?e ?f1`, `when changes_factor ?e ?f2`, `when compare ...` (distinct factors), `then not attributable ?e ?f1`. The `norm` type may also fit, and P-1 (claims and their support) covers judging a design. Nobody has tried these yet.
- **Proposal:** none until the rule form has been tried on the case. Record it only if a fair-test question still cannot be written.
- **Decision:** deferred (one case).

## P-4 (2026-10-02): `compute` words `minimum_with` and `maximum_with` (language vocabulary, no new wire type)

- **Proposer and reviewer:** reasoning-cycle agent (Opus), under the owner's standing authorization of 2026-10-02 evening; implemented the same night.
- **Cases:** books run `run-2026-10-02T15-13-00` and the earlier step-by-step runs: 11 of 109 `problem_formulas` answers of the 4B wrote `min(...)`/`max(...)`/`abs(...)` (commonsense:2.1.1 the bottleneck `min(a, b, c, d)` of serial stages; decompose critical paths, where parallel branches join after the longer one; world:713 "additional tokens needed" that cannot be negative). The formula reader dropped those formulas, and the LLMDirect formalizer (tier `small`) was refused for "unknown compute words such as max" (problem-mode.md, blocker 3).
- **Why the existing words do not suffice:** the smaller of two values is expressible today only as two session rules split on a `compare` (`a at_most b` then `a`, `a above b` then `b`), each with its own intermediate predicate. A chained minimum of four stages needs three such pairs and three predicates, and the minimum cannot sit inside the same rule body as the rest of a formula. A small formalizer does not write that.
- **Decision:** two more `compute` words, `?out A minimum_with B` and `?out A maximum_with B`: the smaller or the larger of two numbers (integers or decimals, exact). This is no new wire type and no new field. It only adds two words to `COMPUTE_WORDS` (`sop/enums.mjs`), so the validator, the capability inventory and the router pick them up from the table. They are not integer words, so the router requires `exact_arithmetic`.
- **Engines:** the oracle `js-reference` (`values.mjs`), `z3-smt-bounded` (`solver-common/exact-rational.mjs`), `prolog-tabling` (`runtime.pl` `min`/`max`), and the fixed-point lowering shared by `sql-sqlite`, `datalog-souffle` and `asp-clingo` (two alternatives of the body: a `compare` of the scaled values, then the kept one). Smoke case `94-compute-minimum-maximum`: every engine that declares `exact_arithmetic` passes.
- **Docs and tests:** DS004 "Exact arithmetic" table, DS006 "Exact decimals in the engines", `docs/wire_typs/rule.html` (executed example), the LLMDirect guide `skills/coding-agent-query/guide.md`, `tests/books-reasoning-cycle.test.mjs`, `CHANGES.md`.
- **Left to the formalization improver:** the step-by-step formula reader (`lib/query-author/step-by-step/problem.mjs` `readFormula`) can now map `min(a, b, ...)` and `max(...)` (and `abs(x)` as `x maximum_with (0 minus x)`) to these words. That is protocol work, reported through the journal.

## P-5 (2026-10-03): what the FOL path still cannot map (no new wire type)

- **Proposer:** FOL-repair agent (Opus), from the 30 problems of the A/B of `experiments/proposal/structure-and-formalizer-models.md` §8–10 (outputs of `good` and the MoE `tiny`, `state/moe-ab/moe-ab/`).
- **What the existing types now carry** (`lib/formalize/fol/`, no language change): disjunctive and `IFF` conclusions (rules over explicit negations, open predicates), universals and negated compounds inside conditions (auxiliary session predicates over the problem's own domain), universal questions (`mode every` with `quantifier all`), value rules (a `Value` concluded under conditions), comparisons in rule conditions over the problem's quantities (`compare`, `compute`), and a search for unknowns (the model `constraint` wire with `task possible|prove|optimize`).
- **Gaps found, with the existing workaround:**
  1. *An existential conclusion under a universal* ("every tooth has some shape"): a Skolem function would invent a new thing per binding, and SOP is function-free. Workaround in the converter: keep the part that does not mention the new thing; the dropped part's predicates are open (never refuted). Two of 30 problems wrote one; neither needed it for its answer.
  2. *The best option by a derived value* ("which stage gives the largest gain"): SOP already ranks options by a derived value (DS014 "Problems that state their own data"); the FOL extension has no form for it, and the models wrote an `IFF` with a universal over comparisons. Proposal for the FOL extension, not for SOP: a reserved `Best(x, t, max|min)` lowered to that ranking query. Deferred: one case (commonsense:2.4.4).
  3. *"Does A prove B?"* (world:50, the logic book's argument questions): the honest answer is the derivability of B (`supported` or not), which the yes/no query already gives; the "No" of the book is "not derivable". This is the claim-and-support work of P-1/Q-LANG-10, not a new type.
- **Engine discrepancy found (reasoning work is paused; recorded, not changed):** the strict universal (`mode every` without `quantifier`) answers `supported` over a closed, empty restriction (vacuous truth) in the oracle and in `prolog-tabling`, while DS014 "Question forms" says `supported` needs a member of the restriction. The converter writes `quantifier all`, whose `quantifiedStatus` gives `unknown` for no member. A cnl crash on every strict universal through the Agent (`members` missing from the packet: `reply_slot_missing`) is fixed in `sop/cnl.mjs`.
- **Decision:** no new wire type. Items 1–2 stay converter-level; item 3 waits for Q-LANG-10.
