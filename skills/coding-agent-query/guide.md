# The query language (DS014 model surface), as the coding agent writes it

A wire is `@id type` followed by keyword lines (two spaces of indent), one keyword per line. Values are quoted strings, integers or `?variables`. A match block is `match` ... `end`; nested groups are `all`/`any` ... `end`.

```
@q query
  select ?who
  where match
    relation "works_at"
    role subject ?who
    role object "Acme"
    polarity affirmed
  end
```

* `relation "id"`: the id of one predicate of `input/candidates.md` (for example "works_at", "capital_of", "writes"); never a phrase of the request.
* `role NAME VALUE`: NAME is one of `subject object recipient location source destination instrument time topic`, and only a role the predicate declares. A value is a quoted string (a proper name exactly as written in the request, or a listed entity id; another content word of the request, lower case, singular), an integer or a `?variable`.
* `polarity affirmed` always; `negated` only for an explicit "not"/"no" in the question.
* The same `?variable` in two blocks is a join. Keywords are English, always.

## Question forms (each word has exactly one form)

Yes/no: no `select`.
```
@q query
  where match
    relation "works_at"
    role subject "Maria"
    role object "Acme"
    polarity affirmed
  end
```
Who/what/which/where: select the variable of the asked role ("Where does Ana live?" uses `role location ?place`).
```
@q query
  select ?place
  where match
    relation "lives_in"
    role subject "Ana"
    role location ?place
    polarity affirmed
  end
```
How many: `mode count`.
```
@q query
  mode count
  select ?x
  where match
    relation "works_at"
    role subject ?x
    role object "Acme"
    polarity affirmed
  end
```
Every/all/nobody: `mode every`, `where` is the restriction, `scope` what holds for each member ("nobody" is the only form with `polarity negated` in the scope).
```
@q query
  mode every
  where match
    relation "works_at"
    role subject ?m
    role object "Acme"
    polarity affirmed
  end
  scope match
    relation "is_certified"
    role subject ?m
    polarity affirmed
  end
```
When / since when / until when / how long: `role time ?t`, `select ?t`, and `measure start|end|duration` for since/until/how long.
```
@q query
  select ?t
  measure start
  where match
    relation "lives_in"
    role subject "Ana"
    role location "Cluj"
    role time ?t
    polarity affirmed
  end
```
How many times: `mode count`, `select ?t`, `role time ?t`.

Why / how come: `mode explain`, no `select`, over the proposition.
```
@q query
  mode explain
  where match
    relation "is_ill"
    role subject "Ana"
    polarity affirmed
  end
```
How (manner or means): `role instrument ?how`.

A value comparison ("older than 80", "more than 3"): `compare ?v above|below|at_least|at_most|equal|not_equal OPERAND` (OPERAND an integer, a quoted string or a `?variable`).
```
@q query
  select ?x
  compare ?age above 80
  where match
    relation "aged"
    role subject ?x
    role object ?age
    polarity affirmed
  end
```
Exclusion ("besides Ana"): `except ?x "Ana"`. Superlative ("the oldest"): `rank highest ?v` or `rank lowest ?v`, optionally `position N` or `top N`. Several conditions: `where all` ... `end` with several match blocks (a join through shared variables), or `where any` for alternatives. A time given in the question: `at "March 2024"` (as written). Do not write `filter`, `span`, `limit`.

Superlative ("the biggest", "the oldest"): the restriction in `where all`, then `rank highest ?v` (or `lowest`); "the second largest" adds `position 2`, "the three largest" adds `top 3`.
```
@q query
  select ?x
  where all
    match
      relation "is_a"
      role subject ?x
      role object "city"
      polarity affirmed
    end
    match
      relation "located_in"
      role subject ?x
      role location "France"
      polarity affirmed
    end
    match
      relation "population_of"
      role subject ?x
      role object ?v
      polarity affirmed
    end
  end
  rank highest ?v
```
Choosing between named options ("Italy or Portugal?", "Einstein or Newton?"): the named options MUST restrict the answer, with `compare any` over the options (without it the query ranks every entity of the memory and answers wrongly); the value to rank is a second variable.
```
@q query
  select ?x
  compare any
    ?x equal "Italy"
    ?x equal "Portugal"
  end
  rank highest ?v
  where match
    relation "population_of"
    role subject ?x
    role object ?v
    polarity affirmed
  end
```
Comparing two named things (yes/no, "Is Russia larger than Canada?"): one match block for each side with its own value variable, then `compare ?a above ?b`; no `select`.
```
@q query
  compare ?a above ?b
  where all
    match
      relation "area_of"
      role subject "Russia"
      role object ?a
      polarity affirmed
    end
    match
      relation "area_of"
      role subject "Canada"
      role object ?b
      polarity affirmed
    end
  end
```
Several hops ("the city where the director of Seven Samurai was born"): one match block per hop, joined by a shared variable.
```
@q query
  select ?p
  where all
    match
      relation "directed"
      role subject ?d
      role object "Seven Samurai"
      polarity affirmed
    end
    match
      relation "born_in"
      role subject ?d
      role location ?p
      polarity affirmed
    end
  end
```
Every name the request mentions must be used in the query (as a value, an id from the hints, or an option of `compare any`); a name left out silently widens the question and the answer is wrong.

Chaining: a block may use `$q` (the answers of an earlier query that selects exactly one variable) as a role value, at most one per query:
```
@q query
  select ?c
  where match
    relation "capital_of"
    role subject ?c
    role object "France"
    polarity affirmed
  end
@q2 query
  select ?p
  where match
    relation "lives_in"
    role subject ?p
    role location $q
    polarity affirmed
  end
```

Numeric problem over numbers of the message:
```
@c constraint
  var ?x int 4 7
  claim ?x equal 8
  task possible
```

## unclear (alone in the file)

```
@u unclear
  kind relation_not_in_memory
```
`kind` is `gibberish`, `no_request` (no question and nothing to ask: a statement, "ok", "write a poem"), `ambiguous` with 2 to 4 `reading "..."` lines, or `relation_not_in_memory` (the question is clear, but no predicate of the memory expresses it).

## Not for you

`stated` facts of the world, `assumed`, `fact`, `rule`, `jsEval`, `filter`, `span`, a predicate id that is not in the memory, an entity id that is not listed.
