# Rezultate comparative

Măsurători noi. Seed-uri prezente: 11, 29, 53. Numărul de interogări din fiecare categorie este consemnat în summary.json; rularea livrată folosește 80 directe, 20 pentru chei absente și 2 inverse largi per seed. Ground truth este accesibil evaluatorului, nu memoriei.

| Fapte | Motor | Recall completări | Mediană ms | Recall invers | Bănci/SQL/payload MiB | Metadate extra MiB |
|---:|---|---:|---:|---:|---:|---:|
| 10,000 | weaver | 100.00% | 2.416 | 100.00% | 2.50 | 1.19 |
| 10,000 | holo | 100.00% | 0.099 | 39.48% | 2.50 | 0.99 |
| 10,000 | sqlite | 100.00% | 0.014 | 100.00% | 5.79 | 0.00 |
| 10,000 | scan | 100.00% | 1.791 | 100.00% | 1.61 | 0.00 |
| 100,000 | weaver | 100.00% | 2.404 | 100.00% | 2.50 | 11.97 |
| 100,000 | holo | 96.55% | 0.109 | 18.14% | 2.50 | 9.96 |
| 100,000 | sqlite | 100.00% | 0.015 | 100.00% | 58.61 | 0.00 |
| 100,000 | scan | 100.00% | 21.316 | 100.00% | 16.20 | 0.00 |

Recall numără faptele recuperate / faptele așteptate, nu numai interogările rezolvate integral. Nu au fost acceptate tuple inexistente în aceste teste; Holo și Weaver folosesc verificare SHA-256 prin receipts. Aceasta nu echivalează cu probabilitate 100% de adevăr sau cu garanția că au fost recuperate toate alternativele.

Timpii sunt pentru nucleele de memorie, nu includ parserul SOP, timpul LLM, construirea întregului context temporal sau snapshot-urile repository-ului. Doi timpi de citire SQL nu înseamnă că un dialog complet durează atât. Latențele de mai sus sunt cache-warm, locale.

Ambele memorii asociative au exact același buget de tablouri de 2,5 MiB; dicționarele și amprentele sunt suplimentare. SQLite include patru indici de argumente și FTS. Scan raportează reprezentarea serializată, nu memoria V8. RAM/RSS și dimensiunea snapshot-ului sunt disponibile în fiecare raport individual.

H7 din documentul sursă nu specifică întreg codul și configurația rulării originale. Nu prezentăm numerele originale drept reproduse. Raportul h7-kernel.json conține măsurătorile noului nucleu, separat de comparația pe fapte.
