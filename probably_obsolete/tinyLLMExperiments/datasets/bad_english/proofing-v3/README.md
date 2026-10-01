# bad_english/proofing-v3: prepared, unused

Training pairs for a possible later LanguageProofingLLM run (role `proofreader`): the iteration-2 data of `../proofing-v2` plus the DeepSeek back-generation parts 010-025 (all 26 parts, two-vote meaning judge, the same target-consistency rules D8/D9, identity share about 22%). The dev sets (`proofreader/dev.jsonl`, `dev-backgen.jsonl`, `dev-heldout.jsonl`, `mash-eval.jsonl`) are byte-identical to those of `../proofing-v2`, so results stay comparable; held-out-vocabulary pairs of the new parts are in `reserve-heldout.jsonl` and are not in train.

Status: qualified (`status/training/qualification-language-proofing-v3.json`), **not trained on**: by the owner decision of 2026-10-01 no iteration 3 is trained for now. No training authorization receipt exists for this dataset. Build: `node tools/datasets/build-language-proofing-v2.mjs build --parts 000..025 --cand candidates-v3.jsonl --out datasets/bad_english/proofing-v3 --evidence eval/reports/current/language-proofing-it2/v3 --freeze-dev datasets/bad_english/proofing-v2`; evidence in `eval/reports/current/language-proofing-it2/v3/`.

Update 2026-10-01: iteration 3 was trained from this dataset's rebuilt form `../proofing-it3` (reserve pairs added to train, eight other words held out, spacing pairs); `proofing-v3` itself was not trained on. See `../proofing-it3/README.md`.
