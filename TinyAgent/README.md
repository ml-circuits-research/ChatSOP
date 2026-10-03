# TinyAgent

A small agent for model work, in one folder, Node >= 22 built-ins only. ONE server per machine does everything that touches a model:
providers and intelligence tiers, rate and plan limits, throttling, local model servers (start, slots, idle stop), the response cache,
the audit store, costs and budgets, batch jobs, skills, SkillPlugins and a sandbox for plugins written on the fly. Programs, command
lines and other agents are thin clients of that server, through the library (`createTinyAgent`) or the CLI (`tinyagent`). Nothing else
calls a model API.

TinyAgent knows nothing about the project that uses it: project work (formalization, ingestion, reviews with a domain validator) comes
in as SkillPlugins, job folders and task templates named by the project's configuration layer.

## Quick start

```
node TinyAgent/bin/tinyagent.mjs serve                 # the server, http://127.0.0.1:18080 (first start writes ~/.tinyagent/)
node TinyAgent/bin/tinyagent.mjs chat --tier tiny "Say hello"
node TinyAgent/bin/tinyagent.mjs run "Extract the prices of the attached file" --attach prices.txt
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
| `runs/` | job runs, task folders and operations (`runs/ops/<id>/`: request, log, plan, result, generated plugins) |
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

Clients name a **tier**, never a model. A tier is a chain of `{upstream, model, prompt?, timeoutMs?, maxTokens?, extraBody?}` or the
name of another tier (an alias); the first entry whose provider has a key (or needs none) serves, the rest is its fallback.

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
  first model are stored: a cut answer (`finish_reason` length) or an empty one never is.
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
await ta.skill('extract-table', {columns: ['price']}, {attach: ['a.txt']});
await ta.run('Count the words of the attached file', {attach: ['a.txt'], planOnly: false});
await ta.skills(); await ta.stats(); await ta.models(); await ta.tiers(); await ta.health();
const tagged = ta.with({purpose: 'review:x', run: 'r1', priority: 'background'});
```

Options common to `chat`, `json` and the roles: `purpose`, `run`, `cache`, `priority`, `noFallback`, `timeoutMs`, `retries` (transient
failures), `headers`. A purpose is required: `chat`, `formalize`, `answer-*`, `ingest`, `job:<name>`, `review:<run>`, `skill:<name>`,
`run:<id>`, `test:<name>` pass the default policy.

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
`decisions.jsonl`, `summary.md`, `cost.json`, `run.json`); `index.jsonl` is append-only; `--resume <run-id>` continues an interrupted
run; `--publish <dir>` copies the summary to `<dir>/<date>-<job>-<run>.md`. Adaptive tiers: a job with `kind`, `ladder` and `quality`
starts at the cheapest tier that met the bar over its recent runs (`tier-stats.jsonl`), re-probing one tier lower now and then.

