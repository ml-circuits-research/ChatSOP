# URGENT HANDOFF — EXECUTE ONLY U1–U3, THEN STOP

**Scope restriction:** The user stopped the implementation session. Work only on the three urgent closeout tasks below, in order. Do not start any deferred P0–P10 task, redesign the language, add features, launch agents for broader work, or train/run a neural model. After U1–U3, record the evidence in `PAS_TASK.md`, remove the completed urgent entries here, and stop. A remaining historical backlog item is not authorization to execute it.

## Fixed decisions — do not reopen

- Small-model output consists only of `premise`, `query`, and `constraint`. `Runtime.run(source, {origin:'model', inputText, language, context})` in `sop/runtime.mjs` delegates to `sop/declarative.mjs`; trusted host orchestration generates execution operations.
- Atom spelling is `temperature room_a 21`, not `temperature(room_a, 21)`. The trusted recording wire is `remember`; no SOP `assert` alias. Do not change JavaScript assertions, Prolog/SMT syntax, original quotations, or sealed historical artifacts.
- `premise` is a conditional model interpretation retained in conversation context, not a sourced `fact` and not an implicit repository write. Host-generated `clarify` carries `pendingSop`, `required`, and `next: answer_clarification`; missing evidence alone remains `unknown`.
- `constraint.select ?x` requests a checked scalar. If it is ambiguous, request clarification even when the claim is entailed. The historical `finite_many` optional/nonunique-output diagnostic remains a full circuit on the `system` evaluation track; do not change its oracle to force it into model training.
- Formalizer examples contain only the three model declarations. Trusted full circuits remain in separate system exports. `eval/suites/source-reference-v2.jsonl` and its provenance are historical and must not be overwritten; current verification uses `source-reference-v2-cutover.jsonl`.

## Urgent remaining work

- [ ] **U1 — Finish the last documentation-example check, not another implementation pass.**
  1. Read `docs/wire_typs/constraint.html`, `sop/declarative.mjs`, and `tests/declarative-runtime.test.mjs`. The first constraint example was changed after the earlier example-parser smoke: it now ends with `select ?arrival` and contains no authored solve.
  2. If the handoff temporary files still exist, run `node /tmp/chatsop-help-cutover.mjs`. It reads `/tmp/chatsop-help-cutover.json`, checks the displayed valid/invalid examples, and compares keyword tables with `SPEC`. The JSON was refreshed from the final browser pages, but this final invocation was not run before the stop request. If absent, collect the examples from `docs/wire_types.html` and its linked pages using DOM text content; include `pre[data-sop="current"]`, `pre[data-sop="model"]`, and parser-rejection examples with `data-check="parse"`. Do not parse HTML entity spellings as SOP.
  3. Execute the first constraint example through the actual `Runtime` with `origin:'model'`. `/tmp/chatsop-constraint-example.sop` contains the browser-extracted source if it still exists. Expected: `result.packet.status === 'possible'`, `values.arrival === 42`, and `outputs.arrival.status === 'bound'`; authored input has only a constraint, generated execution contains solve/output/CNL.
  4. Acceptance: current displayed examples parse as marked, every runtime field is described, and the displayed numeric example produces 42. Earlier browser evidence already covers desktop/mobile navigation and no page overflow; do not repeat a broad visual audit unless you change layout.

