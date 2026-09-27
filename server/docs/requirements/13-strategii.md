# 13. Mai multe strategii, un singur circuit SOP

## Rolul Recall Weaver

Agentul nu este identificat cu o singură implementare de memorie. SOP Lang descrie problema, cunoașterea și legăturile dintre operații. Recall Weaver este o strategie asociativă pentru recuperarea candidaților, utilă când contextul este incomplet și relațiile se repetă. Rezultatul ei intră în același contract ca rezultatul unei memorii exacte. Modelul lingvistic nu trebuie reantrenat atunci când schimbăm strategia.

Inspirația din Thousand Brains privește folosirea mai multor perspective și reducerea ambiguității prin acordul dintre ele. Nu echivalăm bitset-urile Recall Weaver cu un model cortical complet. Modulele Monty construiesc modele prin interacțiune senzori-motorie și cadre de referință; fiecare modul urmărește să recunoască obiecte și separat, iar modulele pot comunica ipoteze. Aici acea idee este una dintre sursele de proiectare a memoriei, nu definiția întregii inteligențe a agentului. Vezi [S9] din `../SOURCES.md`.

## Strategiile au roluri diferite

| Rol | Mecanism în pachet | Ce furnizează |
|---|---|---|
| Recunoașterea expresiilor | Lexicon și resolver simbolic | ID-uri canonice, predicate și proceduri candidate pentru contextul mic |
| Recuperarea asociativă | `recall-weaver` | Fapte reconstruite din coloane și calificate prin metadate temporale/proveniență |
| Recuperarea exactă | `exact` | Fapte păstrate explicit, din snapshot-urile autorizate |
| Combinarea recuperării | `hybrid` | Acoperire exactă când există; altfel completare prin Recall Weaver |
| Identificarea premiselor necesare | Linker backward pe concluziile regulilor | Reguli aplicabile și interogări pentru premise, cu constantele deja cunoscute |
| Reutilizarea unei metode | `template` și `expand` | Subcircuit aprobat, cu parametrii legați de situația curentă |
| Inferența relațională | Kernel Horn JS; adaptor Prolog | Legături între variabile, fapte derivate și premisele folosite |
| Calculul restricțiilor | Enumerare JS finită; adaptor Z3 | Posibilitate, implicație, inconsistență și proiecții de variabile |
| Explicarea rezultatului | `cnl`, apoi verbalizatorul opțional | Răspuns controlat; formularea liberă nu decide rezultatul |

Unele strategii se completează; nu trebuie puse să concureze printr-un vot comun. Un scor mare de familiaritate nu anulează o restricție logică și nu transformă o presupunere în fapt.

## Contractul unei strategii de recuperare

`src/strategies.js` primește repository-ul și sesiunea autorizată de host, un atom parțial canonic, timpul întrebării și limitele de căutare. Returnează `rows`, `complete`, `probes` și `coverage`. Fiecare rând conține un atom complet, ID-ul afirmației, valabilitate, sursă și descrierea verificării. Nu execută SOP recuperat ca text arbitrar și nu creează concluzii logice.

```js
const registry = new StrategyRegistry();
registry.register('my-memory', request => {
  // Respectă request.session, request.query.asof și limitele.
  return { rows: [], complete: false, probes: 0,
           coverage: 'provider-defined' };
});
```

Host-ul transmite registrul la `Runtime({strategies: registry, ...})`. Într-un `solve` sau `link`, `strategy` poate selecta un provider instalat. `policy.allowedStrategies` restrânge această alegere. Un nume necunoscut este eroare, nu o cerere de descărcare de cod.

## Modurile de stocare

În configurația asociativă nu este necesar un tabel exact al corpurilor faptelor. Rămân însă dicționarele domeniilor, amprentele de verificare, metadatele afirmațiilor și evenimentele temporale. Biblioteca executabilă de reguli și proceduri este exactă și aprobată în toate configurațiile.

Opțiunea de ingestie `memory.exact: true` păstrează suplimentar `exactAtoms`, un dicționar de tuple complete. Permite un experiment exact și un fallback. Costul lui este raportat separat în `exactAtomsBytes`; nu îl prezentăm drept compresie asociativă. Nu este activat implicit și nu este consultat de strategia `recall-weaver`.

`exact` aplică evenimentele, `at` și `asof`, dar nu uită un corp exact pentru că s-au degradat contoarele asociative. Aceasta este o alegere de retenție explicită. `hybrid` poate, în consecință, recupera o informație pe care numai banca asociativă nu o mai recuperează. Pentru uitare globală se cere o politică și pe stratul exact, nu doar decay pe Recall Weaver.

Activarea `exact` după ingestie nu recreează automat faptele originale. Reingerează sursele aprobate sau folosește `recall-weaver`. Un provider exact fără corpuri suficiente raportează acoperire incompletă.

Implementarea exactă de referință scanează metadatele snapshot-urilor; nu este încă un index optimizat la scară mare. Interfața permite înlocuirea ei fără schimbarea SOP.

## Ce înseamnă „complet”

`complete` înseamnă că operația declarată s-a încheiat în bugetul și vederea de memorie aleasă. Cu Recall Weaver este vorba despre spațiul de candidați al memoriei reținute, nu despre întreaga istorie înainte de uitare și cu atât mai puțin despre lumea reală. Un output `one` este unic în rezultatele admise ale acestui calcul. Nu este o probabilitate de adevăr.

Snapshot-ul de user/sesiune, cunoașterea disponibilă la `asof` și intervalul valid sunt aplicate înainte de reasoning. Unire de rezultate nu înseamnă unire între utilizatori. Reguli și template-uri fără hash valid/aprobare nu devin executabile.

## Alegerea experimentală

Rulează aceeași suită cu `recall-weaver`, `exact` și `hybrid`, păstrând schema, query-urile, solverul și politica temporală. Măsoară precizia, acoperirea, latența și toată memoria. Separat, compară circuitul cu/fără proceduri recuperate și cu/fără linker. Astfel aflăm contribuția fiecărei strategii, nu atribuim întregul rezultat coloanelor inspirate de Thousand Brains.

## Configurații de pornire

`config/runtime-associative.json` folosește `recall-weaver`, fără corpuri exacte. `config/runtime-exact.json` activează corpurile exacte și furnizorul `exact`. Folosește rădăcini distincte la comparație:

```bash
node cli.js init --root state-associative --config config/runtime-associative.json
node cli.js run --root state-associative --config config/runtime-associative.json --file examples/auto-link.sop
node cli.js init --root state-exact --config config/runtime-exact.json
node cli.js run --root state-exact --config config/runtime-exact.json --file examples/auto-link.sop
```

În implementarea de referință, ingestia exactă păstrează și băncile asociative, pentru ablații pe aceeași stare. Alegerea furnizorului `exact` nu înseamnă că aceste bănci au fost eliminate fizic. Numără toate structurile persistente când compari memoria. Un provider extern poate avea stocare proprie, dar aceasta trebuie implementată și măsurată separat.

## Implementările independente H7 și SQL

Capitolele 19–22 adaugă `holo-memory`, `sqlite`, `scan` și `auto`. Spre deosebire de vechiul `exact`, noile motoare SQL și scan nu alocă bănci Weaver. `hybrid` consultă motorul fizic prezent dacă lipsește vechiul strat `exactAtoms`. Modurile de retenție și contractul SOP rămân comune. Varianta minimală `SimpleSQLiteMemory` ține întreaga bază într-un singur fișier; nu trebuie confundată cu transportul prin snapshot-uri al repository-ului complet.
