# bad_english/proofing-it3: training data of LanguageProofingLLM iteration 3

Sentence pairs for the run `language-proofing-gemma270m-it3` (role `proofreader`, experiment `train-language-proofing-gemma270m-it3`). Built from the qualified, judged `../proofing-v3` by `node tools/datasets/build-language-proofing-v3.mjs build` (evidence in `eval/reports/current/language-proofing-it3/data/`); `proofreader/{train,dev}.jsonl` are byte-identical to `train.jsonl`, `dev.jsonl`. The dev file is byte-identical to the iteration-2 dev.

* The ten words that iteration 2 held out (cousin, niece, uncle, tenant, supervisor, tutor, owe, adopt, audit, boatyard) are in `train.jsonl` (1,258 reserve pairs); `dev-heldout.jsonl` (574 pairs, source rows and targets disjoint from train) is now the **trained-vocabulary dev**.
* Eight NEW words (nephew, landlord, contractor, postpone, reject, bakery, warehouse, pharmacy) are removed from train in prompt and target; `dev-heldout-v3.jsonl` (830 repair pairs) is the **unseen-vocabulary probe**, `dev-heldout-v3-identity.jsonl` its clean-sentence companion.
* Spacing and doubled punctuation: 863 identity pairs with a defect in the prompt became repair pairs, 1,800 deterministic perturbations of clean sentences were added (`tools/datasets/language-proofing/spacing.mjs`), 40 repair pairs with a defective target were dropped; `dev-spacing.jsonl` holds 240 perturbed dev sentences.
* Other dev files: `dev-backgen.jsonl`, `mash-eval.jsonl` (unchanged from v3).

Status: qualified (`status/training/qualification-language-proofing-it3.json`) and trained on once (receipt `status/training/authorization-gemma-language-proofing-gemma270m-it3.json`); targets are DeepSeek-written and unreviewed. Result: `eval/reports/current/language-proofing-it3/summary.md`.
