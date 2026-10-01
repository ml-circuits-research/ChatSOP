# LanguageProofingLLM iteration 1: Gemma 3 270M IT + LoRA on bad_english sentence pairs

Experiment `train-language-proofing-gemma270m-it1` (preregistration `status/preregistrations/train-language-proofing-gemma270m-it1.json`). Natural-language and grammatical-analysis layer only, no SOP metric (owner direction 2026-09-30). All numbers are regenerable from `eval/reports/current/language-proofing-it1/` (`scores/`, `outputs/`, `composed/`, `compare-*.json`). The targets of the training data and of most sealed references are DeepSeek flash text with review status pending; nothing here is human-reviewed.

## Verdict (short)

* **270M learns this task.** Romanian to English is not the weak point on the preregistered surface measures: on the sealed test the clean-English rate is 99.7% for Romanian sentences (6,237 units), 98.8% for mixed (422) and 88.1% for badly written English (1,776); content (names, numbers, quotes, negation) is preserved in 98.8% of the Romanian outputs; chrF against the DeepSeek reference is 0.876 for Romanian. No evidence says 270M cannot learn it; the Gemma 3 1B fallback is not indicated by this run.
* **It beats the shipped textToCleanEnglish backend (LanguageTool + Qwen3-1.7B) on the composite** (clean English AND content preserved AND analysis gate): +7.4 pp [+3.2, +11.7] on the 600-unit judged sample, at 113 tokens/s and about 110 ms per sentence on 4 CPU threads against about 710 ms for the Qwen3-1.7B call. The meaning judge is not different (81.4% against 78.2%, difference +3.2 pp [-1.7, +8.1]).
* **But the meaning judge finds 18.6% of the Romanian/mixed/noisy outputs not meaning-preserving** (reference targets pass 89.9%), and the main error class is a lexical one: the training targets contain "parent of" 249 times and "child of" never, so the model turns unseen "child" (Romanian "copilul lui", English "child of") into "parent" (182 Romanian and 65 English inputs on the full test). Nearby: "boatyard" to "shipyard", "employs" to "issues/owns". This is a vocabulary-diversity problem of the data, not a capacity limit.
* **Two preregistered thresholds fail**: clean sentences left untouched is 94.8% (853/900, Wilson [93.1, 96.1]) against the 95% bar (92.7% on the 300-sentence judged sample), and "clean English above the untrained base for every kind" fails for badly written English (the untrained base also produces gate-clean text there, while destroying the content: 21% content preserved). The dev split is saturated (99.5% composite) and cannot discriminate; the sealed units share the generators of the training data (same forms, other words), so these numbers say nothing about unseen forms: the wild units (formalizer-wild-v1, 89 units) reach chrF 0.61 and 9% exact match against 0.90 and 60% for the generator forms.

## Identity of the run

| item | value |
|---|---|
| base model | `daniel-dona/gemma-3-270m-it` revision `99073d6b6edb0e298d163f964ec2b9d970b3408d` (byte-identical mirror of `google/gemma-3-270m-it` `ac82b4e8...`) |
| recipe | `config/train-gemma.json` sha256 `ecc7fe04...` (LoRA r16 alpha32 dropout 0.05, lr 2e-4, batch 2 x accumulation 8, bf16, seed 42, 3 epochs), unchanged |
| run | `models/gemma/language-proofing-gemma270m-it1/proofreader` (role id `proofreader`); checkpoint `epoch-3`, merged `merged-epoch-3`, GGUF Q8_0 `gguf/ep3-q8_0.gguf`; training finished 2026-09-30T22:04:38Z |
| training data | `datasets/bad_english/proofing` version `2026-09-30-324a34eb`, manifest sha256 `919d5fa86f62...`, train 21,414 / dev 3,946 sentence pairs; `datasets/bad_english/manifest.json` sha256 `0216049796ae...` (state after the merge-done event of meaning-judge-agent, 2026-09-30T21:10:25Z) |
| sealed units | `eval/suites/bad_english/proofing-test.jsonl` sha256 `dc806bd35f74...` (10,711 units: 8,435 repair, 2,276 in-row identity; 6,959 with a reference); `proofing-test-clean.jsonl` sha256 `760fad92211c...` (900 clean sentences); `test-composed.jsonl` `b66952c01844...`; source `test.jsonl` `9204379d1c1d...` |
| authorization | owner decision 2026-09-30T17:32:38Z, receipt `status/training/authorization-gemma-language-proofing-gemma270m-it1.json`, qualification `status/training/qualification-language-proofing.json` |

Training: Podman job `langproof-it1-train-a3` (attempt A failed before any step, a missing projection manifest; A2 stopped itself at step about 1,250 when CUDA free memory fell to 47.9 GiB under the 48 GiB floor; A3 used the documented bounded override `TRAIN_MIN_CUDA_FREE_GIB=24 TRAIN_CUDA_FREE_CHECK=host`, deviation D2). 4,017 steps in 35.5 minutes, dev loss 0.154 / 0.132 / 0.135 (epochs 1-3), no stop rule tripped. Epoch selection on a 100-unit stratified dev sample (89 repair, 10 identity): composite 98.9% at every epoch, identity untouched 9/10, 10/10, 10/10, chrF 0.9185 / 0.9213 / 0.9291; the preregistered tie-break (chrF) selected epoch 3. The dev split is saturated and gives no real selection signal; an attempt B (more epochs) was not warranted (dev loss flat).

