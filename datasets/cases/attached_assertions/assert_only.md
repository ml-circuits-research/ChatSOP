# assert_only

- family: attached_assertions
- split: train
- world: attached_train
- operators: assert, session, no_query
- input_mode: assertions_query
- structure: assert__session__no_query
- oracle: handwritten_graph_temporal







## Questions (surfaces → the same canonical target)

1. [en] Record this for the present session: Ana works at Beta Lab.
2. [en] For this conversation, note that Ana works at Beta Lab.
3. [en] Keep in this session the fact that Ana works at Beta Lab.

## Attached assertions (model input at request time)

- "Ana works at Beta Lab." → `works_at(ana, lab_beta)` valid timeless

## Expected (independent oracle, never computed from the target)

- status: `"stored"`
- packet: `{"count":1}`
- session_claims:
  - holds: `"works_at(ana, lab_beta)"` · valid timeless · source user · quote "Ana works at Beta Lab." · retention normal

## SOP target (compiled, canonical)

```sop
@userFact0 fact
  holds works_at(ana, lab_beta)
  valid timeless
  source user
  quote "Ana works at Beta Lab."

@store0 assert
  input $userFact0
  scope session
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision ac20503521b0ea6482fe565ef5af4e07658f486b70d52431b1868723a3df0c11). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
