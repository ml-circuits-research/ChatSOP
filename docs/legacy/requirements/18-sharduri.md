# 18. Memorie generațională, shard-uri și recuperarea spațiului

## Ideea și domeniul implementat

Un shard este o porțiune autonomă a memoriei. Are propriile coloane Recall Weaver, domenii de valori și metadate. Informația nouă intră în shard-ul activ. Când acesta ajunge la pragul de umplere, este închis pentru scriere, iar următoarea informație intră într-un shard nou. Nu schimbăm dimensiunea sau hash-urile băncii vechi.

În modul cu uitare păstrăm un număr limitat de generații normale. Un fapt vechi folosit într-o demonstrație este reconstruit și copiat în generația activă. Generația veche poate fi apoi eliminată fără să pierdem copia utilă. În modul arhivă păstrăm toate generațiile. Faptele `pinned` sunt într-un flux separat, protejat în ambele moduri.

Implementarea este locală, în Node.js, fără dependențe npm. Shard-urile sunt segmente ale unui repository pe disc; nu sunt servere distribuite. Aceeași sintaxă SOP și aceleași ținte de fine-tuning funcționează indiferent de organizarea memoriei.

## Structurile de date

| Structură | Ce conține și de ce |
|---|---|
| `ShardedLayer.hot` | Shard-ul normal activ sau `null` înainte de prima scriere. |
| `ShardedLayer.cold` | Shard-uri normale închise, în ordinea generațiilor. |
| `pinnedHot`, `pinnedCold` | Același mecanism de rotație, fără evacuare automată. |
| Un shard | ID local, momente de creare/scriere/închidere, un `Weaver`, claim-uri, tuple exacte opționale și jurnal sursă opțional. |
| `events` | Jurnal separat de `end` și `retract`; nu este eliminat odată cu shard-ul unui fapt. |
| Manifestul unei sesiuni | Head-ul bazei, head-ul utilizatorului, revizia, biblioteca SOP și referințele către shard-uri. |
| `shards/<hash>.json` | Un obiect imuabil, identificat prin checksum-ul întregului conținut. Băncile sunt serializate base64. |
| `snapshots/<hash>.json` | Un manifest imuabil; nu duplică în interior băncile deja existente. |

Fiecare shard are un singur set de coloane, normal sau pinned. Nu alocăm o a doua bancă goală pentru fiecare shard. Argumentele canonice, recepțiile și claim-urile rămân distincte de contoare. Strategia asociativă reconstruiește tuplele din domenii și consensul coloanelor; strategia exactă poate citi `exactAtoms` numai dacă aceste tuple au fost păstrate explicit.

Biblioteca de reguli și proceduri rămâne SOP exact, revizuit. Versiunile sale păstrează `knownAt`, inclusiv după checkpoint, pentru ca o întrebare `asof` să poată selecta definițiile cunoscute atunci.

## Algoritmul de scriere și rotație

`Repository.apply` validează întregul lot de operații într-o copie de lucru. Un lot cu un eveniment care țintește un claim necunoscut este respins fără schimbări în memoria publicată sau în manifestul sesiunii.

Pentru un fapt valid, managerul stabilește dacă retenția este normală sau pinned și verifică shard-ul activ corespunzător. Înainte de a adăuga un claim nou, închide shard-ul dacă este îndeplinită oricare dintre condiții: o coloană a ajuns la pragul de ocupare, sunt prea multe claim-uri, metadatele au depășit pragul de rotație sau a expirat durata configurată a generației active. Reobservarea aceluiași claim nu declanșează singură o rotație de capacitate; nu introduce informație distinctă.

Managerul deschide un shard nou, scrie proiecțiile, recepția și metadatele, apoi verifică bugetul generațiilor reci. Ocuparea fiecărei coloane este urmărită incremental. Pragul este aplicat coloanei celei mai ocupate, nu doar mediei care ar putea ascunde o coloană saturată.