## Data and coverage

Training mix by kind (sentence level; train / dev): ro 11,915 / 2,503, mixed 1,933 / 359, noisy_en 5,425 / 689, clean identity 2,141 / 395 (10% of the set, half clean sentences inside bad rows, half symbolic_english). Target sources (train): DeepSeek flash 13,663, noise-inverse 2,961, proofing.repair 1,014, proofing.translate 1,157, new_cases.clean 476. Gemma 3 token lengths of a pair (prompt + target with the chat template): train p50 38, p99 84, max 161; dev max 306; nothing above 2,048.

Coverage of the evaluation (stated plainly): the sealed test holds 10,711 sentence units; 6,959 have a reference (the DeepSeek targets merged into the sealed test by the owner-approved merge of 2026-09-30, deviation D3; 3,752 units have none: held by the clean-English gate, marked unfixable, or rows without a DeepSeek answer). Metrics (a), (b), (e) are reference-free and cover all units; (c) covers the units with a reference; the judge layers (d) analysis gate and (f) meaning judge run on a stratified judged sample of 599 units (472 repair units, 257 with a reference; 127 in-row identity units) because each judged unit costs two DeepSeek calls per layer. The meaning judge (two-vote m1 AND m2, calibrated on English originals only, adjudicated precision 97.5-100%, recall 82-92%) is applied here to Romanian and mixed originals, for which it is uncalibrated; its recall below 100% means it also rejects some good outputs. The clean-English gate (a) and the analysis gate use the same DeepSeek and Stanza machinery as the dataset gates; the judge is also the model family that wrote the references, so the judge layers are correlated with the training targets.

## Results on the sealed test, reference-free and reference metrics, all units (mechanical layer)

Repair units (Romanian, mixed, badly written English). Columns: units; (a) clean-English gate %; (b) content preserved % (names, numbers, quotes, question marks, length ratio, negation parity); (c) mean chrF against the reference (units with a reference); exact match % of the reference.

| arm / kind | units | (a) clean % | (b) content % | (c) chrF (n ref) | exact % |
|---|---|---|---|---|---|
| no rewrite, all repair | 8,435 | 12.3 | 99.4 | 0.553 (4,683) | 0.4 |
| &nbsp;&nbsp;ro | 6,237 | 0.7 | 99.3 | 0.362 (2,836) | 0.0 |
| &nbsp;&nbsp;mixed | 422 | 16.8 | 99.1 | 0.620 (336) | 5.1 |
| &nbsp;&nbsp;noisy_en | 1,776 | 52.0 | 99.8 | 0.897 (1,511) | 0.0 |
| untrained 270M, same prompt, all repair | 8,435 | 35.4 | 35.7 | 0.336 (4,683) | 0.4 |
| &nbsp;&nbsp;ro | 6,237 | 18.1 | 41.3 | 0.267 (2,836) | 0.0 |
| &nbsp;&nbsp;mixed | 422 | 56.2 | 23.7 | 0.336 (336) | 1.2 |
| &nbsp;&nbsp;noisy_en | 1,776 | 91.3 | 19.1 | 0.466 (1,511) | 0.9 |
| **fine-tuned it1**, all repair | 8,435 | 97.2 | 98.9 | 0.898 (4,683) | 59.4 |
| &nbsp;&nbsp;ro | 6,237 | 99.7 | 98.8 | 0.876 (2,836) | 51.4 |
| &nbsp;&nbsp;mixed | 422 | 98.8 | 98.8 | 0.888 (336) | 56.0 |
| &nbsp;&nbsp;noisy_en | 1,776 | 88.1 | 99.3 | 0.943 (1,511) | 75.0 |

For comparison, the dev split (same generators as train, 3,551 repair units): clean 99.8%, content 99.7%, chrF 0.916, composite 99.5%.

Clean sentences (identity), left untouched (e). `in-row` = sentences the clean-English gate accepts inside bad_english rows (not all truly clean: spacing before punctuation, missing space after a comma), `clean900` = 900 clean single sentences of the sealed symbolic_english test (H5 is read on this set).

| arm | in-row identity untouched % (n 2,276) | clean900 untouched % (Wilson 95%) | clean900 content broken % |
|---|---|---|---|
| no rewrite | 100.0 | 100.0 [99.6, 100.0] | 0.0 |
| untrained 270M | 6.3 | 2.2 [1.4, 3.4] | 82.7 |
| **fine-tuned it1** | 92.8 | 94.8 [93.1, 96.1] | 0.1 |

## Results on the judged sample (599 units), all layers

Columns: (a) clean-English %, (b) content %, (c) chrF on units with a reference, (d) analysis gate % (Stanza default = accurate trees AND DeepSeek judge a and c good), (f) meaning judge two-vote %, composite = (a) and (b) and (d). The reference ceiling row scores the reference targets themselves on the same units. The meaning judge is applied to outputs that differ from the input, so an unchanged output (the no-rewrite arm) counts as meaning-preserving by construction.

