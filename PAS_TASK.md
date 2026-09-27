# Latest completed work — declarative SOP cutover

This section records work already implemented before the user requested a stop. Continue only with U1–U3 at the top of `TODO.md`; do not reopen these completed tasks or start the deferred roadmap.

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

## Observed verification and limits

- The final verification command was already running when the user requested a stop. A cancellation was attempted, but the tool reported that it had completed successfully: **394/394 tests, zero skipped, 21/21 checks passed**. No new verification command was started after the stop request.
- Command: `Z3_BIN="$PWD/tools/.solvers/z3/bin/z3" SWIPL_BIN="$PWD/tools/.solvers/swi/swipl" node tools/verify.mjs`. Evidence: `eval/reports/current/verification.json` and its job logs. Source fingerprint: `a511a593b7353e239ffad9aa488754b91d9788398ba37e70cb57ee6c1fe763cd`; Node v22.23.2, Linux ARM64.
- Focused integration run: `node --test tests/eval-runner.test.mjs tests/dataset-pilot.test.mjs tests/query-curriculum.test.mjs tests/declarative-runtime.test.mjs` passed 24/24 before the final full run.
- Browser smoke observed desktop and 390-pixel mobile navigation, no outer/iframe page overflow, and the constraint keyword table. The final help crawl checked 42 topics and 401 local links/fragments with no broken targets. Earlier native help validation passed 81 valid examples, seven intentional parse rejections, and keyword-table coverage. After the last example/author-label edits, browser inputs were refreshed but the final native example-validation invocation was not run; this is U1, not a claimed completed check.
- The rebuilt pilot's full artifact execution is still U2; selected-world pilot tests passed, but the full verifier does not include that separate pilot-manifest job.
- No neural model inference, optimizer step, fine-tuning or training was run. Training dry-run jobs inspect configuration only. Generated corpus checks do not establish human review, training qualification, tokenizer equivalence, or model accuracy.
- Documentation services and managed browser tabs were stopped/closed. The four explicitly named temporary smoke files remain for U1/U3; no unrelated cleanup is authorized.

## Earlier delivery history — not the current verification snapshot

# PAS_TASK.md — ce s-a livrat, cu dovezi

Data de referință: 2026-09-27. Acest fișier arhivează lucrarea **finalizată** și observațiile ei. Doar sarcinile deschise/blocate rămân în [TODO.md](TODO.md). `[x]` aici înseamnă executat real, cu artefact și comandă/scenariu observat; nu reprezintă calificare de training și nici aprobare de optimizer.

## Status la arhivare

- **Historical verification at that delivery:** 359/359 tests, 20/20 checks and 140 reasoning-matrix executions, with private Z3 4.15.8 and SWI 9.0.4 explicitly selected. Historical fingerprint: `8cd054b02dc04b7cf82a15a60e99d8277545ec5e3667da14058102ba7c16e305`. The current verification report has since been superseded by the completed cutover run recorded above.
- **Date:** 62 cazuri / 198 rânduri (105/44/49; RO 6/2/4) + 16 cazuri / 49 suprafețe SQuAD sigilate. Inventar 35 fire; țintele emit 11 tipuri; corpus necalificat pentru training.
- **Structură:** cod de date în `tools/datasets/`; cache raw la `datasets_sources/`; `datasets/` doar artefacte de date.
- **Profil ML:** fără instrucțiuni (`barePrompt` = CONTEXT + MESSAGE); audit Qwen max. 383/502, medie ≈300, identic nativ/Podman.
- **Limite:** zero review uman; QA2D/ProofWriter în carantină; referințe sub ținta 200 EN + 200 RO; training interzis până la OK nou.

## PR — refactorizarea structurală (închisă)

- [x] PR.1. Implementări în `memory/`, `reasoning/`, `sop/`, utilitare în `lib/`; `server/` consumă modulele. **Dovadă:** demo cu șapte scenarii + suita Node portată.
- [x] PR.2. Separare `config/`, `knowledge/`, `tools/`, `tests/`, `examples/`, `datasets/`, `eval/`, `training/`; rapoarte istorice în `eval/reports/history/`, texte-sursă în `docs/legacy/`.
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

## Inventarul istoric (arhivat)

Snapshot-ul dinaintea PR — căile și stările vechi — este păstrat în istoricul git și în `docs/legacy/`; secțiunile „Inventarul inițial”, „Dovezi și limite la pornire”, „Discrepanțe de rezolvat” și „Harta reutilizării tooling-ului” din vechiul TODO au fost consolidate în dovezile de mai sus și în rapoartele din `eval/reports/`. Discrepanțele rămase active sunt reformulate ca sarcini deschise în [TODO.md](TODO.md) (P0.1/P0.2/P0.6, P1.2–P1.9, P4.4–P4.6).