- [ ] **U2 — Validate the rebuilt pilot artifact once and keep the training boundary intact.**
  1. Run `node tools/datasets/validate.mjs --manifest datasets/pilot-v1/manifest.json --execute`. The final full verifier passed, but its job list validates the query curriculum and source reference, not the entire rebuilt pilot; pilot unit tests exercised selected worlds.
  2. Inspect `datasets/pilot-v1/manifest.json` and the manifests under `datasets/query-v1/` and `datasets/seed/`. Check their actual formalizer exports with `parse` from `sop/parser.mjs`: every target wire must be premise/query/constraint. System exports must remain separate, not silently removed or merged into formalizer targets. Existing generators and validators are the authority; do not invent new projections.
  3. If an actual failure appears, read its specific case and fix its source/validator. Sources are `tools/datasets/build-pilot.mjs`, `tools/datasets/build-curriculum.mjs`, and `tools/datasets/curriculum/cases.mjs`; `datasets/cases/*.md` are generated audit views, not authoring sources. Do not change an independent expected answer merely to match execution.
  4. Regenerate only an affected artifact: pilot command `node tools/datasets/build-pilot.mjs --out datasets/pilot-v1 --eval-out eval/suites/pilot-v1`; curriculum command `node tools/datasets/build-curriculum.mjs --out datasets/query-v1 --eval-out eval/suites/query-v1`. If implementation changes are needed, run the affected tests first, then the full verification command below once after the final edit.
  5. Acceptance: executable pilot passes, formalizer targets respect the three-type boundary, and system cases retain their coverage. This is symbolic validation, not semantic review, training qualification, or model evaluation.

- [ ] **U3 — Close the handoff records and remove only this session's temporary scaffolding.**
  1. Check the current-vs-historical wording in `eval/README.md` and `docs/specs/DS009-query-curriculum.md` against rebuilt manifests. They retain historical pilot/full-circuit descriptions; make it unambiguous which are historical and which paths now hold declarative/system-separated derivatives. Preserve historical numbers as historical; do not reuse old reviews/tokenizer measurements for changed bytes.
  2. Put U1/U2 commands, observed results, and any remaining limitation in `PAS_TASK.md`; remove finished urgent items here. Preserve the latest verified fingerprint unless code/data changes require a new run. Do not mark the deferred research/training backlog complete.
  3. Remove only these owned temporary files if present: `/tmp/chatsop-declarative-smoke.mjs`, `/tmp/chatsop-help-cutover.mjs`, `/tmp/chatsop-help-cutover.json`, `/tmp/chatsop-constraint-example.sop`. Do not delete unrelated files or user edits. Documentation services and browser tabs were already stopped/closed.
  4. Stop and report the urgent closeout outcome. No automatic move to P0, data scaling, training, API development, or publication work.

## Already completed — do not redo

Implementation, migrated examples/tests, regenerated current corpora, model/host separation, keyword documentation, and observed smoke results are recorded at the top of `PAS_TASK.md`. Final verification completed from the already-running job during the stop request: **394/394 tests, 21/21 checks passed**, no skips, no neural inference or training. Fingerprint: `a511a593b7353e239ffad9aa488754b91d9788398ba37e70cb57ee6c1fe763cd`.

```sh
Z3_BIN="$PWD/tools/.solvers/z3/bin/z3" \
SWIPL_BIN="$PWD/tools/.solvers/swi/swipl" \
node tools/verify.mjs
```

Evidence: `eval/reports/current/verification.json` and its per-job logs. Do not rerun this merely to confirm the reported success; rerun only after a relevant implementation/data change.

## DEFERRED BACKLOG — NOT AUTHORIZED IN THIS HANDOFF

# ChatSOP — sarcini deschise și porți de acceptare

Data de referință: 2026-09-27. Direcție: [AGENTS.md](AGENTS.md). Ce s-a livrat, cu dovezi: [PAS_TASK.md](PAS_TASK.md).

**Regulă de progres:** `[ ]` înseamnă neexecutat sau incomplet. La închidere mută intrarea în `PAS_TASK.md` cu artefact + comandă/scenariu observat. O poartă nereușită blochează dependenții, nu este ocolită.

**Interdicție explicită actuală:** niciun training, fine-tuning, resume sau smoke cu optimizer până la un **OK nou al utilizatorului**, chiar dacă infrastructura trece. Calificarea datasetului și aprobarea utilizatorului sunt porți separate; nu se fabrică receipts de aprobare. Pregătirea, tokenizarea, evaluarea simbolică și probele CUDA de infrastructură fără optimizer sunt permise.

**Current verification:** 394/394 tests and 21/21 checks passed; see the urgent handoff and `PAS_TASK.md` above for the command, fingerprint, and evidence limits. Earlier 359-test figures belong to the historical delivery record.

