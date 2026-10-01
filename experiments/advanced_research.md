# VRC — program de cercetare și verificare

**Revizie documentară 0.3-R1 · 1 octombrie 2026 · runtime păstrat: v0.3.0.**

## Ce conține acest catalog

Sunt **48 de direcții**, fiecare cu o ipoteză testabilă, starea actuală, date și separarea loturilor, plan de implementare/experiment, comparatori, metrici, criterii de susținere sau infirmare, dependențe și regresii de adăugat. Acoperă direcțiile formulate în această sesiune, limitele auditate ale pachetului și extensii conexe explicit marcate. Nu pretinde enumerarea exhaustivă a tuturor ideilor matematice posibile.

**Toate fișele sunt protocoale viitoare, cu status `PLANNED`.** Câmpul „starea actuală” arată ce există deja; legăturile spre cod/rapoarte oferă context, nu probe că experimentul nou a fost executat. Ramurile G și o parte din H sunt exploratorii și nu fac parte din runtime. Pachetul nu implementează prin această documentare costuri ponderate, politici adverse, probabilități, leme noi ori ingestie NL.

Forma machine-readable este [catalog.json](../research/catalog.json). [Protocolul comun](RESEARCH_PROTOCOL_RO.md) definește gate-urile S1–S6, costurile complete și interpretarea rezultatelor. [Harta de acoperire](RESEARCH_COVERAGE_RO.md) leagă discuția inițială și limitele codului de aceste fișe.

## Ce ar conta ca progres

Nu cerem o comprimare inaccesibilă tuturor metodelor existente. Eficiența semnificativă pe un domeniu bine definit, un mecanism comun care recuperează capacități ale unor specialiști, compoziția verificată și acumularea de calcul reutilizabil sunt contribuții candidate independente. Reprezentabilitatea, învățarea efectivă, certificarea și utilitatea economică se măsoară separat.

Ipoteza arhitecturală comună: **experiența poate produce o bibliotecă de reprezentări, interfețe și proceduri verificate, care reduce efortul viitor de reasoning fără a modifica nejustificat cunoașterea sursă.** VRC v0.3 susține experimental numai o parte: reprezentări numerice, căutare bounded cu cost unitar, integrare relațională și persistență pe contracte compatibile.

## Ordinea recomandată, fără a bloca pilotul

| Etapă | Direcții | Rezultat de decizie |
|---|---|---|
| 0 — preluare și audit | R01, R05, R31, R36 | Taskuri reale eligibile, statusuri corecte, trasabilitate și fallback. Nu este nevoie de implementarea tuturor direcțiilor. |
| 1 — demonstrarea utilității | R02, R03, R04, R18, R28 | Cost net, distribuția beneficiului și comparatorii potriviți; decide unde activăm VRC. |
| 2 — generalizarea învățării | R06, R07, R14, R16, apoi R08/R09/R15 | Acoperire mai mare sau pregătire mai ieftină, păstrând vechile teste. |
| 3 — o singură extensie semantică prioritară | R17 sau R21/R22/R23/R24/R25/R27, după taskurile reale | Contract și verifier înaintea optimizării; fără introducerea simultană a tuturor mecanismelor. |
| 4 — cercetare exploratorie | R37–R44, apoi conexiunile R45–R48 relevante | Redescoperiri controlate și comparații care pot justifica o nouă ramură, nu promisiuni de universalitate. |

Prioritățile P0–P3 sunt orientative. Dependențele din fișe descriu ordinea minimă a contractelor și evaluării, nu impun un calendar sau o echipă. O ramură poate fi oprită după rezultate negative, păstrând datele și contraexemplele. Costurile de cercetare și consolidare pot fi mari dacă beneficiul reutilizării le amortizează; acest lucru se măsoară, nu se presupune.

## Cum se folosește o fișă

Alege o direcție pornind de la un task sau un contraexemplu concret. Completează protocolul și îngheață lotul de test. Adaugă testele de regresie propuse când implementezi extensia. Rulează apoi comparațiile; nu modifica statusul în rezultat fără cod, date și log. Criteriile numerice sunt propuneri de protocol, nu performanțe deja obținute. Pentru toate fișele, bugetul epuizat, lipsa unui comparator compatibil sau a unui certificat necesar impun verdictul INCONCLUSIVE, nu o concluzie de imposibilitate. Orice rezultat rămâne limitat la familia și bugetul testate.

## Index

