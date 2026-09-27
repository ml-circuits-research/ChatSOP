# test_employer_reverse

- family: relation_role
- split: test
- world: employment_test
- operators: role_inversion, select
- input_mode: query_only
- evaluation_track: formalization
- structure: role_inversion__select
- oracle: handwritten_graph_temporal

- holdout: romanian





## Questions (surfaces → the same canonical target)

1. [en] Which organization employs Carina?
2. [en] Who is Carina explicitly employed by?
3. [en] Name Carina’s employer from the records.
4. [ro] La ce organizație este angajată Carina?  (Romanian surface; model intent remains canonical and language-independent)

## Expected (independent oracle, never computed from the target)

- status: `"supported"`
- answers: `[["lab_beta"]]`

## Declarative model target (canonical)

```sop
@q query
  select ?org
  where employed_by carina ?org
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
