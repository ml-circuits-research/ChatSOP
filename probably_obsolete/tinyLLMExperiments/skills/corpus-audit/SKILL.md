---
name: corpus-audit
description: Audit a formalizer corpus for semantic faithfulness, trivial contexts, template duplication and template-level leakage
---

# Corpus audit: faithfulness, non-triviality, diversity and leakage

A corpus can parse, execute and pass every structural invariant and still teach the wrong thing: statements that the message never makes, a `not` nobody said, identifiers or record framing in the message, or a few templates repeated tens of thousands of times with the sealed test built from the same templates. This skill is the systematic procedure a coding agent follows to catch those defects before a corpus is qualified. The tool is deterministic: heuristics over text and parsed SOP, with no model call, no GPU and no network.

The tool is `tools/datasets/audit-corpus.mjs` (modules under `tools/datasets/audit/`). It streams `datasets/<name>/{train,dev}.jsonl` (the three datasets) or `datasets_archive/<corpus>/{train,dev}.jsonl` (the legacy corpora) (read through `lib/jsonl-shards.mjs`, so a split stored as `<split>.part-NNN.jsonl` shards is read as one file) and the sealed `eval/suites/<corpus>/test.jsonl` once, and writes a JSON report plus a short summary.

## When to run

1. After every corpus build or regeneration (`node tools/datasets/build-corpora.mjs`, the DS022 generator), before anything else reads the new files.
2. Before a corpus is proposed for qualification, and again after any generator fix.
3. When a review suspects a corpus defect: the report gives rates and reproducible examples.

`node check-datasets.mjs` runs the audit on every corpus that has train/dev splits, in report mode, after the validators. Report mode prints the findings but does not change the exit code; `node check-datasets.mjs --audit-strict` makes audit failures fail the run.

## Commands

```sh
# One corpus; writes eval/reports/current/corpus-audit/<corpus>.json and prints the summary.
node tools/datasets/audit-corpus.mjs --corpus formalizer-v1

# Report mode: only structural invariants can fail (use while a known-bad corpus awaits regeneration).
node tools/datasets/audit-corpus.mjs --corpus formalizer-v1 --fail-on none

# Every flagged row with its findings, for triage (JSONL, one line per flagged row).
node tools/datasets/audit-corpus.mjs --corpus formalizer-v1 --rows-out /tmp/formalizer-findings.jsonl

# JSON report on stdout (summary on stderr), no file written; or an explicit output path.
node tools/datasets/audit-corpus.mjs --corpus formalizer-ood-v1 --stdout
node tools/datasets/audit-corpus.mjs --corpus formalizer-ood-v1 --out /tmp/formalizer-ood-audit.json

# All corpora with train/dev splits, report mode, plus the validators.
node check-datasets.mjs

# The tool's own tests (in-test fixtures only).
node --test tests/audit-corpus.test.mjs
```

Other flags: `--threshold <id>=<rate>,...` changes a threshold without changing what fails; `--grounded-types`, `--assumption-types`, `--problem-types` set the wire roles (see below); `--lexicon <file.json>` adds surfaces `{"entities": {"<id>": ["surface", ...]}, "predicates": {"<id>": [...]}}`; `--examples N` sets examples kept per check; `--spot N` sets the readable sample size; `--no-leakage` skips the test comparison; `--train/--dev/--test <file>` override split files; `--root <dir>` audits another checkout.

Exit status: `0` pass, `1` a fail-closed invariant or a `--fail-on` check failed, `2` the audit could not run.

## Stated facts versus model assumptions

The small model authors two kinds of statements:

- **Stated facts**: what the message actually says. Every entity, constant and polarity in such a wire must be supported by the message. These are the *grounded* wire types (default `stated`).
- **Model assumptions**: something the model injects and is not sure of. They are explicitly marked, the symbolic reasoner normally ignores them, and they need not be grounded in the message, but they must be labelled as assumptions. These are the *assumption* wire types (default `assumed`).

Problem wires (`query`, `constraint`) are always checked against the message: a query must ask what the question asks. The roles are configuration, not code:

```sh
node tools/datasets/audit-corpus.mjs --corpus <name> --grounded-types stated --assumption-types assumed
```

Faithfulness rules apply strictly to grounded and problem wires. Assumption wires are counted (`wires.assumption`, `wires.assumption_row_ratio`, `wires.assumption_wire_ratio`) and never flagged as unfaithful. A type cannot be both. An unsupported statement is a defect in the target, never something to relabel as an assumption to silence the audit: relabelling is a generator change that must reflect what the model is actually meant to say.

## Reading the report

