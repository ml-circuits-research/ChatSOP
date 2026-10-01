# neuro_english

Grammatically correct English whose **SymbolicLM grammatical analysis is not correct**: the Stanza trees of the two packages differ, or the DeepSeek parse judge says the analysis is not good enough. Where known, a row carries a meaning-preserving rewrite whose analysis passes the gate (a target in `symbolic_english` form). The SOP-layer result of every row is kept as `sop_layer` for the later layer.

**Purpose.** Fine-tuning and evaluation material for **SymbolicProofingLLM**, the small fine-tuned model (Gemma3-270M so far, called "proofreader" in older records) that transfers correct English into the limited English SymbolicLM understands without losing semantic equivalence. Priority order: extend SymbolicLM with rules and repairs first; rewriting covers only what rules cannot fix. Rows nobody can rewrite yet are kept and flagged (`no_target`).

Files: `train.jsonl`, `dev.jsonl` (sharded when large), `manifest.json`; the sealed test is `eval/suites/neuro_english/test.jsonl`. Not human-reviewed; not authorized for training.

## What goes in (classification)

The message is clean English (classifier verdict `clean_en`) and it does **not** pass the analysis gate of `symbolic_english` (same rule for every row, with a gold SOP or without; owner direction of 2026-09-30 night, the earlier builders used the SOP match as a proxy and were corrected, see `eval/reports/current/three-datasets/resplit-summary.md`). A row is here when at least one sentence of the message fails:

* the default-package and accurate-package Stanza trees of the sentence differ (`trees_differ`), or
* the DeepSeek parse judge (`tools/research/parse-judge.mjs`, conditions a and c) says not good enough on condition a, condition c or both (`judge_a`, `judge_c`, `judge_ac`; only sentences with identical trees are judged).

Rows the gate cannot judge follow the SOP rules: no analysed sentence (`no_analysis`) or an `unparsed` span (`unparsed_span`), with the SOP not verified (no strict gold match, or without gold no valid SOP with a real outcome).

### `failure_kind` (per row): the ANALYSIS failure

| `failure_kind` | Meaning | `analysis_verified` |
|---|---|---|
| `trees_differ` | a sentence's default and accurate trees differ (head or relation of a word, or a different sentence split); worst class in `verification.stanza_default_accurate` | `analysis_gate_failed` |
| `judge_ac` | trees identical on every sentence that was judged, and the judge says not good enough on both conditions for some sentence | `analysis_gate_failed` |
| `judge_a` | as above, only condition a (reading and arcs) rejects | `analysis_gate_failed` |
| `judge_c` | as above, only condition c (six checks on the tree) rejects | `analysis_gate_failed` |
| `no_analysis`, `unparsed_span` | the SOP rules placed the row (no analysed sentence, or an unparsed span) | `sop_rule_failed` |
| `pending_judge` | a verdict is still missing (flag `pending_judge`); never in a finished build | `analysis_pending_judge` |

When the sentences of a row fail for different reasons, the row's kind is the first of `trees_differ`, `judge_ac`, `judge_a`, `judge_c`; all reasons are in `failure.reasons` and `analysis_verdict.reasons`. Every row is `rewrite_target: true` (the analysis failed, so a rewrite can help).

`analysis_verdict` holds the gate result per sentence (tree class, verdicts `a` and `c`, the folder each verdict came from). `sop_layer` holds the SOP layer of the earlier builds, unchanged in meaning: `status` (`match`, `mismatch`, `no_gold`), `handled`, and for a miss the SOP `failure_kind` (`parser`, `rules`, `gold_convention`, `unknown`: the proofing layer of a rewrite the current engine still verifies, else the structural diff classes P, R, C and host frame normalization) with its `failure` evidence (`classes`, `categories`, `frame_recoverable`, `proofing_layer`, `regularization`, `unverified_targets`, `unparsed`). A neuro row can have `sop_layer.status: match` (the SOP is right although the analysis is judged wrong): that is a gate result to audit, not a contradiction. `failure` of the row is the analysis evidence (`layer: analysis`, `reasons`, `categories`, `unparsed`, `formatting_only`).

## Target rules

`target` is the first of `targets`; every listed target passed a check that SymbolicLM handles it:

