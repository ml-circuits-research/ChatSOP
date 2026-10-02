# omp (archived 2026-10-02)

Owner decision of 2026-10-02: no path of ChatSOP runs omp. Formalization (the request parser, strategy LLMDirect), knowledge authoring
(`POST /v1/author`), document ingestion, answer formulation and the evaluation tools call their models directly through the proxy
LLMAPIProvider (openference Qwen3.8 27b, then DeepSeek flash through OpenRouter). The omp integration is kept here as history only.

| Archived | Was | Replaced by |
| --- | --- | --- |
| `lib-omp/` (`run.mjs`, `rpc.mjs`, `models.mjs`, `agent-dir.mjs`, `author.mjs`, `index.mjs`) | the fenced `omp -p` run, the RPC session pool, the model listing (`GET /v1/omp/models`), the proxy overlay agent dir, the knowledge authoring loop `authorCircuits` | `lib/ingest/direct-author.mjs` (`directAuthor`), `lib/authoring/circuits.mjs` (file checks and validation helpers), `lib/llm-providers.mjs` |
| `omp-backend.mjs` (was `lib/query-author/backends/omp.mjs`) | the circuit author backend of the CodingAgent strategy | `completionBackend` and the LLMDirect strategy (`lib/formalize/strategies.mjs`, `server/query-parser.mjs`) |
| `omp.test.mjs`, `omp-rpc.test.mjs` | tests of the above | `tests/authoring-circuits.test.mjs`, `tests/query-parser.test.mjs` |
| `skill-omp-run/` (was `skills/omp-run/`) | the procedure for a fenced omp run | none (no omp runs) |

Measured reason: the omp CodingAgent took ~35 s per commonsense question (p95 142 s), 8 of 32 questions failed in transport (120 s
timeouts, prose instead of a circuit, closed streams). Path citations inside these files read as they did before the move.
