# neuro_english/unified-ft-u1: one output (the limited English only)

Training pairs of the unified-ft experiment (preregistration `status/preregistrations/train-unified-qwen3-4b.json`). Built by `tools/research/build-unified-ft.mjs` from the existing datasets only; train 24550, dev 2219. Target: the limited English only. `full.jsonl` (in unified-ft-u2) keeps both outputs and the chain of every row. Evaluation messages (datasets/natural) are never used; the jargon blocklist and the natural-overlap and sealed-leakage guards ran row by row. Qualification is not an authorization.
