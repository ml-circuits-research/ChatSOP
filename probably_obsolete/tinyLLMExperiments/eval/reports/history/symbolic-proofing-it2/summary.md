# SymbolicProofingLLM iteration 2: Gemma 3 270M IT + LoRA on sentence units of neuro_english/proofing-it2

Generated from `eval/reports/current/symbolic-proofing-it2/` by the evaluation run of `train-symbolic-proofing-gemma270m-it2` (preregistration `status/preregistrations/train-symbolic-proofing-gemma270m-it2.json`). Regenerable observation, not product documentation. Tables come from `tools/eval/symbolic-proofing-report.mjs` and `tools/eval/symbolic-proofing-errors.mjs`; every number can be rebuilt from `scores/`, `composed/` and the omp judge folders.

Owner direction (binding): one layer at a time, the PRIMARY metrics are the grammatical analysis and the meaning, the SOP gold match is a SECONDARY column and selected nothing. Comparisons only on our synthetic data against no rewrite, the untrained gemma-3-270m-it and iteration 1. Since 2026-10-01 the evaluation is local first: "default and accurate trees identical" (local GPU) is reported as (a) LOCAL ONLY, the DeepSeek parse judge on top is (b) WITH JUDGES, and the meaning judge runs only on the residue that the local analysis comparison cannot certify.

## 1. Verdict in six lines

1. **Repair is much better than iteration 1.** On the 739 sealed repair pairs (every sentence sent to the model, outputs joined) the share of outputs whose analysis is correct AND whose meaning is kept is 37.6% [34.2, 41.2] with judges (iteration 1: 9.3%, untrained base 0.4%, no rewrite 5.4%) and 41.1% [37.6, 44.7] local only (iteration 1: 24.9%, no rewrite 25.0%, base 0.5%). Paired difference it2 minus it1: +28.3 pp [24.5, 32.1] with judges, +16.2 pp [12.9, 19.6] local only. H1 holds.
2. **The identity break is NOT fixed: H2 fails.** 19.8% [16.5, 23.5] of the 495 sealed identity pairs and 15.4% [12.5, 18.8] of 500 random working sentences of the sealed symbolic_english test are changed (analysis or text), against the preregistered bound of 1%. Iteration 1: 16.2% and 16.6%. The difference to iteration 1 is not significant (-3.6 pp [-8.3, 1.2] and +1.2 pp [-3.0, 5.6] in kept sentences). In 2.8% of the working sentences (14 of 498) the change makes the analysis incorrect; most changes are lead-in or frame removal, rewording, splitting, reordering and adding a question mark and a capital to an unpunctuated working sentence.
3. **Decomposition is learned for the first time, partly.** Sealed decomposition pairs (134): output sentence count equals the target in 32.8% [25.5, 41.2] (iteration 1: 4.5%), analysis correct AND meaning kept 41.8% [33.8, 50.3] (iteration 1: 11.9%). K6 (16 cases): sentence count reached 5/16 = 31.3% (iteration 1: 0/16), 10 of 16 changed. Subordinate clauses (21% good, 70% unchanged) and lists (24%) are the weakest decomposition types.
4. **Pronouns and fillers are kept as preregistered.** Pronoun dropped or replaced in 1/739 repair outputs (0.1%) and 0/495 identity outputs; K5 (102 cases) keeps every pronoun in all arms; lead-in, tag or frame dropped in 0.4% of repair outputs (H5 holds). No runaway output beyond 1 of 739 (H6 holds).
5. **In the chat's design (every sentence sent) iteration 2 helps mixed paragraphs and damages clean ones about as much as iteration 1.** K2 per sentence: sentences analysis-correct 82.0% [80.2, 83.8] with judges against 70.2% no rewrite and 75.3% iteration 1 (it2 minus it1 +5.2 pp [2.5, 7.9]); 9.6% of the clean sentences are changed (iteration 1: 9.5%; H3 bound 1% fails). K3 (265 long clean paragraphs, every sentence works): 11.7% of the paragraphs stay untouched, sentences analysis-correct 97.6% against 99.0% no rewrite (-1.7 pp [-2.6, -1.1]).
6. **No evidence of a capacity limit.** On 400 of its own training repair pairs the final model reproduces the target text in 75.0% [70.5, 79.0] and is good in 83.0%, and keeps 96.5% of 400 training identity pairs; on dev 45.3% exact, on the sealed pairs 17.6%. The model fits what it is shown; the gap is data (the working/failing boundary of the parser is not learnable from the surface) and distribution, not parameters. The Gemma 3 1B fallback is not justified by this run and was not trained.

The SymbolicLM optional rewrite metadata (`symbolic-lm.rewrite` in `config/formalizers.json`) is **not** pointed at the iteration-2 GGUF: the condition "repairs up AND identity break at most 1%" is not met. It stays OFF by default and unchanged. The GGUF is ready at `models/gemma/symbolic-proofing-gemma270m-it2/proofreader/gguf/ep3-q8_0.gguf` (285 MB).

## 2. Identity, data and training

- Run `symbolic-proofing-gemma270m-it2`, role `proofreader`, base `daniel-dona/gemma-3-270m-it` revision `99073d6b6edb0e298d163f964ec2b9d970b3408d` (byte-identical mirror of google/gemma-3-270m-it), LoRA rank 16 / alpha 32 / dropout 0.05, lr 2e-4, batch 2 x accumulation 8, 3 epochs = 1,668 optimizer steps, seed 42, recipe `config/train-gemma.json` sha256 `ecc7fe04...` (unchanged from iteration 1), trained from the base. Podman job `symproof-it2-train-a` (default CUDA floor, no override needed), waited for the LanguageProofingLLM iteration-2 job that held the training lock (00:26Z to 00:32Z), trained 00:32:34Z to 00:49:45Z (17 minutes). Checkpoints `models/gemma/symbolic-proofing-gemma270m-it2/proofreader/{epoch-1..3,merged-epoch-1..3,gguf/ep3-q8_0.gguf}`.
- Authorization: `status/training/authorization-gemma-symbolic-proofing-gemma270m-it2.json` (transcription of the owner decision 2026-09-30T17:32:38.274Z and the later decisions listed in `status/training/owner-approval-symbolic-proofing-it2.json`, written with `tools/research/qualify-neuro-proofing.mjs --authorize ... --scope ... --qualification ...`); qualification `status/training/qualification-symbolic-proofing-it2.json` (experiment-grade, six checks recomputed from the files, sha256 `32ff7f10...`).
- Data `datasets/neuro_english/proofing-it2` (manifest sha256 `5e85391c...`, version `2026-10-01-7ebfca69`): train 8,890 pairs (3,951 repair, 4,939 identity = 55.6%), dev 1,119 (497 repair, 622 identity). Built by `tools/datasets/build-symbolic-proofing-v2.mjs` from the rebuilt `proofing` pairs (1,484 repair units, paragraph pairs cut into sentence units by sentence alignment), the back-generated pairs re-checked against the new split (2,009 repair units: target in the new symbolic_english of the same split or passing the gate now; 2,750 identity units: the paraphrase passes the gate alone), 2,189 identity sentences of symbolic_english train (single sentences, 1,941 identity units overall carry a lead-in, tag or question frame), and the decomposition top-up (458 repair units). Rules frozen in the preregistration: a repair prompt does not pass the gate; target sentences pass the gate; two-vote meaning verdict; no pronoun replaced by a name, no added name or content, numbers, negation and question mark kept; **no filler dropped**; sealed overlap removed (1,469 candidate units flagged by the auditor `tools/datasets/audit/symbolic-proofing-overlap.mjs`).
- **Decomposition count: 1,189 train pairs** (the prompt has more than one finite clause, the target has two or more sentences; 151 in dev), 1,227 train repair pairs with two or more target sentences, 318 with one clause per target sentence. That is above the threshold of about 800, and a DeepSeek top-up was nevertheless created because iteration 1 failed K6: `datasets_sources/decomp_backgen/` (omp task, DeepSeek-V4.1-Flash, fenced to its folder): 558 groups of 2 to 4 short symbolic_english sentences sharing an entity, 1,102 tangled single-sentence variants, 1,074 passed the mechanical checks, 458 train and 41 dev pairs survived the gates and the two-vote meaning judge.
- Dev loss by epoch: 0.1260 / 0.1109 / 0.1161 (minimum at epoch 2). Dev decode per epoch (section 3): repair good 51.9% / 54.7% / 58.8%, identity changed 14.8% / 14.1% / 11.3%, runaway 0.2% / 0% / 0%. The selection rule (identity change at most 1%, else the lowest identity change; then repair good) picks **epoch 3**: no epoch reaches 1%; epoch 3 has the lowest identity change and the highest repair rate. No early-stopping rule tripped.
- Engine for the oracle side: SymbolicLM FINAL engine (Stanza accurate package, frozen rules ud-rules-v2.5). Analysis gate (owner calibration): identical Stanza default and accurate trees AND the DeepSeek judge conditions a and c good. Meaning kept = output unchanged, or equal to the verified target, or (hard mechanical checks on names, numbers and negation AND (the local analysis comparison says equivalent OR the two-vote DeepSeek judge says yes)). Intervals: Wilson 95% on rates, paired bootstrap 95% (10,000 resamples, seed 7) on differences.


