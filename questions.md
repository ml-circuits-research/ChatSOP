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

## Q-TRAIN-1: confirmi rulările exacte de fine-tuning pentru PSM și LFM?

**Context:** Ai aprobat în principiu („facem fine tuning la modelele alea două mici, dacă e cazul”). Sonda zero-shot pe 30 de probleme din cărți arată că e cazul la ambele (`experiments/proposal/structure-and-formalizer-models.md` §4):
- **PSM** (GLiNER2.5 base, 194M, pe CPU prin proxy, tier `structure`):
  - găsește scopul întrebării la 7 din 30 de probleme;
  - acoperă 62% din numere, cu precizie de 95%.
- **LFM** (T5-base NL→FOL, 223M, tier `formalizer`):
  - scrie FOL corect sintactic (99%), iar convertorul nostru îl duce în SOP-IR la 79% din propoziții;
  - transformă doar 4 din 32 de întrebări în interogări;
  - lipește numerele în numele predicatelor (`Sells24Muffins`);
  - răspunde corect la 1 din 30, și acela un „nu” prin lume închisă.

Convertoarele deterministe (FOL → SOP-IR → SOP, PSM → inventar) merg pe forma convenită: testele execută da/nu, „care”, constrângeri, ordine în timp, valori cu perturbare.

**Rulările propuse** (detalii și reguli de oprire în `status/preregistrations/train-psm-lfm-v1.json`):
- **D1, date de la profesori, fără antrenare.**
  - `small` și `medium` formalizează independent ~2.750 de probleme nevăzute, din afara secțiunilor de test.
  - Păstrez doar perechile al căror circuit dă răspunsul cărții și trece verificarea pe numere perturbate, cu ambii profesori de acord.
  - Întâi un pilot de 50 de probleme. Buget LLMJobs: 9.000 de apeluri, 5 USD.
  - Poarta: cel puțin 600 de probleme verificate (estimez ~1.100), altfel nu antrenez.
- **T-PSM-1.** Fine-tune complet GLiNER2.5 base pe documentele PSM verificate: lr 1e-5 / 5e-5, batch 8, ≤10 epoci, oprire timpurie pe F1 de dev. Dacă GLiNER2.5 nu se poate antrena cu cod deschis, folosesc GLiNER2 base (208M).
- **T-LFM-1.** Fine-tune complet, continuând din fvossel/t5-base-nl-to-fol, pe ~7.500 de perechi propoziție + inventar PSM → FOL cu extensia `Value`/`Ask`/comparații/`Before`: lr 3e-4, batch 16, ≤10 epoci, oprire timpurie pe execuția corectă pe dev.
- **GPU:** sub 2 ore în total, pe GB10.
- **Python:** antrenarea cere Python cu PyTorch CUDA. Propun imaginea Podman CUDA din ramura înghețată, folosită doar pentru antrenare; servirea rămâne Node, ONNX pe CPU.
- **E1, evaluarea:**
  - pe secțiunile de carte ținute deoparte (20% din secțiuni, ~690 de itemi);
  - în etape 50/100/rest, cu bootstrap pereche față de formalizatorul actual și calea de expresii pe `tiny`.

**Date și licențe:**
- Datele de antrenare și checkpoint-urile rămân locale și nu se publică: drepturile cărților nu sunt clarificate (DS011).
- Datele de antrenare ale fvossel sunt necomerciale.

**Rezultate A/B (2026-10-03, după răspunsul tău; `experiments/proposal/structure-and-formalizer-models.md` §8):** aceleași 30 de probleme, aceleași convertoare, scor după răspunsul cărții, fără perturbare.
- **`tiny` cu prompt de rol, ca PSM:** găsește scopul la 23/30 (GLiNER: 7/30), cu aceeași precizie la cantități.
- **`tiny` ca LFM:** scrie interogări la 21/30 și dă 6 răspunsuri corecte (5 reale), 2 greșite.
- **T5-base, T5-3B și Llama-1B NL→FOL:** cel mult 1 corect, și acela un „nu” prin lume închisă.
- **Inventarul dat de PSM** nu ajută LFM-ul `tiny`.
- **Concluzie:** nimic nu justifică antrenarea GLiNER/T5. Lipsurile rămase ale lui `tiny` sunt de limbaj: constrângeri „găsește x astfel încât…” și comparații infixe, care se rezolvă în convertor, nu prin antrenare.

**Opțiuni:**
- A) Aprobi D1, T-PSM-1, T-LFM-1 și E1 exact cum sunt scrise. Antrenarea pornește doar dacă D1 trece poarta de 600, și o notez în jurnal înainte de primul pas.
- B) Aprobi doar D1 acum; antrenarea o hotărăști după ce vezi randamentul datelor.
- C) Fără fine-tune: rămân modelele zero-shot ca experiment, iar formalizarea rămâne pe calea actuală.

**Recomandare:** A. Poarta de date face din B un pas automat, iar costul total e mic (sub 5 USD, sub 2 ore de GPU). Pentru antrenare nu aplic recomandarea dacă lași răspunsul gol: aștept un „da” explicit.

**Răspuns:** (owner în chat, 2026-10-03) „ok, pune ca posibilitate antrenarea, dar să testăm cu tiny decorat sau cu alte modele de bază întâi, să vedem ce obținem pe acest pattern”. Deci: amânat; NU e aprobare de antrenare. Întâi A/B cu tiny decorat (prompturi de rol PSM/LFM) și modele de bază gata antrenate; întrebarea rămâne deschisă până la rezultatele lor.
