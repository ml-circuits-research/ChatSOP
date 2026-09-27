# 06. Un SOP, mai multe interpretoare

**Profilul curent este sop-agent-3.** Contractele și noile operații sunt în capitolele 23–29; catalogul exact al câmpurilor este `docs/contracts/wire-fields.md`. Notele istorice despre funcții neimplementate se citesc împreună cu stadiul v3 din capitolul 28.

## Independența de backend înseamnă semantică declarată

LLM-ul produce SOP și identificatori canonici. Compilerul validează tipurile, domeniul și operația cerută; abia apoi generează cod de backend. Nu trimitem textul liber al modelului ca Prolog sau SMT-LIB. Adaptoarele acceptă un profil portabil, nu promit că orice program general Prolog poate fi convertit fără pierderi în SMT sau invers.

| Profil SOP | Implementare implicită | Adaptor opțional |
|---|---|---|
| Reguli Horn sigure, termeni finit reprezentabili, negație explicită | Closure JS, intervale și proveniență | SWI-Prolog cu tabling, pentru query punctual |
| Restricții întregi liniare, toate variabilele bounded și domeniu mic | Enumerare finită JS | Z3 QF_LIA |
| Restricții liniare întregi cu domenii mari sau nebounded | Nu sunt ghicite limite | Z3 |
| Procesare de texte/obiecte locale | `jsEval` interpretat | Handler de încredere, proiectat separat |

`backend auto` alege JS pentru Horn. Pentru restricții folosește JS când toate domeniile sunt finite și produsul lor încape în buget; altfel încearcă Z3. `backend prolog` și `backend z3` sunt selecții explicite utile evaluării. Dacă executabilul lipsește, rezultatul este `unsupported`.

## Traducerea Horn

```sop
@r rule
  when parent(?x, ?y)
  when parent(?y, ?z)
  then grandparent(?x, ?z)
```

Parserul identifică o concluzie și două premise, cu variabile locale. Compilerul atribuie variabile Prolog sigure și encodează constantele, inclusiv șirurile, în loc să le concateneze ca sursă. Intern se folosește relația uniformă `rw(Sign, Predicate, Args)`. Semnul negativ este un argument distinct, nu `\+`/negație-ca-eșec. Se generează `:- table rw/3` pentru closure-ul finit [S2].

Adaptorul actual Prolog filtrează mai întâi faptele și regulile la `at`, apoi calculează closure-ul. Pentru răspunsuri cu intervale se folosește JS. Exportul CLI cere `--at` când sursa are validitate temporală; nu elimină tăcut timpul.

```bash
node cli.js compile-prolog --file examples/local.sop > /tmp/local.pl
node cli.js compile-prolog --file kb/bootstrap.sop --at 2026-09-26 > /tmp/point.pl
```

Adaptorul verifică și acordul closure-ului Prolog cu derivarea JS pe profilul comun. Dovezile livrate sunt traseul JS verificat față de rezultatul Prolog, nu un proof object nativ emis de Prolog. Recursia și bugetele pot limita completitudinea; raportul păstrează acest fapt.

## Traducerea SMT

`var` declară nume logice și tipul `int`. `require` este premisă, `claim` este proprietatea întrebată. Sunt acceptate aritmetică liniară întreagă, comparații și conectori booleeni. Înmulțirea a două variabile, floating point, cuantificatori și funcții arbitrare sunt respinse. Substituirea unei valori `$duration` produce mai întâi un întreg validat în AST.

Compilerul redenumește variabilele în simboluri locale SMT, generează declarații și assert-uri numai pentru premise. Pentru `possible`, caută un model al premiselor împreună cu claim-ul. Pentru `prove`, verifică dacă există un contraexemplu. Înainte verifică consistența premiselor: un set inconsistent întoarce `inconsistent`, nu o demonstrație vacuă.

`sat`, `unsat` și `unknown` sunt statusuri ale solverului, nu echivalente directe cu adevărat/fals în limbaj natural [S3]. De exemplu, premisa `840 <= arrival <= 900` și claim-ul `arrival <= 840` dau `possible`; ele nu justifică „va ajunge până la 14:00”. Pentru `prove`, există și un contraexemplu, deci concluzia rămâne `unknown`.

```bash
node cli.js compile-smt --file examples/constraint.sop > /tmp/query.smt2
# După instalarea opțională:
z3 /tmp/query.smt2
```

## Caz mixt, fără traducere aproximativă

Un query cere `duration(route_demo, ?duration)`. `solve` recuperează faptele și regulile relevante și exportă `output ?duration one`. Nu scriem un `jsEval` care selectează manual primul răspuns: `$duration` există numai după verificarea cardinalității și completitudinii. Un fir `constraint` consumă această valoare și declară, de exemplu, `?arrival = 770 + $duration`.

Al doilea `solve` poate exporta `?arrival`. Evaluatorul JS finit verifică valorile posibile sub toate premisele. Adaptorul Z3 obține un model, apoi întreabă dacă o altă valoare a lui `arrival` mai este posibilă. Doar imposibilitatea alternativei justifică un scalar `one`; un singur model SAT nu o justifică [S3]. `many`/`rows` sunt disponibile pentru proiecția finită JS; enumerarea generală Z3 nu este implementată.

Dacă există mai multe durate, calculul dependent rămâne blocat. Un template aprobat poate cere clarificare sau proiecta deliberat o explorare a alternativelor. Nu se deduce o alegere convenabilă din existența unei soluții. `examples/auto-mixed.sop` și `auto-template.sop` execută lanțul complet; capitolul 14 explică legarea și oferă codul solverului.

## Instalare și validare

`scripts/install-solvers.sh` este opțional și instalează executabilele locale pe sisteme compatibile. `tools/check-solvers.js` raportează disponibilitatea și salvează codul generat. Testele backend-urilor sunt sărite explicit când executabilele lipsesc. Nu sunt prezentate drept reușite și nu reprezintă cerință pentru demo-ul JS.

O extensie a profilului trebuie să stabilească tipurile, semantica statusurilor, regulile temporale, limitele și un test diferențial între implementări. Nu lărgim DSL-ul numai pentru că un backend acceptă mai multă sintaxă.