## 3. Numbers

### Checkpoint selection on dev (it2 dev units)

| checkpoint | dev loss | repair: analysis correct AND meaning kept | repair: meaning kept | repair: analysis correct | identity: analysis or text changed | identity: analysis changed | repair: runaway | repair: pronoun dropped | repair: filler dropped |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| epoch 1 | 0.1260 | 258/497 = 51.9% [47.5, 56.3] | 436/497 = 87.7% [84.5, 90.3] | 303/497 = 61% [56.6, 65.2] | 92/622 = 14.8% [12.2, 17.8] | 89/622 = 14.3% [11.8, 17.3] | 1/497 = 0.2% [0, 1.1] | 4/497 = 0.8% [0.3, 2.1] | 2/497 = 0.4% [0.1, 1.5] |
| epoch 2 | 0.1109 | 272/497 = 54.7% [50.3, 59.1] | 463/497 = 93.2% [90.6, 95.1] | 296/497 = 59.6% [55.2, 63.8] | 88/622 = 14.1% [11.6, 17.1] | 88/622 = 14.1% [11.6, 17.1] | 0/497 = 0% [0, 0.8] | 1/497 = 0.2% [0, 1.1] | 0/497 = 0% [0, 0.8] |
| epoch 3 | 0.1161 | 292/497 = 58.8% [54.4, 63] | 461/497 = 92.8% [90.1, 94.7] | 317/497 = 63.8% [59.5, 67.9] | 70/622 = 11.3% [9, 14] | 70/622 = 11.3% [9, 14] | 0/497 = 0% [0, 0.8] | 3/497 = 0.6% [0.2, 1.8] | 2/497 = 0.4% [0.1, 1.5] |


### Sealed pair test (every input cut by the host splitter, every sentence sent to the model, outputs joined; HF bf16 greedy)


#### Repair pairs (PRIMARY, analysis layer)

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


#### Identity pairs (PRIMARY): the sentence works, nothing may change

| metric | no rewrite | untrained base | iteration 1 | iteration 2 |
| --- | --- | --- | --- | --- |
| **analysis OR text changed** | 0/495 = 0% [0, 0.8] | 486/495 = 98.2% [96.6, 99] | 80/495 = 16.2% [13.2, 19.7] | 98/495 = 19.8% [16.5, 23.5] |
| analysis changed | 0/495 = 0% [0, 0.8] | 486/495 = 98.2% [96.6, 99] | 70/495 = 14.1% [11.3, 17.5] | 96/495 = 19.4% [16.2, 23.1] |
| text changed | 0/495 = 0% [0, 0.8] | 486/495 = 98.2% [96.6, 99] | 80/495 = 16.2% [13.2, 19.7] | 98/495 = 19.8% [16.5, 23.5] |
| working inputs: output no longer analysis-correct | 0/494 = 0% [0, 0.8] | 183/494 = 37% [32.9, 41.4] | 17/494 = 3.4% [2.2, 5.4] | 20/494 = 4% [2.6, 6.2] |
| pronoun dropped or replaced | 0/495 = 0% [0, 0.8] | 46/495 = 9.3% [7, 12.2] | 3/495 = 0.6% [0.2, 1.8] | 0/495 = 0% [0, 0.8] |
| runaway | 0/495 = 0% [0, 0.8] | 38/495 = 7.7% [5.6, 10.4] | 0/495 = 0% [0, 0.8] | 0/495 = 0% [0, 0.8] |
| meaning check failed (mechanical) | 0/495 = 0% [0, 0.8] | 396/495 = 80% [76.3, 83.3] | 11/495 = 2.2% [1.2, 3.9] | 29/495 = 5.9% [4.1, 8.3] |


#### Paired bootstrap, iteration 2 minus the other arm (95% interval, 10,000 resamples)

| it2 minus | (a) repair, LOCAL ONLY: analysis correct AND meaning kept | (b) repair, with judges: analysis correct AND meaning kept | (b) repair: fixed of failing inputs | identity: analysis and text kept |
| --- | --- | --- | --- | --- |
| no rewrite | +16.1 pp [12.7, 19.4] (n 739) | +32.2 pp [28.7, 35.6] (n 739) | +34.6 pp [31, 38.2] (n 699) | -19.8 pp [-23.2, -16.4] (n 495) |
| untrained base | +40.6 pp [37.2, 44.1] (n 739) | +37.2 pp [33.7, 40.6] (n 739) | +34.5 pp [30.9, 38.1] (n 699) | +78.4 pp [74.7, 82] (n 495) |
| iteration 1 | +16.2 pp [12.9, 19.6] (n 739) | +28.3 pp [24.5, 32.1] (n 739) | +29.9 pp [26, 33.8] (n 699) | -3.6 pp [-8.3, 1.2] (n 495) |


#### Secondary: SOP layer (not used for selection or verdict)

| metric | no rewrite | untrained base | iteration 1 | iteration 2 |
| --- | --- | --- | --- | --- |
| repair: SOP matches the gold, strict | 439/739 = 59.4% [55.8, 62.9] | 21/739 = 2.8% [1.9, 4.3] | 431/739 = 58.3% [54.7, 61.8] | 425/739 = 57.5% [53.9, 61] |
| repair: SOP matches the gold, frame-normalized | 517/739 = 70% [66.6, 73.2] | 22/739 = 3% [2, 4.5] | 506/739 = 68.5% [65, 71.7] | 487/739 = 65.9% [62.4, 69.2] |
| repair: SOP equals the SOP of the verified target | 418/739 = 56.6% [53, 60.1] | 18/739 = 2.4% [1.5, 3.8] | 413/739 = 55.9% [52.3, 59.4] | 406/739 = 54.9% [51.3, 58.5] |
| identity: break (SOP no longer matches, strict) | 111/495 = 22.4% [19, 26.3] | 454/495 = 91.7% [89, 93.8] | 124/495 = 25.1% [21.4, 29] | 131/495 = 26.5% [22.8, 30.5] |
| all pairs: SymbolicLM parses the output with no unparsed span | 1041/1234 = 84.4% [82.2, 86.3] | 961/1234 = 77.9% [75.5, 80.1] | 1043/1234 = 84.5% [82.4, 86.4] | 1049/1234 = 85% [82.9, 86.9] |
| empty or capped outputs | 0/1234 = 0% [0, 0.3] | 78/1234 = 6.3% [5.1, 7.8] | 0/1234 = 0% [0, 0.3] | 0/1234 = 0% [0, 0.3] |


#### Decomposition pairs of the sealed set (the verified target has more sentences than the input)

| arm | pairs | analysis correct AND meaning kept | sentence count equals target | sentence count at least target | one-clause output sentences | explicit-subject output sentences | equals the target text |
| --- | --- | --- | --- | --- | --- | --- | --- |
| no rewrite | 134 | 15/134 = 11.2% [6.9, 17.6] | 1/134 = 0.7% [0.1, 4.1] | 1/134 = 0.7% [0.1, 4.1] | 8/150 = 5.3% [2.7, 10.2] | 142/150 = 94.7% [89.8, 97.3] | 0/134 = 0% [0, 2.8] |
| untrained base | 134 | 0/134 = 0% [0, 2.8] | 15/134 = 11.2% [6.9, 17.6] | 37/134 = 27.6% [20.7, 35.7] | 219/330 = 66.4% [61.1, 71.2] | 293/330 = 88.8% [84.9, 91.8] | 0/134 = 0% [0, 2.8] |
| iteration 1 | 134 | 16/134 = 11.9% [7.5, 18.5] | 6/134 = 4.5% [2.1, 9.4] | 8/134 = 6% [3.1, 11.3] | 27/165 = 16.4% [11.5, 22.8] | 158/165 = 95.8% [91.5, 97.9] | 2/134 = 1.5% [0.4, 5.3] |
| iteration 2 | 134 | 56/134 = 41.8% [33.8, 50.3] | 44/134 = 32.8% [25.5, 41.2] | 54/134 = 40.3% [32.4, 48.8] | 168/281 = 59.8% [54, 65.4] | 274/281 = 97.5% [94.9, 98.8] | 25/134 = 18.7% [13, 26.1] |


