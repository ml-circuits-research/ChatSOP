# RecallSOP — circuite SOP, memorie compozabilă și două modele mici

## Nou: două axe și reasoning explicit

Profilul `sop-agent-3` separă **memory.engine** de **policy.reasoningStrategy**. `reference` rulează numai JS; `advanced` poate folosi Prolog/Z3, cu fallback raportat. Sunt implementate profile finite pentru deducție, abducție automată, diagnostic, asociere, inducție, analogie, planificare, intervenții și optimizare. Ipotezele și pattern-urile rămân obiecte candidate; nu devin fapte prin simpla execuție.

```bash
node examples/reasoning-demo.js
node tools/build-data.js --worlds 30 --out data/seed
node tools/verify.js
```

Citește `docs/requirements/23-arhitectura-consolidata.md` și capitolele 24–29. Matricea executată este în `reports/reasoning/matrix.json`. Acesta este un pachet de cercetare integrat, cu limite explicite, nu un produs certificat sau un model deja antrenat.


Scopul experimentului este un agent care învață fapte și proceduri fără reantrenare continuă. Un model mic transformă mesajul în fire SOP Lang; strategiile de memorie furnizează premise; linkerul găsește regulile care pot răspunde; interpretoarele execută regulile și restricțiile; rezultatul CNL poate fi reformulat de al doilea model. Modelul lingvistic nu scrie Prolog sau SMT-LIB și nu hotărăște singur ce este demonstrat.

**Contractul formal unic este profilul `sop-agent-3`.** Faptele din documente, întrebările, comenzile, regulile și procedurile sunt fișiere `.sop`. Configurațiile și transportul seturilor de antrenare pot fi JSON/JSONL; acestea nu reprezintă un al doilea limbaj de cunoaștere.

**Ghidul `StartSOP.md` este inclus în rădăcina arhivei.** Pentru mecanismul de legare citește `docs/requirements/14-output-linker.md`; pentru strategiile independente, `13-strategii.md`; pentru reinforcement/uitare/capacitate, `16-uitare-capacitate.md`; iar `17-algoritmi.md` este harta end-to-end.

## Strategii de memorie implementate și comparate

`weaver`, `holo`, `sqlite`, `scan` și `hybrid` sunt motoare fizice alternative. Holo implementează nucleul H7 cu contoare semnate și un adaptor pentru fapte SOP. SQLite și scan păstrează corpurile exact, fără bănci asociative. Există și un mod minimal într-un singur fișier SQLite. Citește capitolele **19–22** și rezultatele reale din **`reports/memory/RESULTS.md`**.

```bash
node examples/memory-demo.js
node tools/sqlite-simple.js --help
node tools/bench-memory.js --help
```

## Începe fără modele

Necesită Node.js 22.13+; runtime-ul nu are dependențe npm.

```bash
node tools/verify.js
node examples/linker-demo.js
node cli.js init
node cli.js run --file examples/auto-link.sop
node cli.js run --file examples/auto-mixed.sop
node cli.js run --file examples/auto-template.sop
```

`init` publică o mică bază fictivă, aprobată, nu cunoaștere enciclopedică. Demo-ul verifică execuția simbolică, nu calitatea limbii române a unui model.

## Un circuit real

```sop
@q query
  mode select
  select ?who
  where grandmother(?who, carina)
  at 2026-09-26

@result solve
  query $q
  output ?who one

@label jsEval
  expr "Persoana găsită: " + $who

@answer cnl
  result $result
  language ro
```

`?who` este necunoscuta locală a întrebării. `output ?who one` rezervă firul rezultat fără a cere `@who`; runtime-ul îl materializează după rezolvare, iar `$who` îl poate consuma. O soluție ambiguă sau incompletă nu produce un scalar arbitrar. `~procedure` rămâne un handle pentru instanțierea unei definiții aprobate.

