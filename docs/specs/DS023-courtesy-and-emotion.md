---
title: DS023-courtesy-and-emotion
summary: Courtesy and emotion as part of the one understanding step - the formalizer writes them as advisory pragmatic wires next to the query, the compiler keeps them out of linking and execution, the reply and the tone are rendered from them, and how each formalization strategy asks for them; the archived lexicon EmotionDetectionSystem and the evaluation eval-pragmatics-v1.
---

## Introduction

Owner decisions of 2026-10-01 and 2026-10-02. A message does more than ask or state: it greets, thanks, apologises, says goodbye, asks politely, or shows a feeling (frustration, confusion, urgency, joy, sadness, fear, disappointment, anger). The reply should answer that too: "Hello!" gets a greeting back and no computation, a frustrated question gets an apology for the trouble with its answer.

Owner rule of 2026-10-02 ("No hardcoded understanding", AGENTS.md): understanding a message, including its courtesy and its emotion, is the formalizer's work in the same step that writes the query. The earlier **EmotionDetectionSystem** (a lexicon and regular-expression pre-step in `Agent.turn`, English and Romanian) read the message with hand-written word lists before the formalizer; it is archived under `probably_obsolete/paused/lib/emotion-detection/` (with its configuration, tools and tests) and is used only as a reference number in the evaluation below. This specification had the file name "emotion-detection" until 2026-10-02 (`docs/specs/aliases.json`).

## Core Content

### The `pragmatic` wire

A model-language wire ([DS014](specsLoader.html?spec=DS014-model-surface.md) `MODEL_TYPES`; help page [docs/wire_typs/pragmatic.html](wire_typs/pragmatic.html)): `kind` (one of the closed `PRAGMATIC_KINDS` of `sop/enums.mjs`: `greeting`, `closing`, `thanks`, `apology`, `politeness`, `urgency`, `frustration`, `anger`, `confusion`, `curiosity`, `joy`, `sadness`, `fear`, `disappointment`, `hedge`, `emphasis`, `profanity`, `offensive`, `irony_possible`, `confirmation_request`, `topic_shift`, `unclassified`), `basis` (`llm` for every formalizer; `lexicon`, `pattern` and `classifier` remain valid for archived experiments), optional `score` (0 to 1, default 1), optional `span` (a verbatim part of the message; admission rejects a span that is not in it with `pragmatic_span_not_in_message`), optional `near $id` (another, non-pragmatic wire of the same output) and optional `source` (the strategy id). `unclear` stays the only wire of its output except for pragmatic wires ("Thanks!" may be `unclear kind no_request` with a `thanks` wire).

A signal is the system's perception of the message: never a fact about the world, never evidence, never stored and never carried to a later turn.

### Compilation and rendering

`sop/declarative.mjs` `compileDeclarative` splits the pragmatic wires from the authored program (`pragmaticOf`, `sop/pragmatic-text.mjs`) and compiles the rest unchanged; they are never linked, executed or used as evidence. `runDeclarative` then:

1. **Courtesy only.** A program of pragmatic wires only, or `unclear kind no_request` with pragmatic wires, is answered by `courtesyResult`: `status: courtesy`, the reply of `courtesyReply` (courtesy first, at most two kinds: greeting "Hello! What would you like to know?", thanks "You're welcome.", closing "Goodbye!", apology "No problem.", politeness "How can I help?"; else the first emotion: confusion "Sorry for the confusion. Tell me which part is unclear, or ask a question, and I will explain it.", frustration, anger and disappointment "I am sorry about the trouble. …", sadness and fear "I am sorry to hear that. …", joy, urgency, curiosity), no computation and no memory change.
2. **With a request.** Every packet of the turn carries `packet.pragmatic` (`{id, kind, score, span, near, source, basis}` per wire) and the result carries `pragmaticSop`.

`server/agent.mjs` `Agent.turn` applies the tone (`toneAnswer`) to the English answer of a non-`unclear`, non-`clarify`, non-courtesy packet from the signals of score 0.5 or more: an opening phrase for a greeting ("Hello!"), thanks ("Happy to help."), an apology ("No problem.") or politeness ("Of course."); "Sorry for the trouble." for frustration, anger or disappointment; "I am sorry to hear that." for sadness or fear; a clarifying sentence after confusion; "Goodbye!" after a closing; under urgency only the first line of the answer (the packet keeps the rest). It records `packet.pragmatic_use.applied`. The answer is English like every answer; the output edge (`server/answer-language.mjs`) phrases it in the language of the message. The formalizer receives the whole message: nothing is stripped before it.

