> ARCHIVED 2026-09-28 — extracted from DS018-source-rights; superseded by the current source-rights spec (DS014-source-rights since the renumbering of 2026-09-28) and the owner's inspired-by release. Historical register, not a current contract.

# DS018 dated acquisition sections (historical)

## Research-mode acquisition and structure-only use (2026-09-28)

The user authorized acquiring research corpora for this experiment on 2026-09-28; this does **not** authorize model training. PAWS-Wiki's downloaded [`LICENSE`](../../datasets_sources/paws/LICENSE) says the dataset may be freely used for any purpose and requests acknowledgement of **Google LLC** as the data source. Its underlying sentences derive from Wikipedia; preserve applicable Wikipedia attribution, licence, and ShareAlike duties for any use of the text. We cache only the human-labeled, Wikipedia-derived PAWS-Wiki validation split for **aggregate structural study**, never PAWS-QQP or QQP-derived data, and never export a PAWS source row, passage, answer, or close rewrite into `datasets/**` or `eval/suites/**`. No PAWS rows were authored as a result of this acquisition.

The upstream PAWS-Wiki archive linked in its README returned HTTP 403 on 2026-09-28. Instead, the pinned Google Research datasets [Hugging Face PAWS mirror](https://huggingface.co/datasets/google-research-datasets/paws) supplied the labeled-final Wikipedia validation Parquet. [`datasets_sources/paws/provenance.json`](../../datasets_sources/paws/provenance.json) records exact pinned URLs, retrieval dates, byte sizes, hashes, source-only licensing and the lossless JSONL conversion; raw/converted pairs remain in the restricted research cache. Reproduce only aggregate counts with `node tools/datasets/analyze-paws.mjs`; its output is [`eval/reports/current/rights/paws-structure.json`](../../eval/reports/current/rights/paws-structure.json). The report contains no source text, ids, pairs or answers. Pattern detections are non-exclusive lexical heuristics, not validated semantic labels.

Design adaptation remains **inspired-by only** for the quarantined QA2D data, ProofWriter, QQP and AmbigQA: their public papers/READMEs may inform original authoring, but none of their rows, passages or answers may be copied, translated, or lightly edited into any project corpus. Never download/copy their data. Keep the source case's domain and distinctive structural behavior when authoring a genuinely new case; do not narrow diverse upstream topics to a single convenient domain. The existing SQuAD v2.0 CC BY-SA 4.0 attribution/modification/ShareAlike duties are unchanged, and SQuAD use remains confined to the existing sealed test-only derivative.

The pinned PAWS-Wiki sample has **8,000** pairs (4,461 non-paraphrases; 3,539 paraphrases). The following *source-domain proxies* come from generic, fixed English keyword buckets over both sentences, not human topical review; primary buckets are exclusive with fixed-order tie-breaking. Unclassified pairs (**4,703**) lack any cue, so these figures must not be treated as a precise topical census. No target-domain coverage was authored here: this acquisition yields only source-manner statistics, not achieved corpus-domain counts.

| Primary source-domain proxy | Pairs |
| --- | ---: |
| Geography and places | 995 |
| Physical and earth sciences | 44 |
| Life sciences and health | 192 |
| History and society | 170 |
| Arts, books and language | 581 |
| Sports and leisure | 260 |
| Travel and transport | 184 |
| Commerce and services | 161 |
| Education and research | 229 |
| Agriculture and food | 19 |
| Weather and climate | 13 |
| Technology and infrastructure | 101 |
| Law and administration | 148 |
| Everyday household life | 200 |
| Unclassified by these cues | 4,703 |

## Expanded research-only source acquisition and measured design inventory (2026-09-28)

The owner/operator **explicitly authorized acquiring** ProofWriter, QA2D/QANLI, QQP and AmbigQA for this experiment, even when their rights do not permit inclusion in a corpus. This authorization supersedes the earlier research-mode paragraph's instruction not to download these four datasets **only for the quarantined `datasets_sources/**` research cache**; it does not clear any data for export, publication, training, fine-tuning or neural inference. The user also explicitly authorized using their measured themes and shapes as *inspiration for our own separate thinking and authored cases at scale*, not making derivatives of their rows. No source row, passage, question or answer may be copied, translated, lightly edited, or redistributed into `datasets/**`, `eval/suites/**`, or any published artifact. This includes PAWS and applies regardless of a licence's apparent permissiveness. Source rows stay in this local research cache; the report contains aggregate statistics only.

The acquisitions below were made without credentials. Each source's linked `provenance.json` records a pinned or publisher URL, retrieval date, exact byte count and SHA-256 for every newly acquired/converted file, plus failed licence lookups; the previously cached ProofWriter README has an explicitly unknown retrieval date rather than an invented one. The small analysis splits were selected from their published distributions; converted JSONL retains all selected Parquet rows and fields, solely to make `node tools/datasets/analyze-sources.mjs` independently runnable without a Parquet dependency. **The derived JSONL is also source material, not corpus material.**

| Source | Obtained source-only assets | Licence/terms finding |
| --- | --- | --- |
| [QA2D](../../datasets_sources/qa2d/provenance.json) | Pinned Hugging Face dev Parquet (1,870,199 bytes) and lossless JSONL; original QANLI code `LICENSE` and mirror card | Mirror dataset-specific `LICENSE` returned **HTTP 404**; its card says licensing information `[Needs More Information]`, despite `mit` metadata. Original MIT grant says software; it cannot clear mixed SQuAD/RACE/NewsQA/QAMR/MovieQA material. Data remains quarantined. |
| [ProofWriter](../../datasets_sources/proofwriter-structured/provenance.json) | Pinned structured OWA validation Parquet (2,946,801 bytes), lossless JSONL and mirror card | Mirror dataset-specific `LICENSE` returned **HTTP 404**. Official release ZIP was previously inspected and had no `LICENSE`/`NOTICE`, and its README made no dataset grant; the claim that it has no published primary licence was rechecked, not converted into a grant. Quarantined. |
| [QQP](../../datasets_sources/qqp/provenance.json) | Pinned GLUE QQP validation Parquet (3,729,274 bytes), lossless JSONL and a **mirror-authored** release-terms summary | Quora first-party page and Kaggle page returned only crawler/client metadata in this inspection, **not an accessible primary standalone licence grant**. Mirror summary is secondary and cannot license Quora questions. Retain restricted research/non-commercial treatment; no unmodified or modified source-row redistribution. |
| [AmbigNQ](../../datasets_sources/ambignq/provenance.json) | Publisher's light ZIP (1,061,383 bytes), extracted smallest dev split and bundled `LICENSE`, and publisher README | GitHub top-level `LICENSE` returned **HTTP 404**, but the **publisher's release ZIP actually includes a CC BY-SA 3.0 licence notice**, correcting the earlier statement that no project licence was available. Underlying Natural Questions and Wikipedia rights still require separate review before any redistribution. |

The deterministic [theme and shape inventory](../../eval/reports/current/rights/source-themes.json) is regenerated with `node tools/datasets/analyze-sources.mjs`; it also includes the already cached PAWS-Wiki validation. Sizes below are mean Unicode word-token counts; source themes are **lexical proxies, not topic annotations**, and `unclassified` means no fixed cue matched. Cue definitions, full exclusive/multilabel topic buckets, question types, length bands and contrast counts are in the JSON report. The PAWS thematic numbers differ from the older PAWS-specific report because the two analyzers have different fixed lexicons.

| Sample | Rows | Mean principal text length (tokens) | Theme examples from primary buckets; unclassified | Question types / observed shapes |
| --- | ---: | ---: | --- | --- |
| PAWS-Wiki validation | 8,000 pairs | 18.63 / 18.61 | geography 887, arts/books/language 554; unclassified 4,970 | Equal-token-multiset/different-order pairs 780; negation/quantifier/temporal/comparison cue changes 7/53/142/10. |
| QA2D dev | 10,344 triples | question 9.88; declarative 11.84 | geography 596, history/society 459; unclassified 7,144 | What 4,835; which 533; who 1,148; how-many 447; yes/no-initial 4; other question 3,351; statement 26. Question-to-declarative negation/quantifier/temporal/comparison cue changes 160/738/542/153 (lexical, not semantic equivalence). |
| ProofWriter structured OWA validation | 6,128 theories; 50,844 question statements | theory 80.46; statement 4.56 | All 6,128 unclassified by real-world topic cues; this is synthetic entity/rule language, not an absence of topic diversity in the other sources | 29,612 rules: body size one 15,529, two 14,083. Status True/False/Unknown 13,831/13,831/23,182; derivation-depth `qdep` 0/1/2/3/4/5/6 = 26,569/13,549/5,704/2,900/1,101/1,006/15. Formal atom polarity +/−/~ = 113,783/7,942/3,193; 2,928 reversed-order fact pairs. |
| GLUE QQP validation | 40,430 pairs | 11.03 / 11.26 | commerce/services 2,160, arts/books/language 2,058; unclassified 28,984 | Both question fields: what 27,681; which 3,412; who 1,550; how-many 601; yes/no-initial 12,606. Pair labels different/same 25,545/14,885; order-permutation 66; negation/quantifier/temporal/comparison cue changes 2,712/6,408/2,433/3,853. |
| AmbigNQ light dev | 2,002 source questions | original 9.06; disambiguated 12.49 | arts/books/language 176, sports/leisure 70; unclassified 1,441 | 1,776 single-answer and 1,536 multiple-QA annotations (annotations can be multiple per source question), yielding 4,856 disambiguated questions; annotation counts per source question one/two/three = 787/1,120/95. |

The lexical cue counts are **not** claims of logical contrast or exact human topic coverage. For ProofWriter, the report also records dependency-chain node counts as `qdep + 1` (one fact-only node at `qdep=0`) and its separate leaf-count distribution; these are not interchangeable measures. ProofWriter's `~` is a formal polarity marker; do not equate its count with natural-language negation. The approved output is a separately authored corpus inspired by aggregate theme and shape patterns, never a rewrite of a cached row. There was no training/fine-tuning/neural inference.

## Larger source-only splits (2026-09-28)

The same pinned public mirrors supplied the larger labeled splits below without credentials; AmbigNQ's full release came from its publisher. Each file stays in `datasets_sources/**` only; paths, retrieval URLs, byte sizes, SHA-256 values, conversion method, existing licence/terms evidence and absent/secondary licence caveats are also recorded in the corresponding `provenance.json`. DuckDB 1.5.5 produced lossless, all-field JSONL from the five Parquet assets; the two full AmbigNQ JSON files were extracted without modification. Neither this acquisition nor the inventory is permission to train, fine-tune, infer with neural models, redistribute source material, or export source rows.

| Source-only newly obtained asset (relative to `datasets_sources/`) | Bytes | SHA-256 |
| --- | ---: | --- |
| `qa2d/train-00000-of-00001.parquet` | 11,261,693 | `3fce9846e4ad2a409b548b39e5e333be34211452b066cd6bdaf7fd942e06fcad` |
| `qa2d/train.jsonl` | 20,812,345 | `c3df0ab4e93e449040f791173f847ed36a317652050e298eca426b7a26604060` |
| `qqp/train-00000-of-00001.parquet` | 33,558,839 | `4d6f02e643f7c36e9a4f7d4971a5ee9bd74063a319452fe6c87850c739774cd7` |
| `qqp/train.jsonl` | 63,622,331 | `3ba8832b030dfd7e7434a324dfca7143b102d01fe8fed4cb16e9068226d36b91` |
| `paws/train-00000-of-00001.parquet` | 8,433,884 | `8dc9ad3e5f30ad9a86b290fe236d528ef23a5751fec9a35d99cbacf68ba277cf` |
| `paws/train.jsonl` | 13,859,065 | `0ddd71a1c02c68749dbeffbfc366a6a473ea1a729daa16488360f2832b92fa97` |
| `proofwriter-structured/OWA-train.parquet` | 20,160,010 | `9ce14cff096d7c025adb59ef8d6b8080a9fac1a55dc422537f0f36995bb2c87d` |
| `proofwriter-structured/OWA-train.jsonl` | 281,944,425 | `b76835ac9ad2ec3ae333b96a2589c2ee9fa6b7e0833de25f93674915a7017302` |
| `proofwriter-structured/OWA-test.parquet` | 5,898,435 | `03305265ef072de219cb10718366d652734bcd0e5ca615c22d3f6d726246475c` |
| `proofwriter-structured/OWA-test.jsonl` | 84,425,740 | `6cbc3fd4f49592bde2ed78eb8ede2c09aa9b6d6c4b3d8f1d8f99dee3a7d26a11` |
| `ambignq/ambignq.zip` | 18,639,517 | `e85cec5909f076c6f584322c7f05cae44dcacaec93758c110a26fcceaa8da0ce` |
| `ambignq/train.json` | 48,297,111 | `2b525259f3da64905f01eb0df799876d748ab3552f04abc37adf5c9a003ed84e` |
| `ambignq/dev.json` | 16,973,947 | `c065798f12ebff109dcfe10bd25fb096f7c52d66e56a6acfc0c34093572e4b90` |

No requested larger split failed to download. QQP/PAWS test splits, ProofWriter CWA variants and AmbigNQ's separate evidence-article archive were not obtained because they are outside this labeled-train/full-OWA/full-AmbigNQ question-pool request, not because of a failed fetch. The earlier documented QA2D dataset-specific `LICENSE` and ProofWriter mirror `LICENSE` lookups returned HTTP 404; the inspected ProofWriter official archive lacks `LICENSE`/`NOTICE`; QQP's first-party page exposed no accessible standalone grant and its cached terms are *secondary*. AmbigNQ's publisher ZIP contains a CC BY-SA 3.0 notice, but the previously inspected GitHub top-level `LICENSE` returned HTTP 404 and underlying NQ/Wikipedia duties remain. The previously documented official PAWS-Wiki tarball returned HTTP 403; the pinned Google Research mirror supplied the Wikipedia-only train split instead. Those unresolved rights are not silently cleared by the bigger cache.

| Source | Disjoint split counts | Total source rows | Headline measured distributions across disjoint splits |
| --- | --- | ---: | --- |
| QA2D | dev 10,344; train 60,710 | 71,054 | Question types what 31,616, other question 25,160, who 7,160; lexical topic unclassified 47,487, geography 4,565, history/society 3,370; quantifier-cue changes 5,247. One train answer is null; its answer length is omitted and `missing_text_fields` counts it. |
| ProofWriter structured OWA | validation 6,128; train 42,365; test 12,143 | 60,636 theories | 500,090 statements: True 136,215, False 136,215, Unknown 227,660; `qdep` 0/1/2/3/4/5/6/7/8: 261,084/134,054/55,603/28,134/11,144/9,947/107/16/1. All real-world lexical topics unclassified (synthetic formal vocabulary). |
| GLUE QQP | validation 40,430; train 363,846 | 404,276 pairs | Different/same 255,013/149,263; lexical topic unclassified 290,202, arts/books/language 21,943, commerce/services 21,789; token-order permutation 656, negation/quantifier/temporal/comparison cue changes 27,089/64,053/23,833/39,152. |
| PAWS-Wiki labeled-final | validation 8,000; train 49,401 | 57,401 pairs | Different/same 32,033/25,368; lexical topic unclassified 34,535, geography 6,059, arts/books/language 4,060; token-order permutation 5,817, negation/quantifier/temporal/comparison cue changes 74/505/1,027/236. |
| AmbigNQ full | train 10,036; dev 2,002 | 12,038 unique questions | Single-answer annotations 7,235; multiple-QA annotations 6,328; lexical topic unclassified 8,656, arts/books/language 1,089, sports/leisure 382. The previously cached light dev has precisely the same 2,002 IDs and identical light fields as full dev and is measured separately but **not added** to the unique total. |

`node tools/datasets/analyze-sources.mjs` verifies all cached source file hashes, then regenerates [`source-themes.json`](../../eval/reports/current/rights/source-themes.json) with per-split text-length bands/means, question-type buckets, lexical topic proxies, structural contrasts and applicable labels, statuses, derivation depths or annotation shapes. QQP question-type counts include *both* questions, and AmbigNQ counts include original plus disambiguated questions; they are not mutually exclusive row totals. The bigger pool exists solely to ground more **separately authored counterparts**, never copied, translated or lightly edited upstream cases.