`solve` se extinde în `link → reason → binding`. Linkerul unifică ținta query-ului cu concluziile regulilor aprobate, recuperează premisele prin strategia aleasă și transmite un program tipizat solverului. Acesta este pasul explicit dintre căutare și raționament. Recall Weaver este doar o strategie. `recall-weaver`, `holo-memory`, `sqlite`, `scan` și `auto` folosesc același contract. SQLite și scan sunt motoare exacte independente; `exact` și `hybrid` sunt opțiunile legacy pentru copia exactă suplimentară.

## Modele și Spark

```bash
node tools/generate-data.js --out data/generated --worlds 1000
node tools/check-data.js --dir data/generated --execute --out reports/generated-validation.json
bash scripts/spark-shell.sh
# În container:
bash scripts/spark-setup.sh
source .venv/bin/activate
bash scripts/smoke-train.sh
bash scripts/train-both.sh
python training/serve_adapters.py
# În alt terminal, pe gazdă:
node cli.js chat --config config/runtime-shared.json --cnl-only
```

Începe prin evaluarea formalizatorului cu CNL determinist. Activează verbalizatorul după evaluare, eliminând `--cnl-only`. Instrucțiuni complete: `docs/requirements/08-spark.md`.

Baza inițială de model este Gemma 3 270M IT; Qwen3 0.6B este configurația alternativă. Pachetul nu include greutăți și nu demonstrează încă performanța neuronală în română. Serverul de cercetare deservește două adaptoare pe aceeași bază, cu validare după generare; nu aplică constrângeri de gramatică în timpul generării.

## Structura proiectului

| Director | Rol |
|---|---|
| `docs/requirements/` | Contracte și decizii inginerești, cu exemple executabile și limite explicite |
| `src/sop/` | Parser, validare, expresii `jsEval`, conversie internă în obiecte tipizate |
| `src/runtime.js`, `src/sop/outputs.js` | Epoci, ieșiri `?`, efecte, expansiune și blocarea dependențelor nerezolvate |
| `src/linker.js`, `src/strategies.js` | Scopuri, unificare cu reguli, recuperare compozabilă și plan verificabil |
| `src/memory/`, `src/memory.js`, `src/repository.js` | Bănci asociative, reinforcement, pressure decay, proveniență temporală, sesiuni și snapshot-uri |
| `src/backends/` | Horn JS, adaptor Prolog, restricții JS finite și adaptor Z3 |
| `config/ontology.sop` | Entități, predicate și aliasuri aprobate, independente de limbă |
| `kb/`, `examples/` | Cunoaștere, reguli, proceduri și programe SOP |
| `data/seed/`, `tools/` | Corpus inițial, generare, verificare, profesor, ingestie și evaluare |
| `training/`, `scripts/` | Fine-tuning, servire adaptoare, export GGUF CPU |
| `skills/` | Instrucțiuni pentru coding agent; punct de intrare `AGENTS.md` |
| `reports/` | Rezultate executate; testele sărite și rulările fără model sunt identificate |

Modelele neuronale și backend-urile opționale sunt instalate separat. Nucleul JS, exemplele și testele deterministe funcționează fără ele. Consultă `docs/requirements/12-stadiu.md` înainte de a interpreta prototipul drept sistem complet de conversație.

## Shard-uri locale — implementare generațională

Profilul implicit folosește acum `ShardedLayer`: generații normale bounded, pinned separat, bază comună în arhivă, promovarea premiselor utile și garbage collection pe referințe. SOP și antrenarea modelelor rămân independente de stocare.

```bash
node examples/shards-demo.js
node tools/bench-shards.js
node cli.js gc --config config/runtime-sharded.json
```

Începe cu `StartSOP.md` și `docs/requirements/18-sharduri.md`. GC este implicit dry-run la comanda explicită; `--apply` șterge obiectele inaccesibile. Profilurile pot programa GC la un număr de revizii persistate. Pentru date existente, citește procedura de migrare înainte de schimbarea retenției. Cache-ul normal are buget propriu; pinned, KB-ul comun, controlul temporal și sesiunile deschise pot ocupa spațiu suplimentar.
