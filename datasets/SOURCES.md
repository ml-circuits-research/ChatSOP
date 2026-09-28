# Sources that inspire the ChatSOP corpora

This file is the single sources README for `datasets/`. It is not case Markdown: corpora stay JSONL-first (AGENTS.md rule 11), and no case, target or row is authored here.

## Decision

On **2026-09-28** the repository owner released the corpora that ChatSOP derives from, and is inspired by, QQP, PAWS, ProofWriter, AmbigNQ, QA2D and SQuAD (`inspired-by-released`): the texts are original, the inspiration is structural (structure, label types, phenomena and statistics feed the diversity generator in `tools/datasets/diversity/`, inventory `datasets/diversity/inventory.json`), and the purpose differs. The decision, its reasons and the per-asset rights evidence are recorded once, in [DS014](../docs/specs/DS014-source-rights.md). Training still requires a separate explicit approval (AGENTS.md rule 3); this release concerns corpus rights only.

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

## Where the source caches live

Raw caches stay in `datasets_sources/<source>/` with a `provenance.json` per source (pinned URL, retrieval date, bytes, SHA-256). They are research inputs for measurement only and are never copied into `datasets/**` or `eval/suites/**`.

## Row and manifest fields

Rows and manifests record rights through `tools/datasets/rights.mjs`:

- `source.license`: `MIT (repository LICENSE); original ChatSOP authored text`: the licence of the authored text itself.
- `rights.inspired_by[]`: the sources whose structure inspired the row, each with its URL and licence as known.
- `rights.rights_decision: owner-released-inspired-by`, `rights_decision_date: 2026-09-28`, `text_copied: false`.
