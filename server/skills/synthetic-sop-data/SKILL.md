---
name: synthetic-sop-data
description: Generate reviewed NL-to-SOP examples
---

# Generate reviewed NL-to-SOP examples

Citește `07-date.md`. Construiește mai întâi lumi și ținte SOP executabile. Folosește prompturile din `src/llm.js`, nu o versiune paralelă. Fiecare exemplu are profil, grup și split. Nu muta parafraze între split-uri.

Generează variații de limbaj cu un profesor pornind de la ținta fixată. Verifică timpul, negarea, scopul întrebării și identitățile; ținta nu se aprobă doar pentru că parsează. Include clarificări corecte, nu numai întrebări rezolvabile.

Rulează `tools/check-data.js --execute`. Păstrează un holdout uman și compoziții logice distincte. Documentează modelul profesor, parametrii, sursele și deciziile de review. Nu numi exemplele programatice „română naturală validată” fără revizuire.

Pentru profilul v3, citește și `27-date-si-invatare-v3.md`. Catalogul de tipuri este `docs/contracts/wires.json`; exemplele cu abducție/planificare nu trebuie reduse la întrebări factuale.
