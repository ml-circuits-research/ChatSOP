# Implementation brief: reasoning strategies (owner approval 2026-10-01)

Every implementation agent reads this file first. The approved design is `experiments/proposal/reasoning-wires-proposal.md`. The section 14 open questions take the reviewer's recommendations as defaults, and 14.10 is decided. The authoring guide is `experiments/proposal/wire-authoring-guide.md`. The owner's words: "dăm OK-ul, în mare pare bine … pe moment fă toate strategiile, fă-le noi cazuri în evalul de smoke, ulterior o să facem evaluări și mai dure."

## Shared rules

1. **Location.** Each strategy lives in its own folder `reasoning/strategies/<id>/`. Use small modules following DS001, with an `index.mjs` that exports the strategy object:
   - `id`
   - `capabilities`: the declaration of proposal §5.1, with all its dimensions
   - `available()`
   - `ask(program, query, options)`
   - optionally `prepare`, `update`, `check`, `dream`

   It returns the result packet of proposal §5.3: statuses, `rows` with per-row `conditional`, `used`, `proof` when provided, `complete`, `budget`, `route`, `notes`.
2. **Input.** The structured, desugared program comes from the parser, governance and desugarer in `reasoning/strategies/js-reference/` (the `js-oracle`).
   - Do not write a new parser.
   - When the grammar moves to `sop/` (done by grammar-docs-agent), switch the import if a `sop/` export appears. Until then, import from the js-reference folder.
   - Never import from `eval/` in product code.
3. **Never weaken an answer.** A circuit that needs a feature you do not declare gets `not_expressible`. A budget or horizon cut gives `budget_exhausted` with a `reason`, never `unknown`, `refuted`, `no_plan` or `optimal`. Follow proposal §6.
4. **Shadow gate (proposal §5.4).**
   - On every smoke case your strategy declares, it must agree with `js-oracle` on status, rows and counts.
   - Replay your `used` in the oracle.
   - The target is 0 disagreements on exactly decided cases. Report any disagreement and resolve it from the proposal's semantics. If the oracle is wrong, say so with a minimal case. Do not change the oracle's code: report it to the orchestrator in your final message.
5. **Smoke adapter.** Write `eval/smoke-reasoning/adapters/<id>.mjs`.
   - Register it in `adapters/index.mjs` by adding ONE import and ONE array entry. Other agents edit the same file, so re-read it immediately before editing and keep your edit minimal.
   - Remove your stub from `planned.mjs` the same way.
6. **New smoke cases.** Add cases that exercise what is distinctive about your strategy. Each is a folder in `eval/smoke-reasoning/cases/` with:
   - the circuits;
   - the query;
   - `expected.json`, derived by hand AND checked on `js-oracle` when the oracle can express the case;
   - a README naming the feature.

   Use only your assigned number range, so agents do not collide. The new circuits must pass `node eval/smoke-reasoning/validator.mjs`.
7. **Binaries.** These are private and already present: `tools/.solvers/{swi,z3,clingo,souffle}`, with env `SWIPL_BIN`, `Z3_BIN`, `CLINGO_BIN`, `SOUFFLE_BIN`, and probing the same as `eval/smoke-reasoning/adapters/planned.mjs` `probeBinary`. Use `node:sqlite` for SQL.
   - Install nothing.
   - Run subprocesses with a timeout, and map a timeout to `budget_exhausted reason wall`.
8. **Tests.** Write `tests/strategy-<id>.test.mjs` with unit tests for the tricky semantics. `npm test` must be green for your files. Other agents work concurrently: if a failure comes from someone else's files, report it and do not fix it.
9. **Limits.**
   - Do not touch port 9999, `datasets/`, `config/formalizers.json` or the chat. (Superseded on 2026-10-01: the old `reference`/`advanced` routes of `reasoning/reasoner.mjs` were retired; `reference` is now the oracle through `reasoning/bridge/`, see the note at the end of this brief.)
   - No GPU. Do not kill processes you did not start. Do not commit.
10. **Records.**
    - Journal events, actor `CHATSOP_ACTOR=<your agent name>`, exported in every shell: started, milestones in plain words, done.
    - A topic note in `reasoning-strategies`, kind result, never decision.
    - A CHANGES.md entry at the top.
    - A short subsection for your strategy in `docs/specs/DS006-reasoning.md` under a heading "Strategies". Keep your subsection separate; other agents add theirs. Re-read before editing.
11. **Final report, short.**
    - Smoke results for your strategy: pass / fail / not expressible.
    - Shadow disagreements and how they were resolved.
    - The new cases.
    - Speed notes.
    - Known limits.

## Case number ranges

| agent | strategies | case range |
|---|---|---|
| planner-agent | conform lowered to core rules; `htn-strips-planner` | 40–49 |
| sql-agent | `sql-sqlite` | 50–54 |
| prolog-agent | `prolog-tabling`, `golog-swi` | 55–59 |
| solver-agent | `asp-clingo`, `z3-smt-bounded` | 60–64 |
| datalog-agent | `datalog-souffle`, plus `datalog-e10` and `datalog-soplab` vendored as product strategies | 65–69 |
| vrc-sopr-agent | `vrc-compressed-planning`, `worlds-sopr`, `dreaming-session` wrapper, native closure template | 70–79 |

`neural-assist` is deferred: there is no evidence for it yet.

## Vendoring the zip engines

The unpacked zips under `datasets_sources/experiments_unpacked/` are gitignored, so product code must not import from them.
- When a strategy is based on a zip engine (E10, soplab, VRC, sop-r), copy the needed modules into `reasoning/strategies/<id>/vendor/` with a header naming the zip, path and version. The engines are the owner's own experiments, the same project lineage.
- Keep the zip's own tests that matter, adapted under `tests/`.
- Then switch the smoke adapter from the zip path to the product strategy.

## Pruned on 2026-10-01

Owner decisions in chat, recorded after the strategies were built:

- The old JavaScript reference reasoner (`reasoning/reasoner.mjs` and its `js-reference` smoke column) is retired: the oracle `js-reference` does everything it did (the query forms were ported to `js-reference/forms.mjs`, time and the packet of the runtime live in `reasoning/bridge/`). `reference` is an alias of the oracle; `advanced` is deprecated (the oracle plus the optional external backends).
- `prolog-swi` (the old SWI adapter) and `z3-lia` (the old Z3 adapter) are removed: `prolog-tabling` and `z3-smt-bounded` supersede them. The `neural-assist` stub is removed.
- `datalog-soplab` is demoted to a reference engine (`eval/reference-engines/datalog-soplab/`, opt-in smoke column `--with-reference-engines`, differential tests only); `golog-swi` is frozen (`--with-frozen`); `conform-core` is merged into the `js-oracle` column as its `conform` capability.
- The default smoke columns are the oracle, `prolog-tabling`, `datalog-e10`, `datalog-souffle`, `asp-clingo`, `sql-sqlite`, `z3-smt-bounded`, `htn-strips-planner`, `vrc-compressed-planning`, `worlds-sopr`, `closure-template`, `dreaming-session` and the two `llm-agent` baselines.