### 500 random working sentences of the sealed symbolic_english test (HF bf16 greedy)

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


### Capacity check: the final model on 400 repair and 400 identity pairs of its own training file

| metric | value |
| --- | --- |
| repair: output equals the training target text | 300/400 = 75% [70.5, 79] |
| repair: analysis correct AND meaning kept | 332/400 = 83% [79, 86.4] |
| repair: left unchanged | 49/400 = 12.3% [9.4, 15.8] |
| identity: analysis or text changed | 14/400 = 3.5% [2.1, 5.8] |


### Composed suites (analysis layer; GGUF Q8_0 through llama-server on the GPU)


#### K2 mixed paragraphs (bad and clean sentences mixed), per-sentence mode (ALL sentences sent)

| arm | (a) sentences analysis-correct, local only | (b) sentences analysis-correct, with judge | (a) paragraphs analysis-correct, local only | (b) paragraphs analysis-correct, with judge | (a) paragraphs local-only analysis AND meaning kept | (b) paragraphs analysis AND meaning kept, with judges | meaning kept (b) | text unchanged | same analysis as the input | pronouns kept | clean sentences changed (text scorer) | bad sentences fixed to the expected wording (text scorer) | runaway | sentence count equals expected |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| no rewrite | 1221/1607 = 76% [73.8, 78] | 1128/1607 = 70.2% [67.9, 72.4] | 66/306 = 21.6% [17.3, 26.5] | 35/306 = 11.4% [8.3, 15.5] | 66/306 = 21.6% [17.3, 26.5] | 35/306 = 11.4% [8.3, 15.5] | 306/306 = 100% [98.8, 100] | 306/306 = 100% [98.8, 100] | 306/306 = 100% [98.8, 100] | 306/306 = 100% [98.8, 100] | 0/986 = 0% [0, 0.4] | 0/578 = 0% [0, 0.7] | 0/306 = 0% [0, 1.2] | 120/306 = 39.2% [33.9, 44.8] |
| untrained base | 1625/2212 = 73.5% [71.6, 75.3] | 1464/2212 = 66.2% [64.2, 68.1] | 75/306 = 24.5% [20, 29.6] | 58/306 = 19% [15, 23.7] | 0/306 = 0% [0, 1.2] | 0/306 = 0% [0, 1.2] | 0/306 = 0% [0, 1.2] | 0/306 = 0% [0, 1.2] | 0/306 = 0% [0, 1.2] | 306/306 = 100% [98.8, 100] | 910/986 = 92.3% [90.5, 93.8] | 0/578 = 0% [0, 0.7] | 14/306 = 4.6% [2.7, 7.5] | 52/306 = 17% [13.2, 21.6] |
| iteration 1 | 1290/1622 = 79.5% [77.5, 81.4] | 1221/1622 = 75.3% [73.1, 77.3] | 96/306 = 31.4% [26.4, 36.8] | 70/306 = 22.9% [18.5, 27.9] | 45/306 = 14.7% [11.2, 19.1] | 39/306 = 12.7% [9.5, 16.9] | 167/306 = 54.6% [49, 60.1] | 101/306 = 33% [28, 38.5] | 118/306 = 38.6% [33.3, 44.1] | 306/306 = 100% [98.8, 100] | 94/986 = 9.5% [7.9, 11.5] | 31/578 = 5.4% [3.8, 7.5] | 0/306 = 0% [0, 1.2] | 118/306 = 38.6% [33.3, 44.1] |
| iteration 2 | 1578/1770 = 89.2% [87.6, 90.5] | 1452/1770 = 82% [80.2, 83.8] | 149/306 = 48.7% [43.1, 54.3] | 83/306 = 27.1% [22.4, 32.4] | 95/306 = 31% [26.1, 36.4] | 75/306 = 24.5% [20, 29.6] | 243/306 = 79.4% [74.5, 83.6] | 68/306 = 22.2% [17.9, 27.2] | 68/306 = 22.2% [17.9, 27.2] | 306/306 = 100% [98.8, 100] | 95/986 = 9.6% [7.9, 11.6] | 30/578 = 5.2% [3.7, 7.3] | 0/306 = 0% [0, 1.2] | 140/306 = 45.8% [40.3, 51.4] |


#### K2 mixed paragraphs (bad and clean sentences mixed), whole-paragraph mode (comparison)

| arm | (a) sentences analysis-correct, local only | (b) sentences analysis-correct, with judge | (a) paragraphs analysis-correct, local only | (b) paragraphs analysis-correct, with judge | (a) paragraphs local-only analysis AND meaning kept | (b) paragraphs analysis AND meaning kept, with judges | meaning kept (b) | text unchanged | same analysis as the input | pronouns kept | clean sentences changed (text scorer) | bad sentences fixed to the expected wording (text scorer) | runaway | sentence count equals expected |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| no rewrite | 1221/1607 = 76% [73.8, 78] | 1128/1607 = 70.2% [67.9, 72.4] | 66/306 = 21.6% [17.3, 26.5] | 35/306 = 11.4% [8.3, 15.5] | 66/306 = 21.6% [17.3, 26.5] | 35/306 = 11.4% [8.3, 15.5] | 306/306 = 100% [98.8, 100] | 306/306 = 100% [98.8, 100] | 306/306 = 100% [98.8, 100] | 306/306 = 100% [98.8, 100] | 0/986 = 0% [0, 0.4] | 0/578 = 0% [0, 0.7] | 0/306 = 0% [0, 1.2] | 120/306 = 39.2% [33.9, 44.8] |
| untrained base | 635/1018 = 62.4% [59.4, 65.3] | 587/1018 = 57.7% [54.6, 60.7] | 153/306 = 50% [44.4, 55.6] | 140/306 = 45.8% [40.3, 51.4] | 0/306 = 0% [0, 1.2] | 0/306 = 0% [0, 1.2] | 2/306 = 0.7% [0.2, 2.4] | 0/306 = 0% [0, 1.2] | 0/306 = 0% [0, 1.2] | 306/306 = 100% [98.8, 100] | 329/986 = 33.4% [30.5, 36.4] | 0/578 = 0% [0, 0.7] | 2/306 = 0.7% [0.2, 2.4] | 6/306 = 2% [0.9, 4.2] |
| iteration 1 | 1565/1914 = 81.8% [80, 83.4] | 1488/1914 = 77.7% [75.8, 79.5] | 98/306 = 32% [27, 37.4] | 66/306 = 21.6% [17.3, 26.5] | 56/306 = 18.3% [14.4, 23] | 50/306 = 16.3% [12.6, 20.9] | 228/306 = 74.5% [69.3, 79.1] | 138/306 = 45.1% [39.6, 50.7] | 142/306 = 46.4% [40.9, 52] | 306/306 = 100% [98.8, 100] | 38/986 = 3.9% [2.8, 5.2] | 46/578 = 8% [6, 10.5] | 0/306 = 0% [0, 1.2] | 151/306 = 49.3% [43.8, 54.9] |
| iteration 2 | 1381/1710 = 80.8% [78.8, 82.6] | 1268/1710 = 74.2% [72, 76.2] | 96/306 = 31.4% [26.4, 36.8] | 62/306 = 20.3% [16.1, 25.1] | 47/306 = 15.4% [11.8, 19.8] | 33/306 = 10.8% [7.8, 14.8] | 171/306 = 55.9% [50.3, 61.3] | 131/306 = 42.8% [37.4, 48.4] | 132/306 = 43.1% [37.7, 48.7] | 306/306 = 100% [98.8, 100] | 97/986 = 9.8% [8.1, 11.9] | 7/578 = 1.2% [0.6, 2.5] | 1/306 = 0.3% [0.1, 1.8] | 111/306 = 36.3% [31.1, 41.8] |


#### K3 long identity paragraphs (every sentence works), per-sentence mode (ALL sentences sent)

