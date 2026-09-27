# assert_negative

- family: attached_assertions
- split: dev
- world: attached_dev
- operators: premise, conditional, explicit_negation
- input_mode: assertions_query
- evaluation_track: formalization
- structure: premise__conditional__explicit_negation
- oracle: handwritten_graph_temporal







## Questions (surfaces → the same canonical target)

1. [en] Bogdan is not a parent of Ana. Is Bogdan a parent of Ana?
2. [en] With my assertion that Bogdan does not parent Ana, check his parent relation to her.
3. [en] I state that Bogdan is not Ana’s parent. Is the positive claim supported?

## Attached assertions (conditional model premises; never repository facts)

- "Bogdan is not a parent of Ana." → `not parent bogdan ana` valid timeless

## Expected (independent oracle, never computed from the target)

- status: `"refuted"`
- answers: `[]`
- packet: `{"hypothetical":true}`
- context_premises: `[{"holds":"not parent bogdan ana","valid":"timeless","origin":"model-interpretation"}]`

## Declarative model target (canonical)

```sop
@premise0 premise
  holds not parent bogdan ana
  valid timeless

@q query
  where parent bogdan ana
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision 702d7c99d93592ec3959d5748340ba1136bd25f1a9c100460e4de2d6ccb2d291). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
