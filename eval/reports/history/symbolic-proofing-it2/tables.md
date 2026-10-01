
## Checkpoint selection on dev (it2 dev units)

| checkpoint | dev loss | repair: analysis correct AND meaning kept | repair: meaning kept | repair: analysis correct | identity: analysis or text changed | identity: analysis changed | repair: runaway | repair: pronoun dropped | repair: filler dropped |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| epoch 1 | 0.1260 | 258/497 = 51.9% [47.5, 56.3] | 436/497 = 87.7% [84.5, 90.3] | 303/497 = 61% [56.6, 65.2] | 92/622 = 14.8% [12.2, 17.8] | 89/622 = 14.3% [11.8, 17.3] | 1/497 = 0.2% [0, 1.1] | 4/497 = 0.8% [0.3, 2.1] | 2/497 = 0.4% [0.1, 1.5] |
| epoch 2 | 0.1109 | 272/497 = 54.7% [50.3, 59.1] | 463/497 = 93.2% [90.6, 95.1] | 296/497 = 59.6% [55.2, 63.8] | 88/622 = 14.1% [11.6, 17.1] | 88/622 = 14.1% [11.6, 17.1] | 0/497 = 0% [0, 0.8] | 1/497 = 0.2% [0, 1.1] | 0/497 = 0% [0, 0.8] |
| epoch 3 | 0.1161 | 292/497 = 58.8% [54.4, 63] | 461/497 = 92.8% [90.1, 94.7] | 317/497 = 63.8% [59.5, 67.9] | 70/622 = 11.3% [9, 14] | 70/622 = 11.3% [9, 14] | 0/497 = 0% [0, 0.8] | 3/497 = 0.6% [0.2, 1.8] | 2/497 = 0.4% [0.1, 1.5] |


## Sealed pair test (every input cut by the host splitter, every sentence sent to the model, outputs joined; HF bf16 greedy)


### Repair pairs (PRIMARY, analysis layer)

| metric | no rewrite | untrained base | iteration 1 | iteration 2 |
| --- | --- | --- | --- | --- |
| input analysis correct (reference): local only (trees identical) | 185/739 = 25% [22, 28.3] | 185/739 = 25% [22, 28.3] | 185/739 = 25% [22, 28.3] | 185/739 = 25% [22, 28.3] |
| input analysis correct (reference): with the judge | 40/739 = 5.4% [4, 7.3] | 40/739 = 5.4% [4, 7.3] | 40/739 = 5.4% [4, 7.3] | 40/739 = 5.4% [4, 7.3] |
| verified target passes the same gate (ceiling) | 739/739 = 100% [99.5, 100] | 739/739 = 100% [99.5, 100] | 739/739 = 100% [99.5, 100] | 739/739 = 100% [99.5, 100] |
| (a) output analysis correct, LOCAL ONLY (default and accurate trees identical) | 185/739 = 25% [22, 28.3] | 429/739 = 58.1% [54.5, 61.6] | 223/739 = 30.2% [27, 33.6] | 440/739 = 59.5% [56, 63] |
| (a) **LOCAL ONLY: analysis correct AND meaning kept** (unchanged, equals target, or local analysis comparison equivalent) | 185/739 = 25% [22, 28.3] | 4/739 = 0.5% [0.2, 1.4] | 184/739 = 24.9% [21.9, 28.1] | 304/739 = 41.1% [37.6, 44.7] |
| (b) output analysis correct, with the DeepSeek parse judge | 40/739 = 5.4% [4, 7.3] | 388/739 = 52.5% [48.9, 56.1] | 90/739 = 12.2% [10, 14.7] | 333/739 = 45.1% [41.5, 48.7] |
| output meaning kept (unchanged, equals target, or hard mechanical checks AND two-vote judge) | 739/739 = 100% [99.5, 100] | 10/739 = 1.4% [0.7, 2.5] | 701/739 = 94.9% [93, 96.2] | 654/739 = 88.5% [86, 90.6] |
| (b) **WITH JUDGES: analysis correct AND meaning kept** | 40/739 = 5.4% [4, 7.3] | 3/739 = 0.4% [0.1, 1.2] | 69/739 = 9.3% [7.4, 11.7] | 278/739 = 37.6% [34.2, 41.2] |
| outputs that needed the DeepSeek meaning judge (changed, not the target, hard checks pass, local comparison not equivalent) | 0/739 = 0% [0, 0.5] | 429/739 = 58.1% [54.5, 61.6] | 54/739 = 7.3% [5.6, 9.4] | 164/739 = 22.2% [19.3, 25.3] |
|   same, mechanical meaning checks only (iteration-1 definition) | 40/739 = 5.4% [4, 7.3] | 41/739 = 5.5% [4.1, 7.4] | 80/739 = 10.8% [8.8, 13.3] | 256/739 = 34.6% [31.3, 38.1] |
| fixed, of the inputs whose analysis was not correct | 0/699 = 0% [0, 0.5] | 1/699 = 0.1% [0, 0.8] | 33/699 = 4.7% [3.4, 6.6] | 242/699 = 34.6% [31.2, 38.2] |
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

