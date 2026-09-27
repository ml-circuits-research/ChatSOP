# resolved_romanian_lab

- family: scoped_synonyms
- split: test
- world: employment_test
- operators: resolve, entity, romanian, type_organization
- input_mode: query_only
- evaluation_track: formalization
- structure: resolve__entity__romanian__type_organization
- oracle: handwritten_graph_temporal

- holdout: world

- resolve: {"text":"Laboratorul Alfa","language":"ro","id":"lab_alpha"}



## Questions (surfaces → the same canonical target)

1. [en] Does Ana work at Laboratorul Alfa?
2. [en] Check whether Ana works at the organization named Laboratorul Alfa.
3. [en] Is Laboratorul Alfa the recorded workplace of Ana?
4. [ro] Lucrează Ana la Laboratorul Alfa?  (Romanian surface; model intent remains canonical and language-independent)

## Expected (independent oracle, never computed from the target)

- status: `"supported"`
- answers: `[[]]`

## Declarative model target (canonical)

```sop
@q query
  where works_at ana "Laboratorul Alfa"
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
