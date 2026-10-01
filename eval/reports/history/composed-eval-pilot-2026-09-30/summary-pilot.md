# Composed evaluation: summary

Generated 2026-09-30T17:14:47.774Z by `node tools/eval/composed-report.mjs` from the run summaries of `tools/eval/composed-score.mjs` (preregistration `status/preregistrations/eval-composed-v1.json`). No training; the rewriter is an existing checkpoint measured as a baseline. Suites: symbolic_english 784 rows (sha256 abf85afc8724, built 2026-09-30T16:36:12.581Z); neuro_english 336 rows (sha256 4603a5460a5d, built 2026-09-30T16:36:12.598Z); bad_english 328 rows (sha256 2bc121137bfa, built 2026-09-30T16:36:12.611Z).

## 1. SymbolicLM alone on composed paragraphs (K1, K3, K5)

Each paragraph is analysed as one message; each component alone is the control. `paragraph = concatenation` compares the SOP with the concatenated stored SOPs (ids renumbered, statements before queries). The **composition effect** restricts to cases whose components all pass alone, so a loss there is a cross-sentence effect. `sentences as alone` means every sentence keeps its tokens, heads and labels and no sentence is cut or merged. `handled` is a valid conversion with nothing unparsed and no uncertainty flag on the paragraph.

### K1 (400 cases)

| sentences | paragraph = concatenation | composition effect (components all pass alone) | sentences as alone | sentence split as alone | components alone pass | paragraph handled |
| --- | --- | --- | --- | --- | --- | --- |
| n2 | 92% [85, 95.9] 92/100 | 93.9% [87.3, 97.2] 92/98 | 96% [90.2, 98.4] 96/100 | 98% [93, 99.4] 98/100 | 98% [93, 99.4] 98/100 | 98% [93, 99.4] 98/100 |
| n3 | 93% [86.3, 96.6] 93/100 | 96.9% [91.2, 98.9] 93/96 | 97% [91.5, 99] 97/100 | 98% [93, 99.4] 98/100 | 96% [90.2, 98.4] 96/100 | 99% [94.6, 99.8] 99/100 |
| n5 | 76% [66.8, 83.3] 76/100 | 82.6% [73.6, 89] 76/92 | 88% [80.2, 93] 88/100 | 93% [86.3, 96.6] 93/100 | 92% [85, 95.9] 92/100 | 94% [87.5, 97.2] 94/100 |
| n8 | 67% [57.3, 75.4] 67/100 | 77.9% [68.1, 85.4] 67/86 | 82% [73.3, 88.3] 82/100 | 93% [86.3, 96.6] 93/100 | 86% [77.9, 91.5] 86/100 | 89% [81.4, 93.7] 89/100 |
| all | 82% [77.9, 85.5] 328/400 | 88.2% [84.5, 91.1] 328/372 | 90.8% [87.5, 93.2] 363/400 | 95.5% [93, 97.1] 382/400 | 93% [90.1, 95.1] 372/400 | 95% [92.4, 96.7] 380/400 |

Per component: right in the paragraph 92.2% [90.8, 93.3] 1659/1800; right alone 98.4% [97.7, 98.9] 1771/1800. Causes of a loss: {}.

### K3 (282 cases)