| it2 minus | (a) repair, LOCAL ONLY: analysis correct AND meaning kept | (b) repair, with judges: analysis correct AND meaning kept | (b) repair: fixed of failing inputs | identity: analysis and text kept |
| --- | --- | --- | --- | --- |
| no rewrite | +16.1 pp [12.7, 19.4] (n 739) | +32.2 pp [28.7, 35.6] (n 739) | +34.6 pp [31, 38.2] (n 699) | -19.8 pp [-23.2, -16.4] (n 495) |
| untrained base | +40.6 pp [37.2, 44.1] (n 739) | +37.2 pp [33.7, 40.6] (n 739) | +34.5 pp [30.9, 38.1] (n 699) | +78.4 pp [74.7, 82] (n 495) |
| iteration 1 | +16.2 pp [12.9, 19.6] (n 739) | +28.3 pp [24.5, 32.1] (n 739) | +29.9 pp [26, 33.8] (n 699) | -3.6 pp [-8.3, 1.2] (n 495) |


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
| iteration 2 | 134 | 56/134 = 41.8% [33.8, 50.3] | 44/134 = 32.8% [25.5, 41.2] | 54/134 = 40.3% [32.4, 48.8] | 168/281 = 59.8% [54, 65.4] | 274/281 = 97.5% [94.9, 98.8] | 25/134 = 18.7% [13, 26.1] |


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


### K2 mixed paragraphs (bad and clean sentences mixed), per-sentence mode (ALL sentences sent)

