# natural: the owner's own chat messages

Owner decision of 2026-10-01 (DS008 "The natural collection", DS014 "Owner chat messages"). `messages.jsonl` holds the project owner's own chat messages to Claude Code in this repository: mostly Romanian, with typos and English technical words, instructions to an AI assistant about software. It is the most realistic input the project has. There are no train, dev or test splits and no targets.

Row: `{id, ts, session, message, words, sentences}`. The wording is verbatim, typos included. `<pasted_content>` blocks (text of others, logs), e-mail addresses, secret-looking tokens and absolute home paths are replaced by the placeholders `[pasted content]`, `[email]`, `[token]` and `[path]`; messages that are mostly pasted foreign content are dropped. Rights: owner-authored, cleared.

## Build

`node tools/eval/collect-natural.mjs` re-reads the Claude Code transcripts of this project, applies the same filters and appends the new owner messages. It is idempotent (a row is identified by session and timestamp), so the collection grows over time. It writes `messages.jsonl` and `manifest.json`.

## Two roles

1. **Realism evaluation set, read as a whole.** `node tools/eval/natural-score.mjs` runs the chat pipeline on it on CPU (textToCleanEnglish, SymbolicLM, the interpretation "I understood", the gated SymbolicProofingLLM rewrite) and reports layer by layer in `eval/reports/current/natural/summary.md`. Reported separately; it is a realism check, not a gate, and makes no claim of form coverage: these forms are not the ones the system was built for.
2. **Seeds for synthetic training data.** A synthetic row reuses the FORM of a message with different content words (names, nouns, verbs, numbers). That is the project's evaluation policy ("same form, different words"), so evaluating on the originals stays valid.

## How the synthetic rows will be made (not generated yet)

An omp task folder under `datasets_sources/` (DeepSeek or Grok, in the pattern of the other task folders: `TASK.md`, `input/items.jsonl`, `output/`, a validator). For each message the model gets the message and writes several variants that keep the sentence structure, the register (typos, mixed Romanian and English, hesitations) and the intent, and change every content word: names, nouns, verbs, numbers, domain terms. Each output row carries `natural_seed` (the id of the message it comes from) and the usual provenance fields (`source`, `rights` of kind `llm-authored`, `review_status: pending`). The rows then pass the existing gates of their dataset (the clean-English classifier and the analysis gate decide which of the three datasets takes them).

## Mechanical guard

`node tools/datasets/audit/natural-overlap.mjs` (run by `tools/datasets/verify-three-datasets.mjs`, so it fails closed) compares every row of every split of the three datasets with every natural message and fails on

- an exact or normalized duplicate of a natural message (the row's message or its clean target),
- a lexical duplicate: identical content words (light tokenizer, at least two words),
- a `natural_seed` that names no natural message.

Rows that are largely contained (80% of the content words) are counted as information. Report: `eval/reports/current/three-datasets/natural-overlap.json`.
