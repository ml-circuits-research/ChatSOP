# Small-talk collections: evaluation (eval/smalltalk-v1, 40 messages)

Judge run: state/llm-jobs/smalltalk-judge/20261003T141241-406537. Scores 1-5 (auditor tier, blind). before = B of an earlier system version (judge-input --before); A = conversation-v1 alone; B = with the default collections; C = B with the message label as an oracle pragmatic signal.

| Arm | n judged | relevance | tone | naturalness | honesty | brevity | mean |
|---|---|---|---|---|---|---|---|
| before | 40 | 3.33 | 3.20 | 2.88 | 4.92 | 3.67 | 3.60 |
| B | 40 | 4.15 | 3.77 | 3.77 | 5.00 | 4.38 | 4.21 |
| C | 40 | 4.10 | 3.77 | 3.73 | 5.00 | 4.38 | 4.19 |

B - before: mean difference 0.61 over 40 paired messages, 95% paired bootstrap [0.31, 0.93]; 26 better, 12 worse, 2 equal.
C - before: mean difference 0.59 over 40 paired messages, 95% paired bootstrap [0.30, 0.91]; 26 better, 12 worse, 2 equal.

| Category | before | B | C |
|---|---|---|---|
| greetings | 4.10 | 3.80 | 3.80 |
| farewells | 5.00 | 4.80 | 4.80 |
| thanks | 4.80 | 5.00 | 5.00 |
| apologies | 5.00 | 4.20 | 4.20 |
| how are you | 3.20 | 4.70 | 4.70 |
| weather | 3.00 | 4.00 | 4.00 |
| weekend and plans | 2.40 | 3.00 | 3.00 |
| hobbies | 2.40 | 3.80 | 3.80 |
| sport | 2.80 | 2.80 | 2.80 |
| compliments | 3.30 | 4.60 | 4.20 |
| jokes and riddles | 3.13 | 4.73 | 4.73 |
| empathy | 4.73 | 4.65 | 4.65 |
| self | 2.97 | 4.20 | 4.20 |
| opinion and advice | 3.60 | 4.20 | 4.20 |
| off-topic and adversarial | 2.95 | 3.80 | 3.80 |
| clarification and repair | 3.27 | 3.47 | 3.47 |

## Provenance (2026-10-03, smalltalk-acts agent)

- `before`: `node tools/eval/smalltalk/run.mjs turns` at commit 0ab0f1d (step-by-step on the product ladder tiny > small > good; tiny = Qwen3.6-35B-A3B), arm B (conversation-v1 and the four default collections; the formalizer could name only the 22 closed kinds).
- `B` (after): the same command on the P-2 change (message acts as reply-memory data, asked coarse then fine; default reply memory now with smalltalk-professional-v1), `--arms B`.
- `C`: B with the message's label added as an oracle signal (unchanged definition): B now equals the oracle-signal ceiling within noise.
- Judge: jobs/smalltalk-judge (tier `medium`, blind, hashed ids, identical replies judged once), the rubric of 2026-10-02; `judge-input --before`.
- Chat-slice regression on tiny, same session (tools/eval/formalization-regression, runs acts-before-2026-10-03 and acts-after2-2026-10-03): commonsense 17/32 -> 20/32 (wrong 3 -> 2), small talk 29/40 -> 37/40 under its loose criterion.
