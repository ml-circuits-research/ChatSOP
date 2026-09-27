# test_employer_reverse

- family: relation_role
- split: test
- world: employment_test
- operators: role_inversion, select
- input_mode: query_only
- structure: role_inversion__select
- oracle: handwritten_graph_temporal

- holdout: romanian





## Questions (surfaces → the same canonical target)

1. [en] Which organization employs Carina?
2. [en] Who is Carina explicitly employed by?
3. [en] Name Carina’s employer from the records.
4. [ro] La ce organizație este angajată Carina?  (Romanian surface; canonical target and internal CNL stay English)

## Expected (independent oracle, never computed from the target)

- status: `"supported"`
- answers: `[["lab_beta"]]`

## SOP target (compiled, canonical)

```sop
@q query
  select ?org
  where employed_by(carina, ?org)

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