The report is `eval/reports/current/corpus-audit/<corpus>.json` (`format: chatsop-corpus-audit-v2`). It is a regenerable observation of the files on disk, not a historical claim (AGENTS.md rule 9). Key sections:

- `invariants`: the fail-closed structural checks (unique ids, unique normalized questions, no stored prompt other than the message and no question text that presupposes context, records or identifiers, declared no-copied-rows provenance, parseable declarative targets, executed expectations, split groups confined to one split). Any violation fails the run whatever `--fail-on` says.
- `faithfulness.error_rate`: share of rows with a target that have at least one error-severity faithfulness finding.
- `vocabulary_migration`: rows and wires whose only contract problem is a type in migration (for example a type present in `SPEC` but not yet in the `wires.json` snapshot), by type. Counted, never failed.
- `checks[]`: one entry per check with `severity`, `value` (rate of flagged rows, or the corpus metric), `threshold`, `direction`, `status` (`ok`, `warning`, `error`, `info`, or `fail` when selected by `--fail-on`), `by_split`, and deterministic `examples` (row id, split, message, target, findings).
- `wires`: counts by wire type and by role.
- `context_shape`: histograms of predicates and entities in each row's host verification context (`context`, marked `model_visible: false`); the model never sees it.
- `diversity`: masked input templates and target skeletons for the development rows and per split, top-k lists, and near-duplicates.
- `leakage`: `dev_vs_train`, `test_vs_train`, `test_vs_dev`, `test_vs_development` overlaps.
- `sample`: evenly spaced rows for a quick human read.

### Row checks

| id | severity | default threshold | what it means |
| --- | --- | --- | --- |
| `faithfulness.entity` | error | 0 | An entity or quoted constant in a grounded/problem wire is never mentioned in the message. Matching uses labels, the text before the first comma, ontology labels/aliases, lexicon surfaces and literal ids; tolerates case, diacritics, inflection (shared stems, Romanian case endings) and small typos (edit distance 1, or 2 for long words). |
| `faithfulness.entity_crosslingual` | warning | 5% | A non-name label in another language than the message is not matched (for example an English label in a Romanian row). Add a surface in the message language. |
| `faithfulness.vocabulary` | error | 0 | A predicate or constant is not in the row's host vocabulary. |
| `faithfulness.polarity` | error | 0 | A `not`, or a lexically negative predicate such as `omitted`, without a negation or omission cue. Statements may take the cue from the whole message; queries must take it from the question. Cues: en `not, no, never, none, without, n't, ...`; ro `nu, nici, niciodată, fără, n-a, ...`; omission/denial verbs. |
| `faithfulness.polarity_unmarked` | warning | 5% | The message negates something but the target is positive-only. |
| `faithfulness.predicate` | warning | 10% | No gloss, label or id word of a used predicate appears in the message. Heuristic; read the examples. |
| `faithfulness.constraint_number` | warning | 5% | A number in a constraint restriction or claim is not in the message (digits or EN/RO words up to 20). |
| `label.construct` | error | 0 | The structure label claims a quantifier, comparison or temporal feature that the target does not contain (`mode count`, a finite constraint task, a comparator, `at/during/asof/valid`, or a predicate whose meaning carries it). The label is wrong or the target is. |
| `label.negation` | warning | 5% | The label claims negation but the target is positive-only (legitimate when the negation lives in the world facts; check examples). |
| `context.trivial` | warning | 25% | The row's host verification world has one predicate and at most one non-answer entity, so host linking and the executed expectation are exercised only weakly. The model never sees this world; the check describes the verification scaffolding, not model input. |
| `context.single_predicate` | info | — | The verification world has a single predicate: linking never has to choose. |
| `context.answer_leak` | warning | 0 | A gold answer entity is listed in the row's verification context. Because the model has no context this cannot leak an answer to the model; read it as a description of the scaffolding (the check predates the no-context rule; see "Known limits"). |
| `diversity.case_id_in_text` | warning | 0 | Case ids or internal entity/predicate ids appear inside natural language. |
| `diversity.hash_like_name` | warning | 5% | Generator counters or hashes as names (`Osmira11`). |
| `vocabulary.contract` | error | 0 | A `sop_target`, `setup_sop` or `ontology_sop` uses a wire type, field keyword or enumerated value that is not in the language contract, a type the model may not author (non-`system` targets), or a field against its cardinality (a one-valued field repeated, a required field missing). The vocabulary is read from the contract at run time (see "Contract vocabulary check" below). Findings about types whose migration is in flight are excluded here and tallied in `vocabulary_migration`. |
| `vocabulary.model_target_id_token` | error | 0 | No-context guard G2: a model target uses a retired construct (`holds`, `premise`, an atom `where`/`scope` leaf), a quoted `relation`/`role`/`valid`/`speaker`/`reading` value that looks like an identifier or a generator counter, a role value that is not a JSON string, integer or `?variable`, or a `stated` value that does not occur in the message. |

