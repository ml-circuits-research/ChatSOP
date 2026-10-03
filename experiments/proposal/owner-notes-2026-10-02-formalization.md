# Owner notes, 2026-10-02 night: a general formalization algorithm (two external analyses, as given)

The owner pasted two analyses (written in Romanian by other assistants) for the design agent to evaluate. Their claims about papers and systems are unverified here. Summary of their content, kept close to the original:

## Analysis 1: a Universal Formalization Loop (UFL)

- No accepted algorithm formalizes arbitrary problems; the pieces exist separately: problem spaces and means-ends analysis (Newell & Simon; ill-structured problems become structured progressively), HTN planning (recursive task decomposition), computational thinking (decomposition, abstraction, algorithmic thinking, evaluation, generalization), compositional semantics and semantic parsing (AMR, PropBank, UD, DRT), Attempto Controlled English (an English-like controlled language compiled unambiguously to FOL), requirements engineering (ambiguous/incomplete requirements to verifiable specifications), autoformalization (informal mathematics to Lean/Isabelle; still far from solved), philosophy of modelling (a model represents an aspect for a purpose).
- Proposed: Natural Language -> Problem IR -> formalism(s) -> verification, not NL -> Prolog directly. The IR holds context, entities, types, observations, facts, unknowns, goals, constraints, actions, preconditions, effects, dependencies, causal and temporal relations, resources, preferences, costs, probabilities, measurements, assumptions, evidence, evaluation criteria, unresolved semantics.
- Loop: intent (explain, prove, predict, diagnose, decide, plan, optimize, design, classify) -> situation model -> problem frame (GIVEN, UNKNOWN, GOAL, CONSTRAINT, ACTION, OBSERVATION, ASSUMPTION, PREFERENCE) -> ambiguity detection -> recursive decomposition (goal->subgoals, system->components, process->stages, event->causes/effects, condition->cases, quantity->variables) -> abstraction -> dependency/causal/goal graph -> local choice of formal semantics -> compile fragments to suitable reasoners (Datalog/Prolog, SAT/SMT/CSP, PDDL/HTN, temporal logic, algebra, LP/MILP, probabilistic, causal models, program synthesis, theorem provers, abduction, decision theory; unknown stays in the IR, marked) -> verify (types, units, satisfiability, consistency, missing variables, unreachable goals, contradictions, coverage) -> counterexamples and missing questions -> repair -> back-translate to NL and compare with the original -> solve.
- The LLM only performs narrow local operations: paraphrase(span), identify_event, identify_roles, canonicalize_concept, suggest_ontology, suggest_decomposition, generate_candidate_formalization(span), explain_formal_fragment, detect_missing_assumption. LLMs handle representations close to natural language better than rigid formalisms, which supports an intermediate IR/CNL (SOP Lang could be that IR).
- An algebra of domain-independent formalization operators: DECOMPOSE-GOAL, DECOMPOSE-PART-WHOLE, DECOMPOSE-TEMPORAL, DECOMPOSE-CAUSAL, CASE-SPLIT, INTRODUCE-VARIABLE/STATE/ACTION/MEASUREMENT/CONSTRAINT, ABSTRACT, GENERALIZE, SPECIALIZE, MAKE-ASSUMPTION, GROUND-CONCEPT, DEFINE-TERM, RESOLVE-REFERENCE, QUANTIFY, OPERATIONALIZE.
- Good formalization does not invent what is missing: it produces explicit semantic obligations ("define worth_it: expected profit > 0? ROI > threshold? ...") and may report "formalized 87%, unresolved: ..." as a success. Abduction generates latent variables and hypotheses. Symbol grounding limits text-only formalization.
- Research hypothesis: a small finite set of universal formalization operators, with domain knowledge and a neural semantic oracle, can iteratively turn a broad class of NL problems into verifiable formal representations. Universal formalizer != universal solver.

## Analysis 2: this is neuro-symbolic "translate then verify"

