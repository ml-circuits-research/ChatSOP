# test_join_pairs

- family: conjunction_join
- split: test
- world: family_test
- operators: and, shared_variable, select_multiple
- input_mode: query_only
- structure: and__shared_variable__select_multiple
- oracle: handwritten_graph_temporal

- holdout: composition





## Questions (surfaces → the same canonical target)

1. [en] Which grandparent and grandchild form each two-parent-link pair?
2. [en] Give all endpoint pairs for parent-to-parent paths.
3. [en] Return the older–younger pairs linked through an intermediate parent.

## Expected (independent oracle, never computed from the target)

- status: `"supported"`
- answers: `[["ana","maria"]]`

## SOP target (compiled, canonical)

```sop
@q query
  select ?older ?younger
  where parent(?older, ?middle)
  where parent(?middle, ?younger)

@r solve
  query $q

@answer cnl
  result $r
  language en
```

## Host world background (oracle basis, NOT model input)

```sop
@record0 fact
  holds parent(ana, carina)
  valid timeless
  source family_test
  quote "Ana is a parent of Carina."

@record1 fact
  holds parent(carina, maria)
  valid timeless
  source family_test
  quote "Carina is a parent of Maria."

@record2 fact
  holds parent(bogdan, maria)
  valid timeless
  source family_test
  quote "Bogdan is a parent of Maria."

@record3 fact
  holds not parent(bogdan, maria)
  valid timeless
  source family_test
  quote "Bogdan is not a parent of Maria."

@grandparentRule rule
  when parent(?x, ?y)
  when parent(?y, ?z)
  then grandparent(?x, ?z)
  source family_test
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision ac20503521b0ea6482fe565ef5af4e07658f486b70d52431b1868723a3df0c11). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
