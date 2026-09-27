# 16. Uitare, întărire și controlul capacității

Acest capitol descrie cooling-ul pe contoare, disponibil în profilul legacy `runtime-adaptive.json`. Profilul implicit generațional este implementat separat și descris complet în **18-sharduri.md**: rotație, promovare, evacuare și GC.

## În ce sens memoria este „holografică”

Recall Weaver este holografică în sens operațional/distribuit: un fapt nu este localizat într-o singură adresă, ci contribuie simultan la mai multe coloane și mai multe celule partajate. Recuperarea apare din consensul acestor proiecții. Pierderea unei părți a suportului reduce gradual șansa de reconstrucție în loc să șteargă obligatoriu un record unic. Nu folosim termenul ca afirmație că implementarea este o Holographic Reduced Representation clasică; mecanismul concret este multi-view hashing cu contoare.

## Ideea de bază

Recall Weaver este o memorie distribuită multi-view. Un fapt nu ocupă o intrare unică. El este proiectat în mai multe coloane, iar fiecare coloană incrementează o celulă hash-uită. Din acest motiv, uitarea nu poate însemna „șterge biții faptului X”: aceleași celule pot susține simultan mai multe fapte.

Mecanismul folosit aici este mai apropiat de un cache asociativ probabilistic. Celulele sunt contoare saturate pe 4 biți, cu valori 0..15. O observație nouă crește contoarele atinse de toate vederile faptului. O folosire reală a faptului într-o demonstrație le crește din nou. Când memoria normală trece peste o ocupare considerată sigură, runtime-ul execută unul sau mai multe cicluri de răcire: fiecare contor normal pozitiv este decrementat. Relațiile observate o singură dată ajung primele la zero; relațiile reobservate sau folosite des supraviețuiesc mai multe cicluri.

Aceasta este o uitare aproximativă. Nu păstrează o listă ordonată de fapte după LRU și nu garantează că exact cel mai vechi fapt dispare primul. Avantajul este că mecanismul operează direct pe memoria distribuită, fără a cere un tabel complet cu toate faptele originale.

## Cele două bănci de retenție

Fiecare strat temporal are două memorii fizic separate:

- `normal`: participă la decay și la întreținerea automată sub presiune;
- `pinned`: nu este răcită automat.

Un fapt declarat `retention pinned` este proiectat numai în banca pinned. Modul adaptive nu îi reduce suportul. Pinning-ul este pentru informații care trebuie păstrate indiferent de frecvența utilizării: instrucțiuni explicite ale utilizatorului, reguli de siguranță, identități stabile sau alte elemente selectate de policy.

## Scrierea unui fapt normal

Configurația relevantă este:

```json
{
  "retention": {
    "mode": "adaptive",
    "safeOccupancy": 0.55,
    "targetOccupancy": 0.42,
    "writeStrength": 2,
    "useStrength": 1,
    "decayStep": 1,
    "maxSweeps": 6,
    "reinforceOnUse": true,
    "pruneMetadata": true
  }
}
```

La `assert`:

1. faptul este canonicalizat;
2. fiecare vedere calculează o adresă hash;
3. contorul de la acea adresă crește cu `writeStrength`, fără a depăși 15;
4. receipt-ul tuplei primește aceeași tărie logică;
5. pentru un fapt normal se rulează `maintain()`;
6. dacă ocuparea este sub `safeOccupancy`, nu se uită nimic;
7. dacă pragul este depășit, începe răcirea descrisă mai jos.

`writeStrength > 1` este util tocmai pentru ca un fapt tocmai observat să nu dispară la primul sweep de maintenance care a fost declanșat de o memorie deja aglomerată.

## Ce înseamnă „folosit”

Nu întărim orice candidat recuperat. Aceasta ar crea un feedback periculos: un false positive ar deveni mai puternic doar pentru că a fost găsit.

Un fapt este întărit automat numai dacă apare în `proof`-ul final al reasoner-ului, ca fapt observat și verificat prin metadatele memoriei. După reasoning:

1. runtime-ul extrage premisele observate efectiv folosite;
2. fiecare premisă este proiectată din nou în coloane;
3. contoarele cresc cu `useStrength`;
4. receipt-ul este întărit;
5. în stratul hot curent se copiază metadatele minime ale faptului, astfel încât un fapt util dintr-un snapshot mai vechi să poată fi promovat înainte ca stratul vechi să fie eventual eliminat.

Asta produce comportamentul dorit de cache: informația care este cerută și folosită rămâne „caldă”.

## Maintenance sub presiune

`occupancy` este fracția de celule nenule din toate coloanele unei bănci. Nu măsoară numărul de fapte; măsoară cât de încărcată este suprafața hash-uită. Pe măsură ce ocuparea se apropie de 1, vederile discriminează mai prost și false positives cresc.

Algoritmul adaptiv este:

```text
on normal write or real proof use:
    update counters
    occupancy = measure()

    if occupancy <= safeOccupancy:
        stop

    repeat up to maxSweeps:
        decrement every positive normal counter by decayStep
        decrement receipt strengths by decayStep
        delete receipts whose strength becomes zero
        occupancy = measure()
        if occupancy <= targetOccupancy:
            stop
```

`targetOccupancy` este mai mic decât `safeOccupancy` pentru a introduce hysteresis. Fără aceasta, sistemul ar putea intra în maintenance după aproape fiecare scriere când memoria stă exact la prag.

