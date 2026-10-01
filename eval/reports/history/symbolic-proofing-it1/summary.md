# SymbolicProofingLLM iteration 1 (pilot): Gemma 3 270M IT + LoRA on neuro_english/proofing

Generated from `eval/reports/current/symbolic-proofing-it1/` by the evaluation run of `train-symbolic-proofing-gemma270m-it1` (preregistration `status/preregistrations/train-symbolic-proofing-gemma270m-it1.json`). Regenerable observation, not product documentation.

**This is a PILOT on the old split.** The 895 training pairs, the 102 dev pairs and the 95 sealed pairs come from the neuro_english / symbolic_english split that used the SOP match as a proxy for "SymbolicLM does not understand this sentence" (journal incident of 2026-09-30, "symbolic/neuro split used SOP match instead of the grammatical analysis"). About 3,700 neuro rows probably have a correct grammatical analysis and fail only in the SOP layer; a repair pair whose source row failed only in the SOP layer (failure_kind `rules` or `gold_convention`) probably never needed a rewrite at the analysis layer. 54 of the 57 sealed repair pairs are of that kind (`rules`); see the breakdown below. Iteration 2 is built on the new split. No data was rebuilt by this run.

Owner direction of 2026-09-30 (binding for this run): one layer at a time; the PRIMARY metrics are the grammatical analysis and the meaning, the SOP gold match is reported as a SECONDARY column only and was not used to select the checkpoint or to state the verdict.

## Identity and data

- Run: `symbolic-proofing-gemma270m-it1`, role `proofreader`, model `daniel-dona/gemma-3-270m-it` revision `99073d6b6edb0e298d163f964ec2b9d970b3408d` (byte-identical mirror of google/gemma-3-270m-it `ac82b4e8...`), LoRA rank 16 / alpha 32 / dropout 0.05, lr 2e-4, batch 2 x accumulation 8, 3 epochs = 168 optimizer steps, seed 42, recipe `config/train-gemma.json` sha256 `ecc7fe04...` (unchanged from `proofreader-gemma270m-v1`). Training took 114 s (Podman job `symproof-it1-train-a`, NVIDIA GB10), finished 2026-09-30T19:49:55Z. Checkpoints: `models/gemma/symbolic-proofing-gemma270m-it1/proofreader/` (`epoch-1..3`, `best` = epoch 1 by dev loss, `latest`, `merged-epoch-N`, `gguf/ep3-q8_0.gguf`, `gguf/base-q8_0.gguf`).
- Data: `datasets/neuro_english/proofing` manifest sha256 `f2955e0b82a34bef24248a376af07c0db4f620949ff1c208ff60d1d0fc38fe40`, version `2026-09-30-65a44625`; train 895 pairs (471 repair, 424 identity), dev 102 (56 repair, 46 identity); qualification `status/training/qualification-neuro-proofing.json` (experiment-grade, automated oracle grounding, no human review); authorization receipt `status/training/authorization-gemma-symbolic-proofing-gemma270m-it1.json`.
- Sealed pair test `eval/suites/neuro_english/proofing-test.jsonl` (95 pairs: 57 repair, 38 identity) sha256 `0145eb48...`; composed suites sha256 `37b73c7e...` (neuro), `6155b5c6...` (symbolic); the hashes scored equal the preregistered ones.
- Engine for the oracle side: SymbolicLM FINAL engine (Stanza accurate package, frozen rules ud-rules-v2.5), result-cache id `stanza-1.10.1/en:...electra-large|4b33d72253ac`.
- Analysis gate (calibrated, owner direction): a sentence passes when the Stanza default and accurate trees are identical AND the DeepSeek judge conditions a and c both say good enough (CORRECT, MINOR, INPUT_TYPO); a text passes when every sentence passes. Judge folder `datasets_sources/symbolic_proofing_parse_judge/` (9,166 items, 0 unresolved; earlier verdicts of `datasets_sources/neuro_oracle_parse_judge/` reused). Code: `tools/eval/analysis-layer.mjs`, `tools/eval/symbolic-proofing-eval.mjs`.
- Meaning (b): mechanical checks only (names, numbers, negation, quantifiers, question mark, non-empty). The DeepSeek meaning judge is not calibrated (precision 0.53, `trusted: false`), so it was not run. The mechanical check is conservative: it also flags legitimate rewrites that drop a quantifier word (`all`, `both`, `only`) together with a lead-in or when a sentence is split, so "meaning ok" is a lower bound. Identity (c): the analysis signature (non-punctuation tokens with part of speech, relation and head word, per sentence) of the output equals the one of the input.
- Baselines on the same sets and prompt: `identity` (no rewrite) and `base` (the untrained gemma-3-270m-it, same message-only chat prompt, greedy).
- Intervals: Wilson 95% on rates, paired bootstrap 95% (10,000 resamples, seed 7, `tools/research/proofing.mjs bootstrap`) on differences. Small n means wide intervals; read every number with its count.

## 1. Checkpoint selection on dev (analysis layer, 102 pairs: 56 repair, 46 identity)

Selection rule (deviation D3 of the preregistration, replacing the SOP-based rule by the owner direction): the highest share of dev repair outputs with correct analysis AND meaning ok, among the epochs whose dev identity analysis-change rate is at most 10%. Dev loss by epoch: 0.1964 / 0.2043 / 0.2003 (minimum at epoch 1, then flat: plateau).

