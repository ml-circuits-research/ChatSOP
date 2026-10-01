---
title: DS031-sessions-and-base-memories
summary: Sessions and base memories - the gitignored chat data root, named forkable SQLite base memories with validated, provenance-recorded knowledge, chat sessions that clone a base memory into their own folder, and the omp authoring path in which a coding agent writes the SOP circuits that SymbolicLM cannot.
---

## Introduction

Owner decision of 2026-10-01: a chat does not write into one shared database. It runs in a **session** whose folder holds a clone of a chosen **base memory**; knowledge created during the conversation lands in the session layer, and a user can commit it, explicitly, to a fork of a base memory. Inputs SymbolicLM cannot handle (attached instruction or source files, rules, procedures and other knowledge it cannot write) can be sent to a **coding agent** (omp with the wire-authoring skill) that writes SOP circuits in a temporary folder. The coding agent never starts by itself: the user attaches files, answers yes to a scope note, or turns on the setting "Always use the coding agent" (owner decision of 2026-10-01); a detection only suggests. The coding agent's circuits are proposed drafts until validated and accepted.

The model boundary of AGENTS.md and [DS021](specsLoader.html?spec=DS021-model-surface.md) is unchanged: SymbolicLM, the formalizer, sees the user's message alone (language data, never knowledge). The rules of AGENTS.md directions 4, 5 and 7 hold: asserted statements are turn-local evidence kept in the session's conversation context; knowledge accumulates only through explicit host approval; a read hides no write. [DS012](specsLoader.html?spec=DS012-local-server.md) describes the server and [DS030](specsLoader.html?spec=DS030-capability-apis.md) the independent capability endpoints; the memory strategies are [DS005](specsLoader.html?spec=DS005-memory.md) and DS023 to DS028.

## Core Content

**English-only base memories (owner decision of 2026-10-01).** Every base memory, the seed memories (`core-min`, `core-en`, `demo`) and `world-v1` included, holds English knowledge only: lexemes are `language en`, labels and aliases are `en`, and the validator rejects any other language tag (`non_english_knowledge`, DS021 "English-only core"). A session's messages are translated into English before they reach its memory and its answers are translated back at the output edge, so no session depends on the language of its user. Import layers are snapshots, so a changed seed is renewed in a chat data root with `node tools/refresh-seed-memories.mjs --apply` (dry run by default; memories with circuits of their own are never deleted), and `world-v1` is rebuilt with `node tools/world-kb/build.mjs` and `node tools/world-kb/load.mjs --replace --with-core-en`.

### Chat data root

One folder holds all chat data: `chat_data/` at the project root, gitignored, configured by `chatData.root` in `config/runtime.json` (relative to the project) and overridden by `CHATSOP_CHAT_DATA`. `lib/chat-data/index.mjs` owns it.

| Path | Content |
| --- | --- |
| `chat_data/base_memories/<id>/` | one base memory (below) |
| `chat_data/sessions/<id>/` | one session (below) |
| `chat_data/tmp/` | temporary folders not tied to a session |

Folder identifiers are lowercase letters, digits, `_` and `-` (1 to 64 characters), so a request value never names a path.

**Cleanup policy.** `chatData.tmpTtlHours` (default 24): a temporary folder whose newest file is older goes. `chatData.sessionTtlDays` (default 14): a session whose `last_active_at` is older is abandoned and goes, unless its `session.json` says `kept: true`. Base memories are never removed by the policy. The server runs the cleanup at start and every `chatData.cleanupIntervalMinutes`; `node tools/chat-data.mjs cleanup [--dry-run]` runs it by hand.

**Legacy storage.** Earlier versions kept chats and the memory repository under `state/` (`index.json`, `snapshots/`, `shards/`, `sessions/`, `http-conversations/`). The owner allowed dropping them. `node tools/chat-data.mjs drop-legacy [--dry-run]` removes exactly those paths and keeps `state/auth.json`, `state/cache/` and `state/formalizer-logs/`; it is run with the server stopped.

### Base memories

