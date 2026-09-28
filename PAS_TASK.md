# Session delivery — consolidation, real foundation and research corpora

## Documentation, wire help, server and examples review (2026-09-28)

Delivered: `docs/wire_typs/model-guide.html`, `docs/wire_typs/question-types.html`, the corrected wire pages and prompt, guard G3 (`tools/lint/model-surface.mjs`, `tests/no-context-lint.test.mjs`) and G4 (AGENTS.md "Model boundary (non-negotiable)"), the site link checker (`tools/check-links.mjs`, `tests/site-links.test.mjs`), the server fixes listed in `CHANGES.md`, the converted research examples and the skills review. Observed: `tests/wire-help.test.mjs` executes every help example (7/7); `node tools/verify-vocabulary.mjs --scope all` PASS; `node tools/check-spec-refs.mjs` 0 violations; `node tools/shard-large-files.mjs --check` and `node tools/site-menu.mjs --check` pass; the link checker reports 0 broken links; `node tools/verify.mjs` passed every job except `node-tests`, whose remaining failures were in the data owner's in-progress corpus rebuild (baseline registry cells). No training.

## Question forms and the regenerated model-language corpora (2026-09-28)

Delivered: the DS021 question forms (universal `mode every` + `scope`, time variables with `span` and `measure`, `mode explain`, where/how roles), `unclear kind ambiguous` with readings, host normalization of natural dates and filter literals (`sop/parser.mjs`, `sop/enums.mjs`, `sop/unclear.mjs`, `sop/propositions.mjs`, `sop/linking.mjs`, `sop/declarative.mjs`, `sop/lower.mjs`, `reasoning/reasoner.mjs`, `sop/cnl.mjs`, `eval/run.mjs`, `eval/signature.mjs`); the generator extensions and `tools/datasets/build-corpora.mjs`, `tools/datasets/verify-corpus.mjs`, `lib/row-world.mjs`; the corpora `formalizer-v1` and `formalizer-ood-v1`; the message-only projection; guards G1/G2; deletion of the legacy corpora, builders and tests. Observed: `npm test` and `npm run test:data` green with no skips; audit PASS (0 error findings) on both corpora; `verify-corpus --all` 100% agreement; no-copy pass; `verify-vocabulary --scope all` pass; independent adversarial review: round 1 NO SIGN-OFF (about 7% label defects, all fixed), round 2 SIGN-OFF (about 0.2%, residuals fixed before the final build). No training.

## Memory-strategy specifications and naming (2026-09-28)

Delivered: DS023–DS028 and the updates listed in `CHANGES.md`; code renames with legacy aliases in `memory/banks/factory.mjs`, `memory/strategies.mjs`, `memory/banks/holo*.mjs`, `memory/weaver.mjs`, `memory/banks/hybrid.mjs`, the tools, tests, examples and configurations. Observed: `node --test` over the memory, shard, repository, linker, capability-matrix, reasoning and routing tests passes (216/216); `node tools/compare-engines.mjs` and `node tools/compare-reasoners.mjs` (with the private SWI and Z3 binaries) reran under the new names and reproduced the DS013 exact-set counts, byte sizes and hybrid hint counts; `node tools/capability-matrix.mjs` observed 10 cells, 0 skipped, 5 unsupported; the memory, linker, shards, forgetting and reasoning demos and small `bench-memory`/`bench-holo-memory` runs complete; `node tools/check-spec-refs.mjs` reports 29 specifications and 0 violations. No training, no GPU work and no model inference were involved.

## Research corpora adapted from public dataset designs (2026-09-28)

The user authorized research-mode corpus acquisition and set two adaptation rules: keep the **domain of the source case** while varying only subject and wording (domains carry their own subtleties), and keep the corpora **broad** rather than funneling everything into one narrow topic. The quarantined sources (QA2D data, ProofWriter, QQP, AmbigQA) were neither acquired nor read; only their published design manner was adapted. PAWS was fetched with its LICENSE into `datasets_sources/paws/` (8000-pair Wikipedia-only validation sample, raw + derived JSONL, provenance with hashes) and analysed for structure only — no row was exported into any corpus.

Four new corpora, all `formalization` track, all gold-executed, all `not_reviewed`:

| Corpus | Design manner adapted | Cases | Rows (train/dev/test) | EN / RO | Domains |
| --- | --- | ---: | --- | --- | ---: |
| `datasets/qa-proposition-v1` | QA2D question→proposition | 90 | 288 (96/96/96) | 270 / 18 | 12 |
| `datasets/proof-structure-v1` | ProofWriter premises+rules+status+depth | 75 | 240 (144/48/48) | 225 / 15 | 15 |
| `datasets/paraphrase-contrast-v1` | QQP equivalence + PAWS high-overlap contrasts | 60 | 240 (128/56/56) | 180 / 60 | 14 |
| `datasets/ambiguity-resolve-v1` | AmbigQA ambiguity + disambiguated rewrites | 60 | 60 (36/12/12) | 48 / 12 | 12 |
| **Total** | | **285** | **828 (404/212/212)** | **723 / 105** | 53 labels |

Domain fidelity was checked against the measured PAWS distribution (geography 995, arts/language 581, sports 260, education 229, household 200, health 192, travel 184, history 170, commerce 161, law 148, technology 101, earth sciences 44, agriculture 19, weather 13 of 8000 primary pairs) rather than an invented spread.

