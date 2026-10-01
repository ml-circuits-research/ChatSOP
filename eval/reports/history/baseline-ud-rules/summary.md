# Symbolic formalizer baseline: Stanza + UD rules (`baseline-ud-rules-v1`)

Study of 2026-09-29. No training was run.

**Owner's idea.** "Is there any reasonably mature NLP system we could compare on our suite? We bring it in, wrap it, and treat it like an LLM: parse the text, then translate the parse into SOP Lang with code we write ourselves." It should handle English at least, and Romanian if possible.

- **Preregistration:** `status/preregistrations/baseline-ud-rules-v1.json`. The rules were frozen on the dev split before any sealed row was touched.
- **Registry entry:** `status/experiments.json`.
- **Follow-up study** on rewriting before the rules: `eval/reports/current/rewrite-symbolic/summary.md` (`eval-rewrite-symbolic-v1`).

## 1. What was built

- **Parser.** Stanza 1.10.1 (Stanford NLP Group, Apache-2.0), in the host venv `~/nlp-venv` with torch 2.14 cu130.
  - English: default package with tokenize, mwt, pos, lemma, depparse and ner.
  - Romanian: RRT package with tokenize, pos, lemma and depparse. Stanza ships **no Romanian MWT or NER model**, so Romanian runs without named entities.
  - The worker (`training/python/ud_parse_worker.py`) splits the message into sentences. It labels each sentence EN or RO from function words and lower-case diacritics, with a tie going to the message language. Each sentence is parsed with its own language's pipeline, so a mixed message is handled sentence by sentence.
  - It also flags words that are missing from the tagger's pretrained vocabulary; this is the gibberish signal.
- **Converter.** `lib/ud-to-sop/` holds deterministic JavaScript (`analyze.mjs`, `emit.mjs`, `index.mjs`, `lexicon.mjs`, `tree.mjs`, `labels.mjs`, `protect.mjs`) and needs no lexicon, ontology, context or clock. It emits the **current SOP Lang** of the repository parser:
  - **Clauses and wires.** One finite clause becomes one wire. A declarative clause becomes `stated`: `hedged` under "I think"/"cred că" or "probably", `supposed` in if/unless/so-that clauses or under "suppose"/"să presupunem", and with `speaker` for "X says that …". A question becomes `query`:
    - wh-words give `?x` with `select`, "why" gives `mode explain`, "how many" gives `mode count`;
    - when/since when/until when/how long give `role time ?t` plus `measure`, and how many times gives `mode count` over `?t`;
    - "all/every/toți/fiecare" gives `mode every` (with `quantifier not_all`/`most`/`at_least N`), and "is there anyone who…"/"e vreun om care…" gives `mode exists`;
    - "over 40"/"peste 40" gives `compare`, "the most" gives `rank`, "besides X"/"fără X" gives `except`, "X or Y?" gives one query per option, and "before X did" gives `order`.
  - **Relations and roles.** The relation is the predicate lemma plus modal, particle, preposition or light noun: "work at", "lucra la", "take part in", "ține ore de". The message language is kept (owner decision D1). Roles:
    - subject, object and recipient come from nsubj, obj and iobj; the other roles come from `obl` by preposition class and NER;
    - validity or the query period comes from temporal obliques and dates;
    - polarity comes from not/never/nu, with "nu cumva" treated as a question particle.
  - **Links between clauses.** An adverbial clause is linked with the conjunction line (`because $s2`, `if $s1`, `after $s2`, `so $s1`) and `$id` role values. A relative clause becomes a shared-variable match block in a question, or a second statement that repeats the head noun (C9). Remarks about the user's own plans (C4) are dropped.
  - **Values and unparsed spans.** Every value is a **verbatim span of the message**; "the user" is used for the first person (Q-LANG-5). What the rules cannot place becomes an **`unparsed` wire** (`span`, `near $id`, `hint`).
  - **Admission.** Every output goes through `parse` + `checkModelProgram` + `compileDeclarative`. A rejected wire is dropped and logged, never re-invented.
