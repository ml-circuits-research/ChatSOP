---
title: Wire redesign proposal (2026-09-28)
status: PARTLY IMPLEMENTED (2026-09-28, see DS041); the rest PROPOSED — not normative
summary: Critical review of every sop-agent-3 wire type and a concrete redesign built on the decisions to replace `premise` with `stated` and `assumed`, remove the verbatim quote, and put every part of a model-authored proposition on its own keyword line.
---

> ARCHIVED 2026-09-28 — superseded by DS021 (model surface) in the current numbering. Open items were carried to questions.md and TODO.md. Ids and paths inside this file use the numbering of the time.

> Historical proposal, kept as a record. It predates the owner's decision of 2026-09-28 that there is one model language with no versions or profiles; the current contract is DS041.

# Wire redesign proposal — PROPOSED

> **Implementation status (2026-09-28).** The items marked **IMPLEMENTED** below are specified normatively in [DS041](../specsLoader.html?spec=DS041-stated-assumed-unclear.md) (and DS004/DS024), which win over this document. The owner then made a fundamental correction that **supersedes** parts of §3: the small model has **no context** (its prompt is the user's message only), so `relation` is a quoted phrase, roles come from a closed context-free inventory (`subject`, `object`, `recipient`, `location`, `source`, `destination`, `instrument`, `time`, `topic`) instead of lexicon-declared names, values are strings as written in the message, time expressions are strings normalized by the host, anchoring is a typo-tolerant string match against the message (not the shortlist), query conditions are string `match` blocks, and linking strings to knowledge is a host step. Everything in §3 that assumes a model-visible shortlist, canonical identifiers or lexicon role names (`role employee maria`, `valid timeless`, S1/S4/A2/A3 as written) is **SUPERSEDED**. `unclear` has only the kinds `gibberish` and `no_request`. Items not marked stay proposals.

> **Status: PROPOSED.** This document is a design proposal, not a specification. Nothing here changes the behavior of `sop/`, `server/`, `eval/` or the datasets. DS004, DS024 and the wire help pages under `docs/wire_typs/` stay authoritative until a DS amendment accepts part of this proposal. No training, GPU work or dataset regeneration is implied or authorized (AGENTS rules 2–3).

## 0. Scope, method and decisions already taken

**Reviewed material.** I read AGENTS.md; DS004 and DS024; `docs/wire_types.html` and all 45 pages under `docs/wire_typs/`; the parser `SPEC`, `validateShape`, `dependencies` and `canonical` in `sop/parser.mjs`; `sop/lower.mjs`, `sop/declarative.mjs`, `sop/conditions.mjs` and `sop/outputs.mjs`; the relevant runtime paths in `sop/runtime.mjs`, `reasoning/registry.mjs`, `reasoning/reasoner.mjs` and `sop/lexicon.mjs`; the admission guards in `server/agent.mjs` and `eval/run.mjs`; `sop/contracts/wires.json` and the EBNF; `examples/*.sop` and `tests/fixtures/*.sop`; and the corpus targets under `datasets/` and `eval/suites/`.

**Mechanical checks (read-only, scratch scripts only).**
- `sop/contracts/wires.json` matches `SPEC` exactly for all 35 types: field sets, cardinality and required fields.
- Every `SPEC` field has a row in its help-page table, and no help page documents a field that `SPEC` lacks.
- Every example on a help page that is labeled valid parses and passes `validateGraph`. Every example labeled invalid at parse time fails with the documented reason. The runtime-invalid examples parse as their pages say.
- No test or tool executes the help-page examples. DS024 checklist item 6 says "the help-page checks execute", but nothing enforces that today (§7.7).

**Decisions from the user that this proposal builds on.**

| # | Decision | Where it appears |
| --- | --- | --- |
| D1 | The model-authored `premise` is replaced by two wire types, **`stated`** and **`assumed`**. | §3 |
| D2 | `stated` is **kept as a separate wire** (the open question is closed). The model uses it only when it is sure the assertion appears in the user's message, so the claim comes from the user. Anything the model adds or infers is `assumed`. | §3.2 boundary rule |
| D3 | `assumed` is one wire type with no subtypes. The small model may emit it during the intent-detection phase to make explicit what it assumes about the user's intent or the situation. The name `assert` is rejected as confusing. | §3.4 |
| D4 | **No verbatim `quote` on `stated`.** Statements are formalized as keyword lines, one per line: relation, argument roles, polarity, time and certainty. The anchor to the message is the formal structure, checked against the lexicon and the entity shortlist. | §3.1, §3.3 |
| D5 | `basis` on `assumed` is kept with the values `closure`, `default`, `disambiguation`, `implicature` and `world`. It is optional, and absent means `unspecified`. It is descriptive only: shown in the packet and used for metrics, **never** for trust, admission or reasoning. A preregistered criterion decides later whether it becomes influential or is dropped. | §3.4, §3.6 |
| D6 | By default the reasoner ignores `assumed` and lists it in `packet.model_assumptions`. Only when the host policy is `modelAssumptions: 'branch'` does it run as a hypothetical branch, through `fact` with an assumption origin plus `solve` supposition, and that result is marked hypothetical. It is never stored and never rendered as a fact. | §3.4 |

**Design principles used throughout this review.** These put the user's request in operational terms: "as broad and sophisticated as possible, but with keywords on separate lines so the exact intent is clear".

- **P-1: One intent per line.** A line states one thing. Polarity, time, certainty and cardinality are separate lines on model-authored wires; they are not packed inside another value.
- **P-2: No silent semantic defaults on model-authored wires.** If leaving out a field changes the meaning (`task prove` vs `possible`, `at now` vs timeless), the field is required. Defaults remain acceptable only for host budgets and presentation.
- **P-3: Enumerations and free text never share a field.** A field is either a closed enum that the runtime acts on, or free text that the runtime never branches on. Today's `fact.source` breaks this rule (§2.1).
- **P-4: One name, one meaning.** A keyword means the same thing on every wire. Today `mode` has seven meanings and `source` has three.
- **P-5: One token class, one meaning.** `$x`, `?x`, `"text"`, `symbol` and integers mean the same in every field that accepts terms. Whole-line text fields are always JSON-quoted in canonical form.
- **P-6: No field whose meaning depends on another field's value.** Where two readings exist, use two keywords.
- **P-7: The boundaries are unchanged.** The model authors problem descriptions only (rule 5). A read never hides a write (rule 7). A requested backend is never substituted (rule 8). Relations stay whitespace-separated with no parentheses or commas, and Boolean structure uses `all`/`any`/`end` (rule 6). Every new model construct passes the DS024 checklist (§3.7).

---

## 1. Summary table

Priorities:
- **P0**: correctness or safety defect, a documented guarantee that is not enforced, or a model-surface change the user has already decided.
- **P1**: model or host intent is hidden or ambiguous. Fix in the next profile.
- **P2**: cleanup, naming, or future expressiveness.

"Breaking" means that existing SOP text, corpora or tests stop parsing or change meaning.

| Wire | Problem | Proposed change | Breaking? | Priority |
| --- | --- | --- | --- | --- |
| `premise` | It conflates what the user said with what the model assumes. A user assertion ("Ana is a parent of Maria. Is Ana a parent of Maria?") comes back `hypothetical: true`. | Replace it with `stated` and `assumed` (§3). **IMPLEMENTED (DS041): replaced on the sop-agent-4 model surface; `premise` stays for trusted circuits and legacy sop-agent-3.** | Yes: model surface and about 84.5k corpus rows | P0 (decided) |
| `stated` / `assumed` | The atom packs relation, argument order and polarity into one `holds` line (`holds not p a b`). | Use keyword lines: `relation`, `role NAME TERM` (repeated), `polarity`, `valid timeless` or `from`/`until`/`on`, plus `certainty` or `basis` (§3.1). **IMPLEMENTED WITH CHANGES (DS041): keyword lines with a quoted relation phrase, closed role inventory, `polarity`, optional `valid on|from|until "text"`.** | New wires | P0 (decided) |
| `fact` | `source` is both free provenance text ("catalog card 17") and a semantic switch (`source assumption` changes admission, guard and storage behavior). It defaults to `user` silently. | Split it into `origin user\|document\|host\|assumption` (a required enum) and `cite "…"` (free text). | Yes: host circuits and ingestion | P0 |
| `fact` (assumption origin) | DS004 promises that an assumption-sourced fact is rejected without an `assume` consumer and is never stored. The core runtime enforces neither: `remember` accepts it, and `solve.data` admits it as an observed premise. The eval `factGuard` exempts only facts referenced *directly* by `assume $x`, so a packed assumption is rejected by mistake. | Enforce this in `Runtime`: an assumption-origin fact is accepted only by `suppose`/`assume`, `remember` rejects it, and `data`/`evidence` rejects it. Compute the exemption after flattening packs. **IMPLEMENTED: runtime enforcement of assumption-origin facts, extended to the evidence-like operands of reasoning operations (`observation`, `tests`, `cue`, `holdout`, `candidates`, `source`, `target`).** | No (fixes a bug) | P0 |
| `value` | It evaluates the same expression language as `jsEval`, including calls and operators, without checking `allowJsEval`. The policy switch is therefore bypassable. | Restrict `value` to JSON literals and whole `$ref`s. Expressions go through `jsEval` only. As a minimum, gate non-literal `value` on `allowJsEval`. **SUPERSEDED: the owner removed the `allowJsEval` policy entirely; `jsEval` and `value` expressions are always allowed in trusted/host circuits and impossible for the model.** | Yes: `examples/constraint.sop`, `auto-template.sop`, `expand.sop` and the template fixtures | P0 |
| Help pages (13 reasoning pages) | They say "Space-separated `predicate arg` is not executable syntax". That is the exact **opposite** of the grammar. | Replace it with "Parenthesized `predicate(arg, …)` is not executable syntax". | No | P0 |
| `query.html` | It says query is "one of the **four** allowed model-authored declarative types". There are three today (and four after this proposal). | Fix the count and link to `stated`/`assumed`. **IMPLEMENTED: the page names the five sop-agent-4 declarations.** | No | P0 |
| `constraint` | `task` silently defaults to `prove`. `possible` and `prove` give opposite readings of the same claim. | Make it required on model-authored constraints. The corpora already write it on every row. Rename it to `ask` (P1). **IMPLEMENTED (DS041): `task` required in sop-agent-4 model output (not renamed).** | Hardly (every corpus row already has it) | P0 |
| `query` | `mode` defaults to `select` when `select` is present and to `exists` otherwise. `explain` behaves exactly like `exists` (only the packet `kind` label differs). `count` without `select` counts whole bindings. | Add a required `ask whether\|which\|count`. `select` is allowed only with `which`/`count`. Drop `explain`, because every result already carries the proof. | Yes | P1 |
| `query` | The default is `at now`. A question with no time filters out timeless-looking facts and assumptions valid only in the past (the `filterTime` path). No grounded-paraphrase query states a time. | On model queries, require exactly one of `at INSTANT\|now` or `during START END`. The packet always echoes the effective time. | Yes | P1 |
| `query` | Cardinality intent is hidden. The model's `select ?x` says nothing about whether the user presupposes one answer ("Who is *the* manager?") or several. The host decides `one` vs `rows` itself. | Add an optional `expect one\|many`. The host checks it and reports `presupposition_failed` instead of silently returning rows. | No (additive) | P1 |
| `query` | The model can set `limit`, which is a resource budget. Truncating a query that has no ordering returns an arbitrary subset. | Remove `limit` from the model surface; it stays a host budget. | Yes (unused in corpora) | P1 |
| `query.filter`, `constraint.require/claim` | Leaves accept `&&`, `\|\|`, `!` and two spellings of equality (`==`/`===`, `!=`/`!==`). This is a second Boolean syntax next to `all`/`any`/`end` (rule 6). | For model origin, a leaf is a single comparison `EXPR OP EXPR` with `OP ∈ {==, !=, <, <=, >, >=}`. Add a `none … end` group for numeric conditions only. | Yes for model origin (unused in corpora) | P1 |
| `constraint` | `claim` means "the claim to test" for prove/possible but "an extra feasibility condition" for optimize. `direction` is accepted and ignored outside optimize. | `claim` is required for prove/possible and forbidden for optimize. `objective` and `direction` become `minimize EXPR` or `maximize EXPR`. | Yes | P1 |
| `constraint` | One `unit` applies to the whole problem and is never checked. | Use `unit ?var LABEL` (repeatable, per variable). Comparing variables with different declared units is rejected, with no conversion. | Yes (rarely used) | P2 |
| `solve` | `assume` collides with the new `assumed` wire, and with `hypothesis.assume`. `data` and `assume` take one value, which is the only reason `pack` exists in generated circuits. | Rename `data` to `evidence` and `assume` to `suppose`. Both repeatable, several `$refs` per line. | Yes (host only) | P1 |
| `solve` et al. | `output ?x` defaults to `one`. | Make the output mode required. | Yes (host only) | P1 |
| `solve`/`reason` | An explicit `backend prolog\|z3` with no `reasoning` switches the strategy to `advanced` implicitly (`chooseReasoning`). | Reject it with an error: "explicit backend requires `reasoning advanced`". This is consistent with rule 8's no-surprise routing. | Yes (host only) | P1 |
| `pack` | It exists only because consumers take one value. It has no type check and is flattened recursively. | Retire it from generated circuits once the consumers are repeatable. Keep it for trusted circuits for one deprecation window. | Yes (host only) | P1 |
| `mode` (7 wires) | The same keyword means query shape, rule kind, simulation kind, association metric, reasoning operation, output cardinality and binding cardinality. | Rename per wire: `query.ask`, `rule.kind`, `simulate.kind`, `associate.metric`, `reason.operation`. Output modes keep their positional word. | Yes | P1 |
| `event` | Required fields depend on the action (`effective` for `end`, `replacement` for `correct`) but are checked only when `remember` applies the event. `source` defaults to `user`. | Validate per action at parse time. Use `origin` and `cite` as on `fact`. | Yes (host only) | P1 |
| `cnl` | `language` defaults to `ro`, while the declarative compiler defaults to `en`. Any unknown code silently renders English. | Make `language` required and reject codes without a message table. **IMPLEMENTED WITH CHANGES: `cnl.language` defaults to `en` everywhere (not required); `ro` on request.** | Yes (host only) | P1 |
| `analogize` | Its operand field is called `source`, which collides with provenance `source`. `dependencies()` special-cases it. | Rename `source` to `base`. | Yes (host only) | P1 |
| `hypothesis` | It has `holds` (one) plus `assume` (many), two names for the same kind of atom. `assume` collides again. | Use a repeatable `holds`. | Yes (host only) | P1 |
| `policy` (wire) | The name collides with host policy (`allowWrite`, `modelAssumptions`, `reinforce`), which the wire cannot touch. | Rename it to `budget`, and rename the consumer field `policy` to `budget`. | Yes (host only) | P1 |
| `template` / `procedure` | Same field set, same runtime path, different names, and no executable difference. | Merge them into `procedure`. | Yes (host library) | P1 |
| `recall` / `link` | `recall` is `link` without `data`. `recall` also reads like `resolve`. | Merge them into `retrieve` with optional `evidence`. | Yes (host only) | P2 |
| `entity` / `predicate` / `concept` | They have pages but no `SPEC`, so unknown fields are ignored. `entity.kind` means entity type, while `resolve.kind` means entry kind and `resolve.type` means entity type. | Add a strict ontology SPEC. Rename `entity.kind` to `type`. Add `predicate.role NAME TYPE`, which `stated`/`assumed` need. **IMPLEMENTED WITH CHANGES: strict `ONTOLOGY_SPEC` (unknown fields and duplicate singletons rejected); `predicate.role NAME TYPE` with NAME from the closed inventory; `entity.kind` kept.** | Yes (ontologies) | P1 (role lines are P0 for §3) |
| Text fields | `resolve.text`, `clarify.text`, `fact.quote` and `trace.text` accept both quoted and unquoted text, while `expand.with` treats unquoted text as a string, atoms treat it as a symbol and `value` rejects it. | Canonical form is always JSON-quoted. Unquoted text is accepted only in trusted origin, with a deprecation warning. | Yes (lenient phase first) | P1 |
| `binding` | It is in `SPEC`, yet authored `binding` is always rejected, and only at runtime. | Remove it from `SPEC`; it becomes an internal-only type. | No | P2 |
| `theory` | It is declared with no compiler registered, so it always yields `unsupported_theory`. | Keep it, but mark it experimental in `SPEC`, or remove it until a compiler exists. | Maybe | P2 |
| `reason` | `mode` accepts any registry operation (abduce, plan, …), which duplicates the dedicated wires. It is host-internal in practice. | Restrict `operation` to `deduce\|temporal` and document it as internal to `solve`. | Yes (host only) | P2 |
| `abduce` / `diagnose` | "Exactly one of `query`/`observation`" is enforced only at runtime. | Validate it at parse time. | No | P2 |
| `clarify` | Empty `text` parses. | Require non-empty quoted text. | No | P2 |
| `trace.known`, `query.asof` | These are two names for knowledge time. | Name both `known_by`. | Yes | P2 |
| Help pages | Three different page templates. The boilerplate paragraph is repeated on 13 pages. There is no executable example check. | One template, and add `tests/wire-help.test.mjs` to execute every example. | No | P1 |

---

## 2. Findings across wires

### 2.1 `source` is both provenance text and a semantic switch (P0)

On `fact`, `rule`, `pattern`, `hypothesis`, `action`, `trace` and `event`, the `source` field is free text ("catalog card 17", "operator note"). DS004 then gives one magic value, `source assumption`, runtime meaning: the fact must be consumed by `assume`, it is exempt from the provenance guard, and it must never be stored or reinforced. On `analogize`, `source` is an operand (`dependencies()` in `sop/parser.mjs` excludes `source` from dependency scanning *except* on `analogize`). So one keyword means provenance text, trust class or input value depending on the wire and the value.

The guarantees attached to the magic value are not enforced where DS004 places them:
- `Runtime.run` never checks that a `source assumption` fact has an `assume` consumer. Without a host `factGuard` (and only `eval/run.mjs` installs one), such a fact passed through `solve.data` is admitted as an **observed, non-hypothetical** local premise.
- The `remember` effect loop accepts any `kind === 'fact'`, so a `source assumption` fact can be recorded in the session. That contradicts DS004's "never … stored".
- `assumedFactWires` is built from the raw text of `assume` fields. A fact reached through `assume $pack` is therefore *not* exempt, and the eval guard `fact.source === 'user'` rejects it. This is a false rejection.

**Proposal.**
- `origin` is a required closed enum: `user | document | host | assumption`. The runtime acts on it.
- `cite` is optional free text. The runtime never branches on it.
- `quote` stays for document-grounded facts, where DS014 requires exact source quotations. It is not used by `stated`.
- Enforcement moves into `Runtime`:
  - An `origin assumption` fact may be consumed only by `suppose`.
  - `evidence`/`data` and `remember` reject it with `assumption_fact_not_evidence` or `assumption_fact_not_recordable`.
  - Reinforcement already excludes local facts; it also excludes this origin explicitly.
  - The consumer check runs on flattened values, not on field text.

```sop
# before
@catalog fact
  holds on_shelf book_a shelf_north
  valid timeless
  source "catalog card 17"

# after
@catalog fact
  holds on_shelf book_a shelf_north
  valid timeless
  origin document
  cite "catalog card 17"
```

### 2.2 Implicit defaults that change meaning

| Wire.field | Default today | Why the default is not neutral | Proposal |
| --- | --- | --- | --- |
| `constraint.task` | `prove` | It flips the claim between "in every model" and "in some model". | Required, as `ask entailed\|possible\|optimize` |
| `query.mode` | `select` if `select` is present, otherwise `exists` | The answer shape depends on another field. | Required, as `ask` |
| `query.at` | runtime now | It filters evidence and assumptions by valid time. | Required (`at now` is explicit) |
| `fact.source` / `event.source` | `user` | It asserts a trust class that nobody wrote. | Required `origin` |
| `output` mode | `one` | It turns "several answers" into `ambiguous`. | Required |
| `cnl.language` | `ro` (while `declarative.mjs` defaults to `en`) | The rendered language depends on which path produced the circuit. | Required |
| `constraint.direction` | `min`, ignored outside optimize | A value is accepted and has no effect. | Folded into `minimize`/`maximize` |
| `premise.valid` | `timeless` | It widens a statement the user may have scoped in time. | `stated`/`assumed` require an explicit time form |
| `solve`/`reason` `reasoning` | `advanced` when an explicit non-JS `backend` is present, otherwise the host default | An explicit backend changes the strategy implicitly. | Reject; require an explicit `reasoning advanced` |
| `rule.mode`, `simulate.mode` | `logical`, `whatif` | These are acceptable defaults (a host-authored library), but they should be renamed (P-4). | Rename to `kind` |

Host budgets (`limit`, the `policy`/`budget` fields, `strategy`) keep their defaults. They bound work; they do not change what is asked.

### 2.3 Fields whose meaning changes with other fields

- **`query.select` + `mode`.** With `mode exists` a `select` list is accepted but does nothing. With `count` it changes what is counted.
- **`constraint.claim` + `task optimize`.** It becomes an extra requirement.
- **`solve.data`/`assume` with `constraint`.** Forbidden. **`reason.memory`/`data`/`assume` with `constraint`.** Silently ignored (the `reason` page says so).
- **`event.effective`/`replacement`.** Required or ignored depending on `action`. For `retract`, `effective` is parsed and then dropped.
- **`abduce.observation`.** Ignored when `query` is present.
- **`plan.actions`.** When it is non-empty, it overrides the actions inside `data`.

Each case gets either separate keywords or a parse-time exclusivity rule (§5).

### 2.4 `$ref`, `?var` and `"quoted"` across fields (P1)

| Token | In atoms | In `expand.with` | In `value.data` | In text fields |
| --- | --- | --- | --- | --- |
| `maria` | canonical symbol | string `"maria"` | rejected (free name) | literal text |
| `"Maria"` | string term (not identity) | string | string | text (quotes stripped) |
| `$x` | resolved value | resolved value | resolved value | inert text |
| `"?x"` | **logic variable** after decoding (DS004) | string | string | text |

The row for `"?x"` in atoms is a trap: quoting does not make it data. The proposal:
- Canonical form quotes every whole-line text field.
- `expand.with` must use a typed term (a symbol, a `"string"`, an integer or a `$ref`), exactly as in atoms.
- The atom decoder rejects a quoted string whose content matches `^[?$~][A-Za-z]`, with the error "quoted sigil text is not a term; use a text field".

### 2.5 `select` on query vs `output ?x many` on solve

Today the model says *which* variables matter (`select`), and the host alone decides the cardinality contract (`output ?x one` when a later constraint consumes `$x`, and rows otherwise). The user's presupposition ("the manager", "which books", "how many") is never recorded. The proposal:
- Split `query.ask` into `whether | which | count`.
- Add the optional `expect one|many`, which states the presupposition.
- The host maps `which` + `expect one` to `output ?x one` and `which` + `expect many` (or absent) to `output ?x many`. A downstream `$x` still forces `one` and an explicit clarification.
- The packet reports `presupposition_failed` (zero or several answers under `expect one`) instead of silently switching shape.

### 2.6 `pack` exists only because consumers take one value

`remember.input` is already repeatable with several `$refs` per line, so it never needs `pack`. `solve.data`, `solve.assume`, `link.data`, `abduce.candidates`, `induce.data` and the rest take one value. The declarative compiler then emits a `pack` whenever more than one assumption exists. The proposal is to make every collection-consuming field repeatable, with several `$refs` per line, and to have the compiler emit no `pack`. `pack` stays in trusted circuits for one deprecation window.

```sop
# before (generated today)
@host3 pack
  items $retained0 $premise0
@host4 solve
  query $q
  assume $host3

# after
@host4 solve
  query $q
  suppose $retained0 $a1
  output ?status status
```

### 2.7 Naming collisions

| Collision | Problem | Proposal |
| --- | --- | --- |
| `solve.assume` / `hypothesis.assume` / `assumed` | Three meanings of "assume". | `solve.suppose`; `hypothesis.holds` (repeatable); `assumed` stays the only wire of that name. |
| `fact` / `stated` | Both lower to a user fact. | Keep both. `stated` is the model's formalized report of the message. `fact` is a host value with `origin`. The docs present `stated` as "compiles to `fact origin user`, turn-scoped". |
| `claim` | Constraint `claim` vs repository "claim IDs" (`remember` receipts, `event.target`). | Keep `claim` on the constraint (it is the tested proposition). In prose, call repository records "records" (P2). |
| `task` | Reads as an action, not a question. | `ask`, shared with `query.ask`. |
| `valid` vs `at`/`during` | Valid-time *extent* of a statement vs valid-time *probe* of a question. | Statements: `valid timeless` or `from`/`until`/`on`. Questions: `at`/`during`. Knowledge time: `known_by`. |
| `pattern` / `template` / `procedure` / `rule` | Four names for "when … then" or "reusable circuit". | `rule` (approved implication), `pattern` (candidate implication; keep it separate for safety), `procedure` (reusable circuit; absorbs `template`). |
| `reason` / `solve` | `reason` is the inner stage that `solve` generates. | `reason` becomes host-internal, with `operation deduce\|temporal`. |
| `recall` / `resolve` / `link` | "recall" vs "resolve" reads alike, and recall is a subset of link. | `resolve` (lexicon lookup) stays. `recall` and `link` merge into `retrieve`. |
| `policy` wire / host policy | The wire only tightens budgets. | `budget`. |
| `source` | Provenance, trust class, or operand. | `origin` + `cite`; `analogize.base`. |
| `mode` | Seven meanings. | Renamed per wire (§1). |
| `status` | Pattern status, hypothesis status, output mode `status`, packet status. | Keep the packet `status`. `pattern.review`, `hypothesis.review` (P2). |
| `kind` | `resolve.kind` (entry kind) vs `entity.kind` (entity type). | `entity.type`. |

### 2.8 Polarity: `holds not p a b` vs an explicit `polarity` line

- **Model-authored single-proposition wires (`stated`, `assumed`).** Use a **required `polarity affirmed|negated` line** (decision D4, principle P-1).
- **Condition leaves in `query.where` and host atoms (`fact.holds`, `rule.when/then`, `trace.feature`, …).** Keep the `not` prefix. A leaf lives inside `all`/`any`/`end` groups, where a separate line cannot be attached to one leaf without a sub-block. Rules and facts are host-authored and compact.

The cost is two spellings of polarity: one on keyword-form propositions and one on positional atoms. This is accepted because the two forms never appear on the same wire type, and the lowering is fixed (§3.5). The keyword form of query leaves is considered in §4.1 as a P2 experiment.

### 2.9 Missing expressiveness that stays inside the boundaries

| Need | Today | Proposal | Priority |
| --- | --- | --- | --- |
| Who said it (source/speaker attribution) | Not representable. The model can only produce a premise. | `stated` means the user said it. Reported speech ("Ana says Maria left") needs `speaker`. An optional `speaker ENTITY` on `stated` would lower to the supposed branch with attribution. **Not executable until reported-speech semantics exist; returns `unsupported`.** | P2 |
| Certainty of the user's assertion | Not representable. | `stated.certainty asserted\|hedged\|supposed` (§3.3). Qualitative only; no numeric certainty, because none is calibrated. | P0 (part of §3) |
| Certainty of the model's assumption | Not representable. | `assumed` is uncertain by definition. `basis` is descriptive only (D5). | P0 |
| Explicit quantifier scope | Variables are implicitly existential, and `select` frees them. | Document this. A bounded universal over a declared finite set stays the DS024 proposal (`general_quantification` blocked). | P2 |
| Units | One unchecked `unit` per constraint. | Per-variable `unit ?var LABEL` with a same-unit comparison check and no conversion. | P2 |
| Comparison on relational values | `query.filter` (JS-like leaf). | Single-comparison leaves only (§1). | P1 |
| Time on statements | `valid START END` with `beginning`/`open`. | `from`, `until`, `on` lines (§3.3). | P0 (part of §3) |
| Presupposed cardinality | Hidden. | `query.expect` (§2.5). | P1 |
| Negation of a numeric group | Only `!EXPR`. | A `none … end` group, numeric only. Classical negation is sound over finite integer domains. It is **not** added to relational `where`, where it would mean negation-as-failure. | P2 |

### 2.10 Dead, undocumented or mismatched wires

- `SPEC` and `contracts/wires.json` agree for all 35 types. Every SPEC field is documented. No page documents a field that SPEC lacks.
- `entity`, `predicate` and `concept` have pages but no `SPEC`. The lexicon parses them with `allowTypes` and **ignores unknown fields**; the help pages tell reviewers to reject those fields by hand. → strict ontology SPEC (P1).
- `binding` is in `SPEC` and documented, but authored `binding` is always rejected, and only at runtime. → remove it from `SPEC` (P2).
- `theory` has no registered compiler and always yields `unsupported_theory`. → mark it experimental (P2).
- `query.mode explain` is accepted but has no behavior distinct from `exists`. → drop it (P1).
- `premise.html` stays until the migration completes, then becomes a "retired" page that points to `stated`/`assumed`.

### 2.11 Help-page quality

- **P0.** The 13 reasoning pages (`abduce`, `action`, `analogize`, `associate`, `diagnose`, `goal`, `hypothesis`, `induce`, `pattern`, `plan`, `simulate`, `temporal`, `trace`) say "Space-separated `predicate arg` is not executable syntax". This contradicts DS004 and the parser, and should read "Parenthesized `predicate(arg, …)`".
- **P0.** `query.html`: "one of the four allowed model-authored declarative types" (there are three).
- **P1.**
  - `constraint.html` says "explicit backend z3 requires advanced". The runtime *switches* to advanced implicitly.
  - `constraint.html` says "direction … accepted but ignored" without calling it a defect.
  - `cnl.html` documents the `ro` default without pointing out the inconsistency.
- **P1.** Three table templates are in use:
  - "Keyword / Cardinality / default / Accepted value"
  - "Field / multiplicity"
  - "Status and author" + "Accepted fields"

  Unify them into one template: purpose; author (model / host / reviewed); field table; semantics; valid examples; invalid examples each labeled with *the stage that rejects them* (parse, graph, lowering, runtime, guard); sources.
- **P1.** Invalid examples say "the parser accepts … runtime rejects" without the exact error text. Add the expected error substring so the new help test can assert it.
- **P2.** `premise.html` and `small-model.html` still describe `premise`. `small-model.html` ends with "Assumption exercises require a distinct hypothetical-input contract". `assumed` is that contract.

---

## 3. Formal specification: `stated` and `assumed` (IMPLEMENTED WITH CHANGES in DS041; shortlist, identifier and lexicon-role parts SUPERSEDED)

### 3.1 Shared proposition form

Both wires carry **exactly one ground proposition**, written as keyword lines rather than a packed atom. This replaces `premise.holds`.

| Keyword | Cardinality | Value grammar | Meaning |
| --- | --- | --- | --- |
| `relation` | exactly once, required | canonical predicate ID from the turn's shortlist | The relation asserted or assumed. |
| `role` | once per declared role of the predicate, required, no repetition of a role name | `role ROLE_NAME TERM`: exactly two whitespace-separated tokens | Binds one argument by name. `ROLE_NAME` must be a role declared by the predicate (§3.1.1). `TERM` is a canonical entity ID from the shortlist, a JSON-quoted surface mention that the host resolves (`"Maria Ionescu"`), or a safe integer. **No `?variable`, no `$ref`, no `~handle`.** |
| `polarity` | exactly once, required | `affirmed` \| `negated` | Explicit (strong) negation when `negated`. Absence of evidence is never expressed this way. |
| `valid` | at most once | `timeless` only | The proposition has no temporal extent. |
| `from` | at most once | ISO date `YYYY-MM-DD` or UTC timestamp | Inclusive start of validity. |
| `until` | at most once | ISO date or UTC timestamp | Exclusive end of validity. |
| `on` | at most once | ISO date `YYYY-MM-DD` | Shorthand for `from D` + `until D+1 day`. |

**Time rule.** Exactly one of three forms is required: `valid timeless`; `on D`; or at least one of `from`/`until`. When both `from` and `until` are present, `from < until`. `on` excludes `from` and `until`. There is no default (P-2). A missing `from` lowers to `beginning`, and a missing `until` lowers to `open`.

**Canonical line order.** `relation`; the `role` lines in the predicate's declared role order; `polarity`; the time form; then the wire-specific lines (`certainty` for `stated`, `basis` for `assumed`). `canonical()` emits this order, and the parser accepts any order.

#### 3.1.1 Role names: explicit keywords vs positional terms

| | Positional atom (`holds works_at maria acme`) | Role keywords (`role employee maria`) |
| --- | --- | --- |
| Argument direction | Implicit in the order. `argument_reversal` and `role_inversion` are known corpus families *because* reversal is easy. | Explicit. A reversal becomes a visible naming error that the lexicon type check can catch when the types differ, and a human reviewer can catch when they do not. |
| Polarity and time | `not` prefix; one `valid START END` line. | Separate lines. |
| Checkability | Arity and type by position. | Arity, type **and role-name set**. An unknown or duplicate role is rejected mechanically. |
| Output length | 1 line. | About 5–7 lines. That is roughly 3–4 times the tokens per statement. For grounded-paraphrase (about 84.5k rows containing `premise`, most with two statement wires) the target text grows substantially. |
| Lexicon requirement | `args TYPE…`. | Named roles per predicate. **All existing ontologies need migration.** |
| Surface consistency | Same as `query.where`, `fact` and `rule`. | Differs from `query.where` leaves (§2.8, §4.1). |
| Model vocabulary | Predicate IDs only. | Predicate IDs plus their role names, which the shortlist must now show. |

**Recommended canonical form.** Use role keywords on `stated` and `assumed`, with role names declared by the lexicon:

```sop
@works_at predicate
  role employee person
  role employer organization
  label en "works at"
```

`role NAME TYPE` lines replace `args TYPE…`. `args` stays readable for one window and is derived from the role order.

A predicate with no declared role names gets the implicit names `arg1` … `argN`. This fallback keeps the form mechanical, but it is weak for intent, so the corpus audit reports it as `unnamed_roles`. Builders should supply names. For example, for the grounded-paraphrase predicate glossed "was recorded earlier than", the names would be `earlier` and `later`.

**Lowering to the existing atom** is mechanical: `relation p` + roles sorted by the predicate's role order → `p t1 … tn`, and `polarity negated` adds the `not` prefix. The lowered atom is exactly what `parseAtom` accepts today, so the reasoners, the SWI adapter and the oracles need no change.

### 3.2 Boundary rule between `stated` and `assumed` (closed decision D2)

> **`stated` is used only when the model is sure the assertion appears in the user's message.** The claim comes from the user. **Anything the model adds, infers, completes or presupposes is `assumed`.** When in doubt, `assumed`.

"The user's message" means the text segments the user supplied in this turn: the question plus any attached assertions (`context_assertions` in `assertions_query` rows). Earlier turns are *conversation context*, not this message (§3.3 lifecycle).

| Utterance | Correct form | Why |
| --- | --- | --- |
| "Since Nera left the lab, who runs it now?" | `stated` (Nera left the lab, `certainty asserted`) + `query` | An assertion embedded in a question is still asserted by the user. |
| "Ana is a parent of Maria. Is Ana a parent of Maria?" | `stated` + `query` | Explicit assertion. The result is **not** hypothetical (today's `premise` makes it hypothetical). |
| "Is Ana *still* at Acme?" | `assumed` (works_at ana acme, from some earlier time) `basis implicature` + `query` | "Still" presupposes a prior state that the user did not assert. |
| "Rooms A and B are booked. Is room C free?" | `stated` × 2 + `assumed` (`booked room_c`, `polarity negated`) `basis closure` + `query` | The user never said C is not booked. Treating the list as complete is a closure assumption. |
| "Dorin finished before Avela." (grounded-paraphrase `@n`: `not handled avela dorin`) | `stated` (handled dorin avela) + `assumed` (`polarity negated`, the reversed roles) `basis world` | Asymmetry of "before" is world knowledge, not something the user said. |
| "Suppose Maria works at Acme. Would she work at Acme?" | `stated` `certainty supposed` + `query` | The user put the proposition forward without asserting it. It comes from the user, so it is not `assumed`. |
| "I think the door is open. Are the rooms connected?" | `stated` `certainty hedged` + `query` | The user asserted it, weakly. |
| "Is the bank open?" (two `bank` entities) | No `assumed`. The host clarifies. | Choosing an ambiguous identity is host work (DS004, DS024 "Rejected"). `assumed` may not bind an entity listed as ambiguous in the turn's micro-context. |
| "Maria (the one at Acme) — did she sign?" | `stated` (works_at maria acme) + `query` | The parenthetical is an assertion in the message. |
| "Tweety is a bird. Can Tweety fly?" | `stated` (bird tweety) + optional `assumed` (flies tweety) `basis default` + `query` | The default "birds fly" is the model's addition. It is ignored unless the host branches. |

### 3.3 `stated` (PROPOSED)

**Purpose.** A formalized report of one proposition that the user's message puts forward. It is model-authored, turn-scoped and non-writing.

**Fields.** The §3.1 proposition fields, plus:

| Keyword | Cardinality | Values | Meaning |
| --- | --- | --- | --- |
| `certainty` | exactly once, required | `asserted` \| `hedged` \| `supposed` | The user's commitment. **Refinement of D1; see open question Q3.** |

No other field is accepted. In particular, the following are rejected:
- `holds`: use keyword lines;
- `quote`: decision D4;
- `source`, `origin`, `cite`: the host attaches provenance;
- `basis`: it belongs to `assumed`;
- `speaker`: P2, currently `unsupported`;
- any write field.

**Validation rules.** These run in the parser, then in the declarative compiler and the agent vocabulary guard. The rule ID is the error code prefix.

1. **S1.** `relation` is in the turn shortlist; otherwise `stated_relation_not_in_shortlist`.
2. **S2.** The set of role names equals the predicate's declared role set exactly: no missing role, no extra role, no repeated role.
3. **S3.** Each `TERM` type-checks against its role's type. The existing `atomGuard`/`validateAtom` applies after lowering.
4. **S4 (anchoring, replaces the quote).** Every entity `TERM` must be one of:
   - a canonical entity that the host's micro-context found **mentioned in this turn's message segments** (`canonicalMentions`); or
   - a JSON-quoted surface that occurs in a message segment after the lexicon's normalization and resolves uniquely.

   Otherwise the result is `stated_entity_not_in_message`. The model should then use `assumed` or a query variable. The relation is not lexically anchored, because users paraphrase relations; S1 is the relation's anchor.
5. **S5.** No `?variable`, `$ref` or `~handle` in any field.
6. **S6.** The §3.1 time rule. `from < until`. `on` takes a date only.
7. **S7.** There is at most one `stated` per identical lowered (atom, valid, certainty). An exact duplicate is rejected as a formalization error. Two `stated` wires with contrary polarity over overlapping validity are **accepted**, and the result reports the conflict (`both`), following DS004's "explicit conflict is exposed".
8. **S8.** A `stated` may not duplicate an `assumed` in the same turn (the same lowered atom and valid). The `assumed` is the one rejected.

**Semantics and lowering.**

| `certainty` | Lowered host value | Used by `solve` as | Result marking |
| --- | --- | --- | --- |
| `asserted` | `fact`: `holds <lowered atom>`, `valid …`, `origin user`, `scope turn` | `evidence` (today's `data`): an admitted local premise for this turn | Not hypothetical. A proof that uses it cites `origin user`. |
| `hedged` | `fact` … `origin assumption`, `scope turn`, marked `user_hedged` | `suppose` (today's `assume`), with defeat semantics (DS004) | `hypothetical: true` when used |
| `supposed` | the same as `hedged`, marked `user_supposed` | `suppose` | `hypothetical: true` when used |

User-origin suppositions (`hedged`, `supposed`) always run in the primary result, regardless of `modelAssumptions`. The user authorized them. A contrary admitted fact defeats them exactly as DS004 describes, and the packet lists the defeat.

**Lifecycle.**
1. Authored.
2. Parsed.
3. Validated (S1–S8).
4. Lowered to a turn-scoped `fact`.
5. Consumed by the turn's generated `solve` wires.
6. Reported in `packet.user_statements`.
7. Discarded from the execution state.

It is **never stored**: `remember` rejects `scope turn` facts with `turn_fact_not_recordable`. It is **never reinforced**, because local and turn facts are excluded from `reinforce`. Recording a user statement requires a separate trusted `remember` of a host-constructed `fact origin user` under `allowWrite`, which rule 7 keeps visible. Whether the statement is carried into later turns as caller-owned context, the way `premise` is carried today, is open question Q4.

**Packet fields** (added to the result packet of the turn):

```json
"user_statements": [
  {"id": "s1", "atom": "works_at maria acme", "polarity": "affirmed",
   "valid": {"from": "beginning", "until": "open"}, "certainty": "asserted",
   "lowered": "fact origin user scope turn",
   "used_in_proof": true, "defeated": false, "conflict": false,
   "statement": "Maria works at Acme (you said so)."}
]
```

`statement` is rendered by the host, as `explainAssumption` does today, never by the model.

**Valid examples.**

```sop
# "Since Nera left the lab, who runs it now?"
@s1 stated
  relation left
  role person nera
  role place lab_alpha
  polarity affirmed
  valid timeless
  certainty asserted
@q query
  ask which
  select ?who
  where runs ?who lab_alpha
  at now
```

```sop
# "Dorin finished cataloguing before Avela." (attached assertion) + question
@s1 stated
  relation handled
  role earlier dorin
  role later avela
  polarity affirmed
  valid timeless
  certainty asserted
@q query
  ask whether
  where handled dorin avela
  at now
```

```sop
# "Suppose Maria worked at Acme during 2025. Was she at Acme in June 2025?"
@s1 stated
  relation works_at
  role employee maria
  role employer acme
  polarity affirmed
  from 2025-01-01
  until 2026-01-01
  certainty supposed
@q query
  ask whether
  where works_at maria acme
  at 2025-06-15
```

```sop
# "The shop was not open on 3 March."
@s1 stated
  relation open
  role place shop
  polarity negated
  on 2026-03-03
  certainty asserted
```

**Invalid examples.**

```sop
@bad stated
  holds works_at maria acme
  certainty asserted
```
Rejected at parse: `holds` is not a `stated` field, so the keyword form is required.

```sop
@bad stated
  relation works_at
  role employee maria
  role employer acme
  valid timeless
  certainty asserted
```
Rejected at parse: `polarity` is required (no default, P-2).

```sop
@bad stated
  relation works_at
  role person maria
  role employer acme
  polarity affirmed
  valid timeless
  certainty asserted
```
Rejected by S2: `person` is not a role of `works_at` (its roles are `employee` and `employer`).

```sop
@bad stated
  relation works_at
  role employee ?who
  role employer acme
  polarity affirmed
  valid timeless
  certainty asserted
```
Rejected by S5: a statement is ground. Put the unknown in `query.where`.

```sop
@bad stated
  relation works_at
  role employee bogdan
  role employer acme
  polarity affirmed
  valid timeless
  certainty asserted
  quote "Maria works at Acme"
```
Rejected at parse: `quote` does not exist on `stated`. If `bogdan` is not mentioned in the message, S4 also rejects the wire (`stated_entity_not_in_message`).

```sop
@bad stated
  relation works_at
  role employee maria
  role employer acme
  polarity affirmed
  from 2026-01-01
  until 2025-01-01
  certainty asserted
```
Rejected by S6: `from` must precede `until`.

```sop
@bad stated
  relation works_at
  role employee maria
  role employer acme
  polarity affirmed
  valid timeless
  certainty asserted
  basis world
```
Rejected at parse: `basis` belongs to `assumed`.

### 3.4 `assumed` (PROPOSED)

**Purpose.** One proposition that the model adds during intent detection, stating what it takes for granted about the user's intent or the situation. It is one wire type with no subtypes (D3). It is never a fact, never stored, never rendered as a fact and, by default, **not used by the reasoner**.

**Fields.** The §3.1 proposition fields, plus:

| Keyword | Cardinality | Values | Meaning |
| --- | --- | --- | --- |
| `basis` | at most once, optional; absent means `unspecified` | `closure` \| `default` \| `disambiguation` \| `implicature` \| `world` | A descriptive label for *why* the model assumes it. **The host never uses `basis` for trust, admission or reasoning** (D5). |

The basis values mean:

| `basis` | Meaning | Example |
| --- | --- | --- |
| `closure` | The model treats a list or record as complete, so an unmentioned item is negated. | "A and B are booked" → C is not booked. |
| `default` | A typical-case generalization applied to this instance. | Tweety (a bird) flies. |
| `disambiguation` | A reading of an ambiguous *relation or sense* chosen by the model. It never covers an ambiguous entity identity; the host clarifies those. | "Maria's lab" read as `works_at`, not `owns`. |
| `implicature` | A presupposition or implicature of the wording. | "still at Acme" → was at Acme before. |
| `world` | General world knowledge about the relation or domain. | "before" is asymmetric. |

No `certainty` field: an assumption is uncertain by definition. No `quote`, `source`, `origin`, `cite` or write field.

**Validation rules.**

1. **A1.** Rules S1, S2, S3, S5 and S6 apply unchanged.
2. **A2 (anchoring).** Entity terms must be in the turn shortlist, but they need **not** be mentioned in the message. An assumption may bring in a shortlisted entity the user did not name.
3. **A3.** An entity listed as ambiguous in the turn's micro-context (`ambiguities`) is rejected: `assumed_identity_requires_clarification`. `basis disambiguation` does not lift this rule.
4. **A4.** An `assumed` that lowers to the same (atom, valid) as a `stated` in the same turn is rejected as redundant (S8).
5. **A5.** An `assumed` contrary to a `stated` in the same turn is **accepted**. When branched it is defeated, and the packet lists it as `defeated: true`. The contradiction is itself informative.
6. **A6.** Two contrary `assumed` wires are accepted. Under branching, they yield `both` (DS004: two contradicting assumptions keep `both`).
7. **A7.** At most `policy.maxModelAssumptions` (proposed default 8) per turn. Beyond that the turn is rejected with `too_many_assumptions` rather than truncated.

**Semantics.** These are governed by host policy `modelAssumptions`. The proposed name of the default value is `'report'` (Q6).

| Policy | Lowering | Effect on results | Packet |
| --- | --- | --- | --- |
| `'report'` (default) | None. The assumption does not enter the execution circuit. | None. The primary result is computed without it. | Listed in `model_assumptions` with `treatment: "reported"`. `used_in_proof` and `defeated` are `null`, because the assumption was not evaluated. |
| `'branch'` | `fact`: `holds <lowered atom>`, `valid …`, `origin assumption`, `scope turn`, consumed by a **second, generated** `solve` with `suppose`. That solve is run alongside the primary solve, which excludes model assumptions. | The primary result is unchanged. The branch result is reported separately, with `hypothetical: true` when its proof uses a kept assumption. DS004 defeat applies: a contrary admitted fact, or a contrary `stated … asserted` of this turn, defeats the assumption. | `model_assumptions[*].treatment: "branched"`, `used_in_proof`, `defeated`; `assumption_branch: {status, answers, hypothetical, defeatedAssumptions, route}`. |

The branch never replaces the primary answer (Q7). The rendering pattern is: *"From what you said: unknown. Only if we assume that the door is open: the rooms are connected."*

**Lifecycle.**
1. Authored in the intent-detection pass.
2. Parsed and validated (A1–A7).
3. Under `report`, listed only. Under `branch`, lowered to a turn-scoped assumption fact and run in the branch solve.
4. Reported.
5. Discarded.

It is never stored: `remember` rejects it, just as it rejects `origin assumption` facts (§2.1). It is never reinforced. It is never rendered with fact wording; the host uses "the model assumed …". It is not carried into later turns by default; the model must restate it (Q5).

**Packet fields.**

```json
"assumption_policy": "report",
"model_assumptions": [
  {"id": "a1", "atom": "not booked room_c", "polarity": "negated",
   "valid": {"from": "beginning", "until": "open"},
   "basis": "closure", "treatment": "reported",
   "used_in_proof": null, "defeated": null,
   "statement": "The model assumed room C is not booked (treating the list as complete)."}
]
```

When the model omits `basis`, the packet shows `"basis": "unspecified"`.

**Valid examples.**

```sop
# "Rooms A and B are booked. Is room C free?"
@s1 stated
  relation booked
  role room room_a
  polarity affirmed
  valid timeless
  certainty asserted
@s2 stated
  relation booked
  role room room_b
  polarity affirmed
  valid timeless
  certainty asserted
@a1 assumed
  relation booked
  role room room_c
  polarity negated
  valid timeless
  basis closure
@q query
  ask whether
  where not booked room_c
  at now
```

Under `report` the answer is `unknown` (open world), and `a1` is listed. Under `branch`, the branch is `supported` and marked hypothetical.

```sop
# "Is Ana still working at Acme?"
@a1 assumed
  relation works_at
  role employee ana
  role employer acme
  polarity affirmed
  until 2026-09-28
  basis implicature
@q query
  ask whether
  where works_at ana acme
  at now
```

```sop
# "Dorin finished before Avela" (attached). The reversed negation is the model's world knowledge.
@s1 stated
  relation handled
  role earlier dorin
  role later avela
  polarity affirmed
  valid timeless
  certainty asserted
@a1 assumed
  relation handled
  role earlier avela
  role later dorin
  polarity negated
  valid timeless
  basis world
@q query
  ask whether
  where handled dorin avela
  at now
```

```sop
# basis omitted: allowed, reported as "unspecified"
@a1 assumed
  relation door_open
  role from_room room_a
  role to_room room_b
  polarity affirmed
  valid timeless
```

**Invalid examples.**

```sop
@bad assumed
  relation door_open
  role from_room room_a
  role to_room room_b
  polarity affirmed
  valid timeless
  certainty hedged
```
Rejected at parse: `certainty` belongs to `stated`.

```sop
@bad assumed
  relation door_open
  role from_room room_a
  role to_room room_b
  polarity affirmed
  valid timeless
  basis guess
```
Rejected at parse: `guess` is not a `basis` value.

```sop
@bad assumed
  relation located_in
  role item "bank"
  role area riverside
  polarity affirmed
  valid timeless
  basis disambiguation
```
Rejected by A3 when "bank" is ambiguous in the turn context. The host generates `clarify` instead.

```sop
@bad assumed
  relation works_at
  role employee ana
  role employer $company
  polarity affirmed
  valid timeless
```
Rejected by S5: no `$ref` in propositions (Q10 considers relaxing this).

### 3.5 Compilation into the execution circuit (illustrative)

Authored (model):

```sop
@s1 stated
  relation works_at
  role employee maria
  role employer acme
  polarity affirmed
  valid timeless
  certainty asserted
@a1 assumed
  relation located_in
  role organization acme
  role city cluj
  polarity affirmed
  valid timeless
  basis world
@q query
  ask whether
  where works_in_city maria cluj
  at now
```

Generated (host, `modelAssumptions: 'branch'`; field names as proposed in §5):

```sop
@s1 fact
  holds works_at maria acme
  valid timeless
  origin user
  scope turn
@a1 fact
  holds located_in acme cluj
  valid timeless
  origin assumption
  scope turn
@q query
  ask whether
  where works_in_city maria cluj
  at now
@host0 solve
  query $q
  evidence $s1
  output ?status status
@host1 solve
  query $q
  evidence $s1
  suppose $a1
  output ?status status
@host2 cnl
  result $host0
  language en
```

The declarative compiler reports `host1` as `assumption_branch`, and `host0` stays the primary result. Under `report`, `@a1` and `@host1` are not generated.

### 3.6 Evaluating and governing `basis` (D5)

- **Training labels.** A row labels `basis` only where the gold annotator (the generator rule or a human reviewer) judges it clear. Otherwise the gold `assumed` has no `basis`. This is a data-authoring rule; no training is authorized here.
- **Formalization accuracy ignores `basis`.** Canonical match, execution-signature match and the per-family metrics compare stated and assumed propositions with `basis` stripped.
- **Basis accuracy is reported separately** (a DS020 metric addition), computed on gold `assumed` wires that carry a `basis` and whose proposition the prediction matched:
  - **coverage**: the fraction of those wires where the prediction emits any `basis`;
  - **accuracy**: exact label match among the covered wires;
  - the confusion matrix per value.

  `unspecified` predicted against a labeled gold counts as uncovered, not as wrong.
- **Decision criterion.** Preregister it per DS011 before any qualified run. For example: *if basis accuracy on the sealed `eval/suites/**` test is below 0.80, or coverage is below 0.50, for the qualified model, `basis` is removed from the model output profile; if it is at or above the threshold on two consecutive qualified runs, a DS amendment may consider making it influential (for example, allowing `branch` only for `world`/`default`).* The numbers are placeholders, and the user sets them (Q8). Until that amendment, `basis` has no runtime effect whatever its accuracy.

### 3.7 DS024 checklist

| Criterion | `stated` | `assumed` |
| --- | --- | --- |
| 1. Problem-shaped | It reports a proposition of the problem as the user gave it. | It states a premise the model took for granted. It is not an action or advice. |
| 2. Host-evaluable | It lowers to the existing `fact` evidence route (JS Horn and SWI). Certainty `hedged`/`supposed` uses the existing assumption route (DS004 and DS006 parity). | `report` has no evaluation. `branch` uses the existing assumption route. |
| 3. Independently oracle-able | The graph oracle already takes supplied facts. `assumption_boundary` already has a handwritten defeasible oracle (DS022). | The same. `report` needs an oracle only for the proposition, not for the result. |
| 4. Non-writing | `scope turn`; `remember` rejects it. | It is never lowered to a recordable value; `remember` rejects `origin assumption`. |
| 5. Refusal-capable | An unknown relation, role or entity is rejected. `speaker` returns `unsupported`. | An ambiguous identity leads to `clarify`. An explicit backend without assumption support returns `unsupported`, with no substitution. |
| 6. Reviewable | New pages `stated.html` and `assumed.html` with valid and invalid examples executed by `tests/wire-help.test.mjs`. | The same. |

---

## 4. Model-authored `query` and `constraint`

### 4.1 `query` (PROPOSED)

| Keyword | Cardinality | Values | Change |
| --- | --- | --- | --- |
| `ask` | exactly once, required | `whether` \| `which` \| `count` | Replaces `mode`. `explain` is dropped. |
| `select` | required with `which`; optional with `count` (it defines what is counted); forbidden with `whether` | `?var …` | Its meaning is no longer implied by another field. |
| `where` | repeatable, required | a positional atom leaf, or an `all`/`any`/`end` group | Unchanged (§2.8). |
| `filter` | repeatable | a single comparison `TERM OP TERM`, or a group | For model origin, no `&&`, `\|\|` or `!`, and one equality spelling. |
| `at` / `during` | exactly one required (model origin) | `at INSTANT\|now`; `during START END` | No silent `now`. |
| `known_by` | at most once | an instant or `now` | Renames `asof`. |
| `expect` | at most once | `one` \| `many` (only with `which`) | A presupposition, checked by the host. |
| `limit` | — | — | Removed from the model surface. |

Before and after:

```sop
# before
@q query
  select ?book
  where on_shelf ?book shelf_north

# after
@q query
  ask which
  select ?book
  where on_shelf ?book shelf_north
  at now
  expect many
```

```sop
# before
@q query
  where grandparent ana ?x
  filter ?x != bogdan && ?x != carla
  mode count

# after
@q query
  ask count
  select ?x
  where grandparent ana ?x
  filter all
    ?x != bogdan
    ?x != carla
  end
  at now
```

Filtering on symbols with `!=` is an existing feature and is shown here only to illustrate the grouping.

**P2 experiment: role-keyword leaves in `where`.** Keeping `where` positional preserves compact joins. A keyword alternative, `match`-blocks inside groups, is possible:

```sop
  where all
    match works_at
      role employee ?who
      role employer acme
    end
    ...
  end
```

It is about 4 times longer and adds a nesting construct. Adopt it only if a controlled comparison (DS011; it requires future training approval) shows fewer `argument_reversal` errors. Until then, the host echoes a role-labeled reading of every leaf in `packet.query_reading`, so reviewers see the intent.

### 4.2 `constraint` (PROPOSED)

| Keyword | Cardinality | Values | Change |
| --- | --- | --- | --- |
| `ask` | exactly once, required | `entailed` \| `possible` \| `optimize` | Replaces `task`. `prove` is renamed `entailed` to match the result status. |
| `var` | repeatable | `?name int MIN MAX` \| `?name int` | Unchanged. An unbounded domain on the reference strategy still returns `unsupported`. |
| `unit` | repeatable | `unit ?name LABEL` | Per variable (P2). Comparing different units is rejected. |
| `require` | repeatable | a single comparison, or an `all`/`any`/`none`/`end` group | No `&&`, `\|\|` or `!` in model origin. `none` is numeric only. |
| `claim` | required iff `ask entailed\|possible`; forbidden with `optimize` | a single comparison or a group | One meaning only. |
| `minimize` / `maximize` | exactly one iff `ask optimize` | an integer linear expression | Replaces `objective` + `direction`. |
| `select` | optional | `?var …` | Unchanged. |

```sop
# before
@slots constraint
  var ?slot int 0 8
  require ?slot >= 3
  claim ?slot <= 6
  task optimize
  objective ?slot
  direction max

# after
@slots constraint
  ask optimize
  var ?slot int 0 8
  require ?slot >= 3
  require ?slot <= 6
  maximize ?slot
  select ?slot
```

```sop
# before
@deadline constraint
  var ?arrival int 0 100
  require ?arrival == 42
  claim ?arrival <= 45
  task possible
  unit minute
  select ?arrival

# after
@deadline constraint
  ask possible
  var ?arrival int 0 100
  unit ?arrival minute
  require ?arrival == 42
  claim ?arrival <= 45
  select ?arrival
```

---

## 5. Host wires: before and after

Every change in this section is host-only: the model never authors these wires. A trusted-origin circuit may use the old spelling for one deprecation window, with a warning. `canonical()` emits the new spelling only.

**`fact`**: see §2.1. `origin` is required, `cite` is optional, `quote` stays for documents, and `scope turn|session` is set by the host only.

**`solve`**

```sop
# before
@answer solve
  query $question
  data $catalog
  assume $h
  output ?book

# after
@answer solve
  query $question
  evidence $north $south
  suppose $h
  output ?book many
```

`backend z3` without `reasoning advanced` is now an error, not an implicit strategy switch.

**`cnl`**: `language` is required and must have a message table.

```sop
# before
@answer cnl
  result $r

# after
@answer cnl
  result $r
  language en
```

**`event`**: required fields are checked per action at parse time. `origin` and `cite` replace `source`.

```sop
@stop event
  action end
  target $saved
  effective 2026-06-01
  origin user
  cite "closure notice"
```

`action end` without `effective` fails at parse. `action retract` with `effective` or `replacement` fails at parse. `action correct` without `replacement` fails at parse.

**`value` / `jsEval`**

```sop
# before (value evaluates an expression and bypasses allowJsEval)
@total value
  data $base + $offset

# after
@total jsEval
  expr $base + $offset
```

`value` accepts only a JSON literal or one whole `$ref`.

**`remember`**: unchanged fields. It additionally rejects `scope turn` and `origin assumption` facts.

**`pack`**: deprecated. Consumers take several `$refs` per line (§2.6).

**`recall` + `link` → `retrieve`**

```sop
# before
@m recall
  query $q
@l link
  query $q
  data $bundle

# after
@m retrieve
  query $q
@l retrieve
  query $q
  evidence $first $second
```

**`reason`**: host-internal. `mode` → `operation deduce|temporal`. Other operations use their own wires.

**`binding`**: removed from `SPEC`, runtime-internal.

**`template` → `procedure`**

```sop
# before
@calc template
  params base offset
  yield total
  body |
    @total value
      data $base + $offset

# after
@calc procedure
  params base offset
  yield total
  body |
    @total jsEval
      expr $base + $offset
```

**`expand`**: `with NAME TERM` uses atom term typing (§2.4).

```sop
# before (the bare route_a is silently a string)
@call expand
  using ~approved
  with route route_a

# after
@call expand
  using ~approved
  with route "route_a"
```

**`rule` / `simulate` / `associate`**: `mode` renamed per wire.

```sop
# before
@causal rule
  when power_on ?x
  then running ?x
  mode causal
@scenario simulate
  query $q
  intervention ~off
  mode counterfactual

# after
@causal rule
  when power_on ?x
  then running ?x
  kind causal
@scenario simulate
  query $q
  intervention ~off
  kind counterfactual
```

`associate mode lexical` → `associate metric lexical`.

**`hypothesis`**

```sop
# before
@joint hypothesis
  assume fan_stopped server
  assume temperature_high server

# after
@joint hypothesis
  holds fan_stopped server
  holds temperature_high server
```

**`policy` → `budget`**

```sop
# before
@tight policy
  maxCandidates 12
@search abduce
  query $question
  policy ~tight

# after
@tight budget
  maxCandidates 12
@search abduce
  query $question
  budget ~tight
```

**`analogize`**: `source` → `base`.

```sop
@analogy analogize
  base ~old
  target ~new
  transfer ~possible
```

**`abduce` / `diagnose`**: exactly one of `query`/`observation`, validated at parse. Unchanged otherwise.

**`trace`**: `known` → `known_by`. `closed true` stays reviewed-only.

**`clarify`**: `text` is non-empty and JSON-quoted (host-generated only).

**`resolve`**: unchanged. It is already explicit, with required `text`, `language` and `kind`. The only change is that canonical `text` is always quoted.

**`theory`**: marked experimental. Declaring it succeeds; using it yields `unsupported_theory`, as today.

**`goal`, `action`, `pattern`, `plan`, `induce`, `temporal`**: no structural change beyond the renames (`budget`, `known_by`) and the page template. `pattern.status`/`hypothesis.status` → `review` (P2).

**Ontology: `entity` / `predicate` / `concept`**

```sop
# before
@maria_ionescu entity
  kind person
  label en "Maria Ionescu"
@works_at predicate
  args person organization
  label en "works at"

# after
@maria_ionescu entity
  type person
  label en "Maria Ionescu"
@works_at predicate
  role employee person
  role employer organization
  label en "works at"
```

The strict ontology SPEC:
- `entity {one:[type, domain], many:[label, alias]}`;
- `predicate {one:[description, domain], many:[role, label, alias], required:[role]}`;
- `concept {one:[domain], many:[is_a, label, alias]}`.

Unknown fields are rejected.

---

## 6. Migration plan

The phases are ordered to respect AGENTS rules 1–3. No step trains, fine-tunes or runs GPU work. Dataset regeneration uses the existing builders and validators. Sealed suites are rebuilt by their builders under a new version, never edited by hand. Numbers from the previous suites move to `eval/reports/history/`.

### Phase 0: documentation fixes (non-breaking; can land at once)
1. Fix the 13 "Space-separated `predicate arg`" sentences and the "four" count in `query.html`.
2. Add `tests/wire-help.test.mjs`. It extracts every `<pre>` example from `docs/wire_typs/*.html`, requires valid examples to parse, pass `validateGraph` and (where they are model-authored) `compileDeclarative`, and requires invalid examples to fail with the documented error substring. This makes DS024 checklist item 6 true.
3. Unify the page template (§2.11).

### Phase 1: runtime guarantees (non-breaking bug fixes, sop-agent-3)
1. `sop/runtime.mjs`:
   - enforce the assumption-origin rules: consumer is `assume` only; `remember` and `data` reject it; `assumedFactWires` is computed after flattening;
   - gate non-literal `value` on `allowJsEval`;
   - replace the implicit switch to `advanced` with an error, or keep it only with a deprecation warning in trusted origin.
2. `eval/run.mjs`: base the `factGuard` exemption on flattened values.
3. Tests: `tests/assumptions.test.mjs`, `tests/runtime.test.mjs`, `tests/contracts-boundary.test.mjs`.
4. DS004: note that these guarantees are now enforced by the runtime, not by a guard.

### Phase 2: model surface (breaking; new profile, proposed `sop-agent-4`, Q9)
1. **Parser (`sop/parser.mjs`).**
   - Add `SPEC.stated {one:[relation, polarity, valid, from, until, on, certainty], many:[role], required:[relation, role, polarity, certainty]}` and `SPEC.assumed {one:[relation, polarity, valid, from, until, on, basis], many:[role], required:[relation, role, polarity]}`.
   - Add the time-form rule, the enum checks and `role` = two tokens.
   - `query`: add `ask`, `expect`, `known_by`; drop `mode` and `limit` from model origin.
   - `constraint`: add `ask`, `minimize`, `maximize`, per-variable `unit`.
   - Keep `premise` parseable for trusted origin during the window, with a deprecation warning.
2. **Lexicon (`sop/lexicon.mjs`).** Strict ontology SPEC; `predicate.role`; `entity.type`; `roles(predicate)` with the `arg1…argN` fallback; expose role names in `microContext` (the payload grows, so re-check `contextMaxBytes`).
3. **Lowerer (`sop/lower.mjs`).**
   - `lowerProposition(w, lexicon)` produces the existing atom plus a validity interval.
   - `lowerStated` produces `fact` with `origin user|assumption` and `scope turn`.
   - `lowerAssumed` produces the proposition only.
   - `lowerQuery` and `lowerConstraint` take the new fields.
4. **Declarative compiler (`sop/declarative.mjs`).**
   - `MODEL_TYPES = {stated, assumed, query, constraint}`.
   - Compile `stated asserted` into `evidence`, `stated hedged|supposed` into `suppose`, and `assumed` into nothing or a branch solve according to `policy.modelAssumptions`.
   - Emit no `pack`.
   - Build `user_statements`, `model_assumptions`, `assumption_policy` and `assumption_branch`.
   - Replace `context.premises` with `context.statements` (Q4). Assumptions are not retained (Q5).
5. **Agent (`server/agent.mjs`).**
   - `validateVocabulary`/`atomSources` read the keyword form.
   - S4 anchoring against the message segments, meaning the question plus the attached assertions.
   - A3 ambiguity rejection.
   - `explainAssumption` → `explainStatement` and `explainAssumption` for the two lists.
   - Formalizer prompt examples; `chatSop` trace fields.
6. **Eval (`eval/run.mjs`, DS020).**
   - Admission lists.
   - `inputText` includes the attached assertions.
   - A basis-stripped comparison for formalization metrics; a separate basis coverage and accuracy metric.
   - `context_premises` expectations → `user_statements` and `model_assumptions`.
   - DS011 preregistration of the `basis` criterion (Q8).
7. **Datasets and tools.**
   - Add a converter `tools/datasets/converters/premise-to-stated.mjs`. It classifies each `premise` by the §3.2 boundary rule:
     - its lowered atom is entailed verbatim by a context assertion or by the question's asserted clause → `stated asserted`;
     - a supposition cue ("suppose", "if", "assume", including in Romanian) → `stated supposed`;
     - otherwise → `assumed`, with `basis` only where the generator rule is known (for example, grounded-paraphrase's reversed-negation premise → `world`).

     Rows the converter cannot classify with certainty are marked `target_review_status: pending_review` and fail the machine audit (`audit-corpus.mjs`) until a human reviews them in the audit server (DS040).
   - Add role names to the generated ontologies. Builders derive them from the predicate gloss where a builder rule exists, and fall back to `arg1…` with the `unnamed_roles` flag otherwise.
   - Add `ask` to every query target and required time lines. Rename `task` → `ask`.
   - Rebuild `datasets/*/{train,dev}.jsonl` and `eval/suites/*/test.jsonl` through the builders under new corpus versions.
   - Scale: rows containing `premise` are about 84.5k in grounded-paraphrase (train, dev and test), 57 in qa-proposition and 51 in query-v1/v2; every query and constraint row also changes.
8. **Tests.** Parser, declarative runtime, assumptions, agent, contracts boundary, capability matrix, query-v2, grounded suites, boolean groups, and the new wire-help test.
9. **Docs.**
   - New `docs/wire_typs/stated.html` and `assumed.html`.
   - `premise.html` → retired page.
   - Update `query.html`, `constraint.html`, `small-model.html`, `overview.html`, `syntax.html` and the `docs/wire_types.html` sidebar.
   - Regenerate `sop/contracts/wires.json` and `wire-fields.md` with `node tools/capabilities.mjs --write`.
   - Update `sop/grammars/sop-agent.ebnf`.
   - DS004 (a new "Stated and assumed propositions" section replacing the premise paragraphs), DS024 (the construct table and checklist rows), DS020 (the basis metric), DS022/DS026 (family targets), `docs/wiki.html` (definitions of stated, assumed and basis), `docs/training.html` and `docs/runtime.html` references, and `skills/README.md` if a skill changes.

### Phase 3: host renames (breaking for trusted circuits only)
1. Accept both spellings in trusted origin for one release, with warnings, and emit only the new spelling:
   - `origin`/`cite`, `evidence`/`suppose`, `budget`, `kind`/`metric`/`operation`, `base`, `known_by`, `procedure`, `retrieve`;
   - required output mode;
   - required `cnl.language`.
2. Migrate `examples/*.sop`, `tests/fixtures/*.sop`, the reviewed library entries (checksum-verified, which means re-review and new hashes) and `skills/material-to-sop` outputs.
3. Remove `binding` from `SPEC`; mark `theory` experimental; retire `pack` from generated circuits.

### Phase 4: P2 items
Per-variable units, a `none` group, `speaker`, the `match`-leaf experiment (gated on training approval) and the `status` → `review` rename.

---

## 7. Open questions for the user

1. **~~Keep `stated` as a separate wire?~~ Closed (D2).** Yes. It is used only when the model is sure the assertion is in the user's message.
2. **Role names.** Do you accept lexicon-declared role names (`role employee maria`) as the canonical form, with the `arg1…argN` fallback for unnamed predicates? Who supplies role names for the generated ontologies behind the roughly 84.5k grounded-paraphrase rows: builder rules, human review, or the fallback plus an audit flag?
3. **`certainty` on `stated`** (`asserted | hedged | supposed`). This refines D1: a user supposition ("Suppose…") comes from the user but is not asserted. Without the field it must be forced into `stated` (wrongly non-hypothetical) or `assumed` (wrongly attributed to the model). Accept it, rename it (for example `stance`), or drop `hedged`?
4. **Carry-over of `stated` across turns.** Should earlier-turn statements be retained in caller-owned context and re-supplied as turn-scoped user facts, the way `premise` is today, or must the user restate them?
5. **Carry-over of `assumed`.** The proposal says no, and the model restates. Confirm?
6. **Policy value names.** `modelAssumptions: 'report' | 'branch'`. Is `'report'` the right name for the default?
7. **Branch result placement.** The proposal keeps the primary answer assumption-free and reports the branch separately. Should the branch ever replace the primary answer, for example when the primary answer is `unknown`?
8. **`basis` criterion.** Set the preregistered thresholds (placeholders: accuracy 0.80, coverage 0.50, two consecutive qualified runs) and the minimum number of labeled `assumed` wires in the sealed test before the criterion is evaluated.
9. **Profile versioning.** Bump the profile to `sop-agent-4` for the model surface, keep `sop-agent-3` for trusted circuits during the window, and set the length of the deprecation window?
10. **`$ref` in propositions.** Should `assumed` (or `stated`) be allowed to take a projected scalar from an earlier query in the same turn? The proposal forbids it for now, keeping propositions independent of computation.
11. **Required query time.** Is requiring `at now` on every model query acceptable, given that it adds a line to almost every target, or should `now` stay a default that the packet always echoes?
12. **`value` literal-only.** Accept the breaking change (examples and template fixtures move to `jsEval`), or keep expressions in `value` behind the `allowJsEval` gate?
13. **Reported speech (`speaker`).** Is it in scope for the next profile as `unsupported`, or out of scope entirely?
