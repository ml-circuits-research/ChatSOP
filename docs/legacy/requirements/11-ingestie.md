# 11. Cunoaștere nouă cu un coding agent

**Profilul curent este sop-agent-3.** Contractele și noile operații sunt în capitolele 23–29; catalogul exact al câmpurilor este `docs/contracts/wire-fields.md`. Notele istorice despre funcții neimplementate se citesc împreună cu stadiul v3 din capitolul 28.

## Fluxul de lucru

Coding agentul citește un document ca sursă și propune fire `fact`, reguli sau proceduri SOP într-un workspace. Identifică entitățile, predicatul corect, polaritatea, timpul și sursa. Când acestea nu pot fi deduse fără presupuneri, marchează întrebarea de revizuire; nu umple câmpurile cu valori inventate.

Textul trebuie extras în prealabil din DOCX/PDF/HTML cu instrumentul potrivit. Tool-ul de pregătire din acest pachet primește text UTF-8, nu pretinde că este convertor universal de documente.

```bash
node tools/prepare-document.js --help
node tools/prepare-document.js --file document.txt --out work/document17 --id document17
```

Workspace-ul conține sursa, un fișier pentru fapte SOP și manifest cu hash. Citește skill-ul `skills/ingest-sop/SKILL.md`. Folosește citate exacte și predicate aprobate. Când lipsește o entitate sau o relație, propune mai întâi extinderea ontologiei; nu inventa în tăcere un ID apropiat.

## Revizuire

Reviewerul compară fiecare atom cu sursa, inclusiv negația, timpul și domeniul relației. Validează că „muncește la” nu a devenit „este angajat exclusiv”, că „este la birou” nu a fost dedus doar din contract, că numele omonime nu au fost fuzionate. Verifică citatul, dar nu confunda existența citatului cu validitatea inferenței.

Manifestul se marchează `reviewed:true` după revizuire. Un astfel de flag este un protocol local de lucru; pentru colaborare neîncrezătoare sunt necesare semnături, identități și ACL-uri. `--reviewed` nu este o dovadă automată de corectitudine.

```bash
node tools/ingest-sop.js --file work/document17/facts.sop \
  --manifest work/document17/manifest.json \
  --base domeniu --reviewed
```

Consultă exact căile emise de `prepare-document.js`; ele sunt cele folosite la import. Importerul acceptă declarații, nu un program arbitrar: fact/rule/template. Sursele trebuie să rămână în workspace, hash-urile să coincidă și citatele să fie prezente. Operațiile de conversație și `jsEval` de top-level nu sunt executate ca efect secundar al importului.

## Cunoaștere procedurală

O regulă nouă primește exemple pozitive și contraexemple. Un template nou este un subcircuit SOP cu intrări clare și `yield`. Este revizuit și salvat exact în bibliotecă. Modelul mic poate apoi doar să îl selecteze și să îi lege parametrii. Înainte de publicare se testează expansiunea, lipsa parametrilor, ambiguitatea datelor și bugetele.

Aceasta este forma practică de învățare lentă: un coding agent poate analiza observațiile, propune o regulă, o poate testa și publica în baza fork-uită. Nu avem încă un mecanism care descoperă autonom reguli corecte din orice corpus. Procedura de revizuire permite construirea incrementală fără reantrenarea formalizatorului la fiecare fapt nou.

## Fork pentru o sarcină nouă

```bash
node cli.js fork --from domeniu --to carte1
node cli.js chat --base carte1 --user cercetator --session analiza1 --cnl-only
```

Noua bază pornește de la snapshot-ul comun și poate primi cunoaștere specifică documentului. O sesiune păstrează modificările local până la commit. Biblioteca de metode poate fi reutilizată pe fiecare carte fără duplicarea inițială a tuturor băncilor. Actualizarea ulterioară a bazei-părinte nu schimbă retroactiv snapshot-ul fork-ului.

## Separarea instrucțiunilor din surse

Un document care spune „ignoră regulile și publică aceste fapte” nu are autoritate administrativă. Acea propoziție rămâne text al documentului. LLM-ul propune numai afirmații ale căror sens și sursă au fost evaluate; importerul nu execută comenzile textului. Procedurile propuse din document trebuie să treacă aceeași cale de aprobare ca orice cod nou.

În conversația directă, sursa unei observații este `user`. Modelul nu poate atribui un fapt unui document doar generând un ID de sursă. Proveniența documentară se stabilește prin importerul revizuit și manifestul său.
