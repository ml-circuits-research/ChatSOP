# Skills pentru coding agent

Aceste fișiere sunt proceduri de lucru pentru agent, nu pluginuri executabile încărcate automat. Citește `AGENTS.md`, apoi SKILL-ul sarcinii. Directorul proiectului rămâne workspace-ul; aprobarea surselor și a codului este o etapă separată.

**ingest-sop** — Ingest documents into sourced SOP facts
**review-knowledge** — Review assertions and temporal corrections
**lexicon-curation** — Curate multilingual aliases and canonical IDs
**procedure-library** — Build approved SOP rules and templates
**synthetic-sop-data** — Generate reviewed NL-to-SOP examples
**spark-training** — Run two tiny-model adapters on DGX Spark
**evaluate-agent** — Audit the complete agent experiment
**extend-wire** — Add a typed, approved SOP interpreter

**link-circuit** — Leagă scopurile de reguli și strategii, materializează ieșirile SOP și verifică dependențele

**material-to-sop** — Pregătește surse TXT/MD, circuite directe și reguli implicite candidate; probe și decizie separată înainte de publicare.
**semantic-sop-review** — Canonizare conservatoare, lumi discriminante, review LLM real pentru diferențe nerezolvate și decizia finală a integratorului; nu este aprobare de training.
