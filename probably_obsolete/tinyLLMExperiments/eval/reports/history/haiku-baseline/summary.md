# Prompted Claude Haiku: REFERENCE BASELINE and evaluation-validity review

**REFERENCE BASELINE.** This is not a preregistered arm (there is no DS010 record), not a fine-tuned model and not a product configuration. It answers two owner questions:

1. How does a strong general model that is *only prompted* with the SOP Lang rules score on our suites, compared with the fine-tuned small models?
2. How much of each "failure" is the model's fault, and how much is the evaluation's?

| Item | Value |
| --- | --- |
| Model | `claude-haiku-4-5-20251001` through Claude Code headless: `claude -p --output-format json --tools "" --system-prompt … --setting-sources "" --strict-mcp-config`, run in a scratch working directory with no tools |
| Date | 2026-09-29 |
| Headline condition | **`haiku-nothink`**: extended thinking off (`MAX_THINKING_TOKENS=0`; every call reported `thinking_tokens = 0`). Owner decision: the task is meant for a small model, so a thinking model is not the fair comparison. |
| Secondary condition | `haiku-thinking`: the Claude Code default, extended thinking on. It covers the full wild suite and 150-row stratified subsamples of the two 500-row samples (ids in `sample-ids.json`, `thinking_subsample`). |
| Prompt | `prompt.txt`, sha256 `0cc0e4657746322f26e50569cbf5d9564cdaa43cbba63466d0a5ed65569d5fc9` (15,974 characters). It contains `server/prompts/formalizer.txt` verbatim, the DS021 conventions C1–C12 and the question-form notes (condensed), one well-formedness line, and 15 few-shot rows taken only from `datasets/formalizer-v1/train.jsonl` (ids in `prompt.json`). The user turn is the message alone: no world, gold, ids or shortlist. |
| Discarded calls | A first prompt version had no well-formedness line. It was discarded after 108 calls; those calls are kept in `cache-prompt-v0/` and are not scored. |
| Harness leak | Claude Code adds a short preamble to the system prompt: environment details and today's date. The model therefore sees a date, which DS021 forbids for the product model. No reviewed row depended on it. |
| Sets | The full `formalizer-wild-v1` suite (796 rows). A stratified 500-row sample of the `formalizer-v1` sealed test: 375 messages of at most 300 characters and 125 longer ones, stratified by language within each group. A 500-row sample of `formalizer-ood-v1`, stratified by language. Seed 42; the ids are in `sample-ids.json`. |
| Scorers | The same scorers as for the small models. `eval/run.mjs --file` gives canonical match, strict and tolerant execution equivalence, and the reference-free metrics. For the wild suite, `tools/eval/wild-suite.mjs --score` scores against the accepted golds and `eval/run.mjs --messages` gives the reference-free metrics. |
| Comparison | SmolLM2-135M from formalizer-size-v1 (Q8_0, llama.cpp on CPU), on exactly the same rows. Gemma 3 270M had no predictions when this report was written. |
| Reproduce | `tools/research/haiku-baseline.mjs` (`prompt`, `sample`, `predict --condition nothink\|thinking`, `compare`), `run-all.sh` and `score.sh`. Responses are cached per row in `cache-nothink/` and `cache/`. |
| Files | `comparison.json` holds every table, with 95% Wilson intervals and the speed data. `*.predictions.jsonl`, `*.evaluation.json`, `*.wild.json` and `*.reference-free.json` are the scorer outputs. `*.rows.json` holds compact per-row predictions and scores next to SmolLM's. `validity-review.json` holds the manual review. |

## Results (headline: haiku-nothink)

Execution equivalence runs the prediction against the row's verification world. "Tolerant" adds the evaluation-only relation synonyms.

### formalizer-v1 sealed test, 500-row sample (in-distribution)

| | Haiku (no thinking) | SmolLM2-135M |
| --- | --- | --- |
| parse | 97.8% | 100.0% |
| canonical match | 20.0% | 54.0% |
| strict execution | 34.6% | 57.4% |
| **tolerant execution** | **35.6%** [31.5–39.9] | **57.4%** [53.0–61.7] |
| tolerant, EN / mixed / RO | 40.1 / 30.8 / 32.0% | 62.5 / 52.8 / 52.9% |
| tolerant, short (≤300 chars, n=375) / long (n=125) | 46.9 / 1.6% | 76.5 / 0.0% |
| tolerant, hard (n=229) / not hard | 20.1 / 48.7% | 31.4 / 79.3% |
| reference-free: compiles / fully anchored | 96.0 / 68.4% | 90.0 / 51.0% |

