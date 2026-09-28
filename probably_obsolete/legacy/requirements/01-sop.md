> Historical contract only. The current `sop-agent-3` parser requires whitespace-separated atoms and uses `remember` rather than the retired `assert` wire. See `docs/specs/DS004-sop.md`; preserve the following period-specific examples as historical material, not runnable current syntax.

# 01. Profilul SOP pentru cunoaștere și execuție

**Profilul curent este sop-agent-3.** Contractele și noile operații sunt în capitolele 23–29; catalogul exact al câmpurilor este `docs/contracts/wire-fields.md`. Notele istorice despre funcții neimplementate se citesc împreună cu stadiul v3 din capitolul 28.

## Convenții

Un fir începe la început de linie cu `@nume tip`. Câmpurile sunt indentate cu două spații. Un câmp cu `|` are corp multilinie indentat cu patru spații. Comentariile ocupă linii care încep cu `#`. Identificatorii firelor sunt unici într-un circuit.

`$nume` consumă valoarea unui fir și creează dependență de execuție. `~nume` numește definiția unui fir, fără a cere execuția sa ca valoare. `?x` este variabilă logică locală regulii/interogării/restricției. În `output ?x one` de pe un fir `solve`, ea declară suplimentar o ieșire a circuitului: nu scriem `@x`, iar după rezolvare consumăm `$x`. Fără export explicit, variabilele omonime din query-uri diferite nu sunt legate. Referințele din șiruri între ghilimele sunt text, nu dependențe. `source`, `quote` și `text` sunt tratate ca text, nu ca instrucțiuni ascunse.

Predicatele și ID-urile canonice folosesc litere mici, cifre și underscore; etichetele românești stau în ontologie. Constantele text se scriu între ghilimele duble. Argumentele pot fi ID-uri, șiruri, întregi sau valori scalare `$fir`. Într-un `fact` nu rămân variabile logice nelegate. Profilul curent acceptă predicate cu 1–4 argumente.

## Inventarul coerent de fire

| Tip | Câmpuri și rezultat |
|---|---|
| `value` | `data`; valoare pură, de exemplu text, număr, array sau obiect |
| `fact` | `holds`, `valid`; opțional `source`, `quote`, `retention`; afirmație fără efect de scriere |
| `rule` | unul sau mai multe `when`, un `then`, opțional `valid`; regulă Horn sigură |
| `query` | `where` repetabil; `mode`, `select`, `filter`, `at` sau `during`, `asof`, `limit` |
| `constraint` | `var` repetabil, `require` repetabil, `claim`, `task`, `unit` |
| `event` | `action`, `target`; `effective` pentru end, `replacement` pentru correct, `source` |
| `pack` | `items` cu referințe de valori; grup explicit de fapte/reguli |
| `assert` | `input` repetabil, `scope session`, `after` opțional; scriere efectivă |
| `recall` / `link` | `query $q`, `data`, `strategy`, `after`; premise, reguli și planul de recuperare |
| `solve` | `query` sau `constraint`; `data`, `strategy`, `backend`, `assume`, `after`; `output ?nume [one/many/rows/count/status]` repetabil; rezultatul și firele generate |
| `reason` | fie `query` plus `memory` sau `data`, fie `constraint`; `backend`, `assume`, `after` opțional |
| `cnl` | `result $r`, `language ro` sau `en`; răspuns controlat și pachetul exact |
| `jsEval` | `expr`; expresie JS restrânsă și interpretată, fără acces la sistem |
| `template` | `params`, `yield`, `body`, opțional `description` și `cue`; definiție reutilizabilă, aprobată |
| `expand` | `using ~template`, `with` repetabil, `after`; instanțiere și extindere a grafului |
| `clarify` | `text`; oprire cu întrebare explicită, fără a inventa formalizarea |

Nu există un `not` generic asupra oricărui program. `not p(a,b)` este un atom negativ explicit. Absența lui `p(a,b)` nu creează negația lui.

## Afirmație și scriere

```sop
@f fact
  holds works_at(maria, lab_alpha)
  valid 2024-01-01 open
  source "document_17"
  quote "Maria lucrează la Alfa din 2024."
  retention normal

@save assert
  input $f
  scope session
```

`valid beginning open` înseamnă interval deschis nelimitat; `valid timeless` este echivalent pentru o relație declarată fără temporalitate. `open` nu înseamnă că știm sigur viitorul: este limita neprecizată a afirmației. `retention pinned` solicită banca protejată, dacă host-ul permite. Simpla definire a lui `@f` nu modifică memoria.

## Reguli și precizie semantică

```sop
@mother_parent rule
  when mother(?x, ?y)
  then parent(?x, ?y)

@grandmother rule
  when mother(?x, ?y)
  when parent(?y, ?z)
  then grandmother(?x, ?z)
```

