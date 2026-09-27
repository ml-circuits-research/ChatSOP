# 29. Exemple complete și cum construim peste ele

## Biblioteca și programul curent au roluri diferite

Un coding agent publică documentele și definițiile revizuite. Agentul conversațional recunoaște situația și instanțiază query-uri sau proceduri din contextul autorizat. Acest exemplu de bibliotecă folosește predicate demonstrative din ontologie:

```sop
@disk_process rule
  when disk_full(?x)
  then process_crashed(?x)

@process_outage rule
  when process_crashed(?x)
  then outage(?x)
```

Programul pentru mesajul «De ce este indisponibil server7?» este:

```sop
@q query
  where outage(server7)
  at 2026-09-26

@result abduce
  query $q
  output ?hypotheses many

@answer cnl
  result $result
  language ro
```

Linkerul găsește regulile după head. Abducția merge înapoi, propune o premisă lipsă ground, apoi verifică înainte că ea chiar produce observația. `$hypotheses` este o listă de obiecte candidate; modelul nu trebuie să producă «disk_full este adevărat».

## Diagnostic cu candidați aprobați

`kb/reasoning-procedures.sop` conține o procedură cu două ipoteze și o întrebare de verificare. Programul modelului poate fi doar:

```sop
@answer expand
  using ~diagnose_outage
  with device server7
```

Procedura introduce ipotezele locale, caută reguli și produce un test sugerat. Modulul este exact și aprobat. O unealtă separată, autorizată, ar efectua testul; nu îl execută `diagnose`.

## Plan cu acțiune aprobată

Biblioteca descrie `move` prin `requires`, `adds`, `removes`. Faptele spun unde este robotul și ce locuri sunt conectate. Programul modelului poate fi:

```sop
@answer expand
  using ~plan_route
  with robot robot7
  with destination camera3
```

Runtime-ul rezolvă tranzitiv `~move` din corpul procedurii și calculează planul. Nu sunt necesare comenzi motorii sau scripturi generate de model. Un executor de acțiuni real ar necesita propriile permisiuni, verificarea stării și politica de confirmare.

## Pattern din cazuri, nu din inversarea hash-urilor

```sop
@case1 trace
  feature hot(sensor1)
  feature dry(sensor1)
  closed true
  source experiment1

@case2 trace
  feature hot(sensor2)
  feature not dry(sensor2)
  closed true
  source experiment2

@candidate pattern
  when hot(?x)
  then dry(?x)

@cases pack
  items $case1 $case2

@result induce
  data $cases
  candidates $candidate
  output ?patterns many

@answer cnl
  result $result
  language ro
```

Acest setup de cazuri închise este executat ca sursă revizuită, nu text emis de model în conversație. Rezultatul arată un suport și un contraexemplu. Nu instalează o regulă. Biblioteca păstrează textul/cazul original pentru a putea căuta explicații ale diferenței.

## Legătura relațional–numeric

Folosește `examples/auto-mixed.sop` și procedura `check_arrival`. Prima etapă recuperează durata ca ieșire unică; a doua o consumă prin `$duration` într-un constraint. `reasoning reference` enumeră domeniul finit. `reasoning advanced` poate compila același AST pentru Z3. Codul sursă SOP nu se schimbă pentru a deveni Prolog sau SMT-LIB.

## Fișiere executabile și rapoarte

`examples/reasoning/scenarios.js` este generatorul lumilor; `reports/reasoning/examples/` păstrează sursa fiecărui program și setup-ul său în JSON. `examples/reasoning-demo.js` publică setup-urile, rulează programele și verifică rezultatele pe cinci memorii și două strategii.

```bash
node examples/reasoning-demo.js
node examples/reasoning-demo.js --engines sqlite,hybrid --reasoning reference
node tools/build-data.js --worlds 30 --out data/seed
```

Nu copia numai programul cu `~handle` într-un repository gol: publică și biblioteca la care se referă. CLI-ul existent oferă ingestia surselor revizuite; `StartSOP.md` arată traseul de pornire. Pentru interpretarea directă fără memorie, furnizează explicit `data` cu facts/rules. Pentru queries despre cunoaștere stocată, folosește repository/sesiune și linkerul.
