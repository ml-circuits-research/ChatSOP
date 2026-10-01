---
title: DS013-engine-and-solver-comparison
summary: Reproducible bank, lifecycle, reasoning-by-memory, solver-qualification and strategy comparisons (the smoke-reasoning suite and its shadow gate) with explicit skipped, unsupported and incomparable cells.
---

## Scope and evidence

This specification describes **fresh local runs**, not historical benchmark values. The raw observations are `eval/reports/current/comparisons/engines.json` and `reasoners.json`; `matrix.json` and `matrix.txt` are deterministic derivatives. Commands run for these observations:

```sh
node tools/compare-engines.mjs
SWIPL_BIN=tools/.solvers/swi/swipl Z3_BIN=tools/.solvers/z3/bin/z3 node tools/compare-reasoners.mjs
node tools/capability-matrix.mjs
node --test tests/capability-matrix.test.mjs
```

Run in that order from the repository root: command 1 creates `eval/reports/current/comparisons/engines.json`; command 2 creates `reasoners.json`; command 3 reads both and creates `matrix.json` and `matrix.txt`. The scoped test requires no preexisting reports. `eval/reports/current/` is intentionally ignored by Git: these are reproducible local observations, not versioned historical results. Corpus seeds, engine/backend iteration, query order, matrix rows and file structure are deterministic; elapsed time and process/database measurements are observations and naturally vary between runs. The matrix is byte-identical when regenerated from unchanged raw reports. Solver paths above refer to optional private binaries; when absent, omit those environment assignments and native Prolog cells are recorded as skips.

The two private native solver binaries existed and reported SWI-Prolog 9.0.4 and Z3 4.15.8 on this host. If SWI is absent, its cells are **skipped**, never reported as advanced/JS observations. Z3's arithmetic backend does **not** execute these Horn questions: all Z3×memory Horn cells are **unsupported**, even when a Z3 binary exists. JS Horn and native SWI Horn form the observed 2×5 matrix; the explicit 3×3 target (JS, SWI, Z3 × at least RecallMemory, HoloMemory, SQLite) remains unfilled on its third row because a third compatible Horn solver is not implemented. Do not substitute a memory-independent numeric constraint result to fill it.

## Bank comparison protocol and observations

Five real banks (`recall-memory`, `holo-memory`, `sqlite`, `scan`, `hybrid`; [DS023](specsLoader.html?spec=DS023-recall-memory.md)–[DS027](specsLoader.html?spec=DS027-hybrid-memory.md)) receive the same typed atoms and query order per `(count, seed)`. The evaluator computes expected atom keys from the corpus but passes **only pattern and budget** into `recall`/`hints`, never answer keys. Counts 64 and 256, seeds 11 and 29, 24 uniform completion queries, 24 hotspot completion queries and one absent query per run. Every query has `maxProbes = 2 × count`, `limit = count + 1`; RecallMemory power is 12, HoloMemory has 4 banks × 256 rows × 64 dimensions; the five physical representations do **not** have equal-byte budgets. Full sample-level returned keys, expected keys, probes, timings, completeness and hints are in the raw report. Bank timing excludes SOP parsing, repository persistence and inference. `coldMs` is only the **first query on a newly built bank in that process**, not a new-process or disk-cold measurement; later hotspot and absent samples are warm. Warm latency distributions are per run, not claims about production workloads. First timings, GC and memory measurements depend on this host and are not universal.

Observed uniform exact result sets (two seeds, 48 queries per engine/count). The exact-set counts, byte sizes and hybrid hint counts below were reproduced by a fresh run on 2026-09-28 after the engines were renamed; latencies are from that run:

| Engine | 64 atoms | 256 atoms | Representation at 64 / 256 atoms, seed 11 |
|---|---:|---:|---:|
| RecallMemory | 48/48 | 48/48 | 40,960 / 40,960 bank bytes |
| HoloMemory | 42/48 | 28/48 | 65,536 / 65,536 counter bytes |
| SQLite | 48/48 | 48/48 | 90,112 / 212,992 database page bytes |
| Scan | 48/48 | 48/48 | 10,305 / 41,560 serialized payload bytes, **not heap** |
| Hybrid | 48/48 | 48/48 | 131,072 / 253,952 combined bytes |

