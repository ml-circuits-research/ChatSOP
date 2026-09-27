# finite_possible

- family: finite_constraints
- split: train
- world: attached_train
- operators: finite_domain, possible, comparison
- input_mode: query_only
- structure: finite_domain__possible__comparison
- oracle: finite_enumeration







## Questions (surfaces → the same canonical target)

1. [en] Can a number from 0 through 4 that is at least 2 equal 3?
2. [en] Is x = 3 possible if x is an integer in [0,4] constrained to at least 2?
3. [en] Check whether some integer from 0 to 4 satisfying x >= 2 can equal 3.
4. [ro] Poate un întreg între 0 și 4, cel puțin 2, să fie 3?  (Romanian surface; canonical target and internal CNL stay English)

## Expected (independent oracle, never computed from the target)

- status: `"possible"`

## SOP target (compiled, canonical)

```sop
@c constraint
  var ?x int 0 4
  require ?x >= 2
  claim ?x == 3
  task possible

@r solve
  constraint $c

@answer cnl
  result $r
  language en
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision ac20503521b0ea6482fe565ef5af4e07658f486b70d52431b1868723a3df0c11). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
