---
title: DS029-emotion-detection
summary: EmotionDetectionSystem and pragmatic signals - the separate switchable component with pluggable strategies, the closed signal kinds, classification of the spans SymbolicLM cannot formalize, the host-emitted advisory pragmatic wire, how the reasoner may use it, configuration, rights and the evaluation of experiment emotion-detection-v1.
---

## Introduction

Owner decision of 2026-10-01: the architecture has a separate component, the **EmotionDetectionSystem**. It can be enabled or disabled, it has strategies of its own so that different models can be plugged in later, and it can emit SOP Lang circuits to the reasoner so that the reasoner regulates itself (the depth of its thinking, its strategy, its wording). The signals are useful symbolic input even though they are not fully verifiable: they are the system's subjective perception of how a message is said, never a claim about the world.

The same component implements the owner's earlier idea for leftover spans. The pieces of a message that SymbolicLM cannot formalize (greetings, thanks, politeness, interjections, swearing, urgency markers, hedges, discourse markers, tags such as "right?") are classified by their pragmatic or emotional role instead of staying [`unparsed`](specsLoader.html?spec=DS021-model-surface.md); the user sees which spans were classified and the reasoner can use them.

The model boundary of AGENTS.md and [DS021](specsLoader.html?spec=DS021-model-surface.md) is unchanged: the small formalizer never authors a `pragmatic` wire, its prompt stays the user's message, and the component runs on the host after the model (and, for neural strategies, after textToCleanEnglish).

## Core Content

### Component and API

`lib/emotion-detection/` exports `createEmotionDetectionSystem({strategies, enabled, latencyBudgetMs, minScore, emitUnclassified, kindPolicy})` and `createDefaultEmotionDetectionSystem(config)`, which builds the system from `config/emotion-detection.json`. `detect(message, {analysis, englishText, leftoverSpans})` returns `{signals, leftovers, trace}`:

- `signals`: `{kind, label, score, span?, source, basis, emoji?, leftover?, experimental?}` (`emoji` is the suggestion of `kindEmoji` in the config, for showing the kind in a UI), `source` being the strategy or model id, `basis` one of `lexicon`, `pattern`, `classifier`, `llm`; a signal without `span` describes the whole message.
- `leftovers`: `{classified, remaining}`: the leftover spans (`unparsed` spans, or "not represented" spans) whose letters are covered at least 60% by classified signals, each with its `kinds`, and the spans that stay unclassified and therefore stay `unparsed`.
- `trace`: per strategy `{id, ms, signals}` or `{id, error}` or `{id, skipped}`, and the total `elapsedMs`.

`setEnabled(false)` (the chat setting) makes `detect` return no signal and no work. Costly strategies (`cost: 'costly'`) run in parallel after the cheap ones, under `latencyBudgetMs`; one that exceeds the budget or fails is reported in the trace and never blocks the turn; they are skipped when the symbolic signals already cover 90% of the message letters.

