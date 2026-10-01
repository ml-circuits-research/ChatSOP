# No-context sweep: what still teaches that the small model sees context

> **Status, 2026-09-28 (later the same day):** most findings below are in corpora, builders and suites that were deleted with the DS022 regeneration. The permanent guards now exist: G1 `tests/model-input-boundary.test.mjs`, G2 the corpus-audit checks of DS020, G3 `tools/lint/model-surface.mjs` with `tests/no-context-lint.test.mjs` (wired into `tools/verify.mjs`), and G4 the "Model boundary (non-negotiable)" section of `AGENTS.md`. The body is the snapshot as swept; line numbers refer to files as they were then.

Read-only sweep, 2026-09-28. Machine-readable findings are in `eval/reports/current/no-context-sweep.json` (435 records). Code findings carry `line` and data findings carry `row_id`. A data record covers one (file, category) pair and adds `count`, `of_rows` and `example_row_ids`, so the file does not hold one record per row.

**The principle being enforced:**
- The `sop-agent-4` formalizer prompt is exactly the user's message.
- Its output uses quoted strings: `relation "work at"`, roles from the closed set, and values as mentioned in the message (or `?variables` in queries).
- Linking those strings to knowledge is host work.
- `unclear` has only two kinds, `gibberish` and `no_request`, and the model never refuses.
- The verification world (`setup_sop`, `ontology_sop`, `expected`, and any host lexicon) is evaluation tooling and is never model input.

**Snapshot caveat:** other agents were editing the tree during the sweep.
- `server/prompts/formalizer.txt` was rewritten mid-sweep and is now essentially correct.
- The `sop-agent-4` paths of `server/llm.mjs` and `server/agent.mjs` are correct.
- `tests/agent.test.mjs` now asserts a message-only prompt.
- Each entry reflects the last state observed.

## Counts by layer

| layer | records | nature |
| --- | --- | --- |
| model-input | 48 | Prompt construction: `barePrompt` defaults to `sop-agent-3`, and the training projection, eval, audit and builders emit `CONTEXT` + `MESSAGE`. Also 28 derived projection files whose prompts start with `CONTEXT`. |
| model-output | 118 | Aggregated target records: every corpus is still `sop-agent-3`. Targets use bare canonical IDs, often generator-numbered (for example `gp0001_condition_0`). No corpus has a single `sop-agent-4` target. |
| training-data | 98 | Message phrasing that presupposes a model-visible knowledge base, IDs or hashes in the text, mixed languages, and `context_assertions` joined into the message. |
| data-qa | 135 | Per-row shortlist or background data stored as `context` (legitimate only as labelled verification scaffolding), audit invariants and checks that require a shortlist, and audit UI or tests that show it as "what the model sees". |
| host | 7 | Legacy shortlist guard applied to `sop-agent-4` in eval, `approvedEntities` supplied by eval only, and an unguarded public `validateAtom`. |
| docs | 29 | Records covering 60+ doc locations (several grouped). |

**Row counts, primary corpora** (train + dev + sealed test; derived projections and `surfaces.jsonl` excluded):

| corpus | rows | shortlist in `context` | `background_*` | `context_assertions` joined into message | `sop-agent-3` ID target | "din vocabular" | "facts/observations and rules" | record/registry framing | «condition» quote | "review stage N" | IDs/hash in text | digit pseudo-names | mixed language |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grounded-paraphrase | 93064 | 93064 | 0 | 84482 | 84482 | 0 | 0 | 16604 | 0 | 0 | **93064** | 0 | 16894 |
| grounded-proof | 15000 | 15000 | 15000 | 0 | 15000 | **3000** | 250 | 753 | **11493** | **5118** | 0 | 0 | 0 |
| grounded-ambiguity | 14998 | 14998 | 0 | 0 | (all ID-like) | 0 | 0 | 1384 | 0 | 0 | 0 | 0 | 0 |
| grounded-proposition | 10344 | 10344 | 0 | 10344 | (all ID-like) | 0 | 0 | 1800 | 0 | 0 | 0 | 3116 | 263 |
| pilot-v1 | 700 | 700 | 0 | 700 | 500 | 0 | 0 | 0 | 0 | 0 | 700 | 0 | 100 |
| seed / generated | 960 each | 960 | 0 | 0 | 420 | 0 | 0 | 0 | 0 | 0 | 30 (`c_<hex>`) | 0 | 0 |
| independent-v1 | 400 | 400 | 0 | 0 | 320 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| query-v2 | 290 | 218 | 192 | 26 | 169 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 1 |
| query-v1 | 198 | 160 | 141 | 19 | 118 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 |
| qa-proposition-v1 | 288 | 288 | 0 | 57 | 231 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| proof-structure-v1 | 240 | 240 | 240 | 0 | 240 | 0 | 75 | 0 | 0 | 0 | 0 | 0 | 0 |
| paraphrase-contrast-v1 | 240 | 176 | 0 | 0 | 176 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| source-reference-v2 (+cutover) | 98 | 98 | 98 | 0 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| ambiguity-resolve-v1 | 60 | 60 | 0 | 0 | (all ID-like) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

