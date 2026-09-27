# finite_many

- family: finite_outputs
- split: test
- world: attached_test
- operators: finite_domain, nonunique_output, comparison
- input_mode: query_only
- evaluation_track: system
- structure: finite_domain__nonunique_output__comparison
- oracle: finite_enumeration

- holdout: composition





## Questions (surfaces → the same canonical target)

1. [en] If x is in [0,4] and at least 2, can x be at most 3? Return a value only if x is uniquely determined.
2. [en] Is x <= 3 possible with 2 <= x <= 4, and is there one uniquely forced x?
3. [en] For integer x in [0,4] with x >= 2, check feasibility of x <= 3; do not return a value unless unique.

## Expected (independent oracle, never computed from the target)

- status: `"possible"`
- packet: `{"outputProjection":{"?x":{"status":"ambiguous","candidates":3}}}`

## Trusted system circuit (not model target)

```sop
@c constraint
  var ?x int 0 4
  require ?x >= 2
  claim ?x <= 3
  task possible

@result solve
  constraint $c
  output ?x one

@answer cnl
  result $result
  language en
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision 702d7c99d93592ec3959d5748340ba1136bd25f1a9c100460e4de2d6ccb2d291). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
