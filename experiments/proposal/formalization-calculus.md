# Research proposal: formalization of problems as an object of study

Owner proposal, 2026-10-02 night. Status: on the experiment list; partly tested through the running experiments listed at the end.

## Problem

No framework turns a problem stated in natural language systematically into a verifiable formal representation while keeping explicit what remains unformalized.

## Question

Is there a finite set of universal formalization operators that, applied iteratively, turn broad classes of problems into partially verifiable formal representations?

## Central idea

Formalization is not translation. It is an iterative process of decomposition, abstraction, introduction of latent variables and detection of semantic gaps. Its result is a partial formalization in which the unresolved semantics is marked explicitly.

## Key distinction

A universal formalizer is not a universal solver. Formalizing correctly means being able to say "80% is formalized; the rest needs clarification or domain knowledge". A partial failure is a valid result, not an error.

## Contribution

A formalization calculus: operators, verification criteria, and a way to report the degree of formalization. It is not a universal algorithm; it is a framework testable on restricted classes of problems.

## Why it matters

Current neuro-symbolic work treats solving. Formalization itself, as an explicit and measurable process, remains unexplored. The starting set of operators should be minimal and domain-independent: decomposition (goal, part, temporal, causal), abstraction (generalization, specialization), introduction of variables, gap detection (abduction) and verification (consistency, counterexample). Goal-based decomposition is foundational in the literature: a problem space is states plus transition operators, and reduction structures formalize recursive decomposition with sound composition.

## Proposed operators

| Group | Operator | Effect |
|---|---|---|
| Decomposition | DECOMPOSE-GOAL | goal → subgoals |
| | DECOMPOSE-PART-WHOLE | system → components |
| | DECOMPOSE-TEMPORAL | process → stages |
| | DECOMPOSE-CAUSAL | effect → possible causes |
| Abstraction | GENERALIZE | concepts → category |
| | SPECIALIZE | category → instances |
| Introduction | INTRODUCE-VARIABLE | implicit quantity → explicit variable |
| | INTRODUCE-CONSTRAINT | unstated restriction → formula |
| Gap detection | ABDUCT | observation without explanation → latent hypotheses |
| Verification | CHECK-CONSISTENCY | satisfiability of fragments |
| | FIND-COUNTEREXAMPLE | a case that invalidates the formalization |

These cover the CEGIS cycle: proposal (decomposition, introduction) → verification → refinement. Cases, quantification and grounding are specializations or combinations of these; empirical testing will show which operators are missing.

## How it is tested in ChatSOP

| Element of the proposal | Running or planned experiment | Evidence so far |
|---|---|---|
| Operators as a closed, domain-independent set; coverage by composition | Method-library phase 1 (`experiments/proposal/formalization-machine-phase1.md`): ≤30 goal types, ≤50 methods, held-out sections, preregistered support and invalidation thresholds | running |
| Degree of formalization reported, partial result as success | Variant C, semantic obligations (`formalized k%`, unresolved obligations, one targeted clarification) in `experiments/proposal/formalization-research-directions.md` | running |
| CHECK-CONSISTENCY, FIND-COUNTEREXAMPLE | Dual / N-way formalization with engine-checked agreement and perturbation counterexamples (`lib/formalize/dual-check.mjs`) | when two independent formalizations agree, 35/36 answers are correct (99 book problems, `tiny`); perturbation caught programs right only by accident |
| INTRODUCE-VARIABLE | The registry (`lib/formalize/registry.mjs`, v1..vn, e1..ek) and the expression programs over it | in use |
| ABDUCT | `abduce` with consistency checking on the product path; Q-LANG-10 (`candidate`, `mode effect`, abduce over candidates), approved and postponed until the formalization focus ends | partial |
| DECOMPOSE-* | Stage A–D typed sub-goal tree (`experiments/proposal/semantic-decomposition-protocol.md`) | stage A running |

**Measures that would answer the question.** Over stratified book samples with held-out sections, report:
- the fraction of problems reduced to executable primitives by composing the operators;
- the growth of the operator and method set against coverage (does it saturate?);
- the share of each terminal status (SOLVED, PARTIALLY_FORMALIZED with k%, AMBIGUOUS, MISSING_INFORMATION, MISSING_CONCEPT, MISSING_METHOD, UNSUPPORTED_PRIMITIVE, CONTRADICTORY);
- the precision of "formalized" claims.
