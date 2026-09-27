# assume_uncontested

- family: assumption_boundary
- split: train
- world: assumption_open
- operators: assume, defeasible_rule, ground
- input_mode: query_only
- structure: assume__defeasible_rule__ground
- oracle: handwritten_defeasible_assumption







## Questions (surfaces → the same canonical target)

1. [en] If no record denies it, is the door between rooms A and B open, and does that make the rooms connected?
2. [en] Assume the A–B door is open unless a record says otherwise; check connectivity between the two rooms.
3. [en] Check whether rooms A and B are connected when the door state is only a guess.

## Expected (independent oracle, never computed from the target)

- status: `"supported"`
- answers: `[[]]`
- packet: `{"hypothetical":true}`

## SOP target (compiled, canonical)

```sop
@q query
  mode exists
  where connected(room_a, room_b)

@guess fact
  holds door_open(room_a, room_b)
  valid timeless
  source assumption

@r solve
  query $q
  assume $guess

@answer cnl
  result $r
  language en
```

## Host world background (oracle basis, NOT model input)

```sop
@doorRule rule
  when door_open(?x, ?y)
  then connected(?x, ?y)
  source assumption_open
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision ac20503521b0ea6482fe565ef5af4e07658f486b70d52431b1868723a3df0c11). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
