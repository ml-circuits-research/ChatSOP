# finite_direction

- family: finite_constraints
- split: test
- world: attached_test
- operators: finite_domain, direction, strict_comparison
- input_mode: query_only
- evaluation_track: formalization
- structure: finite_domain__direction__strict_comparison
- oracle: finite_enumeration

- holdout: operator





## Questions (surfaces → the same canonical target)

1. [en] Could an integer x between 2 and 4 exceed 3?
2. [en] Is x > 3 feasible when 2 <= x <= 4?
3. [en] Among the integers from 2 through 4, is there any value greater than 3?

## Expected (independent oracle, never computed from the target)

- status: `"possible"`

## Declarative model target (canonical)

```sop
@c constraint
  var ?x int 0 4
  require ?x >= 2
  claim ?x > 3
  task possible
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision 702d7c99d93592ec3959d5748340ba1136bd25f1a9c100460e4de2d6ccb2d291). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
