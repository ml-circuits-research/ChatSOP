# 07. Date sintetice și fine-tuning către SOP

**Profilul curent este sop-agent-3.** Contractele și noile operații sunt în capitolele 23–29; catalogul exact al câmpurilor este `docs/contracts/wire-fields.md`. Notele istorice despre funcții neimplementate se citesc împreună cu stadiul v3 din capitolul 28.

## Cele două sarcini

Formalizatorul învață `mesaj + micro-context → program SOP`. Verbalizatorul învață `CNL + limbă → răspuns natural`. Niciunul nu trebuie să învețe o versiune JSON a faptelor sau să genereze cod Prolog/Z3. Seturile folosesc câmpurile JSONL `prompt` și `target` numai pentru transport; `target` este sursa SOP pentru formalizator și text pentru verbalizator.

`src/llm.js` construiește prompturile folosite atât la generarea datelor, cât și la inferență. Evităm un protocol la training și altul la runtime. Clasele de mesaj sunt un singur mesaj `user` cu toate instrucțiunile și contextul, urmat de ținta `assistant`. Template-ul chat al tokenizerului este aplicat în Python; `enable_thinking=False` este transmis pentru modelele care suportă această opțiune.

## Punctul de pornire livrat

`data/seed/` conține lumi fictive cu entități distincte. Fiecare lume are fapte și reguli în `setup_sop`, 37 sarcini de formalizare și 8 de verbalizare. Cu 30 de lumi rezultă 1.110 ținte SOP și 240 de ținte NL, în total 1.350 rânduri. Acestea sunt exemple programatice, nu un corpus suficient pentru conversație liberă.

Sarcinile acoperă afirmații și negații, precizia mother/parent și contractor/employee, preferințe pinned, întrebări directe/inverse, joins, numărare, explicații, puncte și intervale temporale, `asof`, corecții cu ID real, închidere de stare, ipoteze, template-uri aprobate, posibilitate versus demonstrație numerică, engleză, lipsa diacriticelor, pronume ambigue și text citat ce conține instrucțiuni. Exemplele detaliate și țintele sunt inspectabile în JSONL.

```bash
node tools/build-data.js --out data/generated --worlds 1000 --seed 731
node tools/check-data.js --dir data/generated --execute --out reports/generated-validation.json
```

Verificatorul parsează țintele, verifică forma canonică și împărțirea grupurilor, apoi execută fiecare țintă SOP într-o sesiune izolată a lumii sale. Verifică statusul așteptat și, când exemplul declară `expectedOutputs`, valorile ori stările ieșirilor generate. Nu cere un LLM și nu produce scor de acuratețe neuronală.

## Split fără contaminare trivială

Toate sarcinile unei lumi rămân în același split: 80% train, 10% dev, 10% test. Parafrazele moștenesc grupul părintelui. Verificatorul respinge prompturi identice care apar în split-uri diferite. Entitățile lumilor sunt distincte. Structurile de șablon sunt însă comune: seed-ul măsoară mai ales execuția/formalizarea unor familii cunoscute, nu generalizarea la noi compoziții logice.

Un benchmark puternic adaugă separat test de formulări umane, test de compoziții nefolosite la training, entități și aliasuri noi, domeniu nou și documente cu actualizări tardive. Nu selecta adaptoare pe test și nu lăsa profesorul să parafrazeze testul și apoi să-l reintroducă în train.

## Procedura de îmbogățire cu profesor

Pornim de la o situație executabilă și o țintă SOP verificată, apoi cerem profesorului doar o parafrază semantic echivalentă. Nu validăm sensul numai prin faptul că SOP este sintactic corect. Negarea, cuantificarea, timpul și intenția pot fi schimbate printr-un singur cuvânt.

```bash
node tools/teacher-generate.js \
  --input data/generated/formalizer/train.jsonl \
  --out data/candidates.jsonl \
  --url http://127.0.0.1:9000/v1/chat/completions \
  --model teacher --limit 100
```