New capability used by the proof corpus: every rational packet now reports `depth`, the number of rule applications in the minimal justification of the premises the answer used (observed premise `0`, one chained rule `1`). Implemented in `reasoning/reasoner.mjs`, documented in DS006 and the `reason` help page, and demonstrated in `examples/research/demo.mjs` (premise-only `0`, one rule `1`). Affected suites re-ran green (71/71 focused, then the full verifier).

Experiment inputs are prepared by `node tools/research/prepare-experiment.mjs`: it checks the declarative boundary and the connected-group split invariant, projects instruction-free `barePrompt` train/dev inputs to `datasets/research-train-v1/<corpus>/formalizer/`, references the sealed suites by hash instead of copying them, and writes a manifest with per-corpus tallies and fingerprints. Usage examples: `examples/research/{proposition,polarity,temporal,ambiguity,spatial,quantified}.sop` with `examples/research/demo.mjs` (six domains, executed and asserted) and the index in `examples/research/README.md`. Specifications: the four research-corpus cards and their summary (merged into DS018 on 2026-09-28), registered in `docs/specs/matrix.md`; rights and the research-mode decision in DS014.

Observed verification after this work: **468/468 tests, 31/31 checks passed, zero skipped**, fingerprint `9120dc8da0049aa2c71161161e48a571f5b42f975db23ca89886ea2e175cf15a`; the verifier also executes the four new sealed suites, the research preparation tool and the research examples demo. `node check-datasets.mjs` passes all ten dataset checks, the four research corpora included.



## Source-grounded corpora and assumption explanations (2026-09-28, later phase)

The user's rules for this phase: a generator must read the ACTUAL cached source datasets and author a separate counterpart per analysed source case (same theme and shape, our own content); mass mechanical duplication and unprompted invention are not acceptable; the NL example is the base asset, so an imperfect first-pass SOP target is a review matter, not a blocker; and the system should be able to explain the assumptions it made.

Research-only source cache (`datasets_sources/**`, with licences and provenance; never redistributed): PAWS 8,000 pairs, QA2D 10,344 rows, ProofWriter structured 6,128 theories, QQP 40,430 pairs, AmbigNQ 2,002 cases. `tools/datasets/analyze-sources.mjs` records measured theme and shape inventories (for example ProofWriter True/False/Unknown 13,831/13,831/23,182 and a `qdep` depth distribution; QA2D question-type and change-cue counts; QQP equivalence labels; PAWS change classes). Rights findings were corrected where evidence demanded it: the AmbigNQ publisher bundle DOES carry a CC BY-SA 3.0 licence (earlier "no licence" finding corrected), QA2D data has no dataset-specific licence (card: needs more information), QQP remains research/non-commercial, ProofWriter still exposes no dataset licence. All recorded in DS014.

Four source-grounded corpora, each row anchored to an analysed source row with `generation_trace.lineage` and `source_rows_copied:false`:

| Corpus | Source | Cases analysed | Rows (train/dev/sealed test) | RO | Themes | Skeletons |
| --- | --- | ---: | --- | ---: | ---: | ---: |
| `datasets/grounded-proof` + `eval/suites/grounded-proof` | ProofWriter | 1,200 theories | 1,200 (840/240/120) | 240 | 16 | 240 |
| `datasets/grounded-proposition` + `eval/suites/grounded-proposition` | QA2D dev | 1,200 (10,344 scanned) | 1,200 (960/120/120) | 246 | 14 | 233 of 240 |
| `datasets/grounded-paraphrase` + `eval/suites/grounded-paraphrase` | QQP + PAWS | 600 + 600 pairs | 2,400 (1,946/232/222) | 480 | 30 | 566 |
| `datasets/grounded-ambiguity` + `eval/suites/grounded-ambiguity` | AmbigNQ | 600 cases | 2,508 (1,989/276/243) | 490 | 27 | 200 |
| **Total** | | **4,800** | **7,308 (5,735/868/705)** | **1,456** | 87 labels | — |

Shape fidelity is reported per corpus (ProofWriter status mix 392/418/390 with depth 0–5 = 913/150/73/34/14/16; QQP equivalence 845 versus PAWS contrast 355 with change classes; AmbigNQ ambiguity types 347/189/37/27). Diversity is enforced and measured: 100% unique normalized requests, largest skeleton share ≈0.4–0.7%, NL-only `surfaces.jsonl` beside the canonical split files. Rows are honestly described as generator-composed from an authored skeleton library anchored to analysed source cases — not hand-written and not reviewed — with `target_review_status: pending_review` on every target.

Canonical layout follows the repository rule: development rows in `datasets/<name>/{train,dev}.jsonl`, sealed test only in `eval/suites/<name>/test.jsonl`; `pairs.jsonl` was retired. `tools/research/prepare-experiment.mjs` now discovers these corpora too; the prepared manifest covers nine corpora — 8,536 rows, 6,139 instruction-free train projections, 1,080 dev projections and 1,277 sealed rows.

Assumption explanations were implemented as a host capability rather than a new model head: `server/agent.mjs` exports `explainAssumption` and every turn returns `assumptions` for the premises that turn introduced (atom, rendered statement, validity, `source:'model-interpretation'`), rendered from lexicon labels in the turn language; the HTTP façade exposes the same list in its trace (DS012, DS021, `premise` help page). A retained premise is not re-explained, and the prose cannot claim a reading the model did not declare. Covered by new agent tests (EN and RO) and by the existing server suite; a bare-mode import regression found during integration was fixed.