Paired tolerant outcome over the 500 rows: 152 correct for both models, 26 only for Haiku, 135 only for SmolLM, 187 for neither.

### formalizer-ood-v1, 500-row sample

| | Haiku (no thinking) | SmolLM2-135M |
| --- | --- | --- |
| parse | 97.8% | 99.6% |
| canonical match | 30.6% | 24.8% |
| strict execution | 48.4% | 31.6% |
| **tolerant execution** | **49.8%** [45.4–54.2] | **31.8%** [27.9–36.0] |
| tolerant, EN / mixed / RO | 64.3 / 30.5 / 38.5% | 54.1 / 23.2 / 4.6% |
| tolerant, hard (n=174) / not hard | 37.9 / 56.1% | 21.3 / 37.4% |
| tolerant, long (n=32) | 37.5% | 0.0% |
| reference-free: compiles / fully anchored | 96.8 / 80.2% | 96.0 / 62.9% |

Paired tolerant outcome: 105 correct for both, 144 only for Haiku, 54 only for SmolLM, 197 for neither.

### formalizer-wild-v1, all 796 rows (accepted golds, no execution)

| | Haiku (no thinking) | SmolLM2-135M |
| --- | --- | --- |
| parsed | 87.7% | 90.7% |
| **accepted match** | **16.1%** [13.7–18.8] | **7.3%** [5.7–9.3] |
| accepted match, ignoring assumed wires | 16.7% | 7.4% |
| shape match | 22.6% | 16.7% |
| decision match (query / constraint / statements / unclear kind) | **58.3%** | **81.4%** |
| proposition F1 / query-block F1 | 0.541 / 0.209 | 0.569 / 0.104 |
| accepted match, EN / mixed / RO | 18.2 / 13.0 / 15.4% | 9.4 / 6.8 / 5.1% |
| accepted match, hard (n=307) / not hard (n=489) | 3.6 / 23.9% | 0.7 / 11.5% |
| reference-free: compiles / question form agrees | 86.8 / 97.0% | 91.2 / 93.7% |

Haiku's low decision match has one dominant cause. It answered **176 gold queries with `unclear kind no_request`**, for example "what time does check-in open at the Hilton Garden Inn Bristol", "plovdiv population" and "what size is a UK 7 shoe in EU sizes". Without thinking, it judges whether the host could answer the question, which DS021 forbids.

Paired accepted match: 50 correct for both, 78 only for Haiku, 8 only for SmolLM, 660 for neither.

### Thinking condition (secondary reference)

| | haiku-thinking | haiku-nothink (same rows) | SmolLM2-135M (same rows) |
| --- | --- | --- | --- |
| wild, 796 rows: accepted match | **19.4%** [16.8–22.3] | 16.1% | 7.3% |
| wild: decision match / shape / proposition F1 | 86.2% / 35.7% / 0.542 | 58.3% / 22.6% / 0.541 | 81.4% / 16.7% / 0.569 |
| wild: accepted match EN / mixed / RO | 24.1 / 14.8 / 16.4% | 18.2 / 13.0 / 15.4% | 9.4 / 6.8 / 5.1% |
| formalizer-v1, 151-row subsample: tolerant execution | **47.0%** [39.2–55.0] | 35.8% (54/151) | 58.3% |
| formalizer-v1 subsample, EN / mixed / RO | 52.1 / 39.3 / 44.2% | | 63.4 / 57.1 / 51.9% |
| OOD, 150-row subsample: tolerant execution | **56.7%** [48.7–64.3] | 43.3% (65/150) | 33.3% |
| OOD subsample, EN / mixed / RO | 67.1 / 64.0 / 38.5% | | 53.4 / 28.0 / 7.7% |

Thinking adds 3 to 13 points. Most of the gain comes from no longer refusing real questions as `no_request`: wild decision match rises from 58% to 86%. Even with thinking, Haiku stays below SmolLM2-135M on the in-distribution sealed test.

### Speed

Haiku timings are wall-clock per headless `claude -p` call, from process start to the JSON result. They include network time and Claude Code start-up and, for `haiku-thinking`, the hidden thinking. They are therefore **not directly comparable** with local CPU inference. The SmolLM2-135M numbers come from `llama-server`: Q8_0, 4 parallel slots, the CPU of the shared GB10 Grace host. Output tokens come from the headless usage and include thinking tokens; the visible SOP length is estimated as characters / 4. Several suites and conditions ran concurrently, so the per-suite wall time is shared time.

