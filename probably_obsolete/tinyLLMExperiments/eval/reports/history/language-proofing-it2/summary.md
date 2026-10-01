# LanguageProofingLLM iteration 2: Gemma 3 270M IT + LoRA on vocabulary-covering data

Experiment `train-language-proofing-gemma270m-it2` (preregistration `status/preregistrations/train-language-proofing-gemma270m-it2.json`). Natural-language and grammatical-analysis layer only. All numbers are regenerable from `eval/reports/current/language-proofing-it2/` (`scores/`, `outputs/`, `composed/`, `compare-*.json`, `tables.md`, `paired.md`). The targets of the training data are DeepSeek text with review status pending (flash for iteration-1 data, `slow` for the back-generated pairs) and the judges are DeepSeek too; nothing here is human-reviewed. Comparisons are only on our synthetic data, against no rewrite, the untrained gemma-3-270m-it and iteration 1.

## Verdict (short)

* **The vocabulary hole is closed.** On the child probe (229 units whose input names a child: 214 sealed units plus 38 hand-written sentences) iteration 1 turned "copilul lui" / "child of" into "parent" in 204 cases (89.1%); iteration 2 keeps the relation word in 229/229 and flips to "parent" once (0.4%). Part of this is the rule-written family pairs (207 of the 270 training targets with "child"; DeepSeek gave only 21 unique natural ones), but the 182 sealed Romanian child units are different sentences and come out right (182/182).
* **Clean sentences are left untouched much more often, but the 99% goal is missed.** clean900: 98.1% (883/900, Wilson [97.0, 98.8]) against 94.8% for iteration 1 (paired +3.3 pp [+2.0, +4.7]). Keyboard mash is returned unchanged in 98.7% of 150 strings (iteration 1: 66.7%). In composed K4 per sentence with every sentence sent, 1.4% of clean sentences are changed (iteration 1: 3.9%, the preregistered bar was 1%).
* **The composite did not improve.** Judged sample (472 repair units): 66.3% against 66.1% for iteration 1 (paired +0.2 pp [-2.5, +3.0]); ro 69.6% against 69.6%; mixed 45.8% against 37.5% (24 units, interval [-8.3, +25.0]); noisy_en 59.6% against 60.6%. Meaning judge 82.0% against 81.4% (+0.6 pp [-3.0, +4.2]). On the full sealed test the mechanical composite is 0.7 pp lower ([-1.0, -0.4]), and agreement with the DeepSeek-flash references fell (chrF 0.855 against 0.898; ro exact match 34.6% against 51.4%), see "Why the reference agreement fell".
* **Held-out vocabulary is not learned by generalization.** On 574 pairs whose target contains a word that is absent from training (cousin, niece, uncle, tenant, supervisor, tutor, owe, adopt, audit, boatyard) the held-out word is kept in 45.8% of the outputs (iteration 1: 49.1%, untrained base 36.4%, no rewrite 42.1%; Romanian inputs are the weak part). The mechanical composite on that dev is 96.9% against 95.6%. 270M copies or maps an unseen content word to a known one instead of translating it; vocabulary has to be in the data.
* **Chat registry: not switched.** The preregistered rule needs both the composite (judged sample) and the identity interval above 0; the composite interval contains 0, so `language-proofing-llm` in `config/formalizers.json` still points to the iteration-1 GGUF. Iteration 2 is clearly better on the child error, identity and mash, and slightly worse on K4 bad-sentence repair and reference agreement; the owner may still prefer it for the first three (GGUF ready at `models/gemma/language-proofing-gemma270m-it2/proofreader/gguf/ep3-q8_0.gguf`).
* **270M has not plateaued on the evidence needed for the 1B trigger.** The remaining errors are lexical (unseen words, near-synonym choices) and data-policy artifacts, not capacity: dev loss 0.1187 / 0.1000 / 0.1012 (epochs 1-3, flat after epoch 2), and the held-out result says "add vocabulary". No 1B run was made or is indicated by this run.

## Identity of the run

| item | value |
|---|---|
| base model | `daniel-dona/gemma-3-270m-it` revision `99073d6b6edb0e298d163f964ec2b9d970b3408d` (byte-identical mirror of `google/gemma-3-270m-it`), trained from the BASE, not from iteration 1 (keeps the comparison a pure data comparison and does not carry the child-to-parent mapping of the iteration-1 weights) |
| recipe | `config/train-gemma.json` sha256 `ecc7fe04...`, unchanged (LoRA r16 alpha32, lr 2e-4, batch 2 x 8, bf16, seed 42, 3 epochs) |
| run | `models/gemma/language-proofing-gemma270m-it2/proofreader` (role id `proofreader`), attempt A5 (Podman job `langproof-it2-train-a5`), 6,924 steps in 71.6 minutes, finished 2026-10-01T02:58:10Z; checkpoint `epoch-3`, merged `merged-epoch-3`, GGUF Q8_0 `gguf/ep3-q8_0.gguf` |
| training data | `datasets/bad_english/proofing-v2`, manifest sha256 `7aab29b68ea8...`, train 36,915 / dev 5,173 pairs (`proofreader/train.jsonl` sha256 `a2bdc9156ba4...`, `dev.jsonl` `64f3e6135607...`) |
| qualification / receipt | `status/training/qualification-language-proofing-it2.json` (`d65bed200ba9...`), `status/training/authorization-gemma-language-proofing-gemma270m-it2.json` (`8a042b74cc1f...`), owner decisions of 2026-09-30T17:32:38Z, 17:41:07Z, 17:46:38Z, 19:58:29Z, 22:48:59Z and 22:54:36Z (scope `status/training/owner-approval-language-proofing-it2.json`) |
| projection | `datasets/bad_english/proofing-it2-projection` (manifest `92654ada...`): the iteration-1 projection rebuilt from the CURRENT `datasets/bad_english` files (train sha `bad_english/train.jsonl`, dev, manifest recorded in the preregistration) after the orchestrator reported the sealed merge and the removal of 66 content-word-duplicate rows; the iteration-1 artifacts are untouched |
| sealed units | `eval/suites/bad_english/proofing-test.jsonl` sha256 `dc806bd35f74...` (identical to the file iteration 1 was finally scored on; source `test.jsonl` `9204379d...`), `proofing-test-clean.jsonl` `760fad92211c...`, `proofing-probe-child.jsonl` `ee3f62d2f9d2...` |
| arms | no rewrite; untrained 270M, same message-only prompt; iteration 1 (`merged-epoch-3`, outputs reused and re-scored by the iteration-2 tooling); iteration 2 |