| sentences | paragraph = concatenation | composition effect (components all pass alone) | sentences as alone | sentence split as alone | components alone pass | paragraph handled |
| --- | --- | --- | --- | --- | --- | --- |
| n12 | 41.7% [30.1, 54.3] 25/60 | 51% [37.5, 64.4] 25/49 | 71.7% [59.2, 81.5] 43/60 | 88.3% [77.8, 94.2] 53/60 | 81.7% [70.1, 89.4] 49/60 | 83.3% [72, 90.7] 50/60 |
| n16 | 28.3% [18.5, 40.8] 17/60 | 35.4% [23.4, 49.6] 17/48 | 68.3% [55.8, 78.7] 41/60 | 86.7% [75.8, 93.1] 52/60 | 80% [68.2, 88.2] 48/60 | 76.7% [64.6, 85.6] 46/60 |
| n24 | 18.3% [10.6, 29.9] 11/60 | 28.2% [16.5, 43.8] 11/39 | 45% [33.1, 57.5] 27/60 | 68.3% [55.8, 78.7] 41/60 | 65% [52.4, 75.8] 39/60 | 71.7% [59.2, 81.5] 43/60 |
| n32 | 7.5% [2.6, 19.9] 3/40 | 14.3% [5, 34.6] 3/21 | 42.5% [28.5, 57.8] 17/40 | 65% [49.5, 77.9] 26/40 | 52.5% [37.5, 67.1] 21/40 | 65% [49.5, 77.9] 26/40 |
| n48 | 0% [0, 11.4] 0/30 | 0% [0, 22.8] 0/13 | 13.3% [5.3, 29.7] 4/30 | 36.7% [21.9, 54.5] 11/30 | 43.3% [27.4, 60.8] 13/30 | 46.7% [30.2, 63.9] 14/30 |
| single | 84.4% [68.2, 93.1] 27/32 | 100% [87.5, 100] 27/27 | 100% [89.3, 100] 32/32 | 100% [89.3, 100] 32/32 | 84.4% [68.2, 93.1] 27/32 | 100% [89.3, 100] 32/32 |
| all | 29.4% [24.4, 35] 83/282 | 42.1% [35.5, 49.1] 83/197 | 58.2% [52.3, 63.8] 164/282 | 76.2% [70.9, 80.8] 215/282 | 69.9% [64.3, 74.9] 197/282 | 74.8% [69.4, 79.5] 211/282 |

Per component: right in the paragraph 57.1% [55.9, 58.4] 3355/5872; right alone 98.2% [97.8, 98.5] 5767/5872. Causes of a loss: {}.

### K5 (102 cases)

| sentences | paragraph = concatenation | composition effect (components all pass alone) | sentences as alone | sentence split as alone | components alone pass | paragraph handled |
| --- | --- | --- | --- | --- | --- | --- |
| n2 | 88.2% [73.4, 95.3] 30/34 | n/a | 100% [89.8, 100] 34/34 | 100% [89.8, 100] 34/34 | 0% [0, 10.2] 0/34 | 100% [89.8, 100] 34/34 |
| n3 | 58.8% [42.2, 73.6] 20/34 | n/a | 94.1% [80.9, 98.4] 32/34 | 97.1% [85.1, 99.5] 33/34 | 0% [0, 10.2] 0/34 | 73.5% [56.9, 85.4] 25/34 |
| n4 | 47.1% [31.5, 63.3] 16/34 | n/a | 88.2% [73.4, 95.3] 30/34 | 94.1% [80.9, 98.4] 32/34 | 0% [0, 10.2] 0/34 | 58.8% [42.2, 73.6] 20/34 |
| all | 64.7% [55.1, 73.3] 66/102 | n/a | 94.1% [87.8, 97.3] 96/102 | 97.1% [91.7, 99] 99/102 | 0% [0, 3.6] 0/102 | 77.5% [68.4, 84.5] 79/102 |

Per component: right in the paragraph 72.5% [67.3, 77.2] 222/306; right alone 66% [60.5, 71.1] 202/306. Causes of a loss: {}.

## 2. A rewriter on composed paragraphs (baseline: the existing Gemma 3 270M proofreader, not trained for this)

Whole paragraph: the rewriter gets the text. Per sentence: the host splits, a gate keeps the sentences that are fine (SymbolicLM handles them alone; for K4 the clean-English gate), the rewriter gets only the others. "no rewrite" is the identity rewriter: SymbolicLM on the original paragraph.

