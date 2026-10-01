# Translate, then formalize (eval-translate-then-formalize-v1): summary

**Status:** stopped early on 2026-09-29 at about 12:25 UTC, by the owner's decision D1. The small model will no longer translate: it normalizes content words, and the host translates them with dictionaries. Every number below is **CPU** (llama.cpp or transformers, 8 threads, GPU hidden). The **formalizer is the fine-tuned SmolLM2-360M, Q8_0**. The comparator **T0** is the same formalizer given the message as written.

- **Preregistration:** `status/preregistrations/eval-translate-then-formalize-v1.json`, which records five deviations.
- **Machine results:** `results.json`, `examples.json`, `examples-T4-ood-stage300.json`, and `smollm2-360m/*.comparison.json`.
- **Harness:** `tools/research/translate-eval.mjs` and `training/python/translate_marian.py`.
- **Grade:** experiment-grade, with one seed, greedy decoding and no human review.

## Question

Would the small fine-tuned formalizers do better on Romanian and mixed messages if the host first translated the message into English?

**Answer: no.** The small base LLMs cannot translate, and they destroy the message. A dedicated MT model (Opus-MT) translates well and fixes exactly the Romanian vocabulary failures, but it also changes names and code-switched English, so the net effect is zero on OOD and harmful on the in-distribution test. **Do not add a translation pre-step.**

## Results (SmolLM2-360M formalizer; RO and mixed rows only)

Each cell gives the direct score (T0), then the translated score, then the delta in points with its 95% paired cluster-bootstrap interval and the number of rows helped and hurt.

| Translator | OOD tolerant exec. | formalizer-v1 sample, tolerant exec. | Wild accepted match | Wild decision match | Name fidelity of translation |
| --- | --- | --- | --- | --- | --- |
| T1 Gemma 3 270M-it base (786 / 400 / 455 rows) | 20.7% → 4.1%, **−16.7** [−19.9, −13.5], +3/−134 | 71.8% → 11.5%, **−60.3** [−65.2, −55.3], +1/−242 | 7.5% → 11.0%, +3.5 [+1.1, +5.9] (an artifact, see below) | 83.3% → 42.4% (−40.9) | 0.30 (OOD), 0.19 (v1) |
| T2 SmolLM2-360M-Instruct base (all rows) | 20.7% → 5.5%, **−15.3** [−18.4, −12.1], +7/−127 | 71.8% → 14.5%, **−57.3** [−62.2, −52.5] | −0.4 [−3.1, +2.0] | 83.3% → 62.6% (−20.7) | 0.55 / 0.46 |
| T4 Opus-MT roa→en, stage 300 (OOD, wild) and stage 100 (v1) | 20.7% → 20.7%, **0.0** [−5.6, +5.7], +33/−33 | 68.0% → 43.0%, **−25.0** [−37.4, −12.0], +10/−35 | 7.7% → 10.3%, +2.7 [+0.7, +5.0] | 83.7% → 85.7% | 0.68 / 0.69 |

Detector routing (the variant that translates only when a simple Romanian detector fires) lessens the harm but does not remove it. For T1 it gives −10.7 [−13.3, −8.1] on OOD and −51.0 on the v1 sample. The detector routes 93% of Romanian rows, 64% of mixed rows and 1.2% of English rows on dev.

**The T1 gain on wild is an artifact.**
- All 24 "helped" rows are cases where Gemma answered "Please provide the text you would like me to translate". The formalizer then emitted `unclear no_request`, which happens to match the golds of short fragments such as "dar duminica?".
- Decision match halves (83% → 42%).
- Stated-value anchoring falls from 0.54 to 0.43.

For T4, 8 of the 10 wild rows it helped are also `no_request` fragments. Those gains are plausibly genuine: "but Sunday?" is correctly read as not being a request.

**Stopping rule.** The owner added a sequential rule for T4: stages of 100, then 300, then all rows, stopping on efficacy or harm beyond 2 points, on futility, or on a broken condition.
- **v1 sample** at stage 100: harmful, −25 [−37, −12], so it was stopped.
- **OOD** at stage 300: still ambiguous, 0.0 [−5.6, +5.7].
- It was then stopped by owner decision D1, before the full set.

## Examples