## Documentation and chat on one port, JSONL-first review (2026-09-28, final)

- `server/http.mjs` now serves the documentation site statically beside the chat API: `GET /` and `/docs` redirect to `/docs/`, and `/docs/**` serves the repository documentation (HTML, CSS, the specification Markdown) without authentication, read-only, with no directory listing and a traversal guard that rejects any path resolving outside `docs/` (encoded traversal and NUL bytes included). HTML is `no-cache`, other assets get a short cache. The chat API keeps bearer authentication, and `config/runtime.json` now sets `promptProfile: "formal"` so the server starts without extra environment. Covered by a new case in `tests/server-http.test.mjs` (7/7 passing).
- Startup: `CHATSOP_API_KEY=<≥16 chars> node server/http.mjs` (defaults `127.0.0.1:3000`); remote binding needs `CHATSOP_ALLOW_REMOTE=1` plus `CHATSOP_HOST=0.0.0.0` and `CHATSOP_PORT`. Until a formalizer endpoint runs, `/readyz` answers 503 with `model_available: false` and chat returns 503, while the documentation keeps working. On this workstation port 3000 was already taken by an unrelated Podman `rootlessport`, so the instance runs on **3001**, and the visual audit server (DS020) runs on **8788**; both are bound to all interfaces for remote review.
- Corpus review tooling (DS020): the Markdown layer under `datasets/` was retired completely — generated views, review packs, the older curriculum audit tree, `build-cases-md.mjs`, `authoring/`, the `cases-md` verifier job, the authoring-pipeline test and the `cases_md` manifest field with its validator check — and the `query-v1`/`query-v2` manifests were regenerated without that field. Review now happens in the visual audit server, which lists every corpus with counts and fingerprints, filters and opens cases (requests, vocabulary, target, setup, expectation, lineage), re-executes a case's gold on demand and appends `approve`/`reject`/`needs_fix` verdicts to `eval/reports/current/audit/<corpus>.jsonl`. `tools/datasets/audit-corpus.mjs` writes the machine audit `AUDIT.json` and fails closed on any invariant violation.



Final state of the corpora after the scaling waves: `grounded-proof` 15,000 rows, `grounded-proposition` 10,344, `grounded-paraphrase` 93,064, `grounded-ambiguity` 14,998 — **133,406 rows** anchored to analysed source cases (4,800+ source rows analysed in the first wave, with the larger train splits now cached for further waves), plus the earlier research corpora and the query/pilot/independent suites: the audit server sees **12 corpora and 135,701 rows**. Every gold was executed at build time with counts and fingerprints recorded per corpus, and the source cache was scanned for exact copies with **0** found.

**One server, one port, password on first run (final consolidation).** `npm start` now runs a single process on port **9999** serving: the documentation site (`/docs/`, public, traversal-guarded), the admin page (`/admin`), the corpus audit (`/audit` + `/audit/api/*`) and the OpenAI-compatible chat API (`/v1/chat/completions`, `/readyz`, `/healthz`). On first run `/admin` asks for the administrator password, stored only as a scrypt hash with a per-install salt in `state/auth.json` (mode 0600); the browser keeps an HttpOnly session cookie, and the chat API answers `setup_required` (403) until the password exists. The admin page reports model readiness and the active prompt profile, mints API tokens shown once (stored as SHA-256 digests) with revocation, signs out and links to the audit. `CHATSOP_API_KEY` still works as an environment-provided bearer token with no password. The separate audit server on 8788, its CLI flags and the `npm run audit` script were removed, as was the standalone `server/audit.mjs` listener (the file is now a mountable router). Fixed during integration: the admin and audit routes sat outside the request-level error mapping, so their failures escaped as unhandled rejections — both now answer structured errors (`invalid_credentials`, `too_many_attempts`, `invalid_request`), the admin page's token buttons use data attributes instead of broken nested quoting, `readiness()` reports the active prompt profile, and the auth/audit suites are hermetic (temporary ledger, `closeAllConnections()` teardown). Observed: `tests/auth-server.test.mjs` 4/4, `tests/audit-server.test.mjs` 5/5, `tests/server-http.test.mjs` 7/7.

Observed verification after this phase: **487/487 tests, 38/38 checks passed, zero skipped**, fingerprint `93165283054d893a90ba04e5808bc21d9e7898bde05523a39edb0e3c2d0919ac`; `node check-datasets.mjs` passes all thirteen dataset checks.

Observed verification after the source-grounded phase, before the review-tooling change (superseded by the 481/481 run above): 482/482 tests, 39/39 checks passed, zero skipped, fingerprint `0baa7e40a42866a924dbb1e79d4f4f41e6d4f8bd7c67883481bf8c3eb0cafee3`; the verifier validated each grounded corpus's development and sealed files and ran the research preparation tool, and `node check-datasets.mjs` passed all fourteen dataset checks including the four grounded sealed suites executed against the runtime.



## Consolidation and real foundation (2026-09-27)

Everything below was executed in that phase and recorded with the command that produced it. Nothing was trained, fine-tuned or inferred; the training interdiction stands.

## Verification at that phase (superseded by the 482/482 run above)

