# Rapoarte incluse

`verification.json` înregistrează rezultatele verificării locale; `node-tests.log` păstrează rezultatul fiecărui test. `solvers.json` raportează executabilele externe efectiv disponibile. Un job de verificare a disponibilității reușit nu înseamnă că backend-urile sunt instalate.

`data-validation.json` numără programele SOP executate și verifică statusuri plus ieșiri. `formalizer-dry-run.log` și `verbalizer-dry-run.log` verifică datele/configurația, fără a antrena. `training-format.log` testează formatarea. Niciun raport livrat nu măsoară un LLM antrenat.

`linker/` conține 18 rulări deterministe, șase exemple cu trei furnizori. Fișierele JSON includ programele extinse, planurile de recuperare și ieșirile. `.pl` și `.smt2` sunt surse generate pentru inspectare sau rulare pe o mașină cu solver; nu sunt o dovadă că solverul extern a rulat aici. Kernelurile JS au executat demonstrațiile. Fragmentele `*-expansions.sop` nu se rulează independent de circuitul lor.

Rularea `node tools/verify.js` regenerează rapoartele. Timpii și platforma pot diferi. Verifică `SHA256SUMS.txt` înaintea regenerării pentru integritatea arhivei livrate.
