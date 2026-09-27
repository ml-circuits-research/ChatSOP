# resolved_romanian_lab

- family: scoped_synonyms
- split: test
- world: employment_test
- operators: resolve, entity, romanian, type_organization
- input_mode: query_only
- structure: resolve__entity__romanian__type_organization
- oracle: handwritten_graph_temporal

- holdout: world

- resolve: {"text":"Laboratorul Alfa","language":"ro","id":"lab_alpha"}



## Questions (surfaces → the same canonical target)

1. [en] Does Ana work at Laboratorul Alfa?
2. [en] Check whether Ana works at the organization named Laboratorul Alfa.
3. [en] Is Laboratorul Alfa the recorded workplace of Ana?
4. [ro] Lucrează Ana la Laboratorul Alfa?  (Romanian surface; canonical target and internal CNL stay English)

## Expected (independent oracle, never computed from the target)

- status: `"supported"`
- answers: `[[]]`

## SOP target (compiled, canonical)

```sop
@alias resolve
  text "Laboratorul Alfa"
  language ro
  kind entity
  type organization

@q query
  where works_at(ana, $alias)

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