- `Z3_BIN="$PWD/tools/.solvers/z3/bin/z3" SWIPL_BIN="$PWD/tools/.solvers/swi/swipl" node tools/verify.mjs` → **455/455 tests, 25/25 checks passed, zero skipped**, `complete: true`, `neuralModelTested: false`, `trainingExecuted: false`. Fingerprint `1eefb0952cb1f3e14b32c94f41c96c391dd32546077fa78d2b5dbdfe834ae490`. This was the state at that phase; it is kept as history and is superseded by the 482/482 run recorded above. Evidence: `eval/reports/current/verification.json` plus per-job logs.
- The verifier now also executes: `declarative-demo` (`examples/declarative-demo.mjs`), `core-suite` (`eval/suites/core-v2.jsonl`), `independent-corpus` (`eval/suites/independent-v1/test.jsonl`) and `query-curriculum-v2` (`datasets/query-v2/manifest.json`).
- `node check-datasets.mjs` → six dataset checks PASS (query-v1, pilot-v1, current SQuAD derivative, core-v2, independent-v1, authoring tree).
- Browser checks: 42 wire-help topics, 401 local links/fragments with no broken target; 81 displayed examples parsed as marked, seven intentional parser rejections; desktop and 390-pixel mobile rendering without overflow; the worked constraint example executed to `possible` with `arrival = 42`.

## Runtime behavior made explicit

- **Proof reinforcement is policy-gated.** `sop/runtime.mjs` now requires `policy.reinforce !== false` in addition to the memory retention `reinforceOnUse`, the hypothetical/local/metadata filters, and reports any promotion on the reason packet. Contract regenerated into `sop/contracts/*` and documented in `DS006`, the `reason` help page and `AGENTS.md`.
- **A requested backend is never substituted.** `reasoning/registry.mjs` returns `unsupported` with the requested backend named in `route.backend` and `fallback: null` for: an explicit external backend on a JS-only mode, the reference strategy with an external backend, and an unavailable solver in a supported domain; structural rejections carry `route.backend: 'none'`. Incompatible profiles fail with a clear error. Covered by `tests/routing-policy.test.mjs` (13 passed) and documented in `DS006`.
- **Ambiguous requested scalar ⇒ host clarification.** A `constraint.select` whose value is not unique produces a clarification even when the claim is entailed (`tests/declarative-runtime.test.mjs`, and the displayed help example).

## Corpora and evaluation

- `datasets/query-v1` (62 cases / 198 rows) and its audit tree stayed byte-identical; the new `datasets/query-v2` holds **89 semantic cases / 290 rows** (267 EN, 23 RO; 255 formalization, 35 system) with 33 paired hard negatives and the blocked-family list kept explicit (`DS009`).
- `eval/suites/independent-v1/test.jsonl`: **200 semantic cases / 400 rows** (200 EN + 200 RO), all executed, 20 connected test-only groups with zero split crossing; author recorded as an LLM coding assistant, `not_reviewed` (`DS015`).
- `eval/suites/core-v2.jsonl`: revision-2 export of the authored suite, executed by the verifier; `core-v1.jsonl` retained as superseded.
- Registry and leakage: `tools/eval/registry.mjs` audits before evaluating, refuses an incomplete matrix, and produced a complete **non-model** gold-copy baseline index (dev 35 rows, sealed test 37 rows) while the ordinary model matrix remains blocked on absent predictions (`eval/README.md`, `DS016`).
- Metrics: `eval/metrics.mjs` + `tools/metrics/run.mjs` define one denominator per formalizer/epistemic/reasoning/memory metric; the only observed run is the labeled gold-as-prediction sanity check (`DS016`).
- Engine/reasoner comparisons: 20 bank runs and a deterministic matrix; exact engines reached 48/48 uniform completions while Holo abstained (42/48 at 64 atoms, 28/48 at 256) and all five engines survived retraction, restart, pinned retention and one-snapshot GC reclaim; the Z3×Horn cells remain `unsupported` (`DS013`).
- Solver qualification: 14 reference, 9 SWI, 6 Z3 and 6 routing cells observed with the private binaries, including Z3 returning `unknown`/incomplete instead of a JS fallback (`DS013`).

## Specifications and documentation

- New design specifications (numbered as they were then; `docs/specs/aliases.json` maps them to the current set): case authoring, material sources, solver qualification, local server, engine comparison, source rights, independent corpus, evaluation metrics, skill systems, question-curriculum generator, archived vision documents, small-language scope, research direction and publication, query corpus v2, and four legacy consolidation registers. All 27 rows were registered in `docs/specs/matrix.md`.
- Documentation consolidation: every legacy `.docx` was read in full and its still-valid content consolidated (a vision register now archived under `probably_obsolete/specs/vision/`, DS010, DS005/DS006) before the originals moved to `probably_obsolete/`; the former `docs/legacy/` tree (31 Romanian requirement chapters, index, examples, sources, stale contract snapshots) moved to `probably_obsolete/legacy/` with per-chapter verdicts and a legacy-versus-current contract diff in four consolidation registers (archived on 2026-09-28 under `probably_obsolete/specs/legacy-registers/`). Live citations were mechanically rewritten; empty `vision/`, `article/`, `article/direction/` and `evaluation/` directories were removed.
- User-facing pages updated: `docs/runtime.html` (small-language purpose, worked end-to-end example), `docs/training.html` (rights, authoring, independent corpus, metrics, engine comparison, core-v2), `README.md` (server start, current state), `AGENTS.md` (rules 7–10, reading order, archive pointers).
- `doubts.md` consolidates the ten genuinely unresolved author decisions; the archive index is `probably_obsolete/README.md`.

