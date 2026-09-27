# Rezultatele verificării locale

Profil `sop-agent-2`, Node v22.16.0, Linux x64. Rularea actuală include toate testele vechi și motoarele de memorie noi.

| Verificare | Rezultat |
|---|---:|
| Teste Node.js | 265 trecute, 0 eșecuri |
| Teste Prolog/Z3 cu executabile externe | 9 sărite, executabile indisponibile |
| Matrice SOP: 6 circuite × 4 motoare × 2 organizări | 48 trecute |
| Ținte SOP executate pe fiecare dintre Holo, SQLite și scan | 1.110 per motor, 0 erori |
| Ținte SOP executate pe Weaver, inclusiv organizarea shard-uită | 1.110 per organizare, 0 erori |
| Teste Python ale formatului de antrenare | 3 trecute |

Comparația nouă pe 10.000 și 100.000 de fapte sintetice, trei seed-uri per motor, este în `memory/RESULTS.md` și `memory/summary.json`. Fiecare interogare și configurație este în raportul individual. Memoria, metadatele, timpii și limitările sunt separate explicit.

H7: nucleu probabilistic cu contoare semnate, adaptor de fapte cu receipts și test separat de reconstrucție a unui fir SOP dintr-un handle cunoscut. Nu este implementată descoperirea liberă a handle-ului din orice indiciu NL. SQLite este reperul exact cu indici și include și un mod nativ cu un singur fișier.

Modelele neuronale, fine-tuning-ul, Spark și GGUF nu au fost executate. Testele HTTP sunt simulări de contract, nu măsurători ale unui LLM. Kernelurile JS au executat raționamentul din demonstrații. Rezultatele confirmă funcționalitatea pe testele declarate, nu o superioritate generală.

Fișiere autoritare: `verification.json`, `syntax.json`, `data-validation.json`, `data-sharded.json`, `memory/data-*.json`, `memory/sop-conformance.json`, `solvers.json` și logurile asociate.