**Which fields reach the prompt:**
- Through `barePrompt`/`formalPrompt` for `sop-agent-3`, the whole `context` object reaches the prompt: `now`, `language`, `entities`, `predicates`, `approvedTemplates`, `procedures_sop`, `canonicalMentions`, `background_assertions`, `background_rules`, `background_known_at` and `claims`.
- `context_assertions` are prepended to the question everywhere.
- 122,441 derived prompt rows start with `CONTEXT`. That includes all 121,166 rows of `datasets/research-train-v1`, which is the trainer's input.
- 14,225 of those prompts carry `background_*` knowledge.

## Top 30

1. `server/llm.mjs:9`: `barePrompt(text, context, profile='sop-agent-3')`. The unsafe default silently produces `CONTEXT` + `MESSAGE` for every caller that omits the profile.
2. `tools/research/prepare-experiment.mjs:92`: the training projection is `barePrompt(context_assertions + question, row.context)` and copies `context` into training rows.
3. `tools/research/prepare-experiment.mjs:8-9,104-106`: the manifest declares `profile 'sop-agent-3'` and `prompt_profile 'barePrompt (CONTEXT + MESSAGE…)'`.
4. `datasets/research-train-v1/**`: 121,166 training rows with a `CONTEXT` JSON shortlist and ID targets, which is the exact input to `training/python/train.py`.
5. `datasets/grounded-proof` (for example `gp0001`): the message reads "În urma citirii observațiilor și regulilor … condiției «has a checked mooring line» din vocabular". The prompt includes `background_assertions`, and the target is `where gp0001_condition_0 gp0001_subject`.
6. `docs/specs/DS021…:22-23`: the normative `sop-agent-4` spec still says `relation` is a canonical predicate ID from the turn shortlist and that TERM is a canonical entity ID.
7. `DS021:47,69,14,32`: anchoring against IDs and shortlist labels, and "entities must be in the turn shortlist".
8. `DS021:84,155` and `docs/wire_typs/unclear.html:5,11,12,17`: six `unclear` kinds (`nonsense`, `incomplete`, `contradictory`, `not_a_question`, `off_topic`) and "relates to the available vocabulary". The code has only two.
9. `eval/run.mjs:208-213,220,247`: the legacy `validateAtom` shortlist guard is installed for every formalization row, including `sop-agent-4`.
10. `eval/run.mjs:182,231`: the message is built as `context_assertions` + question, and `row.prompt ??` can inject a stored `CONTEXT` prompt.
11. `server/audit.mjs:38-42` and `server/pages/audit.mjs:9-11,365-381`: the human audit shows a `CONTEXT` prompt, the shortlist and "Knowledge text currently included in the prompt" under "What the model sees". It also refers to `questions.md` Q9, which no longer exists.
12. `tools/datasets/build-*.mjs` and `validate.mjs:63,87`: every projection builder, and the validator that re-checks them, uses `barePrompt(..., row.context)`.
13. `docs/wire_typs/stated.html:5,6,8-56,98`, `assumed.html:5` and `predicate.html:3` use shortlist, canonical-ID and predicate-role examples such as `role employee maria`. Those examples are invalid under the current parser.
14. `DS008:22`: "`row.prompt` contains only the scoped context (entities, predicates, approved handles) plus attached assertions and the question".
15. `DS012:9` and `README.md:87`: "`bare` sends … CONTEXT + MESSAGE".
16. `DS021:28`: "resolved from the host shortlist". `DS021:26`: `unsupported` listed as a model outcome.
17. `DS004:69`: "Before the Agent formalizer call, deterministic retrieval supplies compact canonical mentions, blocked ambiguity…".
18. `docs/wiki.html:60,15,54,138`: "The formalizer receives … a host-supplied list of usable symbols and context", and "before giving the model canonical IDs".
19. `tests/server-http.test.mjs:232-238`: the test asserts that the default server sends `/^CONTEXT\n/` (it currently fails).
20. `tools/datasets/audit/invariants.mjs:41`: a fail-closed "missing inline vocabulary" check, so a correct no-context row fails the audit.
21. `tools/datasets/audit/checks.mjs:164-170,248-262` and `skills/corpus-audit/SKILL.md:8,82,89-91,120,132`: the audit checks and the skill that describe the shortlist the model sees (distractors, answer leaks).
22. `DS020:36,53,71,75,76`: the audit spec treats the shortlist as model context and inline vocabulary as an invariant.
23. `DS018:34`: background facts and rules "exposed … in the model-facing prompt".
24. `datasets/grounded-paraphrase`: the hash `gp-qqp-NNNNNN` appears in the text of all 93,064 rows. There is also "Arată registrul…/Consultă inventarul…" framing and Romanian questions with English assertions (builder lines 140-372).
25. `datasets/pilot-v1`: messages such as "Is person_731_0_0 a parent of person_731_0_1?", with the world dumped as `context_assertions`.
26. `datasets/proof-structure-v1`: "Can the approved facts and rules establish that…". Facts and rules sit in the prompt `background_*`.
27. `datasets/grounded-proposition`: pseudo-names such as Nuvora15, and framing such as "Pe baza însemnării…/În acest dosar…".
28. `datasets/seed|generated/system`: "Corectez afirmația c_5d9c94d42e80a35b845f7d692b15f9e5: …".
29. `AGENTS.md:5,13`: still says "checked `sop-agent-3` profile" and "premise, query, constraint", with no no-context principle.
30. `DS007:8`, `docs/training.html:3` and `DS018:41,86`: "question and supplied context", `barePrompt` (CONTEXT + MESSAGE), and "inline vocabulary".