| run | repair: output analysis correct and meaning ok | repair: fixed of failing inputs | identity: analysis changed | identity: text changed | secondary: SOP accepted (repair) | secondary: SOP identity break |
| --- | --- | --- | --- | --- | --- | --- |
| no rewrite | 11/56 = 19.6% [11.3, 31.8] | 0/45 = 0% [0, 7.9] | 0/46 = 0% [0, 7.7] | 0/46 = 0% [0, 7.7] | 1/56 = 1.8% [0.3, 9.4] | 0/46 = 0% [0, 7.7] |
| untrained base | 3/56 = 5.4% [1.8, 14.6] | 1/45 = 2.2% [0.4, 11.6] | 46/46 = 100% [92.3, 100] | 46/46 = 100% [92.3, 100] | 0/56 = 0% [0, 6.4] | 39/46 = 84.8% [71.8, 92.4] |
| epoch 1 | 19/56 = 33.9% [22.9, 47] | 12/45 = 26.7% [16, 41] | 8/46 = 17.4% [9.1, 30.7] | 11/46 = 23.9% [13.9, 37.9] | 21/56 = 37.5% [26, 50.6] | 6/46 = 13% [6.1, 25.7] |
| epoch 2 | 18/56 = 32.1% [21.4, 45.2] | 11/45 = 24.4% [14.2, 38.7] | 3/46 = 6.5% [2.2, 17.5] | 6/46 = 13% [6.1, 25.7] | 27/56 = 48.2% [35.7, 61] | 2/46 = 4.3% [1.2, 14.5] |
| epoch 3 (selected) | 19/56 = 33.9% [22.9, 47] | 11/45 = 24.4% [14.2, 38.7] | 3/46 = 6.5% [2.2, 17.5] | 7/46 = 15.2% [7.6, 28.2] | 27/56 = 48.2% [35.7, 61] | 2/46 = 4.3% [1.2, 14.5] |

Epoch 1 is excluded by the identity rule (17.4% changed); epochs 2 and 3 are within one row of each other (32.1% vs 33.9%); epoch 3 is selected. The SOP-based rule of the preregistration also selects epoch 3 (equal accepted repair, lower dev loss than epoch 2). Early-stopping rules of the preregistration did not trip (no identity collapse, 1-2% empty/capped outputs, identity break under 20%); dev loss plateaued so the conditional longer attempt B was not run. Dev overfits quickly: the lowest dev loss is at epoch 1.

## 2. Sealed pair test (95 pairs), HF bf16 greedy, epoch 3

PRIMARY, repair pairs (57):

| metric | no rewrite | untrained base | fine-tuned (ep3) |
| --- | --- | --- | --- |
| input analysis correct (reference) | 7/57 = 12.3% [6.1, 23.2] | 7/57 = 12.3% [6.1, 23.2] | 7/57 = 12.3% [6.1, 23.2] |
| verified target passes the same gate (ceiling) | 24/57 = 42.1% [30.2, 55] | 24/57 = 42.1% [30.2, 55] | 24/57 = 42.1% [30.2, 55] |
| output analysis correct | 7/57 = 12.3% [6.1, 23.2] | 22/57 = 38.6% [27.1, 51.6] | 22/57 = 38.6% [27.1, 51.6] |
| output meaning ok (mechanical) | 57/57 = 100% [93.7, 100] | 3/57 = 5.3% [1.8, 14.4] | 37/57 = 64.9% [51.9, 76] |
| output analysis correct AND meaning ok | 7/57 = 12.3% [6.1, 23.2] | 1/57 = 1.8% [0.3, 9.3] | 14/57 = 24.6% [15.2, 37.1] |
| fixed, of the inputs whose analysis was not correct | 0/50 = 0% [0, 7.1] | 1/50 = 2% [0.4, 10.5] | 8/50 = 16% [8.3, 28.5] |
| worse than input, of the inputs whose analysis was correct | 0/7 = 0% [0, 35.4] | 5/7 = 71.4% [35.9, 91.8] | 1/7 = 14.3% [2.6, 51.3] |
| output equals the verified target text | 0/57 = 0% [0, 6.3] | 0/57 = 0% [0, 6.3] | 16/57 = 28.1% [18.1, 40.8] |
| output left unchanged | 57/57 = 100% [93.7, 100] | 0/57 = 0% [0, 6.3] | 6/57 = 10.5% [4.9, 21.1] |

PRIMARY, identity pairs (38):

| metric | no rewrite | untrained base | fine-tuned (ep3) |
| --- | --- | --- | --- |
| analysis of the output differs from the input (identity break, analysis layer) | 0/38 = 0% [0, 9.2] | 38/38 = 100% [90.8, 100] | 4/38 = 10.5% [4.2, 24.1] |
| pairs whose input passes the gate (working sentences) | 18 | 18 | 18 |
|   of those: analysis changed | 0/18 = 0% [0, 17.6] | 18/18 = 100% [82.4, 100] | 2/18 = 11.1% [3.1, 32.8] |
|   of those: output no longer analysis-correct | 0/18 = 0% [0, 17.6] | 4/18 = 22.2% [9, 45.2] | 1/18 = 5.6% [1, 25.8] |
| text changed | 0/38 = 0% [0, 9.2] | 38/38 = 100% [90.8, 100] | 5/38 = 13.2% [5.8, 27.3] |
| meaning check failed (mechanical) | 0/38 = 0% [0, 9.2] | 32/38 = 84.2% [69.6, 92.6] | 0/38 = 0% [0, 9.2] |

Paired bootstrap (fine-tuned minus comparison), repair good = analysis correct and meaning ok; identity = same analysis as input (`eval/reports/current/symbolic-proofing-it1/bootstrap-compare.txt`):

- sealed repair, ep3 vs no rewrite: +12.3 pp [3.5, 22.8]; ep3 vs untrained base: +22.8 pp [10.5, 35.1].
- sealed identity (kept analysis), ep3 vs no rewrite: -10.5 pp [-21.1, -2.6]; ep3 vs untrained base: +89.5 pp [78.9, 97.4].
- dev repair, ep3 vs no rewrite: +14.3 pp [1.8, 26.8]; vs base +28.6 pp [16.1, 41.1]; dev identity, ep3 vs no rewrite -6.5 pp [-15.2, 0.0].

