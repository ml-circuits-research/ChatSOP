# grandparent_ground

- family: multi_hop
- split: train
- world: family_train
- operators: two_hop, approved_rule
- input_mode: query_only
- evaluation_track: formalization
- structure: two_hop__approved_rule
- oracle: handwritten_graph_temporal







## Questions (surfaces → the same canonical target)

1. [en] Is Ana a grandparent of Carina?
2. [en] Does a two-generation parent chain connect Ana to Carina?
3. [en] Check Ana’s grandparent relation to Carina.
4. [ro] Este Ana bunica sau bunicul Carinei?  (Romanian surface; model intent remains canonical and language-independent)

## Expected (independent oracle, never computed from the target)

- status: `"supported"`
- answers: `[[]]`

## Declarative model target (canonical)

```sop
@q query
  where grandparent ana carina
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