## Mediul GPU — restanțe

- [ ] **BLOCAT de interdicția de training:** smoke cu optimizer, checkpoint complet, salvare/reload și resume comparat cu o rulare de referință. Stop-ul de infrastructură nu califică aceste mecanisme și nici siguranța sub presiune reală; `memory.max` nu plafonează universal alocările CUDA.

## P0 — Contractele comune (restante)

- [ ] P0.1. Definește contractele comune: profil SOP, schema semantic-case, pachetul rezultat/epistemic, capabilities reasoning/memory, identitatea experimentului și modelului. **Acceptare:** exemple pozitive/negative pentru fiecare frontieră; niciun status nu pierde contradicția, ipoteza sau incompletitudinea.
- [ ] P0.2. Fixează maparea `supported/refuted/both/unknown`, `possible/entailed` și rezultate exploratorii la vocabulary-ul din vision. **Acceptare:** tabel de decizie și scenarii executabile, inclusiv default cu excepție și lipsă de suport; extensiile neimplementate sunt `unsupported`, nu reguli tari.
- [ ] P0.4. Verifică importul skillurilor din `.agents/`, căile portate și încărcarea `AGENTS.md`; păstrează o singură autoritate pentru regulile proiectului. **Acceptare:** un agent nou găsește sursele și lucrează fără contextul conversației.
- [ ] P0.5. Preregistrează ipotezele, bugetele, split-urile și criteriile de promovare. **Acceptare:** fiecare experiment are o singură schimbare principală, comparator și condiție de infirmare.
- [ ] P0.6. Remaining: qualify and document the strategy×backend×domain matrix, distinguish the two `hybrid` meanings, and verify read-only/reinforcement policy. Parser/grammar/prompt/catalog alignment for whitespace atoms and the three-declaration model boundary is completed and recorded in `PAS_TASK.md`. **Acceptance:** no hidden routing or read side effect. Deferred; do not execute in this handoff.

**G0:** contracte comune închise. Nu lansăm generare mare înainte de G0.

## P1 — Pipeline NL → SOP (restante)

### Autorat și structură

- [ ] P1.1. Remaining: implement a compiler that treats manually edited case Markdown as the authoring source. Currently `tools/datasets/curriculum/cases.mjs` is authoritative; Markdown is a generated audit view. **Acceptance:** editing a case Markdown file deterministically rebuilds JSONL and revalidates its oracle without bypassing semantic review. The completed audit-view generator and drift check are recorded in `PAS_TASK.md`. Deferred; do not execute in this handoff.
- [ ] P1.2. Schema minimă per exemplu: `semantic_case_id`, `source`, `context_assertions`, `question`, `language`, `surface_group_id`, `sop_target`, `semantic_status`, `negative_of`, `generation_trace`, `quality_flags`, `split_key` + profil/hash parser+prompt+ontologie. **Acceptare:** schema respinge cazurile fără proveniență; parse pass nu e review semantic.
- [ ] P1.3. Fixează inventarul familiilor/operatorilor și compozițiile rezervate înainte de randare; split pe grupuri semantice conectate. **Acceptare:** zero grupuri care traversează train/dev/test.
- [ ] P1.4. O singură autoritate pentru test: răspunsurile sigilate în `eval/`; `datasets/splits/` păstrează doar manifest/checksum. **Acceptare:** generatorul și selecția checkpoint nu citesc răspunsurile de test.

### Achiziție, conversie, scalare

