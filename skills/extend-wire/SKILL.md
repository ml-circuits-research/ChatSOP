---
name: extend-wire
description: Add a typed, approved SOP interpreter
---

# Add a typed, approved SOP interpreter

Citește `docs/legacy/requirements/02-runtime.md` și `docs/legacy/requirements/06-backenduri.md`. Încearcă întâi un template din fire existente. Dacă este necesar un tip nou, definește intrările, ieșirile, tipurile, efectele, permisiunile și bugetele; apoi adaugă handler-ul de host.

Nu pune codul backend-ului în output-ul LLM-ului. Tradu numai AST validat. Nu folosi `eval`, `Function` sau `node:vm` drept sandbox. Orice operație nouă în `jsEval` trebuie implementată printr-un caz explicit al evaluatorului și teste adversariale.

Delimitează destinatarii: `jsEval` aparține doar fluxului de coding agent cu controlul și aprobarea hostului, nu țintelor sau antrenării modelului mic NL→SOP. Nici expresiile complexe din `value.data` nu sunt o alternativă deghizată pentru formalizatorul mic. Prioritatea lui este SOP simplu fiabil, evaluat separat de ChatSOP complet; corpusul existent poate încălca acest profil și rămâne în așteptarea migrării/revizuirii, fără regenerare de date/teste sau training înainte de acordul asupra sintaxei. Astăzi `jsEval` este numai interpret de expresii restricționate, nu JavaScript complet; nu promite suport viitor pentru JavaScript complet.

Pentru coding agents, proiectează numai programe de raționare cu contract aprobat, permisiuni și limite explicite. Vocabularul poate fi extins la nevoie pentru algoritmi, căutare în graf și construcție de colecții/grafuri, după aprobare și implementare, nu prin presupunerea că aceste capabilități există deja și nu prin extinderea tacită a țintelor formalizatorului mic.

După acordul asupra sintaxei/profilului relevant și după implementare, actualizează profilul/versionarea, exemplele, validarea datasetului aferent și documentația; nu regenera acum corpusul formalizatorului mic. Testează eșecuri, date ambigue, contradicții și imposibilitatea de a escalada controlul din text. Dacă backend-urile nu au aceeași semantică, delimitează profilul portabil în loc să pretinzi echivalență generală.