## Training data

Composition of `proofing-v2` train (36,915 pairs): 28,700 repair + 8,215 identity (22.3%). By kind: ro 15,997, mixed 6,414, noisy_en 6,289, clean identity 7,917, keyboard-mash identity 298. Sources: iteration-1 projection pairs (after removing sealed overlaps), DeepSeek back-generated pairs of **parts 000-009** (2,500 rows, 16 null rows; the generator finished all 26 parts at 02:26 and rewrote its output files at 02:32; the build reads a snapshot of parts 000-009 taken at 02:35, `datasets_sources/language_proofing_it2_backgen_judge/used/`), 489 rule-written family-relation pairs, identity and mash pairs. Parts 010-025 are unused here and are prepared as `datasets/bad_english/proofing-v3` (below).

Filters of the back-generated pairs (counts are candidates; sentence pairs after them are in the manifest): (a) `new.en` passes the clean-English gate and has a content word that is not in the input; (b) mechanical checks per sentence (names, numbers, quotes, question marks, length, negation parity with two false-positive repairs: the Romanian tag ", nu?" and apostrophe-less contractions); (c) ro versions classified ro or mixed by LanguagesUtil, noisy_en versions different from the clean sentence, mixed versions not identical to it; (d) the calibrated two-vote meaning judge (m1 AND m2) on the whole message pair, noisy_en needs both votes, ro and mixed are dropped only when both votes say no (the judge is calibrated on English originals only); (e) duplicates, exact sentence matches with any sealed text (39k folded hashes of every `eval/suites` test, proofing and composed text) and content-word signatures of the sealed bad_english clean targets. Judge votes (yes/no of m1, m2) on the 10 parts: new/noisy_en 1411 yy, 9 yn, 6 ny, 11 nn; new/ro 2105 yy, 151 yn, 76 ny, 54 nn; new/mixed 2053 yy, 141 yn, 124 ny, 76 nn; same/ro 1924 yy, 115 yn, 73 ny, 38 nn; same/mixed 1927 yy, 101 yn, 69 ny, 71 nn; same/noisy_en 1283 yy. Dropped by the judge rule: 41 noisy_en, 115 ro, 160 mixed pairs. 20 pairs were dropped because a Romanian family word (copil, fiu, fiica, mama, tata) did not come out as its English counterpart. Of the iteration-1 projection, 5,245 sentence pairs were dropped by the full sealed hash set (most match the composed suites that were regenerated after the iteration-1 hashes were written, see "Caveats").

Target-consistency rules (found necessary by the dev evidence of attempts A2 to A4, see "Attempts and deviations"): a target keeps the prompt's absence of a final period; quotation marks around English spans that the prompt lacks are not added (Romanian titles keep their quotes, which is what keeps them out of the English text); a noisy_en pair whose prompt passes the clean-English gate and equals its target after folding case, punctuation and spacing is an identity pair (1,111 iteration-1 train pairs and 757 back-generated pairs).

Identity (22.3% of train, iteration 1: 10%): gate-clean sentences of symbolic_english train and dev, `new.en` sentences, natural lead-in sentences ("Quick question:", "Also,", "Any chance", ", right?") and 1,100 synthetic lead-in variants, plus the converted gate-clean noisy pairs. Unintelligible input (keyboard mash): the policy is that **the target is the input unchanged**, so the model never invents text and the chat shows no proposal; 298 train, 60 dev and 150 evaluation strings (seeded keyboard-row, consonant and repeated-letter patterns, gate-unclean, disjoint from each other and from the sealed texts).

Dev sets (selection only, never sealed): the iteration-1 dev (`dev2300` is a stratified 300-unit sample of the regular dev, 5,173 units), `dev-backgen` (1,488 units: an 8% hash selection of the source rows, deviation D1: all 6,363 source rows are symbolic_english train rows, so no dev source row exists), the **held-out vocabulary dev** `dev-heldout` (574 pairs, 200 ro, 200 mixed, 174 noisy_en, targets contain cousin, niece, uncle, tenant, supervisor, tutor, owe, adopt, audit or boatyard; no train pair contains any of them) and `mash-eval` (150 strings). The held-out pairs come from train-source rows and are not in train.

### Vocabulary coverage (training targets, repair pairs, counting the oversampled copies of the hole words; full table `vocab-coverage.json`)

