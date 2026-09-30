# Proposals to close the measured UD → SOP conversion gaps

Status: **proposal only.** No rule was changed while the new proofreading cases were authored; per
`new_cases.md` §8.2 the failing rewrites are reported with their reason instead. Everything below is evidence
from that corpus.

Naming note: the file is named `improveStanzaRules.md` on request, but the gaps are **not** in Stanza. Stanza
parses every sentence below correctly and identically; the sentences that fail differ only in the *template* the
conversion rules recognise. The rules live in `lib/ud-to-sop/` (`analyze.mjs` builds wires, `lexicon.mjs` holds
the closed word lists, `repair.mjs` performs deterministic tree repairs).

## Evidence base

- Corpus: 6,000 cases (30 writers) under `datasets_sources/new_cases/`; the parse check
  `node tools/datasets/check-new-cases-sop.mjs --in datasets_sources/new_cases/cases.jsonl --out datasets_sources/new_cases/symbolic-lm-check.json`
  runs the real SymbolicLM over every `clean` rewrite. Rows whose main tag is `identity_unfixable` (fragments,
  follow-ups, greetings, gibberish) cannot become SOP by construction and are counted apart.
- Wave 1 alone (3,000 rows, 2,850 rewrites, 150 skipped rows): **599 rewrites with an unparsed span**.
- Families (share of those 599, first head of the unparsed span):

| family | count | share | typical span |
| --- | --- | --- | --- |
| prepositional phrase attached to a clause or noun | 332 | 55% | `at reception`, `for a routine service`, `until Monday`, `on loan` |
| other leftover (relative clause, adjective complement, second time expression) | 169 | 28% | `follow up`, `it`, `smaller`, `this time` |
| post-verbal adverb | 70 | 12% | `separately`, `early`, `overnight`, `apart` |
| comparative | 20 | 3% | `than` |
| existential | 8 | 1% | `Are there units`, `Is there room …` |

- Minimal pairs measured with the same checker (same Stanza analysis, different template — the pair that parses
  and the pair that does not):

| parses | does not parse |
| --- | --- |
| `The van is at the depot.` | `The clinic keeps the record at the depot.` |
| `The keys are on the shelf.` / `Wolfgang left the keys on the shelf.` | `The clinic keeps the record at reception.` |
| `The parcel arrived before Friday.` (statement) / `Do I need the documents by Friday?` (question) | `Do I need the documents before Friday?` (question) |
| `The tanker will remain until Monday.` (statement) | `Will the tanker remain until Monday?` (question) |
| `The tanker will remain for a week.` | `The patients arrived early.` / `The parcel was packed separately.` / `The tanker stayed overnight.` |
| `Which team is Rotaru the coach of?` / `Which team does Rotaru coach?` | `Of which team is Rotaru the coach?` / `Rotaru coaches which team?` |
| `Is a pharmacy near the hotel?` / `Which pharmacy is near the hotel?` | `Is there a pharmacy near the hotel?` |
| `Did you put the box on the shelf?` / `Which shelf holds the box?` | `On which shelf did you put the box?` / `Which shelf did you put the box on?` |

## Proposals

### P1. Attach an oblique prepositional phrase to the clause instead of leaving it unparsed (≈332 rewrites)

- Pattern: `obl` with a `case` preposition whose argument is a **common noun** (`at reception`, `at the desk`,
  `for the reading room`, `on loan`, `for all 11 guests`) attached to a transitive verb or a noun.
  `PLACE_PREPS` (`lib/ud-to-sop/lexicon.mjs`) maps a place preposition to `location` **only when the argument's
  NER is GPE/LOC/FAC**; a common-noun place falls back to `object`, and when the object slot is already filled the
  phrase becomes a leftover → `unparsed` (`analyze.mjs`, the `p.leftovers` loops at ~1030–1054).
- Change: when a `PLACE_PREPS` phrase cannot take the object slot, assign `role location` (a place noun is a place
  even without NER), and for `TIME_PREPS`/`TIME_WORDS` arguments assign the existing `time` role/period instead of
  dropping the phrase. Add `for` to the role table: `for` + duration → `time` (`for a week` already parses), `for`
  + person → `recipient` (`for me`, `for all 11 guests`).
- Test: `tests/ud-to-sop-v14.test.mjs` fixtures + a new family in `tests/fixtures/ud-to-sop/parses-v14.json`
  (`keeps the record at reception`, `for the reading room`, `on loan`).
- Effect: removes the single largest failure family; the SOP wire gains an inspectable `role location` value
  (never a guess: the value stays the verbatim span).

### P2. Post-verbal adverbs (≈70 rewrites)

- Pattern: `advmod` after the verb that is not in `FUNCTION_ADVERBS` (`arrived early`, `packed separately`,
  `remain overnight`, `held apart`, `makes it worse`) → `leftovers` → unparsed.