Breakdown of the 57 repair pairs by the failure kind of the source row (old SOP-proxy split):

| source failure_kind | pairs | input analysis correct | fine-tuned output analysis correct and meaning ok | fixed of failing inputs | secondary: SOP accepted |
| --- | --- | --- | --- | --- | --- |
| parser_or_unknown (SOP-proxy split) | 3 | 1/3 = 33.3% [6.1, 79.2] | 2/3 = 66.7% [20.8, 93.9] | 1/2 = 50% [9.5, 90.5] | 1/3 = 33.3% [6.1, 79.2] |
| rules_or_convention (SOP-proxy split) | 54 | 6/54 = 11.1% [5.2, 22.2] | 12/54 = 22.2% [13.2, 34.9] | 7/48 = 14.6% [7.2, 27.2] | 27/54 = 50% [37.1, 62.9] |

`rules_or_convention` (54 of 57) are pairs whose source row failed only in the SOP layer. The paragraph-level gate does not tell us whether they needed a rewrite: it rejects 48 of those 54 inputs (all sentences of a multi-sentence input must pass), and it also rejects the verified target of 33 of the 57 pairs (the target passes for 24), so the gate is a hard ceiling here and a failing input is not evidence of a wrong analysis. A sentence-level check of the source rows is the job of the new split. `parser_or_unknown` has 3 pairs: no statement is possible.

SECONDARY (SOP layer, not used for selection or verdict), sealed pairs:

| metric | no rewrite | untrained base | fine-tuned (ep3) |
| --- | --- | --- | --- |
| repair: SOP matches the gold, strict | 0/57 = 0% [0, 6.3] | 0/57 = 0% [0, 6.3] | 25/57 = 43.9% [31.8, 56.7] |
| repair: SOP matches the gold, frame-normalized | 1/57 = 1.8% [0.3, 9.3] | 0/57 = 0% [0, 6.3] | 29/57 = 50.9% [38.3, 63.4] |
| repair: SOP equals the SOP of the verified target | 0/57 = 0% [0, 6.3] | 0/57 = 0% [0, 6.3] | 28/57 = 49.1% [36.6, 61.7] |
| identity: break (SOP no longer matches, strict) | 0/38 = 0% [0, 9.2] | 33/38 = 86.8% [72.7, 94.2] | 2/38 = 5.3% [1.5, 17.3] |
| identity: break, frame-normalized | 0/38 = 0% [0, 9.2] | 33/38 = 86.8% [72.7, 94.2] | 2/38 = 5.3% [1.5, 17.3] |
| all pairs: SymbolicLM parses the output with no unparsed span and a valid SOP | 62/95 = 65.3% [55.3, 74.1] | 61/95 = 64.2% [54.2, 73.1] | 68/95 = 71.6% [61.8, 79.7] |
| empty or length-capped outputs | 0/95 = 0% [0, 3.9] | 3/95 = 3.2% [1.1, 8.9] | 2/95 = 2.1% [0.6, 7.4] |

Decomposition rows of the sealed pairs (17, SOP accepted: no rewrite 0/17 = 0% [0, 18.4], fine-tuned 6/17 = 35.3% [17.3, 58.7]); long rows of 500 tokens or more (13): fine-tuned accepted 1/13 = 7.7% [1.4, 33.3].

## 3. Break rate on 300 random symbolic_english dev messages (messages SymbolicLM already handles)

Frozen sample `eval/reports/current/symbolic-proofing-it1/inputs-sym300.jsonl` (sha256 `d6b9b6ba...`, seed 20260930; `datasets/symbolic_english/dev.jsonl` was rebuilt by another agent afterwards, so the sample file, not the dev file, is the evaluated set).

| metric | no rewrite | untrained base | fine-tuned (ep3) |
| --- | --- | --- | --- |
| PRIMARY: analysis of the output differs from the input | 0/300 = 0% [0, 1.3] | 294/300 = 98% [95.7, 99.1] | 64/300 = 21.3% [17.1, 26.3] |
| messages whose input passes the gate | 170 | 170 | 170 |
| PRIMARY: of those, analysis changed | 0/170 = 0% [0, 2.2] | 165/170 = 97.1% [93.3, 98.7] | 38/170 = 22.4% [16.7, 29.2] |
| PRIMARY: of those, output no longer analysis-correct | 0/170 = 0% [0, 2.2] | 36/170 = 21.2% [15.7, 27.9] | 4/170 = 2.4% [0.9, 5.9] |
| text changed | 0/300 = 0% [0, 1.3] | 294/300 = 98% [95.7, 99.1] | 71/300 = 23.7% [19.2, 28.8] |
| meaning check failed (mechanical) | 0/300 = 0% [0, 1.3] | 236/300 = 78.7% [73.7, 82.9] | 7/300 = 2.3% [1.1, 4.7] |
| SECONDARY: SOP of the output differs from the SOP of the message (strict) | 0/300 = 0% [0, 1.3] | 274/300 = 91.3% [87.6, 94] | 25/300 = 8.3% [5.7, 12] |

Paired bootstrap, ep3 vs no rewrite (kept analysis): -21.3 pp [-26.0, -16.7]. **The preregistered bound (break rate <= 1% on this sample) is not met**: the fine-tuned model changes 23.7% of messages that SymbolicLM already handles. Most changes are simplifications the training data asked for (dropping `Also,` / `Quick question:`, turning `X, right?` into a question, replacing a pronoun by the name, reordering the clause), which keep the gate and the meaning in 97.6% of the working messages (4 of 170 no longer analysis-correct) but change the SOP in 8.3%; a minority change the meaning (for example a hallucinated `If you know who grows peppers, then you know who grows them.` and a swapped subject and object in `Not counting Otilia, please find out who Nordwind Systems employs.`).

