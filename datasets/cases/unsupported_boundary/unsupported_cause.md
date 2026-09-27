# unsupported_cause

- family: unsupported_boundary
- split: test
- world: attached_test
- operators: abduction, causal_boundary
- input_mode: clarification
- structure: abduction__causal_boundary
- oracle: explicit_missing_information

- holdout: capability_boundary



- required_clarification: "Which causal model or independently reviewed evidence links the disk to the outage?"

## Questions (surfaces → the same canonical target)

1. [en] Did a full disk cause the outage?
2. [en] Given an outage, was its cause a full disk?
3. [en] Can you establish a disk failure as the cause of this outage?

## Expected (independent oracle, never computed from the target)

- status: `"clarify"`

## SOP target (compiled, canonical)

```sop
@ask clarify
  text "Which causal model or independently reviewed evidence links the disk to the outage?"
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision ac20503521b0ea6482fe565ef5af4e07658f486b70d52431b1868723a3df0c11). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
