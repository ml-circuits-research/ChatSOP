# incident_conflict

- family: negation_openworld
- split: test
- world: incident_test
- operators: explicit_negation, conflict
- input_mode: query_only
- structure: explicit_negation__conflict
- oracle: handwritten_graph_temporal

- holdout: composition





## Questions (surfaces → the same canonical target)

1. [en] Is Alpha Lab’s network down, given both incident reports?
2. [en] Check the conflicting network-down claim at Alpha Lab.
3. [en] Do the Alpha Lab network observations agree?
4. [ro] Este rețeaua Laboratorului Alfa indisponibilă, având dovezi contradictorii?  (Romanian surface; canonical target and internal CNL stay English)

## Expected (independent oracle, never computed from the target)

- status: `"both"`
- answers: `[[]]`

## SOP target (compiled, canonical)

```sop
@q query
  where network_down(lab_alpha)

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
