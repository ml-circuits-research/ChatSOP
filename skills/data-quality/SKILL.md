# Data quality: flag the jsEval bodies that have outgrown a single wire

A static, deterministic scanner over the shipped circuits. It reads every
`training-data/**/solution.sop` (read-only), measures five complexity metrics on each `jsEval`
body, and flags a body as **MONSTROUS** when any metric trips its threshold. There is no LLM, no
model call, no execution, no GPU, and no server: the metrics are counted from the body text, and
the same input always produces the same numbers and the same report.

The output is a triage list, not a fix. Only the flagged bodies get human or agent attention; a
flagged body is a signal that a generator is still emitting a hand-written loop or chain where a
declared wire (or a container command) would absorb it. The fix lives in the generators, never in
the shipped `solution.sop` files.

## The five metrics

Each metric is computed per `jsEval` body, on the body after comments and string/template
literals are stripped (so a word inside a `probe` message never counts):

| metric | definition |
|---|---|
| `lines` | non-empty source lines of the body |
| `loops` | statement-level loop keywords: `for`, `while`, `do` (a `.forEach` is neither a loop nor a chain verb) |
| `chains` | method calls among `filter` / `reduce` / `map` / `sort` / `some` / `every` |
| `variables` | distinct names declared with `const` / `let` / `var` (destructuring and comma declarators counted; function parameters are not) |
| `depth` | maximum brace (`{}`) nesting depth — blocks and object literals |

## Thresholds

A body is MONSTROUS when any one metric exceeds its threshold. Defaults:

| metric | default | env override |
|---|---|---|
| `lines` | `> 15` | `DQ_MAX_LINES` |
| `loops` | `> 2` | `DQ_MAX_LOOPS` |
| `chains` | `> 3` | `DQ_MAX_CHAINS` |
| `variables` | `> 6` | `DQ_MAX_VARIABLES` |
| `depth` | `> 3` | `DQ_MAX_DEPTH` |

Override any threshold with an environment variable, e.g.
`DQ_MAX_LINES=20 node skills/data-quality/scripts/static-check.mjs`. A non-numeric or negative
override falls back to the default.

## The suggestion

Each flagged body carries a suggestion that maps its dominant shape onto a predefined wire,
chosen by the first matching detector in this order:

1. `fraction` — a gcd / reduced-ratio body (`gcd`, or `numerator` with `denominator`);
2. `graphPath` — an edge-list traversal (`edges` plus `shift`/`queue`/`visited`/`seen`/
   `adjacency`/`neighbour`/`degree`/`reach`/`connected`);
3. `aggregate` — a filter-then-reduce-to-scalar body (`.filter` with `.reduce` or
   `Math.min`/`Math.max`);
4. `container` — a build-then-query list (`.push` together with a later
   `filter`/`find`/`map`/`some`/`every`);
5. `candidate` — the body's normalized shape hash is one of wire-discovery's top shapes
   (measured in `skills/wire-discovery/last-report.md`);
6. `container` (fallback) — any remaining complex body points at the typed-store direction of
   the container plan (DS008).

The `candidate` bucket compares against the *current* wire-discovery report, so it is only as
fresh as that report: after a rebuild that changes body shapes, re-run
`skills/wire-discovery/scripts/discover-wires.mjs` before this scanner, or the candidate bucket
reads zero. A zero is not a bug; the report states how many wire-discovery top shapes still occur
verbatim.

## When to run

Run `node skills/data-quality/scripts/static-check.mjs` after every rebuild (and after every
export that changes the shipped circuits). The metric distribution and the flagged list change
with the dataset, so a triage decision must cite the newest numbers, not the old ones.

It is read-only on `training-data/`, `teacher/`, `wires/`, `tests/`, and every evaluation file;
its only writes are stdout and `skills/data-quality/last-report.md`.

## The workflow

1. **Run after every rebuild.** The scanner prints the full flagged list to stdout and writes the
   counts (with percentages) plus the flagged-list summary to `skills/data-quality/last-report.md`.
2. **Only the flagged bodies get attention.** A body below every threshold is left alone; the tool
   exists to shrink the review surface, not to expand it.
3. **Fixes happen in the generators.** A flagged body is a defect in the generator that emitted
   it (`teacher/**`). Change the operator/transcription that produces the long loop, the long
   chain, or the build-then-query list into a declared wire or a container command. Never edit a
   shipped `solution.sop` by hand — it is regenerated from the sources.
4. **Then the rebuild/verify/export gate.** After a generator change: regenerate the dataset,
   run `node training-data/verify.mjs` (it executes every circuit and reproduces the printed
   answer), run the family round-trip/oracle tests (`tests/procedural.test.mjs` and its sibling
   tranche suites), export, and re-run this scanner to confirm the flagged count fell. No phase —
   generator change, rebuild, export, or arm — ships code that does not solve the problem.

## What the report carries

`skills/data-quality/last-report.md` holds, per run:

- the thresholds in effect and their env overrides;
- totals: files scanned, bodies scanned, bodies flagged, files with a flagged body, each with the
  count and its percentage;
- the per-metric trip counts (bodies exceeding each threshold, as count and percentage);
- the distribution of how many thresholds each flagged body trips;
- the suggestion distribution over the flagged bodies;
- the flagged-body count per family, and the most severe flagged bodies (file, family, metrics,
  tripped thresholds, suggestion) as a representative sample.

The complete per-body list is on stdout; re-run the tool to see it.

## Scripts

- `scripts/static-check.mjs` — the scanner. `node --check` it after any edit; `--help` lists the
  flags (`--training-data`, `--report`, `--wire-discovery-report`). Node.js built-ins only; no
  GPU, no servers, no rebuild, English-only output.

## Running it manually

```bash
node skills/data-quality/scripts/static-check.mjs                    # stdout + the report
node skills/wire-discovery/scripts/discover-wires.mjs                 # shape analysis
node training-data/verify.mjs                                         # executes every circuit, reproduces the printed answer
```

Only Node.js built-ins — no dependencies. The report's bloat indicator is the headline: wires
per plan against hand-written JavaScript lines. On the current suite the numbers are ~2.2 wires
per plan against ~15.4 jsEval lines per plan (7 lines per wire), and the plans with at most 3
wires but more than 25 jsEval lines are the bloat class the next abstractions must absorb.

