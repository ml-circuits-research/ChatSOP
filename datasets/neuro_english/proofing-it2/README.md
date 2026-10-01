# neuro_english/proofing-it2: SymbolicProofingLLM iteration-2 training pairs (sentence units)

Pairs `prompt -> target` for the SymbolicProofingLLM (frozen role id `proofreader`): the unit is ONE sentence as cut by the host splitter, the target is the
same sentence unchanged (identity) or one or several simple sentences that SymbolicLM analyses correctly (repair). Built by
`tools/datasets/build-symbolic-proofing-v2.mjs`; nothing here is a sealed test (the sealed pairs stay in `eval/suites/neuro_english/proofing-test.jsonl`).

Rules (preregistered in `status/preregistrations/train-symbolic-proofing-gemma270m-it2.json`):

- repair prompt: SymbolicLM does not handle it as it is (the analysis gate fails: Stanza default and accurate trees differ, or the DeepSeek parse judge says no);
- repair target: every sentence passes the gate, or it is an original sentence of the current `symbolic_english` train/dev of the same split; the two-vote meaning judge says
  the meaning is kept; no pronoun is replaced or dropped, no name, number or content is added, no lead-in, tag or question frame is dropped (no filler may be dropped);
- identity prompt: passes the gate alone; at least half of the rows are identity (backgen identity paraphrases, lead-in and tag sentences, single sentences of `symbolic_english`);
- no sentence equals a sealed sentence or shares its content words with one; the host splits long inputs, the model never sees a paragraph.

Files: `train.jsonl`, `dev.jsonl` (flat rows), `audit.jsonl` (origin, verification, meaning basis, decomposition flags, tokens), `manifest.json`, `VERSION`,
`proofreader/{train,dev}.jsonl` (the layout `training/cli.mjs` reads). Training needs the owner's explicit approval and a receipt (AGENTS.md rule 3).
