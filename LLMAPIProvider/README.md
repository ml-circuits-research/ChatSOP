# LLMAPIProvider

**Self-contained component** (owner, 2026-10-02): this folder is reusable in any project. The proxy uses Node built-ins only (Node >= 22) and imports nothing from outside the folder (its local services under `local-services/` have their own packages); ChatSOP talks to it only over HTTP. To reuse it, copy the folder, edit `config.json` (upstreams, tiers, `baseDir` for relative local-model paths) and put the keys in `~/.config/llmapiprovider/<upstream>.env`. Then `npm start` (or `node server.mjs`) and `npm test`.


A small, self-contained local proxy in front of an LLM API provider. It forwards OpenAI-format and Anthropic-format calls (streaming included), holds the provider key so clients never see it, queues requests under configurable rate limits, retries 429 responses, and records every call so you can see what the provider really lets you do. First upstream: openference (`https://api.openference.com`). Node >= 22, built-ins only.

## Run

```
node LLMAPIProvider/server.mjs            # 127.0.0.1:18080
node LLMAPIProvider/server.mjs --port 18081
npm run test:llmapi                       # stub upstream, no network (also part of npm test)
```

Secrets: `~/.config/llmapiprovider/openference.env` with `OPENFERENCE_API_KEY=...` and optionally `OPENFERENCE_BASE_URL=...` (or the same variables in the environment, which win). The key is never logged, never written to the repo, and is redacted from stored error bodies. `.env*` files and the data dir are gitignored. Nothing in `config.json` is secret.

## Client settings

- OpenAI-compatible (Cursor, Cline, omp, ChatSOP `completion` backend): base URL `http://127.0.0.1:18080/v1`, any API key string.
- Anthropic-compatible: base URL `http://127.0.0.1:18080`, any API key string.
- Endpoints: `GET /v1/models` (upstream list with pricing, context and quota multiplier, cached 10 minutes), `POST /v1/chat/completions`, `POST /v1/messages`, any other `POST /v1/*` is forwarded as is, `GET /health`, `GET /stats` (JSON), `GET /` (dashboard).
- Several upstreams: prefix the path with `/u/<name>` (default upstream otherwise).
- Client auth: the proxy listens on 127.0.0.1 only, so no token is required by default. Set `LLMAPIPROVIDER_TOKEN` in the env file or environment to require `Authorization: Bearer <token>` (or `x-api-key`, or `?token=` for the dashboard) on everything except `/health`. The client's own key is ignored; the upstream key is injected.

## Monitoring

Every upstream attempt (a retried 429 counts as its own attempt) is one JSONL line in `~/.local/share/llmapiprovider/requests-YYYY-MM-DD.jsonl` (override with `LLMAPIPROVIDER_DATA`): time, client, model, endpoint, format, stream, attempt, queue wait, status, latency, TTFT (streams), input/output/cached tokens from `usage`, request/response bytes, all rate-limit-like response headers (`x-ratelimit-*`, `retry-after`, quota, reset, request ids) and a redacted error summary. For OpenAI streams the proxy adds `stream_options.include_usage` so tokens are reported (`injectStreamUsage` in config).

The dashboard and `/stats` show calls per minute/hour/day/week per model, tokens, cost estimate (model-list pricing; cached tokens at the cache-read price), plan requests (calls x `quota_multiplier`, times the context surcharge factor above its threshold), error and 429 rates, latency percentiles, queue depth, inferred limits (the fewest calls seen in the second/minute/hour before each 429, and the highest successful rates), every rate-limit header seen, and a token honesty check (provider-reported input tokens over a chars/4 estimate of the prompt; a persistent ratio far above 1 means the provider counts more than you sent).

## Rate control

Per upstream (`config.json` `limits`): `maxConcurrent`, `maxPerSecond`, `maxPerHour` (null = unlimited). Requests wait in a FIFO queue; none is dropped. On 429 the upstream queue pauses for `retry-after` (else `baseMs * 2^n`), capped by `maxWaitMs`, and the request is retried up to `retry.max` times; after that the 429 is returned to the client. The defaults are conservative guesses until `probe.mjs` has measured the real limits.

