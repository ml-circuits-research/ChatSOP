# 02. Interpretorul SOP și siguranța execuției

## Etapele runtime-ului

Parserul produce o listă de definiții cu ID, tip și câmpuri. El verifică unicitatea, limitele de sursă, forma atomilor și expresiile. Constructorul grafului extrage `$` și `~` în afara textelor citate. Verifică referințele existente, ieșirile rezervate prin `output ?x` și absența ciclurilor de valori. O ieșire rezervată are muchie virtuală către firul `solve` care o produce; nu este tratată ca o valoare deja calculată. Validatorul semantic convertește definițiile în obiecte tipizate: fapt, regulă, query, restricție. Numai acestea ajung la un solver.

Schedulerul găsește toate firele neexecutate ale căror dependențe de valoare sunt disponibile. Le procesează într-o undă deterministă. Firele pure produc valori; `assert` pregătește operații de memorie; `expand` și `solve` pregătesc noi definiții. La sfârșitul undei se aplică batch-ul de scrieri și se publică expansiunile validate. Gruparea firelor independente nu este încă execuție paralelă pe worker threads.

## Ordinea efectelor este explicită

```sop
@save assert
  input $f

@memory recall
  query $q
  after $save
```

Fără `after`, citirea și scrierea pot fi în aceeași undă, iar citirea nu include scrierea din acea undă. Ordinea textuală nu este un substitut pentru dependențe. Același principiu se aplică unei proceduri care trebuie să citească după o corecție.

Scrierile din aceeași undă sunt validate pe o copie de lucru și publicate împreună. O țintă de retractare inexistentă invalidează întreaga undă. **Nu există tranzacție globală peste toate undele unui circuit.** Dacă o undă ulterioară eșuează, o scriere anterioară deja acceptată poate exista. Pentru operații exploratorii folosește o sesiune distinctă și nu o confirma; pentru tranzacții întreg-turn, extensia necesară este un overlay temporar publicat numai după terminare.

## Definiții versus valori

Un `~template` este un handle verificat către o definiție, nu conținut executat automat. În profilul curent este consumat de `expand`. O regulă într-un `pack` este o valoare logică; un template este o definiție de subcircuit. Modelul nu definește reguli/template-uri noi în chat, dar poate instanția biblioteca autorizată.

Expansiunea este **append-only**. Fiecare instanță primește prefixul numelui firului de apel; de exemplu `answer__q`. Parametrii devin fire `value`. Referințele interne sunt redenumite fără a modifica șirurile citate. Variabilele logice locale rămân locale; ieșirile exportate prin `output ?x` și aparițiile corespunzătoare ale acelor necunoscute sunt prefixate igienic pentru instanța template-ului. Noul graf este validat înainte să fie publicat. Un contor de epoci limitează expansiunea.

Nu este implementat încă mecanismul general SOP de redefinire a unui fir, invalidare a descendenților și recalcul reactiv. Nici mutarea unor containere dinamice în aceeași epocă nu este necesară acestui experiment. Nu se pretinde compatibilitate cu aceste extensii doar pentru că este folosit numele SOP Lang.

## `jsEval`: procesări mici, nu cod arbitrar

Interpreterul din `src/sop/expression.js` citește expresia într-un AST propriu și aplică numai operatori și funcții permise. Nu apelează `eval`, `Function` sau `node:vm`. Documentația Node precizează că `vm` nu este mecanism de securitate [S1].

Sunt acceptate literali, array-uri și obiecte, acces la proprietăți proprii, indexare, aritmetică, comparații fără coerciții ascunse, operatori booleeni cu scurtcircuit, ternar și câteva funcții. Pentru texte: `trim`, schimbare de caz, normalizare Unicode, `slice`, `substring`, `includes`, prefix/sufix, `replaceAll` cu șir literal, `split`, `join`. Pentru numere: un subset `Math`, `String` și `Number`. `only(array)` cere exact un element și este util pentru extragerea unei valori dintr-un rezultat de reasoning.

Nu există declarații de funcții, bucle, promisiuni, importuri, rețea, fișiere, procese, acces la prototipuri sau expresii regulate arbitrare. `constructor` și cheile asociate sunt blocate. Bugetele limitează AST-ul, operațiile și mărimea ieșirii. Aceasta este o suprafață restrânsă testată, nu un sandbox pentru întreg JavaScript și nici o dovadă formală de securitate.

Pentru procesări generale, un inginer adaugă un handler de încredere. Interfața constructorului este `new Runtime({handlers:{tip: async ({wire,values,now}) => rezultat}})`. Handlerul trebuie să valideze câmpurile tipului, să respecte bugetele și să declare efectele. Înregistrarea unei funcții JS în host este o operație de administrare; conținutul recuperat din memorie nu poate face asta.

## Erori și limite

Parserul respinge o sintaxă incompletă. Un câmp necunoscut nu este ignorat. Un backend absent produce `unsupported`. Expirarea bugetului de explorare produce `complete=false` sau `unknown`, nu falsitate. Un răspuns LLM oprit din cauza lungimii este respins înaintea execuției. Datele nevalide nu sunt „reparate” printr-un fallback care inventează fapte.

Permisiunile și limitele sunt în `config/runtime.json`, apoi sunt aplicate de host. Modificarea contextului natural nu poate crește `maxWires`, `maxProbes` sau permisiunea de a instala reguli.

## `solve`, ieșiri promise și ramuri blocate

`solve` primește un query sau o restricție deja tipizată. La granița epocii adaugă subcircuitul de linking și reasoning, plus câte un `binding` pentru fiecare ieșire. `generated` și `trace` păstrează definițiile și epocile; `outputs` păstrează starea fiecărui port, tipul și proveniența rezultatului. `@solve_id` însuși este rezultatul formal complet, inclusiv dovezile.

O ieșire `one` nu poate consuma primul rând arbitrar. Pentru ambiguitate, conflict, lipsă ori explorare incompletă, portul nu are valoare. Descendenții săi sunt `blocked`; o ramură CNL care folosește rezultatul solverului poate continua. O ieșire nu este reinferată la fiecare citire și nu este variabilă mutabilă. `solve` și `expand` păstrează atribuirea unică și validează graful extins înainte de publicare.

`?x` nu este referință implicită între query-uri. Pentru a folosi x în altă întrebare se scrie `$x`; astfel schedulerul știe ce trebuie să aștepte. Recursia regulilor se execută în reasoner, nu prin cicluri în graful SOP. Vezi capitolul 14 pentru traseul complet și capitolul 15 pentru testele de blocare și compoziție.