## 4. Composed suites (GGUF Q8_0 through llama-server on the GPU, prompt cache off; per-sentence mode is the intended design)

Per-sentence mode: host splitter, SymbolicLM gate (`symbolic`: a sentence goes to the rewriter when SymbolicLM does not handle it alone), the rewriter sees only those sentences. Whole-paragraph mode: the rewriter gets the paragraph. Runs: `eval/reports/current/symbolic-proofing-it1/composed/` (records per case, analysis files `analysis__*.json`). Whole-paragraph "analysis correct" requires every sentence of the paragraph to pass, which is rare even for the expected text, so the per-sentence rate is the informative column.

### 4a. K2 mixed paragraphs (306 cases: bad and clean sentences mixed, 2 to 16 sentences)

| run | sentences analysis-correct in the output | paragraphs analysis-correct | output analysis correct and meaning ok (paragraphs) | text unchanged | count of sentences equals expected | one-clause sentences (expected text: 60.8%) |
| --- | --- | --- | --- | --- | --- | --- |
| no rewrite, sentence | 766/1610 = 47.6% [45.1, 50] | 10/306 = 3.3% [1.8, 5.9] | 10/306 = 3.3% [1.8, 5.9] | 306/306 = 100% [98.8, 100] | 124/306 = 40.5% [35.2, 46.1] | 768/1610 = 47.7% [45.3, 50.1] |
| untrained base, sentence | 891/1691 = 52.7% [50.3, 55.1] | 17/306 = 5.6% [3.5, 8.7] | 6/306 = 2% [0.9, 4.2] | 68/306 = 22.2% [17.9, 27.2] | 93/306 = 30.4% [25.5, 35.8] | 713/1691 = 42.2% [39.8, 44.5] |
| fine-tuned ep3, sentence | 774/1617 = 47.9% [45.4, 50.3] | 11/306 = 3.6% [2, 6.3] | 11/306 = 3.6% [2, 6.3] | 244/306 = 79.7% [74.9, 83.9] | 127/306 = 41.5% [36.1, 47.1] | 777/1617 = 48.1% [45.6, 50.5] |
| no rewrite, paragraph | 766/1610 = 47.6% [45.1, 50] | 10/306 = 3.3% [1.8, 5.9] | 10/306 = 3.3% [1.8, 5.9] | 306/306 = 100% [98.8, 100] | 124/306 = 40.5% [35.2, 46.1] | 768/1610 = 47.7% [45.3, 50.1] |
| untrained base, paragraph | 483/954 = 50.6% [47.5, 53.8] | 134/306 = 43.8% [38.3, 49.4] | 0/306 = 0% [0, 1.2] | 0/306 = 0% [0, 1.2] | 8/306 = 2.6% [1.3, 5.1] | 465/954 = 48.7% [45.6, 51.9] |
| fine-tuned ep3, paragraph | 1072/1865 = 57.5% [55.2, 59.7] | 16/306 = 5.2% [3.2, 8.3] | 13/306 = 4.2% [2.5, 7.1] | 142/306 = 46.4% [40.9, 52] | 154/306 = 50.3% [44.8, 55.9] | 1024/1865 = 54.9% [52.6, 57.2] |
| reference: the expected text | 1438/2072 = 69.4% [67.4, 71.3] | 46/306 = 15% [11.5, 19.5] | - | - | - | 1259/2072 = 60.8% [58.6, 62.8] |

Paired bootstrap over cases, sentence-level analysis-correct rate: per-sentence mode, ft vs no rewrite +0.3 pp [-3.1, 3.7], ft vs base -4.8 pp [-8.1, -1.6]; whole-paragraph mode, ft vs no rewrite +9.9 pp [6.5, 13.2], ft vs base +6.9 pp [2.5, 11.1].

Text-level scorer of the composed evaluation (SECONDARY: alignment with the expected text, `summary.json` files): ft per-sentence mode sent 384 of 1,665 sentences (23.1%) to the rewriter (gate recall on the sentences that need a change 40.7%), changed 1 of 986 clean sentences (0.1%), matched the expected wording for 0 of 578 bad sentences and rewrote 66 (11.4%) in another way; whole-paragraph mode changed 34 of 986 clean sentences (3.4%), fixed 34 of 578 (5.9%), added text in 76 of 306 paragraphs (24.8%). Untrained base, whole-paragraph: dropped 54% of the components and changed 33% of the clean sentences.

### 4b. K3 long identity (289 cases, 2 to 24 working sentences, all pass SymbolicLM)

| run | text unchanged | same analysis as the input (identity kept) | sentences analysis-correct | output analysis correct and meaning ok |
| --- | --- | --- | --- | --- |
| no rewrite, sentence | 289/289 = 100% [98.7, 100] | 289/289 = 100% [98.7, 100] | 3302/5827 = 56.7% [55.4, 57.9] | 18/289 = 6.2% [4, 9.6] |
| untrained base, sentence | 289/289 = 100% [98.7, 100] | 289/289 = 100% [98.7, 100] | 3302/5827 = 56.7% [55.4, 57.9] | 18/289 = 6.2% [4, 9.6] |
| fine-tuned ep3, sentence | 289/289 = 100% [98.7, 100] | 289/289 = 100% [98.7, 100] | 3302/5827 = 56.7% [55.4, 57.9] | 18/289 = 6.2% [4, 9.6] |
| no rewrite, paragraph | 289/289 = 100% [98.7, 100] | 289/289 = 100% [98.7, 100] | 3302/5827 = 56.7% [55.4, 57.9] | 18/289 = 6.2% [4, 9.6] |
| untrained base, paragraph | 0/289 = 0% [0, 1.3] | 1/289 = 0.3% [0.1, 1.9] | 2263/4995 = 45.3% [43.9, 46.7] | 0/289 = 0% [0, 1.3] |
| fine-tuned ep3, paragraph | 139/289 = 48.1% [42.4, 53.8] | 167/289 = 57.8% [52, 63.3] | 3476/6021 = 57.7% [56.5, 59] | 14/289 = 4.8% [2.9, 8] |

