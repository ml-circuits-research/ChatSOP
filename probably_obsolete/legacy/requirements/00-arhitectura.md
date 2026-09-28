# 00. Scop, componente și contractul comun

**Profilul curent este sop-agent-3.** Contractele și noile operații sunt în capitolele 23–29; catalogul exact al câmpurilor este `docs/contracts/wire-fields.md`. Notele istorice despre funcții neimplementate se citesc împreună cu stadiul v3 din capitolul 28.

## Ce vrem să obținem

Vrem un agent mic care acumulează cunoaștere și poate aplica proceduri explicite asupra ei. Inteligența demonstrabilă nu trebuie să depindă de faptul că modelul neuronal reține lumea în parametri. Modelul recunoaște sensul mesajului suficient cât să emită un program verificabil. Memoria oferă premise și reguli; interpretoarele produc concluzii și justificări; modelul de ieșire reformulează un răspuns deja decis.

Învățarea imediată este inserarea unor afirmații, evenimente sau preferințe. Învățarea procedurală este adăugarea unei reguli ori a unui template revizuit. Fine-tuning-ul este învățarea corespondenței dintre limbajul natural și profilul SOP. Aceste operații au costuri și riscuri diferite și se măsoară separat.

Memoria implicită este generațională: noi observații și premise utile intră în shard-ul activ; presiunea îl închide și deschide altul. Modul bounded evacuează generațiile normale vechi, iar archive le păstrează. Pinned și baza comună sunt separate. Fork-urile partajează fișiere imuabile, iar GC șterge numai obiecte fără referințe. Capitolul 18 descrie implementarea; capitolul 16 păstrează experimentul alternativ de cooling per contor.

## Traseul unei întrebări

Resolverul lexical produce o listă scurtă de entități și predicate. Formalizatorul primește mesajul, lista și câteva elemente recente de dialog. El emite un `query`, eventual declarații de situație, apoi `solve` cu ieșirile `?` dorite și `cnl`, sau instanțiază un template aprobat prin `expand`. Firele de nivel inferior `link`/`recall` și `reason` pot fi scrise explicit, dar datele de antrenare folosesc uzual `solve`. Parserul verifică structura și graful; validatorul verifică tipurile și permisiunile. Runtime-ul execută circuitul topologic. Interogarea memoriei se extinde prin premisele regulilor relevante, astfel încât o cerere despre bunici poate recupera relații de părinte. Nu este suficient să caute doar cuvântul „bunic”.

Rezultatul conține răspunsuri, premise, intervale, status și indicatorul de completitudine. CNL este generat determinist. Verbalizatorul poate face textul mai natural; forma CNL rămâne disponibilă utilizatorului.

## Un singur IR, două niveluri de reprezentare

La frontierele sistemului există SOP. În implementare parserul creează un AST și interpretoarele produc obiecte JS tipizate. Aceste obiecte sunt reprezentarea în memorie a aceluiași program, nu un limbaj pe care formalizatorul trebuie să-l învețe separat. Adaptoarele compilează AST-ul în cod Prolog sau SMT-LIB fără participarea modelului.

O afirmație recuperată asociativ poate fi emisă din nou drept fir `fact`. O regulă sau procedură recuperată vine din biblioteca exactă, cu definiție SOP și checksum. Nu executăm fragmente de program reconstruite numai pe baza unor potriviri probabilistice.

## Control și date

| Control administrat de host | Date produse sau selectate de model |
|---|---|
| Predicate, tipuri de argumente, aliasuri aprobate | Entități și predicate selectate din context |
| Interpretoare JS și adaptoare instalate | Fapte, întrebări, ipoteze, restricții |
| Biblioteca de reguli/template-uri revizuite | Referințe la template-uri aprobate |
| Identitatea utilizatorului, baza, sesiunea, bugetele | Scrieri în sesiunea deja autorizată |
| Aprobarea publicării, commit și extensii | Cereri de clarificare și rezultate CNL |

Modelul nu poate escalada permisiunea printr-un câmp `policy` inventat. Runtime-ul respinge câmpurile necunoscute și refuză instalarea de reguli sau template-uri când originea este `model`.

## Semantica răspunsurilor

`supported` înseamnă susținut de premisele admise, nu adevăr absolut. `refuted` cere negație explicită. `both` cere dovezi opuse suprapuse temporal. `unknown` înseamnă că informațiile nu decid. `complete=false` spune că explorarea a fost limitată; nu justifică „nu există”. Pentru restricții, `possible` afirmă existența unui model compatibil, iar `entailed` că toate modelele premiselor satisfac afirmația.

## Experimentul minim convingător

Același utilizator adaugă fapte, întreabă direct și multi-hop, corectează o afirmație, întreabă despre trecut și prezintă o situație numerică. Alt utilizator nu vede datele lui. O nouă bază fork-uită reutilizează cunoașterea inițială fără copiere integrală. Modelele mici trebuie evaluate pe formulări românești scrise independent de șabloanele de training. Reușita testelor de runtime nu demonstrează această ultimă capacitate.

## Legarea este o componentă, nu o presupunere

SOP este interfața comună; Recall Weaver este un furnizor de memorie. `StrategyRegistry` poate folosi reconstruirea asociativă, stocarea exactă opțională sau ambele. Niciuna nu inventează regulile logice ale domeniului. Linkerul pornește de la relațiile cerute, identifică reguli cu concluzii compatibile și construiește agenda premiselor. Kernelul de inferență rezolvă apoi variabilele comune. O definiție procedurală aprobată poate lega mai multe asemenea rezolvări, citiri și calcule.

`solve` este puntea către graful executabil. Prin `output ?x one`, autorul cere valoarea necunoscută; runtime-ul creează un producător pentru firul x în epoca următoare. `$x` devine disponibil numai când criteriul de ieșire este îndeplinit. Capitolul 14 urmărește acest mecanism, de la query până la codul Prolog/SMT-LIB generat. Comportamentul corect al întregului agent nu se atribuie automat strategiei de memorie asociativă.
