
## Checkpoint selection on dev (it2 dev units)

| checkpoint | dev loss | repair: analysis correct AND meaning kept | repair: meaning kept | repair: analysis correct | identity: analysis or text changed | identity: analysis changed | repair: runaway | repair: pronoun dropped | repair: filler dropped |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| epoch 1 | 0.1260 | 258/497 = 51.9% [47.5, 56.3] | 434/497 = 87.3% [84.1, 90] | 303/497 = 61% [56.6, 65.2] | 92/622 = 14.8% [12.2, 17.8] | 89/622 = 14.3% [11.8, 17.3] | 1/497 = 0.2% [0, 1.1] | 4/497 = 0.8% [0.3, 2.1] | 2/497 = 0.4% [0.1, 1.5] |
| epoch 2 | 0.1109 | 270/497 = 54.3% [49.9, 58.7] | 460/497 = 92.6% [89.9, 94.6] | 296/497 = 59.6% [55.2, 63.8] | 88/622 = 14.1% [11.6, 17.1] | 88/622 = 14.1% [11.6, 17.1] | 0/497 = 0% [0, 0.8] | 1/497 = 0.2% [0, 1.1] | 0/497 = 0% [0, 0.8] |
| epoch 3 | 0.1161 | 288/497 = 57.9% [53.6, 62.2] | 454/497 = 91.3% [88.5, 93.5] | 317/497 = 63.8% [59.5, 67.9] | 70/622 = 11.3% [9, 14] | 70/622 = 11.3% [9, 14] | 0/497 = 0% [0, 0.8] | 3/497 = 0.6% [0.2, 1.8] | 2/497 = 0.4% [0.1, 1.5] |


## Sealed pair test (every input cut by the host splitter, every sentence sent to the model, outputs joined; HF bf16 greedy)


### Repair pairs (PRIMARY, analysis layer)

