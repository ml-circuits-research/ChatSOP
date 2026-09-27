---
title: DS024-small-language-scope
summary: What the small declarative language may describe, why the three agreed constructs suffice, and the conservative checklist for any future construct.
---

# DS024 — Small-language scope and construct proposals

The small language exists for one job: turning a user's question, together with the assertions attached to that question, into a **description of a problem**. It is not an action language, not a planning language and not an advice channel. Everything a user could mistake for a suggestion is either a host decision or an explicit refusal.

## What the small model may author today

Exactly three wire types, enforced in `sop/declarative.mjs` (`MODEL_TYPES`) and re-checked at admission in `server/agent.mjs` and `eval/run.mjs`:

| Construct | What the model states | Why it is a problem description |
| --- | --- | --- |
| `premise` | A conditional assumption (`holds`, optional `valid`) interpreted from this turn | States what the problem *assumes*; it records nothing, proves nothing and is kept only as attributed conversation context |
| `query` | A logical goal (`where` atoms or `all`/`any` groups, optional `select`, time qualifiers, `limit`, `filter`) | States what is being asked; identification and reasoning remain host work |
| `constraint` | A finite integer problem (`var`, `require`, `claim`, `task`, optional `objective`/`direction`/`unit`, `select`) | States the variables, restrictions and claim to be decided |

Everything else — `resolve`, `pack`, `solve`, `reason`, `cnl`, `remember`, `clarify`, `expand`, `jsEval`, definitions such as `rule`/`template`/`procedure`/`policy`, and the reasoning objects — belongs to the host or to trusted tool circuits, and is generated or supplied with recorded provenance.

## Explicit non-goals

1. **No execution.** The model never chooses an engine, a backend, a retrieval strategy or a definition handle. `dependencies(...).handles` must be empty for model output.
2. **No writes.** A `premise` is never recorded; a sourced `fact` and an explicit trusted `remember` are separate, host-authorized operations.
3. **No advice, recommendations or action proposals.** If a user asks "what should I do?", the admissible outcomes are: formalize the underlying decidable question, return a host clarification when a required identity or scalar is missing, or return `unsupported` when no audited interpreter exists. Presenting guidance that the runtime did not compute is forbidden, because the CNL layer renders results, it does not invent them.
4. **No procedure selection.** The model cannot pick or parameterize template/procedure handles; expansion is host-approved and audited.
5. **No new vocabulary by decree.** An unknown predicate or entity is either resolved from the host shortlist or rejected, never silently invented.

## Is the current construct set sufficient?

Yes, for every family whose interpreter exists and is validated in this repository: relation/role and argument reversal, multi-hop composition, joins, explicit negation and conflict, open-world absence, temporal windows and cutoffs, scoped synonym resolution, finite numeric constraints and optimization, clarification of missing/ambiguous dependencies, conditional-session-write targets, approved-procedure reuse, and expression composition. The evidence lives in `datasets/query-v2/manifest.json` family matrix, `eval/suites/*`, and the executed golds reported by `tools/datasets/validate.mjs`.

The families that remain **blocked** stay blocked deliberately (see the corpus manifest `blocked_families`): abduction, default-with-exception, counterfactual, planning, causal, agentive intention, and general quantification. For each of them the reason is the same in substance: this repository has no audited interpreter plus independent oracle for the construct yet, so the honest outcome is `unsupported`, not a hard rule or a guess.

## Conservative checklist for a future construct

A new model-authorable construct is admissible only when **all** of the following hold. Until then it stays a proposal in this document, never in the parser.

1. **Problem-shaped.** It states something about the problem (a fact pattern, a question, a restriction), never a procedure, action, preference or suggestion.
2. **Host-evaluable.** An audited interpreter exists that decides the construct without inventing meaning, and it reports status, completeness and route.
3. **Independently oracle-able.** A second, independent reference can produce the expected result for the corpus, so the corpus never confirms itself.
4. **Non-writing.** The construct cannot change memory; any write stays a separate trusted operation.
5. **Refusal-capable.** When the construct's interpreter is absent, the runtime returns `unsupported` with a reason, and the model cannot force a fallback.
6. **Reviewable.** The field set, cardinality, canonical form and rejection cases are documented in the wire reference, with valid and invalid examples that the help-page checks execute.

## Proposals considered (NOT implemented)

These are recorded so the boundary is explicit; none of them is accepted, and none may be used by a model until the checklist above is satisfied and a specification amendment is accepted.

| Proposal | What it would let the model describe | What must exist first | Status |
| --- | --- | --- | --- |
| Defeasible assumption block (`assumption` with named exceptions) | A default-with-exception problem, still as a description | An audited defeasible reasoner, a scope policy, and a judged oracle for exceptions | PROPOSED; currently `unsupported` and `default_exception` stays blocked |
| Bounded universal question over a declared finite domain | An explicitly closed-domain universal question, e.g. "for every unit in this declared set" | Finite-domain evaluator with an explicit closure declaration and an independent enumeration oracle | PROPOSED; `general_quantification` stays blocked because a finite fact list never implies a closed world |
| Goal-shaped question (a desired state asked about, not planned) | A question about whether a state is reachable under approved actions | Approved action model and a planning oracle, with actions still authored only by trusted circuits | PROPOSED; `planning` stays blocked |
| Advice/intent phrasing ("what should I do?", "recommend") | Nothing: this is not a problem description | — | REJECTED by design; formalize the underlying question, clarify, or return unsupported |

## Rejected in this session

- Letting the model choose `select` targets that hide ambiguity: `select` requests a checked scalar, and an ambiguous requested value produces host clarification even when the claim is entailed.
- Letting the model mark a premise as a sourced fact or attach documentary provenance to an interpretation.
- Letting the model emit `clarify` directly: clarification is a host instruction derived from an unresolved dependency, so it cannot be a model opinion about needing more input.
