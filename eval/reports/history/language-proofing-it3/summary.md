# LanguageProofingLLM iteration 3: Gemma 3 270M IT + LoRA with the vocabulary in the data

Experiment `train-language-proofing-gemma270m-it3` (preregistration `status/preregistrations/train-language-proofing-gemma270m-it3.json`, frozen before the first optimizer step). Natural-language and grammatical-analysis layer only. All numbers are regenerable from `eval/reports/current/language-proofing-it3/` (`scores/`, `outputs/`, `composed/`, `compare-*.json`, `tables.md`). Targets of the training data are DeepSeek text with review status pending, the judges are Grok (meaning) and GLM (parse) for the new items and DeepSeek for the older verdicts that are reused; nothing here is human-reviewed. Comparisons are only on our synthetic data: no rewrite, the untrained gemma-3-270m-it, iteration 1 and iteration 2.

## Verdict (short)

* **Does 270M learn and use new vocabulary when it is in the training data? Yes, clearly.** The ten words that iteration 2 held out (cousin, niece, uncle, tenant, supervisor, tutor, owe, adopt, audit, boatyard) are now in training (1,258 reserve pairs were added; the words occur in 1,274 train targets, a pair counted once per word, from source sentences that are not in the dev set). On the trained-vocabulary dev (574 pairs, source rows, targets and prompts disjoint from train) the target word is used in **94.1%** of the outputs (540/574, Wilson [91.8, 95.7]) against 45.6% for iteration 2 (paired +48.4 pp [+44.4, +52.4]), 49.1% for iteration 1, 36.4% for the untrained base and 42.2% for no rewrite. Every word improved except audit (100% for it2, 97.7% now): uncle 50 -> 97.7, niece 44 -> 100, owe 32 -> 100, boatyard 24 -> 87.2, cousin 30 -> 95, tenant 44 -> 98; Romanian input went from 20% to 89%. The mechanical composite on that dev is 97.4%.
* **Does it still fail on unseen words? Yes, and the failure is specific.** Eight NEW words were removed from training entirely (nephew, landlord, contractor, postpone, reject, bakery, warehouse, pharmacy; `dev-heldout-v3`, 830 pairs). Iteration 3 keeps the target word in only **52.0%** (432/830, [48.6, 55.4]): 40 pp below its trained-vocabulary rate, barely above the untrained base (28.2%) and no rewrite (34.1%). It transfers a word when the input already contains it or a cognate: noisy English 93.3%, cognates contractor 91.8% and pharmacy 90.9%; it fails when the Romanian word has to be translated: Romanian input 26.4%, nephew 23.6%, postpone 32.7%, warehouse 38.2%, bakery 42.7%, landlord 43.6%. The reference arm for this probe is NOT an unseen arm: iteration 1 and 2 had these eight words in training (it2 92.2%; on the 459 probe pairs that are not literal it2 training pairs it2 still keeps 87.6%, it3 55.6%). So the same sentences give 87.6% with the word in training and 55.6% without. Vocabulary has to be in the data; the 270M model does not translate a word it never saw.
* **Chat registry: switched to iteration 3** by the preregistered rule (below). The gate that carried it is the vocabulary criterion; the judged composite did NOT improve (67.2% against 67.2% when both arms are judged by the same judges, +0.0 pp [-3.2, +3.0]). The switch has costs that the owner should weigh: the eight probe words are no longer known to the chat model (use the it2 GGUF, kept on disk, to revert), the mechanical content-preserved rate on the sealed test is 0.75 pp lower, and the HF to GGUF agreement is 92.5%.
* **Spacing and doubled punctuation are repaired:** `dev-spacing` exact 99.6% (239/240) against 17.9% for iteration 2 (it2 leaves spacing alone by design) and 85.0% for iteration 1; all 236 sealed noisy units that need only a spacing repair come out exactly right (it2: 0, it1: 227). Clean sentences are not hurt: clean900 untouched 98.2% (884/900) against 98.1% for iteration 2.
* **No new catastrophic error class on the preregistered probes:** child-to-parent flip 1/229 (0.4%) as in iteration 2 (iteration 1: 204/229); keyboard mash unchanged 98.7% (148/150) as in iteration 2; K4 clean sentences changed 1.1% (it2 1.4%). Two weaker spots are reported below: the relation word is lost in 5 of 229 child units (it2: 0), and parent output for garbled child words rose from 3 to 5 of 116 reference-bearing probe units.

