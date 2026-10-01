# ChatSOP

**Goal: beat small LLMs at reasoning through symbolic processing, and help small LLMs reason symbolically.** ChatSOP runs checked SOP circuits against reviewed, time-aware knowledge and answers with evidence. A person or tool can supply a full circuit; in the chat, a **coding agent (omp)** writes the circuits from the user's message, in any language, and nothing else.

The chat pipeline: user message -> `lib/query-author` through the omp coding agent (a model from the configured subscription chain, default `openai-codex/gpt-6-luna`; it receives the message and the memory vocabulary and writes only circuits: queries, and session definitions or assumptions marked `assumed`; it never answers and never states facts) -> the validator (bounded repair rounds) -> the KnowledgeLinker (entity strings to the base memory) -> the StrategyRouter (`reasoning/router/`) -> a reasoning strategy or the oracle -> a deterministic English rendering of the result packet (`sop/answer-text.mjs`; omp may later formulate the final answer). There is no fallback parser: when no model is available the answer is an honest `parse_unavailable`. Answers are English. The validation procedure is the benchmark in `experiments/proposal/symbolic-vs-llm-benchmark.md` (still to be built).

The branch of small models for translation, proofing and circuit generation (Stanza, SymbolicLM, the proofing and translator models, training, the datasets, the corpus audit) is frozen and lives in `probably_obsolete/tinyLLMExperiments/` (paused work in `probably_obsolete/paused/`).

SOP (properly *SOP Lang*) comes from *Standard Operating Procedure*: the language is an attempt to formalize standard operating procedures, and the facts, questions and constraints they rely on, as inspectable, executable text.

## Prerequisites

Use Node.js 22.13 or newer, including the built-in `node:sqlite` module. The symbolic CLI uses Node built-ins and the root `package.json` has no third-party npm dependencies. SWI-Prolog and Z3 are optional reasoning backends and are not needed for the reference route (the `js-reference` oracle in JavaScript). The omp coding agent is needed only for the chat and the author API; dependency records are in [dependencies.md](dependencies.md). Do not download a model or install an optional solver to run a symbolic example.

On the prepared ARM64 host, explicitly select the private native solvers:

```sh
Z3_BIN="$PWD/tools/.solvers/z3/bin/z3" \
SWIPL_BIN="$PWD/tools/.solvers/swi/swipl" node tools/verify.mjs
```

Their local binaries and pinned provenance are separate from the source checkout.
Without them JS remains available; skipped/fallback checks are not external executions.

## Run a local circuit

From the repository root:

```sh
node server/cli.mjs help
node server/cli.mjs init
node server/cli.mjs run --file examples/query.sop
```

`init` publishes a reviewed fictional fixture into the configured local state directory; `run` executes the specified `.sop` file. Other checked commands include `validate --file <path>`, `compile-smt --file <path>`, `compile-prolog --file <path>`, `fork`, `commit`, `discard`, `stats`, `maintain`, and `gc` (a dry run without `--apply`). The path passed to `--file` is the caller's input path. A separate configuration can be selected with `--config <runtime.json>` (the shipped `config/runtime.json`, or one of your own); a runtime configuration chooses the physical memory engine and reasoning strategy independently. `node examples/reasoning-demo.mjs` exercises the bundled symbolic demonstrations; `npm test` and `npm run verify` invoke repository checks without claiming neural evaluation. Commands can write state or reports; inspect the selected configuration and target paths first.

Memory and reasoning are chosen by the runtime configuration under `config/`, independently of each other. `memory.engine` selects one of five banks: **RecallMemory** (`recall-memory`, several hashed views that must agree, inspired by the column voting of *A Thousand Brains*), **HoloMemory** (`holo-memory`, superposed codes in fixed signed-counter banks), `sqlite`, `scan` or `hybrid` (exact SQLite evidence plus associative hints). Their contracts, verified status and the experiments still needed before any claim are in `docs/specs/DS005-memory.md` and DS016–DS021.

## Circuits and the chat

The coding agent writes one keyword per line and quoted strings for names; the memory vocabulary supplies predicate ids. "Who works at Acme?" becomes a query circuit such as

```sop
@q query
  where works_at ?who "Acme"
  select ?who
```

and the KnowledgeLinker resolves `"Acme"` to an entity of the base memory. Circuits written by people or tools use positional atoms with whitespace-separated terms, for example `where temperature room_a ?degrees`; parentheses and commas are not SOP relation delimiters. Quote a multiword term, such as `"Maria Ionescu"`. Use explicit `all`/`any`/`end` blocks for Boolean grouping. Solver-internal Prolog/SMT and system-side expressions retain their own syntax.