**Also listed (lower priority):**
- `DS018:7,11` and `DS019:37`.
- The wire-redesign proposal (built on the shortlist; needs a SUPERSEDED banner).
- `probably_obsolete/specs/legacy-registers/DS027-legacy-architecture-language.md:66` (archived), where "shortlist in micro-context" is marked PARTIAL.
- `premise`/`query`/`constraint` drift in DS000/002/006/009/010/013/016/022/026/028/037/038, `docs/runtime.html` and `small-model.html`.
- `skills/evaluate-agent:10`.
- `server/agent.mjs:86`: `validateAtom` has no legacy assert.
- `sop/declarative.mjs:106`: `approvedEntities` is fed only by eval.
- `training/python/common.py:28`: `row.prompt` is trusted blindly.
- The tests `grouped-consumers:118`, `data/audit-server:73,120-122`, `eval-runner:86`, `proof-structure:50` and `audit-corpus:89`.

**Host-side, legitimate (no change):** `sop/lexicon.mjs` `microContext` as host retrieval, `sop/linking.mjs`, `tests/lexicon.test.mjs`, and `formalizer-sop-agent-3.txt` while it is explicitly legacy (it should still get a LEGACY header).

## Permanent guards

**G1. Prompt equals message.** Add a new `tests/model-input-boundary.test.mjs`, run by `npm test`. It asserts:
- `barePrompt(m) === m` with no profile argument.
- `formalPrompt(m)` contains no `CONTEXT`, `"entities"`, `"predicates"`, `background_` or `canonicalMentions`, and ends with `MESSAGE\n` + m.
- The `project()` exported from `tools/research/prepare-experiment.mjs` yields `prompt === row.question` for a fixture row whose `context` is fully populated.
- `server/audit.mjs` `promptOf(row) === row.question`.
- For every `*/formalizer/*.jsonl` whose manifest says `sop-agent-4`, each prompt equals its source question.