| arm | (a) sentences analysis-correct, local only | (b) sentences analysis-correct, with judge | (a) paragraphs analysis-correct, local only | (b) paragraphs analysis-correct, with judge | (a) paragraphs local-only analysis AND meaning kept | (b) paragraphs analysis AND meaning kept, with judges | meaning kept (b) | text unchanged | same analysis as the input | pronouns kept | clean sentences changed (text scorer) | bad sentences fixed to the expected wording (text scorer) | runaway | sentence count equals expected |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| no rewrite | 1221/1607 = 76% [73.8, 78] | 1128/1607 = 70.2% [67.9, 72.4] | 66/306 = 21.6% [17.3, 26.5] | 35/306 = 11.4% [8.3, 15.5] | 66/306 = 21.6% [17.3, 26.5] | 35/306 = 11.4% [8.3, 15.5] | 306/306 = 100% [98.8, 100] | 306/306 = 100% [98.8, 100] | 306/306 = 100% [98.8, 100] | 306/306 = 100% [98.8, 100] | 0/986 = 0% [0, 0.4] | 0/578 = 0% [0, 0.7] | 0/306 = 0% [0, 1.2] | 120/306 = 39.2% [33.9, 44.8] |
| untrained base | 1625/2212 = 73.5% [71.6, 75.3] | 1464/2212 = 66.2% [64.2, 68.1] | 75/306 = 24.5% [20, 29.6] | 58/306 = 19% [15, 23.7] | 0/306 = 0% [0, 1.2] | 0/306 = 0% [0, 1.2] | 0/306 = 0% [0, 1.2] | 0/306 = 0% [0, 1.2] | 0/306 = 0% [0, 1.2] | 306/306 = 100% [98.8, 100] | 910/986 = 92.3% [90.5, 93.8] | 0/578 = 0% [0, 0.7] | 14/306 = 4.6% [2.7, 7.5] | 52/306 = 17% [13.2, 21.6] |
| iteration 1 | 1290/1622 = 79.5% [77.5, 81.4] | 1221/1622 = 75.3% [73.1, 77.3] | 96/306 = 31.4% [26.4, 36.8] | 70/306 = 22.9% [18.5, 27.9] | 45/306 = 14.7% [11.2, 19.1] | 39/306 = 12.7% [9.5, 16.9] | 167/306 = 54.6% [49, 60.1] | 101/306 = 33% [28, 38.5] | 118/306 = 38.6% [33.3, 44.1] | 306/306 = 100% [98.8, 100] | 94/986 = 9.5% [7.9, 11.5] | 31/578 = 5.4% [3.8, 7.5] | 0/306 = 0% [0, 1.2] | 118/306 = 38.6% [33.3, 44.1] |
| iteration 2 | 1578/1770 = 89.2% [87.6, 90.5] | 1452/1770 = 82% [80.2, 83.8] | 149/306 = 48.7% [43.1, 54.3] | 83/306 = 27.1% [22.4, 32.4] | 95/306 = 31% [26.1, 36.4] | 75/306 = 24.5% [20, 29.6] | 243/306 = 79.4% [74.5, 83.6] | 68/306 = 22.2% [17.9, 27.2] | 68/306 = 22.2% [17.9, 27.2] | 306/306 = 100% [98.8, 100] | 95/986 = 9.6% [7.9, 11.6] | 30/578 = 5.2% [3.7, 7.3] | 0/306 = 0% [0, 1.2] | 140/306 = 45.8% [40.3, 51.4] |


### K2 mixed paragraphs (bad and clean sentences mixed), whole-paragraph mode (comparison)

| arm | (a) sentences analysis-correct, local only | (b) sentences analysis-correct, with judge | (a) paragraphs analysis-correct, local only | (b) paragraphs analysis-correct, with judge | (a) paragraphs local-only analysis AND meaning kept | (b) paragraphs analysis AND meaning kept, with judges | meaning kept (b) | text unchanged | same analysis as the input | pronouns kept | clean sentences changed (text scorer) | bad sentences fixed to the expected wording (text scorer) | runaway | sentence count equals expected |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| no rewrite | 1221/1607 = 76% [73.8, 78] | 1128/1607 = 70.2% [67.9, 72.4] | 66/306 = 21.6% [17.3, 26.5] | 35/306 = 11.4% [8.3, 15.5] | 66/306 = 21.6% [17.3, 26.5] | 35/306 = 11.4% [8.3, 15.5] | 306/306 = 100% [98.8, 100] | 306/306 = 100% [98.8, 100] | 306/306 = 100% [98.8, 100] | 306/306 = 100% [98.8, 100] | 0/986 = 0% [0, 0.4] | 0/578 = 0% [0, 0.7] | 0/306 = 0% [0, 1.2] | 120/306 = 39.2% [33.9, 44.8] |
| untrained base | 635/1018 = 62.4% [59.4, 65.3] | 587/1018 = 57.7% [54.6, 60.7] | 153/306 = 50% [44.4, 55.6] | 140/306 = 45.8% [40.3, 51.4] | 0/306 = 0% [0, 1.2] | 0/306 = 0% [0, 1.2] | 2/306 = 0.7% [0.2, 2.4] | 0/306 = 0% [0, 1.2] | 0/306 = 0% [0, 1.2] | 306/306 = 100% [98.8, 100] | 329/986 = 33.4% [30.5, 36.4] | 0/578 = 0% [0, 0.7] | 2/306 = 0.7% [0.2, 2.4] | 6/306 = 2% [0.9, 4.2] |
| iteration 1 | 1565/1914 = 81.8% [80, 83.4] | 1488/1914 = 77.7% [75.8, 79.5] | 98/306 = 32% [27, 37.4] | 66/306 = 21.6% [17.3, 26.5] | 56/306 = 18.3% [14.4, 23] | 50/306 = 16.3% [12.6, 20.9] | 228/306 = 74.5% [69.3, 79.1] | 138/306 = 45.1% [39.6, 50.7] | 142/306 = 46.4% [40.9, 52] | 306/306 = 100% [98.8, 100] | 38/986 = 3.9% [2.8, 5.2] | 46/578 = 8% [6, 10.5] | 0/306 = 0% [0, 1.2] | 151/306 = 49.3% [43.8, 54.9] |
| iteration 2 | 1381/1710 = 80.8% [78.8, 82.6] | 1268/1710 = 74.2% [72, 76.2] | 96/306 = 31.4% [26.4, 36.8] | 62/306 = 20.3% [16.1, 25.1] | 47/306 = 15.4% [11.8, 19.8] | 33/306 = 10.8% [7.8, 14.8] | 171/306 = 55.9% [50.3, 61.3] | 131/306 = 42.8% [37.4, 48.4] | 132/306 = 43.1% [37.7, 48.7] | 306/306 = 100% [98.8, 100] | 97/986 = 9.8% [8.1, 11.9] | 7/578 = 1.2% [0.6, 2.5] | 1/306 = 0.3% [0.1, 1.8] | 111/306 = 36.3% [31.1, 41.8] |


