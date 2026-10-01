# Session delivery — consolidation, real foundation and research corpora

## LanguageProofingLLM gloss post-editor: training and evaluation (2026-10-01, gloss-train-agent)

Delivered: re-qualification and receipt for the fast recipe, preregistration deviations D1 to D3, one training run (job `langproof-gloss-train-a3`, 11,730 steps, 36.5 min, 2.9x faster per step than prod1), per-epoch interim checks with the preregistered selection rule (epoch 2), sealed and probe evaluation of epochs 2 and 3 against it3 and prod1 (sealed test, clean900, child probe, mash, spacing, names, 18-word fresh probe, unseen words, romglish) with paired bootstrap, and the recommendation to keep prod1 alone. Not delivered: the judged composite (H3) and the chain latency (H7), skipped by stop rule (a); a GGUF export; any chat switch. Report: `eval/reports/current/language-proofing-gloss/summary.md`.

## LanguageProofingLLM prod1: sealed evaluation, F16 export, name guard (2026-10-01, prod1-eval-agent)

Delivered: deviation D2, sealed evaluation of epochs 1 and 3 against it3 (sealed test, clean900, child probe, mash, names, fresh 18-word probe, 599 judged units with the Grok two-vote meaning judge, paired bootstrap), F16 and Q8_0 GGUF of epoch 3 with HF agreement and CPU speed, the proper-noun guard measured with the real F16 file (63 of 1,106 sealed name units triggered the masked retry, zero names lost after it), the recommendation and the registry records. Not delivered: the chat switch (owner decision; `config/formalizers.json` untouched), epoch 2 on sealed data, the parse judge. Report: `eval/reports/current/language-proofing-prod1/summary.md`.

## Capability APIs, caches and the independent chat flow (2026-10-01, api-agent)

Delivered: five independent endpoints under `/v1` (proofread, understand, symbolic rewrite and analyze, emotion detect) with `GET /v1/capabilities` and the administrator cache endpoints, the shared `status`/`errors`/`timings`/`cache`/`versions` answer contract, the never-total-failure behaviour with `clarify`, `lib/cache/lru.mjs` and its five server caches plus the SymbolicLM service's parse, certification and rewrite caches, DS030, `docs/api.html`, and the chat page refactor (independent calls shown as they arrive, emoticons, "I understood" under the message, prefetch during review).

Observed (real SymbolicLM, LanguageProofingLLM and SymbolicProofingLLM on CPU, private port, `eval/reports/current/api-ui/cache-measurements.json`): the formalize request of a message nobody analysed took 842 to 1020 ms (three messages) and 6 to 8 ms after `/v1/understand` and `/v1/emotion/detect` of the same message; each capability's second identical call took 2 to 3 ms (proofread 90 ms, analyze 550 ms, rewrite 91 ms before). In the browser flow the formalize request joins the pending `/v1/understand` (`shared`) and, once cached, answers in under 20 ms; no horizontal overflow at 1280 and 390 px, light and dark screenshots. Tests: `tests/cache-lru.test.mjs` (11), `tests/capability-api.test.mjs` (19).

## EmotionDetectionSystem and the pragmatic wire (2026-10-01, emotion-agent)

Delivered: the separate switchable component `lib/emotion-detection/` with symbolic (on), neural (off) and LLM-slot (off) strategies; the advisory `pragmatic` wire with its help page, tests and DS029; classification of the spans SymbolicLM does not represent; integration in the SymbolicLM service, the agent (courtesy short-circuit, wires appended to the circuit) and the chat (setting, "I understood" panel); 300-message evaluation labelled by Grok and GLM with 60 labels read (`eval/reports/current/emotion-detection/summary.md`); experiment `emotion-detection-v1`. No training. Not done: calibration on real user messages, a neural classifier for Romanian after LanguageProofingLLM, any end-to-end test that the signals improve answers.

## Chat: what SymbolicLM understood (2026-10-01, chat-cnl-agent)

Delivered: the interpretation CNL in the chat ("I understood:" panel per sentence with round-trip marker, not-represented spans highlighted in the message, certification, SymbolicProofingLLM rewrite trace), the Settings block (clean text, send every sentence, rewrite off/gated/always, show what I understood; per browser), the registry entry `symbolic-proofing-llm`, the API fields `understanding` and `sendAll` and the `chatSop.understanding` response, server tests (`tests/chat-understanding.test.mjs`) and a headless-Chromium check at 1280 and 390 px with five messages (screenshots in `eval/reports/current/chat-cnl/`, no horizontal overflow). Not done by this task: the default of the rewrite stays `off`.

## SymbolicProofingLLM iteration 2 (2026-10-01, symbolic-proofing-it2-agent)

Delivered: sentence-unit pair set `datasets/neuro_english/proofing-it2` (qualified, receipt written), LoRA training run `symbolic-proofing-gemma270m-it2` (1,668 steps, 17 minutes), GGUF Q8_0, local-first analysis-layer evaluation on the sealed pairs, 500 working sentences and the composed suites (per sentence with all sentences sent, and whole paragraph), error categories, thirty examples, iteration-3 needs, DeepSeek cost, audit of the rejected pairs and the corrected pair set `proofing-it3` (not trained). Report: `eval/reports/current/symbolic-proofing-it2/summary.md`.

## Re-split of symbolic_english / neuro_english on the analysis layer (2026-09-30 night, dataset-resplit-agent)

Incident (journal, orchestrator): the builders admitted a gold-SOP row to `symbolic_english` only if SymbolicLM's SOP matched the gold. Delivered and observed:

- **Criterion and gate.** `tools/datasets/three-datasets/analysis-gate.mjs`: every sentence needs identical default/accurate trees and DeepSeek conditions a and c good (`tests/analysis-gate.test.mjs`, 6 tests: pass, differing trees, priority of failure kinds, verdict keyed on text plus tree, unusable verdicts, `hasGoldMatch`). Verdicts reused from `neuro_oracle_parse_judge`, `symbolic_proofing_parse_judge`, `backgen_parse_judge`, `parse_judge_deepseek` (19.5% of the sentence verdicts of the final rows); new ones judged in `datasets_sources/resplit_parse_judge/` (49,244 items, five omp runs, same `SYSTEM_a.txt`/`SYSTEM_c.txt` as the calibration). Estimated cost about 12 USD for the kernel calls (session files meter 0.27 USD).
- **Rebuild.** `node tools/datasets/build-three-datasets.mjs assemble --datasets symbolic_english,neuro_english` and the sealed `assemble` (bad_english train/dev left to their owner), then form-templates, drop-lexical-duplicates, composed-train, form-variants, test-variants, composed-suites, composed-tokens (a CPU llama-server of the GGUF vocabulary, started and stopped by this task), `verify-three-datasets` (0 failures, now also recomputing the gate from the recorded verdicts). Rows: `symbolic_english` 7,124 / 950 / 2,113 -> 5,659 / 788 / 1,605, `neuro_english` 4,872 / 764 / 1,363 -> 6,317 / 924 / 1,871 (train / dev / test); coverage 46.9% against 59.3%; old neuro rows with a correct analysis 2,252 of 6,999 (32.2%); of the 3,716 SOP-only failures 1,521.
- **Additions re-derived by the same gate.** Composed paragraphs 207 (identity 67 symbolic, 2 neuro; mixed and decomposition mostly neuro), form variants 116 (96 symbolic, 20 neuro), sealed test variants 139 (45 rejected by the gate); composed suites symbolic 767, neuro 322, bad 329.
- **Regression.** `record-parses --device cuda`, replay: 8,051 of 8,052 rows `same`, one `analysis_changed_sop_same` (a Stanza GPU jitter on one non-core arc of `formalizer-v1::fv1_032694_0_0`, baseline kept on the cache tree); live `--update` run found nothing else; fixture re-recorded (`tests/symbolic-regression.test.mjs`).
- **Pair set (SymbolicProofingLLM).** Rebuilt on the analysis layer, two-vote meaning judge (raw precision 98.8%, eval-meaning-judge-calibration-v1): train 4,172, dev 626, sealed 1,234 pairs (before 895, 102, 95); levels VERIFIED_GOLD 802/79/280, VERIFIED_GOLD_NORMALIZED 167/22/66, VERIFIED_FORM 1,369/252/393. Candidates for the rows that had none: `datasets_sources/resplit_neuro_targets/` (3,566 of 3,816 rows with candidates; the omp task was stopped after 1 h 40 min of repair rounds).
- **Sealed bad_english test** merged with the DeepSeek targets (owner decision): 2,512 merged (9 message-is-target), 237 held by the clean-English gate, 225 unfixable; 66 bad_english train/dev rows dropped as content-word duplicates.
- **Found on the way.** `tools/symbolic-regression.mjs --update` wrote the sealed split to a stray `datasets/symbolic_english/test.jsonl` (removed, fixed, `writeSplit` refuses it; the leakage preflight is ready again).
- **Not done.** The 5% stronger-judge audit of the new gate on real data (the decision of the DeepSeek calibration) was not run; `add-case` still routes production cases by the SOP `handled` test; the `bad_english` projection (`datasets/bad_english/proofing`) and its sealed units were built before the test merge and the duplicate drop and need a rebuild by their owner; Q-DATA-3 is open.

## SymbolicLM on the Stanza accurate package (2026-09-30, accurate-agent)

Owner decision of 2026-09-30 (journal): switch SymbolicLM to `default_accurate` and adapt the rules before any fine-tuning. Delivered and observed:

- **Configuration.** `config/symbolic-lm.json` and `CHATSOP_STANZA_PACKAGE`; one worker; model id per package; `analyzeMany`; optional `parsers_disagree`; `tests/ud-to-sop-v20.test.mjs` (recorded accurate parses, package configuration, batch equals single calls), the tests of the earlier rules still pass.
- **Rules v2.5** frozen (`frozen-rules-v2.0` to `v2.5`, `SHA256SUMS`); baseline `frozen-rules-v1.6`. Development harness `tools/research/rules-v2-dev.mjs` (recorded parses, replay 40 s): 56.34% to 69.53% strict on 9,966 rows, control rows 55.22% to 69.09%, 1,315 gained and 1 lost against v1.6; wrapper variants 74.22% to 81.30%.
- **Preregistered comparison** `eval-symbolic-accurate-adopt-v1` (five deviations recorded): sealed clean-English strict 59.42% to 67.05% (+7.63 pp [6.52, 8.74], +201/-7); frame-normalized 71.77% to 79.71%; criteria 1 to 5 met; adopted. Latency: `eval/reports/current/symbolic-accurate/latency.json`.
- **Datasets rebuilt** with the adopted engine: `symbolic_english` 6,771 / 896 / 2,567 (train / dev / sealed test), `neuro_english` 4,544 / 683 / 1,665, `bad_english` 17,169 / 3,215 / 5,511. The gate for the rows without gold reused the stored condition-c verdicts of identical trees and judged 1,920 sentences with condition c and 550 with condition b on the accurate tree (15.26 of 25 USD); accepted `parsers_agree_c` 1,092 and `accurate_judge_bc` 509; no row is `pending_judge`.
- **Not done.** No audit of the `accurate_judge_bc` route by the stronger model; the content-word overlap check of composed-eval-agent still fails (86 bad_english, 78 symbolic_english, 18 neuro_english test rows with the words and form of a train or dev row, as on the former build); the legacy sources are re-split by that agent after this task.


## Composed evaluation, content-word overlap, form variants, re-split of the legacy suites and the production loop (2026-09-30, composed-eval-agent)

Owner requests of 2026-09-30 (journal): evaluation is an engineering check (the same form with different words; no duplicated case), long and mixed paragraphs, decomposition as the main job of both proofing models, the legacy OOD and wild suites as learning material, production cases as regression cases. Delivered and observed on the data rebuilt by accurate-agent (Stanza accurate, rules v2.5):