### Corpus metrics

| id | severity | default | what it means |
| --- | --- | --- | --- |
| `diversity.top10_template_share` | warning | > 50% | Share of development rows covered by the 10 commonest masked input templates. Masking replaces entity labels, ids, capitalized names (not sentence-initial words), letter-digit names and digits. |
| `diversity.template_ratio` | warning | < 0.2 | Distinct masked templates per development row. |
| `diversity.target_skeletons` | warning | < 10 | Distinct target skeletons (entities, predicates, variables, literals and numbers masked). Few skeletons mean the model learns a handful of shapes. |
| `diversity.near_duplicate` | warning | > 10% | Rows with a MinHash near-duplicate (word 3-shingles, estimated Jaccard ≥ 0.8) in the same split, outside their own split group (paraphrases and linked contrasts of one group are near-identical by design). |
| `leakage.exact_input` | error | > 0 | A sealed-test message also occurs in train/dev. |
| `leakage.template_overlap` | warning | > 20% | Sealed-test rows whose masked template occurs in train/dev: the test measures template recall, not language understanding. |
| `leakage.near_duplicate` | warning | > 5% | Sealed-test rows with a near-duplicate in train/dev. |
| `leakage.entity_overlap` | warning | > 50% | Sealed-test rows sharing an entity label head with train/dev. |
| `leakage.target_skeleton_overlap` | info | — | Expected to be high for closed families; read it together with template overlap. |
| `assumption.row_ratio` | info | — | Rows containing at least one assumption wire. |

### `--fail-on`

`errors` (default) fails on every error-severity check above its threshold; `warnings` or `all` adds warning checks; `none` is report mode; `<id>[=rate]` (rate as `0.05` or `5%`) selects checks explicitly, for example `--fail-on faithfulness.entity=0,faithfulness.polarity=0,context.trivial=30%`. Invariants always fail.

## Thresholds and what to do when a check fails

The defaults are the qualification bar: zero entity, vocabulary, polarity and label errors on grounded and problem wires, no exact test overlap, and warnings reviewed rather than ignored. When a check fails:

1. Read the check's `examples` and, for volume, the `--rows-out` file. Confirm the finding by reading the message and the target, not the rate alone.
2. **Fix the generator, never hand-patch rows.** The generator (`tools/datasets/build-corpora.mjs` with its modules under `tools/datasets/diversity/`, DS022) produced the defect; a hand edit breaks the manifest checksums and is lost at the next build. Typical fixes: state every statement in the message (or stop emitting it as `stated`), emit negated statements only when the message negates, ask negative questions for negative predicates, make structure labels come from the constructs actually emitted, remove ids and counters from surfaces, write more independent phrasings.
3. Regenerate the corpus (`node tools/datasets/build-corpora.mjs`), run `node tools/datasets/no-copy.mjs`, `npm run test:data` and `node tools/datasets/verify-corpus.mjs --corpus <corpus> --all`, then re-run this audit and compare the rates with the previous report.
4. If the finding is a false positive, improve the heuristic (see below) with a test that shows the legitimate case passing; do not raise a threshold to make a corpus pass. A threshold change needs a stated reason in the change description.
5. Never relax `--fail-on` for qualification. Report mode exists only for known-bad corpora awaiting regeneration.

## Diversity expectations

Real diversity, not templated duplication:

- Independent phrasings per semantic case, varied sentence structures and question forms, and a template distribution without a dominant head (top-10 share well below the threshold).
- Mixed EN/RO, including Romanian diacritics and inflection, informal phrasing and occasional typos, are welcome: the matcher tolerates them, and they are what the model will meet.
- Names are natural names or labels, not counters or hashes; case ids never appear in text.
- The message never presupposes a knowledge base, records or identifiers visible to the model ("from the vocabulary", "the approved facts", "record 12"): the model sees the message only.
- The sealed test is built from templates and entities the development splits did not use, so template overlap with train/dev stays low.

## Contract vocabulary check

Fine-tuning data, examples and docs must not teach SOP constructs that the language does not have. `tools/datasets/audit/vocabulary.mjs` checks every SOP program structurally against the contract; it runs inside every corpus audit as `vocabulary.contract` and standalone over the whole repository:

