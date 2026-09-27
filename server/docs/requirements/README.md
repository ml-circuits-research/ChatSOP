# Specificația experimentului RecallSOP

Documentele se citesc în ordinea de mai jos. Ele descriu ce trebuie construit, ce funcționează în pachet și cum se verifică. Codul și exemplele sunt parte din contract; un concept descris ca extensie nu trebuie prezentat drept rezultat executat.

| Document | Întrebarea la care răspunde |
|---|---|
| `00-arhitectura.md` | Ce rol au modelele, memoria, SOP, motorul și policy-ul? |
| `01-sop.md` | Cum scriem fiecare tip de fir fără un al doilea IR? |
| `02-runtime.md` | Cum se planifică, se extinde și se execută sigur un circuit? |
| `03-memorie.md` | Ce se păstrează asociativ, ce este exact și cum se forkuiește? |
| `04-lexicon.md` | Cum tratăm sinonimele, limbile și contextul mic? |
| `05-timp.md` | Ce înseamnă actualizare, corecție, interval și contradicție? |
| `06-backenduri.md` | Cum se traduce automat același SOP în Horn/Prolog/SMT? |
| `07-date.md` | Cum generăm și verificăm fine-tuning-ul română → SOP? |
| `08-spark.md` | Cum antrenăm două adaptoare și exportăm CPU? |
| `09-evaluare.md` | Cum distingem demonstrația reală de un test insuficient? |
| `10-cnl.md` | Ce primește verbalizatorul și ce nu are voie să modifice? |
| `11-ingestie.md` | Cum adaugă un coding agent cunoaștere și proceduri? |
| `12-stadiu.md` | Ce este implementat și ce experimente urmează? |

Exemplele principale sunt fișierele din `examples/`. Setul generat are o reprezentare SOP completă pentru fiecare comandă și întrebare. Biblioteca de bază este în `kb/bootstrap.sop`. Referințele externe sunt în `docs/SOURCES.md`.

## Capitolele pentru ieșiri și compoziție

| Document | Întrebarea la care răspunde |
|---|---|
| `13-strategii.md` | Cum alegem sau combinăm memoria exactă, Recall Weaver, procedurile și solverele? |
| `14-output-linker.md` | Cum devine `?nume` un fir, cine leagă declarațiile și ce cod primește solverul? |
| `15-experiment-linker.md` | Cum testăm legarea, ambiguitatea, costurile și noile ținte de antrenare? |
| `16-uitare-capacitate.md` | Cum funcționează reinforcement, pressure decay, pinned și modul archive? |
| `17-algoritmi.md` | Care sunt algoritmii end-to-end și unde se execută fiecare? |
| `18-sharduri.md` | Cum rotim, promovăm, evacuăm, salvăm și colectăm shard-urile fără să stricăm fork-urile? |

Pentru a înțelege arhitectura pe exemplu, începe cu capitolul 14 și `examples/auto-link.sop`, apoi revino la contractele detaliate. `StartSOP.md` din rădăcină conține comenzile de pornire.

## Motoare de memorie comparabile

| Document | Rol |
|---|---|
| `19-memorii-paralele.md` | Contractul comun și alegerea Weaver / Holo / SQLite / scan |
| `20-holomemory.md` | Mecanismul H7, adaptorul de fapte, reconstrucția din handle și limitele |
| `21-sqlite-basic.md` | SQL indexat și varianta minimală într-un singur fișier |
| `22-comparatie-experimentala.md` | Protocolul, măsurătorile și criteriile pentru următoarele experimente |

## Arhitectura și profilele de reasoning v3

Începe cu capitolul 23 pentru arhitectura consolidată. Capitolele 24–29 completează și precizează profilele de mai sus; rapoartele vechi rămân măsurători ale versiunilor lor.

| Document | Conținut |
|---|---|
| `23-arhitectura-consolidata.md` | Arhitectura consolidată: memorie, modele și reasoning |
| `24-semantica-firelor.md` | Contractul semantic al firelor SOP |
| `25-motorul-de-referinta.md` | Motorul de referință: algoritmi simpli și inspectabili |
| `26-strategii-si-contracte.md` | Două axe independente și contractele de extensie |
| `27-date-si-invatare-v3.md` | Date, învățare și fine-tuning pentru profilul v3 |
| `28-validare-si-limite.md` | Validarea implementării și criteriile de extindere |
| `29-exemple-integrate.md` | Exemple complete și cum construim peste ele |

| `30-verificare-release.md` | Verificare integrală sau pe grupuri, colectare cu fingerprint și integritatea ZIP-ului |