What the user states ("Maria works at Acme") is turn-local evidence kept in the caller's conversation context, never a stored fact; suppositions, reported speech and `assumed` lines are used only conditionally or reported. A chat turn writes nothing to the knowledge base. The runtime enforces the circuit surface of a coding-agent circuit ([DS014](docs/specsLoader.html?spec=DS014-model-surface.md)) and returns the authored circuit, the generated execution circuit, result packets and traces. The circuit-authoring boundary is stated in [AGENTS.md](AGENTS.md). `node server/cli.mjs chat --config config/runtime.json` runs the same chain against one local repository without sessions.

## Start the local HTTP server

The server serves everything on one port: a **home page** (`/`), the **sign-in page** (`/login`), the **browser chat** (`/chat`), the **evaluation page** (`/eval`, guide at `/eval/guide`), the **experiments and project history** (`/experiments`), the **administrator page** (`/admin`) (these require the administrator session), the **documentation site** (`/docs/`, static, no authentication) and the **OpenAI-compatible chat API** (bearer token or the same session cookie).

```sh
npm start                 # prints the home URL first; extra flags go to the launcher (-- --port 3001)
npm test                  # node --test over tests/*.test.mjs
npm run verify            # tests, smoke reasoning, spec references, shard check, site links
```

`npm start` runs `node tools/serve-local.mjs`, which binds all interfaces (`0.0.0.0:9999`) by default and prints every reachable URL. On the first run the sign-in page asks you to choose the administrator password (at least 8 characters), stored only as a salted hash in `state/auth.json`; the chat API stays blocked until it is set. `CHATSOP_API_KEY` (at least 16 characters) remains supported as an environment-provided bearer token. Environment variables: `CHATSOP_HOST` (set `127.0.0.1` for loopback only), `CHATSOP_PORT`, `CHATSOP_API_KEY`, `CHATSOP_CONFIG`, `CHATSOP_OMP_BIN`.

- **Chat** (`/chat`) sends messages to `/v1/chat/completions` with the session cookie, keeps several conversations, and shows under every answer a collapsible trace: status, strategy and route, completeness, assumptions, the authored circuit, the generated execution circuit and the model that wrote it. A turn without an available coding-agent model answers `parse_unavailable`.
- **Eval** (`/eval`) browses the regenerable observations under `eval/reports/current/`.
- **Experiments** (`/experiments`) is the living project history: tasks and experiments (`status/tasks.json`, `status/experiments.json`, [DS007](docs/specsLoader.html?spec=DS007-experiment-preregistration.md)), append-only topic notes (`node tools/notes.mjs add`), reports, the journal timeline (`node tools/journal.mjs add`) and the open owner questions.
- **Admin** (`/admin`) shows the server status and mints and revokes bearer tokens.

The product API (chat completions, memories, sessions, drafts, `POST /v1/author`, `GET /v1/omp/models`, capabilities, cache) is documented in [docs/api.html](docs/api.html).

```sh
curl -H "Authorization: Bearer $CHATSOP_API_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"chatsop","messages":[{"role":"user","content":"Who works at Alpha Lab?"}]}' \
  http://127.0.0.1:9999/v1/chat/completions
```

## Evaluation and knowledge

The yardsticks kept in the product are the KBQA harness (`tools/eval/kbqa`, sealed suites `eval/suites/kbqa-*`), the linking suite (`eval/suites/linking-v1`), the query-forms dev set and calibration (`tools/eval/query-forms`, `tools/eval/query-model-calibration`), the smoke reasoning suite (`node eval/smoke-reasoning/run.mjs`) and the StrategyRouter reports; the next procedure is the symbolic-versus-LLM benchmark in `experiments/proposal/symbolic-vs-llm-benchmark.md`. The sealed-suite guard is `eval/leakage.mjs`.

The source-to-knowledge workflow is described by `skills/material-to-sop/SKILL.md`: it prepares UTF-8 TXT/MD material in a private workspace, checks quoted SOP drafts and runs isolated candidate-rule probes; it does not review source truth or authorize publication by itself. Training is not planned; any run needs the owner's explicit approval.

Current progress and blockers are in [TODO.md](TODO.md); the dated project journal is `status/journal.jsonl` and the topic notes are `status/notes/`, both shown under `/experiments`.

## Documentation

Start with the [documentation overview](docs/index.html), read the [runtime walk-through](docs/runtime.html), the [wire help](docs/wire_types.html) (every wire and keyword with executed examples), the [API](docs/api.html), consult the [canonical wiki](docs/wiki.html) for project terms, and use the [specification matrix](docs/specsLoader.html?spec=matrix.md) for the authoritative requirements. Root [AGENTS.md](AGENTS.md) is the only coding-agent guidance file; [CHANGES.md](CHANGES.md) retains earlier history. Original requirements and frozen work are preserved under `probably_obsolete/`.
