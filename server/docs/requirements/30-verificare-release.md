# 30. Verificarea unei arhive sau a unui checkout

`node tools/verify.js` rulează verificarea integrală offline. Pentru un runner cu limite scurte per proces, se poate împărți aceeași verificare:

```bash
node tools/verify.js --group core
node tools/verify.js --group associative-data
node tools/verify.js --group exact-data
node tools/verify.js --group python
node tools/verify.js --collect
```

Collect refuză rezultate incomplete sau rezultate din versiuni diferite de surse/date. Nu rerulează testele și nu transformă un eșec în succes. Rapoartele separate sunt păstrate. Seturile Python se pot sări numai când Python lipsește; raportul arată explicit situația. Runtime-ul Node nu are nevoie de Python.

`SHA256SUMS.txt` acoperă conținutul arhivei, cu excepția sa proprie. Verifică-l după dezarhivare prin `sha256sum -c SHA256SUMS.txt` pe Linux. Rerularea testelor actualizează unele rapoarte și, firesc, invalidează hash-urile acelor rapoarte; verificarea de integritate se face înaintea rerulării.

Un release trebuie să păstreze sursa propunerii, requirements, codul, exemplele, skill-urile, datele și măsurătorile. Nu include state-uri personale, tokeni de acces, chei, weights sau cache-uri de execuție. Backend-urile externe și GPU training se verifică pe mașina țintă și se raportează separat de testele JS.
