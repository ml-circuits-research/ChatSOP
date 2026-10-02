# Generic question protocol for LocalLLMStepByStep (Qwen3-4B target)

Status: adopted by the orchestrator on 2026-10-02 (owner: keep step-by-step; bring Qwen3-4B up to high correctness with a comprehensive, generic question protocol). Plan written by a planning agent (Fable) from the code at commit 84f3d7e; implemented and measured by an implementation agent.

The full plan (inventory of constructs → slots by aspect; 12 generic numbered-choice questions Q1–Q12 with cues and the two-signal rule; clause decomposition and recombination; bounded control flow with validator-driven re-asks and a forced-contrast confirmation; methods A/B/C/D with B-cue and B-yesno ablations; staged measurement on levels a/b/c/natural; risks and symbolic compensation) is recorded in the journal event "Step-by-step question protocol plan adopted" and summarised here:

- Q1 KIND (13 kinds incl. every/when/why/statement) · Q2 ASPECTS checklist (verified against regex cues) · Q3 STATEMENTS from the schema neighbourhood · Q4 PLACES (narrowed by class) · Q5 LIMIT · Q6 OPTIONS · Q7 TWO-SIDED COMPARISON · Q8 EXCLUSION · Q9 GROUP/SCOPE · Q10 DEFINITION (chain / join / per-group aggregate / fewest steps) · Q11 CLAUSE ROLE · Q12 CONFIRM by forced contrast.
- Decomposition: deterministic sentence split, clause split on link connectives (never inside relative clauses), main clause gets Q1, other clauses Q11 + statement mode, recombination by shared names, pronoun resolution, `$q`, `if/because/before $s`, leftover → `unparsed`.
- Control flow: ≤ 14 questions, one redo; one-hop lookups take 3 questions.
- Methods: A current, B aspect-first, C clause-first, D = B + C, ablations B-cue and B-yesno; slot attribution of the first diverging step; staged 3 → 5 → 10 per form with paired bootstrap and stopping rules.