| metric | no rewrite | untrained base | iteration 1 | iteration 2 |
| --- | --- | --- | --- | --- |
| input analysis correct (reference) | 40/739 = 5.4% [4, 7.3] | 40/739 = 5.4% [4, 7.3] | 40/739 = 5.4% [4, 7.3] | 40/739 = 5.4% [4, 7.3] |
| verified target passes the same gate (ceiling) | 739/739 = 100% [99.5, 100] | 739/739 = 100% [99.5, 100] | 739/739 = 100% [99.5, 100] | 739/739 = 100% [99.5, 100] |
| output analysis correct | 40/739 = 5.4% [4, 7.3] | 388/739 = 52.5% [48.9, 56.1] | 90/739 = 12.2% [10, 14.7] | 333/739 = 45.1% [41.5, 48.7] |
| output meaning kept (unchanged, equals target, or hard mechanical checks AND two-vote judge) | 739/739 = 100% [99.5, 100] | 9/739 = 1.2% [0.6, 2.3] | 699/739 = 94.6% [92.7, 96] | 640/739 = 86.6% [84, 88.9] |
| **output analysis correct AND meaning kept** | 40/739 = 5.4% [4, 7.3] | 3/739 = 0.4% [0.1, 1.2] | 68/739 = 9.2% [7.3, 11.5] | 271/739 = 36.7% [33.3, 40.2] |
|   same, mechanical meaning checks only (iteration-1 definition) | 40/739 = 5.4% [4, 7.3] | 41/739 = 5.5% [4.1, 7.4] | 80/739 = 10.8% [8.8, 13.3] | 256/739 = 34.6% [31.3, 38.1] |
| fixed, of the inputs whose analysis was not correct | 0/699 = 0% [0, 0.5] | 1/699 = 0.1% [0, 0.8] | 32/699 = 4.6% [3.3, 6.4] | 235/699 = 33.6% [30.2, 37.2] |
| worse than input, of the inputs whose analysis was correct | 0/40 = 0% [0, 8.8] | 18/40 = 45% [30.7, 60.2] | 3/40 = 7.5% [2.6, 19.9] | 2/40 = 5% [1.4, 16.5] |
| output equals the verified target text | 0/739 = 0% [0, 0.5] | 0/739 = 0% [0, 0.5] | 19/739 = 2.6% [1.7, 4] | 130/739 = 17.6% [15, 20.5] |
| output left unchanged | 739/739 = 100% [99.5, 100] | 7/739 = 0.9% [0.5, 1.9] | 625/739 = 84.6% [81.8, 87] | 337/739 = 45.6% [42, 49.2] |
| pronoun dropped or replaced | 0/739 = 0% [0, 0.5] | 92/739 = 12.4% [10.3, 15] | 2/739 = 0.3% [0.1, 1] | 1/739 = 0.1% [0, 0.8] |
| lead-in, tag or question frame dropped | 0/739 = 0% [0, 0.5] | 82/739 = 11.1% [9, 13.6] | 17/739 = 2.3% [1.4, 3.7] | 3/739 = 0.4% [0.1, 1.2] |
| statement turned into a question | 0/739 = 0% [0, 0.5] | 11/739 = 1.5% [0.8, 2.6] | 0/739 = 0% [0, 0.5] | 13/739 = 1.8% [1, 3] |
| runaway (cap hit or repeated sentence) | 0/739 = 0% [0, 0.5] | 56/739 = 7.6% [5.9, 9.7] | 0/739 = 0% [0, 0.5] | 1/739 = 0.1% [0, 0.8] |
| one-clause sentences among the output sentences | 352/856 = 41.1% [37.9, 44.5] | 893/1366 = 65.4% [62.8, 67.9] | 394/878 = 44.9% [41.6, 48.2] | 620/1010 = 61.4% [58.3, 64.3] |
| explicit-subject sentences among the output sentences | 693/856 = 81% [78.2, 83.4] | 1236/1366 = 90.5% [88.8, 91.9] | 724/878 = 82.5% [79.8, 84.8] | 891/1010 = 88.2% [86.1, 90.1] |
| output sentence count equals the target | 552/739 = 74.7% [71.4, 77.7] | 464/739 = 62.8% [59.2, 66.2] | 560/739 = 75.8% [72.6, 78.7] | 607/739 = 82.1% [79.2, 84.7] |


### Identity pairs (PRIMARY): the sentence works, nothing may change

| metric | no rewrite | untrained base | iteration 1 | iteration 2 |
| --- | --- | --- | --- | --- |
| **analysis OR text changed** | 0/495 = 0% [0, 0.8] | 486/495 = 98.2% [96.6, 99] | 80/495 = 16.2% [13.2, 19.7] | 98/495 = 19.8% [16.5, 23.5] |
| analysis changed | 0/495 = 0% [0, 0.8] | 486/495 = 98.2% [96.6, 99] | 70/495 = 14.1% [11.3, 17.5] | 96/495 = 19.4% [16.2, 23.1] |
| text changed | 0/495 = 0% [0, 0.8] | 486/495 = 98.2% [96.6, 99] | 80/495 = 16.2% [13.2, 19.7] | 98/495 = 19.8% [16.5, 23.5] |
| working inputs: output no longer analysis-correct | 0/494 = 0% [0, 0.8] | 183/494 = 37% [32.9, 41.4] | 17/494 = 3.4% [2.2, 5.4] | 20/494 = 4% [2.6, 6.2] |
| pronoun dropped or replaced | 0/495 = 0% [0, 0.8] | 46/495 = 9.3% [7, 12.2] | 3/495 = 0.6% [0.2, 1.8] | 0/495 = 0% [0, 0.8] |
| runaway | 0/495 = 0% [0, 0.8] | 38/495 = 7.7% [5.6, 10.4] | 0/495 = 0% [0, 0.8] | 0/495 = 0% [0, 0.8] |
| meaning check failed (mechanical) | 0/495 = 0% [0, 0.8] | 396/495 = 80% [76.3, 83.3] | 11/495 = 2.2% [1.2, 3.9] | 29/495 = 5.9% [4.1, 8.3] |


