> ARCHIVED 2026-09-28 — extracted from DS024-small-language-scope (merged into the model-surface spec). Historical register, not a current contract.

## Proposals considered

These are recorded so the boundary is explicit.

| Proposal | What it would let the model describe | What must exist first | Status |
| --- | --- | --- | --- |
| User statements separated from model additions (`stated`, `assumed`), context-free strings, `unclear` | Who asserted what, suppositions, reported speech, the model's own additions | Host linking, turn-local facts, conditional use of suppositions, reporting | IMPLEMENTED ([DS041](specsLoader.html?spec=DS041-stated-assumed-unclear.md)) |
| Defeasible assumption block (`assumption` with named exceptions) | A default-with-exception problem, still as a description | An audited defeasible reasoner, a scope policy, and a judged oracle for exceptions | PROPOSED; the model already formalizes a default as `assumed` with `basis default`; engine handling undecided |
| Bounded universal question over a declared finite domain | An explicitly closed-domain universal question, e.g. "for every unit in this declared set" | Finite-domain evaluator with an explicit closure declaration and an independent enumeration oracle | PROPOSED; engine handling undecided (a finite fact list never implies a closed world) |
| Goal-shaped question (a desired state asked about, not planned) | A question about whether a state is reachable under approved actions | Approved action model and a planning oracle, with actions still authored only by trusted circuits | PROPOSED; engine handling undecided |
| Advice/intent phrasing ("what should I do?", "recommend") | Nothing new: the model formalizes the underlying question | — | REJECTED as a construct; the question is formalized, the host clarifies or reports it as not computable |

## Rejected in this session

- Letting the model choose `select` targets that hide ambiguity: `select` requests a checked scalar, and an ambiguous requested value produces host clarification even when the claim is entailed.
- Letting the model mark an interpretation as a sourced fact or attach documentary provenance to it.
- Letting the model emit `clarify` directly: clarification is a host instruction derived from an unresolved link or dependency, so it cannot be a model opinion about needing more input. The model's `unclear` is different: it reports only that the message is unintelligible or contains no statement or question, and the host answers with a fixed reply.
- Letting the model see a vocabulary shortlist or write canonical identifiers: the model has no context, and identity is host work.