* `proofing.repair`: a repair of `datasets_archive/proofing` whose input is exactly the message, that passed the meaning checks and whose target the **current** engine (`ud-rules-v2.5`, accurate package) analyses to the row's gold SOP (strict; a check of the SOP layer that stands as the meaning signal); the older oracle of rules v1.4 no longer counts. A target listed here has not been through the analysis gate; the gate and the meaning are applied to the rewrite candidates of the pair set (`proofing/`, below);
* `regularization`: an attempt of the symbolic-layers study that kept the meaning and parsed correctly (sealed-suite rows only);
* `new_cases.clean`: the LLM-written clean reference of a new case, kept only when SymbolicLM handles it (valid SOP, no unparsed span); `review_status: reviewed-by:pending`. References that SymbolicLM does not handle are listed in `unverified_references`.

A row without target has `flags: ["no_target"]`; a convention-only row has `flags: ["gold_convention_not_a_rewrite_target"]`. A target that differs from the message only in casing, punctuation or spacing (a lowercase, unpunctuated message such as `did at least 3 visitors request captions`) is flagged `formatting_only` (`failure.formatting_only: true`): a rule in SymbolicLM or LanguagesUtil can make that fix, so these rows are evidence for a rule before they are training material.

Row fields: `id`, `message`, `analysis`, `sop`, `sop_valid`, `outcome`, `unparsed`, `gold_sop`, `analysis_verified` (`analysis_gate_failed`, `sop_rule_failed` or, in an unfinished build, `analysis_pending_judge`), `analysis_verdict`, `sop_layer`, `verification` (`sop_gold_match`, `judge`: the gate's per-sentence verdicts, `stanza_spacy_agree`, `stanza_default_accurate`), `failure_kind`, `failure`, `rewrite_target`, `target`, `target_source`, `targets`, `flags`, `symbolic_lm`, `source`, `split_group_id`, `rights`, `quality_flags`, `review_status`.

## Splits and rights

As in `bad_english` and `symbolic_english`: source splits by `split_group_id`, sealed-suite rows only in `eval/suites/neuro_english/test.jsonl`. The sealed proofing test is made of formalizer-v1 dev messages, so the dev rows of the split groups it uses are sealed here as test too (`source.origin_split: dev`, `source.sealed_by`) and are not dev., exact-text overlap with a sealed message dropped from train and dev.

Rebuild (train, dev, then the sealed test; the gate needs the parses and judge verdicts of `node tools/datasets/build-three-datasets.mjs gate-stage` and `node tools/eval/three-datasets-suites.mjs gate-stage`, answered by the judge task of `datasets_sources/resplit_parse_judge/`): `node tools/datasets/build-three-datasets.mjs assemble`, `node tools/eval/three-datasets-suites.mjs assemble`; verify with `node tools/datasets/verify-three-datasets.mjs`. The full order, including the SymbolicLM analysis cache, is in DS008 "Three datasets".

## Target style: limited English for SymbolicLM

The rewrite target follows the contract of [DS021](../../docs/specs/DS021-model-surface.md) "Limited English for SymbolicLM": one clause and one question per sentence, an explicit subject and predicate (a subject shared by coordinated or relative clauses of the same sentence is repeated as written), connectives that carry meaning kept in a form SymbolicLM parses, names, numbers, negation, quantifiers and hedges unchanged with nothing added or dropped, and a pronoun that refers outside its sentence left as a pronoun (SymbolicLM resolves it; the model works one sentence at a time and never needs the previous one). **Decomposition** of a tangled sentence into short simple sentences is the hardest and most important job of SymbolicProofingLLM. `node tools/datasets/audit/decomposition-coverage.mjs --check-targets` counts the decomposition cases of this dataset and checks how well the targets follow the contract.

Long training cases (`composed: true`, `source.corpus: composed`) are paragraphs that mix symbolic sentences (unchanged) with neuro sentences (replaced by their targets), built from train rows (`tools/datasets/composed-train.mjs`); `source.corpus: form-variant` rows are symbolic_english only. Production cases wait in `incoming.jsonl` until the owner reviews them (`tools/datasets/add-case.mjs`).

## proofing/ (SymbolicProofingLLM pairs)

`proofing/{train,dev}.jsonl` are the flat `{id, prompt, target, kind, language, source_language, pipeline, target_source}` pairs of the frozen role id `proofreader` (message in, limited-English rewrite out, or the message itself for an identity pair); `proofing/audit.jsonl` carries the id, kind, source, verification level, form, decomposition type, sentence counts, failure_kind and Gemma 3 token lengths of each pair; `proofing/manifest.json` has counts and hashes; `proofing/proofreader/` holds byte-identical copies in the layout `training/cli.mjs` reads. The sealed test pairs are `eval/suites/neuro_english/proofing-test.jsonl`. Not human-reviewed; not authorized for training.

Built by `node tools/datasets/neuro-targets-oracle.mjs build` (train/dev) and `node tools/eval/neuro-oracle-test.mjs build` (sealed) from the DeepSeek rewrite candidates of `datasets_sources/neuro_english_targets/`. Every candidate is verified on the **analysis layer** (owner direction of 2026-09-30 night): SymbolicLM parses it (frozen rules, recorded parses), and it must pass the same analysis gate as a `symbolic_english` row (identical default and accurate trees and DeepSeek parse judge conditions a and c good on every sentence; `datasets_sources/resplit_parse_judge/`, keyed on sentence text plus tree) **and** keep the meaning. Meaning signals, in order: a strict gold-SOP match (`VERIFIED_GOLD`: the SOP equals the row's gold, the SOP layer serving as the meaning check), a match of the gold under the host's frame normalization confirmed by the meaning judge (`VERIFIED_GOLD_NORMALIZED`), or the DeepSeek meaning judge with two votes, prompts m1 AND m2 both saying yes (`VERIFIED_FORM`; used because its recalibration, experiment `eval-meaning-judge-calibration-v1`, reached 98.8% raw precision of the two-vote yes, at or above the 97% rule; `datasets_sources/resplit_meaning_judge/`). A gate pass without a trusted meaning signal would be marked `VERIFIED_FORM_UNTRUSTED` and is not built. The SOP built from a candidate is not a condition (it is the later layer; the stage record keeps `sop_stage`). Anything else is `REJECTED` with its reason (`tree_disagree`, `gate_failed`, `equals_message`, `meaning_changed`, ...). Candidates: the first DeepSeek task (`datasets_sources/neuro_english_targets/`) and, for the rows that were `symbolic_english` under the SOP-proxy split and became neuro rows, `datasets_sources/resplit_neuro_targets/`. One pair per row (best level, fewest sentences, shortest), identity pairs from `symbolic_english` stratified by form, and the composed and form-variant rows of `tools/datasets/composed-train.mjs` / `form-variants.mjs`. Report: `eval/reports/current/neuro-oracle/summary.md`; engine-gap backlog: `eval/reports/current/neuro-oracle/engine-gaps.jsonl`; qualification record: `node tools/research/qualify-neuro-proofing.mjs`.

<!-- counts -->

## Counts at the last build

Rebuilt 2026-09-30T21:42:20.537Z (train, dev) and 2026-09-30T21:38:54.764Z (sealed test); SymbolicLM `symbolic-lm-v2.0`, rules `ud-rules-v2.5`, stanza-1.10.1/en:tokenize=combined,mwt=combined,pos=combined_electra-large,lemma=combined_nocharlm,depparse=combined_electra-large.

| split | rows | with target | rewrite targets |
| --- | --- | --- | --- |
| train | 6,317 | 317 | 6,317 |
| dev | 924 | 46 | 924 |
| test | 1,871 | 40 | 1,871 |

Rows by source corpus:

| source | train | dev | test |
| --- | --- | --- | --- |
| composed | 119 | 16 | 0 |
| form-variant | 19 | 1 | 0 |
| formalizer-ood-v1 | 210 | 32 | 32 |
| formalizer-v1 | 3,703 | 436 | 1,245 |
| formalizer-wild-v1 | 175 | 50 | 32 |
| new_cases | 1,938 | 389 | 562 |
| proofing-diverse-dev | 153 | 0 | 0 |

`failure_kind`:

| failure_kind | train | dev | test |
| --- | --- | --- | --- |
| judge_a | 322 | 54 | 111 |
| judge_ac | 171 | 20 | 40 |
| judge_c | 221 | 48 | 51 |
| trees_differ | 4,696 | 649 | 1,417 |
| unparsed_span | 907 | 153 | 252 |

`sop_layer`:

| sop_layer | train | dev | test |
| --- | --- | --- | --- |
| match | 2,635 | 295 | 862 |
| mismatch | 1,660 | 226 | 447 |
| no_gold | 2,022 | 403 | 562 |

`sop_failure_kind`:

| sop_failure_kind | train | dev | test |
| --- | --- | --- | --- |
| gold_convention | 470 | 65 | 175 |
| none | 4,069 | 594 | 1,251 |
| parser | 71 | 11 | 1 |
| rules | 1,070 | 147 | 268 |
| unknown | 637 | 107 | 176 |

`target_source`:

| target_source | train | dev | test |
| --- | --- | --- | --- |
| composed | 117 | 16 | 0 |
| new_cases.clean | 121 | 20 | 34 |
| none | 6,000 | 878 | 1,831 |
| proofing.repair | 79 | 10 | 6 |
