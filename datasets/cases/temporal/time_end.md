# time_end

- family: temporal
- split: train
- world: temporal_train
- operators: at, exclusive_end, explicit_negation
- input_mode: query_only
- evaluation_track: formalization
- structure: at__exclusive_end__explicit_negation
- oracle: handwritten_graph_temporal
- negative_of: time_last_day

- time: {"at":"2025-06-01"}




## Questions (surfaces → the same canonical target)

1. [en] Did Maria work at Alpha Lab on 1 June 2025?
2. [en] Check her Alpha Lab work exactly at the period’s exclusive end.
3. [en] What does the dated record say about her Alpha Lab work at the start of June 2025?

## Expected (independent oracle, never computed from the target)

- status: `"refuted"`
- answers: `[]`

## Declarative model target (canonical)

```sop
@q query
  where works_at maria lab_alpha
  at 2025-06-01
```

## Host world background (oracle basis, NOT model input)

```sop
@record0 fact
  holds works_at maria lab_alpha
  valid 2024-01-01 2025-06-01
  source temporal_train
  quote "Maria worked at Alpha Lab from 2024-01-01 until 2025-06-01."

@record1 fact
  holds not works_at maria lab_alpha
  valid 2025-06-01 2026-09-27
  source temporal_train
  quote "Maria did not work at Alpha Lab from 2025-06-01 until 2026-09-27."

@record2 fact
  holds works_at ana lab_beta
  valid 2025-01-01 open
  source temporal_train
  quote "Ana works at Beta Lab starting 2025-01-01."
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision 702d7c99d93592ec3959d5748340ba1136bd25f1a9c100460e4de2d6ccb2d291). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