- **Wrapper.** `tools/eval/ud-baseline.mjs serve` exposes the llama.cpp `/health` and `/v1/chat/completions` interface, so `lib/formalizer-endpoint.mjs predictMessage` calls it like a fine-tuned model.
  - In the chat it is the registry entry `ud-rules`, labelled "Stanza + rules (symbolic baseline)", with `capabilities: ["formalize"]`. It is backed by a new `service` model kind in `server/formalizers.mjs`, which starts, reuses, idles and stops it like a GGUF model, on the CPU with the GPU hidden.
  - It was checked live with the manager: 6 s to ready, then 70–800 ms per message.
- **Tests.** `tests/ud-to-sop.test.mjs` replays recorded parses (`tests/fixtures/ud-to-sop/parses.json`), so no Python is needed. `tests/formalizers.test.mjs` covers the service kind.

## 2. Results (preregistered, frozen v1 rules)

All systems were scored with the **current** harness on the same rows. Comparator predictions are the stored ones, re-scored.
- "Tolerant" is `eval/run.mjs` `execution_equivalence_tolerant`: the row world, its Romanian labels, and the evaluation-only relation synonyms `eval/relation-synonyms.json`. No other lexicon is used.
- The suites are still in the old gold format (a follow-up converts them), so string metrics count Romanian lemmas and `unparsed` wires as misses.
- The D1-tolerant columns compare relations and values through `sop/dictionary.mjs` `sameMeaning` and ignore `unparsed` and link lines.

| Set (rows) | Metric | UD rules | SmolLM2-135M | SmolLM2-360M | Haiku (no thinking) |
| --- | --- | --- | --- | --- | --- |
| OOD sample (500) | tolerant exec | **20.8** | 32.6 | 47.6 | 49.8 |
| OOD, English (287) | tolerant exec | 20.2 | 50.9 | 70.4 | 57.8 |
| OOD, Romanian (213) | tolerant exec | **21.6** | 8.0 | 16.9 | 39.0 |
| Test sample500 | tolerant exec | 28.8 | 77.8 | 80.6 | – |
| Test Haiku sample (500) | tolerant exec | 22.0 | 57.4 | – | 36.0 |
| Test sample500 | wire F1 | 0.24 | 0.67 | 0.82 | – |
| OOD sample (500) | wire F1 | 0.25 | 0.27 | 0.49 | 0.63 |
| Test Haiku sample (500) | wire F1 | 0.29 | 0.60 | – | 0.59 |
| Wild (796) | accepted match | 5.0 | 7.3 | 9.5 | 16.1 |
| Wild (796) | decision match | 73.0 | 81.5 | 83.9 | 59.3 |
| Wild (796) | proposition F1 | 0.476 | 0.569 | 0.557 | 0.541 |
| Wild, English (341) | proposition F1 | **0.604** | 0.631 | 0.610 | 0.628 |
| Wild (796) | invented values (share of quoted values not anchored in the message, dictionary-tolerant) | **0.6%** | 40.0% | 26.0% | 18.1% |
| Wild, English | invented values | **0.2%** | 19.4% | 7.1% | 3.8% |
| OOD (500) | invented values | **0.1%** | 8.4% | 3.2% | 1.5% |
| Wild (796) | outputs with an unparsed wire | 59% | – | – | – |
| All sets | parse validity (repository parser) | **100%** | 99.6–99.8% | 99.6–100% | 97.8–98% |

**Paired differences** are UD rules minus the comparator, with a cluster bootstrap 95% CI:
- **OOD vs 135M:** -11.8 [-16.7, -7.0] overall; English -30.7; **Romanian +13.6 [+7.5, +19.5]**.
- **OOD vs 360M:** Romanian +4.7 [-2.8, +11.7].
- **Test vs 135M:** -49.0 [-54.1, -43.9].
- **Wild, English proposition F1:** vs 135M -2.6 [-7.2, +1.9], vs 360M -0.5 [-5.2, +4.2], vs Haiku -2.4 [-7.5, +2.6]; none of these is decisive.

