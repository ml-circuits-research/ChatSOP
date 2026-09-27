# unsupported_cause

- family: unsupported_boundary
- split: test
- world: attached_test
- operators: abduction, causal_boundary
- input_mode: clarification
- evaluation_track: system
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

## Trusted system circuit (not model target)

```sop
@ask clarify
  text "Which causal model or independently reviewed evidence links the disk to the outage?"
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision 702d7c99d93592ec3959d5748340ba1136bd25f1a9c100460e4de2d6ccb2d291). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
