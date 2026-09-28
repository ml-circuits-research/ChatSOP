# 22. Protocol de comparație a strategiilor de memorie

## Ipoteze verificabile

Pentru completarea unui argument dintr-un fapt cu restul cunoscut, Holo ar putea fi mai rapid decât explorarea vederilor Weaver. Pentru enumerări cu multe rezultate, un index exact ar putea avea un avantaj major. O memorie distribuită ar putea păstra răspunsuri după pierderea unor celule, dar avantajul trebuie măsurat împreună cu erorile și costul verificării integrității.

Nu definim dinainte un câștigător. Pentru o aplicație contează tipul query-ului, cât poate lipsi, dacă toate răspunsurile sunt necesare, câte greșeli sunt acceptabile, latența și memoria totală. Intuiția „mai biologic” nu ține loc de reper experimental.

## Corpul de date

Generatorul din `tools/bench-memory.js` produce fapte canonice binare. Majoritatea entităților au o valoare, iar o parte au două. Există 128 de valori posibile. Acest lucru creează și întrebări inverse cu multe rezultate. Faptele exacte rămân în evaluator pentru calcularea metricilor; nu sunt date memoriei la citire.

Se rulează 10.000 și 100.000 de înregistrări, fiecare cu trei seed-uri independente. Pentru fiecare seed se folosesc 80 de completări, 20 de interogări cu entități absente și două interogări inverse largi. Query-urile, corpusul și hash-urile lor sunt identice între strategii. Exemplarele inverse sunt puține: rezultatul lor arată o problemă clară a configurației testate, nu estimează exhaustiv toate distribuțiile de interogări.

Memoriile Holo și Weaver primesc exact câte 2,5 MiB pentru tablouri. Holo are cinci bănci, iar Weaver 20 de vederi. Dicționarele, receipts și cache-urile se raportează suplimentar. SQLite păstrează faptele și indicii la dimensiunea rezultată; nu este limitat artificial la 2,5 MiB. Comparația comună este utilitate/cost observat, nu un clasament sub același buget total.

## Măsurare

`recall` înseamnă fapte corecte recuperate împărțite la faptele așteptate. `precision` înseamnă fapte corecte din totalul întors. Se numără separat query-urile pentru care întregul set de răspunsuri este corect, query-urile întrerupte de buget, tuplele false și răspunsurile absente.

Timpii se măsoară după un scurt warm-up. Include căutarea din nucleu și materializarea rândurilor, nu LLM, parser, pregătirea întregului context temporal sau snapshot-ul la fiecare scriere. Intrarea SQLite este un fișier real și ingestia folosește o tranzacție. Baza are indicii de argumente și FTS activ. Timpii construcției și snapshot-ului sunt raportați separat.

`probes` nu reprezintă aceeași unitate de lucru în toate motoarele. Pentru SQL numără rândurile potrivite inspectate, nu toate operațiile din B-tree. Pentru Weaver/Holo numără explorarea candidaților. Nu comparăm probele ca și cum ar fi instrucțiuni CPU identice.

## Experimente care se execută separat

`examples/memory-demo.js` verifică șase circuite SOP pe patru motoare și două organizări de memorie: 48 de execuții. Acesta este testul de compatibilitate cu agentul, nu benchmark-ul de latență pe 100.000 de fapte.

`tools/bench-h7.js` măsoară nucleul cheie–valoare cu 3.000 de asocieri și un alfabet de 256 de valori. Fiecare configurație este testată înainte și după ștergerea aleatorie a 10%, 30% și 50% din contoare. Scorul rank-1 și acceptările greșite sunt separate. Cheile inexistente sunt testate explicit. Fără un checksum sau o urmă de verificare, corelația poate produce false acceptări.

Același script testează planul de conținut H7 pe 30 de fire SOP, folosind handle-uri cunoscute și 1 MiB de contoare. Acesta este un test mic și supradimensionat intenționat, pentru corectitudinea reconstrucției și a porții de integritate; nu demonstrează eficiența compresiei sau descoperirea din indicii parțiale.

Testele automate verifică independent noutatea/repetarea, abținerea, limitele contoarelor, deteriorarea memoriei, protejarea pinned/arhivei, actualizările bitemporale și izolarea fork-urilor. Datasetul de formalizare este executat pe fiecare motor fără să schimbe SOP-ul țintă.

## Reproducere

```bash
node tools/verify.js
node examples/memory-demo.js
node tools/bench-memory.js --counts 10000,100000 --queries 80 \
  --seeds 11,29,53 --engines weaver,holo,sqlite,scan --power 18
node tools/summarize-memory.js
node tools/bench-h7.js --count 3000 --samples 300 --seeds 11,29,53
```

Nu este necesar DGX, GPU, model neuronal sau conexiune la rețea. Testele folosesc Node și biblioteca SQLite inclusă. Trei procese diferite pentru fiecare motor/seed evită refolosirea neintenționată a stării unui alt motor. Generatorul și evaluatorul sunt în ZIP.

Rezultatele executate sunt în `reports/memory/RESULTS.md` și `summary.json`. Rapoartele individuale conțin configurația, CPU-ul, versiunea Node, fiecare query, timpii, memoria și hash-urile intrărilor. `h7-kernel.json` nu reciclează numerele din documentul H7: este o rulare nouă.

## Ce rezultă și ce trebuie testat în continuare

În această distribuție, SQLite este reperul cel mai puternic pentru interogări exacte și inverse. Holo este rapid când cheia are puține valori, dar pierde multe răspunsuri când o cheie agregă sute de valori. Weaver recuperează seturile testate, însă căutarea inversă prin enumerarea unui domeniu mare este costisitoare. Scanarea rămâne corectă și simplă, dar timpul crește cu numărul de fapte.

Experimentele următoare trebuie să varieze numărul de valori per cheie, distribuția popularității, aritatea, dimensiunea domeniilor și proporția câmpurilor necunoscute. Pentru Holo trebuie comparate praguri diferite și mecanisme de separare a valorilor unei chei frecvente. Pentru Weaver trebuie separat costul domeniilor și al receipts de cel al contoarelor. Pentru SQL trebuie măsurate și versiuni fără FTS, cu dicționare de simboluri și indici minimali.

Urmează apoi documente reale formalizate și evaluate semantic, query-uri de utilizator, costul end-to-end al repository-ului, retenție pe flux lung și latența după restart. Un rezultat de nucleu nu dovedește încă un partener conversațional competent și nici o memorie întreagă bounded fără metadate suplimentare.
