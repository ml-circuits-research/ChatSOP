# unsupported_counterfactual

- family: unsupported_boundary
- split: test
- world: attached_test
- operators: counterfactual, missing_causal_model
- input_mode: clarification
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

## SOP target (compiled, canonical)

```sop
@ask clarify
  text "Which reviewed causal model defines the intervention and the outcome?"
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision ac20503521b0ea6482fe565ef5af4e07658f486b70d52431b1868723a3df0c11). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
