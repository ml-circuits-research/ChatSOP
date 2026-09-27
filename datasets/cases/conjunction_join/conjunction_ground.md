# conjunction_ground

- family: conjunction_join
- split: train
- world: family_train
- operators: and, shared_variable
- input_mode: query_only
- evaluation_track: formalization
- structure: and__shared_variable
- oracle: handwritten_graph_temporal







## Questions (surfaces → the same canonical target)

1. [en] Are both Ana parent to Bogdan and Bogdan parent to Carina?
2. [en] Check the two links Ana–Bogdan and Bogdan–Carina together.
3. [en] Does the stated two-link parent chain hold?

## Expected (independent oracle, never computed from the target)

- status: `"supported"`
- answers: `[[]]`

## Declarative model target (canonical)

```sop
@q query
  where parent ana bogdan
  where parent bogdan carina
```

## Host world background (oracle basis, NOT model input)

```sop
@record0 fact
  holds parent ana bogdan
  valid timeless
  source family_train
  quote "Ana is a parent of Bogdan."

@record1 fact
  holds parent bogdan carina
  valid timeless
  source family_train
  quote "Bogdan is a parent of Carina."

@record2 fact
  holds parent maria carina
  valid timeless
  source family_train
  quote "Maria is a parent of Carina."

@record3 fact
  holds not parent carina ana
  valid timeless
  source family_train
  quote "Carina is not a parent of Ana."

@grandparentRule rule
  when parent ?x ?y
  when parent ?y ?z
  then grandparent ?x ?z
  source family_train
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision 702d7c99d93592ec3959d5748340ba1136bd25f1a9c100460e4de2d6ccb2d291). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
