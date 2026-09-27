# 24. Contractul semantic al firelor SOP

## Sintaxă și tipuri

O declarație începe cu `@nume tip`. Câmpurile încep pe linii indentate cu două spații. `$nume` consumă o valoare; `~nume` selectează o definiție aprobată; `?x` este o variabilă logică locală. Un producător care declară `output ?x one` rezervă firul viitor `$x`; nu trebuie și nu este permis un `@x` concurent. `binding` este creat exclusiv de runtime.

`src/sop/parser.js:SPEC` este schema sintactică executată. `docs/contracts/wires.json` și `wire-fields.md` sunt generate din aceeași sursă și enumeră **toate** câmpurile acceptate, cardinalitățile și cele obligatorii. `lower.js` verifică semantica: termeni, tipuri, intervale, legarea variabilelor și operatorii numerici. O cheie necunoscută nu este ignorată.

Profilul portabil folosește atomi cu 1–4 argumente, constante string sau întregi JavaScript siguri, variabile `?x` și negație explicită `not`. Aceasta este o limită concretă a reprezentării băncilor actuale, nu o afirmație despre toate relațiile posibile. Relațiile mai bogate sunt reificate: evenimentul primește ID, iar participanții, rolurile și timpii sunt fapte distincte. De exemplu `transfer(e1)`, `giver(e1, ana)`, `receiver(e1, bob)`, `item(e1, carte)`, `event_time(e1, 1760000000)` păstrează împreună rolurile unui eveniment fără pierderea identității lui. Predicatele trebuie declarate în ontologie.

Listele și obiectele intermediare pot circula în `value`, `pack` și `jsEval`; nu sunt automat argumente structurale Prolog. Un calcul ce necesită funcții logice, cuantificare existențială generală, probabilități sau teorii arbitrare trebuie să declare un profil de extensie. Nu reinterpretăm asemenea construcții ca simple stringuri cu aceeași semantică.

## Declarațiile și natura lor

| Fir | Semnificație, reguli și efecte |
|---|---|
| `fact` | Atom complet, interval obligatoriu, sursă/citat/retenție. Crearea firului nu salvează nimic; `assert` autorizează scrierea. Nu se deduce negația din absență. |
| `event` | Comandă temporală `end`, `retract` sau `correct` asupra unui claim identificat. Nu este un event calculus general. Evenimentele din lumea reală pot fi reificate prin facts. |
| `rule` | Corp conjunctiv `when` și concluzie `then`, 1–16 premise. Variabilele concluziei trebuie legate în corp. `mode logical` implicit; `mode causal` declară semantica cauzală a modulului. Nu este învățată automat din corelație. |
| `pattern` | Aceeași structură antecedent/consecvent, dar `status candidate|validated|rejected` și statistici descriptive. Chiar `validated` nu îl face `rule`; promovarea este o publicare distinctă. |
| `hypothesis` | Una sau mai multe presupuneri ground prin `holds`/`assume`, cost nenegativ și status. Este o explicație posibilă sau intervenție, nu observație. |
| `trace` | Text, trăsături ground, sursă și eventual moment. `closed false` implicit. `closed true` certifică doar completitudinea cazului pentru evaluarea pattern-urilor și cere ingestie revizuită. |
| `action` | Parametri, precondiții, efecte `adds`/`removes`, cost nenegativ, valabilitate. Variabilele efectelor trebuie legate în precondiții. Descrie o tranziție simulabilă; nu apelează un robot. |
| `goal` | Conjuncția stărilor dorite. Nu este dovadă că acestea există. |
| `query` | `select`, `exists`, `count`, `explain`, `where`, filtre, `at` sau `during`, și `asof`. Tipurile variabilelor provin din predicate. |
| `constraint` | Domenii întregi, premise `require`, afirmație `claim`, sarcina `prove|possible|optimize`. `objective` și `direction` sunt doar pentru optimize. |
| `procedure` / `template` | Un subcircuit aprobat, cu parametri și `yield`. Sunt aliasuri de implementare; referințele sunt rezolvate tranzitiv și redenumite igienic la `expand`. |
| `policy` | În acest profil: limite de căutare, numai ca restrângere a bugetelor host-ului. Politicile mai ample de retenție, autoritate și comportament rămân configurație de host. Modelul nu poate instala policy-uri. |
| `theory` | Definiție aprobată cu dialect și corp pentru o extensie. Motoarele livrate răspund `unsupported`; conservă distincția semantică în loc să o elimine. |
| `value` / `pack` | O valoare calculată/constantă, respectiv o colecție de valori sau definiții aprobate. Colecția nu convertește tipurile epistemice ale membrilor. |

