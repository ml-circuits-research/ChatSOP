# Wire discovery: rank the recurring jsEval shapes a wire type could absorb

> **Applicability in this repository.** This skill was imported from a sibling project whose shipped circuits live under `training-data/**/solution.sop`, with generators under `teacher/` and wire sources under `wires/`. ChatSOP has none of those directories, no `proposal_wires.md`, no `evaluation/registry/` holdouts, no `training-data/verify.mjs`, and no `procedural`, `composition-tranche` or `scheduling-tranche` test suites. Run the analyzer only with `--training-data <dir>` pointing at a compatible circuit corpus; in ChatSOP the gates below map to the corpus tests (`npm run test:data`, for example `tests/data/formalizer-corpus.test.mjs`), `node tools/datasets/verify-corpus.mjs --corpus <corpus> --all` and `npm run verify`. The wire inventory is [`docs/wire_types.html`](../../docs/wire_types.html), with one page per wire under [`docs/wire_typs/`](../../docs/wire_typs/overview.html). `skills/wire-discovery/last-report.md` is a dated observation from that external corpus, not a measurement of ChatSOP data.

The repeatable, tooled version of `proposal_wires.md`. It reads every shipped circuit and the
committed procedural generator, clusters each jsEval body into a normalized shape, and ranks the
shapes by (frequency x mean-lines x error-share), so the next wire proposal is decided by
measurement rather than by hand-counting. It is read-only on `training-data/`, `wires/`,
`tests/`, `teacher/`, and every evaluation file; its only writes are stdout and the report path
the caller names.

## When to run

Run `scripts/discover-wires.mjs`:

1. After every dataset change (a rebuild, a new tranche of families, an export): the shape
   frequencies and the line-cost map change, and a proposal must cite the new numbers, not the
   old ones.
2. After every new arm's error report lands (a new `evaluation/registry/exp-*/items/holdout.jsonl`):
   the error-share factor is read from the latest holdout, so the correlation must be recomputed
   against the newest failure classes before any candidate is proposed.

The latest holdout is hard-coded to the newest known run and updated in the script when the next
arm lands; `--holdout` overrides it for one run.

## What it produces

One deterministic run prints:

- measured totals: `solution.sop` files scanned, jsEval bodies scanned, distinct shapes found,
  wire-command counts, and the wires-per-circuit distribution;
- the error-class correlation summary from the latest holdout (how many shipped shapes occur in
  any holdout program, and how many of those occurrences are in failing items);
- the top-N ranked shapes (default 20), each with frequency, mean line count, distinct families,
  error share (with counts), and one representative body;
- the line-cost map of the procedural generator: which operators transcribe to a single jsEval
  line (a wire would not absorb them) and which already emit a declarative wire.

Pass `--report path.md` to write the same table as markdown. The skill owns
`skills/wire-discovery/last-report.md` as its landing spot; the caller names any other path.

## The deterministic method

1. Extract every jsEval body from every shipped `solution.sop` (each `@name jsEval` block up to
   the next `@` line).
2. Normalize deterministically: strip comments; keep string literals and numbers verbatim;
   replace `slots.<key>` members with a slot metavariable `K<n>` assigned by position of first
   appearance; replace `$wire` references with `$W<n>` by position; replace every other
   identifier that is not a keyword, a global, `probe`, `slots`, or a method/property name with
   a variable metavariable `V<n>` by position; canonicalize whitespace. Hash the result (sha1).
3. Cluster by hash; per shape count occurrences, mean non-empty line count, and distinct
   families (the directory one level above the instance directory).
4. Read the error classes from the latest holdout: a holdout item's program contains a shape when
   one of its jsEval bodies normalizes to the same hash. Error share is the fraction of those
   items whose class is not `answer_match`.
5. Rank by (frequency x mean-lines x error-share), ties broken by frequency x mean-lines.

The metavariables-by-position rule is what makes two instances of the same family collapse to one
shape while two different operator chains stay apart; it is the mechanical stand-in for the
hand-counted "recurring body shapes" of `proposal_wires.md`. The ranking is a proposal, never an
adoption: a high score says "measure this", not "ship this".

## The validation contract

A proposed wire type is **adopted only after both gates pass, and the verification runs in every
phase — generator change, rebuild, export, and arm — so no phase ships code that does not solve
the problem:**

1. **Family round-trip/oracle tests pass.** For every family the new wire appears in, the drawn
   statement round-trips through the family's parse, and the emitted circuit agrees with the
   family's independent oracle (in ChatSOP, the corpus tests under `tests/data/`, for example `tests/data/formalizer-corpus.test.mjs`).
2. **The circuit-execution check passes** (`node training-data/verify.mjs` in the source project;
   `node tools/datasets/verify-corpus.mjs --corpus <corpus> --all` in ChatSOP). It scans every shipped `solution.sop`, executes
   every circuit without inputs or model bindings, and compares each executed answer with the
   printed answer of its manifest row — every printed answer is reproduced.

The analyzer only proposes; it never adopts. A shape clears the proposal bar on line-reduction
evidence (multi-line AND recurring) and on mistake-reduction evidence (a positive error share in
the latest holdout). The report names which top candidates clear that bar; adoption is a separate
step that must run the two gates above, and a candidate that cannot pass them is not adopted no
matter how high it ranks.

## Scripts

- `scripts/discover-wires.mjs` — the analyzer. `node --check` it after any edit; run it with
  `--help` for the flags. Node.js built-ins only; no GPU, no servers, no rebuild, English-only
  output.


## The abstraction-learning loop (the standing goal)

The candidates are composable abstractions of two kinds: new wire commands AND new sandbox
helpers (the jsEval guest realm already injects `probe`, the `circuit` facade, and the contracts -
see `docs/wire_types.html` and `docs/wire_typs/` for the live inventory). Each experiment feeds the loop: measure the shipped circuits (discover-wires.mjs), flag the
monstrous jsEval bodies (the data-quality static checker), propose a wire with its contract and
its measured line reduction and error elimination, validate through the family round-trip/oracle
tests plus the circuit-execution check (which executes every circuit and reproduces its
printed answer - verification runs in every phase), and measure again on the next arm's holdout
against the jsEval baseline. Only a measured win keeps the wire; the goal is an increasingly
powerful vocabulary, experiment by experiment, beside the 90% benchmark hypothesis.