HoloMemory abstentions/missed answers are not exact failures of SQL; the adapter requires reconstruction **and** integrity verification. HoloMemory is a third representation, not a substitute for deterministic exact enumeration. Probe units also differ: SQL counts matched SQL rows, not B-tree internal visits. Inspect `summary.uniform`, `summary.hotspot`, and `summary.absent` for the per-distribution cold/median/p95 latencies and full `samples` for the access distribution. For illustration only, seed 11 at 256 atoms produced warm uniform medians (ms): RecallMemory 2.495, HoloMemory 0.108, SQLite 0.023, Scan 0.039, Hybrid 2.481. These are measured bank timings, not end-to-end answer latencies.

Hybrid is explicitly **exact evidence + RecallMemory hints**. Its consumer invokes `bank.hints`, ranks only exact-verified `bank.recall` rows using hint membership, and never promotes unverified hints into evidence. Raw samples contain hint candidate/probe counts, `exactOnlyMs` from a subsequent same-bank control lookup, and `topChanged`. The latter lookup runs second on a warmer bank and is **not** a controlled independent latency comparison. On this small corpus, all hybrid hint candidates matched exact rows (384 per seed/count), `topChanged=0`; hint retrieval consumed extra work but changed no top answer. That negative result is not a claimed hint benefit. Production repository retrieval's `hybrid` strategy and the physical `hybrid` bank are different abstractions; this experiment measures the latter.

## Lifecycle, retention, and GC

The separate raw `lifecycles` records exercise each engine through real repository session commits and reopening, base fork isolation, other-user isolation, `asof` visibility before and after a retraction, archive checkpoint, pinned retention, bounded generational eviction, and mark/sweep GC. All five observed retraction survival after restart and pinned survival under bounded forgetting; the oldest normal generation was forgotten and the newest survived. Each GC dry run while a snapshot was pinned found zero removable snapshots, then closing that session and unpinning made **one snapshot** removable and each apply run deleted one. This is a scoped case, not a universal reclaim percentage. The raw report records all intermediate flags, shard counts and GC root/reclamation totals. Snapshot state is an exported bank check separately; native on-disk SQLite restart is not the same as the repository's snapshot replay.

## Deterministic matrix and status contract

`node tools/capability-matrix.mjs` reads the two raw JSON files, validates matched corpus/query hashes within each `(count, seed)`, rejects duplicate cells or mislabeled observed backends, and rewrites `matrix.json`/`matrix.txt` with no wall-clock field. It never reruns an engine or extrapolates a missing cell. `observed` means a backend actually executed and its name matched; `skipped` means unavailable native binary; `unsupported` means incompatible semantics; `missing` means the raw report contains no record. This run observed 10 JS/SWI cells, skipped 0, marked 5 Z3 Horn cells unsupported, and omitted 0 records in the declared 5×3 grid. Neither `advanced` routing nor fallback counts as a separate reasoning engine. No trained model was available or tested; this is a symbolic memory/reasoning comparison.

## Solver qualification

The solver qualification follows the same evidence rules as the comparisons above: every cell is a fresh local observation, a skipped backend is never an inferred match, and `advanced` is routing, not a solver.

### Solver scope and reproduction

This qualification compares the inspectable, bounded JavaScript reference reasoning route with SWI-Prolog on function-free Horn queries and with Z3 on integer constraints. `advanced` is the route selector, **not** a fourth independent solver. The cases are typed reasoning requests, not model-generated SOP or a model-quality benchmark. No training, optimization of neural weights, or neural inference is part of this exercise.

From the repository root, regenerate the evidence with the actual optional executables:

```sh
Z3_BIN="$PWD/tools/.solvers/z3/bin/z3" SWIPL_BIN="$PWD/tools/.solvers/swi/swipl" node tools/qualify-solvers.mjs
Z3_BIN="$PWD/tools/.solvers/z3/bin/z3" SWIPL_BIN="$PWD/tools/.solvers/swi/swipl" node --test tests/solver-qualification.test.mjs
```

The first command executed on the prepared ARM64 host and wrote [`eval/reports/current/solvers/qualification.json`](../../eval/reports/current/solvers/qualification.json): SWI-Prolog 9.0.4 and Z3 4.15.8 were available. Each observed cell stores the command, bounded input, result, and where applicable separate elapsed wall-clock observations. Without a binary, that backend's cells are recorded as **skipped**, not as inferred matches. Timings are individual local runs, not statistical latency estimates or a rank. The report's `reference`, `swi`, `z3`, `routing`, and `unsupported` sections are the cell-level evidence; reruns overwrite **current** evidence and can differ in timing or solver cutoff behavior.

