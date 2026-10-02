# questions.md: decizii deschise

Aici sunt doar întrebările care schimbă ce face sistemul, sau unde nu sunt sigur că am înțeles. Scrie răspunsul pe linia `**Răspuns:**`. Dacă o lași goală, aplic recomandarea. După ce o decizie e implementată, întrebarea dispare din acest fișier.

## Q-DATA-8: pot intra date ShareAlike (CC BY-SA) într-o memorie de bază?

**Context:** `commonsense-v1` ia din ConceptNet 5.7 doar muchiile cu licența proprie CC BY 4.0. Muchiile CC BY-SA 4.0 (importurile din Wiktionary; cele din DBpedia sunt despre lucruri cu nume și nu se potrivesc pe clase) stau acum separat în `config/knowledge/conceptnet-bysa-v1/` (178 de fapte: 157 `is_a`, 21 `part_of`; `"chat": false`, nu e importat de `world-v1` sau de baza implicită; generator `tools/commonsense/free-sources/conceptnet-bysa.mjs`). ShareAlike înseamnă că orice adaptare (o memorie de bază care le conține, o sesiune derivată, un export sau o memorie publicată) se poate distribui doar sub CC BY-SA 4.0 sau o licență compatibilă, cu atribuire și notă de modificare. Aceeași problemă o au DBpedia, YAGO, Wikipedia (text) și părțile ARC/SimpleWikipedia din GenericsKB (DS011).
**Opțiuni:** A) nu intră nicio dată ShareAlike în memoriile de bază; stratul rămâne separat, doar pentru măsurători locale; B) stratul poate fi importat de o memorie de bază anume (de exemplu `world-sa-v1`), iar acea memorie și tot ce derivă din ea (sesiuni, exporturi) sunt marcate CC BY-SA 4.0 în manifest și nu se combină cu date incompatibile; C) intră în baza implicită a chatului, iar toate memoriile derivate și exporturile devin CC BY-SA 4.0.
**Recomandare:** A acum (câștigul e mic: 178 de fapte, mai ales `is_a` pe care WordNet le acoperă deja în bună parte); B dacă măsurătorile pe cărțile de probleme arată un câștig, pentru că păstrează baza implicită fără obligația ShareAlike.
**Răspuns:**