| rewriter | kind | mode | cases | clean sentences changed | bad fixed | bad untouched | bad wrong | dropped | added text | exact cases | end-to-end SOP | splitter agrees |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemma3-270m-proofreader-v1 | K2 | paragraph | 306 | 1.9% (19/986) | 11.4% (66/578) | 67.5% (390/578) | 20.8% (120/578) | 0.5% (8/1564) | 1.6% (5/306) | 7.2% (22/306) | 1.6% (5/306) | 61.4% (188/306) |
| gemma3-270m-proofreader-v1 | K2 | sentence | 306 | 0.1% (1/986) | 4.8% (28/578) | 91.2% (527/578) | 4% (23/578) | 0.1% (1/1564) | 0% (0/306) | 2% (6/306) | 1% (3/306) | 61.4% (188/306) |
| gemma3-270m-proofreader-v1 | K3 | paragraph | 100 | 3.8% (85/2212) | n/a | n/a | n/a | 3.1% (69/2212) | 3% (3/100) | 61% (61/100) | 32% (32/100) | 100% (100/100) |
| gemma3-270m-proofreader-v1 | K3 | sentence | 100 | 0% (0/2212) | n/a | n/a | n/a | 0% (0/2212) | 0% (0/100) | 100% (100/100) | 28% (28/100) | 100% (100/100) |
| gemma3-270m-proofreader-v1 | K4 | paragraph | 306 | 2.1% (21/986) | 30.8% (178/578) | 33.4% (193/578) | 34.6% (200/578) | 1.3% (21/1564) | 13.7% (42/306) | 19% (58/306) | n/a | 80.1% (245/306) |
| gemma3-270m-proofreader-v1 | K4 | sentence | 306 | 0% (0/986) | 12.6% (73/578) | 65.9% (381/578) | 20.9% (121/578) | 0.4% (6/1564) | 8.5% (26/306) | 7.5% (23/306) | n/a | 80.1% (245/306) |
| gemma3-270m-proofreader-v1 | K5 | paragraph | 102 | 0.7% (2/306) | n/a | n/a | n/a | 0% (0/306) | 0% (0/102) | 98% (100/102) | 64.7% (66/102) | 100% (102/102) |
| gemma3-270m-proofreader-v1 | K5 | sentence | 102 | 0% (0/306) | n/a | n/a | n/a | 0% (0/306) | 0% (0/102) | 100% (102/102) | 64.7% (66/102) | 100% (102/102) |
| no-rewrite | K2 | paragraph | 306 | 0% (0/986) | 0% (0/578) | 100% (578/578) | 0% (0/578) | 0% (0/1564) | 0% (0/306) | 0% (0/306) | 1% (3/306) | 61.4% (188/306) |
| no-rewrite | K5 | paragraph | 102 | 0% (0/306) | n/a | n/a | n/a | 0% (0/306) | 0% (0/102) | 100% (102/102) | 64.7% (66/102) | 100% (102/102) |

### Per-sentence mode: gate and splitter

| rewriter | kind | gate recall (sentences that need a rewrite and were sent) | clean sentences sent | rewriter calls per sentence | splitter agrees, all components punctuated | splitter agrees, an unpunctuated component |
| --- | --- | --- | --- | --- | --- | --- |
| gemma3-270m-proofreader-v1 | K2 | 36.2% (209/578) | 0% (0/986) | 22.7% (345/1517) | 100% (164/164) | 16.9% (24/142) |
| gemma3-270m-proofreader-v1 | K3 | n/a | 0% (0/2212) | 0% (0/2212) | 100% (100/100) | n/a |
| gemma3-270m-proofreader-v1 | K4 | n/a | n/a | 16.3% (263/1610) | n/a | n/a |
| gemma3-270m-proofreader-v1 | K5 | n/a | 0% (0/306) | 0% (0/306) | 100% (102/102) | n/a |

### By number of sentences (whole paragraph, exact cases and clean sentences untouched)