## Operațiile de interpretare

| Fir | Intrări și rezultat |
|---|---|
| `recall` | Query și strategie de recuperare; cere o sesiune de memorie și produce premise candidate cu acoperire/proveniență. |
| `link` | Query, facts/rules locale opționale, bibliotecă și memorie. Explorează regulile prin concluzii și agenda premiselor. |
| `solve` | Query sau constraint, nu ambele. Expandează circuitul în link/reason/binding. `strategy` privește memoria; `reasoning` privește engine-ul. |
| `reason` | Execută o subproblemă explicită. `mode deduce|classify|temporal` pentru relații; `constraint` separat pentru calcul numeric. `classify` folosește reguli, nu un clasificator probabilistic. |
| `temporal` | Query cu `at/during/asof`, eventual memorie și date. Este intrarea explicită pentru aceeași semantică temporală, nu alt calendar. |
| `abduce` | Query ground sau observation, reguli/premise și ipoteze opționale. Produce explicații candidate, costuri și demonstrația condiționată de presupuneri. |
| `diagnose` | Abducție plus queries de test ground. Ordonează verificările care separă explicațiile. Nu execută acele verificări. |
| `associate` | Un caz-indiciu și un catalog de trace-uri; `mode lexical|relational|weaver`. Produce scoruri și referințe, nu premise demonstrate. |
| `induce` | Cazuri, pattern-uri candidate opționale și holdout opțional. Produce pattern-uri cu numărări și contraexemple. Fără candidați, generatorul simplu caută perechi de trăsături cu variabile comune. |
| `analogize` | Caz sursă, caz țintă și proprietăți de transfer. Produce mapări structurale și ipoteze de transfer. |
| `plan` | Goal, acțiuni aprobate, stare curentă recuperată sau explicită. Produce planuri pentru stări-țintă distincte, cu cost și pași, fără efecte externe. |
| `simulate` | Query și intervenție, `mode whatif|counterfactual`. Calculează într-o stare izolată și marchează rezultatul ipotetic. |
| `assert` | Scrie doar facts/events autorizate; instalarea bibliotecii cere aprobare de host. Nu este o operație generală «salvează orice rezultat ca adevăr». |
| `expand` | Instanțiază o procedură aprobată. La granița epocii sunt validate noile fire și ieșiri, apoi continuă schedulerul. |
| `jsEval` | Expresie locală interpretată cu allowlist, fără I/O, import, eval/Function, filesystem sau acces global. Transformă date, nu acordă autoritate semantică. |
| `cnl` / `clarify` | Exprimă rezultatul structurat, respectiv o cerere explicită de clarificare. CNL păstrează statutul, ipotezele, bugetele și proveniența. |

## Exemplu: o observație nu este explicația ei

```sop
@q query
  where outage(server7)
  at 2026-09-26

@explanations abduce
  query $q
  output ?possible_causes many

@answer cnl
  result $explanations
  language ro
```

Regulile aprobate vin prin linker. Motorul poate propune `disk_full(server7)` dacă acesta explică observația prin reguli. El nu emite și nu execută un `assert` pentru acel atom. Pentru confirmare trebuie o observație nouă, de exemplu rezultatul unei verificări aprobate.

## Ieșiri logice versus artefacte de explorare

La `solve query`, `one` înseamnă o singură valoare distinctă, fără conflicte, în vederea de memorie și căutarea declarate complete. Nu certifică recuperarea tuturor faptelor din lume; o memorie asociativă poate rata premise. La constraint, unicitatea este verificată în modelele permise, nu extrasă din primul model SAT.

La abducție/inducție/asociere/analogie, `many` materializează obiecte candidate tipizate. `one` înseamnă un singur obiect în colecția completă produsă; nu îl transformă în adevăr. La planificare, un plan ales cu cost minim nu este dovada că este singura cale posibilă: `selection` și `enumerationComplete` explică această distincție. O limită de căutare blochează ieșirile care pretind completitudine; ieșirea `status` rămâne disponibilă.

## Încredere și omisiuni

`score`, support și coverage nu sunt probabilități calibrate. `complete` este completitudinea căutării în profilul și memoria vizibile, nu certitudine metafizică. Un interpretor poate raporta `ignored` pentru pattern-uri când face deducție, fiindcă nu sunt premise admise. Nu poate elimina un constraint, o negație, un interval sau o teorie necesară doar pentru a putea produce un răspuns.
