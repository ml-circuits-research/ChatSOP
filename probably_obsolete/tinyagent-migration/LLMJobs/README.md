# LLMJobs

A small, self-contained runner for LLM batch work: deterministic Node code controls the loop, models only fill in items. A caller (a person, a script or an agent) writes a **job spec** and reads a **summary of at most 10 lines** plus the escalations; it never loops over model calls itself. Node >= 22, built-ins only, no dependencies. It talks to an OpenAI-compatible endpoint (default `http://127.0.0.1:18080`, for example [LLMAPIProvider](../LLMAPIProvider/README.md)) and knows nothing about the project that uses it: domain checks, stores and templates are plugins loaded by path.

```
node LLMJobs/run.mjs <job-dir> [--stage pilot] [--resume <run-id>] [--refresh] [--no-register] [--publish <dir>]
node LLMJobs/run.mjs check <job-dir>          # validate; show chains, ladder, start tier, selected items (no calls)
node LLMJobs/run.mjs list [<job>] | show <job> <run-id>
node LLMJobs/run.mjs task --instructions "Extract the prices" --attach file.txt [--target memory:<id>|session:<id>|none] [--template <name> --params '{...}']
node LLMJobs/run.mjs prune                    # task folders older than tasks.keepDays
npm --prefix LLMJobs test                     # fake endpoint, no network
```

## Configuration

`llmjobs.config.json`, found by `--config`, `LLMJOBS_CONFIG`, or the nearest one in the job folder or a parent (copy `config.example.json`). Relative paths resolve against its folder.

- `endpoint`; `dataDir` (runs, cache, index, tier stats, tasks; default `state/` inside the job folder); `templatesDir`.
- `roles`: role -> tier (`planner`, `decider`, `auditor`, `worker`, `worker-short`). Jobs name tiers (`tier:small`) or roles (`role:worker`), never concrete models.
- `fallback`: tier -> concrete chain `[{upstream, model, maxTokens?, reasoning?, extraBody?}]`, used while the endpoint does not serve the tier. When `GET /health` lists the tier under `tiers`, the runner sends `model: "<tier>"` to `/v1/chat/completions` and the endpoint walks the tier's own fallback; a concrete chain is sent to `/u/<upstream>/v1/...` and walked by the runner.
- `limits` (`maxTaskUsd`, `maxTaskCredits`, `maxTaskCalls`) bound planned tasks; `tasks.keepDays` bounds task folders.

## Job spec

A job folder: `job.json`, `prompt.md`, optional plugins and an audit instruction file.