| word | it1 train | it2 train | of which natural DeepSeek | rule-written | oversampled copies |
|---|---|---|---|---|---|
| parent | 389 | 462 | 153 | 0 | 2 |
| **child** | 3 | 270 | 21 | 207 | 42 |
| **son** | 2 | 219 | 68 | 83 | 68 |
| **daughter** | 74 | 325 | 83 | 83 | 121 |
| mother / father | 5 / 3 | 137 / 127 | 39 / 34 | 57 / 59 | 41 / 34 |
| sister / brother | 66 / 46 | 145 / 138 | 78 / 89 | 0 | 6 / 11 |
| aunt / nephew / twin | 1 / 3 / 0 | 78 / 62 / 48 | 71 / 62 / 24 | 0 | 6 / 0 / 24 |
| husband / wife / fiance | 5 / 4 / 0 | 48 / 44 / 46 | 24 / 22 / 46 | 0 | 24 / 22 / 0 |
| grandparent / grandchild / in-law / stepchild | 0 / 0 / 2 / 0 | 37 / 10 / 18 / 12 | 17 / 5 / 13 / 6 | 0 | 20 / 5 / 5 / 6 |
| cousin, uncle, niece (held out) | 1, 0, 1 | 0, 0, 0 | - | - | - |

Romanian sources of child, son and daughter: 227 train pairs with a "copil*" source all carry a child word in the target (0 misaligned); the held-out words (cousin, niece, uncle, supervisor, tutor, tenant, owe, adopt, audit, boatyard) have 0 train targets by design; "courthouse" and "theater" occur only inside identity sentences (the generator rarely used them as repair targets). Every other word of the TASK.md list (164 words) has repair targets in train; the full per-word table with the split by source is in `vocab-coverage.json`.

## Results

Metrics, tools and units are those of iteration 1 (`tools/eval/language-proofing-eval.mjs`, now parametrized by `LP_WORK`). Reference-free metrics (clean-English gate, content preserved incl. negation) cover all sealed units; reference metrics the units with a reference; the analysis gate and the meaning judge the 600-unit judged sample (472 repair units, 127 identity). The meaning judge is uncalibrated for Romanian and mixed originals.


### Why the reference agreement fell (and what it does not mean)

