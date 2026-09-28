# 09. Evaluarea care poate susține concluziile

## Straturi distincte

Evaluăm separat parserul, memoria, reasoner-ul, formalizatorul neuronal și verbalizatorul. Un test cu un SOP corect preconstruit nu este un test de înțelegere a românei. Un mock HTTP verifică adaptorul și ordinea operațiilor, nu inteligența modelului.

`node tools/verify.js` execută testele locale, demo-ul, verificarea țintelor, testele de loss masking și dry-run-ul training-ului. Rapoartele identifică backend-urile absente. Rularea nu instalează pachete și nu descarcă greutăți.

## Metrici pentru formalizator

Măsurăm validitatea sintactică, validitatea de schemă, respectarea permisiunilor, echivalența observabilă a execuției și fidelitatea semantică revizuită. Separăm omisiunea faptelor de inventarea lor, alegerea greșită a entității de eroarea de query, timpul greșit de negația greșită. Măsurăm și clarificările justificate versus excesul de abțineri.

```bash
node tools/evaluate-model.js --role formalizer \
  --file data/generated/formalizer/test.jsonl \
  --config config/runtime-shared.json \
  --out reports/formalizer-test.json
```

Evaluatorul execută ținta și programul prezis în sesiuni izolate ale aceleiași lumi și compară statusul, legăturile selectate, intervalele, schimbările de memorie și evenimentele. Nu cere egalitate textuală a programelor. Această verificare finit-observabilă **nu dovedește echivalența logică generală** a două programe. Unele query-uri greșite pot coincide într-o lume săracă; adaugă lumi contraexemplu și revizuire semantică.

`--dry-run` verifică pregătirea și nu raportează accuracy. Păstrează testul decompus pe categorii, inclusiv „posibil versus demonstrat”, negație, retractare, context ambiguu și follow-up.

## Metrici pentru memorie și reasoning

Măsurăm tuplele corect reconstruite, false completions, abținerile, recuperarea incompletă, probele și latența. Separăm profilul asociativ de profilul cu recepții. Costul total include bănci, domenii și metadate. Pentru derivări păstrăm proveniența și intervalul comun al premiselor. Testăm update urmat de query, query `asof` și conflicte fără explozie.

Backend-urile se verifică diferențial pe domeniul comun. Prolog nu trebuie să „uite” timpul. Z3 trebuie să distingă satisfiabilitate, demonstrație și inconsistență. Niciun timeout nu devine răspuns negativ. Rulează aceleași teste cu bugete foarte mici pentru a verifica statusul incomplet.

## Metrici pentru verbalizator

```bash
node tools/evaluate-model.js --role verbalizer \
  --file data/generated/verbalizer/test.jsonl \
  --config config/runtime-shared.json \
  --out reports/verbalizer-test.json
```

Raportul păstrează CNL și textul generat pentru audit. Euristica numeralelor noi este doar un detector parțial. Revizuirea trebuie să verifice toate entitățile, polaritatea, intervalele, incertitudinea și faptul că răspunsul este ipotetic. Nu dăm un scor automat de „adevăr” reformulării libere pe baza unui regex.

## Protocolul comparativ propus

Comparația relevantă este același set de sarcini pe modelul mic singur, modelul mic plus SOP/memorie/reasoner și un model mai mare. Include și model mare cu acces la aceleași instrumente, pentru a nu atribui dimensiunii modelului un avantaj provenit doar din acces la memorie. Bugetele, sursele și query-urile trebuie să fie comparabile. Raportează memoria personală, exactitatea logică și conversația naturală separat.

Benchmark-ul inițial poate avea câteva sute de dialoguri RO scrise de oameni, distribuite între însușirea unor fapte, schimbări temporale, reguli și întrebări numerice. Fiecare dialog are răspuns formal și surse. Scorurile agregate trebuie însoțite de intervale de încredere și de erorile individuale relevante, nu doar de procentul favorabil.

## Criterii propuse de acceptare

Un obiectiv de inginerie, nu rezultat deja obținut: toate țintele aprobate executabile; zero scrieri neautorizate în testele adversariale; explicit unknown pentru date insuficiente; rată foarte mică de schimbări semantice la negare și timp; zero presupunere de identitate din nume ambiguu. Pragurile numerice de acuratețe și latență se stabilesc înaintea tuning-ului pe date reale, în funcție de aplicație.

Nu declarăm că un model de 270M bate modele mai mari până când aceste controale au fost executate. Potențialul experimentului stă tocmai în posibilitatea de a atribui câștigul fiecărei componente.

## Ieșiri generate și strategiile interschimbabile

Evaluează separat semnătura scopului, selectarea variabilelor, modul `one/many/rows`, valorile exportate, abținerea la ambiguitate și lipsa efectelor în ramurile blocate. Un SOP parsabil care exportă o valoare greșită nu este succes. În probleme numerice, un martor posibil nu este automat valoare determinată.

Rulează același circuit și aceleași snapshot-uri cu `recall-weaver`, `exact` și `hybrid`. Măsoară memoria totală, probele, latența, premisele recuperate, completitudinea și răspunsurile finale. Dacă strategia exactă produce avantajul, nu îl atribui Recall Weaver. Demo-ul cu corpus mic verifică contractul, nu dovedește avantaj de scalare. Un backend absent este sărit, nu echivalat cu un test diferențial reușit. Protocoalele detaliate sunt în `15-experiment-linker.md`.
