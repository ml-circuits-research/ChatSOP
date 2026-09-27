# route_approved_procedure

- family: approved_procedure
- split: dev
- world: route_dev
- operators: expand, host_approved_library, finite_constraint
- input_mode: query_only
- evaluation_track: system
- structure: expand__host_approved_library__finite_constraint
- oracle: handwritten_route_arithmetic

- holdout: composition





## Questions (surfaces → the same canonical target)

1. [en] Use the approved arrival-check procedure for Alpha Lab, starting at minute 770 with a minute-840 deadline.
2. [en] Apply the reviewed arrival template to the Alpha Lab route: depart 770, deadline 840.
3. [en] With start 770 and cutoff 840, run the approved route-arrival procedure for Alpha Lab.

## Expected (independent oracle, never computed from the target)

- status: `"possible"`
- outputs: `{"expanded__duration":70,"expanded__arrival":840}`

## Trusted system circuit (not model target)

```sop
@route value
  data "route_demo"

@start value
  data 770

@deadline value
  data 840

@expanded expand
  using ~check_arrival
  with route $route
  with start $start
  with deadline $deadline

@packet jsEval
  expr $expanded.packet

@answer cnl
  result $packet
  language en
```

## Host world background (oracle basis, NOT model input)

```sop
@record0 fact
  holds duration route_demo 70
  valid timeless
  source route_dev
  quote "The Alpha Lab route takes 70 minutes."

@check_arrival template
  description "Recuperează durata rutei și calculează sosirea într-o zi, în minute de la miezul nopții."
  cue "sosire"
  cue "ajung"
  params route start deadline
  yield answer
  body |
    @travel query
      select ?duration
      where duration $route ?duration
    @retrieve_duration solve
      query $travel
      output ?duration one
    @timing constraint
      var ?arrival int 0 1440
      require ?arrival == $start + $duration
      claim ?arrival <= $deadline
      task possible
      unit minute
    @feasibility solve
      constraint $timing
      output ?arrival one
    @answer cnl
      result $feasibility
      language ro
```

---

Generated from `tools/datasets/curriculum/cases.mjs` (revision 702d7c99d93592ec3959d5748340ba1136bd25f1a9c100460e4de2d6ccb2d291). Manual edits here are discarded by regeneration and make validation fail as a stale authoring tree. To change a case: edit `cases.mjs`, then run `node tools/datasets/build-cases-md.mjs` and rebuild the corpus.
