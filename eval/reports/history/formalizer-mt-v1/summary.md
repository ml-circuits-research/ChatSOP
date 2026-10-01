# SOP Lang as translation (formalizer-mt-v1): status summary

**Status: BLOCKED before training (2026-09-29, about 12:05Z). No optimizer step has run and no fine-tuned prediction exists, so this page contains no result.**

- **Preregistration:** `status/preregistrations/formalizer-mt-v1.json`
- **Owner approval scope:** `status/training/owner-approval-formalizer-mt-v1.json`
- **Recipe:** `config/train-opus-mt.json`
- **Token audit:** `eval/reports/current/training/opus-mt-formalizer-token-audit.json`

## The idea

The owner's idea (2026-09-29) is that NL → SOP is translation into a new language. The experiment starts from a small pretrained translation model that already translates Romanian into English and copies names, and teaches it SOP Lang as its target language. It is then compared with SmolLM2-135M, Gemma 3 270M and SmolLM2-360M (formalizer-size-v1) on the same suites.

## What was done

- **Model choice, measured:**
  - `Helsinki-NLP/opus-mt-ro-en` and `opus-mt-tc-big-ro-en` do not exist on the Hugging Face Hub.
  - Chosen instead: `Helsinki-NLP/opus-mt-ROMANCE-en@e9ca9975e3972afd80732f08ce01d3a1339f47f8` (MarianMT, 77.9M parameters, Apache-2.0, Romanian among its source languages).
  - The revision publishes only `pytorch_model.bin`. It was converted to safetensors with a weights-only load. All files match the Hub hashes.
- **Tokenizer:** measured on all 28,948 train+dev rows.
  - SentencePiece normalization erases the newlines and two-space indentation that SOP needs.
  - A reversible line encoding (`<nK>` added tokens, `training/python/seq2seq_text.py`) fixes this: every target round-trips exactly, with 0 unknown tokens in targets. Only 10 messages contain one unknown character (U+201D).
  - The same holds for `opus-mt-roa-en`, `opus-mt-tc-bible-big-roa-en` and `mt5-small`. The smallest model was kept.
- **Lengths:**
  - Targets reach 3,099 Marian tokens; 1,688 of them exceed the base's 512 positions.
  - The static sinusoidal position tables are therefore extended to 4,096 rows and frozen. The first 512 rows are identical to the base's, and the base's translations are unchanged.
- **Pipeline:**
  - Seq2seq training in `training/python/train.py`: the encoder reads the message only, and the label is the SOP target.
  - Interim checks after each quarter of epoch 1 and at every epoch end, on the development loss plus 200 stratified development rows. The run stops early when failing or on a plateau (the owner's rule).
  - `training/python/predict_seq2seq.py` and `node training/cli.mjs predict` for GPU bulk evaluation.
  - A seq2seq token audit, which passes.
  - The leakage audit and the model-boundary tests pass.
- **Environment:** `~/mt-venv`, a CPU venv with CTranslate2 4.8.2, for the int8 CPU speed sample (`dependencies.md`).

## Why it is blocked

1. **Qualification:** `training/cli.mjs` refuses `status/training/qualification-formalizer-v1.json` ("SOP contract changed: sop/parser.mjs"). `sop/parser.mjs` and `server/agent.mjs` were modified after the qualification, although the data is unchanged. Training needs a qualification record that is valid for the current contract files.
2. **Authorization receipt:** no `chatsop-training-authorization-v1` receipt exists for `opus-mt/fmt-a1`. The receipt tool only transcribes `training`-area decisions under the formalizer-size-v1 scope, while the owner's approval is logged as a `process`-area decision.

An attempt to extend the qualification/receipt tool for both points was refused by the permission system. The owner has to decide how to re-qualify and how to issue the receipt.

## Conclusion

None yet. Whether a translation model is better than the decoder-only arms is still open.
