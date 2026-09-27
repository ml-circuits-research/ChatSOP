# 17. Harta algoritmilor RecallSOP

**Profilul curent este sop-agent-3.** Contractele și noile operații sunt în capitolele 23–29; catalogul exact al câmpurilor este `docs/contracts/wire-fields.md`. Notele istorice despre funcții neimplementate se citesc împreună cu stadiul v3 din capitolul 28.

Acest capitol este indexul operațional al sistemului. Scopul lui este ca un inginer să poată identifica unde se termină un algoritm și unde începe altul, fără a presupune că LLM-ul face implicit pașii lipsă.

## 1. Formalizarea unui mesaj

Intrare: text NL + shortlist lexical + context recent mic.

Ieșire: program SOP validat.

Pași:

1. normalizare Unicode și lexicală;
2. resolverul caută aliasuri și entități candidate;
3. modelul mic alege simbolurile canonice și forma de query/fact/event/constraint;
4. parserul SOP verifică sintaxa;
5. validatorul verifică tipurile, output-urile `?`, permisiunile și dependențele `$`;
6. programul invalid nu este executat.

Detalii: `01-sop.md`, `04-lexicon.md`.

## 2. Inserarea unui fapt în Recall Weaver

Intrare: fact SOP ground și validat.

Pași:

1. se reduce la predicat, argumente canonice și polaritate;
2. cele șase câmpuri interne sunt construite;
3. fiecare view selectează propriul subset de câmpuri;
4. subsetul este hash-uit în banca acelei coloane;
5. contorul 4-bit este incrementat;
6. receipt-ul tuplei este actualizat;
7. metadatele temporale/proveniența sunt înregistrate;
8. dacă retention este normal, se rulează pressure maintenance.

Detalii: `03-memorie.md`, `16-uitare-capacitate.md`.

## 3. Reconstrucția asociativă

Intrare: pattern parțial, de exemplu `worksAt(maria, ?org)`.

Pași:

1. variabilele sunt grupate;
2. se obțin domeniile candidate;
3. candidatul este completat incremental;
4. orice view complet disponibil este verificat imediat;
5. ramura este eliminată la primul view fără suport;
6. un candidat complet este verificat prin receipt în profilul `receipt`;
7. se aplică timpul și metadatele claim-ului;
8. se întorc candidații și indicatorul `complete`.

Niciun reasoner nu este implicat în această etapă.

## 4. Linkerul

Intrare: query SOP + reguli aprobate + strategiile de memorie.

Pași:

1. ia predicatele cerute de query;
2. caută reguli ale căror concluzii se pot unifica cu obiectivele;
3. propagă constantele deja cunoscute;
4. adaugă premisele regulilor ca obiective noi;
5. repetă în limita bugetului;
6. cere memoriei faptele pentru predicatele necesare;
7. produce un `linkPlan` inspectabil.

Linkerul nu decide adevărul; pregătește subproblema pentru reasoner.

Detalii: `14-output-linker.md`.

## 5. Reasoning Horn

Intrare: query + fapte + reguli.

Pași:

1. premisele unei reguli sunt unite prin unification;
2. intervalele temporale sunt intersectate;
3. concluziile noi sunt adăugate closure-ului;
4. procesul continuă până la fixpoint sau buget;
5. query-ul este evaluat pe closure;
6. proof-ul conține numai premisele efectiv folosite;
7. rezultatul poate fi `supported`, `refuted`, `both`, `unknown` sau incomplet.

Același obiect tipizat poate fi executat de kernelul JS sau compilat spre Prolog.

## 6. Reasoning cu restricții

Intrare: constraint SOP tipizat.

Pași:

1. se verifică domeniile și tipurile;
2. problemele finite simple pot fi rezolvate în kernelul JS;
3. problemele compatibile pot fi compilate în SMT-LIB pentru Z3;
4. existența unui model este separată de entailment;
5. un output scalar este materializat numai când unicitatea lui este demonstrată conform contractului backend-ului.

Detalii: `06-backenduri.md`, `14-output-linker.md`.

## 7. Materializarea variabilelor `?`

Intrare: rezultat reasoner + declarația `output ?x one|many|rows`.

Pași:

1. `solve` se extinde în epoca următoare;
2. runtime-ul creează firele interne `link/reason/binding`;
3. `binding` verifică modul de cardinalitate;
4. numai un rezultat suficient de determinat materializează firul `$x`;
5. dacă rezultatul este ambiguu, firul rămâne blocat și se poate urma o ramură `clarify`.