## Identity of the run

| item | value |
|---|---|
| base model | `daniel-dona/gemma-3-270m-it` revision `99073d6b6edb0e298d163f964ec2b9d970b3408d`, trained from the BASE |
| recipe | `config/train-gemma.json` sha256 `ecc7fe04...`, unchanged (LoRA r16 alpha32, lr 2e-4, batch 2 x 8, bf16, seed 42, 3 epochs) |
| run | `models/gemma/language-proofing-gemma270m-it3/proofreader` (role id `proofreader`), single attempt (Podman job `langproof-it3-train-a1`), 11,802 steps in 130 minutes (03:41:34Z to 05:51:56Z), exit 0, no OOM, no restart; dev loss 0.1340 / 0.1189 / 0.1244 (epochs 1 to 3); checkpoint `epoch-2` selected on dev, merged `merged-epoch-2`, GGUF Q8_0 `gguf/ep2-q8_0.gguf` sha256 `1ded76b1...` |
| training data | `datasets/bad_english/proofing-it3`, manifest sha256 `1603fb53afaa...`, train 62,939 / dev 5,173 pairs (`proofreader/train.jsonl` `9b0a26e6deac...`, `dev.jsonl` `64f3e6135607...`, byte-identical to the iteration-2 dev) |
| qualification / receipt | `status/training/qualification-language-proofing-it3.json` (`dfa7284d6ef7...`), `status/training/authorization-gemma-language-proofing-gemma270m-it3.json` (`e42d700f1d56...`), scope `status/training/owner-approval-language-proofing-it3.json`; owner decisions of 2026-09-30T17:32:38Z (and the five further decisions of iteration 2) and the 2026-10-01 decision transcribed at 03:35:42Z (the receipt written the way iteration 2 did, by `tools/research/qualify-language-proofing-v2.mjs`, extended for the spacing source, extra dev files and the sealed-hash union) |
| sealed units | `eval/suites/bad_english/proofing-test.jsonl` (10,711 units, 8,435 repair, 2,276 identity), `proofing-test-clean.jsonl` (900), `proofing-probe-child.jsonl` (252), the 600-unit judged sample (472 repair + 127 identity), composed K4 (306 paragraphs, 986 clean and 578 bad sentences) |
| arms | no rewrite; untrained 270M (same message-only prompt); iteration 1 and 2 (outputs reused from the iteration-2 report, scores recomputed); iteration 3 |

## Training data

`proofing-it3` is built from the qualified `proofing-v3` by `tools/datasets/build-language-proofing-v3.mjs` (no judging was needed: every pair was already judged). Changes, all recorded in `audit.jsonl` and `manifest.json`:

| change | pairs |
|---|---|
| proofing-v3 train | 61,693 |
| minus every pair (prompt or target, copies included) containing one of the eight new held-out words | -1,772 (bakery 349, contractor 289, postpone 292, nephew 240, landlord 195, warehouse 167, pharmacy 142, reject 98) |
| minus repair pairs whose TARGET has a spacing defect | -40 |
| plus reserve pairs of the ten formerly held-out words (1,564 offered; dropped: 252 sharing a source row with the trained-vocabulary dev, 6 with the same target text, 48 containing a new held-out word) | +1,258 |
| identity pairs with a spacing defect in the prompt turned into repair pairs (target = the mechanically normalized prompt) | 863 |
| deterministic spacing perturbations of clean identity sentences (10 operation sets: space before final punctuation 966, doubled space 299, doubled final punctuation 173, space before comma 42, missing space after comma 46, doubled comma 39, combinations 235) | +1,800 |
| **train** | **62,939** (identity 12,142 = 19.3%, repair 50,797; ro 23,822, mixed 13,813, noisy_en 13,162, clean 11,844, mash 298) |

