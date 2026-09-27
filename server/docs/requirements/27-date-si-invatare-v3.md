# 27. Date, învățare și fine-tuning pentru profilul v3

## Ce antrenăm

Formalizatorul învață să distingă afirmația, întrebarea, ipoteza, explicația, planul, comparația numerică și cererea de exemplu similar. El selectează simbolurile din shortlist și compune/instanțiază SOP. Nu este antrenat să scrie explicații abductive ca și cum le-ar fi observat și nu decide instalarea unor reguli sau politici.

Verbalizatorul primește CNL și produce text fără schimbarea cantităților, negației, ipotezelor, valabilității sau completitudinii. Pachetul permite inițial dezactivarea sa: CNL direct este suficient pentru verificarea formalizatorului. Un rezultat fluent nu trebuie să ascundă o formalizare greșită.

## Datele executabile incluse

`tools/build-data.js` construiește setul complet. Apelează generatorul factual existent și adaugă lumi pentru deducție, clasificare, temporalitate, constraints, optimizare, abducție cu candidați, abducție automată, diagnostic, asociere, inducție, analogie, planificare, what-if și intervenții cauzale. Setup-ul conține cunoașterea aprobată; ținta modelului conține numai comanda SOP și obiectele neautorizante necesare.

```bash
node tools/build-data.js --worlds 30 --seed 731 --out data/seed
node tools/check-data.js --dir data/seed --execute
node tools/check-data.js --dir data/seed --execute --engine hybrid
```

`data/seed/manifest.json` conține numărul real de rânduri și checksum-urile parserului și promptului. Split-ul este făcut pe lumi. Template-urile de limbaj sunt reutilizate, deci acest split testează transferul la alte entități/valori, nu generalizarea la orice construcție lingvistică nevăzută. Parafrazele profesorului trebuie să rămână în split-ul lumii inițiale. Prompt-urile identice sunt deduplicate, inclusiv între split-uri.

Datele noi ale verbalizatorului includ seed-uri conservatoare de tip identitate CNL. Sunt marcate `identity-CNL`; reprezintă o bază sigură de generat parafraze, nu un corpus final de conversație naturală. Celelalte seed-uri conservă explicit statusurile logice. Nu pretindem că datele generate programatic au fost validate semantic de oameni în toate formulările.

## Protocolul profesorului și al coding agentului

Profesorul primește un exemplu semantic și produce mai multe formulări NL cu același înțeles. Dacă schimbă «este posibil» în «este garantat», «am observat» în «presupun» sau «la data X» în «acum», ținta SOP trebuie schimbată și exemplul revizuit; nu este o simplă parafrază.

Generarea trebuie să includă sinonime românești, diacritice și erori de tastare, contexte scurte, ambiguități de pronume, entități omonime, întrebări istorice și corecții tardive. Fiecare familie nouă are și exemple negative: cauza nu este confirmată, pattern-ul are necunoscute, planul nu s-a executat, counterfactualul nu este observație, un optimum nu este unic, lipsa dovezii nu este negație.

Coding agentul poate crea și documente + întrebări + SOP ground truth, dar trebuie să păstreze textele sursă. Afirmațiile extrase au citate verificabile. Rule/procedure/action/policy/theory trec prin revizuire înainte de publicare. `closed true` al unui trace este o afirmație despre completitudinea cazului și nu poate fi auto-certificat de modelul conversațional.

Pentru inducție, construiește familii de cazuri cu suport, contraexemple, excepții și date lipsă. Separă lumea, documentul, autorul și șablonul între train/dev/test unde este posibil. Pentru abducție, include observații cu explicații alternative, necesitatea a două presupuneri, fapte contradictorii și lipsa unei explicații în vocabularul permis.

## Contextul mic

Modelul nu primește tot catalogul wire types și toată biblioteca pentru fiecare mesaj. Resolverul și procedurile selectate furnizează doar simbolurile și definițiile relevante. Promptul general inclus este un reper complet; pe un model extrem de mic trebuie comparat cu prompturi per familie sau cu retrieval de exemple SOP. Nu eliminăm informația despre semnificația unui predicat doar ca să încadrăm inputul.

`training/audit_tokens.py` verifică lungimile cu tokenizerul real. `encode_row` refuză trunchierea silențioasă. Configurația de start folosește max_length 4096; nu este o garanție că fiecare corpus generat ulterior încape. Redu shortlist-ul/procedura sau mărește contextul permis după audit, înaintea antrenării.

## Fine-tuning pe Spark

Ghidul hardware și comenzile de antrenare/export sunt în capitolul 08. `config/train-gemma.json` și `train-qwen.json` rămân opțiunile pregătite; calitatea pe română a unui model foarte mic trebuie demonstrată pe benchmark-ul proiectului. Acest pachet nu include greutăți și nu a executat fine-tuning GPU.

```bash
python training/preflight.py
python training/audit_tokens.py --help
python training/train.py --role formalizer --data data/seed --config config/train-gemma.json --output outputs/formalizer
python training/train.py --role verbalizer --data data/seed --config config/train-gemma.json --output outputs/verbalizer
```

Pentru primul test de antrenare limitează rândurile conform opțiunilor `--help`; apoi păstrează configurația, reviziile modelelor și checksum-urile. `revision: main` este doar default de descărcare: fixează hash-ul rezolvat în experimentul publicat. Nu deduce dintr-un loss mic că reasoner-ul sau limba română sunt corecte.

## Evaluarea semnificației

`tools/evaluate-model.js` execută programul gold și predicția în sesiuni separate. Semnătura include acum ipotezele și costurile, testele propuse, planurile și efectele, statisticile pattern-urilor, mapările analogice, intervențiile, optimum-ul și porturile, nu numai un status generic. Compararea pe o lume finită nu este demonstrația echivalenței tuturor programelor; de aceea fiecare intenție trebuie testată pe mai multe lumi și pe contraexemple.

Pentru un rezultat neuronal publicabil, raportează separat: validitate sintactică, alegerea simbolurilor, echivalență executabilă, răspuns corect, abținere corectă, persistență neautorizată, fidelitate NL și latență totală. Compară strategiile de memorie la formalizare fixă, apoi strategiile de reasoning la premise fixe. Numai după aceea compară agentul întreg cu alte modele cu acces egal la date și tool-uri.