| rewriter | kind | mode | stratum | exact cases | cases without a broken clean sentence |
| --- | --- | --- | --- | --- | --- |
| gemma3-270m-proofreader-v1 | K2 | paragraph | n2m1 | 20.6% (7/34) | 97.1% (33/34) |
| gemma3-270m-proofreader-v1 | K2 | paragraph | n3m1 | 14.7% (5/34) | 94.1% (32/34) |
| gemma3-270m-proofreader-v1 | K2 | paragraph | n4m1 | 14.7% (5/34) | 94.1% (32/34) |
| gemma3-270m-proofreader-v1 | K2 | paragraph | n4m2 | 0% (0/34) | 97.1% (33/34) |
| gemma3-270m-proofreader-v1 | K2 | paragraph | n5m1 | 14.7% (5/34) | 88.2% (30/34) |
| gemma3-270m-proofreader-v1 | K2 | paragraph | n6m2 | 0% (0/34) | 94.1% (32/34) |
| gemma3-270m-proofreader-v1 | K2 | paragraph | n6m3 | 0% (0/34) | 100% (34/34) |
| gemma3-270m-proofreader-v1 | K2 | paragraph | n8m2 | 0% (0/34) | 82.4% (28/34) |
| gemma3-270m-proofreader-v1 | K2 | paragraph | n8m4 | 0% (0/34) | 97.1% (33/34) |
| gemma3-270m-proofreader-v1 | K2 | sentence | n2m1 | 8.8% (3/34) | 97.1% (33/34) |
| gemma3-270m-proofreader-v1 | K2 | sentence | n3m1 | 2.9% (1/34) | 100% (34/34) |
| gemma3-270m-proofreader-v1 | K2 | sentence | n4m1 | 2.9% (1/34) | 100% (34/34) |
| gemma3-270m-proofreader-v1 | K2 | sentence | n4m2 | 0% (0/34) | 100% (34/34) |
| gemma3-270m-proofreader-v1 | K2 | sentence | n5m1 | 2.9% (1/34) | 100% (34/34) |
| gemma3-270m-proofreader-v1 | K2 | sentence | n6m2 | 0% (0/34) | 100% (34/34) |
| gemma3-270m-proofreader-v1 | K2 | sentence | n6m3 | 0% (0/34) | 100% (34/34) |
| gemma3-270m-proofreader-v1 | K2 | sentence | n8m2 | 0% (0/34) | 100% (34/34) |
| gemma3-270m-proofreader-v1 | K2 | sentence | n8m4 | 0% (0/34) | 100% (34/34) |
| gemma3-270m-proofreader-v1 | K3 | paragraph | n12 | 82.4% (14/17) | 82.4% (14/17) |
| gemma3-270m-proofreader-v1 | K3 | paragraph | n16 | 82.4% (14/17) | 82.4% (14/17) |
| gemma3-270m-proofreader-v1 | K3 | paragraph | n24 | 52.9% (9/17) | 52.9% (9/17) |
| gemma3-270m-proofreader-v1 | K3 | paragraph | n32 | 41.2% (7/17) | 41.2% (7/17) |
| gemma3-270m-proofreader-v1 | K3 | paragraph | n48 | 6.3% (1/16) | 25% (4/16) |
| gemma3-270m-proofreader-v1 | K3 | paragraph | single | 100% (16/16) | 100% (16/16) |
| gemma3-270m-proofreader-v1 | K3 | sentence | n12 | 100% (17/17) | 100% (17/17) |
| gemma3-270m-proofreader-v1 | K3 | sentence | n16 | 100% (17/17) | 100% (17/17) |
| gemma3-270m-proofreader-v1 | K3 | sentence | n24 | 100% (17/17) | 100% (17/17) |
| gemma3-270m-proofreader-v1 | K3 | sentence | n32 | 100% (17/17) | 100% (17/17) |
| gemma3-270m-proofreader-v1 | K3 | sentence | n48 | 100% (16/16) | 100% (16/16) |
| gemma3-270m-proofreader-v1 | K3 | sentence | single | 100% (16/16) | 100% (16/16) |
| gemma3-270m-proofreader-v1 | K4 | paragraph | n2m1 | 35.3% (12/34) | 97.1% (33/34) |
| gemma3-270m-proofreader-v1 | K4 | paragraph | n3m1 | 26.5% (9/34) | 91.2% (31/34) |
| gemma3-270m-proofreader-v1 | K4 | paragraph | n4m1 | 35.3% (12/34) | 94.1% (32/34) |
| gemma3-270m-proofreader-v1 | K4 | paragraph | n4m2 | 14.7% (5/34) | 97.1% (33/34) |
| gemma3-270m-proofreader-v1 | K4 | paragraph | n5m1 | 35.3% (12/34) | 85.3% (29/34) |
| gemma3-270m-proofreader-v1 | K4 | paragraph | n6m2 | 11.8% (4/34) | 94.1% (32/34) |
| gemma3-270m-proofreader-v1 | K4 | paragraph | n6m3 | 0% (0/34) | 97.1% (33/34) |
| gemma3-270m-proofreader-v1 | K4 | paragraph | n8m2 | 11.8% (4/34) | 94.1% (32/34) |
| gemma3-270m-proofreader-v1 | K4 | paragraph | n8m4 | 0% (0/34) | 91.2% (31/34) |
| gemma3-270m-proofreader-v1 | K4 | sentence | n2m1 | 29.4% (10/34) | 100% (34/34) |
| gemma3-270m-proofreader-v1 | K4 | sentence | n3m1 | 20.6% (7/34) | 100% (34/34) |
| gemma3-270m-proofreader-v1 | K4 | sentence | n4m1 | 5.9% (2/34) | 100% (34/34) |
| gemma3-270m-proofreader-v1 | K4 | sentence | n4m2 | 0% (0/34) | 100% (34/34) |
| gemma3-270m-proofreader-v1 | K4 | sentence | n5m1 | 5.9% (2/34) | 100% (34/34) |
| gemma3-270m-proofreader-v1 | K4 | sentence | n6m2 | 2.9% (1/34) | 100% (34/34) |
| gemma3-270m-proofreader-v1 | K4 | sentence | n6m3 | 0% (0/34) | 100% (34/34) |
| gemma3-270m-proofreader-v1 | K4 | sentence | n8m2 | 2.9% (1/34) | 100% (34/34) |
| gemma3-270m-proofreader-v1 | K4 | sentence | n8m4 | 0% (0/34) | 100% (34/34) |
| gemma3-270m-proofreader-v1 | K5 | paragraph | n2 | 97.1% (33/34) | 97.1% (33/34) |
| gemma3-270m-proofreader-v1 | K5 | paragraph | n3 | 97.1% (33/34) | 97.1% (33/34) |
| gemma3-270m-proofreader-v1 | K5 | paragraph | n4 | 100% (34/34) | 100% (34/34) |
| gemma3-270m-proofreader-v1 | K5 | sentence | n2 | 100% (34/34) | 100% (34/34) |
| gemma3-270m-proofreader-v1 | K5 | sentence | n3 | 100% (34/34) | 100% (34/34) |
| gemma3-270m-proofreader-v1 | K5 | sentence | n4 | 100% (34/34) | 100% (34/34) |
| no-rewrite | K2 | paragraph | n2m1 | 0% (0/34) | 100% (34/34) |
| no-rewrite | K2 | paragraph | n3m1 | 0% (0/34) | 100% (34/34) |
| no-rewrite | K2 | paragraph | n4m1 | 0% (0/34) | 100% (34/34) |
| no-rewrite | K2 | paragraph | n4m2 | 0% (0/34) | 100% (34/34) |
| no-rewrite | K2 | paragraph | n5m1 | 0% (0/34) | 100% (34/34) |
| no-rewrite | K2 | paragraph | n6m2 | 0% (0/34) | 100% (34/34) |
| no-rewrite | K2 | paragraph | n6m3 | 0% (0/34) | 100% (34/34) |
| no-rewrite | K2 | paragraph | n8m2 | 0% (0/34) | 100% (34/34) |
| no-rewrite | K2 | paragraph | n8m4 | 0% (0/34) | 100% (34/34) |
| no-rewrite | K5 | paragraph | n2 | 100% (34/34) | 100% (34/34) |
| no-rewrite | K5 | paragraph | n3 | 100% (34/34) | 100% (34/34) |
| no-rewrite | K5 | paragraph | n4 | 100% (34/34) | 100% (34/34) |

