---
title: DS006-reasoning
summary: Linked premises, independently selected reasoning strategies, and explicit solver routing.
---

## Introduction

A user submits a checked [SOP](wiki.html#definition-sop) query to receive a supported result with its premises, route, and completeness information. The [linker](wiki.html#definition-linker) selects applicable approved definitions and retrieves relevant facts before a reasoner solves a typed problem; external solvers do not discover missing rules in associative storage.

## Core Content

### Strategy contract

`policy.reasoningStrategy` selects `reference` or `advanced`, independently of `memory.engine`. `reference` uses bounded JavaScript methods for supported Horn deduction and finite integer constraints. `advanced` may route suitable Horn work to SWI-Prolog and suitable numeric constraints or optimization to Z3 when available; remaining methods use audited JavaScript controllers. A route must expose the backend actually used and any fallback. An `advanced` request handled by JavaScript does not count as an independent SWI or Z3 experiment. Unavailable optional solvers do not justify reporting their execution.

### Premises, alternatives, and unsupported cases

Only admitted facts/observations and applicable reviewed rules support ordinary deduction. A hypothesis, pattern, trace, plan, analogy, or satisfiable constraint is not automatically an observed premise or proven conclusion. Abduction proposes explanations; diagnosis proposes discriminating tests; bounded induction and analogy retain candidate status; planning and what-if simulation do not mutate historical facts. Unsupported dialects and mixed constraints needing an explicit stage are reported rather than silently dropping requirements. Retrieval cutoff or incomplete search must remain visible in the result, especially before uniqueness, negation, or count claims. A solver route proves only a consequence of its admitted premises and declared search domain, not the ground truth of those premises.

### Evidence for comparison

Run fixed SOP and fixed approved premises when comparing reasoners; change only the selected reasoning route and record actual execution, answer, proof, cutoff, latency, and unavailable routes. Compare Horn-common semantics with SWI and supported constraint semantics with Z3 separately. This requirement does not assert the external binaries are installed or that every reasoning operation is supported by both.

### Assumption defeat across routes

Assumption handling is part of the shared Horn profile, not a route-specific extra: the reference JS reasoner and the SWI adapter both admit a declared assumption only while no admitted fact or rule-derived conclusion supports the explicit contrary atom, and both keep the same answer, proof and `hypothetical` marker for the same inputs. The adapter therefore filters defeated assumptions with the same rule before compiling SWI input, and its closure-agreement check still guards backend divergence. A result that touches a kept assumption stays conditional; the reasoner never promotes it to an unconditioned support, and no fallback route may restore a defeated assumption. Defeat is atom-level and evidence-scoped: an assumption about one atom does not suppress derivations of unrelated atoms, and the reasoner reports the defeated assumption identifiers for audit instead of silently discarding them.

On the prepared ARM64 host, private Z3 4.15.8 and SWI-Prolog 9.0.4 executables were acquired with pinned package/release hashes and licenses under ignored `tools/.solvers/`; no system package installation or global PATH change was made. Select them explicitly with `Z3_BIN` and `SWIPL_BIN`. `tools/check-solvers.mjs` and optional conformance checks honor those same variables. SWI's private extraction additionally requires the distribution's autoload-index bootstrap, recorded in its manifest.

Actual bounded probes observed JS and Z3 both derive the unique numeric output 840 with no fallback, and JS and SWI both retain conditional support under an explicit hypothesis. The latter reproduced and fixed an adapter bug: merging assumptions into SWI's input facts had erased the returned `hypothetical` marker. SWI computes its closure, while the adapter checks closure agreement and reconstructs proof with JS; report that composed cost and do not claim an independent SWI proof. These probes are not a broad solver benchmark or model evaluation.
