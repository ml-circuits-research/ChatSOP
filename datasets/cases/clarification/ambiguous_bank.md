# ambiguous_bank

- family: clarification
- split: test
- world: attached_test
- operators: ambiguous_sense, lexical_holdout
- input_mode: clarification
- structure: ambiguous_sense__lexical_holdout
- oracle: explicit_missing_information

- holdout: lexical


- reserved_lexemes: bank
- required_clarification: "Which bank or organization do you mean?"

## Questions (surfaces → the same canonical target)

1. [en] Does Maria work at the bank?
2. [en] Check whether Maria works for that bank.
3. [en] Is the bank Maria’s workplace?

## Expected (independent oracle, never computed from the target)

- status: `"clarify"`

## SOP target (compiled, canonical)

```sop
@ask clarify
  text "Which bank or organization do you mean?"
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision ac20503521b0ea6482fe565ef5af4e07658f486b70d52431b1868723a3df0c11). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
