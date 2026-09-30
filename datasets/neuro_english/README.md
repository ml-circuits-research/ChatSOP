# neuro_english

Grammatically correct English that **SymbolicLM does not analyse correctly**. Where known, a row carries a meaning-preserving rewrite that SymbolicLM does handle (a target in `symbolic_english` form).

**Purpose.** Fine-tuning and evaluation material for **SymbolicProofingLLM**, the small fine-tuned model (Gemma3-270M so far, called "proofreader" in older records) that transfers correct English into the limited English SymbolicLM understands without losing semantic equivalence. Priority order: extend SymbolicLM with rules and repairs first; rewriting covers only what rules cannot fix. Rows nobody can rewrite yet are kept and flagged (`no_target`).

Files: `train.jsonl`, `dev.jsonl` (sharded when large), `manifest.json`; the sealed test is `eval/suites/neuro_english/test.jsonl`. Not human-reviewed; not authorized for training.

## What goes in (classification)

The message is clean English (classifier verdict `clean_en`) and SymbolicLM fails on it:

* rows with a gold SOP: the strict gold match fails (frozen rules `ud-rules-v1.4`);
* rows without gold (new cases): SymbolicLM returns an invalid SOP, crashes, formalizes nothing (`nothing_formalized`, `fallback`, `gibberish` outcome), or leaves an `unparsed` span.

### `failure_kind` (per row)

| `failure_kind` | Meaning | Rewriting target? |
|---|---|---|
| `parser` | Stanza's analysis is wrong (proofing layer `parser`, a stronger-judge DEEP/FAIL verdict of the symbolic-layers study, or a wrong lemma of a misspelled word) | yes |
| `rules` | the parse is usable but the UD-to-SOP rules miss or mis-build (proofing layer `rules` / `rules+convention`, or the structural diff has rule classes) | yes |
| `gold_convention` | the miss is only a gold convention: relation/object boundary, role name, wording; host frame normalization repairs it, or the diff has only convention classes | **no** (`rewrite_target: false`): exclude from fine-tuning |
| `unknown` | no layer information (new cases without gold, or no structural difference found) | yes |

`failure` holds the evidence: structural diff `classes` (P parser or typo, R rules, C gold convention), `categories`, `frame_recoverable`, the recorded proofing `layer`, `regularization` verdict, and `unparsed` spans.

## Target rules

`target` is the first of `targets`; every listed target passed a check that SymbolicLM handles it:

* `proofing.repair`: a repair of `datasets_archive/proofing` whose input is exactly the message and whose target passed the strict `ud-rules-v1.4` oracle and the meaning checks;
* `regularization`: an attempt of the symbolic-layers study that kept the meaning and parsed correctly (sealed-suite rows only);
* `new_cases.clean`: the LLM-written clean reference of a new case, kept only when SymbolicLM handles it (valid SOP, no unparsed span); `review_status: reviewed-by:pending`. References that SymbolicLM does not handle are listed in `unverified_references`.

A row without target has `flags: ["no_target"]`; a convention-only row has `flags: ["gold_convention_not_a_rewrite_target"]`. A target that differs from the message only in casing, punctuation or spacing (a lowercase, unpunctuated message such as `did at least 3 visitors request captions`) is flagged `formatting_only` (`failure.formatting_only: true`): a rule in SymbolicLM or LanguagesUtil can make that fix, so these rows are evidence for a rule before they are training material.

Row fields: `id`, `message`, `analysis`, `sop`, `sop_valid`, `outcome`, `unparsed`, `gold_sop`, `analysis_verified` (`gold_sop_mismatch`, or `analysis_failed_no_gold` or `analysis_rejected_by_gate` for new cases: SymbolicLM handled the message but the two-parser gate of `symbolic_english` did not accept the analysis, with `failure_kind` `parser` or `unknown`), `verification` (`sop_gold_match: false`, `judge`, `stanza_spacy_agree`, `stanza_default_accurate`), `failure_kind`, `failure`, `rewrite_target`, `target`, `target_source`, `targets`, `flags`, `symbolic_lm`, `source`, `split_group_id`, `rights`, `quality_flags`, `review_status`.

## Splits and rights

As in `bad_english` and `symbolic_english`: source splits by `split_group_id`, sealed-suite rows only in `eval/suites/neuro_english/test.jsonl`. The sealed proofing test is made of formalizer-v1 dev messages, so the dev rows of the split groups it uses are sealed here as test too (`source.origin_split: dev`, `source.sealed_by`) and are not dev., exact-text overlap with a sealed message dropped from train and dev.

Rebuild (train, dev, then the sealed test): `node tools/datasets/build-three-datasets.mjs assemble`, `node tools/eval/three-datasets-suites.mjs assemble`; verify with `node tools/datasets/verify-three-datasets.mjs`. The full order, including the SymbolicLM analysis cache, is in DS008 "Three datasets".

## Target style: limited English for SymbolicLM

The rewrite target follows the contract of [DS021](../../docs/specs/DS021-model-surface.md) "Limited English for SymbolicLM": one clause and one question per sentence, an explicit subject and predicate (a subject shared by coordinated or relative clauses of the same sentence is repeated as written), connectives that carry meaning kept in a form SymbolicLM parses, names, numbers, negation, quantifiers and hedges unchanged with nothing added or dropped, and a pronoun that refers outside its sentence left as a pronoun (SymbolicLM resolves it; the model works one sentence at a time and never needs the previous one). **Decomposition** of a tangled sentence into short simple sentences is the hardest and most important job of SymbolicProofingLLM. `node tools/datasets/audit/decomposition-coverage.mjs --check-targets` counts the decomposition cases of this dataset and checks how well the targets follow the contract.

Long training cases (`composed: true`, `source.corpus: composed`) are paragraphs that mix symbolic sentences (unchanged) with neuro sentences (replaced by their targets), built from train rows (`tools/datasets/composed-train.mjs`); `source.corpus: form-variant` rows are symbolic_english only. Production cases wait in `incoming.jsonl` until the owner reviews them (`tools/datasets/add-case.mjs`).

<!-- counts -->

## Counts at the last build

Rebuilt 2026-09-30T13:19:12.247Z (train, dev) and 2026-09-30T13:20:14.400Z (sealed test); SymbolicLM `symbolic-lm-v1.1`, rules `ud-rules-v1.4`, stanza-1.10.1/en:tokenize=combined,mwt=combined,pos=combined_charlm,lemma=combined_nocharlm,depparse=combined_charlm.

| split | rows | with target | rewrite targets |
| --- | --- | --- | --- |
| train | 5,999 | 589 | 5,256 |
| dev | 893 | 85 | 795 |
| test | 2,082 | 111 | 1,661 |

Rows by source corpus:

| source | train | dev | test |
| --- | --- | --- | --- |
| formalizer-v1 | 3,415 | 416 | 964 |
| new_cases | 2,405 | 477 | 711 |
| proofing-diverse-dev | 179 | 0 | 0 |
| formalizer-ood-v1 | 0 | 0 | 140 |
| formalizer-wild-v1 | 0 | 0 | 267 |

`failure_kind`:

| failure_kind | train | dev | test |
| --- | --- | --- | --- |
| gold_convention | 743 | 98 | 421 |
| parser | 1,416 | 155 | 147 |
| rules | 1,433 | 163 | 788 |
| unknown | 2,407 | 477 | 726 |

`target_source`:

| target_source | train | dev | test |
| --- | --- | --- | --- |
| new_cases.clean | 265 | 52 | 69 |
| none | 5,410 | 808 | 1,971 |
| proofing.repair | 324 | 33 | 27 |
| regularization | 0 | 0 | 15 |
