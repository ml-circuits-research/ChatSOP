# assert_reverse

- family: attached_assertions
- split: train
- world: attached_train
- operators: assert, session, argument_reversal
- input_mode: assertions_query
- structure: assert__session__argument_reversal
- oracle: handwritten_graph_temporal
- negative_of: assert_positive






## Questions (surfaces → the same canonical target)

1. [en] Ana is a parent of Maria. Is Maria a parent of Ana?
2. [en] Given that Ana parents Maria, check whether Maria parents Ana.
3. [en] Does Maria parent Ana if all I said was that Ana parents Maria?

## Attached assertions (model input at request time)

- "Ana is a parent of Maria." → `parent(ana, maria)` valid timeless

## Expected (independent oracle, never computed from the target)

- status: `"unknown"`
- answers: `[]`
- session_claims:
  - holds: `"parent(ana, maria)"` · valid timeless · source user · quote "Ana is a parent of Maria." · retention normal

## SOP target (compiled, canonical)

```sop
@userFact0 fact
  holds parent(ana, maria)
  valid timeless
  source user
  quote "Ana is a parent of Maria."

@store0 assert
  input $userFact0
  scope session

@q query
  where parent(maria, ana)

@r solve
  query $q
  after $store0

@answer cnl
  result $r
  language en
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision ac20503521b0ea6482fe565ef5af4e07658f486b70d52431b1868723a3df0c11). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