- The LLM is a formalization preprocessor (FOL, LTL, Python...), a deterministic solver reasons, every step is verifiable ("verifier-in-the-loop", "propose-check").
- Cited (unverified): FOL-SLM (a T5-base decoder, ~22M trainable parameters, NL->FOL 85.8% premises / 91.1% questions on unseen vocabulary, clingo ASP solver); UFAL-CUNI SemEval-2026 (a 4B LLM parses syllogisms to FOL for a theorem prover, beats zero-shot LLMs of its class); Mathesis ICLR 2026 (autoformalizer trained by RL with syntactic+semantic+prover feedback); ASD (an LLM router detects a deterministic computation core and synthesizes verified pure code; the router is the riskiest part); CLOVER ICLR 2025 (several translation paths, a SAT solver compares the FOL candidates semantically and picks the most likely); "Divide and Translate" (first decompose complex sentences into logical dependency structures, then translate sequentially); a 2026 "verifiable verdict" provenance standard.
- Limit: LLMs have formal linguistic competence but functional competence needs external modules; universal scope remains open; works best on structured tasks.

## Analysis 3 (owner, later the same night): a formalization machine by rewriting

- Make formalization mechanical: execute a transformation machine until every leaf has an executable interpreter.
- One IR, `ProblemState`, holds:
  - context, entities, variables, facts, goals, constraints, actions, methods;
  - assumptions, ambiguities, unknowns, provenance.

  SOP Lang can represent it.
- First pass, nearly mechanical: label each statement FACT, GOAL, CONSTRAINT, ACTION, DEFINITION, HYPOTHESIS or QUESTION, then its arguments (frame semantics). Classify the goal by the FORMAL OPERATION it asks for, not by domain:

  | Goal shape | Engine |
  |---|---|
  | is X true | logic |
  | does X exist | SAT/SMT/CSP |
  | find the value | equations |
  | max/min | optimization |
  | how to get from A to B | planning |
  | in what order | scheduling |
  | what explains | abduction |
  | what comes next | probabilistic |
  | does X cause Y | causal |
  | find a procedure | synthesis |

- HTN-style METHOD library: `match` (goal pattern), `requires` (slots), `decompose` (subgoals), `solver`. Examples: ScheduleExclusiveResources, ProveImplication, CompareAlternatives (criteria, hard constraints, evaluate, Pareto), ExplainObservation (hypotheses, predictions, discriminating observations).
- Primitives: LOOKUP, CALCULATE, QUERY, PROVE, SOLVE_CONSTRAINTS, OPTIMIZE, SIMULATE, OBSERVE, ASK_USER, CALL_MODEL, RUN_CODE. Decomposition stops when every leaf has an executable interpreter.
- Algorithm loop:
  - semantic parse, normalize entities, resolve references, infer types;
  - then repeat:
    - contradiction → CONFLICT;
    - answerable → execute and verify;
    - otherwise select an unresolved goal, find its methods (if none, the small LLM proposes a structure, marked as a hypothesis), apply the first method whose preconditions hold, add the subgoals;
    - missing information → ASK/OBSERVE;
    - competing interpretations → ask a discriminating question only if it changes the answer.
- The LLM only does: NL fragment → candidate frames, goal → goal type, unknown concept → candidate definition, unknown decomposition → candidate METHOD, ambiguous sentence → interpretations. Optional step: NL → semantic CNL (ACE-like) → SOP IR.
- Learning: a policy for choosing the rewrite method, from (problem state, goal) → method examples, not solving.
- CEGIS-style loop: candidate formalization → decomposition → execute → verify → counterexample, inconsistency or missing fact → refine.
- "Universal" means every input ends in a known state: SOLVED, PARTIALLY_FORMALIZED, AMBIGUOUS, MISSING_INFORMATION, MISSING_CONCEPT, MISSING_METHOD, UNSUPPORTED_PRIMITIVE or CONTRADICTORY. The machine always knows where formalization stopped.
- SOP formalization engine as graph rewriting of SOP wires: NL → IR0 → rewrite → … → executable SOP.
- First experiment: about 20–30 goal types, 30–50 decomposition operators, 6–10 interpreters, 500–2,000 diverse problems. Measure how many problems reduce to primitives by composition alone, without the LLM inventing reasoning; a quickly saturating coverage with a small method library would be a significant result.