In the intended per-sentence mode the symbolic gate sends none of the 5,879 working sentences to the rewriter (gate 0/5,879), so the long-identity result is unchanged by construction; the gate is what protects the working sentences. Whole-paragraph mode breaks half of them: 48.1% unchanged, 57.8% same analysis, 10.7% of paragraphs get added text (text scorer: 5.3% of clean sentences changed).

### 4c. K6 decomposition (16 cases: one tangled message that must become several short sentences)

| run | output changed | sentence count equals expected | every sentence within the one-clause/explicit-subject contract | all output sentences analysis-correct (paragraph) | names preserved |
| --- | --- | --- | --- | --- | --- |
| no rewrite | 0/16 = 0% [0, 19.4] | 0/16 = 0% [0, 19.4] | 0/16 = 0% [0, 19.4] | 4/16 = 25% [10.2, 49.5] | 33/33 = 100% [89.6, 100] |
| untrained base | 16/16 = 100% [80.6, 100] | 1/16 = 6.3% [1.1, 28.3] | 6/16 = 37.5% [18.5, 61.4] | 7/16 = 43.8% [23.1, 66.8] | 13/33 = 39.4% [24.7, 56.3] |
| fine-tuned ep3 | 2/16 = 12.5% [3.5, 36] | 0/16 = 0% [0, 19.4] | 0/16 = 0% [0, 19.4] | 3/16 = 18.8% [6.6, 43] | 32/33 = 97% [84.7, 99.5] |

The fine-tuned model left 14 of 16 tangled messages untouched and never reached the expected sentence count (0/16); the two it changed only got commas, and one of them also lost a clause (`Georgiana checked out ...`). The untrained base changes every message but loses names (39%) and connectives (21%).

### 4d. Inputs longer than the training maximum (16 concatenations of sealed composed paragraphs, 8,600 to 10,900 characters, about 2,200 to 2,900 tokens; the longest training prompt is about 3,000 characters). HF bf16, whole-input mode

| metric | no rewrite | untrained base | fine-tuned (ep3) |
| --- | --- | --- | --- |
| 8 identity inputs: text changed | 0/8 = 0% [0, 32.4] | 8/8 = 100% [67.6, 100] | 8/8 = 100% [67.6, 100] |
| 8 identity inputs: analysis changed | 0/8 = 0% [0, 32.4] | 8/8 = 100% [67.6, 100] | 8/8 = 100% [67.6, 100] |
| 8 identity inputs: meaning check failed | 0/8 = 0% [0, 32.4] | 8/8 = 100% [67.6, 100] | 8/8 = 100% [67.6, 100] |
| all 16 inputs: output hit the generation cap (no end of turn) | 0/16 = 0% [0, 19.4] | 10/16 = 62.5% [38.6, 81.5] | 14/16 = 87.5% [64, 96.5] |
| 8 mixed inputs: output analysis correct and meaning ok | 0/8 = 0% [0, 32.4] | 0/8 = 0% [0, 32.4] | 0/8 = 0% [0, 32.4] |

The fine-tuned model copies the start of a long input correctly and then loops (repeating the last sentences until the cap); 14 of 16 outputs are capped and all 8 identity inputs are damaged. Whole long inputs are out of reach for this pilot; this is expected and does not matter for the per-sentence design, where every rewriter call sees one sentence.

## 5. GGUF Q8_0, agreement with HF, CPU speed

- Export: isolated venv `~/proofreader-export-venv`, the private llama.cpp converter copy that handles Gemma 3; the `<image_soft_token>` entry at id 262144 (present even in the untouched base) was removed from copies of the tokenizer files (`gguf-src/`), as in the earlier export. `gguf/ep3-q8_0.gguf` 285 MB, `gguf/base-q8_0.gguf`.
- HF greedy vs llama.cpp greedy on the first 50 dev rows: identical on 43/50 (CUDA llama-server) and 43/50 (CPU, 4 threads). The same 50 rows differ between HF bf16 and HF fp32 on 6/50 (identical 44/50), and llama.cpp Q8_0 agrees with HF fp32 on 44/50 (CPU) and 43/50 (GPU). The divergences are on long multi-sentence outputs (a comma or a clause in a long greedy decode) and are of the size of precision noise; the agreement claim of the earlier run (50/50) is not reproduced here and is not claimed. Sealed pair and dev numbers above are HF bf16; composed-suite numbers are GGUF.
- CPU speed, llama.cpp CPU, 4 threads, 30 sealed-test prompts under 1,200 characters: p50 209 ms per message, p90 1641 ms, mean 425 ms; 39.3 output tokens per message on average; server-reported generation speed p50 134.0 tokens/s (overall 92.6 tokens/s including prompt processing). Measured on the DGX Spark CPU while other agents were running, not on a laptop; the laptop requirement of AGENTS.md (30 to 40 tokens/s) concerns base models and is met with a large margin by a 270M model.

## 6. Error categories

Sealed repair pairs (57), fine-tuned ep3:

