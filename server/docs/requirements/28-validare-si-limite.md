# 28. Validarea implementării și criteriile de extindere

## Ce testează pachetul

`node tools/verify.js` verifică suitele Node, exemplele vechi, linkerul, uitarea, shard-urile, motoarele de memorie, datele de training și formatele Python. `node examples/reasoning-demo.js` rulează aceleași sarcini cu Weaver, Holo, SQLite, scan și hibrid, fiecare cu reference și advanced. Lumile și rezultatele sunt salvate în reports/reasoning; niciun expected answer nu este furnizat runtime-ului drept input.

Matricea acoperă 14 scenarii mici. Ea demonstrează că traseul parser → memorie → linker → interpretor → output/CNL este conectat pentru fiecare familie și strategie. Nu este benchmark de inteligență și nu dovedește performanțe generale sau eficiență la scară. Benchmark-ul separat din reports/memory măsoară motoarele la volume mai mari și are alt protocol. Nu amestecăm cele două seturi de numere.

Rapoartele de verificare curente, nu cifre scrise manual într-un text vechi, sunt autoritare. Fiecare rută arată ce backend s-a executat. Testele externe sunt skip când swipl/z3 lipsesc. Un advanced cu fallback nu constituie măsurătoare Prolog sau Z3.

## Invariante testate

Un pattern nu devine fapt, nici o ipoteză premisă observată. Un model nu poate publica acțiuni, politici sau teorii. Un trace nu este declarat complet de modelul conversațional. O regulă cu premise nesatisfăcute nu produce concluzie la epuizarea bugetului. Un contrast temporal nu este contradicție simultană. O intervenție nu modifică memoria factuală.

Abducția elimină explicația circulară prin observație și păstrează alternativele. Diagnosticul sugerează, nu execută. Planificarea tratează explicit costurile și efectele. Counterfactualul întrerupe legea care ar rescrie valoarea intervenită. Inducția păstrează necunoscutele distincte de contraexemple. Analogiei îi rămâne statutul de transfer candidat. Optimizerul nu exportă drept unic un optimum cu mai multe valori posibile.

În hibrid, distrugerea băncii aproximative nu elimină răspunsurile SQL exacte. Fork-urile, izolarea utilizatorilor și datele temporale continuă să fie verificate de testele existente. Datele formalizatorului sunt executate; asta validează codul gold, nu o predicție neuronală încă neantrenată.

## Experimente care susțin sau infirmă ipotezele

| Ipoteză | Experiment și interpretare |
|---|---|
| Un singur SOP poate servi engine-uri diferite | Teste diferențiale pe profilul Horn/întreg comun; orice divergență semantică neexplicată este un defect, nu o simplă diferență de performanță. |
| Memoria asociativă oferă ceva peste SQL | Același corpus, buget total contabilizat, întrebări incomplete și familii de cazuri; compară recall/precizie/latency. Un avantaj doar după excluderea metadatelor nu este valid. |
| Hibridul ajută explorarea | Exact-only versus exact+hint, cu premise admise identice; măsoară câte candidate trebuie evaluate. Dacă hints nu reduc costul sau cresc ratările, nu se justifică. |
| Abducția este utilă practic | Defecte documentate cu mai multe explicații și teste reale. Măsoară includerea cauzei confirmate în top-k, costul testelor, ipotezele false și rata de clarificare. |
| Inducția descoperă ceva transferabil | Cazuri train, holdout pe alte surse și căutare de contraexemple. Compară cu numărarea simplă exactă; scorul hash nu este ground truth. |
| Procedurile recuperează capacitate cu LLM mic | Introdu proceduri noi după fine-tuning, fără retraining. Verifică selecția și legarea parametrilor, nu doar copierea unui template identic. |
| Formalizarea conservă informația necesară | Compară răspunsurile pe documente originale versus facts extrase; păstrează raw traces pentru re-formalizare și cuantifică sensul pierdut. |
| Planificarea/contra-factualele au utilitate | Taskuri determinate cu stare verificabilă, intervenții controlate și outcome observat. Nu confunda simularea coerentă cu predicția lumii reale. |
| Modelul minuscul poate fi agent conversațional | Holdout românesc scris de oameni, negări/timp/ambiguități/follow-up, CNL versus verbalizer, două adaptoare versus unul. Raportează abținerile și erorile de memorie. |

## Limite explicite ale livrării

Acesta este un prototip integrat pentru cercetare și teste locale, nu un produs certificat. Kernelul implicit este sincron și limitat; un serviciu multi-tenant trebuie izolat în worker/proces, cu autentificare, rate limiting, backup și audit operațional. Testele nu sunt audit de securitate complet. Corpusurile și modelele descărcate au propriile licențe.

Traces și definițiile aprobate se păstrează în biblioteca exactă. Nu există încă un scheduler autonom al buclei lente, un buffer reservoir global pentru toate sursele, ranking învățat calibrat, integrare de execuție a testelor robotice sau promovare autonomă de reguli. Politicile retenției în profilul hibrid nu sunt un optimizer universal separat pentru fiecare componentă.

Interpretoarele nu oferă logică de ordin superior, cuantificare nelimitată, probabilități bayesiene, event calculus complet, planificare stocastică ori un SCM general cu latenți. `theory` și registrele păstrează punctele de extensie; un dialect neimplementat este unsupported. Absența acestor extensii nu împiedică taskurile portabile implementate.

Pentru un release de producție, sunt necesare: solvere externe reale verificate pe arhitectura-țintă; audit al permisiunilor și datelor personale; teste de crash/concurență și restaurare pe corpusul real; măsurare a memoriei totale și a cutoff-urilor; holdout uman NL→SOP; control al versiunilor ontologiei/compilatoarelor; revizuire a regulilor nou-publicate. Cap. 08 descrie experimentul Spark; pachetul nu prezintă acei pași ca fiind deja executați.
