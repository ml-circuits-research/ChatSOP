# negative_assertion_direct

- family: negation_openworld
- split: train
- world: family_train
- operators: explicit_negation, negative_query
- input_mode: query_only
- structure: explicit_negation__negative_query
- oracle: handwritten_graph_temporal
- negative_of: negative_explicit






## Questions (surfaces → the same canonical target)

1. [en] Is it explicitly recorded that Carina is not Ana’s parent?
2. [en] Does the negative parent claim about Carina and Ana have support?
3. [en] Check the assertion that Carina does not parent Ana.
4. [ro] Există dovadă explicită că Carina nu este părintele Anei?  (Romanian surface; canonical target and internal CNL stay English)

## Expected (independent oracle, never computed from the target)

- status: `"supported"`
- answers: `[[]]`

## SOP target (compiled, canonical)

```sop
@q query
  where not parent(carina, ana)

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
