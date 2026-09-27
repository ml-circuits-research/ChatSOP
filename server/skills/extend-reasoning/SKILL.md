---
name: extend-reasoning
description: Implement and compare a reasoning strategy
---

# Implement and compare a reasoning strategy

Citește capitolele 24–26. Extinde întâi strategia, nu sintaxa LLM-ului. Înregistrează un handler în ReasoningRegistry, cu operații și profile documentate. Primește AST tipizat și întoarce status, complete, epistemic, route, proof sau candidați după caz.

Un profil necunoscut obligatoriu trebuie să producă unsupported. Poți ignora numai obiecte explicit neadmise ca premise și trebuie să raportezi ignored. Nu elimina constraints, negare, timp sau presupuneri pentru a potrivi un backend. Execuția externe se face prin compiler, fără shell construit din texte ale utilizatorului.

Adaugă teste diferențiale, timeout/cutoff, contradicții, output-uri ambigue, zero soluții, mai multe optime și persistență accidentală. Rulează aceeași SOP pe toate memoriile. Nu pretinde independență de memorie dacă scanarea exactă a fost ascunsă într-un motor asociativ. Documentează fallback-ul real și costurile tuturor metadatelor.
