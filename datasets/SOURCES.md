# Sources that inspire the ChatSOP corpora

This file is the single sources README for the datasets (`datasets/` and the legacy corpora in `datasets_archive/`). It is not case Markdown: corpora stay JSONL-first (AGENTS.md rule 11), and no case, target or row is authored here.

## Decision

On **2026-09-28** the repository owner released the corpora that ChatSOP derives from, and is inspired by, QQP, PAWS, ProofWriter, AmbigNQ, QA2D and SQuAD (`inspired-by-released`): the texts are original, the inspiration is structural (structure, label types, phenomena and statistics feed the diversity generator in `tools/datasets/diversity/`, inventory `datasets_archive/diversity/inventory.json`), and the purpose differs. The decision, its reasons and the per-asset rights evidence are recorded once, in [DS014](../docs/specs/DS014-source-rights.md). Training still requires a separate explicit approval (AGENTS.md rule 3); this release concerns corpus rights only.

## The no-copy guarantee is checked, not asserted

`node tools/datasets/no-copy.mjs --corpus <name>` (or `--files a.jsonl,b.jsonl`) streams every cached source text in `datasets_sources/` and reports, for every corpus row:

- **paired 4-gram overlap**: word 4-grams shared between a row's natural-language text and the specific source row named in its lineage (`lineage.source` + `lineage.source_row_id`). The bar is **0**.
- **long-span overlap**: word 8-grams shared with *any* cached source text. The bar is **0**; a shared 8-gram is a copied phrase.
- **global 4-gram rate**: the share of a row's 4-grams that occur anywhere in the sources. Common English (for example "what is the best") is expected here; the rate is reported for review, not failed.
- **identifier leakage**: case ids, source row ids and generator counters inside natural language. The bar is **0**.

Reports go to `eval/reports/current/rights/no-copy-<corpus>.json`. The diversity generator runs the same check on its output before it writes a corpus.

## Sources

| Source | URL | Licence as known | What we took | What we did not take |
| --- | --- | --- | --- | --- |
| **QQP** (Quora Question Pairs, GLUE packaging) | https://quoradata.quora.com/First-Quora-Dataset-Release-Question-Pairs (cached from https://huggingface.co/datasets/nyu-mll/glue, `qqp`) | Quora first release terms: research and educational use with attribution; no SPDX licence; commercial use not addressed by a primary grant | Equivalent / non-equivalent pair label types; question-type distribution; paraphrase operations (reordering, synonym substitution, person switch, question-frame change, modifier addition); conversational noise rates (lowercase starts, missing `?`, chat spellings); multi-sentence question shapes | Any question text, topic string or row id |
| **PAWS-Wiki** labeled final | https://github.com/google-research-datasets/paws (cached from https://huggingface.co/datasets/google-research-datasets/paws) | PAWS LICENSE: "may be freely used for any purpose", acknowledgement of **Google LLC** appreciated; underlying Wikipedia sentences CC BY-SA 4.0 | High-overlap contrast design (same words, different meaning); word-swap and argument-swap rates; clause and adverbial movement; paraphrase / non-paraphrase balance | Any Wikipedia sentence, name or row id |
| **ProofWriter** (OWA, structured) | https://allenai.org/data/proofwriter (cached from https://huggingface.co/datasets/rlhf-and-friends/proofwriter) | No licence file in the official release; secondary sources report CC BY 4.0 (not confirmed from a primary notice) | True / False / Unknown balance under the open-world assumption; derivation-depth distribution; rule body sizes; rule surface forms (if-then, generic plural, all-quantified); explicit negation in facts, rules and questions | Theories, rules, questions, the synthetic names (Charlie, Dave, ...) and attribute vocabulary |
| **AmbigNQ** (AmbigQA) | https://nlp.cs.washington.edu/ambigqa/ (code https://github.com/shmsw25/AmbigQA) | CC BY-SA 3.0 notice bundled in the publisher release ZIP; underlying Natural Questions CC BY-SA 3.0 | Ambiguity types (entity reference, time dependency, answer type, property / sense, event reference); single- versus multiple-interpretation proportions; disambiguation operations (added time, type, qualifier, property) | Questions, disambiguated rewrites, answers, evidence snippets |
| **QA2D** | https://github.com/kelvinguu/qanli (cached from https://huggingface.co/datasets/domenicrosati/QA2D) | Code MIT (Copyright 2019 Dorottya Demszky); dataset licence not stated; upstream SQuAD CC BY-SA 4.0 plus RACE, NewsQA, QAMR and MovieQA terms | Question-to-declarative rewrite operations (wh-fronting undone, auxiliary inversion undone, answer-slot position); question-type distribution; declarative length ratios | Questions, answers, turker or rule-based declaratives |
| **SQuAD v2.0** (dev) | https://rajpurkar.github.io/SQuAD-explorer/ | CC BY-SA 4.0 | Answerable versus unanswerable question design; the existing sealed source-reference derivative keeps its recorded attribution, modification notice and ShareAlike duties | Passages, questions and answers outside that recorded derivative |