### K3 long identity paragraphs (every sentence works), per-sentence mode (ALL sentences sent)

| arm | (a) sentences analysis-correct, local only | (b) sentences analysis-correct, with judge | (a) paragraphs analysis-correct, local only | (b) paragraphs analysis-correct, with judge | (a) paragraphs local-only analysis AND meaning kept | (b) paragraphs analysis AND meaning kept, with judges | meaning kept (b) | text unchanged | same analysis as the input | pronouns kept | clean sentences changed (text scorer) | bad sentences fixed to the expected wording (text scorer) | runaway | sentence count equals expected |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| no rewrite | 5764/5804 = 99.3% [99.1, 99.5] | 5747/5804 = 99% [98.7, 99.2] | 229/265 = 86.4% [81.8, 90] | 216/265 = 81.5% [76.4, 85.7] | 229/265 = 86.4% [81.8, 90] | 216/265 = 81.5% [76.4, 85.7] | 265/265 = 100% [98.6, 100] | 265/265 = 100% [98.6, 100] | 265/265 = 100% [98.6, 100] | 265/265 = 100% [98.6, 100] | 0/5855 = 0% [0, 0.1] | - | 0/265 = 0% [0, 1.4] | 265/265 = 100% [98.6, 100] |
| untrained base | 5476/7671 = 71.4% [70.4, 72.4] | 5212/7671 = 67.9% [66.9, 69] | 15/265 = 5.7% [3.5, 9.1] | 14/265 = 5.3% [3.2, 8.7] | 0/265 = 0% [0, 1.4] | 0/265 = 0% [0, 1.4] | 0/265 = 0% [0, 1.4] | 0/265 = 0% [0, 1.4] | 0/265 = 0% [0, 1.4] | 265/265 = 100% [98.6, 100] | 5533/5855 = 94.5% [93.9, 95.1] | - | 1/265 = 0.4% [0.1, 2.1] | 25/265 = 9.4% [6.5, 13.6] |
| iteration 1 | 5654/5885 = 96.1% [95.5, 96.5] | 5625/5885 = 95.6% [95, 96.1] | 110/265 = 41.5% [35.7, 47.5] | 101/265 = 38.1% [32.5, 44.1] | 50/265 = 18.9% [14.6, 24] | 55/265 = 20.8% [16.3, 26] | 71/265 = 26.8% [21.8, 32.4] | 36/265 = 13.6% [10, 18.2] | 36/265 = 13.6% [10, 18.2] | 265/265 = 100% [98.6, 100] | 634/5855 = 10.8% [10.1, 11.7] | - | 0/265 = 0% [0, 1.4] | 207/265 = 78.1% [72.8, 82.7] |
| iteration 2 | 5835/5940 = 98.2% [97.9, 98.5] | 5795/5940 = 97.6% [97.1, 97.9] | 181/265 = 68.3% [62.5, 73.6] | 158/265 = 59.6% [53.6, 65.4] | 96/265 = 36.2% [30.7, 42.2] | 108/265 = 40.8% [35, 46.8] | 155/265 = 58.5% [52.5, 64.3] | 31/265 = 11.7% [8.4, 16.1] | 31/265 = 11.7% [8.4, 16.1] | 265/265 = 100% [98.6, 100] | 666/5855 = 11.4% [10.6, 12.2] | - | 0/265 = 0% [0, 1.4] | 186/265 = 70.2% [64.4, 75.4] |


