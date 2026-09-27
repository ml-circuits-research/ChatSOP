# Reasoning v3 — rezultate executate

## Configurație

Node v22.16.0, linux/x64. Profile SOP agent 3. Codul și datele sunt identificate prin sourceFingerprint `9622b7d31a375e8592dd73dcde7891a70537100bdfeca610ab4825acbbdf6cf1` în raportul de verificare. Nu a fost apelat un model neuronal. Nu s-a executat fine-tuning.

## Teste și comparații

| Verificare | Rezultat |
|---|---:|
| Teste Node totale | 317 |
| Teste Node trecute | 306 |
| Teste eșuate | 0 |
| Teste externe sărite | 11 |
| Scenarii de reasoning | 14 |
| Execuții scenarii × 5 memorii × 2 strategii | 140 |
| Execuții verificate | 140 |
| Tipuri de fir în catalog, inclusiv intern binding | 34 |

Datele formalizatorului conțin 1530 ținte SOP; au fost executate pe Weaver, Holo, SQLite, scan și hybrid, plus validarea separată a configurației shard-uite. Verbalizatorul are 554 seed-uri. O parte a seed-urilor noi sunt identitate CNL și sunt marcate pentru parafrazare revizuită; nu reprezintă un corpus final conversațional.

Cele trei teste Python verifică response-only labels și lipsa trunchierii silențioase. Cele două dry-run-uri de antrenare verifică citirea datelor/configurației; nu încarcă și nu antrenează greutăți.

## Rutele executate

- reference / js: 70 execuții.
- advanced / js: 70 execuții.

Solvare Prolog și Z3 reale: neexecutate în acest runtime; executabilele nu sunt disponibile. Advanced a folosit fallback-uri JS explicite. Nu raportăm o accelerare sau superioritate față de reference din aceste date.

## Interpretarea corectă

Matricea verifică conectarea semantică a operațiilor și independența axelor, pe lumi mici construite pentru test. Nu estimează acuratețea pe documente românești reale și nu demonstrează generalitate nelimitată. Același set explicit de trace-uri este folosit de operațiile de asociere și inducție în toate configurațiile; această parte a matricei nu reprezintă o comparație de stocare a trace-urilor la scară.

Comparația de memorie la volume mari rămâne raportată separat în `reports/memory/`. Ea nu este rerulată aici sub un alt nume și nici extrapolată la sistemul conversațional.

`matrix.json` conține rutele, rezultatele și timpii fiecărei execuții. Timpii mici ai acestor fixture-uri nu sunt un benchmark de producție. `examples/` conține setup-ul, SOP și packet-ul de rezultat; valorile așteptate sunt utilizate de harness după execuție, nu de solver ca input.
