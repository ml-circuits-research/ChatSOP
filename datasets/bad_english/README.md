# bad_english

Messages that are **not clean English**: Romanian, mixed Romanian/English ("romgleza"), spelling mistakes, grammar problems and garbled text. Where an acceptable clean-English rewrite is known, the row carries it as `target`.

**Purpose.** Evaluate and later fine-tune **LanguageProofingLLM**, the model behind the chat's `textToCleanEnglish` step (translation plus spelling and grammar repair into acceptable English). It is a different job from SymbolicProofingLLM (see `neuro_english`): here the input is not correct English.

Files: `train.jsonl`, `dev.jsonl` (sharded as `.part-NNN.jsonl` when large, read with `lib/jsonl-shards.mjs`), `manifest.json` (counts, sha256, sources, rules); the sealed test is `eval/suites/bad_english/test.jsonl`. Nothing here is human-reviewed and nothing is authorized for training (`training_authorized: false`).

## What goes in (classification)

A row is in `bad_english` when the clean-English classifier (`tools/datasets/clean-english.mjs`, DS008 "Clean-English partition") says the message is not clean English:

| `language_kind` | Classifier verdict |
|---|---|
| `ro` | monolingual Romanian (clean or noisy) |
| `mixed` | a `code_switch` tag, or language identification finds Romanian and English content words |
| `noisy_en` | English with generator noise, a spelling correction the checker would make, a non-English token, or gibberish |

and, for the new cases (`datasets_sources/new_cases`, LLM-written), messages that differ from their clean reference because of noise: the classifier says not clean, or the case carries a `typos` or `casual_register` tag while its message differs from `clean[0]`. New cases declared clean by their author (message equal to `clean[0]`) are never noisy because language identification calls ordinary English "mixed" (for example "dorm", "can", "receipt"); a new case that fails the gate on spelling or gibberish stays here with `target: null`.

## Target rules

`target` is the first of `targets`; each target records its `source` and what was checked. A target must itself pass the clean-English gate. Sources, in order of preference:

1. `proofing.repair`: a repair pair of `datasets_archive/proofing` whose input is exactly the message and whose target passed the strict oracle of `ud-rules-v1.4` (the rewritten message executes to the gold SOP).
2. `noise-inverse`: the clean text reconstructed by undoing the recorded generator noise operations (`typo`, `autocorrect`, `phonetic`, `space_*`, punctuation and casing operations); refused when an operation is not invertible or its text is not found exactly once.
3. `clean-sibling`: a clean-English row of the same semantic case with the same gold SOP (different wording, same meaning).
4. `proofing.translate`: for Romanian and mixed rows, the SymbolicLM English rendering of the same semantic case that passed the strict oracle and the clean-English gate.
5. `new_cases.clean`: the LLM-written clean reference of a new case (`review_status: reviewed-by:pending`).
6. `llm:deepseek-flash`: a clean-English target written by DeepSeek flash (omp task `datasets_sources/bad_english_targets/`) for a row that had none, checked mechanically by `tools/eval/bad-english-targets.mjs validate` and by the clean-English gate; `review_status: pending` and `targets[].check.review: pending`. A target that fails the gate (most often a Romanian proper name kept in the text) is held in `unverified_references` with the flag `llm_target_failed_clean_gate`; a row DeepSeek found unfixable (keyboard mash, nothing recoverable) keeps `no_target` plus `llm_unfixable` and its reason; a `mixed` row that is already clean English (or differs only by casing) gets its message as target (`check.message_is_target`, owner direction 2026-09-30). Merge: `node tools/datasets/merge-llm-targets.mjs` (train, dev; idempotent) and the dataset builder (`three-datasets/llm-targets.mjs`, applied by `assemble`). A row that already has a target keeps it.

Rows with no target are kept and carry `flags: ["no_target"]`. Row fields: `id`, `dataset`, `split`, `split_group_id`, `message`, `language`, `language_kind`, `noise_categories`, `noise` (`level`, `ops`, `code_switch`), `gate_reasons` (why the classifier said not clean), `target`, `target_source`, `targets`, `flags`, `source` (corpus, id, semantic case, family, question type, author), `rights`, `quality_flags`, `review_status`.

