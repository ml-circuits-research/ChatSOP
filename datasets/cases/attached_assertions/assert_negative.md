# assert_negative

- family: attached_assertions
- split: dev
- world: attached_dev
- operators: assert, session, explicit_negation
- input_mode: assertions_query
- structure: assert__session__explicit_negation
- oracle: handwritten_graph_temporal







## Questions (surfaces → the same canonical target)

1. [en] Bogdan is not a parent of Ana. Is Bogdan a parent of Ana?
2. [en] With my assertion that Bogdan does not parent Ana, check his parent relation to her.
3. [en] I state that Bogdan is not Ana’s parent. Is the positive claim supported?

## Attached assertions (model input at request time)

- "Bogdan is not a parent of Ana." → `not parent(bogdan, ana)` valid timeless

## Expected (independent oracle, never computed from the target)

- status: `"refuted"`
- answers: `[]`
- session_claims:
  - holds: `"not parent(bogdan, ana)"` · valid timeless · source user · quote "Bogdan is not a parent of Ana." · retention normal

## SOP target (compiled, canonical)

```sop
@userFact0 fact
  holds not parent(bogdan, ana)
  valid timeless
  source user
  quote "Bogdan is not a parent of Ana."

@store0 assert
  input $userFact0
  scope session

@q query
  where parent(bogdan, ana)

@r solve
  query $q
  after $store0

@answer cnl
  result $r
  language en
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision ac20503521b0ea6482fe565ef5af4e07658f486b70d52431b1868723a3df0c11). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
