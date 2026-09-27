# dev_time_boundary

- family: temporal
- split: dev
- world: temporal_dev
- operators: at, exclusive_end
- input_mode: query_only
- evaluation_track: formalization
- structure: at__exclusive_end
- oracle: handwritten_graph_temporal

- holdout: world
- time: {"at":"2025-04-01"}




## Questions (surfaces → the same canonical target)

1. [en] Was Bogdan working at Beta Lab on 1 April 2025?
2. [en] Check the Beta Lab work fact at its exclusive endpoint.
3. [en] On the first day after March 2025, does the dated Beta Lab work apply?
4. [ro] Lucra Bogdan la Laboratorul Beta la 1 aprilie 2025?  (Romanian surface; model intent remains canonical and language-independent)

## Expected (independent oracle, never computed from the target)

- status: `"unknown"`
- answers: `[]`

## Declarative model target (canonical)

```sop
@q query
  where works_at bogdan lab_beta
  at 2025-04-01
```

## Host world background (oracle basis, NOT model input)

```sop
@record0 fact
  holds works_at bogdan lab_beta
  valid 2024-03-01 2025-04-01
  source temporal_dev
  quote "Bogdan worked at Beta Lab from 2024-03-01 until 2025-04-01."

@record1 fact
  holds works_at carina lab_alpha
  valid 2025-04-01 open
  source temporal_dev
  quote "Carina works at Alpha Lab starting 2025-04-01."
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision 702d7c99d93592ec3959d5748340ba1136bd25f1a9c100460e4de2d6ccb2d291). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