Acknowledgements: Quora Inc.; Google LLC (PAWS); the Allen Institute for AI (ProofWriter); the University of Washington AmbigQA authors; Demszky, Guu and Liang (QA2D); Stanford NLP (SQuAD). The acknowledgements are courtesy and attribution; they do not imply endorsement.

## The three datasets (owner decision of 2026-09-30)

`datasets/` now holds only `bad_english`, `symbolic_english` and `neuro_english` (each with its own `README.md` and `manifest.json`); the corpora described in the sections above and below (`formalizer-v1`, `proofing`, `proofing-diverse-dev`, `clean-english`, `diversity`) moved unchanged to `datasets_archive/`, where they remain the provenance inputs and the gold-SOP arbiter (`datasets_archive/PATH_ALIASES.json` maps the old paths). This file stays here as the one attribution and rights file; there is no second `SOURCES.md`.

| New dataset | Rows come from | Text taken | Rights |
| --- | --- | --- | --- |
| `bad_english` | formalizer-v1 and the sealed suites (rows the clean-English classifier calls Romanian, mixed or noisy), the noisy new cases, diversified paraphrases | messages as written; targets from `proofing` repair pairs, recorded-noise inversion, clean siblings, the oracle-checked `proofing` Romanian translation arm, and the new cases' clean references | inherited per row from formalizer-v1 (`owner-released-inspired-by`, no source text copied); new cases below |
| `symbolic_english` | clean-English rows that SymbolicLM analyses correctly (gold SOP match under ud-rules-v1.4), and clean new cases that yield a valid SOP (`pending_judge`) | messages; SymbolicLM's own analysis and SOP | as above |
| `neuro_english` | clean-English rows that SymbolicLM fails on | messages; targets from `proofing` repairs (strict-oracle checked), `regularization-candidates` attempts, and new-case references SymbolicLM handles | as above |

**New cases** (`datasets_sources/new_cases`, `new_cases.md`): 6,000 messages with clean references written by language models under writer personas (`llm:deepseek/deepseek-flash+reviewed-by:pending`), original writing for ChatSOP, no copied text, no personal data (`node tools/datasets/build-new-cases.mjs` checks it). No person has reviewed them (`review_status: reviewed-by:pending` in every row) and they are not yet recorded in `docs/specs/DS014-source-rights.md`; whether their text may live in the tracked `datasets/` is an open owner decision (`questions.md` Q-DATA-1). The source cache itself stays local and untracked (`datasets_sources/`, AGENTS.md rule 10).

The no-copy check applies to the derived rows through `node tools/datasets/no-copy.mjs --files ... --name three-<dataset>` (it reads `message`); the exact-text and 8-gram overlap of train and dev with the sealed sets is `node tools/datasets/audit/three-datasets-overlap.mjs`.

