# Benchmark plan: symbolic reasoning vs small LLMs

Status: adopted by the orchestrator on 2026-10-01 for the owner's single goal ("symbolic reasoning that beats small LLMs and helps small LLMs reason symbolically"). Written by a planning agent (Fable) from the code at commit `97188d6`; paths may move in the freeze refactor that follows. Implementation goes through omp tasks (gpt-6.1); the preregistration is written before any sealed measurement.

## 0. Where the code stands

- Sealed KBQA (`eval/suites/kbqa-*`: Mintaka CC BY 4.0 1000, LC-QuAD 2.0 CC BY 953, SimpleQuestions CC BY 3.0 1000, QALD-10 MIT 393): the frozen SymbolicLM chain reached 0–1% on Mintaka/LC-QuAD/QALD and 22.7% on SimpleQuestions, with 85–90% of the failures in linking; Grok/GLM/Codex reading the same slice as text scored 37–48% (`eval/reports/current/kbqa/summary.md`). KBQA today measures plumbing, not reasoning.
- codingAgentQuery with gpt-6-luna on the query-forms dev set: 38.6% correct, **20.5% wrong**, median 23 s, 0.002 USD per question (`eval/reports/current/query-parsers/report.md`). Wrong circuits (a dropped `compare any`, a name left out) execute to confident wrong answers.
- The engines beat LLMs where it counts: router 140/140 agreement and 17/17 scale cells (`eval/reports/current/router/`); the llm-agent scale probe (case 80 shape) shows Grok-reasoning wrong at 60/150/400 nodes and GLM wrong at 150 (`eval/reports/current/llm-agent/scale-probe-chain.json`); Grok non-reasoning 74% core on 136 smoke cases.
- Local assets: NVIDIA GB10; `models/proofing/gguf/qwen3-{0.6b,1.7b}-q8_0.gguf`, `models/qwen3-4b-instruct/`; souffle/clingo/swi/z3 under `tools/.solvers/`; omp; every model call goes through TinyAgent (`lib/tinyagent.mjs`), which starts, shares and stops the local llama-servers (the local Qwen3-4B-Instruct is tier `micro`; the harness's own llama-server management and the calibration helpers are archived in `probably_obsolete/tinyagent-migration/`).

## 1. Task families

Each family has dev and sealed generated instances and, where a licence allows, a public probe set.

| # | Family | Instances | Gold | Why it discriminates |
|---|---|---|---|---|
| F1 | multi-hop over a large KB | world-v1 (≈357k facts), 2–4 hops; `tools/eval/formalization/query-forms/gold.mjs` two-source agreement | oracle on world-v1 | the LLM must hold thousands of neighbourhood facts; Mintaka `multihop` as a public probe |
| F2 | count / aggregate / superlative | world-v1 counts and ranks; `bench/datalog-scale.mjs` groupAggregates 10^3–10^5 | construction / oracle | LLMs miscount beyond ~30 items; Mintaka `count`/`superlative` probes |
| F3 | closed world, negation with completeness | `negationChain`; smoke cases 05b/05c/81a/81b/22; `closed true` vs open predicates | construction | exact `absent`, `at_least` bound, honest `unknown`; every Grok run fails 05c/81b |
| F4 | transitive closure / reachability | `ringComponents`, `selectiveChain`, `denseNonlinear`, case-80 shape with cut, blocked and 3N distractors, 10^2–10^6 | construction | the measured LLM failure (a missing link overlooked) |
| F5 | constraint satisfaction | `constraint` wires (z3 / oracle enumeration), small scheduling and assignment puzzles, cases 06a–06c/60 | oracle / z3 proof | Zebra-style; public sets (ZebraLogic, LogicNLI) only as statistics unless DS011 clears them |
| F6 | temporal | world-v1 `born_on`/`died_on`, `at`/`during`/`overlaps`, derived throughout with gaps (cases 12a–12g, 84) | oracle | boundary and gap errors (84 fails on non-reasoning Grok) |
| F7 | rule chaining with defaults and exceptions, depth 1–10 | ProofWriter-inspired generator (`tools/datasets/diversity/families.mjs` proofDepth, extended to depth 10, defaults and priorities as case 82); text passes `tools/datasets/no-copy.mjs` | oracle (desugared defaults) | the depth curve is the classic LLM cliff |
| F8 | contradiction / consistency | `integrity` wires, `both` status, cases 10a/17 at 10^3–10^4 facts | oracle | LLMs resolve `both` into one side |
| F9 | scale | every family at 10^3/10^4/10^5/10^6 facts (one engine process per cell, `tools/eval/engines/router-timing.mjs` pattern) | construction | the evidence no longer fits any context window |
| F10 | natural-language KBQA (realism) | the 4 sealed KBQA suites, measured once per stage, never tuned on | benchmark gold | ties the synthetic wins to public questions |

Each generated family writes `cases/<family>/<instance>/{knowledge.sop, query.sop, source.md, expected.json}` in the smoke format, so the `eval/smoke-reasoning/run.mjs` adapters and `lib/compare.mjs` are reused unchanged. `source.md` comes from a deterministic slice-to-English renderer (new), not by hand.

## 2. Arms

- **A**: small LLM, evidence as text, direct answer. **A'**: the same with chain-of-thought (the llm-agent `cot` reply rule). Both through `reasoning/strategies/llm-agent/` with a new completion runner (today `runner.mjs` is omp-only).
- **B**: the small LLM answers the step-by-step formalization questions (LocalLLMStepByStep, temperature 0) and the system assembles the circuit → `askMemory` (`reasoning/slice/wire.mjs`) → `routedAsk` → deterministic rendering. (Until 2026-10-02 B was the one-shot author `authorQuery`; one-shot formalization is archived in `probably_obsolete/one-shot-formalization/`, owner decision: tiers are compared on the same questions.)
- **C**: larger TinyAgent tiers (`small`, `good`) answer the SAME step-by-step questions as B, the same path as B (harness: `tools/eval/symbolic-vs-llm/run.mjs`, default arms `A,B-stepbystep`, arm C with `--tier`; the one-shot arms `B`, `B-grammar`, `B-structured`, `B-local` are archived).
- **Re-registration needed.** The frozen preregistration of the sealed protocol defined arms B and C as one-shot circuit authoring; before any sealed run they must be re-registered as step-by-step arms (a new DS007 preregistration or a recorded deviation). The existing preregistration JSON is kept unchanged. **D**: the same subscription model as A/A' (upper reference).
- Small models (GGUF, llama-server, one GPU worker, thinking off): Qwen3-1.7B Q8_0, Qwen3-4B-Instruct-2507 Q4_K_M and Q8_0, Qwen3-0.6B Q8_0 (floor), Nemotron-3-Nano Q8_0; Gemma-3-4B-it if exported. CPU timing on a 20-question sample only.
- **Fairness.** Same question text; the same wall budget per question (180 s) and the same token budget for A/A'/B; temperature 0; prompt versions hashed and frozen (the step-by-step protocol version).
- **Retrieval parity.** Arm A receives exactly the facts and rules of the slice the symbolic path retrieved for the gold circuit (`packet.retrieval`, `SliceRetrieval.facts`), rendered as English, plus the closedness declarations in words ("the list of X is complete"). When the slice exceeds the 90,000-character `maxChars` of llm-agent, A gets a capped keyed sample (the `factsFor` ranking of `tools/eval/kbqa/baseline.mjs`, 450 facts) and is told the list is partial; those rows are scored separately as `evidence_does_not_fit`, so a win by scale is never confused with a win by reasoning. A stricter condition (A-parity) gives A the author's own candidate view (entity hints and the 1-hop neighbourhood) to show the cost of retrieval itself.

## 3. Metrics (DS012 vocabulary, per family × size × depth × arm)

- Accuracy; **wrong** (a definite answer different from the gold, the dangerous class) vs **honest unknown** (unknown, incomplete, clarify, unclear); calibrated abstention = the wrong rate among answered and the unknown rate among answerable.
- Proof validity: symbolic arms carry `route.verification` (oracle replay); LLM arms are replayed with `llm-agent/verify.mjs` (re-derivation of `used`). The headline for B/C is "verified-correct".
- Latency p50/p95 split into parse, retrieval, engine and verify; cost per 100 questions (omp usage events; local = 0 plus tokens/s).
- Scaling curves: accuracy vs facts (10^2..10^6) and vs depth (1..10) per arm.
- **Practical margin:** B beats A when the paired-bootstrap 95% lower bound of (B − A) accuracy is > 0, the point estimate is ≥ 10 pp, and B's wrong rate ≤ A's wrong rate + 2 pp.
- Failure attribution (`failureLayer` of `tools/eval/symbolic-vs-llm/score.mjs`): `authoring` (invalid, unclear, or a circuit whose execution differs from the gold circuit on the same slice), `linking` (`unknown_predicate`, `entity_id_not_listed`, candidate recall miss), `retrieval` (`partial_retrieval`, budget), `engine` (`budget_exhausted`, `discrepancy`), `rendering`. Gold-circuit equivalence is decided by executing both on the oracle over the gold slice.

## 4. Protocol

- Split: every family is a set of forms; dev and sealed instances are lexically disjoint variants of the same forms (fresh entity and predicate names from `tools/datasets/diversity/names.mjs`, seeds split dev/sealed), checked by `tools/datasets/audit/content-word-overlap.mjs` and `tools/eval/formalization/query-forms/overlap.mjs` against `eval/suites/kbqa-*`. Sealed sets live under `eval/suites/symbolic-vs-llm-v1/<family>/`, read only by the harness and `eval/leakage.mjs`.
- Stages per family and arm: 100 → 300 → 600 (stratified by size and depth, seed 20261001), paired bootstrap with 10,000 resamples after each stage. Stop when decisive (lower bound > 10 pp), on futility (upper bound < 0), or when broken (> 20% empty/unparsable or `parser_failed` in the first 100 of an arm; the arm is dropped and recorded).
- Sample size: with ~30% discordant pairs, SE(B − A) ≈ sqrt(0.29/n): n = 300 gives ±6 pp, n = 600 ±4.3 pp; 80% power to show a lower bound > 0 at a true 10 pp gain needs ~230 pairs. 600 sealed per family is the full stage; most families should stop at 300.
- Preregistration `status/preregistrations/eval-symbolic-vs-llm-v1.json` (`chatsop-preregistration-v1`): system under test (arms, models, settings, memory versions, prompt hashes), data (generators, seeds, sealed paths, overlap check), hypotheses H1 (B > A by ≥ 10 pp on F2–F4, F7 at depth ≥ 3, F9), H2 (B wrong ≤ A wrong + 2 pp), H3 (B within 10 pp of C on F1/F10 for Qwen3-4B), H4 (A degrades monotonically with size and depth, B stays flat), metrics, decision rule, stopping rules, budget caps (paid 10 USD; subscriptions first), deviations.

## 5. Gaps to close first (ranked by expected impact)

1. **Query author phase 2 (session circuits).** `lib/query-author/validate.mjs` allows only `query/constraint/unclear/unparsed/stated supposed`; F4/F7 need the author to write `rule`, `default`, `predicate … closed` and `assumed` facts as session circuits (origin `coding_agent`), validated by the knowledge validator and joined to the `Theory`. This is also the owner's decision on unknown words (define, ask, assume).
2. **One execution path.** The chat turn (`server/agent.mjs`) runs the typed `Runtime` with `circuitRules` only; defaults, aggregates and `closed` reach only `askMemory`. The harness calls `askMemory`/`routedAsk` directly, and the product turn should delegate the same way.
3. **Host forms only on the oracle.** `compare/rank/except/measure` force the oracle (`reasoning/router/features.mjs` HOST_FORMS), which exhausts its budget on recursion from ~300 facts: superlatives over closures (F2 × F4) would all be `budget_exhausted`. Push the base relation to the engine and rank in a second oracle pass, or add the forms to `sql-sqlite`.
4. **Slice retrieval at scale.** `SLICE_DEFAULTS` (10,000 facts, 10 s) make a transitive `located_in` incomplete; the dev harness raises them to 60,000/60 s. Define class-dependent limits or engine-side retrieval for recursive demands (a SQLite recursive CTE on the repository), and report the bound in `retrieval`.
5. **Authoring wrong rate.** 20.5% wrong for C: add an answer-shape self-check round (the author sees the executed answer cardinality and a one-line paraphrase of its circuit before the answer is given) and make `mention_not_used` / `compare any` errors, not advice.
6. **Completion runner for llm-agent** and the **slice-to-English renderer** (facts, rules, closedness, time → deterministic sentences); without them arms A/A' cannot run locally or at scale.
7. Verification budget: `verify.budget` 3 s yields `unverified` on large closures; run verification offline with a larger budget in the report pass.
8. Cache hygiene: key the query-parser LRU and `state/llm-agent/cache` by run tag so reruns are reproducible.

## 6. Phased plan (parallel milestones)

- **M0 (parallel):** harness `tools/eval/symbolic-vs-llm/{run,score,report}.mjs` reusing the smoke adapters, `lib/compare.mjs` and the paired bootstrap of `tools/eval/kbqa/report.mjs`; preregistration draft; family generators F2–F9 (extend `bench/datalog-scale.mjs`, `families.mjs` proofDepth, world-v1 gold via `query-forms/gold.mjs`); renderer and completion runner (gap 6); gaps 1–3 in `lib/query-author`, `reasoning/router`, `reasoning/slice`.
- **M1:** dev pilot, stage 100, all families, Qwen3-4B Q4 and gpt-6-luna, arms A and B only; prompt/validator fixes recorded as deviations; freeze the preregistration; seal the sets.
- **M2:** sealed staged runs, all arms, scaling curves, attribution; report `eval/reports/current/symbolic-vs-llm/summary.md`; KBQA F10 once per model through the coding-agent parser.
- **M3 ("help small LLMs"):** B with session definitions and repair rounds vs A' on the same families; faithfulness of the optional omp answer formulation (severity rate of the rendered answer vs the packet, `tools/eval/lib/severity/`).