Un prag de rotație nu este o limită strictă de un singur byte. Observația care atinge pragul rămâne în shard; următoarea observație distinctă merge în altul. Un contor nou poate depăși pragul de ocupare cu cel mult o celulă. Un claim foarte mare poate depăși pragul de metadate; aplicația trebuie să limiteze separat dimensiunea documentelor/citatelor admise.

## Recuperarea între shard-uri

Managerul caută numai în namespace-ul autorizat al sesiunii și în baza capturată de aceasta. Routerul verifică existența predicatului și arității în domeniul fiecărui shard. Un shard fără semnătura cerută poate fi omis fără pierderea unei potriviri reținute. Aceasta este rutare deterministă pe predicat, nu selecție semantică aproximativă.

Decoderul fiecărui shard reconstruiește propriii candidați. Rezultatele sunt reunite și deduplicate după ID-ul claim-ului. Băncile unor shard-uri diferite nu sunt combinate prin OR: altfel relații fără legătură ar putea părea componente ale aceluiași fapt.

Jurnalul de corecții este consultat chiar dacă evenimentul și suportul asociativ provin din segmente diferite. Apoi se aplică `at`, `during` și `asof`. Reasoner-ul poate uni premise recuperate din shard-uri diferite, dar o face prin reguli și variabile comune, nu prin suprapunerea celulelor.

`maxProbes` și `maxShards` sunt bugete ale legării unei interogări. Vizitele repetate pentru predicate sau polarități diferite consumă buget; `maxShards` nu înseamnă numărul de fișiere distincte citite o singură dată. Dacă bugetul este epuizat, `complete` devine `false`. Un `output ?x one` nu transformă primul rezultat parțial în răspuns unic.

`complete:true` se referă la vederea de memorie reținută și la căutarea efectuată. Nu afirmă că toate faptele istorice sau toate adevărurile lumii sunt încă în memorie.

## Utilizare reală și promovare

Simpla căutare nu schimbă memoria. Runtime-ul extrage din proof numai premisele observate cu metadate verificate. Repository-ul verifică din nou ID-ul vizibil și hash-ul tuplei; candidații inventați sau ipotezele nu pot deveni singuri observații prin reinforcement.

Pentru fiecare premisă utilizată, managerul reproiectează atomul în shard-ul activ și copiază identitatea, proveniența și valabilitatea originală a claim-ului. Nu copiază intervalul îngustat de întrebarea curentă. De exemplu, folosirea unui fapt valabil un an într-o întrebare despre o singură zi nu îi reduce valabilitatea memorată la acea zi.

Această promovare este mecanismul de supraviețuire între generații. Contoarele sunt și ele întărite, dar o tărie numerică mare într-un shard rece nu împiedică singură evacuarea acelui shard. Politica favorizează utilizarea recentă. Nu este un LRU/LFU exact pentru fiecare fapt și nu promite retenție eternă pentru o informație folosită intens cu mult timp în urmă.

## Când și ce se uită

În `sharding.mode: bounded`, managerul elimină din vederea curentă cele mai vechi generații normale până când sunt respectate limita de shard-uri reci, bugetul opțional al băncilor normale și durata maximă opțională a unei generații reci. Împreună cu generația dispar domeniile, recepțiile și metadatele ei locale. Copiile promovate în generații mai noi rămân.

În `sharding.mode: archive`, presiunea produce generații noi, fără evacuare automată. Dacă administratorul configurează și o cotă maximă de shard-uri de arhivă, atingerea ei oprește noua scriere prin eroare. Nu sacrifica date existente pentru a simula un succes.

Generațiile pinned sunt protejate separat. Pot crește sau pot avea o cotă explicită; atingerea cotei oprește scrierea, nu șterge fapte pinned. Baza comună publicată prin ingestia revizuită folosește modul arhivă, indiferent de politica de cache a sesiunii personale.

