### Sealed proofing test, repair units, mechanical layer (all units)

| arm / kind | units | clean % | content % | chrF (n ref) | exact % |
|---|---|---|---|---|---|
| no rewrite, all repair | 8435 | 12.3 | 99.4 | 0.5532 (4683) | 0.4 |
| &nbsp;&nbsp;ro | 6237 | 0.7 | 99.3 | 0.3621 (2836) | 0 |
| &nbsp;&nbsp;mixed | 422 | 16.8 | 99.1 | 0.6199 (336) | 5.1 |
| &nbsp;&nbsp;noisy_en | 1776 | 52 | 99.8 | 0.897 (1511) | 0 |
| untrained 270M, all repair | 8435 | 35.4 | 35.7 | 0.336 (4683) | 0.4 |
| &nbsp;&nbsp;ro | 6237 | 18.1 | 41.3 | 0.2669 (2836) | 0 |
| &nbsp;&nbsp;mixed | 422 | 56.2 | 23.7 | 0.3364 (336) | 1.2 |
| &nbsp;&nbsp;noisy_en | 1776 | 91.3 | 19.1 | 0.4657 (1511) | 0.9 |
| iteration 1, all repair | 8435 | 97.2 | 98.9 | 0.8984 (4683) | 59.4 |
| &nbsp;&nbsp;ro | 6237 | 99.7 | 98.8 | 0.8757 (2836) | 51.4 |
| &nbsp;&nbsp;mixed | 422 | 98.8 | 98.8 | 0.8879 (336) | 56 |
| &nbsp;&nbsp;noisy_en | 1776 | 88.1 | 99.3 | 0.9433 (1511) | 75 |
| iteration 2, all repair | 8435 | 96.8 | 98.6 | 0.8553 (4683) | 42.2 |
| &nbsp;&nbsp;ro | 6237 | 99.7 | 98.4 | 0.8101 (2836) | 34.6 |
| &nbsp;&nbsp;mixed | 422 | 99.1 | 98.8 | 0.8608 (336) | 49.7 |
| &nbsp;&nbsp;noisy_en | 1776 | 86.2 | 99.2 | 0.9391 (1511) | 55 |
| **iteration 3**, all repair | 8435 | 96.9 | 97.9 | 0.8496 (4683) | 46.5 |
| &nbsp;&nbsp;ro | 6237 | 99.8 | 97.8 | 0.8034 (2836) | 34 |
| &nbsp;&nbsp;mixed | 422 | 98.8 | 98.8 | 0.8514 (336) | 47 |
| &nbsp;&nbsp;noisy_en | 1776 | 86.3 | 98 | 0.9359 (1511) | 69.9 |

### Judged sample (600 units, stratified, seed 7), all layers

| arm / kind | units | clean % | content % | chrF | analysis % | meaning % | composite % |
|---|---|---|---|---|---|---|---|
| no rewrite, all repair | 472 | 12.9 | 98.9 | 0.5618 | 9.7 | 100 | 5.3 (25/472) |
| &nbsp;&nbsp;ro | 349 | 0.6 | 98.6 | 0.3572 | 0.3 | 100 | 0 (0/349) |
| &nbsp;&nbsp;mixed | 24 | 12.5 | 100 | 0.6373 | 37.5 | 100 | 12.5 (3/24) |
| &nbsp;&nbsp;noisy_en | 99 | 56.6 | 100 | 0.8877 | 36.4 | 100 | 22.2 (22/99) |
| untrained 270M, all repair | 472 | 34.3 | 36.7 | 0.3214 | 21.6 | 23.9 | 4 (19/472) |
| &nbsp;&nbsp;ro | 349 | 16 | 41.5 | 0.2475 | 10.3 | 30.4 | 1.4 (5/349) |
| &nbsp;&nbsp;mixed | 24 | 50 | 29.2 | 0.3772 | 41.7 | 8.3 | 4.2 (1/24) |
| &nbsp;&nbsp;noisy_en | 99 | 94.9 | 21.2 | 0.4315 | 56.6 | 5.1 | 13.1 (13/99) |
| iteration 1, all repair | 472 | 97.9 | 99.4 | 0.9086 | 67.4 | 81.4 | 66.1 (312/472) |
| &nbsp;&nbsp;ro | 349 | 99.7 | 99.4 | 0.8917 | 69.9 | 82.2 | 69.6 (243/349) |
| &nbsp;&nbsp;mixed | 24 | 95.8 | 95.8 | 0.8907 | 41.7 | 75 | 37.5 (9/24) |
| &nbsp;&nbsp;noisy_en | 99 | 91.9 | 100 | 0.942 | 64.6 | 79.8 | 60.6 (60/99) |
| iteration 2, all repair | 472 | 97 | 99.4 | 0.8523 | 67.6 | 82 | 66.3 (313/472) |
| &nbsp;&nbsp;ro | 349 | 99.1 | 99.1 | 0.8068 | 70.2 | 82.5 | 69.6 (243/349) |
| &nbsp;&nbsp;mixed | 24 | 100 | 100 | 0.8234 | 45.8 | 66.7 | 45.8 (11/24) |
| &nbsp;&nbsp;noisy_en | 99 | 88.9 | 100 | 0.9367 | 63.6 | 83.8 | 59.6 (59/99) |
| iteration 2 (differing outputs re-judged by Grok and GLM), all repair | 472 | 97 | 99.4 | 0.8523 | 68.4 | 75 | 67.2 (317/472) |
| &nbsp;&nbsp;ro | 349 | 99.1 | 99.1 | 0.8068 | 71.1 | 73.6 | 70.5 (246/349) |
| &nbsp;&nbsp;mixed | 24 | 100 | 100 | 0.8234 | 45.8 | 54.2 | 45.8 (11/24) |
| &nbsp;&nbsp;noisy_en | 99 | 88.9 | 100 | 0.9367 | 64.6 | 84.8 | 60.6 (60/99) |
| **iteration 3**, all repair | 472 | 97.5 | 97.5 | 0.8363 | 69.3 | 78 | 67.2 (317/472) |
| &nbsp;&nbsp;ro | 349 | 99.7 | 96.8 | 0.7912 | 71.3 | 77.4 | 69.6 (243/349) |
| &nbsp;&nbsp;mixed | 24 | 100 | 100 | 0.8084 | 58.3 | 66.7 | 58.3 (14/24) |
| &nbsp;&nbsp;noisy_en | 99 | 88.9 | 99 | 0.9198 | 64.6 | 82.8 | 60.6 (60/99) |