### K3 long identity paragraphs (every sentence works), whole-paragraph mode (comparison)

| arm | (a) sentences analysis-correct, local only | (b) sentences analysis-correct, with judge | (a) paragraphs analysis-correct, local only | (b) paragraphs analysis-correct, with judge | (a) paragraphs local-only analysis AND meaning kept | (b) paragraphs analysis AND meaning kept, with judges | meaning kept (b) | text unchanged | same analysis as the input | pronouns kept | clean sentences changed (text scorer) | bad sentences fixed to the expected wording (text scorer) | runaway | sentence count equals expected |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| no rewrite | 5764/5804 = 99.3% [99.1, 99.5] | 5747/5804 = 99% [98.7, 99.2] | 229/265 = 86.4% [81.8, 90] | 216/265 = 81.5% [76.4, 85.7] | 229/265 = 86.4% [81.8, 90] | 216/265 = 81.5% [76.4, 85.7] | 265/265 = 100% [98.6, 100] | 265/265 = 100% [98.6, 100] | 265/265 = 100% [98.6, 100] | 265/265 = 100% [98.6, 100] | 0/5855 = 0% [0, 0.1] | - | 0/265 = 0% [0, 1.4] | 265/265 = 100% [98.6, 100] |
| untrained base | 2686/4680 = 57.4% [56, 58.8] | 2535/4680 = 54.2% [52.7, 55.6] | 35/265 = 13.2% [9.7, 17.8] | 35/265 = 13.2% [9.7, 17.8] | 0/265 = 0% [0, 1.4] | 0/265 = 0% [0, 1.4] | 2/265 = 0.8% [0.2, 2.7] | 0/265 = 0% [0, 1.4] | 0/265 = 0% [0, 1.4] | 265/265 = 100% [98.6, 100] | 1810/5855 = 30.9% [29.7, 32.1] | - | 0/265 = 0% [0, 1.4] | 15/265 = 5.7% [3.5, 9.1] |
| iteration 1 | 5959/6043 = 98.6% [98.3, 98.9] | 5930/6043 = 98.1% [97.8, 98.4] | 201/265 = 75.8% [70.4, 80.6] | 186/265 = 70.2% [64.4, 75.4] | 117/265 = 44.2% [38.3, 50.2] | 130/265 = 49.1% [43.1, 55] | 170/265 = 64.2% [58.2, 69.7] | 82/265 = 30.9% [25.7, 36.7] | 110/265 = 41.5% [35.7, 47.5] | 265/265 = 100% [98.6, 100] | 438/5855 = 7.5% [6.8, 8.2] | - | 0/265 = 0% [0, 1.4] | 176/265 = 66.4% [60.5, 71.8] |
| iteration 2 | 8203/8362 = 98.1% [97.8, 98.4] | 8148/8362 = 97.4% [97.1, 97.8] | 205/265 = 77.4% [71.9, 82] | 185/265 = 69.8% [64, 75] | 95/265 = 35.8% [30.3, 41.8] | 91/265 = 34.3% [28.9, 40.2] | 106/265 = 40% [34.3, 46] | 91/265 = 34.3% [28.9, 40.2] | 91/265 = 34.3% [28.9, 40.2] | 265/265 = 100% [98.6, 100] | 1765/5855 = 30.1% [29, 31.3] | - | 0/265 = 0% [0, 1.4] | 132/265 = 49.8% [43.8, 55.8] |


### K5 pronoun references (the later sentence refers by pronoun), per-sentence mode (ALL sentences sent)