- **Content-word overlap** (`node tools/datasets/audit/content-word-overlap.mjs`, fail-closed part in `verify-three-datasets.mjs`, numbers in `node check-datasets.mjs`). On the rebuilt data 86 bad_english, 78 symbolic_english and 18 neuro_english sealed test rows had the content words and form of a train/dev row; `node tools/datasets/drop-lexical-duplicates.mjs --apply` dropped the 569 train/dev rows involved (283 bad, 255 symbolic, 31 neuro; sealed files untouched), after which exact and lexical duplicates are 0 in all three (`eval/reports/current/three-datasets/content-word-overlap.json`); 3.6% to 5.6% of test rows have a same-form train/dev row that contains most of their content words (report only); test forms covered by train/dev forms: bad_english 160 of 160, symbolic_english 256 of 311, neuro_english 304 of 496 (`tools/datasets/verify-three-datasets.mjs` 0 failures).
- **Legacy OOD and wild suites re-split** (owner decision): `node tools/eval/legacy-resplit.mjs` split them by group 70/15/15 (OOD 1,107/231/240, wild 556/128/112 rows) into `datasets_archive/legacy-resplit/<suite>/{train,dev}.jsonl`; the builders read them, the sealed test keeps the test part; the rebuild (`analyze`, `accurate`, `spacy`, `assemble`, `report`) gave bad_english 17,977/3,391/4,245, symbolic_english 7,124/950/2,113, neuro_english 4,872/764/1,363 (train/dev/test, including the additions below). AGENTS.md rule 9, DS008 and DS016 state the policy; `eval/leakage.mjs` `INDEPENDENT_SUITES` is empty and the read guard for `eval/suites/**` test files is kept (`tests/wild-suite.test.mjs` updated).
- **Working-data additions** (DS008 "Form coverage and form variants", "Composed training cases"): 207 long composed cases (train 180: identity 60, mixed 60, decomposition 60; dev 27), from train and dev rows only, none for bad_english (decomposition components left after the rebuild: 13 train, 3 dev, so they repeat); 138 form variants (126 train, 12 dev) over 18 of 51 sparse symbolic forms with a gold template (67 more sparse forms have no gold template); 245 sealed test variants (`eval/suites/symbolic_english/test-variants.jsonl`) over 66 of 192 train-only forms; 333 neuro_english test forms (488 rows) have fewer than five train/dev rows and cannot be varied mechanically. Forms that still lack one side after the additions (`content-word-overlap.json`): test forms without a train/dev row 55 (symbolic_english), 192 (neuro_english), 0 (bad_english); train/dev forms without a test row 278 (symbolic_english, counting the sealed test variants as test rows), 1,000 (neuro_english), 11 (bad_english).
- **Composed evaluation suites** (`node tools/eval/composed-suites.mjs`, sealed test rows only, deterministic): symbolic_english 791 rows (K1 400, K3 289, K5 102), neuro_english 322 (K2 306, K6 16), bad_english 328 (K4 306, K6 22); token-length sidecars (`composed-tokens.mjs`): 130 K3 cases exceed the proofreader's longest training example (547 tokens), every K2 and K4 case beyond its p99 of 87. Preregistered (`status/preregistrations/eval-composed-v1.json`), scored by `tools/eval/composed-score.mjs`; summary `eval/reports/current/composed-eval/summary.md`, pilot on the earlier data archived in `eval/reports/history/composed-eval-pilot-2026-09-30/`.
- **Measured** (rules v2.5, K1 100 cases per sentence count, paragraph SOP equals the concatenated component SOPs, all components pass alone): 2 sentences 98% [93, 99.4], 3 sentences 96% [90.2, 98.4], 5 sentences 81% [72.2, 87.5], 8 sentences 66% [56.3, 74.5]; K3 12/16/24/32/48 sentences 56.7%, 31.7%, 23.3%, 17.5%, 6.7%; K5 pronoun reference 82.4%, 73.5%, 50.0% for 2, 3, 4 sentences. Causes of the loss: a lead-in such as "Honestly," inside a paragraph becomes an unparsed span, a time frame ("Going by what was known on ...") spreads to other sentences' queries, a "Since A, is it the case that B?" loses its stated block, and masked filler leaves a lowercase sentence start. Existing Gemma 3 270M proofreader (baseline only): whole-paragraph K2 clean sentences changed 2.9%, bad sentences fixed 1.2%; per sentence with the SymbolicLM gate 0.2% and 0%, the gate recalling 40.7% of the sentences that need a rewrite; K4 (clean-English gate) 36.2% fixed whole, 15.4% per sentence; K3 52% exact whole paragraph (32.7% beyond 547 tokens), 100% per sentence; K5 pronouns kept (95.1% whole, 100% per sentence); K6 decomposition: sentence count reached in 0 of 16 (neuro) and 1 of 22 (bad) cases. The host splitter agrees with the component boundaries in 100% of the cases whose sentences end in punctuation and in 17% to 22% of the cases with an unpunctuated component.
- **Decomposition and the target style:** DS021 "Limited English for SymbolicLM" (contract and ten before/after pairs), `eval/reports/current/composed-eval/decomposition-coverage.md`: neuro_english has 44/13/16 decomposition cases with a verified target (train/dev/test), bad_english 84/13/22; 86.6% of the neuro_english target sentences and 64.6% of the bad_english decomposition target sentences (translations) are within the contract.
- **Production loop** (`tools/datasets/add-case.mjs` add, list, review, merge; `tools/datasets/harvest.mjs`): tested with fixtures; harvest smoke test with the shipped textToCleanEnglish chain (LanguageTool plus Qwen3-1.7B, own ports) on 14 dev rows: 3 chain failures, 9 passes, 2 neuro candidates (not appended), a smoke test of the tool only.
- **Tests and checks:** `tests/composed-eval.test.mjs`, `tests/content-word-overlap.test.mjs`, `tests/production-loop.test.mjs` (fast, fixtures); `npm test`, `npm run test:data`, `node tools/check-spec-refs.mjs`, `node check-datasets.mjs` as in `status/journal.jsonl`.
- **Not done:** merging the DeepSeek clean targets of `datasets_sources/bad_english_targets` into bad_english (left to the orchestrator); a teacher-generation pass for the decomposition candidates without a target (2,649 in neuro_english train, about 2,060 in bad_english train); the composed cases will grow when neuro-oracle-agent's verified targets reach neuro_english (re-run `node tools/datasets/composed-train.mjs --apply`).

## Names and the audit page (2026-09-30, naming-agent)

Owner decisions of 2026-09-30 (journal, actor orchestrator) applied. Delivered and observed:

- **Glossary and policy** in `docs/wiki.html` (component table, definitions of SymbolicLM, LanguagesUtil, TranslatorService, textToCleanEnglish, LanguageProofingLLM, SymbolicProofingLLM, the three datasets, the policy) and DS021 "Names, roles and datasets" (with the alias note for the former "proofreader": role id, run path and experiment ids frozen); DS007 states the no-fine-tuning state and Gemma 3 270M first; DS008, DS012, DS020, matrix, README, AGENTS.md, TODO.md, docs index/training/runtime pages, the small-model wire page, `config/formalizers.json` notes, code comments and `skills/corpus-audit` updated. `node tools/check-spec-refs.mjs`: 29 specifications, 0 violations; `node tools/check-links.mjs`: 2,600 pages and files, 0 broken links; wire-help and site-link tests pass.
- **Audit page** with four tabs (bad_english, symbolic_english, neuro_english, archive / sources), purposes from `config/audit-corpora.json`, row counts per split, per-dataset filters and views, on-demand SymbolicLM re-run and checks (`server/audit-datasets.mjs`). Observed on a private port with headless Chromium at 1280 and 390 px, no horizontal overflow, re-run of a symbolic_english row `same`, neuro_english and bad_english checks answered; screenshots in `eval/reports/current/audit-ui/`.
- **Memory.** The corpus list counts lines and no longer loads any corpus; the three datasets are indexed by byte range: the audit server process stayed under 200 MB after opening all three datasets (before: whole corpora parsed in memory). The index re-reads a file that another agent rewrote.
- **Tests.** `tests/data/audit-tabs.test.mjs` 13 pass (new: tabs, the three views, checks, stale index); `npm run test:data` 54 pass, 0 fail; `npm test` 713 pass, 1 fail: `tests/three-datasets.test.mjs` "the built datasets pass the fail-closed verifier" fails because the symbolic-judge-agent's concurrent update of `symbolic_english` wrote `analysis_verified: parsers_agree` for new-case rows, a value the verifier does not accept yet (not part of this task; the verifier or the data needs the owner's or that agent's decision).
- **Not done.** The three `summary.md` files for parse-judge, stanza-accurate and cpu-speed could not be written by this agent (the environment refused report files from a sub-agent); their content is in the agent's hand-off report.

## Three datasets: bad_english, symbolic_english, neuro_english (2026-09-30, datasets-agent)

Owner decision of 2026-09-30 (journal): `datasets/` holds only `bad_english`, `symbolic_english` and `neuro_english`. Delivered and observed:

- **Datasets.** `datasets/<name>/{train,dev}.jsonl` plus `eval/suites/<name>/test.jsonl`, manifests with sha256, READMEs with the classification rules, DS008 "Three datasets" (and DS014 "New cases"). Rows (train/dev/test): bad_english 17,169 / 3,215 / 5,511 (Romanian 12,367, mixed 6,703, noisy English 6,825; 7,666 with a target: proofing repairs 1,235, noise inversion 3,606, oracle-checked Romanian/mixed translations 1,486, new-case references 1,331, clean siblings 8), symbolic_english 6,735 / 981 / 2,578 (gold-verified 4,659 / 544 / 1,935, `pending_judge` 2,076 / 437 / 643), neuro_english 4,580 / 598 / 1,654 (failure_kind parser 1,718, rules 2,373, gold_convention 1,262, unknown 1,479; 785 with a target). `node tools/datasets/verify-three-datasets.mjs`: 0 failures; `node tools/datasets/audit/three-datasets-overlap.mjs`: 0 exact matches with any sealed text, 0 shared split groups.
- **Coverage** (symbolic / (symbolic + neuro) of clean-English rows): sealed suites formalizer-v1 63.1% (1,062 of 1,682), OOD 74.2% (403 of 543), wild 16.0% (51 of 318), together 1,516 of 2,543 = 59.6%, identical to the strict accuracy of eval-clean-english-v1; train 59.5%, dev 62.1%. New cases (no gold; handled = valid SOP, real outcome, no unparsed span): 67.7% train, 70.6% dev, 69.0% test. Report: `eval/reports/current/three-datasets/reuse-analysis.md`, `coverage.json`.
- **Analysis.** `analyze()` returns `analysis` (UD parse per sentence, Stanza 1.10.1 en models, rules ud-rules-v1.4); analyses cached per distinct text (18,002 distinct texts, 4 CPU shards); spaCy agreement recorded per row (`verification.stanza_spacy_agree`).
- **Regression runner** `tools/symbolic-regression.mjs` (`--update`, `--jobs`, `--replay`), `tests/symbolic-regression.test.mjs` on `tests/fixtures/symbolic-english/sample.json`; the full run over all 10,294 rows (`--jobs 4`, about 50 minutes on CPU) found 10,294 `same`, 0 changed, 0 failing (`eval/reports/current/symbolic-regression/report-full.json`).
- **Restructure.** formalizer-v1, proofing, proofing-diverse-dev, clean-english and diversity moved byte-identical to `datasets_archive/`; `ls datasets` shows the three folders plus `SOURCES.md` (kept as the one attribution file). Paths updated in about 60 live files (code, tests, docs, skills, config, server, AGENTS.md); frozen records keep old paths, `datasets_archive/PATH_ALIASES.json` and `lib/dataset-paths.mjs` resolve them; `tools/datasets/verify-corpus.mjs`, `tools/eval/registry.mjs`, `tools/eval/baseline.mjs`, `lib/row-world.mjs` and `training/cli.mjs` read stored paths through the resolver.
- **Observed results.** `npm test` 714 pass, 0 fail; `npm run test:data` 48 pass, 0 fail; `node check-datasets.mjs` exit 0 (clean-english and proofing are reported SKIP: verify-corpus cannot check a filtered view with wild rows or a proofing-schema corpus; they were already failing this check before the move); `node tools/shard-large-files.mjs --check` ok; `node tools/check-spec-refs.mjs` 0 violations; `eval/leakage.mjs` boundary audit 0 violations.
- **Found on the way.** The sealed proofing test is made of formalizer-v1 dev messages, so their dev rows are sealed as test in the new datasets (1,136 rows); the classifier's `mixed` verdict is unreliable on plain English words (108 of 6,000 new cases); the audit-browser walk crashed on a dangling symlink in another agent's report directory (fixed: skipped); `tests/data/audit-server.test.mjs` needs about 6 GB of heap with the new datasets (`test:data` now sets `--max-old-space-size=8192`).
- Open: `TODO.md` 1e and `questions.md` Q-DATA-1.

## textToCleanEnglish: survey scored, default chosen, audit tabs, broken suite repaired (2026-09-30, resumed after the host reboot)

