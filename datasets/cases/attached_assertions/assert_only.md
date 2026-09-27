# assert_only

- family: attached_assertions
- split: train
- world: attached_train
- operators: remember, session, no_query
- input_mode: assertions_query
- evaluation_track: system
- structure: remember__session__no_query
- oracle: explicit_session_record







## Questions (surfaces → the same canonical target)

1. [en] Record this for the present session: Ana works at Beta Lab.
2. [en] For this conversation, note that Ana works at Beta Lab.
3. [en] Keep in this session the fact that Ana works at Beta Lab.

## Attached assertions (trusted explicit session recording, not a model target)

- "Ana works at Beta Lab." → `works_at ana lab_beta` valid timeless

## Expected (independent oracle, never computed from the target)

- status: `"stored"`
- packet: `{"count":1}`
- session_claims: `[{"holds":"works_at ana lab_beta","valid":"timeless","source":"user","quote":"Ana works at Beta Lab.","retention":"normal"}]`

## Trusted system circuit (not model target)

```sop
@user_fact fact
  holds works_at ana lab_beta
  valid timeless
  source user
  quote "Ana works at Beta Lab."

@record remember
  input $user_fact
  scope session
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision 702d7c99d93592ec3959d5748340ba1136bd25f1a9c100460e4de2d6ccb2d291). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
