# unsupported_counterfactual

- family: unsupported_boundary
- split: test
- world: attached_test
- operators: counterfactual, missing_causal_model
- input_mode: clarification
- evaluation_track: system
- structure: counterfactual__missing_causal_model
- oracle: explicit_missing_information

- holdout: capability_boundary



- required_clarification: "Which reviewed causal model defines the intervention and the outcome?"

## Questions (surfaces → the same canonical target)

1. [en] If the disk had not filled, would the outage still have happened?
2. [en] Would service be up now had the disk remained free?
3. [en] Without the disk filling, would the outage have been avoided?

## Expected (independent oracle, never computed from the target)

- status: `"clarify"`

## Trusted system circuit (not model target)

```sop
@ask clarify
  text "Which reviewed causal model defines the intervention and the outcome?"
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision 702d7c99d93592ec3959d5748340ba1136bd25f1a9c100460e4de2d6ccb2d291). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
