# multi_hop_inverse

- family: multi_hop
- split: dev
- world: family_dev
- operators: two_hop, select
- input_mode: query_only
- evaluation_track: formalization
- structure: two_hop__select
- oracle: handwritten_graph_temporal

- holdout: reasoning_world





## Questions (surfaces → the same canonical target)

1. [en] Who is a grandparent of Ana?
2. [en] Name the person two parent links above Ana.
3. [en] Which recorded person is Ana’s grandparent?

## Expected (independent oracle, never computed from the target)

- status: `"supported"`
- answers: `[["maria"]]`

## Declarative model target (canonical)

```sop
@q query
  select ?elder
  where grandparent ?elder ana
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
