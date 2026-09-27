# child_inverse_select

- family: relation_role
- split: train
- world: family_train
- operators: binary, role_inversion, select
- input_mode: query_only
- structure: binary__role_inversion__select
- oracle: handwritten_graph_temporal







## Questions (surfaces → the same canonical target)

1. [en] Who has Ana as a parent?
2. [en] List Ana’s recorded children.
3. [en] For which person is Ana in the parent role?

## Expected (independent oracle, never computed from the target)

- status: `"supported"`
- answers: `[["bogdan"]]`

## SOP target (compiled, canonical)

```sop
@q query
  select ?child
  where parent(ana, ?child)

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
