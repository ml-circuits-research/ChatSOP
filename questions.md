# questions.md: decizii deschise

Aici sunt doar întrebările care schimbă ce face sistemul, sau unde nu sunt sigur că am înțeles. Scrie răspunsul pe linia `**Răspuns:**`. Dacă o lași goală, aplic recomandarea. După ce o decizie e implementată, întrebarea dispare din acest fișier.

Întrebările Q-ARCH sunt despre articol și experimente. Nu blochează datele sau limbajul și nu le aplic automat dacă rămân necompletate.

## Q-DATA-5: „pentru ce e închisă sala?” — rol `topic` sau întrebare „de ce”?

**Context:** În corpusuri, „What is X closed for?” / „Pentru ce e închisă X?” se formalizează ca întrebare wh cu `relation "be closed for"` / `"fi închis pentru"` și `role topic ?x` (90 de rânduri). În română, „pentru ce” se citește adesea ca „de ce”, adică `mode explain` (DS021).
**Opțiuni:** A) păstrăm `topic ?x` (evenimentul pentru care e închisă); B) „pentru ce” în română devine `mode explain`, iar engleza rămâne `topic ?x`; C) scoatem formularea „pentru ce” din generator.
**Recomandare:** C. Formularea este ambiguă, iar varianta cu `topic` rămâne disponibilă prin „What is X closed for?”.
**Răspuns:**

## Q-DATA-6: „o firmă din Cluj” — relația `"fi în"` sau `"fi din"`?

**Context:** În întrebările join și anchor, „o firmă din X” / „companies in X” devine `relation "fi în"` cu `role location` (aproximativ 120 de rânduri). Convenția din DS022 permite restaurarea cuvintelor funcționale, dar aici prepoziția e schimbată („din” devine „în”).
**Opțiuni:** A) acceptăm „din” → `"fi în"` ca normalizare documentată; B) relația devine `"fi din"`, cu un alias nou în lexicon.
**Recomandare:** B. Păstrează cuvintele mesajului, conform regulii pentru relații.
**Răspuns:**