| arm | (a) sentences analysis-correct, local only | (b) sentences analysis-correct, with judge | (a) paragraphs analysis-correct, local only | (b) paragraphs analysis-correct, with judge | (a) paragraphs local-only analysis AND meaning kept | (b) paragraphs analysis AND meaning kept, with judges | meaning kept (b) | text unchanged | same analysis as the input | pronouns kept | clean sentences changed (text scorer) | bad sentences fixed to the expected wording (text scorer) | runaway | sentence count equals expected |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| no rewrite | 5764/5804 = 99.3% [99.1, 99.5] | 5747/5804 = 99% [98.7, 99.2] | 229/265 = 86.4% [81.8, 90] | 216/265 = 81.5% [76.4, 85.7] | 229/265 = 86.4% [81.8, 90] | 216/265 = 81.5% [76.4, 85.7] | 265/265 = 100% [98.6, 100] | 265/265 = 100% [98.6, 100] | 265/265 = 100% [98.6, 100] | 265/265 = 100% [98.6, 100] | 0/5855 = 0% [0, 0.1] | - | 0/265 = 0% [0, 1.4] | 265/265 = 100% [98.6, 100] |
| untrained base | 5476/7671 = 71.4% [70.4, 72.4] | 5212/7671 = 67.9% [66.9, 69] | 15/265 = 5.7% [3.5, 9.1] | 14/265 = 5.3% [3.2, 8.7] | 0/265 = 0% [0, 1.4] | 0/265 = 0% [0, 1.4] | 0/265 = 0% [0, 1.4] | 0/265 = 0% [0, 1.4] | 0/265 = 0% [0, 1.4] | 265/265 = 100% [98.6, 100] | 5533/5855 = 94.5% [93.9, 95.1] | - | 1/265 = 0.4% [0.1, 2.1] | 25/265 = 9.4% [6.5, 13.6] |
| iteration 1 | 5654/5885 = 96.1% [95.5, 96.5] | 5625/5885 = 95.6% [95, 96.1] | 110/265 = 41.5% [35.7, 47.5] | 101/265 = 38.1% [32.5, 44.1] | 50/265 = 18.9% [14.6, 24] | 55/265 = 20.8% [16.3, 26] | 71/265 = 26.8% [21.8, 32.4] | 36/265 = 13.6% [10, 18.2] | 36/265 = 13.6% [10, 18.2] | 265/265 = 100% [98.6, 100] | 634/5855 = 10.8% [10.1, 11.7] | - | 0/265 = 0% [0, 1.4] | 207/265 = 78.1% [72.8, 82.7] |
| iteration 2 | 5835/5940 = 98.2% [97.9, 98.5] | 5795/5940 = 97.6% [97.1, 97.9] | 181/265 = 68.3% [62.5, 73.6] | 158/265 = 59.6% [53.6, 65.4] | 96/265 = 36.2% [30.7, 42.2] | 108/265 = 40.8% [35, 46.8] | 155/265 = 58.5% [52.5, 64.3] | 31/265 = 11.7% [8.4, 16.1] | 31/265 = 11.7% [8.4, 16.1] | 265/265 = 100% [98.6, 100] | 666/5855 = 11.4% [10.6, 12.2] | - | 0/265 = 0% [0, 1.4] | 186/265 = 70.2% [64.4, 75.4] |


#### K3 long identity paragraphs (every sentence works), whole-paragraph mode (comparison)

| arm | (a) sentences analysis-correct, local only | (b) sentences analysis-correct, with judge | (a) paragraphs analysis-correct, local only | (b) paragraphs analysis-correct, with judge | (a) paragraphs local-only analysis AND meaning kept | (b) paragraphs analysis AND meaning kept, with judges | meaning kept (b) | text unchanged | same analysis as the input | pronouns kept | clean sentences changed (text scorer) | bad sentences fixed to the expected wording (text scorer) | runaway | sentence count equals expected |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| no rewrite | 5764/5804 = 99.3% [99.1, 99.5] | 5747/5804 = 99% [98.7, 99.2] | 229/265 = 86.4% [81.8, 90] | 216/265 = 81.5% [76.4, 85.7] | 229/265 = 86.4% [81.8, 90] | 216/265 = 81.5% [76.4, 85.7] | 265/265 = 100% [98.6, 100] | 265/265 = 100% [98.6, 100] | 265/265 = 100% [98.6, 100] | 265/265 = 100% [98.6, 100] | 0/5855 = 0% [0, 0.1] | - | 0/265 = 0% [0, 1.4] | 265/265 = 100% [98.6, 100] |
| untrained base | 2686/4680 = 57.4% [56, 58.8] | 2535/4680 = 54.2% [52.7, 55.6] | 35/265 = 13.2% [9.7, 17.8] | 35/265 = 13.2% [9.7, 17.8] | 0/265 = 0% [0, 1.4] | 0/265 = 0% [0, 1.4] | 2/265 = 0.8% [0.2, 2.7] | 0/265 = 0% [0, 1.4] | 0/265 = 0% [0, 1.4] | 265/265 = 100% [98.6, 100] | 1810/5855 = 30.9% [29.7, 32.1] | - | 0/265 = 0% [0, 1.4] | 15/265 = 5.7% [3.5, 9.1] |
| iteration 1 | 5959/6043 = 98.6% [98.3, 98.9] | 5930/6043 = 98.1% [97.8, 98.4] | 201/265 = 75.8% [70.4, 80.6] | 186/265 = 70.2% [64.4, 75.4] | 117/265 = 44.2% [38.3, 50.2] | 130/265 = 49.1% [43.1, 55] | 170/265 = 64.2% [58.2, 69.7] | 82/265 = 30.9% [25.7, 36.7] | 110/265 = 41.5% [35.7, 47.5] | 265/265 = 100% [98.6, 100] | 438/5855 = 7.5% [6.8, 8.2] | - | 0/265 = 0% [0, 1.4] | 176/265 = 66.4% [60.5, 71.8] |
| iteration 2 | 8203/8362 = 98.1% [97.8, 98.4] | 8148/8362 = 97.4% [97.1, 97.8] | 205/265 = 77.4% [71.9, 82] | 185/265 = 69.8% [64, 75] | 95/265 = 35.8% [30.3, 41.8] | 91/265 = 34.3% [28.9, 40.2] | 106/265 = 40% [34.3, 46] | 91/265 = 34.3% [28.9, 40.2] | 91/265 = 34.3% [28.9, 40.2] | 265/265 = 100% [98.6, 100] | 1765/5855 = 30.1% [29, 31.3] | - | 0/265 = 0% [0, 1.4] | 132/265 = 49.8% [43.8, 55.8] |


#### K5 pronoun references (the later sentence refers by pronoun), per-sentence mode (ALL sentences sent)

| arm | (a) sentences analysis-correct, local only | (b) sentences analysis-correct, with judge | (a) paragraphs analysis-correct, local only | (b) paragraphs analysis-correct, with judge | (a) paragraphs local-only analysis AND meaning kept | (b) paragraphs analysis AND meaning kept, with judges | meaning kept (b) | text unchanged | same analysis as the input | pronouns kept | clean sentences changed (text scorer) | bad sentences fixed to the expected wording (text scorer) | runaway | sentence count equals expected |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| no rewrite | 299/305 = 98% [95.8, 99.1] | 295/305 = 96.7% [94.1, 98.2] | 96/102 = 94.1% [87.8, 97.3] | 92/102 = 90.2% [82.9, 94.6] | 96/102 = 94.1% [87.8, 97.3] | 92/102 = 90.2% [82.9, 94.6] | 102/102 = 100% [96.4, 100] | 102/102 = 100% [96.4, 100] | 102/102 = 100% [96.4, 100] | 102/102 = 100% [96.4, 100] | 0/306 = 0% [0, 1.2] | - | 0/102 = 0% [0, 3.6] | 102/102 = 100% [96.4, 100] |
| untrained base | 322/449 = 71.7% [67.4, 75.7] | 295/449 = 65.7% [61.2, 69.9] | 36/102 = 35.3% [26.7, 44.9] | 30/102 = 29.4% [21.4, 38.9] | 0/102 = 0% [0, 3.6] | 0/102 = 0% [0, 3.6] | 0/102 = 0% [0, 3.6] | 0/102 = 0% [0, 3.6] | 0/102 = 0% [0, 3.6] | 72/102 = 70.6% [61.1, 78.6] | 288/306 = 94.1% [90.9, 96.2] | - | 9/102 = 8.8% [4.7, 15.9] | 56/102 = 54.9% [45.2, 64.2] |
| iteration 1 | 293/308 = 95.1% [92.1, 97] | 288/308 = 93.5% [90.2, 95.8] | 87/102 = 85.3% [77.1, 90.9] | 83/102 = 81.4% [72.7, 87.7] | 67/102 = 65.7% [56.1, 74.2] | 69/102 = 67.6% [58.1, 75.9] | 79/102 = 77.5% [68.4, 84.5] | 61/102 = 59.8% [50.1, 68.8] | 62/102 = 60.8% [51.1, 69.7] | 102/102 = 100% [96.4, 100] | 47/306 = 15.4% [11.8, 19.8] | - | 0/102 = 0% [0, 3.6] | 99/102 = 97.1% [91.7, 99] |
| iteration 2 | 303/310 = 97.7% [95.4, 98.9] | 298/310 = 96.1% [93.4, 97.8] | 96/102 = 94.1% [87.8, 97.3] | 91/102 = 89.2% [81.7, 93.9] | 86/102 = 84.3% [76, 90.1] | 87/102 = 85.3% [77.1, 90.9] | 97/102 = 95.1% [89, 97.9] | 68/102 = 66.7% [57.1, 75.1] | 68/102 = 66.7% [57.1, 75.1] | 102/102 = 100% [96.4, 100] | 41/306 = 13.4% [10, 17.7] | - | 0/102 = 0% [0, 3.6] | 99/102 = 97.1% [91.7, 99] |


