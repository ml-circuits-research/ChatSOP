# 14. Ieșiri necunoscute și legarea automată a circuitului

## Ideea esențială

O interogare nu aduce numai cuvinte pentru căutare. Ea declară relația care trebuie satisfăcută, constantele cunoscute și valorile necunoscute. Regulile din memorie declară ce relații pot produce și din ce premise. **Linkerul compară cererea cu concluziile regulilor, caută premisele necesare și pregătește problema solverului.** După rezolvare, runtime-ul transformă rezultatele admise în fire normale ale circuitului.

Acesta este mecanismul dintre recuperare și inferență. Prolog și Z3 nu caută singure în Recall Weaver, nu citesc automat limbaj natural și nu decid că două predicate cu nume asemănătoare înseamnă același lucru. Canonicalizarea și linkerul pregătesc explicit datele pe care le primesc.

## Sintaxa ieșirilor

```sop
@q query
  select ?bunica
  where grandmother(?bunica, carina)
  at 2026-09-26

@r solve
  query $q
  output ?bunica one

@label jsEval
  expr "Bunica găsită: " + $bunica

@answer cnl
  result $r
  language ro
```

Nu definim `@bunica`. În `where`, `?bunica` este necunoscuta logică. În `output ?bunica one`, aceeași necunoscută este exportată ca fir al circuitului. `@r` este producătorul declarat; `$bunica` este consumatorul valorii, după rezolvare. `@r` însuși furnizează întregul rezultat, inclusiv răspunsurile, dovezile și statutul, nu doar valoarea extrasă.

`output ?bunica` este echivalent cu `output ?bunica one`. Forma explicită este recomandată în datele de antrenare pentru că face cardinalitatea vizibilă.

| Notație | Semnificație |
|---|---|
| `@x tip` | Fir explicit, definit de autor |
| `$x` | Dependență de valoarea firului x; poate indica și o ieșire generată |
| `~x` | Referință la o definiție aprobată, fără a cere valoarea sa |
| `?x` în regulă | Variabilă locală acelei reguli; nu cere existența unui fir |
| `?x` în query | Necunoscută locală interogării; `select` spune ce raportăm |
| `output ?x ...` pe `solve` | Rezervă numele firului x și declară cum trebuie materializat rezultatul |

Variabilele `?x` din două reguli sunt independente. Două query-uri care scriu ambele `?x` nu sunt legate implicit. Legătura între query-uri se face explicit cu `$x` după ce un `solve` a exportat ieșirea. Astfel nu apare capturare accidentală doar pentru că modelul a reutilizat o literă.

## Cardinalități și rezultate nedeterminate

| Mod | Valoarea firului | Când se definește |
|---|---|---|
| `one` | Scalar | Există exact o valoare distinctă, explorarea este completă în vederea declarată și nu există conflict identificat |
| `many` | Array de valori distincte | Explorarea este completă; array-ul gol înseamnă lipsa rezultatelor în vederea explorată |
| `rows` | Array de obiecte cu toate variabilele selectate | Păstrează împreună valorile care aparțin aceluiași răspuns |
| `count` | Număr de rezultate | Query-ul are `mode count` și căutarea este completă |
| `status` | Statutul formal al solverului | Se poate expune și pentru `unknown`, `unsupported` sau `inconsistent` |

Pentru `one` și `many`, numele trebuie să existe în `query.select` sau în variabilele declarate ale restricției. Pentru `rows`, `count` și `status`, numele desemnează containerul rezultat și nu trebuie să apară ca variabilă în query. `rows` relațional nu separă perechile în coloane independente; nu produce produsul cartezian al rezultatelor.

Dacă `one` are mai multe valori, ieșirea primește statut `ambiguous` și nu primește valoare. Lipsa răspunsului produce `no_answer`; un buget epuizat produce `incomplete`. Firele care depind de `$x` sunt marcate `blocked`. Alte ramuri, de exemplu CNL-ul rezultatului complet, pot continua. Interfața conversațională cere clarificare când chiar răspunsul final depinde de o ieșire nerezolvată.

Un nume nu poate fi produs de două fire `solve` și nu poate suprascrie un `@x` explicit. Numele sunt case-sensitive. În template-uri se aplică prefixare igienică atât firelor, cât și ieșirilor exportate.

