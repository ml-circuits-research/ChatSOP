# Formalization research directions: critique of the owner's notes and ranked experiment variants

**Archived 2026-10-03.** The code and data this document describes moved to `probably_obsolete/formalization-experiments-2026-10/` (its README gives the final numbers and the path map) when the owner decided to rebuild the formalization infrastructure. Paths below read as they did at the time.

Status: design proposal (planning agent Fable, 2026-10-02 night), answering the owner's request to (1) analyse the two external notes in `owner-notes-2026-10-02-formalization.md` against what ChatSOP does, (2) propose ranked experiment variants for when the current approach (registry + typed tree + dual expressions, `semantic-decomposition-protocol.md`) fails or plateaus, (3) say when to declare it failed. No product code is changed by this document.

## 0. Where we stand (numbers read from the state folders, 2026-10-02)

| measure | value | source |
|---|---|---|
| Book problems end to end, step-by-step on `tiny` (batch 2, 100 fresh) | 27 correct / 28 wrong / 42 unknown; bare 4B 69 / 27 / 4 | `eval/reports/current/books-eval/problem-mode.md` |
| `good` answering the same classic problem questions | 4/20 | same report |
| Offline regression replay (122 cases, `tiny`) | 19 correct, clusters: problem_unreadable 20, deduce_unknown 19, compute_unknown 19, choose_wrong 16, formula_wrong 11 | `state/formalization-regression/replay-2026-10-02/summary.md` |
| Dual formalization s1 (30 numeric-strata problems, `tiny`) | expression path 18/30 (60%), tree 16/30 (53%), either 22/30 (73%); agree 12/30, precision when both agree 11/12 (92%); disagreement flags 9 of 11 wrong tree answers; lowering mismatches 0 | `state/dual-formalization/s1/summary.md` |
| Stage A decomposition (sd1-A `tiny`, sd1-G `good`) | run, not yet scored (28 and 33 rows); `tiny`: 16 supported, 2 refuted, 6 clarify, 5 unclear, 6 to 26 questions per problem; every type-like reading in sd1-A is menu choice `1` (check for menu collapse before scoring) | `state/formalization-regression/sd1-*/results.jsonl` |

Two facts drive everything below. First, one closed question in a restricted expression language already beats the whole question tree on numeric problems, and the two paths are complementary (either = 73%). Second, when two independent formalizations agree, they are almost always right (11/12): agreement is the usable confidence signal the owner asked for.

## 1. The two notes, critically

### 1.1 Verification of the cited systems

| citation in the notes | verified? | what is actually there |
|---|---|---|
| CLOVER, ICLR 2025, "several translation paths, a SAT solver compares candidates" | yes | Ryu et al., *Divide and Translate: Compositional First-Order Logic Translation and Verification for Complex Logical Reasoning*, ICLR 2025 (arXiv 2410.08047, github Hyun-Ryu/clover). CLOVER is the name of that method. The notes list "CLOVER" and "Divide and Translate" as two systems; they are one paper. Verification uses a SAT solver to compare FOL candidates from multiple logical-dependency parses and picks by agreement. |
| Mathesis, ICLR 2026, RL autoformalizer with syntactic, semantic and prover feedback | yes | Huawei AI4Math, *Mathesis: Towards Formal Theorem Proving from Natural Languages*, ICLR 2026. GRPO with Lean syntax, semantic and prover rewards, then DPO (they call it HPO). Lean 4 theorem statements, not word problems. |
| UFAL-CUNI, SemEval-2026 Task 11, a 4B LLM parses syllogisms to FOL for a prover, beats zero-shot LLMs of its class | yes | arXiv 2605.04941: Qwen3 4B Thinking as FOL parser, Prover9 as prover, Gemma 3 27B as translator; competitive on syllogisms, limited multilingual. Narrow task (syllogistic validity). |
| FOL-SLM, T5-base, ~22M trainable parameters, 85.8% premises / 91.1% questions on unseen vocabulary, clingo | **not found** | No paper or system named FOL-SLM with those numbers surfaced in three searches. The closest verified work: *Advancing Natural Language Formalization to First Order Logic with Fine-tuned LLMs* (arXiv 2509.22338: Flan-T5-XXL 70% with predicate lists, T5 beats decoder-only models of larger size) and the SemEval-2026 Task 11 SEF-CLGC paper (Flan-T5 < 1B fine-tuned on NL-to-CLINGO notations, F1 about 0.87). Treat the FOL-SLM numbers as unverified. |
| ASD ("an LLM router detects a deterministic computation core and synthesizes verified pure code; the router is the riskiest part") | **not found** | No system with that name and description surfaced. The idea exists diffusely (program-aided reasoning, PAL and PoT, which our design already cites); the specific claim is unverified. |
| a 2026 "verifiable verdict" provenance standard | **not found as a standard** | The nearest items are *Verification Autonomy Levels L0-L5* (arXiv 2608.19009, a classification of verification schemes) and the Haize Labs Verdict library (LLM-as-judge). No provenance standard by that name. |
| Attempto Controlled English, Newell & Simon, HTN, AMR/DRT, autoformalization being unsolved | known literature, not checked individually | Correct as general background. |

