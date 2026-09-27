# Cum se citesc rapoartele

Începe cu `RESULTS.md`. `summary.json` agregă 24 de rulări independente: patru motoare, două volume, trei seed-uri. Rapoartele `weaver-...`, `holo-...`, `sqlite-...`, `scan-...` includ datele fiecărei interogări, identificatorii/hash-urile corpusului și cererilor, dimensiunile și configurația completă.

`sop-conformance.json` conține 48 de rulări complete de circuite pe straturi și shard-uri. `data-holo.json`, `data-sqlite.json`, `data-scan.json` verifică țintele de fine-tuning prin execuție, fără modele neuronale.

`h7-kernel.json` este experimentul separat al nucleului. Rata rank-1 nu este precizia condiționată de acceptare și nici un rezultat al adaptorului cu verificare SHA-256. Verifică separat erorile și cheile absente. Testul pentru fire SOP presupune handle cunoscut și este mic/supradimensionat; nu dovedește compresie sau căutare semantică liberă.

Timpii din benchmark-ul pe fapte exclud parserul SOP, LLM-ul, metadatele temporale și salvarea snapshot-urilor. Băncile asociative au aceeași dimensiune de tablouri; bugetul total al metadatelor diferă. Pagini SQL și payload scan nu sunt același lucru cu heap-ul V8.