### Clean sentences left untouched (clean900) and identity units

| arm | clean900 untouched % (k/n) | Wilson 95% | content broken % | judged identity untouched % |
|---|---|---|---|---|
| no rewrite | 100 (900/900) | [99.6, 100] | 0 | 100 (127/127) |
| untrained 270M | 2.2 (20/900) | [1.4, 3.4] | 82.7 | 3.1 (4/127) |
| iteration 1 | 94.8 (853/900) | [93.1, 96.1] | 0.1 | 92.9 (118/127) |
| iteration 2 | 98.1 (883/900) | [97, 98.8] | 0.1 | 98.4 (125/127) |
| **iteration 3** | 98.2 (884/900) | [97.1, 98.9] | 0.1 | 94.5 (120/127) |

### Dev sets (selection signal), mechanical layer

| arm | devbg repair composite % | devbg chrF | held-out repair composite % | held-out word kept % | dev2300 repair composite % | identity untouched % (dev) | mash unchanged % |
|---|---|---|---|---|---|---|---|
| no rewrite | 12.7 | 0.5281 | 14.5 | 42.1 | 9.1 | 100 (687/687) | 100 (150/150) |
| untrained 270M | 11.4 | 0.3417 | 12.5 | 36.4 | 7.8 | 1.7 (12/687) | 0 (0/150) |
| iteration 1 | 97.9 | 0.8343 | 95.6 | 49.1 | 98.7 | 90.1 (619/687) | 66.7 (100/150) |
| iteration 2 | 98.2 | 0.9412 | 96.9 | 45.8 | 99.6 | 96.7 (664/687) | 98.7 (148/150) |
| **iteration 3** | 97.4 | 0.9499 | 97.4 | 93.8 | 98.7 | 96.8 (665/687) | 98.7 (148/150) |

### Vocabulary probe (child cases)

| arm | child units | relation word kept | parent flip (child to parent) | parent units | parent kept |
|---|---|---|---|---|---|
| no rewrite | 229 | 24 (10.5%) | 0 (0%) | 4 | 1 |
| untrained 270M | 229 | 40 (17.5%) | 0 (0%) | 4 | 1 |
| iteration 1 | 229 | 20 (8.7%) | 204 (89.1%) | 4 | 3 |
| iteration 2 | 229 | 229 (100%) | 1 (0.4%) | 4 | 3 |
| **iteration 3** | 229 | 224 (97.8%) | 1 (0.4%) | 4 | 4 |

### Composed K4, per sentence, every sentence sent (sendAll)

| arm | clean sentences changed | bad sentences fixed | bad rewritten wrongly | bad untouched | dropped components | paragraphs with added text | exact paragraphs |
|---|---|---|---|---|---|---|---|
| no rewrite | 0% (0/986) | 0.3% (2/578) | 0% (0/578) | 99.7% (576/578) | 0% (0/1564) | 0% (0/306) | 0% (0/306) |
| untrained 270M | 92.1% (908/986) | 0% (0/578) | 97.6% (564/578) | 1% (6/578) | 1.7% (26/1564) | 74.5% (228/306) | 0% (0/306) |
| iteration 1 | 3.9% (38/986) | 49.7% (287/578) | 48.4% (280/578) | 1.4% (8/578) | 0.4% (7/1564) | 29.7% (91/306) | 30.1% (92/306) |
| iteration 2 | 1.4% (14/986) | 35.3% (204/578) | 57.3% (331/578) | 7.1% (41/578) | 0.6% (10/1564) | 35.9% (110/306) | 18.3% (56/306) |
| **iteration 3** | 1.1% (11/986) | 38.6% (223/578) | 58.3% (337/578) | 2.8% (16/578) | 0.3% (5/1564) | 37.3% (114/306) | 23.9% (73/306) |

### Vocabulary probes and spacing (iteration 3 sets, mechanical layer)

| arm | trained-vocabulary word kept % (dev-heldout, ten words) | unseen-word kept % (dev-heldout-v3, eight words) | unseen: clean identity sentences kept unchanged % | spacing exact % (dev-spacing) | defect-free dev identity untouched % |
|---|---|---|---|---|---|
| no rewrite | 42.2 (242/574) | 34.1 (283/830) | 100 (306/306) | 15.4 (37/240) | 100 (678/678) |
| untrained 270M | 36.4 (209/574) | 28.2 (234/830) | 4.6 (14/306) | 2.9 (7/240) | 1.8 (12/678) |
| iteration 1 | 49.1 (282/574) | 74.6 (619/830) | 88.6 (271/306) | 85 (204/240) | 90.9 (616/678) |
| iteration 2 | 45.6 (262/574) | 92.2 (765/830) | 98.4 (301/306) | 17.9 (43/240) | 96.6 (655/678) |
| iteration 2 (differing outputs re-judged by Grok and GLM) | - | - | - | - | - |
| **iteration 3** | 94.1 (540/574) | 52 (432/830) | 98.7 (302/306) | 99.6 (239/240) | 97.6 (662/678) |