Vechiul cooling pe contoare rămâne disponibil în profilul fără shard-uri `runtime-adaptive.json`. În profilul generațional nu răcim automat bănci închise. Comanda legacy `decay` este respinsă; folosește `maintain`. Politicile sunt separate pentru a putea măsura efectul fiecăreia.

## De ce corecțiile nu dispar cu shard-ul

Să presupunem că un fapt a fost retractat și ulterior este întâlnit din nou, cu aceeași identitate. Dacă am șterge și retractarea odată cu banca veche, acel fapt ar putea reapărea incorect. De aceea `events` este un jurnal de control separat. Promovarea unui fapt istoric nu îi șterge corecțiile și nu îl reactivează automat pentru prezent.

Acest jurnal nu are compactare semantică automată în implementarea curentă. La fel, biblioteca, vocabularul global, pinned și baza comună nu sunt incluse în limita cache-ului normal. Bugetul cache-ului nu este o promisiune că întregul proces sau întregul disc va rămâne constant indiferent de utilizare.

## Fork, commit și persistență fără copierea băncilor reci

Un fork al bazei creează alt nume către același snapshot. Două sesiuni pot referi aceleași fișiere de shard; o modificare produce un obiect nou cu alt checksum. Nu rescriem fișierul partajat.

În modul shard-uit, sesiunea deține vederea completă a memoriei private a utilizatorului. Commit-ul scrie un checkpoint al acestei vederi, fără a-l lega automat la toate checkpoint-urile private vechi. Acest detaliu este esențial: dacă am păstra lanțul vechi ca sursă de recuperare, datele evacuate ar reapărea prin părinți.

Baza comună rămâne o rădăcină separată. O altă sesiune deja deschisă continuă să vadă head-urile capturate la deschidere. `discard` restaurează vederea privată de la acel head; `close-session` elimină manifestul sesiunii și pierde modificările necommitted. Un commit concurent pe un head devenit vechi este refuzat, nu reconciliat implicit.

Partajarea fără copiere este pe disc. Loaderul actual materializează băncile din manifest în RAM; nu este încă un pager cu încărcare leneșă de pe disc. La arhive foarte mari trebuie măsurate memoria procesului și latența, nu doar dimensiunea băncilor.

## Garbage collection sigur

Evacuarea logică scoate un shard din vederea curentă. Garbage collection-ul fizic șterge fișierul numai când nu mai este referit de nicio rădăcină.

Algoritmul marchează head-urile bazelor și fork-urilor, head-urile utilizatorilor, snapshot-urile fixate explicit și toate manifestele de sesiune încă existente. Urmează părinții snapshot-urilor și referințele către shard-uri. Validează checksum-urile obiectelor accesibile înainte de prima ștergere. Abia apoi șterge obiectele nemarcate. Un obiect accesibil lipsă sau corupt oprește colectarea; nu se presupune că poate fi ignorat.

`gc` este implicit o simulare. `gc --apply` șterge numai obiecte inaccesibile. Profilurile noi pot declanșa aceeași colectare după `gcEveryWrites` revizii persistate ale unei sesiuni; `0` o dezactivează. Rezultatul este în `maintenance.json` și în `stats`. Eșecul colectării nu este prezentat drept eșec al unei scrieri deja publicate.

Un fork sau o sesiune veche ținută deschisă poate reține intenționat istoria. Închide manifestele care nu mai sunt necesare pentru a permite eliberarea discului. `checkpoint-base` aplatizează lanțul unei baze fără a pierde cunoașterea sau versiunile bibliotecii; fork-urile care referă vechiul head rămân intacte.

Lock-ul repository-ului serializează procesele care scriu pe aceeași cale locală. Manifestele sunt publicate prin fișier temporar și rename. Aceasta nu este o tranzacție distribuită sau o garanție ACID la întrerupere de curent pentru toate fișierele. Un crash poate lăsa obiecte orfane ori un lock ce trebuie verificat de operator. Verificările de integritate și reviziile previn continuarea tăcută pe date detectate ca invalide.