| Model / set | latency p50 | p90 | p95 | output tokens p50 (mean) | thinking tokens p50 | output tok/s per call p50 | total time (calls in parallel) | cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Haiku nothink, wild 796 | 2.7 s | 4.4 s | 5.2 s | 62 (106) | 0 | 23 | 403 s (8 parallel); sum of latencies 2,375 s | $1.34 |
| Haiku nothink, formalizer-v1 500 | 2.7 s | 11.2 s | 15.9 s | 79 (385) | 0 | 28 | 316 s (8); sum 2,440 s | $1.66 |
| Haiku nothink, OOD 500 | 2.6 s | 3.1 s | 7.6 s | 55 (147) | 0 | 21 | 202 s (8); sum 1,605 s | $0.96 |
| Haiku thinking, wild 796 | 50.4 s | 103 s | 123 s | 5,222 (5,599) | 5,117 | 97 | about 2 h (8); sum 43,299 s | $23.26 |
| Haiku thinking, formalizer-v1 151 | 15.4 s | 143 s | 177 s | 1,272 (4,914) | 1,222 | 91 | sum 7,121 s | $3.94 |
| Haiku thinking, OOD 150 | 11.8 s | 60.6 s | 86.4 s | 1,043 (2,363) | 964 | 88 | sum 3,648 s | $1.96 |
| SmolLM2-135M, formalizer-v1 short 4,730 | 0.72 s | – | 1.6 s | 49 (55) | – | 70 (server) | 952 s (4 slots) | local |
| SmolLM2-135M, formalizer-v1 long 303 | 28.8 s | – | 83.3 s | 987 (1,160) | – | 34 (server) | 2,748 s (4) | local |
| SmolLM2-135M, OOD 1,578 | 1.2 s | – | 20.4 s | 46 (127) | – | 43 (server) | 1,432 s (4) | local |
| SmolLM2-135M, wild 796 | 1.6 s | – | 7.5 s | 66 (123) | – | 43 (server) | 858 s (4) | local |

The SmolLM2 timing files record p50 and p95 only. `llama-bench` on the base (not fine-tuned) SmolLM2-135M Q8_0 weights (`eval/reports/current/training/cpu-bench-base.json`) measures tg128 generation at 146.9 tokens/s with 1 thread, 283.8 with 4 threads and 318.6 with 10.

## Evaluation validity

### Method

A single reviewer (this agent, with no second annotator) read 60 `haiku-nothink` failures: 20 per suite, stratified 7 EN / 7 RO / 6 mixed, drawn at random among the failing rows. It also read 30 SmolLM2-135M failures on the same sample rows, 10 per suite. Each failure was judged under the **current** DS021 and given one verdict:

- **fn** (eval false negative): the prediction is a correct formalization, and the gold or the scorer rejects it.
- **partial**: the meaning is right, but the prediction breaks an explicit minor convention, or such a break combines with an evaluation cause.
- **genuine**: a model error.

`validity-review.json` holds every verdict with its reason and causes.

### Estimated false-negative rate (the share of failures that are not model errors)

| Suite | Haiku fn (strict) | Haiku fn + partial (lenient) | SmolLM2-135M |
| --- | --- | --- | --- |
| formalizer-wild-v1 | 1/20 = 5% [0.9–23.6] | 3/20 = 15% [5.2–36.0] | 0/10 |
| formalizer-v1 (sealed) | 2/20 = 10% [2.8–30.1] | 4/20 = 20% [8.1–41.6] | 0/10 |
| formalizer-ood-v1 | 4/20 = 20% [8.1–41.6] | 7/20 = 35% [18.1–56.7] | 0/10 |
| all | 7/60 = 11.7% [5.8–22.2] | 14/60 = 23.3% [14.4–35.4] | **0/30 [0–11.4]** |

These rates only roughly change the headline scores, because the intervals are wide. With them, Haiku's tolerant score would be about 6–13 points higher on formalizer-v1 (about 42–49%) and about 10–18 points higher on OOD (about 60–68%). Its wild accepted match would be about 4–13 points higher.

**SmolLM2-135M's low wild and OOD scores are not caused by eval strictness.** All 30 of its reviewed failures were real errors:

- corrupted names ("Palaoma", "Floctice");
- "study at" for "lucrează la";
- invented values;
- role reversals;
- an empty output on a long message.

### Causes of the eval false negatives (21 cause tags on the 14 fn and partial rows)

