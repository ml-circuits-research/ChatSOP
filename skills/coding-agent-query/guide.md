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

* `relation "id"`: first choose an existing predicate id from `input/candidates.md` / `input/vocabulary.md` (for example "works_at", "capital_of", "writes"). A new session predicate id is permitted only with a grounded definition over existing predicates, as shown below; never substitute a made-up id for a missing definition.
* `role NAME VALUE`: NAME is one of `subject object recipient location source destination instrument time topic`, and only a role the predicate declares. A value is a quoted string (a proper name exactly as written in the request, or a listed entity id; another content word of the request, lower case, singular), an integer or a `?variable`.
* `polarity affirmed` for a positive relation. `negated` asks for an explicit negative fact, never for a missing positive fact. In a query only, `absent` asks whether the positive relation is absent from a declared complete relation/list. Preserve that distinction even when English says "not": an explicit denial is `negated`; "missing from this complete list" is `absent`. An absence query requires the existing predicate's `[closed]` declaration; an open relation is refused, not interpreted as negative evidence. Never invent closedness.
* The same `?variable` in two blocks is a join. Keywords are English, always.

Closed-list absence (not an explicit denial):
```
@q query
  where match
    relation "listed"
    role subject "Ada"
    polarity absent
  end
```
Use the existing predicate for the list. `stated` and `assumed` never accept `polarity absent`.

## Question forms (preserve the user's form and all restrictions)

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
Count matching people, objects or events: when an existing derived predicate already exposes the requested count, query it and `select` its numeric result; otherwise use `mode count` over the distinct asked role. A quantity is different: when the question asks for the value of a numeric attribute (a length, duration, amount or age), match that attribute and `select` its value. Do not count the rows of a numeric measure to answer how many units it has.
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

Most/half/none/not all/at least N: use `mode every`, a restriction in `where`, the property in `scope`, and `quantifier most|half|none|not_all|at_least N` (`all` is the default for "every"). Do not replace "most" with "every" or omit the numeric bound. "At least 3 tickets" as an attribute threshold instead uses `compare ?tickets at_least 3`.
```
@q query
  mode every
  quantifier most
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
Every strong name the request mentions must be used in the question (as a role value, listed entity id, or an option of `compare any` / `where any`); repeating it in an unused assumption or definition does not restrict the question. An explicit comparison needs `compare`, and a comparative choice needs its named options and a `rank` of the value. `where any` over option matches is also valid.

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

Numeric problem over numbers of the message: one `constraint` for the WHOLE assignment problem. A name assigned to a variable ("Let x be Ana's assignment") labels that variable; preserve the stated variable name `?x`, not a separate participant query. Declare every variable with its stated integer domain. Each `require` is a simultaneous condition; do not solve conditions in separate wires, invent narrower domains, compute a witness yourself, or combine equations algebraically. `claim` is optional and is not a replacement for all the requirements. Select the requested assignment variables.
```
@c constraint
  var ?x int 0 6
  var ?y int 0 6
  require ?x plus ?y equal 5
  require 2 times ?x plus ?y equal 7
  require ?x below ?y
  task possible
  select ?x ?y
```
Arithmetic is written in words (`plus`, `minus`, `times`); comparisons are `equal`, `not_equal`, `above`, `below`, `at_least`, `at_most`. No parentheses, operator symbols, `and` inside expressions, or repeated `claim`. Repeat `require` for a conjunction; alternatives use `require any` with one condition per line and `end`. Never return an assignment or answer.

## Derived vocabulary and evidence questions

Read the full vocabulary when candidates do not explain the requested relation. A memory predicate can be derived by a rule, recursive closure, default, aggregate or integrity check; it is usable even with no directly stored facts. Follow its description and argument meanings, not the grammatical position of a name in the question.

* Reachability: query an existing reachability predicate only when its documented arguments preserve both the requested source and destination and its definition has the requested path restrictions. Never add an undeclared role to a unary predicate or drop the named source. If only a direct-link predicate exists, define a binary recursive session relation over it; do not replace transitive closure with a fixed number of hops.
* Aggregate: select the numeric result of the corresponding existing sum/total/count/max predicate whenever its declared semantics preserve the question's restrictions. This takes precedence over the ordinary "how many" count form. `mode count` counts distinct selected bindings; it does not sum amounts or retrieve a materialized aggregate count. A group-by total binds the group and selects its result, not the per-person input. Mentioned contextual restrictions still have to be preserved; an irrelevant alternative name can restrict the group with `except ?group "Other group"`, but must not add a negated unrelated fact. Do not invent a role to encode a restriction the predicate lacks.
* Defaults and exceptions: query the existing conclusion directly. Its reviewed rule/default already applies the prerequisites, exception and priority. Do not additionally require explicitly negated evidence for an absent exception.
* Contradictory evidence: ask the proposition once; the reasoner reports `both` if it has positive and negative support. Do not change this into a conjunction of positive and negative queries or choose one side.
* Integrity: query the existing violation predicate using its declared witness and constraint-id roles. Do not swap these roles or invent a value such as "integrity"; select the variable identifying the reported violation when the request asks which violation is present.

Temporal questions use `at "DATE"` for one instant, `during "START to END"` for throughout the full end-exclusive interval, and `overlaps "START to END"` for any instant of the interval. Write the dates rather than the words "throughout" or "at any point" inside the date string. Never use `at` for a whole interval.

## unclear (alone in the file)

```
@u unclear
  kind relation_not_in_memory
