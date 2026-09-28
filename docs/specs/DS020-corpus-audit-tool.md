---
title: DS020-corpus-audit-tool
summary: JSONL-first corpora with a local visual audit server, verdict ledger, machine corpus audit (invariants, faithfulness, triviality, diversity, template leakage) and the retired Markdown authoring path.
---

# DS020 — Corpus source of truth and visual audit

## Decision

The corpora are **JSONL-first**. The synthetic builders author rows, execute every gold against the real runtime and write the split files; those files *are* the dataset. There is no Markdown intermediate anywhere under `datasets/`: the earlier Markdown audit tree and the Markdown authoring/compile path were retired on 2026-09-28 (`datasets/cases/**`, `tools/datasets/build-cases-md.mjs`, `tools/datasets/authoring/**`, the `cases-md` verifier job, the `cases_md` manifest field and its validator check are gone). A human reviews the data through the audit server, not through generated prose files.

Split layout, unchanged and enforced by the validators:

| Path | Role |
| --- | --- |
| `datasets/<corpus>/train.jsonl`, `dev.jsonl` | development corpora |
| `eval/suites/<corpus>/test.jsonl` | the authoritative sealed test (never trained, never selected on) |
| `datasets/<corpus>/surfaces.jsonl` | the natural-language requests without a target (NL-only asset) |
| `datasets/<corpus>/report.json` | the builder's observed counts, distributions and full-execution fingerprint |
| `eval/reports/current/corpus-audit/<corpus>.json` | machine audit report (`chatsop-corpus-audit-v2`): invariants, faithfulness, context shape, diversity, template leakage, spot sample; a regenerable observation, not a dataset artifact |

## Visual audit server

The audit is **mounted on the main server**, so there is one process and one port for everything:

```sh
npm start                     # docs + admin + corpus audit + chat on 0.0.0.0:9999
```

Open `/audit`; a signed-out browser is sent to `/login?next=/audit` first and returned after signing in; the audit page and its API (`/audit/api/*`) require the administrator session (an API call without it answers 401 and is never redirected), and no second service is needed. It loads the corpora straight from the split files. Each corpus is indexed once, on first use: rows are grouped into cases by `semantic_case_id`, the cases are sorted once and their category counts are computed once, so filtering and paging of the largest corpora (75k–93k rows) happen on the server without re-sorting. Only the verdict counts follow the append-only ledger.

The page (`server/pages/audit.mjs`, under the shared top bar of `server/pages/layout.mjs`) has three full-height panes that scroll independently:

- **Categories (left).** The corpora as a collapsible tree with case counts. Opening a corpus shows its category groups, each with per-value case counts: split, family/structure (`structure_id`, else `form` or `surface_design`), language, `input_mode`, review status (`target_review_status`, `review_status` or the generation review status), theme, expected status and verdict (unreviewed / ok / needs fix / reject). Clicking a value filters the list; values from different groups combine, active filters appear as removable chips. A search box above the tree matches case ids, row ids and the full message text.
- **Cases (middle).** The filtered cases, 50 per page, with the total, previous/next and a page-number jump. Each item shows the case id, a one-line truncated message and badges for language, split and verdict. `↑`/`↓` or `k`/`j` move the selection (crossing page boundaries), `PageUp`/`PageDown` change page and `/` focuses the search. The corpus, filters, search, page and selected case live in the URL hash, so a reload or a shared link reopens the same case on its page. The divider to the detail pane can be dragged; under about 900px the panes stack and the case list becomes a drawer opened with a **Cases** button.
- **Case (right).** The selected case in full: a key/value header (id, corpus, split, family/structure, theme, language, input mode, evaluation track, semantic status, review status, target status, split/surface groups, source, lineage, generation trace and quality flags); every surface's full, never truncated message with its row id, split, language and file; the target SOP; the verification context when a row carries one (clock, attached and background assertions, background rules, and the entity and predicate lists that legacy-format rows still carry, shown when present; the model never sees them), the trusted setup, the case ontology and the source content; the stored expectation and the recorded oracle (`independent_oracle`, `graph_oracle`, `expected_from`, recorded execution); the **Execute** button; the machine-audit findings; the verdict buttons with a note and the full verdict history of the case; and the unmodified rows as collapsible raw JSON.

