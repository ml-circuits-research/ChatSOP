---
title: DS005-memory
summary: Reviewed temporal claims, snapshot isolation, the common bank and retrieval contracts, the memory strategy map (RecallMemory, HoloMemory, SQLite, scan and exact sidecar, hybrid, retention and generations) and memory-provider limits.
---

## Introduction

The [repository](wiki.html#definition-repository) stores admitted claims and approved definitions so a user can ask about a time, correct knowledge, and maintain a private session without exposing it to other users or forks. The [memory engine](wiki.html#definition-memory-engine) retrieves candidate facts; it does not decide that a claim is true. This specification states the contracts every memory strategy shares; each strategy has its own specification with its mechanism, verified implementation status and the experiments it still needs.

## Core Content

### Temporal identity and isolation

A claim's validity interval and the time at which the repository learned it must remain separate. Intervals are half-open `[from, until)` over ISO dates or UTC timestamps (`lib/time.mjs`); a time of day is never guessed without a date and zone, and `timeless` is the whole line. `valid`, `at` and `during` concern the world; `knownAt` and `asof` concern the repository's knowledge and are supplied by the host. Retractions and corrections retain provenance: an `end` or `retract` event targets one claim id, never every claim about the same relation, and a question `asof` a time before the correction still sees the earlier version. A new job or changed location must not silently overwrite a previous claim or imply physical presence. Reviewed rule versions are filtered by their known time too. When evidence for `p` and `not p` overlaps in time the reasoner reports `both`; support in disjoint periods is `mixed_temporal`, not a contradiction ([DS006](specsLoader.html?spec=DS006-reasoning.md)).

Users, sessions, base forks, and referenced historical snapshots have distinct roots. `commit` publishes authorized session changes; `discard` removes uncommitted changes; an old referenced snapshot remains a valid [GC](wiki.html#definition-gc) root. `gc` without `--apply` reports unreachable candidates; deleting one still referenced is invalid. The full repository and generation contract is [DS028](specsLoader.html?spec=DS028-memory-retention-and-generations.md).

### Memory strategies

`memory.engine` selects the physical bank behind one SOP-facing interface; `policy.retrievalStrategy` separately selects how the available view is searched; the reasoning strategy is a third, independent choice ([DS006](specsLoader.html?spec=DS006-reasoning.md)).

| Strategy | `memory.engine` / retrieval | What it stores | Specification |
| --- | --- | --- | --- |
| RecallMemory | `recall-memory` | Multi-view hashed 4-bit counters with column-style consensus, inspired by *A Thousand Brains* | [DS023](specsLoader.html?spec=DS023-recall-memory.md) |
| HoloMemory | `holo-memory` | Superposed bipolar codes in fixed signed-counter banks, plus a known-handle wire plane | [DS024](specsLoader.html?spec=DS024-holo-memory.md) |
| SQLite | `sqlite` | Exact indexed tuples with optional literal full-text search; also a single-file memory | [DS025](specsLoader.html?spec=DS025-sqlite-memory.md) |
| Scan and exact sidecar | `scan`; retrieval `exact` | An unindexed exact map; optional exact tuple bodies beside an associative layer | [DS026](specsLoader.html?spec=DS026-exact-reference-memory.md) |
| Hybrid | `hybrid`; retrieval `hybrid`, `auto` | Exact SQLite evidence plus RecallMemory or HoloMemory hints; exact-first search policy | [DS027](specsLoader.html?spec=DS027-hybrid-memory.md) |
| Retention and generations | `memory.retention`, `memory.sharding` | Normal and pinned banks, adaptive cooling, bounded or archive generations, promotion, repository and GC | [DS028](specsLoader.html?spec=DS028-memory-retention-and-generations.md) |

The canonical engine names are exported as `MEMORY_ENGINES` by `memory/banks/factory.mjs`; legacy identifiers still accepted for existing configurations and snapshots are defined in DS023 and DS024.

### Common bank and retrieval contract

Every bank implements `add`, `recall`, `reinforce`, `decay`, `maintain`, `export`/`from` and `stats`, and exposes `domains` (predicate/arity routing) and `receipts` (tuple identity for the temporal layer). A bank is not a reasoner: it runs no rules and does not judge sources. A retrieval strategy (`memory/strategies.mjs`, `StrategyRegistry`) receives the host-authorized repository and session, a canonical partial atom, the question's time view and limits, and returns `rows`, `complete`, `probes` and `coverage`; each row carries the full atom, claim id, validity, source and a description of its verification. It never executes retrieved SOP as text and never creates conclusions. `policy.allowedStrategies` restricts the choice; an unknown name is an error, not a request to load code. The same SOP fact means the same thing in every engine: there is no second memory language, and the formalizer target does not change with the engine.

A retrieval candidate or associative score is not a proof, probability, independent fact, or permission to execute recovered code. Types stay distinct (`1` is not `"1"`), and a repeated variable is an equality constraint. A failed retrieval means "not retrieved", never "false"; explicit negation is a separate fact. Exhaustive enumeration, counting, and absence claims require an appropriate complete exact retained view; a successful bounded lookup alone does not certify that all historical facts survived retention. Probe counts are engine-specific units and are never compared as equal work.

### Closedness and completeness for the knowledge wires

The knowledge wires of [DS004](specsLoader.html?spec=DS004-sop.md) make the retrieved slice a question of correctness: a partial slice makes a missing fact look false. The memory side of the rules is this.

- **`closed` is declared, never inferred.** `closed true` on a `predicate` says the retained view holds every fact of that relation. An author may propose it with the source sentence that asserts exhaustiveness; the host accepts it only over an archive (`retention none`) or a pinned view, so that adaptive forgetting or bounded generations can never turn a forgotten fact into a false `absent`. A predicate is closed only relative to a complete retained view.
- **The pull contract.** A strategy may receive a materialised slice or pull from a fact source with `lookup(predicate, keys)` (rows and `complete`), `rulesFor(predicate)` (rules with `complete`), `count(predicate)` and `closed(predicate)`. The exact engines (SQLite, scan, the exact sidecar) answer `complete` and `closed`; RecallMemory and HoloMemory return candidates and estimates only (`declared: false`) and never close a predicate.
- **Completeness-sensitive answers.** `absent`, an aggregate, `mode count`, `mode every`, `no_plan`, an optimum and any `unknown` or `refuted` obtained by failure are valid only over predicates declared `closed` and fully retrieved for the relevant keys, recursively for derived predicates (every rule with that head, and the rules of the body predicates, must be in the slice). A default conclusion needs retrieval completeness for the keys of its strict contrary and of its exceptions, not a closed world. Otherwise the answer is withheld, widened, or reported incomplete with reason `partial_retrieval`. The host widens a retrieval (so that every strategy gets the same guard) from symbol-driven relevance: exact rule radius, constants and a bounded number of hops first.
- **Positive answers stay valid.** A positive answer derived without negation as failure, aggregates, counts or universal quantifiers remains valid when more wires are retrieved, because evidence is monotone (the status `both` is reported, it never retracts a derivation).
- **Reporting.** Every result packet carries `retrieval: {complete, truncated, keyed, steps, wires, probes}`, and a `supported` answer that rests on an incomplete slice says so ([DS006](specsLoader.html?spec=DS006-reasoning.md) "Completeness under partial retrieval").

### Retention and reporting

Sharded profiles maintain generation-specific banks, pinned knowledge, and referenced snapshot data with budgets and explicit maintenance actions. Promotion must preserve the original valid interval and provenance; strengthening an actually used nonhypothetical fact does not confirm every retrieved hint. Roots from other users and sessions protect reachable shards during GC. Comparison reports must account for bank bytes **and** domains, receipts, claim metadata, indexes and serialization separately, together with retrieval limits, retention and completeness, and must keep unavailable backends or historical reports distinct from observed new runs ([DS013](specsLoader.html?spec=DS013-engine-and-solver-comparison.md)).

### Decisions and open experiments

**Decision 2026-09-28 (Q-ARCH-2).** Still-valid memory content from the archived requirements, registers and reference documents now lives in DS023–DS028; `probably_obsolete/` keeps only the raw historical evidence. The bounded fact-bank role of the current adapters is not declared final: each strategy specification lists the real experiments needed before any claim, including the unreproduced HoloMemory five-seed kernel table, total-byte and metadata measurements, partial-cue discovery, the RecallMemory view portfolio and occupancy thresholds, exact-storage baselines, hint benefit and long-stream retention. **Decision 2026-09-28 (Q-ARCH-3).** The system is named ChatSOP; its two associative strategies are RecallMemory and HoloMemory.
