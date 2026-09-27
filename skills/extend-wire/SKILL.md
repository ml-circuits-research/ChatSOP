---
name: extend-wire
description: Add a typed, approved SOP interpreter
---

# Add a typed, approved SOP interpreter

Read `docs/legacy/requirements/02-runtime.md` and `docs/legacy/requirements/06-backenduri.md`. First try a template using existing wires. If a new type is necessary, define inputs, outputs, types, effects, permissions, and budgets; then add the host handler.

Do not put backend code in LLM output. Translate only a validated AST. Do not use `eval`, `Function`, or `node:vm` as a sandbox. Every new operation in `jsEval` must have an explicit evaluator case and adversarial tests.

Keep users of this functionality distinct: `jsEval` belongs only to the coding-agent workflow with host control and approval, not to the small NL→SOP model's `premise`, `query`, `constraint` targets or training. Complex expressions in `value.data` are not a disguised alternative to declarative formulation. Assess the existing corpus by its `evaluation_track` before using it for training. Today `jsEval` is only a restricted expression interpreter, not full JavaScript; do not promise future full-JavaScript support.

For coding agents, design only reasoning programs with an approved contract, permissions, and explicit limits. The vocabulary may be extended as needed for algorithms, graph search, and collection/graph construction, after approval and implementation, not by assuming these capabilities already exist or silently extending the small formalizer's targets.

After agreeing on and implementing a new host-only contract, update its profile, examples, validation and documentation; keep system-only evaluation separate from the model formalization track. Test failures, ambiguous data, contradictions, and attempts to escalate control through text. If backends do not share semantics, define a portable profile instead of claiming general equivalence.