#### K5 pronoun references (the later sentence refers by pronoun), whole-paragraph mode (comparison)

| arm | (a) sentences analysis-correct, local only | (b) sentences analysis-correct, with judge | (a) paragraphs analysis-correct, local only | (b) paragraphs analysis-correct, with judge | (a) paragraphs local-only analysis AND meaning kept | (b) paragraphs analysis AND meaning kept, with judges | meaning kept (b) | text unchanged | same analysis as the input | pronouns kept | clean sentences changed (text scorer) | bad sentences fixed to the expected wording (text scorer) | runaway | sentence count equals expected |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| no rewrite | 299/305 = 98% [95.8, 99.1] | 295/305 = 96.7% [94.1, 98.2] | 96/102 = 94.1% [87.8, 97.3] | 92/102 = 90.2% [82.9, 94.6] | 96/102 = 94.1% [87.8, 97.3] | 92/102 = 90.2% [82.9, 94.6] | 102/102 = 100% [96.4, 100] | 102/102 = 100% [96.4, 100] | 102/102 = 100% [96.4, 100] | 102/102 = 100% [96.4, 100] | 0/306 = 0% [0, 1.2] | - | 0/102 = 0% [0, 3.6] | 102/102 = 100% [96.4, 100] |
| untrained base | 116/161 = 72% [64.7, 78.4] | 111/161 = 68.9% [61.4, 75.6] | 72/102 = 70.6% [61.1, 78.6] | 70/102 = 68.6% [59.1, 76.8] | 0/102 = 0% [0, 3.6] | 0/102 = 0% [0, 3.6] | 0/102 = 0% [0, 3.6] | 0/102 = 0% [0, 3.6] | 0/102 = 0% [0, 3.6] | 15/102 = 14.7% [9.1, 22.9] | 134/306 = 43.8% [38.3, 49.4] | - | 2/102 = 2% [0.5, 6.9] | 9/102 = 8.8% [4.7, 15.9] |
| iteration 1 | 296/306 = 96.7% [94.1, 98.2] | 293/306 = 95.8% [92.9, 97.5] | 92/102 = 90.2% [82.9, 94.6] | 89/102 = 87.3% [79.4, 92.4] | 82/102 = 80.4% [71.6, 86.9] | 84/102 = 82.4% [73.8, 88.5] | 94/102 = 92.2% [85.3, 96] | 85/102 = 83.3% [74.9, 89.3] | 85/102 = 83.3% [74.9, 89.3] | 98/102 = 96.1% [90.3, 98.5] | 18/306 = 5.9% [3.8, 9.1] | - | 0/102 = 0% [0, 3.6] | 100/102 = 98% [93.1, 99.5] |
| iteration 2 | 289/295 = 98% [95.6, 99.1] | 285/295 = 96.6% [93.9, 98.1] | 96/102 = 94.1% [87.8, 97.3] | 92/102 = 90.2% [82.9, 94.6] | 80/102 = 78.4% [69.5, 85.3] | 78/102 = 76.5% [67.4, 83.6] | 87/102 = 85.3% [77.1, 90.9] | 80/102 = 78.4% [69.5, 85.3] | 80/102 = 78.4% [69.5, 85.3] | 98/102 = 96.1% [90.3, 98.5] | 19/306 = 6.2% [4, 9.5] | - | 0/102 = 0% [0, 3.6] | 90/102 = 88.2% [80.6, 93.1] |


#### Paired bootstrap over cases, iteration 2 minus iteration 1 / minus no rewrite

| suite | mode | share of output sentences analysis-correct, it2 - it1 | it2 - no rewrite | text and analysis unchanged, it2 - it1 | it2 - no rewrite |
| --- | --- | --- | --- | --- | --- |
| K2 | sentence | +5.2 pp [2.5, 7.9] | +10.6 pp [8.7, 12.6] | -10.8 pp [-17, -4.6] | -77.8 pp [-82.4, -73.2] |
| K2 | paragraph | -3 pp [-4.9, -0.9] | +3.4 pp [1.5, 5.3] | -2.3 pp [-9.2, 4.9] | -57.2 pp [-62.7, -51.6] |
| K3 | sentence | +1.8 pp [0.6, 3] | -1.7 pp [-2.6, -1.1] | -1.9 pp [-6.4, 2.6] | -88.3 pp [-92.1, -84.5] |
| K3 | paragraph | -0.4 pp [-1.6, 0.8] | -1.3 pp [-2.4, -0.6] | +3.4 pp [-3.8, 10.9] | -65.7 pp [-71.3, -59.6] |
| K5 | sentence | +1.8 pp [-1.2, 4.5] | -0.2 pp [-1.6, 1.2] | +6.9 pp [-5.9, 18.6] | -33.3 pp [-42.2, -24.5] |
| K5 | paragraph | +1.7 pp [-0.4, 4.5] | +0 pp [-1.6, 1.6] | -4.9 pp [-15.7, 5.9] | -21.6 pp [-29.4, -13.7] |


#### K6 decomposition (16 cases: one tangled message that must become several short sentences)

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


### Error categories

Arm: it2.

#### Sealed repair pairs

| category | pairs | share |
| --- | --- | --- |
| left unchanged, analysis still wrong | 311 | 42.1% |
| good: equals the verified target text | 130 | 17.6% |
| good: different wording, analysis correct, meaning kept | 122 | 16.5% |
| changed, analysis still wrong, meaning kept | 65 | 8.8% |
| meaning lost, analysis correct (judge says no) | 48 | 6.5% |
| changed, analysis still wrong and meaning lost | 29 | 3.9% |
| good: unchanged and already analysis-correct | 26 | 3.5% |
| meaning lost, analysis correct (names, numbers or negation changed) | 7 | 0.9% |
| runaway (cap hit or repeated sentence) | 1 | 0.1% |

| flag (overlapping) | pairs |
| --- | --- |
| pronoun dropped or replaced | 1 |
| lead-in, tag or question frame dropped | 3 |
| statement turned into a question | 13 |
| output sentence count differs from the target | 132 |
| decomposition pair (target has more sentences) | 134 |

Repair pairs by the failure kind of the source row:

| failure kind | pairs | good |
| --- | --- | --- |
| trees_differ | 514 | 191 (37.2%) |
| unparsed_span | 88 | 49 (55.7%) |
| judge_a | 75 | 14 (18.7%) |
| judge_c | 36 | 14 (38.9%) |
| judge_ac | 26 | 10 (38.5%) |

Repair pairs by the number of sentences of the verified target:

| target sentences | pairs | good | equals the target text |
| --- | --- | --- | --- |
| 1 | 485 | 187 (38.6%) | 93 (19.2%) |
| 2 | 171 | 62 (36.3%) | 29 (17%) |
| 3 | 45 | 14 (31.1%) | 4 (8.9%) |
| 4 or more | 38 | 15 (39.5%) | 4 (10.5%) |

#### Identity breaks (working sentences whose analysis or text changed)

sealed identity pairs: 98 of 495 changed.

| cause (heuristic, first match) | sentences | of which output no longer analysis-correct |
| --- | --- | --- |
| reworded (words added, dropped or replaced) | 37 | 10 |
| lead-in, tag or question frame dropped | 26 | 3 |
| split into several sentences | 17 | 1 |
| punctuation or case only | 10 | 5 |
| same words reordered (passive/active, fronting, clause order) | 7 | 1 |
| pronoun changed | 1 | 0 |

500 working sentences: 77 of 500 changed.

| cause (heuristic, first match) | sentences | of which output no longer analysis-correct |
| --- | --- | --- |
| lead-in, tag or question frame dropped | 30 | 8 |
| reworded (words added, dropped or replaced) | 24 | 4 |
| same words reordered (passive/active, fronting, clause order) | 9 | 1 |
| split into several sentences | 9 | 0 |
| punctuation or case only | 4 | 1 |
| pronoun changed | 1 | 0 |

### Thirty examples

1. **good repair (decomposition) (sealed)**
   - IN: Can the wardens move the cones, and who put them there originally?
   - OUT: Can the wardens move the cones? Who put them there originally?
   - TGT: Can the wardens move the cones? Who put the cones there originally?
