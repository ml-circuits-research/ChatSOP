# TinyAgent

A small agent for model work, in one folder, Node >= 22 built-ins only. ONE server per machine does everything that touches a model:
providers and intelligence tiers, rate and plan limits, throttling, local model servers (start, slots, idle stop), the response cache,
the audit store, costs and budgets, batch jobs, TaskLambdas (every call of one an audited folder) and a sandbox for the ones a model
writes. Programs, command lines and other agents are thin clients of that server, through the library (`createTinyAgent`) or the CLI
(`tinyagent`). Nothing else calls a model API.

TinyAgent knows nothing about the project that uses it: project work (formalization, ingestion, reviews with a domain validator) comes
in as project TaskLambdas, job folders and task templates named by the project's configuration layer.

## Quick start

```
node TinyAgent/bin/tinyagent.mjs serve                 # the server, http://127.0.0.1:18080 (first start writes ~/.tinyagent/)
node TinyAgent/bin/tinyagent.mjs chat --tier tiny "Say hello"
node TinyAgent/bin/tinyagent.mjs run "Sum the amount column of sales.csv"   # the agent, in the current folder (TaskLambdas in ./.tinyagent/lambdas)
node TinyAgent/bin/tinyagent.mjs lambdas list          # the TaskLambda cache of the current folder (--server: the server's TaskLambdas)
node TinyAgent/bin/tinyagent.mjs calls list            # the latest TaskLambdaCalls (~/.tinyagent/calls); calls tree <id>, calls show <id>
node TinyAgent/bin/tinyagent.mjs models                # local model servers
node TinyAgent/bin/tinyagent.mjs stats
node --test TinyAgent/test/*.test.mjs                  # stub providers, no network, no model
```

A client on this machine that finds no server on the default port starts one in the background (detached); the server stays after
that client ends. Two clients starting one at the same moment are harmless: only one can bind the port, the other server exits and
both clients use the one that runs. Under `node --test`, with an injected transport, or with `TINYAGENT_AUTOSTART=0`, a client never
starts a server and reports `start it with: node TinyAgent/bin/tinyagent.mjs serve`.

## Home folder and configuration

Everything of a user lives in `~/.tinyagent/` (`TINYAGENT_HOME` moves it):

| Path | What |
|---|---|
| `config.json` | the user's configuration layer (a template is written on the first start) |
| `keys/<provider>.env` | keys, e.g. `OPENFERENCE_API_KEY=...` (templates with commented lines are written on the first start; mode 0600) |
| `data/` | the request log (`requests-<day>.jsonl`, 31 days), run registrations (`jobs/runs.jsonl`) |
| `cache/`, `audit/` | the response cache and the audit store |
| `logs/` | the logs of local model servers and of servers started by a client |
| `calls/` | TaskLambdaCalls: one folder per call (`<YYYY-MM-DD>/<lambda>-<id>/`, children nested), `index.jsonl` per day (below) |
| `runs/` | job run folders (`<job>/<run-id>/`) and task folders (`tasks/<task-id>/`), linked from their calls |
| `models/` | default place of local GGUF files |

Configuration layers, each over the previous one: the built-in defaults (`TinyAgent/config.default.json`), `~/.tinyagent/config.json`,
then a project layer (`--config <file>`, `TINYAGENT_CONFIG`, or the nearest `config/tinyagent.json` or `tinyagent.config.json` above the
working folder). Objects merge key by key, arrays and tier chains are replaced, `null` removes a key. Relative paths resolve against the
folder of the layer that names them (its `baseDir` when set). Keys never go in a configuration file. A key is looked up in
`~/.tinyagent/keys/`, then in the key folder of earlier versions (a migration fallback); the process environment wins over files.
Keys are never printed or logged; an error that quotes one is redacted.

## Providers and tiers

A provider is a block under `providers`: base URL, the env file and variable of its key, its formats (`openai`, `anthropic`, JSON
endpoints), `limits` (`maxConcurrent`, `maxPerSecond`, `maxPerMinute`, `maxPerHour`), `retry` (`max` 429 retries, `max5xx`, `baseMs`,
`maxWaitMs`), an optional `plan` (subscription windows, below), an optional `timeoutMs` (duration cap of one call) and, for a local
model, `start`. Adding a provider is a configuration change only.

Clients name a **tier**, never a model. A tier is a chain of `{upstream, model, prompt?, timeoutMs?, maxTokens?, minTokens?, extraBody?}`
or the name of another tier (an alias); the first entry whose provider has a key (or needs none) serves, the rest is its fallback. An
entry's `extraBody` fills the request fields the caller did not set (the model's own switches: a reasoning model that falls back for a
non-reasoning one gets `reasoning: {enabled: false}`, so a short question's budget is not spent thinking), and `minTokens` raises a
smaller `max_tokens`.

| Tier | Built-in default |
|---|---|
| nano | local Qwen3-0.6B (Q8_0), on demand, idle stop 15 min, 32 slots |
| micro (`supertiny` is an alias) | local Qwen3-4B-Instruct-2507, on demand, idle stop 15 min, 32 slots; then tiny |
| tiny | local Qwen3.6-35B-A3B (MoE, about 3B active), always on, 8 slots; then openference, then OpenRouter |
| small, medium, good | openference (Qwen3.8 27b; DeepSeek-V4-Flash-0731; DeepSeek-V4-Flash-0731), then OpenRouter, then the local tiny |
| best | the local tiny until a stronger model is configured |

