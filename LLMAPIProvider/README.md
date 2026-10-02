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

## Add a provider

Add an entry under `upstreams` in `config.json` (base URL, env file and variable names, formats, limits, retry). No code changes.
