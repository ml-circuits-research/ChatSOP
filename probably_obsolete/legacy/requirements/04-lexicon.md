# 04. Sinonime, identități, limbi și context mic

## Principiul

Formulările pot varia; ID-ul canonic nu variază odată cu limba. `Maria lucrează la Alfa`, `Maria works at Alfa` și o formulare echivalentă în germană pot selecta același `works_at(maria, lab_alpha)`. Reasoner-ul nu traduce limbile. Resolverul lexical reduce opțiunile, iar formalizatorul decide interpretarea propoziției în acel vocabular.

## Ontologie declarativă în SOP

```sop
@works_at predicate
  args person organization
  description "lucrează la organizație; nu afirmă automat angajare"
  label ro "lucrează la"
  alias ro "muncește la"
  alias en "works at"
  alias de "arbeitet bei"
  alias fr "travaille chez"
  alias it "lavora presso"

@maria entity
  kind person
  label ro "Maria"
  alias ro "Mariei"
  label en "Maria"
```

`entity`, `predicate` și `concept` sunt declarații ale controlului lexical; nu sunt fire executabile în runtime-ul de conversație. Aceeași sintaxă SOP este folosită pentru a le edita. Tipurile argumentelor și descrierea predicatului sunt contractul de formalizare.

## Ce unificăm și ce păstrăm separat

Două etichete ale aceleiași organizații pot indica un ID comun, după verificare. Două persoane cu același nume nu se unesc automat. `mother` implică `parent`, dar ar pierde informație dacă ar fi înlocuit prin alias. `employed_by` implică `works_at` numai printr-o regulă explicită a domeniului; `contractor_for` rămâne distinct. `is_a` între concepte este subsumare, nu sinonimie și nu devine automat regulă de inference în profilul actual.

Registrul include forme flexionate cunoscute, precum „Carinei”. Nu există un analizor morfologic general. Nu tăiem mecanic sufixele tuturor numelor: am crea coliziuni și identități greșite.

## Algoritmul rapid implementat

Textul este normalizat Unicode NFC, în litere mici, cu variantele românești sedilă/virgulă normalizate. Se construiește și o versiune fără diacritice pentru căutare. Un index inversat pe tokeni restrânge aliasurile examinate. Potrivirea finală cere expresia întreagă la granițe de cuvinte. Scorul exact este mai bun decât cel fără diacritice; expresiile mai lungi au prioritate. Scorurile sunt ranguri, nu probabilități de adevăr.

Rezultatul conține o listă scurtă de entități, predicate și concepte, ambiguități și indicii lexicale de negație. Nu rezolvă singur scopul lui „nu”, ironia, pronumele sau semanticile contextuale. Fuzzy matching cu edit distance și lematizarea sunt extensii explicite; nu sunt pretinse implementate.

## Micro-contextul formalizatorului

Modelul vede mesajul complet acceptat, candidații și descrierile lor, până la trei fragmente recente și, pentru follow-up, query-ul SOP anterior și câteva premise confirmate. „De ce?” poate reutiliza entitățile ultimei întrebări fără a primi întregul KB. Sinonimele respinse nu sunt transformate în concepte canonice.

Bugetul de intrare este verificat în bytes la nivelul resolverului și în tokeni la servirea modelului. Nu este același lucru: româna cu diacritice și SOP pot avea lungimi diferite în tokenizer. Runtime-ul poate elimina contexte vechi cu prioritate mică, dar nu taie mesajul curent ca să pară că îl înțelege. Când contextul indispensabil nu încape, cere împărțirea ori clarificarea.

Formele noi ale unei entități cunoscute pot fi propuse pentru revizuire. O entitate complet nouă cere extinderea registrului prin ingestie aprobată; agentul conversațional actual nu creează arbitrar ID-uri noi în afara shortlist-ului. Această limită este deliberată în primul test neuronal și trebuie măsurată ca acoperire, nu ascunsă drept eroare de reasoning.

## Învățarea aliasurilor

`tools/review-alias.js` aplică o decizie explicită, cu reviewer și dovadă. Un alias ambiguu cere păstrarea ambiguității, nu fuziune. Frecvența observațiilor nu este suficientă pentru promovare: repetarea aceleiași interpretări greșite nu o face adevărată. Datasetul trebuie să includă exemple apropiate cu sensuri diferite și cazuri în care se cere clarificare.

## Multi-language

Lexiconul poate oferi aliasuri în oricâte limbi. Testele simbolice verifică anumite aliasuri RO/EN/DE/FR/IT. Aceasta nu demonstrează că modelul de 270M înțelege negarea și pronumele în toate aceste limbi. Setul de pornire este predominant română, cu un control în engleză. Extinderea la o limbă cere exemple, evaluare și, eventual, fine-tuning specific. Nucleul de memorie și reasoning rămâne neschimbat.

## Proceduri în contextul modelului

Agentul selectează și până la două template-uri aprobate: după predicatele query-urilor din corp și după indicii `cue` declarate de inginer. Acestea ajung în `procedures_sop` ca sursă SOP exactă, iar `approvedTemplates` listează handle-urile permise. Modelul nu trebuie să ghicească o bibliotecă invizibilă. El poate emite `expand` și lega parametrii. Selecția este simbolică, restrânsă; nu reprezintă încă retrieval semantic general de proceduri.
