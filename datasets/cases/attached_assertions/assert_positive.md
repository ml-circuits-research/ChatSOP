# assert_positive

- family: attached_assertions
- split: train
- world: attached_train
- operators: assert, session, ground
- input_mode: assertions_query
- structure: assert__session__ground
- oracle: handwritten_graph_temporal







## Questions (surfaces → the same canonical target)

1. [en] Ana is a parent of Maria. Is Ana a parent of Maria?
2. [en] Given that Ana parents Maria, check the parent claim.
3. [en] Using the fact I supplied—Ana is a parent of Maria—does it hold?

## Attached assertions (model input at request time)

- "Ana is a parent of Maria." → `parent(ana, maria)` valid timeless

## Expected (independent oracle, never computed from the target)

- status: `"supported"`
- answers: `[[]]`
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
  where parent(ana, maria)

@r solve
  query $q
  after $store0

@answer cnl
  result $r
  language en
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision ac20503521b0ea6482fe565ef5af4e07658f486b70d52431b1868723a3df0c11). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
