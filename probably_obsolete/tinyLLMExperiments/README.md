# tinyLLMExperiments: the frozen small-model research branch

## 1. What this folder is

On 2026-10-01 the owner froze the research branch of small models (journal line "Owner: new direction — freeze the tiny-model branch; circuits only via the omp coding agent; goal = symbolic reasoning that beats small LLMs", `status/journal.jsonl`, 2026-10-01T19:49Z). Stanza with the Python UD worker, SymbolicLM, the UD-to-SOP rules, LanguagesUtil, textToCleanEnglish, TranslatorService, LanguageProofingLLM, SymbolicProofingLLM, FormalizerLLM, the three datasets (plus `natural`) and everything built to train, evaluate and audit them moved here with `git mv`, keeping each file's original path below this folder. From now on circuits come only from the omp coding agent, and the only goal is symbolic reasoning that beats small LLMs and helps small LLMs reason symbolically. Nothing here is deleted for good: the state before the freeze is commit `97188d6` ("WIP snapshot before the tiny-model freeze refactor"), and anything removed outright (for example the older frozen rule copies) is in that history (`git show 97188d6:<path>`). Paused, non-small-model work lives in `../paused/`. This folder is evidence and a resume kit, not product documentation. Tests under `tests/` here are moved, not run any more.

## 2. Old path to new path

Every moved path is `probably_obsolete/tinyLLMExperiments/<old path>`. Areas:

| Area | Old path (now below this folder) |
| --- | --- |
| SymbolicLM, rules, languages, translation | `lib/symbolic-lm`, `lib/ud-to-sop`, `lib/languages-util`, `lib/translator-service`, `lib/text-to-clean-english`, `lib/llama-chat.mjs`, `lib/sentence-split.mjs`; Stanza worker `training/python/ud_parse_worker.py` |
| Server pieces | `server/formalizers.mjs`, `server-models.mjs`, `capabilities.mjs`, `language.mjs`, `audit*.mjs`, `pages/audit.mjs` |
| Configs | `config/formalizers.json`, `server-models.json`, `symbolic-lm.json`, `text-to-clean-english.json`, `audit-corpora.json`, `train-*.json` |
| Datasets | `datasets/{bad_english,symbolic_english,neuro_english,natural}`, `datasets/SOURCES.md`, `datasets_archive/` (legacy corpora, `PATH_ALIASES.json`) |
| Sealed suites | `eval/suites/{bad_english,symbolic_english,neuro_english,decomposition,proofing,clean-english,formalizer-v1,formalizer-ood-v1,formalizer-wild-v1}` |
| Evaluation harness | `eval/run.mjs`, `metrics.mjs`, `registry/`, `severity/`, `signature.mjs`, `propositions.mjs`, `reference-free.mjs`, `llm.mjs`, `prompts/`, `predictions/` |
| Archived reports | `eval/reports/history/**` (all numbers cited below that say "history") |
| Training | `training/` (`cli.mjs`, `python/`, `container/`, `scripts/`) |
| Tools | `tools/{symbolic-lm,symbolic-regression,ud-rules-try,ud-rules-fuzz,sop-gbnf,dictionary,frames,verify-vocabulary,teacher-generate,accept-teacher,review-alias}.mjs`, `tools/{research,datasets,eval,lint}/`, `check-datasets.mjs` |
| Skills | `skills/{training-rules,training-runbook,night-orchestration,spark-training,corpus-audit,synthetic-sop-data,lexicon-curation,semantic-sop-review}` |
| Specs (ids before the 2026-10-01 renumbering) | `specs/DS007-training`, `DS008-data-evaluation`, `DS009-query-curriculum`, `DS015-independent-corpus`, `DS018-research-corpora`, `DS019-grounded-corpora`, `DS020-corpus-audit-tool`, `DS030-capability-apis` |
| Docs, tests | `docs/training.html`, `tests/**` |

Kept in the product tree for reuse: `tools/datasets/{diversity,no-copy.mjs,rights.mjs,audit/content-word-overlap.mjs,three-datasets/{inputs,forms}.mjs}`, `lib/dataset-paths.mjs` (it resolves into this folder), `eval/leakage.mjs`, `tools/eval/severity`.