| category | pairs | of which the output equals the verified target text |
| --- | --- | --- |
| meaning check failed (mechanical; includes legitimate drops of `both`, `only`, lead-ins) | 20 | 6 |
| changed, analysis still not correct | 18 | 2 |
| good: analysis correct and meaning ok | 13 | 8 |
| left unchanged | 6 | 0 |

Of the 20 sealed repair outputs flagged by the mechanical meaning check, 15 are quantifier flags (a quantifier word such as `all` or `both` in a dropped lead-in or in a split sentence), 9 lost-name flags and 3 negation or question flags (one output can have several); 6 of the 20 equal the verified target text. Reading: 16 of the 57 outputs equal the verified target text, yet only 13 changed outputs (14 with one unchanged input that already passes) are counted good, because the gate itself rejects the analysis of 33 of the 57 verified targets (the ceiling of this gate on these pairs) and the mechanical meaning check is conservative. Both are properties of the measurement, not of the model.

Working messages (300 symbolic_english dev messages), fine-tuned ep3:

| category | messages |
| --- | --- |
| unchanged | 229 |
| reworded (same sentence count) | 53 |
| split into more sentences | 7 |
| meaning check failed | 6 |
| punctuation or case only | 5 |

Observed phenomena (from the outputs, not from a labelled audit):

1. Stripping of lead-ins and fillers (`Also,`, `Quick question:`, `Hi!`, `Sorry in advance`): learned, and mostly harmless; but it also fires on working messages.
2. Question normalisation (`X, right?` to `Is X ...?`, `Any chance ...` to a plain question): learned; changes the analysis and the SOP of messages that were fine.
3. Pronoun replacement by the name (`Can you confirm that he is allergic` to `Is Kostas allergic`): learned from the data, but the owner decision of 2026-09-30 says the proofing LLMs keep pronouns. 41 of the 471 training repair targets (8.7%) replace a pronoun.
4. Decomposition of run-on concatenations (`A and B and C`, no punctuation, training pairs of the composed kind): learned for the seen shapes (6 of the 17 sealed decomposition pairs reach the target SOP, secondary layer); NOT learned for genuinely tangled single sentences (K6 0/16) or relative-clause and embedded-question sentences.
5. Hallucination and meaning drift on a minority of rows (an invented conditional, swapped roles, an added question).
6. Long input: copy then repetition loop, no end of turn.
7. Overfitting signal: dev loss is lowest after epoch 1 and the dev identity break falls from 17% to 6.5% only between epochs 1 and 2.

## 7. Twenty example outputs (fine-tuned ep3; IN = input, OUT = output, TGT = verified target where there is one)

1. **good repair (sealed)**
   - IN: What is the meaning of the statute of limitations?
   - OUT: What does the statute of limitations mean?
   - TGT: What does the statute of limitations mean?
2. **good repair (sealed)**
   - IN: Other than Ngozi, I'd like to know who is responsible for the inventory API.
   - OUT: Apart from Ngozi, I'd like to know who is responsible for the inventory API.
   - TGT: Apart from Ngozi, I would like to know who is responsible for the inventory API.
3. **bad: matches the target, gate still rejects (sealed)**
   - IN: What is the meaning of force majeure?
   - OUT: What does force majeure mean?
   - TGT: What does force majeure mean?
4. **bad: changed but not the target (sealed)**
   - IN: This is mostly for my own notes, to be honest. The school bus is repaired by Mirela. The white camper van is repaired by Matei. Also, the fire engine is repaired by Mr Taylor. The old Volvo is repaired by Raluca.  Liam doesn't lease the old sailing boat. Also, ...
   - OUT: This is mostly for my own notes. The school bus is repaired by Mirela. The white camper van is repaired by Matei. The fire engine is repaired by Mr Taylor. The old Volvo is repaired by Raluca. Liam doesn't lease the old sailing boat. Also, Krzysztof rents the  ...
   - TGT: This is mostly for my own notes. The school bus is repaired by Mirela. The white camper van is repaired by Matei. Also, the fire engine is repaired by Mr Taylor. The old Volvo is repaired by Raluca. Liam doesn't lease the old sailing boat. Also, Krzysztof rent ...
5. **bad: left unchanged (sealed)**
   - IN: Given that Seo-yeon resigned, do you know who she quit because of?
   - OUT: Given that Seo-yeon resigned, do you know who she quit because of?
   - TGT: Given that Seo-yeon resigned, do you know because of whom she quit?
6. **bad: left unchanged (sealed)**
   - IN: How come the login service is down?
   - OUT: How come the login service is down?
   - TGT: Why is the login service down?
7. **bad: mechanical meaning flag, SOP also wrong (sealed)**
   - IN: Sorry in advance, this is going to be a long one. Manon rents the red Dacia. The red tractor is repaired by Nikos. I have been meaning to ask about this for a while.  Hannah cooks at the Tampere Arena. Also, Constantin is the chef at the Brașov Arena. Théo Mor ...
   - OUT: Manon rents the red Dacia. The red tractor is repaired by Nikos. I have been meaning to ask about this for a while. Hannah cooks at the Tampere Arena. Also, Constantin is the chef at the Brașov Arena. Théo Moreau does not lease the plot of land by the river. A ...
   - TGT: Sorry in advance. This is going to be a long one. Manon rents the red Dacia. The red tractor is repaired by Nikos. I have been meaning to ask about this for a while. Hannah cooks at the Tampere Arena. Also, Constantin is the chef at the Brașov Arena. Théo More ...
