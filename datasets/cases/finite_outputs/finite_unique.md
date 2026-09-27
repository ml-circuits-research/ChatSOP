# finite_unique

- family: finite_outputs
- split: dev
- world: attached_dev
- operators: finite_domain, unique_output, comparison
- input_mode: query_only
- structure: finite_domain__unique_output__comparison
- oracle: finite_enumeration







## Questions (surfaces → the same canonical target)

1. [en] For an integer x in [0,4] exactly 2 plus 1, is x at most 3 and what unique value is x?
2. [en] For integer x in [0,4] with x = 2 + 1, check x <= 3 and return x.
3. [en] Given x in [0,4] and x = 2 + 1, determine its sole value and test x <= 3.

## Expected (independent oracle, never computed from the target)

- status: `"possible"`
- outputs: `{"x":3}`

## SOP target (compiled, canonical)

```sop
@c constraint
  var ?x int 0 4
  require ?x == 2 + 1
  claim ?x <= 3
  task possible

@r solve
  constraint $c
  output ?x one

@answer cnl
  result $r
  language en
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision ac20503521b0ea6482fe565ef5af4e07658f486b70d52431b1868723a3df0c11). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
