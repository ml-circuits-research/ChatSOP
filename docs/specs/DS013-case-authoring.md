---
title: DS013-case-authoring
summary: Deterministic case Markdown compilation, unreviewed provenance, and semantic split boundaries.
---

## Authoring contract

`tools/datasets/curriculum/cases.mjs` remains the baseline generator for the existing export; `datasets/cases/<family>/<case>.md` is an editable, per-case authoring input for the **separate** compiler. Run `node tools/datasets/authoring/compile-case.mjs --case datasets/cases/relation_role/parent_forward.md --out <case.jsonl>` to create a case-specific JSONL. The output is **not** a qualified training dataset and does not silently replace `datasets/query-v1/` or the sealed evaluation suite. The compiler reads the expected values written in the Markdown independently of the SOP target, checks them with the runtime oracle, then writes only if all rows pass. Edits to questions, existing expected JSON values, canonical target SOP or existing background SOP are supported; changing headings, metadata, field names, surface count, order, family or split fails closed. On regeneration from compiled rows, `caseDocument` returns the exact edited Markdown bytes. `build-cases-md.mjs --check` still audits the committed baseline tree against `cases.mjs`; an in-place Markdown edit needs a separate case compilation, not a baseline regeneration that discards the edit. For experimentation, copy the Markdown to a matching family directory beneath a separate root and call `compileCase({file,out,dir})`.

Every compiled row passes `validateRecord` and `validateCorpus`, then `validateAuthoringRecord`, and carries `authoring.split_key` (the stable `split_group_id`), `profile`, SHA-256 hashes of the actual Markdown, parser implementation, prompt implementation and effective ontology. The source provenance checksum and generation trace remain required. These fingerprints are reproducibility labels, **not** reviewed semantics: the trace remains `synthetic_unreviewed`, authoring review status is `integrator-authored-not-human-validated`, and both `human_reviewed` and `training_approved` remain false. A parse or runtime pass cannot establish independent human semantic adjudication.

## Frozen current family/operator inventory

This is the inventory in `cases.mjs` at this specification's introduction. Family names and operator labels identify coverage, not authority to add new SOP wires. Model-origin targets contain only `premise`, `query`, `constraint`; `remember`, `clarify`, approved expansion and other execution operations stay on the system track.

| Family | Operators |
| --- | --- |
| approved_procedure | expand, finite_constraint, host_approved_library |
| assumption_boundary | assume, defeasible_rule, explicit_negation, ground |
| attached_assertions | argument_reversal, at, conditional, conflict, exclusive_end, explicit_negation, ground, no_query, premise, remember, session |
| causal_boundary | no_causal_inference, open_world |
| clarification | ambiguous_reference, ambiguous_sense, lexical_holdout |
| conjunction_join | and, ground, heterogeneous_predicates, select, select_multiple, shared_variable |
| expression_composition | arithmetic, finite_constraint, query, unique_output |
| finite_constraints | comparison, direction, finite_domain, possible, prove, strict_comparison |
| finite_outputs | comparison, count, finite_domain, nonunique_output, select, unique_output |
| multi_hop | approved_rule, argument_reversal, role_inversion, select, two_hop |
| negation_openworld | conflict, explicit_negation, ground, negative_query, open_world, predicate_distinction |
| relation_role | argument_reversal, binary, employed_by, ground, no_unapproved_rule, open_world, predicate_distinction, role_inversion, select |
| scoped_synonyms | entity, resolve, romanian, type_organization |
| temporal | asof, at, before_exclusive_end, before_start, bounded_interval, during, exclusive_end, explicit_negation, inclusive_start, knowledge_cutoff, open_world |
| unsupported_boundary | abduction, causal_boundary, counterfactual, default_exception, missing_action_model, missing_causal_model, planning |

Reserved `composition` cases and ordered structures (from the current rows): `join_pairs` (dev) and `test_join_pairs` (test): `and__shared_variable__select_multiple`; `test_join_work_project` (test): `and__heterogeneous_predicates__select`; `incident_conflict` (test): `explicit_negation__conflict`; `route_expression` (dev): `query__unique_output__arithmetic__finite_constraint`; `route_approved_procedure` (dev, system): `expand__host_approved_library__finite_constraint`; `assert_conflict` (test): `premise__conditional__conflict`; `assert_temporal` (dev): `premise__conditional__at__exclusive_end`; `finite_many` (test, system): `finite_domain__nonunique_output__comparison`. These are declarations of reserved examples, not proof that each component is unique to a split.

## Split policy and observed overlap

**CI-enforced semantic boundary:** `validateCorpus` checks that every surface of a `semantic_case_id`, every `split_group_id` and every `negative_of` contrast remains inside one train/dev/test partition; it computes their transitive connected components. A family or structure label alone does not establish semantic identity. Existing manifests intentionally split by world and allow templates to recur across splits. **Advisory/opt-in:** `validateFamilyStructureIsolation(rows)` demands stronger family-or-structure component isolation for a new collection; applying it to this established curriculum correctly fails. Do not misreport that failure as semantic-case leakage or rewrite the sealed exports.

Current cross-split **family** recurrence, measured from the generator: `relation_role` train/test; `negation_openworld`, `multi_hop`, `conjunction_join`, `finite_outputs`, `attached_assertions` train/dev/test; `temporal` train/dev; `scoped_synonyms` train/test; `finite_constraints` train/test; `clarification` train/test; `unsupported_boundary` dev/test. Cross-split **identical structure** recurrence: `and__shared_variable__select_multiple` dev/test (`join_pairs`, `test_join_pairs`); `explicit_negation__conflict` dev/test (`conflicted_parent`, `incident_conflict`); `during__bounded_interval` train/dev (`time_interval`, `dev_time_window`). These are real overlap facts, not a cross-split connected semantic group under the CI policy.
