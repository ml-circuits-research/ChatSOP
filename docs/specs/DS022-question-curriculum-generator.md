# DS022 — Question curriculum generator

## Scope and command

`tools/datasets/question-curriculum.mjs` projects the **synthetic, unreviewed** source scenarios from `tools/datasets/curriculum/cases.mjs` through the existing independent oracles in `build-curriculum.mjs`. It does not invent a world, a family, a target, or a new oracle. It does not generate training-approved examples or run a model. `skills/question-curriculum/SKILL.md` describes the workflow.

```sh
node tools/datasets/question-curriculum.mjs --family temporal --world temporal_train --seed 7 --limit 3
node tools/datasets/question-curriculum.mjs --seed 7 --limit 1000 | jq '{verification, inventory_families:(.inventory|length), gaps:[.rows[] | select(.status=="unsupported") | {case_id,reason}] | unique}'
node --test tests/question-curriculum.test.mjs
```

The CLI prints JSON with `inventory`, `verification`, and bounded `rows`. The default limit is 30; accepted limits are 1–1000, and `seed` is a safe integer. A fixed seed and source snapshot produce the same ordered rows. The sort is a SHA-256 ranking of `(seed, surface id)`; selection never moves a surface to a different split. `--family` and `--world` must name an actual listed family/world combination; omit either to include all matching source cases. The no-world blocked families emit one explicit gap record with a null question and null world, not a fabricated question.

Each executable row has `question`, `language`, `family`, `world`, `operators`, `split`, `split_group_id`, `target`, `host_setup`, optional `host_ontology`, `host_context`, `oracle`, and `expected`. The target contains **only `premise`, `query`, `constraint`** wires. `host_setup` contains independently supplied facts/rules/templates; it is not model output. `oracle.kind` identifies the independent graph/temporal, arithmetic-enumeration, assumption, or route source oracle, and `oracle.status` is its expectation, not a value calculated from runtime execution. Unsupported rows have `status: "unsupported"`, a nonempty `reason`, `expected.status: "unsupported"`, and `target: null`. They are not answerable golds. All rows carry `synthetic_unreviewed_not_training_approved` review status.

The verifier publishes host setup into a fresh isolated repository at the source's known-at date, initializes a fresh session and `new Runtime(...)` with the row's host ontology/schema, context, fixed time, `origin: 'model'`, and `allowWrite: false`, then **executes every executable surface**. A forbidden model wire, execution error, or disagreement between runtime status and independently calculated oracle fails the command; it does not overwrite the oracle or relabel a mismatch as success. There is no implicit inference of a causal explanation from a coincident observation. A successful generation is runtime agreement, **not** human review, dataset qualification, or semantic completeness beyond the source scenarios.

## Source-family/operator inventory

This list reflects the source `cases`, `assumptions`, `attached`, `numeric`, `extra`, and `blockedFamilies` arrays. The executable `questionInventory()` derives the inventory from these arrays; the table records the current source snapshot. Operators are source labels, not blanket claims of interpreter capability. A family can mix supported and unsupported constructs.

| Family | Source operators | Coverage/gap |
| --- | --- | --- |
| `abduction` | none in a question case | Blocked: explanations are hypotheses requiring separately judged abductive targets. |
| `agentive_intention` | none in a question case | Blocked: cannot infer knowing/intending/wanting from actions. |
| `approved_procedure` | `expand`, `finite_constraint`, `host_approved_library` | Host-only template expansion/presentation; not a declarative model target. |
| `assumption_boundary` | `assume`, `defeasible_rule`, `explicit_negation`, `ground` | Conditional premise and query; source assumption oracle. |
| `attached_assertions` | `argument_reversal`, `at`, `conditional`, `conflict`, `exclusive_end`, `explicit_negation`, `ground`, `no_query`, `premise`, `remember`, `session` | Conditional premises/query supported; `assert_only` is an explicit trusted `remember` gap, never model-authored recording. |
| `causal` | none in a question case | Blocked: temporal order/coincidence does not establish causal rules. |
| `causal_boundary` | `no_causal_inference`, `open_world` | Check the documented fact only; do not invent a causal link. |
| `clarification` | `ambiguous_reference`, `ambiguous_sense`, `lexical_holdout` | Unresolved reference/sense: explicit gap, host clarification cannot be authored as a model target. |
| `conjunction_join` | `and`, `ground`, `heterogeneous_predicates`, `select`, `select_multiple`, `shared_variable` | Source graph oracle; declarative query. |
| `counterfactual` | none in a question case | Blocked: intervention requires a separately judged simulation world. |
| `default_exception` | none in a question case | Blocked: no reviewed defeasible microtheory. |
| `expression_composition` | `arithmetic`, `finite_constraint`, `query`, `unique_output` | Declarative route query and finite constraint. |
| `finite_constraints` | `comparison`, `direction`, `finite_domain`, `possible`, `prove`, `strict_comparison` | Independent exhaustive finite enumeration. |
| `finite_outputs` | `comparison`, `count`, `finite_domain`, `nonunique_output`, `select`, `unique_output` | Query count/unique output supported; nonunique `finite_many` source presentation requires `solve`/`cnl`, so emits a gap. |
| `general_quantification` | none in a question case | Blocked: finite open-world facts do not imply closed-world universals. |
| `multi_hop` | `approved_rule`, `argument_reversal`, `role_inversion`, `select`, `two_hop` | Host rule plus declarative query. |
| `negation_openworld` | `conflict`, `explicit_negation`, `ground`, `negative_query`, `open_world`, `predicate_distinction` | Independent signed-fact oracle; unknown is not false. |
| `planning` | none in a question case | Blocked: no approved action model or goal criterion. |
| `relation_role` | `argument_reversal`, `binary`, `employed_by`, `ground`, `no_unapproved_rule`, `open_world`, `predicate_distinction`, `role_inversion`, `select` | Independent graph oracle. |
| `scoped_synonyms` | `entity`, `resolve`, `romanian`, `type_organization` | Named entity resolved by host lexicon; target remains declarative. |
| `temporal` | `asof`, `at`, `before_exclusive_end`, `before_start`, `bounded_interval`, `during`, `exclusive_end`, `explicit_negation`, `inclusive_start`, `knowledge_cutoff`, `open_world` | Dated source facts and independent temporal oracle. |
| `unsupported_boundary` | `abduction`, `causal_boundary`, `counterfactual`, `default_exception`, `missing_action_model`, `missing_causal_model`, `planning` | Explicit source questions with blocked-family reasons; never manufacture an answer. |

### Observed local run

With the source snapshot used for this spec, `node tools/datasets/question-curriculum.mjs --seed 7 --limit 1000` reported **22 inventoried families, 205 surfaces, 170 executed gold surfaces, 35 unsupported surfaces**. The unsupported IDs (deduplicated by case) were `ambiguous_bank`, `ambiguous_pronoun`, `assert_only`, `finite_many`, `route_approved_procedure`, `unsupported_cause`, `unsupported_counterfactual`, `unsupported_default`, `unsupported_plan`, plus seven no-world blocked-family gap rows. Counts are observations of this snapshot, not guaranteed quotas or review results.