### Paired bootstrap, iteration 2 minus the other arm (95% interval, 10,000 resamples)

| it2 minus | repair: analysis correct AND meaning kept | repair: fixed of failing inputs | identity: analysis and text kept |
| --- | --- | --- | --- |
| no rewrite | +31.3 pp [27.7, 34.6] (n 739) | +33.6 pp [30, 37.2] (n 699) | -19.8 pp [-23.2, -16.4] (n 495) |
| untrained base | +36.3 pp [32.7, 39.6] (n 739) | +33.5 pp [29.9, 37.1] (n 699) | +78.4 pp [74.7, 82] (n 495) |
| iteration 1 | +27.5 pp [23.7, 31.3] (n 739) | +29 pp [25, 32.9] (n 699) | -3.6 pp [-8.3, 1.2] (n 495) |


### Secondary: SOP layer (not used for selection or verdict)

| metric | no rewrite | untrained base | iteration 1 | iteration 2 |
| --- | --- | --- | --- | --- |
| repair: SOP matches the gold, strict | 439/739 = 59.4% [55.8, 62.9] | 21/739 = 2.8% [1.9, 4.3] | 431/739 = 58.3% [54.7, 61.8] | 425/739 = 57.5% [53.9, 61] |
| repair: SOP matches the gold, frame-normalized | 517/739 = 70% [66.6, 73.2] | 22/739 = 3% [2, 4.5] | 506/739 = 68.5% [65, 71.7] | 487/739 = 65.9% [62.4, 69.2] |
| repair: SOP equals the SOP of the verified target | 418/739 = 56.6% [53, 60.1] | 18/739 = 2.4% [1.5, 3.8] | 413/739 = 55.9% [52.3, 59.4] | 406/739 = 54.9% [51.3, 58.5] |
| identity: break (SOP no longer matches, strict) | 111/495 = 22.4% [19, 26.3] | 454/495 = 91.7% [89, 93.8] | 124/495 = 25.1% [21.4, 29] | 131/495 = 26.5% [22.8, 30.5] |
| all pairs: SymbolicLM parses the output with no unparsed span | 1041/1234 = 84.4% [82.2, 86.3] | 961/1234 = 77.9% [75.5, 80.1] | 1043/1234 = 84.5% [82.4, 86.4] | 1049/1234 = 85% [82.9, 86.9] |
| empty or capped outputs | 0/1234 = 0% [0, 0.3] | 78/1234 = 6.3% [5.1, 7.8] | 0/1234 = 0% [0, 0.3] | 0/1234 = 0% [0, 0.3] |


### Decomposition pairs of the sealed set (the verified target has more sentences than the input)

| arm | pairs | analysis correct AND meaning kept | sentence count equals target | sentence count at least target | one-clause output sentences | explicit-subject output sentences | equals the target text |
| --- | --- | --- | --- | --- | --- | --- | --- |
| no rewrite | 134 | 15/134 = 11.2% [6.9, 17.6] | 1/134 = 0.7% [0.1, 4.1] | 1/134 = 0.7% [0.1, 4.1] | 8/150 = 5.3% [2.7, 10.2] | 142/150 = 94.7% [89.8, 97.3] | 0/134 = 0% [0, 2.8] |
| untrained base | 134 | 0/134 = 0% [0, 2.8] | 15/134 = 11.2% [6.9, 17.6] | 37/134 = 27.6% [20.7, 35.7] | 219/330 = 66.4% [61.1, 71.2] | 293/330 = 88.8% [84.9, 91.8] | 0/134 = 0% [0, 2.8] |
| iteration 1 | 134 | 16/134 = 11.9% [7.5, 18.5] | 6/134 = 4.5% [2.1, 9.4] | 8/134 = 6% [3.1, 11.3] | 27/165 = 16.4% [11.5, 22.8] | 158/165 = 95.8% [91.5, 97.9] | 2/134 = 1.5% [0.4, 5.3] |
| iteration 2 | 134 | 53/134 = 39.6% [31.7, 48] | 44/134 = 32.8% [25.5, 41.2] | 54/134 = 40.3% [32.4, 48.8] | 168/281 = 59.8% [54, 65.4] | 274/281 = 97.5% [94.9, 98.8] | 25/134 = 18.7% [13, 26.1] |


