# test_work_reverse

- family: relation_role
- split: test
- world: employment_test
- operators: role_inversion, select
- input_mode: query_only
- structure: role_inversion__select
- oracle: handwritten_graph_temporal

- holdout: world





## Questions (surfaces → the same canonical target)

1. [en] Who works at Beta Lab?
2. [en] Name the people whose workplace is Beta Lab.
3. [en] Find the person recorded as working at Beta Lab.

## Expected (independent oracle, never computed from the target)

- status: `"supported"`
- answers: `[["bogdan"]]`

## SOP target (compiled, canonical)

```sop
@q query
  select ?person
  where works_at(?person, lab_beta)

@r solve
  query $q

@answer cnl
  result $r
  language en
```

## Host world background (oracle basis, NOT model input)

```sop
@record0 fact
  holds works_at(ana, lab_alpha)
  valid timeless
  source employment_test
  quote "Ana works at Alpha Lab."

@record1 fact
  holds works_at(bogdan, lab_beta)
  valid timeless
  source employment_test
  quote "Bogdan works at Beta Lab."

@record2 fact
  holds employed_by(carina, lab_beta)
  valid timeless
  source employment_test
  quote "Carina is employed by Beta Lab."

@record3 fact
  holds project_member(ana, project_delta)
  valid timeless
  source employment_test
  quote "Ana is a member of Delta Project."
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision ac20503521b0ea6482fe565ef5af4e07658f486b70d52431b1868723a3df0c11). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
