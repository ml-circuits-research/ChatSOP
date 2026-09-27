# unsupported_default

- family: unsupported_boundary
- split: dev
- world: attached_dev
- operators: default_exception
- input_mode: clarification
- evaluation_track: system
- structure: default_exception
- oracle: explicit_missing_information





- required_clarification: "There is no approved default rule or evidence for the current network state; what evidence should I use?"

## Questions (surfaces → the same canonical target)

1. [en] If the network is normally up, can I assume it is up now?
2. [en] Absent an outage report, is the network definitely working?
3. [en] Does missing evidence of failure prove there is no failure?

## Expected (independent oracle, never computed from the target)

- status: `"clarify"`

## Trusted system circuit (not model target)

```sop
@ask clarify
  text "There is no approved default rule or evidence for the current network state; what evidence should I use?"
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision 702d7c99d93592ec3959d5748340ba1136bd25f1a9c100460e4de2d6ccb2d291). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
