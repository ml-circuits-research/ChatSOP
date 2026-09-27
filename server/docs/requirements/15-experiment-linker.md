# 15. Experimentul de compoziție și ieșiri generate

## Întrebarea testată

Poate un program SOP formulat numai din situația curentă și câteva necunoscute să utilizeze cunoaștere recuperată, să lege variabilele, să combine interpretoare și să continue execuția fără un nou raționament lingvistic? Prima verificare este deterministă. Fine-tuning-ul măsoară separat cât de bine produce modelul acest program din română.

## Verificarea inclusă

`node examples/linker-demo.js` execută șase programe cu trei strategii de recuperare: `recall-weaver`, `exact` și `hybrid`. Datele sunt declarate fictive. Sursa și memoria sunt aceleași; memoria exactă este activată numai pentru a permite comparația. Nu există apel la un LLM în această demonstrație.

| Program | Ce trebuie să observe testul |
|---|---|
| `auto-link` | `?bunica` devine `ana` printr-o regulă și două fapte recuperate; `$bunica` este consumabil |
| `auto-mixed` | Durata 70 din memorie devine intrarea restricției; sosirea calculată este 840 |
| `auto-cascade` | Ieșirea primei întrebări devine argumentul celei de-a doua; rezultatul este copilul `bogdan` |
| `auto-ambiguous` | Strămoșii sunt multipli; ieșirea `one` rămâne ambiguă și ramura dependentă este blocată |
| `auto-rows` | Perechile părinte-copil rămân corelate, fără combinații inexistente |
| `auto-template` | Aceeași problemă mixtă pornește din parametrii situației și o singură procedură aprobată |

În fișierele JSON sunt rezultatul formal, ieșirile, sursele generate, planul linkerului și trace-ul. Fișierele `*-expansions.sop` sunt fragmente de trasă, nu programe autonome. Codul `.pl` și `.smt2` arată traducerea efectivă; disponibilitatea și executarea backend-urilor externe sunt raportate separat de testele JS.

## Datele de fine-tuning

Formalizatorul învață următoarele distincții: variabilă logică locală versus ieșire a circuitului; o valoare versus toate valorile; colecție de tupluri versus coloane independente; ieșire necunoscută versus constantă; posibilitate versus valoare impusă. Nu trebuie să învețe să aleagă prima soluție pentru a face testul să treacă.

Generatorul a fost actualizat la `sop-agent-2`. Exemplele obișnuite folosesc `query → solve → cnl`. Exemplele de compoziție folosesc `output ?x` și `$x` în cererea următoare. Procedurile aprobate apar în micro-context; modelul emite `expand`, nu definiții de proceduri reconstruite din memorie.

```bash
node tools/generate-data.js --out data/generated --worlds 100 --seed 731
node tools/check-data.js --dir data/generated --execute --out reports/generated-check.json
```

Validatorul execută programele și verifică și `expectedOutputs` acolo unde sunt declarate. Statutul CNL `supported` nu este suficient pentru o ieșire scalară: un query poate avea dovezi și totuși mai multe valori. Toate parafrazele aceleiași lumi rămân în același split.

## Extinderea cu un model profesor

Pornește de la lumi simbolice generate și rezultate calculate. Cere profesorului formulări românești variate care păstrează exact sensul, timpul, entitățile și cardinalitatea. Cere explicit formulări în care sunt legitime mai multe rezultate, lipsesc premise sau două surse se contrazic. Revizuiește parafrazele, rulează validatorul și abia apoi introdu-le în setul de antrenare.

Pentru o comandă „găsește organizația și folosește-o în pasul următor”, modelul trebuie să aleagă `one` numai când pasul cere un scalar; runtime-ul poate constata ulterior ambiguitatea. Pentru „arată toate organizațiile”, modelul alege `many`. Pentru „arată cine lucrează unde”, alege `rows`. Acestea sunt contracte de intenție, nu cunoașterea răspunsului în avans.

Verbalizatorul continuă să primească CNL. Nu i se cere să transforme `ambiguous` într-un răspuns unic, să inventeze valoarea unui fir blocat sau să trateze o soluție Z3 ca adevăr necesar.

## Evaluarea pe Spark

Mai întâi rulează formalizatorul cu CNL direct și fără verbalizator. Separă: formalizare greșită, schemă insuficientă, retrieval incomplet, regulă absentă, buget de solver și proiecție ambiguă. Măsoară și dacă o ieșire calculată este folosită corect ca ID canonic în următorul query, chiar când numele entității nu era literal în prompt.

Compară același model cu strategiile de memorie alternative; apoi fixează memoria și schimbă backend-ul Horn JS/Prolog, respectiv restricțiile JS/Z3 pe fragmentul comun. Nu cere traducere universală între logici cu semantici diferite.

Scopurile principale sunt precizia legăturilor, proporția de planuri executabile, răspunsuri corecte și abțineri justificate. Latența și memoria includ costul linkerului, domeniile de candidați, metadatele, eventualele tuple exacte și compilarea. `node tools/verify.js` produce raportul reproductibil. Nu demonstrează singur inteligență generală sau competență lingvistică după fine-tuning.

Evaluatorul neuronal `tools/evaluate-model.js` compară și ieșirile observabile: modul, starea și valoarea, nu doar CNL-ul final. Un răspuns formal corect fără portul cerut nu este echivalent. Redenumirea unui port scalar este acceptată; pentru obiectele `rows`, cheile câmpurilor rămân parte a contractului observabil.