## Ce face metaprogramarea

Înainte de execuție, runtime-ul construiește un registru al ieșirilor promise: pentru x există producătorul r și modul one. Registrul face legală referința `$x`, deși corpul firului nu există încă. Validarea dependențelor include muchia virtuală x → r; un ciclu este detectat înainte să pornească vreun efect.

Când intrarea lui `solve` este disponibilă, runtime-ul propune următoarea extindere pentru o epocă nouă:

```sop
@r__link link
  query $q
  strategy hybrid

@r__reason reason
  query $q
  memory $r__link

@bunica binding
  result $r__reason
  variable ?bunica
  mode one
  owner r
```

Acesta este un fragment de trasă generată, nu un al doilea limbaj de scris de către LLM. `binding` este tip intern și nu este admis ca declarație inițială. `@r` devine aliasul rezultatului calculat de `@r__reason`. `@bunica` primește valoarea numai după verificarea rezultatului. Programul păstrează atribuirea unică a valorilor.

Extinderile independente din aceeași undă sunt validate împreună și adăugate la granița de epocă. Nu modificăm pe ascuns valorile unui graf aflat în execuție. `maxEpochs` și `maxWires` limitează expansiunea. În prezent sistemul adaugă subcircuite; redefinirea arbitrară și invalidarea reactivă a oricăror fire rămân în afara acestui profil.

## Cum se leagă exact întrebarea de memorie

Să presupunem că biblioteca aprobată conține:

```sop
@grandmother_rule rule
  when mother(?x, ?y)
  when parent(?y, ?z)
  then grandmother(?x, ?z)
```

iar memoria poate recupera:

```sop
@f1 fact
  holds mother(ana, bogdan)
  valid timeless
  source demo

@f2 fact
  holds parent(bogdan, carina)
  valid timeless
  source demo
```

Query-ul cere `grandmother(?bunica, carina)`. Linkerul identifică semnătura `grandmother/2`, pozitivă. Caută reguli a căror concluzie are această semnătură. În regula găsită leagă `?z` la `carina`; `?x` rămâne valoarea cerută. Premisele devin `mother(?x, ?y)` și `parent(?y, carina)`. Acestea sunt cereri noi către strategiile de memorie. Dacă o premisă este la rândul ei derivabilă printr-o regulă, procesul continuă.

În exemplu, potrivirea lui `parent(?y, carina)` cu faptul recuperat leagă `?y` la `bogdan`. Aceeași variabilă trebuie folosită în `mother(?x, ?y)`, care devine `mother(?x, bogdan)`. Faptul maternal leagă `?x` la `ana`. Răspunsul pentru variabila query-ului este deci `?bunica = ana`. **Acordul asupra aceleiași variabile intermediare este legătura logică**, nu asemănarea dintre texte.

Implementarea separă două sarcini. Linkerul generează pattern-urile de recuperare, propagă constantele cunoscute prin concluziile regulilor și păstrează regulile relevante. Kernelul Horn/Prolog face join-urile efective dintre premise, inclusiv legarea lui `?y` la `bogdan`. Prima versiune poate recupera un pattern larg precum `mother(?v0, ?v1)`; nu pretinde optimizarea completă a tuturor join-urilor înainte de citirea memoriei.

## Algoritmul și structurile

`src/linker.js` indexează regulile vizibile după predicatul, aritatea și polaritatea concluziei. Folosește o agendă de scopuri normalizate și un set de scopuri vizitate. Fiecare aplicare redenumește variabilele regulii înainte de unificare. Repetarea aceluiași scop cu alte nume de variabile nu lansează o expansiune nelimitată. Recursia logică este rezolvată în solver, nu ca ciclu de dependențe `$` în SOP.

Pentru fiecare scop sunt consultate și dovezile explicite opuse; acestea pot identifica un conflict, nu transformă automat lipsa într-o negație. Regulile sunt filtrate temporal, iar faptele sunt filtrate după snapshot, timp și actualizări. Semnăturile necunoscute și limitele de scopuri/reguli/probe sunt raportate. O identitate de regulă nu poate desemna simultan două definiții diferite în același calcul.