| Cause | Count | Example |
| --- | --- | --- |
| Relation paraphrase not in the tolerant synonyms | 6 | "se ocupă de" → "take care of" (gold "work on"); "pleacă la" → "go to" (gold "leave for"); "coach" for "train" |
| Value alias or article not linked | 4 | "certificatul de naștere" → "the birth certificate" (gold "a birth certificate"); "corul Madrigal" → "Madrigal" (the world has only "the Madrigal choir") |
| Role choice not fixed by DS021 | 3 | `object` instead of the corpus's `topic` for "want to learn / plan to study X" (239 sealed-test golds use topic, but DS021 defines topic as "about / because of"); destination instead of object for "show up at" |
| First-person drift in the gold | 2 | Haiku writes "the user", as DS021 Q-LANG-5 and the product prompt require; the wild golds write "I" or "my brother" |
| Scorer bug in the execution signature | 1 | Same status and answers, but the gold resolves "domnul Ungureanu" and "Mr Ungureanu" separately, so the output lists differ |
| Agent-guard anchoring rejects a correct translation | 1 | "ședința cu părinții" → "the meeting with parents" is rejected, which voids a faithful 57-statement program |
| Several valid readings, only one accepted | 1 | "Both at once: does A…, and does B…?" written as two yes/no queries; the gold accepts only one conjunctive query |
| Value paraphrase | 1 | "the conference at Alba Iulia" vs "in Alba Iulia" |
| Convention violation (partial) | 1 | "Anglia" translated to "England" |
| DS021 underspecified (contributing cause on a genuine row) | 1 | C8 lists "remind" among the no_request actions, which invites no_request for "remind me who takes care of the school bus" |

### Systematic suite-level findings (counted over the suites, not sampled)

1. **The wild golds predate current DS021 conventions.**
   - First person: 202 of 796 golds write it literally ("I", "my X", "we"), and in 163 rows every accepted target does. No accepted target uses "the user" (Q-LANG-5).
   - Follow-up fragments: 19 of 21 bare fragments ("și la Cluj?", "si anul trecut?") have gold `no_request`. No accepted target uses `fragment follow_up` (Q-LANG-4).
   - Constraints: 23 constraint golds use bounds `0 1000000000` and `claim ?x at_least 0`. The product prompt says to write bounds only when the message gives them.
   - Mapping Haiku's "the user" to "I" alone gains 0 accepted matches, because every such row also differs elsewhere. On real messages, one convention rarely decides a whole-program match. The drift still biases proposition F1, and it teaches the wrong target.
2. **The sealed test translates Romanian titles.** In 191 RO or mixed rows of the `formalizer-v1` test, the gold translates the title ("The Salt Road" for "Drumul Sării"). DS021 rule 5 keeps titles exactly as written. A model that follows the specification is penalized whenever the verification world lacks the Romanian alias. A model trained on the corpus learns the translation, which it cannot do for unseen titles without knowledge.
3. **Whole-program equivalence cannot score long messages.** Both models score about 0% on the long formalizer-v1 rows (Haiku 1.6%, SmolLM 0/125), even when Haiku reproduces most of the 20–66 statements. On these rows the metric measures "any deviation", not quality.
4. **The execution signature counts plumbing outputs.** Some failures differ from the gold only in the list of bound circuit outputs: for Haiku, 3 of 500 formalizer-v1 failures and 6 of 500 OOD failures; for SmolLM, 16 of 5,033 and 6 of 1,578.
5. **The wild scorer's query key has gaps in both directions.**
   - It ignores the words-only lines `compare`, `rank`, `except`, `order`, `quantifier` and `fragment`, so it is lenient on those constructs.
   - It still keys on the retired `filter`.
   - Its constraint key compares the raw arithmetic lines, so it is strict: any other correct spelling of the same computation fails.

## Fix proposals (proposals only; nothing was applied to a sealed suite)

**Gold and accepted-reading corrections**

1. formalizer-wild-v1: convert first person to "the user" and "the user's X" mechanically, as was done for the words-only syntax. Keep the "we" readings as alternatives.
2. formalizer-wild-v1: make `fragment follow_up` the gold for the 19 bare follow-up fragments (Q-LANG-4). Keep `no_request` only where the fragment carries no role.
3. formalizer-wild-v1: in the constraint golds, drop the invented `0 1000000000` bounds and the `claim ?x at_least 0` lines, or accept the prompt-conformant form.
4. formalizer-v1 and OOD, the 191 translated-title rows: either keep the title as written in the gold (DS021 rule 5), or add the Romanian title as an entity alias in the verification world. The alias is the smaller change and also fixes the training signal.
5. Accept two yes/no queries as an alternative for "both at once: A and B?" rows. In the tolerant layer, accept the active paraphrase of a by-agent passive that has the same meaning.