The chat trace panel shows section "2b. Courtesy and emotion": every wire (kind, span, source, basis) and the tone applied; the API trace carries `pragmatic` and `pragmatic_use`.

### How each strategy writes them

- **CodingAgent** and **LocalLLMDirect** share the author guide (`skills/coding-agent-query/guide.md`, section "Courtesy and emotion: pragmatic wires"): one wire per greeting, thanks, apology, closing, polite word or emotion the message shows, `basis llm`, a verbatim `span` when the message has the words; a message of courtesy or emotion only gets its pragmatic wires and nothing else. The list of kinds in the guide is rendered at load time (`lib/query-author/context.mjs` `guideTexts`) from `PRAGMATIC_KINDS` and the descriptions `PRAGMATIC_DESCRIPTIONS` of `lib/query-author/step-by-step/questions.mjs`, the one place of every question template and choice list; the validator accepts the wires (`AUTHOR_TYPES`) and a message of pragmatic wires only is not `no_query`.
- **LocalLLMStepByStep** (generic protocol, [DS022](specsLoader.html?spec=DS022-sessions-and-base-memories.md) "LocalLLMStepByStep"): after the kind question, `firstQuestion` asks the message acts as lettered yes/no lines with the message repeated (greeting, thanks, apology, goodbye, polite word, a feeling, and a last line for "a question or a request to look something up"); a feeling is followed by the emotion question (frustration, confusion, urgency, anger, disappointment, joy, sadness, fear, curiosity). The circuit writer emits one `pragmatic` wire per act (`source local_llm_step_by_step`, `basis llm`, no span). "Hello!" is two short questions (kind "nothing", then the acts); when the kind says "nothing to look up" but the last line says there is a question, the kind is asked once more without "nothing". Method A (the first protocol) writes no pragmatic wires.

### Use by the reasoner

The wires regulate the reply only (the tone above). The advice mapping of the archived component (urgency: shorter answer and a faster strategy; frustration or confusion: re-check the previous interpretation; a hedge as a supposition; a possible irony asks for confirmation) is not applied by the product; a reasoner use beyond the tone needs a preregistered end-to-end comparison first.

### Evaluation (eval-pragmatics-v1)

Set: `eval/pragmatics-v1/messages.jsonl`, the 300 messages of the archived experiment emotion-detection-v1 (30 each from `bad_english`, `neuro_english`, `symbolic_english`, 29 from `new_cases`, 181 handwritten; English, Romanian and mixed) with the labels of its two judges (Grok and GLM): a kind is positive when both listed it, negative when neither did, disputed kinds are left out of that message. Runner: `node tools/eval/pragmatics/run.mjs --arm stepbystep|coding|lexicon` and `--report` (records and summary in `eval/reports/current/pragmatics/`). Micro precision and recall over the 14 kinds the step-by-step question can name ("core"), 2026-10-02:

| Arm | Messages | Core precision | Core recall |
|---|---|---|---|
| LocalLLMStepByStep, Qwen3-4B Q4 (acts and emotion questions) | 250 held out (the first 50 were used to word the questions) | 45.2% | 82.5% |
| same | all 300 | 48.0% | 83.1% |
| CodingAgent guide, Claude Haiku as a proxy (GLM quota exhausted) | first 50 | 100% | 100% |
| archived lexicon EmotionDetectionSystem (reference only) | 300 | 93.9% | 86.6% |

Reading. The lexicon number is optimistic: its word lists were written and corrected on these very messages by the author of the handwritten ones. The guide arm is the guide's pragmatic section followed by an LLM, not the full CodingAgent run (which writes the query too); the zai/glm-5.3 arm through omp is still to run (`--arm coding`). Qwen3-4B finds most courtesy and feelings but over-reports them (a plain question read as curiosity or fear; "pls" read as a goodbye); its p50 latency for the acts questions is about 0.5 s on the GPU. Questions were worded on the first 50 messages only; the held-out 250 give the honest number.

### Status and gaps

Implemented and tested (`tests/pragmatic-turn.test.mjs`, `tests/local-llm-step-by-step-protocol.test.mjs`, `tests/wire-help.test.mjs`). Open: the CodingAgent arm with zai/glm-5.3 on the 300 messages; better step-by-step precision (the acts question over-reports feelings); whether pragmatic signals improve answers beyond the tone (no preregistered comparison yet).
