---
title: DS000-vision
summary: Purpose, trust boundaries, and research claims for ChatSOP.
---

## Introduction

ChatSOP helps an operator or user turn natural-language requests and assertions into typed [SOP](wiki.html#definition-sop) circuits, execute those circuits against reviewed, time-aware knowledge, and receive an explicit result, evidence, and controlled-language explanation. Its symbolic knowledge and reasoning remain separate from language-model weights.

## Core Content

### Purpose and authority

The [formalizer](wiki.html#definition-formalizer) proposes SOP from a user message; the host validates the circuit, selects the user and permissions, and controls publication of knowledge and executable definitions. The model and a supplied document must not grant their own permissions, install rules or policies, or certify a proof. A [verbalizer](wiki.html#definition-verbalizer) may restate an existing [CNL](wiki.html#definition-cnl) result but must not alter its truth status, provenance, quantities, time, or completeness. The implemented executable profile is `sop-agent-3`; other SOP dialects do not become compatible by sharing a name.

### Distinct information roles

Original documents and traces remain identifiable sources; accepted facts and approved definitions are the premises used by the runtime; patterns and hypotheses are candidate objects, not observations. Source-backed publication requires host review and provenance. Adding approved knowledge need not retrain a model, and retraining does not itself publish a fact or prove a rule. The [memory engine](wiki.html#definition-memory-engine) and [reasoning strategy](wiki.html#definition-reasoning-strategy) are independently selected axes subject to their capability and completeness limits.

`vision/SOP_dataset.docx` establishes the narrow NL question/assertion-to-SOP model task; `vision/SOP_CommonSense_v2.docx` establishes a distinct source-material-to-knowledge loop: extract, generate questions, solve, diagnose, repair, validate, accumulate, and rerun. Quoted source claims, reusable implicit-rule proposals, temporary problem state, and reasoner capabilities must remain separate. A candidate implicit rule is not made global because it repairs one question; executable HARD rules require scoped review, counterexamples, runtime probes and independent authorization. Neither flow establishes a self-modifying production server or automatically accurate small language model.

### Evidence boundaries

An untrained or absent model cannot substantiate conversational quality. A symbolic demonstration or historical report cannot establish neural accuracy, production security, hardware readiness, or comparative superiority. External corpus rights and model weights are not supplied by the source-code license. Publication claims require fixed inputs, observed runs, documented omissions and fallback routes, and independently reviewed evaluation; see [DS008](specsLoader.html?spec=DS008-data-evaluation.md). Work remaining is tracked in `TODO.md`, not asserted as delivered product behavior.

The research direction and publication materials under `article/direction/` are source goals, not peer-reviewed results. Data rights, reproducible run artifacts, independent semantic review, model identity, and backend execution must support every published comparison. Controlled generators, including Luna or another qualified small model, may draft paraphrases only after a representative pilot and cannot make final semantic or architectural judgments; an unexposed generator identity remains unknown.