Un sweep costă liniar în numărul de bytes ai băncilor normale, deoarece fiecare octet conține două contoare și este vizitat o dată. Pentru memorii de ordinul MB/GB, un sweep ocazional este simplu și predictibil. Pentru memorii foarte mari nu vrem să scanăm sute de GB la fiecare presiune; extensia naturală este răcirea pe segmente/stripe sau memorie generațională, unde shard-urile reci sunt eliminate și faptele folosite sunt promovate în shard-ul hot.

Dacă `pruneMetadata=true`, claim-urile locale normale ale căror receipts au dispărut sunt eliminate împreună cu evenimentele/jurnalul local aferent. Aceasta este potrivit pentru un cache adaptiv. Pentru audit complet se folosește modul archive sau un store separat de audit.

## De ce memoria folosită supraviețuiește

Exemplu conceptual cu `writeStrength=2`, `useStrength=1`, `decayStep=1`:

```text
fapt A observat o dată       -> celulele sale au aproximativ tăria 2
fapt B observat o dată       -> celulele sale au aproximativ tăria 2
A este folosit de 3 ori      -> celulele lui A ajung aproximativ la 5

3 sweep-uri de răcire:
B: 2 -> 1 -> 0 -> absent
A: 5 -> 4 -> 3 -> 2          -> încă recuperabil
```

Valorile reale ale celulelor pot fi mai mari din cauza coliziunilor și a relațiilor comune. Tocmai de aceea mecanismul este probabilistic și nu un contor perfect per fapt.

## Receipt-urile și metadatele

În profilul `verification: receipt`, fiecare tuplu are și un hash exact folosit după reconstrucție pentru a elimina false positives. Dacă băncile s-ar răci dar receipt-urile ar rămâne pentru totdeauna, memoria totală nu ar fi bounded. În modul adaptiv, receipt-ul are de aceea o tărie proprie și este decrementat odată cu sweep-urile. Când tăria ajunge la zero, receipt-ul este eliminat.

Registrul lexical și domeniile canonice sunt altă categorie. Faptul că sistemul a uitat `worksAt(maria,cern)` nu înseamnă că trebuie să uite existența entităților `maria` sau `cern`. Ontologia, aliasurile și EntityRegistry sunt vocabular/index semantic și au politici proprii de compaction/sharding.

## Modul archive / fără uitare

Pentru scenarii în care orice pierdere este inacceptabilă:

```json
{
  "retention": {
    "mode": "none",
    "writeStrength": 1,
    "useStrength": 0,
    "reinforceOnUse": false,
    "pruneMetadata": false
  }
}
```

În acest mod nu există decay automat. `safeOccupancy` poate fi folosit doar ca indicator operațional; host-ul trebuie să aloce mai multă memorie sau să creeze shard-uri noi înainte ca banca să se satureze.

Profilul este disponibil în `config/runtime-archive.json`. Profilul cache-like este `config/runtime-adaptive.json`.

## Putem mări memoria pur și simplu?

La crearea unei bănci, `power` stabilește câte celule are fiecare coloană: `2^power`. Mai mult `power` înseamnă mai multă memorie și o saturație mai lentă. Numărul de bytes al băncilor este aproximativ:

```text
number_of_views * 2^power / 2
```

împărțirea la doi apare deoarece două contoare de 4 biți sunt împachetate într-un octet.

O bancă existentă nu poate fi redimensionată transparent. Hash-ul este mascat cu dimensiunea băncii; schimbarea lui `power` schimbă adresele. Există două soluții corecte:

1. `rebuild`: dacă avem un jurnal/exact store, replay-uim faptele într-o bancă mai mare;
2. `segment/shard growth`: păstrăm banca veche read-only, deschidem una nouă pentru scrieri și interogăm ambele.

Pentru o memorie Internet-scale, a doua soluție este cea naturală. Factele folosite din shard-uri reci pot fi promovate în shard-ul hot prin mecanismul de reinforcement.

Profilul cu shard-uri implementează acum rotația, promovarea între generații, checkpoint-uri private fără lanț de straturi uitate și garbage collection al obiectelor inaccesibile. Capitolul 18 explică și de ce baza comună, pinned, jurnalele de corecție și sesiunile încă deschise au bugete separate de cache-ul normal.

## Alegerea pragurilor

`0.55` și `0.42` sunt valori experimentale, nu constante ale tehnologiei. Pentru un domeniu nou:

1. se umple memoria progresiv;
2. pe un set held-out se măsoară recall-ul, ambiguitatea și false positives;
3. se identifică punctul unde calitatea începe să se degradeze rapid;
4. `safeOccupancy` se alege înaintea acelui punct;
5. `targetOccupancy` se alege suficient de jos pentru hysteresis, dar nu atât de jos încât să producă pierdere inutilă;
6. se repetă pentru mai multe dimensiuni de bancă și portofolii de views.

Scopul nu este o rată fixă de uitare, ci menținerea memoriei în zona unde consensul dintre coloane rămâne discriminatoriu.

## Comenzi de verificare

```bash
node cli.js stats --config config/runtime-adaptive.json
node cli.js maintain --config config/runtime-adaptive.json
node cli.js decay --steps 1 --config config/runtime-adaptive.json
```

`maintain` aplică policy-ul configurat; `--force` poate forța un ciclu adaptiv pentru experimente. `decay` este o unealtă explicită de test, nu mecanismul normal de producție.
