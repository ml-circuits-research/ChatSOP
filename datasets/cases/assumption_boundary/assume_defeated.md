# assume_defeated

- family: assumption_boundary
- split: train
- world: assumption_blocked
- operators: assume, explicit_negation, defeasible_rule, ground
- input_mode: query_only
- evaluation_track: formalization
- structure: assume__explicit_negation__defeasible_rule__ground
- oracle: handwritten_defeasible_assumption







## Questions (surfaces → the same canonical target)

1. [en] The record states the A–B door is not open; can the open-door assumption still connect the rooms?
2. [en] Check the connectivity claim when an explicit record denies the assumed door state.
3. [en] With the door recorded as closed, does guessing it open support the connection?

## Expected (independent oracle, never computed from the target)

- status: `"unknown"`
- answers: `[]`
- packet: `{"hypothetical":false}`

## Declarative model target (canonical)

```sop
@guess premise
  holds door_open room_a room_b

@q query
  mode exists
  where connected room_a room_b
```

## Host world background (oracle basis, NOT model input)

```sop
@record0 fact
  holds not door_open room_a room_b
  valid timeless
  source assumption_blocked
  quote "The door between rooms A and B is not open."

@doorRule rule
  when door_open ?x ?y
  then connected ?x ?y
  source assumption_blocked
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision 702d7c99d93592ec3959d5748340ba1136bd25f1a9c100460e4de2d6ccb2d291). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