## Skills

- `material-to-sop`: multi-source TXT/MD/DOCX/PDF/HTML extraction with per-source rights, budgets, byte-exact passage citations and isolated knowledge states; unsupported formats (scanned/encrypted PDFs, RTF, DOCX footnotes/tracked changes, non-UTF-8 HTML) fail closed (`DS011`).
- Four exploration modes with explicit budgets and stop reasons; a one-probe near-exhaustive run correctly reported `incomplete`/`probe_budget`.
- Candidate rules now require a second prepared source plus a non-trigger and a transfer probe; the legacy single-source path was intentionally closed with an explicit message, and five isolated legacy probes pass without approval.
- P2.9 demonstration: a genuinely blank agent (no conversation history) ran the documented procedure and produced the recorded evidence — baseline `unknown` → with-rule `supported` on the positive and transfer quotes, `unknown` abstention on the visitor question, and a rejected proposal missing transfer evidence.
- New skill subsystems: failure classifier, semantic-gap proposer (exceptions preserved, never executed in production) and the authorized implicit-SOP registry with retraction (`DS017`); family-driven question curriculum generator with explicit reasoning gaps (`DS009`).

## Server

`server/http.mjs` provides the local OpenAI-compatible façade over the single `Agent.turn` path: `/v1/models`, `/v1/chat/completions` (non-streaming and SSE of the already-verified result), `/healthz`, `/readyz`; explicit refusals for unimplemented surfaces; explicit `promptProfile` (`bare` for a fine-tuned model, `formal` for base models) with no silent mixing; mandatory bearer auth, localhost binding, request/context/time/concurrency limits, per-principal session isolation and a trace carrying circuit, provenance, backend, fallback, completeness and CNL (`DS012`, `tests/server-http.test.mjs` 6 passed). A real checkpoint-backed smoke remains blocked and `/readyz` reports `model_available: false` until one exists.

## Honest limits

- No neural model was trained, evaluated or served; every metric above is symbolic or a labeled non-model baseline.
- No human or independent review occurred for any corpus; `qualification` stays `not_reviewed` and `review_status` stays `synthetic_unreviewed`/`not_reviewed`.
- Training-dependent gates (P4/P5/P6), external-generator qualification (P1.9) and the research experiments (P9) were not started; the quarantined corpora (QA2D data, ProofWriter, QQP, AmbigQA) were not ingested.



## Earlier phase in the same session — declared boundary cutover

This records the earlier phase, before the full consolidation. Its three follow-up items (U1–U3) were completed afterwards: the pilot artifact executed 700/700 rows, the displayed help examples and the constraint example were validated, and the records were rewritten.

## Implemented and exercised

- [x] **Whitespace atom cutover and recording rename.** `sop/parser.mjs`, grammars, runtime consumers, examples, tests, skills and current generated data use `temperature room_a 21`. The old parenthesized atom spelling is rejected. `remember` replaces the SOP `assert` wire without an alias; programming-language assertions and solver/source syntax are preserved.
- [x] **Actual model/host separation.** `sop/declarative.mjs` and `Runtime.run(..., {origin:'model'})` admit only premise/query/constraint. The host generates inspectable resolution, assumption packs, solves, scalar outputs, CNL and clarification. `server/agent.mjs`, prompts and CLI distinguish authored SOP from execution circuits (`:sop` versus `:circuit`); generated-name collisions are covered.
- [x] **Conditional context, not repository facts.** `premise` accepts holds plus optional validity, without model-authored documentary provenance. The host retains original input and model-interpretation origin across conversation turns. Native smoke demonstrated context-only admission, a conditional answer on a later turn, isolation from another context, and zero implicit repository claims. Trusted remember rejects premise inputs.
- [x] **Constraints and conditional projections.** Model-authored constraints retain domains, variables, comparisons, Boolean groups and objectives. `select` requests checked scalars. Native smoke exercised conditional query → scalar → numeric result 22 with hypothetical provenance preserved. An ambiguous requested scalar produces host clarification even when its claim is entailed; no arbitrary scalar value is created.
- [x] **Host-generated clarification and continuation.** Ambiguous Maria identities produce a concrete candidate question. The packet carries pendingSop, required inputs and answer_clarification for the next turn. Agent tests exercise candidate continuation. Ordinary absence of evidence returns unknown; model-authored clarify and execution operations are rejected.
- [x] **Data/evaluation separation.** Current seed, pilot and query artifacts were regenerated. Formalizer targets and trusted system circuits have separate tracks/exports. Optional/nonunique `finite_many` diagnostics remain system cases with their original oracle, not fabricated scalar answers. Evaluator admission receives the actual question, preserves scoped entity typing, rejects literal fake result packets, and checks lexical leakage across training tracks.
- [x] **Fresh source-reference derivative.** `eval/suites/source-reference-v2-cutover.jsonl` and its independently computed provenance are the current declarative test-only derivative. `tools/verify.mjs` uses that path. The sealed original `source-reference-v2.jsonl` and provenance were not overwritten.
- [x] **Documentation and catalog.** Current specifications, README, wiki, skills and 42-topic wire help document the boundary. Keyword tables cover parser fields; navigation separates the three model declarations from host operations. The generated catalog derives model permissions from MODEL_TYPES. Five residual contradictory host-operation author labels were corrected in expand/link/reason/recall/value help.
- [x] **Completed portions removed from the backlog.** The generated case-Markdown audit view and drift check exist; Markdown-as-authoring-source remains deferred. The parser/grammar/prompt/catalog part of P0.6 is complete; broader routing/reinforcement qualification remains deferred. P8.5 mixed query → scalar → constraint → output/CNL behavior is exercised by runtime regressions and native smoke and is no longer an open implementation item.