### Observed solver matrix

All rows below refer to the executed command and same-named cells in the linked report; `supported` means derivable from admitted facts, not independently true in the world.

| Common Horn profile | Reference JS | SWI adapter | Qualification boundary |
| --- | --- | --- | --- |
| `recursion` (two-step ancestry) | supported; proof includes both parent facts | supported; closure agrees with JS | SWI computes ground closure; JS reconstructs proof |
| `variables-output` (select descendant) | supported; `bogdan`, `carina` | supported; same bindings | Answer projection is checked, not just status |
| `explicit-negation` | refuted | refuted | Explicit contrary evidence, not negation as failure |
| `time-in-range` / `time-out-of-range` | supported / unknown | supported / unknown | SWI facts are scoped at the explicit query instant |
| `contradiction` | both | both | Contradictory facts do not explode into arbitrary claims |
| `hypothesis` / `defeated-hypothesis` | conditional support / refuted | conditional support / refuted | Admitted hypothesis retains `hypothetical`; contrary fact defeats it |
| `fact-limit` (`maxFacts: 2`) | unknown, incomplete | unknown, incomplete | A truncated closure does not establish the missing derivation; agreement of two truncated *sets* is not a complete-profile proof |

The SWI rows separately record `costMs.nativeClosure` (direct `runSWI` process and compilation), `costMs.jsVerification` (JavaScript closure and proof-oriented reasoner), and `costMs.composedAdapter` (complete `solveHorn` path). The latter is not the sum of the first two independently timed calls. SWI does **not** supply an independent proof: `proofBackend` identifies the JS derivation checked against SWI closure. Completed closure cells assert set agreement; incomplete limit cells report the observed agreement flag but cannot establish equivalence. Reference JS exposes proof IDs and query bindings and uses explicit limits; it is an inspectable **oracle for this declared finite profile**, not an oracle for unobserved facts or unrestricted logic.

| Integer profile | Reference JS | Z3 | Qualification boundary |
| --- | --- | --- | --- |
| `sat-not-entailment` (`x=1` possible in `0..2`) | possible | possible; base, claim, and negated claim all sat | Existence is not entailment |
| `same-claim-not-entailed` | unknown | unknown; both claim and negated claim sat | An arbitrary model is not a proven scalar |
| `entailed` (`x=1` with only `x=1` permitted) | entailed | entailed; negated claim unsat | Countermodel check establishes entailment |
| `unsat-base` | inconsistent | inconsistent; base unsat | Inconsistent facts do not establish arbitrary claims |
| `non-unique-optimum` (`x+y=2`, maximize `x+y`) | optimal objective 2, scalar `x` ambiguous | optimal objective 2, strictly-better check impossible, scalar `x` ambiguous | Three distinct optimal assignments are present in the finite JS case; no single `x` is licensed |
| `timeout-1ms` (40 binary integers, sum claim) | **incomparable**; not enumerated | unknown, incomplete; base sat, both claim checks unknown on this run | A 1 ms solver bound is not refutation; result remains native Z3, not fallback JS |

`routing.reference-constraint` and `routing.reference-horn` observed JS, `routing.advanced-constraint` observed Z3, and `routing.advanced-horn` observed SWI. An `advanced` automatic constraint request with simulated unavailability used JS and disclosed the Z3 fallback (`routing.advanced-auto-unavailable`); this is not independent Z3 evidence. A direct Z3 request with the executable path intentionally made unavailable returned `unsupported` with backend `z3`, not a JS answer (`routing.explicit-z3-unavailable`).

**Explicitly unsupported / incomparable:** SWI interval queries (only point-time compilation was exercised), SWI numeric constraints, Z3 Horn proofs, and unbounded-integer JS enumeration are marked `unsupported` by observed rejection cells. Cross-family accuracy/latency aggregation is **incomparable**: the domains, proof responsibility, and composed process costs differ. There is no global winner or score.

### Solver provenance and read-side effects

The report records bounded synthetic inputs and actual backend outputs; it supplies no human validation, review, or real-world ground truth. A separate memory policy can promote an admitted, metadata-verified **observed** fact on real proof use, governed jointly by `policy.reinforce` and memory retention configuration; each such promotion is visible on the reason result. Qualification calls these reasoning backends with local supplied fixtures, not a repository write path, and does not itself exercise persistence or imply that mere query reads promote facts. Hypothetical, local, and non-metadata-verified evidence is not eligible for that promotion.