```
`kind` is `gibberish`, `no_request` (no question and nothing to ask: a statement, "ok", "write a poem"), `ambiguous` with 2 to 4 `reading "..."` lines, or `relation_not_in_memory` (the question is clear, but no predicate of the memory expresses it).

## Session definitions and assumptions (only when needed)

Prefer an existing predicate and its declared roles. When no predicate expresses the request but it has one clear definition using existing predicates, declare a **session** predicate (including its `args` role types) and a safe rule or default; the query can then use that new id.

These examples are **schema examples**, not facts about Ana, A, Acme, or any other named entity. Each base predicate mentioned below must actually exist with the indicated roles in the current memory; substitute the real ids, never invent a base relation or evidence. A supplied example fact shows the role order and argument classes only. If the memory already defines the requested relation, query it instead of redeclaring it. Draft session definitions stay turn-local, require the existing admission/review path, and are identified as definitions in the answer; they do not grant permission to add observed facts, entities, or closedness. A labelled assumption is conditional, not a shortcut to make an unknown answer true.

**F1 — multi-hop KBQA, new relation via shared intermediary.** Suppose `works_at(subject:entity,object:entity)` exists. The `coworker` example below joins two workers at the same employer, excluding the person themself; `subject` is the named person, `object` the selected colleague. Only use this meaning of "works with" when the request establishes that interpretation; if it might mean working on a common project, ask which meaning.
```sop
@coworker predicate
  args subject:entity object:entity
@coworker_at_work rule
  when works_at ?a ?organization
  when works_at ?b ?organization
  when compare ?a not_equal ?b
  then coworker ?a ?b
@q query
  select ?colleague
  where match
    relation "coworker"
    role subject "Ana"
    role object ?colleague
    polarity affirmed
  end
```

**F2 — counts/aggregates.** Suppose `works_at(subject:entity,object:entity)` and `is_certified(subject:entity)` exist, but "certified worker at this employer" has no existing predicate. Define the conjunction, then count distinct workers; do not count rows of an existing numeric aggregate or silently drop the employer restriction.
```sop
@certified_worker predicate
  args subject:entity object:entity
@certified_worker_rule rule
  when works_at ?person ?employer
  when is_certified ?person
  then certified_worker ?person ?employer
@q query
  mode count
  select ?person
  where match
    relation "certified_worker"
    role subject ?person
    role object "Acme"
    polarity affirmed
  end
```

**F3 — completeness/absence.** Only if the memory certifies `rostered(subject:entity,object:entity)` exhaustive for the relevant people and employer can a definition derived solely from that complete roster be marked closed; without that guarantee, omit `closed true` and do not ask `polarity absent`. An explicit negative roster fact instead uses `polarity negated`.
```sop
@rostered_worker predicate
  args subject:entity object:entity
  closed true
@rostered_worker_rule rule
  when rostered ?person ?employer
  then rostered_worker ?person ?employer
@q query
  where match
    relation "rostered_worker"
    role subject "Ana"
    role object "Acme"
    polarity absent
  end
```

**F4 — reachability/closure.** The worked `permitted_step` and `path` definition below is recursive, preserves the source and destination, and excludes destinations backed by `unavailable` evidence. A fixed two-edge query is not equivalent to reachability.
For "Can one get from A to B without entering an unavailable place?", an existing direct-edge predicate does not mean transitive reachability. If no reviewed binary path predicate already expresses it, the following form defines it over existing `edge` and `unavailable` vocabulary. Use the actual existing ids and roles. A default excludes destinations with evidence of unavailability; recursive rules compose the safe steps without inventing observed edges.
```sop
@permitted_step predicate
  args subject:entity object:entity
@permitted_step_default default
  when edge ?from ?to
  then permitted_step ?from ?to
  except unavailable ?to
@path predicate
  args subject:entity object:entity
@path_direct rule
  when permitted_step ?from ?to
  then path ?from ?to
@path_recursive rule
  when path ?from ?via
  when permitted_step ?via ?to
  then path ?from ?to
@q query
  where match
    relation "path"
    role subject "A"
    role object "B"
    polarity affirmed
  end
```

**F5 — numeric constraint satisfaction.** A missing *relational* term may be mapped from real predicates only when the request genuinely asks about that mapping: here `works_at(subject:entity,object:entity)` and `certified_for(subject:entity,object:entity)` license "eligible worker for a shift at Acme". A numeric assignment puzzle still needs one `constraint` with every `require` and stated domain; this rule cannot create a schedule, a numeric bound, or a constraint fact.
```sop
@eligible_shift_worker predicate
  args subject:entity object:entity
