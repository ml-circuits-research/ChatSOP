# ChatSOP: open tasks and acceptance gates

Direction: [AGENTS.md](AGENTS.md). Delivered work with observed evidence: [PAS_TASK.md](PAS_TASK.md). Open owner decisions: [questions.md](questions.md). The tiny-model branch is frozen (owner decision of 2026-10-01); its open items are kept in `probably_obsolete/tinyLLMExperiments/README.md`.

**The single goal:** beat small LLMs at reasoning through symbolic processing, and help small LLMs reason symbolically. **Validation procedure:** the benchmark in `experiments/proposal/symbolic-vs-llm-benchmark.md`. Every item below serves it.

**Progress rule:** `[ ]` means not executed or incomplete. When a task closes, move it into `PAS_TASK.md` with its artifact and the command or scenario actually observed. A failed gate blocks its dependants; it is never bypassed. **Working rules:** decide technical choices by principle (correct, generic, production-grade, user value); never plan in human weeks, launch milestones in parallel; name components, never "host"; soft approvals ("pare bun", "e ok") mean yes, but training needs the owner's own words per run; never touch port 9999 of the owner's running server.

## 1. Done in the freeze refactor (2026-10-01)

- [x] The tiny-model branch (Stanza and the Python UD worker, SymbolicLM, UD-to-SOP rules, LanguagesUtil, textToCleanEnglish, TranslatorService, LanguageProofingLLM, SymbolicProofingLLM, FormalizerLLM, GGUF model roles, training, the datasets `bad_english`, `symbolic_english`, `neuro_english`, `natural`, the corpus audit and `/audit`) moved to `probably_obsolete/tinyLLMExperiments/`; EmotionDetectionSystem and programming P0 to `probably_obsolete/paused/`.
- [x] The chat works through omp as the coding agent: `lib/query-author` writes circuits, the validator repairs in bounded rounds, the KnowledgeLinker links entity strings, the StrategyRouter picks the strategy, `sop/answer-text.mjs` renders the English answer. No SymbolicLM fallback: no model gives `parse_unavailable`.
- [x] Specifications renumbered gap-free DS000 to DS022; the API reduced to the product (`docs/api.html`).
- [x] Delivered earlier and kept: linking M0 to M3 and R2, core-en content (M2), world-v1 base memory, slice path from memory to the reasoner, StrategyRouter v1 (140 of 140 smoke agreement, 17 of 17 scale cells), KBQA harness and sealed suites, hygiene H1 to H20 (see `PAS_TASK.md`).

## 2. Next

1. **Build the benchmark** `experiments/proposal/symbolic-vs-llm-benchmark.md`: task families F1 to F10 (multi-hop, count and aggregate, closed world and negation, transitive closure, constraints, temporal, rule chaining with defaults, contradiction, scale, natural-language KBQA), arms A and A' (small LLM, evidence as text), B (small LLM writes circuits) and C (subscription models writing circuits), preregistration `status/preregistrations/eval-symbolic-vs-llm-v1.json` before any sealed measurement. First close its gaps in the listed order: session circuits from the query author, one execution path for the chat turn and the harness, the host-form oracle limits.
2. **Subscription chain and answer formulation.** The author's model comes from a configured chain of subscriptions (default `openai-codex/gpt-6-luna`), with fallback on errors; omp may formulate the final answer from the result packet while the deterministic rendering stays the checked reference.
3. **Unknown words handled by the query author** (decision of 2026-10-01): when the memory lacks a word, the coding agent defines it as a session definition marked `assumed`, asks, or assumes; the validator admits only what DS014 allows.
4. **KBQA slice runs** (`tools/eval/kbqa`, `eval/suites/kbqa-*`, preregistered `eval-kbqa-v1`): staged 100, 300, all, with accuracy, wrong versus honest unknown and failure attribution by layer; the yardstick for the linker and the author. Open from the post-M0 result: open-vocabulary linking is far from the targets (relation accuracy 38.4%, wrong-link 14.6% of mentions); the linking suite is `eval/suites/linking-v1`.
5. **StrategyRouter evaluation** beyond v1: the planner, closure templates and the follow-ups listed under "StrategyRouter v1" in `PAS_TASK.md`; `compare/rank/except/measure` currently force the oracle, which exhausts its budget on recursion from about 300 facts.
6. **Large-data soundness:** the slice retrieval and the completeness guard decide the engine; rebuild world-v1 after upstream changes (`node tools/world-kb/build.mjs && node tools/world-kb/load.mjs --replace --with-core-en`, about 10 minutes); core-en drafts need owner review and acceptance through `addKnowledge`, and `config/relation-lexicon.json` should shrink to function words.
7. **Calibration of query authors** (`tools/eval/query-model-calibration`, `tools/eval/query-forms`): on the query-forms dev set codingAgentQuery with gpt-6-luna was 38.6% correct and 20.5% wrong; a wrong circuit executes to a confident wrong answer, so reduce the wrong rate before the answer rate.
8. **H21.** The unread surface of research memory engines (all but SQLite) and the strategy comparison set stay by decision; revisit when the benchmark shows which are used.

## 3. Blocked

- [ ] **External generator qualification.** No external generator endpoint or credentials are available; nothing was invented.
- [ ] **Source text stays in the local cache** (`datasets_sources/`) unless `docs/specs/DS011-source-rights.md` records it as cleared; inspired-by corpora take structure only.
- [ ] **Training.** None is planned; any run needs the owner's explicit approval for that run.
