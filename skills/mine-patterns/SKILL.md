---
name: mine-patterns
description: Generate and validate candidate patterns from traces
---

# Generate and validate candidate patterns from traces

Lucrează pe surse/trace-uri explicite, nu inversa bitset-uri și nu pretinde enumerarea tuturor experiențelor din ele. Separă cazurile train/holdout după document și origine. Folosește induce cu șabloane candidate și compară cu generatorul simplu. Folosește associate numai pentru scorarea/rutarea candidaților.

closed=true cere o justificare a completitudinii fiecărui caz. Altfel absența consecventului este unknown, nu contraexemplu. Raportează suporturi, contraexemple, necunoscute, conflicte și cost. Include cazurile adverse, nu numai pattern-urile cu scor mare.

Propune o regulă nouă numai printr-un fișier de revizuire separat. Nu executa assert pe concluzii inductive drept facts. Când o regulă nu este universală, păstrează pattern-ul ca euristică/ipoteză ori restrânge domeniul cu precondiții verificabile. Nu atribui scorurilor de hashing probabilități ale adevărului.