Dev sets (never trained on): `dev` (5,173, frozen), `dev-backgen` (1,488), **`dev-heldout`** (574, now the *trained-vocabulary* dev: same ten words as in iteration 2, none of whose sentences is in train), **`dev-heldout-v3`** (830 repair pairs of the eight new words, at most 110 per word) and `dev-heldout-v3-identity` (306 clean sentences containing them), `dev-spacing` (240 perturbed dev sentences) and `mash-eval` (150). The new probe words were chosen before any output was seen (two relation or work nouns, a verb pair, three places, cognates and non-cognates). Qualification: grounding of every pair from its source (spacing pairs reproduced from their clean target and recorded operations), mechanical meaning checks, the recorded two-vote judge verdicts, no folded exact match with any sealed text (union of the iteration-2 hash file and a fresh scan, because the sealed suites changed since: 130 new hashes), no id in two splits, no train prompt in any dev set, no new held-out word in train, no pair above 2,048 tokens (p99 77, max 161).

## Epoch selection on dev (preregistered rule, sealed data selects nothing)

| epoch | dev loss | devbg composite % | trained-vocab composite % | unseen-vocab composite % | trained word kept % | unseen word kept % | defect-free identity % | mash unchanged % | spacing exact % | selection score |
|---|---|---|---|---|---|---|---|---|---|---|
| it2 (reference) | 0.1012 (epoch 3) | 98.2 | 96.9 | 97.0 | 45.6 | 92.2 (saw them) | 96.6 | 98.7 | 17.9 | 97.37 |
| 1 | 0.1340 | 97.5 | 96.2 | 97.1 | 92.0 | 51.4 | 96.0 | 92.7 | 96.7 | 96.93 |
| **2** | 0.1189 | 97.4 | 97.4 | 97.8 | 94.1 | 52.0 | 97.6 | 98.7 | 99.6 | **97.53** |
| 3 | 0.1244 | 97.8 | 97.0 | 97.6 | 94.3 | 52.5 | 97.5 | 100 | 99.2 | 97.47 |

All three epochs are eligible (defect-free identity at least 95%, mash at least 90%, spacing at least 80%); epoch 2 has the highest mean composite by 0.07 pp over epoch 3, which is within noise (epoch 3 has the better chrF, 0.9556 against 0.9499, and mash 100%): the rule picks epoch 2 and that is what is evaluated. Epoch 3 was not evaluated on sealed data. Dev loss is flat after epoch 2.

## Vocabulary learning (the owner question), per word and kind

Word kept = the output contains the target word (inflections allowed) for the first word of the list the reference contains; no rewrite and the untrained base are the floor. A valid paraphrase (Romanian "proprietar" as "owner" instead of "landlord") counts as a miss for every arm alike.