| arm / kind | units | (a) | (b) | (c) chrF | (d) analysis | (f) meaning | composite |
|---|---|---|---|---|---|---|---|
| no rewrite, all repair | 472 | 12.9 | 98.9 | 0.562 | 10.0 | 100.0 | 5.3 |
| &nbsp;&nbsp;ro | 349 | 0.6 | 98.6 | 0.357 | 0.3 | 100.0 | 0.0 |
| &nbsp;&nbsp;mixed | 24 | 12.5 | 100.0 | 0.637 | 41.7 | 100.0 | 12.5 |
| &nbsp;&nbsp;noisy_en | 99 | 56.6 | 100.0 | 0.888 | 36.4 | 100.0 | 22.2 |
| untrained 270M, same prompt, all repair | 472 | 34.3 | 36.7 | 0.321 | 21.4 | 23.9 | 4.0 |
| &nbsp;&nbsp;ro | 349 | 16.0 | 41.5 | 0.247 | 10.0 | 30.4 | 1.4 |
| &nbsp;&nbsp;mixed | 24 | 50.0 | 29.2 | 0.377 | 41.7 | 8.3 | 4.2 |
| &nbsp;&nbsp;noisy_en | 99 | 94.9 | 21.2 | 0.431 | 56.6 | 5.1 | 13.1 |
| untrained 270M, instructed, all repair | 472 | 35.8 | 43.6 | 0.309 | 25.0 | 34.3 | 10.2 |
| &nbsp;&nbsp;ro | 349 | 26.1 | 43.8 | 0.175 | 18.3 | 32.1 | 6.3 |
| &nbsp;&nbsp;mixed | 24 | 41.7 | 29.2 | 0.276 | 37.5 | 20.8 | 16.7 |
| &nbsp;&nbsp;noisy_en | 99 | 68.7 | 46.5 | 0.545 | 45.5 | 45.5 | 22.2 |
| shipped textToCleanEnglish, all repair | 472 | 94.9 | 95.1 | 0.749 | 63.3 | 78.2 | 58.5 |
| &nbsp;&nbsp;ro | 349 | 96.6 | 94.0 | 0.656 | 66.5 | 73.4 | 62.2 |
| &nbsp;&nbsp;mixed | 24 | 95.8 | 91.7 | 0.710 | 66.7 | 70.8 | 62.5 |
| &nbsp;&nbsp;noisy_en | 99 | 88.9 | 100.0 | 0.917 | 51.5 | 97.0 | 44.4 |
| **fine-tuned it1**, all repair | 472 | 97.9 | 99.4 | 0.909 | 67.2 | 81.4 | 65.9 |
| &nbsp;&nbsp;ro | 349 | 99.7 | 99.4 | 0.892 | 69.6 | 82.2 | 69.3 |
| &nbsp;&nbsp;mixed | 24 | 95.8 | 95.8 | 0.891 | 41.7 | 75.0 | 37.5 |
| &nbsp;&nbsp;noisy_en | 99 | 91.9 | 100.0 | 0.942 | 64.6 | 79.8 | 60.6 |
| reference ceiling (units with a reference, n 257) | 257 | 100 | - | 1.000 | 63.0 | 89.9 | - |
| fine-tuned it1 on the same 257 units | 257 | 99.6 | 99.6 | 0.909 | 63.4 | 79.4 | 63.0 |

The analysis gate is capped by the parser: only about 63% of the clean reference sentences pass it. The fine-tuned model reaches the ceiling (63.4% against 63.0% on the units with a reference); for the kinds, mixed has only 24 judged units, so its intervals are wide (see the paired table).

Clean sentences (identity) in the judged sample: in-row identity units 127, untouched 92.9% (fine-tuned), 98.4% (shipped); clean sample 300: untouched 92.7% [89.1, 95.1], analysis changed on 4.3% (13/300), analysis correct before and not after 1.7% (5/286).

## Paired comparisons (fine-tuned minus arm, bootstrap 95% interval over units, 2,000 resamples)

