# symbolic_english

Correct English whose **SymbolicLM** grammatical analysis is correct (Stanza parse, judged per sentence). Each row stores the message, SymbolicLM's grammatical analysis (the UD parse), and, for the later layer, the SOP Lang it produced with its comparison to the gold (`sop_layer`).

**Purpose.** A **regression suite**: whenever SymbolicLM, the Stanza package or model or the engine changes, everything here must still be analysed the same or better (`node tools/symbolic-regression.mjs`). It is also the inventory of forms that **SymbolicProofingLLM** should rewrite into (the targets of `neuro_english` are drawn from forms like these). SOP generation is a later layer for the owner; the SOP and its gold comparison are kept on every row (`sop_layer`) and never decide the membership.

Files: `train.jsonl`, `dev.jsonl` (sharded when large), `manifest.json`; the sealed test is `eval/suites/symbolic_english/test.jsonl`. Not human-reviewed; not authorized for training.

## What goes in (classification)

The message is clean English (classifier verdict `clean_en`, `tools/datasets/clean-english.mjs`) **and** its grammatical analysis passes the calibrated analysis gate. The rule is the same for every row, with a gold SOP or without (owner direction of 2026-09-30 night; the earlier builders used the SOP match as a proxy and were corrected, see `eval/reports/current/three-datasets/resplit-summary.md`):

* **every sentence** of the message has identical default-package and accurate-package Stanza trees (every head and relation; class `identical` of `compareSentence`, `lib/symbolic-lm/uncertainty.mjs`), **and**
* the DeepSeek parse judge (`tools/research/parse-judge.mjs`, conditions **a** and **c**, run from omp task folders under `datasets_sources/`) says good enough (CORRECT, MINOR or INPUT_TYPO) on both for that sentence. The judge was calibrated against a stronger reference (`datasets_sources/parse_judge_deepseek/`; the gate of identical trees and both conditions reached 97.8% precision on an enriched sample, journal "DeepSeek flash calibrated as a UD parse judge").

Every other clean-English row is in `neuro_english`. Judge verdicts are keyed on the sentence text plus its tree, so a verdict recorded for the same sentence and tree in any folder (`neuro_oracle_parse_judge`, `symbolic_proofing_parse_judge`, `backgen_parse_judge`, `parse_judge_deepseek`, `resplit_parse_judge`) is reused; only missing ones are judged (`node tools/datasets/build-three-datasets.mjs gate-stage`, `tools/datasets/three-datasets/analysis-gate.mjs`). A row that has a verdict is never "pending" in a finished build.

Rows the gate cannot judge follow the SOP rules: a message with **no analysed sentence** (a greeting answered before parsing, gibberish, a crash) or with an **`unparsed` span** is in `symbolic_english` when its SOP is verified (a strict match with the gold, or, without a gold, a valid SOP with a real outcome and no unparsed span) and in `neuro_english` otherwise (`failure_kind` `no_analysis` or `unparsed_span`).

`analysis_verified`:

| `analysis_verified` | Rule |
|---|---|
| `analysis_gate` | every sentence passed the gate above (`analysis_verdict.state: pass`, per sentence the tree class `identical` and the verdicts `a` and `c`, and the folder each verdict came from) |
| `sop_rule` | no analysed sentence, or an unparsed span: the SOP rules placed the row (`analysis_verdict.state: not_applicable`, `reason`) |
| `gold_sop_match` | retired name; only production cases of `tools/datasets/add-case.mjs` (`incoming.jsonl`) still carry it |

`sop_layer` (information for the later layer; it never decides the dataset): `status` is `match` (the SOP equals the gold strictly under rules `ud-rules-v2.5`, Stanza `accurate` package), `mismatch` (a gold exists and the SOP differs; `failure_kind` `parser`, `rules`, `gold_convention` or `unknown` and `failure` as in the earlier builds) or `no_gold`; `handled` says that SymbolicLM produced a valid SOP with a real outcome and no unparsed span. A row with `sop_layer.status: mismatch` keeps its `gold_sop`; `verification.sop_gold_match` repeats the status as true, false or null.

