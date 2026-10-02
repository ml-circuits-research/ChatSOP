# One-shot circuit formalization (archived 2026-10-02)

**Date:** 2026-10-02. **Decision:** the owner. **Status:** history only; nothing here runs in the product, in `npm test` or in an evaluation.

## Why it was archived

One-shot formalization (strategy `LLMDirect`) had a model write the whole SOP circuit of a message in one completion, guided by a long authoring guide, followed by bounded validator repair rounds. The owner made it obsolete on 2026-10-02:

- All formalization goes through the step-by-step protocol (`LocalLLMStepByStep`, `InternalReasoningStepByStep`): the system asks short questions and assembles the circuit itself.
- Larger tiers (`small`, `good`) answer only the SAME protocol questions, so tiers are compared like with like ("apples with apples, not apples with magic").
- The project must learn to ask the right questions efficiently, or small models will never manage. Where small models cannot answer a question, fine-tuning becomes an option later.

The product default is now `LocalLLMStepByStep` (method B) with the per-question tier ladder `tiny`, then `small`, then `good` (`config/runtime.json` `queryParser.local.ladder`; escalation in `createOracle`, `lib/query-author/step-by-step/index.mjs`). The names `LLMDirect`, `CodingAgent` and `LocalLLMDirect` in stored session settings or older run commands resolve to the default step-by-step strategy, with a `strategy_note` in the parse record.

## Last measured numbers

| Measure | One-shot (LLMDirect) | Step by step |
| --- | --- | --- |
| Commonsense rows (eval-commonsense-v1) | 27/32 | not measured on the same rows |
| Owner's books, batch 2 (100 random problems, problem-agent run of 2026-10-02) | 15/100 (25 infrastructure failures), tier `small` | 27/100 on tier `tiny` (LocalLLMStepByStep, method B) |

Source of the books numbers: `status/journal.jsonl` entry of 2026-10-02T17:07 ("problem mode delivered; books batch 2 steps 27/100, LLMDirect 15/100") and `eval/reports/current/books-eval/problem-mode.md` (regenerable, local).

## What moved here (repository-relative paths kept below this folder)

| Archived path | What it was |
| --- | --- |
| `lib/query-author/loop.mjs` | `authorQuery`: the validate-and-repair loop of the one-shot author (vocabulary dialog, self-check) |
| `lib/query-author/context.mjs` | `buildContext`: the one-shot prompt (system guide, retrieved vocabulary, procedure library offer, repair text) |
| `lib/query-author/backends/completion.mjs`, `constrained.mjs` | the completion transport that extracted `query.sop` from a reply, and the grammar/JSON-constrained variant |
| `lib/query-author/structured/` | structured-output ablations (JSON schema, GBNF grammar, closed SOP grammar, interception) of the one-shot author |
| `skills/coding-agent-query/` (`SKILL.md`, `guide.md`) | the one-shot authoring guide (its examples were executable through the validator) |
| `tests/query-author-one-shot.test.mjs` | the context, guide, completion backend, loop and `backendFrom` tests split out of `tests/query-author.test.mjs` |
| `tests/query-author-session-one-shot.test.mjs`, `tests/query-author-condition-misuse-one-shot.test.mjs` | the `authorQuery` tests split out of the session and condition-misuse test files |
| `tests/query-author-dialog.test.mjs`, `-grammar`, `-candidates`, `-structured`, `-ablation`, `tests/constrained-benchmark.test.mjs` | the vocabulary dialog and structured-output tests, and the constrained benchmark arms |
| `tools/eval/query-model-calibration/` (runner parts) | the one-shot calibration of models through `authorQuery` (moved by the eval-tools pass; `servers.mjs` and `models.mjs` stay in place while other tools import them) |

What stayed in the product because other paths use it: the validator (`lib/query-author/validate.mjs`, `admit.mjs`, `session.mjs`, `condition-use.mjs`), retrieval and vocabulary rendering (`retrieval.mjs`, `vocabulary.mjs`, `neighbourhood.mjs`), the procedure circuits of knowledge authoring (`procedures.mjs`), the runtime (`runtime.mjs`), and knowledge ingestion's direct author (`lib/ingest/direct-author.mjs`), which writes KNOWLEDGE wires from documents, a different job.

The archived modules import their old siblings by relative path, so they do not run from this folder as they are. To consult a working copy, check out the commit before the archive move.