| vs | scope | units | composite | clean % | content % | analysis % | meaning % | chrF |
|---|---|---|---|---|---|---|---|---|
| no rewrite | repair | 472 | +60.6 [+56.1, +65.0] | +85.0 [+81.6, +88.1] | +0.4 [-0.9, +1.5] | +57.2 [+52.5, +61.9] | -18.6 [-22.0, -15.0] | +0.3 [+0.3, +0.4] |
| no rewrite | repair:ro | 349 | +69.3 [+64.5, +74.2] | +99.1 [+98.0, +100.0] | +0.9 [-0.6, +2.3] | +69.3 [+64.5, +73.9] | -17.8 [-22.1, -14.0] | +0.5 [+0.5, +0.6] |
| no rewrite | repair:mixed | 24 | +25.0 [+8.3, +41.7] | +83.3 [+66.7, +95.8] | -4.2 [-12.5, +0.0] | +0.0 [-20.8, +20.8] | -25.0 [-41.7, -8.3] | +0.3 [+0.1, +0.4] |
| no rewrite | repair:noisy_en | 99 | +38.4 [+28.3, +48.5] | +35.4 [+26.3, +44.4] | +0.0 [+0.0, +0.0] | +28.3 [+18.2, +38.4] | -20.2 [-28.3, -12.1] | +0.1 [+0.0, +0.1] |
| no rewrite | identity | 127 | -0.8 [-2.4, +0.0] | +0.0 [+0.0, +0.0] | -0.8 [-2.4, +0.0] | +0.0 [+0.0, +0.0] | -2.4 [-5.5, +0.0] | -0.0 [-0.0, -0.0] |
| untrained 270M | repair | 472 | +61.9 [+57.4, +66.3] | +63.6 [+58.7, +68.2] | +62.7 [+58.3, +67.2] | +45.8 [+40.5, +51.1] | +57.4 [+52.3, +62.9] | +0.6 [+0.6, +0.6] |
| untrained 270M | repair:ro | 349 | +67.9 [+63.0, +72.5] | +83.7 [+79.7, +87.4] | +57.9 [+52.7, +63.0] | +59.6 [+54.1, +65.0] | +51.9 [+45.6, +58.2] | +0.6 [+0.6, +0.7] |
| untrained 270M | repair:mixed | 24 | +33.3 [+16.7, +54.2] | +45.8 [+25.0, +66.7] | +66.7 [+45.8, +83.3] | +0.0 [-20.8, +20.8] | +66.7 [+45.8, +87.5] | +0.5 [+0.4, +0.6] |
| untrained 270M | repair:noisy_en | 99 | +47.5 [+37.4, +57.6] | -3.0 [-10.1, +4.0] | +78.8 [+70.7, +86.9] | +8.1 [-4.0, +19.2] | +74.8 [+65.7, +82.8] | +0.5 [+0.4, +0.6] |
| untrained 270M | identity | 127 | +34.6 [+26.0, +44.1] | +1.6 [+0.0, +3.9] | +47.2 [+38.6, +55.9] | +2.4 [-5.5, +10.2] | +81.1 [+74.0, +87.4] | +0.4 [+0.4, +0.5] |
| untrained 270M instructed | repair | 472 | +55.7 [+51.1, +60.6] | +62.1 [+57.4, +66.3] | +55.7 [+51.1, +60.2] | +42.2 [+36.4, +47.9] | +47.0 [+41.7, +51.9] | +0.6 [+0.6, +0.6] |
| untrained 270M instructed | repair:ro | 349 | +63.0 [+57.3, +68.5] | +73.6 [+68.8, +78.2] | +55.6 [+50.4, +60.7] | +51.3 [+44.4, +57.3] | +50.1 [+44.1, +56.2] | +0.7 [+0.7, +0.8] |
| untrained 270M instructed | repair:mixed | 24 | +20.8 [-4.2, +45.8] | +54.2 [+29.2, +75.0] | +66.7 [+41.7, +87.5] | +4.2 [-20.8, +29.2] | +54.2 [+29.2, +79.2] | +0.6 [+0.4, +0.8] |
| untrained 270M instructed | repair:noisy_en | 99 | +38.4 [+28.3, +48.5] | +23.2 [+15.2, +32.3] | +53.5 [+43.4, +63.6] | +19.2 [+7.1, +31.3] | +34.3 [+22.2, +46.5] | +0.4 [+0.3, +0.5] |
| untrained 270M instructed | identity | 127 | +25.2 [+15.8, +33.9] | +8.7 [+3.9, +13.4] | +37.0 [+28.3, +45.7] | +12.6 [+4.7, +21.3] | +29.1 [+20.5, +37.8] | +0.3 [+0.2, +0.3] |
| shipped backend | repair | 472 | +7.4 [+3.2, +11.7] | +3.0 [+1.5, +4.7] | +4.2 [+2.1, +6.4] | +3.8 [-0.4, +8.3] | +3.2 [-1.7, +8.1] | +0.2 [+0.1, +0.2] |
| shipped backend | repair:ro | 349 | +7.2 [+2.6, +12.3] | +3.1 [+1.4, +5.2] | +5.4 [+2.9, +8.0] | +3.1 [-1.7, +8.6] | +8.9 [+3.1, +14.6] | +0.2 [+0.2, +0.3] |
| shipped backend | repair:mixed | 24 | -25.0 [-41.7, -8.3] | +0.0 [-12.5, +12.5] | +4.2 [-8.3, +16.7] | -25.0 [-41.7, -8.3] | +4.2 [-20.8, +29.2] | +0.2 [+0.1, +0.3] |
| shipped backend | repair:noisy_en | 99 | +16.2 [+8.1, +25.2] | +3.0 [+0.0, +7.1] | +0.0 [+0.0, +0.0] | +13.1 [+4.0, +21.2] | -17.2 [-25.2, -9.1] | +0.0 [+0.0, +0.0] |
| shipped backend | identity | 127 | +0.0 [+0.0, +0.0] | +0.0 [+0.0, +0.0] | +0.0 [+0.0, +0.0] | +0.8 [+0.0, +2.4] | -1.6 [-4.7, +1.6] | -0.0 [-0.0, +0.0] |

pp = percentage points (chrF in absolute units). The shipped backend leaves most badly written English unchanged (meaning trivially kept), which is why the meaning column favours it on noisy_en; on Romanian (349 units) the fine-tuned model is better on composite, content and meaning and equal on analysis.

