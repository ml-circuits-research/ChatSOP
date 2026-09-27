# time_interval

- family: temporal
- split: train
- world: temporal_train
- operators: during, bounded_interval
- input_mode: query_only
- evaluation_track: formalization
- structure: during__bounded_interval
- oracle: handwritten_graph_temporal


- time: {"during":"2024-04-01 2024-05-01"}




## Questions (surfaces → the same canonical target)

1. [en] Was Maria working at Alpha Lab at some point during April 2024?
2. [en] Check for evidence of Maria’s Alpha Lab work during 1 April to 1 May 2024.
3. [en] Within the April 2024 interval, is Maria’s Alpha Lab work recorded?

## Expected (independent oracle, never computed from the target)

- status: `"supported"`
- answers: `[[]]`

## Declarative model target (canonical)

```sop
@q query
  where works_at maria lab_alpha
  during 2024-04-01 2024-05-01
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
