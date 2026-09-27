# finite_not_entailed

- family: finite_constraints
- split: train
- world: attached_train
- operators: finite_domain, prove, comparison
- input_mode: query_only
- evaluation_track: formalization
- structure: finite_domain__prove__comparison
- oracle: finite_enumeration
- negative_of: finite_possible






## Questions (surfaces → the same canonical target)

1. [en] Must every number from 0 through 4 that is at least 2 equal 3?
2. [en] Does x >= 2 force x = 3 for integers in [0,4]?
3. [en] For integer x in [0,4] with x >= 2, is x = 3 required?

## Expected (independent oracle, never computed from the target)

- status: `"unknown"`

## Declarative model target (canonical)

```sop
@c constraint
  var ?x int 0 4
  require ?x >= 2
  claim ?x == 3
  task prove
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision 702d7c99d93592ec3959d5748340ba1136bd25f1a9c100460e4de2d6ccb2d291). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
