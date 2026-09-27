# test_reversed_chain

- family: multi_hop
- split: test
- world: family_test
- operators: two_hop, argument_reversal
- input_mode: query_only
- evaluation_track: formalization
- structure: two_hop__argument_reversal
- oracle: handwritten_graph_temporal
- negative_of: test_chain
- holdout: world





## Questions (surfaces → the same canonical target)

1. [en] Is Maria a grandparent of Ana?
2. [en] Trace whether a parent-of-parent chain goes from Maria to Ana.
3. [en] Check Maria’s two-generation relation to Ana.

## Expected (independent oracle, never computed from the target)

- status: `"unknown"`
- answers: `[]`

## Declarative model target (canonical)

```sop
@q query
  where grandparent maria ana
```

## Host world background (oracle basis, NOT model input)

```sop
@record0 fact
  holds parent ana carina
  valid timeless
  source family_test
  quote "Ana is a parent of Carina."

@record1 fact
  holds parent carina maria
  valid timeless
  source family_test
  quote "Carina is a parent of Maria."

@record2 fact
  holds parent bogdan maria
  valid timeless
  source family_test
  quote "Bogdan is a parent of Maria."

@record3 fact
  holds not parent bogdan maria
  valid timeless
  source family_test
  quote "Bogdan is not a parent of Maria."

@grandparentRule rule
  when parent ?x ?y
  when parent ?y ?z
  then grandparent ?x ?z
  source family_test
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision 702d7c99d93592ec3959d5748340ba1136bd25f1a9c100460e4de2d6ccb2d291). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
