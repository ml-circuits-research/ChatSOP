# 21. Memorie exactă simplă: scanare și SQLite

## De ce avem nevoie de acest reper

Pentru un număr moderat de fapte canonice, problema poate fi pur și simplu stocare și căutare exactă. Un motor asociativ trebuie să-și justifice costul printr-un beneficiu măsurat, nu prin complexitate. Scanarea unei colecții și SQLite oferă două repere: minimum de mecanică, respectiv puțin index pentru utilizare practică.

## Varianta fără index

`ScanBank` păstrează un `Map` cu ID-ul și corpul fiecărui fapt. Pentru fiecare întrebare parcurge înregistrările, compară predicatul, semnul și argumentele, apoi aplică egalitățile variabilelor repetate. Recuperează exact ceea ce a fost păstrat dacă bugetul permite parcurgerea completă. Costul de căutare crește cu numărul înregistrărilor. Nu există reconstruire, embeddings sau hashing probabilistic al conținutului.

Snapshot-ul conține exact tuplele și metadatele. Dimensiunea JSON este raportată separat de heap-ul JavaScript. Un fapt repetat actualizează contorul său exact. Decay-ul acestei referințe reduce contoarele per înregistrare; nu are efecte de interferență între fapte.

## Varianta SQL integrată în agent

`SQLiteBank` are o tabelă `atoms`: ID, predicat, aritate, negație, până la patru argumente, corp canonic și metadate. Argumentele sunt codificate determinist cu tipul lor, astfel încât numărul `1` și textul `"1"` rămân diferite.

Patru indici compuși încep cu predicat/aritate/negație și continuă cu câte o poziție de argument. O întrebare precum `works_at(ana, ?org)` devine un `WHERE` parametrizat pe predicat și primul argument. `works_at(?person, cern)` poate folosi indexul celei de-a doua poziții. `same(?x, ?x)` adaugă o egalitate între coloane. Nu concatenăm datele utilizatorului în SQL.

Cu FTS activat, o tabelă FTS5 oferă căutare lexicală și un rang BM25. Termenii sunt tratați literal, nu ca sintaxă SQL sau expresie FTS arbitrară. Căutarea lexicală găsește candidați; pentru premise sunt necesare în continuare potrivirea structurală și verificarea temporală. Lexiconul multilingv și normalizarea ID-urilor rămân înaintea acestei componente. FTS nu este o înțelegere semantică multilingvă.

Biblioteca SQLite este cea inclusă în `node:sqlite`. Nucleul nou cere Node.js 22.13 sau mai nou; nu are dependențe npm. Pe runtime-ul de verificare, Node 22.16, API-ul afișează avertismentul de funcționalitate experimentală. Documentația oficială: Node [S10], SQLite [S11–S12] din `../SOURCES.md`.

## Persistența în cele două moduri

Există două variante intenționat distincte.

În agentul complet, fiecare bancă SQLite este o vedere SQL privată pentru strat/shard. Repository-ul existent exportă rândurile canonice în snapshot și reconstruiește indicii la încărcare. Astfel păstrează fork-urile, sesiunile, promovarea, verificarea hash-urilor snapshot-urilor și garbage collection-ul deja existente. Acest mod nu este un repository nativ într-un singur fișier SQLite. Clonarea și exportul pot fi costisitoare la multe scrieri; benchmark-ul de nucleu nu le include.

Pentru reperul minimal există `SimpleSQLiteMemory`: un singur fișier `.sqlite`, fără Weaver sau Holo. Acesta păstrează tuple, afirmații temporale, evenimente de actualizare și regulile SOP aprobate. Cheile și indicii sunt în aceeași bază. Un fork folosește `VACUUM INTO`, adică o copie consistentă completă, nu copy-on-write. Dacă aplicația cere doar o bază mică de cunoaștere și interogări, acesta este cel mai direct punct de pornire.

## Algoritmul temporal în varianta cu un singur fișier

La ingestie se calculează ID-ul tuplului și ID-ul afirmației, exact ca în restul runtime-ului. Corpul tuplului intră în `atoms`; intervalul, sursa și timpul aflării intră în `claims`. Corecțiile și terminarea stării intră în `changes`, fără suprascrierea istoricului. Reguli revizuite sunt păstrate ca SOP în `library`.

La citire, filtrarea indexată găsește tuplele compatibile cu query-ul. Indexul afirmațiilor găsește metadatele relevante; indexul schimbărilor găsește actualizările cunoscute la `asof`. Se aplică retractarea, capătul intervalului și filtrul `at`/`during`. Doar apoi se întorc premisele reasoner-ului. Căutarea nu scanează toate metadatele globale pentru fiecare întrebare.

Varianta simplă nu introduce automat un cache cu uitare. Pentru o arhivă exactă aceasta este o alegere rezonabilă. O retenție SQL ulterioară poate șterge exact înregistrările neprotejate după utilizare/timp. Celelalte profiluri ale agentului includ deja retenția pe shard-uri; nu o atribuim SQLite ca proprietate implicită.

## Pornire minimală

```bash
node tools/sqlite-simple.js ingest --db demo.sqlite \
  --file examples/memory-knowledge.sop --reviewed
node tools/sqlite-simple.js query --db demo.sqlite \
  --file examples/memory-query.sop
node tools/sqlite-simple.js search --db demo.sqlite --text "ana"
node tools/sqlite-simple.js fork --db demo.sqlite --to second.sqlite
node tools/sqlite-simple.js stats --db demo.sqlite
```

Fișierul de query conține o singură declarație `query`. CLI-ul simplu nu interpretează comenzi arbitrare de efect. Folosește linkerul pentru regulile necesare, kernelul Horn și CNL-ul comun. Pentru agentul complet, template-uri, `jsEval` și modele lingvistice, folosește `cli.js` cu `runtime-sqlite.json`.

## Ce măsurăm

Măsurăm latența indexată și inversă, volumul bazei cu indici, costul ingestiei și reconstrucției snapshot-ului. Pentru `scan` măsurăm parcurgerea completă și întreruperea în buget. Pentru ambele testăm valori de tipuri diferite, negație explicită, variabile repetate, rezultate multiple, expirare, fork și istorie temporală.

Nici SQL, nici Holo și nici Weaver nu fac faptele adevărate prin stocare. Exactitatea SQL privește fidelitatea față de înregistrări, nu autoritatea surselor.
