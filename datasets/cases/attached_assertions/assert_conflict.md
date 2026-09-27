# assert_conflict

- family: attached_assertions
- split: test
- world: attached_test
- operators: premise, conditional, conflict
- input_mode: assertions_query
- evaluation_track: formalization
- structure: premise__conditional__conflict
- oracle: handwritten_graph_temporal

- holdout: composition





## Questions (surfaces → the same canonical target)

1. [en] Carina works at Beta Lab; Carina does not work at Beta Lab. What is the status of that work claim?
2. [en] Given both assertions about Carina’s Beta Lab work, check the claim without choosing a side.
3. [en] I say Carina works and does not work at Beta Lab. Does the record support her work there?
4. [ro] Carina lucrează și nu lucrează la Laboratorul Beta. Ce spun ambele afirmații?  (Romanian surface; model intent remains canonical and language-independent)

## Attached assertions (conditional model premises; never repository facts)

- "Carina works at Beta Lab." → `works_at carina lab_beta` valid timeless
- "Carina does not work at Beta Lab." → `not works_at carina lab_beta` valid timeless

## Expected (independent oracle, never computed from the target)

- status: `"both"`
- answers: `[[]]`
- packet: `{"hypothetical":true}`
- context_premises: `[{"holds":"works_at carina lab_beta","valid":"timeless","origin":"model-interpretation"},{"holds":"not works_at carina lab_beta","valid":"timeless","origin":"model-interpretation"}]`

## Declarative model target (canonical)

```sop
@premise0 premise
  holds works_at carina lab_beta
  valid timeless

@premise1 premise
  holds not works_at carina lab_beta
  valid timeless

@q query
  where works_at carina lab_beta
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision 702d7c99d93592ec3959d5748340ba1136bd25f1a9c100460e4de2d6ccb2d291). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