## Composed K4 (`eval/suites/bad_english/test-composed.jsonl`, 306 paragraphs, per-sentence mode, clean-English gate, host splitter, `tools/eval/composed-score.mjs rewrite --kind K4 --mode sentence`)

| arm | clean sentences changed (of 986) | bad sentences fixed (of 578) | bad sentences rewritten wrongly | bad sentences untouched | dropped components (of 1,564) | paragraphs with added text | exact paragraphs (of 306) |
|---|---|---|---|---|---|---|---|
| no rewrite | 0 (0.0%) | 1 (0.2%) | 0 (0.0%) | 577 (99.8%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) |
| untrained 270M (GGUF Q8_0) | 5 (0.5%) | 1 (0.2%) | 253 (43.8%) | 314 (54.3%) | 24 (1.5%) | 88 (28.8%) | 0 (0.0%) |
| shipped | 0 (0.0%) | 90 (15.6%) | 167 (28.9%) | 313 (54.2%) | 8 (0.5%) | 37 (12.1%) | 22 (7.2%) |
| **fine-tuned it1 (GGUF Q8_0)** | 2 (0.2%) | 148 (25.6%) | 111 (19.2%) | 312 (54.0%) | 11 (0.7%) | 26 (8.5%) | 34 (11.1%) |

The gate is the limit: the clean-English gate sends only 28% of the bad sentences (163/578) to any rewriter, so 54% of them stay untouched for every arm. The model, when it is called, fixes more than the shipped backend (25.6% against 15.6% of all bad sentences) and rewrites wrongly less often (19.2% against 28.9%); it changes 2 of 986 clean sentences (0.2%, H7 holds). `composed/*__K4__sentence.summary.json` holds the per-stratum numbers.

## Deployment form: GGUF Q8_0 and CPU speed