## 500 random working sentences of the sealed symbolic_english test (HF bf16 greedy)

| metric | no rewrite | untrained base | iteration 1 | iteration 2 |
| --- | --- | --- | --- | --- |
| **analysis OR text changed** | 0/500 = 0% [0, 0.8] | 492/500 = 98.4% [96.9, 99.2] | 83/500 = 16.6% [13.6, 20.1] | 77/500 = 15.4% [12.5, 18.8] |
| analysis changed | 0/500 = 0% [0, 0.8] | 491/500 = 98.2% [96.6, 99.1] | 74/500 = 14.8% [12, 18.2] | 75/500 = 15% [12.1, 18.4] |
| text changed | 0/500 = 0% [0, 0.8] | 492/500 = 98.4% [96.9, 99.2] | 83/500 = 16.6% [13.6, 20.1] | 77/500 = 15.4% [12.5, 18.8] |
| working inputs (pass the gate): output no longer analysis-correct | 0/498 = 0% [0, 0.8] | 140/498 = 28.1% [24.3, 32.2] | 18/498 = 3.6% [2.3, 5.6] | 14/498 = 2.8% [1.7, 4.7] |
| pronoun dropped or replaced | 0/500 = 0% [0, 0.8] | 33/500 = 6.6% [4.7, 9.1] | 3/500 = 0.6% [0.2, 1.7] | 0/500 = 0% [0, 0.8] |
| runaway | 0/500 = 0% [0, 0.8] | 17/500 = 3.4% [2.1, 5.4] | 0/500 = 0% [0, 0.8] | 0/500 = 0% [0, 0.8] |
| meaning check failed (mechanical) | 0/500 = 0% [0, 0.8] | 397/500 = 79.4% [75.6, 82.7] | 17/500 = 3.4% [2.1, 5.4] | 19/500 = 3.8% [2.4, 5.9] |

| it2 minus | identity: analysis and text kept |
| --- | --- |
| no rewrite | -15.4 pp [-18.8, -12.4] (n 500) |
| untrained base | +83 pp [79.6, 86.2] (n 500) |
| iteration 1 | +1.2 pp [-3, 5.6] (n 500) |


## Capacity check: the final model on 400 repair and 400 identity pairs of its own training file

| metric | value |
| --- | --- |
| repair: output equals the training target text | 300/400 = 75% [70.5, 79] |
| repair: analysis correct AND meaning kept | 332/400 = 83% [79, 86.4] |
| repair: left unchanged | 49/400 = 12.3% [9.4, 15.8] |
| identity: analysis or text changed | 14/400 = 3.5% [2.1, 5.8] |


## Composed suites (analysis layer; GGUF Q8_0 through llama-server on the GPU)


### Paired bootstrap over cases, iteration 2 minus iteration 1 / minus no rewrite

| suite | mode | share of output sentences analysis-correct, it2 - it1 | it2 - no rewrite | text and analysis unchanged, it2 - it1 | it2 - no rewrite |
| --- | --- | --- | --- | --- | --- |


### K6 decomposition (16 cases: one tangled message that must become several short sentences)

| arm and mode | output changed | sentence count equals expected | sentence count at least expected | every sentence within the contract (one clause, explicit subject) | one-clause output sentences | explicit-subject output sentences | all output sentences analysis-correct (paragraph) | ... AND meaning kept | names preserved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

