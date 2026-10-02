# Behaviour layer: instructions, drives and decision tables decided by reasoning

Status: adopted on 2026-10-02 (owner: "more dynamism, smarter, follow instructions, efficiently and symbolically; preoccupations that surface when the occasion comes; triggered by the user's emotions and by the time since the last reaction of that kind; our memory is fast, we can afford a little waste for realistic dialogue"). Designed by the orchestrator; implemented as phase 2 of the conversation layer (`conversation-v1`).

## Principles

- Every strategy (CodingAgent, LLMDirect, LocalLLMStepByStep, InternalReasoningStepByStep) only produces the circuit of the request. The **reply is always decided by the reasoner** over one behaviour layer; code maps facts in and composes text out, it never chooses.
- No user-facing text and no selection logic in code (AGENTS.md "No hardcoded understanding").
- Everything the system does to shape a reply is data: wires in base memories (defaults) and in the session layer (what the user taught), visible in `/review`.

## 1. Turn context as facts (deterministic mapping, no interpretation)

Each turn adds facts to a small per-turn theory: request kind and status from the packet (`answered`, `unanswered`, `no_relation`, `clarify`), entities and topics touched, pragmatic signals (`user_emotion frustration 0.8`), the language, the turn number, and conversation time facts: `last_reaction ?kind ?turn ?time` for every reply action ever taken (greeting, fun fact, suggestion, follow-up, apology…), `turns_since ?kind ?n`, `seconds_since ?kind ?s`, `user_instruction ?id` active, `topic_count ?topic ?n`.

## 2. Behaviour wires

- **Reply actions** (one new wire type or an extension of `template`, decided by principle): an action id, its slot (`prefix`, `tone`, `main`, `follow_up`, `aside`, `suffix`), its text variants per language with packet slots, and its cost/weight.
- **Decision tables**: ordinary `rule`/`default` wires with priorities deriving `applicable ?action ?priority` from the turn facts (e.g. `no_relation` + `near_candidate ?e` → `suggest_candidate`; `user_emotion frustration` → `apologetic_tone`; `answered` outranks small talk). Defaults with exceptions let explicit user instructions override built-in preferences.
- **Drives (preoccupations)**: `goal`-like wires with an activation condition (topic or emotion match), an intensity that grows with `turns_since`/`seconds_since` the drive last fired, a threshold and a cooldown. When the occasion matches and the intensity passes the threshold, the drive contributes its action (e.g. "learn the user's name", "offer an interesting fact about the current topic", "check the user is satisfied after a long answer"). Firing records `last_reaction`.
- **User instructions in the session**: "from now on always start with «I'm here:»" is formalized as a session rule (origin `user`) deriving `applicable prefix_im_here 100`; "stop doing that" retracts it; "what are my instructions?" lists them. They persist in the session layer and can be inspected and changed.

## 3. Decision and composition

The JS oracle (in process, theory cached per memory version, turn facts added) derives the applicable actions; per slot the highest-priority action wins (ties: least recently used variant); the derivation is the explanation shown in the chat trace ("aside added: drive offer_fact active for 5 turns"). Code composes the reply from the chosen wires and the packet values; the optional answer-formulation step (default LLM via the proxy) phrases it naturally without adding facts.

## 4. Review and tests

- Review every strategy and the chat turn for remaining hardcoded selection or text; route all of them through this layer.
- Tests: an instruction changes later replies and can be withdrawn; a drive fires only after its cooldown and only on a matching occasion; frustration changes tone; time since last greeting decides whether to greet again; the trace explains every action.
