---
name: extend-wire
description: Add a typed, approved SOP interpreter
---

# Add a typed, approved SOP interpreter

Read `docs/legacy/requirements/02-runtime.md` and `docs/legacy/requirements/06-backenduri.md`. First try a template using existing wires. If a new type is necessary, define inputs, outputs, types, effects, permissions, and budgets; then add the host handler.

Do not put backend code in LLM output. Translate only a validated AST. Do not use `eval`, `Function`, or `node:vm` as a sandbox. Every new operation in `jsEval` must have an explicit evaluator case and adversarial tests.

Keep users of this functionality distinct: `jsEval` belongs only to the coding-agent workflow with host control and approval, not to the small NL→SOP model's targets or training. Complex expressions in `value.data` are not a disguised alternative for the small formalizer. Its priority is reliable simple SOP, evaluated separately from full ChatSOP; the existing corpus may violate this profile and remains pending migration/review, without regenerating data/tests or training before agreement on the syntax. Today `jsEval` is only a restricted expression interpreter, not full JavaScript; do not promise future full-JavaScript support.

For coding agents, design only reasoning programs with an approved contract, permissions, and explicit limits. The vocabulary may be extended as needed for algorithms, graph search, and collection/graph construction, after approval and implementation, not by assuming these capabilities already exist or silently extending the small formalizer's targets.

After agreement on the relevant syntax/profile and implementation, update the profile/version, examples, validation of the affected dataset, and documentation; do not regenerate the small formalizer corpus now. Test failures, ambiguous data, contradictions, and the inability of text to escalate control. If backends do not share semantics, define the portable profile instead of claiming general equivalence.