| arm | (a) sentences analysis-correct, local only | (b) sentences analysis-correct, with judge | (a) paragraphs analysis-correct, local only | (b) paragraphs analysis-correct, with judge | (a) paragraphs local-only analysis AND meaning kept | (b) paragraphs analysis AND meaning kept, with judges | meaning kept (b) | text unchanged | same analysis as the input | pronouns kept | clean sentences changed (text scorer) | bad sentences fixed to the expected wording (text scorer) | runaway | sentence count equals expected |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| no rewrite | 299/305 = 98% [95.8, 99.1] | 295/305 = 96.7% [94.1, 98.2] | 96/102 = 94.1% [87.8, 97.3] | 92/102 = 90.2% [82.9, 94.6] | 96/102 = 94.1% [87.8, 97.3] | 92/102 = 90.2% [82.9, 94.6] | 102/102 = 100% [96.4, 100] | 102/102 = 100% [96.4, 100] | 102/102 = 100% [96.4, 100] | 102/102 = 100% [96.4, 100] | 0/306 = 0% [0, 1.2] | - | 0/102 = 0% [0, 3.6] | 102/102 = 100% [96.4, 100] |
| untrained base | 322/449 = 71.7% [67.4, 75.7] | 295/449 = 65.7% [61.2, 69.9] | 36/102 = 35.3% [26.7, 44.9] | 30/102 = 29.4% [21.4, 38.9] | 0/102 = 0% [0, 3.6] | 0/102 = 0% [0, 3.6] | 0/102 = 0% [0, 3.6] | 0/102 = 0% [0, 3.6] | 0/102 = 0% [0, 3.6] | 72/102 = 70.6% [61.1, 78.6] | 288/306 = 94.1% [90.9, 96.2] | - | 9/102 = 8.8% [4.7, 15.9] | 56/102 = 54.9% [45.2, 64.2] |
| iteration 1 | 293/308 = 95.1% [92.1, 97] | 288/308 = 93.5% [90.2, 95.8] | 87/102 = 85.3% [77.1, 90.9] | 83/102 = 81.4% [72.7, 87.7] | 67/102 = 65.7% [56.1, 74.2] | 69/102 = 67.6% [58.1, 75.9] | 79/102 = 77.5% [68.4, 84.5] | 61/102 = 59.8% [50.1, 68.8] | 62/102 = 60.8% [51.1, 69.7] | 102/102 = 100% [96.4, 100] | 47/306 = 15.4% [11.8, 19.8] | - | 0/102 = 0% [0, 3.6] | 99/102 = 97.1% [91.7, 99] |
| iteration 2 | 303/310 = 97.7% [95.4, 98.9] | 298/310 = 96.1% [93.4, 97.8] | 96/102 = 94.1% [87.8, 97.3] | 91/102 = 89.2% [81.7, 93.9] | 86/102 = 84.3% [76, 90.1] | 87/102 = 85.3% [77.1, 90.9] | 97/102 = 95.1% [89, 97.9] | 68/102 = 66.7% [57.1, 75.1] | 68/102 = 66.7% [57.1, 75.1] | 102/102 = 100% [96.4, 100] | 41/306 = 13.4% [10, 17.7] | - | 0/102 = 0% [0, 3.6] | 99/102 = 97.1% [91.7, 99] |


### K5 pronoun references (the later sentence refers by pronoun), whole-paragraph mode (comparison)