**SOP rendering.** Target, setup and ontology SOP are rendered by the shared `server/pages/sop-code.mjs` module (`renderSopHtml(source)` on the server, `sopCodeScript` defining `window.ChatSopCode.render` in the browser; both run the same function) with a copy button. It highlights wire headers, field keywords, `all`/`any`/`end`/`not`, `$refs`, `?vars`, strings, numbers and comments. Every wire type links to `/docs/wire_typs/<type>.html` and every field keyword at the start of a wire body line to `/docs/wire_typs/<type>.html#field-<keyword>`, both in a new tab. The known types and fields come from the parser contract (`SPEC`, plus `ONTOLOGY_SPEC` for `entity`/`predicate`/`concept`), not from a list in the page; a type or field outside the contract is not linked and is marked **undocumented**, a visible hallucination signal.

**Execute** re-executes that case's targets through the real runtime (each distinct trusted setup published once) and compares the observed status *and* answer tuples with the stored expectation, using the same convention as `eval/run.mjs` (an answer is a tuple of the selected fields). The result shows match or mismatch per row, the rendered text, a runtime error when one occurs, and the full runtime packet in a collapsible section.

**Machine-audit findings.** When `eval/reports/current/corpus-audit/<corpus>.rows.jsonl` exists (written with `--rows-out`), the case shows every per-row finding from it; otherwise it shows the rows that appear among the report's per-check `examples` in `<corpus>.json`, and says that coverage is limited to those examples. Error-severity `faithfulness.*` and `label.*` findings are shown in a highlighted block at the top of the case.

**Verdicts.** `approve` (shown as *ok*) / `needs_fix` / `reject` plus a note, appended to `eval/reports/current/audit/<corpus>.jsonl` with a timestamp, the row fingerprint and the target hash, so a later change to the case is detectable. `CHATSOP_AUDIT_LEDGER` overrides the ledger directory (used by the tests).

REST surface (all JSON, under `/audit/api/`):

| Endpoint | Returns |
| --- | --- |
| `GET corpora` | per-corpus rows, cases, split/language/shape/status/theme tallies, the `id + target` fingerprint and reviewed/approved/rejected/needs-fix counters |
| `GET facets?corpus=` | `{corpus, rows, cases, groups:[{key, label, values}]}` with per-case counts for `split`, `family`, `language`, `input_mode`, `review`, `theme`, `status`, `verdict` |
| `GET cases?corpus=` | one page `{total, offset, limit, page, pages, index, items}`; filters are the facet keys (`shape` and `reviewed` remain aliases of `family` and `verdict`) plus `q`; paging by `page` or `offset` with `limit` (default 50, at most 200); `around=<case id>` returns the page holding that case and its `index` |
| `GET case?corpus=&id=` | the full case: header fields, `rows` with full messages, target, setup, ontology, `verification_context` (the evaluation-only clock and verification vocabulary; formerly `context`), `shortlist` (the legacy entity/predicate lists of legacy-format rows, empty for current rows), expectation, `oracle`, latest `verdict`, `history`, `audit` findings and `raw` rows |
| `POST execute` | `{corpus, id}` → per-row observed status, answers, match flags, rendered text and runtime `packet` |
| `POST verdict` | `{corpus, caseId, verdict, note}` → the appended ledger record |

Nothing else is written: the audit is read-only apart from the append-only verdict ledger, it loads no model and calls no network.

## Machine audit

```sh
node tools/datasets/audit-corpus.mjs --corpus <name>
  [--fail-on errors|warnings|all|none|<id>[=rate],...] [--threshold <id>=<rate>,...]
  [--grounded-types stated] [--assumption-types assumed,...] [--problem-types query,constraint]
  [--lexicon <file.json>] [--rows-out <file.jsonl>] [--out <file.json>] [--stdout]
  [--examples 5] [--spot 25] [--no-leakage] [--train|--dev|--test <file>] [--root <dir>]
```

The machine audit is a deterministic, model-free, network-free pass over `datasets/<corpus>/{train,dev}.jsonl` and the sealed `eval/suites/<corpus>/test.jsonl`. Its operating procedure, the full check table and the triage rules are in `skills/corpus-audit/SKILL.md`; code lives in `tools/datasets/audit-corpus.mjs` and `tools/datasets/audit/*.mjs`. It writes `eval/reports/current/corpus-audit/<corpus>.json` (or `--out`; `--stdout` writes the JSON to stdout and no file) and prints a short summary. The report is a regenerable observation of the files on disk; current rates are read from that directory, never restated in a specification.

