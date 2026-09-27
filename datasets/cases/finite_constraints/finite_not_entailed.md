# finite_not_entailed

- family: finite_constraints
- split: train
- world: attached_train
- operators: finite_domain, prove, comparison
- input_mode: query_only
- structure: finite_domain__prove__comparison
- oracle: finite_enumeration
- negative_of: finite_possible






## Questions (surfaces → the same canonical target)

1. [en] Must every number from 0 through 4 that is at least 2 equal 3?
2. [en] Does x >= 2 force x = 3 for integers in [0,4]?
3. [en] For integer x in [0,4] with x >= 2, is x = 3 required?

## Expected (independent oracle, never computed from the target)

- status: `"unknown"`

## SOP target (compiled, canonical)

```sop
@c constraint
  var ?x int 0 4
  require ?x >= 2
  claim ?x == 3
  task prove

@r solve
  constraint $c

@answer cnl
  result $r
  language en
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision ac20503521b0ea6482fe565ef5af4e07658f486b70d52431b1868723a3df0c11). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
