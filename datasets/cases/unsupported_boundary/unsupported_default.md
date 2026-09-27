# unsupported_default

- family: unsupported_boundary
- split: dev
- world: attached_dev
- operators: default_exception
- input_mode: clarification
- structure: default_exception
- oracle: explicit_missing_information





- required_clarification: "There is no approved default rule or evidence for the current network state; what evidence should I use?"

## Questions (surfaces → the same canonical target)

1. [en] If the network is normally up, can I assume it is up now?
2. [en] Absent an outage report, is the network definitely working?
3. [en] Does missing evidence of failure prove there is no failure?

## Expected (independent oracle, never computed from the target)

- status: `"clarify"`

## SOP target (compiled, canonical)

```sop
@ask clarify
  text "There is no approved default rule or evidence for the current network state; what evidence should I use?"
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision ac20503521b0ea6482fe565ef5af4e07658f486b70d52431b1868723a3df0c11). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