## Configurație și operare

Profilul implicit și `config/runtime-sharded.json` folosesc generații bounded. `config/runtime-sharded-archive.json` folosește creștere fără uitare. Parametrii principali sunt:

| Parametru | Efect |
|---|---|
| `power`, `arity`, `views` | Geometria numai a băncilor noi; băncile vechi păstrează configurația lor. |
| `safeOccupancy` | Prag de rotație pentru cea mai ocupată coloană. |
| `maxClaimsPerShard` | Prag de rotație pentru numărul de claim-uri. |
| `maxShardMetadataBytes` | Prag suplimentar de rotație pentru metadate. |
| `maxColdShards` | Câte generații normale închise păstrează cache-ul. |
| `maxNormalBankBytes` | Buget opțional numai pentru băncile normale. |
| `maxHotAgeMs`, `maxColdAgeMs` | Rotație și retenție după ceasul de mentenanță; `null` le dezactivează. |
| `maxPinnedBankBytes`, `maxArchiveShards` | Cote care produc eroare de capacitate, nu pierdere de date. |
| `gcEveryWrites` | Cadenta colectării fizice pe reviziile persistate ale sesiunii. |
| `policy.maxShards`, `policy.maxProbes` | Limitele de lucru ale unei interogări. |

Ceasul de mentenanță `at`/`usedAt` trebuie furnizat coerent de host. Este diferit de valabilitatea unui fapt și de `knownAt`. Mentenanța temporală se execută la operații și la apelul `maintain`; nu există un scheduler care rulează singur când aplicația este oprită.

```bash
node cli.js init --config config/runtime-sharded.json
node cli.js run --config config/runtime-sharded.json --file examples/auto-link.sop
node cli.js stats --config config/runtime-sharded.json
node cli.js maintain --config config/runtime-sharded.json
node cli.js commit --config config/runtime-sharded.json
node cli.js gc --config config/runtime-sharded.json
node cli.js gc --config config/runtime-sharded.json --apply
```

Pentru un repository existent, fă o copie de siguranță și migrează explicit sesiunea. Schimbarea fișierului de configurare nu rescrie o sesiune existentă în secret:

```bash
node cli.js migrate --config config/runtime-sharded-archive.json --root state --base demo --user local --session s1
node cli.js commit  --config config/runtime-sharded-archive.json --root state --base demo --user local --session s1
```

Migrarea importă băncile vechi ca generații, fără să necesite Fact Store sau replay. Nu evacuează nimic în timpul migrării. Cu profil bounded, următoarea scriere/mentenanță poate aplica limitele și elimina generațiile în exces. Profilul arhivă este potrivit pentru o migrare conservatoare.

## Ce este testat

`tests/shards.test.js` verifică rotația după ocupare, volum și timp, protecția pinned, bugetele, promovarea, izolarea, bitemporalitatea, păstrarea corecțiilor, reutilizarea fișierelor, checkpoint-urile, migrarea și GC. Sunt incluse coruperea unui shard accesibil, lock concurent, lot respins atomic și output scalar blocat când bugetul de citire este epuizat.

`examples/shards-demo.js` rulează un circuit SOP cu o regulă de rudenie, promovează premisele folosite, evacuează fapte neutilizate, păstrează o sesiune veche, o închide, recuperează spațiul și redeschide repository-ul. `tools/bench-shards.js` testează separat completarea unor fapte sintetice, cu aceleași intrări în mod bounded și archive.

Acestea sunt teste de implementare și integrare, nu dovezi de performanță neuronală sau la scară Internet. Rezultatele numerice ale rulării livrate sunt în `reports/shards/`, iar rezultatul întregii verificări este în `reports/verification.json`.

```bash
node --test tests/shards.test.js
node examples/shards-demo.js
node tools/bench-shards.js --facts 2000 --queries 200 --batch 64 --power 10 --cold 4 --seed 731
node tools/check-data.js --dir data/seed --execute --sharded
```
