---
name: extend-wire
description: Add a typed, approved SOP interpreter
---

# Add a typed, approved SOP interpreter

Citește `02-runtime.md` și `06-backenduri.md`. Încearcă întâi un template din fire existente. Dacă este necesar un tip nou, definește intrările, ieșirile, tipurile, efectele, permisiunile și bugetele; apoi adaugă handler-ul de host.

Nu pune codul backend-ului în output-ul LLM-ului. Tradu numai AST validat. Nu folosi `eval`, `Function` sau `node:vm` drept sandbox. Orice operație nouă în `jsEval` trebuie implementată printr-un caz explicit al evaluatorului și teste adversariale.

Actualizează profilul/versionarea, exemplele, validarea datasetului și documentația. Testează eșecuri, date ambigue, contradicții și imposibilitatea de a escalada controlul din text. Dacă backend-urile nu au aceeași semantică, delimitează profilul portabil în loc să pretinzi echivalență generală.