**Tasks** (`tinyagent task`, `ta.task`): instructions plus attachments; the planner role chooses a template of `runner.templatesDir`
(`template.json`: `kind` prompt (a job folder using `{{params.x}}`) or adapter (a module `run(ctx)`), `targets`, `params` schema, `budget`,
`ladder`, `ladderAllowed`) and fills its parameters; the plan is validated deterministically (one repair round). An adapter's `ctx` has
`ta` (the library, tagged with the task's purpose and run, so its budget applies), `params`, `attachments`, `target`, `taskDir`, `log`,
`context`.

## Skills and SkillPlugins

A skill is a module:

```js
export default {
  name: 'extract-prices',                       // lowercase, digits, . _ -
  description: 'Extract prices with their quotes from attached text.',
  inputs: {currency: {type: 'string', enum: ['EUR', 'USD'], default: 'EUR', description: '...'}},   // string, integer, number, boolean, string[], object
  async run(ctx) {                              // returns {status: 'finished' | 'failed', summary, ...any JSON}
    const text = await ctx.readAttachment(ctx.attachments[0].name);
    const r = await ctx.ta.json({tier: 'small', prompt: `...${text}`});
    return {status: 'finished', summary: JSON.stringify(r.json)};
  },
};
```

`ctx`: `ta` (the library inside the server, tagged `skill:<name>` and the operation's run), `inputs` (validated, defaults applied),
`attachments` (`[{name, path, bytes}]`), `readAttachment(name)`, `dir` (the operation folder, for outputs), `log(line)`, `jobs.runJob(dir,
options)` and `jobs.runTask(task)` (in the same operation), `config` (the merged configuration), `runner` (the runner configuration).
A module may also export `skills: [...]`.

Sources, in this order (a later one cannot replace a name): built-in skills (`TinyAgent/skills/`: `chat`, `json`, `job`, `task`,
`write-plugin`), the SkillPlugins of `skills.plugins` (files or folders), one skill per job folder of `skills.jobs` (`{name: dir}`, input
`stage`), and one skill per task template (its parameters plus `target`). Every operation (job, task, skill, run) runs in a worker thread
of the server: modules are loaded fresh for each operation, a crash does not stop the server, and every model call goes back to the
server's core over a message port. Operations are listed by `GET /v1/ops`; their folders stay under `runs/ops/`.

**`run`** (`tinyagent run "<request>"`, `ta.run`): the planner role (tier `good`) sees the skill catalog (names, descriptions, inputs;
never code) and answers `{"steps": [{"skill", "inputs"}], "reason"}`; the plan is validated deterministically (known skills, inputs in
their schemas, at most `run.maxSteps` steps; one repair round) and executed step by step, deterministically. A run registers one budget
(`run.budget`) for all its calls. `--plan-only` stops after the plan.

**Plugins written on the fly** (`write-plugin`, chosen by the planner when no skill fits): the planner tier writes a small program
`async function run(api, input)` against an allow-listed API (`prompts/plugin-writer.md`): `api.chat({tier, prompt, system?,
maxTokens?})` on the tiers of `sandbox.tiers` within `sandbox.maxCalls`, `api.listInputs()`, `api.readInput(name)`,
`api.writeOutput(name, text)` (into the operation's `outputs/`), `api.log(message)`. The program is written to the operation folder
(`plugin.js`) before it runs, and runs in the sandbox (`lib/sandbox.mjs`): a worker thread with heap, stack and wall-time limits and an
empty environment; inside it a fresh V8 context with only the ECMAScript built-ins (no require, import, process, fetch, timers, Buffer;
`eval` and `Function` disabled); only strings and numbers cross the boundary (JSON text parsed inside the context), so no host object is
reachable. A program that fails is shown its error once and rewritten. `test/sandbox.test.mjs` holds the escape attempts that must fail.

## Command line

```
tinyagent serve [--port N] [--host H] [--config file]
tinyagent run "<request>" [--attach file]... [--plan-only]
tinyagent skills | skill <name> [--inputs '{json}'] [--attach file]...
tinyagent job <dir> [--stage s] [--resume run-id] [--refresh] [--no-register] [--publish dir]
tinyagent check <dir> | list [job] | show <job> <run-id> | prune
tinyagent task --instructions "..." [--attach file]... [--target memory:<id>|session:<id>|none] [--template name --params '{json}']
tinyagent chat [--tier small] [--system "..."] "<prompt>"
tinyagent stats [--json] | health | models [start|stop <provider>] | ops [id]
tinyagent migrate-home [--yes]            # copy the data of the earlier proxy into ~/.tinyagent (verified, old folders untouched)
tinyagent probe --yes --model <id> [--upstream p] [--rates 0.5,1,2]   # measure a provider's real limits (spends quota)
```

(`tinyagent` is `node TinyAgent/bin/tinyagent.mjs`.) Common options: `--config` (project layer), `--url`, `--purpose`. Agents and
external tools use the CLI or the HTTP API; the CLI prints short summaries and leaves the rest in the operation folder.

## HTTP API

| Method and path | What |
|---|---|
| `POST /v1/chat/completions`, `/v1/messages` | OpenAI and Anthropic formats (streaming included); `model` is a tier or a model of the default provider |
| `POST /u/<provider>/v1/...` | a concrete provider |
| `POST /v1/structure`, `/v1/fol` | prompted JSON roles |
| `GET /v1/models`, `/health`, `/stats`, `/` | models and tiers, health (tiers, providers without keys), statistics, dashboard |
| `POST /jobs/register`, `/jobs/finish`; `GET /jobs` | run budgets |
| `GET /v1/local`; `POST /v1/local/<provider>/start` / `stop` | local model servers |
| `GET /v1/skills`; `POST /v1/skills/<name>` `{inputs, attachments}` | skills |
| `POST /v1/jobs` `{dir, stage?, resume?, refresh?, register?, publish?, priority?}`; `POST /v1/tasks`; `POST /v1/run` `{request, attachments, planOnly?}` | operations (202 `{id}`) |
| `GET /v1/ops`; `GET /v1/ops/<id>?wait=<s>&since=<n>` | operations; a long poll returns at the next log line or the end |

Request headers: `x-tinyagent-purpose`, `x-tinyagent-run`, `x-tinyagent-cache`, `x-tinyagent-priority`, `x-tinyagent-no-fallback`,
`x-client-name`. Response headers: `x-tinyagent-tier`, `-model`, `-fallback`, `-fallback-reason`, `-cache`, `-cache-key`. A token
(`TINYAGENT_TOKEN`, or in a key file) makes every request but `/health` need `Authorization: Bearer <token>`; the server listens on
127.0.0.1 by default.

## Files

`bin/tinyagent.mjs` (CLI); `lib/core.mjs` (routing, forwarding, limits, fallback, cache, audit, budgets, local servers, prompted roles),
`lib/server.mjs` (the server and its operations), `lib/client.mjs` (the library), `lib/worker.mjs` (an operation), `lib/inproc.mjs`
(in-process and port transports), `lib/config.mjs` (layers, home), `lib/settings.mjs` (keys), `lib/limiter.mjs`, `lib/plan.mjs`,
`lib/monitor.mjs`, `lib/cache.mjs`, `lib/audit.mjs`, `lib/guard.mjs`, `lib/local.mjs`, `lib/prompted.mjs`, `lib/skills.mjs`,
`lib/sandbox.mjs`, `lib/dashboard.mjs`, `lib/probe.mjs`, `lib/migrate.mjs`, `lib/jobs/` (the job runner), `skills/` (built-in skills),
`prompts/` (the runner's and the planner's own prompts), `config.default.json`, `test/`. `lib/legacy.mjs` holds the names of the
earlier proxy accepted during a migration (old request headers, old key folder) and is deleted when no caller needs them.
