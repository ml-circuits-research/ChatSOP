# 25. Motorul de referință: algoritmi simpli și inspectabili

## Principiul de implementare

Strategia `reference` folosește generare și testare într-un spațiu finit. Nucleul comun este unificarea atomilor, join-ul premiselor, aplicarea regulilor și căutarea stărilor/candidaților. Nu este un port Prolog complet și nu folosește euristici neuronale. Este un reper lizibil cu care putem compara un engine mai sofisticat fără a schimba programul SOP.

Codul se află în `src/reasoner.js` și `src/reasoning/`. Bugetele sunt explicite. O întrerupere produce rezultat incomplet sau necunoscut; nu poate transforma absența unui răspuns în negație și nu poate produce un binding dintr-un join parțial.

## 1. Deducție, clasificare și timp

Linkerul pornește de la predicatele întrebării, unifică scopuri cu concluziile regulilor, propagă constantele cunoscute și emite cereri de premise. Căutarea din memorie poate fi mai largă decât ar face un optimizer SQL; join-ul final rămâne responsabilitatea reasoner-ului.

Kernelul calculează consecințe până la punct fix. Pentru fiecare regulă, leagă prima premisă cu faptele disponibile, extinde numai bindings compatibile cu următoarea premisă și emite concluzia numai după satisfacerea întregului corp. Variabilele au domeniu finit deoarece nu există simboluri de funcție care construiesc termeni noi. Derivarea păstrează regula și premisele folosite. Dacă bugetul de join se termină înainte de ultima premisă, nu emite concluzii parțiale.

Regulile temporale operează pe intersecția intervalelor premiselor și valabilității regulii. `at` selectează un moment; `during` păstrează intervalele rezultatului. `asof` limitează ce afirmații/corecții erau cunoscute. Negarea este explicită. Există patru situații de bază: susținut, infirmat prin dovadă negativă, susținut în ambele sensuri, necunoscut. Contradicția locală nu autorizează concluzii arbitrare.

Clasificarea exactă este tot deducție: `hot(X) -> needs_attention(X)`. Nu există în acest engine o probabilitate calibrată de apartenență. Clasificarea statistică poate deveni o strategie distinctă ulterior.

## 2. Abducție automată și explicarea observațiilor

Intrarea este o observație ground, plus regulile și premisele relevante. Înaintea căutării, scoatem observația țintă din premisele de explicație: altfel explicația trivială ar fi «este adevărat fiindcă l-am observat». Un fapt deja explicat de alte premise poate primi explicația fără presupuneri suplimentare.

Dacă utilizatorul/procedura a oferit `hypothesis` aprobate, acestea definesc setul de candidați. În lipsa lor, generatorul merge înapoi de la concluzie prin reguli. O premisă ground deja cunoscută nu cere presupunere. O premisă lipsă, pentru care nu mai există regulă de producere, devine ipoteză candidată. Variabilele rămase sunt instanțiate doar din constantele modelului recuperat, cu filtrare integer/symbol. Nu inventăm automat persoane, obiecte sau cauze noi.

Exemplu: `disk_full(X) -> process_crashed(X)` și `process_crashed(X) -> outage(X)`. Pentru `outage(server7)` motorul poate genera `disk_full(server7)`. Pentru o regulă cu două premise lipsă, produce candidații necesari și testarea ulterioară stabilește dacă trebuie folosiți împreună. Generatorul are limite de adâncime și număr de candidați; oprirea sa se propagă la completitudinea rezultatului.

Urmează căutarea prin submulțimi de ipoteze, ordonate după suma costurilor nenegative și numărul de presupuneri. Pentru fiecare submulțime, se recalculează închiderea Horn; observația trebuie să fie derivabilă fără contradicții noi. Sunt păstrate explicațiile minimale prin incluziune, nu toate supramulțimile lor. Două explicații independente pot rămâne valide. Costul este o preferință explicită de căutare, nu probabilitatea ca explicația să fie adevărată.

Acest algoritm este deliberat neoptimizat. Un spațiu mare de abducibile poate necesita multe combinații. Nu este abductive logic programming nelimitat și nu descoperă entități latente din nimic. Avantajul este că presupunerile, costurile și verificarea sunt inspectabile.

## 3. Diagnostic activ

`diagnose` rulează abducția și primește o colecție de teste sub formă de queries ground. Pentru fiecare explicație, simulează rezultatul fiecărui test: susținut, infirmat, ambele sau necunoscut. Numără perechile de explicații pe care un test le separă și sugerează cel mai discriminator.

Este o euristică deterministă de separare, nu calcul bayesian al câștigului informațional. Un rezultat «necunoscut» nu este o măsurătoare. Runtime-ul nu execută testul fizic. Procedura/host-ul cere datele, înregistrează observația nouă cu sursă și repetă diagnosticul. Acesta este punctul de integrare pentru active sensing și tool-uri aprobate.

## 4. Asociere și familiaritate

Candidații sunt `trace` explicite. În modul lexical comparăm seturile de cuvinte normalizate; în modul relațional comparăm seturile de atomi. În modul Weaver proiectăm perechi trace-ID/trăsătură în coloane și calculăm proporția de proiecții susținute pentru indiciu. Catalogul de ID-uri este furnizat explicit; nu este recuperat magic din hash-uri.

Rezultatul este o listă de indicii pentru explorare. El poate sugera o procedură sau un set de abducibile, dar nu devine regulă cauzală. În implementarea curentă banca de scorare a trace-urilor este temporară; nu confundăm acest experiment cu o politică persistentă de mining a întregii memorii.

## 5. Inducție și contraexemple

