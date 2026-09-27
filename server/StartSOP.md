# Pornire — RecallSOP

## Profilul v3: traseul recomandat

```bash
node examples/reasoning-demo.js
node tools/verify.js
```

Apoi citește `docs/requirements/23-arhitectura-consolidata.md`, `24-semantica-firelor.md` și `25-motorul-de-referinta.md`. Alegerea memoriei nu schimbă alegerea motorului de reasoning. `runtime-reference.json` este SQLite + JS; `runtime-advanced.json` este SQLite + solvere opționale; `runtime-hybrid.json` adaugă banca asociativă.

Înainte de training, generează datele v3 cu `node tools/build-data.js --worlds 30 --out data/generated`; rulează check-data și audit_tokens. `tools/generate-data.js` singur produce doar subsetul factual original. Skill-urile noi sunt `reasoning-review`, `extend-reasoning` și `mine-patterns`.

Modelele și solvere externe nu sunt incluse. Verificările reale și skip-urile sunt în `reports/verification.json`. Nu interpreta fallback-ul avansat drept execuție Prolog/Z3.

Dezarhivează `RecallSOP.zip` și intră în `RecallSOP/`. Acest ghid este inclus în ZIP.

```bash
node tools/verify.js
node examples/linker-demo.js
node examples/forgetting-demo.js
node examples/shards-demo.js
node cli.js init
node cli.js run --file examples/auto-link.sop
node cli.js run --file examples/auto-mixed.sop
node cli.js run --file examples/auto-template.sop
```

Aceste teste rulează pe CPU cu Node.js 22.13+, fără npm dependencies, fără modele descărcate și fără Prolog/Z3 obligatorii. `verify` verifică separat disponibilitatea backend-urilor externe. Python este necesar pentru fine-tuning, nu pentru kernelul SOP.

## Citește întâi

`docs/requirements/13-strategii.md`: Recall Weaver este una dintre strategiile sistemului, nu o obligație pentru tot agentul.

`docs/requirements/14-output-linker.md`: cum o necunoscută `?nume` devine firul `$nume`, cum se găsesc premisele în memorie și ce primesc solverele.

`docs/requirements/15-experiment-linker.md`: ce este demonstrat offline și ce trebuie evaluat neuronal.

`docs/requirements/16-uitare-capacitate.md`: mecanismul concret de reinforcement, pressure decay, pinned și modul fără uitare.

`docs/requirements/17-algoritmi.md`: harta tuturor algoritmilor, de la formalizare până la CNL.

## Două minute pentru sintaxă

```sop
@q query
  select ?bunica
  where grandmother(?bunica, carina)
  at 2026-09-26
@r solve
  query $q
  output ?bunica one
@answer cnl
  result $r
  language ro
```

Nu scrii `@bunica`. Runtime-ul creează ieșirea; un fir ulterior poate citi `$bunica`. Dacă rezultatul nu este unic, firul nu primește o valoare arbitrară. `many` întoarce o colecție; `rows` păstrează tuplurile.

## Experimentul neuronal pe DGX Spark

Citește `docs/requirements/07-date.md`, `08-spark.md` și `15-experiment-linker.md`. Generează date, adaugă parafraze românești revizuite și rulează verificarea executabilă înainte de fine-tuning. Pachetul păstrează pipeline-ul pentru două adaptoare mici. Nu include greutăți antrenate.

```bash
node tools/generate-data.js --out data/generated --worlds 100 --seed 731
node tools/check-data.js --dir data/generated --execute
# Urmează 08-spark.md pentru mediu, model, antrenare și export.
```

Pentru un coding agent: `AGENTS.md` și `skills/link-circuit/SKILL.md`. Rapoartele de execuție sunt în `reports/`, inclusiv subfolderul `linker/`.


## Profiluri de retenție

Profilul implicit folosește **shard-uri generaționale bounded**. Datele noi intră într-o generație activă; o generație plină este închisă; premisele folosite în proof sunt promovate. Generațiile normale vechi pot fi eliminate, dar pinned și baza comună sunt protejate. Nu se schimbă sintaxa SOP sau țintele de fine-tuning.

```bash
node cli.js init --config config/runtime-sharded.json
node cli.js stats --config config/runtime-sharded.json
node cli.js maintain --config config/runtime-sharded.json
node cli.js gc --config config/runtime-sharded.json          # doar raport
node cli.js gc --config config/runtime-sharded.json --apply  # numai obiecte fără referințe
```

`config/runtime-sharded-archive.json` păstrează toate generațiile, fără uitare automată. Profilul vechi cu răcire per contor rămâne în `runtime-adaptive.json`, pentru experimente separate.

**Citește `docs/requirements/18-sharduri.md`** pentru mecanism, limite, parametri, migrare și garbage collection. O sesiune veche este o referință validă la istorie; discul se poate elibera numai după închiderea ei. `close-session` pierde schimbările necommitted: folosește `commit` înainte când trebuie păstrate.

```bash
node cli.js commit --config config/runtime-sharded.json --session s1
node cli.js close-session --config config/runtime-sharded.json --session s1
node cli.js gc --config config/runtime-sharded.json --apply
```

Sesiunile existente nu își schimbă formatul automat. Pentru datele vechi, fă o copie de siguranță și urmează migrarea explicită din capitolul 18. Shard-urile pot avea geometrii diferite; creșterea lui `power` afectează băncile noi, nu rescrie hash-urile celor vechi.

## Verificare numai pe CPU

```bash
node --test tests/shards.test.js
node examples/shards-demo.js
node tools/bench-shards.js --facts 2000 --queries 200 --seed 731
node tools/check-data.js --dir data/seed --execute --sharded
```

Rapoartele generate sunt în `reports/shards/`, `reports/data-sharded.json` și `reports/verification.json`. Benchmark-ul este sintetic; modelele lingvistice nu sunt antrenate sau evaluate prin aceste comenzi.

## Compară strategiile de memorie

```bash
node examples/memory-demo.js
node --test tests/memory-engines.test.js
node cli.js init --config config/runtime-sqlite.json
node cli.js run --config config/runtime-sqlite.json --file examples/auto-link.sop
node cli.js init --config config/runtime-holo.json
node cli.js run --config config/runtime-holo.json --file examples/auto-link.sop
```

Pentru o bază simplă, fără întreg repository-ul de snapshot-uri:

```bash
node tools/sqlite-simple.js ingest --db demo.sqlite --file examples/memory-knowledge.sop --reviewed
node tools/sqlite-simple.js query --db demo.sqlite --file examples/memory-query.sop
```

Holo/Weaver reconstruiesc candidați; SQLite și scan păstrează tuplele exact. În comparația furnizată, SQLite este reperul cel mai bun pentru interogări exacte. Holo este interesant pentru asociere/deteriorare/uitare; recuperarea tuturor valorilor unei chei frecvente necesită îmbunătățiri. Detalii și costuri complete: capitolele 19–22.

```bash
node tools/bench-memory.js --counts 10000,100000 --seeds 11,29,53 --queries 80
node tools/summarize-memory.js
node tools/bench-h7.js
node tools/check-data.js --dir data/seed --execute --engine holo
node tools/check-data.js --dir data/seed --execute --engine sqlite
```

Nu schimba motorul peste aceleași fișiere și nu presupune că băncile se convertesc. Profilurile oferite folosesc directoare separate. `StartSOP.md` rămâne în rădăcina ZIP-ului.
