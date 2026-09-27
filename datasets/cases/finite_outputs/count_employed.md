# count_employed

- family: finite_outputs
- split: train
- world: employment_train
- operators: count, select
- input_mode: query_only
- structure: count__select
- oracle: handwritten_graph_temporal







## Questions (surfaces → the same canonical target)

1. [en] How many recorded people are employed by Alpha Lab?
2. [en] Count the distinct people with positive employment support at Alpha Lab.
3. [en] What is the count of Alpha Lab employees in these records?

## Expected (independent oracle, never computed from the target)

- status: `"supported"`
- answers: `[["bogdan"]]`
- packet: `{"count":1}`

## SOP target (compiled, canonical)

```sop
@q query
  mode count
  select ?worker
  where employed_by(?worker, lab_alpha)

@r solve
  query $q

@answer cnl
  result $r
  language en
```

## Host world background (oracle basis, NOT model input)

```sop
@record0 fact
  holds works_at(maria, lab_alpha)
  valid timeless
  source employment_train
  quote "Maria works at Alpha Lab."

@record1 fact
  holds works_at(ana, lab_beta)
  valid timeless
  source employment_train
  quote "Ana works at Beta Lab."

@record2 fact
  holds employed_by(bogdan, lab_alpha)
  valid timeless
  source employment_train
  quote "Bogdan is employed by Alpha Lab."

@record3 fact
  holds project_member(maria, project_delta)
  valid timeless
  source employment_train
  quote "Maria is a member of Delta Project."

@record4 fact
  holds not employed_by(ana, lab_alpha)
  valid timeless
  source employment_train
  quote "Ana is not employed by Alpha Lab."
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision ac20503521b0ea6482fe565ef5af4e07658f486b70d52431b1868723a3df0c11). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
