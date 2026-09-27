# dev_time_window

- family: temporal
- split: dev
- world: temporal_dev
- operators: during, bounded_interval
- input_mode: query_only
- structure: during__bounded_interval
- oracle: handwritten_graph_temporal

- holdout: world
- time: {"during":"2025-04-01 2025-05-01"}




## Questions (surfaces → the same canonical target)

1. [en] Was Carina working at Alpha Lab at some point during April 2025?
2. [en] Check Carina’s Alpha Lab work within the April 2025 interval.
3. [en] Is Carina’s dated work applicable at any time from 1 April to 1 May 2025?

## Expected (independent oracle, never computed from the target)

- status: `"supported"`
- answers: `[[]]`

## SOP target (compiled, canonical)

```sop
@q query
  where works_at(carina, lab_alpha)
  during 2025-04-01 2025-05-01

@r solve
  query $q

@answer cnl
  result $r
  language en
```

## Host world background (oracle basis, NOT model input)

```sop
@record0 fact
  holds works_at(bogdan, lab_beta)
  valid 2024-03-01 2025-04-01
  source temporal_dev
  quote "Bogdan worked at Beta Lab from 2024-03-01 until 2025-04-01."

@record1 fact
  holds works_at(carina, lab_alpha)
  valid 2025-04-01 open
  source temporal_dev
  quote "Carina works at Alpha Lab starting 2025-04-01."
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision ac20503521b0ea6482fe565ef5af4e07658f486b70d52431b1868723a3df0c11). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
