---
title: DS017-engine-comparison
summary: Reproducible bank, lifecycle, and reasoning-by-memory comparisons with explicit unavailable cells.
---

## Scope and evidence

This specification describes **fresh local runs**, not historical benchmark values. The raw observations are `eval/reports/current/comparisons/engines.json` and `reasoners.json`; `matrix.json` and `matrix.txt` are deterministic derivatives. Commands run for these observations:

```sh
node tools/compare-engines.mjs
SWIPL_BIN=tools/.solvers/swi/swipl Z3_BIN=tools/.solvers/z3/bin/z3 node tools/compare-reasoners.mjs
node tools/capability-matrix.mjs
node --test tests/capability-matrix.test.mjs
```

The two private native solver binaries existed and reported SWI-Prolog 9.0.4 and Z3 4.15.8 on this host. If SWI is absent, its cells are **skipped**, never reported as advanced/JS observations. Z3's arithmetic backend does **not** execute these Horn questions: all Z3×memory Horn cells are **unsupported**, even when a Z3 binary exists. JS Horn and native SWI Horn form the observed 2×5 matrix; the explicit 3×3 target (JS, SWI, Z3 × at least Weaver, Holo, SQLite) remains unfilled on its third row because a third compatible Horn solver is not implemented. Do not substitute a memory-independent numeric constraint result to fill it.

## Bank comparison protocol and observations

Five real banks (`weaver`, `holo`, `sqlite`, `scan`, `hybrid`) receive the same typed atoms and query order per `(count, seed)`. The evaluator computes expected atom keys from the corpus but passes **only pattern and budget** into `recall`/`hints`, never answer keys. Counts 64 and 256, seeds 11 and 29, 24 uniform completion queries, 24 hotspot completion queries and one absent query per run. Every query has `maxProbes = 2 × count`, `limit = count + 1`; Weaver power is 12, Holo has 4 banks × 256 rows × 64 dimensions; the five physical representations do **not** have equal-byte budgets. Full sample-level returned keys, expected keys, probes, timings, completeness and hints are in the raw report. Bank timing excludes SOP parsing, repository persistence and inference. `coldMs` is only the **first query on a newly built bank in that process**, not a new-process or disk-cold measurement; later hotspot and absent samples are warm. Warm latency distributions are per run, not claims about production workloads. First timings, GC and memory measurements depend on this host and are not universal.

Observed uniform exact result sets (two seeds, 48 queries per engine/count):

| Engine | 64 atoms | 256 atoms | Representation at 64 / 256 atoms, seed 11 |
|---|---:|---:|---:|
| Weaver | 48/48 | 48/48 | 40,960 / 40,960 bank bytes |
| Holo/H7 | 42/48 | 28/48 | 65,536 / 65,536 counter bytes |
| SQLite | 48/48 | 48/48 | 90,112 / 212,992 database page bytes |
| Scan | 48/48 | 48/48 | 10,305 / 41,560 serialized payload bytes, **not heap** |
| Hybrid | 48/48 | 48/48 | 131,072 / 253,952 combined bytes |

Holo abstentions/missed answers are not exact failures of SQL; the adapter requires reconstruction **and** integrity verification. Holo is a third representation, not a substitute for deterministic exact enumeration. Probe units also differ: SQL counts matched SQL rows, not B-tree internal visits. Inspect `summary.uniform`, `summary.hotspot`, and `summary.absent` for the per-distribution cold/median/p95 latencies and full `samples` for the access distribution. For illustration only, seed 11 at 256 atoms produced warm uniform medians (ms): Weaver 2.438, Holo 0.147, SQLite 0.023, Scan 0.040, Hybrid 2.415. These are measured bank timings, not end-to-end answer latencies.

Hybrid is explicitly **exact evidence + Weaver hints**. Its consumer invokes `bank.hints`, ranks only exact-verified `bank.recall` rows using hint membership, and never promotes unverified hints into evidence. Raw samples contain hint candidate/probe counts, `exactOnlyMs` from a subsequent same-bank control lookup, and `topChanged`. The latter lookup runs second on a warmer bank and is **not** a controlled independent latency comparison. On this small corpus, all hybrid hint candidates matched exact rows (384 per seed/count), `topChanged=0`; hint retrieval consumed extra work but changed no top answer. That negative result is not a claimed hint benefit. Production repository retrieval's `hybrid` strategy and the physical `hybrid` bank are different abstractions; this experiment measures the latter.

## Lifecycle, retention, and GC

The separate raw `lifecycles` records exercise each engine through real repository session commits and reopening, base fork isolation, other-user isolation, `asof` visibility before and after a retraction, archive checkpoint, pinned retention, bounded generational eviction, and mark/sweep GC. All five observed retraction survival after restart and pinned survival under bounded forgetting; the oldest normal generation was forgotten and the newest survived. Each GC dry run while a snapshot was pinned found zero removable snapshots, then closing that session and unpinning made **one snapshot** removable and each apply run deleted one. This is a scoped case, not a universal reclaim percentage. The raw report records all intermediate flags, shard counts and GC root/reclamation totals. Snapshot state is an exported bank check separately; native on-disk SQLite restart is not the same as the repository's snapshot replay.

## Deterministic matrix and status contract

`node tools/capability-matrix.mjs` reads the two raw JSON files, validates matched corpus/query hashes within each `(count, seed)`, rejects duplicate cells or mislabeled observed backends, and rewrites `matrix.json`/`matrix.txt` with no wall-clock field. It never reruns an engine or extrapolates a missing cell. `observed` means a backend actually executed and its name matched; `skipped` means unavailable native binary; `unsupported` means incompatible semantics; `missing` means the raw report contains no record. This run observed 10 JS/SWI cells, skipped 0, marked 5 Z3 Horn cells unsupported, and omitted 0 records in the declared 5×3 grid. Neither `advanced` routing nor fallback counts as a separate reasoning engine. No trained model was available or tested; this is a symbolic memory/reasoning comparison.
