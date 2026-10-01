---
title: DS030-capability-apis
summary: Capability APIs and caching - one independent HTTP endpoint per capability (proofread, understand, symbolic rewrite, symbolic analyze, emotion detect), the shared request and answer contract, the never-total-failure principle with the clarify field, the version-keyed bounded caches with in-flight de-duplication and their statistics, the reuse of cached calls by the chat's formalize request, and the independent flow of the chat page.
---

## Introduction

Owner decision of 2026-10-01: the server has, and documents, a distinct API for every capability that other projects can use independently of the chat: language proofreading, showing what was understood from a sentence (the interpretation CNL with its certification), the SymbolicProofingLLM rewrite, the SymbolicLM analysis and emotion detection. The chat page uses exactly these APIs, one by one, and shows partial results as they arrive. Every expensive call sits behind a small cache so that the final reasoning request reuses the calls the page made earlier. Analysis never fails totally: it always returns what was understood and marks the rest so that a clarification can follow.

The model boundary of AGENTS.md and [DS021](specsLoader.html?spec=DS021-model-surface.md) is unchanged. These endpoints are host-side services around the components; none of them changes the formalizer's input, which stays the user's message alone, and none writes to the repository. [DS012](specsLoader.html?spec=DS012-local-server.md) owns the server, its authentication and its pages; this specification owns the capability contract and the caches. The human-readable reference with executable examples is `docs/api.html`.

## Core Content

### Endpoints

All routes are under `/v1`, JSON in and out, and implemented by `server/api.mjs` (routing, validation, limits) over `server/capabilities.mjs` (the capabilities and their caches).

| Endpoint | Capability and component | Parameters besides `message` |
| --- | --- | --- |
| `POST /v1/language/proofread` (alias `POST /v1/text-to-clean-english`) | textToCleanEnglish: a clean English proposal, sentence by sentence; Romanian and mixed sentences go to the translator LLM (`translator-llm`, Qwen3-4B-Instruct Q4_K_M), English ones to LanguageProofingLLM; `routes` per sentence, `fallback` and `warnings` when the translator could not run | `sendAll` |
| `POST /v1/understand` | SymbolicLM analysis, interpretation CNL per sentence, certification, not-represented spans, leftovers with their pragmatic kind, rewrite trace, `clarify`; optionally after the gated SymbolicProofingLLM rewrite and with the pragmatic signals | `rewrite` (`off`, `gated`, `always`), `accept`, `emotion`, `interpret` |
| `POST /v1/symbolic/rewrite` | SymbolicProofingLLM alone, gated or always, with the unit trace | `mode` (`gated`, `always`), `accept` |
| `POST /v1/symbolic/analyze` | the raw SymbolicLM result: SOP, compact analysis, route, language, uncertainty | `rewrite`, `accept` |
| `POST /v1/emotion/detect` | EmotionDetectionSystem ([DS029](specsLoader.html?spec=DS029-emotion-detection.md)): signals, emoticon suggestions, the advisory `pragmatic` circuit, advice | `hasContent` |
| `GET /v1/capabilities` | the endpoint list, the component versions, the limits and the warm state (`warm`) | none |
| `GET /v1/server/models` and `POST /v1/server/models` | what the server keeps open: per managed model the mode (`keep_open`, `on_demand`, `off`), the live state, warm flag, measured memory, last use and start cost; change modes, `maxRunning`, `idleMinutes`, `memoryBudgetMb`, `turnWindowSeconds`, `warmup` (persisted in `config/server-models.json`) | `models`, `maxRunning`, `idleMinutes`, `memoryBudgetMb`, `turnWindowSeconds`, `warmup` (no `message`) |
| `GET /v1/cache/stats` and `POST /v1/cache/clear` | per-cache statistics, and emptying the caches (any authenticated user) | none |

`POST /v1/text-to-clean-english` stays and is the same handler as `/v1/language/proofread`; its answer is a superset of the earlier one. `POST /v1/chat/completions` keeps its `understanding` and `cleaning` fields.