- [ ] P1.5. Verifică termenii și versiunea surselor QA2D, ProofWriter, QQP, PAWS/PAWS-X, AmbigQA/AmbigNQ; corpus RO numai cu drepturi clare. **Acceptare:** tabel de utilizare și redistribuire.
- [ ] P1.6. Convertește QA2D în propoziție/query și ProofWriter în fapte/reguli/query, păstrând proof/depth/truth. QQP → echivalență, PAWS → contraste. **Acceptare:** probe independente confirmă conservarea sensului; structura neacceptată în carantină.
- [ ] P1.7. Adaptează seed-ul istoric și generatoarele din `tools/datasets/` la schema `tools/datasets/schema.mjs`. **Acceptare:** gold executabil; ținta nu primește cunoașterea de test.
- [ ] P1.8. Pilot de ~500–1.000 cazuri distincte, stratificat pe constructe și riscuri. **Acceptare:** familii cu referințe, întrebări, ținte și negative; numărul final consemnat.
- [ ] P1.9. Califică un generator ieftin (Luna sau altul) pe pilot revizuit independent; cost per exemplu **acceptat**. **Acceptare:** model efectiv identificat; familiile slabe escaladate; Luna nu e arbitru final.
- [ ] P1.11. Extinde hard negatives: cuantificatori, scope, comparație, direcția condiției, entity binding + ambiguitate/contradicție/unsupported. **Acceptare:** contrastele au altă semantică, nu doar alt text.

**G1:** pilot reproductibil, fără leakage, echivalență verificată, cost cunoscut. Un parser care acceptă 100% nu închide G1.

## P2 — Skill material → circuite (restante)

- [ ] P2.1. Completează `skills/material-to-sop/` multi-sursă (TXT/MD/DOCX, apoi PDF/HTML), cu drepturi, scope, buget; experimentul complet multi-sursă rămâne separat de fluxul local deja exercitat.
- [ ] P2.2. Adaptoare de format cu segmentare stabilă, pagină/paragraf/offset și citate verificabile în pasajul original.
- [ ] P2.3. Separă `datasets/knowledge/source/`, `implicit/` și starea temporară; doar cunoașterea acceptată ajunge la biblioteca runtime.
- [ ] P2.4. Question Curriculum Generator cu familiile din vision; lipsa unui interpreter devine reasoning gap declarat.
- [ ] P2.5. Failure Classifier: source gap / semantic gap / reasoning gap / ambiguity / over-inference, cu dovezi și componenta de reparat.
- [ ] P2.6. Semantic Gap Resolver: micro-teorii candidate cu scope, HARD/DEFAULT/PLAUSIBLE, premise, excepții, provenance; nu se execută în producție.
- [ ] P2.7. Implicit SOP Registry: deduplicare semantică, versiuni, candidate/accepted/rejected/retracted, promovare autorizată, rollback demonstrat.
- [ ] P2.8. Per regulă: pozitive + negative + limite + întrebări diferite de trigger; reuse pe altă sursă înainte de afirmații de generalitate.
- [ ] P2.9. Demonstrează skillul cu agent fără istoric pe ≥2 materiale + a 3-a sursă pentru transfer; cel puțin un semantic gap real, un caz respins, o abținere justificată.
- [ ] P2.10. Instrumentează Focused / Broad bounded / Adaptive / Near-exhaustive cu bugete și stop explicite.

**G2:** skillul produce cunoaștere verificată de alt agent, nu răspunsuri memorate.

## P3 — Evaluare (restante)

- [ ] P3.1. `eval/` cu registry de experimente, manifeste, predicții; fără două definiții ale aceleiași metrici.
- [ ] P3.2. Separarea dev/selection de test sigilat + raport leakage înaintea rulărilor.
- [ ] P3.3. Minimum 200 cazuri independente EN + 200 RO, cu autor consemnat; fără etichetă „human gold” pe lot generat și autojudecat.
- [ ] P3.4. Metrici formalizer: parse rate, canon/AST, execution equivalence, corectitudine, alegerea simbolurilor, invarianță la parafrază, discriminare hard-negative, abstain, transfer EN→RO; eșecurile atribuite etapei.
- [ ] P3.5. Metrici epistemice: UNKNOWN calibration, contradicții, over-inference, proveniență, retractări, scrieri neautorizate; abținerea corectă nu e eșec, `both` nu se pierde.
- [ ] P3.6. Metrici reasoning/memorie: soundness, coverage, precision/recall retrieval, bugete, traseu efectiv, latențe pe etape, peak RAM/CUDA.
- [ ] P3.7. Runnerul fixează surse/model/data/profile/library/config/seeds/backend/hardware; incertitudine la nivel de caz/sursă, nu parafraze.
- [ ] P3.10. Fingerprint-uri și indexare de run-uri pe structura nouă; celule lipsă opresc raportul final.

