---
name: procedure-library
description: Build approved SOP rules and templates
---

# Build approved SOP rules and templates

Citește `docs/legacy/requirements/01-sop.md`, `docs/legacy/requirements/02-runtime.md` și `docs/legacy/requirements/06-backenduri.md`. Scrie reguli Horn cu variabile `?x`, dependente SOP cu `$wire` și handle-uri cu `~wire`. Nu confunda aceste roluri. Toate variabilele din concluzie trebuie legate de premise.

Pentru un template definește params, yield și body. Refolosește firele standard și referințe explicite. Folosește `only(...)` când un scalar cere unicitatea rezultatului. Nu rezolva tăcut ambiguitatea alegând primul rând.

Testează instanțierea repetată fără coliziuni de nume, lipsa argumentelor, epocile, bugetele, datele lipsă, sursele contradictorii și ordinea efectelor. Publică sursa exactă cu checksum numai după review; memory support nu este autorizație pentru cod.