### Request contract

Authentication is the server's own ([DS012](specsLoader.html?spec=DS012-local-server.md) "HTTP contract"): a bearer token or the administrator session, checked before any route; the cache endpoints need no more than that (owner decision of 2026-10-01: no administrator role). A request body is one JSON object holding a non-empty string `message` and only the parameters of its endpoint; an unknown parameter, a wrong type or an unknown enumeration value is refused with 400, a message over `maxContextBytes` (default 4800 bytes) with 413, a body over `maxRequestBytes` with 413, and more than `maxConcurrentApi` (default 16) simultaneous capability requests with 429. Errors have the standard form `{error: {message, type: "invalid_request_error", code}}`; only an invalid request, a limit or authentication is an HTTP error.

### Answer contract

Every capability answer is HTTP 200 with:

- `object`: the result type (`language.proofread`, `symbolic.understanding`, `symbolic.rewrite`, `symbolic.analysis`, `emotion.detection`);
- `status`: `ok`, `partial` (something was understood or done, something failed) or `unavailable` (nothing could be done by the component);
- `errors`: a list of `{component, code, message, span?}` for every component that failed, `[]` when none did;
- `timings`: `total_ms` of this request and `compute_ms`, the duration of the computation that produced the result, so that a cache hit shows the cost it saved;
- `cache`: `hit` when every expensive component of the request came from a cache (a stored entry or a computation already in flight), otherwise `miss`; `cache_detail` gives the status of each component (`hit`, `miss` or `shared`);
- `versions`: the API version `capability-api-v1` and, for each component the request used, its version: the SymbolicLM and interpretation versions, the registry model id, run id (the run directory of the model file), file and stamp (size and modification time) of each language model, and the signature of the tone configuration with its strategies.

### Never a total failure

Principle (owner, 2026-10-01): analysis never fails totally; it always returns what was understood, with the failures marked so that they are detectable and intelligible. Consequences:

- A component that cannot run (a model that cannot start, a service that crashes) is reported in `errors` and `status`, never as an HTTP error, while the other components still answer: `/v1/understand` returns the pragmatic signals when SymbolicLM is down; `/v1/language/proofread` leaves a sentence whose model failed as written and lists it in `errors` with its `span`, and when the translator LLM cannot run it has LanguageProofingLLM answer the sentence and reports that in `fallback` (`{from, to, reason, sentences}`) and in `warnings`, never silently (an answer with a fallback is not cached); `/v1/symbolic/rewrite` returns the input unchanged with `status: "unavailable"`.
- **English-only core (DS021 "Input languages and content words").** `/v1/understand`, `/v1/symbolic/analyze`, `/v1/symbolic/rewrite`, `/v1/route` and the chat translate a Romanian or mixed message into English (textToCleanEnglish, names, numbers and quotations masked) before SymbolicLM; the response then carries `input_translation` (`original`, `english`, `language`, `backend`, `masked`, `fallback`) and `analysed_text` is the English. When no translation can run the component error is `backend_unavailable` (status `unavailable`) and the message is not analysed. The chat answer for another language is translated from English; its trace carries `answer_translation` and `english_text`.
- If the SymbolicLM call for the whole message fails, `/v1/understand` analyses the sentences one by one (the host splitter of `lib/sentence-split.mjs`): the sentences that succeed keep their interpretation, a sentence that fails is a row with `status: "failed"`, its text as the only not-represented span and the reason in `error`.
- The interpretation marks what it cannot show: a sentence whose round trip fails is `uncertain` (no CNL, a raw analysis summary), a span the CNL does not use is in `not_represented`, a certification that cannot be established is `null` or `false`. Spans that the EmotionDetectionSystem classifies (a greeting, politeness) are listed in `leftovers.classified` with their kinds and are not unclear; the others stay in `leftovers.remaining`.
- `clarify` is a ready follow-up message: `I did not understand: "a", "b". I am not sure I understood: "s". Could you rephrase it?` (the first part for not-represented spans and failed sentences, the second for uncertain sentences), or `null` when everything was represented. `clarify_items` lists `{kind: not_represented|uncertain|failed, text}`. The interface may send `clarify` to the user; the server never sends it by itself.

