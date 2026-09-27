# route_expression

- family: expression_composition
- split: dev
- world: route_dev
- operators: query, unique_output, arithmetic, finite_constraint
- input_mode: query_only
- evaluation_track: formalization
- structure: query__unique_output__arithmetic__finite_constraint
- oracle: handwritten_route_arithmetic

- holdout: composition





## Questions (surfaces → the same canonical target)

1. [en] The Alpha Lab route takes 70 minutes; leaving at minute 770, is arrival by minute 840 feasible?
2. [en] Retrieve Alpha Lab’s route duration, add it to a departure time of 770 minutes, and check arrival no later than 840.
3. [en] Will departure at minute 770 meet the minute-840 deadline using the recorded route duration?

## Expected (independent oracle, never computed from the target)

- status: `"possible"`
- outputs: `{"minutes":70,"time":840}`

## Declarative model target (canonical)

```sop
@travel query
  mode select
  select ?minutes
  where duration route_demo ?minutes

@limit constraint
  var ?time int 0 1440
  require ?time == 770 + $minutes
  claim ?time <= 840
  task possible
  select ?time
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