```sh
# Everything: corpora, example programs and documentation. Writes eval/reports/current/vocabulary.json.
node tools/verify-vocabulary.mjs --scope all

# One scope or one corpus; every finding as JSONL for triage.
node tools/verify-vocabulary.mjs --scope corpora --corpus formalizer-v1
node tools/verify-vocabulary.mjs --scope docs --findings-out /tmp/vocabulary-findings.jsonl

# The tool's own tests (in-test fixtures and contract stubs only).
node --test tests/vocabulary.test.mjs
```

Other flags: `--pending-types a,b` marks extra types as migration pending; `--no-parse` skips the repository parser pass; `--stdout` prints the JSON report instead of writing it; `--examples N` sets examples kept per group; `--root <dir>` checks another checkout. Exit status: `0` no failing finding, `1` failing findings in the selected scope, `2` the check could not run.

**Where the vocabulary comes from.** Nothing is listed in the tool. Wire types and their `one`/`many`/`required` fields come from `SPEC` (and the lexicon wires `predicate`, `lexeme` and `entity` of `sop/knowledge/grammar.mjs`) in `sop/parser.mjs`; model-authorable types from `sop/declarative.mjs` (`MODEL_TYPES`); enumerated values from explicit registries (`values`/`enums` on a SPEC or `sop/contracts/wires.json` entry, or an exported `FIELD_VALUES`/`ENUMS` table), from exported constants the parser uses to validate a field (`CERTAINTIES.includes(one(w,'certainty'))`), and from exported constants named after the field (`POLARITIES`, `UNCLEAR_KINDS`). A new type, field or exported enumeration is therefore checked without touching the tool. Enumerations that the sources validate only with inline literals (today `query.mode`, `constraint.task`, `constraint.direction`, output port modes, `rule.mode`, `event.action`, `resolve.kind`) are listed as `unverified_enums` in the report and are not enforced; the parser pass still reports those it rejects at parse time as `parse_error`. Exporting such a list from `sop/` makes it enforced.

**Where SOP is read.** `corpora`: `sop_target` (also against the model-authorable types unless `evaluation_track` is `system`), `setup_sop` and `ontology_sop` of `datasets/<corpus>/{train,dev}.jsonl` and the sealed `eval/suites/<corpus>/test.jsonl`. `examples`: `examples/**`, `tests/fixtures/**` and `config/*.sop`; a `# --- ... ---` comment line separates independent programs in one file. `docs`: `<pre>` blocks in `docs/**/*.html`, fenced blocks in `docs/**/*.md`, `skills/**/*.md`, `README.md` and `AGENTS.md` (fences tagged with another language are skipped; a fence info string containing `invalid` exempts fields). Help-page examples marked `data-sop="invalid"` are exempt from field, enum and cardinality checks, but must still use real type names unless their `data-error` demonstrates an unknown wire type. Nested SOP inside `|` blocks (template and procedure bodies) is checked too. The docs scope also cross-checks `docs/wire_typs/`: every contract type has a page, every field a table row and every exported enumerated value a mention, and every table keyword exists in the contract (it shares its page extraction with `tests/wire-help.test.mjs` through `tools/wire-help-pages.mjs`).

**Reading the report.** `eval/reports/current/vocabulary.json` (`format: chatsop-vocabulary-v1`) holds the vocabulary as read (`contract`), what was scanned, and `groups` by construct and class with counts per source and per construct detail plus the first examples; `findings` lists locations (`file:line`, or `corpus:split:row-id:field:line`). Constructs: `unknown_type`, `unknown_field`, `unknown_enum` (class `hallucination`); `model_forbidden_type`, `cardinality`, `parse_error` (class `contract`); `doc_missing_page`, `doc_missing_row`, `doc_unknown_row`, `doc_unknown_keyword`, `doc_missing_enum_value` (class `documentation`). Two classes are reported but never fail: `migration_pending` (the type is in flight: in `SPEC` but not yet in `wires.json` or the reverse, or model-authored in the `wires.json` snapshot but not in `MODEL_TYPES`) and `proposal` (SOP under a docs `proposals/` folder, which describes constructs that do not exist yet; there is none today, and past proposals are archived under `probably_obsolete/specs/`).

**When it fails.** A hallucinated construct in a corpus is a generator defect: fix the builder and regenerate, never hand-patch rows. In docs and examples, correct the SOP to the contract, or, if the construct is intended, change the contract first (parser, `wires.json`, help page) and let the check follow. Pending-migration findings shrink as the migration lands; rows still using a retired model construct must be regenerated before the corpus is qualified.

## Human review before qualification

