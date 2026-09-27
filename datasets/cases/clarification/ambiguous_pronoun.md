# ambiguous_pronoun

- family: clarification
- split: train
- world: attached_train
- operators: ambiguous_reference
- input_mode: clarification
- evaluation_track: system
- structure: ambiguous_reference
- oracle: explicit_missing_information





- required_clarification: "Which two people do you mean by she and their?"

## Questions (surfaces → the same canonical target)

1. [en] Is she their parent?
2. [en] Check whether that person is the parent of the other.
3. [en] Do they have her as a parent?
4. [ro] Este ea părintele lor?  (Romanian surface; model intent remains canonical and language-independent)

## Expected (independent oracle, never computed from the target)

- status: `"clarify"`

## Trusted system circuit (not model target)

```sop
@ask clarify
  text "Which two people do you mean by she and their?"
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision 702d7c99d93592ec3959d5748340ba1136bd25f1a9c100460e4de2d6ccb2d291). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
