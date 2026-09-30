# questions.md: decizii deschise

Aici sunt doar întrebările care schimbă ce face sistemul, sau unde nu sunt sigur că am înțeles. Scrie răspunsul pe linia `**Răspuns:**`. Dacă o lași goală, aplic recomandarea. După ce o decizie e implementată, întrebarea dispare din acest fișier.

## Q-PROOF-1: corectorul pornește singur sau doar la cerere?

**Pe scurt.** Avem corectorul mic antrenat (Gemma3-270M), care rescrie mesajul în engleză curată înainte ca SymbolicLM să-l transforme în SOP. Acum e **oprit**: rulează doar dacă cineva îl pornește explicit.

**Ce știm.** Pe mesaje asemănătoare cu datele noastre crește SOP-ul corect cu 3–7 puncte și aproape nu strică nimic. Pe mesaje scrise independent (suita sălbatică) nu ajută deloc.

**Opțiuni.**
- A) Rămâne oprit până avem cazurile noi din `new_cases.md` și o reantrenare care ajută și pe texte reale.
- B) Îl pornim acum, dar doar când SymbolicLM nu e sigur pe analiză (varianta care n-a stricat nimic în teste).
- C) Îl pornim acum pentru orice mesaj în engleză.

**Recomandare.** A. Pe texte reale încă nu aduce nimic, deci nu merită costul de timp.
**Răspuns:**

## Q-CLEAN-1: ce model rulează pasul `llm` al textToCleanEnglish pentru română/mixt?

**Pe scurt.** Am pus provizoriu, ca implicit, `Qwen3-1.7B` Q8_0 (GGUF deja existent în `models/proofing/gguf/`, intrare `qwen3-1.7b-base` în `config/formalizers.json`, aleasă prin `llm.model` în `config/text-to-clean-english.json`). Motiv: `gemma-3-270m-base` (implicitul `translate`) întoarce text gol pe română. Nu am schimbat `defaults.translate` al modului Translate din chat.

**Ce știm** (`eval/reports/current/text-to-clean-english/summary.md`, eșantioane mici de 40–44 mesaje, CPU pentru varianta livrată). Cu mascare de nume/numere și promptul livrat, `Qwen3-1.7B` produce engleză curată (parsare fără spații nerecunoscute plus limbă engleză) la 70% [55, 82] pe română și 64% [49, 76] pe mixt, față de 3% și 14% pentru mesajele neatinse; mediana e ~0,6 s pe CPU. `EuroLLM-1.7B` și `Gemma-3-1B` (GPU, fără mascare) sunt la fel de fluente, dar nu au GGUF și nu sunt mai bune într-un mod rezolvat. Numele păstrate: ~78% pe română pentru toate, deci un rest de risc rămâne; utilizatorul vede oricum propunerea. Atenție: scorul SymbolicLM contra SOP-ului de aur *scade* pe română după traducere (48% neatins, 28% cu LLM), pentru că SOP-ul de aur al unui rând românesc păstrează cuvintele românești (D1); nu avem aur englezesc pentru aceste rânduri.

**Opțiuni.**
- A) Rămâne `Qwen3-1.7B` (implementat acum); eventual se exportă și se compară `EuroLLM-1.7B` în GGUF.
- B) Înapoi la `gemma-3-270m-base` (nu recomand: golește mesajul românesc; UI-ul acum îl lasă neschimbat).
- C) Backendul simbolic (`toEnglish`) pentru română/mixt: rapid și determinist, dar engleza produsă e stricată ("The room takes place and 8 people enrolled at most 29 of at least").

**Recomandare.** A.
**Răspuns:**

## Q-CLEAN-2: `textToCleanEnglish` ar trebui să aibă și un backend `symbolic`, nu doar `languagetool`/`llm`?

**Pe scurt.** Azi `index.mjs` alege între `languagetool` (engleză) și `llm` (română/mixt); traducătorul simbolic nu e o opțiune.

**Ce știm.** Comparația completă e în `eval/reports/current/text-to-clean-english/summary.md`: pe engleza zgomotoasă scrisă de tine (170 de rânduri cu rescriere de referință) corectorul simbolic singur ajunge la potrivire exactă în 12% dintre rânduri, `LanguageTool` (mascat) în 24%, `Qwen3-1.7B` în 31%; pe zgomotul de generator cele trei sunt la egalitate statistică (SymbolicLM = aur: 60%, 54%, 54%, față de 37% netratat). Pentru română/mixt traducerea simbolică e comparabilă la măsura automată, dar textul e prost și traduce nume ("Sânziana" → "The gold-haired fairy").

**Opțiuni.**
- A) Se adaugă backend `symbolic` doar ca rezervă când LanguageTool sau serverul LLM nu răspund (azi mesajul rămâne neschimbat).
- B) Se lasă cum e acum.

**Recomandare.** B; A e o îmbunătățire mică de robustețe, de făcut doar dacă LanguageTool cade des în producție.
**Răspuns:**

## Q-DATA-1: cazurile noi (`new_cases`, scrise de LLM) pot intra în `datasets/`, care e în git?

**Pe scurt.** Cele trei seturi noi (`bad_english`, `symbolic_english`, `neuro_english`) conțin textul celor 6000 de cazuri noi din `datasets_sources/new_cases/` (mesajul și referințele curate), pentru că ai cerut să le refolosim. `datasets_sources/` este ignorat de git (cache local, regula 10 din AGENTS.md), dar `datasets/` și `eval/suites/` sunt urmărite, deci la primul commit textul lor ajunge în git.

**Ce știm.** Cazurile sunt scriere originală a agenților proiectului (persoane `writer-01` … `writer-30`, `llm:deepseek/deepseek-flash+reviewed-by:pending`), fără text copiat, fără date personale (verificat de `build-new-cases.mjs`). Nu sunt încă înregistrate în `DS014-source-rights.md`, iar niciun om nu le-a revizuit: referințele curate rămân `reviewed-by:pending` în toate rândurile.

**Opțiuni.**
- A) Da: le păstrăm în seturi cu `review_status: reviewed-by:pending`, și adaug o înregistrare în DS014 (text scris de LLM pentru proiect, condițiile modelului).
- B) Nu: în seturi rămân doar id-ul și hash-ul; textul rămâne în cache-ul local, iar seturile nu pot fi reconstruite fără el.
- C) Da, dar doar după ce un om a revizuit un eșantion (cum cere `new_cases.md` §6).

**Recomandare.** A (rândurile sunt marcate, iar datele nu sunt folosite la antrenare fără aprobarea ta nouă).
**Răspuns:**
