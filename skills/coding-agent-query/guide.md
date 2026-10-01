# The query language (DS021 model surface), as the coding agent writes it

A wire is `@id type` followed by keyword lines (two spaces of indent), one keyword per line. Values are quoted strings, integers or `?variables`. A match block is `match` ... `end`; nested groups are `all`/`any` ... `end`.

```
@q query
  select ?who
  where match
    relation "work at"
    role subject ?who
    role object "Acme"
    polarity affirmed
  end
```

* `relation "lemma"`: the base form of the verb or noun phrase as listed in `input/vocabulary.md` ("work at", "be the capital of", "write").
* `role NAME VALUE`: NAME is one of `subject object recipient location source destination instrument time topic`, and only a role the predicate declares. A value is a quoted string (a proper name as written; another content word of the message, normalized to lower case, singular), an integer or a `?variable`.
* `polarity affirmed` always; `negated` only for an explicit "not"/"no" in the question.
* The same `?variable` in two blocks is a join. Keywords are English, always.

## Question forms (each word has exactly one form)

Yes/no: no `select`.
```
@q query
  where match
    relation "work at"
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
    relation "live in"
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
    relation "work at"
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
    relation "work at"
    role subject ?m
    role object "Acme"
    polarity affirmed
  end
  scope match
    relation "be certified"
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
    relation "live in"
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
    relation "be ill"
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
    relation "be aged"
    role subject ?x
    role object ?age
    polarity affirmed
  end
```
Exclusion ("besides Ana"): `except ?x "Ana"`. Superlative ("the oldest"): `rank highest ?v` or `rank lowest ?v`, optionally `position N` or `top N`. Several conditions: `where all` ... `end` with several match blocks (a join through shared variables), or `where any` for alternatives. A time given in the question: `at "March 2024"` (as written). Do not write `filter`, `span`, `limit`.

Chaining: a block may use `$q` (the answers of an earlier query that selects exactly one variable) as a role value, at most one per query:
```
@q query
  select ?c
  where match
    relation "be the capital of"
    role subject ?c
    role object "France"
    polarity affirmed
  end
@q2 query
  select ?p
  where match
    relation "live in"
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
  kind no_request
```
`kind` is `gibberish`, `no_request` (no question and nothing to ask: a statement, "ok", "write a poem") or `ambiguous` with 2 to 4 `reading "..."` lines.

## Not for you

`stated` facts of the world, `assumed`, `fact`, `rule`, `jsEval`, `filter`, `span`, entity identifiers, predicate identifiers in `relation`.