With no key configured only the local models serve, and tiny serves small, medium, good and best. A response names what served it
(`x-tinyagent-tier`, `x-tinyagent-model`); a fallback is marked (`x-tinyagent-fallback`, `x-tinyagent-fallback-reason`: unreachable,
5xx, 429, wait, timeout, unavailable) and counted in `/stats`. `x-tinyagent-no-fallback: 1` (client option `noFallback`) keeps a request
on one model (calibrations, A/B arms).

**Prompted roles.** A tier entry with `prompt` serves the JSON endpoints `/v1/structure` (labelled spans and relations) and `/v1/fol`
(FOL per sentence) with a chat model and a role prompt from `promptsDir` (sections `<<<options>>>`, `<<<system>>>`, `<<<user>>>`,
`<<<again>>>`); the reply is validated deterministically, re-asked once naming its problems, merged with the valid parts of the other
reply, and a reply cut by its budget is asked again with four times the budget up to `maxTokensCap`.

**Duration caps.** Some models ignore `max_tokens` and reason for many minutes. A tier entry's `timeoutMs` (else the provider's) cuts
such a call: it is logged as `upstream timeout`, answered `504 upstream_timeout`, never cached, and falls back down the tier's chain.
The server and the library talk HTTP through node:http (`lib/http-fetch.mjs`), not Node's built-in fetch, so no fixed 300-second
header timeout ends a long call: only a cap, or the client's own `timeoutMs`, does.

## Local models

`start` of a provider: `bin` (llama-server; a bare name is looked up on PATH), `gguf`, `alias`, `slots` (llama-server `--parallel`, and
the provider's `maxConcurrent` unless set), `ctxPerSlot` (`-c slots*ctxPerSlot`), `args`, `startAtBoot` (always on), `idleStopMs` (stop
after that long unused), `exclusiveGroup` (servers of a group never run together), `locks` (files that reserve the GPU), `startTimeoutMs`,
or `script` (a Node service started with `--port`) with `requires` and `identity` (files whose size and mtime enter the cache key).
The server starts a local model at its first request (or at boot), reuses one already listening on the port, stops on-demand ones when
idle, and refuses a start while a GPU lock exists (the request falls back down its chain). `tinyagent models` lists them;
`tinyagent models start|stop <provider>` controls them.

## Limits, costs and priorities

- Every attempt is one line of the request log: time, client, purpose, run, tier, provider, model, status, latency, tokens, cost
  (provider-reported USD, plan credits), rate-limit headers, fallback fields. `/stats` (and the dashboard at `/`) aggregates windows,
  models, tiers, purposes, plan use, inferred limits, quota windows, fallbacks, cache, local servers, jobs and queued work.
- Requests wait in a per-provider queue (none is dropped) under the provider's rate limits; a 429 pauses the queue. A `plan`
  (`limits: [{name, unit: calls|credits|tokens, window: "60s"|"5h"|"7d", max, mode?, provider?}]`) gates the queue so no window is
  exceeded; `/stats` `plan` shows use, remaining, warnings at 80% and the provider's own count next to ours; `value` compares the
  subscription with pay-per-token prices of `compare`.
- **Priority classes.** `interactive` (purposes in `interactive.purposes`, or header `x-tinyagent-priority`) goes first and falls back
  after `interactive.maxWaitMs`; `normal` waits; `background` (the header, a job's `"priority": "background"`, or purposes in
  `background.purposes`) runs only when nothing else waits and, on a plan provider, only within `background.share` (default 0.7) of
  every rate and plan window, so 30% stays free for interactive and normal work. Background work is held, never refused, never falls
  back because of a wait, and resumes by itself; `/stats` `upstreams.<name>.queued` counts queued work per class and `held_reason`
  says why the head of a queue waits.

## Cache, audit, budgets

