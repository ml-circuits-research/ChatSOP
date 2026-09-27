# 12. Stadiul implementării și experimentele prioritare

**Profilul curent este sop-agent-3.** Contractele și noile operații sunt în capitolele 23–29; catalogul exact al câmpurilor este `docs/contracts/wire-fields.md`. Notele istorice despre funcții neimplementate se citesc împreună cu stadiul v3 din capitolul 28.

## Implementat și verificabil local

Parser SOP, validare tipizată, dependențe distincte `$`/`~`/`?`, scheduler topologic, expansiune append-only, `jsEval` interpretat cu allowlist, fapte și reguli Horn, queries, restricții întregi bounded, CNL RO/EN, memorie asociativă cu recepții opționale, reinforcement pe premisele efectiv folosite, pressure-triggered decay în profilul legacy, shard-uri generaționale bounded/archive, promovare între shard-uri, rutare pe predicat, checkpoint, GC pe obiecte inaccesibile și pinned separat, metadate bitemporale, corecții și fork-uri. Există lexicon simbolic multilingv cu shortlist, protocol de ingestie revizuit, generator de date SOP și evaluator prin execuție.

Adaptoarele Prolog/Z3 și compilatoarele lor sunt incluse. Testele cu executabil real se fac numai când backend-ul este instalat; indisponibilitatea rămâne vizibilă. Fine-tuning-ul, descărcarea modelului, compatibilitatea pe Spark și calitatea conversației neuronale sunt pregătite prin cod/instrucțiuni, dar nu sunt rezultate executate în acest pachet.

## Extensii proiectate, nu prezentate drept funcții existente

Învățarea online a portofoliului de coloane, scheduling-ul strict după ceas independent de trafic, full free recall la scară mare, router semantic de shard-uri, paginare lazy de pe disc, replicare distribuită, compactarea semantică a jurnalului de retractări, resolverul global de entități, morfologia multilingvă completă, event calculus general, selecția semantică automată a oricărui template, recalculul reactiv după redefinirea firelor, interfețe mobile și un verificator formal al textului reformulat.

## Experimente recomandate

| Ipoteză | Protocol de testare | Ce ar conta ca infirmare sau limită |
|---|---|---|
| Modelul de 270M poate formaliza un domeniu restrâns în română | Holdout uman cu negare, timp, corecții și sinonime, fără template-uri identice | Erori semantice persistente chiar dacă sintaxa devine corectă |
| Două adaptoare sunt utile | Aceleași date și bază: două adaptoare versus unul comun | Modelul comun egalează rezultatele cu cost operațional mai mic |
| Shortlist-ul simbolic compensează contextul mic | Full ontology versus shortlist la același context; măsoară recall-ul shortlist-ului | Predicatul corect este des exclus înaintea LLM-ului |
| SOP îmbunătățește generalizarea procedurală | Proceduri noi aprobate, aceleași primitive, fără retraining complet | Formalizatorul nu poate selecta/lega noile template-uri |
| Memoria asociativă oferă valoare peste structurile exacte | Același buget total, cu/fără recepții, față de un index exact | Domeniile și metadatele anulează avantajul sau costul de decodare crește excesiv |
| Uitarea adaptivă păstrează informația utilă fără saturare | Umplere progresivă, acces Zipfian și uniform, sweep pe praguri/capacități; măsoară hit-rate, false positives și bytes totali | Faptele utile dispar prea repede, metadata domină memoria sau pragul sigur nu este stabil între domenii |
| Update-urile păstrează reasoning-ul corect | Evenimente tardive, retractări, surse contradictorii, query-uri asof | Apar concluzii bazate pe premise expirate sau retractate |
| Backends interpretează aceeași semantică | Test diferențial Horn JS/SWI și constrângeri JS/Z3 pe domeniul comun | Există divergențe neexplicate de completitudine ori profil |
| Învățarea procedurală prin coding agent este practic utilă | Documente reale → SOP revizuit → query-uri noi, provenance audit | Costul revizuirii sau pierderea de sens domină beneficiul |
| Cuantizarea păstrează comportamentul | BF16/F16/Q8/Q4 pe același holdout | Negarea, operatorii sau ID-urile se degradează sistematic |
| Sistemul mic poate depăși alternative mai mari la sarcini definite | Memorie, instrumente și limite comparabile, inclusiv baseline mare cu tools | Avantajul dispare după controlul accesului la cunoaștere |

