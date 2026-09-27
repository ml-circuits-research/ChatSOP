# incident_absent_cause

- family: causal_boundary
- split: test
- world: incident_test
- operators: open_world, no_causal_inference
- input_mode: query_only
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

## SOP target (compiled, canonical)

```sop
@q query
  where outage(lab_beta)

@r solve
  query $q

@answer cnl
  result $r
  language en
```

## Host world background (oracle basis, NOT model input)

```sop
@record0 fact
  holds network_down(lab_alpha)
  valid timeless
  source incident_test
  quote "The network is down at Alpha Lab."

@record1 fact
  holds disk_full(lab_beta)
  valid timeless
  source incident_test
  quote "The disk at Beta Lab is full."

@record2 fact
  holds not network_down(lab_alpha)
  valid timeless
  source incident_test
  quote "The Alpha Lab network is not down."
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision ac20503521b0ea6482fe565ef5af4e07658f486b70d52431b1868723a3df0c11). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