**Structural invariants (fail-closed).** Unique ids and unique normalized requests, inline vocabulary on every row, a target for every non-surface row (or an explicit `pending_review`/`surfaces_only` marker), parseable targets, declarative-only targets (`stated`, `assumed`, `unclear`, `query`, `constraint`) outside the `system` evaluation track, executed expectations, connected groups confined to one split, and declared no-copied-rows provenance. The provenance invariant accepts any of `quality_flags.source_rows_copied: false`, `quality_flags.copied_source_rows: false` or `quality_flags.synthetic: true` (a fully synthetic curriculum has no source rows to copy). Any invariant violation fails the run regardless of `--fail-on`.

**Semantic checks.** Each check has an id, a severity (`error`, `warning` or `info`) and a threshold:

- *Faithfulness* (`faithfulness.*`): every entity and quoted constant in a grounded or problem wire is mentioned in the message; model-language propositions carry quoted strings, numbers or `?variables` that the host links, while identifier atoms in legacy-format rows must use predicates and constants from that row's legacy vocabulary lists; every `not` or lexically negative predicate has a negation or omission cue; constraint numbers occur in the message; structure labels (`label.*`) match the constructs the target actually contains.
- *Context triviality* (`context.*`): for legacy-format rows that still carry a context block, single-predicate or near-empty vocabulary lists that make the target predictable without reading the message, and gold answers listed in that context. Current rows have no context, because the model sees only the user message.
- *Diversity* (`diversity.*`): masked input-template concentration and ratio, distinct target skeletons, within-split near-duplicates outside a split group, ids or generator counters in natural language.
- *Template leakage* (`leakage.*`): exact sealed-test messages in train/dev (error), and sealed-test rows whose masked template, near-duplicate message, entity label head or target skeleton occurs in train/dev.

**Wire roles.** Grounded wire types (default `stated`) carry stated facts and are checked strictly for faithfulness; problem wire types (default `query`, `constraint`) must ask what the message asks; assumption wire types (default `assumed`) carry model-injected assumptions, are counted (`wires.assumption*`, `assumption.row_ratio`) and are exempt from faithfulness findings. The roles are configuration (`--grounded-types`, `--assumption-types`, `--problem-types`), not code, and one type cannot be both an assumption and a grounded/problem type. Relabelling an unsupported statement as an assumption is a generator change, not a way to silence the audit.

**Failing set.** `--fail-on errors` (default) fails on every error-severity check above its threshold; `warnings` or `all` adds warning checks; `none` is report mode, where only invariants fail; `<id>[=rate]` selects checks explicitly. `--threshold` changes a threshold without changing which checks fail. Exit status is `0` pass, `1` an invariant or a selected check failed, `2` the audit could not run.

**Integration.** `node check-datasets.mjs` runs the audit on every corpus with train/dev splits after the validators, in report mode (`--fail-on none`): findings, including invariant violations, are printed and the reports refreshed, but only the validators decide the exit code. `--audit-strict` applies the default `--fail-on errors` and lets any audit failure fail the run; `--no-audit` skips the audit. The audit tools are registered as sealed auditors in `eval/leakage.mjs` ([DS008](specsLoader.html?spec=DS008-data-evaluation.md)). A passing audit does not replace human review and does not qualify a corpus for training.

## Trust chain

A reviewer does not have to trust the JSONL blindly:

1. The builder prints the counts it produced and the fingerprint of the golds it executed; the report file records both.
2. `npm run test:data` (`tests/data/formalizer-corpus.test.mjs`) re-executes a deterministic stratified sample and asserts that the manifest checksums still match the files on disk, so a hand edit is caught.
3. `node tools/datasets/verify-corpus.mjs --corpus <corpus> --all` re-checks every row and re-executes every row, sealed test included, on its verification world.
4. `node tools/verify.mjs` and `node check-datasets.mjs` run all of the above together (`check-datasets.mjs` also runs the machine audit in report mode); `tools/verify.mjs` fingerprints the repository sources.
5. The audit server shows the same data to a human, re-executes individual cases on demand and records verdicts as evidence.

## Exposure and limits

The audit shares the server's authentication: the administrator password chosen on `/login` (or a bearer token) is required. The documentation path stays public, so still prefer a private network address when binding to `0.0.0.0`. The corpora remain `not_reviewed` until verdicts are recorded, and a verdict records one reviewer's judgement — it is not training qualification.
