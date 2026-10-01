---
title: DS031-sessions-and-base-memories
summary: Sessions and base memories - the gitignored chat data root, named forkable base memories of any memory strategy with validated, provenance-recorded knowledge, chat sessions that clone a base memory into their own folder, and the omp authoring path in which a coding agent writes the SOP circuits that SymbolicLM cannot.
---

## Introduction

Owner decision of 2026-10-01: a chat does not write into one shared database. It runs in a **session** whose folder holds a clone of a chosen **base memory**; knowledge created during the conversation lands in the session layer, and a user can commit it, explicitly, to a fork of a base memory. Inputs that SymbolicLM cannot handle (attached instruction or source files, complex texts, a detected failure) go to a **coding agent** (omp with the wire-authoring skill) that writes SOP circuits in a temporary folder. The coding agent's circuits are drafts until validated and accepted.

The model boundary of AGENTS.md and [DS021](specsLoader.html?spec=DS021-model-surface.md) is unchanged: the small formalizer sees the user's message alone. The rules of AGENTS.md directions 4, 5 and 7 hold: asserted statements are turn-local evidence kept in the session's conversation context; knowledge accumulates only through explicit host approval; a read hides no write. [DS012](specsLoader.html?spec=DS012-local-server.md) describes the server and [DS030](specsLoader.html?spec=DS030-capability-apis.md) the independent capability endpoints; the memory strategies are [DS005](specsLoader.html?spec=DS005-memory.md) and DS023 to DS028.

## Core Content

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
| `manifest.json` | `id`, `name`, `parent` (id, name, strategy, circuits count, fork time, or null), `strategy`, `exact`, `created_at`, `description`, counters |
| `repo/` | a memory repository ([DS028](specsLoader.html?spec=DS028-memory-retention-and-generations.md)) with one base named `main`, built for the manifest's strategy |
| `circuits/NNNN-<name>.sop` | the validated knowledge circuits in the order they were added: the source of truth the repository is derived from |
| `provenance.jsonl` | one record per addition, import or fork: `approved_by`, `approved_at`, `reason`, `source`, the circuit's SHA-256, the wire count and what was ingested |

**Strategy.** Any `memory.engine` of [DS005](specsLoader.html?spec=DS005-memory.md): `recall-memory`, `holo-memory`, `sqlite`, `scan`, `hybrid` (and `exact: true` for the exact tuple sidecar of [DS026](specsLoader.html?spec=DS026-exact-reference-memory.md)). The repository's memory configuration is the runtime `memory` block with the engine set.

**What the repository holds.** The `fact` wires of a circuit are ingested into the memory strategy (a fact without `valid` is stored with `valid timeless` and counted in `facts_defaulted_valid`; a fact the store cannot lower is listed in `facts_skipped` and stays in its circuit). Every other knowledge wire (rules, defaults, norms, aggregates, methods) lives as a circuit; `theory()` concatenates the circuits for the exact engines (`reasoning/strategies/js-reference`), which read the whole theory.

**Adding knowledge is an administrator action.** `addKnowledge` validates the circuits with the knowledge validator of `sop/knowledge/` (authoring mode) together with the circuits already stored (duplicate ids, arity, closedness), rejects `jsEval`, any model-surface wire, any `query` wire and any governance field (`approval`, `approved_by`, `approved_at`: the host's record is the provenance), and writes nothing when anything fails (answer 422 with `problems`). On success it stores the circuit, ingests its facts and appends the provenance record with the approving administrator. There is no implicit write path.

**Fork.** A fork copies the circuits and the provenance, records the parent in its manifest and adds a `fork` provenance record. With the same strategy the repository is cloned by hard links: snapshots and shards are content-addressed files never modified in place, so the clone is copy-on-write and costs no data copy. With another strategy the repository is rebuilt by replaying the circuits into the new engine (`method: replay`).

### Verification

`tests/chat-data.test.mjs` (layout, identifiers, cleanup, legacy drop), `tests/chat-memories.test.mjs` (every strategy stores, reads back and forks; hard-link clone and independence; replay across strategies; validation, provenance and all-or-nothing writes; the `/v1/memories` API with admin and user credentials).