**Base LLMs (T1/T2):** they answer, refuse or invent instead of translating.
- "Poți să verifici dacă Shirin are un post la Tipografia Delta?" → "Yes, I can verify if Shirin has a post on Tipografia Delta."
- "Cred că Zoltán pleacă la Bălți. Oare pleacă la Bălți?" → "Yes, Zoltán is currently in Bălți." (the question became an assertion)
- "Presupunem că Larisa se ocupă de baza de date de salarizare…" → "Larisa is a data analyst. Florica has a data warehouse." (meaning changed)
- "Ok, la ce eveniment e prrezentă Rubina, te rog?" → "Okay, I'm ready. Please provide the text you want me to translate."
- T2: "Verifică, te rog, dacă Seo-yeon Choi nu e autoarea cărții Iarna în Maramureș." → "Verify, you are, if you are a driver of the Iarna car in Maramureș."

**Opus-MT helps** on exactly the vocabulary failure diagnosed in formalizer-size-v1:
- "Oare Katrin cultivă lavandă?" → "Does Katrin grow lavender?". The direct output was `raise … "the garden"`; the translated one is `grow … "lavender"`, which is correct.
- "„Emma Taylor cultivă ardei” — se confirmă?" → "grows peppers". The direct output was "the arbor".
- "Fără să-l pun la socoteală pe Botond, oare cine e membru în corul de tineret?" → `be a member of "the youth choir"`. The direct output was "the tennis club".

**Opus-MT hurts** by changing names and code-switched English:
- "Galați Philharmonic" → "Galatii Philharmonic".
- "Bogdan-Ionuț" → "Bogdan-Ionut", losing its diacritics.
- "Tipografia Delta" and "Nordwind Systems" are translated on dev.
- "pls find out what Megan leases" → "what Megan reads".
- "Ai idee which venue Kavya cooks at?" → "what Kavya cooks came up with".
- "until what date did Ovidiu go…" → "how much did Ovidiu go…". The direct output was `measure end`; the translated one is `measure cost`.

**Name fidelity.** This is the share of gold role values with a capital letter, as written in the message, that appear verbatim in the translation.
- T4: 0.66–0.72, against the preregistered bar of ≥ 0.90.
- In the formalizer's output (v1), names survive in 94% of direct outputs but only 55% of outputs after translation.

## Latency (CPU)

**Translation per message:**

| Translator | Mean | p50 | p95 | Setup |
| --- | --- | --- | --- | --- |
| T1 Gemma | 0.49 s | 0.28 s | 1.0 s | 4 slots, 8 threads |
| T2 SmolLM2-360M | 1.43 s | 0.45 s | 5.1 s | same |
| T4 Opus-MT | 1.23 s | 0.73 s | 2.2 s | 40-row single-message sample, 8 threads |

T4 batched throughput was about 4–8 messages/s.

**Direct SmolLM2-360M formalization** (v1 sample, same machine and settings) took a mean of 2.8 s and a p50 of 1.0 s. A translation pre-step therefore adds roughly 20–50% to mean end-to-end latency. The CPU was shared with other jobs (load average 8–15), so these figures are relative, not absolute.

## Decision rule and recommendation

The preregistered rule requires all of: a positive OOD delta with an interval excluding 0, v1 and wild deltas that are not significantly negative, and name fidelity ≥ 0.90. **Every translator fails it.**
- T1 and T2 are **harmful**.
- T4 shows **no measurable OOD benefit**, is harmful on the in-distribution test, and has name fidelity of about 0.68.

**Recommendation: do not add a whole-message translation pre-step, with any of these models.** The useful signal is lexical: Opus-MT gets "ardei → peppers" right. That is consistent with owner decision D1, where the host translates normalized content words with dictionaries or MT, word by word. Names, quoted text and English spans are then never touched.

## Deviations and incidents

1. **Scope correction.** On the owner's correction, Qwen3-0.6B was removed before any output was produced.
2. **SmolLM2-135M dropped.** The SmolLM2-135M formalizer arm and the SmolLM2-135M base translator were not run, by the owner's decision to stop the base LLMs.
3. **Model substitution.** `Helsinki-NLP/opus-mt-ro-en` does not exist on the Hugging Face hub, so `Helsinki-NLP/opus-mt-roa-en` (Apache-2.0) was used instead.
4. **GPU refused.** The owner asked for GPU bulk inference, but the local permission system refused GPU access while training owns the GPU. Everything ran on the CPU.
5. **Timeouts.** SmolLM2-360M after T2 had 4 request timeouts (300 s); they are counted as failures.
6. **Rerun control.** SmolLM2-360M T0 on the v1 sample matched formalizer-size-v1 `sample500` byte for byte on 43 of 44 overlapping rows.
7. **Wrong server signalled.** While stopping its own servers, this agent also sent SIGTERM to PID 1390852, a llama-server on port 18851 that belonged to another agent. A new server on that port was running shortly afterwards. All of this agent's own servers are stopped.