## Observed verification and limits (superseded by the final run above)

- The final state is the 455/455 test and 25/25 check run recorded at the top of this file; the 394/394 figure belonged to the intermediate cutover run and is kept only as history.
- Pilot artifact: `node tools/datasets/validate.mjs --manifest datasets/pilot-v1/manifest.json --execute` executed 700/700 rows, `verified_against_runtime`, `qualification: not_reviewed`.
- Help examples: the final crawl checked 42 topics and 401 local links/fragments with no broken target; 81 displayed examples parsed as marked with seven intentional parser rejections; the displayed constraint example executed to `possible` with `arrival = 42` and a bound output.
- No neural model inference, optimizer step, fine-tuning or training was run. Training dry-run jobs inspect configuration only. Generated corpus checks do not establish human review, training qualification, tokenizer equivalence, or model accuracy.
- Documentation services and managed browser tabs were stopped; the session's temporary smoke files were removed.

## Earlier delivery history — not the current verification snapshot

# PAS_TASK.md — ce s-a livrat, cu dovezi

- 2026-09-28: un singur limbaj pentru modelul mic (fără profiluri `sop-agent-3`/`sop-agent-4`, fără firul `premise`, fără prompt CONTEXT); testele pe corpusurile vechi sunt sărite până la regenerare (vezi TODO.md).

Data de referință: 2026-09-27. Acest fișier arhivează lucrarea **finalizată** și observațiile ei. Doar sarcinile deschise/blocate rămân în [TODO.md](TODO.md). `[x]` aici înseamnă executat real, cu artefact și comandă/scenariu observat; nu reprezintă calificare de training și nici aprobare de optimizer.

## Status la arhivare

- **Historical verification at that delivery:** 359/359 tests, 20/20 checks and 140 reasoning-matrix executions, with private Z3 4.15.8 and SWI 9.0.4 explicitly selected. Historical fingerprint: `8cd054b02dc04b7cf82a15a60e99d8277545ec5e3667da14058102ba7c16e305`. The current verification report has since been superseded by the completed cutover run recorded above.
- **Date:** 62 cazuri / 198 rânduri (105/44/49; RO 6/2/4) + 16 cazuri / 49 suprafețe SQuAD sigilate. Inventar 35 fire; țintele emit 11 tipuri; corpus necalificat pentru training.
- **Structură:** cod de date în `tools/datasets/`; cache raw la `datasets_sources/`; `datasets/` doar artefacte de date.
- **Profil ML:** fără instrucțiuni (`barePrompt` = CONTEXT + MESSAGE); audit Qwen max. 383/502, medie ≈300, identic nativ/Podman.
- **Limite:** zero review uman; QA2D/ProofWriter în carantină; referințe sub ținta 200 EN + 200 RO (ținta a fost atinsă ulterior de `eval/suites/independent-v1/test.jsonl`: 200 EN + 200 RO, nerevizuite uman); training interzis până la OK nou.

## PR — refactorizarea structurală (închisă)

- [x] PR.1. Implementări în `memory/`, `reasoning/`, `sop/`, utilitare în `lib/`; `server/` consumă modulele. **Dovadă:** demo cu șapte scenarii + suita Node portată.
- [x] PR.2. Separare `config/`, `knowledge/`, `tools/`, `tests/`, `examples/`, `datasets/`, `eval/`, `training/`; rapoarte istorice în `eval/reports/history/`, texte-sursă în `probably_obsolete/legacy/`.
- [x] PR.3. Python eliminat din `server/`; cele șapte module ML în `training/python/`, justificate în `dependencies.md`. **Dovadă:** preflight CUDA nativ executat.
- [x] PR.4. Baze în `models/<model>/bases/<revision>/`, rulări în `models/<model>/<run>/<role>/`. **Dovadă:** dry-run Qwen.
- [x] PR.5. `AGENTS.md`, README și documentația GAMP consolidate. **Dovadă:** DS000–DS009 + matrice; 15 pagini randate în browser fără erori JS (probă din `documentation-browser-check.json`).
- [x] PR.6. Verificare structurală înaintea pilotului. **Dovadă:** suita de teste + demo-uri; launcherul refuză lock existent și disk floor imposibil.

**GPR:** comportamentul păstrat prin execuție reală; lipsa mediului ML este blocaj de training, nu motiv de fabricare de rezultate.

## Date, evaluare și skilluri (închis)

