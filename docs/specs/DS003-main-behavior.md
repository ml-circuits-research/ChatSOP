---
title: DS003-main-behavior
summary: Five accepted user-impacting behaviors of the ChatSOP runtime.
---

## Introduction

ChatSOP turns user questions and assertions into typed [SOP](wiki.html#definition-sop) circuits and produces checked results from reviewed knowledge. The five components below describe what the local CLI user, host operator, and integrator can observe; lower-level semantics belong to the specialized specifications.

## Core Content

### Main Behavior Components

| Name | Explanation |
| --- | --- |
| Execute typed SOP circuits | A CLI user submits a circuit and receives a validated result, evidence, or a precise rejection. |
| Translate local conversation into checked SOP answers | A locally configured model proposes a circuit; the agent checks and executes it before responding. |
| Publish reviewed knowledge | A host operator admits sourced facts and approved definitions, while model and document text cannot publish them. |
| Preserve isolated temporal knowledge | Users and sessions query and update knowledge with independent temporal history and fork boundaries. |
| Substitute memory and reasoning independently | Integrators change physical memory and reasoning routes without changing the SOP program's meaning. |

### Execute typed SOP circuits

A CLI user invokes `node server/cli.mjs run --file <path>` to execute a typed SOP circuit; `validate --file <path>` checks and canonically prints a program, while `compile-smt` and `compile-prolog` export their supported typed subsets. The parser, scheduler, [linker](wiki.html#definition-linker), reasoner, and [CNL](wiki.html#definition-cnl) output make the result and its evidence visible. `@id` declares a wire, `$id` consumes its value, `~id` identifies a definition, and `?x` denotes a local logical unknown; result output can bind a generated wire after solving. Invalid fields, unresolved dependencies, and unauthorized effects cannot be treated as successful execution. See [DS004](specsLoader.html?spec=DS004-sop.md).

### Translate local conversation into checked SOP answers

A local CLI user invokes `chat` with a configured model endpoint to ask a question or supply an assertion. The [agent](wiki.html#definition-agent) asks the [formalizer](wiki.html#definition-formalizer) for SOP, checks the proposal and permitted actions, runs the circuit, and returns a controlled-language answer; [verbalization](wiki.html#definition-verbalizer) is optional and cannot certify an unsupported result. The model endpoint, adapter availability, and model quality are separate requirements: neither the CLI path nor source templates prove the existence of trained weights or neural accuracy. The inference adapter is not a complete OpenAI-compatible ChatSOP server. See [DS007](specsLoader.html?spec=DS007-training.md).

### Publish reviewed knowledge

A host operator publishes reviewed facts and executable definitions through authorized ingestion, with quoted sources and hashes when required. Source documents and model suggestions may provide proposals, but neither can install a rule, policy, procedure, or ontology update through generated text alone. A published claim retains its provenance and validity conditions; approval is not a claim that a source is infallible. See [DS004](specsLoader.html?spec=DS004-sop.md) and [DS005](specsLoader.html?spec=DS005-memory.md).

### Preserve isolated temporal knowledge

A host or CLI user uses `init`, `fork`, `commit`, `discard`, `stats`, `maintain`, and `gc` to manage reviewed knowledge and private changes. The [repository](wiki.html#definition-repository) keeps users, sessions, and forks separate, distinguishes time a claim is valid from when it became known, and preserves corrections, retractions, and referenced snapshots. `gc` reports candidates without `--apply`; applying it must not discard snapshots still referenced by users, sessions, or forks. A missing retrieved premise is not proof of negation, and retention can affect answer completeness. See [DS005](specsLoader.html?spec=DS005-memory.md).

### Substitute memory and reasoning independently

An integrator selects `memory.engine` and `policy.reasoningStrategy` independently in a runtime profile and executes the same SOP against the selected providers. Exact or associative retrieval changes completeness and cost, while the reference JavaScript strategy and optional SWI-Prolog/Z3 routes have different supported reasoning domains. The observable route and fallback must be reported: `advanced` falling back to JavaScript is not a separate solver run, and an approximate retrieval score is not probability or proof. See [DS005](specsLoader.html?spec=DS005-memory.md) and [DS006](specsLoader.html?spec=DS006-reasoning.md).