**G3:** evaluarea respinge un model care emite SOP valid dar greșit; testul nu e expus generatorului/selecției.

## P4 — Training safe pe DGX Spark (restante)

- [ ] P4.1. Calificarea completă a imaginii și a regimului ML real (SDPA, torch CUDA în container, nu wheel generic); baza Qwen descărcată, dar neantrenată.
- [ ] P4.4. Health/stall/disk guard corelate cu procesele și artefactele proprii; bugete reale checkpoint/download/merge; refuzurile sigure înainte de orice alocare GPU.
- [ ] P4.5. Checkpoint complet + resume compatibil (weights/adaptor, optimizer, scheduler, pas/epoch, RNG, fingerprinturi); scriere atomică + manifest de completitudine; reluare comparată cu referința.
- [ ] P4.6. Headroom memorie unificată calificat sub presiune reală; preflight refuză sub floor sau la imposibilitatea măsurării, fără restart loop ori presupuneri din N/A.
- [ ] P4.7. Stop/alertă pentru OOM, loss nefinit, lipsă progres, disk, temperatură; oprire și diagnostic persistente, fără retry nelimitat.
- [ ] P4.8. Finalizare doar cu manifest + metrici valide ale run_id-ului curent; fail-chain nu este raportat „finished successfully”.

**G4:** exclusivitate, checkpoint/resume și oprire sigură exercitate pe modelul real. Trainingul rămâne interzis fără OK nou.

## P5 — Dataset v1 înghețat (restante)

- [ ] P5.1. Extindere pe baza acoperirii și erorilor (reper vision: 20k–50k cazuri, 100k–300k rânduri) — intervale de proiectare, nu criterii suficiente.
- [ ] P5.2. Pipeline complet + carantină + review stratificat; zero erori structurale în export; familii riscante cu oracle/probe adecvate.
- [ ] P5.3. Îngheț train/dev/holdout/parser/prompt/ontologie/library + manifest/checksum/VERSION + rapoarte leakage/coverage/licențe/tokens; rebuild-ul reproduce artefactele deterministe.
- [ ] P5.4. Identitatea fiecărui experiment: ipoteză, bază, date/version, recipe, seeds, timestamp, limite — lansabilă de un operator fără ghicire.

**G5:** dataset utilizabil, legal, înghețat; G1–G4 trecute. Volumul nu se mărește în timpul unui run.

## P6 — Model mic antrenat și calificat (restante)

- [ ] P6.1. Compararea bazelor (Gemma 3 270M IT vs Qwen3 0.6B) pe dev; zero-shot doar ca diagnostic; holdout sigilat pentru final.
- [ ] P6.2. Antrenarea formalizatorului, un braț odată, recipe + dataset fixate; inițial CNL fără verbalizer.
- [ ] P6.3. Selecția checkpoint-ului după execuție/corectitudine semantică pe dev; early-stop preregistrat; testul nu influențează selecția.
- [ ] P6.4. Holdout first-shot: EN/RO, negare, roluri, timp, compoziții, ambiguitate, cereri în afara profilului; consumarea holdout-ului se înregistrează.
- [ ] P6.5. Praguri de calificare internă (parse ≥99%; corectitudine ≥90% EN/RO; hard-negative ≥95%; afirmat fără suport ≤2% pe UNKNOWN; zero încălcări de izolare) — de înghețat în P0.5, nu relaxate după scoruri.
- [ ] P6.6. La eșec G6: localizare (source/semantics, vocabular, model, retrieval, solver, evaluator) și reparare într-un braț nou; rezultatul negativ se păstrează.
- [ ] P6.7. Servirea checkpoint-ului real: întrebări noi → SOP → runtime → CNL, cu trace, identitate model, latență și memorie observate.
- [ ] P6.8. Merge/export și comparație BF16/F16 vs Q8/Q4/CPU unde backend-ul suportă; degradarea semantică măsurată pe aceeași suită.