GGUF Q8_0 through the private converter copy of `~/proofreader-export-venv`. Greedy agreement between HF bf16 and llama.cpp on the first 50 judged-sample units: 49/50 (GPU server), 48/50 (CPU server); on all 599 units 574/599 and 571/599 (95.8% and 95.3%); differences are numeric noise on near-ties (for example "in the warehouse" dropped once, "In addition" against "Also"). CPU speed, llama-server on CPU with 4 threads (`-ngl 0 -t 4`, other agents' jobs running on the machine), 30 messages of the sealed test: p50 112 ms per sentence, mean 116 ms, max 184 ms, about 113 output tokens/s including prompt processing (13.2 output tokens per sentence); over all 599 units p50 101 ms, 124 tokens/s. The shipped backend needs about 710 ms per sentence for the Qwen3-1.7B call (373 of 599 sentences reach it), 24 ms for LanguageTool, 0 ms when the cheap gate passes the sentence. The base-model requirement of 30 to 40 tokens/s is met with a wide margin. `cpu-speed.json`.

## Error categories (fine-tuned it1, judged sample, repair units; exclusive, first match wins)

| category | units | share |
|---|---|---|
| keyboard-mash or unintelligible input (clean-English gate fails on the copied mash) | 8 | 1.7% |
| other clean-English gate failure (untranslated word, spelling left) | 2 | 0.4% |
| content lost or changed mechanically (name, number, quote, negation, question mark, length) | 3 | 0.6% |
| relation flip child to parent (unseen word mapped to the only training relation) | 17 | 3.6% |
| meaning judge rejects, other (wrong lexical choice, wrong translation, added or dropped detail) | 65 | 13.8% |
| only the analysis gate fails (meaning judge and mechanics pass) | 120 | 25.4% |
| pass everything | 257 | 54.4% |

The meaning-judge category mixes real errors (wrong lexical choice, a misread misspelling) and judge strictness (quotation marks added around a title, example 7; "not trained" against a reference "not trained", example 6, where the gate and the judge disagree with the reference). In a hand read of 14 random rejects about half (7) were real errors; the rest were judge strictness or unintelligible input.

On the full sealed test (mechanical layer, 8,435 repair units): 235 fail the clean-English gate (206 of them keyboard-mash inputs that have no acceptable output; the model copies or garbles them, 22 leave a non-English token, 12 a spelling the checker would change); 91 lose content mechanically (74 a name, number or quote, 13 negation parity, 4 question marks); the child to parent flip occurs 182 times for Romanian inputs and 65 times for English inputs. Wild units (formalizer-wild-v1, 89): chrF 0.61, exact match 9.3%, clean 94.4%, content 94.4%; units longer than 160 characters (11): content 90.9%.

Root causes seen in the examples and the training data:

1. **Closed vocabulary of the generator.** `datasets/bad_english/proofing/train.jsonl` has 249 targets with "parent of" and none with "child of" (inputs neither); the sealed rows contain "child of" (new cases, other templates) and the model maps it to the word it knows. The same mechanism explains "boatyard" to "shipyard", "employs" to "issues/owns" for misspelled "emoloys", "lactoză" to "penicillin": repairs that land on a trained word instead of the written one. Same form, other words is exactly the owner's generalization test, and the vocabulary is the thing that fails.
2. **Keyboard mash and one-word interjections** have no acceptable target (the DeepSeek rows marked them unfixable, so the pairs were skipped) and the model was never taught to leave them alone or to refuse: it copies the mash (206 gate failures) or invents a greeting ("Fihe." to "Hello." against the reference "Fine.").
3. **Cosmetic edits of clean text** (the 5.2% of clean sentences changed): capital letter and final full stop added, a comma before a conjunction, quotes around a title, "fewer" to "less", "metres" to "meters"; all mechanically content-preserving, a few change meaning ("Play the bridge more quietly" to "Play the bridge quietly"). The identity share (10%) taught restraint only partly.
4. **Mixed kind under-represented** (1,933 train pairs, 422 sealed units, 24 judged): the judged composite is 37.5% [wide interval], lower than Romanian, and the composite difference to the shipped backend on mixed is -25 pp (24 units, interval excludes 0). Too few units to conclude, enough to prioritize.
5. **Analysis gate ceiling**: 63% of even the reference targets pass it, so the gate separates rewriters only weakly above that level; the fine-tuned outputs reach the ceiling.

## 30 examples (judged sample; 10 Romanian, 10 mixed, 10 badly written English; 5 good and 5 bad per kind)

Good = clean English, content preserved, analysis gate and meaning judge pass. Bad examples are real errors (meaning judge rejects, content lost or gate failure), not only analysis-gate failures. Reference = the DeepSeek target where one exists. Flags: clean / content / analysis / meaning.

| # | kind | input | fine-tuned output | reference | shipped output | flags |
|---|---|---|---|---|---|---|
| 1 | ro good | Întrebare: Ștoi cumva dacă are de vânzare uniforme școlare ? | Question: Do you happen to know whether she has school uniforms for sale? | Question: Do you happen to know whether it has school uniforms for sale? | Is Ștoi selling school uniforms? | YYYY |
| 2 | ro good | Știi de ce Teodora Mocanu ia bonusul? | Do you know why Teodora Mocanu gets the bonus? | - | Do you know why Teodora Mocanu gets the bonus? | YYYY |
| 3 | ro good | În plus, Rachel se ocupă de serverul de e-mail. | In addition, Rachel takes care of the email server. | - | In addition, Rachel is responsible for the email server. | YYYY |
| 4 | ro good | Alina raportează către Tudor. | Alina reports to Tudor. | Alina reports to Tudor. | Alina reports to Tudor. | YYYY |
| 5 | ro good | În plus, Oficiul de Cadastru Orhei nu eliberează extrasul de carte funciară. | In addition, the Oficiul de Cadastru Orhei does not issue the land title extract. | - | In addition, Oficiul de Cadastru Orhei does not release the bookkeeping slip. | YYYY |
| 6 | ro bad | Există cineva care lucrează la Orion Robotics și nu e instruit? | Is there anyone who works at Orion Robotics and is not trained? | Is there anyone who works at Orion Robotics and is not trained? | Is there anyone working at Orion Robotics who is not instructed? | YYnn |
| 7 | ro bad | Greenline Transport a publicat Ciorbele Transilvaniei. | Greenline Transport published "Ciorbele Transilvaniei". | Greenline Transport published "Ciorbele Transilvaniei". | Greenline Transport published Ciorbele Transilvaniei. | YYYn |
| 8 | ro bad | În plus, Lucian este copilul lui Nils. | In addition, Lucian is Nils's parent. | - | In addition, Lucian is the child of Nils. | YYYn |
| 9 | ro bad | Context: Tunde e copilul lui Dragoș Rusu. | Context: Tunde is Dragoș Rusu's parent. | - | Tunde is the child of Dragoș Rusu. | YYYn |
| 10 | ro bad | Fă-mi o listă cu oamenii și firmele din Kraków la care lucrează. | Make me a list of the people and companies in Kraków that they work for. | Make me a list of the people and the companies in Kraków that they work for. | Make a list of people and companies in Kraków that they work for. | YYnn |
| 11 | mixed good | Does Marta need an adap ter for her bass amp? | Does Marta need an adapter for her bass amp? | Does Marta need an adapter for her bass amp? | Does Marta need an adapter for her bass amp? | YYYY |
| 12 | mixed good | Since Diego Romero trains Olimpia Buzău, oare este certificat? | Since Diego Romero trains Olimpia Buzău, is it true that he is certified? | Since Diego Romero trains Olimpia Buzău, is he certified? | Since Diego Romero trains Olimpia Buzău, is Olimpia Buzău certified? | YYYY |
| 13 | mixed good | So, Ștefan vizitează Orhei. | So, Ștefan is visiting Orhei. | So, Ștefan is visiting Orhei. | Ștefan visits Orhei. | YYYY |
| 14 | mixed good | Poți să verifici dacă Mirela face alergie la cat hair? | Can you check whether Mirela is allergic to cat hair? | Can you check whether Mirela is allergic to cat hair? | Can you check if Mirela has an allergy to cat hair? | YYYY |
| 15 | mixed good | We have an echipă meeting soon. | We have a team meeting soon. | We have a team meeting soon. | We have a team meeting soon. | YYYY |
| 16 | mixed bad | How long did Kamau own via de lângă Sibiu? | How long did Kamau own the vineyard near Sibiu? | How long did Kamau own the vineyard near Sibiu? | How long did Kamau own via de lângă Sibiu? | YYnn |
| 17 | mixed bad | Context: Chen e copilul lui Nour. | Context: Chen is Nour's parent. | Context: Chen is Nour's child. | Chen is the child of Nour. | YYYn |
| 18 | mixed bad | How cime Lucian has acc ess to the lab ? | How many people have access to the lab? | How come Lucian has access to the lab? | How does Lucian have access to the lab? | YnYn |
| 19 | mixed bad | Who treats a patient with an allergy to lactoză ? | Who treats a patient with an allergy to penicillin? | Who treats a patient with an allergy to lactose? | Who treats a patient with an allergy to lactose? | YYnn |
| 20 | mixed bad | Întrebare: Oare esgte ânchisă pentru wedding reception ? | Question: Is he/she ânchis for the wedding reception? | Question: I wonder whether it is closed for the wedding reception? | Are they engaged for the wedding reception? | nYnn |
| 21 | noisy_en good | Also,a work permit doesn't require a birth certificate. | Also, a work permit doesn't require a birth certificate. | Also, a work permit doesn't require a birth certificate. | Also, a work permit doesn't require a birth certificate. | YYYY |
| 22 | noisy_en good | Petronela moved from Orhei too Galați. | Petronela moved from Orhei to Galați. | Petronela moved from Orhei to Galați. | Petronela moved from Orhei too Galați. | YYYY |
| 23 | noisy_en good | Here'swhat I know: Alejandro treats Oluwaseun. | Here's what I know: Alejandro treats Oluwaseun. | Here's what I know: Alejandro treats Oluwaseun. | Here'swhat I know: Alejandro treats Oluwaseun. | YYYY |
| 24 | noisy_en good | Fact-check: Mr Navarro intends to attend the product launch . | Fact-check: Mr Navarro intends to attend the product launch. | Fact-check: Mr Navarro intends to attend the product launch. | Fact-check: Mr Navarro intends to attend the product launch . | YYYY |
| 25 | noisy_en good | Please lable that crate. | Please label that crate. | Please label that crate. | Please lable that crate. | YYYY |
| 26 | noisy_en bad | Fihe. | Hello. | Fine. | Fihe. | YYnn |
| 27 | noisy_en bad | rgtyuio rty | Sorry, sorry | - | rgtyuio rty | YYnn |
| 28 | noisy_en bad | Debrecen Logistics emoloys Radu Căpraru. | Debrecen Logistics issues Radu Căpraru. | Debrecen Logistics employs Radu Căpraru. | Debrecen Logistics emoloys Radu Căpraru. | YYnn |
| 29 | noisy_en bad | zxcvbnjmkzxcv | zxcvbnjmkzxcv | - | zxcvbnjmkzxcv | nYYY |
| 30 | noisy_en bad | Greenline Transport empoloys Răzvan Anghel. | Greenline Transport owns Răzvan Anghel. | Greenline Transport employs Răzvan Anghel. | Greenline Transport employs Răzvan Anghel. | YYYn |

`examples.jsonl` has the same rows with the failure reasons.

## Preregistered hypotheses, read against the results

| id | statement (short) | result | holds |
|---|---|---|---|
| H1 | clean-English gate >= 80% overall, >= 70% ro; difference interval to base and to no rewrite above 0 for every kind | overall 97.2%, ro 99.7%; vs no rewrite above 0 for every kind; vs untrained base above 0 for ro and mixed but noisy_en -3.0 pp [-10.1, +4.0] (the base emits gate-clean text that is not the message) | point bars yes; interval clause fails for noisy_en |
| H2 | content preserved >= 85% (mechanical); meaning judge >= 80% on the judged sample | 98.9% mechanical; meaning judge 81.4% (reference targets 89.9%) | yes |
| H3 | mean chrF >= 0.80 on units with a reference | 0.898 overall (ro 0.876, mixed 0.888, noisy_en 0.943) | yes (the references are DeepSeek text, the same source as most training targets) |
| H4 | analysis gate within 10 pp of the reference ceiling and above no rewrite (interval above 0) | 63.4% against ceiling 63.0% on the units with a reference; vs no rewrite +57.2 pp [+52.5, +61.9] | yes |
| H5 | >= 95% of clean sentences untouched | 94.8% (853/900), Wilson [93.1, 96.1] on clean900; 92.7% on the judged 300 | **no** (narrowly; point estimate below the bar) |
| H6 | composite not lower than the shipped backend by more than 5 pp (paired lower bound above -5 pp), 600-unit sample (not 300) | +7.4 pp [+3.2, +11.7] | yes (also above 0); mixed -25 pp on 24 units |
| H7 | K4 per-sentence: <= 2% of clean sentences changed | 2/986 = 0.2% | yes |
| H8 | ro learns when ro clean % and ro content % are both >= 70% | 99.7% and 98.8% on the mechanical layer; meaning judge 82.2% on ro, analysis 69.6% | learns (by the preregistered mechanical definition); the meaning judge shows 18% residual errors |

## Verdict: does 270M learn this, and what should iteration 2 change?

**Does 270M learn it?** Yes, on the measures that exist today. After three epochs (35 minutes) it turns Romanian, mixed and badly written English sentences into clean English that keeps names, numbers, quotes and negation (98.9% of repair units), agrees with the DeepSeek reference at chrF 0.90 (0.876 for Romanian), reaches the parser ceiling of the analysis gate (63%) and beats the shipped LanguageTool + Qwen3-1.7B step on the composite by 7 pp on the judged sample, about six times faster per sentence on CPU than the Qwen3-1.7B call. Romanian to English specifically works: the clean-English rate is 99.7%, the meaning judge accepts 82% of the Romanian outputs against 90% for the references themselves. The evidence does not show that 270M cannot learn; the Gemma 3 1B fallback is not triggered, and the failures below are data problems that a larger base would not remove by itself.

**Caveats that limit the claim.** (1) Dev is saturated (99.5%) and the sealed units come from the same generators, so this measures same form with other words at the level of the generator's vocabulary, not unseen forms (wild units: chrF 0.61, 9% exact). (2) The references and the judge are the same model family (DeepSeek flash); agreement with the reference and the meaning judge both inherit its habits, and the judge was calibrated on English originals. (3) The clean-English gate accepts text that is not the message (the untrained base passes it 91% of the time on badly written English); it is a necessary check, not a quality measure, so the composite and the meaning judge carry the weight. (4) Meaning errors remain at 18.6% of the judged repair units, against 10.1% for the references. (5) Mixed has 24 judged units.

**Iteration 2 should change (data first, same model):**
1. **Vocabulary diversity.** Train on targets that use more relation words and nouns (the `child of` hole is the visible one): DeepSeek through omp with prompts that vary domain and lexicon, plus held-out-word dev splits (hold out lexical items, not only groups) so that dev measures what the sealed test measures. Add an explicit "keep the written word" signal: pairs whose misspelling is ambiguous must resolve to the written candidate, not to a frequent trained word.
2. **Meaning-judge-filtered targets.** Keep only targets that pass the two-vote meaning judge (3% of the DeepSeek targets had meaning errors on the 100-row read) and add the hard negatives as contrast pairs.
3. **More mixed and wild forms.** Mixed has 1.9k train pairs and the wild units are where agreement breaks (chrF 0.61); the owner's rule (forms from the wild and OOD suites are learning material) applies directly.
4. **Policy for unintelligible input.** Decide what the target is for keyboard mash and interjections (leave unchanged, or a marker the host recognises), then teach it; today 206 units are gate failures that no model could have passed.
5. **Stronger identity discipline.** Raise the identity share from 10% toward 20-25% with varied clean English (not only symbolic_english templates), including already-good sentences with commas, titles and lower-case starts, so that cosmetic edits stop (clean sentences changed 5.2%, H5 missed by 0.2 pp).
6. **Fix the host gate, not the model, for K4.** The clean-English gate sends 28% of the bad sentences to any rewriter; in sentence mode the pipeline is gate-limited (54% of the bad sentences stay untouched for every arm). A gate that is permissive about punctuation, casing and spacing problems would raise end-to-end fixes without any model change.
7. **Longer training is not the lever** (dev loss 0.154, 0.132, 0.135; dev saturated); change the data, keep the recipe and the base, and compare iteration 2 on the same sealed units.

## Deviations and notes

* D1 (preregistration): `verify-three-datasets.mjs` without `--dataset` failed on the symbolic/neuro fields being re-split by another agent; the bad_english-only run passes (0 failures). D2: bounded CUDA-floor override after the default floor stopped attempt A2. D3: the sealed bad_english test was merged by the owner-approved merge during training (hash change); the tuned model had been scored once, mechanically, on the pre-merge units; all arms were re-run on the rebuilt units and only those are reported; a post-hoc leakage check against the merged test is in `leakage-post-merge.json` (no sealed message sentence is a train prompt; 7 train pairs have a prompt equal to a merged sealed reference sentence, 94 train targets equal a sealed sentence). D4: the extra clean900 identity set (H5 reads on it). Not preregistered but done: a second untrained baseline with an instruction prefix, the 599-unit judged sample (600 requested: one unit dropped by the stratification), and the 599-unit shipped run instead of 300.
* Judge folders: `datasets_sources/language_proofing_parse_judge/` and `datasets_sources/language_proofing_meaning_judge/` (DeepSeek flash through omp; frozen SYSTEM prompts copied from the calibration folders).
* Processes started by this run (LanguageTool, Qwen3-1.7B llama-server, the shipped-step shim, three llama-servers for the GGUF checks) were stopped after use; nothing else was touched.
* Hashes and the training recipe are not changed after the freeze; `status/training/qualification-language-proofing.json` and the receipt were regenerated once before any optimizer step (missing projection manifest), which is logged in the journal.

## Reproduce

`node tools/datasets/build-language-proofing.mjs`, `node tools/eval/language-proofing-test.mjs build`, `node tools/research/qualify-language-proofing.mjs`, training through `node training/container/podman.mjs run --job ... -- train --model gemma --run language-proofing-gemma270m-it1 --role proofreader --data datasets/bad_english/proofing ...`, then `node tools/eval/language-proofing-eval.mjs generate|prepare|meaning-prepare|score|compare`, `node tools/eval/composed-score.mjs rewrite --kind K4 --mode sentence`, `tools/eval/language-proofing-shipped.mjs` and `language-proofing-shipped-server.mjs` for the shipped backend.

