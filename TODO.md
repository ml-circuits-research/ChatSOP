# ChatSOP: open tasks and acceptance gates

Direction: [AGENTS.md](AGENTS.md). Delivered work with observed evidence: [PAS_TASK.md](PAS_TASK.md). Open owner decisions: [questions.md](questions.md). The tiny-model branch is frozen (2026-10-01; `probably_obsolete/tinyLLMExperiments/README.md`). The previous version of this file, with the omp-era gates T1 to T12, is kept in `probably_obsolete/TODO-2026-10-02-before-cleanup.md`.

**The single goal:** beat small LLMs at reasoning through symbolic processing, and help small LLMs reason symbolically. **Measure now:** the owner's book problems solved end to end. **Validation procedure later:** the benchmark in `experiments/proposal/symbolic-vs-llm-benchmark.md`.

**Progress rule:** `[ ]` means not executed or incomplete. When a task closes, move it into `PAS_TASK.md` with its artifact and the command or scenario actually observed. **Working rules:** AGENTS.md (decide technical choices by principle, no hardcoded understanding, automated first, proxy tiers, minimal experiments, never touch port 9999 of the owner's running server).

## 0. Focus now (owner, 2026-10-02): solve the problems of the owner's books

Measure: book problems solved end to end (`datasets_sources/books/eval/`, 100 random at a time), correct vs wrong vs honest unknown.

- [ ] **Problem mode** for book problems: numbers, units, aggregates, step results; per-book report.
- [x] Exact decimals in all engines (fixed point / rationals; DS006 "Exact decimals in the engines").
- [ ] **No omp anywhere:** formalization, answer formulation and ingestion through direct proxy calls; LLMDirect on tier `small`, the step-by-step methods on `tiny`; omp code archived.
- [x] **Proxy tiers** in `LLMAPIProvider/`: `tiny` (local Qwen3-4B, always on), `small` (openference Qwen3.8 27b), `medium` (deepseek-v4-flash), `good` (deepseek-v4.1-flash), `best` (unconfigured); fallback chains; purpose/run tags; audit store of the cheap tiers.
- [ ] **LLMJobs (mini-omp)**, a self-contained component like `LLMAPIProvider/`: declarative jobs, deterministic control, adaptive tier ladder per task kind, per-run folders, budgets enforced by the proxy, planner and decider on `good`, Claude only for escalations; the product path for base-memory building and large session attachments. Follow-ups: (a) chat attachments with instructions and `POST /v1/memories/{id}/ingest` through `runTask`; (b) port the hand-run LLM loops to job specs (`tools/knowledge-mining/mine.mjs`, `tools/eval/books/score.mjs --judge`, `tools/eval/ingest-v1.mjs`, `tools/linking/judge/run.mjs`, `tools/eval/direct-files.mjs`); (c) a session target for `extract-table`/`label-entities` results; (d) tools that overwrite a fixed shared `summary.md` write per run (`tools/eval/kbqa/report.mjs`, `tools/eval/pragmatics/run.mjs`, `tools/eval/query-model-calibration/report.mjs`, `tools/linking/core-en/summary.mjs`).
- [ ] **Periodic audit** of the proxy's audit store by tier `medium` during and after batch work; problems escalate as short summaries; chat traffic only logged.
- [ ] **Direct ingestion** (`lib/ingest/`): one call per chunk plus validator repair, entity labelling included; rerun eval-ingest-v1 (the pipeline arm was 0/7 with unlabelled entities); A/B `tiny` vs `small`.
- [ ] **Knowledge from failures:** mine the general common sense needed by failed book problems into `commonsense-books-v1` (admitted only if it fixes a problem without regressions). Free sources: GenericsKB, ATOMIC 2020, Ascent++, Wikidata units; the ConceptNet CC BY-SA layer marked and attributed (owner: allowed).
- [x] **KnowledgeLinker and quantities:** class-vs-entity preference, units as values (`sop/quantities.mjs`), text-typed roles, multi-entity slice demand (11 of 15 failing commonsense rows fixed).
- [ ] **Rebuild world-v1** in `chat_data/` over the regenerated commonsense-v1 and the fixed `borders`/class mapping, when no agent writes to `chat_data/`; then delete the private builds under `work/`.
- [ ] Conversational chat and behaviour layer (wires, no text in code); small-talk collections and the admin base-memory composer (checkboxes over layers).
- [ ] **Repository green:** `npm test` with zero failures after the parallel work lands; architecture citations regenerated (`node tools/docs/build-architecture.mjs`); `tests/site-links.test.mjs` within its time limit; then a clean commit.

## 1. Backlog (owner, 2026-10-02, not urgent): proposal first in `questions.md`, then implementation

- [ ] **Session context over time.** A session accumulates wires (assumed definitions, added circuits); the user's statements are turn-local evidence. There is no unified mechanism for freshness or importance; partial mechanisms exist (replacement by name, memory generations and retention DS021, reinforcement on proof use, the behaviour layer's time since the last reaction). Design one mechanism for what is current or important in a session and how it ages.
- [ ] **Priority, frequency, probability (salience).** The symbolic side covers defaults with exceptions, rule priorities and time-valid facts; it lacks salience (what the user most likely wants, which fact matters more, how frequent or likely something is), which today is left to the formalizing model. Propose how salience enters the language, the memory and the routing without making the engine probabilistic or hiding it in code.