8. **mechanical flag is a false positive: the dropped lead-in `Thanks for your patience with all my questions` contains `all` (sealed)**
   - IN: Thanks for your patience with all my questions. Larissa Souza does not visit Novi Sad; Javier doesn't travel to Ploiești. Radu is the spouse of Taras.  Ionuț has an allergy to bee stings. Daria studies at Toma Primary School. Rafael checked out Notes from the  ...
   - OUT: Larissa Souza does not visit Novi Sad. Javier doesn't travel to Ploiești. Radu is the spouse of Taras. Ionuț has an allergy to bee stings. Daria studies at Toma Primary School. Rafael checked out Notes from the Night Train. Plus, Haruka borrowed The Last Ferry ...
   - TGT: Larissa Souza does not visit Novi Sad. Javier doesn't travel to Ploiești. Radu is the spouse of Taras. Ionuț has an allergy to bee stings. Daria studies at Toma Primary School. Rafael checked out Notes from the Night Train. Plus, Haruka borrowed The Last Ferry ...
9. **identity break: pronoun replaced by a name (sealed)**
   - IN: Jürgen Hoffmann raises Kaveh. He is on the Tampere Falcons?
   - OUT: Jürgen Hoffmann raises Kaveh. Is Kaveh on the Tampere Falcons?
10. **identity break: invented sentence (sealed)**
   - IN: book me a table for 4 at Dishoom Kensington this saturday, around 7:30 if poss
   - OUT: book me a table for 4 at Dishoom Kensington this Saturday, around 7:30. If you have a table, please let me know.
11. **harmful on a working message: hallucination (sym300)**
   - IN: Who grows peppers, if you know?
   - OUT: If you know who grows peppers, then you know who grows them.
12. **harmful on a working message: roles swapped (sym300)**
   - IN: Not counting Otilia, please find out who Nordwind Systems employs.
   - OUT: Not counting Otilia, please find out who employs Nordwind Systems.
13. **benign change on a working message: lead-in dropped (sym300)**
   - IN: Quick question: does Lin not study at Toma Primary School?
   - OUT: Does Lin not study at Toma Primary School?
14. **benign change: clause reordered (sym300)**
   - IN: Who maintained the booking app at some point in 2020?
   - OUT: At some point in 2020, who maintained the booking app?
15. **K6 decomposition not done (composed, sealed)**
   - IN: The vet called while I was walking Kiki and my phone was in my bag and I missed the message and now the clinic is closed so can I call back tomorrow?
   - OUT: The vet called while I was walking Kiki and my phone was in my bag and I missed the message and now the clinic is closed so can I call back tomorrow?
   - TGT: The vet called while I was walking Kiki. My phone was in my bag. I missed the message. Now the clinic is closed. Can I call back tomorrow?
16. **K6 decomposition: commas added, not split (composed, sealed)**
   - IN: Given that Daria Mureșan has borrowed Notes from the Night Train and Ji-woo checked out Notes from the Night Train; Georgiana checked out Notes from the Night Train, is it correct that Layla doesn't borrow Notes from the Night Train?
   - OUT: Given that Daria Mureșan has borrowed Notes from the Night Train, and Ji-woo checked out Notes from the Night Train, is it correct that Layla doesn't borrow Notes from the Night Train?
   - TGT: Daria Mureșan has borrowed Notes from the Night Train. Ji-woo checked out Notes from the Night Train. Georgiana checked out Notes from the Night Train. Is it correct that Layla doesn't borrow Notes from the Night Train?
17. **K2 whole-paragraph: hallucinated question (composed, sealed)**
   - IN: The author spoke at the library and signed the catalogue copy and left a poster for the reading room. On how many occasions did Grace Wright cook at the Old Mill Hall? Given that Daria Mureșan has borrowed Notes from the Night Train and Ji-woo checked out Note ...
   - OUT: The author spoke at the library and signed the catalogue copy and left a poster for the reading room. On how many occasions did Grace Wright cook at the Old Mill Hall? Given that Daria Mureșan has borrowed Notes from the Night Train, does Ji-woo check out Note ...
   - TGT: The author spoke at the library. The author signed the catalogue copy. The author left a poster for the reading room. On how many occasions did Grace Wright cook at the Old Mill Hall? Daria Mureșan has borrowed Notes from the Night Train. Ji-woo checked out No ...
18. **K3 whole-paragraph: a clean sentence dropped (composed, sealed)**
   - IN: I'm trying to find out who is employed by Brightfield Foods. What does Ildikó commute by? Fact-check: Sigrid looks after the analytics pipeline. Do you know if Iulia Dobre looked after the analytics pipeline as of 23 September 2019? In what period was Mr Toma  ...
   - OUT: I am trying to find out who is employed by Brightfield Foods. Sigrid looks after the analytics pipeline. Do you know if Iulia Dobre looked after the analytics pipeline as of 23 September 2019? In what period was Mr Toma the spouse of Kavya? Who works at a comp ...
19. **long input 10,290 chars: copy, then loop (output 18,500 chars, capped)**
   - IN: I wonder if Felix worked at Tisa Textiles as of 2022-02-12. Do you know how Julien gets to work? Since Min-jun Choi reports to Răzvan, is it the case that Răzvan reports to Min-jun Choi? Up to what da ...
   - OUT: w Soups of Transylvania? Could you check if Astrid intends to attend the Tuesday board meeting? Please find out who checked out Soups of Transylvania. I wonder who travels to Baia Mare. True or false:

## 8. Verdict

**Does 270M learn this? Yes for the surface transformation on forms like the training forms; no evidence yet for the hard part, and two properties it needs are missing.**