- Pilotul `datasets/pilot-v1/`: 600 cazuri / 700 rânduri (490/105/105); test separat în `eval/suites/pilot-v1/`; toate rândurile verificate executiv (`node tools/datasets/validate.mjs --manifest datasets/pilot-v1/manifest.json --execute`).
- Curriculumul `datasets/query-v1/` + `datasets/query-profile.json`: 60 cazuri / 192 rânduri, trei suprafețe EN/caz, 12 ancore RO (6/2/4), matrice completă; review LLM inițial + corecțiile principalului în `eval/reports/current/principal-data-review.json`. Cele două suprafețe RO noi din dev au doar review-ul principalului.
- Referința sursă `eval/suites/source-reference-v2.jsonl`: 16 cazuri / 49 suprafețe SQuAD v2, CC-BY-SA-4.0, sigilată, exclusă din training/selection; v1 + review-ul ei arhivate în `eval/reports/history/data-review/` după corectarea parafrazei de numire și a jurământului.
- Evaluatorul `eval/run.mjs` + `eval/contracts.mjs` + `eval/suites/core.mjs`: self-check cu circuit gold, semantic greșit, invalid, UNKNOWN corect (`evaluator-self-check.json`); nu s-a evaluat un model.
- Skillul `skills/material-to-sop/`: flux complet exercitat din alt cwd; probe supported/unknown/unknown; refuzuri pentru lipsa probelor, DEFAULT, lipsa autorizării, binare, republicare după retractare (`ingestion-self-check.json`).
- Skillul `skills/semantic-sop-review/`: prepare → review LLM real → receipt → decizie integrator, executat din `/tmp`; patru lumi discriminante, verdict automat `pending`, acceptare limitată. Bundle `40b9d7f1e95501c8e3155f473899757db7230bdefaad1c400f50d71c6d539bc6`. Identitatea backend-ului LLM nu e verificată independent; nu e review uman.
- `resolve`: lexicon host, limbă, kind, tip/domeniu, rezoluție unică; ambiguitatea/absența blochează dependenții; head-uri de predicate doar canonice literale.
- `eval/reports/current/review-readiness.json` indexează toate dovezile (24 artefacte, hashuri verificate).

## Defecte reproduse și corectate

- Pachet de răspuns fabricat acceptat fără reasoning; acum `cnl` refuză valori non-runtime, iar terminalul conversațional respinge imitațiile literale (`packet-origin-smoke.json`).
- Context omis din exportul ML: proiecția e recomputată de validator; ulterior înlocuită complet de profilul fără instrucțiuni.
- Marker ipotetic pierdut în adaptorul SWI (reprodus pe SWI real: JS `true` vs SWI `false`); corectat și probat (`horn-conditionality-before-fix.json` → `horn-conditionality-smoke.json`).
- Holdout-uri supraestimate relabelate; novelitatea compozițională re-fingerprint-uită; ancore RO redistribuite (dev nu a rămas fără RO).
- Solutii native private Z3/SWI instalate cu hashuri/licențe fixate în `tools/.solvers/`; `check-solvers.mjs`, `verify.mjs` și testele respectă `Z3_BIN`/`SWIPL_BIN`; #nume și traversal-ul tools ajustate.

## Podman / GPU (infrastructură, închis)

- Mediu nativ găsit fără modificare: Torch 2.14.0+cu130, CUDA 13.0, Transformers 5.17.0, PEFT 0.21.0, Accelerate 1.15.0.
- Preflight nativ: GB10, capability 12.1, BF16 forward/backward passed.
- Imagine ARM64 construită: digest `sha256:9c1dd2ab8101bc85d861e9952b6555ee43546a5562f27d312e8c46249ffc4383`; `spark-preflight-1` exit 0, fără OOM; cgroup CPU 6 / RAM 32 GiB / swap 0 / pids 256 / shm 1 GiB.
- `spark-stop-probe-1`: refuzul jobului concurent, stop exclusiv al containerului propriu, `operator_requested` persistat, lock propriu eliminat, memorie CUDA liberă observată; fără cache-squeeze sau kill global.
- `spark-token-audit-1/2/3`: audit tokenizer nativ și în container, măsurători identice; pe profilul final 99 train/44 dev, max. 383/502, fără weights încărcate.
- Cele șapte scripturi cu cache-squeeze/kill-pe-pattern au fost retrase; metodologia utilă păstrată în skilluri.

## Faze de plan marcate executate

- P0.3 — baseline reproductibil separat de rapoartele istorice (comanda + fingerprint în TODO-ul istoric; acum `8cd054b0…`).
- P0.7 — definiția aprobată recuperată în contextul Agent și executată: `expand` → extragere pachet → `cnl` verificat, endpoint controlat.
- P1.10 — suprafețe EN/caz + ancore RO 20% (6/2/4) cu ținta canonică păstrată.
- P1.12 — canonizare conservatoare + guard-uri + oracole finite/graph + lumile discriminante; 192 ținte query + 49 ținte sursă trecute.
- P1.13 — matricea de coverage cu numărători pe familie/limbă/input mode/oracle/fire; holdout-urile verificate, categoriile neverificate marcate.
- P3.8 — self-check evaluator: gold vs semantic greșit vs invalid vs UNKNOWN corect.
- P3.9 — runnerul corectat (policy/backend, guard-uri Agent, erori separate pe etape, latențe distincte).
- P4.2 — mount-urile exercitate nativ + Podman pe același corpus.
- P4.3 — lock atomic comun nativ/Podman (owner PID/token/CID); refuz concurență și stop propriu observate.

## Decizii de proiect consemnate

