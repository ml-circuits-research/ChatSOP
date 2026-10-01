# Coding-agent skills

These files describe working procedures, not automatically loaded executable plugins. Read `AGENTS.md` and then the relevant skill. **Training is prohibited until the owner gives a new explicit approval** (AGENTS.md rule 3); no skill grants it. Open owner decisions go to the root `questions.md` (in Romanian). The project directory remains the workspace; source and code approvals are separate decisions.

**Project journal.** Every skill that starts, finishes or blocks a meaningful task, or records an owner decision, logs it with `node tools/journal.mjs add --area … --title … --detail …` into the append-only `status/journal.jsonl`; experiment records go to `status/experiments.json`. Meaningful analyses, suggestions, results and decisions are also appended as topic notes with `node tools/notes.mjs add --topic … --kind … --title … --body …` (append-only; corrections use `--supersedes`). The owner follows all of it on the server's `/experiments` pages, the living index. The training-rules, training-runbook, night-orchestration, corpus-audit and evaluate-agent skills state this explicitly.

## Procedural skills (with `SKILL.md`)

**compare-memory** — Compare memory strategies without changing the semantic task.
**corpus-audit** — Run and triage the machine corpus audit (`tools/datasets/audit-corpus.mjs`): fail-closed invariants plus semantic faithfulness, context triviality, diversity and template-level leakage against the sealed test; reports in `eval/reports/current/corpus-audit/`. The visual audit page has one tab per dataset (`bad_english`, `symbolic_english`, `neuro_english`) plus a secondary archive / sources tab (DS020).
**evaluate-agent** — Audit the complete agent experiment: the current chain (textToCleanEnglish, SymbolicLM, host linking; the symbolic regression, composed metrics and smoke-reasoning) and the whole-system track; the FormalizerLLM track on `formalizer-v1` and `formalizer-ood-v1` is archive, with counts, `not_computable` and `unsupported` kept apart.
**extend-reasoning** — Implement and compare a reasoning strategy.
**extend-wire** — Add a typed, approved SOP interpreter.
**ingest-sop** — Ingest documents into sourced SOP facts.
**lexicon-curation** — Curate multilingual aliases and canonical IDs.
**link-circuit** — Review and compose an SOP circuit that the runtime can link.
**manage-shards** — Maintain local generations, retention, copy-on-write snapshots, migration and safe garbage collection.
**material-to-sop** — Prepare source material, inspect quoted claims, design a question curriculum, diagnose observed failures, and gate candidate SOP rules through scoped probes and authorized review.
**mine-patterns** — Generate and validate candidate patterns from traces.
**omp-run** — Run the omp coding agent non-interactively on a temporary folder: model discovery with a cost class (`GET /v1/omp/models`), the fence (cwd, read/write/edit tools only, no profile extensions or skills, secrets never in prompts), a timeout, cost read from the session files, and the validate-and-repair loop that turns attached files into draft SOP circuits with `sop-wire-authoring`; the output is unapproved proposals.
**night-orchestration** — Bounded ownership and observable recovery for long-running work; methodology, not a launcher.
**procedure-library** — Build approved SOP rules and templates.
**reasoning-review** — Review epistemic objects and reasoning contracts.
**review-knowledge** — Review assertions and temporal corrections.
**semantic-sop-review** — Compare SOP circuits with guarded probes, require an actual LLM review for unresolved differences, and record the principal integrator's final decision; not training approval.
**coding-agent-query** — Turn one English request into SOP query wires (predicates by id from retrieved candidates, entity hints) for the session memory's vocabulary; the coding agent of codingAgentQuery never answers and never adds a fact (`lib/query-author/`, `server/query-parser.mjs`, DS031 "Request parsers").

**sop-wire-authoring** — Compile a long text (a book, manual, regulation, article) into checked knowledge wires (predicate, fact, rule, default, aggregate, action, method, norm) for evaluations and memory: the write-validate-fix loop with `node eval/smoke-reasoning/validator.mjs --authoring`, source and quote rules, closedness only with a source sentence, reification, symbols versus strings, no `jsEval`, a differential check of two independent compilations (`scripts/compare-compilations.mjs`) and how to split long texts; its output is unapproved proposals. The sub-folder `programming/` holds `TASK.md`, the task of the programming path (programming plan, milestone P0): the coding agent turns an instruction for a small JavaScript function into `task.sop` (task facts and `test` wires) and `candidate.sop` (a `code` wire), which the host validates and runs in the `code-sandbox` strategy (`lib/programming/solve-instruction.mjs`). The vocabulary of a base memory (`predicate`, `lexeme`, `entity`: classes, labels, lexemes, readings) has its own recipe, `skills/sop-wire-authoring/lexicon.md`.
**spark-training** — Build and run a bounded ChatSOP GPU training job with rootless Podman on DGX Spark (training still requires new explicit user approval).
**synthetic-sop-data** — Change the model-language corpora through the DS022 generator (`tools/datasets/build-corpora.mjs`), then verify, audit and send them to human review; never hand-patch rows.
**training-rules** — Experimental design heuristics for training small models on synthetic data.
**training-runbook** — Runbook for small-model training on synthetic data, distinguishing portable design from the actual ChatSOP controller (`node training/cli.mjs`, which refuses to train without a qualification record and a new explicit owner authorization).

## Code-only skill systems (no `SKILL.md`)

These folders hold executable modules specified by [DS017](../docs/specsLoader.html?spec=DS017-skill-systems.md) and exercised by `tests/skill-systems.test.mjs`.

**failure-classifier** — `classify.mjs`: classifies observed failures.
**implicit-sop-registry** — `registry.mjs`: the authorized implicit-SOP registry.
**semantic-gap-resolver** — `resolve.mjs`: semantic-gap proposals with explicit exceptions.

## Retired skills

`data-quality` and `wire-discovery` were imported from a sibling project and scanned `training-data/**/solution.sop` circuits that ChatSOP does not have; they were moved to `probably_obsolete/skills/` on 2026-09-28 and are not part of the current procedures.