**G6:** model mic efectiv antrenat, evaluat independent, folosit cap-coadă. Loss descrescător nu închide G6.

## P7 — Server local OpenAI (restante)

- [ ] P7.0. Profilul de servire respectă profilul de antrenare: modelul fine-tuned se servește cu `barePrompt` (CONTEXT + MESSAGE), nu `formalPrompt`; textul din `server/prompts/formalizer.txt` rămâne pentru modele base. Mixing-ul profilurilor invalidează evaluarea.
- [ ] P7.1. Separarea fațadă HTTP / sesiune+policy / inferență / runtime; un singur traseu de execuție partajat.
- [ ] P7.2. Backend intern formalizer-only cu verificare base/revision/tokenizer/data/profile; adaptor incompatibil refuzat.
- [ ] P7.3. `GET /v1/models`, `POST /v1/chat/completions`, health/readiness; erori explicite, fără pretenții neimplementate (Responses/embeddings/tools).
- [ ] P7.4. Non-streaming + SSE pe rezultat verificat; terminare corectă, disconnect/cancel tratate.
- [ ] P7.5. Binding local implicit, autentificare, limite request/context/timp/concurență, izolare user/sesiune.
- [ ] P7.6. Trace cu circuit, proveniență, backend, fallback, completitudine, CNL; fără date private/chei în erori.
- [ ] P7.7. Smoke API cu modelul real: multi-turn, fapte, corecție, istoric, ambiguitate, UNKNOWN, conflict, restart, doi utilizatori izolați.
- [ ] P7.8. README/GAMP/skills aliniate la comenzile reale; pornire/oprire documentată fără procese orfane.

**G7:** un client OpenAI folosește local întregul ChatSOP.

## P8 — Reasonere reale și memorii comparabile (restante)

- [ ] P8.1. Capabilities fixate pentru referința JS; referința rămâne oracle inspectabil.
- [ ] P8.2. Calificarea SWI pe profilul comun (recursie, variabile, negație, timp, contradicție, ipoteze, limite, outputs); separarea explicită a costului SWI de verificarea JS.
- [ ] P8.3. Calificarea Z3: sat vs entailment, optimum neunic, unsat, timeout; niciun fallback JS ascuns.
- [ ] P8.4. `advanced` rămâne strategie de rutare, nu al patrulea solver; matricea marchează `unsupported`/incomparabil.
- [ ] P8.6. SQLite exact vs Recall Weaver pe același corpus/setup; retrieval-ul nu primește răspunsurile așteptate.
- [ ] P8.7. Holo/H7 ca al treilea motor; hybrid ca ablație exact+hint, cu consumatorul de hints conectat și măsurat.
- [ ] P8.8. Comparații de cost la bugete declarate + configurații practice; scaling, latențe reci/calde, distribuții de acces.
- [ ] P8.9. Restart/checkpoint, fork, izolare, archive/pinned, uitare, generații, GC cu retractări.
- [ ] P8.10. Matrice reasoning × memorie: minimum 2×2, țintă 3×3 cu celule declarate.

**G8:** ≥2 motoare de reasoning efective și ≥2 memorii comparate corect; fallback-urile nu sunt motoare diferite.

## P9 — Experimente pentru articol (restante)

- [ ] P9.1. S0 source-only, S1 dynamic repair, S2 accumulating SOP, S3 frozen library, S4 teacher reference, cu acces la bibliotecă explicit diferit.
- [ ] P9.2. Compararea strategiilor de expansiune cu bugete măsurabile și sensibilitate la ordinea surselor.
- [ ] P9.3. Accuracy per family, UNKNOWN calibration, semantic-gap recovery, transfer gain, rule reuse, cost până la platou; noutatea și saturația preregistrate.
- [ ] P9.4. Ablații formalizer: RO zero/sute/mii de ancore; resolver on/off; proceduri on/off; CNL vs verbalizer; un factor pe braț.
- [ ] P9.5. Baseline-uri: model mic în proză, model mic fine-tuned SOP, model mare în proză, model mare cu aceleași unelte; acces egal la informație.
- [ ] P9.6. Separarea studiilor de mecanism / formalizare / agent complet + scenarii longitudinale (corecții, informație rară, fork, uitare).
- [ ] P9.7. Repetiții pe seeds/surse pentru incertitudine; eșecurile și incomparabilitățile publicate; tabele regenerabile din raw results.

