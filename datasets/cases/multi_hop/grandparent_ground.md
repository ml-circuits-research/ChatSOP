# grandparent_ground

- family: multi_hop
- split: train
- world: family_train
- operators: two_hop, approved_rule
- input_mode: query_only
- structure: two_hop__approved_rule
- oracle: handwritten_graph_temporal







## Questions (surfaces → the same canonical target)

1. [en] Is Ana a grandparent of Carina?
2. [en] Does a two-generation parent chain connect Ana to Carina?
3. [en] Check Ana’s grandparent relation to Carina.
4. [ro] Este Ana bunica sau bunicul Carinei?  (Romanian surface; canonical target and internal CNL stay English)

## Expected (independent oracle, never computed from the target)

- status: `"supported"`
- answers: `[[]]`

## SOP target (compiled, canonical)

```sop
@q query
  where grandparent(ana, carina)

@r solve
  query $q

@answer cnl
  result $r
  language en
```

## Host world background (oracle basis, NOT model input)

```sop
@record0 fact
  holds parent(ana, bogdan)
  valid timeless
  source family_train
  quote "Ana is a parent of Bogdan."

@record1 fact
  holds parent(bogdan, carina)
  valid timeless
  source family_train
  quote "Bogdan is a parent of Carina."

@record2 fact
  holds parent(maria, carina)
  valid timeless
  source family_train
  quote "Maria is a parent of Carina."

@record3 fact
  holds not parent(carina, ana)
  valid timeless
  source family_train
  quote "Carina is not a parent of Ana."

@grandparentRule rule
  when parent(?x, ?y)
  when parent(?y, ?z)
  then grandparent(?x, ?z)
  source family_train
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision ac20503521b0ea6482fe565ef5af4e07658f486b70d52431b1868723a3df0c11). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