### Caches

`lib/cache/lru.mjs` provides one bounded cache used everywhere:

- **Key**: `cacheKey(capability, version, input, options)`, the SHA-256 of the canonical JSON (sorted object keys) of its parts. The version is the registry model file path with its size and modification time, together with the SymbolicLM version; the input is the exact message or sentence; the options are every setting that changes the result (`sendAll`, the rewrite mode and acceptance, `interpret`, the tone configuration and the leftover spans). A different option is a different entry, and replacing or switching a model never serves a result of the old one.
- **Bounds**: at most `maxEntries` entries and `maxBytes` approximate bytes (the JSON length of the value); the least recently used entry is evicted first; an entry larger than the byte bound is not stored; an entry expires after `ttlMs` (15 minutes; 30 minutes inside the SymbolicLM service). The defaults hold tens to hundreds of recent entries per cache, not millions.
- **In-flight de-duplication**: concurrent identical requests share one computation (a map of pending promises); followers report `shared`. All state changes are synchronous between awaits, so the cache is correct under parallel multi-user use inside one process.
- **Failures**: a failed computation rejects every waiter and is not stored; `failureTtlMs` (default 0) can remember a failure briefly and mark it (`failureHits` in the statistics). A degraded result (a sentence whose model failed, a rewrite model that could not start) is never stored (`cacheable`).
- **Places**: `proofread` (the proofread answer), `proofread-llm` (one LanguageProofingLLM call per sentence), `symbolic-lm` (the SymbolicLM service call: SOP, analysis and interpretation; shared by `analyze`, `understand`, `rewrite` and the chat's formalize request), `symbolic-proofing-llm` (one SymbolicProofingLLM call per sentence), `emotion` (the tone detection of a message with its leftover spans). Inside the SymbolicLM service, `SymbolicLM.parse` (the Stanza parse of a text), `SymbolicLM.inspectUnit` (the default-versus-accurate certification of a sentence) and the rewrite backend call are cached the same way, keyed by the Stanza package and the rewrite model version the host passes as `symbolic_lm.rewrite_version`.
- **Statistics**: `GET /v1/cache/stats` returns, per cache, `entries`, `bytes`, `maxEntries`, `maxBytes`, `ttlMs`, `hits`, `misses`, `shared`, `evictions`, `expired`, `failures`, `failureHits`, `tooBig`, `inflight` and `hitRate`, plus the caches inside running services (read from their `/health`; the endpoint never starts a service).

### Model lifecycle and latency

The capabilities share the model processes of `ModelManager`; the lifecycle is specified in [DS012](specsLoader.html?spec=DS012-local-server.md) "Model lifecycle" and summarised here for the API user.

- **Keep open, on demand, off.** `GET /v1/server/models` returns `{object: 'server.models', settings, modes, models, running, memory, warm, file}`; each model row has `mode`, `state` (`stopped`, `starting`, `ready`, `error`), `warm` (its probe request was answered), `pid`, `memory_mb` (measured resident memory of the process tree while running), `memory_estimate_mb`, `last_used`, `idle_s`, `busy`, `start_ms` (the last measured start) and `start_estimate_ms` (what a start would cost). `POST /v1/server/models` takes a partial object and returns the same view; it is validated first (400 `invalid_settings`, `unknown_model`, `invalid_parameter`, `unsupported_parameter`) and applied, then persisted. The four pipeline models (SymbolicLM, LanguageProofingLLM, the translator LLM, SymbolicProofingLLM) are `keep_open` by default.
- **Warm state.** `GET /health` (no authentication) and `GET /v1/capabilities` report `warm`: `state` `disabled`, `warming`, `warm` or `partial`, `ready` (every kept-open model runs and was probed), `ms`, `resources` (the cleaning gate's word lists), and per model `mode`, `state`, `warm`, `start_ms`, `probe_ms`.
- **Never evicted in a turn.** `proofread`, `understand`/`analyze`/`rewrite` and the chat's formalize request hold the models they use for the whole call (`manager.hold`); a start that would need to evict a held, busy or kept-open model fails with 503 `formalizer_capacity` (retryable) instead. A model that is `off` fails with `model_off` and the capability degrades as for any component that cannot run.
- **No duplicate analysis.** `analyze` accepts `interpret`; a request without the interpretation reuses a stored (or already running) interpreted call with the same message and rewrite setting, and `POST /v1/route` calls the analysis with the rewrite setting of the `understanding` it receives, so one chat turn analyses a message once: the page's `/v1/understand`, `/v1/route` and the formalize request share `symbolic-lm` cache entries.
- **Greetings.** `POST /v1/language/proofread` answers a pure greeting or thanks that the gate finds clean English without a model call (`skipped: [{start, end, why: 'greeting'}]`, `backend: 'none'`), configurable by `llm.skipGreetings` of `config/text-to-clean-english.json`; the sentences of a longer message are cleaned in parallel.

### Reuse by the chat

The chat's formalize request (`POST /v1/chat/completions`, mode formalize, SymbolicLM) obtains its analysis through the same `symbolicCall` as `/v1/understand`, with the same message and settings, and its tone detection through the same `emotionFor` as the emotion endpoint; the service is always asked with `emotion: false` and the tone detection runs on the host, cached. A page that has just called `/v1/understand` therefore pays nothing for the analysis of the answer, and a formalize request that races a pending `/v1/understand` of the same message joins its computation.

### The chat page

The page calls the independent APIs one by one and shows each result as soon as it arrives (a result never waits for a slower one):

1. `POST /v1/language/proofread` proposes the clean English; the user accepts, edits or sends the original.
2. After the final text is fixed, `POST /v1/emotion/detect` and `POST /v1/understand` start together with the formalize request. The emotion result appears as emoticons next to the user's message, each with a tooltip giving the kind, score and span. The understand result appears as the "I understood:" panel under the message (collapsed to one line, click to expand): the CNL per sentence, certified badges, the not-represented spans highlighted in the message, the rewrite trace and a separate, labelled list of leftover spans with their pragmatic kind. A `clarify` message is offered as a suggestion the user may send.
3. The formalize answer follows and reuses the cache.

The Settings toggles (clean before formalizing, send every sentence, SymbolicProofingLLM rewrite, detect tone and courtesy, show what I understood) stay, and the page works at phone width and in the light and dark themes.

### Product endpoints

The same server hosts the endpoints of the product layer, specified in [DS031](specsLoader.html?spec=DS031-sessions-and-base-memories.md) and documented with executed examples in `docs/api.html` sections 10 to 14: base memories (`/v1/memories`), sessions (`/v1/sessions`, drafts, settings, commit, theory, query, `scope-answer`), the omp model list (`GET /v1/omp/models`, administrator), the authoring path (`POST /v1/author`) and the routing decision (`POST /v1/route`, which returns a `suggestion` from the scope detector or a detected SymbolicLM failure and never starts the coding agent by itself). They share the authentication, the error shape and `GET /v1/capabilities` (which lists them) with the capability endpoints; they take the parameters listed per endpoint instead of `message`, and writes to base memories and the commit need the administrator session.

### Verification

`tests/cache-lru.test.mjs` covers the cache (hit and miss by option, eviction by count and bytes, TTL, 50 concurrent identical requests with exactly one computation, a multi-user parallel run with mixed keys, failures not cached or cached briefly). `tests/capability-api.test.mjs` runs every endpoint against stub model processes, counts the real model calls to show the hits, checks validation and authentication, partial answers and `clarify`, the key change on a model switch, the reuse by the chat's formalize request, and executes every example of `docs/api.html` and compares the documented response keys with the live answer. `eval/reports/current/api-ui/` holds the measured timings before and after the cache and the browser screenshots.