## 8. Întărirea memoriei după utilizare

Intrare: proof-ul reasoner-ului.

Pași:

1. se selectează doar faptele observate, metadata-verified, folosite efectiv;
2. simplele candidate recuperate sunt ignorate;
3. faptele selectate sunt reproiectate în stratul hot;
4. contoarele și receipt-urile cresc cu `useStrength`;
5. metadatele minime sunt promovate;
6. poate urma pressure maintenance.

Detalii: `16-uitare-capacitate.md`.

## 9. Uitarea adaptivă

Intrare: ocuparea băncii normale după write/use.

Pași:

1. sub `safeOccupancy`: nimic;
2. peste prag: cooling sweep;
3. toate contoarele normale pozitive scad cu `decayStep`;
4. receipt-urile scad cu aceeași logică și cele ajunse la zero dispar;
5. claim-urile locale fără receipt pot fi eliminate;
6. sweep-urile continuă până la `targetOccupancy` sau `maxSweeps`;
7. pinned nu este atins.

Acesta este un mecanism probabilistic de cache, nu LRU exact.

## 10. Temporalitate și corecții

Un update al lumii nu șterge automat trecutul. Un eveniment `end` închide intervalul de valabilitate. `retract` marchează o afirmație ca retractată după momentul în care corecția a fost cunoscută. Query-urile `at/during/asof` selectează combinația corectă de valid time și knowledge time.

Detalii: `05-timp.md`.

## 11. Fork, sesiune și commit

1. baza este un snapshot imuabil;
2. un fork creează un nou head fără copierea băncilor;
3. sesiunea adaugă un strat hot local;
4. reasoning-ul poate promova fapte utile în stratul hot;
5. `commit` publică stratul ca snapshot al utilizatorului;
6. `discard` îl elimină;
7. head-urile concurente nu sunt merged automat.

## 12. Creșterea capacității

Înainte de creare, creșterea lui `power` mărește fiecare bancă. După creare, resize in-place nu este corect deoarece adresele hash depind de mărime. Creșterea online se face prin rebuild cu replay sau prin segmente/shard-uri noi. Recall-ul combină rezultatele shard-urilor; utilizarea poate promova faptele reci în memoria hot.

Profilul generațional este implementat în `src/memory/sharded.js`. `Repository.gc` marchează snapshot-urile, shard-urile și sesiunile accesibile înainte de a șterge obiectele orfane. Detalii și comenzi: `18-sharduri.md`.

## 13. Generarea CNL și verbalizarea

Reasoner-ul produce rezultat structurat + proof. Generatorul CNL transformă determinist această structură într-o formulare controlată. Verbalizatorul mic poate reformula CNL-ul, dar nu are voie să schimbe status-ul, valorile sau proveniența.

## 14. Ce este adaptiv și ce este stabil

Adaptiv:

- memoria normală și tăria relațiilor;
- aliasuri candidate și statisticile lor;
- selecția views, dacă rulăm experimentul de auto-tuning;
- memorii per-user/per-session.

Stabil/revizuit:

- sintaxa SOP;
- interpretoarele;
- schema predicatelor aprobate;
- regulile și template-urile executable publicate;
- policy-ul host-ului.

Acest separator este intenționat: informația se poate schimba rapid fără ca sistemul să își rescrie arbitrar semantica de execuție.

## 15. Scrierea, recuperarea și uitarea cu shard-uri

Managerul alege generația activă normală sau pinned, o închide când atinge pragul de rotație și deschide o bancă nouă. Routerul selectează generațiile după predicat; fiecare își reconstruiește candidații, apoi aceștia sunt reuniți după claim ID. O premisă observată folosită în proof este promovată în generația curentă cu valabilitatea originală. Generațiile normale prea vechi sunt scoase din vederea bounded. Corecțiile rămân în jurnalul separat.

## 16. Checkpoint și GC

Commit-ul generațional publică vederea privată completă fără a reatașa straturile uitate. Fork-urile și sesiunile vechi păstrează propriile referințe. GC validează toate obiectele accesibile din head-uri, sesiuni și pin-uri, apoi elimină numai fișierele inaccesibile. Un checkpoint al bazei poate aplatiza vechiul DAG fără pierderea regulilor istorice. Algoritmii și limitele operaționale sunt în capitolul 18.