**G9:** dovezi independente pentru afirmații și limite clare pentru infirmări.

## P10 — Articol și publicare (restante)

- [ ] P10.1. Registrul afirmație→experiment→artefact→limită, pornind de la `Articol.docx`; cifre istorice nu devin rezultate noi.
- [ ] P10.2. Manuscrisul în engleză: problemă, diferența față de PAL/LINC/Logic-LM/Scallop/LMQL/DSPy/RAG, SOP ca IR, metodă, rezultate, ablații, limite.
- [ ] P10.3. Variante de publicare (Neurosymbolic AI / NeSy / Semantic Web / JOSS / arXiv) conform `Publicare.docx`.
- [ ] P10.4. Reverificarea pe surse oficiale a scope/politici/format/termene chiar înainte de trimitere.
- [ ] P10.5. Artefact imuabil: cod, licențe, manifeste, hashes, date redistribuibile/instrucțiuni, rezultate brute, scripturi de tabele; reproducere de terți din artefact.
- [ ] P10.6. Revizuirea finală a autorului; nu declara review uman înainte de efectuare; fără submission simultan dublu.

**G10:** articolul + artefactul spun exact ce a fost construit și măsurat.

## 2. Riscuri și decizii de escaladare

| Risc | Acțiune, nu ocolire |
|---|---|
| Luna parafrazează fluent, dar schimbă sensul | Pilot pe familii; cod determinist unde se poate; carantină și reviewer capabil; cost per exemplu acceptat. |
| Profilul SOP nu exprimă o familie din vision | Declară unsupported și reasoning gap; extensie cu semantică/oracle înainte de producția țintelor. |
| Modelul mic are scor bun doar pe template-uri | Holdout structural/source/RO și baseline corect; nu mai adăuga numai instanțe ale aceleiași forme. |
| Biblioteca implicită repară testul memorând răspunsul | Separă trigger/validation/test, generalizează și cere transfer pe sursă nouă. |
| Default produce certitudine falsă | Scope/excepții/epistemic explicite; rule candidat, nu Horn hard implicit. |
| Reasonerele au profile diferite | Comparație pe intersecții + capabilities; nu un scor global înșelător. |
| Memoria aproximativă pierde premise relevante | Coverage vizibil, abținere corectă și baseline exact; include costul metadatelor. |
| Preflight trece, dar lipsesc CUDA memory/checkpoint valid | Gate fail-closed și exercitarea refuzurilor înainte de job lung. |
| Un job ori un evaluator citește date care se schimbă | Dataset/library imuabile, run fingerprints, un singur writer și slot GPU. |
| Licențe, acces gated sau container indisponibil | Consemnează prerechizitul și sursa alternativă compatibilă; nu publica pe drepturi presupuse. |
| Cifrele istorice ajung în articol ca rezultate noi | Registrul afirmațiilor, timestamp/hardware/backend/model și status historical/new distincte. |

## 3. Ordinea și rolurile pentru restanțe

```text
P0 contracte rămase → P1 date + P2 skill + P3 eval + P4 operațiuni (în paralel pe contracte)
→ P5 dataset înghețat → P6 training + calificare → P7 server local
→ P8 reasonere + memorii → P9 experimente → P10 articol
```

Roluri: **integrator** — contracte și decizie finală; **data agent** — surse/generare; **ingestion agent** — skill și propuneri; **eval agent** — runner și referințe independente; **training operator** — singurul proprietar al jobului GPU; **server agent** — integrare API/runtime. Agenții mai mici sunt producători de candidați, nu autorități semantice.

Current execution order: U1 → U2 → U3 → STOP. The P0–P10 roadmap above is deferred background only; resuming it requires a new user instruction.
