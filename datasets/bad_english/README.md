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

Rows with no target are kept and carry `flags: ["no_target"]`. Row fields: `id`, `dataset`, `split`, `split_group_id`, `message`, `language`, `language_kind`, `noise_categories`, `noise` (`level`, `ops`, `code_switch`), `gate_reasons` (why the classifier said not clean), `target`, `target_source`, `targets`, `flags`, `source` (corpus, id, semantic case, family, question type, author), `rights`, `quality_flags`, `review_status`.

## Splits and rights

Splits are the source splits by `split_group_id` (formalizer-v1 groups; new cases by writer, with the sealed writers of `split-proposal.json` as the test and four deterministic dev writers), so no group crosses a split. Rows that come from a sealed suite are only in the sealed test (AGENTS.md rule 9). The sealed proofing test is made of formalizer-v1 dev messages, so the dev rows of the split groups it uses are sealed here as test too (`source.origin_split: dev`, `source.sealed_by`) and are not dev. A message whose normalized text equals a sealed message is dropped from train and dev. Rights follow the source per row (`rights`): formalizer-derived rows inherit the DS014 record of `formalizer-v1`, new cases are original writing of the ChatSOP agents; no source text is copied.

Rebuild (train, dev, then the sealed test): `node tools/datasets/build-three-datasets.mjs assemble`, `node tools/eval/three-datasets-suites.mjs assemble`; verify with `node tools/datasets/verify-three-datasets.mjs`. The full order, including the SymbolicLM analysis cache, is in DS008 "Three datasets".

## Target style and the two-model chain

A clean target is acceptable English; where the sentence is tangled, the contract of [DS021](../../docs/specs/DS021-model-surface.md) "Limited English for SymbolicLM" applies to the target too (one clause and one question per sentence, explicit subject and predicate, meaning-carrying connectives kept, names, numbers, negation, quantifiers and hedges unchanged, pronouns that refer outside the sentence left as pronouns). LanguageProofingLLM works **one sentence at a time** (the host splits, the clean-English gate keeps the clean sentences, only the others go to the model): it never resolves a reference and needs no other sentence, so this dataset has single-sentence cases only; a Romanian dropped subject becomes the pronoun that fits the verb (SymbolicLM resolves it, so the choice does not change the SOP). The composed paragraphs of K4 (`eval/suites/bad_english/test-composed.jsonl`) are evaluation only. `node tools/datasets/harvest.mjs` runs rows through the chain and feeds the chain's failures to `neuro_english`; production cases wait in `incoming.jsonl` (`tools/datasets/add-case.mjs`).

<!-- counts -->

## Counts at the last build

Rebuilt 2026-09-30T13:19:11.426Z (train, dev) and 2026-09-30T13:20:14.317Z (sealed test); SymbolicLM `symbolic-lm-v1.1`, rules `ud-rules-v1.4`, stanza-1.10.1/en:tokenize=combined,mwt=combined,pos=combined_charlm,lemma=combined_nocharlm,depparse=combined_charlm.

| split | rows | with target |
| --- | --- | --- |
| train | 17,169 | 5,393 |
| dev | 3,215 | 829 |
| test | 5,511 | 1,444 |

Rows by source corpus:

| source | train | dev | test |
| --- | --- | --- | --- |
| formalizer-v1 | 15,850 | 3,034 | 3,730 |
| new_cases | 933 | 181 | 268 |
| proofing-diverse-dev | 386 | 0 | 0 |
| formalizer-ood-v1 | 0 | 0 | 1,035 |
| formalizer-wild-v1 | 0 | 0 | 478 |

`language_kind`:

| language_kind | train | dev | test |
| --- | --- | --- | --- |
| mixed | 4,527 | 859 | 1,317 |
| noisy_en | 4,543 | 610 | 1,672 |
| ro | 8,099 | 1,746 | 2,522 |

`target_source`:

| target_source | train | dev | test |
| --- | --- | --- | --- |
| clean-sibling | 4 | 1 | 3 |
| new_cases.clean | 898 | 171 | 262 |
| noise-inverse | 2,267 | 271 | 1,068 |
| none | 11,776 | 2,386 | 4,067 |
| proofing.repair | 1,013 | 111 | 111 |
| proofing.translate | 1,211 | 275 | 0 |