**Synonyms and linking (evaluation layer)**

6. Add to `eval/relation-synonyms.json`, each with the conflict check that `eval/synonyms.mjs` already performs:
   - `maintains` / "work on" ← "take care of", "handle";
   - `coaches` ← "coach", "train";
   - `teaches` ← "teach", for "give lessons in" and "give classes in";
   - `travelled_to` ← "go to" (check the conflict with the "go to" of `studies_at`);
   - `plays_for` ← "be on";
   - the "be issued at" variants.
7. When linking values, fold a leading article ("a", "an", "the") and allow a bare proper-name head ("Madrigal" for "the Madrigal choir"). Do this in evaluation first, then as a host linking improvement.
8. Accept both object and topic as the role of learning relations in tolerant linking, or fix the role in DS021 (item 9).

**DS021 and product prompt clarifications**

9. DS021: state which role holds the subject matter of study or learning ("want to learn X", "plan to study X"). The corpus uses `topic`, while the rules define topic as "about / because of".
10. DS021 C8: "remind me / tell me / can you check" followed by a wh- or yes/no question is that question, not `no_request`. Only a pure action ("remind me to call Ana tomorrow") is `no_request`.
11. DS021: state that "in what period" and "when exactly" use the when form without `measure`, and that `measure` takes exactly one of start, end or duration.
12. `server/prompts/formalizer.txt`: add three rules.
    - Well-formedness: a proposition has 1 to 4 roles; every stated, assumed and match block needs a polarity; a match block has no `valid` line; a query has no `role` line. The first prompt version, which lacked these, produced exactly these errors.
    - A claim check ("True or false:", "Fact-check:", "— se confirmă?") is a query, never a stated.
    - A question about general knowledge, schedules, prices or places is a query: the model never judges whether the host can answer it.

**Scorer bugs**

13. `eval/signature.mjs`: for the formalization track, drop the list of bound circuit outputs, or compare only the bound values. Resolving the same entity in one step or in two should not change the signature.
14. `tools/eval/wild-suite.mjs`: include the words-only query lines in the query key, drop `filter`, and compare constraints by solving them or through a normalized form instead of by their raw lines.
15. `eval/run.mjs`: an agent-guard anchoring rejection of one `stated` value currently voids the whole program. Report anchoring through the reference-free metrics and execute the rest, or widen cross-lingual anchoring so that it accepts correct translations.
16. Report proposition-level precision and recall (`eval/propositions.mjs`) as the headline for long and multi-statement rows, next to whole-program equivalence.

## Conclusions

1. **Prompted Haiku is worse than the fine-tuned 135M model on the task that model was trained for.** On the formalizer-v1 sealed test sample, Haiku without thinking reaches 35.6% tolerant execution against SmolLM2-135M's 57.4%. On short messages it is 46.9% against 76.5%. With thinking, Haiku reaches 47.0% on a 151-row subsample against SmolLM's 58.3% on the same rows. The small model has learned the corpus's relation vocabulary, role conventions and title translations, which the rules alone do not determine.
2. **Haiku generalizes better out of distribution and in Romanian.** OOD: 49.8% against 31.8% (38.5% against 4.6% on Romanian). Wild accepted match: 16.1% against 7.3%. The collapse of SmolLM on Romanian OOD rows is a real generalization failure, not an evaluation artifact.
3. **Most failures are real.** About 12% of Haiku's failures are evaluation false negatives, or 23% if the partial cases are counted; none of SmolLM's reviewed failures are. The evaluation is strict but mostly fair to the small models. It is unfair mainly to models that follow DS021 rather than the corpus: unstated role conventions, translated titles, paraphrases missing from the synonym list, and stale wild-suite conventions.
4. **The wild suite needs one convention refresh before it can be a headline**: first person, follow-up fragments and constraint bounds. Whole-program match on long real messages also needs a proposition-level companion metric.
5. **Speed favors the small model.** SmolLM2-135M on CPU answers a short message in about 0.7 s (p50). Haiku without thinking takes about 2.7 s (p50), including network and CLI overhead, and costs about $0.002–0.003 per message. With thinking, Haiku is about 5–20 times slower (p50 12–50 s) and roughly 10–20 times more expensive than without thinking, for a gain of 3–13 points. A 135M model that understands less but runs locally in under a second remains a reasonable choice for in-distribution traffic. The OOD and Romanian gap is what the small model must still close.