## natural (owner chat messages, 2026-10-01)

`datasets/natural/messages.jsonl` is not inspired by an external source: it holds the project owner's own chat messages to Claude Code in this repository (`tools/eval/collect-natural.mjs`), cleared as owner-authored text (DS014 "Owner chat messages"). Pasted blocks, e-mail addresses, tokens and home paths are replaced by placeholders and mostly-pasted messages are dropped. Role: realism evaluation set and seeds for synthetic rows that change the content words (`tools/datasets/audit/natural-overlap.mjs`).

## proofing (dataset_proofing): derived from formalizer-v1, not from an external source

`datasets_archive/proofing` (experiment `proofing-candidates-v1`, `tools/research/proofing.mjs` and `tools/research/proofing-ro.mjs`) is not inspired by an external corpus: its only source is ChatSOP's own `datasets_archive/formalizer-v1` train and dev messages (own rights, `datasets_archive/formalizer-v1/manifest.json`), read but never modified. Every row pairs a formalizer-v1 message with the text SymbolicLM (Stanza + frozen `lib/ud-to-sop` rules) should be given to parse it correctly:

- **identity rows** (`kind: identity`): the message already parses; the target is the message itself, unmodified.
- **repair rows** (`kind: repair`): the message fails the frozen-rules oracle; the target is the smallest edit that a candidate proofreading model or, for rows no small candidate repairs, Claude Haiku 4.5 (`claude-haiku-4-5-20251001`, oracle-filtered, budget-capped) produced and that both passes the oracle and keeps every meaning check (placeholders, negation, quantifiers, question mark, language, non-answer-like). Rights of each target text follow the model that wrote it, recorded in [DS014](../docs/specs/DS014-source-rights.md) ("Model weights" for the candidates, "LLM-authored text" for the Haiku teacher) and repeated per row in `rights.target`.
- **Romanian rows** (`pipeline: translate`, `tools/research/proofing-ro.mjs`): the owner's target pipeline translates Romanian with SymbolicLM before the small proofreader ever runs, so a Romanian row's `input`/`target` are English: the SymbolicLM translation of the formalizer-v1 message (untouched, or proofread the same way as an English row), never the raw Romanian text. `source_language: ro` and `pipeline: translate` keep these rows distinguishable from the direct-English arm (`pipeline` absent or `direct`).
- **hard cases** (`datasets_archive/proofing/hard_cases.jsonl`): rows nobody repairs, or rows whose only difference from gold is a labelling convention (DS021 boundary/role/relational-noun/assumed choices) that a rewrite must never be taught to game; `target` is `null`.

No row ever copies a QQP/PAWS/ProofWriter/AmbigNQ/QA2D/SQuAD sentence: those sources fed formalizer-v1's generator, three steps upstream of this corpus, and no formalizer-v1 row nor its proofing pair repeats source text (`tools/datasets/no-copy.mjs`, run against formalizer-v1's own build). `tools/datasets/audit/proofing-overlap.mjs` reports proofing's overlap with the sealed formalizer-v1 test, OOD and wild suites.

## clean-english (dataset-forCleanEnglish): a filter over formalizer-v1, not a new source

Owner decision, 2026-09-30 (journaled, `status/journal.jsonl`): formalization evaluation focuses only on **valid, clean English**. Romanian, mixed Romanian/English ("romgleza") and badly written English (typos, garbled or confusing input) leave the formalization evaluation; they are handled by a separate `textToCleanEnglish` chat-UI service under user control (a different task/topic, `text-to-clean-english-v1`). The fine-tuned Gemma3-270M proofreader stays only as a simplifier of already-valid English for SymbolicLM.