| ID | Direcție | Prioritate | Grup |
|---|---|---|---|
| [R01](#r01) | Pilot pe taskuri reale, fără selecția ulterioară a cazurilor favorabile | P0 | A |
| [R02](#r02) | Comparații externe echitabile și atribuirea contribuției VRC | P0 | A |
| [R03](#r03) | Selector automat: off, reuse, discover sau defer | P0 | A |
| [R04](#r04) | Multe reguli active și interacțiuni eterogene, nu numai fapte de fundal | P1 | A |
| [R05](#r05) | Audit adversarial, metamorphic testing și verificator independent | P0 | A |
| [R06](#r06) | Sinteză comună a encoderului și regulilor, fără expandare brută obligatorie | P1 | B |
| [R07](#r07) | Sinteză ghidată de contraexemple și experimente discriminante | P1 | B |
| [R08](#r08) | Învățarea constructorilor de reprezentări, nu numai a artefactelor | P2 | B |
| [R09](#r09) | O formă comună tipată pentru mai multe familii de reprezentări | P2 | B |
| [R10](#r10) | Simetrii globale și canonizare dincolo de coloane identice | P2 | B |
| [R11](#r11) | Date zgomotoase și reprezentări aproximative cu statut distinct | P2 | B |
| [R12](#r12) | Observare parțială: reprezentarea trebuie să includă memorie | P2 | B |
| [R13](#r13) | Invariante inductive și certificate condiționate de domeniul accesibil | P2 | B |
| [R14](#r14) | Transfer verificat prin redenumire, scalare și parametri | P1 | B |
| [R15](#r15) | Module descoperite, interfețe minime și compoziție ierarhică | P1 | C |
| [R16](#r16) | Contracte multiple și rafinare incrementală pentru întrebări noi | P1 | C |
| [R17](#r17) | Lumi relaționale mutable și întreținerea incrementală a adevărului | P2 | C |
| [R18](#r18) | Reasoning goal-directed general și execuție numerică în loturi | P1 | C |
| [R19](#r19) | Memorie externă, indexuri și recuperare în două etape | P2 | C |
| [R20](#r20) | Euristici admisibile, dominanță și macro-acțiuni învățate | P2 | D |
| [R21](#r21) | Costuri ponderate, durate și obiective multiple | P2 | D |
| [R22](#r22) | Nedeterminism adversarial și politici, nu numai trasee existențiale | P2 | D |
| [R23](#r23) | Probabilități și mase de tranziție conservate | P2 | D |
| [R24](#r24) | Numărarea exactă a planurilor, dovezilor și soluțiilor | P2 | D |
| [R25](#r25) | Temporalitate, termene și proprietăți despre istorii | P2 | D |
| [R26](#r26) | Rafinare a abstracției în timpul căutării | P2 | D |
| [R27](#r27) | Abducție și contrafactuale cu ipoteze explicit separate | P2 | D |
| [R28](#r28) | Dreaming cu buget și distribuție de taskuri schimbătoare | P1 | E |
| [R29](#r29) | Leme relaționale și macro-demonstrații învățate din urme | P2 | E |
| [R30](#r30) | Memorie de capabilități: retenție, uitare și fork-uri | P2 | E |
| [R31](#r31) | Registry robust: read-only, concurență și recuperare după crash | P1 | E |
| [R32](#r32) | Certificate portabile și verificare cu nucleu independent | P2 | E |
| [R33](#r33) | Aritmetică adaptivă cu erori certificate și chei de stare sigure | P1 | F |
| [R34](#r34) | Batching, paralelism și portabilitate CPU/ARM/accelerator | P2 | F |
| [R35](#r35) | Complexitate a descoperirii și limite de resurse explicite | P1 | F |
| [R36](#r36) | Securitate, proveniență și date private în traseul de învățare | P1 | F |
| [R37](#r37) | Algebre care anulează automat combinațiile invalide | P3 | G |
| [R38](#r38) | Redundanță semantică și raționament de tip corectare a erorilor | P3 | G |
| [R39](#r39) | Abstracții comportamentale din teste și factorizare Hankel | P3 | G |
| [R40](#r40) | Ordine, semnături de secvențe și compoziție necomutativă | P3 | G |
| [R41](#r41) | Concepte ca operatori: descoperirea coordonatelor operațiilor | P3 | G |
| [R42](#r42) | Compatibilitate între perspective locale și defecte globale | P3 | G |
| [R43](#r43) | Compilare de familii de posibilități și contracție tensorială | P3 | G |
| [R44](#r44) | Ruliologie executabilă: căutare comună în reguli și reprezentări | P3 | G |
| [R45](#r45) | Propuneri neuronale sau LLM, verificare simbolică obligatorie | P2 | H |
| [R46](#r46) | Ingestie NL→SOP și verificarea fidelității formalizării | P3 | H |
| [R47](#r47) | Statute epistemice, contradicții și dependențe de surse | P2 | H |
| [R48](#r48) | Abstracții relaționale și transfer de roluri între domenii | P3 | H |

## A. Validare, comparatori și utilitate pe taskuri reale

<a id="r01"></a>
### R01 — Pilot pe taskuri reale, fără selecția ulterioară a cazurilor favorabile

**Prioritate:** P0 · **Experiment:** PLANNED · **Dependențe:** gate-urile comune; nu are dependență de o altă extensie

**Starea actuală.** Există VRCStrategy, execuție shadow și exemple sintetice. Nu există în pachet rezultate din mediul gazdei.

**Ipoteza.** Pe un subset identificabil înaintea testului, reutilizarea reprezentărilor reduce costul total al reasoning-ului repetat fără schimbarea răspunsului sau a garanțiilor.

**Date și separarea loturilor.** Țintă de colectare: 300 taskuri autorizate, din minimum trei fluxuri reale compatibile cu semantica actuală; split cronologic 100 dezvoltare / 100 calibrare / 100 test. Dacă nu există suficiente taskuri, se raportează un pilot mic, nu o confirmare. Se păstrează taskurile fără reducere și cele cu date lipsă.

**Plan de implementare și verificare.**

1. Instrumentează separat încărcarea, selecția, lookup-ul, certificarea, search-ul și replay-ul; rulează inițial shadow pe cazurile mici.
2. Fixează politica de activare pe primele două intervale; pe intervalul final nu regla praguri și nu elimina eșecurile.
3. Compară execuția completă, structurală și VRC pe aceleași taskuri; verifică exact răspunsurile compatibile și replay-ul fiecărui plan pozitiv.

**Comparatori și ablații.** Același motor cu VRC off; Aceeași optimizare logică fără reducere numerică; Reuse cu registry gol versus încălzit.

**Metrici.** Rată de taskuri eligibile și HIT; Timp total rece/cald și p50/p95; Memorie maximă, cost dreaming, răspunsuri UNKNOWN/BUDGET; Dezacord semantic și martori invalizi.

**Criteriu de susținere.** Zero dezacorduri pe cazurile decidate exact; pentru subsetul fixat, limita inferioară a intervalului de încredere pentru economia totală este pozitivă. Se raportează și rezultatul pe toate taskurile, inclusiv costul bypass-ului.

**Ce ar infirma ipoteza în domeniul testat.** Un răspuns exact greșit blochează promovarea; dacă economia dispare după includerea pregătirii sau aproape niciun task nu este eligibil, ipoteza de utilitate în acea distribuție nu este susținută.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Fapte noi → același artefact, răspuns recalculat; Task neeligibil → fallback cu motiv; Shadow nu validează un timeout al referinței ca echivalență.

**Puncte de pornire existente.** [docs/HANDOVER_RO.md](../docs/HANDOVER_RO.md) · [src/strategy.mjs](../src/strategy.mjs) · [examples/host-integration.mjs](../examples/host-integration.mjs) · [test/handover-core.test.mjs](../test/handover-core.test.mjs)

**Artefact viitor.** `research/runs/R01/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r02"></a>
### R02 — Comparații externe echitabile și atribuirea contribuției VRC

**Prioritate:** P0 · **Experiment:** PLANNED · **Dependențe:** R01

**Starea actuală.** Pachetul conține comparatori proprii și un adaptor SWI opțional; comparația externă completă nu a fost executată.

**Ipoteza.** Avantajul VRC rămâne măsurabil pe unele familii relevante când referința este optimizată și semantica este aceeași; în paralel, unificarea poate rămâne valoroasă chiar unde specialistul este mai rapid.

**Date și separarea loturilor.** Corpus fixat cu 12 familii, minimum 30 instanțe/familie, incluzând no-reduction, recursie, compilare rece, planificare și query numeric. Exporturile acceptate trebuie să aibă aceleași domenii finite, obiective și aritmetică; celelalte se marchează INCOMPATIBLE.

**Plan de implementare și verificare.**

1. Adaugă contracte de traducere și verificare a mulțimilor de răspunsuri; separă benchmarkurile Datalog de cele ale plannerului.
2. Integrează motoare externe disponibile și versiuni fixate; pentru numeric compară și cu kernelul complet compilat, reducere structurală și, unde sunt compatibile, metode de reducere existente.
3. Intercalează execuțiile, numără costurile de conversie, preprocesare și dovezi; publică matricea acoperire–cost–garanții, nu un singur scor.

**Comparatori și ablații.** SWI-Prolog cu tabling și/sau Soufflé pe subsetul logic compatibil; Planner extern pe subsetul finit cu același obiectiv; EDMD redus / regresie integrală / reducere exactă unde accesul la date și model permite; Ablation: exact aceeași căutare, numai E diferă.

**Metrici.** Timp total și throughput; Acoperire semantică; Număr de stări și operații; Costul exportului, conversiei și preprocesării.

**Criteriu de susținere.** Beneficiu reproductibil pe o clasă definită sau acoperire comună semnificativă cu cost declarat. Nu se cere câștig contra fiecărui specialist.

**Ce ar infirma ipoteza în domeniul testat.** Câștigul apare numai contra unei referințe neoptimizate sau cu altă semantică; unificarea este doar un selector manual care invocă specialiștii.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Export/import cu numere exacte; Aceeași negare și acoperire; SKIPPED nu intră în mediana performanței.

**Puncte de pornire existente.** [experiments/external.mjs](../experiments/external.mjs) · [src/swi.mjs](../src/swi.mjs) · [docs/REFERENCES.md](../docs/REFERENCES.md) · [docs/PROTOCOL.md](../docs/PROTOCOL.md)

**Artefact viitor.** `research/runs/R02/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r03"></a>
### R03 — Selector automat: off, reuse, discover sau defer

**Prioritate:** P0 · **Experiment:** PLANNED · **Dependențe:** R01

**Starea actuală.** Politicile sunt alegeri explicite ale gazdei; frecvența urmelor nu demonstrează automat rentabilitatea.

**Ipoteza.** Un selector bazat pe caracteristici ieftine și costuri măsurate evită recompilarea nerentabilă și păstrează cea mai mare parte a economiei disponibile.

**Date și separarea loturilor.** Replay cronologic al pilotului R01 plus 600 taskuri sintetice cu orizonturi, rate HIT, modificări de reguli și amplitudini diferite; calibrare și test pe fluxuri distincte.

**Plan de implementare și verificare.**

1. Înregistrează număr de coordonate, acțiuni, grad, frecvență și costuri fără să rulezi căutarea completă doar pentru a decide.
2. Antrenează sau calibrează o regulă transparentă de decizie; păstrează fallback-ul și bugete separate pentru explorare.
3. Evaluează regretul față de un oracle retrospectiv și costul propriu al selectorului; include familii fără economie.

**Comparatori și ablații.** Always off; Always on-demand; Reuse-only; Prag fix frecvență × cost; Oracle retrospectiv, etichetat neimplementabil online.

**Metrici.** Regret cumulat în milisecunde; Slowdown p95; Costul selectorului; Economia netă cu toate încercările eșuate.

**Criteriu de susținere.** Țintă propusă: cel puțin 80% din economia pozitivă a oracle-ului pe fluxul de test și cel mult 10% slowdown p95 pe no-benefit; pragurile se îngheață înaintea măsurării.

**Ce ar infirma ipoteza în domeniul testat.** Selectorul cheltuie mai mult decât economisește sau învață numai eticheta generatorului; schimbarea distribuției produce încetiniri persistente.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Cost estimat negativ → bypass; MISS repetat în același buget nu reîncepe discovery; Selectorul nu modifică verdictul semantic.

**Puncte de pornire existente.** [src/strategy.mjs](../src/strategy.mjs) · [src/learning.mjs](../src/learning.mjs) · [docs/LEARNING_AND_DREAMING.md](../docs/LEARNING_AND_DREAMING.md)

**Artefact viitor.** `research/runs/R03/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r04"></a>
### R04 — Multe reguli active și interacțiuni eterogene, nu numai fapte de fundal

**Prioritate:** P1 · **Experiment:** PLANNED · **Dependențe:** R01

**Starea actuală.** Benchmarkul mare conține multe fapte irelevante și șabloane repetitive; selecția fragmentelor este testată pe câteva familii numerice.

**Ipoteza.** Extracția și reutilizarea rămân utile când o proporție importantă din cunoaștere contribuie efectiv la întrebare, iar modulele nu au toate aceeași lege.

**Date și separarea loturilor.** Grilă propusă: 10^4, 10^5 și 10^6 fapte; 20, 50 și 100 șabloane diferite; fracții active 1%, 10%, 50%; cuplare rară și densă. Se limitează numărul de combinații prin protocol, nu se omite post-hoc cazul greu.

**Plan de implementare și verificare.**

1. Generează reguli și fapte SOP cu dependențe controlate, plus un evaluator mic independent.
2. Măsoară întâi selectorul și limitele actuale de fragment; cazurile peste limită trebuie să refuze explicit, nu să pretindă suport.
3. Compară scaling-ul pentru încărcare, indexare, extragere, modelare și query; repetă pe un corpus de gazdă redactat.

**Comparatori și ablații.** Reasoner indexat fără VRC; Slicing fără reducere; Module furnizate de generator, oracle de structură etichetat.

**Metrici.** Fracție de reguli realmente executate; Mărimea interfețelor; Timp și RAM pe fiecare fază; Rată de cache reutilizabil și buget epuizat.

**Criteriu de susținere.** Curbe de scalare reproductibile și beneficii pe un regim cu legi diferite, nu numai pe reguli inactive; identitatea răspunsurilor se păstrează.

**Ce ar infirma ipoteza în domeniul testat.** Reducerea dispare la interacțiuni moderate sau extragerea domină toate economiile; limita este raportată ca frontieră de utilizare.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Adăugarea unei dependențe unește modulele necesare; Fondul irelevant nu schimbă concluzia; Reguli active rare nu sunt eliminate din greșeală.

**Puncte de pornire existente.** [src/numeric.mjs](../src/numeric.mjs) · [experiments/large.mjs](../experiments/large.mjs) · [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) · [docs/LIMITS.md](../docs/LIMITS.md)

**Artefact viitor.** `research/runs/R04/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r05"></a>
### R05 — Audit adversarial, metamorphic testing și verificator independent

**Prioritate:** P0 · **Experiment:** PLANNED · **Dependențe:** gate-urile comune; nu are dependență de o altă extensie

**Starea actuală.** v0.3 a corectat coliziuni numerice și martori de mod; testele nu reprezintă o demonstrație de absență a altor defecte.

**Ipoteza.** Verificarea independentă și generarea sistematică a contraexemplelor reduc riscul ca aceleași erori să fie partajate de learner și evaluator.

**Date și separarea loturilor.** 10.000 micro-lumi finite, raționale mici și mari, nume permutate, praguri de frontieră și artefacte mutate; seed-urile și mutațiile sunt fixate înaintea rulării.

**Plan de implementare și verificare.**

1. Scrie un oracle lent independent pentru cazurile mici; nu reutiliza codul de canonizare VRC în acest oracle.
2. Aplică transformări metamorfice: redenumire, permutare de fapte, adăugare de variabile irelevante, scalare rațională inversabilă.
3. Fă mutation testing pe certificat, guard, obiectiv și chei; păstrează fiecare defect minimizat ca fixture permanent.

**Comparatori și ablații.** Oracle exhaustiv independent; Runtime complet existent; Checker existent fără noua verificare.

**Metrici.** Dezacorduri; Mutații detectate versus mutații semantice reale; Acoperire de clase de eroare; Cost de verificare.

**Criteriu de susținere.** Zero erori pe oracolele finite; toate mutațiile care schimbă o obligație certificată sunt respinse sau produc un contraexemplu explicit.

**Ce ar infirma ipoteza în domeniul testat.** Un model greșit trece ambele verificări dintr-o eroare comună; testele metamorfice schimbă planul minim sau adevărul unei condiții.

**Regresii de adăugat — nu sunt implementate prin această fișă.** 0 diferă de 1/10^13; Valori peste 2^53; Root-goal cu stopAtGoal false; Ramură logică exactă în replay; Cost necunoscut respins.

**Puncte de pornire existente.** [test/handover-core.test.mjs](../test/handover-core.test.mjs) · [docs/SAFETY_AUDIT_03.md](../docs/SAFETY_AUDIT_03.md) · [src/exact-runtime.mjs](../src/exact-runtime.mjs) · [docs/REGRESSION_PROPERTIES.md](../docs/REGRESSION_PROPERTIES.md)

**Artefact viitor.** `research/runs/R05/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

## B. Descoperirea reprezentărilor și generalizarea mecanismului

<a id="r06"></a>
### R06 — Sinteză comună a encoderului și regulilor, fără expandare brută obligatorie

**Prioritate:** P1 · **Experiment:** PLANNED · **Dependențe:** R05

**Starea actuală.** Există propuneri multiplicative și aditive; în linia data-only, unele etape estimează întâi expresii în coordonatele originale.

**Ipoteza.** Căutarea directă în DAG-uri de expresii partajate recuperează reduceri compacte cu un cost mai mic decât expandarea unei baze polinomiale complete.

**Date și separarea loturilor.** Familii cu a^5, sume de puteri șase, produse de forme liniare și compoziții de grad crescător; 30 instanțe/familie. Familii de compoziții ținute complet separat de dezvoltare, nu numai coordonate noi.

**Plan de implementare și verificare.**

1. Introdu noduri comune de sumă/produs/putere și un buget de dimensiune DAG, păstrând certificat exact după substituție.
2. Caută simultan E și G; măsoară separat gramatică expresivă versus succesul algoritmului.
3. Compară cu propunerile existente și dicționare extinse până la același buget de timp și RAM.

**Comparatori și ablații.** Learner v0.3; Regresie cu dicționar extins; Enumerare DAG fără ghidaj; Reprezentare-martor furnizată numai evaluatorului.

**Metrici.** Acoperirea soluțiilor admisibile; Noduri DAG/monomiale intermediare; Discovery time/RAM; Costul certificatului și inferenței.

**Criteriu de susținere.** Recuperarea atât a martorului a^5, cât și a sumei de puteri, fără răspunsuri preintroduse; economie sau acoperire mai bună la buget egal pe familii held-out.

**Ce ar infirma ipoteza în domeniul testat.** Câștigul provine exclusiv din creșterea bugetului sau din șabloane care codifică răspunsul; expandarea finală anulează economia.

**Regresii de adăugat — nu sunt implementate prin această fișă.** a^5 → generatoare echivalente cu a^2,a^3; Sumă a^6+b^6+c^6; Expresie admisibilă negăsită rămâne NO_MODEL, nu IRREDUCIBLE.

**Puncte de pornire existente.** [vendor/vrc/src/proposals.mjs](../vendor/vrc/src/proposals.mjs) · [docs/MECHANISMS.md](../docs/MECHANISMS.md) · [history/reports/ml.md](../history/reports/ml.md) · [history/reports/uni.md](../history/reports/uni.md)

**Artefact viitor.** `research/runs/R06/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r07"></a>
### R07 — Sinteză ghidată de contraexemple și experimente discriminante

**Prioritate:** P1 · **Experiment:** PLANNED · **Dependențe:** R05, R06

**Starea actuală.** Certificatele exacte există; bucla generală de selecție activă a stărilor care diferențiază propuneri nu este implementată.

**Ipoteza.** Contraexemplele orientate către ambiguitatea reprezentării reduc numărul propunerilor și observațiilor necesare față de eșantionarea neghidată.

**Date și separarea loturilor.** 100 lumi cu perechi de stări confundabile de candidați greșiți; exemplu: aceeași sumă, produse diferite. Date-only și rule-oracle sunt două piste distincte.

**Plan de implementare și verificare.**

1. Construiește din diferența E(T(x))−G(E(x)) o obligație verificabilă și caută un martor rațional în domeniul declarat.
2. Adaugă martorul setului de identificare și revizuiește reprezentarea; în pista data-only cere observația simulatorului pentru starea selectată.
3. Repetă până la certificat sau buget; ablație cu același număr de stări aleatoare.

**Comparatori și ablații.** Același generator de candidați fără feedback; Sampling uniform; Sampling bazat numai pe eroarea de predicție.

**Metrici.** Propuneri respinse până la succes; Apeluri oracle; Timp total inclusiv găsirea contraexemplului; Rate de certificat.

**Criteriu de susținere.** Reducere repetabilă a costului total sau a apelurilor oracle pe date held-out, fără a schimba gramatica sau bugetul în favoarea metodei.

**Ce ar infirma ipoteza în domeniul testat.** Găsirea contraexemplelor costă mai mult decât economisește ori martorii sunt în afara domeniului fizic/formal declarat.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Sumă egală, produs diferit; Contraexemplu la un guard eliminat; Buget fără martor nu dovedește identitatea.

**Puncte de pornire existente.** [docs/MECHANISMS.md](../docs/MECHANISMS.md) · [vendor/vrc/test/core.test.mjs](../vendor/vrc/test/core.test.mjs)

**Artefact viitor.** `research/runs/R07/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r08"></a>
### R08 — Învățarea constructorilor de reprezentări, nu numai a artefactelor

**Prioritate:** P2 · **Experiment:** PLANNED · **Dependențe:** R06, R07

**Starea actuală.** Registry-ul păstrează encodere găsite; familiile operatorilor de propunere sunt scrise manual.

**Ipoteza.** Experiența poate extrage constructori compoziționali reutilizabili care accelerează descoperirea pe legi noi, fără a mări gramatica la test.

**Date și separarea loturilor.** Curriculum cu cel puțin 10 familii de legi; leave-family-out și leave-composition-out, nu doar redenumiri. Constructorii și modelul de selecție se îngheață înaintea testului.

**Plan de implementare și verificare.**

1. Minează sub-DAG-uri recurente din reprezentări certificate și generalizează parametrii în șabloane tipate.
2. Păstrează condițiile de aplicabilitate; un constructor produce candidați, nu dovezi gratuite.
3. Compară pornirea rece, biblioteca fixă și biblioteca învățată pe același set de legi noi; include costul extragerii constructorilor.

**Comparatori și ablații.** Operatori manuali v0.3; Bibliotecă de mărime egală extrasă aleator; Memoizare de contracte identice; Constructori învățați fără condiții, doar ca ablație nepromovabilă.

**Metrici.** Timp până la model certificat; Transfer între familii; Dimensiunea bibliotecii; Încercări inutile pe no-benefit.

**Criteriu de susținere.** Cost amortizat mai mic sau acoperire mai largă pe familii nefolosite la mining, cu toate certificatele păstrate.

**Ce ar infirma ipoteza în domeniul testat.** Transferul dispare după separarea familiilor sau biblioteca memorează coeficienți/identități de task.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Constructor nou aplicat unei legi nevăzute; Candidat greșit respins de checker; Regresii polinomiale vechi rămân.

**Puncte de pornire existente.** [src/learning.mjs](../src/learning.mjs) · [vendor/vrc/src/proposals.mjs](../vendor/vrc/src/proposals.mjs) · [docs/LEARNING_AND_DREAMING.md](../docs/LEARNING_AND_DREAMING.md)

**Artefact viitor.** `research/runs/R08/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r09"></a>
### R09 — O formă comună tipată pentru mai multe familii de reprezentări

**Prioritate:** P2 · **Experiment:** PLANNED · **Dependențe:** R06

**Starea actuală.** Unificarea actuală este în principal polinomială, cu stări logice finite; nu acoperă orice algebră sau reprezentare de secvențe.

**Ipoteza.** Un IR tipat pentru encodere, operații și obligații de verificare poate exprima și învăța mai multe clase prin același mecanism de construcție, cu overhead util.

**Date și separarea loturilor.** Matrice de acoperire: liniar, polinomial, Boolean finit, automaton, semiring de numărare și compoziții între două familii; 20 instanțe/celulă compatibilă, celule imposibile declarate.

**Plan de implementare și verificare.**

1. Definește tipurile și semantica operatorilor; scrie includeri explicite pentru specialiștii selectați.
2. Generalizează constructorul comun, nu interfața unui router manual către șase rezolvitoare.
3. Compară reprezentabilitatea, succesul de învățare, certificarea și costul pe aceeași matrice; testează compozițiile ținute separat.

**Comparatori și ablații.** Specialist pe fiecare familie; Router cu etichetă oracle; Aceeași gramatică fără operatori compoziționali; IR comun fără învățare.

**Metrici.** Acoperire operațională și formală; Overhead față de fiecare specialist; Cod/primitive specifice unei familii; Compoziții rezolvate.

**Criteriu de susținere.** Aceeași procedură recuperează reuniunea unei liste finite de capacități declarate și compune cel puțin două, fără a cere să bată fiecare specialist.

**Ce ar infirma ipoteza în domeniul testat.** Unificarea constă doar în nume comune sau ramuri hard-coded după eticheta generatorului; conversiile pierd garanții.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Nu se confundă probabilitate cu număr de dovezi; Operator incompatibil de tip respins; Certificat compus păstrează tipul rezultatului.

**Puncte de pornire existente.** [docs/MECHANISMS.md](../docs/MECHANISMS.md) · [docs/SOP.md](../docs/SOP.md) · [docs/REFERENCES.md](../docs/REFERENCES.md)

**Artefact viitor.** `research/runs/R09/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r10"></a>
### R10 — Simetrii globale și canonizare dincolo de coloane identice

**Prioritate:** P2 · **Experiment:** PLANNED · **Dependențe:** R05, R09

**Starea actuală.** Experimentele timpurii au comprimat clase pe sufixe; auditul a identificat limite când trebuie permutate simultan mai multe componente.

**Ipoteza.** O familie de transformări certificate asupra stărilor poate descoperi simetrii ratate de egalitatea locală și reduce suplimentar search-ul.

**Date și separarea loturilor.** Deranjamente, atribuiri bipartite, grafuri etichetate și planuri cu obiecte interschimbabile; mărimi mici exhaustive, apoi scalare. Ordinea prezentării este randomizată separat.

**Plan de implementare și verificare.**

1. Propune permutări sau acțiuni de grup tipate pe stări și reguli, nu doar pe vectorul curent.
2. Verifică păstrarea obiectivului, acțiunilor și costurilor relevante; păstrează martori de ridicare spre planul original.
3. Compară cu reducerea pe sufix, canonizarea clasică și formulele închise disponibile pe controale.

**Comparatori și ablații.** Compresia din audit/exp2; Canonizare de graf pe domeniul compatibil; Formulă/recurență directă pentru deranjamente; Ordini de procesare optimizate egal pentru metode.

**Metrici.** Stări distincte; Costul canonizării; Dependență de ordine; Timp total și validitatea planului ridicat.

**Criteriu de susținere.** Economia supraviețuiește costului canonizării pe o clasă definită; contraexemplul istoric este tratat fără a hard-coda răspunsul.

**Ce ar infirma ipoteza în domeniul testat.** Se confundă obiecte distinse de un guard sau reprezentarea canonizată pierde identitatea necesară reconstruirii acțiunii.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Permutare comună rânduri–coloane; Un guard care numește un obiect rupe simetria; Plan abstract are lift concret.

**Puncte de pornire existente.** [history/archives/audit.zip](../history/archives/audit.zip) · [history/reports/audit.md](../history/reports/audit.md) · [docs/MECHANISMS.md](../docs/MECHANISMS.md)

**Artefact viitor.** `research/runs/R10/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r11"></a>
### R11 — Date zgomotoase și reprezentări aproximative cu statut distinct

**Prioritate:** P2 · **Experiment:** PLANNED · **Dependențe:** R05

**Starea actuală.** Linia exactă respinge datele zgomotoase testate; această revizie nu schimbă acel rezultat.

**Ipoteza.** Un estimator robust poate învăța reprezentări utile sub zgomot, cu erori calibrate explicit, fără a le promova drept teoreme exacte.

**Date și separarea loturilor.** Date cu zgomot pe intrări și ieșiri, relativ 10^-6, 10^-4, 10^-2, plus outlieri și drift; minimum 30 semințe/regim. Separă identificarea parametrilor de selecția modelului și calibrarea intervalelor.

**Plan de implementare și verificare.**

1. Definește un artefact EMPIRICAL separat de EXACT și un model de zgomot; păstrează regulile sursă neschimbate.
2. Învață E/G cu criteriu robust și estimează incertitudinea pe traiectorii nefolosite la fitting.
3. Evaluează predicția lungă și deciziile lângă prag; folosește abstention sau calcul exact când este disponibil.

**Comparatori și ablații.** Regresie robustă integrală; Model neural/polinomial cu același buget; VRC strict actual; Reprezentare-martor cu parametri estimați.

**Metrici.** Eroare și coverage de interval; False exact declarations; Calibrare OOD; Dimensiune și cost runtime.

**Criteriu de susținere.** La nivelul de acoperire stabilit în protocol, intervalele sunt calibrate în domeniul testat și reducerea are valoare predictivă sau economică; zero etichete EXACT fără probă.

**Ce ar infirma ipoteza în domeniul testat.** Incertitudinea este subestimată sistematic sau metoda doar crește toleranța și numește potrivirea exactă.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Outlier nu devine lege; Interval care traversează pragul → nedecis; DATE-ONLY fără checker nu produce certificat universal.

**Puncte de pornire existente.** [history/reports/ml.md](../history/reports/ml.md) · [docs/LIMITS.md](../docs/LIMITS.md) · [vendor/vrc/test/reference.test.mjs](../vendor/vrc/test/reference.test.mjs)

**Artefact viitor.** `research/runs/R11/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r12"></a>
### R12 — Observare parțială: reprezentarea trebuie să includă memorie

**Prioritate:** P2 · **Experiment:** PLANNED · **Dependențe:** R07

**Starea actuală.** Modelele curente primesc starea formală necesară; nu există un learner general al stării ascunse din istorii.

**Ipoteza.** Encoderul unei ferestre sau al unei stări recurente poate găsi o statistică predictivă suficientă când observația curentă singură este insuficientă.

**Date și separarea loturilor.** Automate ascunse finite și lumi numerice cu întârzieri cunoscute evaluatorului; ferestre 1,2,4,8. Familii cu aliasing ireductibil și prefixe identice cu viitor diferit.

**Plan de implementare și verificare.**

1. Separă observațiile de starea simulatorului; learnerul vede numai secvențe și acțiuni.
2. Caută memorie de lungime finită sau un updater recurent și teste discriminante între istorii.
3. Pe lumi finite certifică echivalența comportamentală; pe lumi numerice cu dinamică necunoscută raportează numai validare statistică.

**Comparatori și ablații.** VRC fără memorie; Predictor cu delay embedding fix; Model recurent la buget egal; Oracle cu starea completă, separat.

**Metrici.** Memorie minimă găsită; Predicție pe orizont lung; Ambiguitate rămasă; Cost per pas și cost de învățare.

**Criteriu de susținere.** Recuperează stări utile pe cazurile cu memorie finită și refuză certitudinea pe observații insuficiente.

**Ce ar infirma ipoteza în domeniul testat.** Aparenta reducere folosește clandestin variabile ascunse sau confundă istorii cu continuări distincte.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Aceeași observație, istoric diferit; Memoria se resetează la schimbarea episodului; Oracolul latent nu intră în input.

**Puncte de pornire existente.** [docs/MECHANISMS.md](../docs/MECHANISMS.md) · [docs/LIMITS.md](../docs/LIMITS.md)

**Artefact viitor.** `research/runs/R12/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r13"></a>
### R13 — Invariante inductive și certificate condiționate de domeniul accesibil

**Prioritate:** P2 · **Experiment:** PLANNED · **Dependențe:** R05, R07

**Starea actuală.** Certificatele curente verifică identități universale; nu utilizează automat ipoteze valabile numai pe stări accesibile.

**Ipoteza.** Condiții inductive certificate permit reduceri mai mici decât cele universal valabile, fără a pierde corectitudinea pe domeniul declarat.

**Date și separarea loturilor.** Lumi cu conservare, relații inițiale a=b, domenii finite și tranziții care mențin ori rup invariantul; controale ce părăsesc intenționat domeniul.

**Plan de implementare și verificare.**

1. Propune I(x), apoi verifică inițializarea și I(x)∧guard_a(x) ⇒ I(T_a(x)) pentru fiecare acțiune.
2. Verifică E/G numai sub I, cu domeniul în contract și în invalidare; verifică separat ieșirile din domeniu.
3. Compară reducerea universală și condiționată pe aceleași întrebări, costul proverului inclus.

**Comparatori și ablații.** VRC universal; Invariant furnizat de proiectant numai ca plafon superior; Sampling empiric fără drept de pruning.

**Metrici.** Dimensiune/stări reduse; Cost de probă; Counterexamples la inițializare/conservare; Rată de domenii refuzate.

**Criteriu de susținere.** Reducerile condiționate sunt mai utile pe unele clase și toate cele trei obligații — inițializare, conservare, compatibilitate — sunt verificate.

**Ce ar infirma ipoteza în domeniul testat.** O regularitate observată este folosită ca invariant fără inducție sau fapte noi reutilizează un certificat cu premise neîndeplinite.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Invariant fals în starea inițială; O acțiune rupe conservarea; Premisă de domeniu schimbată invalidează capabilitatea.

**Puncte de pornire existente.** [docs/MECHANISMS.md](../docs/MECHANISMS.md) · [src/learning.mjs](../src/learning.mjs)

**Artefact viitor.** `research/runs/R13/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r14"></a>
### R14 — Transfer verificat prin redenumire, scalare și parametri

**Prioritate:** P1 · **Experiment:** PLANNED · **Dependențe:** R05

**Starea actuală.** Cache-ul fragmentelor normalizează local numele; registry-ul plannerului folosește un contract numeric exact, nu transfer semantic general.

**Ipoteza.** Normalizarea certificată a coordonatelor și șabloanele parametrice reduc descoperirea repetată între taskuri structural echivalente.

**Date și separarea loturilor.** 100 contracte × variante de nume, ordine, scalare rațională și coeficienți; variante cu un guard suplimentar sunt controale negative. Split pe familii de transformări.

**Plan de implementare și verificare.**

1. Propune o mapare invertibilă sau un șablon cu premise explicite; nu considera egalitatea hash-urilor drept probă semantică.
2. Transportă E/G prin mapare și recertifică față de destinație înainte de promovare.
3. Compară costul mapării+recertificării cu recompilarea și reuse-ul de contract identic.

**Comparatori și ablații.** Registry actual; Redescoperire de la zero; Oracle de mapare furnizat evaluatorului.

**Metrici.** HIT semantic valid; Timp de transfer; False matches; Dimensiunea registry-ului.

**Criteriu de susținere.** Mai puține descoperiri repetate și cost total mai mic pe taskuri noi; zero transferuri greșite pe variantele care schimbă semantica.

**Ce ar infirma ipoteza în domeniul testat.** Maparea costă mai mult decât discovery sau ignoră unități, domenii, acțiuni ori guards.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Redenumire păstrează planul după remapare; Scalare schimbă decoderul corect; Guard nou forțează recertificarea.

**Puncte de pornire existente.** [src/numeric.mjs](../src/numeric.mjs) · [src/learning.mjs](../src/learning.mjs) · [docs/LEARNING_AND_DREAMING.md](../docs/LEARNING_AND_DREAMING.md)

**Artefact viitor.** `research/runs/R14/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

## C. Compoziție, reasoning și acces la cunoaștere

<a id="r15"></a>
### R15 — Module descoperite, interfețe minime și compoziție ierarhică

**Prioritate:** P1 · **Experiment:** PLANNED · **Dependențe:** R04, R05

**Starea actuală.** Slicing-ul urmărește dependențe și unește fragmentele care se intersectează; compoziția generală assume–guarantee nu este implementată.

**Ipoteza.** Interfețe descoperite și certificate local permit compunerea reducerilor fără reînvățarea întregii lumi, inclusiv când există cuplare rară.

**Date și separarea loturilor.** Rețele de 10,100,1000 module, 3–10 coordonate/modul; topologii lanț, arbore, ciclu, hub și cuplare densă. 20 legi locale distincte, nu numai instanțierea unui șablon.

**Plan de implementare și verificare.**

1. Construiește graful dependențelor și propune tăieturi cu intrări/ieșiri explicite.
2. Certifică fiecare modul pentru toate valorile admise ale intrărilor; pentru cicluri verifică închiderea interfeței, nu presupune independența.
3. Compară modelul monolitic, slicing-ul curent și compoziția ierarhică; adaugă controlat o muchie care rupe o interfață.

**Comparatori și ablații.** Compilare monolitică; Slicing structural; Module oracle cunoscute numai evaluatorului.

**Metrici.** Cost discovery/certificate; Dimensiunea interfeței; Memorie și runtime; Fragmente recertificate după schimbare.

**Criteriu de susținere.** Compoziția păstrează exact observabilele și reduce costul total pe topologii rare; pe cuplare densă poate reveni justificat la modelul complet.

**Ce ar infirma ipoteza în domeniul testat.** Interfețele omit un efect de feedback sau modulele sunt furnizate ascuns de generator; toate schimbările cer oricum recompilare integrală.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Buclă între module; Guard dependent de vecin; Cuplare nouă produce merge ori refinare.

**Puncte de pornire existente.** [src/numeric.mjs](../src/numeric.mjs) · [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) · [vendor/vrc/test/integration.test.mjs](../vendor/vrc/test/integration.test.mjs)

**Artefact viitor.** `research/runs/R15/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r16"></a>
### R16 — Contracte multiple și rafinare incrementală pentru întrebări noi

**Prioritate:** P1 · **Experiment:** PLANNED · **Dependențe:** R14, R15

**Starea actuală.** Observabilele și guards schimbă contractul; în general se caută alt artefact. Nu există o rețea de reutilizare între contracte apropiate.

**Ipoteza.** O bibliotecă de reprezentări ordonate după informația păstrată permite extend/reuse/refine cu mai puțin efort decât recompilarea completă.

**Date și separarea loturilor.** Secvențe de 200 întrebări/contract: prag nou, observabilă nouă, acțiune nouă, guard nou, apoi revenire; 20 lumi cu grade diferite de suprapunere.

**Plan de implementare și verificare.**

1. Definește explicit ce înseamnă că E2 rafinează E1: există decoder verificat E1=F(E2).
2. Reutilizează coordonatele vechi și caută numai informația lipsă, dar verifică toate acțiunile și observabilele noului contract.
3. Măsoară costul incremental și mărimea bibliotecii; păstrează și soluția de la zero ca referință.

**Comparatori și ablații.** Recompilare integrală; Un singur model care păstrează toate întrebările; Registry actual.

**Metrici.** Cost marginal per schimbare; Dimensiunea E cumulativă; Recertificări; Beneficiu pe revenirea la contract vechi.

**Criteriu de susținere.** Cost mai mic pe fluxuri held-out fără acumulare necontrolată de coordonate și fără folosirea unui certificat prea slab.

**Ce ar infirma ipoteza în domeniul testat.** Refinarea devine doar stocarea întregii stări sau o observabilă nouă este calculată din informație deja pierdută.

**Regresii de adăugat — nu sunt implementate prin această fișă.** q-only apoi întrebare despre a; Prag nou nu schimbă legea; Acțiune care face b relevant.

**Puncte de pornire existente.** [src/learning.mjs](../src/learning.mjs) · [docs/LEARNING_AND_DREAMING.md](../docs/LEARNING_AND_DREAMING.md) · [vendor/vrc/test/integration.test.mjs](../vendor/vrc/test/integration.test.mjs)

**Artefact viitor.** `research/runs/R16/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r17"></a>
### R17 — Lumi relaționale mutable și întreținerea incrementală a adevărului

**Prioritate:** P2 · **Experiment:** PLANNED · **Dependențe:** R05, R16

**Starea actuală.** Există snapshot/fork și moduri logice finite; plannerul nu modifică arbitrar baza relațională la fiecare acțiune.

**Ipoteza.** Delta-uri relaționale și proveniența dependentă de versiune pot face utile reducerile numerice într-o lume în care acțiunile schimbă și fapte.

**Date și separarea loturilor.** Fluxuri cu inserări/retrageri, muchii dependente de acțiuni, autorizări și acoperire parțială; micro-lumi exhaustive și 100 sesiuni de 1000 evenimente.

**Plan de implementare și verificare.**

1. Definește semantica ADD/REMOVE într-un profil nou, cu snapshot versionat și tranziții atomice.
2. Menține dependențele faptelor derivate; invalidarea unei premise retrage consecințele afectate, nu tot istoricul.
3. Include starea logică necesară în cheia de search și compară cu reevaluarea completă după fiecare pas.

**Comparatori și ablații.** Rebuild integral; Delta-uri fără VRC; Copiere completă de snapshot; Truth maintenance independent pe cazuri mici.

**Metrici.** Cost per actualizare; Dimensiunea delta; Concluzii stale; Memorie pe ramură.

**Criteriu de susținere.** Aceleași concluzii și planuri ca recomputarea, cu economie pe schimbări locale; retractarea nu lasă dovezi active invalide.

**Ce ar infirma ipoteza în domeniul testat.** Două lumi cu mod egal dar fapte relevante diferite sunt unite sau o dovadă absentă rămâne validă după schimbarea acoperirii.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Revocare în mijlocul unui plan; Ștergere de premisă recursivă; Fork-uri nu împart mutații; Plan replay folosește snapshotul corect.

**Puncte de pornire existente.** [src/store.mjs](../src/store.mjs) · [src/engine.mjs](../src/engine.mjs) · [docs/LIMITS.md](../docs/LIMITS.md) · [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)

**Artefact viitor.** `research/runs/R17/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r18"></a>
### R18 — Reasoning goal-directed general și execuție numerică în loturi

**Prioritate:** P1 · **Experiment:** PLANNED · **Dependențe:** R01, R02

**Starea actuală.** Există selecție de predicate și un șablon special de reachability; adaptarea generală a cererii și batching-ul CALL nu sunt complete.

**Ipoteza.** Propagarea cererii prin reguli și gruparea calculelor numerice cu același contract fac ca economia VRC să rămână vizibilă cap-coadă.

**Date și separarea loturilor.** Joinuri selective și dense, recursie mutuală, 10^2–10^5 entități apelând aceleași 5–20 contracte, orizonturi amestecate 1,16,64,256; date active, nu numai zgomot de fond.

**Plan de implementare și verificare.**

1. Generalizează transformarea cererii sau tabling-ul fără a schimba stratificarea și acoperirea.
2. Grupează CALL-uri după contract și aritmetică; deduplică pregătirea, dar nu substitui răspunsuri din alte fapte.
3. Măsoară factorial: demand on/off × batch on/off × VRC on/off.

**Comparatori și ablații.** Reasoner indexat curent; Kernel procedural direct; Batch fără reducere; VRC fără batching.

**Metrici.** Timp end-to-end; Apeluri și compilări; Tupluri materializate; Cost de proveniență.

**Criteriu de susținere.** Beneficiul atribuit VRC se păstrează după izolarea optimizărilor logice; soluția comună bate varianta identică fără componenta evaluată pe clase definite.

**Ce ar infirma ipoteza în domeniul testat.** Câștigul este doar BFS/demand și nu există economie incrementală VRC, sau batching-ul schimbă lipsurile/ordinea efectelor.

**Regresii de adăugat — nu sunt implementate prin această fișă.** CALL identic cu fapte diferite nu returnează rezultat stale; Negare stratificată păstrată; Batch exact egal cu scalar.

**Puncte de pornire existente.** [src/engine.mjs](../src/engine.mjs) · [src/numeric.mjs](../src/numeric.mjs) · [src/reach.mjs](../src/reach.mjs) · [experiments/benchmark.mjs](../experiments/benchmark.mjs)

**Artefact viitor.** `research/runs/R18/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r19"></a>
### R19 — Memorie externă, indexuri și recuperare în două etape

**Prioritate:** P2 · **Experiment:** PLANNED · **Dependențe:** R05

**Starea actuală.** Stocarea este în memorie; streaming-ul de intrare nu înseamnă query out-of-core. Memoria holografică nu este parte a VRC livrat.

**Ipoteza.** Selecția de candidați dintr-un index extern urmată de acces exact la fire și verificare poate susține baze mari fără confundarea similarității cu dovada.

**Date și separarea loturilor.** Colecții de 10^5–10^7 fapte/artefacte, subseturi relevante rare și dense; comparații exacte pentru seturi mici și subseturi de audit pentru mari. Relevanța completă necesară absenței se evaluează separat de retrieval top-k.

**Plan de implementare și verificare.**

1. Definește handle-uri versionate și interfață de citire exactă a firelor SOP; păstrează proveniența și drepturile de acces.
2. Compară index exact, bază pe disc și retrieval aproximativ numai ca generator de candidați.
3. Testează misses, evicție, restart și lookup sub revocare; nu deduce inexistența dintr-un top-k incomplet.

**Comparatori și ablații.** Store în RAM; SQLite/index exact pe disc; Index aproximativ + verificare exactă; Scan complet pe subset auditabil.

**Metrici.** RAM și I/O; Recall de candidați; Latență rece/caldă; False absence conclusions; Cost reconstruire după evicție.

**Criteriu de susținere.** Memorie mai mică sau acces mai ieftin, cu semantica de incompletitudine corectă și fără artefacte neverificate acceptate.

**Ce ar infirma ipoteza în domeniul testat.** Pierderile de retrieval sunt prezentate ca fals logic, sau verificarea exactă recitește mereu toată baza și anulează beneficiul.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Cue → handle → wire exact; Versiune handle schimbată; Lipsă top-k → UNKNOWN, nu negare; Evicția nu șterge premisele sursă.

**Puncte de pornire existente.** [src/stream.mjs](../src/stream.mjs) · [src/store.mjs](../src/store.mjs) · [docs/LIMITS.md](../docs/LIMITS.md)

**Artefact viitor.** `research/runs/R19/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

## D. Extinderea semanticii de planificare și a căutării

<a id="r20"></a>
### R20 — Euristici admisibile, dominanță și macro-acțiuni învățate

**Prioritate:** P2 · **Experiment:** PLANNED · **Dependențe:** R05

**Starea actuală.** Plannerul folosește BFS cu quotient; nu învață euristici sau leme de dominanță.

**Ipoteza.** Reprezentarea redusă poate alimenta euristici certificate ori macro-acțiuni care reduc expansiunile suplimentar, fără a atribui VRC câștigul algoritmului de search.

**Date și separarea loturilor.** Probleme finite cu distanță optimă calculabilă independent, acțiuni reversibile, dead ends și simetrii; 100 instanțe/familie, trei mărimi și familii held-out.

**Plan de implementare și verificare.**

1. Construiește o euristică dintr-o abstracție relaxată și dovedește că nu supraestimează; macro-acțiunile au cost și precondiții verificate.
2. Păstrează distincte euristicile de ordering necertificate de regulile care elimină stări.
3. Evaluează BFS/A* × complet/redus, plus macro on/off; compară costul și replay-ul planului.

**Comparatori și ablații.** BFS complet și VRC; A* cu euristică simplă aceeași în ambele; Oracle distanță exactă pe mici.

**Metrici.** Expansiuni; Cost/adâncime optimă; Overhead euristică; Timp total cu learning.

**Criteriu de susținere.** Reducere suplimentară a costului la optimalitate păstrată; contribuțiile quotient și euristică sunt raportate separat.

**Ce ar infirma ipoteza în domeniul testat.** Euristica supraestimează ori dominanța elimină un plan optim; efectul dispare față de A* complet bine configurat.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Euristică zero reproduce referința; Macro invalidă respinsă; Ordering empiric nu autorizează pruning.

**Puncte de pornire existente.** [src/planner.mjs](../src/planner.mjs) · [docs/PLANNING_VRC.md](../docs/PLANNING_VRC.md)

**Artefact viitor.** `research/runs/R20/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r21"></a>
### R21 — Costuri ponderate, durate și obiective multiple

**Prioritate:** P2 · **Experiment:** PLANNED · **Dependențe:** R05, R16

**Starea actuală.** COST este respins; plannerul actual optimizează numărul de acțiuni cu cost unitar.

**Ipoteza.** O reprezentare care păstrează și funcția de cost poate accelera optimizarea ponderată și, într-o extensie separată, frontiera Pareto.

**Date și separarea loturilor.** Costuri raționale nenegative, două trasee cu lungimi/costuri inversate, cicluri de cost zero și cost dependent de informație eliminată; cazuri multiobiectiv separate.

**Plan de implementare și verificare.**

1. Adaugă costul la contract și verifică c_a(x)=cbar_a(E(x)); extinde cheia și dominanța pentru buget rămas dacă acesta contează.
2. Folosește un algoritm potrivit costurilor, cu replay al costului în lumea originală; costurile negative rămân respinse până la semantică explicită.
3. Compară optimele cu un solver independent; abia apoi adaugă durata ori Pareto cu criteriul de dominanță documentat.

**Comparatori și ablații.** Dijkstra complet; Aceeași căutare pe quotient; BFS numai ca martor că problema diferă; Enumerare Pareto pe lumi mici.

**Metrici.** Cost optim și plan valid; Număr de stări; Timp total; Mărime frontieră Pareto.

**Criteriu de susținere.** Costurile optime coincid exact și există reducere pe familii cu simetrie cost-invariantă.

**Ce ar infirma ipoteza în domeniul testat.** Sunt unite stări cu costuri viitoare diferite sau distanța minimă în pași este prezentată drept cost minim.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Plan mai lung dar mai ieftin; Cost dependent de a rupe encoderul q,ab; Ciclu zero-cost; Cost negativ respins.

**Puncte de pornire existente.** [docs/SOP.md](../docs/SOP.md) · [test/handover-core.test.mjs](../test/handover-core.test.mjs) · [docs/LIMITS.md](../docs/LIMITS.md)

**Artefact viitor.** `research/runs/R21/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r22"></a>
### R22 — Nedeterminism adversarial și politici, nu numai trasee existențiale

**Prioritate:** P2 · **Experiment:** PLANNED · **Dependențe:** R05, R26

**Starea actuală.** Modurile pot avea ramuri, dar succesul actual este existența unui traseu; nu este garanție asupra tuturor alegerilor mediului.

**Ipoteza.** Un quotient alternant care păstrează toate succesoarele relevante poate micșora căutarea unei politici garantate.

**Date și separarea loturilor.** Jocuri finite turn-based cu rezultate favorabile și nefavorabile ale aceleiași acțiuni, bucle și stări-capcană; exhaustiv pentru până la opt stări, scalare ulterior.

**Plan de implementare și verificare.**

1. Definește explicit alegerea agentului versus alegerea mediului și succesul strong/strong-cyclic separat.
2. Verifică echivalența mulțimilor de succesoare abstracte și a obiectivului pentru fiecare acțiune; folosește algoritm AND/OR sau punct fix adecvat.
3. Livrează o politică și verifică toate ramurile, nu numai un plan favorabil.

**Comparatori și ablații.** Solver joc finit independent; Model complet cu aceeași semantică; Planner existențial ca control intenționat insuficient.

**Metrici.** Mulțimea stărilor câștigătoare; Mărimea politicii; Ramuri auditate; Cost de certificare.

**Criteriu de susținere.** Aceleași stări câștigătoare și politici valide; economie măsurată pe un domeniu delimitat.

**Ce ar infirma ipoteza în domeniul testat.** Un singur traseu favorabil este folosit ca dovadă de succes garantat sau ciclurile sunt tratate fără ipoteze de fairness.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Acțiune cu două rezultate, unul fatal; Politică pentru toate ramurile; Fairness absent nu este inventat.

**Puncte de pornire existente.** [docs/LIMITS.md](../docs/LIMITS.md) · [docs/PLANNING_VRC.md](../docs/PLANNING_VRC.md) · [test/handover-core.test.mjs](../test/handover-core.test.mjs)

**Artefact viitor.** `research/runs/R22/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r23"></a>
### R23 — Probabilități și mase de tranziție conservate

**Prioritate:** P2 · **Experiment:** PLANNED · **Dependențe:** R05, R09

**Starea actuală.** Quotient-ul actual nu păstrează probabilități; numărul reprezentanților nu este o distribuție.

**Ipoteza.** Agregarea certificată a maselor către clase echivalente permite predicție probabilistică sau control într-un MDP redus.

**Date și separarea loturilor.** Lanțuri Markov și MDP finite cu probabilități raționale, surse corelate și stări cu același output dar tranziții diferite; minimum 200 modele mici, apoi scalare.

**Plan de implementare și verificare.**

1. Adaugă distribuția tranziției și recompensa la contract; suma probabilităților spre o clasă trebuie să fie independentă de reprezentant.
2. Verifică exact modelele finite și separă învățarea statistică a probabilităților de agregarea lor.
3. Compară probabilitățile de atingere și valorile/politicile cu modelul complet, la aceleași orizonturi.

**Comparatori și ablații.** Calcul exact pe modelul complet; Agregare clasică de stări compatibilă; Aproximare probabilistică cu eroare declarată, separat.

**Metrici.** Eroare de probabilitate/recompensă; Conservarea masei; Dimensiune; Timp și memorie.

**Criteriu de susținere.** Pe pista exactă, rezultate identice și certificate de conservare; pe pista empirică, intervale calibrate și etichetă distinctă.

**Ce ar infirma ipoteza în domeniul testat.** Masele sunt pierdute prin deduplicare sau se presupune independență între surse care nu a fost declarată.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Două microstări spre aceeași clasă adună masele; Probabilități total unu; Distribuții diferite interzic merge.

**Puncte de pornire existente.** [docs/MECHANISMS.md](../docs/MECHANISMS.md) · [docs/LIMITS.md](../docs/LIMITS.md)

**Artefact viitor.** `research/runs/R23/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r24"></a>
### R24 — Numărarea exactă a planurilor, dovezilor și soluțiilor

**Prioritate:** P2 · **Experiment:** PLANNED · **Dependențe:** R09, R05

**Starea actuală.** Primele experimente au numărat atribuiri; plannerul curent păstrează un reprezentant și nu conservă multiplicitățile.

**Ipoteza.** Ponderi/semiring-uri și condiții de echivalență mai puternice pot recupera numărarea fără enumerarea tuturor microtraiectoriilor.

**Date și separarea loturilor.** Atribuiri din algebra/exp2, grafuri cu două drumuri spre aceeași stare, cicluri și planuri cu orizont fix; lungime exactă versus cel mult H testate separat.

**Plan de implementare și verificare.**

1. Definește obiectul numărat: secvență de acțiuni, microstare, dovadă sau plan distinct; nu le amesteca.
2. Construiește tranziții ponderate și verifică numărul de continuări și multiplicitățile; ciclurile cer orizont finit sau altă semantică explicită.
3. Compară rezultatele BigInt cu enumerarea exhaustivă pe mici și recurențe de specialitate pe mari.

**Comparatori și ablații.** Enumerare exactă; Algoritmii istorici de numărare; Programare dinamică ponderată fără compresie.

**Metrici.** Număr exact; Stări agregate; Bit complexity; Timp și RAM.

**Criteriu de susținere.** Numere identice, inclusiv pentru drumuri care se reunesc; reducerile sunt mai ieftine pe o familie clară.

**Ce ar infirma ipoteza în domeniul testat.** Două planuri sunt deduplicate ca unul sau ponderile reprezintă probabilități fără justificare.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Diamond are două drumuri, nu unul; Acțiuni duplicate: semantică declarată; H=0 și cicluri; Regresii algebra/exp2 păstrate separat.

**Puncte de pornire existente.** [history/archives/algebra.zip](../history/archives/algebra.zip) · [history/archives/exp2.zip](../history/archives/exp2.zip) · [docs/MECHANISMS.md](../docs/MECHANISMS.md)

**Artefact viitor.** `research/runs/R24/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r25"></a>
### R25 — Temporalitate, termene și proprietăți despre istorii

**Prioritate:** P2 · **Experiment:** PLANNED · **Dependențe:** R05, R12

**Starea actuală.** HORIZON este un număr de pași; nu există temporalitate generală sau specificații asupra întregii istorii.

**Ipoteza.** Adăugarea unui monitor finit ori a ceasurilor relevante în reprezentare permite comprimare corectă pentru proprietăți temporale.

**Date și separarea loturilor.** Secvențe cu before/after, deadline, cooldown și eveniment care trebuie precedat de autorizare; versiune discretă finită înaintea timpului continuu.

**Plan de implementare și verificare.**

1. Transformă proprietatea temporală într-o stare de monitor explicită; produsul cu starea numerică intră în contract.
2. Verifică guards dependente de timp și schimbări de resurse; distinge pas de durată.
3. Compară cu enumerarea completă a istoriilor/monitorului pe mici și un backend temporal compatibil pe mari.

**Comparatori și ablații.** Planner complet cu monitor; Stocarea întregii istorii; State-only fără monitor, control greșit.

**Metrici.** Verdict temporal; Memorie de istoric; Stări produs; Latență și cost monitor.

**Criteriu de susținere.** Aceeași satisfacere a specificației cu mai puține stări; clock/monitor nu este omis din cheia de search.

**Ce ar infirma ipoteza în domeniul testat.** Două stări numerice egale dar cu deadline sau trecut diferit sunt unite în ciuda viitorului relevant diferit.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Autorizare înainte, nu după; Aceeași stare, cooldown diferit; HORIZON nu este interpretat în secunde.

**Puncte de pornire existente.** [docs/SOP.md](../docs/SOP.md) · [docs/PLANNING_VRC.md](../docs/PLANNING_VRC.md)

**Artefact viitor.** `research/runs/R25/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r26"></a>
### R26 — Rafinare a abstracției în timpul căutării

**Prioritate:** P2 · **Experiment:** PLANNED · **Dependențe:** R05, R07

**Starea actuală.** VRC caută un model și îl certifică înainte de search; nu există CEGAR general între planificare și reprezentare.

**Ipoteza.** O abstracție inițială ieftină, rafinată prin planuri abstracte imposibile concret, poate evita construirea de la început a unui model prea mare.

**Date și separarea loturilor.** Lumi cu guards rare, dependențe care apar târziu și ținte greu accesibile; micro-lumi finite cu set exact de soluții cunoscut evaluatorului.

**Plan de implementare și verificare.**

1. Definește dacă abstracția supraaproximează sau este exactă; un candidat abstract pozitiv cere concretizare.
2. Când concretizarea eșuează, extrage distincția lipsă și rafinează E/partitionarea; înregistrează obligațiile de probă.
3. Compară cu certificat complet upfront și căutare completă; niciun rezultat negativ nu este promovat fără condiția de soundness corespunzătoare.

**Comparatori și ablații.** VRC upfront; Full-state BFS; Rafinare aleatoare la același buget.

**Metrici.** Iterații de refinare; Contraexemple false/utile; Cost end-to-end; Dimensiune finală.

**Criteriu de susținere.** Aceleași răspunsuri exacte cu cost redus pe o clasă unde puține distincții sunt realmente cerute.

**Ce ar infirma ipoteza în domeniul testat.** Un plan abstract neridicabil este acceptat sau o abstracție incompletă este folosită pentru a certifica inexistența.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Plan abstract fals produce refinare; Limita refinărilor → BUDGET; Exemplu unde a treia variabilă devine necesară.

**Puncte de pornire existente.** [src/planner.mjs](../src/planner.mjs) · [docs/MECHANISMS.md](../docs/MECHANISMS.md)

**Artefact viitor.** `research/runs/R26/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r27"></a>
### R27 — Abducție și contrafactuale cu ipoteze explicit separate

**Prioritate:** P2 · **Experiment:** PLANNED · **Dependențe:** R16, R05

**Starea actuală.** VRC accelerează evaluarea înainte a ipotezelor; nu generează toate explicațiile și nu reconstruiește unic starea originală.

**Ipoteza.** Un generator explicit de ipoteze combinat cu VRC reduce costul găsirii unor explicații minimale, păstrând diferența dintre premisă și concluzie.

**Date și separarea loturilor.** Micro-lumi de diagnostic, flux de resurse și intervenții; observații cu una, mai multe sau nicio explicație; ipoteze și costuri de minimalitate declarate.

**Plan de implementare și verificare.**

1. Definește spațiul ipotezelor și operațiile de intervenție asupra legilor/faptelor; salvează fiecare lume separat.
2. Reutilizează VRC numai când noul contract rămâne valabil; verifică predicțiile și minimalitatea cu un enumerator independent.
3. Raportează mulțimea sau un reprezentant justificat al explicațiilor, nu un adevăr unic inventat.

**Comparatori și ablații.** Enumerare ipoteze + model complet; Aceleași ipoteze + VRC; Solver abductiv extern pe subset compatibil.

**Metrici.** Explicații corecte/minimale; Număr de evaluări; Contracte reutilizate; Cost discovery și search.

**Criteriu de susținere.** Aceeași familie de explicații în scope și cost mai mic la evaluări repetate; statutul HYPOTHESIS rămâne distinct.

**Ce ar infirma ipoteza în domeniul testat.** Ipotezele sunt inserate în baza de fapte certe sau decoderul pierdut este tratat ca inversă unică.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Două explicații compatibile; Intervenție schimbă legea; Absență de date nu este cauză dovedită.

**Puncte de pornire existente.** [docs/USE_CASES_RO.md](../docs/USE_CASES_RO.md) · [docs/LEARNING_AND_DREAMING.md](../docs/LEARNING_AND_DREAMING.md)

**Artefact viitor.** `research/runs/R27/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

## E. Învățare persistentă, dreaming și viața artefactelor

<a id="r28"></a>
### R28 — Dreaming cu buget și distribuție de taskuri schimbătoare

**Prioritate:** P1 · **Experiment:** PLANNED · **Dependențe:** R03

**Starea actuală.** Consolidarea grupează contracte recurente și încearcă learnerul; politica este euristică, nu învățare optimă a investiției de calcul.

**Ipoteza.** Selectarea offline după câștigul așteptat și incertitudinea lui produce mai multă economie decât frecvența brută, inclusiv sub drift.

**Date și separarea loturilor.** 10 fluxuri de câte 1000 taskuri cu regimuri recurente, noi și dispărute; bugete offline de 0%,1%,5%,20% din timpul de referință, strict separate de latența online.

**Plan de implementare și verificare.**

1. Construiește un ledger al timpului cheltuit, economisit și nerecuperat; costul încercărilor eșuate rămâne în total.
2. Compară politici de prioritate și explorare cu configurație înghețată; replay-ul viitor nu este disponibil selectorului.
3. Simulează schimbarea regulilor și revenirea lor; păstrează o rezervă de resurse pentru taskurile online.

**Comparatori și ablații.** Fără dreaming; Frecvență × expanded actual; Planificare offline aleatoare; Oracle retrospectiv.

**Metrici.** Economie cumulată netă; Cost irosit și break-even; Adaptare la drift; Latență online p95.

**Criteriu de susținere.** Beneficiu pozitiv pe fluxul complet, nu doar după omiterea costului consolidării; revenirea la un regim vechi reutilizează capabilități valide.

**Ce ar infirma ipoteza în domeniul testat.** Dreaming-ul recompilează aceleași eșecuri sau antrenează numai pe distribuția deja dispărută.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Idempotent la același contract; Buget mărit permite retry; Drift nu deblochează un artefact revocat.

**Puncte de pornire existente.** [src/learning.mjs](../src/learning.mjs) · [examples/dreaming.mjs](../examples/dreaming.mjs) · [docs/LEARNING_AND_DREAMING.md](../docs/LEARNING_AND_DREAMING.md)

**Artefact viitor.** `research/runs/R28/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r29"></a>
### R29 — Leme relaționale și macro-demonstrații învățate din urme

**Prioritate:** P2 · **Experiment:** PLANNED · **Dependențe:** R05, R28

**Starea actuală.** Această bibliotecă învață reprezentări; nu livrează invenție generală de leme relaționale. Direcția este conexă altor experimente ale proiectului, nu importată implicit.

**Ipoteza.** Fragmentele repetate ale justificărilor pot fi generalizate în leme/macro-uri care reduc reasoning-ul ulterior, cu dovadă și domeniu explicit.

**Date și separarea loturilor.** Urme din 10 familii de reguli recursive și numerice, split după scheme de probleme; exemple negative unde variabilele nu pot fi unificate sau premisele sunt insuficiente.

**Plan de implementare și verificare.**

1. Minează subgrafuri și anti-unifică variabilele fără să generalizezi constante cu rol semantic obligatoriu.
2. Verifică lema ca derivabilă din reguli sau ca macro cu expansiune echivalentă; nu folosi succesul pe exemple drept dovadă.
3. Promovează cu versiuni de premise și evaluează pe taskuri noi, cu toate vechile regresii active.

**Comparatori și ablații.** Reasoner fără leme; Memoizare de răspunsuri; Macro-uri manuale comparabile; Anti-unificare fără promovare, numai candidaturi.

**Metrici.** Lungime de dovadă și search; Leme utile versus respinse; Cost verificare/memorie; Transfer între taskuri.

**Criteriu de susținere.** Scade costul pe taskuri nevăzute fără premise noi inventate și fără redefinirea adevărului în KB.

**Ce ar infirma ipoteza în domeniul testat.** Lema este valabilă numai în exemplele memorate sau excepțiile dispar prin generalizare.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Lemă cu premisă omisă respinsă; Revizuirea unei reguli invalidează lema; Macro expandat produce același rezultat.

**Puncte de pornire existente.** [src/engine.mjs](../src/engine.mjs) · [docs/LEARNING_AND_DREAMING.md](../docs/LEARNING_AND_DREAMING.md) · [docs/RESEARCH_NARRATIVE.md](../docs/RESEARCH_NARRATIVE.md)

**Artefact viitor.** `research/runs/R29/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r30"></a>
### R30 — Memorie de capabilități: retenție, uitare și fork-uri

**Prioritate:** P2 · **Experiment:** PLANNED · **Dependențe:** R28

**Starea actuală.** Registry-ul persistă artefacte; nu are o politică generală de evicție bazată pe utilitate sau fork copy-on-write între agenți.

**Ipoteza.** Retenția ghidată de utilitate, cu versiuni și fork-uri, menține beneficiul sub un buget de memorie fără să afecteze corectitudinea surselor.

**Date și separarea loturilor.** Fluxuri lungi cu 10^3–10^5 contracte, distribuții uniforme și cu popularitate concentrată, reveniri după pauze; ramuri agent/sesiune cu reguli diferite.

**Plan de implementare și verificare.**

1. Separă store-ul exact al faptelor de cache-ul de algoritmi; evicția unui artefact declanșează fallback, nu uitarea unei premise.
2. Implementează politici LRU/LFU și una cost-aware, cu copy-on-write și pinning pentru capabilități active.
3. Testează reveniri, revocări și reutilizare între ramuri autorizate; măsoară costul redescoperirii.

**Comparatori și ablații.** Fără evicție; LRU; LFU; Retenție după economie netă estimată.

**Metrici.** Hit rate ponderat cu costul; RAM/disc; Relearning cost; Izolare între ramuri.

**Criteriu de susținere.** Cost total mai mic la buget de memorie egal; evicțiile nu schimbă adevărul răspunsurilor.

**Ce ar infirma ipoteza în domeniul testat.** Un cache miss devine NO_SOLUTION sau un artefact din alt fork trece fără verificarea contractului.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Base→agent→session fără mutații comune; Artefact evictat se poate reînvăța; Revocare persistă după fork/restart.

**Puncte de pornire existente.** [src/learning.mjs](../src/learning.mjs) · [docs/LIMITS.md](../docs/LIMITS.md) · [docs/LEARNING_AND_DREAMING.md](../docs/LEARNING_AND_DREAMING.md)

**Artefact viitor.** `research/runs/R30/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r31"></a>
### R31 — Registry robust: read-only, concurență și recuperare după crash

**Prioritate:** P1 · **Experiment:** PLANNED · **Dependențe:** R05

**Starea actuală.** Există lock local, scrieri atomice, carantină și revocare; lookup-ul poate scrie metrici, iar registry-ul nu este distribuit.

**Ipoteza.** Separarea capabilităților imuabile de contoarele de utilizare permite lookup read-only și partajare sigură fără costuri de sincronizare dominante.

**Date și separarea loturilor.** 1,2,8,32 workeri locali, opriri injectate între etapele scrierii, artefacte trunchiate, migrare versiuni și sisteme de fișiere declarate; rețea distribuită într-o pistă ulterioară.

**Plan de implementare și verificare.**

1. Fă artefactele content-addressed și stocarea metricilor separată; verifică semnificația revocării pentru snapshoturi read-only.
2. Adaugă jurnal/mecanism de recovery și teste de fault injection; păstrează verificarea la import.
3. Măsoară contendența, recovery-ul și overhead-ul; nu trata hash-ul ca autentificare.

**Comparatori și ablații.** Registry local v0.3; Snapshot read-only recertificat; Fără sharing între procese.

**Metrici.** Lookup p95; Scrieri pierdute; Timp de recovery; Acceptări invalide; Throughput multiworker.

**Criteriu de susținere.** Zero artefacte parțiale/străine acceptate și recuperare definită; lookup read-only funcționează realmente fără permisiune de scriere.

**Ce ar infirma ipoteza în domeniul testat.** Crash-ul face revocarea să dispară sau un proces citește un index inconsistent cu artefactul.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Kill între scriere și rename; Două promovări concurente; FS read-only; Migrare checker version.

**Puncte de pornire existente.** [src/learning.mjs](../src/learning.mjs) · [test/handover-core.test.mjs](../test/handover-core.test.mjs) · [docs/LEARNING_AND_DREAMING.md](../docs/LEARNING_AND_DREAMING.md)

**Artefact viitor.** `research/runs/R31/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r32"></a>
### R32 — Certificate portabile și verificare cu nucleu independent

**Prioritate:** P2 · **Experiment:** PLANNED · **Dependențe:** R05

**Starea actuală.** Verificarea exactă folosește codul pachetului; nu există o demonstrație importată într-un nucleu formal independent.

**Ipoteza.** Certificatele explicite, mici și independente de learner permit reutilizare mai sigură și validare mai ieftină între procese sau implementări.

**Date și separarea loturilor.** Cele 96 modele istorice, certificate cu expresii mari și 1000 mutații de dovezi; artefacte din versiuni diferite, cu premise și domenii diferite.

**Plan de implementare și verificare.**

1. Exportă obligațiile normalizate și derivările de identități, nu doar un verdict true sau hash.
2. Scrie un checker independent ori o punte către un proof kernel; măsoară câtă semantică a parserului/compilatorului rămâne în baza de încredere.
3. Compară costul verificării de la zero cu verificarea certificatului; semnează artefacte numai dacă gazda cere identitate/autorizare, separat de adevăr.

**Comparatori și ablații.** Recertificarea actuală; Checker independent; Recalcularea completă fără artefact.

**Metrici.** Dimensiune dovadă; Timp checker; Bază de încredere; Mutații respinse.

**Criteriu de susținere.** Aceleași identități acceptate de implementări independente și cost mai mic ori garanție mai puternică explicită.

**Ce ar infirma ipoteza în domeniul testat.** Certificatul conține cod executabil neverificat sau checkerul folosește exact aceeași cale defectă ca learnerul.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Hash corect dar identitate falsă; Premisă de domeniu absentă; Versiune necunoscută → refuz.

**Puncte de pornire existente.** [vendor/vrc/src](../vendor/vrc/src) · [docs/MECHANISMS.md](../docs/MECHANISMS.md) · [docs/SAFETY_AUDIT_03.md](../docs/SAFETY_AUDIT_03.md)

**Artefact viitor.** `research/runs/R32/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

## F. Cost numeric, portabilitate și securitate

<a id="r33"></a>
### R33 — Aritmetică adaptivă cu erori certificate și chei de stare sigure

**Prioritate:** P1 · **Experiment:** PLANNED · **Dependențe:** R05

**Starea actuală.** Exact folosește raționale BigInt; float64 este aproximativ și nu oferă limite interval pentru decizii.

**Ipoteza.** Execuția interval/adaptivă poate accelera evaluarea și un subset al deciziilor, păstrând exactitatea acolo unde intervalul separă rezultatele.

**Date și separarea loturilor.** Traiectorii cu numitori în creștere, valori peste 2^53, anulări și praguri la distanțe 10^-3–10^-15; include aritmetică stabilă și instabilă.

**Plan de implementare și verificare.**

1. Definește propagarea intervalelor cu rotunjire controlată și escaladarea la BigInt lângă frontiere.
2. Nu folosi intervale suprapuse pentru a afirma egalitatea stărilor: merge exact numai prin certificat sau cheie canonică exactă.
3. Compară costul total și verdictul cu execuția rațională, inclusiv costul conversiilor și al escaladărilor.

**Comparatori și ablații.** Exact BigInt; Float64 etichetat aproximativ; Interval conservator; Adaptive interval→exact.

**Metrici.** Proporție de pași accelerați; Escaladări; Bit growth; Timp și memorie; Decizii greșite lângă prag.

**Criteriu de susținere.** Aceleași decizii certificate ca exact, economie netă pe familii stabile și niciun merge bazat doar pe epsilon.

**Ce ar infirma ipoteza în domeniul testat.** Intervalul este nesigur sau identități numerice diferite sunt unite; aproape fiecare pas escaladează și nu rămâne economie.

**Regresii de adăugat — nu sunt implementate prin această fișă.** 0 versus 1/10^13; Catastrophic cancellation; Interval atinge pragul; Cheie exactă și runtime aproximativ nu se confundă.

**Puncte de pornire existente.** [src/exact-runtime.mjs](../src/exact-runtime.mjs) · [src/planner.mjs](../src/planner.mjs) · [docs/SAFETY_AUDIT_03.md](../docs/SAFETY_AUDIT_03.md)

**Artefact viitor.** `research/runs/R33/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r34"></a>
### R34 — Batching, paralelism și portabilitate CPU/ARM/accelerator

**Prioritate:** P2 · **Experiment:** PLANNED · **Dependențe:** R02, R33

**Starea actuală.** Există kernel numeric compilat și worker de izolare; nu sunt măsurători portabile de performanță pe hardware-ul gazdei.

**Ipoteza.** Reducerea de stare poate diminua trafic de memorie și sincronizare, astfel încât beneficiul să persiste pe batch-uri și hardware diferit.

**Date și separarea loturilor.** Aceleași 20 modele pe loturi de 1,10^3,10^5,10^6 stări, minimum CPU x64 și ARM disponibil; accelerator numai dacă este efectiv accesibil și cu precizie declarată.

**Plan de implementare și verificare.**

1. Separă operațiile de descoperire exactă de execuția kernelurilor; păstrează arhitectura și versiunea compilatorului în rezultate.
2. Compară scalarea pe workeri cu state-sharing controlat; măsoară serializarea, transferul și pornirea.
3. Verifică numeric contra exact pe eșantioane și exact pe cazurile mici; publică și cazul batch=1.

**Comparatori și ablații.** Full kernel cu aceleași optimizări; Reduced kernel; Single-thread versus multiworker; CSE și layout identice în ambele variante.

**Metrici.** Timp kernel și end-to-end; Bytes mutați; Memorie; Eroare numerică; Energie numai dacă instrumentată.

**Criteriu de susținere.** Câștig reproducibil după costuri de transfer/pornire și fără favorizarea unei variante prin compilare mai bună.

**Ce ar infirma ipoteza în domeniul testat.** Avantajul este exclusiv un layout mai bun aplicat doar VRC sau dispare la includerea transferurilor.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Batch egal cu scalar; Worker termination păstrează BUDGET; ARM/x64 acceptă aceleași certificate.

**Puncte de pornire existente.** [src/isolated.mjs](../src/isolated.mjs) · [src/strategy-worker.mjs](../src/strategy-worker.mjs) · [vendor/vrc/src](../vendor/vrc/src) · [docs/API.md](../docs/API.md)

**Artefact viitor.** `research/runs/R34/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r35"></a>
### R35 — Complexitate a descoperirii și limite de resurse explicite

**Prioritate:** P1 · **Experiment:** PLANNED · **Dependențe:** R06, R03

**Starea actuală.** Există limite de coordonate, grade, timp și candidați; NO_MODEL nu este o probă de ireductibilitate.

**Ipoteza.** Măsuri ale structurii expresiilor și interfețelor pot prezice costul descoperirii și pot ghida reduceri fără a exploda baza intermediară.

**Date și separarea loturilor.** Grilă de coordonate 4,8,16,32; grad, sparsitate, număr de acțiuni și mărime a coeficienților variate separat. Peste 32 numai după o extensie explicită, nu printr-un flag nedocumentat.

**Plan de implementare și verificare.**

1. Instrumentează monomiale, operații exacte, rank, dimensiuni de matrice, bits și candidați.
2. Derivă limite pentru subfamilii sau măcar curbe explicabile; testează ordonări și descompuneri care reduc complexitatea.
3. Aplică bugete pentru fiecare fază, cu checkpoint și reluare dependentă de versiune.

**Comparatori și ablații.** Learner actual; Enumerare la buget egal; Ordini aleatoare; Strategie structurală fixă.

**Metrici.** Rată de succes în buget; Cost în operații și biți; RAM maxim; Calitatea predicției costului.

**Criteriu de susținere.** O limită formală pe o familie sau o politică reproducibil mai eficientă; factorii ascunși de dimensiune/precizie sunt expuși.

**Ce ar infirma ipoteza în domeniul testat.** Măsura propusă nu explică niciun cost sau schimbarea ordinii produce câștiguri alese post-hoc.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Bit-budget explicit; Reluare fără coruperea candidaților; NO_MODEL vs irreducibilitate dovedită.

**Puncte de pornire existente.** [docs/LIMITS.md](../docs/LIMITS.md) · [docs/MECHANISMS.md](../docs/MECHANISMS.md) · [src/planner.mjs](../src/planner.mjs)

**Artefact viitor.** `research/runs/R35/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r36"></a>
### R36 — Securitate, proveniență și date private în traseul de învățare

**Prioritate:** P1 · **Experiment:** PLANNED · **Dependențe:** R05, R31

**Starea actuală.** Traces sunt opt-in, workerul nu este sandbox OS, iar hash-urile nu sunt control de acces.

**Ipoteza.** Artefactele de calcul pot fi reutilizate fără scurgerea datelor originale și fără a permite codului sau textului neîncrezut să ocolească verificarea.

**Date și separarea loturilor.** Intrări SOP malformate, expresii de epuizare a resurselor, artefacte mutate, două domenii de acces și surse revocate; teste locale sintetice, fără date personale reale.

**Plan de implementare și verificare.**

1. Definește modelul de amenințări și separă parserul, checkerul, kernelul generat și stocarea urmelor.
2. Testează izolarea în proces/container, limitele de resurse și ACL pentru registry; păstrează doar metadatele necesare selecției unde este posibil.
3. Auditează dacă encoderul/certificatul conține constante sensibile sau fragmente de premise și măsoară utilitatea tracing-ului minimizat.

**Comparatori și ablații.** Tracing complet local; Tracing minimizat; Registry separat per tenant; Worker fără protecție OS, doar ca delimitare.

**Metrici.** Accesuri neautorizate blocate; Date sensibile păstrate; Cost de izolare; Teste de epuizare și recovery.

**Criteriu de susținere.** Nicio traversare între domenii autorizate și nicio funcție adusă de artefact executată; limitele OS și ale checkerului sunt explicit diferite.

**Ce ar infirma ipoteza în domeniul testat.** Un certificat corect este tratat drept autorizație de acces sau revocarea unei surse nu afectează reutilizarea dependentă de acea sursă.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Prompt-like text nu devine JS; Path traversal respins; Tenant mismatch; Traces dezactivate nu scriu snapshoturi.

**Puncte de pornire existente.** [docs/SAFETY_AUDIT_03.md](../docs/SAFETY_AUDIT_03.md) · [src/isolated.mjs](../src/isolated.mjs) · [docs/LEARNING_AND_DREAMING.md](../docs/LEARNING_AND_DREAMING.md)

**Artefact viitor.** `research/runs/R36/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

## G. Ramurile matematice din brainstormingul inițial

<a id="r37"></a>
### R37 — Algebre care anulează automat combinațiile invalide

**Prioritate:** P3 · **Experiment:** PLANNED · **Dependențe:** R09, R24

**Starea actuală.** Experimentul algebra a redescoperit operații locale, inclusiv pătrat nul; această familie nu este un mecanism general al plannerului curent.

**Ipoteza.** Sinteza unui produs algebric poate înlocui verificarea repetată a unor restricții de reutilizare cu o operație compozițională ieftină.

**Date și separarea loturilor.** Trasee fără repetare, alocări cu resurse exclusive și selecții de dovezi cu identificatori expliciți de origine; gramatici finite mici exhaustive, apoi familii parametrizate.

**Plan de implementare și verificare.**

1. Enumeră produse și encodere într-o gramatică declarată; impune identitate/asociativitate numai dacă fac parte din ipoteză.
2. Verifică separat anularea invalidelor și supraviețuirea validelor; coeficienții și domeniul trebuie să evite anulări accidentale.
3. Compară calculul algebric cu bitset/DP și cu metode specializate; păstrează costul bazei și decodării.

**Comparatori și ablații.** Verificare explicită de mulțimi; DP de atribuire; Operație cunoscută furnizată ca reper; Căutare de produs versus produs fix.

**Metrici.** Corectitudine combinatorială; Complexitatea reprezentării; Cost compunere+citire; Număr de proprietăți recuperate de același motor.

**Criteriu de susținere.** O reprezentare inteligibilă verificată, cu eficiență sau integrare comună utilă; o redescoperire este marcată ca atare.

**Ce ar infirma ipoteza în domeniul testat.** Produse valide dispar accidental ori origini distincte sunt prezentate ca dovadă a independenței statistice.

**Regresii de adăugat — nu sunt implementate prin această fișă.** u*u=0 elimină repetarea; Două origini cu același conținut nu sunt automat independente; Caz fără soluții.

**Puncte de pornire existente.** [history/archives/algebra.zip](../history/archives/algebra.zip) · [history/archives/exp2.zip](../history/archives/exp2.zip) · [history/SESSION_LEDGER.md](../history/SESSION_LEDGER.md)

**Artefact viitor.** `research/runs/R37/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r38"></a>
### R38 — Redundanță semantică și raționament de tip corectare a erorilor

**Prioritate:** P3 · **Experiment:** PLANNED · **Dependențe:** R11, R47

**Starea actuală.** Direcție de brainstorming; nu există memorie semantică corectoare de erori în VRC.

**Ipoteza.** Constrângeri locale redundante pot localiza sau reconstrui informație lipsă mai ieftin decât reevaluarea integrală, fără a șterge excepții reale.

**Date și separarea loturilor.** Bilanțuri, relații temporale și tabele relaționale cu 0–20% coruperi/ștergeri injectate; set separat de observații rare dar corecte și constrângeri cu excepții.

**Plan de implementare și verificare.**

1. Separă constrângerile certe, regulile statistice și observațiile sursă.
2. Învață sau selectează verificări locale; produce ipoteze de reparație și un certificat condiționat, nu rescriere automată a sursei.
3. Compară cu propagare de constrângeri și reconstrucție globală la același buget.

**Comparatori și ablații.** CSP/propagare pe model complet; Cache fără redundanță; Verificări locale manuale; Model statistic, separat.

**Metrici.** Precizie localizare; Recuperare de lipsuri; Excepții corecte alterate; Cost per reparație.

**Criteriu de susținere.** Reducere utilă a costului/erorilor, cu zero rescrieri neautorizate ale sursei și cu ambiguitatea raportată.

**Ce ar infirma ipoteza în domeniul testat.** Sistemul corectează sistematic noutatea reală pentru a se potrivi regularităților vechi.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Excepție adevărată nu devine eroare; Două reparații posibile; Constrângere statistică nu produce certificat exact.

**Puncte de pornire existente.** [history/SESSION_LEDGER.md](../history/SESSION_LEDGER.md) · [docs/RESEARCH_NARRATIVE.md](../docs/RESEARCH_NARRATIVE.md)

**Artefact viitor.** `research/runs/R38/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r39"></a>
### R39 — Abstracții comportamentale din teste și factorizare Hankel

**Prioritate:** P3 · **Experiment:** PLANNED · **Dependențe:** R07, R12

**Starea actuală.** Ideea apare în brainstorming; nucleul actual nu învață automate ponderate din matrice de prefixe și continuări.

**Ipoteza.** Stările definite prin efectul asupra testelor viitoare pot oferi o reprezentare comună pentru secvențe și proceduri, mai compactă decât identitatea istoriilor.

**Date și separarea loturilor.** Automate finite/ponderate sintetice, istorii lungi și teste discriminatorii; rang cunoscut numai evaluatorului. Exemple cu aceeași vocabularistică, comportamente diferite.

**Plan de implementare și verificare.**

1. Construiește observații prefix–continuare fără acces la starea ascunsă.
2. Factorizează și rafinează testele; în varianta finită verifică echivalența pe întregul model, nu numai pe matricea observată.
3. Integrează starea învățată ca modul cu contract E/G și compară cu learneri de automate și memorarea istoriilor.

**Comparatori și ablații.** Automat minimal oracle; Învățare spectrală/automate pe același acces; Istoric brut; VRC numeric când domeniul se traduce fără pierderi.

**Metrici.** Dimensiune/rang; Număr de teste; Transfer la continuări lungi; Timp per pas.

**Criteriu de susținere.** Recuperează reprezentări suficiente pe familii noi și semnalează când testele sunt insuficiente; compară valoarea unificării, nu numai recordul specialistului.

**Ce ar infirma ipoteza în domeniul testat.** Echivalența pe eșantion este prezentată drept echivalență pentru toate întrebările viitoare.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Două istorii separate de un test nou; Test de paritate; Ponderi distincte în același suport Boolean.

**Puncte de pornire existente.** [history/SESSION_LEDGER.md](../history/SESSION_LEDGER.md) · [docs/RESEARCH_NARRATIVE.md](../docs/RESEARCH_NARRATIVE.md)

**Artefact viitor.** `research/runs/R39/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r40"></a>
### R40 — Ordine, semnături de secvențe și compoziție necomutativă

**Prioritate:** P3 · **Experiment:** PLANNED · **Dependențe:** R09, R19

**Starea actuală.** Path signatures și sketch-uri au fost propuse conceptual; nu sunt algoritmi incluși în runtime.

**Ipoteza.** O reprezentare compozițională sensibilă la ordine poate recunoaște structuri de proceduri și reduce costul combinării fragmentelor.

**Date și separarea loturilor.** Secvențe de evenimente și argumente formalizate, perechi cu aceleași elemente în altă ordine, lungimi 10–10^4 și niveluri de trunchiere/sketch separate.

**Plan de implementare și verificare.**

1. Definește encodarea evenimentelor și operația de concatenare; verifică proprietatea de compoziție în nivelul trunchiat declarat.
2. Compară stocarea exactă, semnătura trunchiată și sketch-ul; păstrează separat identificarea aproximativă de verificarea ordinii exacte.
3. Testează regăsirea unei structuri cu etichete noi și limitele de reconstrucție/proveniență.

**Comparatori și ablații.** N-grame; Secvență exactă/automaton; Features ordonate simple; Reprezentare ignorând ordinea, control.

**Metrici.** Discriminare de ordine; Memorie; Cost concatenare/query; Coliziuni și fals-pozitive.

**Criteriu de susținere.** Avantaj pe o sarcină definită la buget egal; o potrivire aproximativă nu este utilizată singură pentru a certifica o demonstrație.

**Ce ar infirma ipoteza în domeniul testat.** Diferențele de ordine relevante se pierd sau decodarea recitește întotdeauna tot textul.

**Regresii de adăugat — nu sunt implementate prin această fișă.** A apoi B diferă de B apoi A; Concatenare asociativă în profil; Sketch collision → verificare exactă.

**Puncte de pornire existente.** [history/SESSION_LEDGER.md](../history/SESSION_LEDGER.md) · [docs/RESEARCH_NARRATIVE.md](../docs/RESEARCH_NARRATIVE.md)

**Artefact viitor.** `research/runs/R40/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r41"></a>
### R41 — Concepte ca operatori: descoperirea coordonatelor operațiilor

**Prioritate:** P3 · **Experiment:** PLANNED · **Dependențe:** R09, R14

**Starea actuală.** VRC conține reducere de dinamică numerică; analogia operatorială între domenii rămâne ipoteză.

**Ipoteza.** Învățarea operațiilor și a legilor lor de compunere poate transfera proceduri între contexte, nu doar compara vectori de obiecte.

**Date și separarea loturilor.** Transformări afine, deplasări circulare, permutări și operații cu ordine relevantă; domenii cu aceeași structură algebrică, dar etichete și coordonate diferite.

**Plan de implementare și verificare.**

1. Caută E și operatori Ga cu compoziție verificată; operațiile fără inversă nu primesc o inversă artificială.
2. Recuperează pe controale coordonate care simplifică deplasările și compară costul transformării inițiale cu economia ulterioară.
3. Testează compoziții de operatori nevăzute, cu decoder și domeniu de validitate explicit.

**Comparatori și ablații.** Operatori în coordonate originale; Baze/transformări specializate; Memorarea procedurilor complete.

**Metrici.** Generalizare la compoziții; Dimensiune; Cost codificare+aplicare; Identități verificate.

**Criteriu de susținere.** Proceduri noi obținute din operatori cunoscuți, corecte în contract și economice la reutilizare.

**Ce ar infirma ipoteza în domeniul testat.** Sistemul memorează secvențele sau simplificarea operației mută un cost mai mare în E/D.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Scade 10 apoi −10% versus ordinea inversă; Operator neinvertibil; Compoziție ținută în afara antrenării.

**Puncte de pornire existente.** [docs/MECHANISMS.md](../docs/MECHANISMS.md) · [history/SESSION_LEDGER.md](../history/SESSION_LEDGER.md)

**Artefact viitor.** `research/runs/R41/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r42"></a>
### R42 — Compatibilitate între perspective locale și defecte globale

**Prioritate:** P3 · **Experiment:** PLANNED · **Dependențe:** R15, R47

**Starea actuală.** Perspectiva de tip sheaf a fost discutată conceptual; nu există un modul de lipire a teoriilor locale.

**Ipoteza.** Reprezentări locale cu interfețe de compatibilitate pot localiza contradicții distribuite fără a uniformiza sau șterge contextul surselor.

**Date și separarea loturilor.** Rețele temporale și de unități/măsurători cu cicluri consistente/inconsistente, contexte legitime diferite și mapări greșite; apoi fragmente formalizate manual din documente.

**Plan de implementare și verificare.**

1. Definește ce se compară pe suprapunerea a două contexte și verifică mapările de coordonate/unități.
2. Detectează defecte de compatibilitate și produce un subset-martor al constrângerilor implicate.
3. Compară cu rezolvarea de ecuații/CSP standard; evaluează dacă structura locală aduce cost sau interpretabilitate mai bună.

**Comparatori și ablații.** Sistem global de ecuații; CSP/SMT compatibil; Verificări independente per context; Model local cu interfețe cunoscute.

**Metrici.** Contradicții localizate; Fals-conflicte din contexte diferite; Mărime martor; Cost incremental la sursă nouă.

**Criteriu de susținere.** Măcar eficiență sau structură explicativă utilă peste formalizarea globală simplă, cu martori verificabili.

**Ce ar infirma ipoteza în domeniul testat.** O convenție locală diferită este etichetată fals drept contradicție sau metoda doar redenumește un solver mai simplu fără avantaj.

**Regresii de adăugat — nu sunt implementate prin această fișă.** 2+3 versus 4 într-un ciclu; Unități diferite compatibile; Context local păstrat în proveniență.

**Puncte de pornire existente.** [history/SESSION_LEDGER.md](../history/SESSION_LEDGER.md) · [docs/RESEARCH_NARRATIVE.md](../docs/RESEARCH_NARRATIVE.md)

**Artefact viitor.** `research/runs/R42/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r43"></a>
### R43 — Compilare de familii de posibilități și contracție tensorială

**Prioritate:** P3 · **Experiment:** PLANNED · **Dependențe:** R09, R24

**Starea actuală.** Au fost discutate knowledge compilation și algoritmi holografici; runtime-ul nu descoperă baze generale care fac contracții tractabile.

**Ipoteza.** Învățarea unor descompuneri și schimbări de bază verificate poate simplifica operații asupra multor posibilități fără enumerare.

**Date și separarea loturilor.** Factor graphs și probleme de numărare cu structură rară/densă, rank redus și transformări ascunse; familii de dimensiune controlată cu răspuns exact cunoscut.

**Plan de implementare și verificare.**

1. Explicitează semiring-ul, factorii și operațiile; propune ordini de eliminare, factorizări și baze tipate.
2. Verifică păstrarea contracției și măsoară costul reprezentării intermediare, transformării și rezultatului.
3. Compară cu eliminare/trellis/structuri de decizie și ordine optimizate ale comparatorilor; nu revendica tractabilitate generală.

**Comparatori și ablații.** Eliminare de variabile; DP pe frontieră/trellis; Ordine de contracție euristică; Bază cunoscută ca reper.

**Metrici.** Lățime/rank intermediar; Operații și RAM; Număr exact; Cost compilare+reutilizare.

**Criteriu de susținere.** O clasă nou tratată eficient în motorul comun sau un câștig repetabil față de comparatori adecvați.

**Ce ar infirma ipoteza în domeniul testat.** Toată dificultatea rămâne în găsirea bazei ori transformarea nu păstrează valoarea exactă.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Contracție egală înainte/după; Ordine proastă păstrată ca negativ; Nu confunda memoria holografică cu algoritmii holografici.

**Puncte de pornire existente.** [history/archives/audit.zip](../history/archives/audit.zip) · [history/archives/algebra.zip](../history/archives/algebra.zip) · [docs/REFERENCES.md](../docs/REFERENCES.md)

**Artefact viitor.** `research/runs/R43/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r44"></a>
### R44 — Ruliologie executabilă: căutare comună în reguli și reprezentări

**Prioritate:** P3 · **Experiment:** PLANNED · **Dependențe:** R07, R09, R37

**Starea actuală.** Căutarea micilor tabele algebrice a fost efectuată în primul experiment; un laborator general de lumi și reprezentări nu este implementat.

**Ipoteza.** Un spațiu tipat de mici teorii executabile, cu criterii de utilitate și observație, poate descoperi familii de operații interpretabile și reutilizabile.

**Date și separarea loturilor.** Operații pe domenii de 2–4 elemente și mici sisteme liniare/Boolean; enumerare completă unde este fezabilă, apoi căutare structurată cu seed fix.

**Plan de implementare și verificare.**

1. Separă alegerea gramaticii de răspunsul descoperit; fixează observațiile ce trebuie recuperate pentru a exclude encoderul constant trivial.
2. Caută reguli, E/G/D și probe de compoziție; păstrează diversitatea mecanismelor, nu numai un scor de compresie.
3. Testează redescoperirea unor proprietăți cunoscute și transferul lor către lumi noi, costul total inclus.

**Comparatori și ablații.** Enumerare oarbă; Reguli fixe cu encoder învățat; Encoder fix cu reguli învățate; Căutare comună.

**Metrici.** Clase de comportament descoperite; Certificare; Cost de căutare; Transfer operațional; Descriere minimală în gramatica dată.

**Criteriu de susținere.** Rezultate inteligibile și verificabile pe o familie delimitată, cu eficiență sau acoperire comună mai bună decât ablațiile.

**Ce ar infirma ipoteza în domeniul testat.** Criteriul recompensează pierderea întregii informații sau „noutatea” este doar redenumirea unei structuri deja enumerate.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Encoder constant respins prin cerința de observație; Operații asociative versus neasociative; Ștergerea unei capacități vechi detectată.

**Puncte de pornire existente.** [history/archives/algebra.zip](../history/archives/algebra.zip) · [history/SESSION_LEDGER.md](../history/SESSION_LEDGER.md)

**Artefact viitor.** `research/runs/R44/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

## H. Interfețe cu ML, limbaj și cunoaștere semantică

<a id="r45"></a>
### R45 — Propuneri neuronale sau LLM, verificare simbolică obligatorie

**Prioritate:** P2 · **Experiment:** PLANNED · **Dependențe:** R06, R08, R05

**Starea actuală.** Motorul curent folosește propuneri matematice programate; nu necesită LLM și nu este demonstrat un avantaj al unui proposer neural.

**Ipoteza.** Un model învățat din urme poate ordona sau produce candidați E/G și poate scurta descoperirea fără a schimba baza de încredere a verdictului exact.

**Date și separarea loturilor.** Artefacte și eșecuri provenite din familii separate train/test; test leave-family-out, mărimi și coeficienți noi. Timpul antrenării și apelurilor este parte din cost.

**Plan de implementare și verificare.**

1. Definește output tipat în gramatica comună, fără cod liber executabil; păstrează generatorul determinist ca fallback.
2. Antrenează modelul să propună sau să ordoneze, nu să emită eticheta VERIFIED.
3. Compară același checker și buget final pentru random, euristic și neural; măsoară și amortizarea offline.

**Comparatori și ablații.** Ordine euristică existentă; Propuneri aleatoare la buget egal; Model mic versus mai mare; Oracle de reprezentare numai ca plafon.

**Metrici.** Timp până la certificat; Rată candidați validați; Cost antrenare și inference; Generalizare la familii.

**Criteriu de susținere.** Beneficiu net de descoperire sau acoperire comună, iar orice candidat incorect este respins indiferent de încrederea modelului.

**Ce ar infirma ipoteza în domeniul testat.** Modelul memorează formulele de test ori costul său depășește câștigul; răspunsuri necertificate ajung în registry-ul exact.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Candidat adversarial valid sintactic, fals matematic; Model indisponibil → fallback; Certificat nu este textul de explicație al LLM.

**Puncte de pornire existente.** [docs/MECHANISMS.md](../docs/MECHANISMS.md) · [docs/LEARNING_AND_DREAMING.md](../docs/LEARNING_AND_DREAMING.md)

**Artefact viitor.** `research/runs/R45/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r46"></a>
### R46 — Ingestie NL→SOP și verificarea fidelității formalizării

**Prioritate:** P3 · **Experiment:** PLANNED · **Dependențe:** R36, R47

**Starea actuală.** SOP este input formal; biblioteca nu dovedește adevărul premiselor sau corectitudinea extragerii din text.

**Ipoteza.** Formalizarea cu surse și ambiguități explicite poate furniza taskuri utile VRC fără a confunda certificarea calculului cu certificarea interpretării.

**Date și separarea loturilor.** Documente scurte EN/RO cu numere, condiții, excepții și reformulări; gold formal făcut independent; train/test separat pe document și șablon semantic.

**Plan de implementare și verificare.**

1. Construiește o interfață de candidat SOP cu spans de sursă, unități, domenii și statut de aprobare.
2. Verifică sintaxa, tipurile și fidelitatea față de gold; neclaritățile cer abstention ori alternative, nu inventarea unui fapt.
3. Rulează reasoning doar pe partea acceptată și măsoară separat erorile de extracție, cunoaștere, reprezentare și search.

**Comparatori și ablații.** Formalizare umană gold; Translator fără verificare; Translator cu checker; Reasoner pe input perfect ca reper.

**Metrici.** Precizie semantică; Rată UNKNOWN corectă; Erori de unități/negație; Cost total; Calitatea provenienței.

**Criteriu de susținere.** O contribuție de integrare dacă calculele păstrează fidelitatea și oferă cost/trasabilitate utile; niciun certificat al ecuației nu este numit dovadă a textului.

**Ce ar infirma ipoteza în domeniul testat.** Erorile formalizatorului sunt mascate de un rezultat matematic exact sau toate ambiguitățile sunt rezolvate arbitrar.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Nu toate versus niciunul; Unități incompatibile; Excepție locală; Afirmație fără sursă.

**Puncte de pornire existente.** [docs/SOP.md](../docs/SOP.md) · [docs/LIMITS.md](../docs/LIMITS.md) · [docs/MECHANISMS.md](../docs/MECHANISMS.md)

**Artefact viitor.** `research/runs/R46/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r47"></a>
### R47 — Statute epistemice, contradicții și dependențe de surse

**Prioritate:** P2 · **Experiment:** PLANNED · **Dependențe:** R05

**Starea actuală.** Există negație explicită, absență acoperită și UNKNOWN pentru anumite cazuri; nu există o semantică generală de argumentare/revizuire.

**Ipoteza.** Contracte tipate pentru certitudine, acoperire și dependențe de surse permit folosirea capabilităților fără a transforma inconsistența sau lipsa în concluzii certe.

**Date și separarea loturilor.** Micro-lumi cu suport pozitiv/negativ, surse comune, acoperire retrasă, reguli de excepție și ipoteze; aceleași date evaluate sub politici declarate distincte.

**Plan de implementare și verificare.**

1. Definește explicit tipul fiecărui rezultat: derivat exact din premise, probabilistic, empiric, ipoteză ori necunoscut.
2. Propagă dependențele de premise și politici în dovezi și invalidare; nu impune un singur semiring pentru toate sensurile.
3. Testează că schimbarea unui context afectează numai rezultatele dependente și că nu apare explozie logică accidentală.

**Comparatori și ablații.** Kernel actual; Evaluator finit independent al politicii; Sistem care ignoră proveniența, control.

**Metrici.** Verdicte corecte pe politica aleasă; Dovezi stale; Surse duble; Cost al provenienței.

**Criteriu de susținere.** Separare consecventă a statusurilor și replay valid după actualizări; independența statistică nu este dedusă din simpla diferență a identificatorilor.

**Ce ar infirma ipoteza în domeniul testat.** Unknown devine false neautorizat sau două copii ale aceleiași dovezi cresc artificial certitudinea.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Pozitiv și negativ coexistă; Acoperire incompletă; Sursă revocată; Două copii ale aceleiași origini.

**Puncte de pornire existente.** [src/engine.mjs](../src/engine.mjs) · [src/store.mjs](../src/store.mjs) · [docs/LIMITS.md](../docs/LIMITS.md) · [docs/REGRESSION_PROPERTIES.md](../docs/REGRESSION_PROPERTIES.md)

**Artefact viitor.** `research/runs/R47/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

<a id="r48"></a>
### R48 — Abstracții relaționale și transfer de roluri între domenii

**Prioritate:** P3 · **Experiment:** PLANNED · **Dependențe:** R14, R29, R47

**Starea actuală.** VRC grupează după comportamentul relevant numeric; învățarea conceptelor relaționale și analogiilor între domenii nu este implementată.

**Ipoteza.** Roluri definite prin relații și teste de comportament pot transfera reguli sau reprezentări între domenii fără a uni identități care trebuie păstrate.

**Date și separarea loturilor.** Grafuri de roluri, fluxuri și proceduri cu etichete disjuncte; sarcini isomorfe, aproape-isomorfe și false analogies; domenii întregi ținute în afara antrenării.

**Plan de implementare și verificare.**

1. Descoperă mapări tipate între roluri și relații, cu condiții explicite de transfer.
2. Transportă o regulă/artefact ca propunere și recertifică în domeniul destinație.
3. Compară cu redenumire simplă, graph matching și învățare de la zero; include întrebări despre identitatea originală.

**Comparatori și ablații.** Matching structural clasic; Transfer de nume oracle; Fără transfer; Similarity-only, fără promovare exactă.

**Metrici.** Taskuri transferate corect; Cost economisit; False analogies respinse; Identități și proveniență păstrate.

**Criteriu de susținere.** Utilitate pe domenii noi și respingerea mapărilor care nu păstrează operațiile relevante.

**Ce ar infirma ipoteza în domeniul testat.** Sistemul confundă asemănarea cu echivalența sau nu mai poate răspunde unei întrebări care distinge identitățile.

**Regresii de adăugat — nu sunt implementate prin această fișă.** Aceeași structură, nume diferite; O singură regulă rupe analogia; Întrebare despre identitate interzice merge.

**Puncte de pornire existente.** [docs/RESEARCH_NARRATIVE.md](../docs/RESEARCH_NARRATIVE.md) · [docs/MECHANISMS.md](../docs/MECHANISMS.md) · [history/SESSION_LEDGER.md](../history/SESSION_LEDGER.md)

**Artefact viitor.** `research/runs/R48/result.json`; protocol, date, repetiții brute, certificate și contraexemple în același subarbore. Gate-uri: S1–S6.

## Cum se extinde catalogul

Se adaugă un ID nou stabil, fără renumerotarea celor vechi, cu toate câmpurile din catalog. O direcție respinsă experimental rămâne în catalog, legată de raportul negativ. O capacitate implementată primește o intrare de versiune și teste executabile; nu se modifică retrospectiv statusul acestei revizii documentare. Rezultatele noi se înregistrează în subdirectoare de rulare, nu în șabloanele PLANNED.
