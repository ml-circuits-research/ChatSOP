# incident_absent_cause

- family: causal_boundary
- split: test
- world: incident_test
- operators: open_world, no_causal_inference
- input_mode: query_only
- evaluation_track: formalization
- structure: open_world__no_causal_inference
- oracle: handwritten_graph_temporal

- holdout: lexical





## Questions (surfaces → the same canonical target)

1. [en] Is there a documented outage at Beta Lab?
2. [en] Does a full disk alone establish an outage at Beta Lab?
3. [en] Check for an outage fact at Beta Lab without assuming a cause.

## Expected (independent oracle, never computed from the target)

- status: `"unknown"`
- answers: `[]`

## Declarative model target (canonical)

```sop
@q query
  where outage lab_beta
```

## Host world background (oracle basis, NOT model input)

```sop
@record0 fact
  holds network_down lab_alpha
  valid timeless
  source incident_test
  quote "The network is down at Alpha Lab."

@record1 fact
  holds disk_full lab_beta
  valid timeless
  source incident_test
  quote "The disk at Beta Lab is full."

@record2 fact
  holds not network_down lab_alpha
  valid timeless
  source incident_test
  quote "The Alpha Lab network is not down."
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision 702d7c99d93592ec3959d5748340ba1136bd25f1a9c100460e4de2d6ccb2d291). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
