---
name: synthetic-sop-data
description: Generate reviewed NL-to-SOP examples
---

# Generate reviewed NL-to-SOP examples

Înainte de a proiecta ținte sau date, citește `docs/wire_types.html` și verifică sintaxa contra gramaticii executabile curente, nu contra propunerii keyword-only fără paranteze/virgule. În gramatica actuală `@id type` declară wire-ul, `$id` consumă o valoare, `?x` este necunoscuta logică locală, iar `~id` referă o definiție aprobată. Propunerile `?other` pentru injectare contextuală/metaprogramare și `~other` pentru handle-uri interne numite nu schimbă sensurile actuale și nu sunt ținte de generat; nu inventa alte convenții. Până la aprobarea explicită a noii sintaxe, nu genera date în acea sintaxă și nu porni training.

Prioritatea imediată este să validezi că **modelul mic formalizator** produce fiabil SOP simplu din limbaj natural; evaluează această sarcină separat de ChatSOP ca sistem complet și de fluxul coding-agent pentru documente/cunoaștere. `jsEval` nu intră în țintele, exemplele noi sau antrenarea formalizatorului mic. Nici expresiile complexe ascunse în `value.data` nu sunt ocolire acceptabilă: folosește numai construcții simple din profilul formalizatorului aprobat sau clarifică dacă nu poți reprezenta cererea. `jsEval` existent este un interpret restricționat de expresii, nu JavaScript complet; viitorul suport JavaScript complet nu este specificat.

Corpusul existent poate conține `jsEval` și alte ținte în afara acestei delimitări: marchează-l **în așteptarea migrării/revizuirii**, nu drept curriculum aprobat pentru modelul mic și nu-l regenera acum. Conveniți întâi sintaxa și profilul țintă; abia apoi revizuiți datele și evaluați modelul mic. Excluderea aceasta nu interzice coding-agentului capabilități de calcul controlate, autorizate de host: programele de raționare aprobate se pot extinde când sunt necesare (algoritmi, căutare în graf, construcție de colecții/grafuri), cu contract, permisiuni și verificare, fără a le transforma automat în ținte pentru modelul mic.

După aprobarea sintaxei și profilului modelului mic, citește `docs/legacy/requirements/07-date.md` înainte de a construi lumi și ținte SOP executabile noi. Folosește prompturile din `server/llm.mjs`, nu o versiune paralelă. Fiecare exemplu are profil, grup și split. Nu muta parafraze între split-uri.

Generează variații de limbaj cu un profesor pornind de la ținta fixată. Verifică timpul, negarea, scopul întrebării și identitățile; ținta nu se aprobă doar pentru că parsează. Include clarificări corecte, nu numai întrebări rezolvabile.

Păstrează separat aserțiunile utilizatorului furnizate ca context pentru întrebare de cunoașterea persistentă extrasă din documente și aprobată cu sursă. Un enunț contextual nu devine automat fapt publicat sau adevăr de referință; marchează premisele necunoscute și verifică fiecare citat, proveniență, negație și interval temporal înainte de aprobarea unei ținte.

Numai după acordul asupra sintaxei și profilului, pentru date noi/revizuite, rulează `tools/check-data.mjs --execute`. Păstrează un holdout uman și compoziții logice distincte. Documentează modelul profesor, parametrii, sursele și deciziile de review. Nu numi exemplele programatice „română naturală validată” fără revizuire.

Pentru profilul v3 separat de curriculumul minimal al formalizatorului, citește și `docs/legacy/requirements/27-date-si-invatare-v3.md`. Catalogul de tipuri este `sop/contracts/wires.json`; existența tipurilor și a exemplelor cu abducție/planificare nu le face ținte ale modelului mic și nu cere reducerea lor la întrebări factuale.