- **Cache** (`cache.defaultMode`, header `x-tinyagent-cache`, client option `cache`): `use` (a hit is served without a call), `strict`
  (a miss is refused with 409 `cache_miss` and no model is called: regressions), `record` (always call and refresh), `off`. The key is
  the whole request body (stream fields excluded) plus the target and the identity of the model behind it (a local GGUF's size and
  mtime; a role prompt's hash), so a changed prompt, setting or model is a new key. Only complete non-streamed 200 answers of the tier's
  first model are stored (`answerComplete` of `lib/cache.mjs`): never a cut answer (`finish_reason` length or `max_tokens`), an empty or
  thinking-only one, or one without output-token usage (an answer that ended early upstream); an entry stored under older rules is
  re-checked on every read and never replayed when it fails. The mode is set per client (`createTinyAgent({cache: 'off'})`) or per call
  (`ta.chat({..., cache: 'record'})`); an unknown mode throws.
- **Audit** (`audit`): request/response pairs of the configured tiers and providers, one JSONL file per day, bounded, kept 14 days.
- **Purposes and budgets** (`policy`): every request carries a purpose (`x-tinyagent-purpose`, required by the library); purposes outside
  `allowedPurposes` share a small daily allowance (`untaggedDailyMax`) and are refused beyond it (403 `untagged_limit`). A run registered
  with `POST /jobs/register {job, run, purpose, budget: {usd?, credits?, calls?}}` is refused at its budget (402 `budget_exceeded`) and
  after `POST /jobs/finish` (403 `run_finished`). Jobs, tasks and `run` register their runs themselves.

## The library

```js
import {createTinyAgent} from './TinyAgent/lib/client.mjs';
const ta = createTinyAgent({purpose: 'job:prices'});           // url (TINYAGENT_URL, default http://127.0.0.1:18080), run, client,
                                                                 // cache, priority, fetchImpl (transport), autostart, config (project layer)
const r = await ta.chat({tier: 'small', messages, maxTokens: 800, temperature: 0});
// r: {ok, status, text (thinking removed), raw, reasoning, finish, cut, usage: {in, out, cached, reasoning}, tier, served, fallback,
//     fallbackReason, cached, credits, usd, ms, body, reason}; never throws on a model failure
await ta.chat({tier: 'good', system, prompt, retryCut: true});  // a cut reply is re-asked with 4x the budget up to cutCap (32000)
await ta.chat({upstream: 'openrouter', model: 'deepseek/deepseek-v4-flash', prompt, noFallback: true});   // a concrete model
const j = await ta.json({tier: 'good', prompt: 'Return {"a": 1}'});            // {..., json} (ok false when no JSON object)
await ta.role('structure').structure({text, entities, relations});            // prompted roles: .structure(), .fol(), .chat()
await ta.runJob('jobs/my-job', {stage: 'pilot', priority: 'background'});     // waits for the operation; {wait: false} returns its id
await ta.task({instructions, attachments: ['a.txt'], target: {kind: 'none'}});
await ta.call('extract-table', {columns: ['price']}, {attach: ['a.txt']});    // a TaskLambdaCall: {id, dir (the call folder), status, result}
await ta.run('Count the words of the attached file', {attach: ['a.txt'], planOnly: false});   // server TaskLambdas as steps (CLI run-lambdas)
// the agent of `tinyagent run` runs in the caller's process: import {runAgent} from './TinyAgent/lib/agent/index.mjs';
// await runAgent({request: 'Sum the amount column of sales.csv', workdir: '.', ta, config});   // below, "The agent"
await ta.call('extract-table', {columns: ['price']}, {wait: false});         // the background form: the operation at once ({id}); ta.op(id) follows it
await ta.lambdas(); await ta.calls({lambda: 'extract-table', status: 'ok'}); await ta.callTree(id); await ta.callInfo(id);
await ta.stats(); await ta.models(); await ta.tiers(); await ta.health();
const tagged = ta.with({purpose: 'review:x', run: 'r1', priority: 'background'});
```

Options common to `chat`, `json` and the roles: `purpose`, `run`, `cache`, `priority`, `noFallback`, `timeoutMs`, `retries` (transient
failures), `headers`. A purpose is required: `chat`, `formalize`, `answer-*`, `ingest`, `job:<name>`, `review:<run>`, `lambda:<name>`,
`run:<id>`, `test:<name>` pass the default policy. (`ta.skill`, `ta.skills` and the purpose `skill:<name>` are the names of before the
TaskLambda rename, kept until no caller needs them: `lib/legacy.mjs`.)

## Jobs

A job folder holds `job.json`, `prompt.md` and optional plugins; the runner does: select inputs -> pack -> call (cache first) -> split
per item -> built-in and plugin checks -> repair rounds -> climb the tier ladder -> stop rules -> the decider (role `decider`) on items
still rejected -> the audit sample (role `auditor`) -> tier statistics -> the sink plugin -> a summary of at most 10 lines.

| field | meaning |
|---|---|
| `name`, `description`, `kind` | identity; `kind` is the task kind of the tier statistics |
| `inputs` | one of `path` (JSONL), `command` (stdout JSONL), `items`, `module` (plugin `inputs(ctx)`), `attachments` (`{chunkChars}`); `idField`; `promptFields` (the only fields a prompt sees: gold never reaches a model); `select` `{where, ids, n, seed}` |
| `packing` | `{itemsPerCall}` or `{tokenBudget, maxItems}`; more than one item per call needs `output.format: "jsonl"` |
| `models` / `ladder` | `tier:<name>`, `role:<name>` or a ladder of tiers, cheapest first; `fallbackOnFailure: false` keeps one model |
| `output` | `{format: "text" | "jsonl", fields, minRecords, stripFences}` |
| `checks` | plugin: `parse(text, item)`, `check(item, output, ctx)` -> `{ok, problems, hint, value, empty}`, `repairHint`, `score(item, output)` |
| `repairRounds`, `concurrency`, `stages`, `audit`, `decider`, `escalation`, `sink` | as named; `stages` `[{name, items, stop: {maxRejectRate, maxEmptyRate, minItems}}]` |
| `budget` | at least one of `usd`, `credits`, `calls`; registered with the server, checked before every call |
| `priority` | `interactive`, `normal` or `background` |

`prompt.md` sections: `<<<system>>>`, `<<<item>>>` (`{{id}}` and the prompt fields), optional `<<<call>>>` (`{{items}}`, `{{count}}`),
`<<<repair>>>` (`{{problems}}`, `{{hint}}`); `{{params.x}}` fills template parameters; a missing variable is an error.

Every run owns `<runner.dataDir>/<job>/<run-id>/` (`accepted.jsonl`, `rejected.jsonl`, `escalations.jsonl`, `audit.jsonl`,
`decisions.jsonl`, `summary.md`, `cost.json`, `run.json`); `index.jsonl` is append-only. A run started through the server is wrapped by
a TaskLambdaCall (below): its call.json links the run folder, it has one child call per item, and the decider's and auditor's model
calls are in its models.jsonl; `--resume <run-id>` continues an interrupted
run; `--publish <dir>` copies the summary to `<dir>/<date>-<job>-<run>.md`. Adaptive tiers: a job with `kind`, `ladder` and `quality`
starts at the cheapest tier that met the bar over its recent runs (`tier-stats.jsonl`), re-probing one tier lower now and then.

**Tasks** (`tinyagent task`, `ta.task`): instructions plus attachments; the planner role chooses a template of `runner.templatesDir`
(`template.json`: `kind` prompt (a job folder using `{{params.x}}`) or adapter (a module `run(ctx)`), `targets`, `params` schema, `budget`,
`ladder`, `ladderAllowed`) and fills its parameters; the plan is validated deterministically (one repair round). An adapter's `ctx` has
`ta` (the library, tagged with the task's purpose and run, so its budget applies), `params`, `attachments`, `target`, `taskDir`, `log`,
`context`.

## TaskLambdas and TaskLambdaCalls

**A TaskLambda** is a content-hashed executable unit: code, a typed parameter schema, an optional check, metadata (name, description,
origin) and a REQUIRED effects declaration. Origins: `built-in` (`TinyAgent/lambdas/`: `chat`, `json`, `job`, `task`, `write-lambda`; and
`agent`, the agent of `tinyagent run`), `project` (modules named by `lambdas.project`), `job` (a job folder of `lambdas.jobs`), `template`
(a task template), and `model-written` (the agent's cached TaskLambdas, whose status is `draft`, `verified` or `edited`, and the programs
of `write-lambda`; both run in the sandbox). The hash of a module TaskLambda is the sha256 of its module text and name, of a job folder or
template of its files, of a model-written one of its code. Agent Skills (`.agents/skills/*/SKILL.md`) are a separate concept:
instructions and scripts a TaskLambda may use.

| Effect | Meaning | Enforced by |
|---|---|---|
| `pure` (alone) | no effect: the output depends only on the params and the files or attachments read | every tool and the server's client refuse the other kinds |
| `writes-workdir` | writes, moves or deletes files of the work folder | `tools.write`, `tools.move` |
| `model-calls` | calls models through TinyAgent | `tools.ask`; `ctx.ta.chat`/`json` of a server TaskLambda |
| `runs-scripts` | runs a declared script of an Agent Skill (trusted code; its own writes are not observed) | `tools.runSkillScript` |
| `runs-jobs` | starts job runs or tasks | `ctx.jobs.runJob`, `ctx.jobs.runTask` |
| `writes-external` | writes outside the work folder and the call folder (a project store) | declared by trusted code |
| `network` | direct network access | none is allowed today: a TaskLambda declaring it is refused |

A server TaskLambda is a module:

```js
export default {
  name: 'extract-prices',                       // lowercase, digits, . _ -
  description: 'Extract prices with their quotes from attached text.',
  effects: ['model-calls'],                     // required: ['pure'] or the kinds above
  params: {currency: {type: 'string', enum: ['EUR', 'USD'], default: 'EUR', description: '...'}},   // string, integer, number, boolean, string[], object
  async run(ctx) {                              // returns {status: 'finished' | 'failed', summary, ...any JSON}
    const text = await ctx.readAttachment(ctx.attachments[0].name);
    const r = await ctx.ta.json({tier: 'small', prompt: `...${text}`});
    return {status: 'finished', summary: JSON.stringify(r.json)};
  },
};
```

`ctx`: `params` (validated, defaults applied), `ta` (the library inside the server, tagged `lambda:<name>` and the call's run; it records
every model call in the call's models.jsonl and refuses model calls without `model-calls`), `attachments` (`[{name, path, bytes,
sha256}]`), `readAttachment(name)`, `dir` (the call folder, for outputs), `self` (the call's handle: `log`, `effect`, `input`, `model`,
`child`), `invoke(name, params)` (a nested TaskLambdaCall), `log(line)`, `jobs.runJob(dir, options)` and `jobs.runTask(task)` (with
`runs-jobs`), `config`, `runner`. A module may also export `lambdas: [...]`. Sources, in this order (a later one cannot replace a name):
built-in, `lambdas.project` (files or folders), one per job folder of `lambdas.jobs` (`{name: dir}`, param `stage`), one per task
template (its parameters plus `target`). Every operation runs in a worker thread of the server: modules are loaded fresh for each
operation, a crash does not stop the server, and every model call goes back to the server's core over a message port. (The keys
`skills.plugins` and `skills.jobs`, the export `skills` and the field `inputs` are read as the old names until no caller needs them.)

**A TaskLambdaCall** is one invocation, with its own folder. Calls accumulate: together the folders are an auditable cache of past
activity, visible and editable by people and coding agents. The calls root is `<TinyAgent home>/calls` (`calls.dir`, `--calls DIR`);
every run prints its call folder.

```
~/.tinyagent/calls/
  2026-10-03/index.jsonl                          one line per event (started, finished, pruned) of the calls started that day
  2026-10-03/agent-5c1e09ab/                      tinyagent run "Count the lines of notes.txt"
    call.json       {"id": "20261003-161502-5c1e09ab", "lambda": {"name": "agent", "hash": "…", "origin": "built-in", "effects": [...]},
                     "params": {"request": "Count the lines of notes.txt", ...}, "caller": "cli", "purpose": "run:20261003-…", "run": "…",
                     "parent": null, "root": "20261003-161502-5c1e09ab", "workdir": "/home/me/work", "started_at": "…", "finished_at": "…",
                     "status": "ok", "ms": 8120}
    output.json     {"status": "ok", "result": {"answer": "3", "how": "plan", "lambda": "count-lines-1a2b3c", ...}, "error": null}
    models.jsonl    {"role": "planner", "tier": "good", "model": "openference/DeepSeek-V4-Flash-0731", "in": 2210, "out": 640,
                     "credits": 0.75, "usd": 0, "cache_key": "9f…", "cached": false, "ms": 7400}
    decision.json   the match: candidates with BM25 scores, the match call, the reason
    lambda-1.mjs    the code the planner wrote in round 1 (context.txt, errors.jsonl when there were any)
    log.txt, summary.json
    calls/count-lines-77d0c2f1/                   the child call: the TaskLambda itself
      call.json     {"lambda": {"name": "count-lines", "hash": "…", "origin": "model-written", "effects": ["pure"], "status": "candidate"},
                     "params": {"file": "notes.txt"}, "parent": "20261003-161502-5c1e09ab", "reuse_key": "…",
                     "inputs": [{"op": "read", "path": "notes.txt", "sha": "…"}], "inputs_complete": true, ...}
      lambda.mjs    the code that ran
      tools.jsonl   every tool call (arguments, outcome, ms)
      inputs.jsonl  every file read, listing and search, with the sha256 of what it saw
      effects.jsonl every write, move or delete: {"kind": "write", "path": "out.csv", "before": null | sha, "after": sha, "bytes": 81}
      output.json   {"status": "ok", "result": {"result": {"answer": "3"}, "check": {...}}, "reused_from": "<call id>" when reused}
  reuse/<k0k1>/<key>.json                         the last successful call of a pure TaskLambda for one reuse key
```

A job run started through the server is a call of `job` with one child call per item (`<job>.item`: the item's prompt fields, its
output or problems, its model calls; a packed call is listed in every item it served with `shared`); a task is a call of `task` whose job
items are its children; `run-lambdas` has one child call per step; `write-lambda` one per program it ran. The job runner's own run folder
(`runs/<job>/<run-id>/`) and the task folder stay where they are and are linked from call.json (`job_run`, `task`): the call wraps them.

**Reuse.** A `pure` TaskLambda called with the same lambda hash, params, work folder and attachments, whose recorded inputs (the files it
read, its listings and searches) still have the same hashes, returns the recorded output marked `reused_from: <call id>` without running
(`agent.reusePure: false` or `--no-cache` turns this off for the agent). A call with effects is never replayed: every call runs and is
audited. A result larger than `calls.maxResultBytes` goes to `result.json` and is never reused.

**Index and prune.** `tinyagent calls list|search` read the per-day `index.jsonl` files (filters `--lambda`, `--status`, `--date`,
`--since`, `--parent`, `--top`, free text over params, lambda, purpose and run); `calls show <id>` prints call.json, output.json and
summary.json; `calls tree <id>` the call tree; `calls prune [--days N] --yes` keeps call.json, output.json and summary.json (the effect
and model summaries) of calls older than N days (`calls.keepArtifactsDays`, default 30) and removes the rest (logs, line files, code,
outputs); a call still running is left alone. The server answers the same over HTTP (`GET /v1/calls`, `/v1/calls/<id>`, `/v1/calls/<id>/tree`).

**`run-lambdas`** (`tinyagent run-lambdas "<request>"`, `ta.run`, `POST /v1/run`; the agent of `tinyagent run` is described below): the
planner role (tier `good`) sees the catalog of TaskLambdas (names, descriptions, params, effects; never code) and answers `{"steps":
[{"lambda", "params"}], "reason"}`; the plan is validated deterministically (known TaskLambdas, params in their schemas, at most
`run.maxSteps` steps; one repair round) and executed step by step, each step a child call. A run registers one budget (`run.budget`) for
all its calls. `--plan-only` stops after the plan.

**TaskLambdas written on the fly** (`write-lambda`, chosen by the planner when no TaskLambda fits): the planner tier writes a small
program `async function run(api, input)` against an allow-listed API (`prompts/lambda-writer.md`): `api.chat({tier, prompt, system?,
maxTokens?})` on the tiers of `sandbox.tiers` within `sandbox.maxCalls`, `api.listInputs()`, `api.readInput(name)`, `api.writeOutput(name,
text)` (into its call folder's `outputs/`), `api.log(message)`. Each attempt is a child call of the model-written TaskLambda `program`; the
program is written to its folder (`program.js`) before it runs, and runs in the sandbox (`lib/sandbox.mjs` `runProgram`): a worker thread
with heap, stack and wall-time limits and an empty environment; inside it a fresh V8 context with only the ECMAScript built-ins (no
require, import, process, fetch, timers, Buffer; `eval` and `Function` disabled); only strings and numbers cross the boundary (JSON text
parsed inside the context), so no host object is reachable. A program that fails is shown its error once and rewritten.
`test/sandbox.test.mjs` holds the escape attempts that must fail.

## The agent: `tinyagent run`

A small coding-style agent for clear, simple, repetitive tasks in a work folder (`--workdir`, default the current folder). It writes
TaskLambdas (code with a typed parameter schema, a check and an effects declaration), keeps the ones that worked in a visible cache, and
calls them again for the same task with other parameters without planning again. It runs in the caller's process (the CLI, or `runAgent`
of `lib/agent/index.mjs`); its model calls go through the server under the purpose `run:<call-id>` and one registered budget
(`agent.budget`, else `run.budget`). Every run is a TaskLambdaCall of the built-in TaskLambda `agent`, and every execution of a TaskLambda
is a child call (layout above); every run prints its TaskLambda folder and its call folder.

**Skills.** Agent Skills in the standard format: `<workdir>/.agents/skills/<name>/SKILL.md` (YAML frontmatter `name`, `description`;
the body is the instructions; files beside it), then the skill roots of `agent.skillDirs` (for example a project's `skills/`; the first
source wins a name). The planner sees names and descriptions only; a body is loaded when the planner asks for it (`load_skills`) or
when its TaskLambda uses the skill (progressive disclosure). A skill declares its scripts in the frontmatter (`scripts: [scripts/a.mjs]`)
or, without that key, as the files of its `scripts/` folder; `.mjs`/`.js`/`.cjs` run with this Node, `.py` with python3, `.sh` with
`/bin/sh`. A script is the skill author's code: trusted like an installed tool, not sandboxed.

**Tools**, the only way a TaskLambda touches anything, all confined to the work folder and to its declared effects: `tools.read(path)`,
`tools.list(dir, {recursive})`, `tools.search(text, {dir, ignoreCase, maxResults})` (literal text), `tools.write(path, text)` and
`tools.move(from, to)` (never overwrites) with `writes-workdir`, `tools.ask(tier, prompt, {system, maxTokens})` with `model-calls` (tiers
of `agent.askTiers`, at most `agent.maxAsks` per run), `tools.runSkillScript(skill, script, args)` with `runs-scripts` (a declared script
only; argv strings, no shell, the work folder as cwd, PATH/LANG/HOME only, a timeout and an output cap), `tools.log(message)`. Every read,
listing and search is recorded with the hash of what it returned (the inputs of the call), every write and move with before/after hashes
(its effects), every model call in models.jsonl, every tool call in tools.jsonl. Refused: an undeclared effect, a path outside the folder
(`..`, an absolute path elsewhere, a NUL byte), a path whose existing part leaves the folder through a symbolic link, writing through a
link (O_NOFOLLOW), and writing into `.tinyagent/`, `.agents/` or `.git/`. Reads, writes, lists and searches are size-bounded. There is no
free shell.

**A TaskLambda is code**, a module a person can read and edit:

```js
export const meta = {name: 'sum-csv-column', task: 'Sum a numeric column of a CSV file.',
  params: {file: {type: 'string', description: 'the CSV file'}, column: {type: 'string', description: 'the column header'}},
  example: {file: 'sales.csv', column: 'amount'}, effects: ['pure'], skills: []};
export default async function run(tools, params) { /* ... */ return {answer: '59.75', outputs: []}; }
export async function check(tools, params, result) { /* verify another way */ return {ok: true, reason: '...'}; }
```

The planner tier (`agent.plannerTier`, else `runner.roles.planner`: `good`) writes it (`prompts/agent-planner.md`), seeing the request,
the folder's first entries, the first lines of the files the request names and the skill catalog; it may ask once for skill bodies and
file heads. It runs in the sandbox of model-written TaskLambdas (`lib/sandbox.mjs` `runModule`: a worker with heap, stack and time limits,
a fresh V8 context with the ECMAScript built-ins only); the tools are served by the host over the message channel, only strings and
numbers cross it. Before it runs, a TaskLambda is refused when its `meta` is not a typed parameter schema with example values that fit it,
when its effects declaration is missing or does not cover the tools its code uses, or when its code writes a value of the request (a
string literal such as `".txt"` or `"2026-"` that occurs in the request; plain words, skill names and their scripts excepted): it would
not work with other values. A failure (a refusal, an exception with its `lambda.js` line, a failed check) goes back to the planner with the
last tool calls and the first lines of the files it read, at most `agent.maxRounds` (3) rounds; each attempt that ran is a child call
with status `candidate`. `--plan-only` (`--dry-run`) shows the TaskLambda, or the cached one and its values, and runs nothing.

**The TaskLambda cache**, a plain folder: `--lambdas DIR`, else `agent.lambdasDir`, else `<workdir>/.tinyagent/lambdas` (decided:
TaskLambdas name paths of their work folder, so they live beside it, where a person or a coding agent sees and edits them; a shared
folder is one setting away). One directory per TaskLambda: `lambda.mjs`, `LAMBDA.md` (frontmatter `id`, `origin`, `status`,
`verified_hash`, `effects`, `calls`; sections Description, Parameters, Effects, Skills, First request, Check, Last calls) and
`calls.jsonl` (one line per call: call id, how it was chosen, params, outcome, `reused_from`); `index.json` is a derived cache of the
`meta`s. One that ran and passed its own check is stored `verified` and called again; one without a check is stored `draft` until
`tinyagent lambdas verify <id>`. One whose `lambda.mjs` changed since it was verified (its hash differs from `verified_hash`) is
`edited`: when it next matches, it runs with its check, becomes `verified` again if the check passes, and is otherwise not called (the
planner writes a new one; a folder edited by hand is never overwritten). Editing the Description of LAMBDA.md improves matching.
`tinyagent lambdas list | show <id> | verify <id> | rm <id> | promote <id> --name <name> [--to DIR]`; `promote` writes a project
TaskLambda module (default `<workdir>/.tinyagent/project-lambdas/<name>.mjs`) with the same effects, whose params are its params plus
`workdir`; add its folder to `lambdas.project` to serve it. The folder of earlier versions, `.tinyagent/plans` (plan.mjs, PLAN.md,
runs.jsonl), is moved to `.tinyagent/lambdas` on first use: a plan without `meta.effects` gets the effects its code shows, inserted on its
meta line, and keeps its verification.

**Fast match before planning.** A BM25 index (`lib/agent/bm25.mjs`, no dependency) over the verified and edited TaskLambdas (task,
LAMBDA.md description, parameter names, first request) gives the top `agent.match.k` candidates in about a millisecond. The same request
as a TaskLambda's first request calls it at once. Otherwise the match tier (`agent.matchTier`, `tiny`, thinking off;
`prompts/agent-match.md`) decides only whether the request is the same task as a candidate with other parameter values, and extracts
the values; they are coerced to their declared types, validated against the schema and, with `agent.match.grounded`, each string or
number must occur in the request (defaults excepted). A match that holds calls the cached TaskLambda directly (with its check,
`agent.checkOnReuse`), with no planner call and no new code; a pure one whose recorded inputs still hold returns its recorded output
without running (`how: reuse-output`); anything else, or a cached TaskLambda that fails, goes to the planner. `decision.json` records the
candidates and their scores, the BM25 time, the match call and the reason.

**Measured** (`node TinyAgent/bench/agent-tasks.mjs`: 12 tasks with known results in one fresh folder and one cache: four families, a
parameter variant of each, a paraphrased variant and three near misses; planner `good`, match `tiny`). First run (2026-10-03, plan
cache): 12 of 12 correct; of 8 newly planned tasks 3 were right at the first plan and 5 after one or two re-plans (two of those were a
skill name wrongly taken for a hard-coded value, fixed since); 4 of 5 variants reused with the right plan and values (the fifth after
that fix), 0 of 3 near misses reused; a cache hit cost one local `tiny` call and 0 credits and took 1.7 to 8 s (median 3.7 s with an
idle model), a new plan 3 to 4 model calls, 0.75 to 3 plan credits and 8 to 80 s.

Second run (2026-10-03, after the TaskLambda rename; TaskLambda cache and call folders; a server of this checkout on a private port): 11 of 12
correct; of 8 newly planned tasks 5 were right at the first TaskLambda and 2 after one re-plan; 4 of 5 variants called the right cached
TaskLambda with the right values (4 of 4 match precision), 0 of 3 near misses reused; a cache hit cost one local `tiny` call, 0 credits
and 1.5 to 2.4 s (median 2.0 s), a new TaskLambda 1 to 5 model calls (median 3), 0.75 to 3 plan credits and 8 to 80 s (median 17 s); 12
credits in all; 12 agent calls with 13 child calls in the call folders. The failure: the cached `skill-stats` TaskLambda wrote the
request's "3" into its code as the text `'3'` (a one-character literal, skipped by the hard-coded value check), so the match tier rightly
refused it for "the 5 most frequent words"; the planner's new TaskLambda then re-implemented the script's word rule in its check, which
failed three times. The check now flags a one-digit literal that the request holds; a targeted rerun of that family (`--only
skill-stats,skill-stats-variant`, fresh folder) passed both, the variant by calling the cached TaskLambda.

## Command line

```
tinyagent serve [--port N] [--host H] [--config file]
tinyagent run "<instructions>" [--workdir DIR] [--lambdas DIR] [--calls DIR] [--plan-only|--dry-run] [--no-cache] [--json]
tinyagent lambdas [list] [--server] | show <id> | verify <id> | rm <id> | promote <id> --name <name> [--to DIR] [--yes]   [--workdir DIR] [--lambdas DIR]
tinyagent call <name> [--params '{json}'] [--attach file]... [--detach]   # one TaskLambdaCall; --detach prints the operation id at once
tinyagent calls [list] [--lambda n] [--status s] [--date d] [--since d] [--parent id] [--top] [--limit n] | show <id> | tree <id>
                | search <text> | prune [--days N] [--yes]   [--calls DIR] [--json]
tinyagent run-lambdas "<request>" [--attach file]... [--plan-only]
tinyagent job <dir> [--stage s] [--resume run-id] [--refresh] [--no-register] [--publish dir]
tinyagent check <dir> | list [job] | show <job> <run-id> | prune
tinyagent task --instructions "..." [--attach file]... [--target memory:<id>|session:<id>|none] [--template name --params '{json}']
tinyagent chat [--tier small] [--system "..."] "<prompt>"
tinyagent stats [--json] | health | models [start|stop <provider>] | ops [id]
tinyagent migrate-home [--yes]            # copy the data of the earlier proxy into ~/.tinyagent (verified, old folders untouched)
tinyagent probe --yes --model <id> [--upstream p] [--rates 0.5,1,2]   # measure a provider's real limits (spends quota)
```

(`tinyagent` is `node TinyAgent/bin/tinyagent.mjs`.) Common options: `--config` (project layer), `--url`, `--purpose`. Agents and
external tools use the CLI or the HTTP API; the CLI prints short summaries and leaves the rest in the call folder. `run`, `lambdas` and
`calls` read and write local folders only (`run` reaches models through the server). Old names, kept until no caller needs them
(`lib/legacy.mjs`): `plans` and `--plans` (`lambdas`, `--lambdas`), `skills` (`lambdas --server`), `skill <name> --inputs` (`call <name>
--params`), `run-skills` (`run-lambdas`).

## HTTP API

| Method and path | What |
|---|---|
| `POST /v1/chat/completions`, `/v1/messages` | OpenAI and Anthropic formats (streaming included); `model` is a tier or a model of the default provider |
| `POST /u/<provider>/v1/...` | a concrete provider |
| `POST /v1/structure`, `/v1/fol` | prompted JSON roles |
| `GET /v1/models`, `/health`, `/stats`, `/` | models and tiers, health (tiers, providers without keys), statistics, dashboard |
| `POST /jobs/register`, `/jobs/finish`; `GET /jobs` | run budgets |
| `GET /v1/local`; `POST /v1/local/<provider>/start` / `stop` | local model servers |
| `GET /v1/lambdas`; `POST /v1/lambdas/<name>` `{params, attachments}` | TaskLambdas; a call (202 `{id, dir}`: the operation and its call folder) |
| `POST /v1/jobs` `{dir, stage?, resume?, refresh?, register?, publish?, priority?}`; `POST /v1/tasks`; `POST /v1/run` `{request, attachments, planOnly?}` | operations (202 `{id, dir}`) |
| `GET /v1/ops`; `GET /v1/ops/<id>?wait=<s>&since=<n>` | operations; a long poll returns at the next log line or the end |
| `GET /v1/calls?lambda=&status=&date=&since=&parent=&root=&text=&top=1&limit=`; `GET /v1/calls/<id>`, `/v1/calls/<id>/tree` | the call folders: search, one call, its tree |

`GET /v1/skills` and `POST /v1/skills/<name>` `{inputs}` are the old names of the TaskLambda endpoints. Request headers:
`x-tinyagent-purpose`, `x-tinyagent-run`, `x-tinyagent-cache`, `x-tinyagent-priority`, `x-tinyagent-no-fallback`, `x-client-name`.
Response headers: `x-tinyagent-tier`, `-model`, `-fallback`, `-fallback-reason`, `-cache`, `-cache-key`. A token (`TINYAGENT_TOKEN`, or in
a key file) makes every request but `/health` need `Authorization: Bearer <token>`; the server listens on 127.0.0.1 by default.

## Files

`bin/tinyagent.mjs` (CLI); `lib/core.mjs` (routing, forwarding, limits, fallback, cache, audit, budgets, local servers, prompted roles),
`lib/server.mjs` (the server and its operations), `lib/client.mjs` (the library), `lib/worker.mjs` (an operation), `lib/inproc.mjs`
(in-process and port transports), `lib/config.mjs` (layers, home), `lib/settings.mjs` (keys), `lib/limiter.mjs`, `lib/plan.mjs`,
`lib/monitor.mjs`, `lib/cache.mjs`, `lib/audit.mjs`, `lib/guard.mjs`, `lib/local.mjs`, `lib/prompted.mjs`, `lib/lambda/` (TaskLambdas:
`registry.mjs`, `effects.mjs`, `calls.mjs` the call folders), `lib/sandbox.mjs`, `lib/agent/` (the agent of `run`: `run.mjs`,
`lambda-cache.mjs`, `lambda-code.mjs`, `match.mjs`, `bm25.mjs`, `workspace.mjs`, `agent-skills.mjs`), `lib/dashboard.mjs`, `lib/probe.mjs`,
`lib/migrate.mjs`, `lib/jobs/` (the job runner), `lambdas/` (built-in TaskLambdas), `prompts/` (the runner's and the planners' own
prompts), `config.default.json`, `test/`, `bench/` (task sets with known results). `lib/legacy.mjs` holds the names of the earlier proxy
accepted during a migration (old request headers, old key folder) and the names of before the TaskLambda rename (`lib/skills.mjs` is its
old module path); both are deleted when no caller needs them.
