# assert_reverse

- family: attached_assertions
- split: train
- world: attached_train
- operators: premise, conditional, argument_reversal
- input_mode: assertions_query
- evaluation_track: formalization
- structure: premise__conditional__argument_reversal
- oracle: handwritten_graph_temporal
- negative_of: assert_positive






## Questions (surfaces → the same canonical target)

1. [en] Ana is a parent of Maria. Is Maria a parent of Ana?
2. [en] Given that Ana parents Maria, check whether Maria parents Ana.
3. [en] Does Maria parent Ana if all I said was that Ana parents Maria?

## Attached assertions (conditional model premises; never repository facts)

- "Ana is a parent of Maria." → `parent ana maria` valid timeless

## Expected (independent oracle, never computed from the target)

- status: `"unknown"`
- answers: `[]`
- context_premises: `[{"holds":"parent ana maria","valid":"timeless","origin":"model-interpretation"}]`

## Declarative model target (canonical)

```sop
@premise0 premise
  holds parent ana maria
  valid timeless

@q query
  where parent maria ana
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision 702d7c99d93592ec3959d5748340ba1136bd25f1a9c100460e4de2d6ccb2d291). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
