# 23. Arhitectura consolidată: memorie, modele și reasoning

## Obiectiv

RecallSOP este un agent în care un model lingvistic mic recunoaște ce afirmă sau cere utilizatorul și produce un circuit SOP Lang. Memoria furnizează cunoaștere; un motor execută circuitul; un rezultat controlat arată concluzia și temeiurile sale. Un al doilea model poate reformula acest rezultat. Cunoașterea și procedurile noi pot fi publicate fără modificarea greutăților neuronale. Aceasta este ipoteza sistemului; succesul parserului românesc de 270M trebuie măsurat pe Spark.

Profilul implementat se numește `sop-agent-3`. SOP rămâne singurul limbaj în care omul, modelul sau coding agentul autorizează conținut semantic executabil. Parserul construiește obiecte JavaScript tipizate; acestea nu sunt un limbaj suplimentar pe care trebuie să îl genereze LLM-ul. Configurațiile și rândurile de training sunt JSON/JSONL doar ca transport.

Nu alegem între «memorie asociativă» și «bază de date» o dată pentru tot proiectul. Separăm două axe: motorul care păstrează/recuperează informația și strategia care o interpretează. Un circuit trebuie să aibă același sens când schimbăm aceste axe, deși costul, completitudinea recuperării și limitele de căutare pot diferi.

## Trei roluri pentru informație

| Rol | Reprezentare și responsabilitate |
|---|---|
| Experiență și sursă | Documentul sau observația originală; un `trace` păstrează textul și trăsăturile unui caz. Formalizarea nu trebuie să distrugă originalul. |
| Cunoaștere și definiții | `fact`, evenimente de actualizare, reguli aprobate, ontologie, proceduri, proveniență. Faptele folosesc motorul de memorie ales. Definițiile executabile aprobate sunt păstrate exact în biblioteca versionată, indiferent de motorul faptelor. |
| Obiecte de explorare | `pattern`, `hypothesis`, analogii și planuri. Acestea pot sugera o întrebare sau o regulă de verificat; nu intră automat în setul de premise adevărate. |

În modul hibrid, un depozit SQLite exact și o bancă asociativă sunt actualizate împreună. Depozitul exact furnizează premisele; banca asociativă poate furniza indicii. În modul Weaver-only sau Holo-only, completarea faptelor continuă să fie experimentală și nu necesită o copie exactă SQL a tuturor tuplelor. Domeniile, amprentele de verificare, metadatele temporale și biblioteca de reguli rămân totuși costuri reale.

Un `fact` înseamnă «afirmație admisă cu această sursă și valabilitate», nu adevăr ontologic garantat. SQL nu transformă o afirmație falsă într-una adevărată. Un proof demonstrează o consecință a premiselor și regulilor admise.

## Cum se leagă operațiile

Pentru o întrebare despre o persoană, resolverul găsește ID-urile și predicatele candidate. Modelul produce un `query` și un `solve` sau instanțiază o `procedure` aprobată. Linkerul unifică scopul cu concluziile regulilor. Premisele regulilor devin interogări de memorie. Strategia de memorie recuperează faptele; solverul leagă variabilele comune; ieșirile selectate sunt materializate ca fire. CNL exprimă rezultatul, intervalul și dovezile.

Pentru o întrebare «de ce?», trebuie deosebite două sensuri. `query mode explain` cere dovada unei concluzii deja derivabile. `abduce` caută presupuneri suplimentare care ar explica o observație. A doua operație poate propune cauze candidate, nu poate confirma cauza reală doar pentru că explicația este coerentă.

Un rezultat numeric consumă valori recuperate prin `$duration`, `$start` etc. Nu trimitem întregul KB unui solver numeric. Un `constraint` conține explicit subproblema; compilerul traduce AST-ul acesteia. Dacă o problemă mixtă nu a fost separată în etape, motorul refuză să elimine restricțiile doar ca să o transforme într-o problemă Horn.

## Bucla rapidă și bucla lentă

Bucla rapidă formalizează o observație, recuperează premise, calculează răspunsul și eventual memorează o afirmație explicit autorizată. Nu modifică singură regulile aprobate. Folosirea unei premise reale într-o demonstrație neipotetică poate întări acea amintire. Recuperarea unui candidat, o analogie sau o simulare nu reprezintă confirmare.

Bucla lentă lucrează pe un lot de `trace` și documente. `associate` propune cazuri; `induce` generează/evaluează pattern-uri; un coding agent poate propune o regulă, un predicat sau o procedură. Verificarea folosește cazuri distincte, contraexemple și analiză semantică. Publicarea unei definiții schimbă explicit biblioteca. Pachetul include operațiile, skill-urile și fișierele necesare; nu rulează un serviciu autonom de auto-modificare în fundal.

## Cum integrăm propunerea

Textul furnizat este păstrat în `docs/references/RecallSOP-proposal.docx` și în forma extrasă `.txt`. Comparația SQLite/Weaver/H7/scan rămâne disponibilă. Introducem separat profilul hibrid real. Pattern-urile, ipotezele, acțiunile și urmele devin obiecte tipizate. Abducția poate genera premise lipsă prin reguli. Planificarea are stare și efecte explicite. Contra-factualele necesită reguli cauzale, nu doar asociere temporală.

Propunerea descria și posibilități mai largi. Documentăm exact ce există: mining simplu pe cazuri explicite, analogii finite, planificare deterministă și intervenții Horn. Nu prezentăm aceste profile drept învățare conceptuală nelimitată, probabilități bayesiene sau causalitate identificată din date. Acestea au puncte de extensie fără a schimba rolurile arhitecturii.