**Trained vocabulary, `dev-heldout` (ten words in iteration 3's training data, absent from iteration 2's and iteration 1's):**

| word (n) | no rewrite | base | it1 | it2 | it3 |
|---|---|---|---|---|---|
| uncle (44) | 22.7 | 6.8 | 22.7 | 50.0 | 97.7 |
| boatyard (148) | 60.1 | 50.0 | 40.5 | 24.3 | 87.2 |
| tutor (84) | 38.1 | 35.7 | 65.5 | 52.4 | 90.5 |
| supervisor (42) | 33.3 | 35.7 | 66.7 | 73.8 | 100 |
| niece (34) | 11.8 | 23.5 | 38.2 | 44.1 | 100 |
| audit (44) | 77.3 | 68.2 | 97.7 | 100 | 97.7 |
| tenant (54) | 38.9 | 37.0 | 42.6 | 44.4 | 98.1 |
| cousin (80) | 27.5 | 20.0 | 33.8 | 30.0 | 95.0 |
| owe (28) | 32.1 | 25.0 | 32.1 | 32.1 | 100 |
| adopt (16) | 43.8 | 37.5 | 87.5 | 81.3 | 100 |
| ro (200) | 7.5 | 7.0 | 21.0 | 20.0 | 89.0 |
| mixed (200) | 45.0 | 37.5 | 48.5 | 47.5 | 95.5 |
| noisy_en (174) | 78.7 | 69.0 | 82.2 | 73.0 | 98.3 |
| **all (574)** | 42.2 [38.2, 46.2] | 36.4 [32.6, 40.4] | 49.1 [45.1, 53.2] | 45.6 [41.6, 49.7] | **94.1 [91.8, 95.7]** |

(`language-proofing-v2-metrics.mjs heldout`, which counts a row once per word root it contains, gives 45.8% for it2 and 93.8% for it3.) Sealed units that contain one of the ten words are too few to measure (4): it3 keeps the word in 4/4, it2 in 3/4.

**Unseen vocabulary, `dev-heldout-v3` (eight words absent from iteration 3's training data; iteration 1 and 2 HAD them):**

| word (n) | no rewrite | base | it1 (saw) | it2 (saw) | it3 (unseen) |
|---|---|---|---|---|---|
| contractor (110) | 42.7 | 43.6 | 90.0 | 98.2 | 91.8 |
| pharmacy (99) | 43.4 | 39.4 | 92.9 | 100 | 90.9 |
| reject (71) | 40.8 | 25.4 | 47.9 | 91.5 | 59.2 |
| landlord (110) | 34.5 | 30.0 | 49.1 | 69.1 | 43.6 |
| bakery (110) | 40.0 | 30.0 | 83.6 | 98.2 | 42.7 |
| warehouse (110) | 31.8 | 25.5 | 80.9 | 94.5 | 38.2 |
| postpone (110) | 22.7 | 18.2 | 91.8 | 95.5 | 32.7 |
| nephew (110) | 20.0 | 13.6 | 52.7 | 90.9 | 23.6 |
| ro (356) | 6.5 | 6.2 | 63.8 | 88.2 | 26.4 |
| mixed (296) | 40.9 | 34.5 | 76.0 | 93.6 | 58.1 |
| noisy_en (178) | 78.1 | 61.8 | 93.8 | 97.8 | 93.3 |
| **all (830)** | 34.1 [31.0, 37.4] | 28.2 [25.2, 31.3] | 74.6 | 92.2 [90.1, 93.8] | **52.0 [48.6, 55.4]** |

Paired it3 minus it2 on these pairs: -40.1 pp [-43.4, -36.7] (the cost of leaving the words out, 371 of the 830 pairs are literal it2 training pairs). Clean English sentences that contain the unseen words are left unchanged in 98.7% (302/306), so the model copies a word it recognizes; what it cannot do is produce it from a Romanian word. On the sealed test, 40 repair units contain one of the eight words: it3 keeps 6/40 (postpone 3/19, bakery 2/15), it2 40/40, no rewrite 6/40. H2 (the unseen rate stays at least 20 pp below the trained rate) holds: the gap is 42 pp.

## Composite on the judged sample (472 repair units, 127 identity units)

Judging: the verdicts of iteration 2 come from the DeepSeek judges (keyed by text and reused where the output text is identical); the new items of iteration 3 came from Grok (meaning) and GLM (parse). Their strictness differs (the calibrated Grok meaning judge has raw recall 76.5%), which would bias a plain comparison against iteration 3: with the iteration-2 verdicts as they were, the meaning rate reads 82.0% against 78.0%. Therefore iteration 2's 237 outputs that differ from iteration 3's were judged again by the same Grok and GLM judges (row `iteration 2 (re-judged)`); outputs that are identical in both arms keep their one earlier verdict in both. This is deviation D2.

| arm | clean % | content % | chrF | analysis % | meaning % | composite % |
|---|---|---|---|---|---|---|
| iteration 1 | 97.9 | 99.4 | 0.9086 | 67.4 | 81.4 | 66.1 (312/472) |
| iteration 2, original verdicts | 97.0 | 99.4 | 0.8523 | 67.6 | 82.0 | 66.3 (313/472) |
| iteration 2 (re-judged, same judges as it3) | 97.0 | 99.4 | 0.8523 | 68.4 | 75.0 | 67.2 (317/472) |
| **iteration 3** | 97.5 | 97.5 | 0.8363 | 69.3 | 78.0 | **67.2 (317/472)** |

By kind (composite): ro 69.6 (243/349) for both it2-original and it3, 70.5 for it2 re-judged; mixed 45.8 (11/24) for it2 and **58.3 (14/24)** for it3 (it1 37.5); noisy_en 59.6 / 60.6 / 60.6. Paired it3 minus it2 (re-judged), bootstrap 95% intervals over units (2,000 resamples):

| scope | n | composite | clean | content | analysis | meaning | chrF |
|---|---|---|---|---|---|---|---|
| repair | 472 | +0.0 [-3.2, +3.0] | +0.4 [0.0, +1.1] | -1.9 [-3.4, -0.6] | +0.9 [-2.3, +3.8] | +3.0 [-0.9, +6.8] | -0.016 [-0.032, +0.001] |
| ro | 349 | -0.9 [-4.9, +3.2] | +0.6 [0.0, +1.4] | -2.3 [-4.3, -0.6] | +0.3 [-3.7, +4.3] | +3.7 [-0.9, +8.3] | -0.016 [-0.040, +0.010] |
| mixed | 24 | +12.5 [0.0, +29.2] | 0 | 0 | +12.5 [0.0, +29.2] | +12.5 [-8.3, +33.3] | -0.015 [-0.067, +0.037] |
| noisy_en | 99 | +0.0 [-2.0, +3.0] | 0 | -1.0 [-3.0, 0.0] | 0 | -2.0 [-7.1, +3.0] | -0.017 [-0.033, -0.003] |

With the original iteration-2 verdicts the paired composite is +0.9 pp [-2.3, +4.0] and the meaning rate -4.0 pp [-7.6, -0.6]; the second number is the judge-strictness artifact described above, not a model effect. H3 (composite interval above 0) is not met either way. Against iteration 1 the composite is +1.1 pp [-2.3, +4.7], mixed +20.8 pp [+8.3, +37.5] (n 24).

## Identity, mash, child probe, K4, sealed test

| measure | no rewrite | it1 | it2 | **it3** | paired it3 minus it2 |
|---|---|---|---|---|---|
| clean900 untouched | 100 (900/900) | 94.8 (853) | 98.1 (883) | **98.2 (884)**, Wilson [97.1, 98.9] | +0.1 pp [-0.9, +1.1] |
| judged identity units untouched (127) | 100 | 92.9 | 98.4 | 94.5 (120/127) | -3.9 pp [-7.9, -0.8] |
| keyboard mash unchanged (150) | 100 | 66.7 | 98.7 | **98.7 (148/150)** | 0.0 pp [-2.7, +2.7] |
| child to parent flip (229 child units) | 0 | 204 (89.1%) | 1 (0.4%) | **1 (0.4%)** | |
| relation word kept (229) | 24 | 20 | 229 | 224 (97.8%) | |
| hand-written child sentences (24) kept | | | 24/24 | 24/24 | |
| K4 clean sentences changed (986) | 0% | 3.9% | 1.4% (14) | **1.1% (11)** | -0.3 pp [-1.3, +0.7] |
| K4 bad sentences fixed (578) | 0.3% | 49.7% | 35.3% | **38.6%** | +3.3 pp [+0.4, +6.3] |
| K4 bad rewritten wrongly | 0% | 48.4% | 57.3% | 58.3% | +1.0 pp [-1.5, +3.5] |
| K4 bad untouched | 99.7% | 1.4% | 7.1% | 2.8% | -4.3 pp [-6.2, -2.5] |
| K4 exact paragraphs (306) | 0% | 30.1% | 18.3% | 23.9% | |
| sealed test, all repair units (8,435): clean / content / chrF / exact | 12.3 / 99.4 / 0.553 / 0.4 | 97.2 / 98.9 / 0.898 / 59.4 | 96.8 / 98.6 / 0.855 / 42.2 | 96.9 / 97.9 / 0.850 / 46.5 | +0.1 [-0.1, +0.2] / **-0.75 [-1.06, -0.45]** / -0.006 [-0.009, -0.002] / |

Observations behind the numbers:

* **Judged identity units:** 5 more of the 127 changed than in iteration 2. Two are intended spacing repairs ("shellfish ." and "block ?"), one is a changed question ("Can 8 people fit in it?" to "fit it", a real content loss), one is a mash string ("tyu tyu???" to "tyu tyu..."), one a capital ("Uio juio?!"). The clean900 sentences have no spacing defects and are as untouched as before.
* **Child probe, garbled child words:** the correctly spelled child units keep the relation word 224/229 (it2 229/229); the 5 losses are typo'd inputs ("copiul", "copiplul", "chipd", "chiod", "chilld"). Counting every probe unit whose reference has a child word and whose input has no parent word, parent output occurs 3 times for it2 and 5 times for it3 of 116 (it1: 89); the paired difference is two units and not significant. The preregistered child metric (1/229) is unchanged. No new class, but the typo case was not closed.
* **Content-preserved fell by 0.75 pp on the full sealed test** ([-1.06, -0.45], noisy_en -1.2 pp, ro -0.7 pp). 126 units fail a mechanical content check in iteration 3 that passed in iteration 2: 64 "lost" protected words (proper names that the model now translates, for instance "Filarmonica din Lisbon" to "Lisbon Philharmonic", "Colegiul Tehnic din Craiova" to "Craiova College", and some genuine errors such as "LED bulbs" to "used bulbs"), 39 question-mark count changes (some are keyboard-mash strings whose doubled "???" the spacing repair collapses to "?", which the mechanical check counts although the content is untouched), 18 negation parity changes, 5 line-break or length cases; in the other direction 57 units pass now that failed before. This is the measurable cost of the extra data and of spacing repair on this metric; it is the reason the paired composite does not rise although analysis and clean-English rates do.
* The 8 held-out words cost the sealed test: 40 of its 8,435 repair units contain one of them, and it3 fails 34 of them where it2 passes all 40 (iteration 1: 38).

## GGUF, agreement and CPU speed

GGUF Q8_0 through `~/proofreader-export-venv` with its patched `llama-cpp-conv/convert_hf_to_gguf.py` (pre-tokenizer `gemma4`, tokenizer `gpt2`) on a scratch copy `gguf-src/ep2` of the merged epoch-2 model with the 16 MB `tokenizer.json` and the 453-byte `tokenizer_config.json` of the iteration-2 `gguf-src` (the tokenizer.json recipe; the stock converter in `~/llama-cpp-venv` does not know the pre-tokenizer). Greedy agreement of the GGUF with HF bf16: **554/599 judged-sample units (92.5%)**, 43/50 on the first 50 (iteration 2: 569/599 = 95.0%, 49/50; iteration 1 95.3%). The differences are near ties ("Plus" against "In addition", "does not" against "doesn't") and a few Q8 degradations ("grows my." for "grows my grapes.", "costest", "LED pipes"); the composed K4 numbers above are GGUF numbers, the sealed numbers are HF bf16. CPU speed, `llama-server -ngl 0 -t 4 -c 4096`, the 599 judged-sample units sequentially (load average about 6, other agents' jobs running): p50 105 ms per sentence, mean 110 ms, 12.9 output tokens per sentence, about 118 output tokens/s (`cpu-speed.json`); the base-model requirement of 30 to 40 tokens per second is met.

## Judging cost

Local first: the mechanical layer (clean-English gate, content checks, chrF, word-kept, spacing, identity, mash, child probe) and the Stanza analysis layer ran on every unit at no judge cost; the K4 composed run, the identity and mash sets and the vocabulary probes need no LLM judge. LLM judges ran only on the 600-unit judged sample, only where an output text had no verdict yet, as omp task folders under `datasets_sources/`, fenced and detached: `language_proofing_it3_meaning_judge` (Grok `xai-oauth/grok-4.20-0309-non-reasoning`, two votes m1 and m2) and `language_proofing_it3_parse_judge` (GLM `zai/glm-5.3-flash`, conditions a and c). Pass 1 (iteration-3 outputs): 320 meaning items (160 pairs) in 151 s, 214 parse items (107 sentences) in 269 s; pass 2 (iteration-2 outputs that differ, same judges): 430 meaning items (215 pairs) and 316 parse items (158 sentences) in about 2 and 5 minutes. **In total 750 Grok calls and 530 GLM calls, about 14 minutes of summed judge time (the two judges ran in parallel, about 10 minutes of wall time), no errors and no fall-back to DeepSeek; both are subscriptions and no per-token charge is exposed to the harness.** Earlier verdicts (DeepSeek, from iterations 1 and 2) were reused for 362 of the 599 units' outputs. A parse/meaning judge was NOT needed for the decision criterion that carried the switch (word kept, mechanical).

## Preregistered switch rule

Rule: switch the chat entry `language-proofing-llm` if (1) no new catastrophic error class (child probe at most 1%; mash and identity not worse beyond their intervals), (2) clean900 untouched at least iteration 2, and (3) EITHER the composite OR the trained-vocabulary accuracy improves with a paired 95% interval above 0.

| condition | result | holds |
|---|---|---|
| child probe at most 1% | 1/229 = 0.4% | yes |
| mash unchanged not worse | 98.7% = 98.7% (paired 0.0 [-2.7, +2.7]) | yes |
| identity (clean900) not worse beyond the interval | +0.1 pp [-0.9, +1.1] | yes |
| clean900 untouched at least it2 | 884 against 883 | yes |
| composite improves with interval above 0 | +0.0 [-3.2, +3.0] (same judges) | no |
| trained-vocabulary accuracy improves with interval above 0 | +48.4 pp [+44.4, +52.4] | **yes** |

All gates hold: `config/formalizers.json` entry `language-proofing-llm` now points to `models/gemma/language-proofing-gemma270m-it3/proofreader/gguf/ep2-q8_0.gguf` and its `note` records the decision with the caveats above. The iteration-2 GGUF stays on disk for a revert.

## Hypotheses

| id | result |
|---|---|
| H1 trained vocabulary, point at least 85% and paired interval above 0 vs it2 | **yes**: 94.1%, +48.4 pp [+44.4, +52.4] |
| H2 unseen words at least 20 pp below the trained rate | **yes** (prediction of failure confirmed): 52.0% against 94.1%, 42 pp |
| H3 composite above it2 with interval above 0 | no: +0.0 [-3.2, +3.0] (+0.9 [-2.3, +4.0] with the original verdicts) |
| H4 clean900 untouched at least it2 | yes: 98.2% against 98.1% |
| H5 child flip at most 1% | yes: 1/229 = 0.4% (relation word kept 224/229) |
| H6 mash not lower beyond the interval | yes: 98.7% = 98.7% |
| H7 spacing exact at least 90% | yes: 99.6% (239/240); sealed noisy units that need only spacing 236/236 |
| H8 K4 clean sentences changed at most it2 | yes: 1.1% against 1.4% |

## Attempts and deviations (recorded in the preregistration)

* **D1 (tooling):** the first per-epoch merge ran with the Python environment that lacks `peft` and decoded nothing; the watcher was restarted with the export environment (CPU merge) and epoch 1 was decoded from the same checkpoint. No training effect.
* **D2 (judging):** the iteration-2 outputs that differ from iteration 3's were judged again by the same Grok and GLM judges so that the paired composite and meaning comparison use one judge per output pair (see above); the original DeepSeek-judged iteration-2 numbers are kept in the tables.
* **D3 (design fact):** the eight "unseen" words are unseen only for iteration 3; iterations 1 and 2 had them in training, so the unseen probe has no untrained-by-design comparison arm besides the base and no rewrite. Stated in the preregistered hypotheses as "reported against" and analysed above.
* **D4 (slip, corrected):** the first `prepare` call of the judging stage ran without the iteration-3 folder variables and appended 214 parse and 320 meaning items to the iteration-1 judge folders (`datasets_sources/language_proofing_parse_judge`, `language_proofing_meaning_judge`); they were removed again (the files hold exactly their earlier lines; their verdict files were not touched) and the items went to the iteration-3 folders.
* **D5 (selection margin):** epoch 2 beat epoch 3 by 0.07 pp on the preregistered score; both are reported, only epoch 2 was evaluated on sealed data.
* The CUDA floor override of iteration 2 (`TRAIN_MIN_CUDA_FREE_GIB=24`, `TRAIN_CUDA_FREE_CHECK=host`) was used again because the GPU was shared with a local-judge llama-server (13.8 GB); it did not slow the run noticeably (about 0.55 to 1.0 s per step).

## Caveats

DeepSeek-written training targets and the LLM judges are unreviewed and correlated; the meaning judge is calibrated on English originals only; the word-kept metric undercounts valid paraphrases equally for every arm; mixed has 24 judged units (the +12.5 pp interval touches 0); the sealed test contains hardly any sentence with the ten trained words (4), so the trained-vocabulary measurement is a dev measurement on source sentences disjoint from train, not a sealed one; the vocabulary probes are back-generated DeepSeek pairs, not user text; no 1B model was trained and one run of 270M does not show a capacity limit.

## What iteration 4 should contain

Put the eight probe words back into training and pick eight new probe words (the result above says it will work for words in the data and not otherwise); keep the spacing pairs; stop the model from translating proper-noun phrases (add protected-name pairs such as "Filarmonica din Lisbon" kept as written, and typo'd child-word pairs); consider Q8 degradation (try Q8 with a different export or F16 for the chat, or train a few more steps with quantization-aware targets) since HF to GGUF agreement dropped to 92.5%.