`induce` primește cazuri și eventual pattern-uri candidate. Fără candidați, generatorul examinează perechi de trăsături din cazuri și construiește un antecedent cu variabile și un consecvent care partajează variabilele. Acest generator are o singură premisă; evaluarea unui pattern furnizat poate avea mai multe premise, în limitele regulilor.

Pentru fiecare binding care satisface antecedentul într-un caz, evaluăm consecventul. Dacă există, incrementăm suportul. Dacă există negația sa explicită, avem contraexemplu. Dacă lipsește și cazul este revizuit drept `closed true`, îl putem trata ca un contraexemplu în acel univers declarat complet. Altfel este necunoscut. Prezența ambelor polarități este raportată separat ca conflict.

Output-ul separă numărul de oportunități, suporturi, contraexemple și necunoscute. Un holdout cu ID-uri de caz distincte este evaluat separat. Lipsa de overlap pe ID nu detectează singură parafraze sau copii de documente: protocolul de date trebuie să prevină și această scurgere.

Niciun pattern nu este publicat automat ca regulă. O regulă inductivă cu 90% suport nu este o implicație logică universală; poate deveni o euristică, o ipoteză de test sau o regulă cu precondiții mai precise. Skill-ul de revizuire decide explicit forma admisibilă.

## 6. Analogie structurală

Engine-ul enumeră mapări injective ale constantelor din cazul sursă către constantele cazului țintă. Evaluează câte relații, cu aceleași predicate și polarități, sunt păstrate. Proprietățile suplimentare sunt transferate numai când constantele lor au o mapare și rezultatul este tot `hypothesis`.

Aceasta testează un mecanism simplu de analogie între subgrafuri. Nu caută metafore, nu învață echivalențe între predicate și nu justifică adevărul proprietăților transferate. Spațiul combinatorial este o limită reală; `maxNodes` trebuie mic pe telefon.

## 7. Planificare

Starea este un set finit de atomi cu polaritate explicită. Precondițiile acțiunilor sunt verificate după închiderea regulilor. Aplicarea elimină efectele `removes`, adaugă efectele `adds` și elimină polaritatea opusă valorilor impuse. Consecințele derivate se recalculează în noua stare, nu sunt copiate ca observații independente.

Frontiera este o listă ordonată după cost cumulat; vizităm stările în ordine de cost și memorăm cel mai mic cost găsit pentru fiecare stare. Costurile nenegative permit căutare uniform-cost. Sunt raportate costul, pașii, bindings și precondițiile. La un buget insuficient păstrăm un plan găsit, dar nu pretindem optimalitate.

Implicit cerem un plan. `maxPlans` permite planuri pentru stări-țintă distincte; motorul nu enumeră toate căile echivalente către aceeași stare. `complete` se referă la obiectivul de căutare declarat, iar `enumerationComplete` spune separat dacă frontiera a fost epuizată. Planul nu trimite comenzi către hardware sau API-uri. Duratele, resursele continue, incertitudinea acțiunilor și planificarea contingentă necesită alte profile sau subcircuite numerice.

## 8. What-if și intervenții cauzale

`whatif` modifică o copie temporară a faptelor și recalculează regulile. Memoria observată, sursele și sesiunile reale nu sunt rescrise. Output-ul este marcat ipotetic.

`counterfactual` are un profil mai precis: reguli Horn deterministe marcate explicit causal. Engine-ul calculează starea factuală, separă valorile endogene produse de reguli de intrările exogene, aplică intervenția, întrerupe regulile care ar impune din nou valoarea intervenită și recalculează efectele aval. O valoare endogenă observată nu poate supraviețui automat unei intervenții ca și cum ar fi input exogen.

Dacă biblioteca relevantă conține reguli obișnuite nemarcate causal, engine-ul cere un modul cauzal explicit. Absența unei concluzii pozitive după intervenție rămâne necunoscut, nu devine automat fals. Pentru «lumina se stinge» trebuie o lege care produce negația, nu doar dispariția regulii care o aprindea.

Nu implementăm aici toate modelele structurale cauzale, variabile latente sau identificarea probabilităților contra-factuale din observații. Profilul este determinist și model-relative; înțelegerea cauzală trebuie furnizată și validată.

## 9. Restricții și optimizare

Motorul JS enumeră asignările din domenii întregi finite și verifică expresiile validate. `possible` caută un model compatibil cu claim; `prove` verifică dacă toate modelele premiselor satisfac claim și dacă premisele sunt coerente. Un model găsit nu este dovadă de unicitate.

`optimize` caută minimul/maximul unei expresii pe modelele care satisfac require și claim. Fără finalizarea căutării, rezultatul este `feasible_bound`, nu `optimal`. Pentru porturi se verifică toate optimele găsite în căutarea completă: valorile diferite rămân ambigue. Costul este produsul dimensiunilor domeniilor, motiv pentru care Z3 poate fi util ulterior.

## Bugete și condiții de corectitudine

Configurația controlează maxNodes, maxDepth, maxCandidates, maxHypotheses, maxPlans, maxFacts, maxJoins, maxRounds, maxAssignments și timeoutMs. Limita temporală este cooperativă între pași; o operație sincronă internă nu este preemptată exact la milisecundă. Pentru endpoint-uri neîncredere, host-ul trebuie să ruleze engine-ul într-un worker/proces cu timeout și memorie limitată.

Corectitudinea este relativă la premisele recuperate, semantica declarată și limita de reprezentare numerică. Testele nu demonstrează exhaustiv corectitudinea tuturor programelor. Un avantaj al acestei implementări mici este că profilurile și traseele sunt deschise auditului, nu ascunse într-o etichetă generică de «inteligență».