## Strategy comparison on the knowledge wires

The comparison above fixes one corpus and varies the engine. The strategies of [DS006](specsLoader.html?spec=DS006-reasoning.md) "Strategies" are compared the same way, on the knowledge wires of [DS004](specsLoader.html?spec=DS004-sop.md): the same circuits and the same question, only the strategy changes, and every cell is a fresh local observation (`eval/reports/current/smoke-reasoning/report.json`), never a historical number.

### The smoke suite

`eval/smoke-reasoning/` is the harness. A case is a folder `cases/<id>/` with `knowledge.sop` (the knowledge circuits), `query.sop` (the query circuit), `expected.json`, a `README.md` naming the reasoning feature, and optionally `memory.json` (the case then runs behind the retrieval layer). `expected.json` is strategy-neutral: the `status`, the `rows` or `count`, the `requires` list of features the case needs, the validator `warnings` the case declares, and the optional claims `conditional`, `used_support`, `used_incomplete`, `row_conditional`, `relaxed`, `obligations_triggered`, `compliance` and `retrieval`. The expected answer is derived by hand and checked on the oracle `js-reference` wherever the oracle can express the case; a case the oracle declares `not_expressible` (the modes of work) is an acceptance test of the strategy that declares the feature, and its answer is confirmed by that strategy's shadow run. Case ids use numeric ranges per feature family (`01`..`17` the core, `20`..`24` retrieval, `30`..`39` modes of work), so new strategies add cases without colliding.

`invalid/` holds circuits that must be rejected, each with the expected validator code on its first line (`# expect: code`); `validator.mjs` is the command line of `sop/knowledge/` (`--grammar`, `--grammar-compact`, `--authoring`), and the harness validates every case, every invalid fixture and the desugared form of every case before it runs a strategy. A circuit that fails validation never reaches an adapter.

### What a run does

`node eval/smoke-reasoning/run.mjs [--adapter id,id] [--case text] [--verbose] [--markdown] [--widen policy]` runs the self-tests (the comparator, governance, authoring mode, the Z3 lowering), validates everything, then runs one adapter per strategy on every case. An adapter declares the features it supports; a case needing another feature is `not_expressible` for it, a strategy whose binary is absent is `unavailable`, and a strategy not yet implemented is `planned` with its declared coverage shown as `exp` or `n/e`. The results are `pass`, `FAIL`, `n/e`, `plan` and `unav`; the summary per strategy gives pass, fail and not expressible counts and "of the cases it can express" the pass rate. A pass count is a check of agreement with the expected answer, not a measure of quality: a strategy is compared on the cases it declares, and what it cannot express is reported, never weakened.

The host rules that surround every strategy alike are part of the harness, so that all strategies get the same guard: the per-row `conditional` list verified by a second run (`lib/conditional.mjs`), the closed-world policy for counts and `every` over open predicates (`lib/closed.mjs`), `used` as one sufficient support set verified by replay (`lib/used.mjs`), and the retrieval layer with its widening loop (`lib/memory.mjs`, `lib/widen.mjs`).

### The comparison rules

`lib/compare.mjs` compares a normalized result with `expected.json` on status, rows, counts and the declared extra claims, and it fails an incomplete result that reads as `unknown`, `refuted`, `no_plan` or `optimal`, a result with `reason horizon`, `depth` or `domain` that reports anything but `budget_exhausted`, and a `used` that does not re-derive the answer when replayed alone in the oracle (never leaf-set equality: two sufficient sets both pass). The self-test of the comparator checks that each of these guards has teeth. The shadow gate of DS006 is this comparison: a strategy is accepted when it agrees with the oracle on every case it declares.

The retrieval study (cases `20` to `24`) runs the first live strategy that can express the case under four policies (`targeted`, `blind`, `whole`, and `targeted+unsafe` with the completeness guard disabled) and reports steps, retrieved wires, probes and the recall of the needed wires; the unsafe run shows what the guard prevents (a wrong answer) and is expected to be wrong.

### Reading a report

`report.json` holds `adapters` (declarations), `results` (per strategy and case: result, detail, route, retrieval) and `retrievalStudy`. Compare strategies by reading the cells of the cases both declare; a cell outside the declaration is `not_expressible`, not a defect. A disagreement between two strategies that both declare a case and both completed is a defect of one of them and is reported with the minimal case that shows it.
