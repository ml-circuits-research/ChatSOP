# conflict_no_explosion

- family: negation_openworld
- split: dev
- world: family_dev
- operators: conflict, open_world
- input_mode: query_only
- structure: conflict__open_world
- oracle: handwritten_graph_temporal







## Questions (surfaces → the same canonical target)

1. [en] Do the conflicting records establish that Ana parents Maria?
2. [en] Is Ana a parent of Maria in these records?
3. [en] Check the unrelated Ana–Maria parent claim.

## Expected (independent oracle, never computed from the target)

- status: `"unknown"`
- answers: `[]`

## SOP target (compiled, canonical)

```sop
@q query
  where parent(ana, maria)

@r solve
  query $q

@answer cnl
  result $r
  language en
```

## Host world background (oracle basis, NOT model input)

```sop
@record0 fact
  holds parent(maria, bogdan)
  valid timeless
  source family_dev
  quote "Maria is a parent of Bogdan."

@record1 fact
  holds parent(bogdan, ana)
  valid timeless
  source family_dev
  quote "Bogdan is a parent of Ana."

@record2 fact
  holds parent(carina, ana)
  valid timeless
  source family_dev
  quote "Carina is a parent of Ana."

@record3 fact
  holds not parent(maria, bogdan)
  valid timeless
  source family_dev
  quote "Maria is not a parent of Bogdan."

@grandparentRule rule
  when parent(?x, ?y)
  when parent(?y, ?z)
  then grandparent(?x, ?z)
  source family_dev
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision ac20503521b0ea6482fe565ef5af4e07658f486b70d52431b1868723a3df0c11). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
