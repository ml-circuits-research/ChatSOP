# assert_temporal

- family: attached_assertions
- split: dev
- world: attached_dev
- operators: premise, conditional, at, exclusive_end
- input_mode: assertions_query
- evaluation_track: formalization
- structure: premise__conditional__at__exclusive_end
- oracle: handwritten_graph_temporal

- holdout: composition
- time: {"at":"2025-06-01"}




## Questions (surfaces → the same canonical target)

1. [en] Maria worked at Alpha Lab from 1 January 2024 until 1 June 2025. Did she work there on 1 June 2025?
2. [en] Given Maria’s Alpha Lab work ending on 1 June 2025, check that exact day.
3. [en] I assert the work interval [2024-01-01, 2025-06-01). Does the work claim hold at its end?

## Attached assertions (conditional model premises; never repository facts)

- "Maria worked at Alpha Lab from 2024-01-01 until 2025-06-01." → `works_at maria lab_alpha` valid 2024-01-01 2025-06-01

## Expected (independent oracle, never computed from the target)

- status: `"unknown"`
- answers: `[]`
- context_premises: `[{"holds":"works_at maria lab_alpha","valid":"2024-01-01 2025-06-01","origin":"model-interpretation"}]`

## Declarative model target (canonical)

```sop
@premise0 premise
  holds works_at maria lab_alpha
  valid 2024-01-01 2025-06-01

@q query
  where works_at maria lab_alpha
  at 2025-06-01
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision 702d7c99d93592ec3959d5748340ba1136bd25f1a9c100460e4de2d6ccb2d291). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
