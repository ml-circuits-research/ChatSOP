# incident_conflict

- family: negation_openworld
- split: test
- world: incident_test
- operators: explicit_negation, conflict
- input_mode: query_only
- evaluation_track: formalization
- structure: explicit_negation__conflict
- oracle: handwritten_graph_temporal

- holdout: composition





## Questions (surfaces → the same canonical target)

1. [en] Is Alpha Lab’s network down, given both incident reports?
2. [en] Check the conflicting network-down claim at Alpha Lab.
3. [en] Do the Alpha Lab network observations agree?
4. [ro] Este rețeaua Laboratorului Alfa indisponibilă, având dovezi contradictorii?  (Romanian surface; model intent remains canonical and language-independent)

## Expected (independent oracle, never computed from the target)

- status: `"both"`
- answers: `[[]]`

## Declarative model target (canonical)

```sop
@q query
  where network_down lab_alpha
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