- Change: split the closed adverb list in `lexicon.mjs` into (a) time adverbs (`early`, `late`, `soon`,
  `overnight`, `immediately`, `today`, …) → `role time`, mirroring `TIME_WORDS`, and (b) manner/degree adverbs
  (`separately`, `alone`, `together`, `apart`, `instead`) → merged into the relation phrase exactly like the
  existing `PARTICLES` handling in `analyze.mjs` (~line 561: `parts.push(adv.folded)`), so `packed separately`
  becomes the relation `pack separately`. `worse`/`better` stay a comparative (see P4) and `enough` becomes a
  quantity bound.
- Test: same fixture file, family `advmod`.
- Effect: conversions become faithful without inventing content.

### P3. `there is/are` with a locative (8 rewrites in wave 1, but a frequent real-user form)

- Pattern: `Is there a pharmacy near the hotel?` — the `be` + `expl` `there` branch exists (`analyze.mjs` ~551,
  `EXISTENTIAL` covers `exista`/`exist`), but a locative `obl` in the same clause is left over.
- Change: in the existential branch, take the `obl` as `role location` (P1 covers the mapping).
- Test: fixture `existential` (`Is there room for Zara and her twins at the reunion?`).

### P4. Comparatives and quantity complements (≈20 + part of "other")

- Pattern: `than` (`fewer filters than the shelf holds`, `Fewer than half the supply crates …`), adjective
  comparatives with a complement (`the smaller bottle`, `makes it worse`), `so far`, `enough`.
- Change: extend `COMPARATORS` handling (`analyze.mjs` ~463–481 handles `than` only for copular `ADJ` queries) to
  a comparative with an object complement, and treat `so far`/`this time`/`now` as time expressions (the time-adverb part of P2).
- Test: fixture `comparative`.

### P5. Question forms of temporal periods (part of P1's 332)

- Pattern: `before <time>` / `until <time>` inside a question fails, while the statement form and `by <time>`
  parse (`TIME_PREPS` maps `before → until`); the query path rejects a second time expression
  (`analyze.mjs` ~1176: `if (q.during || q.at) … 'second time expression'`), and a period at the end of a query is
  not taken as the validity form.
- Change: let one `TIME_PREPS` phrase set the query period, preferring the explicit `before/until` phrase over an
  implicit date; only a *second* explicit time expression should be reported.
- Test: fixture `query-period` (`Do I need the documents before Friday?`, `Will the tanker remain until Monday?`).

### P6. Fronted and stranded preposition questions (part of "other")

- Measured: `Of which team is Rotaru the coach?` ✗, `On which shelf did you put the box?` ✗,
  `Which shelf did you put the box on?` ✗, `From what is the returned stock being held apart?` ✗; while
  `Which team does Rotaru coach?` ✓, `Which team is Rotaru the coach of?` ✓, `Did you put the box on the shelf?` ✓.
  This is the family `symbolic-layers/summary.md` already assigns to **tree repair**, not rewriting.
- Change: extend `lib/ud-to-sop/repair.mjs` with a `TR-OBL` repair: a fronted `obl` whose `case` introduces a
  wh-word becomes the question's oblique (its `case` preposition is the relation particle), and a clause-final
  orphan `case` word (stranded preposition) is re-attached to the `obl` it belongs to before conversion.
- Test: `tests/ud-to-sop.test.mjs` + a repair fixture beside the existing `TR-WH` cases.

### P7. Relative-clause and nominal leftovers (`follow-up appointment`, `it`)

- Pattern: `Is Márta's follow-up appointment still on the waiting list for Friday?` reports `follow up`;
  `… and reception has it now` reports `it`; `On what is the appointment change dependent this time?` reports
  `this time`.
- Change: treat a hyphenated or pre-modified noun (`follow-up appointment`) as the noun phrase it is (the
  `compound`/`amod` path), resolve a pronoun object only when an antecedent noun phrase is in the same clause
  (`has it now` → the earlier object), and route `this time`/`so far` through the time-expression path (P5).
- Test: fixture `relcl`/`pronoun`.

### P8. Regression fixture from the corpus

- Keep a sealed slice of the failing rewrites as the converter's regression set: the rows in
  `datasets_sources/new_cases/symbolic-lm-check.jsonl` are the *input* to fix; after each proposal lands, re-run
  the check and compare its per-family counts (the report records `span`, `near` and `hint` for every failure).
  A small fixture (`tests/fixtures/ud-to-sop/parses-v16.json`) with 30–50 of these sentences is enough to prevent
  regressions while the families are closed one by one.

## Not fixable by rewriting, and not by these rules

Two rows are content-hard rather than template-hard and should stay reported rather than forced: a comparative
without a counterpart (`makes it worse` → span `worse`, `w09-0148`) and an indefinite place pronoun
(`anywhere`, `w09-0199`) whose only faithful substitution changes the message's wording. Both are recorded in the
delivery report with their reason.