### By token length (whole paragraph; Gemma 3 270M tokens, training-style length)

| rewriter | kind | length | cases | exact cases | clean sentences changed |
| --- | --- | --- | --- | --- | --- |
| gemma3-270m-proofreader-v1 | K2 | within training p99 (<= 87 tokens) | 46 | 19.6% (9/46) | 4.6% (3/65) |
| gemma3-270m-proofreader-v1 | K2 | beyond training p99 | 260 | 5% (13/260) | 1.7% (16/921) |
| gemma3-270m-proofreader-v1 | K3 | within training p99 (<= 87 tokens) | 12 | 100% (12/12) | 0% (0/12) |
| gemma3-270m-proofreader-v1 | K3 | beyond training p99 | 38 | 84.2% (32/38) | 1.7% (8/480) |
| gemma3-270m-proofreader-v1 | K3 | beyond the longest training example (> 547 tokens) | 50 | 34% (17/50) | 4.5% (77/1720) |
| gemma3-270m-proofreader-v1 | K4 | within training p99 (<= 87 tokens) | 50 | 30% (15/50) | 2.7% (2/74) |
| gemma3-270m-proofreader-v1 | K4 | beyond training p99 | 256 | 16.8% (43/256) | 2.1% (19/912) |
| gemma3-270m-proofreader-v1 | K5 | within training p99 (<= 87 tokens) | 59 | 96.6% (57/59) | 1.4% (2/145) |
| gemma3-270m-proofreader-v1 | K5 | beyond training p99 | 43 | 100% (43/43) | 0% (0/161) |
| no-rewrite | K2 | within training p99 (<= 87 tokens) | 46 | 0% (0/46) | 0% (0/65) |
| no-rewrite | K2 | beyond training p99 | 260 | 0% (0/260) | 0% (0/921) |
| no-rewrite | K5 | within training p99 (<= 87 tokens) | 59 | 100% (59/59) | 0% (0/145) |
| no-rewrite | K5 | beyond training p99 | 43 | 100% (43/43) | 0% (0/161) |