### 1.2 What is sound, what is oversold

| claim | verdict | against ChatSOP |
|---|---|---|
| NL -> IR -> formalism -> verification, not NL -> solver language directly | sound, and already ours | SOP Lang plus the registry is the IR; the engines and the oracle are the verification. The note's IR list (observations, unknowns, goals, constraints, actions, preconditions, effects, resources, preferences, costs, probabilities, assumptions, evidence) is a wish list; we have goals, stated values, derived values, constraints, assumptions (`assumed`), `unclear`/`unparsed`. Missing and relevant for the books: actions with preconditions and effects (planning problems), evidence and hypotheses on the model surface (abduce), unresolved-semantics markers with a reason. |
| "The LLM performs only narrow local operations" | sound; this is the step-by-step protocol | Our closed questions are narrow operations. The s1 data warns against taking it too far: the one-question expression path (a medium-sized operation) beats fourteen narrow questions. The right grain is "one checkable artefact per question", not "one word per question". |
| A closed algebra of formalization operators (DECOMPOSE-*, INTRODUCE-*, CASE-SPLIT, MAKE-ASSUMPTION, ...) | oversold as a research hypothesis; useful as a vocabulary for repair | Nobody has shown such a set is closed or complete; the note presents it as a hypothesis. We already perform INTRODUCE-VARIABLE (`new:`), DEFINE-TERM (session predicates), MAKE-ASSUMPTION (`assumed`), QUANTIFY (`stated`), and CASE-SPLIT (conditional lowering). What we lack is an explicit *edit* language for repair: "replace line 3", "split goal g1 into two", "mark v4 unused". That is where an operator vocabulary pays (variant A below), not as a general planner. |
| Semantic obligations, "formalized 87%, unresolved: X" reported as success | sound and cheap; the owner's "know that we don't know" | We have the pieces (expression `unused:` list, `unparsed`, `clarify`, `why_not`) but not the metric and not the report shape. Variant C. |
| Back-translation to NL and comparison with the original | sound in principle, weak as a sole check | Known from the autoformalization literature to be a weak signal when the same model judges its own output (it agrees with itself). It is useful as one more feature of a selector among candidates, and as the clarification text shown to the user. Variant D, low rank. |
| Multiple translation paths compared semantically by a solver (CLOVER) | sound and verified; our dual check is already a two-path instance | CLOVER compares FOL formulas for equivalence with a SAT solver; our equivalent is executing both circuits on the problem numbers plus perturbations, which is the right analogue for arithmetic (equivalence of functions on sampled inputs). Variant B extends it to N paths with a selection rule. |
| Divide-and-translate (parse to logical dependency structures first, translate subsentences) | sound for long FOL sentences; the wrong unit for us | It is sentence-level compositional translation for FOLIO-style text. Our problems fail on quantity roles and formula choice, not on nested quantifiers; the owner has already seen sentence splitting hurt. Keep only the lesson "accumulate from atomic parts with checks", which the registry-indexed lines already do. |
| A small fine-tuned translator (FOL-SLM-like) | plausible but unverified at the quoted numbers; a later option | The verified neighbours (Flan-T5 fine-tunes, Mathesis) show fine-tuning helps when the target language is fixed and the data is verified. Our restricted expression language is such a target and the dual check produces verified pairs. Variant E, after data accumulates and with the owner's approval per run (AGENTS.md: the project does not train models by default). |
| RL with verifier feedback (Mathesis) | verified, but far from our scale | GRPO on a 7B with a Lean prover in the loop; ours would be a 4B with the engines as the verifier. Only after E shows that supervised fine-tuning helps. |
| Abduction generates latent variables and hypotheses | sound; partly ours | `new:` is an abduced latent quantity; the expression program's intermediate names are latent sub-problems. The `abduce` type and `why_not` cover hypotheses. Nothing to add beyond stage D of the decomposition design. |
| An intent taxonomy (explain, prove, predict, diagnose, decide, plan, optimize, design, classify) | sound, mostly ours | Our goal kinds (number, yes/no, which thing, order, list, explanation) are the computable half of that taxonomy. Add `plan` and `diagnose` only when the model surface has actions and hypotheses. |
| "Universal formalizer != universal solver" | sound | Our StrategyRouter already separates them. |
| "LLMs have formal but not functional competence; neuro-symbolic works best on structured tasks" | sound and matches our data | Our numbers: the symbolic path wins where the problem states its own data; the bare 4B wins on qualitative and world-knowledge items. |

