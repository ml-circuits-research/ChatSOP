# test_join_work_project

- family: conjunction_join
- split: test
- world: employment_test
- operators: and, heterogeneous_predicates, select
- input_mode: query_only
- evaluation_track: formalization
- structure: and__heterogeneous_predicates__select
- oracle: handwritten_graph_temporal

- holdout: composition





## Questions (surfaces → the same canonical target)

1. [en] Who works at Alpha Lab while participating in Delta Project?
2. [en] Find the Delta Project participant with an Alpha Lab workplace.
3. [en] Give people appearing in both the Alpha Lab work and Delta Project membership lists.

## Expected (independent oracle, never computed from the target)

- status: `"supported"`
- answers: `[["ana"]]`

## Declarative model target (canonical)

```sop
@q query
  select ?member
  where works_at ?member lab_alpha
  where project_member ?member project_delta
```

## Host world background (oracle basis, NOT model input)

```sop
@record0 fact
  holds works_at ana lab_alpha
  valid timeless
  source employment_test
  quote "Ana works at Alpha Lab."

@record1 fact
  holds works_at bogdan lab_beta
  valid timeless
  source employment_test
  quote "Bogdan works at Beta Lab."

@record2 fact
  holds employed_by carina lab_beta
  valid timeless
  source employment_test
  quote "Carina is employed by Beta Lab."

@record3 fact
  holds project_member ana project_delta
  valid timeless
  source employment_test
  quote "Ana is a member of Delta Project."
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision 702d7c99d93592ec3959d5748340ba1136bd25f1a9c100460e4de2d6ccb2d291). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