Toate variabilele din concluzie trebuie să apară în premise. Nu există simboluri-funcții care generează termeni tot mai mari, cuantificare existențială în concluzie sau execuție arbitrară. Recursia este permisă, dar limitată prin buget. Numele „Ana” nu este folosit ca dovadă de gen; regula folosește relația maternală explicită.

## Întrebări

```sop
@q query
  mode select
  select ?organization
  where works_at(maria, ?organization)
  during 2025-01-01 2026-01-01
  asof 2026-09-26
  limit 20
```

`during` cere răspunsuri cu intervalele în care există suport, nu dovadă că relația este adevărată în întregul interval. „În 2025” rămâne un interval; nu se transformă arbitrar în 1 iunie. `at` cere un moment. Fără ambele, host-ul fixează o singură valoare `now` pentru întregul circuit.

`mode exists` verifică un atom sau o conjuncție. `mode count` numără legăturile distincte recuperate pentru variabilele selectate, cu indicator de completitudine. `mode explain` păstrează dovezile. Mai multe `where` înseamnă conjuncție. `filter ?n >= 5` filtrează variabile deja legate de premise; nu inventează un domeniu pentru ele. Disjuncția liberă și agregările universale nu fac parte din acest profil.

## Restricții numerice

```sop
@timing constraint
  var ?arrival int 840 900
  require ?arrival >= 840
  claim ?arrival <= 840
  task possible
  unit minute_from_midnight

@result reason
  constraint $timing
  backend auto

@answer cnl
  result $result
  language ro
```

Acest exemplu este posibil, dar nu demonstrat pentru toate valorile permise. `task prove` schimbă întrebarea, nu premisele. Variabilele fără limite se declară `var ?x int` și cer un backend capabil; evaluatorul JS finit nu ghicește limite. `unit` este adnotarea blocului; conversia unităților și alegerea aceleiași zile/fus trebuie făcute înainte. Nu există încă o algebră completă a dimensiunilor fizice.

## Actualizări

```sop
@end event
  action end
  target "c_identificatorul_afirmatiei"
  effective 2026-03-01
  source user

@save assert
  input $end
```

Un ID real vine din recepția unei scrieri ori din proveniența unei citiri. Alternativ `target $saved` este permis când `$saved` identifică exact o afirmație. O corecție folosește `action correct`, `target` și `replacement $new_fact`; retractarea și inserarea se fac în aceeași undă de efecte. Detaliile sunt în `05-timp.md`.

## Proceduri recuperabile

```sop
@find_ancestors template
  params person
  yield answer
  body |
    @q query
      mode select
      select ?who
      where ancestor(?who, $person)
    @m recall
      query $q
    @r reason
      query $q
      memory $m
    @answer cnl
      result $r
      language ro

@person value
  data "carina"

@reply expand
  using ~find_ancestors
  with person $person
```

Modelul conversațional emite numai cele două fire de la sfârșit. Template-ul vine din biblioteca aprobată. `expand` substituie parametrii ca valori, redenumește firele locale și programează noul subgraf. Interpretorul nu cere modelului să genereze pașii de reasoning deja disponibili în procedură.

## Expresii și extensii

```sop
@text value
  data "  ŞTIINŢĂ  "

@clean jsEval
  expr $text.trim().toLowerCase().replaceAll("ş", "ș").replaceAll("ţ", "ț")
```

Noile tipuri de fire se înregistrează în host prin `handlers`. Ele trebuie să aibă un contract documentat și teste; modelul nu poate încărca un fișier JS indicând o cale în SOP. Pentru tipurile standard, câmpurile necunoscute sunt erori, nu extensii tăcute.

## Ieșiri materializate de runtime

```sop
@q query
  select ?who
  where grandmother(?who, carina)

@r solve
  query $q
  output ?who one

@label jsEval
  expr "Rezultat: " + $who
```

`one` cere o valoare distinctă; `many` expune o listă; `rows` expune rânduri complete pentru mai multe variabile; `count` cere query de numărare; `status` expune verdictul. `rows`, `count` și `status` numesc un container nou, nu o variabilă ce trebuie selectată. `one`/`many` se referă la variabile selectate sau la variabile declarate ale restricției. Backend-ul poate limita modurile disponibile; proiecțiile Z3 sunt momentan scalare, nu enumerare exhaustivă.

Două producătoare ale aceluiași nume sunt o eroare. Un `@who` explicit lângă `output ?who` este de asemenea o eroare. `binding` este tip de fir intern creat de runtime, niciodată instrucțiune emisă de model. Capitolul 14 explică verificarea cardinalității, ciclurile, epocile și codul compilat.