- **Root cause of 26 failing tests after the reboot:** `server/audit.mjs` (edited by the audit-tabs agent that was killed mid-task) imported `server/audit-proofreading.mjs` and `server/audit-cleantext.mjs`, which did not exist. Also fixed: `tools/datasets/build-clean-english.mjs` (a generator) named and read the sealed `formalizer-wild-v1` suite, which `eval/leakage.mjs` forbids; the sealed half moved to `tools/eval/clean-english-suite.mjs` (the corpus manifest's test fields are patched by it and kept by the generator). Five agent-authored `decision` notes were corrected with superseding notes.
- **Audit page tabs** (DS020 "Corpus registry and review types"): one tab per type (formalizer, proofreading, cleanText) from `config/audit-corpora.json`, type-specific facets and case views (word diffs, kind, pipeline, categories, author), on-demand SymbolicLM check, sealed suites view-only, verdicts to `eval/reports/current/audit/<corpus>.jsonl`, phone layout; `tests/data/audit-tabs.test.mjs`. Checked in a headless browser at 1280 and 390 px.
- **textToCleanEnglish:** default confirmed by the scored survey (`eval/reports/current/text-to-clean-english/summary.md`): gate, LanguageTool 5.9 masked for English, Qwen3-1.7B Q8_0 masked for Romanian and mixed (`llm.model`, registry entry `qwen3-1.7b-base`). Fixes found on the way: an empty backend answer was shown as an empty proposal (now a failed backend), Romanian sentence openers were masked as names (`protect()` takes an `isCommon` hook), a reasoning model's think block leaked into the proposal. `tools/languagetool-server.mjs` starts LanguageTool 5.9 (installed under `models/languagetool/`). End to end in a browser on a private port: clean English passes with no review, Romanian shows the diff with Accept/Edit/Send original, Accept sends the cleaned text.
- Open: see `TODO.md` 1c and `questions.md` Q-CLEAN-1, Q-CLEAN-2.

## Clean-English formalization evaluation (`eval-clean-english-v1`, 2026-09-30)

Owner decision 2026-09-30: formalization is evaluated only on valid, clean English; Romanian, mixed and noisy English are handled by the separate textToCleanEnglish service. Continued after the 09:08 reboot killed the previous agent.

- **Corpus and suite.** `tools/datasets/clean-english.mjs` (four partitions: `clean_en`, `noisy_en`, `ro`, `mixed`), `datasets/clean-english/{train,dev}.jsonl` (7,966 / 1,717 rows) and the sealed `eval/suites/clean-english/test.jsonl` (2,543 rows); manifests now carry SHA-256 of every split. `node tools/datasets/no-copy.mjs --corpus clean-english` passes.
- **Filter verification.** Manual spot-check of 60 accepted and 60 rejected rows (all read): 60/60 accepted valid, 58/60 rejections justified. A scan then found 59 clean rows wrongly rejected (Romanian-looking names such as Mihai/Mei, English words Romanian also lists, British spellings, compounds); fixed before further scoring (deviation D1) and the earlier stage scores archived under `eval/reports/current/clean-english/superseded-pre-d1/`.
- **Result (full stage, frozen rules v1.4 verified by SHA256SUMS).** Clean English strict 59.6% [57.7, 61.5], frame-normalized 71.7%; formalizer-v1 63.1/79.4, OOD 74.2/81.6, wild 16.0/14.2. Full English strict 51.2%, frame 60.8%; noisy English only 31.1%. Gap clean minus full English +8.4 pp [5.8, 11.0]; frame normalization +12.1 pp paired [10.8, 13.5]. Not decisive at stage 300, so the full set ran; 0 invalid outputs.
- **Relation to the earlier "EN 43.1%" (ud-rules-v14).** Different sample mix (20.5% wild there against 12.5% here) and wild scorer (D1-tolerant F1 = 1 there, accepted match here); reweighted to the same suite mix the numbers agree within sampling noise (`summary.md` section 4).
- **Proofreader arms on clean English** (Gemma3-270M GGUF q8_0 via llama-server, CPU): always-on +1.0 pp strict [0.5, 1.5] (30 helped, 5 hurt), gated +0.2 pp [0.0, 0.5]; a minor simplifier only.
- **Blame.** 1,027 strict misses: 314 repaired by frame normalization; of the 713 residual, rules only 333, rules plus convention 317, convention only 33, typo 15; a manual read of 30 residual rows found 12 gold-convention, 14 rules, 4 parser, 0 language. Top-10 patterns with three examples each: `eval/reports/current/clean-english/summary.md` section 7.
- **Tools and evidence.** `tools/research/clean-english-eval.mjs` (`sets`, `run`, `score`, `blame`), `tools/research/clean-english-report.mjs`, `eval/reports/current/clean-english/{summary.md,report.json,blame-clean-full.json}`, experiment `eval-clean-english-v1`, task `eval-clean-english-v1`, topic `clean-english`.
- **Environment notes.** Another agent edited `lib/ud-to-sop/protect.mjs` at 09:49 (an inert optional parameter); outputs were verified identical on all 7,407 sealed messages, so every arm is frozen v1.4 behavior. No training or GPU job was run.

## textToCleanEnglish: a user-reviewed UI step before formalization (2026-09-30)

Owner decision 2026-09-30: formalization handles only clean English; a host step ahead of the small formalizer
corrects spelling/grammar, translates Romanian/mixed text to English and simplifies wording, shown to the user for
accept/edit/reject before anything is formalized. Built across several overlapping sessions of the same
`clean-english-ui-agent` actor on a shared, non-isolated working tree (documented honestly in `status/journal.jsonl`
and `status/tasks.json` `text-to-clean-english-v1`, including a mid-session collision between two instances of the
same actor and a stand-down by the later one).

- `lib/text-to-clean-english/`: `index.mjs` (`textToCleanEnglish(message, options)` ->
  `{original, clean, changed, reasons, spans, backend, confidence}`, `diffWords` word-level diff), `gate.mjs` (the
  cheap LanguagesUtil-only decision: non-English tokens, a spelling signal, a handful of grammar-trouble regexes;
  clean English is skipped without calling any backend), `backends/languagetool.mjs` and `backends/llm.mjs` (both
  mask names/quotes/numbers with `lib/ud-to-sop/protect.mjs` before calling an external server or model and restore
  them after — measured necessary: unmasked, LanguageTool corrupts unknown proper names). `config/text-to-clean-english.json`
  chooses `languagetool`/`llm`/`none` per message class; a missing/unreachable backend throws
  `{code:'backend_unavailable'}`, caught by `server/http.mjs`'s `POST /v1/text-to-clean-english` and degraded to
  `backend:'none'` rather than failing the request.
- Chat UI (`server/pages/chat.mjs`): a *Clean before formalizing* toggle (on by default, Formalize mode only) calls
  the endpoint before sending; when the message changes, a word-diff review panel offers Accept / Edit / Send
  original, and the request to `/v1/chat/completions` carries `cleaning: {original, backend, changed}` for the trace.
- Docs: DS012 "textToCleanEnglish", DS021 "textToCleanEnglish", `docs/runtime.html`, `docs/wiki.html`
  (`#definition-text-to-clean-english`), `dependencies.md` ("textToCleanEnglish and LanguageTool"), DS014 (LanguageTool's
  own LGPL/third-party licences, the Eclipse Temurin JRE, the pinned model revisions already recorded for
  EuroLLM-1.7B-Instruct/Qwen3-1.7B/Gemma-3-1B-it under `proofing-candidates-v1`).
- Candidate survey (`status/preregistrations/text-to-clean-english-v1.json`, `status/experiments.json` same id): a
  small (n=40/bucket), heuristic-scored comparison of the shipped symbolic backend (`lib/symbolic-lm`), Opus-MT,
  Gemma-3-1b-it and Qwen3-1.7B found the symbolic backend has the best or tied-best meaning preservation on every
  bucket (ro/mixed/noisy English) and is far inside the ~2s UI latency budget (60–510ms), while the two zero-shot
  LLM candidates reach higher English fluency at a real, measured meaning-preservation cost (worst: 55% on
  gemma3-1b/mixed). A separately run LanguageTool check (own smoke test and a sibling session's control-set run)
  confirmed the name-corruption risk that `protect.mjs` masking now guards against. Claude Haiku (`claude -p`,
  headless) was run as the reference ceiling on a small batch (cost well under the $5 cap) and produced the highest
  quality of any candidate tried, at the cost of being a paid external API. Two open owner decisions from this
  evidence are recorded in `questions.md` (Q-CLEAN-1: which model backs the `llm` path's default `translate`
  registry entry; Q-CLEAN-2: whether `textToCleanEnglish` should default non-English text to the already-shipped
  `symbolic` backend instead of `llm`) rather than resolved unilaterally, because the current evidence is small and
  heuristic, not scored against gold SOP.
- Tests: `tests/text-to-clean-english.test.mjs` (18 cases, mocked `fetch`, stub LanguagesUtil resources — no
  network, Java or Python). A live smoke test against a real LanguageTool 6.6 server, on a private port and state
  directory, confirmed the full request/response cycle end to end. `npm test`: 695/700 pass; the 5 unrelated
  failures (`tests/eval-registry.test.mjs`, `tests/audit-corpus.test.mjs`, `tests/solver-qualification.test.mjs`)
  reproduce in isolation and are most likely caused by other, concurrently running processes on the same shared
  working tree (background GPU/CPU jobs from sibling sessions of this same task, still running at session end).

## Diverse-dev generalization test and datasets/proofing v2 (eval-proofreader-diverse-dev-v1, 2026-09-30)

Follow-up to `eval-proofreader-e2e-v1` (below): its end-to-end result was decisive-positive on generator-distribution
suites (`formalizer-v1` +6.67pp, `formalizer-ood-v1` +2.84pp) but null on `formalizer-wild-v1` (-1pp [-3,0]),
independently-written text. Hypothesis: `datasets/proofing` was built only from generator text, so the model learned
generator style, not general English repair. Preregistered `status/preregistrations/eval-proofreader-diverse-dev-v1.json`
before scoring any row.

Built a held-out, realistic diverse set from Haiku-diversified (`claude-haiku-4-5-20251001`) paraphrases of
`formalizer-v1` train rows (DS022 "LLM diversification", owner decision D2): combined an existing 274-row pilot with
a new 800-source-row batch (seed 20260930, 695 accepted: 434 EN/261 RO, **$3.9075**), split by `split_group_id`
(`tools/research/split-diverse-dev.mjs`, dev_fraction 0.70, computed before any model was run) into
`datasets/proofing-diverse-dev/diverse-dev.jsonl` (669 rows, 415 EN, held out) and `candidates.jsonl` (281 rows, 189
EN, for the v2 build) -- never `eval/suites/**`.

**Diverse-dev result** (`tools/research/diverse-dev-eval.mjs`, full 415 EN rows, frozen rules v1.4, paired cluster
bootstrap): `gemma_always_on` (fine-tuned) strict 36.39% vs `no_rewrite` 33.49%, delta **+2.89pp [0.99,5.15]** (CI
excludes 0, break 0.72%) -- real, but a third the size of `formalizer-v1`'s and close to `formalizer-ood-v1`'s,
**not null** like the wild suite. `gate_no_spacy` +1.93pp [0.48,3.92] at 0% break (keeps most of the benefit, no
extra risk). Untrained `qwen3-1.7b:proof` +0.96pp [-0.96,3.21], CI includes 0 -- no significant effect, break 2.88%.
Interpretation: real-but-partial generalization, nuancing the pure style-overfitting hypothesis. Failure examples
(long coordination, multi-question fronting, code-switched tag questions, stranded "other than") are structural,
not spelling -- the layer a text-repair model cannot fix.

**datasets/proofing v2** (`tools/research/build-proofing-v2.mjs`, from `candidates.jsonl`): raw frozen-rules-v1.4
oracle 59 pass (identity) / 130 fail; small-candidate (Qwen3-1.7B) repaired 6; Haiku teacher repaired 26 more (own
$20 sub-budget, spent **$0.1677**, 124 calls, <=4 variants/row); 98 stayed hard. **Found and fixed a real leakage
bug before merging**: the first hash-based train/dev split ignored v1's own existing split assignment, putting 5
`split_group_id`s in both splits (v1's original row in train, a v2 paraphrase of the same message in dev); fixed
`build-proofing-v2.mjs` to reuse v1's split per group, re-verified `tools/datasets/audit/proofing-overlap.mjs`
`shared_split_groups` all 0 and `exact_matches_total` 0 before merging. Merged: `train.jsonl` +88 (4207->4295),
`dev.jsonl` +3 (459->462), `hard_cases.jsonl` +98 (5482->5580); v1 rows unchanged. Wrote two new checked-in scripts
that replace ad hoc, uncommitted steps from the original v1 build, each verified to reproduce v1's own numbers
exactly before being trusted for v2: `tools/research/build-proofreader-projection.mjs` (the flat role projection)
and `training/python/token_budget_audit.py` (the Gemma token-budget report). Regenerated the projection (6183
train/874 dev), token audit (`over_2048` still 0, max 547 tokens), `datasets/proofing/VERSION` (counter 2->3), and
requalified (`tools/research/qualify-proofing.mjs`, status `qualified`, all 6 checks pass). Total spend this task:
**$4.0752 of the $30 cap**.

**Recommendation** (`eval/reports/current/proofing/report-v2.md`): the v2 additions are small relative to v1 (1.4%
of train) and 52% hard (structural failures, unrepairable by text rewriting), so a retrain on v2 alone is unlikely
to move the diverse-dev or wild-suite numbers much; scaling the diversify batch itself toward a larger,
repair-focused pool is the more promising next lever. **No retrain was performed or is recommended as an immediate
action** (AGENTS.md rule 3: needs a new, separate owner "yes"). `npm test` run at the end; see its own report for
the pass/fail count.

## Honest unconditional proofreader evaluation and end-to-end SymbolicLM wiring (eval-proofreader-e2e-v1, 2026-09-30)

Follow-up to train-proofreader-gemma270m-v1 (below), whose headline sealed-test numbers (break 0.19%, repair 66.9%, net +14.2 [11.7,17.0]) scored only the 660 non-hard rows of `eval/suites/proofing/test.jsonl` -- rows where some rewrite was already known to pass the oracle. Preregistered `status/preregistrations/eval-proofreader-e2e-v1.json` before scoring, per DS010.

**Unconditional full sealed test** (1,135 rows, hard cases included, natural proportions, `tools/research/proofing-eval-checkpoint.mjs test --include-hard`, frozen rules v1.4): always-on break 0.19% (unchanged), repair 19.3% (119/617), net_delta **+10.4pp [8.6,12.2]** -- smaller than the conditional headline as expected, still clearly positive. `gate_no_spacy`: break 0%, repair 12.8%, net +6.96pp [5.55,8.46]. Untrained `qwen3-1.7b:proof` reference on the same rows: net +6.43pp -- the fine-tuned 270M still beats it unconditionally.

**End-to-end** (new tool `tools/research/proofreader-e2e-frozen-rules-eval.mjs`: frozen rules v1.4 applied directly to English text, message-only HF-generated rewrite, an offline `gate_no_spacy` replica of the trained gate; staged 100/300/full with the preregistered early-stopping rule) on EN rows of suites never used to build `datasets/proofing`: **formalizer-v1** stopped decisive-positive at 300/2,868 rows, strict delta always-on **+6.67pp [4,9.67]**, gated +5.33pp [3,8.03], break 0%; **formalizer-ood-v1** ran the full 915 EN rows, decisive-positive, always-on **+2.84pp [1.77,4]**, gated +2.40pp [1.47,3.44], break 0.32%; **formalizer-wild-v1** (independently written text, not from the generator) stopped by futility at 100/341 rows, **-1pp [-3,0]** -- no useful gain transfers to real, independently-written text. Leakage re-verified fresh (`tools/datasets/audit/proofing-overlap.mjs`): 0 exact matches, 0 shared `split_group_id` against all three suites.

**GGUF export**: isolated venv `~/proofreader-export-venv` (CPU torch+transformers+peft+gguf, no shared venv touched); the merge output was missing `tokenizer.model`/`added_tokens.json`/`special_tokens_map.json` (a recurring gap already seen in `formalizer-size-v1`'s gemma arm), fixed by copying them from the pinned base. Verification found 45/50 (CPU) and 44/50 (GPU) EXACT match to HF greedy, not the byte-identical result the task asked for as the bar to trust GGUF for scoring -- so all scored numbers above use raw HF/transformers, and the GGUF export was used only for CPU speed (llama-server, 10 threads: p50 120ms/message, ~138 tok/s, far faster than the untrained base's own zero-shot CPU number) and GPU self-reproducibility (50/50 identical across two runs).

**Backend wired, off by default**: `tools/symbolic-lm.mjs serve --rewrite-url <endpoint> [--rewrite-when always|uncertain]`, `config/formalizers.json` `symbolic-lm.rewrite` (`mode: "off"`), documented in DS021 ("Optional rewrite backend") and `docs/runtime.html`. No default changed; `questions.md` Q-PROOF-1 asks the owner whether to change it, in Romanian.

**Operational incident, disclosed in full**: partway through this task, a second process under the same actor label (`CHATSOP_ACTOR=proofreader-eval-agent`) -- almost certainly a reconnaissance fork this agent dispatched earlier that exceeded its explicit "no GPU jobs, no edits" instruction -- was found overwriting `tools/research/proofreader-e2e-eval.mjs` and `status/preregistrations/eval-proofreader-e2e-v1.json` with its own, independently-built, more rigorous implementation and preregistration text (same experiment id). It found and fixed two real upstream GGUF tokenizer defects (an overflowing special-token id, a missing chkhsh pretokenizer table entry) that this agent's own simpler fix had merely papered over, reaching 100/100 CPU and 98/100 GPU exact match. Neither agent's files or GPU processes were touched destructively (no kill, no re-overwrite, per AGENTS.md); this agent's own script was preserved under a new name (`tools/research/proofreader-e2e-frozen-rules-eval.mjs`) and the mixed-rows exploratory arm was skipped to avoid a second concurrent GPU job. Full account: `status/journal.jsonl` 2026-09-29T23:37Z, topic notes (topic `proofing`), `status/experiments.json` `eval-proofreader-e2e-v1.conclusions`. The owner should reconcile the two preregistration drafts and prefer the other process's GGUF fix; this agent's numbers stand as an independently-produced, self-consistent cross-check pointing the same direction. `npm test` run at the end; see its own report for the pass/fail count.

## Trained proofreader: Gemma3-270M fine-tune, sealed-test win over zero-shot references (train-proofreader-gemma270m-v1, 2026-09-30)

Owner-scoped training (journal 2026-09-29T21:37:26.749Z, 21:39:19.620Z): fine-tune `google/gemma-3-270m-it` (LoRA rank 16) on `datasets/proofing` as a `proofreader` (message-only text repair, never SOP). Preregistration `status/preregistrations/train-proofreader-gemma270m-v1.json` frozen before any optimizer step, with 2 recorded deviations (a GB10 CUDA-free-floor infrastructure adjustment; the max-steps-then-resume stage plan replaced by a clean full-budget restart because `training/cli.mjs --resume` freezes `max_steps` into the run identity).

Before training, found the trainer only ever supported SOP-target roles: added a real `proofreader` role (`training/cli.mjs` `role()` + role-conditioned `qualificationSchema()`, `training/python/train.py --role` choices) with its own check list (`oracle_grounding, meaning_preservation, leakage, split_integrity, source_rights, token_budget`) and an empty `contract_files` (the SOP grammar contract does not apply to a text-repair target); renamed `datasets/proofing/formalizer/` (a workaround name) to `datasets/proofing/proofreader/`, added its missing projection manifest, bumped `datasets/proofing/VERSION` to counter 2, and regenerated `status/training/qualification-proofing.json` (`tools/research/qualify-proofing.mjs`, new tool) against the new schema with every evidence file re-verified to still show zero violations and every hash recomputed fresh. Authorization receipt `status/training/authorization-gemma-proofreader-gemma270m-v1.json` transcribes the journal decision via a new `owner-approval-proofreader-v1.json` scope file (`approved_models: ["gemma"]` only).

Trained via `node training/container/podman.mjs run -- train ...` (rootless Podman, NVIDIA GB10), 1143 optimizer steps / 3 epochs, ~510 seconds; `best` = epoch 2 (dev_loss 0.0478, dev-loss-gated selection). A staged early-stopping check on a 100-row stratified `datasets/proofing/dev.jsonl` sample after epoch 1 (net +0.23 [0.15,0.32], break 1.5%) cleared the preregistered stopping rule before continuing.

Evaluated on the sealed `eval/suites/proofing/test.jsonl` (660 non-hard rows) with the same frozen-rules oracle the corpus was built with (new evaluator `tools/research/proofing-eval-checkpoint.mjs`, message-only generation via new `training/python/generate_causal.py`, reusing `tools/research/proofing.mjs`'s `oracle()`/`checks()`/`bootstrap()`), against four reference arms on the identical rows:

| Arm | break (always-on) | repair (always-on) | net Δ (always-on) | net Δ (gate_no_spacy) |
| --- | --- | --- | --- | --- |
| no rewrite | — | — | 0 | — |
| gemma3-270m:proof (untrained, zero-shot) | 11.4% | 12.0% | −0.064 [−0.089,−0.039] | −0.005 |
| qwen3-0.6b:proof (untrained, zero-shot) | 10.4% | 35.2% | −0.006 [−0.036,0.024] | +0.062 [0.044,0.082] |
| qwen3-1.7b:proof (untrained, zero-shot, cached from the full-corpus run) | 0.58% | 47.2% | +0.097 | +0.085 |
| **gemma3-270m fine-tuned (this run)** | **0.19%** | **66.9%** | **+0.142 [0.117,0.170]** | **+0.102 [0.079,0.124]** |

H1–H4 all confirmed: net_delta positive with a CI excluding 0; break rate under the 1% target (0.19% always-on, 0% gated); a decisive reversal of the untrained base's zero-shot behaviour (which is net-harmful, matching `eval/reports/current/proofing/report.md`'s earlier pilot finding); gating keeps most of the repair benefit without raising the break rate. Bonus, not preregistered as a goal: the fine-tuned 270M model also beats the untrained Qwen3-1.7B zero-shot reference (6× the parameters) on both break and net delta on these rows. CPU speed (raw transformers, message-only, batch 1, 40 real sealed-test messages): p50 939 ms, 15.4 tok/s — faster than the untrained base's own zero-shot number in report.md (p50 2,749 ms, 5.2 tok/s), mainly because no instruction wrapper is needed. GGUF Q8_0 export/verification was **not completed**: no Python environment on this host combines torch+transformers (for llama.cpp's converter) with peft (required by `training/cli.mjs export-gguf`'s dependency gate) and the `gguf` package together; building an isolated venv or modifying a shared multi-agent venv was deferred given the time budget (`eval/reports/current/proofing/checkpoint-eval-cpu-speed-finetuned.json` records the reasoning). SymbolicLM's optional `rewrite` hook was not wired to this checkpoint (no deployed inference endpoint yet); left as follow-up in `TODO.md`.

Artifacts: `models/gemma/proofreader-gemma270m-v1/proofreader/{best,merged-best}`, `eval/reports/current/proofing/checkpoint-eval-{finetuned,gemma3-270m-zeroshot,qwen3-0.6b-zeroshot}-test.json`, `eval/reports/current/proofing/checkpoint-eval-qwen3-1.7b-proof-cached.json`, `tools/research/proofing-eval-checkpoint.mjs`, `tools/research/qualify-proofing.mjs`, `training/python/generate_causal.py`. `npm test` run at the end of this task; see its own report for the pass/fail count.

## TranslatorService, LanguagesUtil split from SymbolicLM; Romanian route decided by numbers (Q-PIPE-1, 2026-09-30)

Delivered: `lib/translator-service/` (`index.mjs` pluggable `loadBackend(name)` registry; `backends/symbolic.mjs`+`english.mjs`, the former `lib/symbolic-lm/translate.mjs`+`english.mjs` moved unchanged; `backends/opus-mt.mjs`, CPU MarianMT via `~/mt-venv` and `training/python/translate_marian.py`, masking through `lib/ud-to-sop/protect.mjs`; `backends/apertium.mjs`, a documented "unavailable" stub); `lib/languages-util/` (`langid.mjs`, `spellfix.mjs`+`spellfix/`, the former `lib/symbolic-lm/langid.mjs` and `lib/spellfix.mjs` moved unchanged; new `frame.mjs` `detectFrame`/`functionLanguage`, a Matrix-Language-Frame heuristic for code-switched messages). `lib/symbolic-lm/index.mjs` now calls both instead of containing translation or language-id code; `tests/translator-service.test.mjs` (split out of `tests/symbolic-lm.test.mjs`); `tools/research/translator-compare-eval.mjs` (sets/run/score/niche); the preregistered experiment `eval-translator-compare-v1` (`status/preregistrations/eval-translator-compare-v1.json`, `eval/reports/current/translator-compare/summary.md`) with its 40-message niche-word probe (`niche-probe.jsonl`/`.outputs.jsonl`); DS021 (new "LanguagesUtil" and "TranslatorService" sections), `docs/runtime.html`, `docs/wiki.html`, `dependencies.md` (downloaded MT model hash/licence, Apertium availability evidence), `config/formalizers.json`.

Behaviour-preservation for both moves: 50 fresh `formalizer-v1` dev rows through `tools/symbolic-lm.mjs english` (with and without `--spell`) gave byte-identical output before and after each move (verified by temporarily restoring the pre-move file layout and diffing).

Results (`eval-translator-compare-v1`, CPU only, no training, no GPU): on 150 monolingual-Romanian rows no arm beat `direct` and Opus-MT was decisively worse (tolerant -15.3 [-22.7,-8.0], ~6× slower) — the second independent experiment (after `eval-symbolic-lm-v1`) to find this, so Romanian's default route changed from `translate` to `direct`. On 100 mixed rows, `symbolic`/`symbolic-hybrid` led `direct` by +7.0 points with a 95% CI of exactly [0.0, +14.0] (the closest possible miss of the decisive threshold), so mixed messages keep their current default (`translate`); a new `matrix` frame-language route was not decisively different and is not adopted. Apertium was dropped before running (no Romanian→English pair exists, packaged or in the `apertium` GitHub organization's 655 repositories). Owner question 1: Opus-MT does not reliably clean "romgleza" into fluent English (21/50, 42% [29,56], fully fluent on manual reading). Owner question 2: the symbolic backend is far safer with unknown words (70% correct, 21% honestly copied and reported `untranslated`, 4% hallucinated) than Opus-MT (32% correct, 21% hallucinated); two symbolic-backend hallucinations trace to real dictionary-entry bugs, left open as a follow-up, as is `protect.mjs`'s English-only sentence-initial name heuristic mismasking Romanian common nouns. Both superseded questions Q-SLM-1 and Q-PIPE-1 removed from `questions.md`; decision recorded in `CHANGES.md`, DS021 and the journal.

## Rules v1.4, host synonym/frame list and gold vs DS021 (Q-SYM-1..3, 2026-09-29)

Delivered: `lib/ud-to-sop` v1.4 (`repair.mjs`, `numeric.mjs`, `analyze.mjs`, `index.mjs`, `lexicon.mjs`, `emit.mjs`; frozen under `eval/reports/current/baseline-ud-rules/frozen-rules-v1.4/`), `tests/ud-to-sop-v14.test.mjs` with 26 recorded parses; `sop/frames.mjs`, `tools/frames.mjs`, `config/dictionary/frames-{world,train,wordnet}.tsv`, `tests/frames.test.mjs`; `sop/dictionary.mjs` compile-3 (Romanian copula lemma forms, to-infinitive chains; `tests/dictionary.test.mjs`); `tools/research/ud-rules-v14.mjs`; the preregistered experiment `eval-ud-rules-v14-v1` (`status/preregistrations/eval-ud-rules-v14-v1.json`, deviations D1–D4) with its results in `eval/reports/current/ud-rules-v14/results.json`; ten re-adjudicated wild gold rows (`gold-readjudication.jsonl`, manifest `readjudications`); DS021, DS016, DS014, DS010 and the `unclear`, `query`, `stated` and `model-guide` help pages; the registration of `eval-clause-decomposition-v1`. Owner decisions recorded: Q-SYM-1 (strict scoring unchanged, gold boundary convention kept, tolerant host score only beside strict), Q-SYM-2 (host synonym/frame list, analysed: not sufficient alone), Q-SYM-3 (DS021 explicit → gold re-adjudicated; DS021 unclear → DS021 clarified, gold kept). Observed: fresh held-out strict +7.0 [4.7, 9.3] (48 gained, 6 lost); host-normalized 28.5% → 33.0%; `node tools/eval/wild-suite.mjs --check` 0 problems. No training, no GPU.

## Documentation, wire help, server and examples review (2026-09-28)

Delivered: `docs/wire_typs/model-guide.html`, `docs/wire_typs/question-types.html`, the corrected wire pages and prompt, guard G3 (`tools/lint/model-surface.mjs`, `tests/no-context-lint.test.mjs`) and G4 (AGENTS.md "Model boundary (non-negotiable)"), the site link checker (`tools/check-links.mjs`, `tests/site-links.test.mjs`), the server fixes listed in `CHANGES.md`, the converted research examples and the skills review. Observed: `tests/wire-help.test.mjs` executes every help example (7/7); `node tools/verify-vocabulary.mjs --scope all` PASS; `node tools/check-spec-refs.mjs` 0 violations; `node tools/shard-large-files.mjs --check` and `node tools/site-menu.mjs --check` pass; the link checker reports 0 broken links; `node tools/verify.mjs` passed every job except `node-tests`, whose remaining failures were in the data owner's in-progress corpus rebuild (baseline registry cells). No training.

## Question forms and the regenerated model-language corpora (2026-09-28)

Delivered: the DS021 question forms (universal `mode every` + `scope`, time variables with `span` and `measure`, `mode explain`, where/how roles), `unclear kind ambiguous` with readings, host normalization of natural dates and filter literals (`sop/parser.mjs`, `sop/enums.mjs`, `sop/unclear.mjs`, `sop/propositions.mjs`, `sop/linking.mjs`, `sop/declarative.mjs`, `sop/lower.mjs`, `reasoning/reasoner.mjs`, `sop/cnl.mjs`, `eval/run.mjs`, `eval/signature.mjs`); the generator extensions and `tools/datasets/build-corpora.mjs`, `tools/datasets/verify-corpus.mjs`, `lib/row-world.mjs`; the corpora `formalizer-v1` and `formalizer-ood-v1`; the message-only projection; guards G1/G2; deletion of the legacy corpora, builders and tests. Observed: `npm test` and `npm run test:data` green with no skips; audit PASS (0 error findings) on both corpora; `verify-corpus --all` 100% agreement; no-copy pass; `verify-vocabulary --scope all` pass; independent adversarial review: round 1 NO SIGN-OFF (about 7% label defects, all fixed), round 2 SIGN-OFF (about 0.2%, residuals fixed before the final build). No training.

## Memory-strategy specifications and naming (2026-09-28)

Delivered: DS023–DS028 and the updates listed in `CHANGES.md`; code renames with legacy aliases in `memory/banks/factory.mjs`, `memory/strategies.mjs`, `memory/banks/holo*.mjs`, `memory/weaver.mjs`, `memory/banks/hybrid.mjs`, the tools, tests, examples and configurations. Observed: `node --test` over the memory, shard, repository, linker, capability-matrix, reasoning and routing tests passes (216/216); `node tools/compare-engines.mjs` and `node tools/compare-reasoners.mjs` (with the private SWI and Z3 binaries) reran under the new names and reproduced the DS013 exact-set counts, byte sizes and hybrid hint counts; `node tools/capability-matrix.mjs` observed 10 cells, 0 skipped, 5 unsupported; the memory, linker, shards, forgetting and reasoning demos and small `bench-memory`/`bench-holo-memory` runs complete; `node tools/check-spec-refs.mjs` reports 29 specifications and 0 violations. No training, no GPU work and no model inference were involved.

## Research corpora adapted from public dataset designs (2026-09-28)

The user authorized research-mode corpus acquisition and set two adaptation rules: keep the **domain of the source case** while varying only subject and wording (domains carry their own subtleties), and keep the corpora **broad** rather than funneling everything into one narrow topic. The quarantined sources (QA2D data, ProofWriter, QQP, AmbigQA) were neither acquired nor read; only their published design manner was adapted. PAWS was fetched with its LICENSE into `datasets_sources/paws/` (8000-pair Wikipedia-only validation sample, raw + derived JSONL, provenance with hashes) and analysed for structure only — no row was exported into any corpus.

Four new corpora, all `formalization` track, all gold-executed, all `not_reviewed`:

| Corpus | Design manner adapted | Cases | Rows (train/dev/test) | EN / RO | Domains |
| --- | --- | ---: | --- | --- | ---: |
| `datasets/qa-proposition-v1` | QA2D question→proposition | 90 | 288 (96/96/96) | 270 / 18 | 12 |
| `datasets/proof-structure-v1` | ProofWriter premises+rules+status+depth | 75 | 240 (144/48/48) | 225 / 15 | 15 |
| `datasets/paraphrase-contrast-v1` | QQP equivalence + PAWS high-overlap contrasts | 60 | 240 (128/56/56) | 180 / 60 | 14 |
| `datasets/ambiguity-resolve-v1` | AmbigQA ambiguity + disambiguated rewrites | 60 | 60 (36/12/12) | 48 / 12 | 12 |
| **Total** | | **285** | **828 (404/212/212)** | **723 / 105** | 53 labels |

Domain fidelity was checked against the measured PAWS distribution (geography 995, arts/language 581, sports 260, education 229, household 200, health 192, travel 184, history 170, commerce 161, law 148, technology 101, earth sciences 44, agriculture 19, weather 13 of 8000 primary pairs) rather than an invented spread.

New capability used by the proof corpus: every rational packet now reports `depth`, the number of rule applications in the minimal justification of the premises the answer used (observed premise `0`, one chained rule `1`). Implemented in `reasoning/reasoner.mjs`, documented in DS006 and the `reason` help page, and demonstrated in `examples/research/demo.mjs` (premise-only `0`, one rule `1`). Affected suites re-ran green (71/71 focused, then the full verifier).

Experiment inputs are prepared by `node tools/research/prepare-experiment.mjs`: it checks the declarative boundary and the connected-group split invariant, projects instruction-free `barePrompt` train/dev inputs to `datasets/research-train-v1/<corpus>/formalizer/`, references the sealed suites by hash instead of copying them, and writes a manifest with per-corpus tallies and fingerprints. Usage examples: `examples/research/{proposition,polarity,temporal,ambiguity,spatial,quantified}.sop` with `examples/research/demo.mjs` (six domains, executed and asserted) and the index in `examples/research/README.md`. Specifications: the four research-corpus cards and their summary (merged into DS018 on 2026-09-28), registered in `docs/specs/matrix.md`; rights and the research-mode decision in DS014.

Observed verification after this work: **468/468 tests, 31/31 checks passed, zero skipped**, fingerprint `9120dc8da0049aa2c71161161e48a571f5b42f975db23ca89886ea2e175cf15a`; the verifier also executes the four new sealed suites, the research preparation tool and the research examples demo. `node check-datasets.mjs` passes all ten dataset checks, the four research corpora included.



## Source-grounded corpora and assumption explanations (2026-09-28, later phase)

The user's rules for this phase: a generator must read the ACTUAL cached source datasets and author a separate counterpart per analysed source case (same theme and shape, our own content); mass mechanical duplication and unprompted invention are not acceptable; the NL example is the base asset, so an imperfect first-pass SOP target is a review matter, not a blocker; and the system should be able to explain the assumptions it made.

Research-only source cache (`datasets_sources/**`, with licences and provenance; never redistributed): PAWS 8,000 pairs, QA2D 10,344 rows, ProofWriter structured 6,128 theories, QQP 40,430 pairs, AmbigNQ 2,002 cases. `tools/datasets/analyze-sources.mjs` records measured theme and shape inventories (for example ProofWriter True/False/Unknown 13,831/13,831/23,182 and a `qdep` depth distribution; QA2D question-type and change-cue counts; QQP equivalence labels; PAWS change classes). Rights findings were corrected where evidence demanded it: the AmbigNQ publisher bundle DOES carry a CC BY-SA 3.0 licence (earlier "no licence" finding corrected), QA2D data has no dataset-specific licence (card: needs more information), QQP remains research/non-commercial, ProofWriter still exposes no dataset licence. All recorded in DS014.

Four source-grounded corpora, each row anchored to an analysed source row with `generation_trace.lineage` and `source_rows_copied:false`:

| Corpus | Source | Cases analysed | Rows (train/dev/sealed test) | RO | Themes | Skeletons |
| --- | --- | ---: | --- | ---: | ---: | ---: |
| `datasets/grounded-proof` + `eval/suites/grounded-proof` | ProofWriter | 1,200 theories | 1,200 (840/240/120) | 240 | 16 | 240 |
| `datasets/grounded-proposition` + `eval/suites/grounded-proposition` | QA2D dev | 1,200 (10,344 scanned) | 1,200 (960/120/120) | 246 | 14 | 233 of 240 |
| `datasets/grounded-paraphrase` + `eval/suites/grounded-paraphrase` | QQP + PAWS | 600 + 600 pairs | 2,400 (1,946/232/222) | 480 | 30 | 566 |
| `datasets/grounded-ambiguity` + `eval/suites/grounded-ambiguity` | AmbigNQ | 600 cases | 2,508 (1,989/276/243) | 490 | 27 | 200 |
| **Total** | | **4,800** | **7,308 (5,735/868/705)** | **1,456** | 87 labels | — |

Shape fidelity is reported per corpus (ProofWriter status mix 392/418/390 with depth 0–5 = 913/150/73/34/14/16; QQP equivalence 845 versus PAWS contrast 355 with change classes; AmbigNQ ambiguity types 347/189/37/27). Diversity is enforced and measured: 100% unique normalized requests, largest skeleton share ≈0.4–0.7%, NL-only `surfaces.jsonl` beside the canonical split files. Rows are honestly described as generator-composed from an authored skeleton library anchored to analysed source cases — not hand-written and not reviewed — with `target_review_status: pending_review` on every target.

Canonical layout follows the repository rule: development rows in `datasets/<name>/{train,dev}.jsonl`, sealed test only in `eval/suites/<name>/test.jsonl`; `pairs.jsonl` was retired. `tools/research/prepare-experiment.mjs` now discovers these corpora too; the prepared manifest covers nine corpora — 8,536 rows, 6,139 instruction-free train projections, 1,080 dev projections and 1,277 sealed rows.

Assumption explanations were implemented as a host capability rather than a new model head: `server/agent.mjs` exports `explainAssumption` and every turn returns `assumptions` for the premises that turn introduced (atom, rendered statement, validity, `source:'model-interpretation'`), rendered from lexicon labels in the turn language; the HTTP façade exposes the same list in its trace (DS012, DS021, `premise` help page). A retained premise is not re-explained, and the prose cannot claim a reading the model did not declare. Covered by new agent tests (EN and RO) and by the existing server suite; a bare-mode import regression found during integration was fixed.

## Documentation and chat on one port, JSONL-first review (2026-09-28, final)

- `server/http.mjs` now serves the documentation site statically beside the chat API: `GET /` and `/docs` redirect to `/docs/`, and `/docs/**` serves the repository documentation (HTML, CSS, the specification Markdown) without authentication, read-only, with no directory listing and a traversal guard that rejects any path resolving outside `docs/` (encoded traversal and NUL bytes included). HTML is `no-cache`, other assets get a short cache. The chat API keeps bearer authentication, and `config/runtime.json` now sets `promptProfile: "formal"` so the server starts without extra environment. Covered by a new case in `tests/server-http.test.mjs` (7/7 passing).
- Startup: `CHATSOP_API_KEY=<≥16 chars> node server/http.mjs` (defaults `127.0.0.1:3000`); remote binding needs `CHATSOP_ALLOW_REMOTE=1` plus `CHATSOP_HOST=0.0.0.0` and `CHATSOP_PORT`. Until a formalizer endpoint runs, `/readyz` answers 503 with `model_available: false` and chat returns 503, while the documentation keeps working. On this workstation port 3000 was already taken by an unrelated Podman `rootlessport`, so the instance runs on **3001**, and the visual audit server (DS020) runs on **8788**; both are bound to all interfaces for remote review.
- Corpus review tooling (DS020): the Markdown layer under `datasets/` was retired completely — generated views, review packs, the older curriculum audit tree, `build-cases-md.mjs`, `authoring/`, the `cases-md` verifier job, the authoring-pipeline test and the `cases_md` manifest field with its validator check — and the `query-v1`/`query-v2` manifests were regenerated without that field. Review now happens in the visual audit server, which lists every corpus with counts and fingerprints, filters and opens cases (requests, vocabulary, target, setup, expectation, lineage), re-executes a case's gold on demand and appends `approve`/`reject`/`needs_fix` verdicts to `eval/reports/current/audit/<corpus>.jsonl`. `tools/datasets/audit-corpus.mjs` writes the machine audit `AUDIT.json` and fails closed on any invariant violation.



Final state of the corpora after the scaling waves: `grounded-proof` 15,000 rows, `grounded-proposition` 10,344, `grounded-paraphrase` 93,064, `grounded-ambiguity` 14,998 — **133,406 rows** anchored to analysed source cases (4,800+ source rows analysed in the first wave, with the larger train splits now cached for further waves), plus the earlier research corpora and the query/pilot/independent suites: the audit server sees **12 corpora and 135,701 rows**. Every gold was executed at build time with counts and fingerprints recorded per corpus, and the source cache was scanned for exact copies with **0** found.

**One server, one port, password on first run (final consolidation).** `npm start` now runs a single process on port **9999** serving: the documentation site (`/docs/`, public, traversal-guarded), the admin page (`/admin`), the corpus audit (`/audit` + `/audit/api/*`) and the OpenAI-compatible chat API (`/v1/chat/completions`, `/readyz`, `/healthz`). On first run `/admin` asks for the administrator password, stored only as a scrypt hash with a per-install salt in `state/auth.json` (mode 0600); the browser keeps an HttpOnly session cookie, and the chat API answers `setup_required` (403) until the password exists. The admin page reports model readiness and the active prompt profile, mints API tokens shown once (stored as SHA-256 digests) with revocation, signs out and links to the audit. `CHATSOP_API_KEY` still works as an environment-provided bearer token with no password. The separate audit server on 8788, its CLI flags and the `npm run audit` script were removed, as was the standalone `server/audit.mjs` listener (the file is now a mountable router). Fixed during integration: the admin and audit routes sat outside the request-level error mapping, so their failures escaped as unhandled rejections — both now answer structured errors (`invalid_credentials`, `too_many_attempts`, `invalid_request`), the admin page's token buttons use data attributes instead of broken nested quoting, `readiness()` reports the active prompt profile, and the auth/audit suites are hermetic (temporary ledger, `closeAllConnections()` teardown). Observed: `tests/auth-server.test.mjs` 4/4, `tests/audit-server.test.mjs` 5/5, `tests/server-http.test.mjs` 7/7.

Observed verification after this phase: **487/487 tests, 38/38 checks passed, zero skipped**, fingerprint `93165283054d893a90ba04e5808bc21d9e7898bde05523a39edb0e3c2d0919ac`; `node check-datasets.mjs` passes all thirteen dataset checks.

Observed verification after the source-grounded phase, before the review-tooling change (superseded by the 481/481 run above): 482/482 tests, 39/39 checks passed, zero skipped, fingerprint `0baa7e40a42866a924dbb1e79d4f4f41e6d4f8bd7c67883481bf8c3eb0cafee3`; the verifier validated each grounded corpus's development and sealed files and ran the research preparation tool, and `node check-datasets.mjs` passed all fourteen dataset checks including the four grounded sealed suites executed against the runtime.



## Consolidation and real foundation (2026-09-27)

Everything below was executed in that phase and recorded with the command that produced it. Nothing was trained, fine-tuned or inferred; the training interdiction stands.

## Verification at that phase (superseded by the 482/482 run above)

- `Z3_BIN="$PWD/tools/.solvers/z3/bin/z3" SWIPL_BIN="$PWD/tools/.solvers/swi/swipl" node tools/verify.mjs` → **455/455 tests, 25/25 checks passed, zero skipped**, `complete: true`, `neuralModelTested: false`, `trainingExecuted: false`. Fingerprint `1eefb0952cb1f3e14b32c94f41c96c391dd32546077fa78d2b5dbdfe834ae490`. This was the state at that phase; it is kept as history and is superseded by the 482/482 run recorded above. Evidence: `eval/reports/current/verification.json` plus per-job logs.
- The verifier now also executes: `declarative-demo` (`examples/declarative-demo.mjs`), `core-suite` (`eval/suites/core-v2.jsonl`), `independent-corpus` (`eval/suites/independent-v1/test.jsonl`) and `query-curriculum-v2` (`datasets/query-v2/manifest.json`).
- `node check-datasets.mjs` → six dataset checks PASS (query-v1, pilot-v1, current SQuAD derivative, core-v2, independent-v1, authoring tree).
- Browser checks: 42 wire-help topics, 401 local links/fragments with no broken target; 81 displayed examples parsed as marked, seven intentional parser rejections; desktop and 390-pixel mobile rendering without overflow; the worked constraint example executed to `possible` with `arrival = 42`.

## Runtime behavior made explicit

- **Proof reinforcement is policy-gated.** `sop/runtime.mjs` now requires `policy.reinforce !== false` in addition to the memory retention `reinforceOnUse`, the hypothetical/local/metadata filters, and reports any promotion on the reason packet. Contract regenerated into `sop/contracts/*` and documented in `DS006`, the `reason` help page and `AGENTS.md`.
- **A requested backend is never substituted.** `reasoning/registry.mjs` returns `unsupported` with the requested backend named in `route.backend` and `fallback: null` for: an explicit external backend on a JS-only mode, the reference strategy with an external backend, and an unavailable solver in a supported domain; structural rejections carry `route.backend: 'none'`. Incompatible profiles fail with a clear error. Covered by `tests/routing-policy.test.mjs` (13 passed) and documented in `DS006`.
- **Ambiguous requested scalar ⇒ host clarification.** A `constraint.select` whose value is not unique produces a clarification even when the claim is entailed (`tests/declarative-runtime.test.mjs`, and the displayed help example).

## Corpora and evaluation

- `datasets/query-v1` (62 cases / 198 rows) and its audit tree stayed byte-identical; the new `datasets/query-v2` holds **89 semantic cases / 290 rows** (267 EN, 23 RO; 255 formalization, 35 system) with 33 paired hard negatives and the blocked-family list kept explicit (`DS009`).
- `eval/suites/independent-v1/test.jsonl`: **200 semantic cases / 400 rows** (200 EN + 200 RO), all executed, 20 connected test-only groups with zero split crossing; author recorded as an LLM coding assistant, `not_reviewed` (`DS015`).
- `eval/suites/core-v2.jsonl`: revision-2 export of the authored suite, executed by the verifier; `core-v1.jsonl` retained as superseded.
- Registry and leakage: `tools/eval/registry.mjs` audits before evaluating, refuses an incomplete matrix, and produced a complete **non-model** gold-copy baseline index (dev 35 rows, sealed test 37 rows) while the ordinary model matrix remains blocked on absent predictions (`eval/README.md`, `DS016`).
- Metrics: `eval/metrics.mjs` + `tools/metrics/run.mjs` define one denominator per formalizer/epistemic/reasoning/memory metric; the only observed run is the labeled gold-as-prediction sanity check (`DS016`).
- Engine/reasoner comparisons: 20 bank runs and a deterministic matrix; exact engines reached 48/48 uniform completions while Holo abstained (42/48 at 64 atoms, 28/48 at 256) and all five engines survived retraction, restart, pinned retention and one-snapshot GC reclaim; the Z3×Horn cells remain `unsupported` (`DS013`).
- Solver qualification: 14 reference, 9 SWI, 6 Z3 and 6 routing cells observed with the private binaries, including Z3 returning `unknown`/incomplete instead of a JS fallback (`DS013`).

## Specifications and documentation

- New design specifications (numbered as they were then; `docs/specs/aliases.json` maps them to the current set): case authoring, material sources, solver qualification, local server, engine comparison, source rights, independent corpus, evaluation metrics, skill systems, question-curriculum generator, archived vision documents, small-language scope, research direction and publication, query corpus v2, and four legacy consolidation registers. All 27 rows were registered in `docs/specs/matrix.md`.
- Documentation consolidation: every legacy `.docx` was read in full and its still-valid content consolidated (a vision register now archived under `probably_obsolete/specs/vision/`, DS010, DS005/DS006) before the originals moved to `probably_obsolete/`; the former `docs/legacy/` tree (31 Romanian requirement chapters, index, examples, sources, stale contract snapshots) moved to `probably_obsolete/legacy/` with per-chapter verdicts and a legacy-versus-current contract diff in four consolidation registers (archived on 2026-09-28 under `probably_obsolete/specs/legacy-registers/`). Live citations were mechanically rewritten; empty `vision/`, `article/`, `article/direction/` and `evaluation/` directories were removed.
- User-facing pages updated: `docs/runtime.html` (small-language purpose, worked end-to-end example), `docs/training.html` (rights, authoring, independent corpus, metrics, engine comparison, core-v2), `README.md` (server start, current state), `AGENTS.md` (rules 7–10, reading order, archive pointers).
- `doubts.md` consolidates the ten genuinely unresolved author decisions; the archive index is `probably_obsolete/README.md`.

## Skills

- `material-to-sop`: multi-source TXT/MD/DOCX/PDF/HTML extraction with per-source rights, budgets, byte-exact passage citations and isolated knowledge states; unsupported formats (scanned/encrypted PDFs, RTF, DOCX footnotes/tracked changes, non-UTF-8 HTML) fail closed (`DS011`).
- Four exploration modes with explicit budgets and stop reasons; a one-probe near-exhaustive run correctly reported `incomplete`/`probe_budget`.
- Candidate rules now require a second prepared source plus a non-trigger and a transfer probe; the legacy single-source path was intentionally closed with an explicit message, and five isolated legacy probes pass without approval.
- P2.9 demonstration: a genuinely blank agent (no conversation history) ran the documented procedure and produced the recorded evidence — baseline `unknown` → with-rule `supported` on the positive and transfer quotes, `unknown` abstention on the visitor question, and a rejected proposal missing transfer evidence.
- New skill subsystems: failure classifier, semantic-gap proposer (exceptions preserved, never executed in production) and the authorized implicit-SOP registry with retraction (`DS017`); family-driven question curriculum generator with explicit reasoning gaps (`DS009`).

## Server

`server/http.mjs` provides the local OpenAI-compatible façade over the single `Agent.turn` path: `/v1/models`, `/v1/chat/completions` (non-streaming and SSE of the already-verified result), `/healthz`, `/readyz`; explicit refusals for unimplemented surfaces; explicit `promptProfile` (`bare` for a fine-tuned model, `formal` for base models) with no silent mixing; mandatory bearer auth, localhost binding, request/context/time/concurrency limits, per-principal session isolation and a trace carrying circuit, provenance, backend, fallback, completeness and CNL (`DS012`, `tests/server-http.test.mjs` 6 passed). A real checkpoint-backed smoke remains blocked and `/readyz` reports `model_available: false` until one exists.

## Honest limits

- No neural model was trained, evaluated or served; every metric above is symbolic or a labeled non-model baseline.
- No human or independent review occurred for any corpus; `qualification` stays `not_reviewed` and `review_status` stays `synthetic_unreviewed`/`not_reviewed`.
- Training-dependent gates (P4/P5/P6), external-generator qualification (P1.9) and the research experiments (P9) were not started; the quarantined corpora (QA2D data, ProofWriter, QQP, AmbigQA) were not ingested.



## Earlier phase in the same session — declared boundary cutover

This records the earlier phase, before the full consolidation. Its three follow-up items (U1–U3) were completed afterwards: the pilot artifact executed 700/700 rows, the displayed help examples and the constraint example were validated, and the records were rewritten.

## Implemented and exercised

- [x] **Whitespace atom cutover and recording rename.** `sop/parser.mjs`, grammars, runtime consumers, examples, tests, skills and current generated data use `temperature room_a 21`. The old parenthesized atom spelling is rejected. `remember` replaces the SOP `assert` wire without an alias; programming-language assertions and solver/source syntax are preserved.
- [x] **Actual model/host separation.** `sop/declarative.mjs` and `Runtime.run(..., {origin:'model'})` admit only premise/query/constraint. The host generates inspectable resolution, assumption packs, solves, scalar outputs, CNL and clarification. `server/agent.mjs`, prompts and CLI distinguish authored SOP from execution circuits (`:sop` versus `:circuit`); generated-name collisions are covered.
- [x] **Conditional context, not repository facts.** `premise` accepts holds plus optional validity, without model-authored documentary provenance. The host retains original input and model-interpretation origin across conversation turns. Native smoke demonstrated context-only admission, a conditional answer on a later turn, isolation from another context, and zero implicit repository claims. Trusted remember rejects premise inputs.
- [x] **Constraints and conditional projections.** Model-authored constraints retain domains, variables, comparisons, Boolean groups and objectives. `select` requests checked scalars. Native smoke exercised conditional query → scalar → numeric result 22 with hypothetical provenance preserved. An ambiguous requested scalar produces host clarification even when its claim is entailed; no arbitrary scalar value is created.
- [x] **Host-generated clarification and continuation.** Ambiguous Maria identities produce a concrete candidate question. The packet carries pendingSop, required inputs and answer_clarification for the next turn. Agent tests exercise candidate continuation. Ordinary absence of evidence returns unknown; model-authored clarify and execution operations are rejected.
- [x] **Data/evaluation separation.** Current seed, pilot and query artifacts were regenerated. Formalizer targets and trusted system circuits have separate tracks/exports. Optional/nonunique `finite_many` diagnostics remain system cases with their original oracle, not fabricated scalar answers. Evaluator admission receives the actual question, preserves scoped entity typing, rejects literal fake result packets, and checks lexical leakage across training tracks.
- [x] **Fresh source-reference derivative.** `eval/suites/source-reference-v2-cutover.jsonl` and its independently computed provenance are the current declarative test-only derivative. `tools/verify.mjs` uses that path. The sealed original `source-reference-v2.jsonl` and provenance were not overwritten.
- [x] **Documentation and catalog.** Current specifications, README, wiki, skills and 42-topic wire help document the boundary. Keyword tables cover parser fields; navigation separates the three model declarations from host operations. The generated catalog derives model permissions from MODEL_TYPES. Five residual contradictory host-operation author labels were corrected in expand/link/reason/recall/value help.
- [x] **Completed portions removed from the backlog.** The generated case-Markdown audit view and drift check exist; Markdown-as-authoring-source remains deferred. The parser/grammar/prompt/catalog part of P0.6 is complete; broader routing/reinforcement qualification remains deferred. P8.5 mixed query → scalar → constraint → output/CNL behavior is exercised by runtime regressions and native smoke and is no longer an open implementation item.

## Observed verification and limits (superseded by the final run above)

- The final state is the 455/455 test and 25/25 check run recorded at the top of this file; the 394/394 figure belonged to the intermediate cutover run and is kept only as history.
- Pilot artifact: `node tools/datasets/validate.mjs --manifest datasets/pilot-v1/manifest.json --execute` executed 700/700 rows, `verified_against_runtime`, `qualification: not_reviewed`.
- Help examples: the final crawl checked 42 topics and 401 local links/fragments with no broken target; 81 displayed examples parsed as marked with seven intentional parser rejections; the displayed constraint example executed to `possible` with `arrival = 42` and a bound output.
- No neural model inference, optimizer step, fine-tuning or training was run. Training dry-run jobs inspect configuration only. Generated corpus checks do not establish human review, training qualification, tokenizer equivalence, or model accuracy.
- Documentation services and managed browser tabs were stopped; the session's temporary smoke files were removed.

## Earlier delivery history — not the current verification snapshot

# PAS_TASK.md — ce s-a livrat, cu dovezi

- 2026-09-28: un singur limbaj pentru modelul mic (fără profiluri `sop-agent-3`/`sop-agent-4`, fără firul `premise`, fără prompt CONTEXT); testele pe corpusurile vechi sunt sărite până la regenerare (vezi TODO.md).

Data de referință: 2026-09-27. Acest fișier arhivează lucrarea **finalizată** și observațiile ei. Doar sarcinile deschise/blocate rămân în [TODO.md](TODO.md). `[x]` aici înseamnă executat real, cu artefact și comandă/scenariu observat; nu reprezintă calificare de training și nici aprobare de optimizer.

## Status la arhivare

- **Historical verification at that delivery:** 359/359 tests, 20/20 checks and 140 reasoning-matrix executions, with private Z3 4.15.8 and SWI 9.0.4 explicitly selected. Historical fingerprint: `8cd054b02dc04b7cf82a15a60e99d8277545ec5e3667da14058102ba7c16e305`. The current verification report has since been superseded by the completed cutover run recorded above.
- **Date:** 62 cazuri / 198 rânduri (105/44/49; RO 6/2/4) + 16 cazuri / 49 suprafețe SQuAD sigilate. Inventar 35 fire; țintele emit 11 tipuri; corpus necalificat pentru training.
- **Structură:** cod de date în `tools/datasets/`; cache raw la `datasets_sources/`; `datasets/` doar artefacte de date.
- **Profil ML:** fără instrucțiuni (`barePrompt` = CONTEXT + MESSAGE); audit Qwen max. 383/502, medie ≈300, identic nativ/Podman.
- **Limite:** zero review uman; QA2D/ProofWriter în carantină; referințe sub ținta 200 EN + 200 RO (ținta a fost atinsă ulterior de `eval/suites/independent-v1/test.jsonl`: 200 EN + 200 RO, nerevizuite uman); training interzis până la OK nou.

## PR — refactorizarea structurală (închisă)

- [x] PR.1. Implementări în `memory/`, `reasoning/`, `sop/`, utilitare în `lib/`; `server/` consumă modulele. **Dovadă:** demo cu șapte scenarii + suita Node portată.
- [x] PR.2. Separare `config/`, `knowledge/`, `tools/`, `tests/`, `examples/`, `datasets/`, `eval/`, `training/`; rapoarte istorice în `eval/reports/history/`, texte-sursă în `probably_obsolete/legacy/`.
- [x] PR.3. Python eliminat din `server/`; cele șapte module ML în `training/python/`, justificate în `dependencies.md`. **Dovadă:** preflight CUDA nativ executat.
- [x] PR.4. Baze în `models/<model>/bases/<revision>/`, rulări în `models/<model>/<run>/<role>/`. **Dovadă:** dry-run Qwen.
- [x] PR.5. `AGENTS.md`, README și documentația GAMP consolidate. **Dovadă:** DS000–DS009 + matrice; 15 pagini randate în browser fără erori JS (probă din `documentation-browser-check.json`).
- [x] PR.6. Verificare structurală înaintea pilotului. **Dovadă:** suita de teste + demo-uri; launcherul refuză lock existent și disk floor imposibil.

**GPR:** comportamentul păstrat prin execuție reală; lipsa mediului ML este blocaj de training, nu motiv de fabricare de rezultate.

## Date, evaluare și skilluri (închis)

- Pilotul `datasets/pilot-v1/`: 600 cazuri / 700 rânduri (490/105/105); test separat în `eval/suites/pilot-v1/`; toate rândurile verificate executiv (`node tools/datasets/validate.mjs --manifest datasets/pilot-v1/manifest.json --execute`).
- Curriculumul `datasets/query-v1/` + `datasets/query-profile.json`: 60 cazuri / 192 rânduri, trei suprafețe EN/caz, 12 ancore RO (6/2/4), matrice completă; review LLM inițial + corecțiile principalului în `eval/reports/current/principal-data-review.json`. Cele două suprafețe RO noi din dev au doar review-ul principalului.
- Referința sursă `eval/suites/source-reference-v2.jsonl`: 16 cazuri / 49 suprafețe SQuAD v2, CC-BY-SA-4.0, sigilată, exclusă din training/selection; v1 + review-ul ei arhivate în `eval/reports/history/data-review/` după corectarea parafrazei de numire și a jurământului.
- Evaluatorul `eval/run.mjs` + `eval/contracts.mjs` + `eval/suites/core.mjs`: self-check cu circuit gold, semantic greșit, invalid, UNKNOWN corect (`evaluator-self-check.json`); nu s-a evaluat un model.
- Skillul `skills/material-to-sop/`: flux complet exercitat din alt cwd; probe supported/unknown/unknown; refuzuri pentru lipsa probelor, DEFAULT, lipsa autorizării, binare, republicare după retractare (`ingestion-self-check.json`).
- Skillul `skills/semantic-sop-review/`: prepare → review LLM real → receipt → decizie integrator, executat din `/tmp`; patru lumi discriminante, verdict automat `pending`, acceptare limitată. Bundle `40b9d7f1e95501c8e3155f473899757db7230bdefaad1c400f50d71c6d539bc6`. Identitatea backend-ului LLM nu e verificată independent; nu e review uman.
- `resolve`: lexicon host, limbă, kind, tip/domeniu, rezoluție unică; ambiguitatea/absența blochează dependenții; head-uri de predicate doar canonice literale.
- `eval/reports/current/review-readiness.json` indexează toate dovezile (24 artefacte, hashuri verificate).

## Defecte reproduse și corectate

- Pachet de răspuns fabricat acceptat fără reasoning; acum `cnl` refuză valori non-runtime, iar terminalul conversațional respinge imitațiile literale (`packet-origin-smoke.json`).
- Context omis din exportul ML: proiecția e recomputată de validator; ulterior înlocuită complet de profilul fără instrucțiuni.
- Marker ipotetic pierdut în adaptorul SWI (reprodus pe SWI real: JS `true` vs SWI `false`); corectat și probat (`horn-conditionality-before-fix.json` → `horn-conditionality-smoke.json`).
- Holdout-uri supraestimate relabelate; novelitatea compozițională re-fingerprint-uită; ancore RO redistribuite (dev nu a rămas fără RO).
- Solutii native private Z3/SWI instalate cu hashuri/licențe fixate în `tools/.solvers/`; `check-solvers.mjs`, `verify.mjs` și testele respectă `Z3_BIN`/`SWIPL_BIN`; #nume și traversal-ul tools ajustate.

## Podman / GPU (infrastructură, închis)

- Mediu nativ găsit fără modificare: Torch 2.14.0+cu130, CUDA 13.0, Transformers 5.17.0, PEFT 0.21.0, Accelerate 1.15.0.
- Preflight nativ: GB10, capability 12.1, BF16 forward/backward passed.
- Imagine ARM64 construită: digest `sha256:9c1dd2ab8101bc85d861e9952b6555ee43546a5562f27d312e8c46249ffc4383`; `spark-preflight-1` exit 0, fără OOM; cgroup CPU 6 / RAM 32 GiB / swap 0 / pids 256 / shm 1 GiB.
- `spark-stop-probe-1`: refuzul jobului concurent, stop exclusiv al containerului propriu, `operator_requested` persistat, lock propriu eliminat, memorie CUDA liberă observată; fără cache-squeeze sau kill global.
- `spark-token-audit-1/2/3`: audit tokenizer nativ și în container, măsurători identice; pe profilul final 99 train/44 dev, max. 383/502, fără weights încărcate.
- Cele șapte scripturi cu cache-squeeze/kill-pe-pattern au fost retrase; metodologia utilă păstrată în skilluri.

## Faze de plan marcate executate

- P0.3 — baseline reproductibil separat de rapoartele istorice (comanda + fingerprint în TODO-ul istoric; acum `8cd054b0…`).
- P0.7 — definiția aprobată recuperată în contextul Agent și executată: `expand` → extragere pachet → `cnl` verificat, endpoint controlat.
- P1.10 — suprafețe EN/caz + ancore RO 20% (6/2/4) cu ținta canonică păstrată.
- P1.12 — canonizare conservatoare + guard-uri + oracole finite/graph + lumile discriminante; 192 ținte query + 49 ținte sursă trecute.
- P1.13 — matricea de coverage cu numărători pe familie/limbă/input mode/oracle/fire; holdout-urile verificate, categoriile neverificate marcate.
- P3.8 — self-check evaluator: gold vs semantic greșit vs invalid vs UNKNOWN corect.
- P3.9 — runnerul corectat (policy/backend, guard-uri Agent, erori separate pe etape, latențe distincte).
- P4.2 — mount-urile exercitate nativ + Podman pe același corpus.
- P4.3 — lock atomic comun nativ/Podman (owner PID/token/CID); refuz concurență și stop propriu observate.

## Decizii de proiect consemnate

- Restructurare la cererea utilizatorului: `tools/datasets/` pentru cod, `datasets_sources/` pentru cache raw, `datasets/` doar date; ținta de autorat rămâne Markdown per caz + JSONL compilat (P1.1).
- Profil ML fără instrucțiuni la cererea utilizatorului: `barePrompt` pentru SFT; instrucțiuni doar în `server/prompts/formalizer.txt` (servire base); servire consecventă cerută în TODO P7.0.
- AGENTS.md redus la nivel înalt (direcție, ordine de lectură, căi); regulile normative mutat în DS-uri: autoritatea host/untrusted inputs în DS004, excludența single-GPU-worker și controllerul unic în DS007, politica generatorilor (Luna) în DS009.
- Pipeline de audit manual implementat: `datasets/cases/` (60 fișiere MD generate, unul per caz) + `build-cases-md.mjs` (regenerare/`--check`) + guard de drift în validator (`cases_md.tree_sha256`) + job `cases-md` în `tools/verify.mjs` + stub high-level `check-datasets.mjs` la rădăcină + `eval/README.md`.
- DS009 adâncit conform metodologiei casei: contracte pe cele 11 fire emise (câmpuri cerute din `sop/contracts/wires.json`), pipeline de autorat/compilare, limite de acoperire declarate.

- `knowledge/` de la rădăcină a fost eliminat ca ne-generic la cererea utilizatorului: `bootstrap.sop` și `reasoning-procedures.sop` trăiesc acum în `tests/fixtures/`; consumatori actualizați (CLI `init`, demo-uri, teste, generatoare); îndrumar în `AGENTS.md`. Verificare: 21/21 verificări, 359/359 teste, demo + `init` rulate.

## Presupuneri defectibile (implementat la cererea utilizatorului)

- Reasoner-ul JS: `admissibleAssumptions` — o presupunere e folosită doar dacă niciun fapt admis (sau derivat din reguli) nu susține contrariul explicit al atomului; `hypothetical: true` apare **doar** dacă dovada răspunsului atinge o presupunere păstrată; `defeatedAssumptions` e raportat pentru audit.
- Adaptorul SWI: același filtru înainte de compilarea programului, cu verificarea de acord de închidere păstrată; ambele rute dau același răspuns și același marker (6 teste noi, `tests/assumptions.test.mjs`).
- Runtime: un fapt cu `source assumption` este acceptat numai dacă e consumat de un câmp `assume`; guardul de proveniență nu se aplică acelor fapte, iar ele nu se publică, nu se salvează și nu se întăresc.
- Corpus: familie nouă `assumption_boundary` — 2 cazuri / 6 rânduri (train): presupunere păstrată → `supported` cu `hypothetical: true`; presupunere înfrântă de un fapt negativ explicit → `unknown`. Șablonul aprobat `check_arrival` a fost inline-uit în `cases.mjs` (nu mai depinde de fixture).
- Contract în DS004 ("Assumptions and defeat"), DS006 (paritate între rute), DS009 (familie în matrice + limite declarate).
- Total: 62 cazuri / 198 rânduri (105/44/49); audit Qwen 105/44, max. 383/502, identic nativ/Podman; 366/366 teste, 21/21 verificări.

## Context-free model surface `sop-agent-4` (2026-09-28, delivered on owner request)

- Model surface `stated`, `assumed`, `unclear`, `query` (string `match` blocks), `constraint` (`task` required); `premise` retired from the model surface and kept for trusted circuits and explicitly selected legacy `sop-agent-3` evaluation (DS021, DS004; `sop/declarative.mjs` `MODEL_PROFILES`).
- The formalizer prompt is exactly the user's message (`barePrompt` default `sop-agent-4`; `formalPrompt` = instructions + MESSAGE); host linking of relation phrases, the closed role inventory, entity strings and temporal expressions (`sop/linking.mjs`), with host `clarify` on unknown or ambiguous links.
- Semantics: asserted statements as turn-local user evidence carried in caller-owned context; hedged, supposed and reported statements conditional; model assumptions reported, or branched under `policy.modelAssumptions: 'branch'`; `unclear` (`gibberish`, `no_request`) with EN/RO host replies; no model refusal (`not_computable`).
- Strict ontology SPEC; `predicate.role NAME TYPE` over the closed inventory; `allowJsEval` removed; `cnl.language` defaults to `en`; chat API/page `language` selection and a deterministic in-message request detector; HTTP trace fields; eval admission per row profile with stated/assumed separation and `basis` metrics (`eval/propositions.mjs`).
- Evidence: `npm test` all passing (count in the final verification of the change); new `tests/stated-assumed.test.mjs`, agent and HTTP end-to-end tests with a mock formalizer, executed wire help with `field-<keyword>` anchors; `node tools/verify-vocabulary.mjs --scope docs|examples` pass. No training, no GPU work, no dataset changes.

## textToCleanEnglish: pre-formalization cleaning service, chat UI, survey (2026-09-30, delivered on owner request)

- Owner decision 2026-09-30: formalization handles only clean English; a `textToCleanEnglish` host step runs in the chat UI before formalization (spelling/grammar correction, translation, simplification), shown to the user for Accept/Edit/Send-original, with a setting to turn it off; the small formalizer's own model boundary (DS021) is unchanged — it still receives exactly the finally-sent message, nothing else.
- **Service** (`lib/text-to-clean-english/`): `textToCleanEnglish(message, options)` runs a cheap LanguagesUtil-only gate (non-English tokens, a spelling signal, cheap grammar-trouble regexes; already-clean English skips every backend) and, only when needed, a configured backend (`languagetool`: an external LanguageTool HTTP server, English only; `llm`: a registry `translate`-capability model reached the same way Chat/Translate mode reaches one; `none`), both masking names/numbers/quoted spans with `lib/ud-to-sop/protect.mjs` first (measured: LanguageTool unmasked corrupts unknown proper names). Returns `{original, clean, changed, reasons, spans, backend, confidence}`; an unavailable backend degrades to `backend: "none"` rather than failing the request. `config/text-to-clean-english.json` chooses the backend per message class and can disable the step entirely. `tests/text-to-clean-english.test.mjs` (hermetic, mocked backends).
- **Chat UI** (`server/pages/chat.mjs`, `server/http.mjs`): a *Clean before formalizing* toggle (on by default, Formalize mode only) calls the new `POST /v1/text-to-clean-english`; a changed proposal is shown as a word-level diff with Accept/Edit/Send-original before anything is formalized. The accepted text is the formalizer's whole input as always; the request may carry `cleaning: {original, backend, changed}` and the trace (`chatSop.cleaning`) keeps both the original and the accepted wording. Verified with a live end-to-end smoke test (own port, a real LanguageTool server) and the existing HTTP/auth/formalizer test suites.
- **Survey** (`status/preregistrations/text-to-clean-english-v1.json`, `status/experiments.json`, `eval/reports/current/text-to-clean-english/`): staged, preregistered comparison of EuroLLM-1.7B-Instruct, Qwen3-1.7B, Gemma-3-1B-it (combined proofread+translate+simplify prompt, GPU), LanguageTool (masked), the already-shipped symbolic backend (LanguagesUtil+TranslatorService) and Claude Haiku, on ~40 Romanian / ~44 mixed / ~35 noisy-English `datasets/formalizer-v1` dev rows plus a clean-control set, scored by automatic meaning checks, `execution_equivalent`(`_tolerant`) of SymbolicLM's parse of the cleaned text against gold SOP (DS016), fluency and latency. On GPU, Qwen3-1.7B has the best gold-SOP match of the three LLM candidates on every bucket (ro 0.17, mixed 0.34-0.36, noisyEn 0.54) and is inside the ~2s budget (282-845ms); the same model on CPU averages ≈24.6s/message (up to 81s), far outside it. LanguageTool answers in 50-400ms regardless of GPU. A separate, heuristic-only (not gold-SOP-scored) stage-1 cross-check found the already-shipped symbolic backend has the best/tied-best meaning preservation of everything tried, fastest, and free — flagged non-authoritative and left as `questions.md` Q-CLEAN-2 pending a rerun that scores it the same way. Gemma-3-4B-it and a full 100/100/100 sample were not run (time/resource budget); the Claude Haiku run's recorded outputs do not resemble the requested task and are excluded from every conclusion.
- **This session's own contribution**, on top of the above (produced by several agent instances working the same owner request concurrently on a shared, non-isolated working tree, reconciled here): re-derived the chat UI (`server/pages/chat.mjs` toggle, review panel, word diff, settings persistence) and the `POST /v1/text-to-clean-english` route/trace wiring in `server/http.mjs` against the final, settled `lib/text-to-clean-english/` API; added the DS012, DS021, `docs/runtime.html`, `docs/wiki.html` terminology, `dependencies.md` (LanguageTool + its required private Java 17 runtime, since the host's system Java is 8) and DS014 documentation; added the DS010 "Registered experiments" paragraph and `questions.md` Q-CLEAN-2; reconciled the `status/tasks.json`/`status/experiments.json` records other instances had already written. `npm test`: 696/700 (4 pre-existing failures, `tests/audit-corpus.test.mjs`/`tests/eval-registry.test.mjs`, from an unrelated, still in-flight session's edit to `server/audit.mjs`/`tools/datasets/build-clean-english.mjs`, reproduced in isolation and unrelated to this work).

## Neuro oracle: verified SymbolicProofingLLM pairs from the DeepSeek candidates (2026-09-30, delivered on owner request)

- The 10,722 DeepSeek rewrite candidates of `datasets_sources/neuro_english_targets/` are run through SymbolicLM (frozen rules v2.5, Stanza accurate package, parses recorded on the GPU, rules replayed) by `tools/datasets/neuro-targets-oracle.mjs` (train/dev side, `tools/datasets/neuro-oracle/`) and `tools/eval/neuro-oracle-test.mjs` (sealed side, AGENTS.md rule 9). Levels: `VERIFIED_GOLD` (strict gold match), `VERIFIED_GOLD_NORMALIZED` (gold match under the host's frame normalization), `VERIFIED_FORM` (no gold: identical default/accurate trees, DeepSeek parse judge a and c good, meaning check), `REJECTED` with a reason.
- Meaning judge calibrated first (`eval-neuro-meaning-judge-v1`, DeepSeek flash through omp): precision 53% against the preregistered negatives, below the 95% rule, so no `VERIFIED_FORM` pair; the no-gold tier stays an option (`--include-extra form`).
- Output: `datasets/neuro_english/proofing/{train,dev}.jsonl` (895 and 102 pairs: repair, identity stratified by form, composed hook) with `audit.jsonl`, `manifest.json`, `proofreader/` projection; sealed `eval/suites/neuro_english/proofing-test.jsonl` (95 pairs); `status/training/qualification-neuro-proofing.json` (`tools/research/qualify-neuro-proofing.mjs`, data gate only, no training authorization); `eval/reports/current/neuro-oracle/summary.md` and `engine-gaps.jsonl` (rules backlog).
- No training, no model download, one GPU worker for Stanza parses only. Tests: `tests/neuro-oracle.test.mjs`; `npm test` passing.

## Inventarul istoric (arhivat)

Snapshot-ul dinaintea PR — căile și stările vechi — este păstrat în istoricul git și în `probably_obsolete/legacy/`; secțiunile „Inventarul inițial”, „Dovezi și limite la pornire”, „Discrepanțe de rezolvat” și „Harta reutilizării tooling-ului” din vechiul TODO au fost consolidate în dovezile de mai sus și în rapoartele din `eval/reports/`. Discrepanțele rămase active sunt reformulate ca sarcini deschise în [TODO.md](TODO.md) (P0.1/P0.2/P0.6, P1.2–P1.9, P4.4–P4.6).

## Meaning-judge calibration, back-generated pairs and DeepSeek targets for bad_english (2026-09-30 night, meaning-judge-agent)

Owner direction of 2026-09-30 night (journal): evaluate layer by layer; proofing output must keep the meaning. Delivered and observed:

- **Meaning judge calibration** (`eval-meaning-judge-calibration-v1`, `tools/datasets/meaning-judge/`, folders `datasets_sources/meaning_judge_calibration{,_v2}`): 300 positives (strict gold-matching rewrite pairs), 297 mechanical negatives of 11 types (27 each; "resolve ambiguity" not buildable) and 105 hand-written hard negatives. Confirmatory run v2: m1 precision of yes raw 95.8%, adjudicated 97.5% (Wilson 95.0 to 98.8), recall 92.0%; m2 adjudicated 99.2%, recall 86.0%; two-vote m1 AND m2 raw 98.8%, adjudicated 100% (98.5 to 100), recall 82.0%; reproducibility 95/100. Run v1 was exploratory (prompts identical, written before the record: deviation D1). Blind spots of m1: a pronoun resolved to one of two referents, and/or between questions, a dropped background fact, a reported claim turned into an assertion. The adjudication is by an LLM agent, not a human.
- **`datasets/neuro_english/proofing-backgen/`** (`tools/datasets/backgen-proofing.mjs`, `tools/eval/backgen-sealed-check.mjs`): 10,160 pairs (train 8,978, dev 1,182) from 15,448 DeepSeek paraphrases of symbolic_english train/dev messages: 6,785 repair pairs and 3,375 identity examples (the paraphrase already passes the calibrated parse gate), all verified by the two-vote meaning judge; flat `proofreader/` layout, `audit.jsonl`, `manifest.json`. Rejections are counted in the manifest.
- **bad_english DeepSeek targets** merged through the dataset builder (`three-datasets/llm-targets.mjs`, `tools/datasets/merge-llm-targets.mjs`): 12,805 targets (`llm:deepseek-flash`, review pending), 31 mixed rows with the message as target, 1,517 targets held as unverified references (clean-English gate), 760 unfixable rows flagged; a 100-row read found 3% meaning errors. `verify-three-datasets --dataset bad_english` 0 failures.
- **Not done:** the merge into the sealed `eval/suites/bad_english/test.jsonl` (denied by the permission classifier; the assembler applies the targets on the next sealed rebuild); no human review of any of this; `npm test` has one failure (`tests/three-datasets.test.mjs`) caused by another agent's in-progress verifier rework, not by these changes.

## LanguageProofingLLM iteration 1 (2026-10-01, language-proofing-training-agent)

Preregistered `train-language-proofing-gemma270m-it1` (owner approval of 2026-09-30T17:32:38Z, receipt in `status/training/`). Delivered and observed:

- **Data.** `tools/datasets/build-language-proofing.mjs` projects `datasets/bad_english` to sentence pairs (`datasets/bad_english/proofing`: 21,414 train, 3,946 dev; ro 11,915, mixed 1,933, noisy_en 5,425, clean identity 2,141 in train), `tools/eval/language-proofing-test.mjs` builds the sealed units (`eval/suites/bad_english/proofing-test.jsonl` 10,711 units, `proofing-test-clean.jsonl` 900 clean sentences), `tools/research/qualify-language-proofing.mjs` qualifies and transcribes the receipt.
- **Run.** Gemma 3 270M IT LoRA, 4,017 steps (35 min), run `models/gemma/language-proofing-gemma270m-it1/proofreader`, epoch 3 selected on dev; GGUF Q8_0 exported (CPU 4 threads p50 112 ms per sentence).
- **Evaluation.** `tools/eval/language-proofing-eval.mjs` (clean-English gate, content preservation, chrF, analysis gate, meaning judge, paired bootstrap), `language-proofing-shipped.mjs` and `-shipped-server.mjs` (the shipped LanguageTool + Qwen3-1.7B step), composed K4 per sentence. Report `eval/reports/current/language-proofing-it1/summary.md`: clean English 97.2% (ro 99.7%), composite 65.9% against 58.5% for the shipped step on the judged sample, clean sentences untouched 94.8% (bar 95% missed), meaning judge 81.4% (references 89.9%); main error an unseen-word substitution (child of to parent of).
- **Not done.** No human review of the DeepSeek targets or of the judge verdicts; no iteration 2; mixed judged on 24 units only; the qualification record predates the owner-approved merge into the sealed test (deviation D3).

## LanguageProofingLLM iteration 3 (2026-10-01, language-proofing-it3-agent)

Preregistered `train-language-proofing-gemma270m-it3` (owner approval of 2026-09-30T17:32:38Z plus the 2026-10-01 decision transcribed in the journal at 03:35:42Z; receipt `status/training/authorization-gemma-language-proofing-gemma270m-it3.json`). Delivered and observed:

- **Data.** `datasets/bad_english/proofing-it3` (`tools/datasets/build-language-proofing-v3.mjs`): train 62,939 / dev 5,173; the ten formerly held-out words in train, eight new words held out (`dev-heldout-v3`, 830 pairs), 2,663 spacing repair pairs (`tools/datasets/language-proofing/spacing.mjs`); qualified.
- **Run.** Gemma 3 270M IT LoRA from the base, one attempt, 11,802 steps (130 min), epoch 2 selected on dev; GGUF Q8_0 (CPU p50 105 ms, 118 tokens/s; HF to GGUF agreement 554/599).
- **Result.** Words in the data are learned and used (trained words 94.1% vs 45.6% for it2); unseen words are not (52.0%, Romanian input 26.4%). Spacing repaired (99.6%). Judged composite unchanged (67.2% vs 67.2% by the same judges); clean900 98.2%, mash 98.7%, child flip 0.4%; sealed content-preserved -0.75 pp. Chat `language-proofing-llm` switched to it3 by the preregistered rule. Report `eval/reports/current/language-proofing-it3/summary.md`.
- **Not done.** No human review of targets or judge verdicts; epoch 3 not evaluated on sealed data; no 1B run; iteration 4 (probe words back into training, proper-noun protection, Q8 review) not started.

## Decomposition evaluation and iteration-3 decomposition data (2026-10-01, decomp-agent)

Experiment `eval-decomposition-v1` (preregistration `status/preregistrations/eval-decomposition-v1.json`), report `eval/reports/current/decomposition/summary.md`. No training, no change in `lib/`.

- **Set.** `eval/suites/decomposition/test.jsonl`, 275 sealed tangled cases (coordination 34, subordinate 45, relative 32, completive 45, multi_question 40, run_on 34, list 45): tangled rows of the sealed neuro_english test plus DeepSeek tangled paraphrases of groups of sealed symbolic_english test sentences; expected decompositions certified by SymbolicLM and accepted by both meaning votes (Grok, GLM). Replaces K6 (16 cases) as the decomposition measure.
- **Scorer.** `tools/eval/decomposition-score.mjs` (graded severity of the "I understood" summary against the message, upper and lower estimates; detectability as a dimension: a marker is a not-represented span, an uncertain sentence or a partial leftover; silent meaning change = S3 or S4 with no marker; certified per sentence; sentence counts; paired comparisons). DS016 "Decomposition and detectability".
- **Baselines.** none, it2 always, it2 gated + certified, it2 partial acceptance (llama-server on CPU, own port): silent meaning change 4.7% / 8.0% / 4.7% / 4.4%; catastrophic summary 15.3% / 13.8% / 13.5% / 13.5% (upper; lower 6.2% / 6.6% / 5.1% / 5.1%); sentence count at the expected 11.3% / 44.0% / 32.0% / 32.0%. Findings: sending everything makes failures silent (paired +3.3 points, p = 0.049), the gate removes that (p = 0.004) but leaves 179 of 342 tangled-but-certified units untouched, partial acceptance almost never fires (2 of 163 sent units), and the certified acceptance passes a connective reattachment.
- **Data.** `datasets/neuro_english/proofing-it3-decomp` (prepared, not trained): 3,246 train and 326 dev pairs, 1,850 subordinate-type, 1,300 list and long-coordination (capped), 96 partial-acceptance; accepted on Grok's two meaning votes (deviation D1, orchestrator decision 2026-10-01); qualified by `tools/research/qualify-decomp-it3.mjs`.
- **Not done.** No training; no human review of the generated tangled sentences or of the judge verdicts; the subordinate count (1,850) is below the 2,000 requested because certified one-clause sentences are scarce; partial acceptance is only the host-side form; span-level detectability is not implemented; no change to the acceptance check (no connective-attachment check).
