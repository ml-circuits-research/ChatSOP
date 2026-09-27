# 26. Două axe independente și contractele de extensie

## Selectare

În configurație, `memory.engine` este unul dintre `weaver`, `holo`, `sqlite`, `scan`, `hybrid`. `policy.reasoningStrategy` este `reference` sau `advanced`. `policy.retrievalStrategy = auto` lasă adaptorul să citească băncile efectiv stocate. Fișierele `config/runtime-reference.json`, `runtime-advanced.json` și `runtime-hybrid.json` sunt exemple complete.

Schimbarea memory.engine pentru date deja stocate nu transformă băncile existente; folosește un root separat și reingerează. Schimbarea reasoningStrategy poate interpreta aceeași sesiune fără reingestie. Configurațiile SQL sau hibrid sunt recomandabile pentru verificarea semanticii înaintea experimentelor de memorie aproximativă.

| Strategie de reasoning | Comportament implementat |
|---|---|
| `reference` | Exclusiv JS; nu verifică și nu lansează solverele externe. Horn, intervale, căutare abductivă, teste de diagnostic, cazuri, inducție, analogie, planificare, intervenții, constrângeri finite, optimizare finită. |
| `advanced` | Pentru Horn la moment fix preferă SWI-Prolog dacă există; pentru constraints/optimize preferă Z3. Restul operațiilor folosesc controlerele JS comune. `route` arată backend-ul real și orice fallback. |
| Strategie înregistrată ulterior | Handler aprobat de host, contract de input/output și profil declarat. Nu poate schimba statutul unei ipoteze în fapt doar fiindcă produce un răspuns. |

Advanced nu înseamnă automat mai rapid sau mai inteligent. În implementarea actuală, Prolog calculează închiderea și JS reconstruiește/verifică derivările; acest dublu calcul este pentru audit, nu optimizare. Operațiile complexe nu sunt traduse universal în Prolog/Z3. Folosesc controlere comune, iar solverele exacte se pot integra în subcircuite explicit delimitate.

## Contractul cererii interne

`ReasoningRegistry.run(name, request)` primește un mod, obiecte tipizate pentru query/problem, fapte/rules recuperate cu completitudine, obiectele specifice operației și limitele host-ului. Modelul nu generează această structură JavaScript; runtime-ul o construiește din firele SOP validate.

Un handler întoarce cel puțin `kind`, `status`, `complete`. Pentru utilizare reală trebuie să păstreze și natura epistemică, premise/proof unde există, rezultatele tipizate, profilul/route și motivul unui rezultat unsupported/incomplete. `run` validează forma minimă; corectitudinea semantică a unui plugin rămâne responsabilitatea implementatorului și a testelor diferențiale. Plugin-urile sunt cod de host de încredere, nu sandbox-uri pentru cod emis de LLM.

Înregistrarea se face prin `ReasoningRegistry.register(name, handler)` și injectarea registrului în `Runtime`. Pentru tipuri SOP noi, `handlers` pe Runtime permite o extensie aprobată; handler-ul trebuie să valideze câmpurile și tipurile sale. Un nou dialect poate folosi `theory`, dar un motor fără compiler nu îl execută și nu îl ignoră.

## Contractul de memorie

`src/memory/banks/factory.js` construiește băncile. Contractul comun include scriere, reinforcement, recall, metadate, retenție, statistici și export/import. `src/strategies.js` rezolvă recuperarea din sesiunile/straturile vizibile. Linkerul vede atomi canonici, proveniență și acoperire, nu formatul fizic al băncii.

O strategie nouă trebuie să declare dacă enumeră exact toate tuplele reținute, dacă verifică candidații cu receipts sau dacă poate rata fapte. `complete` al unei căutări asociative nu este garanție de recall semantic 100%. Strategia nu poate fabrica proof-uri; furnizează doar premise candidate și dovezi de stocare/identitate.

## Hibridul real și numele legacy

`memory.engine = hybrid` creează **două** componente: SQLite pentru răspuns exact și Weaver/Holo pentru indicii. Orice scriere merge în ambele. `recall` folosește SQL drept sursă de premise și nu filtrează răspunsurile exacte prin banca aproximativă. `hints` expune separat rezultatul asociativ. Testul de integrare șterge banca asociativă și confirmă că răspunsul SQL rămâne disponibil. Exportul păstrează ambele componente și costurile lor.

Acesta nu este același lucru cu vechiul `retrievalStrategy = hybrid`, care combina o scanare exactă opțională cu fallback-ul băncii. Numele vechi este păstrat pentru compatibilitate; configurațiile noi folosesc `auto` cu engine-ul ales. Nu există o migrare silențioasă între aceste sensuri.

Ranking-ul prin indicii nu modifică implicit costurile abductive și nici ordinea tuturor căutărilor. Punctul de extensie există, dar o euristică nouă trebuie măsurată pe același buget și cu rezultate exacte păstrate. Costurile SQL + bancă + domains + receipts + bibliotecă trebuie adunate, nu raportate doar contoarele.

## Ce poate ignora un interpretor

Deducția poate ignora un `pattern` sau o `hypothesis` transmisă ca obiect de explorare, raportând `ignored`. Nu poate include acel obiect drept premisă. Un interpret de scorare poate folosi trace-uri și poate lăsa proof-ul gol. O teorie necunoscută obligatorie sau un constraint transmis unei operații relaționale produce `unsupported`, nu un răspuns optimist.

Nu este permisă eliminarea negației, intervalului, sursei de autoritate, cardinalității ieșirii ori statutului ipotetic. O regulă causal nu devine automat lege pentru planificare stocastică. Semantica SQL/Prolog/Z3 este reconciliată numai în profilele comune declarate.

## Mecanismul real de compilare

SOP este parsată în AST, simbolurile sunt rezolvate, variabilele sunt tipizate, iar linkerul construiește setul de premise. Compilerul Prolog encodează constantele, separă polaritățile și folosește tabling. Filtrarea temporală la punct este făcută înainte de compilare; răspunsurile pe intervale rămân JS în acest adaptor.

Compilerul SMT folosește declarații întregi, operatori permiși, premise și claim. `prove` necesită distincția satisfiabilitate/validitate: se caută și un contra-model, nu se confundă `sat` cu adevărul necesar. Optimizerul cere un optimum și verifică separat imposibilitatea unei valori mai bune. Proiecția numerică se verifică în modelele optime admise.

O problemă mixtă este compusă prin ieșiri: un query produce `$duration`; următorul constraint consumă acel întreg. Acesta este un contract explicit al grafului, nu un schimb liber de texte între solverele externe.
