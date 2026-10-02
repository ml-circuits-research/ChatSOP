# ChatSOP

**Goal: beat small LLMs at reasoning through symbolic processing, and help small LLMs reason symbolically.** ChatSOP runs checked SOP circuits against reviewed, time-aware knowledge and answers with evidence. A person or tool can supply a full circuit; in the chat, a **formalization strategy** writes the circuits from the user's message, in any language, and nothing else. The answer is computed by symbolic code and rendered deterministically in English; when the message is not in English, an optional last step phrases that answer in the message's language.

The chat pipeline (details and one worked example in [docs/runtime.html](docs/runtime.html#pipeline)):

1. **Request parser** (`server/query-parser.mjs`, `lib/query-author`): the session's formalization strategy turns the message into circuits. **CodingAgent** (the default) runs omp with the model chain `queryParser.models` of `config/runtime.json` (`zai/glm-5.3`, then `openai-codex/gpt-6-luna`), one turn, no tools, thinking off, on persistent RPC workers. **LocalLLMDirect** asks a local GGUF model served by llama-server (shared runtime `lib/local-llm/`) to write the circuit in one step. **LocalLLMStepByStep**, in which the symbolic system asks a small local model short questions and assembles the circuit itself, is in progress. The author receives the message and the **schema neighbourhood** of the session's memory (relations around the named entities, with their roles and examples); it writes only queries, constraints, `unclear`/`unparsed` markers, labelled session definitions and `assumed` lines. It never answers and never states a fact.
2. **Admission and repair**: the validator (`lib/query-author/validate.mjs`, `admit.mjs`, `condition-use.mjs`) checks the circuit against the memory's declarations and sends problems (for example `condition_misuse`, `time_not_a_point`, `time_range_needs_quantifier`, `unknown_predicate`) back for bounded repair rounds; a missing term opens a bounded **vocabulary dialog** (at most two expansions). Session definitions come back as drafts that the user accepts or rejects.
3. **KnowledgeLinker**: relation phrases and entity names are linked to the base memory.
4. **Slice retrieval with the completeness guard** (`reasoning/slice/`): only the facts the question can use are fetched; an answer that needs a complete slice is never given from a partial one.
5. **StrategyRouter** (`reasoning/router/`): the `js-reference` oracle or an engine (`sql-sqlite`, `datalog-souffle`, `asp-clingo`) answers; a routed answer is verified against the oracle (`route.verification`); a requested backend is never substituted.
6. **Rendering** (`sop/answer-text.mjs`): a deterministic English answer that names the origin of every step (memory, definition, assumption); it is always kept in the trace (`chatSop.english_text`).
7. **Answer formulation** (`server/answer-language.mjs`): when the message does not look English (`answerLanguage.mode` `auto`; also `always` or `off`), omp with a non-Anthropic model of `answerLanguage.models` (default `queryParser.models`, GLM first) rephrases the English answer in the message's language, strictly from the English answer and a compact result packet. Every number and Wikidata id of the English answer must survive, otherwise the next model is tried, and then the English answer is returned. "Unde s-a născut Ada Lovelace?" is answered in Romanian from `world-v1`.

There is no fallback parser and no silent substitution of a strategy: when no model can run the answer is `parse_unavailable` (503); when the models ran and no valid circuit came back it is `parse_failed` (422). The validation procedure is the benchmark in `experiments/proposal/symbolic-vs-llm-benchmark.md`.

The earlier branch of small models for translation, proofing and circuit generation (Stanza, SymbolicLM, textToCleanEnglish, LanguageProofingLLM, SymbolicProofingLLM, FormalizerLLM, training, the datasets, the corpus audit) is frozen history and lives in `probably_obsolete/tinyLLMExperiments/` (paused work in `probably_obsolete/paused/`).

SOP (properly *SOP Lang*) comes from *Standard Operating Procedure*: the language is an attempt to formalize standard operating procedures, and the facts, questions and constraints they rely on, as inspectable, executable text.

## Prerequisites

Use Node.js 22.13 or newer, including the built-in `node:sqlite` module. The symbolic CLI uses Node built-ins and the root `package.json` has no third-party npm dependencies. SWI-Prolog and Z3 are optional reasoning backends and are not needed for the reference route (the `js-reference` oracle in JavaScript). The omp CLI is needed only for the CodingAgent strategy of the chat and for the author API, and LocalLLMDirect needs a llama.cpp `llama-server` and a local GGUF; neither is needed to run circuits; dependency records are in [dependencies.md](dependencies.md). Do not download a model or install an optional solver to run a symbolic example.

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

The request parser writes one keyword per line and quoted strings for names; the schema neighbourhood of the memory supplies predicate ids. "Who works at Acme?" becomes a query circuit such as

```sop
@q query
  where works_at ?who "Acme"
  select ?who
```

and the KnowledgeLinker resolves `"Acme"` to an entity of the base memory. Circuits written by people or tools use positional atoms with whitespace-separated terms, for example `where temperature room_a ?degrees`; parentheses and commas are not SOP relation delimiters. Quote a multiword term, such as `"Maria Ionescu"`. Use explicit `all`/`any`/`end` blocks for Boolean grouping. Solver-internal Prolog/SMT and system-side expressions retain their own syntax.

What the user states ("Maria works at Acme") is turn-local evidence kept in the caller's conversation context, never a stored fact; suppositions, reported speech and `assumed` lines are used only conditionally or reported. A chat turn writes nothing to the knowledge base. The runtime enforces the circuit surface of an authored circuit ([DS014](docs/specsLoader.html?spec=DS014-model-surface.md)) and returns the authored circuit, the generated execution circuit, result packets and traces. The circuit-authoring boundary is stated in [AGENTS.md](AGENTS.md). `node server/cli.mjs chat --config config/runtime.json` runs the same chain against one local repository without sessions.

## Start the local HTTP server

The server serves everything on one port: a **home page** (`/`), the **sign-in page** (`/login`), the **browser chat** (`/chat`), the **knowledge browser** (`/review`), the **evaluation page** (`/eval`, guide at `/eval/guide`), the **experiments and project history** (`/experiments`), the **administrator page** (`/admin`) (these require the administrator session), the **documentation site** (`/docs/`, static, no authentication) and the **OpenAI-compatible chat API** (bearer token or the same session cookie).

```sh
npm start                 # 0.0.0.0:9999; prints the home URL first; extra flags go to the launcher (-- --port 3001)
npm test                  # node --test over tests/*.test.mjs
npm run verify            # tests, smoke reasoning, spec references, shard check, site links
```

`npm start` runs `node tools/serve-local.mjs`, which binds all interfaces (`0.0.0.0:9999`) by default and prints every reachable URL. On the first run the sign-in page asks you to choose the administrator password (at least 8 characters), stored only as a salted hash in `state/auth.json`; the chat API stays blocked until it is set. `CHATSOP_API_KEY` (at least 16 characters) remains supported as an environment-provided bearer token. At start the base memories of `server.warmMemories` (`world-v1`) and the default base are decoded in the background (`world-v1`, about 357k Wikidata facts in 221 layers, takes about 12 s); the server answers at once (`CHATSOP_WARMUP=0` skips the warmup).

Environment variables: `CHATSOP_HOST` (set `127.0.0.1` for loopback only), `CHATSOP_PORT`, `CHATSOP_API_KEY`, `CHATSOP_CONFIG` (another runtime configuration), `CHATSOP_CHAT_DATA` (another chat data root instead of `chat_data/`), `CHATSOP_OMP_BIN`, `CHATSOP_WARMUP`. A private second server for experiments, which does not disturb the one on 9999:

```sh
CHATSOP_PORT=9998 CHATSOP_CHAT_DATA=/tmp/chatsop-data CHATSOP_CONFIG=config/my-runtime.json npm start
```

- **Chat** (`/chat`) keeps one session per conversation; a session is a fork of a base memory. The default base is the encyclopedic `world-v1` (`chatData.defaultBase`). If `world-v1` is not loaded, the minimal `default` (which imports `core-min`) is used instead. The *New session* dialog marks the default and can pick another base memory; `core-en`, `core-min` and `demo` are seed memories. Specialised tasks start from a memory created as *minimal* (imports `core-min`) or *empty*. The Create memory dialog offers "Built on: encyclopedic / minimal / empty". Each answer is plain English, with a trace panel ordered as the pipeline: formalization (strategy, model, models tried, repair rounds with their problem codes, cache, latency, cost), vocabulary (schema neighbourhood and vocabulary dialog), session definitions and assumptions (proposed definitions with Accept and Reject), linking, retrieval (complete or not, bounds), route and verification, and the circuits. The *Settings* tab chooses the formalization strategy (an unavailable strategy is shown disabled with its reason), the CodingAgent model, and shows a server status card from `GET /v1/status`; the *Base Memory* tab lists, views, forks and creates base memories.
- **Knowledge** (`/review`) is a read-only browser of what a base memory or a chat session knows: the memories and their layers (`core-min`, `core-en`, `world-v1`, seed and ingestion layers, the session layer) with provenance; a risk view per layer that lists the items most likely to be wrong first, with flags (a lexeme form with no corpus or Wikidata evidence, a form two predicates claim, a converse frame, a rule, a flipped or merged Wikidata mapping, a predicate without a description) and the evidence next to them (mined corpus counts and example messages, Wikidata properties, dropped forms, the world-v1 mapping table); keyword search over entities, classes, predicates and their forms, rules and fact values; entity, predicate and rule cards that show effect rather than syntax (generated sentences and the atom they map to, facts in words with their layer and source, an example derivation of each rule) and a *Derive* button that asks the oracle what the rules add about an entity, with proofs. There is no accept or reject step: corrections go through tests and interactions. Entity and relation names in the chat trace open their cards. API: `GET /v1/knowledge/*` (docs/api.html section 9).
- **Eval** (`/eval`) browses the regenerable observations under `eval/reports/current/`.
- **Experiments** (`/experiments`) is the living project history: tasks and experiments (`status/tasks.json`, `status/experiments.json`, [DS007](docs/specsLoader.html?spec=DS007-experiment-preregistration.md)), append-only topic notes (`node tools/notes.mjs add`), reports, the journal timeline (`node tools/journal.mjs add`) and the open owner questions.
- **Admin** (`/admin`) shows the server status and mints and revokes bearer tokens.

### Choosing the formalization strategy

| Strategy | What writes the circuit | How to select it |
| --- | --- | --- |
| **CodingAgent** (default) | omp, one turn, no tools, thinking off, persistent RPC workers; the models of `queryParser.models` in `config/runtime.json` are tried in order (`zai/glm-5.3`, then `openai-codex/gpt-6-luna`) | default; per session, the Settings tab's model picker (`omp_model`, tried before the chain; `GET /v1/omp/models` lists the models with their cost class) |
| **LocalLLMDirect** | a local GGUF (for example Qwen3.8-27B) served by llama-server through the shared local runtime `lib/local-llm/`, one step, prompt cache on | the Settings tab, or `POST /v1/sessions/{id}/settings {"formalizer": "LocalLLMDirect"}`; setup in [docs/runtime.html](docs/runtime.html#local-formalizer) |
| **LocalLLMStepByStep** | the symbolic system asks a small local model short questions and assembles the circuit | local llama-server, `steps` slot; [docs/runtime.html](docs/runtime.html#local-formalizer) |

`formalizer: null` uses the server default (CodingAgent). A turn whose strategy cannot run on this server is refused with 503 `parse_unavailable` naming the strategy (`GET /v1/status` lists each strategy with `available` and the reason); it is never silently replaced by another. Whatever strategy wrote the circuit, the same admission, linking, retrieval, routing, verification and rendering follow.

The product API (chat completions, status, memories, sessions and their settings, drafts, `POST /v1/author`, `GET /v1/omp/models`, capabilities, cache) is documented in [docs/api.html](docs/api.html).

```sh
curl -H "Authorization: Bearer $CHATSOP_API_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"chatsop-local","messages":[{"role":"user","content":"Who works at Alpha Lab?"}]}' \
  http://127.0.0.1:9999/v1/chat/completions
curl -H "Authorization: Bearer $CHATSOP_API_KEY" http://127.0.0.1:9999/v1/status
```

## Base memories from documents (learning by ingestion)

The system learns by adding knowledge to base memories, not by training models: documents, manuals and books become facts, relations, rules and procedures of a **task-type base memory** (one for HR policy questions, one for a science topic, ...), and chats are sessions made from that memory. The coding agent drafts the circuits chunk by chunk, the validator and a quote check (every quoted sentence must be in the document) run in its repair rounds, facts that duplicate or contradict the memory are held back, and nothing is stored until a user accepts the ingestion report.

```sh
node tools/ingest-documents.mjs create-memory --id hr-policies --name "HR policies" --imports core-min
node tools/ingest-documents.mjs draft --memory hr-policies --file handbook.md --rights cleared   # prints the ingestion id and its report path
node tools/ingest-documents.mjs report --memory hr-policies --ingestion ING                      # extracted, rejected, held back, uncertain
node tools/ingest-documents.mjs accept --memory hr-policies --ingestion ING --by "$USER"         # stores the validated chunks with provenance
```

Over HTTP: `POST /v1/memories/{id}/ingest`, then `POST /v1/memories/{id}/ingestions/{ingestion}/accept`, then `POST /v1/sessions {"base": "hr-policies"}` (examples on the [API page](docs/api.html#ingest)). Ingesting the same document again adds nothing (chunks are identified by their SHA-256). Only documents whose rights are recorded as cleared, permissive-attribution or owner-provided are accepted (DS011). Rules that answer one question form can be stored as a **procedure** (`POST /v1/memories/{id}/procedures`); the query author is then offered the procedure whenever a message matches its description. Contract: DS022 "Ingesting documents into a base memory" and "Procedure library".

## Evaluation and knowledge

The yardsticks kept in the product are the KBQA harness (`tools/eval/kbqa`, sealed suites `eval/suites/kbqa-*`), the linking suite (`eval/suites/linking-v1`), the query-forms dev set and calibration (`tools/eval/query-forms`, `tools/eval/query-model-calibration`), the smoke reasoning suite (`node eval/smoke-reasoning/run.mjs`) and the StrategyRouter reports; the next procedure is the symbolic-versus-LLM benchmark in `experiments/proposal/symbolic-vs-llm-benchmark.md`. The sealed-suite guard is `eval/leakage.mjs`.

The source-to-knowledge workflow is described by `skills/material-to-sop/SKILL.md`: it prepares UTF-8 TXT/MD material in a private workspace, checks quoted SOP drafts and runs isolated candidate-rule probes; it does not review source truth or authorize publication by itself. There is no model training in this project.

Current progress and blockers are in [TODO.md](TODO.md); the dated project journal is `status/journal.jsonl` and the topic notes are `status/notes/`, both shown under `/experiments`.

## Documentation

Start with the [documentation overview](docs/index.html), read the [runtime walk-through](docs/runtime.html), the [wire help](docs/wire_types.html) (every wire and keyword with executed examples), the [API](docs/api.html), consult the [canonical wiki](docs/wiki.html) for project terms, and use the [specification matrix](docs/specsLoader.html?spec=matrix.md) for the authoritative requirements. Root [AGENTS.md](AGENTS.md) is the only coding-agent guidance file; [CHANGES.md](CHANGES.md) retains earlier history. Original requirements and frozen work are preserved under `probably_obsolete/`.
