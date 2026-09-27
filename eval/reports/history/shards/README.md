# Testele memoriei generaționale

Rulare locală pe v22.16.0, linux/x64. Procesor raportat: Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz. Nu a fost folosit un model neuronal sau un solver extern.

## Verificare

Suita completă: **222 teste, 213 trecute, 9 sărite pentru backend-uri externe, 0 eșecuri**. Cele 52 teste noi din `tests/shards.test.js` au fost executate. `data-sharded.json` confirmă executarea tuturor celor 1.110 ținte SOP ale formalizatorului, fără erori; cele 240 exemple ale verbalizatorului sunt verificate structural, nu evaluate neuronal.

## Benchmark de integrare

Au fost inserate 2,000 fapte sintetice normale și un fapt pinned. Un fapt normal-santinelă a primit 31 semnale explicite de utilizare confirmată, pentru a verifica promovarea. Rularea SOP separată verifică faptul că runtime-ul produce aceste semnale numai pentru premisele proof-ului. Faptele-sursă sunt păstrate numai de evaluator; decoderul vede băncile, domeniile și recepțiile. Au fost folosite recepții SHA-256: acest benchmark nu măsoară rata falsurilor pozitive a variantei fără recepții.

| Măsură | Cache bounded | Arhivă |
|---|---:|---:|
| Shard-uri normale reținute | 5 | 32 |
| Shard-uri pinned | 1 | 1 |
| Shard-uri normale evacuate | 27 | 0 |
| Claim-uri reținute, inclusiv pinned | 300 | 2001 |
| Completări corecte din cele 200 cereri eșantionate | 30 | 200 |
| Cereri fără răspuns deoarece faptul fusese evacuat | 170 | 0 |
| Rezultate incompatibile cu retenția/valoarea așteptată | 0 | 0 |
| False acceptări în 100 cereri despre fapte neintroduse | 0 | 0 |
| Bytes bănci normale | 51200 | 327680 |
| Bytes bănci pinned | 10240 | 10240 |
| Bytes metadate serializate ale shard-urilor | 166716 | 1109069 |
| Mediană interogare, ms | 2.661 | 18.588 |
| Percentila 95 interogare, ms | 8.376 | 20.817 |

Cele 170 abțineri ale cache-ului sunt pierdere intenționată de istorie, nu recuperări corecte ale informației originale. Faptul-santinelă utilizat și cel pinned au rămas recuperabile. Arhiva a completat 200/200 cereri eșantionate fără evacuare. Aceasta nu este o garanție universală de acuratețe și nu este o demonstrație de scară Internet.

Dimensiunile băncilor nu sunt memoria totală. Metadatele, biblioteca, vocabularul, jurnalele, serializarea, snapshot-urile încă referite și overhead-ul JavaScript sunt separate. Timpii sunt măsurători ale acestui proces, nu SLA sau benchmark de telefon mobil. În această încărcare toate shard-urile au același predicat, deci routerul nu le poate exclude pe baza predicatului; creșterea latenței arhivei este vizibilă.

## Demonstrația SOP și garbage collection

`demo.json` verifică o inferență cu două premise, promovarea acestora, uitarea unui fapt neutilizat, protecția pinned, redeschiderea repository-ului și izolarea altui utilizator. După închiderea sesiunii vechi au devenit colectabile **3 shard-uri și 1 snapshot**, total **28497 bytes de fișiere**. Înainte de închidere, istoricul acelei sesiuni a rămas accesibil. Fișierele încă accesibile din baze/fork-uri/utilizatori/sesiuni nu au fost eliminate.

## Reproducere

```bash
node --test tests/shards.test.js
node examples/shards-demo.js
node tools/bench-shards.js --facts 2000 --queries 200 --batch 64 --power 10 --cold 4 --seed 731
node tools/verify.js
```

Parametrii și măsurătorile individuale de latență sunt în `benchmark.json`. Testele tuturor funcțiilor sunt în `../node-tests.log`. Aceste comenzi regenerează rapoartele; checksum-urile distribuției originale trebuie verificate înainte de regenerare.