**Wild decision match vs Haiku:** +13.7 [+9.2, +18.3]. Haiku marks many real questions as no_request.

The wild scorer's "parsed" is 97.1% for the rules. All 23 unreadable rows are `fragment follow_up` queries without a relation; the repository parser accepts them, but the wild scorer's summarizer cannot read them.

**Hypotheses:**
- **H1** (OOD ≥ 135M): **refuted**, already at stage 100.
- **H2** (test ≥ 20 points below 135M): **supported**.
- **H3** (small distribution gap): **supported**. The rules lose 8.0 points from test to OOD [-13.2, -2.6]; SmolLM2-135M loses 45.2.
- **H4** (invention below 2% and lowest): **supported**.
- **H5** (Romanian OOD above both SmolLM2 models): **partly**. It holds against 135M but is inconclusive against 360M.

**Latency** (60 wild messages, sequential parse and convert):
- GPU: p50 **38 ms**, p90 86 ms.
- CPU: p50 **217 ms**, p90 499 ms.
- Model load: about 5 s.
- Bulk on the GPU: under 15 s per 500 messages.

**Staging.** The runs went 100, then 300, then full, per the preregistration. Stage 100 already decided H1 and H2. The full sets were run as declared in advance, because each costs seconds and the error analysis needs every row.

## 3. Deviations: later rule versions (exploratory)

- **D1 — `ud-rules-v1.1`.** At the coordinator's request, the rules gained a DS022 simple-text label layer (`labels.mjs`: Maybe/Suppose/says/Assumption/And/Count/Except/Condition/Rank/Order/Group+Check/Options/Ambiguous/Number, in EN and RO) and a few general rules. These were developed on dev and on dev oracle text only.
- **D2 — `ud-rules-v1.2`.** Two bug fixes found by the tests.

The frozen v1 numbers above stand. The later versions are:

| Run | Test (100, simplifier sample) raw → oracle text | OOD (100) raw → oracle | Wild accepted raw → oracle | Wild proposition F1 raw → oracle |
| --- | --- | --- | --- | --- |
| before v1.1 (simplifier study, earlier converter snapshot) | 0.20 → 0.32 | 0.12 → 0.35 | 0.035 → 0.067 | 0.481 → 0.672 |
| v1.1 | **0.33 → 0.46** | **0.21 → 0.44** | **0.051 → 0.127** | 0.475 → **0.714** |

- The v1.2 re-run of the four preregistered full sets (`runs/ud-rules-v1.2/`) gives raw numbers equal to v1 within 1 point: OOD 21.0, test 28.6, wild accepted 5.2. It has fewer unparsed outputs: OOD 44 → 37%, wild 59 → 55%.
- On dev, oracle simple text reaches 57% and 54% tolerant exec, against 40% and 35% on the raw messages.

**Oracle-renderer issues** seen on dev, for the simplifier study:
- doubled prepositions ("locuiește în în Pune");
- "how" questions rendered as "Ce …";
- how-many-times rendered as "When …";
- value questions rendered as "What is X old?".

## 4. Error analysis

Details are in `error-analysis.json`.

**What the rules miss.** Exec by question type, test sample500 (rules / 135M):

| Question type | Rules | 135M |
| --- | --- | --- |
| universal | 0% | 100% |
| numeric (constraint) | 0% | 100% |
| ambiguous | 0% | 75% |
| multi | 10% | 25% |
| wh | 19% | 81% |
| yes/no | 28% | 78% |

Types the rules do well:

| Question type | Rules | 135M |
| --- | --- | --- |
| claim_check | 80% | 90% |
| none (statements only) | 78% | 67% |
| until_when | 67% | 67% |

The causes, in order of weight:

