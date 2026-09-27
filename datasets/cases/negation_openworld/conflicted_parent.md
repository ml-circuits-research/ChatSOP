# conflicted_parent

- family: negation_openworld
- split: dev
- world: family_dev
- operators: explicit_negation, conflict
- input_mode: query_only
- evaluation_track: formalization
- structure: explicit_negation__conflict
- oracle: handwritten_graph_temporal







## Questions (surfaces → the same canonical target)

1. [en] Is Maria a parent of Bogdan, given the conflicting records?
2. [en] What does the evidence say about Maria parenting Bogdan?
3. [en] Check the parent claim for Maria and Bogdan without discarding either record.
4. [ro] Este Maria părintele lui Bogdan, având dovezi contradictorii?  (Romanian surface; model intent remains canonical and language-independent)

## Expected (independent oracle, never computed from the target)

- status: `"both"`
- answers: `[[]]`

## Declarative model target (canonical)

```sop
@q query
  where parent maria bogdan
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