chrF against the DeepSeek-flash references falls from 0.898 to 0.855 (ro 0.876 to 0.810, exact match 51.4% to 34.6%; mixed 0.888 to 0.861; noisy_en 0.943 to 0.939 but exact 75.0% to 55.0%). Three causes, in the order of what the data shows: (1) noisy_en: 20.3 pp more of the sealed noisy units are returned unchanged, by design (gate-clean sentences that only lack capitals or a final period are identity pairs, and targets keep the prompt's final period); the references capitalize and punctuate, so exact match drops although the sentence is as clean for the gate and the analysis. Folded for case and punctuation the noisy_en exact match is 78.7% against 78.8%. (2) ro and mixed: the folded exact match also falls (ro 52.3% to 35.7%), so this is word choice: the back-generated half of the new Romanian training data was written by a different DeepSeek model than the flash references of the sealed units, and iteration 2 no longer trains on the 1,536 train pairs (5,245 sentence pairs of the rebuilt projection) that match sealed texts; the meaning judge and the analysis gate, which do not compare with a reference, are equal to iteration 1 on the same units. This is a hypothesis consistent with the numbers, not a tested cause. (3) The question-mark rule and gate-clean spacing: see example 10 and 11 below, spacing before a question mark and doubled "!!" are now left alone (iteration 3 should repair them).

## Paired comparisons (bootstrap 95% interval over units, 2,000 resamples)

| it2 minus | scope | units | composite | clean % | content % | analysis % | meaning % | chrF | unchanged % |
|---|---|---|---|---|---|---|---|---|---|
| iteration 1 | repair | 472 | +0.2 [-2.5, +3.0] | -0.9 [-1.9, +0.0] | +0.0 [-0.9, +0.9] | +0.2 [-2.5, +3.0] | +0.6 [-3.0, +4.2] | -0.056 [-0.074, -0.039] | +4.0 [+2.1, +6.1] |
| iteration 1 | repair:ro | 349 | +0.0 [-3.4, +3.4] | -0.6 [-1.4, +0.0] | -0.3 [-1.4, +0.6] | +0.3 [-3.1, +3.7] | +0.3 [-4.0, +4.3] | -0.085 [-0.113, -0.059] | -0.3 [-0.9, +0.0] |
| iteration 1 | repair:mixed | 24 | +8.3 [-8.3, +25.0] | +4.2 [+0.0, +12.5] | +4.2 [+0.0, +12.5] | +4.2 [-8.3, +16.7] | -8.3 [-29.2, +12.5] | -0.067 [-0.130, -0.013] | +0.0 [+0.0, +0.0] |
| iteration 1 | repair:noisy_en | 99 | -1.0 [-7.1, +5.1] | -3.0 [-7.1, +0.0] | +0.0 [+0.0, +0.0] | -1.0 [-7.1, +5.1] | +4.0 [-3.0, +11.1] | -0.005 [-0.023, +0.013] | +20.2 [+12.1, +29.3] |
| iteration 1 | identity | 127 | +0.0 [+0.0, +0.0] | +0.0 [+0.0, +0.0] | +0.0 [+0.0, +0.0] | +0.0 [+0.0, +0.0] | +1.6 [+0.0, +3.9] | +0.007 [+0.002, +0.015] | +5.5 [+1.6, +9.4] |
| untrained 270M | repair | 472 | +62.3 [+58.1, +66.5] | +62.7 [+57.8, +67.4] | +62.7 [+58.3, +67.2] | +46.0 [+40.2, +51.5] | +58.1 [+53.0, +63.1] | +0.531 [+0.500, +0.560] | -12.3 [-16.7, -7.8] |
| untrained 270M | repair:ro | 349 | +68.2 [+63.3, +73.1] | +83.1 [+78.8, +87.1] | +57.6 [+52.4, +62.7] | +59.9 [+54.1, +65.0] | +52.1 [+46.1, +58.2] | +0.559 [+0.524, +0.594] | -25.2 [-30.1, -20.3] |
| untrained 270M | repair:mixed | 24 | +41.7 [+20.8, +62.5] | +50.0 [+29.2, +70.8] | +70.8 [+54.2, +87.5] | +4.2 [-20.8, +29.2] | +58.3 [+33.3, +79.2] | +0.446 [+0.346, +0.543] | +12.5 [+0.0, +29.2] |
| untrained 270M | repair:noisy_en | 99 | +46.5 [+36.4, +56.6] | -6.1 [-13.1, +2.0] | +78.8 [+70.7, +86.9] | +7.1 [-6.1, +18.2] | +78.8 [+69.7, +86.9] | +0.505 [+0.445, +0.564] | +27.3 [+18.2, +37.4] |
| untrained 270M | identity | 127 | +34.6 [+26.0, +44.1] | +1.6 [+0.0, +3.9] | +47.2 [+38.6, +55.9] | +2.4 [-5.5, +10.2] | +82.7 [+75.6, +89.0] | +0.425 [+0.367, +0.480] | +95.3 [+91.3, +98.4] |
| no rewrite | repair | 472 | +61.0 [+56.6, +65.5] | +84.1 [+80.7, +87.1] | +0.4 [-0.6, +1.7] | +57.8 [+53.2, +62.5] | -18.0 [-21.4, -14.6] | +0.290 [+0.258, +0.321] | -93.4 [-95.5, -91.1] |
| no rewrite | repair:ro | 349 | +69.6 [+64.8, +74.2] | +98.6 [+97.1, +99.7] | +0.6 [-1.1, +2.3] | +69.9 [+65.0, +74.5] | -17.5 [-21.5, -13.5] | +0.450 [+0.417, +0.483] | -100.0 [-100.0, -100.0] |
| no rewrite | repair:mixed | 24 | +33.3 [+16.7, +54.2] | +87.5 [+70.8, +100.0] | +0.0 [+0.0, +0.0] | +8.3 [-12.5, +29.2] | -33.3 [-54.2, -16.7] | +0.186 [+0.084, +0.289] | -87.5 [-100.0, -70.8] |
| no rewrite | repair:noisy_en | 99 | +37.4 [+27.3, +46.5] | +32.3 [+23.2, +41.4] | +0.0 [+0.0, +0.0] | +27.3 [+18.2, +36.4] | -16.2 [-23.2, -9.1] | +0.049 [+0.026, +0.072] | -71.7 [-80.8, -62.6] |
| no rewrite | identity | 127 | -0.8 [-2.4, +0.0] | +0.0 [+0.0, +0.0] | -0.8 [-2.4, +0.0] | +0.0 [+0.0, +0.0] | -0.8 [-2.4, +0.0] | -0.007 [-0.021, +0.000] | -1.6 [-3.9, +0.0] |

Sealed test, all units (mechanical layer), it2 minus it1:

| scope | units | composite (clean AND content) | clean % | content % | chrF | unchanged % |
|---|---|---|---|---|---|---|
| repair | 8435 | -0.7 [-1.0, -0.4] | -0.4 [-0.6, -0.2] | -0.3 [-0.5, -0.1] | -0.043 [-0.047, -0.039] | +4.3 [+3.9, +4.8] |
| repair:ro | 6237 | -0.4 [-0.7, -0.1] | +0.0 [-0.1, +0.1] | -0.4 [-0.7, -0.1] | -0.066 [-0.071, -0.060] | -0.0 [-0.1, +0.0] |
| repair:mixed | 422 | +0.2 [-1.7, +2.1] | +0.2 [-0.9, +1.4] | +0.0 [-1.4, +1.4] | -0.027 [-0.041, -0.013] | +1.2 [+0.2, +2.4] |
| repair:noisy_en | 1776 | -1.9 [-2.8, -1.1] | -1.9 [-2.6, -1.2] | -0.1 [-0.5, +0.4] | -0.004 [-0.009, +0.001] | +20.3 [+18.4, +22.3] |
| identity | 2276 | +0.3 [+0.1, +0.6] | +0.0 [+0.0, +0.0] | +0.3 [+0.1, +0.6] | +0.011 [+0.009, +0.014] | +5.5 [+4.5, +6.5] |

clean900 untouched, it2 minus it1: +3.3 pp [+2.0, +4.7] (n 900)

## All arms, all layers

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
| **iteration 2**, all repair | 8435 | 96.8 | 98.6 | 0.8553 (4683) | 42.2 |
| &nbsp;&nbsp;ro | 6237 | 99.7 | 98.4 | 0.8101 (2836) | 34.6 |
| &nbsp;&nbsp;mixed | 422 | 99.1 | 98.8 | 0.8608 (336) | 49.7 |
| &nbsp;&nbsp;noisy_en | 1776 | 86.2 | 99.2 | 0.9391 (1511) | 55 |

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
| **iteration 2**, all repair | 472 | 97 | 99.4 | 0.8523 | 67.6 | 82 | 66.3 (313/472) |
| &nbsp;&nbsp;ro | 349 | 99.1 | 99.1 | 0.8068 | 70.2 | 82.5 | 69.6 (243/349) |
| &nbsp;&nbsp;mixed | 24 | 100 | 100 | 0.8234 | 45.8 | 66.7 | 45.8 (11/24) |
| &nbsp;&nbsp;noisy_en | 99 | 88.9 | 100 | 0.9367 | 63.6 | 83.8 | 59.6 (59/99) |

### Clean sentences left untouched (clean900) and identity units

| arm | clean900 untouched % (k/n) | Wilson 95% | content broken % | judged identity untouched % |
|---|---|---|---|---|
| no rewrite | 100 (900/900) | [99.6, 100] | 0 | 100 (127/127) |
| untrained 270M | 2.2 (20/900) | [1.4, 3.4] | 82.7 | 3.1 (4/127) |
| iteration 1 | 94.8 (853/900) | [93.1, 96.1] | 0.1 | 92.9 (118/127) |
| **iteration 2** | 98.1 (883/900) | [97, 98.8] | 0.1 | 98.4 (125/127) |

### Dev sets (selection signal), mechanical layer

| arm | devbg repair composite % | devbg chrF | held-out repair composite % | held-out word kept % | dev2300 repair composite % | identity untouched % (dev) | mash unchanged % |
|---|---|---|---|---|---|---|---|
| no rewrite | 12.7 | 0.5281 | 14.5 | 42.1 | 9.1 | 100 (687/687) | 100 (150/150) |
| untrained 270M | 11.4 | 0.3417 | 12.5 | 36.4 | 7.8 | 1.7 (12/687) | 0 (0/150) |
| iteration 1 | 97.9 | 0.8343 | 95.6 | 49.1 | 98.7 | 90.1 (619/687) | 66.7 (100/150) |
| **iteration 2** | 98.2 | 0.9412 | 96.9 | 45.8 | 99.6 | 96.7 (664/687) | 98.7 (148/150) |

### Vocabulary probe (child cases)

| arm | child units | relation word kept | parent flip (child to parent) | parent units | parent kept |
|---|---|---|---|---|---|
| no rewrite | 229 | 24 (10.5%) | 0 (0%) | 4 | 1 |
| untrained 270M | 229 | 40 (17.5%) | 0 (0%) | 4 | 1 |
| iteration 1 | 229 | 20 (8.7%) | 204 (89.1%) | 4 | 3 |
| **iteration 2** | 229 | 229 (100%) | 1 (0.4%) | 4 | 3 |

### Composed K4, per sentence, every sentence sent (sendAll)

| arm | clean sentences changed | bad sentences fixed | bad rewritten wrongly | bad untouched | dropped components | paragraphs with added text | exact paragraphs |
|---|---|---|---|---|---|---|---|
| no rewrite | 0% (0/986) | 0.3% (2/578) | 0% (0/578) | 99.7% (576/578) | 0% (0/1564) | 0% (0/306) | 0% (0/306) |
| untrained 270M | 92.1% (908/986) | 0% (0/578) | 97.6% (564/578) | 1% (6/578) | 1.7% (26/1564) | 74.5% (228/306) | 0% (0/306) |
| iteration 1 | 3.9% (38/986) | 49.7% (287/578) | 48.4% (280/578) | 1.4% (8/578) | 0.4% (7/1564) | 29.7% (91/306) | 30.1% (92/306) |
| **iteration 2** | 1.4% (14/986) | 35.3% (204/578) | 57.3% (331/578) | 7.1% (41/578) | 0.6% (10/1564) | 35.9% (110/306) | 18.3% (56/306) |

Reading notes. The held-out-word column counts a target word as kept when the output contains the same word or an inflection; Romanian inputs with an unseen word score about 20% for every arm, because the model has to translate it, English noisy inputs about 80%. In K4 (306 paragraphs, per sentence, every sentence sent, host splitter, clean-English gate replaced by `--gate all`) iteration 2 fixes 35.3% of the bad sentences against 49.7% for iteration 1 and rewrites 57.3% wrongly against 48.4%: the K4 expected texts are capitalized and punctuated and K4 counts an exact match, so the case and final-period policy costs here (the bad K4 sentences are mostly gate-clean noisy sentences). For the same reason the iteration-1 K4 row (3.9% of clean sentences changed with sendAll) is not the 0.2% of the iteration-1 report, which used the gate and sent only 28% of the sentences. The untrained base changes 92% of clean sentences.

## Error categories (judged sample, repair units, exclusive, first match wins)

| category | iteration 2 units | share | iteration 1 units | share |
|---|---|---|---|---|
| pass everything | 260 | 55.1% | 257 | 54.4% |
| meaning judge rejects (wrong lexical choice, wrong translation, added or dropped detail, judge strictness) | 84 | 17.8% | 66 | 14.0% |
| only the analysis gate fails (meaning judge and mechanics pass) | 111 | 23.5% | 120 | 25.4% |
| keyboard-mash or unintelligible input (the output copies it, as the policy says) | 11 | 2.3% | 8 | 1.7% |
| other clean-English gate failure (untranslated word, spelling left) | 3 | 0.6% | 2 | 0.4% |
| content lost or changed mechanically | 3 | 0.6% | 3 | 0.6% |
| relation flip child to parent | 0 | 0.0% | 16 | 3.4% |

The meaning-judge rejects grew from 66 to 84 although the overall meaning rate is 82.0% against 81.4% (the categories are exclusive and the child flips of iteration 1 moved into other buckets); the examples below show the real classes: a near-synonym that changes the meaning (examples 15 to 18: "apple trees" became "his own tomatoes", "team meeting" became "equipment meeting", "take care of" became "maintain"), unseen vocabulary, and judge strictness on added hedges ("Plus," for "In addition,"). The mash outputs of iteration 2 are exactly the input; the gate category counts them because the gate calls them gibberish, which is the intended behavior.

## 30 examples (judged sample, deterministic selection; ref None = no reference exists)

| # | kind | input | reference | iteration 2 | iteration 1 | class |
|---|---|---|---|---|---|---|
| 1 | ro | În plus, Lin cântă în corul de cameră. | Also, Lin sings in the chamber choir. | Plus, Lin sings in the chamber choir. | In addition, Lin sings in the chamber choir. | pass everything |
| 2 | ro | Haruka Tanaka nu repară autobuzul școlii. | None | Haruka Tanaka doesn't repair the school bus. | Haruka Tanaka does not repair the school bus. | pass everything |
| 3 | ro | În plus, Lin Zhang nu e bucătăreasă la Filarmonica din Iași. | None | Plus, Lin Zhang is not a cook at the Filarmonica din Iași. | In addition, Lin Zhang is not a cook at the Filarmonica din Iași. | pass everything |
| 4 | ro | Mathieu nu muncește la Crăciun & Asociații. | Mathieu does not work at Crăciun & Asociații. | Mathieu does not work at Crăciun & Asociații. | Mathieu does not work at Crăciun & Asociații. | pass everything |
| 5 | ro | În plus, Łukasz este prezent la festivalul recoltei. | None | Plus, Łukasz is present at the harvest festival. | In addition, Łukasz is present at the harvest festival. | pass everything |
| 6 | mixed | Poți să verifici dacă Mirela face alergie la cat hair? | Can you check whether Mirela is allergic to cat hair? | Can you check whether Mirela is allergic to cat hair? | Can you check whether Mirela is allergic to cat hair? | pass everything |
| 7 | mixed | How cime Lucian has acc ess to the lab ? | How come Lucian has access to the lab? | How does Lucian have access to the lab? | How many people have access to the lab? | pass everything |
| 8 | mixed | Context: Chen e copilul lui Nour. | Context: Chen is Nour's child. | Background: Chen is the child of Nour. | Context: Chen is Nour's parent. | pass everything |
| 9 | mixed | True or false: Sorin visits Pune. | True or false: Sorin visits Pune. | True or false: Sorin visits Pune. | True or false: Sorin visits Pune. | pass everything |
| 10 | noisy_en | Not counting Mr Lefèvre, please find out who cooks at the Bistrița Arena!! | Not counting Mr Lefèvre, please find out who cooks at the Bistrița Arena! | Not counting Mr Lefèvre, please find out who cooks at the Bistrița Arena!! | Not counting Mr Lefèvre, please find out who cooks at the Bistrița Arena! | pass everything |
| 11 | noisy_en | Does Esmeralda own the old sailing boat ? | Does Esmeralda own the old sailing boat? | Does Esmeralda own the old sailing boat ? | Does Esmeralda own the old sailing boat? | pass everything |
| 12 | noisy_en | And is it the caxse that she borrow ed Soups of Transylvania ? | And is it the case that she borrowed Soups of Transylvania? | And is it the case that she borrowed Soups of Transylvania? | And is it the case that she borrowed Soups of Transylvania? | pass everything |
| 13 | noisy_en | Since Nils is allergic to dust mites and Élodie is allergic to dust mites and Larisa has an allergy to dust mites, do you knw if Florin doesn't have an allergy to dust mites ? | Since Nils is allergic to dust mites and Élodie is allergic to dust mites and Larisa has an allergy to dust mites, do you know if Florin doesn't have an allergy to dust mites? | Since Nils is allergic to dust mites and Élodie is allergic to dust mites and Larisa has an allergy to dust mites, do you know if Florin doesn't have an allergy to dust mites? | Since Nils is allergic to dust mites and Élodie is allergic to dust mites and Larisa has an allergy to dust mites, do you know if Florin doesn't have an allergy to dust mites? | pass everything |
| 14 | ro | Elif repară stivuitorul din depozit. | Elif repairs the forklift in the warehouse. | Elif repairs the warehouse forklift. | Elif repairs the forklift in the warehouse. | meaning judge rejects (wrong lexical cho |
| 15 | ro | Wojciech cultivă meri. | Wojciech grows apple trees. | Wojciech grows his own tomatoes. | Wojciech grows apple trees. | meaning judge rejects (wrong lexical cho |
| 16 | ro | Lucian se ocupă de autobuzul școlii sau nu? | Does Lucian take care of the school bus or not? | Does Lucian maintain the school bus or not? | Does Lucian take care of the school bus or not? | meaning judge rejects (wrong lexical cho |
| 17 | ro | Scuze de la început, mesajul o să fie cam lung. | Sorry about the beginning, the message will be a bit long. | Sorry for the beginning, the message should be as long as usual. | Sorry for the beginning, the message has to be as long as it is. | meaning judge rejects (wrong lexical cho |
| 18 | mixed | We have an echipă meeting soon. | We have a team meeting soon. | We have an equipment meeting soon. | We have a team meeting soon. | meaning judge rejects (wrong lexical cho |
| 19 | ro | Oare Mehmet Çelik este membru în corul Madrigal? | I wonder if Mehmet Çelik is a member of the Madrigal choir? | Is Mehmet Çelik a member of the Madrigal choir? | I wonder whether Mehmet Çelik is a member of the Madrigal choir? | only the analysis gate fails (meaning ju |
| 20 | ro | Matei închiriază terenul de lângă râu. | None | Matei rents the land by the river. | Matei rents the land by the river. | only the analysis gate fails (meaning ju |
| 21 | ro | În plus, Silviu se ocupă de ambulanța spitalului. | None | Plus, Silviu takes care of the hospital ambulance. | In addition, Silviu takes care of the hospital ambulance. | only the analysis gate fails (meaning ju |
| 22 | ro | Context: Lansarea produsului a fost amânată. | Context: The product launch was postponed. | Background: Lansarea produsului a been postponed. | Context: The product launch was postponed. | other clean-English gate failure (untran |
| 23 | ro | ultgamșor șorvrizor șorult | None | Ultgamșor șorvrizor șorult | ultgamșor șorvrizor șorult | other clean-English gate failure (untran |
| 24 | noisy_en | zxcvbnjmkzxcv | None | zxcvbnjmkzxcv | zxcvbnjmkzxcv | keyboard-mash or unintelligible input (c |
| 25 | noisy_en | xcvbnm.. rtyui | None | xcvbnm.. rtyui | Check... thank you | keyboard-mash or unintelligible input (c |
| 26 | clean | Csaba Varga grows apple trees. | Csaba Varga grows apple trees. | Csaba Varga grows apple trees. | Csaba Varga grows apple trees. | identity untouched |
| 27 | clean | Ms Balogh leases the garage behind the block. | Ms Balogh leases the garage behind the block. | Ms Balogh leases the garage behind the block. | Ms Balogh leases the garage behind the block. | identity untouched |
| 28 | clean | Ok,am nott . | Ok,am nott . | Okay, I didn't. | Okay, I didn't finish. | identity changed |
| 29 | clean | Quesyion: I need to know if he is the author of A Short History of Bridges. | Quesyion: I need to know if he is the author of A Short History of Bridges. | Question: I need to know if he is the author of A Short History of Bridges. | Question: I need to know if he is the author of A Short History of Bridges. | identity changed |
| 30 | ro | Lukas Weber este copilul lui Lena. | None | Lukas Weber is the child of Lena. | Lukas Weber is Lena's parent. | pass everything |

## Deployment form: GGUF Q8_0 and CPU speed

GGUF Q8_0 through `~/proofreader-export-venv` (`convert_hf_to_gguf.py` on a scratch copy `gguf-src/ep3`). A first conversion used the base `tokenizer.model` and produced a SentencePiece tokenizer (`llama`, pre `default`) that disagreed with the HF tokenizer (HF fp32 against that GGUF: 455/599 identical); the working recipe is the one of iteration 1: the 16 MB `tokenizer.json` and the 453-byte `tokenizer_config.json` of `proofreader-gemma270m-v1/merged-best` (same vocabulary, byte-identical to the iteration-1 `gguf-src`), which gives the BPE tokenizer (`gpt2`, pre `gemma4`) of iteration 1; the final GGUF is that one. The merge output of this environment writes a 33 MB `tokenizer.json` that trips the converter's vocabulary assertion (the tokenizer fix note in `dependencies.md` applies). Greedy agreement of the final GGUF with HF bf16 on the 599 judged-sample units: 569/599 (95.0%), on the first 50 units 49/50; with HF fp32: 570/599 (HF bf16 against HF fp32: 587/599); the differences are near-tie numerics ("Plus" against "In addition", "does not" against "doesn't"). Iteration 1 measured 571/599 (95.3%) the same way.

CPU speed, `llama-server -ngl 0 -t 4 -c 4096`, 30 messages of the sealed test: p50 233 ms per sentence, mean 249 ms, about 52 output tokens/s including prompt processing (12.8 output tokens per sentence), 599 units p50 239 ms and 51 tokens/s (`cpu-speed.json`); measured with other agents' jobs loading the machine (load average about 5). The iteration-1 GGUF measured the same way under the same load: p50 254 ms and 51.2 tokens/s (`outputs/lp-it1-gguf-cpu-speed__test600.jsonl`), so the two models are equally fast; the 112 ms of the iteration-1 report was measured on a quieter machine. The base-model requirement of 30 to 40 tokens per second on an ordinary laptop CPU is met.

## Attempts and deviations (all recorded in the preregistration, D1 to D10)

The run needed five training starts. Each earlier start was stopped on **dev evidence**, before any sealed result was read; their run folders are kept as `models/gemma/language-proofing-gemma270m-it2-a*-...` (epoch 1 at most, none is a candidate).

| attempt | job | what happened |
|---|---|---|
| A1 | `langproof-it2-train-a1` | 130 steps, stopped when the orchestrator reported that `datasets/bad_english` train/dev had lost 66 content-word-duplicate rows and the sealed test had been merged after the iteration-1 projection (D5); projection and data rebuilt from the current files, receipt re-transcribed |
| A2 | `langproof-it2-train-a2` | stopped after the epoch-1 snapshot (dev loss 0.1166). Dev: back-generated dev composite 99.3%, chrF 0.935, mash 97.3%, but identity untouched 94.4% as in iteration 1. Cause: the data contradicted itself (1,158 noisy pairs add a final period and 807 targets add quotes around titles, 479 identity pairs lack a final period, 41 carry unquoted titles) (D6) |
| A3 | `langproof-it2-train-a3` | stopped after epoch 1: "never add quotes" also unquoted Romanian titles, which then fail the clean-English gate; dev2300 composite 96.1% (D8) |
| A4 | `langproof-it2-train-a4` | stopped after epoch 1: the rule "a gate-clean noisy prompt is an identity pair" also turned real typos that the gate misses (crrect, glases, belive) into identity targets; identity 89.7% (D9) |
| A5 | `langproof-it2-train-a5` | the run reported here; dev loss 0.1187 / 0.1000 / 0.1012; decoded after each epoch on dev2300, dev-backgen, held-out dev and mash: epoch 1 selection score 96.5, epoch 2 97.45, epoch 3 97.55 (identity 96.2 / 96.5 / 96.7%, mash 89.3 / 98.7 / 98.7%); epoch 3 selected by the preregistered rule with the identity floor of D10 (95%, lowered from 98% before epoch 3 was decoded; the dev identity units include sentences that are lowercase and typo-free, so 98% was unreachable) |

Other deviations: D1 (all back-generation source rows are train rows, so the back-generated dev is a hash selection), D2 (489 rule-written family pairs, because DeepSeek gave 21 unique natural child pairs), D3 (the question-mark rule is kept: a noisy version without "?" of a clean question is dropped, about 1,750 candidate sentences, so the model is not taught to add question marks that the sealed references lack), D4 (bounded CUDA floor override as in iteration 1, `TRAIN_MIN_CUDA_FREE_GIB=24 TRAIN_CUDA_FREE_CHECK=host`), D7 (the back-generation output was rewritten by the generator after the first build; a snapshot is built, judged and qualified). Epoch-1 dev numbers of A2 to A4 are observations in the topic notes, not results.

## Caveats

* The iteration-1 comparison is on identical sealed units (`proofing-test.jsonl` `dc806bd35f74...`), but iteration 1 was trained on pairs that this run removed. Full sealed hash set: 1,536 iteration-1 train pairs have a prompt or target equal to a sealed text (most match the composed suites, which were regenerated at 00:50 after the iteration-1 hash file was written at 00:15). Iteration 1's K4 and reference numbers may therefore be optimistic; iteration 2's are not affected.
* Targets, references and both judges are DeepSeek; the meaning judge is calibrated on English only and used here on Romanian and mixed originals; mixed has 24 judged units (wide intervals); the hand-written child probe sentences (38) were written by the agent of this run and are unreviewed; 207 of 270 "child" training targets are rule-written templates.
* The dev identity set contains in-row sentences that the gate accepts but that are not clean; the clean900 set is the identity result of record.
* Speed was measured on a loaded machine.

## What iteration 3 should contain

1. **Vocabulary, not capacity.** Add the rest of the generated data (prepared, below) and **put the ten held-out words into training** (cousin, niece, uncle, tenant, supervisor, tutor, owe, adopt, audit, boatyard; 1,564 reserve pairs in the v3 data), then hold out a different small set to keep a generalization probe. The held-out result (45.8% kept) says that unseen words are not generalized at 270M.
2. **More natural "child" (and son, daughter) sentences**: only 21 unique natural child pairs survived the filters out of 6,363 rows; 207 of the 270 targets are templates. Ask the generator specifically for child/son/daughter/grandchild/stepchild sentences in several verbs and shapes.
3. **Repair spacing and doubled punctuation** that the fold-equal identity rule now leaves alone (examples 10 and 11: " ?" before a question mark, "!!"): make the identity conversion exclude pairs that differ in spacing or repeated punctuation, keep it for case and final period only.
4. **One writer for the references.** Targets of the back-generated half (`slow`) and of the sealed references (flash) choose different words; regenerate or merge with one model, or score against both, before reading chrF as quality.
5. **Mixed and noisy**: mixed is thin in the judged sample (24); add judged mixed units (the judge is the limit, not the model) and typo-heavy English whose typos the gate misses (the gate misses crrect, glases, belive, enrolld): a typo list for the gate is a rule-side fix.
6. **Near-synonym errors** (apple trees to tomatoes, team to equipment): mine them with the meaning judge as hard negatives and add contrastive pairs.
7. Keep: 22% identity (clean900 98.1%, mash 98.7%), the target-consistency rules, held-out dev, mash policy, the clean900/probe/mash sets. The 99% identity goal needs the remaining lowercase-initial and rare-word cases ("christening", "pens" to "pen") as identity data.
8. Fix the evaluation conventions first: score reference agreement folded for case and final punctuation, or give the gate-clean noisy units a reference without edits.

## Unused prepared data: `datasets/bad_english/proofing-v3`

Owner decision 2026-10-01: iteration 3 is not trained for now. The DeepSeek back-generation parts 010-025 were judged (38,938 new meaning-judge items, two votes) and built together with parts 000-009 under the same rules (D8/D9, identity share 21.9%): train 61,693 pairs (identity 13,484, ro 23,887, mixed 13,792, noisy_en 10,530), dev sets byte-identical to `proofing-v2` (5,173 / 1,488 / 574 / 150), 1,564 held-out-vocabulary pairs in `reserve-heldout.jsonl`, no exact match with any sealed text, qualified (`status/training/qualification-language-proofing-v3.json`), **no authorization receipt and no training**. Child/son/daughter natural pairs in v3: child 43, son 188, daughter 151 (plus templates and oversampling). See `datasets/bad_english/proofing-v3/README.md`; evidence in `eval/reports/current/language-proofing-it2/v3/`.

## Chat registry

`config/formalizers.json` entry `language-proofing-llm` is **unchanged** (iteration-1 GGUF, kept on disk together with the iteration-2 GGUF): the preregistered switch rule needs the paired intervals of the composite (judged sample, +0.2 pp [-2.5, +3.0]) and of identity (clean900, +3.3 pp [+2.0, +4.7]) both above 0, and the composite interval contains 0.