- It learns. With 895 pairs and 114 s of training the model goes from 98 to 100% damage on working messages (untrained base) to 10.5% analysis change on sealed identity pairs, and from 1.8% to 24.6% good repairs on the sealed repair pairs (+22.8 pp [10.5, 35.1] against the base; +12.3 pp [3.5, 22.8] against no rewrite). It reproduces the verified target text for 28% of the sealed repair pairs. Dev loss is already at its minimum after one epoch, so capacity is not what limits it on this data.
- It keeps working sentences only when a gate protects them. On 300 working messages it changes 23.7% (analysis changed for 21.3%, SOP changed for 8.3%); the preregistered bound of 1% is not met, although the analysis-layer damage is small (4 of 170 working messages no longer analysis-correct, 2.4%). In the intended per-sentence design the symbolic gate sends no working sentence to the model (K3: 0 of 5,879), so the end-to-end identity is intact, but the gate is then the only protection.
- Decomposition of tangled sentences is not learned: K6 0/16 at the expected sentence count, 14/16 untouched; it learned only the run-on-concatenation shape of the composed training pairs. In the per-sentence pipeline on K2 the model adds no net analysis gain (+0.3 pp [-3.1, 3.7] sentences analysis-correct); whole-paragraph mode gains +9.9 pp [6.5, 13.2] but damages half of the long clean paragraphs (K3 48.1% unchanged).
- Long input collapses (14/16 capped, copy then loop); whole-paragraph use is not viable for this model, consistent with the owner decision to work sentence by sentence.
- Caveat that weakens every number: the pairs come from the SOP-proxy split. 54 of 57 sealed repair pairs have a source row that failed only in the SOP layer, so most of them probably needed no rewrite at the analysis layer; and the paragraph-level gate rejects 48 of those 54 inputs and also the verified target of 33 of the 57 pairs, so the analysis metric has a low ceiling (24 of 57). The pilot therefore measures mainly how well the model imitates DeepSeek rewrites, not how well it repairs sentences the parser gets wrong.

Preregistered hypotheses: H1 (SOP accepted repair >= 30% with the interval above the untrained base) holds: 49.1% [36.6, 61.7] against 0% [0, 6.3] (analysis layer: 24.6% [15.2, 37.1] against 1.8% [0.3, 9.3]). H2 fails: 8.3% [5.7, 12.0] SOP change on sym300 (bound 1%) and 5.3% [1.5, 17.3] on sealed identity pairs (bound 5%, point estimate just above); analysis layer 21.3% and 10.5%. H3 is not supported in per-sentence mode (clean sentences changed 0.1% is fine, but bad sentences fixed 0/578 by wording and +0.3 pp by analysis; the base has a higher per-sentence analysis-correct rate (52.7% against 47.9%) but that metric is blind to meaning: the base often replaces a sentence by an unrelated short reply, which parses fine, and its paragraphs that are analysis-correct with meaning ok are 2.0% against 3.6% for the fine-tuned model). H4 confirmed descriptively (collapse). The decision rule of the preregistration does not fire cleanly (H1 holds, H2 fails, repair above 10%), so it does not by itself choose between "continue 270M" and "escalate"; the choice belongs to the orchestrator and the owner.

## 9. What iteration 2 data must contain

The evidence points to data and recipe, not to a capacity wall, so the recommendation is to stay on Gemma 3 270M for iteration 2 (the owner fallback to Gemma 3 1B applies only if iteration 2 still fails on decomposition after the data below).

1. Build on the new analysis-layer split. Only sentences whose grammatical analysis is wrong or that SymbolicLM cannot use are repair material; sentences that fail only in the SOP layer must be identity material or left out, otherwise the model learns to edit what needs no edit (the dominant cause of the sym300 damage).
2. Sentence-level units, the same unit the host sends at run time: one sentence in, one or several simple sentences out, produced by the host splitter. No whole-paragraph pairs, no training on inputs beyond a few hundred tokens; long inputs stay a host job.
3. The reverse-direction set (complex paraphrase to the simple form SymbolicLM already understands): relative clauses, coordination, embedded questions, fronting, lead-ins, passive, nominalization, casual register, reordering. This is where the pilot has no data and K6 fails (0/16), so these shapes need many distinct examples each, with the decomposed form as target (one clause per sentence, explicit subject).
4. Many identity pairs from working sentences across all forms (at least half of the rows, including the lead-in and question-frame forms the pilot edited: `Also,`, `Quick question:`, `X, right?`, `Any chance ...`), with a rule decided before generation about which fillers may be dropped.
5. Keep pronouns: drop or rewrite the 41 training repair targets (8.7%) that replace a pronoun by a name; reference resolution stays in SymbolicLM.
6. Filters on the targets: analysis gate on every target sentence (trees identical and judge a and c good), mechanical meaning check (names, numbers, negation, quantifiers, question kind) plus the calibrated meaning judge once it exists; reject targets that add a fact or change roles (the hallucination and role-swap cases).
7. Stopping and selection: 2 to 3 epochs are enough (minimum dev loss at epoch 1, flat afterwards); select on dev with the analysis-layer metrics, and report the identity rate on a frozen sample of working sentences next to the repair rate. Consider a short length filter so the model is never trained to emit an unbounded copy, and add a stop check (cap hit) to the dev decode.

## Files

- Tooling: `tools/eval/symbolic-proofing-eval.mjs`, `tools/eval/analysis-layer.mjs`, `tools/research/qualify-neuro-proofing.mjs` (`--authorize`), `training/python/train.py` (per-epoch snapshots for role `proofreader`), `tools/datasets/neuro-oracle/build.mjs` (`versionRecord`).
- Observations: `eval/reports/current/symbolic-proofing-it1/{scores,outputs,composed,bootstrap-compare.txt,cpu-speed.json}`.
- Records: `status/preregistrations/train-symbolic-proofing-gemma270m-it1.json`, `status/experiments.json`, `status/tasks.json`, `status/journal.jsonl`, topic notes `training-experiments` and `evaluation`.