Mirror the same check as fail-closed runtime asserts in three places:
- `prepare-experiment.mjs`: refuse to write.
- `tools/datasets/validate.mjs`: the projection check.
- `training/python/common.py`, in the row loader: reject a prompt that starts with `CONTEXT` or contains `\nMESSAGE\n`, and require the manifest `prompt_profile == "message-only"`.

**G2. ID-like tokens rejected in model targets.** In `tools/datasets/audit/vocabulary.mjs`, add a `VOCABULARY_ROW_CHECKS` entry `model_target_id_token` (class `contract`, failing). It fires on:
- any `sop-agent-3` construct (`holds`, where-atoms, `premise`) in a row of a `sop-agent-4` corpus;
- any `relation`/`role`/`valid` value that is not a JSON string, integer or `?var`;
- any quoted value matching snake-case identifiers or generator counters (`/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/`, `/\d+_\d+/`, `/\b[0-9a-f]{8,}\b/`, `/gp\d+_/`);
- any value that does not occur in the message for `stated`.

Also add a fail-closed invariant in `tools/datasets/audit/invariants.mjs` that replaces the "missing inline vocabulary" check. It requires "no `prompt` field, or `prompt === question`", and it rejects question text matching `din vocabular|from the vocabulary|observațiilor și regulilor|facts and rules|review stage \d|gp-[a-z]+-\d+|\bc_[0-9a-f]{16,}|[a-z]+_\d+_\d+`.

**G3. Model-surface phrase lint.** Add `tools/lint/model-surface.mjs`, wired into `tools/verify.mjs` and asserted by `tests/no-context-lint.test.mjs`.

It forbids these patterns:
- `shortlist`
- `resolved from the host shortlist`
- `CONTEXT \+ MESSAGE`
- `canonicalMentions`
- `candidate (entities|predicates|aliases)`
- `list of usable symbols`
- `supplied context`
- `canonical (predicate|entity) ID`
- `in the model-facing prompt`
- the `unclear` kinds `nonsense|incomplete|contradictory|not_a_question|off_topic`

It applies to these files:
- `server/prompts/formalizer.txt`
- `docs/specs/DS004|DS007|DS008|DS012|DS021|DS018|DS018|DS020|DS021*.md`
- `docs/wire_typs/{stated,assumed,unclear,query,constraint,predicate,small-model}.html`
- `docs/{wiki,training,runtime}.html`
- `README.md` and `AGENTS.md`
- `skills/{corpus-audit,evaluate-agent,synthetic-sop-data}/SKILL.md`

A line is exempt only when it contains `sop-agent-3` or `legacy`. `formalizer-sop-agent-3.txt`, `probably_obsolete/specs/legacy-registers/`, `probably_obsolete/specs/proposals/`, `CHANGES.md` and `PAS_TASK.md` are excluded.

**G4. `AGENTS.md` principle.** Insert a new section "## Model boundary (non-negotiable)" directly after `## Scope` and before `## Direction`:

> The small formalizer has no context: its prompt is exactly the user's message: no CONTEXT, shortlist, IDs, lexicon, background knowledge or time. It writes `sop-agent-4` (`stated`, `assumed`, `unclear`, `query`, `constraint`) with quoted strings: `relation "…"`, roles from subject/object/recipient/location/source/destination/instrument/time/topic, values as mentioned or `?variables`. It never reasons, never refuses, and reports `unclear` only as `gibberish` or `no_request`. Linking strings to knowledge is host work after the model. `setup_sop`, `ontology_sop`, `expected` and any per-row lexicon are verification scaffolding, never model input, and must be labelled so. Guards: `tests/model-input-boundary.test.mjs`, `tests/no-context-lint.test.mjs`, audit check `model_target_id_token`.

Also update rule 5 and line 5 (the "checked `sop-agent-3` profile" wording) to `sop-agent-4`, and mirror the principle as the first paragraph of DS021 §Scope.
