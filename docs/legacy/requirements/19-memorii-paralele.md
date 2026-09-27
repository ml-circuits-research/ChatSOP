# 19. Patru memorii interschimbabile, același SOP

## Ce vrem să comparăm

Întrebarea este dacă reprezentarea distribuită aduce un avantaj practic față de păstrarea exactă a faptelor. Nu schimbăm concomitent formalizatorul, regulile, sinonimele sau solverul. Același document SOP este ingerat separat în fiecare implementare, iar aceeași întrebare SOP este executată cu aceleași limite. Doar memoria se schimbă.

H7 propune HoloMemory: o memorie cu bănci de contoare semnate, în care cheia selectează rânduri și măști, iar valoarea este un cod distribuit. Recall Weaver folosește în schimb vederi ale tuplului și contoare pozitive care indică susținerea combinațiilor. Cele două mecanisme sunt compatibile la intrarea și ieșirea agentului; nu sunt compatibile ca reprezentare binară și nu își pot citi direct băncile.

Documentul sursă este păstrat nemodificat în `probably_obsolete/references/H7.docx` (text extras în `docs/legacy/references/H7.txt`), iar constatările actuale sunt în DS005/DS006. Capitolul 20 separă nucleul descris acolo, adaptorul construit pentru agent și cercetarea rămasă pentru descoperirea firelor din indicii foarte vagi.

## Implementările disponibile

| `memory.engine` | Provider pentru `solve` / `link` | Ce păstrează corpul faptului |
|---|---|---|
| `weaver` | `recall-weaver` | Proiecții relaționale în contoare de 4 biți; valorile sunt reconstruite și verificate |
| `holo` | `holo-memory` | Coduri bipolare suprapuse în contoare Int8; se reconstruiesc argumentele |
| `sqlite` | `sqlite` | Tupluri exacte în SQLite, cu indici pentru argumente și FTS opțional |
| `scan` | `scan` | Tupluri exacte într-un `Map`, parcurse secvențial, fără index relațional |

`scan` este referința cea mai banală. `sqlite` este referința inginerească simplă pentru utilizare practică. Alegerea unui provider nu creează retrospectiv o reprezentare lipsă. Creează rădăcini separate și reingerează sursele aprobate. `auto` poate citi generații cu motoare diferite prin contractul comun; nu convertește băncile. Selecția explicită a unui motor incompatibil produce eroare în locul unei comparații false.

Providerii vechi `exact` și `hybrid` rămân pentru compatibilitate. `exact` citește vechiul `exactAtoms` opțional, stocat alături de Recall Weaver. Nu îl numim SQLite și nu îl folosim drept substitut pentru noul reper SQL. `hybrid` folosește acel strat exact dacă există; în absența lui, delegă la motorul fizic prezent prin `auto`.

## Locul schimbării în arhitectură

`src/memory/banks/factory.js` construiește banca. `TemporalLayer` și `ShardedLayer` folosesc aceeași bancă abstractă pentru `add`, `recall`, `reinforce`, `decay`, `maintain`, `export` și `stats`. `Repository` continuă să impună izolarea utilizatorului, snapshot-urile, fork-urile și publicarea atomică. Linkerul și reasoner-ul nu primesc contoare sau SQL; primesc fapte canonice cu identitate, interval, proveniență și descrierea verificării.

Un fapt precum `works_at(ana, cern)` este același în toate strategiile. Nu introducem un IR alternativ pentru H7. Structurile JavaScript din implementare sunt rezultatul parserului SOP, nu un format suplimentar pe care trebuie să-l învețe modelul.

Băncile expun `domains` pentru rutarea după predicat/aritate și `receipts` pentru compatibilitatea cu stratul temporal. Pentru Holo și Weaver acestea sunt metadate exacte, separate de tablourile asociative. SQLite ține corpurile și metadatele băncii în baza SQL. O bancă nu este un reasoner: nu execută reguli și nu decide dacă o sursă spune adevărul.

## Reguli comune de interpretare

Un răspuns negativ la căutare înseamnă că nu a fost recuperată o premisă, nu că premisa este falsă. Negația explicită este un fapt separat. Tipurile rămân distincte: numărul `1` nu este simbolul `"1"`. Repetarea lui `?x` în două argumente impune egalitatea lor.

`complete` descrie închiderea căutării în bugetul și vederea aleasă. Într-o memorie probabilistică nu certifică supraviețuirea tuturor faptelor înainte de uitare. Nici un singur candidat rămas, nici un scor mare nu demonstrează unicitatea răspunsului în lumea reală. Pentru enumerări complete, numărări exacte și absență certificată în KB-ul reținut, reperul SQL este cel potrivit.

Timpul și retractările se aplică după recuperarea corpului și înainte de inferență. Un fapt `pinned` nu este răcit automat. Modul arhivă dezactivează și ageing-ul H7 indus de noutate. Regula comună de reinforcement rămâne: se întăresc premisele efectiv utilizate în proof, nu orice candidat vizitat la căutare.

## Cum rulezi aceeași problemă

```bash
node examples/memory-demo.js
node --test tests/memory-engines.test.js
```

Demo-ul reingerează aceeași bază și execută șase circuite pe fiecare dintre cele patru motoare, atât cu straturi simple, cât și cu shard-uri. Rezultă 48 de execuții verificate. Sunt incluse legarea regulilor, ieșiri scalare și tabelare, ambiguitate, subcircuite recuperate și transmiterea unei durate recuperate către un calcul numeric.

Pentru utilizare interactivă:

```bash
node cli.js init --config config/runtime-sqlite.json
node cli.js run --config config/runtime-sqlite.json --file examples/auto-link.sop
node cli.js init --config config/runtime-holo.json
node cli.js run --config config/runtime-holo.json --file examples/auto-link.sop
```

Rădăcinile configurate sunt diferite. Pentru generații cu evacuare există și `runtime-holo-sharded.json`, `runtime-sqlite-sharded.json`, `runtime-scan-sharded.json`. Profilurile anterioare Weaver sunt păstrate.

## Ce nu se schimbă în fine-tuning

Țintele formalizatorului rămân SOP. Nu antrenăm patru modele care să emită patru limbaje de memorie. Motorul este o alegere a host-ului; modelul poate primi doar strategiile permise de policy. Aceleași 1.110 ținte SOP din setul inițial sunt executabile cu motoarele noi. Verificarea lor se face cu `tools/check-data.js --execute --engine holo|sqlite|scan`.

Antrenamentul nu a fost executat prin această comparație. Toate măsurătorile sunt ale sistemului simbolic și ale memoriei, fără intervenția unui LLM.
