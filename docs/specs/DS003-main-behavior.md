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
| Translate local conversation into checked SOP answers | The step-by-step formalizer asks short questions about the message (answered by proxy tiers, smallest first) and assembles a circuit; the validator, the runtime and the reasoning strategy check and execute it before the answer is rendered. |
| Publish reviewed knowledge | An operator admits sourced facts and approved definitions, while model and document text cannot publish them. |
| Preserve isolated temporal knowledge | Users and sessions query and update knowledge with independent temporal history and fork boundaries. |
| Substitute memory and reasoning independently | Integrators change physical memory and reasoning routes without changing the SOP program's meaning. |
| Follow project work and evaluation | An administrator reads the project journal, preregistered experiments and evaluation reports through the local server pages. |

### Execute typed SOP circuits

A CLI user invokes `node server/cli.mjs run --file <path>` to execute a typed SOP circuit; `validate --file <path>` checks and canonically prints a program, while `compile-smt` and `compile-prolog` export their supported typed subsets. The parser, scheduler, [linker](wiki.html#definition-linker), reasoner, and [CNL](wiki.html#definition-cnl) output make the result and its evidence visible. `@id` declares a wire, `$id` consumes its value, `~id` identifies a definition, and `?x` denotes a local logical unknown; result output can bind a generated wire after solving. Invalid fields, unresolved dependencies, and unauthorized effects cannot be treated as successful execution. See [DS004](specsLoader.html?spec=DS004-sop.md).

### Translate local conversation into checked SOP answers

A local CLI user invokes `chat`, which runs the product chain (the query author, validation, linking, execution) to ask a question or supply context. The formalizer is step by step (owner decision 2026-10-02): the system asks short questions about the user's message and the vocabulary of the memory, a proxy tier answers them (the ladder `tiny`, `small`, `good`, escalated per question only when an answer cannot be read), and the system assembles only circuits: `query` and `constraint` wires, `unclear` and `unparsed` reports and `stated` suppositions of the message; `assumed` session definitions and assumptions are planned ([DS014](specsLoader.html?spec=DS014-model-surface.md)). The answering model never writes SOP, an answer or a fact, and a statement or assumption is a turn-local string report, not a sourced user assertion or a repository write. The validator admits the circuit or the strategy re-asks the doubtful question in bounded rounds; a separate layer links the strings to the memory and compiles an inspectable circuit for identity lookup, reasoning and rendering. When identity is missing or ambiguous or a required scalar is missing or nonunique, symbolic orchestration generates a `clarify` wire and suspends dependent work; lack of supporting knowledge by itself is not a request for user clarification. The [agent](wiki.html#definition-agent) checks the circuit and permitted actions, runs it, and returns a deterministic English controlled-language answer; no model verbalizer is called. When the first tier of the ladder is not available the turn is answered with an honest `parse_unavailable`; no other parser runs. An execution metaprogram cannot guess ambiguous identity, promote statements or assumptions into stored facts, or infer publication authority. Explicit sourced `fact` and `remember` remain available to trusted runtime and tool callers separately from model-origin circuits. The local server exposes the same agent through an OpenAI-compatible chat façade ([DS009](specsLoader.html?spec=DS009-local-server.md)).

### Publish reviewed knowledge

An operator publishes reviewed facts and executable definitions through authorized ingestion, with quoted sources and hashes when required. Source documents and model suggestions may provide proposals, but neither can install a rule, policy, procedure, or ontology update through generated text alone. A published claim retains its provenance and validity conditions; approval is not a claim that a source is infallible. See [DS004](specsLoader.html?spec=DS004-sop.md) and [DS005](specsLoader.html?spec=DS005-memory.md).

### Preserve isolated temporal knowledge

A CLI user or operator uses `init`, `fork`, `commit`, `discard`, `stats`, `maintain`, and `gc` to manage reviewed knowledge and private changes. The [repository](wiki.html#definition-repository) keeps users, sessions, and forks separate, distinguishes time a claim is valid from when it became known, and preserves corrections, retractions, and referenced snapshots. `gc` reports candidates without `--apply`; applying it must not discard snapshots still referenced by users, sessions, or forks. A missing retrieved fact is not proof of negation, and retention can affect answer completeness. See [DS005](specsLoader.html?spec=DS005-memory.md).

### Substitute memory and reasoning independently

An integrator selects `memory.engine` and `policy.reasoningStrategy` independently in a runtime configuration and executes the same SOP against the selected providers. Exact or associative retrieval changes completeness and cost, while the reference strategy (the `js-reference` oracle) has a supported reasoning domain; a wire that names an external backend maps to that backend's strategy id or returns `unsupported` with the backend named and `fallback: null` (rule 8). The observable route and fallback must be reported: a JavaScript result is never a Prolog or Z3 run, and an approximate retrieval score is not probability or proof. See [DS005](specsLoader.html?spec=DS005-memory.md) and [DS006](specsLoader.html?spec=DS006-reasoning.md).

### CLI commands

This section is the canonical command list; `docs/runtime.html` links here instead of repeating it. `node server/cli.mjs help` prints the same list.

| Command | Effect |
| --- | --- |
| `init [--base demo]` | Publishes the reviewed bootstrap fixture (`tests/fixtures/bootstrap.sop`) as a base snapshot. |
| `run --file <path> [--base --user --session --now --json]` | Executes a typed SOP circuit against the selected session. |
| `validate --file <path>` | Parses, validates and canonically prints a program without executing it. |
| `compile-smt --file <path>`, `compile-prolog --file <path>` | Export the supported typed subset of a constraint or Horn program. |
| `lexicon --text <text>` | Prints the lexicon candidates for a text; linking support for inspection. |
| `chat [--cnl-only]` | Interactive local conversation through the product chain (query author, validator, linking, execution); the answer is the deterministic controlled-language text. It needs the first tier of the formalizer's ladder. |
| `fork --from <base> --to <base>`, `checkpoint-base` | Repository fork and base checkpoint. |
| `commit`, `discard`, `stats`, `maintain`, `migrate`, `close-session`, `decay --steps <n>` | Session lifecycle, retention maintenance and statistics. |
| `gc [--apply]` | Reports unreferenced snapshots; deletes them only with `--apply`. |

### Follow project work and evaluation

`npm start` serves the local site (default `0.0.0.0:9999`). After administrator sign-in, `/eval` browses sealed suites, predictions and current reports with the evaluation guide at `/eval/guide`, and `/experiments` shows the append-only journal `status/journal.jsonl` and the preregistered experiments of `status/experiments.json` ([DS007](specsLoader.html?spec=DS007-experiment-preregistration.md)). These pages read existing artifacts; they never train a model, and a journal entry or report is a record of work, not a current measurement unless it says so. See [DS009](specsLoader.html?spec=DS009-local-server.md).