- Restructurare la cererea utilizatorului: `tools/datasets/` pentru cod, `datasets_sources/` pentru cache raw, `datasets/` doar date; ținta de autorat rămâne Markdown per caz + JSONL compilat (P1.1).
- Profil ML fără instrucțiuni la cererea utilizatorului: `barePrompt` pentru SFT; instrucțiuni doar în `server/prompts/formalizer.txt` (servire base); servire consecventă cerută în TODO P7.0.
- AGENTS.md redus la nivel înalt (direcție, ordine de lectură, căi); regulile normative mutat în DS-uri: autoritatea host/untrusted inputs în DS004, excludența single-GPU-worker și controllerul unic în DS007, politica generatorilor (Luna) în DS009.
- Pipeline de audit manual implementat: `datasets/cases/` (60 fișiere MD generate, unul per caz) + `build-cases-md.mjs` (regenerare/`--check`) + guard de drift în validator (`cases_md.tree_sha256`) + job `cases-md` în `tools/verify.mjs` + stub high-level `check-datasets.mjs` la rădăcină + `eval/README.md`.
- DS009 adâncit conform metodologiei casei: contracte pe cele 11 fire emise (câmpuri cerute din `sop/contracts/wires.json`), pipeline de autorat/compilare, limite de acoperire declarate.

- `knowledge/` de la rădăcină a fost eliminat ca ne-generic la cererea utilizatorului: `bootstrap.sop` și `reasoning-procedures.sop` trăiesc acum în `tests/fixtures/`; consumatori actualizați (CLI `init`, demo-uri, teste, generatoare); îndrumar în `AGENTS.md`. Verificare: 21/21 verificări, 359/359 teste, demo + `init` rulate.

## Presupuneri defectibile (implementat la cererea utilizatorului)

- Reasoner-ul JS: `admissibleAssumptions` — o presupunere e folosită doar dacă niciun fapt admis (sau derivat din reguli) nu susține contrariul explicit al atomului; `hypothetical: true` apare **doar** dacă dovada răspunsului atinge o presupunere păstrată; `defeatedAssumptions` e raportat pentru audit.
- Adaptorul SWI: același filtru înainte de compilarea programului, cu verificarea de acord de închidere păstrată; ambele rute dau același răspuns și același marker (6 teste noi, `tests/assumptions.test.mjs`).
- Runtime: un fapt cu `source assumption` este acceptat numai dacă e consumat de un câmp `assume`; guardul de proveniență nu se aplică acelor fapte, iar ele nu se publică, nu se salvează și nu se întăresc.
- Corpus: familie nouă `assumption_boundary` — 2 cazuri / 6 rânduri (train): presupunere păstrată → `supported` cu `hypothetical: true`; presupunere înfrântă de un fapt negativ explicit → `unknown`. Șablonul aprobat `check_arrival` a fost inline-uit în `cases.mjs` (nu mai depinde de fixture).
- Contract în DS004 ("Assumptions and defeat"), DS006 (paritate între rute), DS009 (familie în matrice + limite declarate).
- Total: 62 cazuri / 198 rânduri (105/44/49); audit Qwen 105/44, max. 383/502, identic nativ/Podman; 366/366 teste, 21/21 verificări.

## Context-free model surface `sop-agent-4` (2026-09-28, delivered on owner request)

- Model surface `stated`, `assumed`, `unclear`, `query` (string `match` blocks), `constraint` (`task` required); `premise` retired from the model surface and kept for trusted circuits and explicitly selected legacy `sop-agent-3` evaluation (DS021, DS004; `sop/declarative.mjs` `MODEL_PROFILES`).
- The formalizer prompt is exactly the user's message (`barePrompt` default `sop-agent-4`; `formalPrompt` = instructions + MESSAGE); host linking of relation phrases, the closed role inventory, entity strings and temporal expressions (`sop/linking.mjs`), with host `clarify` on unknown or ambiguous links.
- Semantics: asserted statements as turn-local user evidence carried in caller-owned context; hedged, supposed and reported statements conditional; model assumptions reported, or branched under `policy.modelAssumptions: 'branch'`; `unclear` (`gibberish`, `no_request`) with EN/RO host replies; no model refusal (`not_computable`).
- Strict ontology SPEC; `predicate.role NAME TYPE` over the closed inventory; `allowJsEval` removed; `cnl.language` defaults to `en`; chat API/page `language` selection and a deterministic in-message request detector; HTTP trace fields; eval admission per row profile with stated/assumed separation and `basis` metrics (`eval/propositions.mjs`).
- Evidence: `npm test` all passing (count in the final verification of the change); new `tests/stated-assumed.test.mjs`, agent and HTTP end-to-end tests with a mock formalizer, executed wire help with `field-<keyword>` anchors; `node tools/verify-vocabulary.mjs --scope docs|examples` pass. No training, no GPU work, no dataset changes.

## Inventarul istoric (arhivat)

Snapshot-ul dinaintea PR — căile și stările vechi — este păstrat în istoricul git și în `probably_obsolete/legacy/`; secțiunile „Inventarul inițial”, „Dovezi și limite la pornire”, „Discrepanțe de rezolvat” și „Harta reutilizării tooling-ului” din vechiul TODO au fost consolidate în dovezile de mai sus și în rapoartele din `eval/reports/`. Discrepanțele rămase active sunt reformulate ca sarcini deschise în [TODO.md](TODO.md) (P0.1/P0.2/P0.6, P1.2–P1.9, P4.4–P4.6).