| field | meaning |
|---|---|
| `name`, `description`, `kind` | identity; `kind` is the task kind for tier stats |
| `inputs` | exactly one of `path` (JSONL, relative to the job folder), `command` (stdout JSONL), `items`, `module` (plugin `inputs(ctx)`), `attachments` (`{chunkChars}`: a task's files cut at blank lines); `idField`; `promptFields` (the only fields the prompt may see, so gold answers never reach a model); `select` `{where, ids, n, seed}` (deterministic hash order) |
| `packing` | `{itemsPerCall}` or `{tokenBudget, maxItems}`; more than one item per call needs `output.format: "jsonl"` with the item id on every line |
| `models` / `ladder` | a tier or role, or a ladder of tiers, cheapest first (see Adaptive tiers); `fallbackOnFailure: false` keeps a run on its first model (calibrations) |
| `output` | `{format: "text" | "jsonl", fields: {name: type | {type, enum, required}}, minRecords, stripFences}`; `{"none": true}` is a valid "nothing here" line |
| `checks` | plugin path: `parse(text, item)`, `check(item, output, ctx)` -> `{ok, problems, hint, value, empty}`, `repairHint(item, output, problems, ctx)`, `score(item, output)` -> `{label, reason}`; pure functions |
| `repairRounds` | repair conversation rounds per item (0..5), with the problems and hint (`<<<repair>>>`) |
| `concurrency` | calls in flight (the endpoint still enforces its own limits) |
| `budget` | at least one of `usd`, `credits`, `calls`; checked before every call and registered with the endpoint |
| `stages` | `[{name, items (cumulative, null = all), stop: {maxRejectRate, maxEmptyRate, minItems}}]`; stop rules are checked after every settled item and at each stage end |
| `audit` | `{rate, role | tier, instructions, severity, budgetTokens, seed}`: a deterministic sample of accepted items reviewed in packed calls that list problems only |
| `decider` | default `role:decider`; `null` switches it off |
| `escalation` | `{nextModel}` for a plain chain |
| `sink` | plugin path: `sink({accepted, rejected, items, run, dir, params, spec}, ctx)` stores the results (ctx carries the caller's `target`) |

`prompt.md` sections: `<<<system>>>`, `<<<item>>>` (`{{id}}` and the prompt fields), optional `<<<call>>>` (`{{items}}`, `{{count}}`), `<<<repair>>>` (`{{problems}}`, `{{hint}}`). `{{params.x}}` fills template parameters; a missing variable is an error.

## What a run does

Select inputs -> pack -> call (cache first) -> split the reply per item -> built-in and plugin checks -> repair rounds -> climb the tier ladder (or the next model) -> stop rules -> the **decider** (role `decider`) on items still rejected: one packed call answers per item `retry` (with a hint, one more worker attempt), `drop` or `escalate` -> the **audit** sample (role `auditor`) -> the decider on audit findings: `retry`, `dismiss` or `escalate` -> tier stats -> sink -> summary.

- **Cache.** Content-addressed by (upstream or tier, the whole request body: model, prompt, input, parameters) under `<dataDir>/cache/`; written once, never overwritten. A rerun pays nothing for calls already made; `--refresh` bypasses it.
- **Run folders.** Every run owns `<dataDir>/<job>/<run-id>/` (run id = UTC time + short hash, created exclusively): `accepted.jsonl`, `rejected.jsonl`, `escalations.jsonl`, `audit.jsonl`, `decisions.jsonl`, `summary.md` (at most 10 lines), `cost.json`, `run.json` (spec hash, models, git commit, status), `sink.json`. `<dataDir>/index.jsonl` is append-only. No run writes into another run's folder; a finished or stopped run is immutable. `--resume <run-id>` continues an interrupted run in its own folder. `--publish <dir>` copies the summary to `<dir>/<date>-<job>-<run-id>.md`, never to a fixed shared name. In `accepted.jsonl` the last line of an id wins (a decider retry appends), and an id there wins over `rejected.jsonl`.
- **Endpoint tags.** Every call carries `x-llmapiprovider-purpose: job:<name>` and `x-llmapiprovider-run: <run-id>`; a run registers its budget with `POST /jobs/register {job, run, purpose, budget}` and closes with `POST /jobs/finish`. An endpoint without these routes still works (the runner enforces the budget itself). A refusal (`402 budget_exceeded`, `403 untagged_limit`, `run_finished`) stops the run.

## Adaptive tiers

A job (or template) declares `kind`, `ladder` (e.g. `["tiny", "small", "medium", "good"]`), `quality` `{minPassRate, maxAuditPer100}` and optionally `adaptive` `{window, minItems, reprobeEvery, probeItems}`.

- Per item: start at the run's start tier; while the item fails (checks, repair rounds, an unavailable tier) try it on the next tier up. `accepted.jsonl` records `tier` and `tiers_tried`.
- Per kind: `<dataDir>/tier-stats.jsonl` is an append-only log, one row per run and tier (tried, passed, repair rounds, audit sampled and problems, USD, credits, latency). The start tier is the cheapest tier that met the bar over its last `window` runs, or that has fewer than `minItems` tries (explored); tiers that missed the bar are skipped. Every `reprobeEvery` runs of the kind, the first `probeItems` items start one tier lower.
- The summary states the mix and why: `tiers: start small (small met the bar ...); passed at small 18 (90%), medium 2 (10%)`. Only deterministic rules choose tiers; a planner may set `kind` and the ladder when it writes a task's spec.

## Tasks: large inputs with instructions

`runTask` (CLI `task`) takes instructions, attachments and a target (`memory:<id>`, `session:<id>`, `none`):

1. A task folder `<dataDir>/tasks/<task-id>/` (task.json, attachments/, plan.json, the run folder, result.json, summary.md), removed by `prune` after `tasks.keepDays`.
2. Planning: one call to the `planner` role chooses a template from `templatesDir` and fills its parameters (`prompts/planner.md`; previews of the attachments only). The plan is validated deterministically: known template, target allowed, parameters within the template's schema (`type`: string, integer, number, boolean, string[]; `enum`, `min`, `max`, `required`, `default`), ladder within `ladderAllowed`, budget within the template and `limits`. One repair round; then refused. A caller that knows the template passes `template` + `params` and no model is asked.
3. A `"kind": "prompt"` template is a job folder whose `job.json` uses `{{params.x}}`; an `"kind": "adapter"` template names a module exporting `run({params, attachments, target, taskDir, config, endpoint, chains, ladder, fetchImpl, budget, log, context})` for work an existing pipeline already does; its `fetchImpl` tags every call with the task's purpose and run id, and the task's budget is registered with the endpoint.
4. The sink plugin (or the adapter) stores the results against the target; the summary returns to the caller.

## Plugin interface (summary)

| plugin | exports |
|---|---|
| checks | `parse(text, item)`, `check(item, output, ctx)`, `repairHint(item, output, problems, ctx)`, `score(item, output)` |
| sink | `sink({accepted, rejected, items, run, dir, params, spec}, ctx)` -> `{stored?, summary?, ...}` |
| inputs | `inputs(ctx)` -> items (`ctx.params`, `ctx.attachments`, `ctx.options`) |
| adapter | `run(ctx)` -> `{status, summary, ...}` |