What the notes add that our design lacks: (i) the agreement signal as a first-class output ("formalized k%, unresolved X") with targeted questions; (ii) selection among N candidates rather than a cross-check of 2; (iii) an explicit edit/operator vocabulary for repair; (iv) a data path to a fine-tuned translator. What they do not add: a better decomposition than the registry, or any evidence that a general operator algebra beats a typed inventory on word problems.

## 2. Experiment variants, ranked by expected gain per cost

| rank | variant | hypothesis in one line | cost to build | expected gain | first gate |
|---|---|---|---|---|---|
| 1 | **B. N-way formalization with engine-checked agreement and a cascade** | Several cheap independent candidates, selected by agreement on numbers and perturbations, beat any single path; disagreement is where to spend a bigger tier. | low (everything exists; add candidates and a selector) | +10 to +15 points on numeric strata (s1: either = 73% vs best single 60%) | selected ≥ 66% on 60 problems, precision of agreed answers ≥ 85% |
| 2 | **F1. Verified-exemplar retrieval (no training)** | Few-shot examples drawn from our own verified formalizations (agreed and gold-matching) by registry shape raise the expression path on `tiny`. | low (an index over the recordings; a prompt block) | +5 to +10 points; grows with the corpus | paired gain ≥ +5 on 60 fresh problems, losses = 0 on the regression set |
| 3 | **C. Semantic obligations and targeted clarification** | Reporting coverage ("formalized k%, unresolved X") and asking one targeted question turns wrong answers into honest unknowns or into correct answers after one clarification. | medium (metric, report shape, question wires) | wrong down by a third; abstention precision ≥ 80% | abstention precision ≥ 80%, wrong ≤ 15/100 |
| 4 | **A. Operator repair over SOP as IR** | On disagreement or validator refusal, asking the model for one local edit (an operator) beats re-asking the whole question. | medium (edit operators, apply/validate loop) | +3 to +8 points on the disagreeing third | repair success ≥ 50% of disagreeing cases without new losses |
| 5 | **D. Back-translation as a selector feature** | A deterministic English rendering of each candidate, judged against the problem by `tiny` (yes/no), adds a usable signal to B's selector. | low-medium (renderer from registry labels; two-signal judge) | +2 to +4 points on B; better clarification text | adds ≥ 2 points to B's selection accuracy, else drop |
| 6 | **E. Small fine-tuned translator** (owner approval per run) | A LoRA on Qwen3-4B trained on verified (problem, program) pairs raises first-pass accuracy of the expression path. | high (data pipeline, training run, evaluation discipline) | +10 points on the expression path if ≥ 2,000 verified pairs | only after B and F1; needs the data below |
| 7 | **F2. RL with engine feedback** (Mathesis-like) | Verifier reward improves beyond SFT. | very high | unknown | not before E shows a gain |

