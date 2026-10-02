# questions.md: decizii deschise

Aici sunt doar întrebările care schimbă ce face sistemul, sau unde nu sunt sigur că am înțeles. Scrie răspunsul pe linia `**Răspuns:**`. Dacă o lași goală, aplic recomandarea. După ce o decizie e implementată, întrebarea dispare din acest fișier.

## Q-LANG-10: aprobi sintaxa și semantica pentru metacogniție: `candidate`, `mode effect` și `abduce` peste candidați?

**Context:** Q-LANG-9 e închisă: ai cerut ca metacogniția (raționamentul sistemului despre propriile reguli) să fie suportată obligatoriu. Am verificat pe 8 itemi din cartea de logică (`experiments/proposal/wire-type-proposals.md` P-1). Cu firele existente merg deja: „forțat / doar posibil / contrazis” (`supported` / `unknown` / `refuted` pe câte o interogare), „ce regulă susține concluzia” (`used` și `proof` din pachet), „dacă adaug faptul F, X decurge sau e blocat?” (`stated` cu `certainty supposed` și `if $s`, inclusiv blocarea unui `default` prin `except`). Rezultat: 4 din 8 rezolvați complet, 2 cu verdictul corect dar fără numirea greșelii, 2 nerezolvați. Lipsesc trei lucruri pe care formalizatorul nu le poate scrie azi: (1) o **regulă candidată**, adică „concluzia lui Sam ar decurge doar dacă adăugăm reciproca regulii” (afirmarea consecventului, negarea antecedentului; oracolul o face deja cu o regulă `approval proposed`, dar autorul nu are voie să scrie câmpuri de guvernanță, iar `if` numește doar un `stated`); (2) **efectul fiecărei opțiuni** asupra unei concluzii, într-o singură întrebare („care opțiune întărește sau slăbește argumentul”); (3) **abducția peste opțiunile din mesaj** („care poveste se potrivește”, „ce presupune autorul”), pentru că firul `hypothesis` nu e scris de model. Fără tipuri noi de fire (`claim`/`supports`/`undermines`/`assumes` le resping: ar însemna ca modelul să decidă singur ce susține ce, adică să răspundă, iar niciun motor n-ar putea verifica asta). Separat, fără să-ți cer aprobarea, pentru că e doar corectitudine și implementare: rutez `why_not`, `abduce` și `explain` la oracol pe calea de produs (azi întorc `not_computable`), `abduce` respinge o explicație care contrazice un fapt observat (azi o păstrează: la logic:541, „intrare forțată cu unelte” rămâne, deși nota spune că nu există urme de unelte), iar `explain` numește regulile folosite.
**Opțiuni:**
A) **Extensie a firului `query`, fără tip nou.** Trei adăugiri, câte un cuvânt cheie pe linie:
   - `candidate $id` (repetabil, 1–8) numește un fir din același output care **nu e în vigoare**: un `stated` cu `certainty supposed` (fapt candidat) sau o regulă `rule`/`default` de sesiune (regulă candidată). O regulă numită de un `candidate` sau de un `if` intră doar în rulările acelei interogări, niciodată în teoria sesiunii.
   - `mode effect` cere o afirmație de bază (`where` fără variabile, fără `select`). Rulează afirmația fără candidați (starea de bază), apoi câte o dată cu fiecare candidat adăugat ca presupunere condiționată, și clasifică fiecare candidat: `establishes` (din ne-dovedit devine `supported`: întărește), `blocks` (din `supported` devine `unknown`; posibil doar prin `default`/`except` sau `absent`), `contradicts` (apare `refuted` sau `both`: slăbește), `no_effect`, `inconsistent` (candidatul e contrazis de faptele admise și nu se numără). Pachetul conține `effects`: câte un rând `{candidate, kind fact|rule, baseline, with, effect, used}`.
   - `mode abduce` cu linii `candidate`: toate mulțimile minimale **consistente** de candidați care fac afirmația derivabilă, plus `necessary`, adică candidații prezenți în fiecare mulțime („ce presupune argumentul”). Fără `candidate`, `abduce` rămâne ca acum (pe firele `hypothesis`, scrise de gazdă).
   - `if $r` poate numi și o regulă de sesiune („ce-ar fi dacă regula ar fi și invers”).
   Exemplu (logic:171, „dacă a plouat, pavajul e ud; pavajul e ud; Sam: a plouat”):
   ```
   @r_card rule
     when rained ?m
     then pavement_wet ?m
   @r_converse rule
     when pavement_wet ?m
     then rained ?m
   @s1 stated
     certainty asserted
     relation "pavement_wet"
     role subject "market"
     polarity affirmed
   @q_sam query
     mode effect
     candidate $r_converse
     where match
       relation "rained"
       role subject "market"
       polarity affirmed
     end
   ```
   Rezultat: starea de bază `unknown` (nu e forțat), `r_converse` → `establishes`: „Sam ar avea dreptate doar cu reciproca regulii; cartonașul nu o conține.” La logic:91 (Tess: „poate sări peste ochelari pentru că depozitul e întunecat”), `candidate $s_dark` pe `wears_shield "Sam"` dă `no_effect`: întunericul nu atinge Regula Unu. La logic:541 (poartă deschisă, lacăt închis, fără urme de unelte), `mode abduce` cu `candidate $s_forced` și `candidate $s_key` pe `gate_open` dă o singură explicație, `[s_key]`; `s_forced` e respins, pentru că ar deriva `tool_marks` contra faptului `not tool_marks`.
   **Semantică:** fiecare rulare e ipotetică (`conditional`), nimic nu se stochează și nimic nu se întărește din ea. Cunoașterea strictă bate concluziile `default` ca acum. Un candidat contrazis de un fapt admis e `inconsistent` (aceeași regulă ca la presupuneri). `closed`/`absent` rămân neschimbate: un fapt candidat pe un predicat închis poate bloca un `absent`, și exact asta înseamnă `blocks`. `at`/`during`/`overlaps` se aplică fiecărei rulări; linkurile temporale nu se combină cu `candidate`.
   **Validator:** `candidate` doar cu `mode effect` sau `abduce` (`candidate_needs_mode`); `mode effect` cere cel puțin un candidat și o afirmație de bază (`effect_needs_ground_claim`); ținta e un `stated` `supposed` sau o regulă/`default` de sesiune din același output (`candidate_target`); același fir nu e și `candidate`, și `if` (`candidate_also_if`); cel mult 8 candidați (`candidate_limit`).
   **Motoare:** oracolul js-reference întâi (refolosește `abduce` și verificarea `conditional`; 1+K rulări pentru `effect`, cel mult 2^8 submulțimi pentru `abduce`, limitate de `maxHypotheses`). Routerul trimite modurile de lucru la oracol (R1); celelalte strategii răspund `not_expressible`.
   **Cost:** gramatică și enumerări (un câmp, un mod), 5 verificări de validator, admiterea (candidații scoși din teorie), circa 100 de linii în oracol, firele de răspuns pentru renderer, DS004/DS014, `docs/wire_typs/query.html`, teste.
B) Doar `if $r` pe reguli de sesiune, plus rutarea și reparația de mai sus, fără `candidate` și `effect`: autorul scrie câte o interogare pe opțiune, iar rendererul nu poate spune „opțiunea 2 slăbește”; „ce presupune autorul” rămâne neacoperit.
C) Tipuri noi de fire `claim` / `supports` / `undermines` / `assumes` (graful argumentului ca date). Nu le recomand: modelul ar eticheta singur suportul, iar motorul doar ar citi etichetele.
**Recomandare:** A. Acoperă toate întrebările metacognitive din listă cu un singur câmp și un singur mod nou al firului `query`, fiecare verificabil de oracol. „Ce reguli ale mele sunt în conflict” rămâne, deocamdată, statusul `both` cu `used` pe fiecare polaritate; un mod `conflicts` îl propun separat doar dacă apare în date.
**Răspuns:* pare 9k, cum evitam regresii in notoarele de reasoning, avem acopeeire buna de teste?*
