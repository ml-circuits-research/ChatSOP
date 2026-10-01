# Grammar-constrained decoding (eval-grammar-constrained-v1): summary

**Status: DONE, stopped early for futility (2026-09-29).** Preregistration: `status/preregistrations/eval-grammar-constrained-v1.json`. Machine summary: `summary.json`. Per-cell results: `<model>/<cell>[.<condition>].results.json`. Raw predictions: `work/`.

## Answer

**Grammar-constrained decoding does not make the small fine-tuned formalizers more accurate.** It guarantees syntactically valid output, at little or no speed cost.

- The primary metric was unchanged in all six cells: tolerant execution equivalence on OOD and on the sealed-test sample, and accepted match on wild. The paired delta was 0 in every cell (95% interval [0, 0], 100 rows each), so every cell stopped for futility after stage 1 under the owner's rule.
- Parse validity rose on wild: 135M from 94% to 99%, 360M from 95% to 100%, a gain of +5 pp [+1, +9] for each. Elsewhere it was already 99–100%.
- **All 10 outputs the grammar repaired stayed wrong** (5 per model on wild, 1 on 360M OOD). The grammar produces a well-formed program; it cannot supply the missing content.
- Wild decision match rose: 135M +4 pp [0, +9], 360M +5 pp [+1, +10]. The repaired outputs now at least have the right top-level shape.

**Why the gain is capped:** with greedy decoding, llama.cpp keeps the unconstrained argmax whenever the grammar allows it. So a constrained run can differ only on outputs the grammar rejects. The ceiling (`ceiling-parser-strings.json`, full suites, the formalizer-size-v1 CPU predictions) is the share of such outputs: 5.4–7.7% of wild outputs, 0.3–0.4% of OOD and 0–0.1% of the sealed test, and almost all of them are parse failures.

## Recommendation for the host

- **Do not expect accuracy from the grammar.** Invest in data, as the size study concluded.
- **Decoding with the grammar is safe to turn on as a validity guard**, with one condition: it must accept every output the parser accepts, or it forces the model onto different words.
- The canonical grammar rejects strings with a leading blank (`relation " plant"`). SmolLM2 emits these as a separate token on about 10% of OOD rows. Forbidding them changed 10–14 of 100 OOD outputs, sometimes into other content (`" plant"` became `"give classes in"`), with no net effect on the primary metric.
- The parser-faithful variant (`--strings parser`, the exploratory `gbnf-lax` condition) changed only the rows that were invalid anyway.
- Remaining work, owned by the language change already announced: regenerate the grammar for the new language, and make field and role order parser-faithful too. Until then, host validation plus the `unclear` fallback does the same job.

## Tables (stage 1, 100 stratified rows per cell, GPU, sequential requests, no prompt cache)

| Model | Cell | Primary (free → gbnf) | Parse | Compile | Identical outputs | Repaired / still wrong |
| --- | --- | --- | --- | --- | --- | --- |
| 135M | wild | accepted 8% → 8% | 94% → 99% | 94% → 99% | 92% | 5 / 5 |
| 135M | OOD | tolerant exec 27% → 27% | 100% → 100% | 96% → 95% | 86% | 0 |
| 135M | test500 | 80% → 80% | 100% → 100% | 98% → 98% | 100% | 0 |
| 360M | wild | accepted 13% → 13% | 95% → 100% | 95% → 98% | 94% | 5 / 5 |
| 360M | OOD | 42% → 42% | 99% → 100% | 98% → 99% | 89% | 1 / 1 |
| 360M | test500 | 84% → 84% | 100% → 100% | 99% → 99% | 99% | 0 |

- The A/A control `free-aa` repeated the free run in the same session and was identical on 100/100 rows in all six cells.
- The exploratory `gbnf-lax` variant was identical to free except on invalid rows (93–100%).
- The per-language slices are in `summary.json`. Wild parse validity reached 98–100% in English, Romanian and mixed alike.

**Speed.** Measured with the CPU only (`-ngl 0`, CUDA hidden, 5–6 threads, 1 slot, 40 test messages, each run twice in ABBA order, on a machine shared with other agents' jobs):

| Model | Median paired latency ratio (gbnf/free) | Median ms-per-token ratio | Generation tokens/s p50 (free → gbnf) |
| --- | --- | --- | --- |
| 135M | 1.19 | 1.17 | 339 → 296 |
| 360M | 1.00 | 0.99 | 119 → 120 |

On the GPU (single requests), the median latency moved by less than 5%. The grammar costs a fixed amount of CPU time per token, so it shows only when the model itself is very fast.

## Deviations and validity notes

- **D1.** Parallel slots made greedy outputs depend on the batch: identical free runs differed on 6–7% of rows. Requests were therefore sent one at a time.
- **D3.** llama-server's prompt cache made outputs depend on the request history: 135M outputs differed on up to 33% of wild rows across server sessions. The cache was turned off (`cache_prompt: false`), and the A/A control then matched 100/100. The earlier runs are kept under `superseded-8slots/` and `superseded-prompt-cache/`; every superseded run also stopped for futility.
- **D2.** The CPU speed sample was rerun with two ABBA repetitions and median statistics, because one long message in the first single-pass run was slowed by the shared load. That run showed a 1.50× mean latency, which disappeared on repeat; it is kept under `superseded-cpu-v1/`.
- The GPU free outputs match the formalizer-size-v1 CPU predictions on only 66–94% of rows, depending on the cell. Only same-session GPU pairs are compared.
- The tolerant-execution scorer flipped once under heavy CPU load: one rescore gave 37% instead of 42% for identical outputs. The numbers above were confirmed by rescoring.
- Single seed, greedy decoding, experiment-grade.

## Examples

- **Repaired but still wrong** (wild, 360M): the free output had parse errors. The constrained output parses, but it formalizes the same wrong reading, for example `except ?x "Hamburg"` plus unrelated queries for a VAT question.
- **Forced a different completion** (OOD, 135M, `ood1_000012_0_0`, observed in a superseded session; the same mechanism accounts for the 14 changed valid outputs of the main 135M OOD cell): free wrote `relation " plant"` with a leading blank, which the parser accepts. The canonical grammar forbade the blank token, and the model continued with `"give classes in"` / `"Spanish"` instead of `"plant"`. Both outputs were wrong.
- No row was turned from right to wrong, or from wrong to right, in any main cell.
