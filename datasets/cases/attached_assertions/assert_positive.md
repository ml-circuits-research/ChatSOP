# assert_positive

- family: attached_assertions
- split: train
- world: attached_train
- operators: premise, conditional, ground
- input_mode: assertions_query
- evaluation_track: formalization
- structure: premise__conditional__ground
- oracle: handwritten_graph_temporal







## Questions (surfaces → the same canonical target)

1. [en] Ana is a parent of Maria. Is Ana a parent of Maria?
2. [en] Given that Ana parents Maria, check the parent claim.
3. [en] Using the fact I supplied—Ana is a parent of Maria—does it hold?

## Attached assertions (conditional model premises; never repository facts)

- "Ana is a parent of Maria." → `parent ana maria` valid timeless

## Expected (independent oracle, never computed from the target)

- status: `"supported"`
- answers: `[[]]`
- packet: `{"hypothetical":true}`
- context_premises: `[{"holds":"parent ana maria","valid":"timeless","origin":"model-interpretation"}]`

## Declarative model target (canonical)

```sop
@premise0 premise
  holds parent ana maria
  valid timeless

@q query
  where parent ana maria
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision 702d7c99d93592ec3959d5748340ba1136bd25f1a9c100460e4de2d6ccb2d291). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
