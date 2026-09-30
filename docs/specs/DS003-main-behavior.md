---
title: DS003-main-behavior
summary: Six accepted user-impacting behaviors of the ChatSOP runtime, including the canonical CLI command list.
---

## Introduction

ChatSOP turns user questions and assertions into typed [SOP](wiki.html#definition-sop) circuits and produces checked results from reviewed knowledge. The six components below describe what the local CLI user, host operator, and integrator can observe; lower-level semantics belong to the specialized specifications.

## Core Content

### Main Behavior Components

| Name | Explanation |
| --- | --- |
| Execute typed SOP circuits | A CLI user submits a circuit and receives a validated result, evidence, or a precise rejection. |
| Translate local conversation into checked SOP answers | A locally configured model proposes a circuit; the agent checks and executes it before responding. |
| Publish reviewed knowledge | A host operator admits sourced facts and approved definitions, while model and document text cannot publish them. |
| Preserve isolated temporal knowledge | Users and sessions query and update knowledge with independent temporal history and fork boundaries. |
| Substitute memory and reasoning independently | Integrators change physical memory and reasoning routes without changing the SOP program's meaning. |
| Follow project work and evaluation | An administrator reads the project journal, preregistered experiments and evaluation reports through the local server pages. |

### Execute typed SOP circuits

A CLI user invokes `node server/cli.mjs run --file <path>` to execute a typed SOP circuit; `validate --file <path>` checks and canonically prints a program, while `compile-smt` and `compile-prolog` export their supported typed subsets. The parser, scheduler, [linker](wiki.html#definition-linker), reasoner, and [CNL](wiki.html#definition-cnl) output make the result and its evidence visible. `@id` declares a wire, `$id` consumes its value, `~id` identifies a definition, and `?x` denotes a local logical unknown; result output can bind a generated wire after solving. Invalid fields, unresolved dependencies, and unauthorized effects cannot be treated as successful execution. See [DS004](specsLoader.html?spec=DS004-sop.md).

### Translate local conversation into checked SOP answers

A local CLI user invokes `chat` with a configured model endpoint to ask a question or supply context. The [formalizer](wiki.html#definition-formalizer) sees only the user's message and proposes only declarative `stated`, `assumed`, `unclear`, `query`, or `constraint` SOP written with quoted strings ([DS021](specsLoader.html?spec=DS021-model-surface.md)); it never refuses, and marks a message `unclear` only as `gibberish` or `no_request`; statements and assumptions are turn-local string reports, not sourced user assertions or repository writes. A separate host-approved layer compiles an inspectable circuit for identity lookup, reasoning and rendering. When identity is missing/ambiguous or a required scalar is missing/nonunique, symbolic orchestration generates a `clarify` wire and suspends dependent work; lack of supporting knowledge by itself is not a request for user clarification. The [agent](wiki.html#definition-agent) checks the proposal and permitted actions, runs the circuit, and returns a controlled-language answer; [verbalization](wiki.html#definition-verbalizer) is optional and cannot certify an unsupported result. An execution metaprogram cannot guess ambiguous identity, promote statements or assumptions into stored facts, or infer publication authority. Explicit sourced `fact` and `remember` remain available to trusted runtime/tool callers separately from model-origin circuits. The model endpoint, adapter availability, and model quality are separate requirements: neither the CLI path nor source templates prove the existence of trained weights or neural accuracy. The local server exposes the same agent through an OpenAI-compatible chat façade ([DS012](specsLoader.html?spec=DS012-local-server.md)). See [DS007](specsLoader.html?spec=DS007-training.md).

### Publish reviewed knowledge

A host operator publishes reviewed facts and executable definitions through authorized ingestion, with quoted sources and hashes when required. Source documents and model suggestions may provide proposals, but neither can install a rule, policy, procedure, or ontology update through generated text alone. A published claim retains its provenance and validity conditions; approval is not a claim that a source is infallible. See [DS004](specsLoader.html?spec=DS004-sop.md) and [DS005](specsLoader.html?spec=DS005-memory.md).

### Preserve isolated temporal knowledge

A host or CLI user uses `init`, `fork`, `commit`, `discard`, `stats`, `maintain`, and `gc` to manage reviewed knowledge and private changes. The [repository](wiki.html#definition-repository) keeps users, sessions, and forks separate, distinguishes time a claim is valid from when it became known, and preserves corrections, retractions, and referenced snapshots. `gc` reports candidates without `--apply`; applying it must not discard snapshots still referenced by users, sessions, or forks. A missing retrieved fact is not proof of negation, and retention can affect answer completeness. See [DS005](specsLoader.html?spec=DS005-memory.md).

### Substitute memory and reasoning independently

An integrator selects `memory.engine` and `policy.reasoningStrategy` independently in a runtime configuration and executes the same SOP against the selected providers. Exact or associative retrieval changes completeness and cost, while the reference JavaScript strategy and optional SWI-Prolog/Z3 routes have different supported reasoning domains. The observable route and fallback must be reported: `advanced` falling back to JavaScript is not a separate solver run, and an approximate retrieval score is not probability or proof. See [DS005](specsLoader.html?spec=DS005-memory.md) and [DS006](specsLoader.html?spec=DS006-reasoning.md).

### CLI commands

This section is the canonical command list; `docs/runtime.html` links here instead of repeating it. `node server/cli.mjs help` prints the same list.

| Command | Effect |
| --- | --- |
| `init [--base demo]` | Publishes the reviewed bootstrap fixture (`tests/fixtures/bootstrap.sop`) as a base snapshot. |
| `run --file <path> [--base --user --session --now --json]` | Executes a typed SOP circuit against the selected session. |
| `validate --file <path>` | Parses, validates and canonically prints a program without executing it. |
| `compile-smt --file <path>`, `compile-prolog --file <path>` | Export the supported typed subset of a constraint or Horn program. |
| `lexicon --text <text>` | Prints host lexicon candidates for a text; this is host linking support, not model input. |
| `chat [--cnl-only]` | Interactive local conversation through the configured model endpoint and the agent. |
| `fork --from <base> --to <base>`, `checkpoint-base` | Repository fork and base checkpoint. |
| `commit`, `discard`, `stats`, `maintain`, `migrate`, `close-session`, `decay --steps <n>` | Session lifecycle, retention maintenance and statistics. |
| `gc [--apply]` | Reports unreferenced snapshots; deletes them only with `--apply`. |

### Follow project work and evaluation

`npm start` serves the local site (default `0.0.0.0:9999`). After administrator sign-in, `/audit` is the visual corpus audit ([DS020](specsLoader.html?spec=DS020-corpus-audit-tool.md)), `/eval` browses corpora, sealed suites, predictions and current reports with the evaluation guide at `/eval/guide`, and `/experiments` shows the append-only journal `status/journal.jsonl` and the preregistered experiments of `status/experiments.json` ([DS010](specsLoader.html?spec=DS010-experiment-preregistration.md)). These pages read existing artifacts; they never train a model, and a journal entry or report is a record of work, not a current measurement unless it says so. See [DS012](specsLoader.html?spec=DS012-local-server.md).