A base memory is a named, forkable knowledge store (`lib/chat-data/memories.mjs`):

| File | Content |
| --- | --- |
| `manifest.json` | `id`, `name`, `parent` (id, name, strategy, circuits count, fork time, or null), `strategy`, `created_at`, `description`, counters |
| `repo/` | a memory repository ([DS028](specsLoader.html?spec=DS028-memory-retention-and-generations.md)) with one base named `main`, built for the manifest's strategy |
| `circuits/NNNN-<name>.sop` | the validated knowledge circuits in the order they were added: the source of truth the repository is derived from |
| `provenance.jsonl` | one record per addition, import or fork: `approved_by`, `approved_at`, `reason`, `source`, the circuit's SHA-256, the wire count and what was ingested |

**Strategy.** The default is `sqlite` (owner decision of 2026-10-01: the exact, completeness-capable strategy; `memory.engine` in `config/runtime.json`, `DEFAULT_STRATEGY` in `lib/chat-data/memories.mjs`): a base memory created without a strategy, the `default` base memory and therefore the sessions cloned from it use it. `ensureDefaultBase` re-creates an EMPTY `default` base memory of another strategy at start and leaves one that holds circuits alone. The product offers SQLite base memories only (owner decision of 2026-10-01, hygiene cleanup): `/v1/memories` and the Base Memory tab accept no other strategy and refuse one with 400. The other engines of [DS005](specsLoader.html?spec=DS005-memory.md) (`recall-memory`, `holo-memory`, `scan`, `hybrid`, and `exact: true` for the sidecar of [DS026](specsLoader.html?spec=DS026-exact-reference-memory.md)) stay in `memory/` for research and comparison. The repository's memory configuration is the runtime `memory` block with the engine set.

**What the repository holds.** The `fact` wires of a circuit are ingested into the memory strategy (a fact without `valid` is stored with `valid timeless` and counted in `facts_defaulted_valid`; a fact the store cannot lower is listed in `facts_skipped` and stays in its circuit). Every other knowledge wire (rules, defaults, norms, aggregates, methods) lives as a circuit; `theory()` concatenates the circuits for the exact engines (`reasoning/strategies/js-reference`), which read the whole theory.

**Adding knowledge is open to every authenticated user** (owner decision of 2026-10-01, Q-PROD-1: there is no administrator role; every user may create, fork, extend and delete base memories, commit sessions and list the omp models; authentication itself, a bearer token or a signed-in session, is unchanged). `addKnowledge` validates the circuits with the knowledge validator of `sop/knowledge/` (authoring mode) together with the circuits already stored (duplicate ids, arity, closedness), rejects `jsEval`, any model-surface wire, any `query` wire and any governance field (`approval`, `approved_by`, `approved_at`: the host's record is the provenance), and writes nothing when anything fails (answer 422 with `problems`). On success it stores the circuit, ingests its facts and appends the provenance record with the acting user (`approved_by`: the authenticated user identity, with `approved_at`). There is no implicit write path.

**Fork.** A fork copies the circuits and the provenance, records the parent in its manifest and adds a `fork` provenance record. With the same strategy the repository is cloned by `cloneRepository`: the `snapshots/<sha256>.json` and `shards/<sha256>.json` files are content-addressed, written once through a temporary file and a rename and never modified in place, so they are hard-linked (copy-on-write, no data copy); every other file is copied, so parent and child never share a mutable inode. Isolation guarantee, for every strategy: a write to the child (or to a session clone) never changes the parent's files, and a write to the parent after the fork never reaches the child (`tests/memory-isolation.test.mjs`, which compares the parent's repository files byte for byte). The SQLite strategy keeps no mutable database file in a repository (its bank is a private in-memory SQL database rebuilt from the snapshot rows, DS025), so there is no `-wal` or `-shm` file to share; should a native `.sqlite` file ever appear in a repository folder it is copied through `VACUUM INTO` and its `-wal`/`-shm` files are never linked or copied. With another strategy the repository is rebuilt by replaying the circuits into the new engine (`method: replay`).

