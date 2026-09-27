# assert_temporal

- family: attached_assertions
- split: dev
- world: attached_dev
- operators: assert, session, at, exclusive_end
- input_mode: assertions_query
- structure: assert__session__at__exclusive_end
- oracle: handwritten_graph_temporal

- holdout: composition
- time: {"at":"2025-06-01"}




## Questions (surfaces → the same canonical target)

1. [en] Maria worked at Alpha Lab from 1 January 2024 until 1 June 2025. Did she work there on 1 June 2025?
2. [en] Given Maria’s Alpha Lab work ending on 1 June 2025, check that exact day.
3. [en] I assert the work interval [2024-01-01, 2025-06-01). Does the work claim hold at its end?

## Attached assertions (model input at request time)

- "Maria worked at Alpha Lab from 2024-01-01 until 2025-06-01." → `works_at(maria, lab_alpha)` valid 2024-01-01 2025-06-01

## Expected (independent oracle, never computed from the target)

- status: `"unknown"`
- answers: `[]`
- session_claims:
  - holds: `"works_at(maria, lab_alpha)"` · valid 2024-01-01 2025-06-01 · source user · quote "Maria worked at Alpha Lab from 2024-01-01 until 2025-06-01." · retention normal

## SOP target (compiled, canonical)

```sop
@userFact0 fact
  holds works_at(maria, lab_alpha)
  valid 2024-01-01 2025-06-01
  source user
  quote "Maria worked at Alpha Lab from 2024-01-01 until 2025-06-01."

@store0 assert
  input $userFact0
  scope session

@q query
  where works_at(maria, lab_alpha)
  at 2025-06-01

@r solve
  query $q
  after $store0

@answer cnl
  result $r
  language en
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision ac20503521b0ea6482fe565ef5af4e07658f486b70d52431b1868723a3df0c11). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
