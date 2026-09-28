# Surse tehnice primare

Consultate la 26 septembrie 2026. Sursele susțin componentele externe, nu rezultate experimentale ale proiectului. Rapoartele proprii sunt în `reports/`.

| ID | Sursă și utilizare |
|---|---|
| S1 | Node.js, `node:vm`: https://nodejs.org/api/vm.html — documentația precizează că modulul nu este mecanism de securitate pentru cod neîncrezător. De aici alegerea unui evaluator de expresii propriu, restrâns. |
| S2 | SWI-Prolog, tabled execution: https://www.swi-prolog.org/pldoc/man?section=tabling — suportul pentru tabling; profilul și compilerul nostru rămân definite în codul proiectului. |
| S3 | Z3 Guide, basic commands: https://microsoft.github.io/z3guide/docs/logic/basiccommands/ — satisfiabilitate, statusuri și operații; diferența dintre existența unui model și entailment este tratată explicit de adaptor. |
| S4 | Google, Gemma 3 270M IT: https://huggingface.co/google/gemma-3-270m-it — model de bază și condiții; nu dovadă de performanță pe română/SOP. |
| S5 | Qwen, Qwen3 0.6B: https://huggingface.co/Qwen/Qwen3-0.6B — model alternativ, template și controlul thinking. |
| S6 | NVIDIA Spark, instrucțiuni fine-tuning: https://build.nvidia.com/spark/unsloth/instructions — referință pentru mediul NVIDIA 25.11. Rețeta livrată aici folosește Transformers/PEFT, nu necesită Unsloth. |
| S7 | Hugging Face PEFT, LoRA: https://huggingface.co/docs/peft/en/developer_guides/lora — implementarea adaptoarelor utilizată de training. |
| S9 | Thousand Brains Project, learning modules: https://docs.thousandbrains.org/docs/learning-modules — modele de obiecte, referințe spațiale și vot între module; paralela Recall Weaver privește numai perspectivele complementare, nu echivalența mecanismelor. |
| S8 | llama.cpp: https://github.com/ggml-org/llama.cpp — sursa uneltelor de export/servire; build-ul trebuie arhivat cu commit-ul efectiv. |

Profilul `sop-agent-2` este un contract experimental al acestui pachet. Nu este prezentat drept standard extern sau implementare integrală a tuturor extensiilor SOP Lang.

## Referințe pentru motoarele de memorie

[H7] Document furnizat de utilizator, „HoloMemory: A bounded associative memory for SOP-Lang agents and formal reasoning”. Copia originală `.docx` a fost arhivată în `probably_obsolete/references/H7.docx`; textul extras rămâne în `docs/legacy/references/H7.txt`, iar constatările curente sunt consemnate în DS005/DS006. Numerele din document nu sunt revendicate drept reproduse; benchmark-urile noi au surse și seed-uri proprii.

[S10] Node.js, SQLite API, documentația versiunii 22.13.1: https://nodejs.org/download/release/v22.13.1/docs/api/sqlite.html . DatabaseSync, fișiere și baze în memorie, prepared statements. Consultat 2026-09-26.

[S11] SQLite, Query Planning: https://sqlite.org/queryplanner.html . Indici compuși și căutări exacte. Consultat 2026-09-26.

[S12] SQLite, FTS5: https://sqlite.org/fts5.html . Căutare lexicală, tokenizare și BM25. Consultat 2026-09-26.


## Reasoning v3 — surse tehnice primare

- Poole și Mackworth, Artificial Intelligence: Foundations of Computational Agents, ediția 3, capitolul Planning: https://artint.info/3e/html/ArtInt3e.Ch6.S2.html . Inspiră utilizarea căutării înainte în spațiul stărilor; codul acestui pachet este propriu și neoptimizat.
- SWI-Prolog manual, tabling: https://www.swi-prolog.org/pldoc/man?section=tabling . Adaptorul folosește profile Horn; nu pretinde toate semantici WFS ale SWI.
- Z3 Guide, Propositional Logic: https://microsoft.github.io/z3guide/docs/logic/propositional-logic/ . Distincția dintre satisfiabilitate și validitate.
- Z3 Guide, Optimization introduction: https://microsoft.github.io/z3guide/docs/optimization/intro/ și Arithmetic optimization: https://microsoft.github.io/z3guide/docs/optimization/arithmeticaloptimization/ . Adaptorul v3 adaugă verificarea separată a optimalității și proiecției.

Nici aceste surse, nici testele sintetice nu demonstrează noutatea sau superioritatea RecallSOP. Propunerea proiectului este separarea explicită a limbajului, memoriei și interpretoarelor și evaluarea lor combinată.