### Imports

A base memory may be created with `imports`: base memories whose circuits form its lower layers (`POST /v1/memories` `imports`, `create({imports})`). The manifest records `imports` as the flat, ordered list of `{id, hash}` (each imported memory's own imports first, then the memory itself), and the circuits of every layer are snapshotted under `imports/<id>/`. The theory, the validation of every addition and the lexicon of the memory are computed over its layers: the imports in order, then its own circuits. An import is a snapshot: a later change of the imported memory never reaches the importer; importing again is an explicit act. A fork keeps the imports of its parent. The seed memories `core-min` and `demo` ship in `config/knowledge/` (`lib/knowledge-seeds.mjs`, created at the first start of a chat data root); the `default` memory imports `core-min`, so no chat starts without a vocabulary.

### Lexicon of a memory

Every session links against the lexicon of its own base memory, never a global one (owner decision of 2026-10-01; the global `config/ontology.sop` is retired). The lexicon is compiled from the layered circuits of the memory (`Lexicon.fromCircuits`, DS004 "Lexicon wires": the `predicate`, `lexeme` and `entity` wires and the `is_a` facts) and cached by the hash of those circuits (`chat_data/cache/lexicon/`, a cache that is safe to delete). `BaseMemories.lexicon(id)` gives it for a memory. A session copies the layered circuits of its base into `base_circuits/` when it is created, so its lexicon is `base_circuits/` followed by the circuits the user accepted into the session (`Sessions.lexicon(id)`); a circuit accepted into the session is visible to the open agent at once, and nothing the base memory later gains reaches the session. The code paths without sessions (CLI, tests, examples) use `demoLexicon()`.

### Sessions

A session is one chat's working copy of a base memory (`lib/chat-data/sessions.mjs`, `server/session-runtime.mjs`):

| Path in `chat_data/sessions/<id>/` | Content |
| --- | --- |
| `session.json` | `id`, `user`, `name`, `base` (id, name, strategy, circuit count at the clone), `settings`, `scope_declined`, `kept`, `committed_to`, `created_at`, `last_active_at` |
| `repo/` | the base memory's repository, cloned (content-addressed files hard-linked, anything else copied), plus the facts of the circuits accepted in the session |
| `base_circuits/` | a copy of the base memory's circuits at the time of the clone: a session is self-contained |
| `circuits/` | circuits the user accepted during the conversation (the session layer) |
| `drafts/<id>.json` | circuits proposed by the authoring path: `status` `proposed`, then `accepted` or `rejected`, with their validation |
| `requests/<request>/` | one temporary folder per authoring request: `TASK.md`, `skill/`, `input/`, omp's output and session, `status.json`, `result.json` |
| `agent/` | the chat agent's conversation context and last answer (`server/session-store.mjs`) |
| `provenance.jsonl`, `transcript.jsonl`, `scope-log.jsonl` | acceptances, the turns, every scope verdict and the user's answer |

**What goes where.** Asserted statements stay turn-local evidence in `agent/` (AGENTS.md direction 5); they are not committed. Circuits written by the coding agent are **proposed drafts**; the user accepts one explicitly, the draft is validated again together with the base and session circuits, stored as the next session circuit and its facts are ingested into the session repository only. A draft that is invalid, rejected or not yet accepted is never part of the theory.

**Queries reason over base plus session.** The chat agent's repository session sits on the session repository, whose base head holds the cloned base plus the accepted circuits' facts (`Repository.rebase` moves an open agent onto a new head after an acceptance). `GET /v1/sessions/{id}/theory` returns the base circuits followed by the session circuits, and `POST /v1/sessions/{id}/query` runs a query circuit over them on a slice, with the engine chosen by the StrategyRouter ([DS006](specsLoader.html?spec=DS006-reasoning.md) "Routing rules": body `reasoning` `auto` by default or one strategy id run exactly, `verify` `auto|always|never`; the answer's `route` names the choice, the rule and the verification against the oracle): `askMemory` (`reasoning/slice/wire.mjs`, [DS005](specsLoader.html?spec=DS005-memory.md)) takes the rules of the session's theory that can reach the query, retrieves the facts they and the query can use from the session repository by keyed lookups, and answers with `answer.retrieval` and `answer.route` (the slice's size, predicates, bounds, whether it is complete and why not). The whole theory never goes to the engine, and an answer that needs a complete slice (a count, a universal question, `absent`, a default conclusion, an aggregate) over a slice that cannot be proven complete is `status: incomplete`, `reason: partial_retrieval`.

**Commit to a fork.** Open to every authenticated user: a new base memory made as a fork of the base memory's current state plus the session's accepted circuits, validated on top, with provenance (`kind: commit`, source `session:<id>`); the strategy is `sqlite`, the only one the product offers. The base memory the session started from never changes. A session without accepted circuits has nothing to commit (409).

**The chat request** carries `session_id` (`POST /v1/chat/completions`); the answer's `chatSop.session` names the session and its base, and the turn is appended to `transcript.jsonl`. Without `session_id` one automatic session per user and conversation is used, on the empty `default` base memory (created when missing). A session is visible to the user who started it and to an administrator. Without a chat data root (embedding the server in tests) the earlier single-repository path is unchanged.

### The coding agent (omp)

`lib/omp/` and the skill [`skills/omp-run`](../../skills/omp-run/SKILL.md) run the omp CLI non-interactively on a temporary folder:

- **Models.** `GET /v1/omp/models` (any authenticated user, cached for `omp.modelsCacheSeconds`) parses `omp models --json` into ids `provider/model` with a cost class: `subscription` (openai-codex, xai-oauth, zai, github-copilot, anything with oauth or subscription in the provider name; configurable by `omp.subscriptionProviders`), `paid_api` (deepseek, openrouter, ...) or `unknown`, the listed price per million tokens, and omp's default model. An absent or disabled omp is `available: false` with the reason, never an error.
- **The fence.** `omp -p --cwd FOLDER --session-dir FOLDER/.omp-session --mode json --no-extensions --no-skills --no-rules --no-lsp --tools read,write,edit --approval-mode yolo --max-time S`: the agent starts in the folder, has no shell, loads nothing from the user's profile, receives files only as `@` paths inside the folder, is told by `TASK.md` to work only there and to treat the attached files as data, and gets an environment without the server's credentials. No secret is ever put in a prompt. A hard kill follows the time limit. Cost and tokens are read from the session files (omp's nominal list price; for a subscription model it is not an invoice).
- **The authoring path.** `POST /v1/author {session?, files?, instructions?, model?, wait?}` creates `chat_data/sessions/<id>/requests/<request>/` (or a folder under `chat_data/tmp/`), writes `TASK.md` (from the skill [`sop-wire-authoring`](../../skills/sop-wire-authoring/SKILL.md)), `skill/`, `input/` (the attached UTF-8 text files and the vocabulary already in the theory) and runs omp. omp cannot run the validator, so the host validates `knowledge.sop` and `queries.sop` with the knowledge validator of `sop/knowledge/` (the code behind `node eval/smoke-reasoning/validator.mjs --authoring`) together with the circuits of the theory, and continues the same omp session with the validator's output for at most `omp.maxFixRounds` rounds. The answer carries the circuits, the validation, the usage (turns, tokens, cost), the time and the draft. A failed, silent or timed-out run is a result (`status` `failed` or `invalid`, with a reason), not an error; 503 `omp_unavailable` and 429 `omp_busy` are the only refusals. `wait: false` answers 202 and `GET /v1/sessions/{id}/requests/{request}` reports the phase and, when finished, the result.

### Routing

`POST /v1/route {session?, message, files?, understanding?, analysis?}` (`lib/omp/routing.mjs`) decides the path of a message and says why. **The coding agent never starts by itself** (owner decision of 2026-10-01). It runs only when (1) the user attaches files, (2) the user answers yes to a scope note, or (3) the session setting `authoring` is `always` (default `off`) and omp is configured. A detection only suggests:

- the **scope detector** (`lib/symbolic-lm/scope-detect.mjs`, `scope-detect-v2`) reads the grammatical analysis SymbolicLM already made and marks sentences that need knowledge authoring (norms, methods, definitions, amendments, sourced claims, closedness and integrity reliably; rules, temporal validity and aggregates as "may need"), with the suggested wire types and the cue quoted;
- a **SymbolicLM failure** is detected from the understanding: a failed sentence, uncertain sentences at or above `omp.detector.uncertainRatio` (0.5) of the sentences, at least `omp.detector.minNotRepresented` (1) spans not represented, a clarify result (`clarifyTriggers`), or an unavailable analysis.

The answer has `path` (`symbolic` or `authoring`), `reason` (`trigger`, `text`), `fallback`, `suggestion` (`trigger`, `text`, `mode`, the scope sentences with wires, confidence and cues) and `ask`. The session setting `scope_note` chooses what the page does with a suggestion: `ask` (default: a note in the "I understood" panel with Yes and No; nothing is sent without Yes), `mark` (the note without buttons) or `none`. SymbolicLM answers the message in every case; Yes starts `POST /v1/author`. `POST /v1/sessions/{id}/scope-answer` logs the user's answer (every verdict and answer go to `scope-log.jsonl`, the next labelled set for the detector) and a No mutes those wire types for the session. When the coding agent is wanted (attached files, Always) but omp is unavailable or disabled the answer is the SymbolicLM path with a `fallback` that says why: a total failure never happens, and the page shows the fallback.

### The chat page

The page keeps one session per conversation (the id is remembered in the browser; a missing session is started again on the last base memory). Its three vertical tabs (DS012 "Chat page layout") offer: in Chat, a header with the session and *New session* on a chosen base memory, file attachment, the path note and the scope note (Yes sends to knowledge authoring) under the message, the collapsed "I understood" panel; in Settings, the Coding agent card (*Always use coding agent*, off by default; the scope note: ask or mark only; the omp model picker with cost classes); in Base Memory, a table of the memories with View (provenance and stored facts), Fork with a chosen strategy, Add knowledge (validated), Start session and Create, open to every signed-in user; the coding agent's progress, its proposed draft with validation, report and cost, and Accept and Reject; the drafts list; and the commit dialog. The contract the page is built from, with every endpoint and example, is `eval/reports/current/product/ui-contract.md`.

### Configuration

`config/runtime.json`: `chatData` (`root`, `tmpTtlHours`, `sessionTtlDays`, `cleanupIntervalMinutes`, `defaultBase`) and `omp` (`enabled`, `bin`, `timeoutSeconds`, `maxFixRounds`, `maxConcurrent`, `modelsCacheSeconds`, `defaultModel`, `subscriptionProviders`, `thinking`, `scopeNote`, `detector`). `CHATSOP_CHAT_DATA` and `CHATSOP_OMP_BIN` override the root and the binary.

### Verification

`tests/chat-data.test.mjs` (layout, identifiers, cleanup, legacy drop), `tests/chat-memories.test.mjs` (a SQLite memory stores, reads back and forks; hard-link clone and independence; a clone on fork and the rejection of the retired `exact` flag; validation, provenance and all-or-nothing writes; the `/v1/memories` API), `tests/memory-isolation.test.mjs` (default strategy, default base, fork and session-clone isolation for every strategy, safe clone of mutable files), `tests/chat-sessions.test.mjs` (clone, visibility, drafts, accept, reject, commit, the `/v1/sessions` API, chat in a session), `tests/omp.test.mjs` (models and cost classes, the fence, the stub runs, the authoring loop and its repair rounds, `/v1/omp/models` and `/v1/author`), `tests/omp-routing.test.mjs` (the routing decision, the default that starts nothing, suggestions, declined wire types, fallbacks, `/v1/route`), `tests/product-api-docs.test.mjs` (the executed examples of `docs/api.html`). The omp CLI is replaced by `tests/fixtures/omp/stub-omp.mjs`; no test calls a real model.