Rezultatul `link` conține fapte calificate, regulile selectate, bugetele și un `linkPlan`: scopurile, regulile-producător, substituirile și citirile efective. Nu este doar un scor de relevanță. `reports/linker/` arată planurile, circuitele generate, rezultatele și codul compilat.

## Ce vede Prolog

Forma logică lizibilă, echivalentă exemplului, este:

```prolog
mother(ana, bogdan).
parent(bogdan, carina).
grandmother(X, Z) :- mother(X, Y), parent(Y, Z).
% Query conceptual: grandmother(Bunica, carina).
```

Compilerul real folosește `rw/3` cu simboluri encodate, astfel încât datele să nu poată injecta cod Prolog. Adaptorul produce închiderea Horn prin tabling și verifică acordul cu kernelul JS; evaluatorul comun construiește răspunsurile și urmele. Nu atribuie Prolog-ului capacitatea de a interpreta singur toate formele SOP. Profilul extern curent acceptă query-uri la un moment, iar răspunsurile pe intervale folosesc JS. Semantica și tabling-ul sunt documentate în [S2].

## Ce vede Z3 și cum se leagă de o citire de memorie

`examples/auto-mixed.sop` întreabă mai întâi `duration(route_demo, ?duration)`. `solve` definește `$duration` din memoria relevantă. Abia apoi poate fi materializată restricția:

```sop
@timing constraint
  var ?arrival int 0 1440
  require ?arrival == 770 + $duration
  claim ?arrival <= 840
  task possible
  unit minute

@feasibility solve
  constraint $timing
  output ?arrival one
```

Pentru durata recuperată 70, premisele compilate declară `arrival` ca întreg, limitează domeniul și afirmă egalitatea `arrival = 770 + 70`. Întrebarea `arrival <= 840` este verificată separat. Z3 nu primește un text despre trasee; primește restricții tipizate în SMT-LIB. Legătura dintre memoria relațională și aritmetică este firul `$duration`, nu o convenție implicită despre numele variabilelor.

Un model Z3 poate arăta o valoare posibilă, fără să fie singura. Pentru `output ?arrival one`, adaptorul cere o valoare și apoi verifică dacă premisele mai au o soluție în care `arrival` este diferit. Numai dacă a doua verificare este `unsat` exportă scalarul. Pentru `many` și `rows`, enumerarea tuturor soluțiilor este implementată numai de backend-ul JS finit; adaptorul Z3 raportează explicit proiecția nesuportată. Vezi [S3].

În exemplu durata este exactă și timpul este exprimat în minute ale aceleiași zile. O durată minimă ar produce altă restricție; nu se transformă automat în egalitate. Interpretarea zilei, unităților și tipului de afirmație se face înainte de solver.

## Procedura poate furniza și planul numeric

`check_arrival` din `kb/bootstrap.sop` conține deja query-ul duratei, exportul, restricția și CNL-ul. Modelul emite doar situația și instanțierea:

```sop
@route value
  data "route_demo"
@departure value
  data 770
@deadline value
  data 840
@answer expand
  using ~check_arrival
  with route $route
  with start $departure
  with deadline $deadline
```

Subcircuitul este recuperat exact din biblioteca aprobată. Un template poate avea `yield` chiar o ieșire amânată, fără un `@x` scris manual. Runtime-ul știe cine o produce și așteaptă rezolvarea.

Nu există încă sinteză automată generală a unui circuit arbitrar din orice colecție de plugin-uri. Avem legare automată a scopurilor Horn și a variabilelor, compoziție prin dependențe explicite și instanțiere de proceduri cunoscute. Pentru domenii noi se adaugă definiții de predicate, reguli sau template-uri cu contracte clare, nu se cere solverului să inventeze sensul unei relații.

## Cod relevant

`src/sop/outputs.js`: registrul ieșirilor și regulile de materializare. `src/sop/parser.js`: validarea grafului inclusiv ieșirile promise. `src/linker.js`: scopuri și unificare. `src/strategies.js`: selecția memoriei. `src/runtime.js`: expansiune între epoci, programare și blocare. `src/backends/`: executarea și proiecțiile. `tests/outputs.test.js` și `tests/linker.test.js`: contractele executabile.
