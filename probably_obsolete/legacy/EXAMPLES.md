# SOP execution examples (legacy collection)

These examples are retained for their original flow demonstrations. Their SOP atoms and explicit recording wires use the current spelling; their older `reason`/`recall` and `jsEval` routes are low-level program examples, not a recommended small-model curriculum. Run `node examples/linker-demo.js` for maintained runnable examples.

## auto-link.sop

```sop
# The caller declares the unknown output, not an @bunica value.
@q query
  select ?bunica
  where grandmother ?bunica carina
  at 2026-09-26

@r solve
  query $q
  output ?bunica one

@label jsEval
  expr "Rezultatul recuperat este " + $bunica

@answer cnl
  result $r
  language ro
```

## auto-cascade.sop

```sop
@family query
  select ?bunica
  where grandmother ?bunica carina
  at 2026-09-26

@who solve
  query $family
  output ?bunica one

@children query
  select ?copii
  where parent $bunica ?copii
  at 2026-09-26

@next solve
  query $children
  output ?copii many

@answer cnl
  result $next
  language ro
```

## auto-mixed.sop

```sop
# Relational recall -> generated numeric wire -> constraint -> another output.
@q query
  select ?duration
  where duration route_demo ?duration
  at 2026-09-26

@trip solve
  query $q
  output ?duration one

@timing constraint
  var ?arrival int 0 1440
  require ?arrival == 770 + $duration
  claim ?arrival <= 840
  task possible
  unit minute

@feasibility solve
  constraint $timing
  output ?arrival one

@margin jsEval
  expr 840 - $arrival

@answer cnl
  result $feasibility
  language ro
```

## auto-template.sop

```sop
# Only the situation is instantiated. The approved procedure supplies the plan.
@route value
  data "route_demo"
@departure value
  data 770
@deadline value
  data 840
@answer expand
  using ~check_arrival
  with route $route
  with start $departure
  with deadline $deadline
```

## auto-ambiguous.sop

```sop
@q query
  select ?stramos
  where ancestor ?stramos carina
  at 2026-09-26

@r solve
  query $q
  output ?stramos one

@would_guess jsEval
  expr "Unicul strămoș ar fi " + $stramos

@answer cnl
  result $r
  language ro
```

## auto-rows.sop

```sop
@q query
  select ?parent ?child
  where parent ?parent ?child
  at 2026-09-26

@r solve
  query $q
  output ?families rows

@answer cnl
  result $r
  language ro
```

## remember.sop

```sop
@f fact
  holds project_member maria project_delta
  valid 2026-09-26 open
  source user
  retention pinned

@save remember
  input $f
  scope session

@q query
  mode select
  select ?project
  where project_member maria ?project
  at 2026-09-26

@m recall
  query $q
  after $save

@r reason
  query $q
  memory $m

@answer cnl
  result $r
  language ro
```

## temporal.sop

```sop
@f fact
  holds works_at ana lab_alpha
  valid 2024-01-01 open
  source user

@saved remember
  input $f

@end event
  action end
  target $saved
  effective 2025-06-01
  source user

@applied remember
  input $end

@q query
  mode exists
  where works_at ana lab_alpha
  at 2025-07-01

@m recall
  query $q
  after $applied

@r reason
  query $q
  memory $m

@answer cnl
  result $r
  language ro
```

## local.sop

```sop
@a fact
  holds parent ana bogdan
  valid timeless

@b fact
  holds parent bogdan carina
  valid timeless

@r rule
  when parent ?x ?y
  when parent ?y ?z
  then grandparent ?x ?z

@data pack
  items $a $b $r

@q query
  mode select
  select ?who
  where grandparent ?who carina

@result reason
  query $q
  data $data
  backend js

@answer cnl
  result $result
  language ro
```

## hypothesis.sop

```sop
@h fact
  holds parent carina person_delta
  valid timeless

@q query
  mode select
  select ?who
  where ancestor ?who person_delta

@m recall
  query $q

@r reason
  query $q
  memory $m
  assume $h

@answer cnl
  result $r
  language ro
```

## strings.sop

```sop
@input value
  data "  ŞTIINŢĂ   "

@normalized jsEval
  expr $input.trim().toLowerCase().replaceAll("ş", "ș").replaceAll("ţ", "ț").normalize("NFC")
```