Row fields: `id` (`<corpus>::<source id>`, stable), `message`, `analysis` (`columns` = `id, form, lemma, upos, head, deprel`, then per sentence `text`, `start`, `end`, `tokens`: one array per token; head 0 is the root), `sop`, `sop_valid`, `outcome`, `unparsed`, `uncertain`, `gold_sop` (or `null`), `analysis_verified`, `analysis_verdict` (the gate result per sentence), `sop_layer`, `verification` (`sop_gold_match`, `judge`: the gate's per-sentence verdicts (`class`, `a`, `c`), `stanza_spacy_agree`, `stanza_default_accurate`: `identical`, `noncore_diff` or `core_diff` between the tree the default package would give (`eval/reports/current/three-datasets/analysis-default-v1.6/`, else the recorded default parses of `eval/reports/current/neuro-oracle/parses/`) and the current one, core arcs as defined in `lib/symbolic-lm/uncertainty.mjs` `compareSentence`; the worst class over the sentences), `symbolic_lm` (`version`, `rules`, `stanza` model id), `reference_clean` (new cases: the LLM-written clean references), `source`, `split_group_id`, `rights`, `quality_flags`, `review_status`. `stanza_spacy_agree` is the agreement of Stanza and spaCy (`en_core_web_lg`) on the core arcs (root, subject, object, negation) of every sentence, or `null` when not comparable; it is a weak second opinion, not a verdict.

## Regression runner

`node tools/symbolic-regression.mjs [--split train,dev,test] [--jobs N] [--update]` re-runs SymbolicLM on every row and classifies it: `same`, `analysis_changed_sop_same`, `sop_changed_equivalent` (the SOP text changed but still matches the gold), `sop_changed`, `now_failing`. It exits non-zero on `sop_changed` and `now_failing`; `--update` re-baselines the rows that changed without failing. The stored row is the baseline. `tests/symbolic-regression.test.mjs` runs the same classification on a fixed sample from recorded parses (no Stanza).

## Splits and rights

Source splits by `split_group_id` (formalizer-v1 groups; new cases by writer, sealed writers as the test). Rows of sealed suites are only in the sealed test. The sealed proofing test is made of formalizer-v1 dev messages, so the dev rows of the split groups it uses are sealed here as test too (`source.origin_split: dev`, `source.sealed_by`) and are not dev. Exact-text overlap with a sealed message is dropped from train and dev. Rights per row as in `bad_english`.

Rows the gate rejects go to `neuro_english` in the same split (a row never changes split). Numbers of the re-split, the coverage before (SOP proxy) and after, and where the old neuro rows went: `eval/reports/current/three-datasets/resplit-summary.md`. The forms inventory and the numbers of the earlier Haiku gate (`eval-symbolic-gate-v1`, superseded for membership by the DeepSeek gate) are in `symbolic-gate-report.md` and `symbolic-forms-inventory.md`. Rebuild (analysis caches and judge verdicts are inputs: `node tools/datasets/build-three-datasets.mjs analyze`, again with `--targets`, then `spacy`; `node tools/eval/three-datasets-suites.mjs analyze`, then `targets`; then `node tools/datasets/build-three-datasets.mjs gate-stage` and `node tools/eval/three-datasets-suites.mjs gate-stage` record the parses the gate lacks and append the missing judge items, the judge task of `datasets_sources/resplit_parse_judge/` answers them): `node tools/datasets/build-three-datasets.mjs assemble [--datasets symbolic_english,neuro_english]`, `node tools/eval/three-datasets-suites.mjs assemble [--datasets symbolic_english,neuro_english]`; verify with `node tools/datasets/verify-three-datasets.mjs`. The full order, including the SymbolicLM analysis cache, is in DS008 "Three datasets".

## Working-data additions: form variants, composed paragraphs and production cases

Rows with `source.corpus: form-variant` are variants of forms that the sealed test has and the training side lacked (`node tools/datasets/form-variants.mjs`): same form, other names, nouns and verbs, expected SOP equal to the template's gold with the substituted strings, verified by SymbolicLM, never a text or lexical duplicate of a sealed row (DS008 "Form coverage and form variants"; the sealed twin for forms only the training side has is `eval/suites/symbolic_english/test-variants.jsonl`). Rows with `source.corpus: composed` are paragraphs of 2 to 8 known-good sentences built from train and dev rows whose SymbolicLM analysis equals the concatenation of their parts (`node tools/datasets/composed-train.mjs`); they are the identity targets of SymbolicProofingLLM at paragraph length. Their membership is re-derived by the same analysis gate as every row (a paragraph or variant whose sentences fail the gate is a `neuro_english` row; the exact SOP match the generator made is kept as `sop_layer`); `composed` paragraphs get their parses and judge items through `tools/datasets/three-datasets/place.mjs`. Production cases wait in `incoming.jsonl` until the owner reviews them (`node tools/datasets/add-case.mjs`, DS008 "How we learn from production"). After every rebuild run `node tools/eval/form-templates.mjs`, `node tools/datasets/drop-lexical-duplicates.mjs --apply`, `node tools/datasets/composed-train.mjs --apply` and `node tools/datasets/form-variants.mjs --apply` (each refuses to apply while a judge verdict of its rows is missing: run the judge task, then run it again).

<!-- counts -->

## Counts at the last build

Rebuilt 2026-09-30T21:42:19.947Z (train, dev) and 2026-09-30T21:38:54.682Z (sealed test); SymbolicLM `symbolic-lm-v2.0`, rules `ud-rules-v2.5`, stanza-1.10.1/en:tokenize=combined,mwt=combined,pos=combined_electra-large,lemma=combined_nocharlm,depparse=combined_electra-large.

| split | rows |
| --- | --- |
| train | 5,659 |
| dev | 788 |
| test | 1,605 |

Rows by source corpus:

| source | train | dev | test |
| --- | --- | --- | --- |
| composed | 61 | 11 | 0 |
| form-variant | 87 | 9 | 0 |
| formalizer-ood-v1 | 195 | 38 | 35 |
| formalizer-v1 | 4,014 | 492 | 1,194 |
| formalizer-wild-v1 | 46 | 9 | 6 |
| new_cases | 1,128 | 229 | 370 |
| proofing-diverse-dev | 128 | 0 | 0 |

`analysis_verified`:

| analysis_verified | train | dev | test |
| --- | --- | --- | --- |
| analysis_gate | 5,553 | 780 | 1,593 |
| sop_rule | 106 | 8 | 12 |

`sop_layer`:

| sop_layer | train | dev | test |
| --- | --- | --- | --- |
| match | 3,445 | 415 | 912 |
| mismatch | 1,083 | 142 | 323 |
| no_gold | 1,131 | 231 | 370 |