`probe.mjs` spends real quota: it sends tiny requests directly to the upstream at rising rates and stops at the first 429 (dry run without `--yes`):

```
node LLMAPIProvider/probe.mjs --yes --model GLM-5.2 --rates 0.5,1,2,3,5 --step-seconds 20
```

## Plan limits and value

Each upstream can declare `plan: {priceUsdPerMonth, limits: [{name, unit, window, max, mode?, anchor?, provider?}]}`. `unit` is `calls` (every upstream attempt, 429s included), `credits` (sum of the model's quota cost per successful call: `x-quota-cost`, else `quota_multiplier` with the context surcharge) or `tokens` (input plus output). `window` is `60s`, `5h`, `7d`, ... (`ms|s|m|h|d|w`), rolling by default; `mode: "fixed"` with an ISO `anchor` uses calendar-like blocks. `provider` names the response headers that carry the provider's own count (`remainingHeader`, `costHeader`, `resetHeader` as epoch seconds).

- `/stats` `plan.<upstream>`: per limit used, max, remaining, percent, `warn` at 80%, `exceeded`, time to the next relief (the oldest counted call leaving the window, or the provider's reset when it sends one), the provider's remaining next to ours and an agreement check since the provider's last reset (`provider_used` vs `our_used`; a persistent `diff` means the provider counts differently from us). The dashboard shows the same with bars and highlights limits at 80% or more.
- The queue pauses (never drops) a call that would exceed a declared limit, using the model's estimated credit cost plus the cost of calls in flight; the reason is `upstreams.<name>.gateReason`. `limits.maxPerMinute` and `maxPerHour` stay as plain queue limits.
- `/stats` `value.<upstream>` (and the dashboard): tokens (fresh input, cached, output) of plan-billed successful calls per day, week and month, what they would have cost at the openference list prices and at each price in the top-level `compare` table (`inputUsdPerM`, `outputUsdPerM`, `cachedInputUsdPerM`), against the prorated subscription price, a projection of the observed span (at least one day, at most 30) to 30 days, and a one-line `verdict` against the cheapest alternative. Alternatives assume equal quality; credit-billed models are excluded.
- `compare` DeepSeek prices come from DeepSeek's public pricing page (read 2026-10-02): `deepseek-flash` (V4.1-Flash) input cache miss 0.30 USD per M at peak and 0.15 off-peak, cache hit 0.006 / 0.003, output 1.20 / 0.60. Peak is 01:00-04:00 and 06:00-10:00 UTC on weekdays. Re-check them before deciding; prices change.
- Restarts: the request logs (31 days kept) are reloaded, so the rolling windows, the queue's recent start times and the value tables are rebuilt on start.

## Add a provider

Add an entry under `upstreams` in `config.json` (base URL, env file and variable names, formats, limits, retry). No code changes.

## openference plan (observed 2026-10-02)

- Calls need `Authorization: Bearer <key>`; the model list is public.
- Rate limit: 15 requests per minute (`x-ratelimit-*`).
- Quota: a 5-hour window of about 400 plan requests; each call costs its model's `quota_multiplier` (`x-quota-cost`: `Qwen3.8 27b` 0.1, `GLM-5.3-Flash` 1), and about 4,000 requests per 5 hours. `maxPerHour: 800` spreads them over the window.
- Credit-billed models (for example `DeepSeek-V4.1-Flash`) are not in the plan; they need a credit balance.
- Calibration (36 book problems): `Qwen3.8 27b` 32/36 at ~38 generated tokens/s (p50 12.5 s per problem); `GLM-5.3-Flash` 32/36 at ~39 tokens/s (p50 7.9 s).

## Other upstreams: OpenRouter and DeepSeek

Each upstream is monitored separately; a client picks one with the path prefix `/u/<upstream>/` (no prefix = `openference`).

- `openrouter`: pay-as-you-go credit, key in `~/.config/llmapiprovider/openrouter.env` (`OPENROUTER_API_KEY=`). The real cost of every call is OpenRouter's `usage.cost` (USD), stored as `usd` in the request log and summed as `cost_usd` in `/stats`. Example: `POST http://127.0.0.1:18080/u/openrouter/v1/chat/completions` with `model: "deepseek/deepseek-v4-flash"`.
- `deepseek`: the official API, key in `~/.config/llmapiprovider/deepseek.env` (`DEEPSEEK_API_KEY=`); not configured yet.

## Fallback

`config.json` `fallback` (one entry or a list): `{from, upstream, models, maxWaitMs}`; `from` defaults to `defaultUpstream`, `models` maps a requested model to the fallback model (`"*"` for any). Today: `openference` `Qwen3.8 27b` falls back to `openrouter` `deepseek/deepseek-v4-flash` with `maxWaitMs` 120000.

- The request goes to the fallback when the primary is unreachable or answers 5xx after `retry.max5xx` retries (openference: 2), answers 429 after `retry.max` retries or with a `retry-after` above `maxWaitMs`, or when the queue, the plan-limit gate or the 429 pause would make it wait more than `maxWaitMs` before it starts (checked before the call; jobs already queued are not simulated). The fallback upstream's own error is returned as is; there is no second fallback.
- Every fallback is marked: the response carries `x-llmapiprovider-fallback: <upstream>/<model>` and `x-llmapiprovider-fallback-reason: unreachable|5xx|429|wait`; the request log has `fallback_from`, `fallback_model`, `fallback_kind`, `fallback_reason` on the fallback call and `fallback_to` on the last failed primary attempt; `/stats` `fallback` (total, hour, day, by kind, by route, last 10), `windows.*.fallbacks` and the dashboard show the count; `/health` lists the configured fallbacks.
- Opt out per request with `x-llmapiprovider-no-fallback: 1`, for runs that must stay on one model (calibrations, A/B arms). The bulk reviewer (`lib/llm-review`) always opts out.
- Only OpenAI-format requests fall back (the OpenRouter upstream has no Anthropic endpoint).

## Bulk review with a cheap model

`node tools/llm-review.mjs run --kind <kind> --input items.jsonl --out DIR` (`lib/llm-review/`, review kinds in `config/review/<kind>/`). Input tokens are cheap and output tokens dear, so one call reviews many items (a token budget per batch, shared source passages printed once) and the model writes only `{"id","problem","severity"}` lines for items with problems, then `{"done":true}`; a malformed answer is retried once. Confirmed problems (high at once, medium only when a second pass agrees) are repaired by the same model, checked by the SOP validator and reviewed again; only what stays unresolved goes to `escalations.jsonl` and a summary of at most 10 lines. Cost per stage comes from OpenRouter `usage.cost` and is cross-checked against this proxy's log (client name `llm-review-<id>`, purpose `review:<id>`).

Calibration (2026-10-02, 30 items, 10 planted errors: wrong number, dropped condition, hedge turned certain, wrong relation): `deepseek/deepseek-v4-flash` with low reasoning found 10/10 with 0/20 false alarms; without reasoning 7/10 (1/20 false alarms); `deepseek/deepseek-v4.1-flash` without reasoning 9/10 (2/20). The kinds default to v4-flash with low reasoning, 20k-token batches and 32k output tokens (reasoning overflowed 8k tokens on an 18-item batch).

## Tiers, local model and audit (owner, 2026-10-02)

Clients and jobs name a **tier**, never a concrete model: `POST /v1/chat/completions` with `model: "tiny"|"small"|"medium"|"good"|"best"`. The chain of each tier is in `config.json` `tiers`; the first usable entry serves, the rest is its fallback (header `x-llmapiprovider-fallback`). The response carries `x-llmapiprovider-tier` and `x-llmapiprovider-model`; `/v1/models`, `/health` and `/stats` list the tiers, and `/stats` has `last24h.by_tier`, `by_purpose`, `by_upstream`.

| Tier | Serves | Fallback |
|---|---|---|
| tiny | `local` Qwen3-4B (llama-server, port 19611) | openrouter deepseek-v4-flash |
| small | openference Qwen3.8 27b | openrouter deepseek-v4-flash |
| medium | openrouter deepseek/deepseek-v4-flash | none |
| good | openrouter deepseek/deepseek-v4.1-flash | none |
| best | not configured: a request is a 400 error naming the tier | none |
| structure | alias of `structure-gliner`: `smallmodels` GLiNER2.5 base (local service, port 19612, CPU), `POST /v1/structure` (JSON, not chat) | none |
| formalizer | alias of `formalizer-t5`: `smallmodels` T5-base NL-to-FOL (same service), `POST /v1/fol` (JSON, not chat) | none |
| structure-tiny | `local` Qwen3-4B with the role prompt `prompts/psm-v1.md` (same `/v1/structure` contract) | none |
| formalizer-tiny | `local` Qwen3-4B with `prompts/fol-v1.md` (same `/v1/fol` contract) | none |
| formalizer-t5-3b | `smallmodels` T5-3B NL-to-FOL (ONNX with external data, CPU, ~9 tokens/s) | none |
| formalizer-llama-fol | `localfol` Llama-3.2-1B NL2FOL GGUF (llama-server on demand, port 19613, stopped after 15 idle minutes) with `prompts/fol-plain-v1.md` | none |

- **Small-model local service** (owner, 2026-10-03: everything that serves models lives here): `local-services/small-models/` serves the two small non-chat models of the formalization architecture, GLiNER2.5 base (tier `structure`, `POST /v1/structure`) and T5-base NL-to-FOL (tier `formalizer`, `POST /v1/fol`), as the managed upstream `smallmodels` (port 19612), exactly like the llama-server of `tiny`: the proxy starts it with itself (`startAtBoot`), restarts it on demand when it is not healthy, and clients only ever name the tiers. It is a script upstream: `start.script` (run with the proxy's Node and `--port`), `start.requires` (files that must exist, else the start is refused and logged), `start.identity` (weight files whose size and mtime enter the cache key). Hardware: CPU only, because onnxruntime-node 1.30 ships no CUDA provider for linux-arm64; each model uses at most 4 intra-op threads, one inter-op thread and no spin-waiting (measured: median about 3 cores, peak about 5, during a probe; GLiNER median 0.35 s per book problem, T5 about 87 tokens/s). The service has its own `package.json` (transformers.js 4.3.0, onnxruntime-node 1.30.0; `npm install` in its folder) and its tests (`server.test.mjs`, fake backends) run with the proxy's. API and models: `local-services/small-models/README.md`.
- **Swappable backends and prompted tiers** (owner, 2026-10-03): `structure` and `formalizer` are aliases (a tier may name another tier) of one of their variants, so the backend is chosen in `config.json` without client changes. A tier entry with `prompt` (e.g. `{upstream: "local", model: "Qwen3-4B", prompt: "psm-v1"}`) serves `/v1/structure` or `/v1/fol` with a chat model: `prompted.mjs` fills the template `prompts/<name>.md` (sections `<<<options>>>`, `<<<system>>>`, `<<<user>>>`, `<<<again>>>`), sends the chat call through the proxy's own forwarding (queued, logged, tagged with the tier), validates the reply deterministically (JSON shape, known labels, spans copied verbatim and located by offset, relations between span texts, sentence numbers, balanced parentheses, a query when a sentence asks), re-asks once naming the problems, drops what stays invalid (`dropped`, `unresolved`, `reasks` in the answer) and answers in the dedicated model's contract. The template's hash is part of the cache key. `/v1/fol` accepts `context.inventory` (the structure inventory as text) for a shared vocabulary; a prompted formalizer returns per sentence one candidate of one or more lines, a line starting with `? ` being a query.
- **JSON tiers**: `structure` and `formalizer` are not chat models. A client posts `{model: "structure", text, entities, relations?}` to `/v1/structure` or `{model: "formalizer", inputs: [sentence], candidates?}` to `/v1/fol` (the endpoints are the upstream's `formats`; a tier asked on another path is a 400). Forwarding, purpose tags, the request log and the cache work as for chat; a JSON answer is cached when it is a 200 without an `error` field.

- **Local upstream** (`upstreams.local.start`): Qwen3-4B is always on (owner, 2026-10-02): the proxy starts llama-server when it starts (`startAtBoot`), reuses a server already on port 19611 and restarts it on demand; a GPU reservation lock file blocks a start. Measured: ~75 tokens/s, ~0.22 s for a short answer. A start that fails falls back down the tier's chain (reason `unavailable`; `/stats` `local` shows the last refusal). Options `requireFreeGpu` and `idleStopMs` exist but are off.
- **Tags:** send `x-llmapiprovider-purpose` (`chat`, `formalize`, `job:<name>`, `review:<run>`) and optionally `x-llmapiprovider-run`; they go into the request log, the stats and the audit store.
- **Audit store** (`config.audit`): request/response pairs of the tiers `tiny`, `small`, `medium` are kept in `~/.local/share/llmapiprovider-audit/audit-<day>.jsonl` (200 MB per day, 14 days). A periodic review by the `medium` tier reads them during and after batch work; chat traffic is only logged for later audit.

## Jobs: budgets and the purpose policy

`jobs.mjs` (config `jobs`). Clients tag requests with `x-llmapiprovider-purpose` and, for a batch run, `x-llmapiprovider-run`; both are logged (`purpose`, `run`) and grouped in `/stats` `last24h.by_purpose`.

- `POST /jobs/register {job, run, purpose?, budget: {usd?, credits?, calls?}}` registers a run (at least one budget; a run id once); `POST /jobs/finish {run, status}` closes it; `GET /jobs` (also `/stats` `jobs`) lists spend per job and per run, the untagged count and refusals. Registrations are an append-only log `<dataDir>/jobs/runs.jsonl` (kept `keepDays`).
- A request of a registered run is refused once the run's spend reaches its budget: `402 {"error": {"type": "budget_exceeded"}}` (spend from the request log: provider-reported USD, plan credits of plan upstreams, successful calls), and after the run finished: `403 run_finished`.
- `allowedPurposes` (exact names or `prefix*`; default `chat`, `formalize`, `answer-*`, `ingest`, `job:*`, `review:*`, `test:*`) pass. Any other request, without a purpose or with an unknown one, counts against `untaggedDailyMax` per local day (default 100) and is refused beyond it: `403 untagged_limit`. Admitted untagged requests are logged `untagged: true`, so the count survives a restart.
- The job runner `LLMJobs/` registers every run and task; the proxy and the runner share only HTTP and these headers.


## Interactive priority (owner, 2026-10-02)

Requests whose purpose is in `config.interactive.purposes` (`chat`, `formalize`, `answer-*`) go to the front of each upstream queue (FIFO within a priority) and fall back down their tier chain when the expected wait exceeds `interactive.maxWaitMs` (15 s), so a person is never kept behind batch jobs on the 15 requests/minute openference plan. Batch purposes (`job:*`, `review:*`, `ingest`) keep the long wait.

## Response cache (owner, 2026-10-02)

Responses are cached by default (`config.cache.defaultMode: "use"`): the same request gets the same answer, without a model call or cost. The key is the whole request body (messages, model or tier, sampling settings; `stream` excluded) plus the target and the identity of the model behind it (a tier's first chain entry; a local GGUF's size and mtime), so a changed prompt, setting or model is simply a new key and nothing is invalidated by hand. Header `x-llmapiprovider-cache`: `off` (bypass), `use`, `strict` (a miss is refused with 409 `cache_miss` and no model is called: regressions that must not call models), `record` (call and refresh). Only complete non-streamed 200 answers of the tier's first model are stored (a fallback answer is not). Entries: `~/.local/share/llmapiprovider-cache/`; counts in `/stats` `cache`; a hit is logged with `upstream: "cache"` and response header `x-llmapiprovider-cache: hit`.