## 2. Later, still valid

- [ ] **Benchmark** `experiments/proposal/symbolic-vs-llm-benchmark.md`: task families F1 to F10, arms A and A' (small LLM, evidence as text), B (small LLM writes circuits: tier `tiny`), C (larger models writing circuits: tiers `small`, `good`); preregistration `status/preregistrations/eval-symbolic-vs-llm-v1.json` before any sealed measurement. The T5 dev pilot artifacts (`eval/reports/current/symbolic-vs-llm/t5-gold-preflight/`) used the omp-era authors and are to be rerun with the tiers.
- [ ] **KBQA slice runs** (`tools/eval/kbqa`, `eval/suites/kbqa-*`, preregistered `eval-kbqa-v1`): staged, with accuracy, wrong versus honest unknown and failure attribution by layer. Open: open-vocabulary linking far from target (relation accuracy 38.4%, wrong-link 14.6% of mentions; `eval/suites/linking-v1`).
- [ ] **StrategyRouter evaluation** beyond v1: the planner, closure templates and the follow-ups under "StrategyRouter v1" in `PAS_TASK.md`; typed interval `measure`/`order` still need the temporal bridge (`reasoning/bridge/reason.mjs`); the reasoning demo's `whatif` scenario fails after `plan_found`.
- [ ] **Large-data soundness:** slice retrieval and the completeness guard decide the engine; `config/relation-lexicon.json` should shrink to function words.
- [ ] **Step-by-step coverage** (on `tiny`): quantified questions (`mode every`), comparisons between named options, exclusions ("not X"), definitions of a missing relation other than reachability.
- [ ] **Chat findings of 2026-10-02:** (a) an assertion such as "My friend Zork lives in Lisbon." must be formalized as `stated`, not `unclear no_request`; (b) function words must not become entity strings in repair rounds; (c) counting over world-v1 includes namesake states (Kingdom of Denmark next to Denmark); (d) world-v1 has no population relation for "most populous".
- [ ] **Generality follow-ups:** rerun the aggregate forms (group-threshold, count-difference); bounded shortest path (arithmetic in recursion is refused); the natural question "How did the Silk Road change trade ..." crashed the node heap; the answer text leaks "ENGINE undefined / js" on unknown; free-text equality is exact ("flying" vs "fly").
- [ ] **Self-check default:** `server/agent.mjs` treats an omitted `queryParser.selfCheck` as true while the shipped default is off; align the caller and DS014/DS022.
- [ ] **H21.** The unread surface of research memory engines (all but SQLite) and the strategy comparison set stay by decision; revisit when the benchmark shows which are used.
