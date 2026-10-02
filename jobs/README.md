# ChatSOP job library (LLMJobs)

LLM batch work of ChatSOP runs as job specs through the self-contained runner `LLMJobs/` (manual: `LLMJobs/README.md`). This folder holds ChatSOP's part:

- `llmjobs.config.json`: endpoint (LLMAPIProvider), data dir `state/llm-jobs/` (gitignored), model roles and tiers, concrete fallback chains, task limits.
- Jobs: one folder each (`job.json`, `prompt.md`, plugins). `node LLMJobs/run.mjs jobs/<job>`; `check` first, `--stage pilot` for the small stage.
  - `books-direct-calibration`: the worker tier answers 20 book problems directly; `checks.mjs` scores against gold (never in the prompt).
- `templates/`: what the planner of a task may choose (`node LLMJobs/run.mjs task --instructions ... --attach ... --target memory:<id>`): `ingest-document` (adapter over `lib/ingest`), `bulk-review` (adapter over `lib/llm-review`), `extract-table`, `label-entities`.
- `plugins/`: `sop-check.mjs` (knowledge validator and quote check), `sop-sink.mjs` (store circuits in a base memory or a session).

Read only a run's `summary.md` and `escalations.jsonl`; never loop over model calls by hand.