## 3. Decomposition (K6): a tangled message into short simple sentences

| rewriter | dataset | cases | changed | sentence count matches | at least the expected sentences | every sentence within the contract | SymbolicLM handles every sentence | exact target | names kept | numbers kept | negations kept | connectives kept | SOP = gold |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemma3-270m-proofreader-v1 | bad_english | 22 | 40.9% (9/22) | 4.5% (1/22) | 4.5% (1/22) | 0% (0/22) | 40.9% (9/22) | 4.5% (1/22) | 91.7% (22/24) | 100% (2/2) | 100% (4/4) | 100% (21/21) | n/a |
| gemma3-270m-proofreader-v1 | neuro_english | 30 | 20% (6/30) | 6.7% (2/30) | 10% (3/30) | 13.3% (4/30) | 30% (9/30) | 6.7% (2/30) | 96.6% (56/58) | 100% (2/2) | 100% (7/7) | 100% (18/18) | 40% (2/5) |
| no-rewrite | bad_english | 22 | 0% (0/22) | 0% (0/22) | 0% (0/22) | 0% (0/22) | 36.4% (8/22) | 0% (0/22) | 100% (24/24) | 100% (2/2) | 100% (4/4) | 100% (21/21) | n/a |
| no-rewrite | neuro_english | 30 | 0% (0/30) | 0% (0/30) | 0% (0/30) | 6.7% (2/30) | 26.7% (8/30) | 0% (0/30) | 100% (58/58) | 100% (2/2) | 100% (7/7) | 100% (18/18) | 20% (1/5) |