2. **good repair (decomposition) (sealed)**
   - IN: The dispatcher changed Pema's airport run to a larger vehicle and the driver saw the update but the rider still saw the small car in her app, so she called the office.
   - OUT: The dispatcher changed Pema's airport run to a larger vehicle. The driver saw the update. But the rider still saw the small car in her app. So she called the office.
   - TGT: The dispatcher changed Pema's airport run to a larger vehicle. The driver saw the update. The rider still saw the small car in her app. So she called the office.
3. **good repair (decomposition) (sealed)**
   - IN: Boaz took the tunnel and paid the toll and stopped near the arena and then the rider changed the destination to the hotel but the fare estimate did not update.
   - OUT: Boaz took the tunnel. He paid the toll. He stopped near the arena. Then the rider changed the destination to the hotel. But the fare estimate did not update.
   - TGT: Boaz took the tunnel and paid the toll. Boaz stopped near the arena. Then the rider changed the destination to the hotel. But the fare estimate did not update.
4. **good repair (sealed)**
   - IN: which platform does the Cambridge train usually leave from at King's Cross
   - OUT: From which platform does the Cambridge train typically leave at King's Cross?
   - TGT: From which platform does the Cambridge train usually leave at King's Cross?
5. **good repair (sealed)**
   - IN: What is Nori captain of?
   - OUT: Nori is captain of what?
   - TGT: Nori is captain of what?
6. **good repair (sealed)**
   - IN: Who is the oldest person working at Blue Harbor Media?
   - OUT: Which person working at Blue Harbor Media is the oldest?
   - TGT: Who is the oldest person who works at Blue Harbor Media?
7. **good repair (sealed)**
   - IN: who did Lale cook for at the private dinner last night
   - OUT: For whom did Lale cook at the private dinner last night?
   - TGT: For whom did Lale cook at the private dinner last night?
8. **left unchanged, analysis still wrong (decomposition, sealed)**
   - IN: Who collected the sedan when the return office closed, and did Loredana receive a signed inspection slip before she boarded the last shuttle?
   - OUT: Who collected the sedan when the return office closed, and did Loredana receive a signed inspection slip before she boarded the last shuttle?
   - TGT: Who collected the sedan when the return office closed? Did Loredana receive a signed inspection slip before she boarded the last shuttle?
9. **changed, analysis still wrong and meaning lost (decomposition, sealed)**
   - IN: when the vet called after Jiji had already eaten the new food I could not tell whether the change in her appetite began before breakfast or only after our walk
   - OUT: I could not tell whether the change in her appetite began before breakfast. Or if the change in her appetite began after our walk. Or if the change in her appetite only after our walk.
   - TGT: Jiji had already eaten the new food when the vet called. When the vet called, I could not tell whether the change in her appetite began before breakfast or only after our walk.
10. **left unchanged, analysis still wrong (decomposition, sealed)**
   - IN: Unless the supplier sends the correct charger before Thursday, Imran says he cannot complete the scooter repair, but he can still inspect the cable and replace the cracked port cover.
   - OUT: Unless the supplier sends the correct charger before Thursday, Imran says he cannot complete the scooter repair, but he can still inspect the cable and replace the cracked port cover.
   - TGT: Imran says he cannot complete the scooter repair unless the supplier sends the correct charger before Thursday. But he can still inspect the cable. He can still replace the cracked port cover.
11. **meaning lost, analysis correct (judge says no) (sealed)**
   - IN: So how many companies is Carpathia Energy a supplier of?
   - OUT: How many companies supply Carpathia Energy?
   - TGT: Carpathia Energy is a supplier of how many companies?
12. **left unchanged, analysis still wrong (sealed)**
   - IN: Any chance Vikram goes to Bistrița Technical College?
   - OUT: Any chance Vikram goes to Bistrița Technical College?
   - TGT: Does Vikram go to Bistrița Technical College?
13. **meaning lost, analysis correct (judge says no) (sealed)**
   - IN: Where does whoever manages Mihai live?
   - OUT: Who manages Mihai?
   - TGT: Where does Mihai's manager live?
14. **meaning lost, analysis correct (names, numbers or negation changed) (sealed)**
   - IN: The agreement lists 250 kilometers for 3 days and charges 0.20 for each extra kilometer, but Youssef's copy says 200 kilometers, so which limit applies to this booking?
   - OUT: The agreement lists 250 kilometers for 3 days. Youssef's copy says 200 kilometers. Which limit applies to this booking?
   - TGT: The agreement lists 250 kilometers for 3 days. The agreement charges 0.20 for each extra kilometer. But Youssef's copy says 200 kilometers. So which limit applies to this booking?
15. **changed, analysis still wrong and meaning lost (sealed)**
   - IN: not all journals are searchable and some aren't even indexed
   - OUT: some journals aren't searchable and not all journals are indexed
   - TGT: Not all journals are searchable. Some aren't even indexed.
16. **runaway (cap hit or repeated sentence) (sealed)**
   - IN: The new tyres are wider and the mudguard barely clears them and Rui says the rear brake still rubs but the invoice lists only the tyre fitting and not the brake work.
   - OUT: The new tyres are wider. The mudguard barely clears them. Rui says the rear brake still rubs. But the invoice lists only the tyre fitting. Rui says the rear brake still rubs. But the invoice lists only the tyre fitting. Not the brake work.
   - TGT: The new tyres are wider. The mudguard barely clears them. Rui says the rear brake still rubs. But the invoice lists only the tyre fitting and not the brake work.
17. **identity break: reworded (words added, dropped or replaced)** (output no longer analysis-correct)
   - IN: Given that the Târgu Mureș Town Hall issues a work permit, is it correct that a work permit is issued by the Tampere Town Hall?
   - OUT: Given that the Târgu Mureș Town Hall issues a work permit, is it correct that it is issued by the Tampere Town Hall?
18. **identity break: reworded (words added, dropped or replaced)** (output still analysis-correct)
   - IN: Have all the students at Bistrița Music Academy completed the safety training?
   - OUT: Has every student at Bistrița Music Academy completed the safety training?
19. **identity break: split into several sentences** (output still analysis-correct)
   - IN: The battery meter shows half and then the screen goes blank and the scooter slows on hills and Qiao asked for a written price before we order any replacement cells.
   - OUT: The battery meter shows half. Then the screen goes blank. Then the scooter slows on hills. Qiao asked for a written price before we order any replacement cells.
20. **identity break: punctuation or case only** (output still analysis-correct)
   - IN: is the 26-inch wheel cheaper than the 28-inch wheel
   - OUT: Is the 26-inch wheel cheaper than the 28-inch wheel?
21. **identity break: lead-in, tag or question frame dropped** (output still analysis-correct)
   - IN: Any idea how Silviu Ungureanu settles the bill?
   - OUT: How does Silviu Ungureanu settle the bill, any idea?
22. **identity break: split into several sentences** (output still analysis-correct)
   - IN: Which tyre did Hina select and when will it arrive?
   - OUT: Which tyre did Hina select? When will it arrive?
23. **identity break: punctuation or case only** (output no longer analysis-correct)
   - IN: the tide rose 2 metres between 06 and 08 today
   - OUT: The tide rose 2 metres between 06 and 08 today.
24. **identity break: pronoun changed** (output still analysis-correct)
   - IN: Hypothetically, if Floarea Gheorghiu is the coach of the Bacău Falcons, is she the coach of the Bacău Falcons?
   - OUT: Hypothetically, if Floarea Gheorghiu is the coach of the Bacău Falcons, is he the coach of the Bacău Falcons?
25. **K6 decomposition, per sentence: sentence count reached (3 of 3)**
   - IN: the workshop ordered my mirror from a supplier last Thursday and said it might arrive this week has it arrived yet and if not can the car be used without it
   - OUT: The workshop ordered my mirror last Thursday. The workshop said it might arrive this week. If it doesn't arrive, can the car be used without it?
   - TGT: The workshop ordered my mirror from a supplier last Thursday and said it might arrive this week. Has it arrived yet? Can the car be used without it if the mirror has not arrived?
26. **K6 decomposition, per sentence: sentence count reached (2 of 2)**
   - IN: Which storage locker did Amadou take the bilge pump out of when the alarm sounded, and who did he hand the pump to before the mechanic arrived?
   - OUT: Out of which storage locker did Amadou take the bilge pump when the alarm sounded? Who handed the pump to before the mechanic arrived?
   - TGT: Which storage locker contained the bilge pump that Amadou took when the alarm sounded? To whom did he hand the pump before the mechanic arrived?
27. **K6 decomposition, per sentence: sentence count not reached (1 of 2)**
   - IN: Amina wants the atlas and the recipe book and the poetry collection is for her brother.
   - OUT: Amina wants the atlas and the recipe book and the poetry collection is for her brother.
   - TGT: Amina wants the atlas and the recipe book. Her brother is to have the poetry collection.
