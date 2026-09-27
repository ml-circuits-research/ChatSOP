---
title: DS005-memory
summary: Reviewed temporal claims, snapshot isolation, retention, and memory-provider limits.
---

## Introduction

The [repository](wiki.html#definition-repository) stores admitted claims and approved definitions so a user can ask about a time, correct knowledge, and maintain a private session without exposing it to other users or forks. The [memory engine](wiki.html#definition-memory-engine) retrieves candidate premises; it does not decide that a claim is true.

## Core Content

### Temporal identity and isolation

A claim's validity interval and the time at which the repository learned it must remain separate. Retractions and corrections retain provenance; a new job or changed location must not silently overwrite a previous claim or imply physical presence. Users, sessions, base forks, and referenced historical snapshots have distinct roots. `commit` publishes authorized session changes; `discard` removes uncommitted changes; an old referenced snapshot remains a valid [GC](wiki.html#definition-gc) root. `gc` without `--apply` reports unreachable candidates; deleting one still referenced is invalid.

### Physical providers

The `memory.engine` selection may choose `weaver`, `holo`, `sqlite`, `scan`, or `hybrid` using a common SOP-facing interface. SQLite and scan retain exact tuples; Weaver reconstructs from relational associative counters; Holo reconstructs argument candidates from signed distributed counters; hybrid uses an exact SQL bank with associative hints. Their representations and costs differ and cannot be assumed interchangeable on disk. The physical engine and reasoning strategy remain orthogonal. A retrieval candidate or associative score is not a proof, probability, independent fact, or permission to execute recovered code. Exhaustive enumeration, counting, and absence claims require an appropriate complete exact retained view; a successful bounded lookup alone does not certify that all historical facts survived retention.

### Retention and reporting

Sharded profiles maintain generation-specific banks, pinned knowledge, and referenced snapshot data with budgets and explicit maintenance actions. Promotion must preserve the original valid interval and provenance; strengthening an actually used nonhypothetical premise does not confirm every retrieved hint. Roots from other users and sessions protect reachable shards during GC. Comparison reports must account for metadata, retrieval limits, retention and completeness, and must keep unavailable backends or historical reports distinct from observed new runs.
