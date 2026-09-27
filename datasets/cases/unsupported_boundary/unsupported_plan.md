# unsupported_plan

- family: unsupported_boundary
- split: dev
- world: attached_dev
- operators: planning, missing_action_model
- input_mode: clarification
- structure: planning__missing_action_model
- oracle: explicit_missing_information





- required_clarification: "Which approved actions, preconditions and goal definition should the plan use?"

## Questions (surfaces → the same canonical target)

1. [en] Which sequence of repairs guarantees the network will recover?
2. [en] Plan the steps to restore service, with no action model provided.
3. [en] What actions should I take to guarantee that the outage ends?

## Expected (independent oracle, never computed from the target)

- status: `"clarify"`

## SOP target (compiled, canonical)

```sop
@ask clarify
  text "Which approved actions, preconditions and goal definition should the plan use?"
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision ac20503521b0ea6482fe565ef5af4e07658f486b70d52431b1868723a3df0c11). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
