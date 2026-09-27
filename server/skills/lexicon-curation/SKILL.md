---
name: lexicon-curation
description: Curate multilingual aliases and canonical IDs
---

# Curate multilingual aliases and canonical IDs

Citește `04-lexicon.md`. Distinge alias de identitate, sinonimie contextuală, implicație și subsumare. În special `mother` nu trebuie eliminat prin normalizare în `parent`. Două persoane cu același nume păstrează ID-uri separate.

Propune modificări în `config/ontology.sop`, cu descriere, tipuri și exemple în limbile vizate. Formele flexionate ale numelor pot fi aliasuri explicite. Nu folosi repetarea aceleiași presupuneri drept dovadă.

Pentru alias folosește un review cu `canonicalId`, `language`, `surface`, `verdict:accept`, `reviewer`, `evidence`; dacă aliasul desemnează mai multe ID-uri, `keepAmbiguous:true` trebuie justificat. Aplică prin `tools/review-alias.js --ontology ... --review ... --out ...`. Rulează teste de coliziune, cu/fără diacritice, limite de cuvinte și shortlist.