A passing audit is necessary, not sufficient. Before a corpus is proposed for qualification, a human reviews a stratified sample in the audit server (`npm start`, then `/audit`, DS020): at least a few rows per structure label, per language and per expected status, drawn from each split, plus every check's examples. Verdicts go to `eval/reports/current/audit/<corpus>.jsonl`. The reviewer confirms that every stated fact is in the message, assumptions are marked as such, polarity and time are right, and the phrasing is natural. Qualification cites both the audit report and the review ledger.

The audit page has four tabs, declared in `config/audit-corpora.json` (DS020 "Audit tabs and review types"): `bad_english`, `symbolic_english`, `neuro_english` (the three datasets, each with a purpose statement, row counts per split and filters) and a secondary `archive / sources` tab. This is where the owner reviews the datasets before any fine-tuning decision. In `symbolic_english` check that the dependency tree and table are a correct analysis of the message, read the verification status (gold match, judge verdict, Stanza-spaCy agreement) and use **Re-run SymbolicLM** to see whether the current engine still gives the same analysis. In `neuro_english` check the failure kind and blame, that SymbolicLM's output really differs from the gold, and that a rewrite target keeps names, numbers, negation, quantifiers and the question kind (word diff); **Check message and target** runs SymbolicLM on both. In `bad_english` check the kind and noise categories and that the clean target is clean English with the same meaning (**Check the target** runs the classifier and SymbolicLM). The archive tab holds the legacy corpora (`proofing`, `formalizer-v1`, ...) and the local source cache (never exported) with their earlier views. Sealed suites are view-only, and every verdict still goes to the ledger `eval/reports/current/audit/<dataset>.jsonl`. Passing this audit does not authorize training (AGENTS.md rule 3).

## Known limits

The `context.*` checks and the `context_shape` histogram were written when rows carried a model-visible vocabulary. Today `context` is verification scaffolding only (`model_visible: false`) and the model's prompt is the message (DS021), so these checks describe how rich the verification world is; they say nothing about what the model sees. The fail-closed invariants and `vocabulary.model_target_id_token` enforce the no-context rule itself. The corpora in scope are `formalizer-v1` (train/dev plus the sealed test) and the out-of-distribution suite `formalizer-ood-v1` (sealed test only: it has no train/dev splits, so its leakage section compares against nothing and reports zero).

## Sealed-test boundary

Reading `eval/suites/<corpus>/test.jsonl` is what a leakage audit does; it is not training or selection input (AGENTS.md rule 9). The audit tools are registered as sealed auditors in `eval/leakage.mjs`: the code-path audit excludes them from the generator set and fails if any generator or training/selection source imports them. Never import `tools/datasets/audit/**` from a builder, trainer or selector, and never feed audit output back into generation.

## Adding a new check

1. Row checks live in `ROW_CHECKS` in `tools/datasets/audit/checks.mjs`: add `{id, severity, threshold, target, description, run(context)}`. `run` receives the per-row context (row, message, question, vocabulary, parsed wires with atoms, normalized message and tokens, configuration) and returns a list of findings; empty means the row passes. Use `checkedWires(context)` so the grounded/assumption roles are respected. `target: true` limits the check to rows whose target parses.
2. Corpus metrics live in `CORPUS_CHECKS` in `tools/datasets/audit/options.mjs` (with `direction: 'max'` or `'min'`); compute the value in `tools/datasets/audit/engine.mjs`.
3. Choose severity by consequence: `error` when the row teaches a wrong mapping, `warning` when it is weak or suspicious, `info` for descriptive metrics. Errors join the default `--fail-on` set.
4. Add a planted-defect test and a clean-row test to `tests/audit-corpus.test.mjs` using in-test fixtures only (no real corpora).
5. Run the audit on the current corpora, read the new examples for false positives, and document the check in the tables above.

## Project journal

Append an event to `status/journal.jsonl` with `node tools/journal.mjs add --area <area> --state <started|progress|done|blocked|decision> --title "…" --detail "…" [--link <path>]` whenever you start, finish or block a meaningful task or record an owner decision; the journal is append-only and the server's `/experiments` pages shows it to the owner in real time (AGENTS.md, "Project journal"). After an audit run, log the corpus, verdict and failing checks with `node tools/journal.mjs add --area data …` and link the report.

Also record the audit's findings as topic notes under `data-quality-and-audit`: `node tools/notes.mjs add --topic data-quality-and-audit --kind <result|observation|suggestion> --title "…" --body "…" --link eval/reports/current/corpus-audit/<corpus>.json`, including audits that fail before a later pass. Notes are append-only; correct one with a new note and `--supersedes <note id>`. The `/experiments` pages are the living index.
