# 03. Strategia asociativă, proveniența și fork-urile

Recall Weaver este strategia descrisă în acest capitol, nu singura memorie permisă. Același runtime are furnizori `recall-weaver`, `exact` și `hybrid`; contractul și costurile opțiunilor sunt în capitolul 13.

## Ce reprezintă o relație

Firul `fact` este validat și redus la predicat, argumente canonice și polaritate. Memory encoder-ul folosește șase câmpuri: predicat cu aritate, până la patru argumente și semnul. Câmpurile nefolosite au o reprezentare constantă. Fiecare vedere selectează un subset de câmpuri și hash-uiește combinația în propria bancă. Reinserarea întărește contoarele. Nu este memorată poziția unei propoziții într-un document ca identitate a faptului.

Băncile folosesc contoare de patru biți împachetate câte două într-un octet. `power` stabilește adresele per bancă; `arity` stabilește câte câmpuri privește fiecare vedere. Portofoliul curent este combinatorial, nu învățat în această versiune. La șase câmpuri și aritate trei rezultă douăzeci de vederi. Schimbarea numărului de bytes al alfabetului text nu schimbă aceste șase câmpuri semantice. Nu confunda aritatea unui predicat, aritatea unei vederi și lungimea unui token.

La citire, variabilele primesc valori din domeniile marginale observate. Decoderul construiește candidați și elimină ramurile pentru care o vedere complet disponibilă nu are suport. Furnizorul `recall-weaver` nu consultă o listă separată cu toate tuplele ca răspunsuri. Totuși domeniile pot fi mari; enumerarea are un buget de probe și nu oferă scalare nelimitată.

## Ce este exact, în afara contoarelor

Profilul implicit `verification: receipt` păstrează hash-uri SHA-256 ale tuplelor inserate. După reconstrucție, acestea filtrează false positives ale băncilor. Recepția confirmă compatibilitatea cu un tuplu introdus, sub presupunerea practică privind coliziunile hash; nu confirmă adevărul afirmației în lume. În profilul `associative` acest filtru poate fi oprit pentru experimente.

Metadatele afirmațiilor sunt exacte: ID, hash de tuplu, interval, momentul aflării, sursă, citat și retenție. În configurația asociativă implicită `memory.exact=false`, ele nu conțin corpul complet al atomului. Cu `memory.exact=true`, există în plus o hartă `exactAtoms` opțională, separată de metadate; furnizorul exact o folosește, cel asociativ nu. Costul ei este raportat separat. Pentru audit se poate activa jurnalul opțional, dar testele de reconstrucție folosesc `journal:false`.

Regulile și template-urile sunt diferite de datele reconstruibile. Biblioteca lor păstrează exact sursa SOP și checksum-ul; programul aprobat nu poate fi înlocuit cu o combinație probabilistică. Această separare permite memorie asociativă pentru fapte fără a pretinde că execuția codului este probabilistică.

## Cum se recuperează premisele

`recall` primește query-ul. Pornind de la predicatele cerute, consultă capetele regulilor aprobate și adaugă predicatele din premise, repetând până când nu mai apar altele. Interoghează memoria pentru aceste predicate și pentru ambele polarități; reconstruiește candidații; verifică recepțiile și metadatele valabile la `at/during` și `asof`. Returnează premise, reguli, numărul de probe și completitudinea.

Această implementare caută conservator pe predicate. Nu este încă router semantic de scară Internet. O interogare cu foarte multe valori marginale poate atinge `maxProbes` chiar dacă rezultatul final ar fi mic. Extensiile naturale sunt indexarea indiciilor, selectivitatea bazată pe argumente și recuperarea ierarhică a ID-urilor. Shard-urile locale și rutarea lor pe predicat sunt implementate în capitolul 18. Ele trebuie evaluate în plus, nu presupuse implementate.

## Memorie comună, utilizatori, sesiuni

O bază este un head către un snapshot imuabil. `fork` creează un al doilea nume către același head, fără copierea băncilor. Fiecare utilizator are o vedere privată peste baza aleasă. În profilul generațional, aceasta este un checkpoint de shard-uri; vechiul profil păstrează un lanț de straturi. Sesiunea capturează head-urile existente la deschidere și are un strat local. Astfel un experiment într-o sesiune nu schimbă imediat memoria utilizatorului și nu se propagă altora.

`commit` publică vederea sesiunii ca nou snapshot al utilizatorului. În profilul generațional nu reatașează vechile straturi private evacuate. Shard-urile nemodificate sunt partajate prin referințe la fișiere, nu recopiate. Dacă între timp altă sesiune a avansat head-ul, commit-ul este refuzat; trebuie deschisă o sesiune nouă și reconciliate schimbările. Nu se face un merge tăcut. `discard` elimină schimbările neconfirmate. Accesul local este serializat printr-un lock de scriere, iar reviziile sesiunilor sunt verificate.

```bash
node cli.js fork --from demo --to experiment1
node cli.js run --file examples/remember.sop --base experiment1 --user alice --session s1
node cli.js commit --base experiment1 --user alice --session s1
node cli.js stats --base experiment1 --user alice --session s2
```

Aceste namespace-uri oferă izolare funcțională locală. Ele nu sunt autentificare pentru un serviciu public multi-tenant; autentificarea, ACL-urile, criptarea și cotele trebuie adăugate înaintea expunerii în rețea.

## Uitare și adevăr temporal

Recall Weaver separă datele `normal` de `pinned`. Profilul generațional folosește mai multe bănci pe fiecare traseu; vezi capitolul 18. Paragrafele următoare descriu cooling-ul din profilul legacy cu o bancă pe traseu. În profilul adaptiv, scrierea unui fapt normal crește contoarele cu `writeStrength`, iar folosirea lui efectivă într-un proof îl reproiectează în stratul hot și îl întărește cu `useStrength`. Simplele candidate recuperate nu sunt întărite.

După o scriere sau întărire se măsoară ocuparea băncii normale. Sub `safeOccupancy` nu se întâmplă nimic. Peste prag, runtime-ul execută cooling sweeps: toate contoarele normale pozitive și tăria receipt-urilor scad cu `decayStep` până când ocuparea ajunge sub `targetOccupancy` sau se atinge `maxSweeps`. Pinned nu este răcit. Receipt-urile ajunse la zero dispar; în profilul cache-like pot fi eliminate și metadatele locale care nu mai au suport. Algoritmul complet, exemplele și configurațiile `runtime-adaptive.json` / `runtime-archive.json` sunt în `16-uitare-capacitate.md`.

Uitarea nu este retractare și nici dovadă de falsitate. Închiderea intervalului unui fapt este un eveniment semantic exact. Slăbirea memoriei doar reduce recuperabilitatea. O arhivă istorică completă cere modul fără decay sau o retenție de audit separată.

`stats` separă costul băncilor de metadate și jurnale. Pentru comparații de memorie se raportează toate: bănci, domenii, recepții, metadate, bibliotecă și overhead de serializare. Nu prezenta doar dimensiunea contoarelor drept memoria totală a sistemului.