## 3. Components: what they were, best results, failures, how to resume

All numbers are quoted from the named source; none is a current run. Resume commands assume the root restored as in "How to resume (all components)" at the end of this section.

### Stanza and the Python UD worker
`training/python/ud_parse_worker.py`, started by `lib/ud-to-sop/stanza.mjs`; environment `~/nlp-venv` (stanza 1.10.1), accurate package `~/stanza_accurate` (pinned in `dependencies.md`). Result: switching SymbolicLM to the `default_accurate` package moved sealed clean-English strict match from 59.42% to 67.05% (+7.63 pp [6.52, 8.74]), `PAS_TASK.md` "SymbolicLM on the Stanza accurate package", experiment `eval-symbolic-accurate-adopt-v1`. Weak point: Stanza on the GPU is not bit-stable across batches (one regression row flips, `TODO.md` at 97188d6). Resume: `~/nlp-venv` and `~/stanza_accurate` must still exist; `CHATSOP_NLP_PYTHON`, `CHATSOP_STANZA_PACKAGE`, `CHATSOP_STANZA_ACCURATE_DIR`.

### SymbolicLM and the UD-to-SOP rules
Stanza analysis plus rules into the grammatical `analysis` and SOP (`lib/symbolic-lm`, `lib/ud-to-sop`, service `lib/symbolic-lm/serve.mjs`). Frozen rule sets: `eval/reports/current/baseline-ud-rules/frozen-rules-v2.8` is kept; older copies (v1.4 to v2.5 and others) were deleted and are in git history at 97188d6. Best results: clean English strict 59.6% [57.7, 61.5], frame-normalized 71.7% on 2,543 sealed rows with the default package (`eval/reports/current/clean-english/summary.md`, report in this folder's history after the move); rules v2.5 on the accurate package, strict 56.34% to 69.53% on 9,966 development rows (`PAS_TASK.md`); regression suite `symbolic_english` replay: 8,049 rows same, no version bump (`PAS_TASK.md` "SymbolicLM hang fixed"). Failures: open-ended wild suite 16% on clean English (17.6% with the accurate package); loses known forms inside paragraphs (K1 98/96/81/66% for 2/3/5/8 sentences, K3 6.7% at 48 sentences, pronoun reference K5 82/74/50%); universal relative clauses 9.4% strict, coordinated subjects 22% (`TODO.md` 1d, 1f at 97188d6). Resume:
- Service: `node tools/symbolic-lm.mjs serve --host 127.0.0.1 --port 18961 --threads 4` (add `--rewrite-url <endpoint> --rewrite-when uncertain` for the gated rewrite).
- Regression: `node tools/symbolic-regression.mjs` (live, Stanza needed), `--replay tests/fixtures/symbolic-english/sample.json` (recorded parses), `record-parses` then `--replay eval/reports/current/symbolic-regression/parses.json` (rules only, seconds).
- Rules development: `node tools/research/rules-v2-dev.mjs sig --run <name>`; termination guard `node tools/ud-rules-fuzz.mjs`.

### LanguagesUtil
Language identification and symbolic spelling (`lib/languages-util`: `langid.mjs`, `spellfix.mjs`, `frame.mjs`). Behaviour-preserving move from SymbolicLM verified byte-identical on 50 rows (`PAS_TASK.md` "TranslatorService, LanguagesUtil split"). Spelling preprocessing experiment `eval-spellfix-preproc-v1` (`eval/reports/current/spellfix`). Resume: library only, `import` from `lib/languages-util/`.

### textToCleanEnglish
Chat UI step validated by the user: gate, then English to LanguageProofingLLM, Romanian or mixed to translator-llm (Qwen3-4B Q4_K_M, LanguageProofingLLM fallback); the LanguageTool backend was removed (`CHANGES.md`). Survey (`eval/reports/current/text-to-clean-english/summary.md`): clean input untouched by the gate (0 of 300 clean rows, 9 of 400 independent clean messages sent to a backend); the earlier default (LanguageTool 5.9 plus Qwen3-1.7B) was replaced. Realism check on the owner's 226 messages (`eval/reports/current/natural/summary.md`): numbers kept 96.5%, names and identifiers 84.5%, negation 94.8%; judged good enough only 4.0% (upper) to 10.6% (lower) of messages, S4 88.5% (upper); the messages are project jargon and unpunctuated run-ons, so this is a realism check, not a gate. Not run: Gemma 3 4B-it GPU latency and a full 100/100/100-row survey. Resume: `lib/text-to-clean-english`, `config/text-to-clean-english.json`, the llama-server entries of `config/formalizers.json` and `server-models.json`.

### TranslatorService, translator-llm (Qwen3-4B) and answer translation
`lib/translator-service` with pluggable backends (`symbolic`, `english`, `opus-mt`, Apertium stub). Findings: Opus-MT ROMANCE-en is decisively worse than `direct` on 150 Romanian rows (tolerant -15.3 pp [-22.7, -8.0], about 6x slower) and does not clean "romgleza" fluently (21/50 = 42% [29, 56]) (`eval-translator-compare-v1`, `eval/reports/current/translator-compare/summary.md`); small base LLMs cannot translate and destroy the message (T1 Gemma 3 270M-it: OOD tolerant execution 20.7% to 4.1%, -16.7 pp) (`eval/reports/history/translate-then-formalize/summary.md`). Qwen3-4B Q4_K_M became the Romanian translator and also translated answers EN to RO (`CHANGES.md` "Input edge"); recorded exception: 15 to 20 tokens per second. Not done: a preregistered evaluation of answer translation and input translation (meaning preservation of names and numbers); the opus-mt distillation (`config/train-opus-mt.json`, dataset `bad_english/translate-jargon-v1` 4,923/431) never trained, waiting for an owner-written receipt `status/training/authorization-opus-translate-distill-v1.json`. Resume: translator-llm needs `models/qwen3-4b-instruct/gguf` (2.4 GB, present).

### LanguageProofingLLM (Gemma 3 270M, run `language-proofing-gemma270m-prod1`)
Romanian, mixed and bad English to acceptable English. Best: prod1 epoch 3 F16 (3 epochs, 12,486 steps, 66,587 train / 5,173 dev), against iteration 3 on sealed data (`eval/reports/current/language-proofing-prod1/summary.md`): names kept in 99.2% of 1,106 units against 65.6% (+33.5 pp [+30.7, +36.2]); fresh 18-word probe 88.2% (540/612) against 69.6%; typo'd child words 100% against 50%; mash unchanged 100%; content preserved 98.3% against 97.9%; CPU 90.3 tokens/s (F16), 139.2 (Q8_0). Failed gates: relation word kept 98.3% against 99%, eight unseen-vocabulary words 88.3% against 90%; judged meaning preserved 82.5% against 81.0% (n.s.). Iteration 3 showed the limit: words absent from training survive only 52.0% (432/830) against 94.1% for trained words (`eval/reports/history/language-proofing-it3/summary.md`). Typo mangling remains ("wher was albert einstien borned" to "Where was Albert's birth?"). Resume: GGUF `models/gemma/language-proofing-gemma270m-prod1/proofreader/gguf/ep3-f16.gguf`; data `datasets/bad_english/proofing-prod1`.

### SymbolicProofingLLM (run `symbolic-proofing-gemma270m-it3`, gate)
Rewrites correct English into the limited English SymbolicLM understands; role id `proofreader` and path `models/gemma/proofreader-gemma270m-v1` stay frozen. Iteration 3 (734 s, 2,718 steps, `neuro_english/proofing-it3-mix`, F16 CPU p50 233 ms, 117 tokens/s): on the sealed decomposition set gated + certified, sentence count as expected 36.7% against 32.0% for it2 (p = 0.012), every sentence certified 68.4% against 65.5%, silent meaning change 5.1% against 4.7%, identity change on 500 working sentences 9.2% against 15.4% (`PAS_TASK.md` "SymbolicProofingLLM iteration 3"). Iteration 2 (`eval/reports/history/symbolic-proofing-it2/summary.md`): repair correct and meaning kept 37.6% [34.2, 41.2] with judges against 9.3% for it1; the identity break NOT fixed (19.8% of 495 identity pairs changed against a bound of 1%). Failures: not trained for paragraphs (K6 expected sentence count 0 of 16, K3 32.7% exact); the per-sentence gate recalls only 40.7% of sentences needing a rewrite. Resume: rewrite gate `--rewrite-when uncertain|trees` of the SymbolicLM service; GGUF under `models/gemma/symbolic-proofing-gemma270m-it3`.

### FormalizerLLM (smollm2-135m, smollm2-360m, gemma-3-270m, formalizer-v1 runs)
SOP Lang written directly from the message; archived and removed from the product 2026-10-01 and earlier. Size study `formalizer-size-v1` (run `fv1-size-a4`, `eval/reports/history/formalizer-size-v1/summary.json`, Q8_0 tolerant execution equivalence): `formalizer-v1` sealed 5,033 rows 74.1% (smollm2-135m) and 74.2% (gemma-3-270m); `formalizer-ood-v1` 1,578 rows 33.3% (135m), 28.0% (gemma), 47.5% (smollm2-360m). Grammar-constrained decoding gave zero accuracy change in every cell (`eval/reports/history/grammar-constrained/summary.md`); MT-style formalizer `formalizer-mt-v1` (Opus-MT ROMANCE-en as base, 77.9M) was blocked before any optimizer step (`eval/reports/history/formalizer-mt-v1/summary.md`). Why frozen: SymbolicLM replaced it, with no context and no versions. Resume: `config/train-*.json`, `models/*/fv1-size-a4`.

### ModelManager and GGUF role entries
Chat and API model entries (`config/formalizers.json`, `server-models.json`, `server/server-models.mjs`, lifecycle test `tests/model-lifecycle.test.mjs`): roles `formalize`, `translate`, `chat`, `proofread`, base entries `*-base`. CPU speed table (`eval/reports/current/cpu-speed/cpu-speed-table.json`, DGX Spark ARM, indicative): Gemma 3 270M Q4_K_M 88.9 to 154.8 tokens/s, SmolLM2-360M 61.0 to 134.3, Qwen3-0.6B 42.8 to 92.7, Gemma 3 1B-it 25.5 to 52.0, Qwen3-1.7B 17.5 to 37.4 (does not meet 30 to 40).

### Datasets and their build tools
`bad_english` (Romanian, mixed, bad English), `symbolic_english` (analysis correct; regression suite), `neuro_english` (SymbolicLM fails; SymbolicProofingLLM material), `natural` (226 owner messages, seeds and realism set). Rebuilt on the accurate engine: `symbolic_english` 6,771 / 896 / 2,567 (train / dev / sealed test), `neuro_english` 4,544 / 683 / 1,665, `bad_english` 17,169 / 3,215 / 5,511 (`PAS_TASK.md` "SymbolicLM on the Stanza accurate package"); the gate judged 1,920 sentences (condition c) and 550 (condition b), 15.26 of 25 USD. Open: SymbolicProofingLLM pair set train 4,172, dev 626, sealed 1,234; only 785 of 6,832 `neuro_english` rows and 7,666 of 25,895 `bad_english` rows have rewrite targets; Romanian and mixed targets are machine translations (53% gender agreement). Resume: `node tools/datasets/build-three-datasets.mjs assemble --datasets symbolic_english,neuro_english --unparsed-policy gate`, then the post-rebuild steps `form-templates`, `drop-lexical-duplicates --apply`, `composed-train --apply`, `form-variants --apply`, `test-variants`, `composed-suites`, `composed-tokens`, `verify-three-datasets` (DS008 "Form coverage and form variants"); `node tools/datasets/verify-three-datasets.mjs` is the gate.

### Sealed suites and the evaluation harness
`eval/run.mjs`, the registry, composed metrics (K1 to K6), decomposition suite, graded severity (`eval/severity`, judges Grok and GLM, worse = upper, disagreement on S3/S4 = excusable ambiguity), `eval/leakage.mjs` (kept in the product). Composed pilot: `eval/reports/history/composed-eval-pilot-2026-09-30`. Policy: only the same form with different words is tested (DS008 "Form coverage and form variants"). Resume: `node eval/run.mjs --help`, `node tools/eval/test-variants.mjs`.

### Corpus audit and the /audit page
`server/audit*.mjs`, `server/pages/audit.mjs`, `tools/datasets/audit-corpus.mjs`, spec DS020-corpus-audit-tool; tabs `bad_english`, `symbolic_english`, `neuro_english` plus archive / sources; verdicts appended to `eval/reports/current/audit/<dataset>.jsonl`. Machine audit: `node tools/datasets/audit-corpus.mjs --corpus <name>` (procedure `skills/corpus-audit/SKILL.md`).

### Symbolic regression
`tools/symbolic-regression.mjs` and `lib/symbolic-lm/regression.mjs`: classes same, analysis_changed_sop_same, sop_changed_equivalent, sop_changed, now_failing; exit code 1 on the last two. Last run: `eval/reports/current/symbolic-regression/report-verify.json`.

### Diversity generator
Partly kept in the product (`tools/datasets/diversity`); the LLM diversification (`tools/datasets/llm-diversify`) and `diversity` corpora moved. Diverse-dev test `eval-proofreader-diverse-dev-v1` (669 rows): real but partial gain, `gemma_always_on` +2.89 pp (`TODO.md` 1b at 97188d6).

### Training skills and runbooks
`skills/training-rules`, `training-runbook`, `night-orchestration`, `spark-training`; CLI `node training/cli.mjs --help`; container `training/container/Containerfile`. Rule that stays: training happens only with the owner's explicit approval per run, quoted in a receipt under `status/training/`; an approval is spent when its run ends; image build, CUDA preflight, safe stop and dataset qualification need no approval; one GPU job per machine.

### How to resume (all components)
Moved files keep their repository-relative imports (`../../lib/...`), which resolve only when the folder content sits at the repository root. Restore with:

```
rsync -a --exclude README.md --exclude specs probably_obsolete/tinyLLMExperiments/ ./
# after checking the result, delete probably_obsolete/tinyLLMExperiments (except this README) and commit
```

Equivalent per area: `git mv probably_obsolete/tinyLLMExperiments/lib/symbolic-lm lib/symbolic-lm`, and so on. Files that the product changed after the freeze (for example `config/formalizers.json`, `server/*.mjs`, `lib/dataset-paths.mjs`, `docs/specs/*`) must be taken from `git show 97188d6:<path>` and merged by hand rather than overwritten. Specs go back to `docs/specs/` under the then current ids (see `docs/specs/aliases.json`). Then run `node --test tests/*.test.mjs` and `node tools/symbolic-regression.mjs --replay tests/fixtures/symbolic-english/sample.json` before any work.

## 4. Open items at freeze (from `TODO.md` at 97188d6)

- SymbolicLM rules: universal relative clauses and coordinated subjects, anaphora, filler in long messages, time roles (`as of`, `from X to Y`); wild suite 16%; paragraph loss (K1, K3, K5).
- Decide whether the frame list may absorb the gold relation/role convention (314 of 1,027 strict misses, 12.1 pp).
- Grammar check (gate e of the clean filter) not implemented; no local checker installed.
- Three `symbolic_english` rows removed by hand under rules v2.8 belong in `neuro_english` at the next rebuild.
- Rebuild `bad_english` projection and sealed units; SymbolicProofingLLM iteration 4 on the rebuilt pair set needs the owner's explicit OK.
- Stanza GPU non-determinism decision; Q-DATA-3 rebuild (unparsed spans placed by the analysis gate, option B) after the current production trainings.
- LanguageProofingLLM typo mangling; Q-DATA-1 human review of new-case rows (all `reviewed-by:pending`); rewrite targets sparse; DeepSeek targets of `bad_english_targets` not merged.
- Decomposition: send tangled-but-certified units to SymbolicProofingLLM (52% of tangled units), grow `proofing-it3-decomp` beyond 1,850.
- Unified Qwen3-4B (u2): trained in `models/qwen3-4b/unified-qwen3-4b-u2`, evaluation against the chain not done (tooling in `../paused/tools/eval/unified-ft`).
- opus-mt distillation waits for the owner-written receipt.
- Romanian UD rules and the `direct` / `translate` routes remain as research code behind `englishOnly`; translation quality at the edges has no preregistered evaluation.

Open questions at freeze: `questions.md` at 97188d6 held no question (header only). Earlier questions Q-CLEAN-1 (confirm `qwen3-1.7b-base`) and Q-CLEAN-2 (a `symbolic` fallback backend) were named in `TODO.md` as open.

## 5. Trained models (gitignored, left in place under `models/`)

| Directory | Size | What it is | Run id / provenance |
| --- | --- | --- | --- |
| `models/gemma/language-proofing-gemma270m-prod1` | 2.1 GB | LanguageProofingLLM, shipped | `train-language-proofing-gemma270m-prod1`, `status/preregistrations/`, report `eval/reports/current/language-proofing-prod1` |
| `models/gemma/language-proofing-gemma270m-it1`, `-it2`, `-it3` | 563 MB, 563 MB, 1.9 GB | earlier LanguageProofingLLM iterations | `train-language-proofing-gemma270m-it1/2/3`; `eval/reports/history/language-proofing-it1..3` |
| `models/gemma/language-proofing-gloss-gemma270m` | 262 MB | gloss post-editor | `train-language-proofing-gloss-gemma270m` |
| `models/gemma/symbolic-proofing-gemma270m-it3` | 2.1 GB | SymbolicProofingLLM, shipped (gated) | `train-symbolic-proofing-gemma270m-it3` job `symproof-it3-train-a2` |
| `models/gemma/symbolic-proofing-gemma270m-it1`, `-it2` | 864 MB, 561 MB | earlier iterations | `eval/reports/history/symbolic-proofing-it1`, `-it2` |
| `models/gemma/proofreader-gemma270m-v1` | 2.2 GB | first proofreader (role id `proofreader`) | `train-proofreader-gemma270m-v1` |
| `models/{gemma,smollm2-135m,smollm2-360m}/fv1-size-a4` | 1.5 GB, 756 MB, 1.9 GB | FormalizerLLM size study | `formalizer-size-v1` |
| `models/{gemma,smollm2-135m,smollm2-360m}/{chat-base,translator-base,cpu-bench-base}` | 279 MB to 369 MB each | base GGUFs for chat, translate, speed | `config/formalizers.json` |
| `models/gemma/bases`, `models/qwen/bases`, `models/qwen3-4b/bases`, `models/smollm2-*/bases` | 549 MB, 1.5 GB, 7.6 GB, 260 MB and 694 MB | pinned Hugging Face bases | `dependencies.md` |
| `models/qwen3-4b/unified-qwen3-4b-u2` | 3.0 GB | unified Qwen3-4B (faithful + limited English), evaluation incomplete | `status/preregistrations/train-unified-qwen3-4b.json` |
| `models/qwen3-4b-instruct` | 2.4 GB | translator-llm GGUF | `provenance.json` there |
| `models/opus-mt*` (4 dirs) | 555 MB, 301 MB, 893 MB, 8 KB | Opus-MT bases | `dependencies.md` |
| `models/languagetool` | 598 MB | LanguageTool 5.9 (backend removed) | `dependencies.md` |
| `models/proofing` | 8.5 GB | zero-shot proofreader candidates (Gemma 3 1B, Qwen3-1.7B, GGUF) | `models/proofing/weights.sha256`, `proofing-candidates-v1` |
| `models/emotion` | 1.7 GB | four emotion classifiers (see `../paused/`) | `emotion-detection-v1` |

Total `models/` about 45 GB (`du -sh models/*`).

## 6. Disk notes

`models/` about 45 GB; `datasets_sources/` 6.7 GB (raw source cache, gitignored, never exported, `DS011-source-rights.md`); `eval/reports/current/` 2.5 GB (gitignored, regenerable). All left in place. Owner's disk-hygiene decision of 2026-10-01 (AGENTS.md at 97188d6): after a training run keep the selected adapter, shipped GGUFs and run metadata, delete `merged-epoch-*`, `gguf-src`, unselected GGUFs and aborted checkpoints; trained models are never committed (publish a GGUF outside git, record URL and sha256); before every commit run `node tools/shard-large-files.mjs --check` and no file may exceed 50 MB.
