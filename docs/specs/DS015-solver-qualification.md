---
title: DS015-solver-qualification
summary: Executable common-profile solver qualification and explicit unsupported boundaries.
---

## Scope and reproduction

This qualification compares the inspectable, bounded JavaScript reference reasoning route with SWI-Prolog on function-free Horn queries and with Z3 on integer constraints. `advanced` is the route selector, **not** a fourth independent solver. The cases are typed reasoning requests, not model-generated SOP or a model-quality benchmark. No training, optimization of neural weights, or neural inference is part of this exercise.

From the repository root, regenerate the evidence with the actual optional executables:

```sh
Z3_BIN="$PWD/tools/.solvers/z3/bin/z3" SWIPL_BIN="$PWD/tools/.solvers/swi/swipl" node tools/qualify-solvers.mjs
Z3_BIN="$PWD/tools/.solvers/z3/bin/z3" SWIPL_BIN="$PWD/tools/.solvers/swi/swipl" node --test tests/solver-qualification.test.mjs
```

The first command executed on the prepared ARM64 host and wrote [`eval/reports/current/solvers/qualification.json`](../../eval/reports/current/solvers/qualification.json): SWI-Prolog 9.0.4 and Z3 4.15.8 were available. Each observed cell stores the command, bounded input, result, and where applicable separate elapsed wall-clock observations. Without a binary, that backend's cells are recorded as **skipped**, not as inferred matches. Timings are individual local runs, not statistical latency estimates or a rank. The report's `reference`, `swi`, `z3`, `routing`, and `unsupported` sections are the cell-level evidence; reruns overwrite **current** evidence and can differ in timing or solver cutoff behavior.

## Observed matrix

All rows below refer to the executed command and same-named cells in the linked report; `supported` means derivable from admitted premises, not independently true in the world.

| Common Horn profile | Reference JS | SWI adapter | Qualification boundary |
| --- | --- | --- | --- |
| `recursion` (two-step ancestry) | supported; proof includes both parent premises | supported; closure agrees with JS | SWI computes ground closure; JS reconstructs proof |
| `variables-output` (select descendant) | supported; `bogdan`, `carina` | supported; same bindings | Answer projection is checked, not just status |
| `explicit-negation` | refuted | refuted | Explicit contrary evidence, not negation as failure |
| `time-in-range` / `time-out-of-range` | supported / unknown | supported / unknown | SWI facts are scoped at the explicit query instant |
| `contradiction` | both | both | Contradictory facts do not explode into arbitrary claims |
| `hypothesis` / `defeated-hypothesis` | conditional support / refuted | conditional support / refuted | Admitted hypothesis retains `hypothetical`; contrary fact defeats it |
| `fact-limit` (`maxFacts: 2`) | unknown, incomplete | unknown, incomplete | A truncated closure does not establish the missing derivation; agreement of two truncated *sets* is not a complete-profile proof |

The SWI rows separately record `costMs.nativeClosure` (direct `runSWI` process and compilation), `costMs.jsVerification` (JavaScript closure and proof-oriented reasoner), and `costMs.composedAdapter` (complete `solveHorn` path). The latter is not the sum of the first two independently timed calls. SWI does **not** supply an independent proof: `proofBackend` identifies the JS derivation checked against SWI closure. Completed closure cells assert set agreement; incomplete limit cells report the observed agreement flag but cannot establish equivalence. Reference JS exposes proof IDs and query bindings and uses explicit limits; it is an inspectable **oracle for this declared finite profile**, not an oracle for unobserved facts or unrestricted logic.

| Integer profile | Reference JS | Z3 | Qualification boundary |
| --- | --- | --- | --- |
| `sat-not-entailment` (`x=1` possible in `0..2`) | possible | possible; base, claim, and negated claim all sat | Existence is not entailment |
| `same-claim-not-entailed` | unknown | unknown; both claim and negated claim sat | An arbitrary model is not a proven scalar |
| `entailed` (`x=1` with only `x=1` permitted) | entailed | entailed; negated claim unsat | Countermodel check establishes entailment |
| `unsat-premises` | inconsistent | inconsistent; base unsat | Inconsistent premises do not establish arbitrary claims |
| `non-unique-optimum` (`x+y=2`, maximize `x+y`) | optimal objective 2, scalar `x` ambiguous | optimal objective 2, strictly-better check impossible, scalar `x` ambiguous | Three distinct optimal assignments are present in the finite JS case; no single `x` is licensed |
| `timeout-1ms` (40 binary integers, sum claim) | **incomparable**; not enumerated | unknown, incomplete; base sat, both claim checks unknown on this run | A 1 ms solver bound is not refutation; result remains native Z3, not fallback JS |

`routing.reference-constraint` and `routing.reference-horn` observed JS, `routing.advanced-constraint` observed Z3, and `routing.advanced-horn` observed SWI. An `advanced` automatic constraint request with simulated unavailability used JS and disclosed the Z3 fallback (`routing.advanced-auto-unavailable`); this is not independent Z3 evidence. A direct Z3 request with the executable path intentionally made unavailable returned `unsupported` with backend `z3`, not a JS answer (`routing.explicit-z3-unavailable`).

**Explicitly unsupported / incomparable:** SWI interval queries (only point-time compilation was exercised), SWI numeric constraints, Z3 Horn proofs, and unbounded-integer JS enumeration are marked `unsupported` by observed rejection cells. Cross-family accuracy/latency aggregation is **incomparable**: the domains, proof responsibility, and composed process costs differ. There is no global winner or score.

## Provenance and read-side effects

The report records bounded synthetic inputs and actual backend outputs; it supplies no human validation, review, or real-world ground truth. A separate memory policy can promote an admitted, metadata-verified **observed** premise on real proof use, governed jointly by `policy.reinforce` and memory retention configuration; each such promotion is visible on the reason result. Qualification calls these reasoning backends with local supplied fixtures, not a repository write path, and does not itself exercise persistence or imply that mere query reads promote facts. Hypothetical, local, and non-metadata-verified evidence is not eligible for that promotion.