`datasets_archive/clean-english` introduces **no new source text**: it is a language-quality filter (`tools/datasets/clean-english.mjs`, built by `tools/datasets/build-clean-english.mjs` for train/dev and `tools/eval/clean-english-suite.mjs` for the sealed test) over rows already generated and rights-cleared as part of `datasets_archive/formalizer-v1` and its three sealed suites (`eval/suites/formalizer-v1`, `eval/suites/formalizer-ood-v1`, `eval/suites/formalizer-wild-v1`). It therefore inherits formalizer-v1's `inspired_by` rights record rather than declaring a new one (`rights.rights_decision: inherited-from-formalizer-v1` in its manifests).

The filter sorts every row into one of four partitions, in this precedence: **mixed** (a `code_switch` tag, or LanguagesUtil's `identify()` calls the unquoted message `mixed`) &gt; **ro** (`language: ro`, not mixed) &gt; **clean_en** (`language: en`, not mixed, and every clean-English gate below passes) &gt; **noisy_en** (`language: en`, not mixed, at least one gate fails). The clean-English gates, all re-checkable from the row's `question` text and metadata alone:

1. **no generator noise** — the row carries no `noise`/`noise_level`/`code_switch` tag from the diversity generator's deliberate typo/code-switch injection (`tools/datasets/diversity/noise.mjs`);
2. **no spelling fix** — `lib/languages-util/spellfix.mjs` `Spellfix.fix()` proposes no correction that is a typo on the message (its own quote-aware, conservative editor; a proposal that only splits a compound, switches British and American spelling or concerns a capitalized name is not a typo);
3. **every token is English** — every word token outside quoted spans, proper names (capitalized tokens) and numbers is labelled `en` by LanguagesUtil's `identify()`, unless the English dictionary also lists it;
4. **not gibberish** — `eval/reference-free.mjs` `gibberishVerdict()` is not `gibberish` (added after a manual spot-check caught a keyboard-mash row, `fv1_019088_0`, slipping through gates 1-3: no Romanian evidence, and the spellchecker's own "mostly unknown" heuristic skips proposing any correction on pure noise);
5. **grammar check** — not implemented: no local grammar checker is installed (no new dependency added without an entry in `dependencies.md`); recorded as a follow-up in `TODO.md`. Its absence never widens or narrows the gate; a row can be `clean_en` on gates 1-4 alone. A short, well-formed English fragment ("she coaches them", "yes") passes: nothing here penalizes length.

**Precision**: three manual spot-checks were read row by row. The first two (seeds `20260930` and `424242`) caught the gibberish false positive above (fixed by adding gate 4). The third (seed `12345`, 60 accepted and 60 rejected rows of the sealed suites, re-run after reading) found all 60 accepted rows to be valid English (one is informal lower-case chat without punctuation, counted valid) and 58 of 60 rejections justified, but showed a systematic over-rejection: 59 clean rows of the sealed suites (2.4%) were rejected only because a Romanian-looking first name ("Mihai", "Mei", "Levente") or an English word that Romanian also lists ("certificate", "merge") tripped gate 3, or because a British spelling ("specialised"), a compound ("lockbox") or a product name tripped gate 2. Deviation D1 (recorded 2026-09-30, before any further scoring) fixed this: gate 3 ignores capitalized tokens and lower-case words that the English dictionary lists; gate 2 ignores proposals that only split a compound, switch between British and American spelling, or concern a capitalized name. The corpus was rebuilt (train 7,966, dev 1,717, sealed test 2,543 rows; the earlier counts were 7,848, 1,694 and 2,484) and the manifests now carry the SHA-256 of every split. Known remaining false rejections are a handful of wild-suite rows with jargon ("config", "repo", "postgres", "licences"). Nothing noisy was found among the accepted rows. Full detail: `status/notes/clean-english.jsonl` (topic `clean-english`).

**Layout**: `datasets_archive/clean-english/{train,dev}.jsonl` (clean_en rows of formalizer-v1 train/dev, split preserved) and the sealed `eval/suites/clean-english/test.jsonl` (clean_en rows of the three sealed suites, each row tagged `suite` and `source_id`, id `"<suite>::<source_id>"`); rows keep their original `world`/`ontology_sop`/`setup_sop` verification scaffolding unchanged. Partition manifests (ids and counts only) for the other three partitions live at `datasets_archive/formalizer-v1/partitions/{noisy_en,ro,mixed}.json` (train/dev) and `eval/reports/current/clean-english/partitions/<suite>.json` (sealed suites), so each can be evaluated separately later. `node tools/datasets/no-copy.mjs --corpus clean-english` passes (0 shared 4/8-grams, being a strict subset of an already-checked corpus).

## Wikidata (base memory world-v1, 2026-10-01)

`tools/world-kb/` builds the base memory `world-v1`, "a small encyclopedia" for chat, mechanically from a subset of **Wikidata** (<https://www.wikidata.org>, structured data **CC0**, evidence in [DS014](../docs/specs/DS014-source-rights.md)). The subset is fetched from the Wikidata Query Service in polite batches (`tools/world-kb/fetch.mjs`, User-Agent `ChatSOP-worldkb/0.1`, one request at a time) into the untracked `datasets_sources/world-kb/raw/`. What was taken: statements and labels (English, Romanian) and English descriptions of about 25,000 selected items (countries, cities, languages, currencies, chemical elements, planets, well-known people, companies, universities, international organizations, notable books, films and paintings) through the 47 mapped properties of `tools/world-kb/MAPPING.md`. What was not taken: Wikipedia article text, other Wikimedia text (CC BY-SA), and any statement outside the mapped properties. Nothing is exported from `datasets_sources/`; the loaded memory is in the gitignored `chat_data/base_memories/world-v1/`.

## Where the source caches live

Raw caches stay in `datasets_sources/<source>/` with a `provenance.json` per source (pinned URL, retrieval date, bytes, SHA-256). They are research inputs for measurement only and are never copied into `datasets/**` or `eval/suites/**`.

## Host dictionary data (not a corpus source)

The host bilingual dictionary `config/dictionary/` (DS021, `sop/dictionary.mjs`) is runtime host data, never model input and never corpus text. Its `wiktionary.tsv` source is a filtered extraction of the Romanian section of **English Wiktionary** via kaikki.org/wiktextract (https://kaikki.org/dictionary/Romanian/kaikki.org-dictionary-Romanian.jsonl, retrieved 2026-09-29), licensed **CC BY-SA 4.0** (and GFDL) with attribution to the English Wiktionary contributors; the file carries that licence and a modification notice. Taken: lemmas, parts of speech, short English gloss candidates and selected Romanian inflected forms. Not taken: definitions beyond 1-3-word gloss candidates, examples, etymologies, pronunciations. The raw dump stays in `datasets_sources/wiktionary-ro/` with its `provenance.json`; rights row in [DS014](../docs/specs/DS014-source-rights.md).

## Row and manifest fields

Rows and manifests record rights through `tools/datasets/rights.mjs`:

- `source.license`: `MIT (repository LICENSE); original ChatSOP authored text`: the licence of the authored text itself.
- `rights.inspired_by[]`: the sources whose structure inspired the row, each with its URL and licence as known.
- `rights.rights_decision: owner-released-inspired-by`, `rights_decision_date: 2026-09-28`, `text_copied: false`.

## translate-jargon-v1 (2026-10-01)

`datasets/bad_english/translate-jargon-v1/` (jargon-aware Romanian/mixed to English pairs for the translator distillation study) is LLM-authored (Grok and GLM write the source messages, DeepSeek flash the targets). OPUS KDE4 v2, GNOME v1, Ubuntu v14.10, EMEA v3 and JRC-Acquis v3.0 (English-Romanian) were read only to count English tokens kept unchanged in the Romanian side per domain; their licences are copyleft, non-commercial or unverified (DS014 "Jargon term sources for translate-jargon-v1"), so no sentence of them is in the dataset. The owner's project jargon and the evaluation set `datasets/natural` are excluded by a blocklist.