Fiecare candidat are `parentId`, `group`, `split`, hash-ul țintei, modelul profesor și `pending_review`. Cheia API opțională este în variabila de mediu `RECALL_LLM_KEY`, nu în fișierele publicate. Endpoint-ul profesorului poate fi local sau un serviciu autorizat. Nu trimite documente private unui serviciu fără acord.

Reviewerul produce JSONL de forma:

```json
{"candidateId":"ID_DIN_CANDIDAT","verdict":"accept","reviewer":"human-or-reviewed-agent","reason":"Aceleași entități, negare, interval și tip de întrebare."}
```

```bash
node tools/accept-teacher.js \
  --seed data/generated/formalizer/train.jsonl \
  --candidates data/candidates.jsonl --reviews data/reviews.jsonl \
  --out data/accepted-train.jsonl
```

Rezultatele acceptate se adaugă numai split-ului corespunzător, apoi se verifică din nou întregul set. Un coding agent poate revizui, dar este util un al doilea reviewer și un eșantion uman. Un verdict JSON nu este o dovadă semantică sau o semnătură criptografică de autorizare.

## Curriculum recomandat

În prima etapă antrenăm declarații, interogări simple, negare și clarificări, cu scheme mici și identități explicite. A doua introduce joins, timp, corecții și proof queries. A treia introduce folosirea template-urilor și restricții numerice. `jsEval` liber nu trebuie să fie sarcina dominantă a unui model de 270M: operațiile uzuale se oferă în template-uri aprobate.

Include perechi minimale: „este angajată” versus „colaborează”, „nu mai este” versus „nu a fost”, „este posibil” versus „rezultă obligatoriu”, „în anul” versus „la data”, „toți” versus „există”. Dacă profilul nu poate exprima corect cuantificarea cerută, ținta este `clarify`, nu un query aproximativ.

Verbalizatorul are nevoie de mai multă diversitate decât cele opt statusuri inițiale: rezultate cu mai multe răspunsuri, dovezi și surse, intervale, incompletitudine, conflict și ipoteze. Profesorul nu are voie să transforme „necunoscut” în „nu” sau posibilitatea în certitudine.

## Auditul lungimilor și al versiunilor

`training/audit_tokens.py` folosește tokenizerul real înainte de antrenare. Verifică lungimea totală prompt+țintă și numărul de tokeni supravegheați. Nu tăia ținta în mijlocul programului pentru a încăpea. Pentru contexte prea lungi simplifică schema, scurtează definiții redundant explicate ori separă sarcina.

Arhivează profilul SOP, ontology, prompturile, generatorul, seed-ul, lista exemplelor acceptate și hash-urile lor împreună cu adaptorul. Schimbarea unui predicat sau a semanticii unui fir cere regenerare și reevaluare, nu doar editarea documentației.

## Curriculum pentru `?ieșiri` și legarea automată

Profilul tuturor exemplelor este `sop-agent-3`. În țintele noi, un query uzual este urmat de `solve`, nu de pași repetați manual pentru fiecare provider de memorie. `one`, `many`, `rows`, `count` și `status` trebuie învățate prin sensul cererii. `?x` este local în logică, iar `$x` este dependență de valoarea exportată. Nu genera `@x value` cu răspunsul așteptat al exercițiului: acesta trebuie obținut de runtime.

Cazurile noi includ ieșire unică, mai multe răspunsuri, răspuns absent, cascadă între două întrebări, păstrarea tuplurilor, ieșire numerică unică/ambiguă și instanțierea unei proceduri recuperate care combină memorie cu aritmetică. Micro-contextul conține numai definițiile aprobate relevante. Există exemple fără răspuns sau cu ambiguitate pentru ca modelul să nu învețe că orice întrebare trebuie completată cu o constantă.

Schimbarea strategiei de memorie nu cere alte ținte lingvistice. Se testează separat după training, prin policy-ul host-ului. Capitolul 15 definește măsurătorile care separă selecția lexicală, formalizarea, linking-ul, inferența și materializarea ieșirilor.

Pentru profilul v3, citește și `27-date-si-invatare-v3.md`. Catalogul de tipuri este `docs/contracts/wires.json`; exemplele cu abducție/planificare nu trebuie reduse la întrebări factuale.