Divide-and-translate as a separate variant is not proposed (see 1.2); its usable lesson is inside B (compositional candidates from the registry).

### B. N-way formalization with engine-checked agreement

- Hypothesis: with k independent candidate circuits per problem, selecting the largest cluster that agrees on the asked values on the problem numbers and on 3 perturbations gives higher accuracy than any single path, and the no-majority residue carries most wrong answers.
- Candidates (all over the same registry, all lowered to SOP): (1) expression path on `tiny`; (2) expression path on `tiny` with the registry lines in reverse order and the example changed (an independent sample, not temperature); (3) the typed tree on `tiny` (stage A); (4) expression path on `small` only when (1)-(3) have no majority (the cascade); (5) optionally the classic problem questions. Independence is by prompt, not by sampling temperature, so a replay stays deterministic.
- Selection rule (deterministic): cluster candidates by `answersAgree` on the original and perturbed numbers; choose the largest cluster; tie or singleton -> cascade to (4); still no agreement -> report `unresolved` (variant C), never a guess. Record for every problem the cluster sizes and which candidate was chosen.
- Smallest decisive experiment: 60 fresh problems from the numeric strata (`STRATA` of `expression.mjs`: units and rates, chained yields, bottlenecks, capacity thresholds, break-even, budgets, the decompose book's 2- to 5-part splits), 10 per stratum, excluding regression cases and seen items. Tiers: `tiny` for (1)-(3), `small` for (4). Measures: selected correct / wrong / unresolved; precision of agreed answers; share cascaded; cost per problem (calls, tokens, seconds). Paired bootstrap of selected − best single candidate. Stopping: stop after 60 if the interval excludes 0; one more 60 if not; stop early at 30 if more than 20% of candidates fail for infrastructure reasons.
- Build: `tools/eval/formalization-regression/expression.mjs run` gains `--candidates`; `lib/formalize/dual-check.mjs` gains `selectByAgreement(candidates)`; the step-by-step problem mode consults the selector before rendering. Everything else is reused: the registry, `expressionFormalize`, `crossCheck`, `perturbations`, the engines, the proxy response cache, the record/replay cache and the offline regression (every candidate is recorded by question hash so the selection is replayable without a model).
- Decision gate: selected accuracy ≥ 66% on the 60 and precision of agreed answers ≥ 85%, with zero losses on the regression set, makes B the product path for problem mode; below that, B stays an evaluation tool and the cascade (4) alone is kept if it is the part that helped.

### F1. Verified-exemplar retrieval

- Hypothesis: the expression path fails mostly on role binding (a price read as a count) and formula shape; showing two verified programs of problems with a similar registry shape (number count, percent flags, unit labels, goal kind) corrects both without any training.
- Data: the recordings in `datasets_sources/formalization-regression/expression/<tier>.jsonl` and the `s1` results, filtered to candidates whose answer agreed with another candidate and matched the gold (verified pairs); only the registry shape and the program are indexed, never the problem text of a sealed suite (DS011: the exemplar's own text is book-derived, so the index stays in `datasets_sources/`, and the prompt shows a verified exemplar's text only when its rights record allows it; otherwise the exemplar is shown as registry labels plus program, which is ours).
- Smallest experiment: the same 60 problems as B, expression path on `tiny` with and without 2 retrieved exemplars (leave-one-out: an exemplar is never the problem itself or a duplicate by content-word overlap, `tools/datasets/audit/content-word-overlap.mjs`). Measure first-pass correct, static-analysis rejections, and whether the exemplar's shape matched. Stop at 60 if decisive.
- Build: an index keyed by registry shape (small module under `lib/formalize/`), one prompt block in `expressionQuestion`; reuse the offline regression as the loss gate.
- Gate: paired gain ≥ +5 points and no loss on the regression set; exemplar shape match ≥ 70% (else the key is wrong, not the idea).

### C. Semantic obligations and targeted clarification

- Hypothesis: a formalization that reports what it did not use and what it could not bind is more valuable than a guess, and a single targeted question (to the user, or to a larger tier in the benchmark) resolves most of the residue.
- The obligation record per problem (structure only): registry numbers used / listed unused / neither (silently dropped); goals asked / answered; `new:` quantities opened / closed; candidates agreeing / disagreeing; the validator's refusals. Coverage k% = bound items over items. The answer packet carries `formalized: k%`, `unresolved: [v4 "staff roles", goal g2]`, and the renderer shows it from wires (no text in code).
- Targeted question: generated from the structure, not from phrasing: an unbound number asks "is v4 (…context…) needed for the answer, and how?"; a disagreement asks which of two one-line English renderings (variant D) is the intended computation; a `new:` left open asks for its value. One question per turn, then the circuit is re-selected.
- Smallest experiment: 100 fresh problems across all books (the qualitative fifth included, as the honest-unknown control). Measures: abstention precision (share of `unresolved` answers whose gold the system would have got wrong), wrong per 100, coverage k% distribution, and for the benchmark arm where `good` answers the targeted question, the share of unresolved problems that become correct after one question. Stop at 100.
- Build: the obligation record in `dual-check.mjs`/`decompose.mjs`; a `coverage` field in the result packet; renderer wires in the behaviour layer; the question templates as `fp_question_text` wires with placeholders. Reuses the inbox (`state/formalization-errors/inbox.jsonl`) for every unresolved problem, which feeds the improver and the knowledge-mining job (owner direction 3: agreeing formalizations with an `unknown` result route to knowledge mining).
- Gate: abstention precision ≥ 80% and wrong ≤ 15/100 at unchanged correct count; the clarification arm recovers ≥ 40% of unresolved problems.

### A. Operator repair over SOP as the IR

- Hypothesis: when candidates disagree or the validator refuses, asking for one local edit from a closed operator menu (REPLACE-LINE k, SPLIT-GOAL g, MARK-UNUSED v, INTRODUCE-VARIABLE name = expr, SET-ROLE v -> role, CASE-SPLIT on a check) succeeds more often than re-asking the full question, because the model sees the diverging line and the engines' two results.
- The operators are the edit algebra over the program and the typed tree; each is applied by code, validated, lowered and re-executed; a repair is accepted only when it increases agreement (joins a cluster) and never when it only changes the answer. At most 2 operator rounds per problem.
- Smallest experiment: the disagreeing cases of B's 60 (expected 20 to 30); `tiny` first, `small` on the residue. Measures: repaired-to-correct, repaired-to-wrong, untouched; operators used. Stop when 30 cases are done.
- Build: an operator reader (menu plus one line, structural), `applyOperator(program|tree, op)`, the loop in the selector. Reuses the dual check for acceptance and the regression replay for recording (an operator round is one more recorded question).
- Gate: ≥ 50% of disagreeing cases end in an agreeing correct cluster and repaired-to-wrong ≤ 10%; otherwise the operators are kept only as the vocabulary of the clarification questions of C.

### D. Back-translation as a selector feature

- Hypothesis: a deterministic English rendering of each candidate program ("the answer is the setup time plus the number of blocks, rounded up, times the minutes per block, compared with the limit") lets `tiny` answer a closed question "does this compute what the problem asks? yes/no" with enough precision to break ties in B and to phrase clarifications in C.
- Smallest experiment: on B's 60 problems, every candidate rendered and judged twice (the two-signal rule: the same question with candidates in swapped order); the feature is added to the selector only on the tie cases. Measures: judge agreement with gold per candidate, tie cases resolved correctly. Stop at 60.
- Build: a renderer from program lines and registry labels (structure: operator words and labels, in the answer-text layer, with its wording as wires); a judge question template. Reuses `sop/answer-text.mjs` conventions.
- Gate: ≥ 2 points on B's selected accuracy and judge precision on wrong candidates ≥ 70%; else dropped as a selector feature and kept for clarification text only.

### E. A small fine-tuned translator (later; owner approval per run)

- Hypothesis: a LoRA on Qwen3-4B (`tiny`) trained on verified (problem, registry, program) pairs raises first-pass expression accuracy by ≥ 10 points and reduces static rejections, as fine-tuned T5 and Mathesis show for fixed target languages.
- Data requirements before a run is even proposed: ≥ 2,000 verified pairs, where verified means the program's circuit agreed with an independent candidate on perturbations AND matched the gold, collected by B and F1 over fresh samples; stratified so no section exceeds 10%; de-duplicated against every sealed suite and the regression set by content-word overlap; source rights per pair recorded (book-derived problems stay in `datasets_sources/`, so training data never enters the repository and the owner decides which books may be used, DS011). Negative pairs (disagreeing programs with the engines' values) are kept for a later preference stage.
- Smallest experiment: one LoRA run, evaluation on 100 fresh problems by the offline regression with the `tiny` recordings re-recorded under the new weights, paired against the base `tiny`; stop after one run.
- Build: a data exporter from the recordings (a job spec under `jobs/`), the training script outside the product, a registry entry for the model variant; the proxy serves it as a separate tier name so nothing else changes.
- Gate: ≥ +10 points first-pass, no loss on the regression set, static rejections halved; each run needs the owner's written approval in `questions.md`.