@eligible_shift_worker_rule rule
  when works_at ?person "Acme"
  when certified_for ?person ?shift
  then eligible_shift_worker ?person ?shift
@q query
  select ?worker
  where match
    relation "eligible_shift_worker"
    role subject ?worker
    role object "Morning shift"
    polarity affirmed
  end
```

**F6 — temporal intervals.** With actual `works_at(subject:entity,object:entity)` and `is_certified(subject:entity)` predicates, the same derived conjunction can be asked *throughout* an end-exclusive interval via `during`. Temporal support comes from the dated memory evidence; the rule cannot manufacture a validity span or bridge a gap.
```sop
@certified_employee predicate
  args subject:entity object:entity
@certified_employee_rule rule
  when works_at ?person ?employer
  when is_certified ?person
  then certified_employee ?person ?employer
@q query
  where match
    relation "certified_employee"
    role subject "Ana"
    role object "Acme"
    polarity affirmed
  end
  during "2026-03-01 to 2026-06-01"
```


**F7 — defaults and exceptions.** The next worked `typically_certified` example applies only when the request explicitly supplies that default meaning and `works_at`, `is_certified`, and `on_leave` exist. An existing reviewed default/conclusion wins; do not add a redundant or conflicting one.
When the wording explicitly says "usually" and gives an exception, a `default` uses existing predicates for its body, head and exception (these illustrative ids must be present in the memory before writing this circuit):
```sop
@typically_certified default
  when works_at ?person "Acme"
  then is_certified ?person
  except on_leave ?person
@q query
  where match
    relation "is_certified"
    role subject "Ana"
    polarity affirmed
  end
```

**F8 — contradictory evidence.** When `permit(subject:entity)` has *both* affirmative and explicitly negative evidence, a requested "disputed permit" can be grounded in both supports. `when not permit` requires an explicit negative fact, not absence from an open list. If the memory already has a reviewed integrity/violation predicate, use it and its documented constraint-id/witness roles instead.
```sop
@disputed_permit predicate
  args subject:entity
@disputed_permit_rule rule
  when permit ?person
  when not permit ?person
  then disputed_permit ?person
@q query
  where match
    relation "disputed_permit"
    role subject "Ana"
    polarity affirmed
  end
```

**F9 — large memories.** A request for *exactly two edges* (not arbitrary reachability) can use the same local `edge(subject:entity,object:entity)` rule regardless of memory size; this is not a license to enumerate the graph in the prompt. The system's bounded retrieval still decides whether its evidence is complete.
```sop
@two_edge_route predicate
  args subject:entity object:entity
@two_edge_route_rule rule
  when edge ?from ?via
  when edge ?via ?to
  then two_edge_route ?from ?to
@q query
  where match
    relation "two_edge_route"
    role subject "A"
    role object "B"
    polarity affirmed
  end
```

**F10 — natural-language KBQA.** When `lives_in(subject:entity,location:entity)` links a resident to a city and `located_in(subject:entity,location:entity)` links that city to a region, a missing "resident of region" relation has a unique two-hop definition if the request uses that meaning. Example city names or facts in the neighbourhood do not authorize asserting that any particular person lives there.
```sop
@resident_of_region predicate
  args subject:entity object:entity
@resident_of_region_rule rule
  when lives_in ?person ?city
  when located_in ?city ?region
  then resident_of_region ?person ?region
@q query
  select ?person
  where match
    relation "resident_of_region"
    role subject ?person
    role object "Region A"
    polarity affirmed
  end
```

A `predicate` may declare `closed true` only when the user establishes that its extension is complete for this session (for example, a complete list of booked rooms already supplied as session evidence). If the memory has no `booked_room` predicate, and the list is explicitly exhaustive, the declaration and question can be:
```sop
@booked_room predicate
  args subject:entity
  closed true
@q query
  where match
    relation "booked_room"
    role subject "Room A"
    polarity affirmed
  end
```
The declaration itself adds no booked-room facts; completeness must come from actual supplied evidence. If `booked_room` already exists in the memory, use it instead of redeclaring it. Do not claim closedness just because the question mentions a list. If more than one definition is plausible, write a short `unclear kind ambiguous` with 2–4 `reading` alternatives; never choose a meaning silently.

If no definition over existing predicates suffices but a background premise is necessary, write a **labelled assumption**, not a `fact` or an asserted `stated` wire. For example, with `works_at` already in the memory:
```sop
@a assumed
  relation "works_at"
  role subject "Ana"
  role object "Acme"
  polarity affirmed
  basis world
@q query
  where match
    relation "works_at"
    role subject "Ana"
    role object "Acme"
    polarity affirmed
  end
```
The assumption is optional and its origin is reported; any answer that relies on it must remain conditional, not a memory fact. Use it only when genuinely needed by the request, never to make up an answer. A user-given "if" premise instead uses `stated certainty supposed` linked by `if $id`. Do not write `fact`, asserted `stated`, `remember`, unrelated knowledge or a guessed definition.
