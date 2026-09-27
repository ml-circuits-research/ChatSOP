# 20. HoloMemory: mecanismul H7 și adaptorul SOP

## Ideea, înainte de detalii

Cheia stabilește unde scriem; valoarea stabilește ce model de semne adăugăm acolo. Mai multe asocieri pot folosi aceleași celule. La citire, cheia selectează din nou acele locuri, inversează mascarea și adună semnalele. Valorile candidate sunt comparate cu semnalul recuperat. Informația este distribuită între celule și bănci, nu salvată într-o înregistrare exactă pe care algoritmul o citește ulterior.

Aceasta este esența implementată din H7. Nu folosim tabelul exact SQLite ca să „corectăm” răspunsul Holo. Evaluatorul păstrează adevărul de referință în afara memoriei exclusiv pentru măsurare.

## Trei componente distincte

| Componentă | Fișier | Contract implementat |
|---|---|---|
| Nucleu asociativ | `src/memory/banks/holo-kernel.js` | Cheie cunoscută → valoare dintr-un domeniu explicit |
| Adaptor de fapte | `src/memory/banks/holo.js` | Atom SOP parțial → argumente reconstruite → verificare de integritate |
| Plan de conținut experimental | `src/memory/banks/holo-wire.js` | Handle SHA-256 cunoscut → întregul fir SOP canonic, octet cu octet |

Adaptorul de fapte este integrat în agent, inclusiv în shard-uri. Planul de conținut este o componentă separată, testată, care nu rezolvă încă descoperirea handle-ului dintr-un indiciu semantic vag. Nu prezentăm această limită drept o operație deja implementată.

## Structura fizică a nucleului

Configurația declară numărul de bănci, rândurile din fiecare bancă și lungimea unui cod. Datele sunt un singur `Int8Array`. Un rând este un segment consecutiv din acest tablou. Fiecare contor poate fi limitat până la ±127. Setarea unei limite ±7 nu îl împachetează automat în patru biți: implementarea folosește în continuare un octet fizic per contor.

Pentru fiecare bancă, hash-ul cheii alege un rând. Din același hash derivăm determinist o mască de semne. Un cod bipolar al valorii este regenerat determinist din valoarea canonică și seed. Nu se păstrează o listă de chei. Cache-ul codurilor este opțional, limitat și raportat separat; el poate fi reconstruit și nu conține asocierile învățate.

Snapshot-ul nucleului conține configurația, tabloul de contoare, starea generatorului pentru ageing și contoarele de diagnostic. Fork-ul nucleului clonează tabloul. Acest fork mic este corect, dar nu este copy-on-write. Repository-ul agentului oferă separat partajarea generațiilor imuabile descrisă în capitolul 18.

## Scriere și citire

Scrierea calculează codul valorii, îl înmulțește componentă cu componentă cu masca cheii și adaugă rezultatul în rândul ales din fiecare bancă. Valorile se limitează la intervalul contoarelor. O observație repetată adaugă din nou aceleași contribuții.

Citirea regenerează rândurile și măștile, adună semnalele demascate și calculează corelația cu fiecare valoare candidat. Rezultatul expune amplitudinea semnalului, corelația normalizată și diferența dintre primii candidați. Pragurile decid dacă nucleul raportează `remembered`, `uncertain` sau `not_remembered`. Aceste scoruri nu sunt probabilități calibrate.

Sub supraîncărcare, chiar primul candidat cu marjă bună poate fi greșit. De aceea nucleul singur nu este o sursă de premise acceptate automat. Raportul `h7-kernel.json` măsoară separat valorile rank-1 corecte, acceptările greșite și acceptările pe chei care nu au fost scrise.

## Ageing indus de noutate

`remember` în modul `auto` încearcă mai întâi să citească cheia în domeniul declarat. Dacă valoarea citită este aceeași și trece pragurile, scrierea este o repetiție: întărește local, fără ageing global. Dacă valoarea este alta sau citirea este nesigură, se aplică ageing, apoi scrierea. Un utilizator al nucleului poate declara explicit `new` sau `repeat` când are informații externe verificate.

Ageing-ul selectează un număr configurabil de celule din întregul tablou și mută fiecare contor nenul cu un pas spre zero. Selecția este pseudoaleatoare și reproductibilă prin snapshot. Nu ștergem „înregistrarea cea mai veche”; slăbim fragmente de urme suprapuse. O celulă poate susține mai multe fapte, deci uitarea este aproximativă.