### F2. RL with engine feedback

Only if E shows a gain and the owner wants a second step: GRPO-style training with the engines' agreement and gold match as reward. Not costed here.

## 3. When to declare the current approach failed

The current approach = registry + typed tree (stage A) + dual expressions on `tiny`. Thresholds, all measured on fresh stratified samples with the paired bootstrap, never on the regression set:

| component | sample | failed when | then |
|---|---|---|---|
| Stage A typed tree vs classic questions (arm A vs C of `eval-semantic-decomposition-v1`) | stage 1, 50 problems | the paired interval of A − C includes 0 after one generic fix round and one fresh 50, OR the tree is ≥ 10 points below the expression path on the same problems, OR type agreement `tiny` vs `good` < 60% (menu collapse: the sd1-A dialogs show every type-like reading as choice `1`; verify before scoring), OR `clarify` + `unclear` ≥ 35% on numeric strata, OR median questions per problem > 12 without gain | keep the tree only as a candidate in B, stop extending its type inventory (stages B to D), route the type question to `small` or drop it |
| Dual expressions (expression path alone) | 60 numeric problems | first-pass correct < 50% on `tiny` after F1, OR static rejections > 20% | the expression language or the registry labelling is the defect; fix the language before anything else |
| Dual agreement signal | 60 problems | agreement coverage < 30% OR precision when agreeing < 80% OR either − best single < 5 points (no complementarity) | N-way selection cannot help; go to C (honest unknown) and E |
| End to end on `tiny`, numeric strata | 100 fresh, after two improvement cycles | correct < 45/100 OR wrong > 20/100 | problem mode moves to `small` by default for the type and expression questions (the ladder stays), and E is proposed to the owner |
| End to end, all books | 100 fresh, after two cycles | correct + honest unknown < 85/100 (wrong > 15) | the abstention of C is enforced before any new type is added |

Early stopping applies to every row: a stage of 50 or 60 that is decisive stops the question; a fix is made generically, and one fresh sample of the same size confirms it; the larger measurement runs once.

## 4. Order of execution

1. Score sd1-A/sd1-G now (the runs exist), check the type-menu collapse, and apply the stage-A thresholds.
2. B on 60 problems (one evening on `tiny`, a few `small` calls); it reuses the s1 harness and settles whether selection is the product path.
3. F1 inside the same 60 (leave-one-out exemplars), then C on 100 across all books, with the obligation record as the packet field everything later reports through.
4. A on B's disagreeing residue; D only on B's ties.
5. E as a written proposal in `questions.md` with the data count, once ≥ 2,000 verified pairs exist.

Every run is an LLMJobs job spec or a `tools/eval/formalization-regression/*` command with a run id, a dated summary and an inbox report; no hand-run loops.