1. **Gold conventions that cannot be known without a lexicon.** Property predicates pack the object into the relation ("have a valid certificate", "be eligible for the bonus", "get the flu shot"), the role inventory is per predicate (visit → destination, "plan to study" → topic), and relation wording differs ("go back to" vs "be refunded to").
2. **Parser errors on noisy and code-switched text.**
   - Typos turn verbs into nouns ("Which property that X owns costs the most": costs → NOUN).
   - Romanian RRT mis-attaches copular passives ("a fost festivalul … amânat") and titles ("Iarna în Maramureș").
   - "Pune" is read as the verb *a pune*.
3. **Constructs without a rule.** Arithmetic constraints, `unclear ambiguous` (the rules never judge ambiguity), superlatives by adjective ("the oldest"), multi-statement long messages (wild G01/G02 proposition F1 0.04/0.10), and conditionals and hypotheticals over several questions.
4. **Romanian content words.** Relations stay lemmas under D1. They execute when the row world's Romanian labels or aliases cover them, and fail otherwise. Only an 8-point gap separates EN and RO OOD (20.2 vs 21.6), whereas SmolLM2 collapses on Romanian.

Unparsed spans on wild: 964 spans in 470 of 796 outputs.

| Cause | Spans |
| --- | --- |
| unmapped `obl` | 197 |
| clauses with no recognisable proposition | 176 |
| adverbs | 122 |
| nmod | 119 |
| numbers | 77 |

Hints: other 608, object 271, relation 41, time 32.

**What the rules get right where the models fail** (exec or proposition F1 better than the comparator):

| Set | vs 135M | vs 360M | vs Haiku |
| --- | --- | --- | --- |
| OOD | 50 rows (38 Romanian) | 44 (36 Romanian) | – |
| Wild | 79 rows (53 English) | – | 105 |

The rules never corrupt a name, never invent an entity and never drop a negation that the parse shows.

## 5. Fallback and repair: a component, not a formalizer

**Gold-free fallback.** Keep the model's output unless it fails to parse or carries a quoted value not anchored in the message (dictionary-tolerant). In that case, use the rules' output. The selection uses no gold. This is exploratory and was not preregistered.

| Model | OOD tolerant exec | Test sample500 | Wild proposition F1 |
| --- | --- | --- | --- |
| SmolLM2-135M | 32.6 → **35.0** (107 fallbacks) | 77.8 → **79.8** (53) | 0.569 → 0.552 (396 fallbacks: too many on wild) |
| SmolLM2-360M | 47.6 → **49.8** (63) | 80.6 → **81.4** (25) | 0.557 → 0.536 |
| Haiku no-thinking | 49.8 → **50.6** (43) | – | 0.541 → **0.595** (237) |

The best-of-two oracle is the ceiling: OOD 42.6 / 56.4 / 55.8 and wild 0.64 for the three comparators.

**Conclusion.**
- As a formalizer, the symbolic path is far below the fine-tuned models in distribution. It is below them on OOD English, but at or above SmolLM2 on OOD Romanian.
- It is **the most honest system measured**. Its values come verbatim from the message, parse validity is 100% and the invention rate is under 1%. It also degrades little between distributions.
- That makes it useful as a **host repair and fallback component** rather than a replacement:
  1. Use its verbatim spans and names to repair `unparsed` spans and placeholder values of the small model. The rules' role and preposition classifier and its date and number spans are ready-made repair functions.
  2. Cross-check a small model's output. A model value that is absent from the message and absent from the rules' spans is the invention signal; fallback on that signal gains 1–2 points on OOD and test.
  3. As a Romanian safety net: fall back to the rules where the model's Romanian output invents or translates names.
- The oracle-text ceiling (0.44–0.46 exec on OOD and test at stage 100, wild proposition F1 0.71) bounds what a perfect simplifier in front of the rules could give. The rewrite study shows that off-the-shelf rewriters and Haiku do not get there.