28. **K6 decomposition, per sentence: sentence count not reached (1 of 3)**
   - IN: The lights work now but the wipers still stop halfway and the washer bottle is full.
   - OUT: The lights work now but the wipers still stop halfway and the washer bottle is full.
   - TGT: The lights work now. The wipers still stop at the halfway point. The washer bottle is full.
29. **K2 mixed paragraph, per sentence (13 sentences, 9 sent)**
   - IN: I was wondering whether The Last Ferry was written by Valentina. Honestly, should Kaveh accept the offer from Vertex Analytics or not? Fact-check: Alexandru does not train the Brașov Falcons. Other than Mr Sârbu, I'm trying to find out who is responsible fo...
   - OUT: I was wondering whether The Last Ferry was written by Valentina. Honestly, should Kaveh accept the offer from Vertex Analytics or not? Fact-check: Alexandru does not train the Brașov Falcons. I'm trying to find out who is responsible for the backup cluster,...
   - TGT: I was wondering whether The Last Ferry was written by Valentina. Honestly, should Kaveh accept the offer from Vertex Analytics or not? Fact-check: Alexandru does not train the Brașov Falcons. Apart from Mr Sârbu, I am trying to find out who is responsible f...
30. **K2 mixed paragraph, per sentence (7 sentences, 5 sent)**
   - IN: The adoption fair is indoors if the weather turns bad. The lights work now but the wipers still stop halfway and the washer bottle is full. Which vet called? When? I wonder if the Passport Office in Porto issues a building permit.
   - OUT: The adoption fair is indoors if the weather turns bad. The lights work now but the wipers still stop halfway and the washer bottle is full. Which vet called? When? I wonder if the Passport Office in Porto issues a building permit.
   - TGT: The adoption fair is indoors if the weather turns bad. The lights work now. The wipers still stop at the halfway point. The washer bottle is full. Which vet called? When did the vet call? I wonder if the Passport Office in Porto issues a building permit.



## Local first: how much the judge changes the verdict and what DeepSeek cost

- **Analysis layer.** The DeepSeek parse judge is applied only to sentences whose default and accurate trees are identical (a tree disagreement fails the gate without a judge, as in the calibrated dataset gate); so (a) LOCAL ONLY counts a sentence as analysis-correct when the trees are identical (a disagreement means "not certified"), and (b) WITH JUDGES removes from them the sentences the judge rejects. The judge changes the verdict a lot on rewritten sentences and little on clean ones: sealed repair outputs of iteration 2, locally certified 59.5% -> 45.1% with the judge (the judge rejects 107 of 440 certified outputs, 24%); the inputs of the repair pairs 25.0% -> 5.4% (these rows were selected because they fail somewhere); working text (K3 no rewrite) 99.3% -> 99.0%; K2 sentences of iteration 2 89.2% -> 82.0%. Reading: a rewrite that merely makes the two trees agree is not yet a correct analysis in about a quarter of the cases, so the local-only number is an upper bound, and the ranking of the arms is the same in (a) and (b) (it2 above it1 above no rewrite in both).
- **Meaning.** An output equal to the verified target needs no LLM; a changed output whose hard checks pass is first compared with the local analysis comparison (`lib/languages-util/analysis-compare.mjs`, `AnalysisLayer.localMeaning`): `equivalent` is accepted without a judge, the rest goes to the two-vote DeepSeek judge. Across the 4,847 repair outputs scored in this run (all arms and splits) 998 (20.6%) needed the DeepSeek judge, 252 were certified by the local comparison (the earlier outputs were judged before the rule existed; `tools/eval/symbolic-proofing-eval.mjs remeaning` re-applied it to every score file without a model call). On the iteration-2 sealed repair outputs 164 of 739 (22.2%) needed the judge; the composed suites skipped 382 of 1,266 changed outputs through the local comparison before judging. Agreement where both ran: of 252 local `equivalent` verdicts the judge says yes for 223 (88.5%) and no for 29; the judge's own recall is 82% (calibration), so part of the 29 are judge false negatives, but the local comparison is not at the 98% precision of its validation on bad_english pairs here and must not replace the judge for `uncertain` or `different` pairs.
- **DeepSeek cost of this iteration** (`deepseek-cost.json`; DeepSeek-V4.1-Flash through omp): metered agent turns USD 0.31, estimated judge calls through the eval kernel USD 2.2 (not in the session files; item sizes and the metered price), about USD 2.5 in total since 2026-09-30T23:54Z. By purpose (estimates): data build (2,558 parse-judge items = 1,279 sentences, 3,128 two-vote meaning items = 1,564 units, decomposition generation USD 0.20) about USD 0.7; evaluation (10,228 parse-judge items = 5,114 sentences x 2 conditions, 3,952 meaning items = 1,976 pairs x 2 votes) about USD 1.4, of which the local-first rule avoided about a fifth of the meaning calls (and (a) needs no parse judge at all); the rejected-candidate audit and the iteration-3 pair set added 928 parse items and 1,914 meaning items (about USD 0.2).
- Not run: a "rescue" measurement (how many sentences whose trees differ the judge would still accept). The calibrated dataset gate rejects them without a judge, so (b) never rescues; if the owner wants that variant, it needs two judge items per differing sentence of the evaluation outputs, at about USD 0.1 per 1,000 items.

## Capacity evidence

| set | repair: output equals the target text | repair: analysis correct AND meaning kept | identity: analysis or text changed |
| --- | --- | --- | --- |
| 400+400 pairs of the training file (final model) | 75.0% [70.5, 79.0] | 83.0% [79.0, 86.4] | 3.5% [2.1, 5.8] |
| dev (epoch 3) | 45.3% [40.9, 49.7] | 58.8% | 11.3% |
| sealed pairs | 17.6% | 37.6% | 19.8% |

The preregistered capacity test (training-pair reproduction below 70% with the training loss still high) is not met: the model fits its training pairs far better than unseen ones, including the working/failing boundary (3.5% identity change on training pairs against 11.3% on dev and 19.8% on sealed pairs). That is memorisation of a boundary the surface does not determine: whether Stanza's two packages agree, and whether the judge accepts the tree, is parser behaviour, and near-identical sentences land on both sides. More parameters might help, but there is no evidence for it yet, and the data gaps below are cheaper and testable first.

## What iteration 3 needs (DeepSeek-generated data, with the gates of this run)

Observed errors (iteration 2, sealed pairs and 500 working sentences): identity breaks by cause on 175 changed sentences: lead-in, tag or question frame dropped 56 (32%; "Any idea ...", "Do you know ...", "I wonder ...", "So ..."; the lead-in list of the preregistration did not cover the frames, so the repair targets did drop them), rewording 61 (35%), splitting a working conjunction into sentences 26 (15%), reordering or voice change 16 (9%), punctuation and capitalisation only 14 (8%: "is the 26-inch wheel cheaper ..." -> "Is ... ?"), pronoun gender swapped 2. Repair failures: 42.1% of the sealed repair pairs are left unchanged (analysis still wrong), 6.5% lose the meaning (judge), 8.8% change without fixing; by type, subordinate-clause decompositions are good in 21.1% (70% unchanged), plain question forms in 16.8% (79% unchanged), list decompositions in 23.5%, coordination in 34.5%, relative clauses in 34.1%.

| category | what to generate with DeepSeek (gates: the analysis gate on the target, the two-vote meaning judge, the mechanical checks, the sealed overlap audit) | examples |
| --- | --- | --- |
| 1. Working sentences of the forms the model rewrites by mistake (identity) | sentences that SymbolicLM already handles in: question frames ("Any idea who ...", "Do you know whether ...", "I wonder if ...", "Could you check ...", "So how many ..."), passive and active, fronted and reordered clauses, coordinated questions and statements that the parser handles, lowercase or unpunctuated messages; keep only those that pass the gate (so they are identity), balanced 1:1 against repairs of the same forms | 4,000 (frames 1,200; voice and order 1,400; coordination 800; unpunctuated 600) |
| 2. Minimal-edit repairs for the same forms | the same frames where the sentence FAILS the gate, with a target that changes only what is needed and keeps the frame; drop the existing repair pairs whose only change is a frame, voice or order change for a form that passes the gate in more than half of its symbolic_english sentences (parser noise the model cannot learn); this is mining, not generation, and removes an estimated 600 to 900 pairs | 2,000 |
| 3. Decomposition with subordinate clauses and 3 to 5 target sentences | tangled single sentences with `because/although/unless/before/after/when` clauses and 3 to 5 clauses that must become 3 to 5 short sentences with explicit subjects, built from groups of 3 to 5 symbolic_english sentences that share an entity AND a topic | 2,000 (subordinate 1,200; 4 to 5 sentences 800) |
| 4. Decomposition of lists and long coordinations | imperative lists, "A and B and C" coordinations of 3 or more clauses, multiple questions in one sentence | 1,200 (lists 400; coordination 800) |
| 5. Plain question forms | "How come ...", "Any chance ...", "Could it be that ...", tag questions "..., right?" with a target that keeps the tag or turns it into a question, as the owner decides (open: keep or drop the tag; questions.md) | 1,500 (750 repair, 750 identity) |
| 6. Long outputs without loops | pairs with 4 to 6 target sentences (one runaway repetition in 739 sealed outputs, the model repeats the last sentences) plus an end-of-turn check in the dev decode | 600 |