## Splits and rights

Splits are the source splits by `split_group_id` (formalizer-v1 groups; new cases by writer, with the sealed writers of `split-proposal.json` as the test and four deterministic dev writers), so no group crosses a split. Rows that come from a sealed suite are only in the sealed test (AGENTS.md rule 9). The sealed proofing test is made of formalizer-v1 dev messages, so the dev rows of the split groups it uses are sealed here as test too (`source.origin_split: dev`, `source.sealed_by`) and are not dev. A message whose normalized text equals a sealed message is dropped from train and dev. Rights follow the source per row (`rights`): formalizer-derived rows inherit the DS014 record of `formalizer-v1`, new cases are original writing of the ChatSOP agents; no source text is copied.

Rebuild (train, dev, then the sealed test): `node tools/datasets/build-three-datasets.mjs assemble`, `node tools/eval/three-datasets-suites.mjs assemble`; verify with `node tools/datasets/verify-three-datasets.mjs`. The full order, including the SymbolicLM analysis cache, is in DS008 "Three datasets".

## Target style and the two-model chain

A clean target is acceptable English; where the sentence is tangled, the contract of [DS021](../../docs/specs/DS021-model-surface.md) "Limited English for SymbolicLM" applies to the target too (one clause and one question per sentence, explicit subject and predicate, meaning-carrying connectives kept, names, numbers, negation, quantifiers and hedges unchanged, pronouns that refer outside the sentence left as pronouns). LanguageProofingLLM works **one sentence at a time** (the host splits, the clean-English gate keeps the clean sentences, only the others go to the model): it never resolves a reference and needs no other sentence, so this dataset has single-sentence cases only; a Romanian dropped subject becomes the pronoun that fits the verb (SymbolicLM resolves it, so the choice does not change the SOP). The composed paragraphs of K4 (`eval/suites/bad_english/test-composed.jsonl`) are evaluation only. `node tools/datasets/harvest.mjs` runs rows through the chain and feeds the chain's failures to `neuro_english`; production cases wait in `incoming.jsonl` (`tools/datasets/add-case.mjs`).

<!-- counts -->

## Counts at the last build

Rebuilt 2026-09-30T19:06:22.826Z (train, dev) and 2026-09-30T19:07:19.962Z (sealed test); SymbolicLM `symbolic-lm-v2.0`, rules `ud-rules-v2.5`, stanza-1.10.1/en:tokenize=combined,mwt=combined,pos=combined_electra-large,lemma=combined_nocharlm,depparse=combined_electra-large.

| split | rows | with target |
| --- | --- | --- |
| train | 17,919 | 15,986 |
| dev | 3,383 | 3,037 |
| test | 4,245 | 3,783 |

Rows by source corpus:

| source | train | dev | test |
| --- | --- | --- | --- |
| formalizer-ood-v1 | 701 | 160 | 173 |
| formalizer-v1 | 15,566 | 2,973 | 3,730 |
| formalizer-wild-v1 | 334 | 69 | 74 |
| new_cases | 933 | 181 | 268 |
| proofing-diverse-dev | 385 | 0 | 0 |

`language_kind`:

| language_kind | train | dev | test |
| --- | --- | --- | --- |
| mixed | 4,831 | 933 | 928 |
| noisy_en | 4,617 | 631 | 1,465 |
| ro | 8,471 | 1,819 | 1,852 |

`target_source`:

| target_source | train | dev | test |
| --- | --- | --- | --- |
| clean-sibling | 4 | 2 | 2 |
| llm:deepseek-flash | 10,553 | 2,190 | 2,512 |
| new_cases.clean | 898 | 171 | 262 |
| noise-inverse | 2,328 | 289 | 896 |
| none | 1,933 | 346 | 462 |
| proofing.repair | 996 | 110 | 111 |
| proofing.translate | 1,207 | 275 | 0 |
