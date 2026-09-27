# finite_refuted

- family: finite_constraints
- split: train
- world: attached_train
- operators: finite_domain, prove, strict_comparison
- input_mode: query_only
- evaluation_track: formalization
- structure: finite_domain__prove__strict_comparison
- oracle: finite_enumeration







## Questions (surfaces → the same canonical target)

1. [en] Can all numbers at least 2 in [0,4] be below 2?
2. [en] Does x >= 2 entail x < 2 over integers 0 to 4?
3. [en] For an integer x in [0,4] satisfying x >= 2, prove the claim x < 2 if true.

## Expected (independent oracle, never computed from the target)

- status: `"refuted"`

## Declarative model target (canonical)

```sop
@c constraint
  var ?x int 0 4
  require ?x >= 2
  claim ?x < 2
  task prove
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision 702d7c99d93592ec3959d5748340ba1136bd25f1a9c100460e4de2d6ccb2d291). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
