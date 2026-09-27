# join_pairs

- family: conjunction_join
- split: dev
- world: family_dev
- operators: and, shared_variable, select_multiple
- input_mode: query_only
- evaluation_track: formalization
- structure: and__shared_variable__select_multiple
- oracle: handwritten_graph_temporal

- holdout: composition





## Questions (surfaces → the same canonical target)

1. [en] List every grandparent–grandchild pair via a common parent.
2. [en] Which older and younger people share a two-link parent chain?
3. [en] Return each pair at the ends of an explicit parent-parent path.

## Expected (independent oracle, never computed from the target)

- status: `"supported"`
- answers: `[["maria","ana"]]`

## Declarative model target (canonical)

```sop
@q query
  select ?older ?younger
  where parent ?older ?middle
  where parent ?middle ?younger
```

## Host world background (oracle basis, NOT model input)

```sop
@record0 fact
  holds parent maria bogdan
  valid timeless
  source family_dev
  quote "Maria is a parent of Bogdan."

@record1 fact
  holds parent bogdan ana
  valid timeless
  source family_dev
  quote "Bogdan is a parent of Ana."

@record2 fact
  holds parent carina ana
  valid timeless
  source family_dev
  quote "Carina is a parent of Ana."

@record3 fact
  holds not parent maria bogdan
  valid timeless
  source family_dev
  quote "Maria is not a parent of Bogdan."

@grandparentRule rule
  when parent ?x ?y
  when parent ?y ?z
  then grandparent ?x ?z
  source family_dev
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision 702d7c99d93592ec3959d5748340ba1136bd25f1a9c100460e4de2d6ccb2d291). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
