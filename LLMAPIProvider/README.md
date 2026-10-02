# LLMAPIProvider

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