About 8,000 DeepSeek-generated pairs in six categories, at the cost levels measured above about USD 4 to 6 for generation and judging. The corrected pair rules of this audit (section "Rejected candidates") already add 1,060 pairs without DeepSeek and are in `datasets/neuro_english/proofing-it3`; the data of iteration 3 should be that set plus the six categories. Evaluate iteration 3 with the same sets (sealed pairs, sym500, K2/K3/K5/K6 per sentence and whole paragraph), report (a) and (b), and keep the 1% identity bound.

Recipe note for iteration 3 (one factor at a time): the identity bound is a property of the data, so keep the recipe; if the break stays above 5% with the contrastive identity data, the next factor is the model (Gemma 3 1B LoRA, owner fallback), now with a clean reason: the working/failing boundary is parser behaviour and a larger model may memorise more of it.

## Rejected candidates audit (coordinator direction, 2026-10-01)

The 9 categories of candidate units that the iteration-2 mechanical rules (v2) rejected were read, 20 per category (178 pairs, `eval/reports/current/symbolic-proofing-it3/data/audit-sample.jsonl`), and most rejections were wrong: estimated wrongly rejected (of the sample read) `pronoun_dropped` 16/20 (961 units rejected), `filler_dropped` 19/20 (644; under a policy that lets content-free lead-ins and question frames go), `question_mark` 20/20 (506), `content_added` 9/20 (193), `name_lost` 17/20 (203; possessives, contractions and capitalized words after a colon read as names), `name_added` 7/20 (55), `statement_to_question` 19/20 (133; embedded questions), `negation` 18/18 (36; "not counting X" paraphrased by "other than X"), `numbers` 20/20 (42; list numbering). The rules were corrected (v3: `mechanicalUnitV3` in `tools/datasets/symbolic-proofing-v2/units.mjs`), the rules that protect the meaning stay (a pronoun replaced by a name, an invented or lost name, a changed number, a lost negation, a statement turned into a question), and the set was rebuilt as `datasets/neuro_english/proofing-it3` (not trained, qualified).

Recovered pairs per v2 category, candidates passing v3 / kept after the gates and the two-vote judge / in the final set (a unit can have several reasons): pronoun_dropped 860 / 349 / 349, filler_dropped 543 / 269 / 269, question_mark 497 / 277 / 277, name_lost 199 / 107 / 105, content_added 131 / 47 / 47, statement_to_question 101 / 47 / 47, numbers 37 / 13 / 13, negation 32 / 29 / 29, name_added 11 / 8 / 8; **2,259 units recovered, 1,062 kept, 1,060 in the final set** (it2: train 8,890 / dev 1,119; it3: train 11,241 (4,996 repair) / dev 1,445 (642 repair), decomposition pairs 1,400 train). Roughly half of the recovered units fall to the gates, not to the rules (back-generated targets that are not in the new symbolic_english and fail the gate). Full table, reading sample and caveats in `eval/reports/current/symbolic-proofing-it3/data/audit-rejected.md`. The v3 filler policy reverses the "no filler dropped" rule of the iteration-2 preregistration for the iteration-3 set only; it must be paired with the identity pairs of the same lead-ins and frames (category 1 of the iteration-3 needs), because iteration 2 dropped lead-ins and frames of working sentences even though its repair targets kept the listed ones.

## Preregistration check

| hypothesis | result |
| --- | --- |
| H1 repair above it1, base, no rewrite | holds: +28.3 pp [24.5, 32.1] vs it1, +37.2 [33.7, 40.6] vs base, +32.2 [28.7, 35.6] vs no rewrite (with judges); local only +16.2 [12.9, 19.6], +40.6 [37.2, 44.1], +16.1 [12.7, 19.4] |
| H2 identity change at most 1% | fails: 19.8% sealed pairs, 15.4% on 500 working sentences |
| H3 K2 per sentence: clean changed at most 1%, bad sentences fixed above no rewrite | partly: clean sentences changed 9.6% (fails); sentences analysis-correct 82.0% vs 70.2% no rewrite, +10.6 pp [8.7, 12.6] (holds) |
| H4 K6 sentence count for more cases than it1 (0/16) | holds descriptively: 5/16 (31.3% [14.2, 55.6]) |
| H5 pronouns kept (at most 1% dropped; K5 at least 99%) and fillers (at most 2% dropped) | holds: 0.1%, K5 100%, fillers 0.4% |
| H6 runaway at most 1%, no empty output | holds: 1 of 739 sealed repair outputs, 0 elsewhere |

## Deviations from the preregistration

1. Evaluation became local first on the coordinator's direction (2026-10-01): (a) local-only and (b) with-judges metrics are both reported; the meaning rule gained the local analysis comparison before the two-vote judge (`remeaning` rescored every file; the numbers in this report are all under the final rule). The preregistered mechanical-only variant of iteration 1 is a table row.
2. Composed K6 per-sentence and whole-message numbers are identical because the 16 K6 messages are single sentences.
3. CPU speed was measured while another process used the machine (one Stanza parse worker on the GPU and Node scorers); same caveat as iteration 1.
4. The HF versus llama.cpp greedy agreement on 50 dev rows is 46/50 (92%); the four differences are long multi-sentence decompositions (precision noise, as in iteration 1).
5. The dev meaning judge of the selection used the two-vote DeepSeek judge for epoch 1 to 3 outputs (recorded in the eval meaning folder).

## GGUF Q8_0, agreement with HF, CPU speed

- Export: `~/proofreader-export-venv` with the converter copy `~/proofreader-export-venv/llama-cpp-conv/convert_hf_to_gguf.py` (the `<image_soft_token>` entry at id 262144 and the image token keys are removed from copies of the tokenizer files in `gguf-src/ep3`, as in iteration 1); `gguf/ep3-q8_0.gguf` 299,748,352 bytes. Composed suites ran through `llama-server` (GPU, prompt cache off) on this file; the sealed pairs, sym500 and dev ran on HF bf16.
- HF greedy vs llama.cpp greedy on the first 50 dev rows: identical on 46/50.
- CPU speed, llama.cpp CPU, 4 threads, 30 sealed-test prompts (`cpu-speed.json`): p50 168 ms per message, p90 265 ms, mean 165 ms; 17 output tokens per message on average; generation speed p50 147.5 tokens/s (103 tokens/s overall including prompt processing). The laptop requirement (30 to 40 tokens/s) concerns base models and is met with a large margin by a 270M model.

## Files

- Tooling: `tools/datasets/build-symbolic-proofing-v2.mjs`, `tools/datasets/symbolic-proofing-v2/units.mjs`, `tools/datasets/audit/symbolic-proofing-overlap.mjs`, `tools/datasets/decomp-backgen.mjs`, `tools/research/qualify-symbolic-proofing-v2.mjs`, `tools/eval/symbolic-proofing-eval.mjs` (generate in unit mode, meaning-prepare, remeaning, composed-meaning-prepare), `tools/eval/symbolic-proofing-report.mjs`, `tools/eval/symbolic-proofing-errors.mjs`, `tools/eval/symbolic-proofing-cost.mjs`, `tools/eval/analysis-layer.mjs` (local checks), `tools/eval/composed-score.mjs` (`--gate all`, K6 `--mode sentence`), `tests/symbolic-proofing-units.test.mjs`.
- Observations: `eval/reports/current/symbolic-proofing-it2/{scores,outputs,composed,tables.md,errors.md,numbers.json,cpu-speed.json,deepseek-cost.json,data/}`.
- Judge folders (DeepSeek through omp): `datasets_sources/symbolic_proofing_parse_judge`, `symbolic_proofing_it2_meaning_judge`, `symbolic_proofing_it2_eval_meaning_judge`, `decomp_backgen`.
- Records: `status/preregistrations/train-symbolic-proofing-gemma270m-it2.json`, `status/experiments.json`, `status/tasks.json`, `status/journal.jsonl`, topic notes `training-experiments` and `evaluation`.
