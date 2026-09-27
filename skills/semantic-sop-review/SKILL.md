---
name: semantic-sop-review
description: Compare SOP circuits with guarded probes, require an actual LLM review for unresolved differences, and record the principal integrator's final decision
---

# Semantic SOP review

Run from any working directory, always with an explicit `--project-root` (paths passed to flags are relative to that root unless absolute). This is a coding-agent workflow, **not** a model-calling backend, a certificate of human review, or a claim of universal equivalence. The pilot dataset is diagnostic and unqualified for training.

1. Supply a reviewed row JSON, a candidate SOP text file, and optional JSON array of independent discriminating probe worlds (each world may override `setup_sop`, `context`, `ontology_sop`, and `expected`). Probe oracles must be independently established; the baseline gold oracle is never reused on a changed world. Execute:

   `node skills/semantic-sop-review/review.mjs prepare --project-root /project --row row.json --candidate proposed.sop --probes probes.json --bundle reviews/case.bundle.json`

   Omit `--probes` if no other worlds are available. The bundle records source, host ontology, model-input assertions, both complete circuits, independent expected outputs, guarded evaluator observations, hashes, and limitations. It is created exclusively and cannot be overwritten by this CLI. `invalid`, `reference_error`, and `counterexample` are terminal failures for acceptance. A safe alpha-equivalent circuit can be marked `equivalent` only after guarded evaluation; otherwise matching finite results stay `pending`.

2. For `pending`, use an actually available independent LLM reviewer (including a coding-agent model, with its true runtime provenance) to inspect the complete bundle and answer its recorded prompt. Supply its real `{reviewer_kind:"llm",model:{provider,id,version},reviewer_identity,verdict:"equivalent"|"different"|"uncertain",rationale,bundle_sha256,prompt_sha256,context_sha256,reference_sha256,candidate_sha256}` as JSON. Do not invent a network call or pretend that this command invokes one. Execute:

   `node skills/semantic-sop-review/review.mjs record-review --project-root /project --bundle reviews/case.bundle.json --review reviews/reviewer.json --receipt reviews/case.receipt.json`

3. A **separate principal integrator** supplies JSON `{principal_identity,verdict:"accept"|"reject"|"quarantine",rationale,bundle_sha256,receipt_sha256}` (omit `receipt_sha256` when no receipt). Execute:

   `node skills/semantic-sop-review/review.mjs decide --project-root /project --bundle reviews/case.bundle.json --receipt reviews/case.receipt.json --decision reviews/principal.json --out reviews/case.final.json`

   A principal may reject/quarantine without a receipt. Acceptance of pending differences requires an equivalent LLM receipt bound to the exact bundle and a different principal identity. No review can override failed syntax, types, policy, reference setup, or observed counterexample. This CLI records supplied identities but cannot authenticate external model endpoints or attest that a principal is human. Preserve immutable bundle/receipt/decision hashes when reporting provenance. Never use this process to certify training qualification absent source rights and independent dataset audit.
