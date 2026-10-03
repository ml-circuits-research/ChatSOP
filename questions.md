# questions.md: decizii deschise

Aici sunt doar întrebările care schimbă ce face sistemul, sau unde nu sunt sigur că am înțeles. Scrie răspunsul pe linia `**Răspuns:**`. Dacă o lași goală, aplic recomandarea. După ce o decizie e implementată, întrebarea dispare din acest fișier.

## Q-CODE-1: permiți rularea programelor scrise de model (`engineCode`, P-7)?

**Context:** Ai cerut (prin coordonator, 2026-10-03) firul `codeEval` (un program JavaScript complet scris de formalizator) și apoi `engineCode` cu `engine js|prolog|asp|smt|datalog|sql`. Am proiectat și testat sandbox-ul (fir de execuție separat cu limite de memorie și timp, context fără globale și fără generare de cod pentru JS; `sandboxed(true)` + `safe_goal` pentru Prolog; clingo fără `#script`, Z3 fără `include`, Soufflé fără `.input`/`.output`, SQLite în memorie într-un proces copil; toate sub `prlimit` și oprite la timp). Când am legat execuția în runtime (`sop/runtime.mjs`), sistemul de permisiuni al sesiunii a refuzat-o ca o suprafață nouă de execuție de cod la distanță. Am scos legătura; nu există niciun fir `engineCode` și nu am rulat nicio măsurătoare. Detalii: `experiments/proposal/wire-type-proposals.md` P-7.
**Opțiuni:**
A) Permiți explicit rularea codului scris de model, cu sandbox-ul de mai sus, în runtime și în evaluări; adaugi regula de permisiune în setări, iar un agent reia P-7 (fir, teste adversariale, măsurători pe 30 + 50).
B) Permiți doar în evaluări (harness offline), nu în runtime-ul de produs, până la un audit al sandbox-ului.
C) Cu izolare mai tare: QuickJS compilat în WebAssembly pentru JS (dependență nouă, `dependencies.md`), procese separate pentru restul; apoi A.
D) Renunți la P-7; rămânem la `jsEval` (P-6) și la regulile și constrângerile SOP.
**Recomandare:** C, apoi A: aceeași funcție, cu granița cea mai sigură pentru codul neîncrezut. Dacă lași răspunsul gol, NU aplic recomandarea: rularea codului scris de model cere un „da” explicit al tău și o regulă de permisiune.
**Răspuns:** (owner în chat, 2026-10-03) „te autorizez explicit să faci codeEval, mai ales să poți targeta rapid diferitele engines, dacă poate să genereze rezolvare pe mai multe engine-uri deodată și tu faci fire și dau același rezultat, cu atât mai bine”. Aprobat: engineCode (P-7) cu izolarea proiectată; testele adversariale înaintea rulărilor pe probleme reale.