| arm | (a) sentences analysis-correct, local only | (b) sentences analysis-correct, with judge | (a) paragraphs analysis-correct, local only | (b) paragraphs analysis-correct, with judge | (a) paragraphs local-only analysis AND meaning kept | (b) paragraphs analysis AND meaning kept, with judges | meaning kept (b) | text unchanged | same analysis as the input | pronouns kept | clean sentences changed (text scorer) | bad sentences fixed to the expected wording (text scorer) | runaway | sentence count equals expected |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| no rewrite | 299/305 = 98% [95.8, 99.1] | 295/305 = 96.7% [94.1, 98.2] | 96/102 = 94.1% [87.8, 97.3] | 92/102 = 90.2% [82.9, 94.6] | 96/102 = 94.1% [87.8, 97.3] | 92/102 = 90.2% [82.9, 94.6] | 102/102 = 100% [96.4, 100] | 102/102 = 100% [96.4, 100] | 102/102 = 100% [96.4, 100] | 102/102 = 100% [96.4, 100] | 0/306 = 0% [0, 1.2] | - | 0/102 = 0% [0, 3.6] | 102/102 = 100% [96.4, 100] |
| untrained base | 116/161 = 72% [64.7, 78.4] | 111/161 = 68.9% [61.4, 75.6] | 72/102 = 70.6% [61.1, 78.6] | 70/102 = 68.6% [59.1, 76.8] | 0/102 = 0% [0, 3.6] | 0/102 = 0% [0, 3.6] | 0/102 = 0% [0, 3.6] | 0/102 = 0% [0, 3.6] | 0/102 = 0% [0, 3.6] | 15/102 = 14.7% [9.1, 22.9] | 134/306 = 43.8% [38.3, 49.4] | - | 2/102 = 2% [0.5, 6.9] | 9/102 = 8.8% [4.7, 15.9] |
| iteration 1 | 296/306 = 96.7% [94.1, 98.2] | 293/306 = 95.8% [92.9, 97.5] | 92/102 = 90.2% [82.9, 94.6] | 89/102 = 87.3% [79.4, 92.4] | 82/102 = 80.4% [71.6, 86.9] | 84/102 = 82.4% [73.8, 88.5] | 94/102 = 92.2% [85.3, 96] | 85/102 = 83.3% [74.9, 89.3] | 85/102 = 83.3% [74.9, 89.3] | 98/102 = 96.1% [90.3, 98.5] | 18/306 = 5.9% [3.8, 9.1] | - | 0/102 = 0% [0, 3.6] | 100/102 = 98% [93.1, 99.5] |
| iteration 2 | 289/295 = 98% [95.6, 99.1] | 285/295 = 96.6% [93.9, 98.1] | 96/102 = 94.1% [87.8, 97.3] | 92/102 = 90.2% [82.9, 94.6] | 80/102 = 78.4% [69.5, 85.3] | 78/102 = 76.5% [67.4, 83.6] | 87/102 = 85.3% [77.1, 90.9] | 80/102 = 78.4% [69.5, 85.3] | 80/102 = 78.4% [69.5, 85.3] | 98/102 = 96.1% [90.3, 98.5] | 19/306 = 6.2% [4, 9.5] | - | 0/102 = 0% [0, 3.6] | 90/102 = 88.2% [80.6, 93.1] |


### Paired bootstrap over cases, iteration 2 minus iteration 1 / minus no rewrite

| suite | mode | share of output sentences analysis-correct, it2 - it1 | it2 - no rewrite | text and analysis unchanged, it2 - it1 | it2 - no rewrite |
| --- | --- | --- | --- | --- | --- |
| K2 | sentence | +5.2 pp [2.5, 7.9] | +10.6 pp [8.7, 12.6] | -10.8 pp [-17, -4.6] | -77.8 pp [-82.4, -73.2] |
| K2 | paragraph | -3 pp [-4.9, -0.9] | +3.4 pp [1.5, 5.3] | -2.3 pp [-9.2, 4.9] | -57.2 pp [-62.7, -51.6] |
| K3 | sentence | +1.8 pp [0.6, 3] | -1.7 pp [-2.6, -1.1] | -1.9 pp [-6.4, 2.6] | -88.3 pp [-92.1, -84.5] |
| K3 | paragraph | -0.4 pp [-1.6, 0.8] | -1.3 pp [-2.4, -0.6] | +3.4 pp [-3.8, 10.9] | -65.7 pp [-71.3, -59.6] |
| K5 | sentence | +1.8 pp [-1.2, 4.5] | -0.2 pp [-1.6, 1.2] | +6.9 pp [-5.9, 18.6] | -33.3 pp [-42.2, -24.5] |
| K5 | paragraph | +1.7 pp [-0.4, 4.5] | +0 pp [-1.6, 1.6] | -4.9 pp [-15.7, 5.9] | -21.6 pp [-29.4, -13.7] |


### K6 decomposition (16 cases: one tangled message that must become several short sentences)

