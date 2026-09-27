# ambiguous_bank

- family: clarification
- split: test
- world: attached_test
- operators: ambiguous_sense, lexical_holdout
- input_mode: clarification
- evaluation_track: system
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

## Trusted system circuit (not model target)

```sop
@ask clarify
  text "Which bank or organization do you mean?"
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision 702d7c99d93592ec3959d5748340ba1136bd25f1a9c100460e4de2d6ccb2d291). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
