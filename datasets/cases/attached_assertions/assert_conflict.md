# assert_conflict

- family: attached_assertions
- split: test
- world: attached_test
- operators: assert, session, conflict
- input_mode: assertions_query
- structure: assert__session__conflict
- oracle: handwritten_graph_temporal

- holdout: composition





## Questions (surfaces → the same canonical target)

1. [en] Carina works at Beta Lab; Carina does not work at Beta Lab. What is the status of that work claim?
2. [en] Given both assertions about Carina’s Beta Lab work, check the claim without choosing a side.
3. [en] I say Carina works and does not work at Beta Lab. Does the record support her work there?
4. [ro] Carina lucrează și nu lucrează la Laboratorul Beta. Ce spun ambele afirmații?  (Romanian surface; canonical target and internal CNL stay English)

## Attached assertions (model input at request time)

- "Carina works at Beta Lab." → `works_at(carina, lab_beta)` valid timeless
- "Carina does not work at Beta Lab." → `not works_at(carina, lab_beta)` valid timeless

## Expected (independent oracle, never computed from the target)

- status: `"both"`
- answers: `[[]]`
- session_claims:
  - holds: `"works_at(carina, lab_beta)"` · valid timeless · source user · quote "Carina works at Beta Lab." · retention normal
  - holds: `"not works_at(carina, lab_beta)"` · valid timeless · source user · quote "Carina does not work at Beta Lab." · retention normal

## SOP target (compiled, canonical)

```sop
@userFact0 fact
  holds works_at(carina, lab_beta)
  valid timeless
  source user
  quote "Carina works at Beta Lab."

@store0 assert
  input $userFact0
  scope session

@userFact1 fact
  holds not works_at(carina, lab_beta)
  valid timeless
  source user
  quote "Carina does not work at Beta Lab."

@store1 assert
  input $userFact1
  scope session

@q query
  where works_at(carina, lab_beta)

@r solve
  query $q
  after $store0
  after $store1

@answer cnl
  result $r
  language en
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision ac20503521b0ea6482fe565ef5af4e07658f486b70d52431b1868723a3df0c11). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