| arm and mode | output changed | sentence count equals expected | sentence count at least expected | every sentence within the contract (one clause, explicit subject) | one-clause output sentences | explicit-subject output sentences | all output sentences analysis-correct (paragraph) | ... AND meaning kept | names preserved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| no rewrite, per sentence, all sent | 0/16 = 0% [0, 19.4] | 0/16 = 0% [0, 19.4] | 0/16 = 0% [0, 19.4] | 0/16 = 0% [0, 19.4] | 0/16 = 0% [0, 19.4] | 16/16 = 100% [80.6, 100] | 4/16 = 25% [10.2, 49.5] | 4/16 = 25% [10.2, 49.5] | 33/33 = 100% [89.6, 100] |
| no rewrite, whole message | 0/16 = 0% [0, 19.4] | 0/16 = 0% [0, 19.4] | 0/16 = 0% [0, 19.4] | 0/16 = 0% [0, 19.4] | 0/16 = 0% [0, 19.4] | 16/16 = 100% [80.6, 100] | 4/16 = 25% [10.2, 49.5] | 4/16 = 25% [10.2, 49.5] | 33/33 = 100% [89.6, 100] |
| untrained base, per sentence, all sent | 16/16 = 100% [80.6, 100] | 1/16 = 6.3% [1.1, 28.3] | 3/16 = 18.8% [6.6, 43] | 6/16 = 37.5% [18.5, 61.4] | 23/39 = 59% [43.4, 72.9] | 34/39 = 87.2% [73.3, 94.4] | 7/16 = 43.8% [23.1, 66.8] | 0/16 = 0% [0, 19.4] | 13/33 = 39.4% [24.7, 56.3] |
| untrained base, whole message | 16/16 = 100% [80.6, 100] | 1/16 = 6.3% [1.1, 28.3] | 3/16 = 18.8% [6.6, 43] | 6/16 = 37.5% [18.5, 61.4] | 23/39 = 59% [43.4, 72.9] | 34/39 = 87.2% [73.3, 94.4] | 7/16 = 43.8% [23.1, 66.8] | 0/16 = 0% [0, 19.4] | 13/33 = 39.4% [24.7, 56.3] |
| iteration 1, per sentence, all sent | 2/16 = 12.5% [3.5, 36] | 0/16 = 0% [0, 19.4] | 0/16 = 0% [0, 19.4] | 0/16 = 0% [0, 19.4] | 0/16 = 0% [0, 19.4] | 16/16 = 100% [80.6, 100] | 3/16 = 18.8% [6.6, 43] | 3/16 = 18.8% [6.6, 43] | 32/33 = 97% [84.7, 99.5] |
| iteration 1, whole message | 2/16 = 12.5% [3.5, 36] | 0/16 = 0% [0, 19.4] | 0/16 = 0% [0, 19.4] | 0/16 = 0% [0, 19.4] | 0/16 = 0% [0, 19.4] | 16/16 = 100% [80.6, 100] | 3/16 = 18.8% [6.6, 43] | 3/16 = 18.8% [6.6, 43] | 32/33 = 97% [84.7, 99.5] |
| iteration 2, per sentence, all sent | 10/16 = 62.5% [38.6, 81.5] | 5/16 = 31.3% [14.2, 55.6] | 7/16 = 43.8% [23.1, 66.8] | 6/16 = 37.5% [18.5, 61.4] | 16/35 = 45.7% [30.5, 61.8] | 34/35 = 97.1% [85.5, 99.5] | 8/16 = 50% [28, 72] | 6/16 = 37.5% [18.5, 61.4] | 31/33 = 93.9% [80.4, 98.3] |
| iteration 2, whole message | 10/16 = 62.5% [38.6, 81.5] | 5/16 = 31.3% [14.2, 55.6] | 7/16 = 43.8% [23.1, 66.8] | 6/16 = 37.5% [18.5, 61.4] | 16/35 = 45.7% [30.5, 61.8] | 34/35 = 97.1% [85.5, 99.5] | 8/16 = 50% [28, 72] | 6/16 = 37.5% [18.5, 61.4] | 31/33 = 93.9% [80.4, 98.3] |