Un rezultat negativ are valoare când identifică exact limita: parser lingvistic, reprezentare, retrieve, raționament sau prezentare. De aceea nu comprimăm toate erorile într-un singur scor de „inteligență”. Pachetul este pregătit să permită aceste separări și să poată fi extins de un inginer fără a reconstrui discuția inițială.

## Legare și ieșiri implementate în profilul `sop-agent-2`

Sunt incluse `solve`, `link`, registrul ieșirilor promise, `binding` intern, validarea ciclurilor prin ieșiri, materializarea cu cardinalitate, blocarea dependențelor nerezolvate și redenumirea igienică în template-uri. Linkerul face unificare între scop și concluziile regulilor, construiește agenda premiselor și păstrează planul verificabil. Registry-ul oferă motoarele `weaver`, `holo`, `sqlite`, `scan` și selecția `auto`, precum și strategiile legacy `exact` și `hybrid`. `exact` legacy este o scanare suplimentară de metadate; `sqlite` este noul index SQL real, separat de băncile asociative.

Ieșirile numerice JS sunt verificate prin enumerarea domeniului finit; implementarea Z3 folosește o verificare suplimentară de unicitate, dar testarea cu executabil real rămâne condiționată de instalare. Demo-urile folosesc JS și păstrează separat codul compilat pentru backend-uri externe. `reports/verification.json` și `reports/linker/summary.json` sunt rezultatele autoritare ale rulării livrate.

Nu este implementată sinteza arbitrară a unei proceduri lipsă, distribuirea optimă a tuturor join-urilor între provider și solver, backtracking-ul general între tool-uri, enumerarea exhaustivă a modelelor Z3 sau actualizarea reactivă a unui circuit deja rezolvat. Aceste limite nu împiedică exemplele declarate: query → regulă → premise → solver → ieșire → următorul fir.

## Validarea stocării generaționale

`tests/shards.test.js`, `examples/shards-demo.js` și `tools/bench-shards.js` verifică organizarea, persistența și retenția; `tools/check-data.js --sharded --execute` execută toate țintele SOP pe această organizare. Rezultatele livrate sunt în `reports/shards/` și `reports/data-sharded.json`. Nu confundăm acest test cu evaluarea neuronală.

## Motoare paralele de memorie

Sunt implementate H7/HoloMemory (nucleu de contoare semnate și adaptor pentru completarea argumentelor), SQLite cu indici compuși și FTS, precum și scanarea exactă fără index. Toate folosesc același SOP și aceeași validare temporală în repository. SQLite are suplimentar modul minimal `SimpleSQLiteMemory`, care persistă fapte, versiuni, evenimente și reguli într-un singur fișier și poate rula fără repository-ul generațional.

H7 include și un experiment de citire a unui fir SOP întreg dintr-un handle cunoscut, cu verificarea SHA-256. Nu este implementată recuperarea semantică liberă a handle-urilor din fragmente arbitrare. Adaptorul H7 pentru fapte păstrează domenii și receipts exacte; aceste costuri suplimentare cresc cu datele. Nucleul este bounded, adaptorul complet nu este.

Testele și benchmark-urile sunt în `tests/memory-engines.test.js` și `reports/memory/`. Comparația separă completarea directă, interogările inverse cu multe rezultate, precizia, recall-ul, memoria și latența. Timpii de benchmark sunt ai băncilor, nu ai unui dialog complet sau ai salvării unui snapshot după fiecare fapt.
