# symbolic_english

Correct English that **SymbolicLM** (Stanza parse plus the UD-to-SOP rules) analyses correctly. Each row stores the message, SymbolicLM's grammatical analysis (the UD parse) and the SOP Lang it produced.

**Purpose.** A **regression suite**: whenever SymbolicLM, the Stanza model or the engine changes, everything here must still be analysed the same or better (`node tools/symbolic-regression.mjs`). It is also the inventory of forms that **SymbolicProofingLLM** should rewrite into (the targets of `neuro_english` are drawn from forms like these). SOP generation is a later stage for the owner; the SOP is kept when we have it.

Files: `train.jsonl`, `dev.jsonl` (sharded when large), `manifest.json`; the sealed test is `eval/suites/symbolic_english/test.jsonl`. Not human-reviewed; not authorized for training.

## What goes in (classification)

The message is clean English (classifier verdict `clean_en`, `tools/datasets/clean-english.mjs`) **and** SymbolicLM's output is verified correct. `analysis_verified` says how:

| `analysis_verified` | Rule |
|---|---|
| `gold_sop_match` | the row has a gold SOP and SymbolicLM's SOP matches it strictly (frozen rules `ud-rules-v1.4`; strict execution equivalence with the gold, or an accepted gold for the independent suite). Never removed for a parser disagreement; `analysis_suspect` marks rows whose analysis a judge doubts. |
| `parsers_agree_c` | no gold SOP (new cases): SymbolicLM yields a valid SOP with a real outcome (not `nothing_formalized`, `fallback` or `gibberish`), no `unparsed` span, the default Stanza tree equals the tree of the transformer-based `default_accurate` package on every sentence (head and relation of every token), **and** the Haiku check of `tools/research/parse-judge.mjs` (condition c, six checks) accepts every sentence. This is the tightened gate: the first gate (`parsers_agree` = identical trees; `judge_bc` = differing trees accepted by conditions b and c) audited at 92.7% precision, below the 97% threshold, so those routes are no longer used (the verifier still knows their names). |

Row fields: `id` (`<corpus>::<source id>`, stable), `message`, `analysis` (`columns` = `id, form, lemma, upos, head, deprel`, then per sentence `text`, `start`, `end`, `tokens`: one array per token; head 0 is the root), `sop`, `sop_valid`, `outcome`, `unparsed`, `uncertain`, `gold_sop` (or `null`), `analysis_verified`, `verification` (`sop_gold_match`, `judge` (b/c verdicts per differing sentence), `stanza_spacy_agree`, `stanza_default_accurate`: `identical`, `noncore_diff` or `core_diff` between the default and the accurate tree, core arcs as defined in `tools/datasets/three-datasets/accurate.mjs`), `analysis_suspect` (gold rows only: `true` when the default and accurate trees differ on core arcs and the judges did not both accept the differing sentences; judged on a random sample only), `symbolic_lm` (`version`, `rules`, `stanza` model id), `reference_clean` (new cases: the LLM-written clean references), `source`, `split_group_id`, `rights`, `quality_flags`, `review_status`. `stanza_spacy_agree` is the agreement of Stanza and spaCy (`en_core_web_lg`) on the core arcs (root, subject, object, negation) of every sentence, or `null` when not comparable; it is a weak second opinion, not a verdict.

## Regression runner

`node tools/symbolic-regression.mjs [--split train,dev,test] [--jobs N] [--update]` re-runs SymbolicLM on every row and classifies it: `same`, `analysis_changed_sop_same`, `sop_changed_equivalent` (the SOP text changed but still matches the gold), `sop_changed`, `now_failing`. It exits non-zero on `sop_changed` and `now_failing`; `--update` re-baselines the rows that changed without failing. The stored row is the baseline. `tests/symbolic-regression.test.mjs` runs the same classification on a fixed sample from recorded parses (no Stanza).

## Splits and rights

Source splits by `split_group_id` (formalizer-v1 groups; new cases by writer, sealed writers as the test). Rows of sealed suites are only in the sealed test. The sealed proofing test is made of formalizer-v1 dev messages, so the dev rows of the split groups it uses are sealed here as test too (`source.origin_split: dev`, `source.sealed_by`) and are not dev. Exact-text overlap with a sealed message is dropped from train and dev. Rights per row as in `bad_english`.

Rejected rows go to `neuro_english` (`analysis_verified: analysis_rejected_by_gate`, `failure_kind` `parser` or `unknown`) in the same split. Numbers of the gate, the audit and the forms inventory: `eval/reports/current/three-datasets/symbolic-gate-report.md`, `symbolic-forms-inventory.md`. Rebuild (train, dev, then the sealed test; the accurate-parse cache and the judge verdicts are inputs, `node tools/datasets/build-three-datasets.mjs accurate` and `node tools/eval/three-datasets-suites.mjs accurate` fill the first, `node tools/eval/symbolic-gate.mjs judge` the second): `node tools/datasets/build-three-datasets.mjs assemble`, `node tools/eval/three-datasets-suites.mjs assemble`; verify with `node tools/datasets/verify-three-datasets.mjs`. The full order, including the SymbolicLM analysis cache, is in DS008 "Three datasets".

<!-- counts -->

## Counts at the last build

Rebuilt 2026-09-30T13:19:11.612Z (train, dev) and 2026-09-30T13:20:14.344Z (sealed test); SymbolicLM `symbolic-lm-v1.1`, rules `ud-rules-v1.4`, stanza-1.10.1/en:tokenize=combined,mwt=combined,pos=combined_charlm,lemma=combined_nocharlm,depparse=combined_charlm.

| split | rows |
| --- | --- |
| train | 5,316 |
| dev | 686 |
| test | 2,150 |

Rows by source corpus:

| source | train | dev | test |
| --- | --- | --- | --- |
| formalizer-v1 | 4,550 | 544 | 1,475 |
| new_cases | 662 | 142 | 221 |
| proofing-diverse-dev | 104 | 0 | 0 |
| formalizer-ood-v1 | 0 | 0 | 403 |
| formalizer-wild-v1 | 0 | 0 | 51 |

`analysis_verified`:

| analysis_verified | train | dev | test |
| --- | --- | --- | --- |
| gold_sop_match | 4,654 | 544 | 1,929 |
| parsers_agree_c | 662 | 142 | 221 |