The library surface for callers (the server's API layer, the agent, tools): `createDefaultEmotionDetectionSystem(config = loadConfig(), {enabled, llmClassify})` (async `detect(message, {analysis, englishText, leftoverSpans})`, `setEnabled`, `strategyIds`, `close`), `loadConfig(path?)` and `CONFIG_PATH`, `adviceFor(signals, {hasContent, minScore})`, `signalsToSop(signals, {taken})`, `classifyLeftovers(leftoverSpans, signals)` and `courtesyReply(signals, language)` (`lib/emotion-detection/courtesy.mjs`). Everything is pure data in and out; the module touches no server code.

### Kinds

A small closed set (`sop/enums.mjs` `PRAGMATIC_KINDS`): `greeting`, `closing`, `thanks`, `apology`, `politeness`; `urgency`; `frustration`, `anger`, `confusion`, `curiosity`, `joy`, `sadness`, `fear`, `disappointment`; `hedge`, `emphasis`; `profanity`, `offensive`; `irony_possible`; `confirmation_request` (tag questions); `topic_shift` (discourse markers); `unclassified` (a pragmatic span that no strategy could name; not emitted unless `emitUnclassified`).

### Strategies

All strategies sit behind `{id, kinds, detect(message, context)}`.

- **`symbolic`** (`strategies/symbolic.mjs`, lexicon and patterns in `lexicon.mjs`, English and Romanian): deterministic, folded (no diacritics) word-boundary patterns for greetings, closings, thanks, apologies, politeness, urgency, hedges, frustration, anger, confusion, curiosity, joy, sadness, fear, disappointment, profanity, insults, soft irony patterns, discourse markers and tag questions; emoji and emoticons; punctuation intensity (`!!!`, `?!`); stretched words; all-caps words and messages (acronyms excluded). It runs on the whole message and on every leftover span, costs about 0.2 ms per message and is on by default. The lists are original compilations by the project, so no external licence applies ([DS014](specsLoader.html?spec=DS014-source-rights.md)).
- **`neural`** (`strategies/neural.mjs`, `training/python/emotion_worker.py`): optional local CPU classifiers in a separate virtual environment `~/emotion-venv`, no network, no GPU, reading the English text (`englishText`, after LanguageProofingLLM for Romanian and mixed input). Candidate models and their licences: `SamLowe/roberta-base-go_emotions` (MIT), `unitary/toxic-bert` (Apache-2.0), `cardiffnlp/twitter-roberta-base-irony` and `j-hartmann/emotion-english-distilroberta-base` (no licence declared: experimental, local inference only, nothing redistributed). Their labels map to kinds by `config.map`; each label needs its threshold. Off by default.
- **`llm`** (`strategies/llm.mjs`): a slot for a later fine-tuned or general LLM, `classify(text, context)` returning signals; off by default and bundled with no model.

`kindPolicy` in the config sets, per `strategy.kind`, `on` (the default), `experimental` (the signal is reported to the user but not emitted as a wire and not used by the reasoner) or `off`. The rule applied by `tools/emotion-detection/evaluate.mjs`: `on` at precision 0.85 or more over at least three predictions, `experimental` from 0.6, `off` below.

### The `pragmatic` wire

A host-emitted advisory wire ([docs/wire_typs/pragmatic.html](wire_typs/pragmatic.html)); fields `kind`, `score` (decimal 0 to 1, at most three digits), `span` (optional, JSON-quoted verbatim part of the message), `near` (optional `$id`), `source` (strategy id) and `basis`. The parser, the graph check and the runtime accept it; the model-origin compiler rejects it (it is not in `MODEL_TYPES`); the runtime reports `{status: "pragmatic", advisory: true, kind, score, span, source, basis, near}` and changes nothing else. `lib/emotion-detection/sop.mjs` (`signalsToSop`) renders signals as wires with fresh ids `p1`, `p2`, and the host adds them to the circuit sent to the reasoner.

A leftover span that the symbolic strategy classifies becomes a `pragmatic` wire and its `unparsed` wire is dropped from the user-facing "not represented" list; a span that stays unclassified remains `unparsed` and is handled by host repair and clarification as before ([DS021](specsLoader.html?spec=DS021-model-surface.md)).

### Leftover-span classification (owner decision Q-DATA-3)

Message pieces that SymbolicLM cannot formalize are not left as `unparsed` when they have a pragmatic or emotional role. Rules:

1. Input: the spans the interpretation reports as not represented (`leftoverSpans`, each `{span}`), plus the whole message.
2. Every enabled strategy classifies the message and each span; signals found inside a leftover span carry `leftover: true`.
3. A leftover span is **classified** when the non-experimental signals cover at least 60% of its letters (a signal whose span contains a short leftover, or is contained in it, counts). It is reported in `leftovers.classified` with its `kinds`, becomes `pragmatic` wires, and no longer counts as not represented.
4. Any other span is in `leftovers.remaining` and stays `unparsed`: the host repair and one-question-per-span clarification of [DS021](specsLoader.html?spec=DS021-model-surface.md) apply unchanged. A classification never hides content: a span with a content word the strategies do not explain is not classified.
5. The user sees the classified spans, with kind, score, source and emoji, in the "I understood" view; experimental signals are shown marked and are not used by the reasoner.
6. Measured (experiment emotion-detection-v1, `leftover-study.json`): of 97 spans SymbolicLM did not represent in 300 messages, 32 were classified (greetings, politeness and thanks markers, closings, "ugh", "out of curiosity"); the 65 others, mostly subordinate clauses and names, stayed `unparsed`.

### Use by the reasoner

A pragmatic signal is advisory: it is never a fact about the world, never evidence, never stored and never carried to a later turn, and it never blocks or refuses a turn. `lib/emotion-detection/advice.mjs` (`adviceFor`) is the pure mapping the host applies:

- `urgency`: shorter answer, low thinking level, hint for a faster strategy.
- `frustration`, `anger`, `disappointment`: re-check the previous interpretation, calm tone, higher thinking level (unless urgent).
- `confusion`: re-check and offer a clarification, explain unless urgent.
- `hedge`: the hedged statement is a supposition, consistent with `certainty hedged` of [DS021](specsLoader.html?spec=DS021-model-surface.md).
- `greeting`, `closing`, `thanks`, `apology`, `politeness` without any content: a short courtesy reply and no computation.
- `irony_possible`: do not act on the literal meaning without confirmation. It is a soft signal: the symbolic score is capped at 0.5, and it only ever asks for confirmation.
- `confirmation_request`: open the answer with the confirmation or its denial.
- `topic_shift`: do not resolve references against the previous topic.
- `fear`, `sadness`: supportive tone, no extra detail. `profanity`, `offensive`: answer the content neutrally, never mirror it and never refuse because of it.
- `curiosity`: allow an explained answer.

### Configuration

`config/emotion-detection.json`: `enabled`, `latencyBudgetMs` (400), `minScore` (0.5), `emitUnclassified`, `strategies` (`symbolic` on; `neural` with its Python, worker, threads, models, label map and thresholds, off; `llm` off), `kindPolicy`, `kindEmoji` (one emoji suggestion per kind). The chat setting toggles `enabled` per request.

### Rights

Model weights are assets with their own rights ([DS014](specsLoader.html?spec=DS014-source-rights.md) "Model weights"); revisions and sha256 values are in `dependencies.md` and `eval/reports/current/emotion-detection/models-sha256.txt`. A model without a declared licence is used for local evaluation only and is never default.

### Evaluation (experiment emotion-detection-v1)

300 messages (30 each from `bad_english`, `neuro_english`, `symbolic_english`, 29 from `new_cases`, 181 written for the study with greetings, thanks, urgency, hedges, swearing, irony, tag questions and neutral controls, in English, Romanian and mixed), labelled by Grok (`xai-oauth/grok-4.20-0309-non-reasoning`) and GLM (`zai/glm-5.3-flash`, three parallel sessions) as omp task folders under `datasets_sources/emotion_*`. A kind counts as positive when both judges list it, negative when neither does, and disputed messages are left out of that kind's precision and recall. Sixty labels were read by the evaluating agent. Results, per-kind tables, latency and caveats: `eval/reports/current/emotion-detection/summary.md`. The set is a development set, not a sealed test: the symbolic lexicon was corrected on the odd-numbered half and scored on the even half, and the handwritten messages share an author with the lexicon, so the numbers overstate performance on unseen text.

### Status and gaps

The symbolic strategy and the component are implemented and measured. No emotion-specific data is trained on and no training is involved. Neural strategies are optional and off by default. Open: calibration on messages from real users, a larger independent set, Romanian neural classification (the classifiers read English), the LLM strategy, and whether any pragmatic signal improves answers downstream (a preregistered end-to-end comparison is not yet run).