Adaptorul SOP detectează repetițiile cu o amprentă existentă plus verificarea că urma mai are susținere. Acesta este un mecanism mai conservator decât detecția nucleului fără metadate. Strength-ul provenit dintr-un proof nu declanșează ageing. Pinned și arhiva îl dezactivează. În modul cu shard-uri, o generație rece nu este modificată; evacuarea și promovarea sunt operațiile externe de retenție.

## Cum memorăm un fapt SOP

Pentru `works_at(ana, cern)`, adaptorul scrie două asocieri. Prima are cheia „works_at, pozitiv, argumentul 0 necunoscut, restul cern” și valoarea `ana`. A doua are cheia „works_at, pozitiv, argumentul 1 necunoscut, restul ana” și valoarea `cern`. Pentru trei sau patru argumente se scrie câte o asemenea asociere pe argument.

La `works_at(ana, ?org)`, cheia pentru argumentul 1 este deja cunoscută. Citim semnalul o singură dată și comparăm organizațiile candidate cu el. Dacă mai multe câmpuri lipsesc, enumerăm domeniile mai mici până când rămâne un singur argument necunoscut. Pentru aceeași variabilă în mai multe poziții impunem aceeași valoare.

În varianta integrată, domeniile de valori și amprentele SHA-256 ale tuplurilor sunt metadate exacte. Ele nu conțin corpul complet al fiecărui fapt, dar cresc cu datele. Metadatele temporale, sursele și definițiile aprobate ale regulilor sunt, de asemenea, păstrate separat. Prin urmare, nucleul H7 are buget fix; întregul adaptor SOP nu are buget fix fără shard-uri și politici explicite pentru metadate. Costurile sunt raportate separat, nu ascunse în „MiB de memorie holografică”.

După reconstrucție, hash-ul întregului tuplu trebuie să existe între receipts. Verificarea previne admiterea multor combinații inexistente, dar nu recuperează faptele ratate și nu demonstrează adevărul unei surse. Apoi stratul comun aplică intervalele și retractările.

## Unul sau multe răspunsuri pentru aceeași cheie

O cheie precum „organizația la care lucrează Ana” poate avea puține valori. O cheie inversă precum „toate persoanele de la organizația X” poate avea sute. Codurile acestor persoane sunt suprapuse în aceleași rânduri și se interferează. Nucleul simplu nu este echivalent cu o listă exactă de rezultate. Acesta este motivul pentru care benchmark-ul separă completările cu puține răspunsuri de interogările inverse cu multe răspunsuri.

Direcțiile de îmbunătățire sunt sub-chei/bucket-uri, rutare pe grupuri, mai mult spațiu pentru cheile cu multe valori și un plan de descoperire separat. Niciuna nu trebuie creditată înainte de implementare și măsurare. SQLite oferă direct enumerarea exactă și rămâne reperul pentru această sarcină.

## Recuperarea unui fir întreg

`HoloWireMemory.remember(sop)` canonicalizează SOP și întoarce hash-ul lui ca handle. Lungimea și octeții sunt scriși ca asocieri separate, folosind cheia formată din handle și poziția octetului. Citirea recuperează lungimea, apoi fiecare byte din alfabetul 0–255. Dacă un byte este ambiguu, lungimea depășește bugetul sau hash-ul firului nu mai coincide cu handle-ul, nu se întoarce un fir acceptat.

Acest experiment nu păstrează un dicționar de fire și nici o listă a lungimilor. Apelantul trebuie însă să cunoască handle-ul. Sunt configurabile memoria, dimensiunea maximă a firului și pragurile. Codul nu execută automat un fir reconstruit; validarea și aprobarea necesare pentru reguli rămân ale runtime-ului.

## Validare reproductibilă

```bash
node --test tests/memory-engines.test.js
node tools/bench-h7.js --seeds 11,29,53 --count 3000 --samples 300
node tools/check-data.js --dir data/seed --execute --engine holo
```

Tabelul numeric din H7 este rezultatul raportat de documentul sursă. În lipsa codului/configurației complete originale, nu îl etichetăm „reprodus”. Rapoartele acestui pachet sunt rulări independente ale implementării de aici.
