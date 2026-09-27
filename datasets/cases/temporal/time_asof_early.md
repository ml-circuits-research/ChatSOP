# time_asof_early

- family: temporal
- split: train
- world: temporal_train
- operators: at, asof, knowledge_cutoff
- input_mode: query_only
- evaluation_track: formalization
- structure: at__asof__knowledge_cutoff
- oracle: handwritten_graph_temporal


- time: {"at":"2024-05-01","asof":"2023-12-31"}




## Questions (surfaces → the same canonical target)

1. [en] From the records known by 31 December 2023, was Maria working at Alpha Lab on 1 May 2024?
2. [en] Using only information available before 2024, check her Alpha Lab work on 1 May 2024.
3. [en] As known at the end of 2023, does the 1 May 2024 work claim have support?

## Expected (independent oracle, never computed from the target)

- status: `"unknown"`
- answers: `[]`

## Declarative model target (canonical)

```sop
@q query
  where works_at maria lab_alpha
  at 2024-05-01
  asof 2023-12-31
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
