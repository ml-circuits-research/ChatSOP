# ambiguous_pronoun

- family: clarification
- split: train
- world: attached_train
- operators: ambiguous_reference
- input_mode: clarification
- structure: ambiguous_reference
- oracle: explicit_missing_information





- required_clarification: "Which two people do you mean by she and their?"

## Questions (surfaces → the same canonical target)

1. [en] Is she their parent?
2. [en] Check whether that person is the parent of the other.
3. [en] Do they have her as a parent?
4. [ro] Este ea părintele lor?  (Romanian surface; canonical target and internal CNL stay English)

## Expected (independent oracle, never computed from the target)

- status: `"clarify"`

## SOP target (compiled, canonical)

```sop
@ask clarify
  text "Which two people do you mean by she and their?"
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision ac20503521b0ea6482fe565ef5af4e07658f486b70d52431b1868723a3df0c11). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
